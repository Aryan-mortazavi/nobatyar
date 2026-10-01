"""User management (registration, profile, enable/disable, search)."""

from __future__ import annotations

from sqlalchemy import String, cast, or_, select
from sqlalchemy.orm import Session

from database.models import Appointment, User
from utils.constants import ROLE_ADMIN, ROLE_USER


def get_by_telegram(session: Session, telegram_id: int) -> User | None:
    """Find a user by Telegram id (returns None for unregistered users)."""
    return session.scalar(select(User).where(User.telegram_id == telegram_id))


def get_by_id(session: Session, user_id: int) -> User | None:
    return session.get(User, user_id)


def get_or_create(
    session: Session,
    *,
    telegram_id: int,
    first_name: str,
    last_name: str = "",
    phone: str = "",
    role: str = ROLE_USER,
    is_demo: bool = False,
) -> tuple[User, bool]:
    """
    Return (user, created). Used by the registration flow - calling it twice
    never creates a duplicate account.
    """
    user = get_by_telegram(session, telegram_id)
    if user is not None:
        return user, False

    user = User(
        telegram_id=telegram_id,
        first_name=first_name,
        last_name=last_name,
        phone=phone,
        role=role,
        is_demo=is_demo,
    )
    session.add(user)
    session.flush()  # gives the user an id without committing
    return user, True


def update_profile(
    session: Session, user: User, *, first_name: str | None = None,
    last_name: str | None = None, phone: str | None = None
) -> User:
    """Edit the profile fields that the user is allowed to change."""
    if first_name:
        user.first_name = first_name
    if last_name is not None:
        user.last_name = last_name
    if phone:
        user.phone = phone
    session.flush()
    return user


def set_active(session: Session, user: User, active: bool) -> None:
    """Admin can disable / enable an account."""
    user.is_active = active
    session.flush()


def set_role(session: Session, user: User, role: str) -> None:
    user.role = role
    session.flush()


def list_users(
    session: Session, *, search: str | None = None, active_only: bool = False
) -> list[User]:
    """All users (optionally filtered by name / phone / telegram id)."""
    stmt = select(User)
    if active_only:
        stmt = stmt.where(User.is_active.is_(True))
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                User.first_name.like(pattern),
                User.last_name.like(pattern),
                User.phone.like(pattern),
                cast(User.telegram_id, String).like(pattern),
            )
        )
    stmt = stmt.order_by(User.created_at.desc())
    return list(session.scalars(stmt))


def count_appointments(session: Session, user_id: int) -> int:
    """How many appointments a user has (shown on the profile page)."""
    return len(
        list(
            session.scalars(
                select(Appointment.id).where(Appointment.user_id == user_id)
            )
        )
    )


def apply_admin_roles(session: Session, admin_ids: list[int]) -> int:
    """
    Keep the database role in sync with ADMIN_IDS from .env.
    Called once at startup -> admin permissions never live in the source code.
    """
    updated = 0
    if not admin_ids:
        return updated
    for user in session.scalars(select(User).where(User.telegram_id.in_(admin_ids))):
        if user.role != ROLE_ADMIN:
            user.role = ROLE_ADMIN
            updated += 1
    session.flush()
    return updated
