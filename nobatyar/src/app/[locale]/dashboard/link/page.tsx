import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QrPanel, type QrTarget } from "@/components/dashboard/qr-panel";
import { requireSession } from "@/lib/auth";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getPublicServices, getWorkspace } from "@/lib/queries";
import { appUrl } from "@/lib/env";
import { isLocale, type Locale } from "@/lib/i18n";
import { qrSvg } from "@/lib/qr";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.link.title };
}

/**
 * "Link & QR" — the two doors into the booking page.
 * The main code encodes the booking URL; every service gets its own deep link
 * so a customer who scans a poster lands directly on that service.
 */
export default async function LinkAndQrPage({
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
  const services = await getPublicServices(workspace.id);

  const bookingUrl = `${appUrl}/${typed}/book`;
  const businessName = pick(typed, workspace.name, workspace.nameFa);

  const targets: QrTarget[] = await Promise.all(
    [
      {
        id: "main",
        label: t.dashboard.link.mainPage,
        url: bookingUrl,
        svg: await qrSvg(bookingUrl, { size: 640, margin: 1 }),
      },
      ...services.map(async (service) => {
        const url = `${bookingUrl}?service=${service.id}`;
        return {
          id: service.id,
          label: pick(typed, service.name, service.nameFa),
          detail: `${service.durationMin} ${t.common.minutes}`,
          url,
          svg: await qrSvg(url, { size: 320, margin: 1 }),
        };
      }),
    ],
  );

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.link.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.link.subtitle}</p>
      </header>

      <QrPanel
        targets={targets}
        businessName={businessName}
        accentColor={workspace.accentColor}
        labels={{
          link: t.dashboard.link.link,
          linkHint: t.dashboard.link.linkHint,
          copy: t.dashboard.link.copy,
          copied: t.dashboard.link.copied,
          open: t.dashboard.link.open,
          download: t.dashboard.link.download,
          downloadPng: t.dashboard.link.downloadPng,
          print: t.dashboard.link.print,
          share: t.dashboard.link.share,
          embed: t.dashboard.link.embed,
          embedCopied: t.dashboard.link.embedCopied,
          qrTitle: t.dashboard.link.qrTitle,
          qrHint: t.dashboard.link.qrHint,
          services: t.dashboard.link.services,
          allServices: t.dashboard.link.allServices,
          mainPage: t.dashboard.link.mainPage,
        }}
      />

      <p className="text-xs text-muted-foreground">
        {session.email} · {businessName}
      </p>
    </div>
  );
}
