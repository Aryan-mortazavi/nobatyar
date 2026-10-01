import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BadgeCheck,
  CalendarClock,
  CalendarX2,
  Clock,
  MapPin,
  Phone,
  StickyNote,
  UserRound,
} from "lucide-react";

import { cancelMyAppointmentFormAction } from "@/app/actions/customer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/dates";
import { getDictionary, pick } from "@/lib/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n";
import { getWorkspace } from "@/lib/queries";
import { rateLimit } from "@/lib/rate-limit";
import { holdsSlot } from "@/lib/slot-key";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "warning" | "success" | "outline" | "danger" | "primary"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  COMPLETED: "outline",
  CANCELLED: "danger",
  NO_SHOW: "outline",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; trackingCode: string }>;
}): Promise<Metadata> {
  const { locale, trackingCode } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${getDictionary(locale).booking.trackingCode} ${trackingCode}`, robots: { index: false } };
}

/**
 * The page every confirmation message links to.
 *
 * Two states on purpose:
 *
 * * **visitor with only the link** — sees when and what, never *who*. The
 *   tracking code is five characters; treating it as a password would be
 *   false comfort, so personal data is gated behind a real sign-in.
 * * **the customer (or staff)** — sees their details, and can cancel, which
 *   releases the slot for the waitlist exactly like every other cancellation.
 */
export default async function MyAppointmentPage({
  params,
}: {
  params: Promise<{ locale: string; trackingCode: string }>;
}) {
  const { locale, trackingCode } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const code = trackingCode.toUpperCase();
  const limit = rateLimit(`myappt:${code}`, 30, 60_000);
  if (!limit.ok) notFound();

  const appointment = await prisma.appointment.findUnique({
    where: { trackingCode: code },
    include: {
      service: { include: { category: true } },
      staff: true,
      location: true,
      workspace: true,
    },
  });
  if (!appointment) notFound();

  const workspace = await getWorkspace();
  const session = await getSession();

  const isStaff = session
    ? Boolean(
        await prisma.workspaceMember.findFirst({
          where: { userId: session.sub, workspaceId: workspace.id },
          select: { id: true },
        }),
      )
    : false;
  const isOwner = Boolean(session && appointment.customerUserId === session.sub);
  const canManage = isStaff || isOwner;

  const isUpcoming = appointment.startsAt.getTime() > Date.now();
  const canCancel =
    canManage && isUpcoming && holdsSlot(appointment.status) && appointment.status !== "CANCELLED";

  const service = pick(typed, appointment.service.name, appointment.service.nameFa);
  const staffName = appointment.staff.name;
  const statusLabel = t.status[appointment.status as keyof typeof t.status] ?? appointment.status;

  const details: { icon: typeof Clock; label: string; value: string }[] = [
    {
      icon: CalendarClock,
      label: t.common.date,
      value: formatDate(appointment.startsAt, typed, workspace.timezone, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    },
    {
      icon: Clock,
      label: t.common.time,
      value: `${formatTime(appointment.startsAt, typed, workspace.timezone)} – ${formatTime(appointment.endsAt, typed, workspace.timezone)}`,
    },
    { icon: UserRound, label: t.dashboard.appointments.staff, value: staffName },
  ];

  if (appointment.location) {
    details.push({
      icon: MapPin,
      label: t.booking.location,
      value: pick(typed, appointment.location.name, appointment.location.nameFa),
    });
  }
  if (canManage && appointment.customerPhone) {
    details.push({
      icon: Phone,
      label: t.common.phone,
      value: appointment.customerPhone,
    });
  }
  if (canManage && appointment.notes) {
    details.push({ icon: StickyNote, label: t.booking.notesPlaceholder, value: appointment.notes });
  }

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="text-center">
          <span
            className={
              appointment.status === "CANCELLED"
                ? "mx-auto grid size-14 place-items-center rounded-2xl bg-danger/12 text-danger"
                : "mx-auto grid size-14 place-items-center rounded-2xl bg-primary/12 text-primary"
            }
          >
            {appointment.status === "CANCELLED" ? (
              <CalendarX2 className="size-7" aria-hidden />
            ) : (
              <BadgeCheck className="size-7" aria-hidden />
            )}
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            {appointment.status === "CANCELLED" ? t.dashboard.appointments.cancel : t.booking.successTitle}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pick(typed, appointment.workspace.name, appointment.workspace.nameFa)} · {service}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Badge tone={STATUS_TONE[appointment.status] ?? "outline"}>{statusLabel}</Badge>
            <span className="text-xs text-muted-foreground">{t.booking.trackingCode}</span>
            <Badge tone="outline" dir="ltr">
              {code}
            </Badge>
          </div>
        </header>

        <Card padding="lg">
          <dl className="grid gap-4 sm:grid-cols-2">
            {details.map((item) => (
              <div key={item.label} className="flex items-start gap-3">
                <item.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{item.label}</dt>
                  <dd className="mt-0.5 text-sm font-medium">{item.value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </Card>

        {appointment.recurrenceGroupId ? (
          <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {t.booking.repeat} · {t.booking.everyWeek} {t.booking.weeks}
          </p>
        ) : null}

        {canManage ? (
          <Card padding="lg" className="space-y-4">
            <h2 className="text-sm font-semibold">{t.dashboard.appointments.title}</h2>
            {canCancel ? (
              <form action={cancelMyAppointmentFormAction}>
                <input type="hidden" name="trackingCode" value={code} />
                <input type="hidden" name="locale" value={typed} />
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full text-danger hover:bg-danger/10"
                >
                  <CalendarX2 aria-hidden />
                  {t.dashboard.appointments.cancel}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">{t.dashboard.appointments.emptyState}</p>
            )}
            {isStaff ? (
              <Button asChild variant="ghost" className="w-full">
                <Link href={`/${typed}/dashboard/appointments?q=${code}`}>
                  {t.dashboard.nav.appointments}
                </Link>
              </Button>
            ) : null}
          </Card>
        ) : (
          <Card padding="lg" className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">{t.errors.unauthorized}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild size="sm">
                <Link href={`/${typed}/login?next=/${typed}/my-appointments/${code}`}>
                  {t.auth.login}
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/${typed}/book`}>{t.nav.book}</Link>
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
