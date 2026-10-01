"""
Small generic helpers: time math, pagination, formatting, tracking codes.
"""

from __future__ import annotations

import random
import string
from datetime import date, datetime, time, timedelta

from utils.calendar import tehran_now, tehran_tz
from utils.constants import TRACKING_PREFIX

# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------
def time_to_minutes(value: time) -> int:
    """09:30 -> 570."""
    return value.hour * 60 + value.minute


def minutes_to_time(total: int) -> time:
    """570 -> 09:30."""
    total %= 24 * 60
    return time(hour=total // 60, minute=total % 60)


def hhmm(value: time) -> str:
    """09:30 -> '09:30' (always 24-hour format)."""
    return value.strftime("%H:%M")


def add_minutes(value: time, minutes: int) -> time:
    return minutes_to_time(time_to_minutes(value) + minutes)


def overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    """Half-open interval overlap test ([a,b) style)."""
    return a_start < b_end and b_start < a_end


def appointment_datetime(day: date, start: time, end: time | None = None) -> datetime:
    """Timezone-aware Tehran datetime of an appointment (start or end moment)."""
    chosen = start if end is None else end
    return datetime.combine(day, chosen, tzinfo=tehran_tz())


def is_in_past(day: date, start: time, now: datetime | None = None) -> bool:
    """True when the slot already lies in the past."""
    now = now or tehran_now()
    return appointment_datetime(day, start) <= now


# ---------------------------------------------------------------------------
# Timezone helpers (SQLite returns naive datetimes - they are stored as UTC)
# ---------------------------------------------------------------------------
def as_utc(value: datetime | None) -> datetime | None:
    """Attach UTC to a naive datetime coming from the database."""
    if value is None:
        return None
    return value.replace(tzinfo=None) if value.tzinfo is None else value


def as_tehran(value: datetime | None) -> datetime | None:
    """Convert a (possibly naive/UTC) database datetime to Tehran time."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=None)  # stored values are UTC naive
        from datetime import timezone

        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(tehran_tz())


def utcnow() -> datetime:
    """UTC now - default value for created_at / updated_at columns."""
    return datetime.utcnow()


def jalali_ym(value: date) -> tuple[int, int]:
    """Gregorian date -> (jalali_year, jalali_month) e.g. (1405, 7)."""
    import jdatetime

    j = jdatetime.date.fromgregorian(date=value)
    return j.year, j.month


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------
class Page:
    """Result of a pagination request (used by Telegram and the web panel)."""

    def __init__(self, items: list, page: int, per_page: int, total: int):
        self.items = items
        self.per_page = per_page
        self.total = total
        self.total_pages = max(1, -(-total // per_page))  # ceil division
        self.page = max(1, min(page, self.total_pages))
        self.start_index = (self.page - 1) * per_page + 1 if total else 0
        self.end_index = min(self.page * per_page, total)

    @property
    def has_prev(self) -> bool:
        return self.page > 1

    @property
    def has_next(self) -> bool:
        return self.page < self.total_pages


def paginate(items: list, page: int = 1, per_page: int = 5) -> Page:
    """Slice a python list into a page."""
    total = len(items)
    start = (max(1, page) - 1) * per_page
    return Page(items[start:start + per_page], page, per_page, total)


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------
def tracking_code() -> str:
    """Random human friendly code, e.g. 'APT-10245' (uniqueness is verified)."""
    digits = "".join(random.choices(string.digits, k=5))
    return f"{TRACKING_PREFIX}-{digits}"


def price_text(price: int) -> str:
    """150000 -> '150,000' (informational only - there is NO payment)."""
    return f"{price:,}"


def appointment_card(
    *,
    user: str,
    service: str,
    staff: str,
    jalali_date: str,
    start: str,
    tracking: str | None = None,
    status_fa: str | None = None,
    title: str = "جزئیات نوبت",
) -> str:
    """The standard boxed appointment message used across the bot."""
    lines = [
        "━━━━━━━━━━━━━━",
        f"📅 {title}",
        "━━━━━━━━━━━━━━",
        f"👤 کاربر: {user}",
        f"🛠 خدمت: {service}",
        f"🧑‍💼 کارشناس: {staff}",
        f"📅 تاریخ: {jalali_date}",
        f"⏰ ساعت: {start}",
    ]
    if tracking:
        lines.append(f"🔑 کد رهگیری: {tracking}")
    if status_fa:
        lines.append(f"📌 وضعیت: {status_fa}")
    lines.append("━━━━━━━━━━━━━━")
    return "\n".join(lines)


def safe_int(value: object, default: int = 0) -> int:
    """'12' -> 12, anything else -> default."""
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default
