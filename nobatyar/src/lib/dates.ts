/**
 * Civil (calendar) date helpers.
 *
 * The product stores every instant in UTC and renders it in the workspace
 * timezone; the Jalali ⇄ Gregorian conversion is a pure numeric algorithm so
 * the booking engine and the tests never depend on the server locale.
 */

export type CivilDate = { year: number; month: number; day: number };

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;

// Jalali calendar correction table (the classic jalaali-js breaks).
const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192,
  2262, 2324, 2394, 2456, 3178,
];

type JalCal = { leap: number; gy: number; march: number };

function jalCal(jy: number, withoutLeap = false): JalCal {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;

  if (jy < jp || jy >= BREAKS[BREAKS.length - 1]) {
    throw new RangeError(`Jalali year out of range: ${jy}`);
  }

  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (withoutLeap) return { leap: 0, gy, march };

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + div(gm - 8, 6) + 100100, 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): CivilDate {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { year: gy, month: gm, day: gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): CivilDate {
  const gy = d2g(jdn).year;
  let jy = gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { year: jy, month: 1 + div(k, 31), day: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { year: jy, month: 7 + div(k, 30), day: mod(k, 30) + 1 };
}

/** Gregorian → Jalali. 2026-09-28 → 1405/07/06 */
export function toJalali(civil: CivilDate): CivilDate {
  return d2j(g2d(civil.year, civil.month, civil.day));
}

/** Jalali → Gregorian. 1405/07/06 → 2026-09-28 */
export function fromJalali(jalali: CivilDate): CivilDate {
  return d2g(j2d(jalali.year, jalali.month, jalali.day));
}

export function isJalaliLeapYear(jy: number): boolean {
  return jalCal(jy, false).leap === 0;
}

/** 1..12 with Esfand = 12. */
export function jalaliDaysInMonth(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeapYear(jy) ? 30 : 29;
}

export function isValidJalali(jy: number, jm: number, jd: number): boolean {
  if (jm < 1 || jm > 12) return false;
  if (jd < 1) return false;
  return jd <= jalaliDaysInMonth(jy, jm);
}

// ── Timezone aware civil conversions ───────────────────────────────────────

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock offset of `timeZone` at `date`, in milliseconds. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(date);
  const lookup: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = Number(part.value);
  }
  const asUTC = Date.UTC(
    lookup.year,
    lookup.month - 1,
    lookup.day,
    lookup.hour,
    lookup.minute,
    lookup.second,
  );
  return asUTC - date.getTime();
}

export type ZonedParts = CivilDate & { hour: number; minute: number };

/** The civil date/time an instant shows in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const lookup: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = Number(part.value);
  }
  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour: lookup.hour,
    minute: lookup.minute,
  };
}

export function civilOf(date: Date, timeZone: string): CivilDate {
  const { year, month, day } = zonedParts(date, timeZone);
  return { year, month, day };
}

/**
 * UTC instant of "day X, minute-of-day M" in `timeZone`.
 * Two passes so DST transitions land on the correct side of the gap.
 */
export function zonedMinuteToUtc(civil: CivilDate, minuteOfDay: number, timeZone: string): Date {
  const naive = Date.UTC(civil.year, civil.month - 1, civil.day, 0, 0, 0) + minuteOfDay * 60_000;
  const firstGuess = naive - timeZoneOffsetMs(new Date(naive), timeZone);
  const secondOffset = timeZoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(secondOffset === timeZoneOffsetMs(new Date(naive), timeZone) ? firstGuess : naive - secondOffset);
}

/** 0 = Sunday … 6 = Saturday for a civil date. */
export function civilWeekday(civil: CivilDate): number {
  return new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).getUTCDay();
}

export function addDays(civil: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function civilToDateKey(civil: CivilDate): string {
  return `${civil.year}-${String(civil.month).padStart(2, "0")}-${String(civil.day).padStart(2, "0")}`;
}

export function parseDateKey(key: string): CivilDate {
  const [y, m, d] = key.split("-").map(Number);
  return { year: y, month: m, day: d };
}

// ── Presentation ───────────────────────────────────────────────────────────

export type CalendarSystem = "gregory" | "persian";

/** Display calendar for a locale: Persian users see Jalali, everyone else Gregorian. */
export function calendarForLocale(locale: string): CalendarSystem {
  return locale === "fa" ? "persian" : "gregory";
}

export function formatDate(
  date: Date,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const calendar = calendarForLocale(locale);
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    calendar,
    timeZone,
    ...options,
  }).format(date);
}

export function formatTime(date: Date, locale: string, timeZone: string): string {
  return formatDate(date, locale, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function formatDateTime(date: Date, locale: string, timeZone: string): string {
  return `${formatDate(date, locale, timeZone)} · ${formatTime(date, locale, timeZone)}`;
}

/** Weekday labels honour the workspace's week start (6 = Saturday in Iran). */
export function weekdayLabels(locale: string, weekStart = 6, count = 7): string[] {
  const formatter = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    weekday: "short",
    calendar: calendarForLocale(locale),
    timeZone: "UTC",
  });
  // 2024-01-07 was a Sunday → reference point for index 0
  const base = Date.UTC(2024, 0, 7);
  return Array.from({ length: count }, (_, i) =>
    formatter.format(new Date(base + ((weekStart + i) % 7) * 86_400_000)),
  );
}

/**
 * Localised month name for a **Jalali** civil date.
 * The same day is rendered in the reader's calendar: "مهر ۱۴۰۵" / "September 2026".
 */
export function monthName(jalali: CivilDate, locale: string): string {
  const gregorian = fromJalali(jalali);
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    month: "long",
    year: "numeric",
    calendar: calendarForLocale(locale),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day)));
}

export function isSameCivil(a: CivilDate, b: CivilDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function compareCivil(a: CivilDate, b: CivilDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}
