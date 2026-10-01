"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, CalendarRange, LogIn, LogOut, Menu, UserPlus, X } from "lucide-react";

import { ThemeToggle } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { logoutAction } from "@/app/actions/auth";
import { localeMeta, locales, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type HeaderLabels = {
  home: string;
  services: string;
  staff: string;
  pricing: string;
  faq: string;
  book: string;
  myAppointments: string;
  dashboard: string;
  login: string;
  register: string;
  logout: string;
  welcome: string;
  menu: string;
};

/** The product logotype: SVG mark + localised wordmark. */
export function BrandLogo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="grid size-9 place-items-center rounded-xl bg-white shadow-[0_6px_18px_-10px_rgba(11,27,52,0.6)] ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
        <Image
          src="/brand/mark.svg"
          alt=""
          width={26}
          height={26}
          priority
          className="size-6.5"
        />
      </span>
      {compact ? null : (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-bold tracking-tight text-foreground">
            Nobat
            <span className="text-primary">.</span>yar
          </span>
          <span className="mt-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
            رزرو نوبت، به سادگی
          </span>
        </span>
      )}
    </span>
  );
}

export function SiteHeader({
  locale,
  labels,
  user,
}: {
  locale: Locale;
  labels: HeaderLabels;
  user: { name: string; email: string } | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { href: `/${locale}`, label: labels.home },
    { href: `/${locale}/services`, label: labels.services },
    { href: `/${locale}/staff`, label: labels.staff },
    { href: `/${locale}/pricing`, label: labels.pricing },
    { href: `/${locale}/faq`, label: labels.faq },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled ? "glass border-b border-border shadow-sm" : "border-b border-transparent",
      )}
    >
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href={`/${locale}`} aria-label="NobatYar">
          <BrandLogo />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent/60 hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LocaleSwitcher locale={locale} />
          <ThemeToggle />
          {user ? (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden xl:inline-flex">
                <Link href={`/${locale}/my-appointments`}>
                  <CalendarRange aria-hidden />
                  {labels.myAppointments}
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/${locale}/dashboard`}>
                  <CalendarCheck aria-hidden />
                  {labels.dashboard}
                </Link>
              </Button>
              <span className="flex items-center gap-2 rounded-xl border border-border py-1 pe-3 ps-1">
                <Avatar name={user.name} size={28} />
                <span className="max-w-28 truncate text-sm font-medium">{user.name}</span>
              </span>
              <form action={logoutAction}>
                <Button type="submit" variant="ghost" size="icon-sm" title={labels.logout}>
                  <LogOut aria-hidden />
                </Button>
              </form>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/${locale}/login`}>
                  <LogIn aria-hidden />
                  {labels.login}
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href={`/${locale}/register`}>
                  <UserPlus aria-hidden />
                  {labels.register}
                </Link>
              </Button>
            </>
          )}
        </div>

        <button
          type="button"
          className="grid size-10 place-items-center rounded-xl border border-border lg:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={labels.menu}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-border glass lg:hidden">
          <nav className="container-page flex flex-col gap-1 py-4" aria-label="Mobile">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium transition hover:bg-accent/60"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-4">
              <LocaleSwitcher locale={locale} />
              <ThemeToggle />
              {user ? (
                <Button asChild size="sm" className="flex-1">
                  <Link href={`/${locale}/dashboard`} onClick={() => setOpen(false)}>
                    {labels.dashboard}
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link href={`/${locale}/login`} onClick={() => setOpen(false)}>
                      {labels.login}
                    </Link>
                  </Button>
                  <Button asChild size="sm" className="flex-1">
                    <Link href={`/${locale}/register`} onClick={() => setOpen(false)}>
                      {labels.register}
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function LocaleSwitcher({ locale, className }: { locale: Locale; className?: string }) {
  const pathname = usePathname();
  const other = locales.find((code) => code !== locale) ?? "en";
  const target = pathname.replace(new RegExp(`^/${locale}`), `/${other}`) || `/${other}`;

  return (
    <Link
      href={target}
      hrefLang={other}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium transition hover:border-primary/40 hover:text-primary",
        className,
      )}
      aria-label="Switch language"
    >
      <span aria-hidden>{localeMeta[other].flag}</span>
      <span className="text-xs">{localeMeta[other].label}</span>
    </Link>
  );
}
