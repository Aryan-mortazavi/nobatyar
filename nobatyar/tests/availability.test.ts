import { describe, expect, it } from "vitest";

import {
  buildDayMap,
  firstFreeDay,
  generateSlots,
  isBookable,
  mergeSlots,
  summarizeDay,
  type SlotPlan,
  type WeeklyWindow,
} from "@/lib/availability";
import { addDays, zonedMinuteToUtc, type CivilDate } from "@/lib/dates";

const TZ = "Asia/Tehran";
const MIN = 60_000;

/** 2026-09-27 is a Sunday in Iran (weekday index 0). */
const SUNDAY: CivilDate = { year: 2026, month: 9, day: 27 };

// 09:00-17:00 every day except Friday (weekday 5), no breaks
const WINDOWS: WeeklyWindow[] = [0, 1, 2, 3, 4, 6].map((weekday) => ({
  weekday,
  startMinute: 540,
  endMinute: 1020,
}));

function plan(overrides: Partial<SlotPlan> = {}): SlotPlan {
  return {
    date: SUNDAY,
    timeZone: TZ,
    windows: WINDOWS,
    blocked: [],
    busy: [],
    durationMin: 30,
    stepMin: 15,
    // a "now" well before the day starts so nothing is filtered as past
    now: zonedMinuteToUtc(SUNDAY, 0, TZ).getTime(),
    ...overrides,
  };
}

describe("generateSlots", () => {
  it("produces every step inside the working window", () => {
    const slots = generateSlots(plan());
    // 09:00 .. 16:30 in 15-minute steps, 30-minute service
    expect(slots[0].label).toBe("09:00");
    expect(slots.at(-1)?.label).toBe("16:30");
    expect(slots).toHaveLength(31);
    expect(slots.every((slot) => slot.available)).toBe(true);
  });

  it("returns nothing on a closed weekday", () => {
    // Friday 2026-10-02
    expect(generateSlots(plan({ date: { year: 2026, month: 10, day: 2 } }))).toHaveLength(0);
  });

  it("removes slots that overlap an existing appointment", () => {
    const start = zonedMinuteToUtc(SUNDAY, 600, TZ).getTime(); // 10:00
    const slots = generateSlots(
      plan({ busy: [{ start, end: start + 30 * MIN }] }),
    );
    expect(slots.find((s) => s.label === "10:00")?.available).toBe(false);
    expect(slots.find((s) => s.label === "10:00")?.reason).toBe("busy");
    // a 30-minute service at 09:45 runs into 10:00 → also taken
    expect(slots.find((s) => s.label === "09:45")?.available).toBe(false);
    // half-open intervals: the first free slot starts when the booking ends
    expect(slots.find((s) => s.label === "10:30")?.available).toBe(true);
  });

  it("honours the cleanup buffer of an existing appointment", () => {
    const start = zonedMinuteToUtc(SUNDAY, 600, TZ).getTime(); // 10:00
    // the stored interval already includes the booked service's 15-min cleanup
    const slots = generateSlots(
      plan({ busy: [{ start, end: start + 30 * MIN + 15 * MIN }] }),
    );
    expect(slots.find((s) => s.label === "10:30")?.available).toBe(false);
    expect(slots.find((s) => s.label === "10:45")?.available).toBe(true);
  });

  it("reserves the new service's own buffer against other bookings", () => {
    const start = zonedMinuteToUtc(SUNDAY, 660, TZ).getTime(); // 11:00
    const slots = generateSlots(
      plan({
        durationMin: 45,
        bufferBeforeMin: 15,
        busy: [{ start, end: start + 30 * MIN }],
      }),
    );
    // a 45-min service at 10:30 would need 10:15-11:30 → collides with 11:00
    expect(slots.find((s) => s.label === "10:30")?.available).toBe(false);
    expect(slots.find((s) => s.label === "10:00")?.available).toBe(true);
  });

  it("never lets a service run past the closing time", () => {
    const slots = generateSlots(plan({ durationMin: 90 }));
    // last start such that start + 90min <= 17:00
    expect(slots.at(-1)?.label).toBe("15:30");
  });

  it("respects the minimum-notice rule", () => {
    const now = zonedMinuteToUtc(SUNDAY, 570, TZ).getTime(); // 09:30
    const slots = generateSlots(plan({ now, minNoticeMin: 120 }));
    expect(slots.find((s) => s.label === "09:00")?.available).toBe(false);
    expect(slots.find((s) => s.label === "10:00")?.available).toBe(false);
    expect(slots.find((s) => s.label === "11:30")?.available).toBe(true);
  });

  it("blocks whole days covered by a holiday or time off", () => {
    const from = zonedMinuteToUtc(SUNDAY, 0, TZ).getTime();
    const to = zonedMinuteToUtc(SUNDAY, 24 * 60, TZ).getTime();
    const slots = generateSlots(plan({ blocked: [{ start: from, end: to }] }));
    expect(slots).toHaveLength(31);
    expect(slots.every((slot) => !slot.available && slot.reason === "blocked")).toBe(true);
  });

  it("supports two windows a day (lunch break)", () => {
    const slots = generateSlots(
      plan({
        windows: [
          { weekday: 0, startMinute: 540, endMinute: 720 }, // 09:00-12:00
          { weekday: 0, startMinute: 780, endMinute: 1020 }, // 13:00-17:00
        ],
      }),
    );
    const labels = slots.map((slot) => slot.label);
    expect(labels).toContain("11:30");
    expect(labels).not.toContain("12:00");
    expect(labels).toContain("13:00");
  });

  it("keeps slots in chronological order even with unsorted windows", () => {
    const slots = generateSlots(
      plan({
        windows: [
          { weekday: 0, startMinute: 780, endMinute: 1020 },
          { weekday: 0, startMinute: 540, endMinute: 720 },
        ],
      }),
    );
    const starts = slots.map((slot) => slot.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("produces the exact duration requested", () => {
    const slot = generateSlots(plan({ durationMin: 45 }))[0];
    expect(slot.end - slot.start).toBe(45 * MIN);
  });
});

describe("isBookable", () => {
  it("accepts a free slot and refuses a taken one", () => {
    const free = zonedMinuteToUtc(SUNDAY, 540, TZ).getTime();
    const taken = zonedMinuteToUtc(SUNDAY, 600, TZ).getTime();

    expect(isBookable(plan(), free).ok).toBe(true);
    const refused = isBookable(
      plan({ busy: [{ start: taken, end: taken + 30 * MIN }] }),
      taken,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("busy");
  });

  it("refuses a start that is not on the slot grid", () => {
    const offGrid = zonedMinuteToUtc(SUNDAY, 545, TZ).getTime();
    expect(isBookable(plan(), offGrid).ok).toBe(false);
  });
});

describe("summarizeDay", () => {
  it("reports capacity, bookings and utilisation", () => {
    const start = zonedMinuteToUtc(SUNDAY, 540, TZ).getTime();
    const summary = summarizeDay(
      plan({ busy: [{ start, end: start + 30 * MIN }] }),
    );
    expect(summary.totalSlots).toBe(31);
    // a 30-minute booking on a 15-minute grid consumes two start times
    expect(summary.bookedSlots).toBe(2);
    expect(summary.freeSlots).toBe(29);
    expect(summary.utilization).toBeCloseTo(2 / 31, 5);
    expect(summary.isClosed).toBe(false);
  });

  it("marks a closed day", () => {
    const summary = summarizeDay(plan({ date: { year: 2026, month: 10, day: 2 } }));
    expect(summary.isClosed).toBe(true);
    expect(summary.totalSlots).toBe(0);
  });
});

describe("buildDayMap", () => {
  it("covers every day of the range, open or closed", () => {
    const map = buildDayMap({ ...plan(), startDate: SUNDAY, days: 7 });
    // the calendar needs a row per day: 7 days, 6 open (Friday is closed)
    expect(map.size).toBe(7);
    expect(map.get("2026-09-27")?.freeSlots).toBe(31);
    expect(map.get("2026-10-02")?.isClosed).toBe(true); // Friday
  });
});

describe("mergeSlots (earliest available across a team)", () => {
  it("marks a time free when at least one specialist can take it", () => {
    const busy = zonedMinuteToUtc(SUNDAY, 600, TZ).getTime(); // 10:00
    const specialistA = generateSlots(plan({ busy: [{ start: busy, end: busy + 30 * MIN }] }));
    const specialistB = generateSlots(plan());

    const merged = mergeSlots([specialistA, specialistB]);
    const at10 = merged.find((s) => s.label === "10:00");
    expect(at10?.available).toBe(true); // B is free

    const onlyBusy = mergeSlots([specialistA]);
    expect(onlyBusy.find((s) => s.label === "10:00")?.available).toBe(false);
  });

  it("returns a chronologically sorted, de-duplicated list", () => {
    const merged = mergeSlots([generateSlots(plan()), generateSlots(plan())]);
    expect(merged).toHaveLength(31);
    const starts = merged.map((s) => s.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe("firstFreeDay", () => {
  it("skips days that are fully booked", () => {
    const dayStart = zonedMinuteToUtc(SUNDAY, 0, TZ).getTime();
    const dayEnd = zonedMinuteToUtc(SUNDAY, 24 * 60, TZ).getTime();
    const result = firstFreeDay({
      ...plan({ blocked: [{ start: dayStart, end: dayEnd }] }),
      startDate: SUNDAY,
      days: 7,
    });
    expect(result).not.toBeNull();
    expect(result?.date).not.toEqual(SUNDAY);
  });

  it("returns null when the horizon is empty", () => {
    const from = zonedMinuteToUtc(SUNDAY, 0, TZ).getTime();
    const to = zonedMinuteToUtc(addDays(SUNDAY, 30), 0, TZ).getTime();
    const result = firstFreeDay({
      ...plan({
        windows: [],
        blocked: [{ start: from, end: to }],
      }),
      startDate: SUNDAY,
      days: 30,
    });
    expect(result).toBeNull();
  });
});
