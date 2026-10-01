"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth";
import { notify, notifyWaitlist } from "@/lib/notifications";
import { buildMessage } from "@/lib/notifications";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/dictionaries";
import { updateAppointmentStatus } from "@/lib/booking";
import { getWorkspace } from "@/lib/queries";
import { isLocale } from "@/lib/i18n";
import type { FormState } from "@/lib/form-state";

/**
 * Customer self-service, on the website.
 *
 * This is the page every confirmation message links to, so the rules are
 * deliberately strict:
 *
 *   * the *view* only needs the tracking code, and shows no personal data to
 *     somebody who is not signed in — the code is short, so it is not a
 *     password;
 *   * every *action* (cancel) requires being signed in **as the person who
 *     booked it**, or being staff of the business.
 */
/**
 * Cancel from the customer's own page.
 *
 * Bound to the form with `.bind(null, trackingCode, locale)`, so the signature
 * the form needs is a no-argument action: the two arguments come from the URL,
 * never from the browser.
 */
export async function cancelMyAppointmentAction(
  trackingCode: string,
  locale: string,
): Promise<FormState> {
  const session = await getSession();
  const workspace = await getWorkspace();
  const typed: "fa" | "en" = isLocale(locale) ? locale : "fa";

  const appointment = await prisma.appointment.findUnique({
    where: { trackingCode },
    include: { service: true, staff: true, workspace: true, location: true, customer: true },
  });

  if (!appointment || appointment.workspaceId !== workspace.id) {
    return { ok: false, error: "NOT_FOUND" };
  }

  // staff of this workspace, or the customer who booked it
  const isStaff = session
    ? Boolean(
        await prisma.workspaceMember.findFirst({
          where: { userId: session.sub, workspaceId: workspace.id },
          select: { id: true },
        }),
      )
    : false;
  const isOwner = appointment.customerUserId === session?.sub;

  if (!session || (!isStaff && !isOwner)) {
    return { ok: false, error: "UNAUTHORIZED" };
  }

  const result = await updateAppointmentStatus({
    appointmentId: appointment.id,
    status: "CANCELLED",
    reason: "cancelled by customer (web)",
  });
  if (!result.ok) {
    return { ok: false, error: result.error === "NOT_FOUND" ? "NOT_FOUND" : "INVALID" };
  }

  await notify({
    workspaceId: workspace.id,
    userId: appointment.customerUserId,
    kind: "appointment_cancelled",
    subject: workspace.name,
    message: await buildMessage("appointment_cancelled", appointment, typed),
    appointmentId: appointment.id,
    to: {
      email: appointment.customerEmail,
      phone: appointment.customerPhone,
      telegramId: appointment.customer?.telegramId ?? null,
    },
  });

  const offered = await notifyWaitlist(workspace.id, appointment.staffId, appointment.id);

  revalidatePath(`/${typed}/my-appointments/${trackingCode}`);
  return { ok: true, id: appointment.id, count: offered };
}

/**
 * Form entry point.
 *
 * React's `action={…}` needs `(formData) => Promise<void>`, so the real work
 * lives in `cancelMyAppointmentAction` and this thin wrapper adapts the
 * signature. Both values come from hidden inputs rendered by the page.
 */
export async function cancelMyAppointmentFormAction(formData: FormData): Promise<void> {
  const trackingCode = String(formData.get("trackingCode") ?? "");
  const locale = String(formData.get("locale") ?? "fa");
  await cancelMyAppointmentAction(trackingCode, locale);
}
