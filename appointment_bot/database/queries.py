"""
Shared query helpers used by the Telegram admin panel, the FastAPI panel and
the reporting service. Keeping them here avoids duplicating SQL everywhere.
"""

from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from database.models import (
    Appointment,
    Holiday,
    Service,
    Staff,
    SupportTicket,
    User,
    Waitlist,
)
from utils.calendar import tehran_now, tehran_today

# Appointments that still hold their time slot
ACTIVE = Appointment.status.in_(("pending", "confirmed"))


# ---------------------------------------------------------------------------
# Generic listing with filters (also used by reports)
# ---------------------------------------------------------------------------
def filter_appointments(
    session: Session,
    *,
    day: date | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    staff_id: int | None = None,
    service_id: int | None = None,
    user_id: int | None = None,
    status: str | None = None,
) -> list[Appointment]:
    """Build an appointment query with any combination of filters."""
    stmt: Select = select(Appointment)
    if day is not None:
        stmt = stmt.where(Appointment.date == day)
    if from_date is not None:
        stmt = stmt.where(Appointment.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(Appointment.date <= to_date)
    if staff_id:
        stmt = stmt.where(Appointment.staff_id == staff_id)
    if service_id:
        stmt = stmt.where(Appointment.service_id == service_id)
    if user_id:
        stmt = stmt.where(Appointment.user_id == user_id)
    if status:
        stmt = stmt.where(Appointment.status == status)
    stmt = stmt.order_by(Appointment.date, Appointment.start_time)
    return list(session.scalars(stmt))


def user_appointments(
    session: Session, user_id: int, status: str | None = None
) -> list[Appointment]:
    """All appointments of one user (newest date first)."""
    stmt = select(Appointment).where(Appointment.user_id == user_id)
    if status:
        stmt = stmt.where(Appointment.status == status)
    stmt = stmt.order_by(Appointment.date.desc(), Appointment.start_time.desc())
    return list(session.scalars(stmt))


# ---------------------------------------------------------------------------
# Statistics / dashboard
# ---------------------------------------------------------------------------
def _count(session: Session, stmt: Select) -> int:
    return session.scalar(select(func.count()).select_from(stmt.subquery())) or 0


def count_users(session: Session, *, active_only: bool = False) -> int:
    stmt = select(User)
    if active_only:
        stmt = stmt.where(User.is_active.is_(True))
    return _count(session, stmt)


def dashboard_stats(session: Session) -> dict[str, int]:
    """Numbers displayed on both admin dashboards."""
    today = tehran_today()
    now = tehran_now()

    def count_where(*conditions) -> int:
        return _count(session, select(Appointment).where(*conditions))

    return {
        "total_users": count_users(session),
        "total_services": _count(session, select(Service).where(Service.is_active.is_(True))),
        "total_staff": _count(session, select(Staff).where(Staff.is_active.is_(True))),
        "today": count_where(Appointment.date == today, Appointment.status != "cancelled"),
        "upcoming": count_where(Appointment.date >= today, ACTIVE),
        "pending": count_where(Appointment.status == "pending"),
        "confirmed": count_where(Appointment.status == "confirmed"),
        "cancelled": count_where(Appointment.status == "cancelled"),
        "completed": count_where(Appointment.status == "completed"),
        "no_show": count_where(Appointment.status == "no_show"),
        "open_tickets": _count(session, select(SupportTicket).where(SupportTicket.status == "open")),
        "waitlist_pending": _count(session, select(Waitlist).where(Waitlist.status == "pending")),
        "holidays": _count(session, select(Holiday)),
        "now": now,
    }


def appointments_by_status(session: Session) -> dict[str, int]:
    """{status: count} - used by the dashboard chart."""
    rows = session.execute(
        select(Appointment.status, func.count(Appointment.id)).group_by(Appointment.status)
    ).all()
    return {status: count for status, count in rows}


def appointments_last_days(session: Session, days: int = 7) -> list[tuple[str, int]]:
    """[(iso_date, count), ...] for the last N days (including today)."""
    today = tehran_today()
    start = today.fromordinal(today.toordinal() - (days - 1))
    rows = session.execute(
        select(Appointment.date, func.count(Appointment.id))
        .where(Appointment.date >= start, Appointment.status != "cancelled")
        .group_by(Appointment.date)
        .order_by(Appointment.date)
    ).all()
    return [(d.isoformat(), c) for d, c in rows]


def staff_load(session: Session, day: date | None = None) -> list[tuple[str, int]]:
    """[(staff_name, appointment_count), ...] - staff statistics."""
    stmt = (
        select(Staff.name, func.count(Appointment.id))
        .join(Appointment, Appointment.staff_id == Staff.id)
        .where(Appointment.status != "cancelled")
    )
    if day is not None:
        stmt = stmt.where(Appointment.date == day)
    stmt = stmt.group_by(Staff.id, Staff.name).order_by(func.count(Appointment.id).desc())
    return session.execute(stmt).all()


def service_load(session: Session, day: date | None = None) -> list[tuple[str, int]]:
    """[(service_name, appointment_count), ...] - service statistics."""
    stmt = (
        select(Service.name, func.count(Appointment.id))
        .join(Appointment, Appointment.service_id == Service.id)
        .where(Appointment.status != "cancelled")
    )
    if day is not None:
        stmt = stmt.where(Appointment.date == day)
    stmt = stmt.group_by(Service.id, Service.name).order_by(func.count(Appointment.id).desc())
    return session.execute(stmt).all()


def count_in_range(
    session: Session, start: date, end: date, status: str | None = None
) -> int:
    """Number of appointments inside [start, end] (optionally one status)."""
    stmt = select(Appointment).where(Appointment.date >= start, Appointment.date <= end)
    if status:
        stmt = stmt.where(Appointment.status == status)
    return _count(session, stmt)


def new_users_in_range(session: Session, start: datetime, end: datetime) -> int:
    """Users registered inside a time range."""
    return _count(
        session,
        select(User).where(User.created_at >= start, User.created_at < end),
    )
