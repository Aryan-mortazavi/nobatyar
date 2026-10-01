export const locales = ["fa", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fa";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}

export const localeMeta: Record<Locale, { label: string; htmlLang: string; flag: string }> = {
  fa: { label: "فارسی", htmlLang: "fa", flag: "🇮🇷" },
  en: { label: "English", htmlLang: "en", flag: "🇬🇧" },
};
