/**
 * Booking writes.
 *
 * Every rule that protects the calendar lives here and is enforced twice:
 *  1. a re-check inside the transaction (friendly error messages)
 *  2. the unique index (staffId, startsAt) — the real guarantee under load
 */
import "server-only";

import { prisma } from "./db";
import { audit, getSession } from "./auth";
import { civilOf } from "./dates";
import { verifySlot } from "./availability-server";
import { holdsSlot, slotKeyOf } from "./slot-key";

export { holdsSlot, slotKeyOf } from "./slot-key";

export const ACTIVE_STATUSES = ["PENDING", "CONFIRMED"] as const;

export type BookingInput = {
  workspaceId: string;
  serviceId: string;
  staffId: string;
  startMs: number;
  customerName: string;
  customerEmail?: string | null;
  customerPhone: string;
  notes?: string | null;
  customerUserId?: string | null;
  source?: string;
  locationId?: string | null;
  packagePurchaseId?: string | null;
};

export type BookingResult =
  | { ok: true; appointmentId: string; trackingCode: string; status: string }
  | { ok: false; error: "SLOT_TAKEN" | "CLOSED" | "INVALID" | "MAX_PER_DAY" };

function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `APT-${out}`;
}

export async function createAppointment(input: BookingInput): Promise<BookingResult> {
  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    select: {
      id: true,
      durationMin: true,
      priceAmount: true,
      maxPerDay: true,
      isActive: true,
      isPublic: true,
      workspaceId: true,
    },
  });
  if (!service || !service.isActive || !service.isPublic) return { ok: false, error: "INVALID" };
  if (service.workspaceId !== input.workspaceId) return { ok: false, error: "INVALID" };

  const check = await verifySlot({
    workspaceId: input.workspaceId,
    serviceId: input.serviceId,
    staffId: input.staffId,
    startMs: input.startMs,
    ...(input.locationId ? { locationId: input.locationId } : {}),
  });
  if (!check.ok) return { ok: false, error: "SLOT_TAKEN" };

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: { timezone: true, autoConfirm: true, maxAdvanceDays: true },
  });
  const start = new Date(input.startMs);
  const end = new Date(check.endMs);

  // per-customer daily cap
  if (service.maxPerDay && input.customerUserId) {
    const dayStart = civilOf(start, workspace.timezone);
    const sameDay = await prisma.appointment.count({
      where: {
        customerUserId: input.customerUserId,
        serviceId: service.id,
        status: { in: [...ACTIVE_STATUSES] },
        startsAt: {
          gte: new Date(`${dayStart.year}-${String(dayStart.month).padStart(2, "0")}-${String(dayStart.day).padStart(2, "0")}T00:00:00.000Z`),
          lt: new Date(`${dayStart.year}-${String(dayStart.month).padStart(2, "0")}-${String(dayStart.day).padStart(2, "0")}T23:59:59.999Z`),
        },
      },
    });
    if (sameDay >= service.maxPerDay) return { ok: false, error: "MAX_PER_DAY" };
  }

  const status = workspace.autoConfirm ? "CONFIRMED" : "PENDING";

  try {
    const appointment = await prisma.$transaction(async (tx) => {
      // re-check inside the transaction: closes the race window
      const clash = await tx.appointment.findFirst({
        where: {
          staffId: input.staffId,
          status: { in: [...ACTIVE_STATUSES] },
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
        select: { id: true },
      });
      if (clash) throw new Error("SLOT_TAKEN");

      // optionally spend one session of a prepaid package (atomic decrement)
      let packagePurchaseId: string | null = null;
      if (input.packagePurchaseId && input.customerUserId) {
        const { consumeSession } = await import("./packages");
        const used = await consumeSession(tx, input.packagePurchaseId, service.id);
        if (used) packagePurchaseId = input.packagePurchaseId;
      }

      return tx.appointment.create({
        data: {
          workspaceId: input.workspaceId,
          serviceId: service.id,
          staffId: input.staffId,
          locationId: input.locationId ?? null,
          customerUserId: input.customerUserId ?? null,
          customerName: input.customerName,
          customerEmail: input.customerEmail ?? null,
          customerPhone: input.customerPhone,
          startsAt: start,
          endsAt: end,
          status,
          source: input.source ?? "WEB",
          trackingCode: makeCode(),
          priceAmount: service.priceAmount,
          notes: input.notes ?? null,
          packagePurchaseId,
          // reserve the slot: the unique index refuses a concurrent second claim
          slotKey: slotKeyOf(input.staffId, start),
        },
        select: { id: true, trackingCode: true, status: true },
      });
    });

    await audit({
      action: "APPOINTMENT_CREATE",
      workspaceId: input.workspaceId,
      entity: "appointment",
      entityId: appointment.id,
      meta: { serviceId: service.id, staffId: input.staffId, start: start.toISOString() },
      actorUserId: input.customerUserId ?? null,
    });

    return { ok: true, appointmentId: appointment.id, trackingCode: appointment.trackingCode, status: appointment.status };
  } catch (error) {
    // Prisma P2002 = unique constraint (the DB-level double-booking guard)
    if (error instanceof Error && (error.message.includes("SLOT_TAKEN") || error.message.includes("Unique constraint"))) {
      return { ok: false, error: "SLOT_TAKEN" };
    }
    throw error;
  }
}

export type StatusUpdate = "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW" | "PENDING";

const TRANSITIONS: Record<string, StatusUpdate[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export async function updateAppointmentStatus(params: {
  appointmentId: string;
  status: StatusUpdate;
  reason?: string | null;
}): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" | "INVALID_TRANSITION" }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    select: { id: true, status: true, workspaceId: true, customerUserId: true, staffId: true, slotKey: true },
  });
  if (!appointment) return { ok: false, error: "NOT_FOUND" };
  if (!TRANSITIONS[appointment.status]?.includes(params.status)) {
    return { ok: false, error: "INVALID_TRANSITION" };
  }

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      status: params.status,
      cancelledAt: params.status === "CANCELLED" ? new Date() : null,
      cancelReason: params.status === "CANCELLED" ? (params.reason ?? null) : null,
      // give the slot back: this is what makes the time bookable again
      slotKey: holdsSlot(params.status) ? appointment.slotKey : null,
    },
  });

  await audit({
    action: `APPOINTMENT_${params.status}`,
    workspaceId: appointment.workspaceId,
    entity: "appointment",
    entityId: appointment.id,
    meta: { from: appointment.status, reason: params.reason ?? null },
    actorUserId: (await getSession())?.sub ?? null,
  });

  if (params.status === "CANCELLED") {
    const { notifyWaitlist } = await import("./notifications");
    await notifyWaitlist(appointment.workspaceId, appointment.staffId, appointment.id);
  }
  return { ok: true };
}

/** Move an appointment: frees the old slot and reserves the new one atomically. */
export async function rescheduleAppointment(params: {
  appointmentId: string;
  newStartMs: number;
  newStaffId?: string;
}): Promise<{ ok: true; newId: string } | { ok: false; error: "NOT_FOUND" | "SLOT_TAKEN" }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    select: {
      id: true,
      status: true,
      workspaceId: true,
      serviceId: true,
      staffId: true,
      locationId: true,
      customerUserId: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      priceAmount: true,
    },
  });
  if (!appointment) return { ok: false, error: "NOT_FOUND" };
  if (!ACTIVE_STATUSES.includes(appointment.status as (typeof ACTIVE_STATUSES)[number])) {
    return { ok: false, error: "NOT_FOUND" };
  }

  const staffId = params.newStaffId ?? appointment.staffId;
  const check = await verifySlot({
    workspaceId: appointment.workspaceId,
    serviceId: appointment.serviceId,
    staffId,
    startMs: params.newStartMs,
    excludeAppointmentId: appointment.id,
  });
  if (!check.ok) return { ok: false, error: "SLOT_TAKEN" };

  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointment.id },
        // the old time is given back to the calendar
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "rescheduled", slotKey: null },
      });
      return tx.appointment.create({
        data: {
          workspaceId: appointment.workspaceId,
          serviceId: appointment.serviceId,
          staffId,
          locationId: appointment.locationId,
          customerUserId: appointment.customerUserId,
          customerName: appointment.customerName,
          customerEmail: appointment.customerEmail,
          customerPhone: appointment.customerPhone,
          startsAt: new Date(params.newStartMs),
          endsAt: new Date(check.endMs),
          status: "CONFIRMED",
          trackingCode: makeCode(),
          priceAmount: appointment.priceAmount,
          rescheduledFromId: appointment.id,
          source: "ADMIN",
          slotKey: slotKeyOf(staffId, params.newStartMs),
        },
        select: { id: true },
      });
    });

    await audit({
      action: "APPOINTMENT_RESCHEDULE",
      workspaceId: appointment.workspaceId,
      entity: "appointment",
      entityId: created.id,
      meta: { from: appointment.id, to: params.newStartMs },
      actorUserId: (await getSession())?.sub ?? null,
    });
    return { ok: true, newId: created.id };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return { ok: false, error: "SLOT_TAKEN" };
    }
    throw error;
  }
}
