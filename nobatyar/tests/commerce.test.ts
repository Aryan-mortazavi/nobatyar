import { describe, expect, it } from "vitest";

import { minuteOfDay, planSeries } from "@/lib/recurrence-plan";
import {
  isPurchaseUsable,
  remainingFor,
  remainingForService,
  remainingTotal,
  totalSessionsOf,
  type PurchaseWithPackage,
} from "@/lib/packages-plan";
import { fitsInDay } from "@/lib/availability";
import { civilOf, zonedMinuteToUtc, type CivilDate } from "@/lib/dates";

const TEHRAN = "Asia/Tehran";

describe("planSeries", () => {
  const firstDay: CivilDate = { year: 2026, month: 10, day: 1 };

  it("keeps the same local time of day across the series", () => {
    const start = zonedMinuteToUtc(firstDay, 9 * 60 + 30, TEHRAN).getTime();
    const { starts } = planSeries({
      firstDay,
      minuteOfDay: minuteOfDay(start, firstDay, TEHRAN),
      count: 4,
      intervalDays: 7,
      timeZone: TEHRAN,
    });

    expect(starts).toHaveLength(4);
    for (const value of starts) {
      // every occurrence sits at 09:30 *local* time, on its own day
      expect(minuteOfDay(value, civilOf(new Date(value), TEHRAN), TEHRAN)).toBe(9 * 60 + 30);
    }
    // exactly one week apart
    expect(starts[1]! - starts[0]!).toBe(7 * 24 * 60 * 60_000);
    expect(starts[3]! - starts[0]!).toBe(21 * 24 * 60 * 60_000);
  });

  it("crosses the Jalali month boundary without shifting the time", () => {
    // 1405/07/09 → weekly jumps land in Shahrivar and Mehr
    const start = zonedMinuteToUtc({ year: 2026, month: 9, day: 28 }, 20 * 60, TEHRAN).getTime();
    const { starts } = planSeries({
      firstDay: { year: 2026, month: 9, day: 28 },
      minuteOfDay: minuteOfDay(start, { year: 2026, month: 9, day: 28 }, TEHRAN),
      count: 3,
      intervalDays: 7,
      timeZone: TEHRAN,
    });
    const labels = starts.map((value) => new Date(value).toISOString());
    expect(labels).toEqual([
      "2026-09-28T16:30:00.000Z", // 20:00 Tehran
      "2026-10-05T16:30:00.000Z",
      "2026-10-12T16:30:00.000Z",
    ]);
  });

  it("supports other intervals and clamps nonsense input", () => {
    const { starts } = planSeries({
      firstDay: { year: 2026, month: 1, day: 10 },
      minuteOfDay: 600,
      count: 3,
      intervalDays: 14,
      timeZone: TEHRAN,
    });
    expect(starts).toHaveLength(3);
    expect(starts[2]! - starts[0]!).toBe(28 * 24 * 60 * 60_000);

    const clamped = planSeries({
      firstDay: { year: 2026, month: 1, day: 10 },
      minuteOfDay: 600,
      count: 0,
      intervalDays: 0,
      timeZone: TEHRAN,
    });
    expect(clamped.starts).toHaveLength(1);
  });
});

describe("package sessions", () => {
  it("sums the quantities of its lines", () => {
    expect(
      totalSessionsOf({ services: [{ quantity: 2 }, { quantity: 3 }, { quantity: 1 }] }),
    ).toBe(6);
    expect(totalSessionsOf({ services: [] })).toBe(0);
  });

  it("keeps a per-service quota, not a shared pool", () => {
    const purchase: PurchaseWithPackage = {
      id: "p1",
      totalSessions: 5,
      usedSessions: 2,
      status: "ACTIVE",
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      usedByService: { facial: 2 },
      package: {
        id: "pkg",
        name: "Skin starter",
        nameFa: null,
        services: [
          {
            serviceId: "facial",
            quantity: 2,
            service: { name: "Facial", nameFa: null },
          },
          {
            serviceId: "laser",
            quantity: 3,
            service: { name: "Laser", nameFa: null },
          },
        ],
      },
    };

    // both facials are used up …
    expect(remainingFor(purchase, "facial")).toBe(0);
    // … but the three laser sessions are untouched
    expect(remainingFor(purchase, "laser")).toBe(3);
    // a service outside the package is never free
    expect(remainingFor(purchase, "unknown")).toBe(0);
    expect(remainingTotal(purchase)).toBe(3);
  });

  it("never returns a negative number of sessions", () => {
    expect(remainingForService({ quantity: 2 }, 5)).toBe(0);
    expect(remainingForService(undefined, 0)).toBe(0);
    expect(remainingTotal({ totalSessions: 2, usedSessions: 4 })).toBe(0);
  });

  it("only treats active, unexpired purchases as usable", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(
      isPurchaseUsable({ status: "ACTIVE", expiresAt: new Date("2026-07-01T00:00:00Z") }, now),
    ).toBe(true);
    expect(
      isPurchaseUsable({ status: "ACTIVE", expiresAt: new Date("2026-05-01T00:00:00Z") }, now),
    ).toBe(false);
    expect(
      isPurchaseUsable({ status: "CANCELLED", expiresAt: new Date("2026-07-01T00:00:00Z") }, now),
    ).toBe(false);
  });
});

describe("day containment", () => {
  const dayStart = zonedMinuteToUtc({ year: 2026, month: 10, day: 1 }, 0, TEHRAN).getTime();
  const dayEnd = zonedMinuteToUtc({ year: 2026, month: 10, day: 1 }, 24 * 60, TEHRAN).getTime();
  const at = (hour: number, minute = 0) =>
    zonedMinuteToUtc({ year: 2026, month: 10, day: 1 }, hour * 60 + minute, TEHRAN).getTime();

  it("accepts a normal appointment inside the day", () => {
    // this is the regression: an intersection test rejected every slot
    expect(fitsInDay(at(9, 30), at(10, 30), dayStart, dayEnd)).toBe(true);
  });

  it("refuses an appointment that would run past midnight", () => {
    expect(fitsInDay(at(23, 30), at(24, 30), dayStart, dayEnd)).toBe(false);
  });

  it("refuses an appointment that starts before the day", () => {
    expect(fitsInDay(dayStart - 60_000, at(1), dayStart, dayEnd)).toBe(false);
  });

  it("accepts an appointment that ends exactly at midnight", () => {
    expect(fitsInDay(at(23), dayEnd, dayStart, dayEnd)).toBe(true);
  });
});
