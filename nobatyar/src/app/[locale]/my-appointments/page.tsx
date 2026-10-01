import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/dates";
import { getDictionary, pick } from "@/lib/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n";
import { getWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    title: getDictionary(locale).nav.myAppointments,
    robots: { index: false },
  };
}

/**
 * The customer's own list — the counterpart of the Telegram bot's «📋 نوبت‌های من».
 *
 * Whatever the customer booked — on the website, through the bot, or by phone
 * at the counter — it is all here, because it is all the same record.
 */
export default async function MyAppointmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) redirect("/fa");
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const session = await getSession();
  if (!session) redirect(`/${typed}/login?next=/${typed}/my-appointments`);

  const workspace = await getWorkspace();
  const now = new Date();

  const [upcoming, past] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        customerUserId: session.sub,
        startsAt: { gte: now },
        status: { not: "CANCELLED" },
      },
      include: { service: true, staff: true, location: true },
      orderBy: { startsAt: "asc" },
      take: 25,
    }),
    prisma.appointment.findMany({
      where: {
        customerUserId: session.sub,
        OR: [{ startsAt: { lt: now } }, { status: { in: ["CANCELLED", "COMPLETED", "NO_SHOW"] } }],
      },
      include: { service: true, staff: true, location: true },
      orderBy: { startsAt: "desc" },
      take: 25,
    }),
  ]);

  const sections: { title: string; rows: typeof upcoming }[] = [
    { title: t.dashboard.appointments.upcoming, rows: upcoming },
    { title: t.dashboard.appointments.history, rows: past },
  ];

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t.nav.myAppointments}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {pick(typed, workspace.name, workspace.nameFa)}
            </p>
          </div>
          <Button asChild size="sm">
            <Link href={`/${typed}/book`}>
              <CalendarPlus aria-hidden />
              {t.nav.book}
            </Link>
          </Button>
        </header>

        {upcoming.length === 0 && past.length === 0 ? (
          <Card padding="lg" className="text-center">
            <p className="text-sm text-muted-foreground">{t.booking.noService}</p>
            <Button asChild className="mt-4">
              <Link href={`/${typed}/book`}>{t.nav.book}</Link>
            </Button>
          </Card>
        ) : null}

        {sections.map((section) =>
          section.rows.length === 0 ? null : (
            <section key={section.title} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">{section.title}</h2>
              <ul className="space-y-3">
                {section.rows.map((appointment) => (
                  <li key={appointment.id}>
                    <Card padding="lg" hover="lift">
                      <Link
                        href={`/${typed}/my-appointments/${appointment.trackingCode}`}
                        className="flex flex-wrap items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {pick(typed, appointment.service.name, appointment.service.nameFa)}
                          </p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <Clock3 className="size-3.5" aria-hidden />
                              {formatDate(appointment.startsAt, typed, workspace.timezone, {
                                dateStyle: "medium",
                              })}
                            </span>
                            <span className="tabular-nums">
                              {formatTime(appointment.startsAt, typed, workspace.timezone)}
                            </span>
                            <span>{appointment.staff.name}</span>
                            {appointment.location ? (
                              <span>
                                {pick(typed, appointment.location.name, appointment.location.nameFa)}
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={
                              appointment.status === "CANCELLED"
                                ? "danger"
                                : appointment.status === "CONFIRMED"
                                  ? "success"
                                  : "warning"
                            }
                          >
                            {t.status[appointment.status as keyof typeof t.status] ??
                              appointment.status}
                          </Badge>
                          <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                            {appointment.trackingCode}
                          </span>
                        </div>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </div>
  );
}
