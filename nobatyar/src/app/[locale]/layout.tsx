import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import "@fontsource-variable/vazirmatn";
import "@fontsource-variable/inter";
import "../globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { getDictionary } from "@/lib/dictionaries";
import { getSession } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { dirOf, isLocale, locales, type Locale } from "@/lib/i18n";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f1a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);

  return {
    metadataBase: new URL(appUrl),
    title: {
      default: t.meta.title,
      template: `%s | ${t.brand.name}`,
    },
    description: t.meta.description,
    keywords: t.meta.keywords.split("،").map((k) => k.trim()),
    applicationName: t.brand.name,
    authors: [{ name: t.brand.name }],
    alternates: {
      canonical: `${appUrl}/${locale}`,
      languages: { fa: `${appUrl}/fa`, en: `${appUrl}/en`, "x-default": `${appUrl}/fa` },
    },
    openGraph: {
      type: "website",
      siteName: t.brand.name,
      title: t.meta.title,
      description: t.meta.description,
      url: `${appUrl}/${locale}`,
      locale: locale === "fa" ? "fa_IR" : "en_US",
      alternateLocale: locale === "fa" ? "en_US" : "fa_IR",
    },
    twitter: {
      card: "summary_large_image",
      title: t.meta.title,
      description: t.meta.description,
    },
    robots: { index: true, follow: true },
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: "/icon.svg",
    },
  };
}

export default async function LocaleLayout({
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
  const session = await getSession();
  const dir = dirOf(typed);

  const organisationJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: t.brand.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: t.meta.description,
    url: `${appUrl}/${typed}`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return (
    <html lang={typed} dir={dir} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider>
          <ToastProvider>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-100 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
            >
              {t.nav.home}
            </a>
            <div className="flex min-h-dvh flex-col">
              <SiteHeader
                locale={typed}
                labels={{
                  home: t.nav.home,
                  services: t.nav.services,
                  staff: t.nav.staff,
                  pricing: t.nav.pricing,
                  faq: t.nav.faq,
                  book: t.nav.book,
                  dashboard: t.nav.dashboard,
                  login: t.nav.login,
                  register: t.nav.register,
                  logout: t.nav.logout,
                  welcome: t.auth.welcome,
                  menu: "menu",
                }}
                user={session ? { name: session.name, email: session.email } : null}
              />
              <main id="main" className="flex-1">
                {children}
              </main>
              <SiteFooter
                locale={typed}
                labels={{
                  tagline: t.brand.tagline,
                  product: t.footer.product,
                  company: t.footer.company,
                  support: t.footer.support,
                  services: t.nav.services,
                  staff: t.nav.staff,
                  pricing: t.nav.pricing,
                  faq: t.nav.faq,
                  book: t.nav.book,
                  dashboard: t.nav.dashboard,
                  rights: t.footer.rights,
                  builtWith: t.footer.builtWith,
                }}
              />
            </div>
            <script
              type="application/ld+json"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: JSON.stringify(organisationJsonLd) }}
            />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
