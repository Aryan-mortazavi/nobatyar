"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { audit, getSession } from "@/lib/auth";
import { createAppointment } from "@/lib/booking";
import { createRecurringSeries } from "@/lib/recurrence";
import { buildMessage, notify, notifyWaitlist } from "@/lib/notifications";
import { getWorkspace } from "@/lib/queries";
import { isLocale, type Locale } from "@/lib/i18n";
import { parseDateKey, zonedMinuteToUtc } from "@/lib/dates";
import { bookingSchema, fieldErrors, waitlistSchema } from "@/lib/validators";
import type { FormState } from "@/lib/form-state";
import { verifySlot, getStaffSchedules } from "@/lib/availability-server";
import { activePurchasesFor, remainingFor } from "@/lib/packages";

/**
 * Public booking action.
 *
 * The wizard is a Client Component, so everything it needs travels in hidden
 * inputs — and everything it sends is re-validated here. Supports recurring
 * weekly series and prepaid package sessions.
 */
export async function bookAppointmentAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const parsed = bookingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // the wizard only surfaces the first few fields — log all of them
    console.warn(
      "[booking] rejected by validation:",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const locale: Locale = isLocale(input.locale) ? input.locale : "fa";
  const workspace = await getWorkspace();
  const session = await getSession();
  const startMs = Number(input.slot);

  if (!Number.isFinite(startMs) || startMs <= 0) {
    return { ok: false, error: "VALIDATION", fields: { slot: "bad slot" } };
  }

  const locationId = input.locationId || null;

  // "any specialist" → the first one who can actually take that instant
  const staffId =
    input.staffId && input.staffId !== "any"
      ? input.staffId
      : await pickAnyStaff({
          workspaceId: workspace.id,
          serviceId: input.serviceId,
          startMs,
          locationId,
        });

  if (!staffId) {
    console.warn("[booking] refused: no eligible specialist for", new Date(startMs).toISOString());
    return { ok: false, error: "SLOT_TAKEN" };
  }

  const base = {
    workspaceId: workspace.id,
    serviceId: input.serviceId,
    staffId,
    customerName: input.name,
    customerEmail: input.email || null,
    customerPhone: input.phone,
    notes: input.notes || null,
    customerUserId: session?.sub ?? null,
  };

  const wantsSeries = input.repeatCount > 1;
  const bookingInput = {
    ...base,
    startMs,
    ...(locationId ? { locationId } : {}),
    ...(input.packagePurchaseId && session ? { packagePurchaseId: input.packagePurchaseId } : {}),
  };
  const result = wantsSeries
    ? await createRecurringSeries(bookingInput, {
        count: input.repeatCount,
        interval: input.repeatIntervalDays,
      })
    : await (async () => {
        const single = await createAppointment(bookingInput);
        return single.ok
          ? ({
              ok: true as const,
              groupId: single.appointmentId,
              appointmentIds: [single.appointmentId],
              trackingCodes: [single.trackingCode],
            } as const)
          : ({
              ok: false as const,
              error: single.error === "SLOT_TAKEN" ? ("SLOT_TAKEN" as const) : ("INVALID" as const),
            });
      })();

  if (!result.ok) {
    console.warn(
      "[booking] refused:",
      JSON.stringify(result),
      "service=",
      input.serviceId,
      "staff=",
      staffId,
      "start=",
      new Date(startMs).toISOString(),
    );
    // For a series, say *which* occurrence is gone so the customer can pick
    // another day instead of guessing.
    const failed =
      "failedIndex" in result && typeof result.failedIndex === "number"
        ? result.failedIndex + 1
        : null;
    return {
      ok: false,
      error: result.error === "INVALID" ? "INVALID" : "SLOT_TAKEN",
      fields: failed ? { slot: `occurrence:${failed}` } : undefined,
    };
  }

  // ── notifications ───────────────────────────────────────────────────────
  const appointment = await prisma.appointment.findUniqueOrThrow({
    where: { id: result.appointmentIds[0] },
    include: { service: true, staff: true, workspace: true, location: true },
  });

  await notify({
    workspaceId: workspace.id,
    userId: session?.sub ?? null,
    kind: "appointment_created",
    subject: `${workspace.name} — ${locale === "fa" ? "نوبت شما ثبت شد" : "appointment confirmed"}`,
    message: await buildMessage("appointment_created", appointment, locale),
    appointmentId: appointment.id,
    to: { email: input.email || null, phone: input.phone },
  });

  // the business gets an operational alert on Telegram
  await notify({
    workspaceId: workspace.id,
    kind: "new_booking_alert",
    subject: `${workspace.name}`,
    message: await buildMessage("new_booking_alert", appointment, locale),
    appointmentId: appointment.id,
  });

  await audit({
    action: wantsSeries ? "APPOINTMENT_SERIES_CREATE" : "APPOINTMENT_CREATE",
    workspaceId: workspace.id,
    entity: "appointment",
    entityId: result.appointmentIds[0],
    meta: { count: result.appointmentIds.length, recurring: wantsSeries },
    actorUserId: session?.sub ?? null,
  });

  revalidatePath(`/${locale}/dashboard`, "layout");
  return {
    ok: true,
    trackingCode: result.trackingCodes[0],
    id: result.appointmentIds[0],
    count: result.appointmentIds.length,
  };
}

async function pickAnyStaff(params: {
  workspaceId: string;
  serviceId: string;
  startMs: number;
  locationId?: string | null;
}): Promise<string | null> {
  const [schedules, service] = await Promise.all([
    getStaffSchedules(params.workspaceId),
    prisma.service.findUniqueOrThrow({
      where: { id: params.serviceId },
      select: { staff: { select: { staffId: true } } },
    }),
  ]);

  const eligible = schedules.filter((schedule) =>
    service.staff.some((link) => link.staffId === schedule.staffId),
  );

  for (const schedule of eligible) {
    const check = await verifySlot({
      workspaceId: params.workspaceId,
      serviceId: params.serviceId,
      staffId: schedule.staffId,
      startMs: params.startMs,
      ...(params.locationId ? { locationId: params.locationId } : {}),
    });
    if (check.ok) return schedule.staffId;
  }
  return null;
}

export async function joinWaitlistAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const parsed = waitlistSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }
  const workspace = await getWorkspace();
  const session = await getSession();

  await prisma.waitlistEntry.create({
    data: {
      workspaceId: workspace.id,
      serviceId: parsed.data.serviceId,
      staffId: parsed.data.staffId && parsed.data.staffId !== "any" ? parsed.data.staffId : null,
      customerUserId: session?.sub ?? null,
      customerName: parsed.data.name,
      customerPhone: parsed.data.phone,
      customerEmail: parsed.data.email || null,
      preferredDate: zonedMinuteToUtc(parseDateKey(parsed.data.date), 0, workspace.timezone),
      preferredStartMinute: parsed.data.startMinute ?? null,
      status: "PENDING",
    },
  });

  await audit({
    action: "WAITLIST_JOIN",
    workspaceId: workspace.id,
    actorUserId: session?.sub ?? null,
  });
  revalidatePath(`/${parsed.data.locale}/dashboard`, "layout");
  return { ok: true };
}

/** Packages the signed-in customer can still spend on this service. */
export async function myPackagesAction(
  serviceId: string,
): Promise<{ ok: true; purchases: { id: string; name: string; remaining: number }[] }> {
  const session = await getSession();
  if (!session) return { ok: true, purchases: [] };
  const workspace = await getWorkspace();
  const purchases = await activePurchasesFor(workspace.id, session.sub);
  return {
    ok: true,
    purchases: purchases
      .map((purchase) => ({
        id: purchase.id,
        name: purchase.package.nameFa || purchase.package.name,
        remaining: remainingFor(purchase, serviceId),
      }))
      .filter((purchase) => purchase.remaining > 0),
  };
}
