import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionHeading } from "@/components/marketing/sections";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n";
import { formatMoney } from "@/lib/utils";
import { Check } from "lucide-react";

type Plan = {
  name: string;
  price: number;
  features: string[];
  featured?: boolean;
};

const PLANS: Record<Locale, Plan[]> = {
  fa: [
    {
      name: "شروع",
      price: 0,
      features: ["یک کارشناس", "تا ۵۰ نوبت در ماه", "تقویم شمسی", "لینک و کد QR", "یادآوری درون‌برنامه‌ای"],
    },
    {
      name: "حرفه‌ای",
      price: 1_900_000,
      features: [
        "نامحدود کارشناس و خدمت",
        "نوبت نامحدود",
        "یادآوری ایمیل و تلگرام",
        "گزارش‌ها و نمودارهای تحلیلی",
        "لیست انتظار خودکار",
        "مدیریت چند کاربر با نقش‌های مختلف",
      ],
      featured: true,
    },
    {
      name: "سازمانی",
      price: 5_900_000,
      features: ["چند شعبه", "نقش‌های پیشرفته و سیاست‌ها", "API و وب‌هوک", "SSO / SAML", "پشتیبانی اختصاصی"],
    },
  ],
  en: [
    {
      name: "Starter",
      price: 0,
      features: ["1 team member", "50 bookings / month", "Jalali calendar", "Link & QR codes", "In-app reminders"],
    },
    {
      name: "Professional",
      price: 39,
      features: [
        "Unlimited team & services",
        "Unlimited bookings",
        "Email & Telegram reminders",
        "Analytics and reports",
        "Automatic waitlist",
        "Role-based team access",
      ],
      featured: true,
    },
    {
      name: "Business",
      price: 129,
      features: ["Multi-location", "Advanced roles and policies", "API & webhooks", "SSO / SAML", "Priority support"],
    },
  ],
};

const FAQ: Record<Locale, { q: string; a: string }[]> = {
  fa: [
    {
      q: "آیا مشتری باید حساب کاربری بسازد؟",
      a: "خیر. رزرو با لینک یا کد QR بدون ورود انجام می‌شود و مشتری کد رهگیری می‌گیرد. ساخت حساب فقط برای پیگیری نوبت‌های قبلی لازم است.",
    },
    {
      q: "اگر دو نفر هم‌زمان یک بازه را انتخاب کنند چه می‌شود؟",
      a: "فقط یک رزرو ثبت می‌شود. محدودیت یکتای پایگاه‌داده در دو لایه (بررسی داخل تراکنش + ایندکس یکتا) تضمین می‌کند بازه دوباره فروخته نشود.",
    },
    {
      q: "کد QR برای چه استفاده‌ای است؟",
      a: "هر کد یک لینک رزرو را در خود دارد. می‌توانید کد اصلی را روی میز پذیرش چاپ کنید و برای هر خدمت یک کد جداگانه بسازید تا مشتری مستقیم وارد همان صفحه شود.",
    },
    {
      q: "آیا داده‌های من قابل انتقال است؟",
      a: "بله. تمام داده‌ها در پایگاه‌داده شماست و می‌توانید در هر لحظه خروجی بگیرید یا به سامانه دیگری مهاجرت دهید.",
    },
  ],
  en: [
    {
      q: "Do customers need an account?",
      a: "No. Booking works through the link or the QR code without signing up; the customer simply receives a tracking code.",
    },
    {
      q: "What happens if two people pick the same slot?",
      a: "Only one booking is written. A two-layer guard (in-transaction re-check plus a database unique index) makes double booking impossible.",
    },
    {
      q: "What is the QR code for?",
      a: "Each code embeds a booking URL. Print the main code at reception, and generate one per service so customers land straight on the right page.",
    },
    {
      q: "Can I take my data with me?",
      a: "Yes. All data lives in your own database and can be exported or migrated at any time.",
    },
  ],
};

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);
  const plans = PLANS[typed];
  const faq = FAQ[typed];

  return (
    <>
      <div className="container-page py-16">
        <SectionHeading
          title={t.nav.pricing}
          subtitle={
            typed === "fa"
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
              className={`flex flex-col ${plan.featured ? "ring-2 ring-primary/60" : ""}`}
            >
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-2 text-3xl font-bold tabular-nums">
                {plan.price === 0
                  ? typed === "fa"
                    ? "رایگان"
                    : "Free"
                  : formatMoney(plan.price, typed, typed === "fa" ? "IRR" : "USD")}
                {plan.price > 0 ? (
                  <span className="text-sm font-normal text-muted-foreground">
                    {typed === "fa" ? " / ماه" : " / month"}
                  </span>
                ) : null}
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-muted-foreground">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-6"
                block
                variant={plan.featured ? "primary" : "outline"}
                asChild
              >
                <Link href={`/${typed}/register`}>{typed === "fa" ? "شروع کنید" : "Get started"}</Link>
              </Button>
            </Card>
          ))}
        </div>
      </div>

      <div className="container-page max-w-3xl pb-20">
        <SectionHeading title={t.nav.faq} />
        <div className="mt-10 space-y-3">
          {faq.map((item) => (
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
    </>
  );
}
