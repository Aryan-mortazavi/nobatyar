import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BellRing } from "lucide-react";

import { Badge, EmptyState } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { formatDate } from "@/lib/dates";
import { isLocale, type Locale } from "@/lib/i18n";
import { minutesToHHMM } from "@/lib/utils";
import { WaitlistRowActions } from "@/components/dashboard/waitlist-actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.waitlist.title };
}

const TONE: Record<string, "default" | "primary" | "success" | "warning" | "danger" | "info"> = {
  PENDING: "warning",
  NOTIFIED: "info",
  BOOKED: "success",
  EXPIRED: "default",
  CANCELLED: "danger",
};

export default async function WaitlistPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  await requireSession(typed);
  const workspace = await getWorkspace();

  const [entries, staff] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      include: { service: true, staff: true },
    }),
    prisma.staffMember.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true },
    }),
  ]);

  const staffName = new Map(staff.map((member) => [member.id, member.name]));

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.waitlist.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.waitlist.subtitle}</p>
      </header>

      <Card padding="none">
        {entries.length === 0 ? (
          <EmptyState
            icon={<BellRing className="size-5" aria-hidden />}
            title={t.dashboard.waitlist.empty}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t.dashboard.appointments.customer}</TH>
                <TH>{t.dashboard.appointments.service}</TH>
                <TH>{t.dashboard.appointments.staff}</TH>
                <TH>{t.dashboard.waitlist.preferred}</TH>
                <TH>{t.common.status}</TH>
                <TH className="text-end">{t.common.actions}</TH>
              </TR>
            </THead>
            <TBody>
              {entries.map((entry) => (
                <TR key={entry.id}>
                  <TD>
                    <span className="font-medium">{entry.customerName}</span>
                    <span className="block text-[11px] text-muted-foreground" dir="ltr">
                      {entry.customerPhone}
                    </span>
                  </TD>
                  <TD className="text-muted-foreground">
                    {pick(typed, entry.service.name, entry.service.nameFa)}
                  </TD>
                  <TD className="text-muted-foreground">
                    {entry.staffId ? (staffName.get(entry.staffId) ?? "—") : t.booking.anyStaff}
                  </TD>
                  <TD className="tabular-nums text-muted-foreground">
                    {entry.preferredDate
                      ? formatDate(entry.preferredDate, typed, workspace.timezone, { dateStyle: "medium" })
                      : "—"}
                    {entry.preferredStartMinute != null ? (
                      <span className="ms-2">{minutesToHHMM(entry.preferredStartMinute)}</span>
                    ) : null}
                  </TD>
                  <TD>
                    <Badge tone={TONE[entry.status] ?? "default"}>{entry.status}</Badge>
                  </TD>
                  <TD>
                    <div className="flex justify-end">
                      <WaitlistRowActions
                        id={entry.id}
                        locale={typed}
                        status={entry.status}
                        labels={{
                          notify: t.dashboard.waitlist.notify,
                          remove: t.common.delete,
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
        )}
      </Card>
    </div>
  );
}
