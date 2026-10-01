import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarOff, Clock3 } from "lucide-react";

import { Badge, EmptyState } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  addDays,
  civilOf,
  civilToDateKey,
  formatDate,
  formatTime,
  parseDateKey,
  zonedMinuteToUtc,
  type CivilDate,
} from "@/lib/dates";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { STATUS_TONE } from "@/lib/domain";
import { isLocale, type Locale } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.calendar.title };
}

/** `?date=` is a plain Gregorian key so links stay portable. */
function resolveDate(value: string | undefined, fallback: CivilDate): CivilDate {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = parseDateKey(value);
  return Number.isFinite(parsed.year) && parsed.month >= 1 && parsed.month <= 12 ? parsed : fallback;
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string; staff?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  await requireSession(typed);
  const workspace = await getWorkspace();

  const today = civilOf(new Date(), workspace.timezone);
  const day = resolveDate(query.date, today);
  const from = zonedMinuteToUtc(day, 0, workspace.timezone);
  const to = zonedMinuteToUtc(addDays(day, 1), 0, workspace.timezone);

  const [appointments, staff] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        workspaceId: workspace.id,
        startsAt: { gte: from, lt: to },
        ...(query.staff ? { staffId: query.staff } : {}),
      },
      orderBy: { startsAt: "asc" },
      include: { service: true, staff: true },
    }),
    prisma.staffMember.findMany({
      where: { workspaceId: workspace.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const Arrow = typed === "fa" ? ArrowLeft : ArrowRight;
  const prev = civilToDateKey(addDays(day, -1));
  const next = civilToDateKey(addDays(day, 1));
  const staffName = new Map(staff.map((member) => [member.id, member.name]));
  const week = Array.from({ length: 8 }, (_, index) => addDays(day, index - 2));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.calendar.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(from, typed, workspace.timezone, { dateStyle: "full" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/${typed}/dashboard/calendar?date=${prev}`}>
              {typed === "fa" ? (
                <ArrowRight className="size-4" aria-hidden />
              ) : (
                <ArrowLeft className="size-4" aria-hidden />
              )}
              {t.dashboard.calendar.prev}
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/${typed}/dashboard/calendar`}>{t.common.today}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${typed}/dashboard/calendar?date=${next}`}>
              {typed === "fa" ? (
                <ArrowLeft className="size-4" aria-hidden />
              ) : (
                <ArrowRight className="size-4" aria-hidden />
              )}
              {t.dashboard.calendar.next}
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card padding="lg" className="h-fit">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t.common.date}
          </p>
          <ul className="mt-3 space-y-1">
            {week.map((civil) => {
              const key = civilToDateKey(civil);
              const active = key === civilToDateKey(day);
              return (
                <li key={key}>
                  <Link
                    href={`/${typed}/dashboard/calendar?date=${key}`}
                    className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition ${
                      active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                    }`}
                  >
                    <span>{formatDate(from, typed, workspace.timezone, { dateStyle: "short" })}</span>
                    <span className="text-xs opacity-70 tabular-nums">
                      {formatDate(new Date(`${key}T12:00:00Z`), typed, "UTC", { day: "numeric" })}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card padding="none">
          {appointments.length === 0 ? (
            <EmptyState
              icon={<CalendarOff className="size-5" aria-hidden />}
              title={t.dashboard.calendar.emptyDay}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-28">{t.common.time}</TH>
                  <TH>{t.dashboard.appointments.customer}</TH>
                  <TH>{t.dashboard.appointments.service}</TH>
                  <TH>{t.dashboard.appointments.staff}</TH>
                  <TH>{t.common.status}</TH>
                </TR>
              </THead>
              <TBody>
                {appointments.map((appointment) => (
                  <TR key={appointment.id}>
                    <TD className="font-medium tabular-nums">
                      {formatTime(appointment.startsAt, typed, workspace.timezone)}
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        <Clock3 className="me-1 inline size-3" aria-hidden />
                        {formatTime(appointment.endsAt, typed, workspace.timezone)}
                      </span>
                    </TD>
                    <TD>
                      <span className="flex items-center gap-2">
                        <Avatar name={appointment.customerName} size={26} />
                        {appointment.customerName}
                      </span>
                    </TD>
                    <TD className="text-muted-foreground">
                      {pick(typed, appointment.service.name, appointment.service.nameFa)}
                    </TD>
                    <TD className="text-muted-foreground">
                      {staffName.get(appointment.staffId) ?? appointment.staff.name}
                    </TD>
                    <TD>
                      <Badge className={STATUS_TONE[appointment.status as keyof typeof STATUS_TONE]}>
                        {t.status[appointment.status as keyof typeof t.status]}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
