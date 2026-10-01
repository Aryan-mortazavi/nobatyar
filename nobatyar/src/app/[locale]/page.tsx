import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Star } from "lucide-react";

import {
  FaqSection,
  Features,
  Hero,
  HowItWorks,
  PricingPreview,
  Testimonials,
} from "@/components/marketing/sections";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n";
import { getStats, getUpcomingAppointments, getWorkspace } from "@/lib/queries";
import { formatDate, formatTime } from "@/lib/dates";
import { STATUS_TONE } from "@/lib/domain";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return { title: t.brand.name, description: t.meta.description };
}

const PRICING = {
  fa: {
    cta: "شروع کنید",
    plans: [
      {
        name: "شروع",
        price: 0,
        currency: "IRR",
        features: ["یک کارشناس", "تا ۵۰ نوبت در ماه", "تقویم شمسی", "پیام یادآوری درون‌برنامه‌ای"],
        cta: "رایگان بسازید",
      },
      {
        name: "حرفه‌ای",
        price: 1_900_000,
        currency: "IRR",
        features: [
          "نامحدود کارشناس",
          "نوبت نامحدود",
          "یادآوری ایمیل و تلگرام",
          "گزارش‌ها و نمودارها",
          "لیست انتظار خودکار",
        ],
        featured: true,
        cta: "انتخاب حرفه‌ای",
      },
      {
        name: "سازمانی",
        price: 5_900_000,
        currency: "IRR",
        features: ["چند شعبه", "نقش‌های پیشرفته", "API و وب‌هوک", "پشتیبانی اختصاصی"],
        cta: "تماس با ما",
      },
    ],
  },
  en: {
    cta: "Get started",
    plans: [
      {
        name: "Starter",
        price: 0,
        currency: "USD",
        features: ["1 team member", "50 bookings / month", "Jalali calendar", "In-app reminders"],
        cta: "Start free",
      },
      {
        name: "Professional",
        price: 39,
        currency: "USD",
        features: [
          "Unlimited team",
          "Unlimited bookings",
          "Email & Telegram reminders",
          "Reports and charts",
          "Automatic waitlist",
        ],
        featured: true,
        cta: "Choose Professional",
      },
      {
        name: "Business",
        price: 129,
        currency: "USD",
        features: ["Multi-location", "Advanced roles", "API & webhooks", "Priority support"],
        cta: "Contact us",
      },
    ],
  },
} as const;

const TESTIMONIALS = {
  fa: [
    {
      name: "دکتر نگار موسوی",
      role: "مدیر مرکز آریا",
      body: "قبلاً هر روز سه ساعت را صرف هماهنگی تلفنی می‌کردم. حالا مشتری خودش بازه را انتخاب می‌کند و نرخ عدم حضورمان نصف شده است.",
    },
    {
      name: "سامان یزدانی",
      role: "مدرس و مشاور",
      body: "تقویم شمسی و یادآور خودکار دقیقاً همان چیزی بود که لازم داشتم؛ مشتری‌های غیرقانونی‌ام تقریباً صفر شدند.",
    },
    {
      name: "مریم رحیمی",
      role: "مدیر سالن زیبایی",
      body: "پنل مدیریت و گزارش‌های هفتگی کمک می‌کند ظرفیت هر کارشناس را دقیق برنامه‌ریزی کنم.",
    },
  ],
  en: [
    {
      name: "Dr. Negar Mousavi",
      role: "Clinic director",
      body: "I used to spend three hours a day coordinating by phone. Customers now pick their own slot and our no-show rate dropped by half.",
    },
    {
      name: "Saman Yazdani",
      role: "Coach & consultant",
      body: "The Jalali calendar plus automatic reminders was exactly what I needed — late cancellations are almost gone.",
    },
    {
      name: "Maryam Rahimi",
      role: "Salon owner",
      body: "The dashboard and weekly reports let me schedule every specialist with real capacity numbers.",
    },
  ],
} as const;

const FAQ = {
  fa: [
    {
      q: "آیا برای رزرو نیازی به ساخت حساب کاربری هست؟",
      a: "خیر. مشتری می‌تواند بدون ورود، در کمتر از یک دقیقه نوبت بگیرد و کد رهگیری دریافت کند. ساخت حساب فقط برای مدیریت نوبت‌های قبلی مفید است.",
    },
    {
      q: "اگر دو نفر هم‌زمان یک بازه را انتخاب کنند چه می‌شود؟",
      a: "تنها یک رزرو ثبت می‌شود؛ محدودیت یکتای پایگاه‌داده در سطح سرور تضمین می‌کند بازه دوباره فروخته نشود و نفر دوم پیام «این بازه رزرو شد» می‌گیرد.",
    },
    {
      q: "تقویم چگونه تعطیلی و مرخصی را لحاظ می‌کند؟",
      a: "تعطیلات رسمی، زمان‌های غیبت کارشناس، ساعات کاری هفتگی و فاصله‌های پاکسازی بین نوبت‌ها همگی به‌صورت خودکار از تقویم حذف می‌شوند.",
    },
    {
      q: "آیا اطلاعات کسب‌وکار من قابل برندینگ است؟",
      a: "بله؛ نام، شعار، رنگ اصلی، منطقه زمانی و واحد پول از پنل تنظیمات قابل تغییر است.",
    },
  ],
  en: [
    {
      q: "Do customers need an account to book?",
      a: "No. A customer books in under a minute without signing up and receives a tracking code. An account is only useful to manage past appointments.",
    },
    {
      q: "What if two people pick the same slot at the same time?",
      a: "Only one booking is written — a database-level unique constraint makes double selling impossible and the second customer gets a clear 'slot taken' message.",
    },
    {
      q: "How are holidays and time off handled?",
      a: "Public holidays, specialist time off, weekly schedules and the cleanup buffers between appointments are all subtracted from the calendar automatically.",
    },
    {
      q: "Can I brand it for my business?",
      a: "Yes: name, tagline, accent colour, timezone and currency are all configurable from the settings page.",
    },
  ],
} as const;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const workspace = await getWorkspace();
  const [stats, upcoming] = await Promise.all([
    getStats(),
    getUpcomingAppointments(workspace.id, 3).catch(() => []),
  ]);

  const copy = typed === "fa" ? PRICING.fa : PRICING.en;
  const testimonials: { name: string; role: string; body: string }[] = [
    ...(typed === "fa" ? TESTIMONIALS.fa : TESTIMONIALS.en),
  ];
  const faq: { q: string; a: string }[] = [...(typed === "fa" ? FAQ.fa : FAQ.en)];
  const plans = copy.plans.map((plan) => ({
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    features: [...plan.features],
    cta: plan.cta,
    featured: "featured" in plan ? plan.featured : false,
  }));
  const Arrow = typed === "fa" ? ArrowLeft : ArrowRight;

  return (
    <>
      <Hero
        locale={typed}
        t={t}
        stats={stats}
        bookingSlug={workspace.bookingPageSlug ?? "book"}
        accentColor={workspace.accentColor}
      />

      {upcoming.length > 0 ? (
        <section className="container-page pb-4">
          <Card padding="lg" className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                {t.dashboard.overview.upcomingTitle}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {typed === "fa"
                  ? "زنده از دیتابیس — نمونه‌ای از نوبت‌های ثبت‌شده"
                  : "Live from the database — a sample of real bookings"}
              </p>
            </div>
            <ul className="grid flex-1 gap-3 sm:grid-cols-3">
              {upcoming.map((appointment) => (
                <li key={appointment.id} className="rounded-xl border border-border bg-background/60 p-3">
                  <p className="truncate text-sm font-medium">{appointment.customerName}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {typed === "fa" ? appointment.service.nameFa : appointment.service.name}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {formatDate(appointment.startsAt, typed, workspace.timezone, { dateStyle: "medium" })}{" "}
                    {formatTime(appointment.startsAt, typed, workspace.timezone)}
                  </p>
                  <span
                    className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[appointment.status as keyof typeof STATUS_TONE]}`}
                  >
                    {t.status[appointment.status as keyof typeof t.status]}
                  </span>
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="shrink-0">
              <Link href={`/${typed}/book`}>
                {t.hero.ctaPrimary}
                <Arrow aria-hidden />
              </Link>
            </Button>
          </Card>
        </section>
      ) : null}

      <Features locale={typed} t={t} />
      <HowItWorks locale={typed} t={t} />
      <Testimonials locale={typed} items={testimonials} />
      <PricingPreview locale={typed} plans={plans} />
      <FaqSection locale={typed} items={faq} />

      <section className="container-page pb-20">
        <Card padding="lg" className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <span className="grid size-12 place-items-center rounded-2xl bg-warning/15 text-warning">
              <Star className="size-6" aria-hidden />
            </span>
            <div>
              <p className="font-semibold">{typed === "fa" ? "امتیاز کاربران" : "Customer rating"}</p>
              <p className="text-sm text-muted-foreground">
                {typed === "fa" ? "۴٫۹ از ۵ بر اساس ۲۴۰ نظر" : "4.9 / 5 from 240 reviews"}
              </p>
            </div>
          </div>
          <Button asChild size="lg">
            <Link href={`/${typed}/book`}>
              {t.nav.book}
              <Arrow aria-hidden />
            </Link>
          </Button>
        </Card>
      </section>
    </>
  );
}
