import { notFound } from "next/navigation";

import { getDictionary } from "@/lib/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n";

const FAQ = {
  fa: [
    {
      q: "برای رزرو نوبت چه چیزی لازم است؟",
      a: "فقط انتخاب خدمت، کارشناس، تاریخ و ساعت. هیچ رمز عبور یا ثبت‌نامی لازم نیست؛ در پایان یک کد رهگیری دریافت می‌کنید.",
    },
    {
      q: "تقویم چه زمان‌هایی را نشان می‌دهد؟",
      a: "فقط بازه‌هایی که واقعاً آزاد هستند: ساعات کاری هر کارشناس، بدون فاصله‌های استراحت، روزهای تعطیل، زمان‌های غیبت و نوبت‌های رزروشده کنار گذاشته می‌شوند.",
    },
    {
      q: "می‌توانم نوبت را جابه‌جا یا لغو کنم؟",
      a: "بله. از بخش «نوبت‌های من» با کد رهگیری، لغو با رعایت مهلت تعیین‌شده توسط کسب‌وکار انجام می‌شود و بازه آزادشده به لیست انتظار اطلاع داده می‌شود.",
    },
    {
      q: "یادآوری چگونه ارسال می‌شود؟",
      a: "یادآوری ۲۴ ساعت و ۱ ساعت پیش از نوبت، و پیام تأیید بلافاصله پس از رزرو. کانال‌های ایمیل و تلگرام در دسترس‌اند.",
    },
    {
      q: "اطلاعات من چطور محافظت می‌شود؟",
      a: "گذرواژه‌ها با bcrypt هش می‌شوند، نشست‌ها امضا‌شده و فقط در کوکی httpOnly نگهداری می‌شوند، همه ورودی‌ها سمت سرور اعتبارسنجی می‌شوند و رخدادهای حساس ثبت (audit) می‌شوند.",
    },
  ],
  en: [
    {
      q: "What do I need to book?",
      a: "Just pick a service, a specialist, a date and a time. No password or sign-up is required — you receive a tracking code at the end.",
    },
    {
      q: "Which times does the calendar show?",
      a: "Only genuinely free slots: each specialist's schedule, minus breaks, holidays, time off and existing bookings.",
    },
    {
      q: "Can I reschedule or cancel?",
      a: "Yes. From your appointments section, using the tracking code. The freed slot is offered to the waitlist automatically.",
    },
    {
      q: "How are reminders sent?",
      a: "A confirmation right after booking, plus reminders 24 hours and 1 hour before the appointment, over email (Telegram available).",
    },
    {
      q: "How is my data protected?",
      a: "Passwords are bcrypt-hashed, sessions are signed and kept in an httpOnly cookie, every input is validated server-side and sensitive events are written to an audit log.",
    },
  ],
} as const;

export default async function FaqPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  return (
    <div className="container-page max-w-3xl py-16">
      <h1 className="text-3xl font-bold tracking-tight">{t.nav.faq}</h1>
      <div className="mt-10 space-y-3">
        {FAQ[typed].map((item) => (
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
  );
}
