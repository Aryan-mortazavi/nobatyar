import { describe, expect, it } from "vitest";

import {
  addDays,
  calendarForLocale,
  civilOf,
  civilToDateKey,
  civilWeekday,
  formatDate,
  formatTime,
  fromJalali,
  isValidJalali,
  jalaliDaysInMonth,
  monthName,
  timeZoneOffsetMs,
  toJalali,
  weekdayLabels,
  zonedMinuteToUtc,
  zonedParts,
  type CivilDate,
} from "@/lib/dates";

const TZ = "Asia/Tehran";
const MIN = 60_000;

describe("Jalali conversion", () => {
  it("converts known dates", () => {
    // reference points from the official Jalali calendar
    expect(toJalali({ year: 2026, month: 9, day: 21 })).toEqual({
      year: 1405,
      month: 6,
      day: 30,
    });
    // Nowruz 1405 = 2026-03-21
    expect(toJalali({ year: 2026, month: 3, day: 21 })).toEqual({
      year: 1405,
      month: 1,
      day: 1,
    });
    expect(toJalali({ year: 2026, month: 3, day: 20 })).toEqual({
      year: 1404,
      month: 12,
      day: 29, // 1404 is not a leap year
    });
    expect(fromJalali({ year: 1405, month: 7, day: 1 })).toEqual({
      year: 2026,
      month: 9,
      day: 23,
    });
    // leap Esfand 1403 has 30 days → 2025-03-20
    expect(fromJalali({ year: 1403, month: 12, day: 30 })).toEqual({
      year: 2025,
      month: 3,
      day: 20,
    });
  });

  it("round-trips 400 years of dates", () => {
    let cursor: CivilDate = { year: 1900, month: 1, day: 1 };
    for (let i = 0; i < 400 * 365 + 97; i += 1) {
      const jalali = toJalali(cursor);
      const back = fromJalali(jalali);
      expect(back).toEqual(cursor);
      if (!isValidJalali(jalali.year, jalali.month, jalali.day)) {
        throw new Error(`invalid Jalali date produced: ${JSON.stringify(jalali)}`);
      }
      cursor = addDays(cursor, 1);
    }
  });

  it("knows month lengths including leap Esfand", () => {
    expect(jalaliDaysInMonth(1405, 1)).toBe(31);
    expect(jalaliDaysInMonth(1405, 7)).toBe(30);
    expect(jalaliDaysInMonth(1405, 12)).toBe(29); // 1405 is not a leap year
    expect(jalaliDaysInMonth(1404, 12)).toBe(29);
    expect(jalaliDaysInMonth(1403, 12)).toBe(30); // 1403 is a leap year
  });

  it("validates Jalali input", () => {
    expect(isValidJalali(1405, 7, 30)).toBe(true);
    expect(isValidJalali(1405, 13, 1)).toBe(false);
    expect(isValidJalali(1405, 7, 0)).toBe(false);
    expect(isValidJalali(1405, 12, 30)).toBe(false);
    expect(isValidJalali(1403, 12, 30)).toBe(true);
  });
});

describe("timezone helpers", () => {
  it("applies the Tehran offset (+03:30)", () => {
    const instant = new Date("2026-09-27T06:00:00.000Z");
    expect(timeZoneOffsetMs(instant, TZ)).toBe(3.5 * 60 * MIN);
    const parts = zonedParts(instant, TZ);
    expect(parts).toMatchObject({ year: 2026, month: 9, day: 27, hour: 9, minute: 30 });
  });

  it("round-trips a local time to UTC", () => {
    const utc = zonedMinuteToUtc({ year: 2026, month: 9, day: 27 }, 9 * 60, TZ);
    expect(utc.toISOString()).toBe("2026-09-27T05:30:00.000Z");
    expect(civilOf(utc, TZ)).toEqual({ year: 2026, month: 9, day: 27 });
  });

  it("handles midnight without drifting a day", () => {
    const midnight = zonedMinuteToUtc({ year: 2026, month: 9, day: 27 }, 0, TZ);
    expect(midnight.toISOString()).toBe("2026-09-26T20:30:00.000Z");
    const endOfDay = zonedMinuteToUtc({ year: 2026, month: 9, day: 27 }, 24 * 60, TZ);
    expect(endOfDay.getTime() - midnight.getTime()).toBe(24 * 60 * MIN);
  });

  it("maps 0 = Sunday correctly", () => {
    expect(civilWeekday({ year: 2026, month: 9, day: 27 })).toBe(0); // Sunday
    expect(civilWeekday({ year: 2026, month: 10, day: 2 })).toBe(5); // Friday
  });
});

describe("formatting", () => {
  it("formats Persian with the Jalali calendar and Persian digits", () => {
    const date = new Date("2026-09-27T05:30:00.000Z");
    const text = formatDate(date, "fa", TZ, { dateStyle: "long" });
    expect(text).toContain("۱۴۰۵");
  });

  it("formats English with the Gregorian calendar", () => {
    const date = new Date("2026-09-27T05:30:00.000Z");
    const text = formatDate(date, "en", TZ, { dateStyle: "long" });
    expect(text).toContain("2026");
    expect(text).not.toContain("۱۴۰۵");
  });

  it("always renders 24-hour times", () => {
    const afternoon = new Date("2026-09-27T14:05:00.000Z");
    expect(formatTime(afternoon, "en", TZ)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatTime(afternoon, "fa", TZ)).not.toMatch(/[AP]M/i);
  });

  it("picks the calendar per locale", () => {
    expect(calendarForLocale("fa")).toBe("persian");
    expect(calendarForLocale("en")).toBe("gregory");
  });

  it("labels months in the right calendar", () => {
    const jalali = toJalali({ year: 2026, month: 9, day: 27 });
    expect(monthName({ ...jalali, day: 1 }, "fa")).toContain("مهر");
    expect(monthName({ ...jalali, day: 1 }, "en")).toContain("September");
  });

  it("orders weekday labels from the week start", () => {
    const persian = weekdayLabels("fa", 6);
    const english = weekdayLabels("en", 1);
    expect(persian).toHaveLength(7);
    expect(persian[0]).toContain("شنبه");
    expect(english[0]).toContain("Mon");
  });
});

describe("civil helpers", () => {
  it("builds and parses date keys", () => {
    expect(civilToDateKey({ year: 2026, month: 9, day: 7 })).toBe("2026-09-07");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays({ year: 2026, month: 9, day: 30 }, 1)).toEqual({
      year: 2026,
      month: 10,
      day: 1,
    });
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });
});
