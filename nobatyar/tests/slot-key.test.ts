import { describe, expect, it } from "vitest";

import { holdsSlot, slotKeyOf } from "@/lib/slot-key";

/**
 * The rule that keeps the calendar honest.
 *
 * Regression guard: a plain unique index on `(staffId, startsAt)` was correct on
 * paper and wrong in practice — one cancellation made that instant permanently
 * unbookable. These tests pin the replacement so nobody "simplifies" it back.
 */
describe("slotKeyOf", () => {
  it("is the specialist and the instant, nothing else", () => {
    const when = new Date("2026-10-01T06:00:00.000Z");
    expect(slotKeyOf("staff-1", when)).toBe(`staff-1:${when.getTime()}`);
  });

  it("accepts epoch milliseconds as well as a Date", () => {
    const when = new Date("2026-10-01T06:00:00.000Z");
    expect(slotKeyOf("staff-1", when.getTime())).toBe(slotKeyOf("staff-1", when));
  });

  it("never collides for different specialists or instants", () => {
    const base = new Date("2026-10-01T06:00:00.000Z").getTime();
    const keys = new Set([
      slotKeyOf("a", base),
      slotKeyOf("b", base),
      slotKeyOf("a", base + 60_000),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe("holdsSlot", () => {
  it("keeps the slot while the appointment is still going to happen", () => {
    expect(holdsSlot("PENDING")).toBe(true);
    expect(holdsSlot("CONFIRMED")).toBe(true);
    // completed consumed the time and stays on the record
    expect(holdsSlot("COMPLETED")).toBe(true);
  });

  it("releases the slot when the appointment will not happen", () => {
    // this is the behaviour the old unique index made impossible
    expect(holdsSlot("CANCELLED")).toBe(false);
    expect(holdsSlot("NO_SHOW")).toBe(false);
  });

  it("is safe for an unknown status (releases rather than blocking forever)", () => {
    expect(holdsSlot("SOMETHING_NEW")).toBe(false);
  });
});
