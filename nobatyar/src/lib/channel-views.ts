/**
 * Channel views: how the domain looks from the outside.
 *
 * Every channel (Telegram today) receives the same JSON shapes, so adding
 * WhatsApp later means writing a handler, not a serializer. Two rules:
 *
 *  1. Localisation is decided here, once. The app owns the translations, so a
 *     channel never ships its own copy of the business's wording.
 *  2. Every view carries a `webUrl` — every channel must be able to hand the
 *     customer over to the full web experience with one tap.
 */
import "server-only";

import { appUrl } from "./env";
import { formatDate, formatTime } from "./dates";
import { getDictionary, pick } from "./dictionaries";
import { isLocale, type Locale } from "./i18n";

export type ChannelLocale = Locale;

export function resolveLocale(input: string | null | undefined, fallback: string = "fa"): Locale {
  return isLocale(input ?? "") ? (input as Locale) : fallback === "en" ? "en" : "fa";
}

/** The five statuses the app knows, in the order channels should show them. */
export const CHANNEL_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export function isChannelStatus(value: string): value is ChannelStatus {
  return (CHANNEL_STATUSES as readonly string[]).includes(value);
}

function names(
  en: string,
  fa: string | null | undefined,
  locale: Locale,
): { en: string; fa: string; display: string } {
  return { en, fa: fa || en, display: pick(locale, en, fa) };
}

export function serviceView(
  row: {
    id: string;
    slug: string;
    name: string;
    nameFa: string | null;
    shortDesc: string | null;
    durationMin: number;
    priceAmount: number | null;
    color: string | null;
    staff: { staffId: string }[];
    category?: { slug: string; name: string; nameFa: string | null } | null;
  },
  locale: Locale,
) {
  const label = names(row.name, row.nameFa, locale);
  return {
    id: row.id,
    slug: row.slug,
    name: label.en,
    nameFa: label.fa,
    title: label.display,
    description: row.shortDesc,
    durationMin: row.durationMin,
    price: row.priceAmount,
    currency: "IRT",
    color: row.color,
    staffIds: row.staff.map((link) => link.staffId),
    category: row.category
      ? { slug: row.category.slug, title: pick(locale, row.category.name, row.category.nameFa) }
      : null,
    webUrl: `${appUrl}/${locale}/book?service=${row.id}`,
  };
}

export function staffView(
  row: {
    id: string;
    slug: string;
    name: string;
    title: string | null;
    bio: string | null;
    photoUrl: string | null;
    serviceIds: string[];
  },
  locale: Locale,
) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    title: row.title,
    bio: row.bio,
    photoUrl: row.photoUrl,
    serviceIds: row.serviceIds,
    webUrl: `${appUrl}/${locale}/staff/${row.slug}`,
  };
}

export function locationView(
  row: { id: string; slug: string; name: string; nameFa: string | null; address: string | null; phone: string | null },
  locale: Locale,
) {
  const label = names(row.name, row.nameFa, locale);
  return {
    id: row.id,
    slug: row.slug,
    name: label.en,
    nameFa: label.fa,
    title: label.display,
    address: row.address,
    phone: row.phone,
  };
}

export type AppointmentRow = {
  id: string;
  trackingCode: string;
  status: string;
  source: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone: string | null;
  notes: string | null;
  locationId: string | null;
  recurrenceGroupId: string | null;
  recurrenceIndex: number;
  packagePurchaseId: string | null;
  service: { name: string; nameFa: string | null; durationMin: number };
  staff: { name: string };
  location: { name: string; nameFa: string | null } | null;
};

export function appointmentView(row: AppointmentRow, locale: Locale, timeZone: string) {
  const t = getDictionary(locale);
  const service = pick(locale, row.service.name, row.service.nameFa);
  // NB: `dateStyle` cannot be combined with `weekday` in Intl.DateTimeFormat,
  // so the components are listed explicitly.
  const when = formatDate(row.startsAt, locale, timeZone, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = `${formatTime(row.startsAt, locale, timeZone)}–${formatTime(row.endsAt, locale, timeZone)}`;

  return {
    id: row.id,
    trackingCode: row.trackingCode,
    status: row.status,
    statusLabel: isChannelStatus(row.status) ? t.status[row.status] : row.status,
    source: row.source,
    isUpcoming: row.startsAt.getTime() > Date.now() && !["CANCELLED", "COMPLETED", "NO_SHOW"].includes(row.status),
    cancellable:
      row.startsAt.getTime() > Date.now() && ["PENDING", "CONFIRMED"].includes(row.status),
    service: { title: service, durationMin: row.service.durationMin },
    staff: { name: row.staff.name },
    location: row.location
      ? { id: row.locationId, title: pick(locale, row.location.name, row.location.nameFa) }
      : null,
    when: { date: when, time, startsAt: row.startsAt.toISOString() },
    series:
      row.recurrenceGroupId && row.recurrenceIndex > 0
        ? { index: row.recurrenceIndex + 1 }
        : null,
    usedPackageSession: Boolean(row.packagePurchaseId),
    notes: row.notes,
    webUrl: `${appUrl}/${locale}/my-appointments/${row.trackingCode}`,
  };
}

export function packageView(
  purchase: {
    id: string;
    totalSessions: number;
    usedSessions: number;
    expiresAt: Date;
    package: { name: string; nameFa: string | null };
  },
  locale: Locale,
) {
  return {
    id: purchase.id,
    name: pick(locale, purchase.package.name, purchase.package.nameFa),
    totalSessions: purchase.totalSessions,
    usedSessions: purchase.usedSessions,
    remainingSessions: Math.max(0, purchase.totalSessions - purchase.usedSessions),
    expiresAt: purchase.expiresAt.toISOString(),
  };
}

/** Small helper so every route answers with the same envelope. */
export function ok<T>(data: T, extra?: Record<string, unknown>) {
  return Response.json({ ok: true, ...extra, data } satisfies { ok: true } & Record<string, unknown> & { data: T });
}
