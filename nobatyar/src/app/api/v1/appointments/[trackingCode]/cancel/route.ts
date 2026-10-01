import type { NextRequest } from "next/server";

import { audit } from "@/lib/auth";
import { buildMessage, notify, notifyWaitlist } from "@/lib/notifications";
import { channelError, requireChannel, verifyCustomerToken } from "@/lib/channel-auth";
import { appointmentView, ok, resolveLocale } from "@/lib/channel-views";
import { cancelSeries } from "@/lib/recurrence";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/appointments/{trackingCode}/cancel
 *
 * A customer may cancel their own future appointment from a channel. The rules
 * match the web app exactly: only PENDING/CONFIRMED, only before the start,
 * and cancelling one occurrence of a weekly series asks whether the whole
 * series should go (`?series=1`).
 *
 * A freed slot is immediately offered to the waitlist, which is what makes the
 * channels feel like one product rather than two systems.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ trackingCode: string }> },
) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const customer = await verifyCustomerToken(request);
  if (!customer.ok) return customer.response;

  const { trackingCode } = await params;
  const key = customer.principal.telegramId ?? customer.principal.userId;
  if (!rateLimit(`channel:cancel:${key}`, 20, 60_000).ok) {
    return channelError(429, "RATE_LIMITED", "Too many cancellation attempts");
  }

  const workspace = await getWorkspace();
  const locale = resolveLocale(request.nextUrl.searchParams.get("locale"), "fa");

  const appointment = await prisma.appointment.findUnique({
    where: { trackingCode },
    include: { service: true, staff: true, workspace: true, location: true, customer: true },
  });

  if (!appointment || appointment.workspaceId !== workspace.id) {
    return channelError(404, "NOT_FOUND", "Appointment not found");
  }
  // ownership: the token's customer must be the one who booked it
  if (appointment.customerUserId !== customer.principal.userId) {
    // Same 404 as "does not exist": a stranger must not be able to learn that a
    // tracking code is real just by asking twice.
    return channelError(404, "NOT_FOUND", "Appointment not found");
  }
  if (appointment.status === "CANCELLED") {
    return channelError(409, "CONFLICT", "Already cancelled", {
      appointment: appointmentView(appointment, locale, workspace.timezone),
    });
  }
  if (!["PENDING", "CONFIRMED"].includes(appointment.status)) {
    return channelError(409, "CONFLICT", `Cannot cancel a ${appointment.status} appointment`);
  }
  if (appointment.startsAt.getTime() <= Date.now()) {
    return channelError(409, "CONFLICT", "This appointment has already started");
  }

  const cancelSeriesToo = request.nextUrl.searchParams.get("series") === "1";

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "cancelled by customer (channel)", slotKey: null },
  });

  let seriesCancelled = 0;
  if (cancelSeriesToo) {
    seriesCancelled = await cancelSeries(appointment.id, "cancelled by customer (channel)");
  }

  await notify({
    workspaceId: workspace.id,
    userId: appointment.customerUserId,
    kind: "appointment_cancelled",
    subject: `${workspace.name}`,
    message: await buildMessage("appointment_cancelled", appointment, locale),
    appointmentId: appointment.id,
    to: {
      email: appointment.customerEmail,
      phone: appointment.customerPhone,
      telegramId: appointment.customer?.telegramId ?? customer.principal.telegramId,
    },
  });

  // the freed slot goes straight to the waitlist
  const offered = await notifyWaitlist(workspace.id, appointment.staffId, appointment.id);

  await audit({
    action: "APPOINTMENT_CANCEL",
    workspaceId: workspace.id,
    actorUserId: customer.principal.userId,
    entity: "appointment",
    entityId: appointment.id,
    meta: { channel: gate.principal.channel, seriesCancelled, waitlistOffers: offered },
  });

  return ok({
    cancelled: true,
    seriesCancelled,
    waitlistOffers: offered,
    message: getDictionary(locale).channel.cancelled,
    appointment: appointmentView(appointment, locale, workspace.timezone),
  });
}
