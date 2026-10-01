"""
Input validation.

Every function returns either the cleaned value, or None / a Persian error
message - handlers never show raw exceptions to the user.
"""

from __future__ import annotations

import re
from datetime import date, time

from utils.calendar import from_jalali, tehran_today
from utils.helpers import minutes_to_time

_NAME_RE = re.compile(r"^[؀-ۿa-zA-Z\s'.\-]{2,64}$")
_PHONE_RE = re.compile(r"^(?:\+?98|0098|0)?9\d{9}$")


def validate_name(value: str) -> tuple[str | None, str | None]:
    """
    Validate a first/last name.

    :return: (cleaned_value, None) when valid, otherwise (None, error_message)
    """
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return None, "❌ نام نمی‌تواند خالی باشد. دوباره تلاش کنید:"
    if len(cleaned) < 2:
        return None, "❌ نام باید حداقل ۲ حرف باشد. دوباره تلاش کنید:"
    if not _NAME_RE.match(cleaned):
        return None, "❌ فقط حروف مجاز هستند. دوباره تلاش کنید:"
    return cleaned, None


def validate_phone(value: str) -> tuple[str | None, str | None]:
    """
    Validate an Iranian mobile number and normalise it to 09xxxxxxxxx.

    Accepts: 09123456789 / +989123456789 / 989123456789 / 9123456789
    """
    cleaned = value.strip().replace(" ", "").replace("-", "")
    if not cleaned:
        return None, "❌ شماره موبایل نمی‌تواند خالی باشد. دوباره ارسال کنید:"
    if not cleaned.isdigit() and not cleaned.startswith("+"):
        return None, "❌ شماره موبایل نامعتبر است. دوباره ارسال کنید:"
    match = _PHONE_RE.match(cleaned)
    if not match:
        return None, "❌ شماره موبایل معتبر نیست. نمونه: 09123456789"
    normalised = cleaned.lstrip("+")
    if normalised.startswith("0098"):
        normalised = normalised[4:]
    elif normalised.startswith("98"):
        normalised = normalised[2:]
    if not normalised.startswith("0"):
        normalised = "0" + normalised
    return normalised, None


def parse_jalali_input(value: str) -> date | None:
    """Accept 1405/07/10, 1405-07-10, 1405/7/10 ... -> Gregorian date."""
    return from_jalali(value)


def parse_time_input(value: str) -> time | None:
    """Accept '9:00', '09:00', '9.00' -> datetime.time."""
    cleaned = value.strip().replace(".", ":")
    if not cleaned:
        return None
    parts = cleaned.split(":")
    if len(parts) not in (2,):
        return None
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return minutes_to_time(hour * 60 + minute)


def parse_positive_int(value: str) -> int | None:
    """'30' -> 30, '-5' / 'abc' -> None."""
    try:
        result = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return result if result >= 0 else None


def validate_password(value: str) -> bool:
    """Basic rule for the web admin password stored in .env."""
    return bool(value) and len(value) >= 6


def ensure_future_date(day: date, today: date | None = None) -> bool:
    """Past dates can never be booked."""
    return day >= (today or tehran_today())
