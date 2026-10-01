"""
Dynamic time-slot generation.

Slots are NEVER hard-coded. For a given (staff, service, date) we compute:

    working hours  -  minus break times  -  minus already booked appointments
    -  minus past times  -  stepped by the service duration

Example: working hours 08:00-12:00, duration 30 min
    -> 08:00 08:30 09:00 09:30 10:00 10:30 11:00 11:30
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import Appointment, Holiday, Service, Staff, WorkingHour
from database.models import BreakTime
from services import settings_service
from utils.calendar import persian_weekday, tehran_now, to_jalali
from utils.helpers import (
    hhmm,
    is_in_past,
    minutes_to_time,
    overlaps,
    time_to_minutes,
)


@dataclass
class Slot:
    """One candidate time slot of a day."""

    time: str            # "09:30"
    available: bool      # False -> already booked
    reason: str = ""     # "booked" / "" (kept for future use)

    @property
    def locked(self) -> bool:
        return not self.available


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _work_intervals(session: Session, staff_id: int, day: date) -> list[tuple[int, int]]:
    """Active working intervals of that weekday in minutes."""
    rows = session.scalars(
        select(WorkingHour).where(
            WorkingHour.staff_id == staff_id,
            WorkingHour.day_of_week == persian_weekday(day),
            WorkingHour.is_active.is_(True),
        )
    ).all()
    return sorted(
        (time_to_minutes(r.start_time), time_to_minutes(r.end_time)) for r in rows
    )


def _break_intervals(session: Session, staff_id: int, day: date) -> list[tuple[int, int]]:
    rows = session.scalars(
        select(BreakTime).where(
            BreakTime.staff_id == staff_id,
            BreakTime.day_of_week == persian_weekday(day),
            BreakTime.is_active.is_(True),
        )
    ).all()
    return [(time_to_minutes(r.start_time), time_to_minutes(r.end_time)) for r in rows]


def _busy_intervals(
    session: Session, staff_id: int, day: date, ignore_appointment_id: int | None = None
) -> list[tuple[int, int]]:
    """Slots already taken by pending/confirmed/completed appointments."""
    rows = session.scalars(
        select(Appointment).where(
            Appointment.staff_id == staff_id,
            Appointment.date == day,
            Appointment.status.in_(("pending", "confirmed", "completed", "no_show")),
        )
    ).all()
    return [
        (time_to_minutes(a.start_time), time_to_minutes(a.end_time))
        for a in rows
        if not (ignore_appointment_id and a.id == ignore_appointment_id)
    ]


def is_holiday(session: Session, day: date) -> bool:
    return session.scalar(select(Holiday).where(Holiday.date == day)) is not None


def is_working_day(session: Session, staff_id: int, day: date) -> bool:
    """True when the staff member has at least one active interval that day."""
    if is_holiday(session, day):
        return False
    return bool(_work_intervals(session, staff_id, day))


# ---------------------------------------------------------------------------
# Main slot generation
# ---------------------------------------------------------------------------
def build_day_slots(
    session: Session,
    *,
    staff_id: int,
    service_id: int,
    day: date,
    now: datetime | None = None,
    ignore_appointment_id: int | None = None,
) -> list[Slot]:
    """
    Build every candidate slot of one day together with its availability.

    * past slots are removed completely
    * holiday / closed day -> empty list
    * booked slots are returned with available=False (they drive the waitlist)
    * ``ignore_appointment_id`` lets a reschedule ignore the appointment that
      is about to be moved.
    """
    now = now or tehran_now()

    if is_holiday(session, day):
        return []

    service = session.get(Service, service_id)
    if service is None:
        return []
    duration = service.duration or settings_service.get_default_slot_duration(session)
    step = duration

    work = _work_intervals(session, staff_id, day)
    if not work:
        return []

    breaks = _break_intervals(session, staff_id, day)
    busy = _busy_intervals(session, staff_id, day, ignore_appointment_id)

    result: dict[str, Slot] = {}
    for w_start, w_end in work:
        cursor = w_start
        while cursor + duration <= w_end:
            start = minutes_to_time(cursor)
            end_minutes = cursor + duration

            # Never show times that already passed
            if not is_in_past(day, start, now):
                in_break = any(overlaps(cursor, end_minutes, b0, b1) for b0, b1 in breaks)
                booked = any(overlaps(cursor, end_minutes, b0, b1) for b0, b1 in busy)
                if not in_break:
                    label = hhmm(start)
                    result[label] = Slot(
                        time=label,
                        available=not booked,
                        reason="" if not booked else "booked",
                    )
            cursor += step

    return [result[key] for key in sorted(result)]


def get_available_slots(
    session: Session,
    *,
    staff_id: int,
    service_id: int,
    day: date,
    now: datetime | None = None,
) -> list[str]:
    """Only the free slots (what the user is allowed to book)."""
    return [s.time for s in build_day_slots(
        session, staff_id=staff_id, service_id=service_id, day=day, now=now
    ) if s.available]


def first_available_slot(
    session: Session, *, staff_id: int, service_id: int, day: date,
    now: datetime | None = None,
) -> time | None:
    slots = get_available_slots(
        session, staff_id=staff_id, service_id=service_id, day=day, now=now
    )
    if not slots:
        return None
    h, m = slots[0].split(":")
    return time(int(h), int(m))


def is_slot_available(
    session: Session,
    *,
    staff_id: int,
    service_id: int,
    day: date,
    start: time,
    now: datetime | None = None,
    ignore_appointment_id: int | None = None,
) -> bool:
    """Cheap availability check - always re-run right before inserting."""
    label = hhmm(start)
    return any(
        s.time == label and s.available
        for s in build_day_slots(
            session, staff_id=staff_id, service_id=service_id, day=day, now=now,
            ignore_appointment_id=ignore_appointment_id,
        )
    )


def bookable_dates(
    session: Session,
    *,
    staff_id: int,
    from_day: date,
    horizon_days: int,
    service_id: int | None = None,
) -> set[date]:
    """
    Which days of a month may be clicked in the calendar:
    future + not a holiday + the staff member actually works that day.
    """
    from datetime import timedelta

    allowed: set[date] = set()
    today = tehran_now().date()
    last = today + timedelta(days=horizon_days)
    cursor = max(from_day, today)
    while cursor <= last:
        if is_working_day(session, staff_id, cursor):
            allowed.add(cursor)
        cursor += timedelta(days=1)
    return allowed


def describe_day(session: Session, *, staff_id: int, service_id: int, day: date) -> str:
    """Short Persian summary used by the bot (e.g. for the waitlist prompt)."""
    slots = build_day_slots(
        session, staff_id=staff_id, service_id=service_id, day=day
    )
    if not slots:
        return f"تاریخ {to_jalali(day)} برای این کارشناس تعطیل است."
    free = sum(1 for s in slots if s.available)
    return f"تاریخ {to_jalali(day)}: {free} بازه آزاد از {len(slots)} بازه."
