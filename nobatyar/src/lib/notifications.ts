/**
 * Notification service.
 *
 * Every message is written to the `notifications` table first (auditable,
 * retryable) and then delivered through the configured channels — email for the
 * customer, Telegram for the team, WhatsApp where a text message is expected.
 * Reminders are idempotent: `reminded24hAt` / `reminded1hAt` guarantee that the
 * same reminder is never sent twice, no matter how often the sweep runs.
 */
import "server-only";

import { adminRecipients, deliver, transports, type Channel } from "./channels";
import { formatDate, formatTime } from "./dates";
import { getDictionary, pick } from "./dictionaries";
import { prisma } from "./db";
import { appUrl } from "./env";
import type { Locale } from "./i18n";

export type NotificationKind =
  | "appointment_created"
  | "appointment_cancelled"
  | "appointment_rescheduled"
  | "appointment_reminder_24h"
  | "appointment_reminder_1h"
  | "waitlist_offer"
  | "new_booking_alert"
  | "package_purchased";

type AppointmentForMessage = {
  id: string;
  trackingCode: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  notes: string | null;
  recurrenceIndex?: number;
  service: { name: string; nameFa: string | null; durationMin: number; priceAmount: number | null };
  staff: { name: string; title: string | null };
  location: { name: string; nameFa: string | null } | null;
  workspace: { name: string; nameFa: string | null; timezone: string; phone: string | null };
};

/**
 * Which channels each kind of message prefers.
 *
 * Telegram sits alongside WhatsApp for customer-facing messages: a customer
 * who introduced themselves to the bot gets confirmations and reminders *in
 * Telegram*, no matter which front door they booked through. The business-side
 * alert is the only kind that is Telegram-first.
 */
const kindChannels: Record<NotificationKind, Channel[]> = {
  appointment_created: ["TELEGRAM", "WHATSAPP", "EMAIL"],
  appointment_cancelled: ["TELEGRAM", "WHATSAPP", "EMAIL"],
  appointment_rescheduled: ["TELEGRAM", "WHATSAPP", "EMAIL"],
  appointment_reminder_24h: ["TELEGRAM", "WHATSAPP", "EMAIL"],
  appointment_reminder_1h: ["TELEGRAM", "WHATSAPP", "EMAIL"],
  waitlist_offer: ["TELEGRAM", "WHATSAPP", "EMAIL"],
  new_booking_alert: ["TELEGRAM", "EMAIL"],
  package_purchased: ["TELEGRAM", "EMAIL", "WHATSAPP"],
};

/** Human message for one appointment, in the reader's language. */
export async function buildMessage(
  kind: NotificationKind,
  appointment: AppointmentForMessage,
  locale: Locale,
): Promise<string> {
  const t = getDictionary(locale);
  const tz = appointment.workspace.timezone;
  const service = pick(locale, appointment.service.name, appointment.service.nameFa);
  const business = pick(locale, appointment.workspace.name, appointment.workspace.nameFa);
  const where = appointment.location
    ? ` · ${pick(locale, appointment.location.name, appointment.location.nameFa)}`
    : "";
  const when = `${formatDate(appointment.startsAt, locale, tz)} ${formatTime(appointment.startsAt, locale, tz)}`;
  const tracking = `${t.booking.trackingCode}: ${appointment.trackingCode}`;
  const series =
    appointment.recurrenceIndex && appointment.recurrenceIndex > 0
      ? `\n(${appointment.recurrenceIndex + 1}/…)`
      : "";
  const head = `${business}${where}\n${when}\n${service} — ${appointment.staff.name}`;
  const manage = `${appUrl}/${locale}/my-appointments/${appointment.trackingCode}`;
  // the same URL the customer booked from, so "cancel" is one tap away in chat
  const manageLabel = t.channel.viewOnWeb;

  switch (kind) {
    case "appointment_created":
      return `${t.channel.confirmed}${series}\n${head}\n${tracking}\n${manageLabel}: ${manage}`;
    case "appointment_cancelled":
      return `${t.channel.cancelled}\n${head}\n${tracking}`;
    case "appointment_rescheduled":
      return `${t.channel.adminRescheduled}\n${head}\n${tracking}\n${manageLabel}: ${manage}`;
    case "appointment_reminder_24h":
      return `${t.channel.adminReminder24h}\n${head}\n${tracking}\n${manageLabel}: ${manage}`;
    case "appointment_reminder_1h":
      return `${t.channel.adminReminder1h}\n${head}\n${tracking}\n${manageLabel}: ${manage}`;
    case "waitlist_offer":
      return `${t.channel.waitlistOffer}\n${head}\n${tracking}\n${manageLabel}: ${manage}`;
    case "new_booking_alert":
      return `🔔 ${t.channel.adminNewBooking}\n${appointment.customerName} · ${service}\n${when}`;
    case "package_purchased":
      return `${t.channel.packagesTitle}\n${business}\n${tracking}`;
  }
}

type NotifyParams = {
  workspaceId: string;
  userId?: string | null;
  kind: NotificationKind;
  message: string;
  subject: string;
  appointmentId?: string | null;
  /** explicit recipients; otherwise email (if any) + WhatsApp (if a phone) */
  to?: { email?: string | null; phone?: string | null; telegramId?: string | null } | null;
};

type NotifyResult = {
  delivered: Channel[];
  failed: { channel: Channel; detail?: string }[];
  skipped: boolean;
};

/**
 * Persist first, then deliver. A row is only marked `isSent` when at least one
 * channel accepted the message, so a temporary outage leaves it retryable.
 */
export async function notify(params: NotifyParams): Promise<NotifyResult> {
  const row = await prisma.notification.create({
    data: {
      workspaceId: params.workspaceId,
      userId: params.userId ?? null,
      type: params.kind,
      message: params.message,
      channel: (kindChannels[params.kind][0] ?? "EMAIL") as string,
      isSent: false,
    },
    select: { id: true },
  });

  const isTeamAlert = params.kind === "new_booking_alert";

  // A customer who linked a Telegram account gets their messages there, no
  // matter which door they came through. Resolved from the appointment so no
  // caller has to remember to pass it.
  let telegramId = params.to?.telegramId ?? null;
  if (!telegramId && params.userId) {
    const owner = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { telegramId: true },
    });
    telegramId = owner?.telegramId ?? null;
  }

  const recipients = isTeamAlert
    ? adminRecipients()
    : [
        ...(params.to?.email ? [{ channel: "EMAIL" as Channel, to: params.to.email }] : []),
        ...(params.to?.phone ? [{ channel: "WHATSAPP" as Channel, to: params.to.phone }] : []),
        ...(telegramId ? [{ channel: "TELEGRAM" as Channel, to: telegramId }] : []),
      ];

  if (recipients.length === 0) {
    await prisma.notification.update({
      where: { id: row.id },
      data: { isSent: true, error: "no-recipient" },
    });
    return { delivered: [], failed: [], skipped: true };
  }

  const channels = [...new Set(recipients.map((item) => item.channel))];

  // A recipient exists but none of its channels is configured: say so
  // explicitly, otherwise the row would sit in the dashboard looking pending
  // forever when in fact nothing can ever be delivered.
  const anyEnabled = channels.some((channel) =>
    transports.some((item) => item.channel === channel && item.enabled()),
  );
  if (!anyEnabled) {
    await prisma.notification.update({
      where: { id: row.id },
      data: { isSent: false, error: `no-transport:${channels.join("+")}` },
    });
    return { delivered: [], failed: [], skipped: true };
  }

  const { delivered, failed } = await deliver(
    channels,
    recipients,
    params.subject,
    params.message,
  );

  await prisma.notification.update({
    where: { id: row.id },
    data: {
      isSent: delivered.length > 0,
      error: failed.length ? failed.map((f) => `${f.channel}:${f.detail}`).join(", ") : null,
    },
  });

  return { delivered, failed, skipped: false };
}

/** Someone cancelled → offer the freed slot to the waitlist. */
export async function notifyWaitlist(
  workspaceId: string,
  staffId: string,
  freedAppointmentId: string,
): Promise<number> {
  const [workspace, entries] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    prisma.waitlistEntry.findMany({
      where: { workspaceId, status: "PENDING", staffId },
      include: { service: { include: { staff: true } } },
      orderBy: { createdAt: "asc" },
      take: 5,
    }),
  ]);

  const locale = (workspace.defaultLocale === "en" ? "en" : "fa") as Locale;
  const t = getDictionary(locale);
  let notified = 0;

  for (const entry of entries) {
    if (!entry.service.staff.some((link) => link.staffId === staffId)) continue;
    const message = `${t.dashboard.waitlist.title} — ${pick(locale, entry.service.name, entry.service.nameFa)}`;
    const result = await notify({
      workspaceId,
      userId: entry.customerUserId,
      kind: "waitlist_offer",
      message,
      subject: `${t.brand.name} — ${t.dashboard.waitlist.title}`,
      to: { email: entry.customerEmail, phone: entry.customerPhone },
    });
    if (result.delivered.length > 0) {
      await prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: "NOTIFIED", notifiedAt: new Date() },
      });
      notified += 1;
    }
  }
  return notified;
}

/** Reminder sweep — safe to run as often as you like. */
export async function runReminderSweep(now = new Date()): Promise<{ sent: number }> {
  const windows = [
    { hours: 24, field: "reminded24hAt" as const },
    { hours: 1, field: "reminded1hAt" as const },
  ];
  let sent = 0;

  for (const window of windows) {
    const from = new Date(now.getTime() + (window.hours * 60 - 30) * 60_000);
    const to = new Date(now.getTime() + (window.hours * 60 + 30) * 60_000);

    const rows = await prisma.appointment.findMany({
      where: {
        status: { in: ["PENDING", "CONFIRMED"] },
        [window.field]: null,
        startsAt: { gte: from, lte: to },
      },
      include: {
        service: true,
        staff: true,
        workspace: true,
        customer: true,
        location: true,
      },
    });

    for (const row of rows) {
      const locale = ((row.customer?.locale ?? row.workspace.defaultLocale) === "en"
        ? "en"
        : "fa") as Locale;
      const kind: NotificationKind =
        window.hours === 24 ? "appointment_reminder_24h" : "appointment_reminder_1h";

      const result = await notify({
        workspaceId: row.workspaceId,
        userId: row.customerUserId,
        kind,
        subject: `${row.workspace.name} — appointment reminder`,
        message: await buildMessage(kind, row, locale),
        appointmentId: row.id,
        to: { email: row.customerEmail ?? row.customer?.email ?? null, phone: row.customerPhone },
      });

      if (result.delivered.length > 0) {
        await prisma.appointment.update({
          where: { id: row.id },
          data: { [window.field]: new Date() },
        });
        sent += 1;
      }
    }
  }
  return { sent };
}
