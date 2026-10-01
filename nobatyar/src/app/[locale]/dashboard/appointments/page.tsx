import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Search } from "lucide-react";

import { StatusActions } from "@/components/dashboard/status-actions";
import { Badge, EmptyState } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Pagination, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { formatDate, formatTime } from "@/lib/dates";
import { APPOINTMENT_STATUSES, STATUS_TONE } from "@/lib/domain";
import { isLocale, type Locale } from "@/lib/i18n";
import { formatMoney } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.appointments.title };
}

const PAGE_SIZE = 20;

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const session = await requireSession(typed);
  const workspace = await getWorkspace();

  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const status = APPOINTMENT_STATUSES.includes(query.status as never)
    ? (query.status as string)
    : undefined;
  const search = query.q?.trim();

  const where = {
    workspaceId: workspace.id,
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { customerName: { contains: search } },
            { customerPhone: { contains: search } },
            { trackingCode: { contains: search.toUpperCase() } },
          ],
        }
      : {}),
  };

  const [rows, total, services, staff] = await Promise.all([
    prisma.appointment.findMany({
      where,
      orderBy: { startsAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { service: true, staff: true },
    }),
    prisma.appointment.count({ where }),
    prisma.service.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true, nameFa: true } }),
    prisma.staffMember.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }),
  ]);

  const serviceName = new Map(services.map((s) => [s.id, pick(typed, s.name, s.nameFa)]));
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const revenue = rows.reduce((sum, row) => sum + (row.priceAmount ?? 0), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.appointments.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.appointments.subtitle}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a
            href={`/${typed}/dashboard/appointments.csv?${new URLSearchParams(
              Object.entries(query).filter(([, v]) => v),
            ).toString()}`}
          >
            <Download aria-hidden />
            {t.common.export}
          </a>
        </Button>
      </header>

      <Card padding="md">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <div className="min-w-52 flex-1">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="q">
              {t.common.search}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="q"
                name="q"
                defaultValue={search ?? ""}
                placeholder={t.booking.lookupPlaceholder}
                className="ps-9"
              />
            </div>
          </div>
          <div className="w-44">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="status">
              {t.common.status}
            </label>
            <Select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">{t.common.all}</option>
              {APPOINTMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t.status[value]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            {t.dashboard.appointments.filters}
          </Button>
        </form>
      </Card>

      <Card padding="none">
        {rows.length === 0 ? (
          <EmptyState
            title={t.dashboard.appointments.emptyState}
            description={t.dashboard.overview.empty}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>{t.dashboard.appointments.customer}</TH>
                  <TH>{t.dashboard.appointments.service}</TH>
                  <TH>{t.dashboard.appointments.staff}</TH>
                  <TH>{t.dashboard.appointments.when}</TH>
                  <TH>{t.common.status}</TH>
                  <TH className="text-end">{t.common.price}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <span className="font-medium">{row.customerName}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground" dir="ltr">
                        {row.trackingCode}
                      </span>
                    </TD>
                    <TD className="text-muted-foreground">{serviceName.get(row.serviceId)}</TD>
                    <TD className="text-muted-foreground">{staffName.get(row.staffId)}</TD>
                    <TD className="tabular-nums text-muted-foreground">
                      {formatDate(row.startsAt, typed, workspace.timezone, { dateStyle: "medium" })}
                      {" · "}
                      {formatTime(row.startsAt, typed, workspace.timezone)}
                    </TD>
                    <TD>
                      <Badge className={STATUS_TONE[row.status as keyof typeof STATUS_TONE]}>
                        {t.status[row.status as keyof typeof t.status]}
                      </Badge>
                    </TD>
                    <TD className="text-end tabular-nums">
                      <span>{row.priceAmount ? formatMoney(row.priceAmount, typed, workspace.currency) : "—"}</span>
                      <div className="mt-1 flex justify-end">
                        <StatusActions
                          id={row.id}
                          status={row.status}
                          locale={typed}
                          labels={{
                            confirm: t.dashboard.appointments.markConfirmed,
                            complete: t.dashboard.appointments.markCompleted,
                            cancel: t.dashboard.appointments.cancel,
                            noShow: t.dashboard.appointments.markNoShow,
                            loading: t.common.loading,
                            done: t.common.success,
                            failed: t.errors.generic,
                          }}
                        />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={page}
              totalPages={totalPages}
              basePath={`/${typed}/dashboard/appointments`}
              params={{
                ...(status ? { status } : {}),
                ...(search ? { q: search } : {}),
              }}
              labels={{
                page: t.common.page,
                of: t.common.of,
                previous: t.common.previous,
                next: t.common.next,
              }}
            />
          </>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        {total} {typed === "fa" ? "نوبت" : "appointments"} ·{" "}
        {formatMoney(revenue, typed, workspace.currency)} · {session.email}
      </p>
    </div>
  );
}
