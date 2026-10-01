import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getStaffBySlug, getWorkspace } from "@/lib/queries";
import { isLocale, type Locale } from "@/lib/i18n";
import { minutesToHHMM } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const workspace = await getWorkspace();
  const member = await getStaffBySlug(workspace.id, slug);
  if (!member) return {};
  const t = getDictionary(locale);
  return {
    title: member.name,
    description: member.bio ?? member.title ?? t.staff.subtitle,
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/staff/${slug}`,
    },
  };
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  timeZone: "UTC",
});

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const workspace = await getWorkspace();
  const member = await getStaffBySlug(workspace.id, slug);
  if (!member) notFound();

  const Arrow = typed === "fa" ? ArrowLeft : ArrowRight;

  const byWeekday = new Map<number, { startMinute: number; endMinute: number }[]>();
  for (const window of member.workingHours) {
    byWeekday.set(window.weekday, [
      ...(byWeekday.get(window.weekday) ?? []),
      { startMinute: window.startMinute, endMinute: window.endMinute },
    ]);
  }
  const reference = Date.UTC(2024, 0, 7); // a Sunday
  const weekdays = Array.from({ length: 7 }, (_, index) => (workspace.weekStart + index) % 7);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: member.name,
    jobTitle: member.title ?? member.specialty ?? undefined,
    description: member.bio ?? undefined,
    worksFor: { "@type": "LocalBusiness", name: pick(typed, workspace.name, workspace.nameFa) },
  };

  return (
    <div className="container-page py-12">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link
        href={`/${typed}/staff`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-primary"
      >
        {typed === "fa" ? <ArrowRight className="size-4" aria-hidden /> : <ArrowLeft className="size-4" aria-hidden />}
        {t.staff.title}
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="flex items-center gap-4">
            <Avatar name={member.name} src={member.photoUrl} size={72} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{member.name}</h1>
              <p className="mt-1 text-muted-foreground">{member.title ?? member.specialty}</p>
              {member.specialty ? (
                <Badge tone="primary" className="mt-2">
                  {member.specialty}
                </Badge>
              ) : null}
            </div>
          </div>

          {member.bio ? (
            <p className="mt-6 text-base leading-relaxed text-muted-foreground">{member.bio}</p>
          ) : null}

          <Button asChild size="lg" className="mt-8">
            <Link href={`/${typed}/book?staff=${member.id}`}>
              {t.booking.title}
              <Arrow aria-hidden />
            </Link>
          </Button>
        </div>

        <div className="space-y-4">
          <Card padding="lg">
            <h2 className="flex items-center gap-2 font-semibold">
              <Clock3 className="size-4" aria-hidden />
              {t.staff.workingHours}
            </h2>
            <ul className="mt-4 space-y-1.5 text-sm">
              {weekdays.map((weekday) => {
                const windows = (byWeekday.get(weekday) ?? []).sort(
                  (a, b) => a.startMinute - b.startMinute,
                );
                return (
                  <li
                    key={weekday}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 odd:bg-muted/40"
                  >
                    <span>{WEEKDAY_FORMATTER.format(new Date(reference + weekday * 86_400_000))}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {windows.length === 0
                        ? t.staff.closedDay
                        : windows
                            .map(
                              (w) =>
                                `${minutesToHHMM(w.startMinute)}–${minutesToHHMM(w.endMinute)}`,
                            )
                            .join("  ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          {member.services.length > 0 ? (
            <Card padding="lg">
              <h2 className="font-semibold">{t.dashboard.nav.services}</h2>
              <ul className="mt-3 space-y-2">
                {member.services.map((link) => (
                  <li key={link.serviceId}>
                    <Link
                      href={`/${typed}/services/${link.service.slug}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5 text-sm transition hover:border-primary/50"
                    >
                      <span className="truncate">
                        {pick(typed, link.service.name, link.service.nameFa)}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {link.service.durationMin} {t.common.minutes}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
