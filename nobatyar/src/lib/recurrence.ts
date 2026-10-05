/**
 * Recurring appointments.
 *
 * A series is a group of appointments that share `recurrenceGroupId`. The first
 * occurrence is the one the customer picked; the rest are generated at the same
 * time of day, one interval apart. Every occurrence is validated individually —
 * if one is not free the whole series is refused and nothing is written, so a
 * customer never ends up with a half-booked series.
 *
 * The date arithmetic lives in `recurrence-plan.ts` (pure, unit tested); this
 * module only talks to the database.
 */
import "server-only";

import { prisma } from "./db";
import { createAppointment, type BookingInput } from "./booking";
import { slotKeyOf } from "./slot-key";
import { civilOf } from "./dates";
import { minuteOfDay, planSeries } from "./recurrence-plan";

/**
 * A weekly series writes up to 12 appointments in one transaction, so it needs
 * a bigger budget than a single booking — and, more to the point, it must not
 * abort halfway and leave a partial series behind (see BOOKING_TX in booking.ts
 * for why Prisma's 5 s default is too tight here).
 */
export const SERIES_TX = { maxWait: 15_000, timeout: 30_000 } as const;
import { verifySlot } from "./availability-server";
import { getWorkspace } from "./queries";

export const MIN_OCCURRENCES = 1;
export const MAX_OCCURRENCES = 12;
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 90;

/** Guard used by the form (and by anything that builds a series by hand). */
export function isValidSeries(count: number, interval: number): boolean {
  return (
    Number.isInteger(count) &&
    count >= MIN_OCCURRENCES &&
    count <= MAX_OCCURRENCES &&
    Number.isInteger(interval) &&
    interval >= MIN_INTERVAL_DAYS &&
    interval <= MAX_INTERVAL_DAYS
  );
}

export type SeriesResult =
  | { ok: true; groupId: string; appointmentIds: string[]; trackingCodes: string[] }
  | { ok: false; error: "SLOT_TAKEN" | "INVALID" | "PARTIAL"; failedIndex?: number };

/**
 * Book `count` occurrences, `interval` days apart, on the same time of day.
 * All-or-nothing: the whole series is validated before anything is written.
 */
export async function createRecurringSeries(
  input: BookingInput,
  options: { count: number; interval: number },
): Promise<SeriesResult> {
  if (!isValidSeries(options.count, options.interval)) {
    return { ok: false, error: "INVALID" };
  }

  if (options.count === 1) {
    const single = await createAppointment(input);
    if (!single.ok) {
      return { ok: false, error: single.error === "SLOT_TAKEN" ? "SLOT_TAKEN" : "INVALID" };
    }
    return {
      ok: true,
      groupId: single.appointmentId,
      appointmentIds: [single.appointmentId],
      trackingCodes: [single.trackingCode],
    };
  }

  const workspace = await getWorkspace();
  const timeZone = workspace.timezone;
  const firstDay = civilOf(new Date(input.startMs), timeZone);
  const { starts } = planSeries({
    firstDay,
    minuteOfDay: minuteOfDay(input.startMs, firstDay, timeZone),
    count: options.count,
    intervalDays: options.interval,
    timeZone,
  });

  // ── validate every occurrence first ──────────────────────────────────────
  for (let index = 0; index < starts.length; index += 1) {
    const check = await verifySlot({
      workspaceId: input.workspaceId,
      serviceId: input.serviceId,
      staffId: input.staffId,
      startMs: starts[index],
      ...(input.locationId ? { locationId: input.locationId } : {}),
    });
    if (!check.ok) return { ok: false, error: "PARTIAL", failedIndex: index };
  }

  // ── write them, all inside one transaction ───────────────────────────────
  const service = await prisma.service.findUniqueOrThrow({
    where: { id: input.serviceId },
    select: { durationMin: true, priceAmount: true },
  });
  const groupId = `rec_${crypto.randomUUID()}`;
  const created: { id: string; trackingCode: string }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      // a package session is spent per occurrence, inside the same transaction
      const { consumeSession } = await import("./packages");

      for (let index = 0; index < starts.length; index += 1) {
        const start = starts[index];
        const end = start + service.durationMin * 60_000;

        // last-moment re-check: closes the race window inside the transaction
        const clash = await tx.appointment.findFirst({
          where: {
            staffId: input.staffId,
            status: { in: ["PENDING", "CONFIRMED"] },
            startsAt: { lt: new Date(end) },
            endsAt: { gt: new Date(start) },
          },
          select: { id: true },
        });
        if (clash) throw new Error("SLOT_TAKEN");

        let packagePurchaseId: string | null = null;
        if (input.packagePurchaseId && input.customerUserId) {
          const used = await consumeSession(tx, input.packagePurchaseId, input.serviceId);
          if (used) packagePurchaseId = input.packagePurchaseId;
        }

        const row = await tx.appointment.create({
          data: {
            workspaceId: input.workspaceId,
            serviceId: input.serviceId,
            staffId: input.staffId,
            customerUserId: input.customerUserId ?? null,
            customerName: input.customerName,
            customerEmail: input.customerEmail ?? null,
            customerPhone: input.customerPhone,
            startsAt: new Date(start),
            endsAt: new Date(end),
            status: "CONFIRMED",
            source: input.source ?? "WEB",
            trackingCode: `APT-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
            priceAmount: service.priceAmount,
            notes: input.notes ?? null,
            recurrenceGroupId: groupId,
            recurrenceIndex: index,
            packagePurchaseId,
            ...(input.locationId ? { locationId: input.locationId } : {}),
            slotKey: slotKeyOf(input.staffId, start),
          },
          select: { id: true, trackingCode: true },
        });
        created.push(row);
      }
    }, SERIES_TX);
  } catch (error) {
    if (error instanceof Error && error.message.includes("SLOT_TAKEN")) {
      return { ok: false, error: "SLOT_TAKEN" };
    }
    throw error;
  }

  return {
    ok: true,
    groupId,
    appointmentIds: created.map((row) => row.id),
    trackingCodes: created.map((row) => row.trackingCode),
  };
}

/** Cancel every remaining occurrence of a series. */
export async function cancelSeries(
  appointmentId: string,
  reason = "series cancelled",
): Promise<number> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { recurrenceGroupId: true },
  });
  if (!appointment?.recurrenceGroupId) return 0;

  const result = await prisma.appointment.updateMany({
    where: {
      recurrenceGroupId: appointment.recurrenceGroupId,
      status: { in: ["PENDING", "CONFIRMED"] },
    },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: reason,
      // every freed slot goes back on the calendar
      slotKey: null,
    },
  });
  return result.count;
}

/** Every appointment of one series, in order. */
export async function seriesOf(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { recurrenceGroupId: true },
  });
  if (!appointment?.recurrenceGroupId) return [];
  return prisma.appointment.findMany({
    where: { recurrenceGroupId: appointment.recurrenceGroupId },
    orderBy: { startsAt: "asc" },
  });
}
