import Link from "next/link";

import type { Locale } from "@/lib/i18n";

export type FooterLabels = {
  tagline: string;
  product: string;
  company: string;
  support: string;
  services: string;
  staff: string;
  pricing: string;
  faq: string;
  book: string;
  dashboard: string;
  rights: string;
  builtWith: string;
};

export function SiteFooter({ locale, labels }: { locale: Locale; labels: FooterLabels }) {
  const year = new Date().getFullYear();

  const columns = [
    {
      title: labels.product,
      links: [
        { href: `/${locale}/services`, label: labels.services },
        { href: `/${locale}/staff`, label: labels.staff },
        { href: `/${locale}/book`, label: labels.book },
      ],
    },
    {
      title: labels.company,
      links: [
        { href: `/${locale}/pricing`, label: labels.pricing },
        { href: `/${locale}/faq`, label: labels.faq },
        { href: `/${locale}/dashboard`, label: labels.dashboard },
      ],
    },
  ];

  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(2,1fr)]">
        <div className="space-y-4">
          <p className="text-lg font-semibold">{locale === "fa" ? "نوبت‌یار" : "NobatYar"}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{labels.tagline}</p>
          <p className="text-xs text-muted-foreground">
            © {year} {labels.rights}
          </p>
        </div>

        {columns.map((column) => (
          <div key={column.title} className="space-y-3">
            <p className="text-sm font-semibold">{column.title}</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition hover:text-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-5 text-xs text-muted-foreground">
          <span>{labels.builtWith}</span>
          <span className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" aria-hidden />
              {locale === "fa" ? "وضعیت سرویس: عادی" : "All systems operational"}
            </span>
            <Link href={`/${locale}/faq`} className="transition hover:text-primary">
              {labels.support}
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
