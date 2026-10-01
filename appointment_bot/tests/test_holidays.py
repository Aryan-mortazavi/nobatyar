"""تعطیلات: مسدود کردن کل یک روز و باز شدن دوباره آن."""

from __future__ import annotations

from datetime import time, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from database.models import Holiday
from services import appointment_service, slot_service
from services.appointment_service import SlotUnavailableError


def test_holiday_blocks_the_whole_day(session, team):
    day = team["day"]
    assert slot_service.build_day_slots(
        session, staff_id=team["staff"].id, service_id=team["service"].id, day=day
    ) != []

    session.add(Holiday(date=day, note="تعطیل رسمی"))
    session.flush()

    assert slot_service.build_day_slots(
        session, staff_id=team["staff"].id, service_id=team["service"].id, day=day
    ) == []
    assert slot_service.get_available_slots(
        session, staff_id=team["staff"].id, service_id=team["service"].id, day=day
    ) == []

    with pytest.raises(SlotUnavailableError) as exc:
        appointment_service.create_appointment(
            session,
            user=team["user"],
            service_id=team["service"].id,
            staff_id=team["staff"].id,
            day=day,
            start=time(9, 0),
        )
    assert "تعطیل" in str(exc.value)

    assert "تعطیل" in appointment_service.date_blocked_reason(
        session, team["staff"].id, day
    )


def test_removing_the_holiday_opens_the_day_again(session, team):
    day = team["day"]
    holiday = Holiday(date=day, note="")
    session.add(holiday)
    session.flush()

    assert slot_service.is_holiday(session, day) is True
    session.delete(holiday)
    session.flush()

    assert slot_service.is_holiday(session, day) is False
    assert slot_service.get_available_slots(
        session, staff_id=team["staff"].id, service_id=team["service"].id, day=day
    ) != []


def test_holiday_date_is_unique(session):
    """Two holidays can never exist for the same date (DB level)."""
    from datetime import date as date_type

    day = date_type(2100, 1, 1)
    session.add(Holiday(date=day, note="اول"))
    session.flush()

    session.add(Holiday(date=day, note="دوم"))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_holiday_has_no_effect_on_other_days(session, team):
    from database.models import Holiday

    day = team["day"]
    session.add(Holiday(date=day + timedelta(days=1), note=""))
    session.flush()

    assert slot_service.get_available_slots(
        session, staff_id=team["staff"].id, service_id=team["service"].id, day=day
    ) != []
    assert slot_service.get_available_slots(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=day + timedelta(days=1),
    ) == []
