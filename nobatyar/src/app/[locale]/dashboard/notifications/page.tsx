import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Mail, MessageCircle, Send } from "lucide-react";

import { Badge, EmptyState } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { formatDate, formatTime } from "@/lib/dates";
import { isLocale, type Locale } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.notifications.title };
}

const CHANNEL_ICON = { EMAIL: Mail, WHATSAPP: MessageCircle, TELEGRAM: Send } as const;

export default async function NotificationsPage({
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

  const rows = await prisma.notification.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const configured = {
    EMAIL: true,
    WHATSAPP: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    TELEGRAM: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.notifications.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.notifications.subtitle}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {(["EMAIL", "WHATSAPP", "TELEGRAM"] as const).map((channel) => {
          const Icon = CHANNEL_ICON[channel];
          const label =
            channel === "EMAIL"
              ? t.dashboard.notifications.email
              : channel === "WHATSAPP"
                ? t.dashboard.notifications.whatsapp
                : t.dashboard.notifications.telegram;
          const delivered = rows.filter((row) => row.channel === channel && row.isSent).length;
          return (
            <Card key={channel} padding="lg" hover="lift">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 text-primary" aria-hidden />
                  {label}
                </span>
                <Badge tone={configured[channel] ? "success" : "outline"}>
                  {configured[channel] ? "on" : "off"}
                </Badge>
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums">{delivered}</p>
              <p className="text-xs text-muted-foreground">{t.dashboard.notifications.sent}</p>
            </Card>
          );
        })}
      </div>

      <p className="rounded-xl border border-dashed border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {t.dashboard.notifications.channelsHint}
      </p>

      <Card padding="none">
        {rows.length === 0 ? (
          <EmptyState title={t.common.noResults} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t.dashboard.notifications.type}</TH>
                <TH>{t.dashboard.notifications.channel}</TH>
                <TH className="w-64">—</TH>
                <TH>{t.dashboard.notifications.status}</TH>
                <TH>{t.common.date}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD className="whitespace-nowrap font-medium">{row.type}</TD>
                  <TD>
                    <Badge tone="outline">{row.channel}</Badge>
                  </TD>
                  <TD className="max-w-md truncate text-xs text-muted-foreground">
                    {row.message.replace(/\n/g, " ⏎ ")}
                  </TD>
                  <TD>
                    {(() => {
                      // a channel that simply is not configured is not a
                      // delivery failure — say exactly that
                      if (row.error?.startsWith("no-transport")) {
                        return (
                          <Badge tone="warning">{t.dashboard.notifications.notConfigured}</Badge>
                        );
                      }
                      if (row.isSent) {
                        return (
                          <Badge tone="success">{t.dashboard.notifications.sent}</Badge>
                        );
                      }
                      return (
                        <Badge tone={row.error ? "danger" : "warning"}>
                          {row.error
                            ? t.dashboard.notifications.failed
                            : t.dashboard.notifications.pending}
                        </Badge>
                      );
                    })()}
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatDate(row.createdAt, typed, workspace.timezone, { dateStyle: "short" })}{" "}
                    {formatTime(row.createdAt, typed, workspace.timezone)}
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
