"""
Authorization helpers.

Two independent checks are used:
  1. Telegram panel -> admin Telegram IDs from the .env file (ADMIN_IDS)
  2. Web panel      -> username/password from the .env file

Because the role is also stored on the User row, new roles (moderator, staff...)
can be introduced later without touching every handler.
"""

from __future__ import annotations

import secrets

from sqlalchemy.orm import Session

from config import ADMIN_IDS, WEB_ADMIN_PASSWORD, WEB_ADMIN_USERNAME
from database.models import User
from utils.constants import ROLE_ADMIN
from services import user_service


def is_admin_telegram_id(telegram_id: int) -> bool:
    """True when this Telegram user is allowed to open /admin."""
    return telegram_id in ADMIN_IDS


def is_admin(session: Session, telegram_id: int) -> bool:
    """
    Combined check: either the id is configured in .env, or the user row
    carries the admin role (kept in sync at startup).
    """
    if is_admin_telegram_id(telegram_id):
        return True
    user = user_service.get_by_telegram(session, telegram_id)
    return user is not None and user.role == ROLE_ADMIN


def user_is_admin(user: User) -> bool:
    return user.role == ROLE_ADMIN


def web_credentials_valid(username: str, password: str) -> bool:
    """Constant-time comparison of the web admin credentials from .env."""
    if not WEB_ADMIN_PASSWORD:
        return False
    return secrets.compare_digest(username, WEB_ADMIN_USERNAME) and secrets.compare_digest(
        password, WEB_ADMIN_PASSWORD
    )
