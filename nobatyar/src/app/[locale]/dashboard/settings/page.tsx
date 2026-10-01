import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SettingsForm } from "@/components/dashboard/managers";
import { requireSession } from "@/lib/auth";
import { getDictionary } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { isLocale, type Locale } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.settings.title };
}

export default async function SettingsPage({
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

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.settings.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.settings.subtitle}</p>
      </header>

      <SettingsForm
        locale={typed}
        t={t}
        settings={{
          name: workspace.name,
          nameFa: workspace.nameFa,
          tagline: workspace.tagline,
          description: workspace.description,
          slug: workspace.slug,
          accentColor: workspace.accentColor,
          timezone: workspace.timezone,
          weekStart: workspace.weekStart,
          defaultLocale: workspace.defaultLocale,
          currency: workspace.currency,
          phone: workspace.phone,
          email: workspace.email,
          address: workspace.address,
          minNoticeMinutes: workspace.minNoticeMinutes,
          maxAdvanceDays: workspace.maxAdvanceDays,
          slotStepMinutes: workspace.slotStepMinutes,
          cancellationWindowHrs: workspace.cancellationWindowHrs,
          allowGuestBooking: workspace.allowGuestBooking,
          requirePhone: workspace.requirePhone,
          autoConfirm: workspace.autoConfirm,
        }}
      />
    </div>
  );
}
