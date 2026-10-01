import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock3, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getServiceBySlug, getWorkspace } from "@/lib/queries";
import { isLocale, type Locale } from "@/lib/i18n";
import { formatMoney, minutesToHHMM } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const workspace = await getWorkspace();
  const service = await getServiceBySlug(workspace.id, slug);
  if (!service) return {};
  const name = pick(locale, service.name, service.nameFa);
  const t = getDictionary(locale);
  return {
    title: name,
    description: service.shortDesc ?? service.description ?? t.services.subtitle,
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/services/${slug}`,
    },
    openGraph: { title: name, description: service.shortDesc ?? undefined, type: "article" },
  };
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const workspace = await getWorkspace();
  const service = await getServiceBySlug(workspace.id, slug);
  if (!service) notFound();

  const Arrow = typed === "fa" ? ArrowLeft : ArrowRight;
  const name = pick(typed, service.name, service.nameFa);
  const staff = service.staff.map((link) => link.staff);

  // Service structured data → rich results in Google
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name,
    description: service.description ?? service.shortDesc ?? undefined,
    provider: { "@type": "LocalBusiness", name: pick(typed, workspace.name, workspace.nameFa) },
    areaServed: workspace.address ?? undefined,
    offers: service.priceAmount
      ? {
          "@type": "Offer",
          price: service.priceAmount,
          priceCurrency: workspace.currency,
        }
      : undefined,
  };

  return (
    <div className="container-page py-12">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <Link
            href={`/${typed}/services`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-primary"
          >
            {typed === "fa" ? <ArrowRight className="size-4" aria-hidden /> : <ArrowLeft className="size-4" aria-hidden />}
            {t.nav.services}
          </Link>

          <div className="mt-4 flex items-center gap-4">
            <span
              className="grid size-14 place-items-center rounded-2xl text-lg font-bold text-white"
              style={{ background: service.color ?? "var(--primary)" }}
              aria-hidden
            >
              {service.durationMin}
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
              {service.category ? (
                <Badge tone="primary" className="mt-1.5">
                  {pick(typed, service.category.name, service.category.nameFa)}
                </Badge>
              ) : null}
            </div>
          </div>

          {service.description ? (
            <p className="mt-6 whitespace-pre-line text-base leading-relaxed text-muted-foreground">
              {service.description}
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href={`/${typed}/book?service=${service.id}`}>
                {t.services.bookNow}
                <Arrow aria-hidden />
              </Link>
            </Button>
            {service.priceAmount ? (
              <span className="text-lg font-semibold tabular-nums">
                {formatMoney(service.priceAmount, typed, workspace.currency)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <Card padding="lg">
            <h2 className="font-semibold">{t.common.duration}</h2>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="size-4" aria-hidden />
              {service.durationMin} {t.common.minutes}
            </p>

            <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
              {(service.bufferBeforeMin > 0 || service.bufferAfterMin > 0) ? (
                <p>
                  {t.booking.pickTime}: +{service.bufferBeforeMin} / +{service.bufferAfterMin} {t.common.minutes}
                </p>
              ) : null}
              {service.maxPerDay ? (
                <p>
                  {typed === "fa"
                    ? `سقف رزرو روزانه: ${service.maxPerDay} نوبت`
                    : `Daily cap: ${service.maxPerDay} appointments`}
                </p>
              ) : null}
            </div>
          </Card>

          <Card padding="lg">
            <h2 className="flex items-center gap-2 font-semibold">
              <Users className="size-4" aria-hidden />
              {t.staff.title}
            </h2>
            {staff.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t.booking.noStaff}</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {staff.map((member) => (
                  <li key={member.id} className="flex items-center gap-3">
                    <Avatar name={member.name} src={member.photoUrl} size={40} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{member.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {member.title ?? member.specialty}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost" className="ms-auto shrink-0">
                      <Link href={`/${typed}/book?service=${service.id}&staff=${member.id}`}>
                        {t.nav.book}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padding="lg">
            <h2 className="font-semibold">{t.staff.workingHours}</h2>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {staff.length === 0 ? (
                <li>—</li>
              ) : (
                staff.slice(0, 3).map((member) => (
                  <li key={member.id}>
                    <span className="block font-medium text-foreground">{member.name}</span>
                    <WorkingHoursSummary staffId={member.id} />
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

async function WorkingHoursSummary({ staffId }: { staffId: string }) {
  const { prisma } = await import("@/lib/db");
  const hours = await prisma.workingHour.findMany({
    where: { staffId, isActive: true },
    orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
  });
  const byWeekday = new Map<number, string[]>();
  for (const window of hours) {
    byWeekday.set(window.weekday, [
      ...(byWeekday.get(window.weekday) ?? []),
      `${minutesToHHMM(window.startMinute)}–${minutesToHHMM(window.endMinute)}`,
    ]);
  }
  const formatter = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
  const reference = Date.UTC(2024, 0, 7);
  const lines: string[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const windows = byWeekday.get(weekday);
    if (!windows) continue;
    lines.push(`${formatter.format(new Date(reference + weekday * 86_400_000))}: ${windows.join("  ")}`);
  }
  if (lines.length === 0) return <span>—</span>;
  return (
    <span className="block space-y-1">
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </span>
  );
}
