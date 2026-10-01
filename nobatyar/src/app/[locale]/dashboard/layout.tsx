import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DashboardNav, type DashboardSection } from "@/components/dashboard/nav";
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
  return {
    title: getDictionary(locale).dashboard.title,
    robots: { index: false, follow: false },
  };
}

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const session = await requireSession(typed);
  const workspace = await getWorkspace();

  // icons travel as keys, never as component references (server → client)
  const sections: DashboardSection[] = [
    { key: "overview", href: `/${typed}/dashboard`, label: t.dashboard.nav.overview },
    { key: "calendar", href: `/${typed}/dashboard/calendar`, label: t.dashboard.nav.calendar },
    { key: "appointments", href: `/${typed}/dashboard/appointments`, label: t.dashboard.nav.appointments },
    { key: "link", href: `/${typed}/dashboard/link`, label: t.dashboard.nav.link },
    { key: "services", href: `/${typed}/dashboard/services`, label: t.dashboard.nav.services },
    { key: "staff", href: `/${typed}/dashboard/staff`, label: t.dashboard.nav.staff },
    { key: "waitlist", href: `/${typed}/dashboard/waitlist`, label: t.dashboard.nav.waitlist },
    { key: "packages", href: `/${typed}/dashboard/packages`, label: t.dashboard.nav.packages },
    { key: "locations", href: `/${typed}/dashboard/locations`, label: t.dashboard.nav.locations },
    { key: "notifications", href: `/${typed}/dashboard/notifications`, label: t.dashboard.nav.notifications },
    { key: "settings", href: `/${typed}/dashboard/settings`, label: t.dashboard.nav.settings },
  ];

  return (
    <div className="container-page py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t.dashboard.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {typed === "fa" ? workspace.nameFa : workspace.name}
        </p>
      </header>

      <DashboardNav
        sections={sections}
        locale={typed}
        userName={session.name}
        role={session.wrole}
      >
        {children}
      </DashboardNav>
    </div>
  );
}
