"""تقویم شمسی، ابزارهای عمومی و اعتبارسنجی‌ها (UI فارسی بدون تاریخ میلادی)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pytest

from utils import validators
from utils.calendar import (
    day_name,
    from_jalali,
    human_datetime,
    jalali_month_bounds,
    month_title,
    next_month,
    persian_weekday,
    prev_month,
    tehran_today,
    to_jalali,
)
from utils.helpers import jalali_ym
from utils.constants import PERSIAN_DAYS, SETTINGS_DEFAULTS, STATUS_LABELS_FA
from utils.helpers import hhmm, minutes_to_time, overlaps, paginate, time_to_minutes, tracking_code


def test_gregorian_to_jalali_and_back():
    day = date(2026, 9, 28)
    text = to_jalali(day)
    assert text.count("/") == 2
    assert text.startswith("1405/")  # 2026 is 1405 in the Jalali calendar
    assert from_jalali(text) == day


def test_jalali_input_formats():
    day = from_jalali("1405/07/10")
    assert day == date(2026, 10, 2)
    assert from_jalali("1405-07-10") == day
    assert from_jalali("1405/7/1") == date(2026, 9, 23)
    assert from_jalali("not a date") is None
    assert from_jalali("1405/15/40") is None


def test_persian_week_starts_on_saturday():
    # 2026-09-26 is a Saturday (1405/07/04)
    saturday = date(2026, 9, 26)
    assert persian_weekday(saturday) == 0
    assert day_name(saturday) == PERSIAN_DAYS[0]
    assert persian_weekday(saturday + timedelta(days=6)) == 6  # Friday
    assert day_name(saturday + timedelta(days=6)) == PERSIAN_DAYS[6]


def test_month_boundaries_and_navigation():
    start, end = jalali_month_bounds(1405, 7)
    assert to_jalali(start).endswith("/07/01")  # first of Mehr
    # end is the last day of the month (the next day already belongs to Aban)
    assert to_jalali(end).startswith("1405/07/")
    assert to_jalali(end + timedelta(days=1)).startswith("1405/08/")
    assert end > start

    assert next_month(1405, 7) == (1405, 8)
    assert next_month(1405, 12) == (1406, 1)
    assert prev_month(1405, 1) == (1404, 12)

    title = month_title(1405, 7)
    assert "مهر" in title and "1405" in title

    assert jalali_ym(date(2026, 9, 28)) == (1405, 7)


def test_month_matrix_covers_the_whole_jalali_month():
    """Grid of every month: correct width, padding and day count."""
    import jdatetime

    from utils.calendar import month_matrix

    for year in (1404, 1405, 1403):
        total = 0
        for month in range(1, 13):
            grid = month_matrix(year, month)
            assert all(len(week) == 7 for week in grid), (year, month)
            days = [cell for week in grid for cell in week if cell is not None]
            # 1..N with no hole, in order
            assert days == list(range(1, len(days) + 1)), (year, month)
            # the first day sits under the right Persian weekday (شنبه = 0)
            first, last = jalali_month_bounds(year, month)
            assert grid[0][persian_weekday(first)] == 1, (year, month)
            # the number of cells equals the real length of the month
            assert len(days) == jdatetime.date.fromgregorian(date=last).day
            total += len(days)
        assert total in (365, 366)

    # leap year check: 1403 is a Jalali leap year -> Esfand has 30 days
    assert len([c for w in month_matrix(1403, 12) for c in w if c]) == 30
    assert len([c for w in month_matrix(1405, 12) for c in w if c]) == 29


def test_calendar_keyboard_renders_without_errors():
    """The inline calendar must build (a crash here froze the booking flow)."""
    from keyboards import inline_keyboard as inline

    first, _ = jalali_month_bounds(1405, 7)
    keyboard = inline.calendar(1405, 7, {first})
    rows = keyboard.inline_keyboard
    assert len(rows) > 2
    flat = [button.callback_data for row in rows for button in row]
    assert f"cal:day:1405:7:1" in flat  # the bookable day is clickable
    assert any(str(c).startswith("cal:nav:") for c in flat)  # month navigation
    assert all(c for c in flat), "every button must carry a callback"


def test_human_datetime_is_persian_and_24_hours():
    day = date(2026, 9, 28)
    text = human_datetime(day, 9 * 60)  # 09:00
    assert "09:00" in text
    assert "1405" in text
    assert "am" not in text.lower() and "pm" not in text.lower()


def test_time_helpers():
    assert time_to_minutes(time(9, 30)) == 570
    assert minutes_to_time(570) == time(9, 30)
    assert hhmm(time(9, 5)) == "09:05"
    assert minutes_to_time(24 * 60 + 15) == time(0, 15)


def test_overlap_logic():
    # half-open intervals: [10:00-10:30) vs [10:30-11:00)
    assert overlaps(600, 630, 630, 660) is False
    assert overlaps(600, 630, 615, 645) is True
    assert overlaps(600, 630, 600, 660) is True


def test_paginate():
    items = list(range(23))
    first = paginate(items, 1, 10)
    assert first.items == list(range(10))
    assert first.total == 23
    assert first.total_pages == 3
    assert paginate(items, 99, 10).page == 3  # out of range is clamped
    assert paginate(items, 0, 10).page == 1


def test_tracking_code_format():
    code = tracking_code()
    assert code.startswith("APT-")
    assert len(code) == len("APT-") + 5
    assert code[4:].isdigit()


def test_status_labels_are_persian():
    from utils.constants import APPOINTMENT_STATUSES

    for status in APPOINTMENT_STATUSES:
        label = STATUS_LABELS_FA[status]
        assert label and label != status
        assert any("\u0600" <= ch <= "\u06ff" for ch in label)


def test_settings_defaults_are_complete():
    required = {
        "center_name",
        "phone",
        "address",
        "cancellation_limit_hours",
        "default_slot_duration",
        "max_days_ahead",
        "about_text",
        "support_message",
        "auto_confirm",
        "timezone",
    }
    assert required.issubset(set(SETTINGS_DEFAULTS))
    for key, (value, description) in SETTINGS_DEFAULTS.items():
        assert description, key
        assert isinstance(value, str)


# ---------------------------------------------------------------------------
# validators
# ---------------------------------------------------------------------------
def test_validate_name():
    assert validators.validate_name("علی") == ("علی", None)
    value, error = validators.validate_name("")
    assert value is None and "خالی" in error
    value, error = validators.validate_name("a")
    assert value is None


def test_validate_phone():
    assert validators.validate_phone("09123456789")[0] == "09123456789"
    assert validators.validate_phone("+989123456789")[0] == "09123456789"
    value, error = validators.validate_phone("12345")
    assert value is None and "معتبر نیست" in error


def test_parse_time_input():
    assert validators.parse_time_input("09:30") == time(9, 30)
    assert validators.parse_time_input("9:5") == time(9, 5)
    assert validators.parse_time_input("25:00") is None
    assert validators.parse_time_input("abc") is None


def test_parse_positive_int_and_password():
    assert validators.parse_positive_int("45") == 45
    assert validators.parse_positive_int("-3") is None
    assert validators.parse_positive_int("x") is None
    assert validators.validate_password("123456") is True
    assert validators.validate_password("123") is False


def test_parse_jalali_input_and_future_date():
    assert validators.parse_jalali_input("1405/07/10") == date(2026, 10, 2)
    assert validators.parse_jalali_input("bad") is None
    today = tehran_today()
    assert validators.ensure_future_date(today + timedelta(days=1)) is True
    assert validators.ensure_future_date(today - timedelta(days=1)) is False
