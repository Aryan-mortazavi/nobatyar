import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarCheck, Clock, TrendingUp, TriangleAlert, Wallet } from "lucide-react";

import { Badge, Progress } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getPublicStaff, getUpcomingAppointments, getWorkspace } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/dates";
import { STATUS_TONE } from "@/lib/domain";
import { isLocale, type Locale } from "@/lib/i18n";
import { formatMoney, formatNumber } from "@/lib/utils";
import { WeekTrendChart, ServiceShareChart, StatusDonut } from "@/components/dashboard/charts";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.nav.overview };
}

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const session = await requireSession(typed);
  const workspace = await getWorkspace();
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const last30 = new Date(startOfToday);
  last30.setDate(last30.getDate() - 29);

  const [
    todayCount,
    upcoming,
    last30Rows,
    statusRows,
    serviceRows,
    staffRows,
    staffList,
  ] = await Promise.all([
    prisma.appointment.count({
      where: { workspaceId: workspace.id, startsAt: { gte: startOfToday, lt: endOfToday }, status: { not: "CANCELLED" } },
    }),
    getUpcomingAppointments(workspace.id, 6),
    prisma.appointment.findMany({
      where: { workspaceId: workspace.id, startsAt: { gte: last30 } },
      select: { startsAt: true, status: true, priceAmount: true, serviceId: true, staffId: true },
    }),
    prisma.appointment.groupBy({
      by: ["status"],
      where: { workspaceId: workspace.id },
      _count: { _all: true },
    }),
    prisma.appointment.groupBy({
      by: ["serviceId"],
      where: { workspaceId: workspace.id, status: { notIn: ["CANCELLED"] } },
      _count: { _all: true },
      orderBy: { _count: { serviceId: "desc" } },
      take: 6,
    }),
    prisma.appointment.groupBy({
      by: ["staffId"],
      where: { workspaceId: workspace.id, status: { notIn: ["CANCELLED"] } },
      _count: { _all: true },
    }),
    getPublicStaff(workspace.id),
  ]);

  const allServices = await prisma.service.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true, name: true, nameFa: true },
  });
  const nameOf = new Map(allServices.map((s) => [s.id, pick(typed, s.name, s.nameFa)]));
  const staffNameOf = new Map(staffList.map((s) => [s.id, s.name]));

  // ── weekly trend (last 7 days) ────────────────────────────────────────
  const trend: { label: string; value: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(startOfToday);
    day.setDate(day.getDate() - i);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const value = last30Rows.filter(
      (row) => row.startsAt >= day && row.startsAt < next && row.status !== "CANCELLED",
    ).length;
    trend.push({
      label: formatDate(day, typed, workspace.timezone, { day: "2-digit", month: "2-digit" }),
      value,
    });
  }

  const total30 = last30Rows.length;
  const cancelled30 = last30Rows.filter((r) => r.status === "CANCELLED").length;
  const noShow30 = last30Rows.filter((r) => r.status === "NO_SHOW").length;
  const revenue30 = last30Rows
    .filter((r) => r.status !== "CANCELLED")
    .reduce((sum, r) => sum + (r.priceAmount ?? 0), 0);

  const statusData = statusRows
    .map((row) => ({
      key: row.status,
      label: t.status[row.status as keyof typeof t.status] ?? row.status,
      value: row._count._all,
    }))
    .sort((a, b) => b.value - a.value);

  const serviceData = serviceRows
    .map((row) => ({ label: nameOf.get(row.serviceId) ?? "—", value: row._count._all }))
    .slice(0, 6);

  const kpis = [
    {
      label: t.dashboard.overview.todayTitle,
      value: formatNumber(todayCount, typed),
      icon: CalendarCheck,
      tone: "primary" as const,
    },
    {
      label: t.dashboard.overview.revenue,
      value: formatMoney(revenue30, typed, workspace.currency),
      icon: Wallet,
      tone: "success" as const,
    },
    {
      label: t.dashboard.overview.noShowRate,
      value: `${formatNumber(total30 ? Math.round((noShow30 / total30) * 100) : 0, typed)}٪`,
      icon: TriangleAlert,
      tone: "warning" as const,
    },
    {
      label: t.dashboard.overview.fillRate,
      value: `${formatNumber(total30 ? Math.round(((total30 - cancelled30) / total30) * 100) : 0, typed)}٪`,
      icon: TrendingUp,
      tone: "info" as const,
    },
  ];

  const maxStaff = Math.max(1, ...staffRows.map((row) => row._count._all));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {typed === "fa" ? `سلام، ${session.name.split(" ")[0]}` : `Hello, ${session.name.split(" ")[0]}`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(now, typed, workspace.timezone, { dateStyle: "full" })}
          </p>
        </div>
        <Badge tone="primary">
          <Clock className="size-3.5" aria-hidden />
          {t.common.time}: {formatTime(now, typed, workspace.timezone)}
        </Badge>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} padding="lg" hover="lift">
            <div className="flex items-start justify-between">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <span
                className={`grid size-9 place-items-center rounded-xl bg-${kpi.tone}/12 text-${kpi.tone}`}
                aria-hidden
              >
                <kpi.icon className="size-4.5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold tabular-nums">{kpi.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card padding="lg" className="lg:col-span-2">
          <h3 className="font-semibold">{t.dashboard.overview.weekTitle}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t.stats.bookings}</p>
          <div className="mt-5 h-64">
            <WeekTrendChart data={trend} labels={t.common} />
          </div>
        </Card>

        <Card padding="lg">
          <h3 className="font-semibold">{t.dashboard.overview.statusTitle}</h3>
          <div className="mt-4 h-56">
            <StatusDonut data={statusData} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card padding="lg" className="lg:col-span-2">
          <h3 className="font-semibold">{t.dashboard.overview.upcomingTitle}</h3>
          {upcoming.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t.dashboard.overview.empty}</p>
          ) : (
            <Table className="mt-4">
              <THead>
                <TR>
                  <TH>{t.dashboard.appointments.customer}</TH>
                  <TH>{t.dashboard.appointments.service}</TH>
                  <TH>{t.dashboard.appointments.when}</TH>
                  <TH>{t.common.status}</TH>
                </TR>
              </THead>
              <TBody>
                {upcoming.map((appointment) => (
                  <TR key={appointment.id}>
                    <TD className="font-medium">{appointment.customerName}</TD>
                    <TD className="text-muted-foreground">
                      {pick(typed, appointment.service.name, appointment.service.nameFa)}
                    </TD>
                    <TD className="tabular-nums text-muted-foreground">
                      {formatDate(appointment.startsAt, typed, workspace.timezone, { dateStyle: "medium" })}
                      {" · "}
                      {formatTime(appointment.startsAt, typed, workspace.timezone)}
                    </TD>
                    <TD>
                      <Badge
                        className={STATUS_TONE[appointment.status as keyof typeof STATUS_TONE]}
                      >
                        {t.status[appointment.status as keyof typeof t.status]}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card padding="lg">
            <h3 className="font-semibold">{t.dashboard.overview.serviceTitle}</h3>
            <div className="mt-4 h-56">
              <ServiceShareChart data={serviceData} />
            </div>
          </Card>

          <Card padding="lg">
            <h3 className="font-semibold">{t.dashboard.overview.utilizationTitle}</h3>
            <ul className="mt-4 space-y-3">
              {staffRows
                .sort((a, b) => b._count._all - a._count._all)
                .slice(0, 5)
                .map((row) => (
                  <li key={row.staffId}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate">{staffNameOf.get(row.staffId) ?? "—"}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatNumber(row._count._all, typed)}
                      </span>
                    </div>
                    <Progress value={row._count._all} max={maxStaff} className="mt-1.5" />
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
