"""
Global application settings (settings table).

Values are strings in the database; typed getters apply defaults and
conversion so no other module has to worry about missing/invalid values.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import Setting
from utils.constants import SETTINGS_DEFAULTS


def get_setting(session: Session, key: str, default: str | None = None) -> str:
    """Read one setting (falls back to the built-in default)."""
    row = session.get(Setting, key)
    if row is not None and row.value != "":
        return row.value
    if default is not None:
        return default
    # Fall back to the value defined in constants
    return SETTINGS_DEFAULTS.get(key, ("", ""))[0]


def get_int_setting(session: Session, key: str, default: int) -> int:
    """Read an integer setting; invalid values return the default."""
    try:
        return int(get_setting(session, key).strip())
    except (TypeError, ValueError):
        return default


def is_setting_true(session: Session, key: str, default: bool = False) -> bool:
    """Boolean setting stored as yes/no, true/false, 1/0."""
    raw = get_setting(session, key, "yes" if default else "no").strip().lower()
    return raw in ("yes", "true", "1", "on", "فعال")


def get_all_settings(session: Session) -> dict[str, str]:
    """Every setting merged with the built-in defaults (key -> value)."""
    merged = {key: value for key, (value, _desc) in SETTINGS_DEFAULTS.items()}
    for row in session.scalars(select(Setting)):
        merged[row.key] = row.value
    return merged


def get_described_settings(session: Session) -> list[tuple[str, str, str, str]]:
    """[(key, value, description, is_default)] - used by both admin panels."""
    stored = {row.key: row for row in session.scalars(select(Setting))}
    result: list[tuple[str, str, str, str]] = []
    for key, (default, description) in SETTINGS_DEFAULTS.items():
        row = stored.get(key)
        value = row.value if row is not None and row.value != "" else default
        is_default = "پیش‌فرض" if value == default else "تغییر یافته"
        result.append((key, value, description, is_default))
    # Custom settings created by the admin (not in the defaults list)
    for key, row in stored.items():
        if key not in SETTINGS_DEFAULTS:
            result.append((key, row.value, row.description or "—", "سفارشی"))
    return result


def set_setting(session: Session, key: str, value: str) -> None:
    """Create or update a setting."""
    row = session.get(Setting, key)
    if row is None:
        session.add(
            Setting(
                key=key,
                value=value,
                description=SETTINGS_DEFAULTS.get(key, ("", ""))[1],
            )
        )
    else:
        row.value = value


def get_cancellation_limit_hours(session: Session) -> int:
    """How many hours before an appointment cancellation becomes impossible."""
    return max(0, get_int_setting(session, "cancellation_limit_hours", 2))


def get_default_slot_duration(session: Session) -> int:
    """Fallback slot length (minutes) when a service has no duration."""
    return max(5, get_int_setting(session, "default_slot_duration", 30))


def get_max_days_ahead(session: Session) -> int:
    """How far in the future a user may book."""
    return max(1, get_int_setting(session, "max_days_ahead", 30))
