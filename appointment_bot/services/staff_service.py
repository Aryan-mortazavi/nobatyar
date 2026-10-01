"""
Staff management: CRUD, service assignment, working hours and break times.

The weekly schedule (Persian week, Saturday = 0):
    0 شنبه ... 5 پنجشنبه, 6 جمعه
A missing or inactive WorkingHour row simply means "closed that day".
"""

from __future__ import annotations

from datetime import time

from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import Appointment, BreakTime, Service, Staff, WorkingHour

# Default schedule created for every new staff member
DEFAULT_HOURS: list[tuple[int, time, time]] = [
    (0, time(8, 0), time(18, 0)),   # شنبه
    (1, time(8, 0), time(18, 0)),   # یکشنبه
    (2, time(8, 0), time(18, 0)),   # دوشنبه
    (3, time(8, 0), time(18, 0)),   # سه‌شنبه
    (4, time(8, 0), time(18, 0)),   # چهارشنبه
    (5, time(8, 0), time(14, 0)),   # پنجشنبه
    # جمعه -> تعطیل (هیچ رکوردی ساخته نمی‌شود)
]
DEFAULT_BREAKS: list[tuple[int, time, time]] = [
    (day, time(12, 0), time(13, 0)) for day in range(6)
]


class StaffError(ValueError):
    """Raised for invalid staff operations (message is Persian)."""


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
def list_staff(
    session: Session,
    *,
    active_only: bool = False,
    service_id: int | None = None,
) -> list[Staff]:
    """All staff members, optionally only those providing one service."""
    stmt = select(Staff)
    if active_only:
        stmt = stmt.where(Staff.is_active.is_(True))
    stmt = stmt.order_by(Staff.id)
    staff = list(session.scalars(stmt))
    if service_id:
        staff = [
            member for member in staff
            if any(svc.id == service_id for svc in member.services)
        ]
    return staff


def get(session: Session, staff_id: int) -> Staff | None:
    return session.get(Staff, staff_id)


def get_active(session: Session, staff_id: int) -> Staff:
    staff = session.get(Staff, staff_id)
    if staff is None:
        raise StaffError("❌ کارشناس موردنظر یافت نشد.")
    if not staff.is_active:
        raise StaffError("❌ این کارشناس در حال حاضر غیرفعال است.")
    return staff


def create(
    session: Session,
    *,
    name: str,
    specialty: str = "",
    phone: str = "",
    is_active: bool = True,
    is_demo: bool = False,
    with_default_schedule: bool = True,
) -> Staff:
    """Create a staff member (a default weekly schedule is added)."""
    name = name.strip()
    if not name:
        raise StaffError("❌ نام کارشناس نمی‌تواند خالی باشد.")

    staff = Staff(
        name=name, specialty=specialty.strip(), phone=phone.strip(),
        is_active=is_active, is_demo=is_demo,
    )
    session.add(staff)
    session.flush()

    if with_default_schedule:
        create_default_schedule(session, staff.id)
    return staff


def update(session: Session, staff: Staff, **fields) -> Staff:
    """Update name / specialty / phone / is_active."""
    if "name" in fields and fields["name"]:
        staff.name = fields["name"].strip()
    if "specialty" in fields and fields["specialty"] is not None:
        staff.specialty = fields["specialty"].strip()
    if "phone" in fields and fields["phone"] is not None:
        staff.phone = fields["phone"].strip()
    if "is_active" in fields and fields["is_active"] is not None:
        staff.is_active = bool(fields["is_active"])
    session.flush()
    return staff


def set_active(session: Session, staff: Staff, active: bool) -> None:
    staff.is_active = active
    session.flush()


def delete(session: Session, staff: Staff) -> None:
    """
    Delete a staff member (blocked while it still has appointments).

    The guard is a plain SELECT: sessions do not expire objects on commit, so
    a cached ``staff.appointments`` collection could be stale.
    """
    from database.models import Appointment, StaffService

    used = session.scalar(
        select(Appointment.id).where(Appointment.staff_id == staff.id).limit(1)
    )
    if used is not None:
        raise StaffError(
            "❌ برای این کارشناس نوبت ثبت شده است؛ ابتدا او را غیرفعال کنید."
        )
    # relationships use cascade="all, delete-orphan" -> hours/breaks go with it
    session.execute(
        sa_delete(StaffService).where(StaffService.staff_id == staff.id)
    )
    staff.services.clear()  # keep the in-memory collection in sync
    session.delete(staff)
    session.flush()


# ---------------------------------------------------------------------------
# Staff <-> service assignment
# ---------------------------------------------------------------------------
def services_of(session: Session, staff_id: int) -> list[Service]:
    staff = session.get(Staff, staff_id)
    if staff is None:
        return []
    # reload: the collection may have been loaded before another request
    session.refresh(staff, attribute_names=["services"])
    return list(staff.services)


def assign_services(session: Session, staff: Staff, service_ids: list[int]) -> None:
    """Replace the service list of a staff member."""
    wanted = [s for s in session.scalars(select(Service).where(Service.id.in_(service_ids)))]
    session.refresh(staff, attribute_names=["services"])  # never diff against a stale list
    staff.services = wanted
    session.flush()


def toggle_service(session: Session, staff: Staff, service_id: int) -> bool:
    """Add / remove one service. Returns True when it is now assigned."""
    service = session.get(Service, service_id)
    if service is None:
        raise StaffError("❌ خدمت موردنظر یافت نشد.")
    session.refresh(staff, attribute_names=["services"])
    if service in staff.services:
        staff.services.remove(service)
        assigned = False
    else:
        staff.services.append(service)
        assigned = True
    session.flush()
    return assigned


# ---------------------------------------------------------------------------
# Working hours
# ---------------------------------------------------------------------------
def working_hours(session: Session, staff_id: int) -> list[WorkingHour]:
    rows = session.scalars(
        select(WorkingHour).where(WorkingHour.staff_id == staff_id)
    ).all()
    return sorted(rows, key=lambda h: h.day_of_week)


def working_hours_for_day(session: Session, staff_id: int, day_of_week: int) -> WorkingHour | None:
    return session.scalar(
        select(WorkingHour).where(
            WorkingHour.staff_id == staff_id,
            WorkingHour.day_of_week == day_of_week,
        )
    )


def set_working_hours(
    session: Session,
    staff_id: int,
    day_of_week: int,
    start: time,
    end: time,
    *,
    is_active: bool = True,
) -> WorkingHour:
    """Create or update the working interval of one weekday (upsert)."""
    if start >= end:
        raise StaffError("❌ ساعت شروع باید قبل از ساعت پایان باشد.")
    row = working_hours_for_day(session, staff_id, day_of_week)
    if row is None:
        row = WorkingHour(
            staff_id=staff_id, day_of_week=day_of_week,
            start_time=start, end_time=end, is_active=is_active,
        )
        session.add(row)
    else:
        row.start_time = start
        row.end_time = end
        row.is_active = is_active
    session.flush()
    return row


def toggle_working_hour(session: Session, hour_id: int) -> bool:
    """Enable / disable one weekday. Returns the new is_active value."""
    row = session.get(WorkingHour, hour_id)
    if row is None:
        raise StaffError("❌ ساعات کاری یافت نشد.")
    row.is_active = not row.is_active
    session.flush()
    return row.is_active


def delete_working_hour(session: Session, hour_id: int) -> None:
    """Removing the row closes that weekday."""
    row = session.get(WorkingHour, hour_id)
    if row is not None:
        session.delete(row)
        session.flush()


def create_default_schedule(session: Session, staff_id: int) -> None:
    """Sat-Thu 08:00-18:00 (Thursday until 14:00) + 12:00-13:00 break."""
    for day, start, end in DEFAULT_HOURS:
        session.add(
            WorkingHour(
                staff_id=staff_id, day_of_week=day,
                start_time=start, end_time=end, is_active=True,
            )
        )
    for day, start, end in DEFAULT_BREAKS:
        session.add(
            BreakTime(
                staff_id=staff_id, day_of_week=day,
                start_time=start, end_time=end, is_active=True,
            )
        )
    session.flush()


# ---------------------------------------------------------------------------
# Breaks
# ---------------------------------------------------------------------------
def breaks(session: Session, staff_id: int, day_of_week: int | None = None) -> list[BreakTime]:
    stmt = select(BreakTime).where(BreakTime.staff_id == staff_id)
    if day_of_week is not None:
        stmt = stmt.where(BreakTime.day_of_week == day_of_week)
    rows = session.scalars(stmt).all()
    return sorted(rows, key=lambda b: (b.day_of_week, b.start_time))


def add_break(
    session: Session, staff_id: int, day_of_week: int, start: time, end: time
) -> BreakTime:
    if start >= end:
        raise StaffError("❌ ساعت شروع استراحت باید قبل از ساعت پایان باشد.")
    row = BreakTime(
        staff_id=staff_id, day_of_week=day_of_week,
        start_time=start, end_time=end, is_active=True,
    )
    session.add(row)
    session.flush()
    return row


def delete_break(session: Session, break_id: int) -> None:
    row = session.get(BreakTime, break_id)
    if row is not None:
        session.delete(row)
        session.flush()


def toggle_break(session: Session, break_id: int) -> bool:
    row = session.get(BreakTime, break_id)
    if row is None:
        raise StaffError("❌ زمان استراحت یافت نشد.")
    row.is_active = not row.is_active
    session.flush()
    return row.is_active


def schedule_text(session: Session, staff: Staff) -> str:
    """Human readable weekly schedule (used in the admin panels)."""
    from utils.constants import PERSIAN_DAYS

    rows = {h.day_of_week: h for h in working_hours(session, staff.id)}
    lines = []
    for day_index, day_name in enumerate(PERSIAN_DAYS):
        row = rows.get(day_index)
        if row is None or not row.is_active:
            lines.append(f"  {day_name}: تعطیل")
            continue
        lines.append(
            f"  {day_name}: {row.start_time.strftime('%H:%M')} تا "
            f"{row.end_time.strftime('%H:%M')}"
        )
    return "\n".join(lines)
