"""
Waitlist: users can queue for a busy day and get notified when a slot frees up.

Flow:
    slot full -> user joins the waitlist
    someone cancels -> offers_for_cancellation() finds a free slot
    -> the notification service informs the waiting user with a booking button
"""

from __future__ import annotations

import logging
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import Waitlist
from services import slot_service
from utils.helpers import hhmm, time_to_minutes

logger = logging.getLogger(__name__)


class WaitlistError(ValueError):
    """Raised for invalid waitlist operations (Persian message)."""


def add(
    session: Session,
    *,
    user_id: int,
    staff_id: int,
    service_id: int,
    day: date,
    preferred_time: time | None = None,
) -> tuple[Waitlist, bool]:
    """
    Join the waiting list of a (staff, day) pair.

    :return: (entry, created) - joining twice updates the existing entry.
    """
    existing = session.scalar(
        select(Waitlist).where(
            Waitlist.user_id == user_id,
            Waitlist.staff_id == staff_id,
            Waitlist.date == day,
            Waitlist.status.in_(("pending", "notified")),
        )
    )
    if existing is not None:
        if preferred_time is not None:
            existing.preferred_time = preferred_time
        existing.status = "pending"
        session.flush()
        return existing, False

    entry = Waitlist(
        user_id=user_id,
        staff_id=staff_id,
        service_id=service_id,
        date=day,
        preferred_time=preferred_time,
        status="pending",
    )
    session.add(entry)
    session.flush()
    logger.info("Waitlist entry #%s created (user=%s)", entry.id, user_id)
    return entry, True


def get(session: Session, entry_id: int) -> Waitlist | None:
    return session.get(Waitlist, entry_id)


def list_entries(
    session: Session, *, status: str | None = None, day: date | None = None
) -> list[Waitlist]:
    stmt = select(Waitlist)
    if status:
        stmt = stmt.where(Waitlist.status == status)
    if day:
        stmt = stmt.where(Waitlist.date == day)
    stmt = stmt.order_by(Waitlist.date, Waitlist.preferred_time)
    return list(session.scalars(stmt))


def set_status(session: Session, entry: Waitlist, status: str) -> None:
    if status not in Waitlist.STATUSES:
        raise WaitlistError("❌ وضعیت نامعتبر است.")
    entry.status = status
    session.flush()


def remove(session: Session, entry: Waitlist) -> None:
    session.delete(entry)
    session.flush()


def pending_for_day(session: Session, staff_id: int, day: date) -> list[Waitlist]:
    """Everyone waiting for this staff member on this date."""
    rows = session.scalars(
        select(Waitlist).where(
            Waitlist.staff_id == staff_id,
            Waitlist.date == day,
            Waitlist.status.in_(("pending", "notified")),
        )
    ).all()
    return sorted(
        rows,
        key=lambda e: (
            e.preferred_time is None,
            time_to_minutes(e.preferred_time) if e.preferred_time else 0,
        ),
    )


def offers_for_cancellation(
    session: Session, *, staff_id: int, day: date
) -> list[tuple[Waitlist, time]]:
    """
    After a slot was freed: which waiting users can be offered which slot.

    Every free slot is offered to at most one user, preferring the user's
    own preferred time.
    """
    results: list[tuple[Waitlist, time]] = []
    taken: set[str] = set()

    for entry in pending_for_day(session, staff_id, day):
        free = slot_service.get_available_slots(
            session, staff_id=staff_id, service_id=entry.service_id, day=day
        )
        chosen: str | None = None
        if entry.preferred_time is not None:
            label = hhmm(entry.preferred_time)
            if label in free and label not in taken:
                chosen = label
        if chosen is None:
            chosen = next((s for s in free if s not in taken), None)
        if chosen is None:
            continue
        taken.add(chosen)
        hour, minute = chosen.split(":")
        results.append((entry, time(int(hour), int(minute))))
    return results


def expire_old_entries(session: Session, today: date | None = None) -> int:
    """Mark entries of past dates as expired (called by the scheduler)."""
    today = today or date.today()
    rows = session.scalars(
        select(Waitlist).where(
            Waitlist.date < today,
            Waitlist.status.in_(("pending", "notified")),
        )
    ).all()
    for row in rows:
        row.status = "expired"
    session.flush()
    return len(rows)
