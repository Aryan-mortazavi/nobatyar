import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class merge (the `cn` used across the whole app). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** URL/anchor friendly slug that keeps Persian letters intact. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s‌]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/** Human friendly appointment reference: APT-7K2QX */
export function trackingCode(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    out += alphabet[Math.floor(random() * alphabet.length)];
  }
  return `APT-${out}`;
}

/** 0-padded minutes → "09:30" (24h, no AM/PM anywhere in the product). */
export function minutesToHHMM(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:30" → 570 */
export function hhmmToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd) */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Money formatting.
 *
 * Prices are informational, but they must stay unambiguous: Iranian businesses
 * quote تومان (IRT) while Intl's "IRR" is ریال — a 10× difference. So the number
 * is formatted with grouping and the *configured* unit is appended, instead of
 * silently mixing the two.
 */
const NATIVE_CURRENCIES = new Set(["USD", "EUR", "AED", "TRY", "GBP", "SAR"]);

const PERSIAN_UNITS: Record<string, string> = {
  IRT: "تومان",
  IRR: "ریال",
};

export function formatMoney(amount: number, locale: string, currency: string): string {
  const fa = locale === "fa";
  const code = currency.toUpperCase();

  if (fa) {
    const number = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(amount);
    return `${number} ${PERSIAN_UNITS[code] ?? code}`;
  }

  if (NATIVE_CURRENCIES.has(code)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)} ${code}`;
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(numberLocale(locale)).format(value);
}

function numberLocale(locale: string) {
  return locale === "fa" ? "fa-IR" : "en-US";
}

export function relativeDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Initials for the avatar fallback: "مهدی کریمی" → "م ک" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]} ${parts[parts.length - 1][0]}`;
}

/** Deterministic pastel colour for avatars / service chips. */
export function colorFromString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 360;
  }
  return `hsl(${hash} 72% 55%)`;
}
