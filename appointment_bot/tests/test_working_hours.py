"""ساعات کاری و زمان‌های استراحت (هفتگی، هفته ایرانی: شنبه = 0)."""

from __future__ import annotations

from datetime import time

import pytest

from database.models import WorkingHour
from services import staff_service
from services.staff_service import DEFAULT_HOURS, StaffError


def test_default_schedule_created(session):
    member = staff_service.create(session, name="کارشناس")
    hours = staff_service.working_hours(session, member.id)

    # شنبه تا چهارشنبه 8-18 و پنجشنبه 8-14 / جمعه تعطیل
    assert len(hours) == len(DEFAULT_HOURS) == 6
    assert all(h.is_active for h in hours)
    assert staff_service.working_hours_for_day(session, member.id, 6) is None
    assert staff_service.working_hours_for_day(session, member.id, 0).start_time == time(8, 0)
    assert staff_service.working_hours_for_day(session, member.id, 5).end_time == time(14, 0)


def test_default_breaks_created(session):
    member = staff_service.create(session, name="کارشناس")
    breaks = staff_service.breaks(session, member.id)
    assert len(breaks) == 6
    assert all(b.start_time == time(12, 0) and b.end_time == time(13, 0) for b in breaks)
    assert staff_service.breaks(session, member.id, 6) == []  # جمعه استراحت ندارد


def test_set_working_hours_upsert(session):
    member = staff_service.create(session, name="کارشناس")
    staff_service.set_working_hours(session, member.id, 0, time(9, 0), time(17, 0))
    staff_service.set_working_hours(session, member.id, 0, time(10, 0), time(16, 0))
    session.flush()

    rows = staff_service.working_hours(session, member.id)
    saturday = [h for h in rows if h.day_of_week == 0]
    assert len(saturday) == 1  # only one row per weekday
    assert saturday[0].start_time == time(10, 0)
    assert saturday[0].end_time == time(16, 0)


def test_start_must_be_before_end(session):
    member = staff_service.create(session, name="کارشناس")
    with pytest.raises(StaffError):
        staff_service.set_working_hours(session, member.id, 0, time(18, 0), time(9, 0))


def test_toggle_and_delete_working_hour(session):
    member = staff_service.create(session, name="کارشناس")
    row = staff_service.working_hours_for_day(session, member.id, 0)

    assert staff_service.toggle_working_hour(session, row.id) is False
    assert staff_service.working_hours_for_day(session, member.id, 0).is_active is False
    assert staff_service.toggle_working_hour(session, row.id) is True

    staff_service.delete_working_hour(session, row.id)
    session.flush()
    assert staff_service.working_hours_for_day(session, member.id, 0) is None


def test_breaks_crud(session):
    member = staff_service.create(session, name="کارشناس")
    day = 0
    break_row = staff_service.add_break(session, member.id, day, time(13, 0), time(14, 0))
    assert break_row in staff_service.breaks(session, member.id, day)

    assert staff_service.toggle_break(session, break_row.id) is False
    assert staff_service.toggle_break(session, break_row.id) is True

    with pytest.raises(StaffError):
        staff_service.add_break(session, member.id, day, time(15, 0), time(14, 0))

    staff_service.delete_break(session, break_row.id)
    session.flush()
    # only the default 12:00-13:00 break of that day is left
    remaining = staff_service.breaks(session, member.id, day)
    assert break_row not in remaining
    assert len(remaining) == 1
    assert remaining[0].start_time == time(12, 0)


def test_schedule_text_is_persian(session):
    member = staff_service.create(session, name="کارشناس")
    text = staff_service.schedule_text(session, member)
    assert "شنبه" in text and "جمعه" in text and "تعطیل" in text


def test_working_hour_unique_constraint(session):
    """UNIQUE (staff_id, day_of_week, start_time): one 08:00 row per weekday."""
    from sqlalchemy.exc import IntegrityError

    member = staff_service.create(session, name="کارشناس")
    session.commit()  # so the rollback below cannot erase the staff member

    with pytest.raises(IntegrityError):
        session.add(
            WorkingHour(
                staff_id=member.id,
                day_of_week=0,
                start_time=time(8, 0),
                end_time=time(18, 30),
            )
        )
        session.flush()
    session.rollback()

    # a different start time on the same weekday is perfectly fine
    session.add(
        WorkingHour(
            staff_id=member.id,
            day_of_week=0,
            start_time=time(9, 0),
            end_time=time(10, 0),
        )
    )
    session.flush()
