"""
Jalali (Persian) calendar helpers.

The web app owns the calendar; these helpers exist for the *presentation* a chat
channel needs — month grids, weekday names, "today" in Tehran.

The invariant worth keeping in mind: a Telegram user reads Jalali dates, so
anything the bot draws itself must be converted here, never with a naive
``datetime``.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import jdatetime

# Persian week: Saturday is the first day, Friday the last.
PERSIAN_DAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"]
PERSIAN_DAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"]
PERSIAN_MONTHS = [
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]


def tehran_tz() -> ZoneInfo:
    """Timezone used by the whole application (default: Asia/Tehran)."""
    return ZoneInfo("Asia/Tehran")


def tehran_now() -> datetime:
    """Current timezone-aware datetime in Tehran."""
    return datetime.now(tehran_tz())


def tehran_today() -> date:
    """Today's date in Tehran."""
    return tehran_now().date()


def to_jalali(value: date | datetime) -> str:
    """Gregorian date -> '1405/07/10'."""
    g = value.date() if isinstance(value, datetime) else value
    j = jdatetime.date.fromgregorian(date=g)
    return j.strftime("%Y/%m/%d")


def from_jalali(text: str) -> date | None:
    """
    '1405/07/10' | '1405-7-10' | '14050710' -> date, or None if invalid.
    """
    cleaned = text.strip().replace("-", "/").replace(".", "/").replace(" ", "")
    if not cleaned:
        return None
    parts = cleaned.split("/")
    try:
        if len(parts) == 3:
            year, month, day = (int(p) for p in parts)
        elif len(cleaned) == 8 and cleaned.isdigit():
            year, month, day = int(cleaned[:4]), int(cleaned[4:6]), int(cleaned[6:])
        else:
            return None
        j = jdatetime.date(year, month, day)  # raises ValueError if invalid
        return j.togregorian()
    except ValueError:
        return None


def persian_weekday(value: date) -> int:
    """Saturday = 0 ... Friday = 6 (Persian week convention)."""
    return (value.weekday() + 2) % 7


def day_name(value: date) -> str:
    """Name of the weekday in Persian, e.g. 'دوشنبه'."""
    return PERSIAN_DAYS[persian_weekday(value)]


def jalali_month_bounds(year: int, month: int) -> tuple[date, date]:
    """First and last Gregorian day of a Jalali month."""
    first = jdatetime.date(year, month, 1).togregorian()
    if month == 12:
        nxt = jdatetime.date(year + 1, 1, 1)
    else:
        nxt = jdatetime.date(year, month + 1, 1)
    last = nxt.togregorian() - timedelta(days=1)
    return first, last


def month_matrix(year: int, month: int) -> list[list[int | None]]:
    """
    Build the calendar grid of a Jalali month.

    Returns a list of weeks; every week is a list of 7 cells.
    A cell is the day of month (int) or None for empty padding.
    The week starts on Saturday, exactly like the Persian calendar.
    """
    first, last = jalali_month_bounds(year, month)
    lead = persian_weekday(first)          # 0 for Saturday
    # 'last' is already the final day of this Jalali month -> its Jalali day
    # number is the number of days in the month (12/30 or 12/29, 7/30 ...).
    days_in_month = jdatetime.date.fromgregorian(date=last).day

    cells: list[int | None] = [None] * lead + list(range(1, days_in_month + 1))
    while len(cells) % 7:
        cells.append(None)

    return [cells[i:i + 7] for i in range(0, len(cells), 7)]


def month_title(year: int, month: int) -> str:
    """'مهر 1405'."""
    return f"{PERSIAN_MONTHS[month - 1]} {year}"


def next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def prev_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def weekday_headers(short: bool = False) -> list[str]:
    """Header row of the calendar: شنبه ... جمعه."""
    return PERSIAN_DAYS_SHORT if short else PERSIAN_DAYS


def human_datetime(day: date, minutes: int) -> str:
    """Helper used by reports: '1405/07/10 09:00'."""
    hour, minute = divmod(minutes, 60)
    return f"{to_jalali(day)} {hour:02d}:{minute:02d}"
