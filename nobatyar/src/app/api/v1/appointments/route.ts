import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/auth";
import { buildMessage, notify } from "@/lib/notifications";
import { activePurchasesFor, remainingFor } from "@/lib/packages";
import { channelError, requireChannel, verifyCustomerToken } from "@/lib/channel-auth";
import { appointmentView, ok, resolveLocale } from "@/lib/channel-views";
import { createAppointment } from "@/lib/booking";
import { createRecurringSeries } from "@/lib/recurrence";
import { prisma } from "@/lib/db";
import { getPublicStaff, getWorkspace } from "@/lib/queries";
import { getStaffSchedules, verifySlot } from "@/lib/availability-server";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/i18n";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bookSchema = z.object({
  serviceId: z.string().min(8),
  /** "any" (or omitted) = let the app pick whoever is free */
  staffId: z.string().min(8).optional().or(z.literal("any")).or(z.literal("")),
  locationId: z.string().min(8).optional().or(z.literal("any")).or(z.literal("")),
  /** epoch ms, exactly as returned by /availability */
  slot: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(8).max(24).optional(),
  notes: z.string().trim().max(500).optional(),
  repeatCount: z.coerce.number().int().min(1).max(12).default(1),
  packagePurchaseId: z.string().min(8).optional(),
  locale: z.enum(["fa", "en"]).default("fa"),
});

const appointmentInclude = {
  service: true,
  staff: true,
  workspace: true,
  location: true,
} as const;

/**
 * POST /api/v1/appointments — book through a channel.
 *
 * Everything the web wizard enforces is enforced here too, because this route
 * calls the *same* `createAppointment` / `createRecurringSeries` functions:
 * the availability re-check, the in-transaction overlap check, the unique
 * `(staffId, startsAt)` index, the package session, the audit trail and the
 * notifications. A channel is a second door, not a second rulebook.
 */
export async function POST(request: NextRequest) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const customer = await verifyCustomerToken(request);
  if (!customer.ok) return customer.response;

  const parsed = bookSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return channelError(422, "VALIDATION", "Invalid booking payload", {
      fields: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const input = parsed.data;
  const key = customer.principal.telegramId ?? customer.principal.userId;
  if (!rateLimit(`channel:book:${key}`, 20, 60_000).ok) {
    return channelError(429, "RATE_LIMITED", "Too many booking attempts");
  }

  const workspace = await getWorkspace();
  const locale = isLocale(input.locale) ? input.locale : "fa";
  const t = getDictionary(locale);

  // the customer record the token points at is the only identity we accept
  const user = await prisma.user.findUnique({
    where: { id: customer.principal.userId },
    select: { id: true, name: true, phone: true, locale: true, telegramId: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return channelError(404, "NOT_FOUND", "Customer not found");
  }

  // "any specialist" → the first one who can actually take that instant
  let staffId = input.staffId && input.staffId !== "any" ? input.staffId : null;
  if (!staffId) {
    const [schedules, service] = await Promise.all([
      getStaffSchedules(workspace.id),
      prisma.service.findUniqueOrThrow({
        where: { id: input.serviceId },
        select: { staff: { select: { staffId: true } } },
      }),
    ]);
    for (const member of schedules) {
      if (!service.staff.some((link) => link.staffId === member.staffId)) continue;
      const check = await verifySlot({
        workspaceId: workspace.id,
        serviceId: input.serviceId,
        staffId: member.staffId,
        startMs: input.slot,
        ...(input.locationId ? { locationId: input.locationId } : {}),
      });
      if (check.ok) {
        staffId = member.staffId;
        break;
      }
    }
  }
  if (!staffId) return channelError(409, "SLOT_TAKEN", t.errors.slotTaken);

  // spend a package session only if the customer really has one for this service
  let packagePurchaseId: string | undefined;
  if (input.packagePurchaseId) {
    const purchases = await activePurchasesFor(workspace.id, user.id);
    const purchase = purchases.find((entry) => entry.id === input.packagePurchaseId);
    if (purchase && remainingFor(purchase, input.serviceId) > 0) {
      packagePurchaseId = purchase.id;
    }
  }

  const base = {
    workspaceId: workspace.id,
    serviceId: input.serviceId,
    staffId,
    customerUserId: user.id,
    customerName: user.name || input.name || "—",
    customerEmail: null,
    customerPhone: user.phone ?? input.phone ?? "",
    notes: input.notes ?? null,
    source: gate.principal.channel === "telegram" ? "TELEGRAM" : "API",
    ...(input.locationId ? { locationId: input.locationId } : {}),
    ...(packagePurchaseId ? { packagePurchaseId } : {}),
  };

  const result =
    input.repeatCount > 1
      ? await createRecurringSeries(
          { ...base, startMs: input.slot },
          { count: input.repeatCount, interval: 7 },
        )
      : await (async () => {
          const single = await createAppointment({ ...base, startMs: input.slot });
          return single.ok
            ? ({
                ok: true as const,
                appointmentIds: [single.appointmentId],
                trackingCodes: [single.trackingCode],
              })
            : ({
                ok: false as const,
                error: single.error === "SLOT_TAKEN" ? ("SLOT_TAKEN" as const) : ("INVALID" as const),
              });
        })();

  if (!result.ok) {
    const failedIndex = "failedIndex" in result ? result.failedIndex : undefined;
    return channelError(409, "SLOT_TAKEN", t.errors.slotTaken, {
      ...(typeof failedIndex === "number" ? { occurrence: failedIndex + 1 } : {}),
    });
  }

  const rows = await prisma.appointment.findMany({
    where: { id: { in: result.appointmentIds } },
    include: appointmentInclude,
    orderBy: { startsAt: "asc" },
  });

  // the customer gets a Telegram message, the business gets its alert — the
  // same notification pipeline the web app uses
  for (const row of rows) {
    await notify({
      workspaceId: workspace.id,
      userId: user.id,
      kind: "appointment_created",
      subject: `${workspace.name}`,
      message: await buildMessage("appointment_created", row, locale),
      appointmentId: row.id,
      to: {
        email: null,
        phone: row.customerPhone,
        telegramId: user.telegramId,
      },
    });
  }

  await audit({
    action: rows.length > 1 ? "APPOINTMENT_SERIES_CREATE" : "APPOINTMENT_CREATE",
    workspaceId: workspace.id,
    actorUserId: user.id,
    entity: "appointment",
    entityId: rows[0]?.id,
    meta: {
      channel: gate.principal.channel,
      telegramId: user.telegramId,
      count: rows.length,
      recurring: rows.length > 1,
      packagePurchaseId: packagePurchaseId ?? null,
    },
  });

  return ok({
    count: rows.length,
    trackingCode: rows[0]?.trackingCode ?? null,
    message:
      rows.length > 1
        ? t.channel.seriesConfirmed.replace("{count}", String(rows.length))
        : t.channel.confirmed,
    appointments: rows.map((row) => appointmentView(row, locale, workspace.timezone)),
  });
}

/** GET /api/v1/appointments — the customer's own list, newest first. */
export async function GET(request: NextRequest) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const customer = await verifyCustomerToken(request);
  if (!customer.ok) return customer.response;

  const workspace = await getWorkspace();
  const locale = resolveLocale(request.nextUrl.searchParams.get("locale"), "fa");
  const scope = request.nextUrl.searchParams.get("scope") ?? "upcoming";
  const now = new Date();

  const rows = await prisma.appointment.findMany({
    where: {
      customerUserId: customer.principal.userId,
      workspaceId: workspace.id,
      ...(scope === "upcoming"
        ? { startsAt: { gte: now }, status: { not: "CANCELLED" } }
        : scope === "history"
          ? { OR: [{ startsAt: { lt: now } }, { status: { in: ["CANCELLED", "COMPLETED", "NO_SHOW"] } }] }
          : {}),
    },
    include: appointmentInclude,
    orderBy: { startsAt: scope === "history" ? "desc" : "asc" },
    take: 50,
  });

  const t = getDictionary(locale);
  return ok({
    scope,
    labels: {
      noAppointments: t.channel.noAppointments,
      cancelConfirm: t.channel.cancelConfirm,
      cancelled: t.channel.cancelled,
      viewOnWeb: t.channel.viewOnWeb,
      website: t.channel.website,
    },
    appointments: rows.map((row) => appointmentView(row, locale, workspace.timezone)),
  });
}
