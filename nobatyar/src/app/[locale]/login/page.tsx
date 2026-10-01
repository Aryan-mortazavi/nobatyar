import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).auth.loginTitle, robots: { index: false, follow: false } };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  return (
    <div className="container-page grid place-items-center py-16">
      <AuthForm
        mode="login"
        locale={typed}
        t={t}
        {...(query.next ? { next: query.next } : {})}
        demo={{ email: "owner@nobatyar.app", password: "Nobat#2026" }}
      />
    </div>
  );
}
