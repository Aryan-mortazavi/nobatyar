/**
 * Planning for recurring series — pure, no database, no server imports.
 *
 * A weekly series is nothing more than N instants N*interval days apart, all
 * at the same time of day *in the business timezone*. Keeping the arithmetic
 * here means it can be unit tested and reused by the dashboard.
 */
import { addDays, zonedMinuteToUtc, type CivilDate } from "./dates";

export type SeriesPlan = {
  /** epoch ms of every occurrence, in order */
  starts: number[];
  /** 1-based position of each occurrence, for user-facing labels */
  indexes: number[];
};

/** Minute of the day (0..1439) an instant falls on, in the given timezone. */
export function minuteOfDay(startMs: number, day: CivilDate, timeZone: string): number {
  const midnight = zonedMinuteToUtc(day, 0, timeZone).getTime();
  return Math.round((startMs - midnight) / 60_000);
}

/**
 * Build the instants of a series: the first one, then `interval` days later
 * each time, always at the same local time — so a 09:30 appointment stays at
 * 09:30 across a DST-free but calendar-shifting range.
 */
export function planSeries(params: {
  firstDay: CivilDate;
  minuteOfDay: number;
  count: number;
  intervalDays: number;
  timeZone: string;
}): SeriesPlan {
  const count = Math.max(1, Math.trunc(params.count));
  const interval = Math.max(1, Math.trunc(params.intervalDays));
  const starts: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const day = addDays(params.firstDay, index * interval);
    starts.push(zonedMinuteToUtc(day, params.minuteOfDay, params.timeZone).getTime());
  }
  return { starts, indexes: starts.map((_, index) => index + 1) };
}
