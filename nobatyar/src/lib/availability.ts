/**
 * Availability engine — the heart of the product.
 *
 * Pure, dependency-free and fully unit tested: it turns a weekly schedule,
 * time off, holidays, existing bookings and a booking policy into the exact
 * list of slots a customer may pick. No database, no React, no locale.
 *
 * Everything is in minutes-of-day and epoch milliseconds so the same code path
 * serves the booking wizard, the dashboard calendar and the analytics.
 */
import {
  addDays,
  civilWeekday,
  civilToDateKey,
  type CivilDate,
  zonedMinuteToUtc,
} from "./dates";
import { minutesToHHMM, overlaps } from "./utils";

export type WeeklyWindow = { weekday: number; startMinute: number; endMinute: number };
export type Interval = { start: number; end: number };
export type SlotReason = "past" | "busy" | "blocked" | "closed";

export type Slot = {
  /** UTC epoch ms */
  start: number;
  end: number;
  /** minute of the day in the workspace timezone (for labels and sorting) */
  startMinute: number;
  label: string;
  available: boolean;
  reason?: SlotReason;
};

export type SlotPlan = {
  date: CivilDate;
  timeZone: string;
  /** working windows for that weekday */
  windows: WeeklyWindow[];
  /** time off + holidays (absolute intervals) */
  blocked: Interval[];
  /** existing appointments already padded with their buffers */
  busy: Interval[];
  durationMin: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  stepMin?: number;
  /** slots starting before `now + minNoticeMin` are not bookable */
  now: number;
  minNoticeMin?: number;
  /** slots after this instant are outside the booking horizon */
  latestAt?: number;
};

const MIN = 60_000;

function totalMinutes(windows: WeeklyWindow[], weekday: number): number {
  return windows
    .filter((w) => w.weekday === weekday)
    .reduce((sum, w) => sum + Math.max(0, w.endMinute - w.startMinute), 0);
}

/**
 * All slots of one day, in chronological order.
 * Unavailable slots are returned as well (with a reason) so the UI can render
 * them as disabled chips instead of silently hiding them.
 */
export function generateSlots(plan: SlotPlan): Slot[] {
  const {
    date,
    timeZone,
    windows,
    blocked,
    busy,
    durationMin,
    bufferBeforeMin = 0,
    bufferAfterMin = 0,
    stepMin = 15,
    now,
    minNoticeMin = 0,
    latestAt,
  } = plan;

  const weekday = civilWeekday(date);
  const dayWindows = windows
    .filter((w) => w.weekday === weekday && w.endMinute > w.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute);

  const earliest = now + minNoticeMin * MIN;
  const spanWithBuffers = durationMin + bufferBeforeMin + bufferAfterMin;
  const slots: Slot[] = [];
  const seen = new Set<number>();

  for (const window of dayWindows) {
    // the *booked* span (without buffers) has to fit inside the window
    for (
      let minute = window.startMinute - bufferBeforeMin;
      minute + spanWithBuffers <= window.endMinute;
      minute += stepMin
    ) {
      if (seen.has(minute)) continue;
      seen.add(minute);

      const startMinute = minute + bufferBeforeMin;
      const start = zonedMinuteToUtc(date, startMinute, timeZone).getTime();
      const end = start + durationMin * MIN;
      const occupiedStart = start - bufferBeforeMin * MIN;
      const occupiedEnd = end + bufferAfterMin * MIN;

      let reason: SlotReason | undefined;
      if (blocked.some((i) => overlaps(occupiedStart, occupiedEnd, i.start, i.end))) {
        reason = "blocked";
      } else if (busy.some((i) => overlaps(occupiedStart, occupiedEnd, i.start, i.end))) {
        reason = "busy";
      } else if (start < earliest) {
        reason = "past";
      } else if (latestAt !== undefined && start > latestAt) {
        reason = "closed";
      }

      slots.push({
        start,
        end,
        startMinute,
        label: minutesToHHMM(startMinute),
        available: reason === undefined,
        ...(reason ? { reason } : {}),
      });
    }
  }

  return slots.sort((a, b) => a.start - b.start);
}

export type DaySummary = {
  key: string;
  totalSlots: number;
  freeSlots: number;
  bookedSlots: number;
  minutesAvailable: number;
  bookedMinutes: number;
  isClosed: boolean;
  isHoliday: boolean;
  isPast: boolean;
  utilization: number; // 0..1
};

/** One row for a calendar day: how full is it? */
export function summarizeDay(plan: SlotPlan): DaySummary {
  const slots = generateSlots(plan);
  const free = slots.filter((s) => s.available);
  const booked = slots.filter((s) => s.reason === "busy");
  const duration = plan.durationMin;
  const workingMinutes = totalMinutes(plan.windows, civilWeekday(plan.date));
  return {
    key: civilToDateKey(plan.date),
    totalSlots: slots.length,
    freeSlots: free.length,
    bookedSlots: booked.length,
    minutesAvailable: free.length * duration,
    bookedMinutes: booked.length * duration,
    isClosed: workingMinutes === 0,
    isHoliday: slots.length > 0 && slots.every((s) => s.reason === "blocked"),
    isPast: plan.now > zonedMinuteToUtc(plan.date, 24 * 60, plan.timeZone).getTime(),
    utilization: slots.length === 0 ? 0 : booked.length / slots.length,
  };
}

/**
 * Calendar view: which days of the horizon still have room?
 * Returns a map `YYYY-MM-DD → DaySummary` (timezone-local keys).
 */
export function buildDayMap(
  plan: Omit<SlotPlan, "date"> & { startDate: CivilDate; days: number },
): Map<string, DaySummary> {
  const result = new Map<string, DaySummary>();
  const { startDate, days } = plan;
  for (let i = 0; i < days; i += 1) {
    const date = addDays(startDate, i);
    const { startDate: _omit, days: _omit2, ...rest } = plan;
    const summary = summarizeDay({ ...rest, date });
    if (summary.totalSlots > 0 || !summary.isPast) {
      result.set(summary.key, summary);
    }
  }
  return result;
}

/** The next day that still has at least one free slot (used by "next available"). */
export function firstFreeDay(
  plan: Omit<SlotPlan, "date"> & { startDate: CivilDate; days: number },
): { date: CivilDate; summary: DaySummary } | null {
  const { startDate, days } = plan;
  for (let i = 0; i < days; i += 1) {
    const date = addDays(startDate, i);
    const { startDate: _omit, days: _omit2, ...rest } = plan;
    const summary = summarizeDay({ ...rest, date });
    if (summary.freeSlots > 0) return { date, summary };
  }
  return null;
}

/** Does this exact instant survive every rule? (used by the booking action) */
export function isBookable(
  plan: SlotPlan,
  startMs: number,
): { ok: true; slot: Slot } | { ok: false; reason: SlotReason } {
  const slot = generateSlots(plan).find((s) => s.start === startMs);
  if (!slot) return { ok: false, reason: "closed" };
  return slot.available ? { ok: true, slot } : { ok: false, reason: slot.reason ?? "closed" };
}

/**
 * Must the whole appointment sit inside one civil day?
 *
 * This is a *containment* test: a slot at 23:30 with a 60-minute service is
 * refused because it would run past midnight. Note that it is deliberately not
 * an intersection test — every slot inside the day "overlaps" the day, which
 * would reject the whole calendar.
 */
export function fitsInDay(
  startMs: number,
  endMs: number,
  dayStartMs: number,
  dayEndMs: number,
): boolean {
  return startMs >= dayStartMs && endMs <= dayEndMs;
}

/** Merge the schedules of several specialists into one union of free slots. */
export function mergeSlots(slotsPerStaff: Slot[][]): Slot[] {
  const byStart = new Map<number, Slot>();
  for (const slots of slotsPerStaff) {
    for (const slot of slots) {
      const existing = byStart.get(slot.start);
      // a time is free as soon as one specialist can take it
      if (!existing || (!existing.available && slot.available)) {
        byStart.set(slot.start, slot);
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}
