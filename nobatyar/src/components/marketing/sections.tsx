import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  Clock3,
  Globe2,
  Lock,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatTime } from "@/lib/dates";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/i18n";
import { cn, formatMoney, formatNumber } from "@/lib/utils";

const FEATURE_ICONS = [Clock3, CalendarDays, MessageSquareText, ChartNoAxesCombined, Globe2, ShieldCheck] as const;

export function Hero({
  locale,
  t,
  stats,
  bookingSlug,
  accentColor,
}: {
  locale: Locale;
  t: Dictionary;
  stats: { bookings: number; business: number; satisfaction: number };
  bookingSlug: string;
  accentColor: string;
}) {
  const Arrow = locale === "fa" ? ArrowLeft : ArrowRight;

  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div
        className="pointer-events-none absolute -top-40 start-1/2 -z-10 size-[38rem] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: `radial-gradient(circle, ${accentColor}, transparent 65%)` }}
        aria-hidden
      />

      <div className="container-page grid items-center gap-14 py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24">
        <div className="animate-fade-up space-y-7">
          <Badge tone="primary" className="px-3 py-1.5">
            <Sparkles className="size-3.5" aria-hidden />
            {t.hero.badge}
          </Badge>

          <h1 className="text-balance text-4xl font-bold leading-[1.15] tracking-tight sm:text-5xl lg:text-6xl">
            {t.hero.title}{" "}
            <span className="text-gradient">{t.hero.titleAccent}</span>
          </h1>

          <p className="max-w-xl text-lg text-muted-foreground">{t.hero.subtitle}</p>

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href={`/${locale}/${bookingSlug}`}>
                {t.hero.ctaPrimary}
                <Arrow aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href={`/${locale}/dashboard`}>{t.hero.ctaSecondary}</Link>
            </Button>
          </div>

          <dl className="grid max-w-lg grid-cols-3 gap-4 pt-4">
            {[
              { label: t.stats.bookings, value: formatNumber(stats.bookings, locale) },
              { label: t.stats.businesses, value: formatNumber(stats.business, locale) },
              { label: t.stats.satisfaction, value: `${formatNumber(stats.satisfaction, locale)}٪` },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="mt-1 text-2xl font-bold tabular-nums">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <HeroPreview locale={locale} t={t} accentColor={accentColor} />
      </div>
    </section>
  );
}

function HeroPreview({
  locale,
  t,
  accentColor,
}: {
  locale: Locale;
  t: Dictionary;
  accentColor: string;
}) {
  const today = new Date();
  return (
    <div className="relative animate-fade-up" style={{ animationDelay: "120ms" }}>
      <Card tone="glass" padding="none" className="overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
          <span className="size-2.5 rounded-full bg-danger/70" aria-hidden />
          <span className="size-2.5 rounded-full bg-warning/70" aria-hidden />
          <span className="size-2.5 rounded-full bg-success/70" aria-hidden />
          <span className="ms-2 text-xs text-muted-foreground">
            {locale === "fa" ? "رزرو نوبت آنلاین" : "nobatyar.app/book"}
          </span>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{t.booking.pickTime}</p>
            <Badge tone="success">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              {t.booking.anyStaff}
            </Badge>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px]">
            {Array.from({ length: 7 }).map((_, index) => (
              <span key={index} className="rounded-lg bg-muted/60 py-1.5 text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-2">
            {["09:00", "10:30", "12:00", "16:45"].map((time, index) => (
              <span
                key={time}
                className={cn(
                  "rounded-xl border px-2 py-2 text-center text-xs font-medium tabular-nums",
                  index === 1
                    ? "border-transparent text-primary-foreground"
                    : "border-border text-foreground/80",
                )}
                style={index === 1 ? { background: accentColor } : undefined}
              >
                {time}
              </span>
            ))}
          </div>

          <div className="space-y-2 rounded-2xl border border-border bg-background/60 p-4">
            <p className="text-xs text-muted-foreground">{t.booking.summary}</p>
            <p className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="size-4 text-primary" aria-hidden />
              {formatDate(today, locale, "Asia/Tehran", { dateStyle: "full" })}
            </p>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Clock3 className="size-4 text-primary" aria-hidden />
              {formatTime(today, locale, "Asia/Tehran")}
            </p>
          </div>
        </div>
      </Card>

      <div
        className="absolute -bottom-6 -start-6 hidden rounded-2xl border border-border bg-card px-4 py-3 shadow-xl sm:block animate-float"
        aria-hidden
      >
        <p className="text-xs text-muted-foreground">{t.features.realtime.title}</p>
        <p className="text-sm font-semibold">{t.hero.trust}</p>
      </div>
    </div>
  );
}

export function Features({ locale, t }: { locale: Locale; t: Dictionary }) {
  const items = [
    t.features.realtime,
    t.features.jalali,
    t.features.reminders,
    t.features.dashboard,
    t.features.multilingual,
    t.features.secure,
  ];

  return (
    <section id="features" className="container-page py-20">
      <SectionHeading title={t.features.title} subtitle={t.features.subtitle} />

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => {
          const Icon = FEATURE_ICONS[index] ?? Sparkles;
          return (
            <Card key={item.title} padding="lg" hover="lift" className="group">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary transition group-hover:scale-110">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export function HowItWorks({ locale, t }: { locale: Locale; t: Dictionary }) {
  const steps = [t.how.step1, t.how.step2, t.how.step3];
  const Arrow = locale === "fa" ? ArrowLeft : ArrowRight;
  return (
    <section className="border-y border-border bg-muted/30 py-20">
      <div className="container-page">
        <SectionHeading title={t.how.title} subtitle={t.how.subtitle} />

        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="relative">
              <Card padding="lg" className="h-full">
                <span className="grid size-10 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {formatNumber(index + 1, locale)}
                </span>
                <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{step.body}</p>
              </Card>
              {index < steps.length - 1 ? (
                <Arrow
                  className="absolute -end-3 top-1/2 hidden size-5 -translate-y-1/2 text-muted-foreground/50 md:block"
                  aria-hidden
                />
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function SectionHeading({
  title,
  subtitle,
  align = "center",
  id,
}: {
  title: string;
  subtitle?: string;
  align?: "center" | "start";
  id?: string;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" ? "mx-auto text-center" : "text-start")} id={id}>
      <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {subtitle ? <p className="mt-3 text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

export function PricingPreview({
  locale,
  plans,
}: {
  locale: Locale;
  plans: { name: string; price: number; currency: string; features: string[]; featured?: boolean; cta: string }[];
}) {
  return (
    <section id="pricing" className="container-page py-20">
      <SectionHeading
        title={locale === "fa" ? "تعرفه‌های شفاف" : "Transparent pricing"}
        subtitle={
          locale === "fa"
            ? "بدون هزینه پنهان؛ هر زمان بخواهید ارتقا دهید."
            : "No hidden fees — upgrade whenever you need."
        }
      />
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card
            key={plan.name}
            padding="lg"
            hover="lift"
            className={cn("flex flex-col", plan.featured && "ring-2 ring-primary/60")}
          >
            {plan.featured ? (
              <Badge tone="primary" className="mb-3 self-start">
                {locale === "fa" ? "محبوب‌ترین" : "Most popular"}
              </Badge>
            ) : null}
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <p className="mt-2 text-3xl font-bold tabular-nums">
              {formatMoney(plan.price, locale, plan.currency)}
              <span className="text-sm font-normal text-muted-foreground">
                {locale === "fa" ? " / ماه" : " / month"}
              </span>
            </p>
            <ul className="mt-5 flex-1 space-y-2 text-sm text-muted-foreground">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>
            <Button className="mt-6" block variant={plan.featured ? "primary" : "outline"}>
              {plan.cta}
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function FaqSection({ locale, items }: { locale: Locale; items: { q: string; a: string }[] }) {
  return (
    <section id="faq" className="border-t border-border bg-muted/30 py-20">
      <div className="container-page max-w-3xl">
        <SectionHeading
          title={locale === "fa" ? "سوالات متداول" : "Frequently asked questions"}
        />
        <div className="mt-10 space-y-3">
          {items.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border border-border bg-card px-5 py-4 transition open:shadow-md"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-medium">
                {item.q}
                <span className="text-muted-foreground transition group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CallToAction({ locale, t, bookingSlug }: { locale: Locale; t: Dictionary; bookingSlug: string }) {
  return (
    <section className="container-page py-20">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-10 text-center">
        <div className="grid-bg pointer-events-none absolute inset-0 -z-10 opacity-60" aria-hidden />
        <h2 className="text-balance text-2xl font-bold sm:text-3xl">{t.hero.ctaPrimary}</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{t.hero.subtitle}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href={`/${locale}/${bookingSlug}`}>{t.nav.book}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`/${locale}/register`}>{t.nav.register}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function Testimonials({ locale, items }: { locale: Locale; items: { name: string; role: string; body: string }[] }) {
  return (
    <section className="container-page py-20">
      <SectionHeading
        title={locale === "fa" ? "نظر کسب‌وکارها" : "Trusted by modern businesses"}
        subtitle={
          locale === "fa"
            ? "از کلینیک و آرایشگاه تا مشاور و مدرس"
            : "From clinics and salons to consultants and coaches"
        }
      />
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {items.map((item) => (
          <Card key={item.name} padding="lg" hover="lift">
            <p className="text-sm leading-relaxed text-foreground/85">«{item.body}»</p>
            <div className="mt-5 flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {item.name.slice(0, 1)}
              </span>
              <div>
                <p className="text-sm font-semibold">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.role}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
