"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn, formatNumber } from "@/lib/utils";
import {
  civilToDateKey,
  compareCivil,
  fromJalali,
  jalaliDaysInMonth,
  monthName,
  toJalali,
  type CivilDate,
} from "@/lib/dates";
import type { Locale } from "@/lib/i18n";

/** Day metadata handed down from the server. */
export type DayState = {
  bookable: boolean;
  freeCount: number;
  isHoliday: boolean;
  isClosed: boolean;
};

export type MonthCursor = { year: number; month: number }; // Jalali year/month

/**
 * The grid is always built in the Jalali calendar (the product's native
 * calendar) and rendered in the reader's calendar: Persian users see
 * ۱۴۰۵/۰۷/۱۰, English users see the Gregorian equivalent of the same days.
 */
export function BookingCalendar({
  locale,
  todayJalali,
  selected,
  onSelect,
  dayStates,
  weekStart,
  cursor,
  onCursorChange,
  labels,
}: {
  locale: Locale;
  todayJalali: CivilDate;
  selected: CivilDate | null;
  /** receives the Gregorian date (what the availability API speaks) */
  onSelect: (gregorian: CivilDate) => void;
  dayStates: Record<string, DayState>;
  weekStart: number;
  cursor: MonthCursor;
  onCursorChange: (cursor: MonthCursor) => void;
  labels: {
    prev: string;
    next: string;
    days: string[];
    free: (count: number) => string;
    closed: string;
  };
}) {
  const persian = locale === "fa";
  // Persian weeks start on Saturday, English weeks on Monday
  const gridStart = persian ? 6 : weekStart === 6 ? 1 : weekStart;

  const cells = React.useMemo(
    () => buildJalaliGrid(cursor, gridStart),
    [cursor, gridStart],
  );

  const title = monthName({ ...cursor, day: 1 }, locale);
  const step = (delta: number) => onCursorChange(stepMonth(cursor, delta));

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label={labels.prev}>
          {persian ? <ChevronRight className="size-4" aria-hidden /> : <ChevronLeft className="size-4" aria-hidden />}
        </Button>
        <p className="text-sm font-semibold">{title}</p>
        <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label={labels.next}>
          {persian ? <ChevronLeft className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {labels.days.map((day) => (
          <span key={day} className="py-1.5">
            {day}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, index) => {
          if (!cell) return <span key={`pad-${index}`} className="aspect-square" />;

          const gregorian = fromJalali(cell);
          const key = civilToDateKey(gregorian);
          const state = dayStates[key];
          const isToday = compareCivil(cell, todayJalali) === 0;
          const isSelected = selected ? compareCivil(cell, toJalali(selected)) === 0 : false;
          const isPast = compareCivil(cell, todayJalali) < 0;
          const disabled = isPast || !state?.bookable;
          const display = persian ? formatNumber(cell.day, locale) : String(gregorian.day);

          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(gregorian)}
              aria-pressed={isSelected}
              aria-label={key}
              title={state?.bookable ? labels.free(state.freeCount) : labels.closed}
              className={cn(
                "relative grid aspect-square place-items-center rounded-xl text-sm font-medium transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !persian && "tabular-nums",
                disabled && "cursor-not-allowed text-muted-foreground/35",
                !disabled && "hover:bg-accent",
                isToday && !isSelected && "ring-1 ring-primary/50",
                isSelected &&
                  "bg-primary text-primary-foreground shadow-[0_10px_24px_-14px_var(--primary)]",
                state?.isHoliday && !isSelected && "line-through decoration-danger/60",
              )}
            >
              {display}
              {state?.bookable && !isSelected ? (
                <span className="absolute bottom-1 size-1 rounded-full bg-success" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildJalaliGrid(cursor: MonthCursor, gridStart: number): (CivilDate | null)[] {
  const { year, month } = cursor;
  const firstJalali: CivilDate = { year, month, day: 1 };
  const firstGregorian = fromJalali(firstJalali);
  const weekday = new Date(
    Date.UTC(firstGregorian.year, firstGregorian.month - 1, firstGregorian.day),
  ).getUTCDay();
  const lead = (weekday - gridStart + 7) % 7;
  const days = jalaliDaysInMonth(year, month);

  const cells: (CivilDate | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push({ year, month, day });
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function stepMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const month = cursor.month + delta;
  if (month < 1) return { year: cursor.year - 1, month: 12 };
  if (month > 12) return { year: cursor.year + 1, month: 1 };
  return { year: cursor.year, month };
}
