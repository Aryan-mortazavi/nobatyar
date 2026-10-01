"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  CalendarRange,
  CalendarCheck2,
  Gift,
  LayoutDashboard,
  Link2,
  ListChecks,
  MapPin,
  Settings2,
  Sparkles,
  UsersRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

/**
 * Icons are referenced by key: a Server Component may not hand a component
 * (a function) to a Client Component.
 */
const ICONS = {
  overview: LayoutDashboard,
  calendar: CalendarRange,
  appointments: ListChecks,
  link: Link2,
  services: CalendarCheck2,
  staff: UsersRound,
  waitlist: Sparkles,
  packages: Gift,
  locations: MapPin,
  notifications: BellRing,
  settings: Settings2,
} as const;

export type DashboardIconKey = keyof typeof ICONS;

export type DashboardSection = {
  key: DashboardIconKey;
  href: string;
  label: string;
};

export function DashboardNav({
  sections,
  locale,
  userName,
  role,
  children,
}: {
  sections: DashboardSection[];
  locale: Locale;
  userName: string;
  role: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  const roleLabel =
    role === "OWNER"
      ? "مالک"
      : role === "ADMIN"
        ? "مدیر"
        : role === "MANAGER"
          ? "سرپرست"
          : "کارشناس";

  return (
    <div className="grid gap-6 lg:grid-cols-[248px_1fr]">
      <aside className={cn("lg:sticky lg:top-20 lg:self-start", open ? "block" : "hidden lg:block")}>
        <nav className="space-y-1 rounded-2xl border border-border bg-card p-3" aria-label="Dashboard">
          {sections.map((section) => {
            const Icon = ICONS[section.key];
            const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
            return (
              <Link
                key={section.key}
                href={section.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  active
                    ? "bg-primary text-primary-foreground shadow-[0_10px_24px_-16px_var(--primary)]"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4.5" aria-hidden />
                {section.label}
              </Link>
            );
          })}

          <div className="mt-3 rounded-xl bg-muted/60 p-3">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{roleLabel}</p>
          </div>
        </nav>
      </aside>

      <div className="min-w-0 space-y-6">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium lg:hidden"
          aria-expanded={open}
        >
          <span className="inline-flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden />
            {locale === "fa" ? "فهرست پنل" : "Menu"}
          </span>
          <span aria-hidden>☰</span>
        </button>
        {children}
      </div>
    </div>
  );
}
