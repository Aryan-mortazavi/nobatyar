"""ساخت پویای بازه‌های زمانی: ساعات کاری − استراحت − رزرو شده − زمان گذشته."""

from __future__ import annotations

from datetime import datetime, time, timedelta

from services import appointment_service, service_service, slot_service, staff_service
from utils.calendar import tehran_now, tehran_today


def _future_datetime(day, hour=6, minute=0):
    """A 'now' early enough in the day so no slot is filtered as past."""
    return datetime.combine(day, time(hour, minute), tzinfo=tehran_now().tzinfo)


def test_slots_follow_working_hours_and_duration(session, team):
    day = team["day"]
    slots = slot_service.build_day_slots(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=day,
        now=_future_datetime(day),
    )
    labels = [s.time for s in slots]

    # 08:00-18:00 minus the 12:00-13:00 break, 30 minute steps
    assert labels[0] == "08:00"
    assert "12:00" not in labels and "12:30" not in labels
    assert "13:00" in labels
    assert all(s.available for s in slots)
    # every start time is a multiple of the service duration from 08:00
    minutes = [int(h) * 60 + int(m) for h, m in (lab.split(":") for lab in labels)]
    assert all((value - 8 * 60) % team["service"].duration == 0 for value in minutes)
    # the 12:00-13:00 break is the only gap
    gaps = [b - a for a, b in zip(minutes, minutes[1:])]
    assert max(gaps) == team["service"].duration + 60


def test_duration_controls_the_step(session, team):
    day = team["day"]
    service_service.update(session, team["service"], duration=60)
    session.flush()
    labels = slot_service.get_available_slots(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=day,
        now=_future_datetime(day),
    )
    minutes = [int(h) * 60 + int(m) for h, m in (lab.split(":") for lab in labels)]
    # one hour after the previous start (the break only adds a bigger gap)
    assert all((value - 8 * 60) % 60 == 0 for value in minutes)
    assert "12:00" not in labels and "13:00" in labels


def test_break_time_is_removed(session, team):
    day = team["day"]
    labels = slot_service.get_available_slots(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=day,
        now=_future_datetime(day),
    )
    # 11:30-12:00 is fine, 12:00-13:00 is the break
    assert "11:30" in labels
    assert not any("12:00" <= label < "13:00" for label in labels)


def test_booked_slot_becomes_locked(session, team):
    day = team["day"]
    appointment_service.create_appointment(
        session,
        user=team["user"],
        service_id=team["service"].id,
        staff_id=team["staff"].id,
        day=day,
        start=time(10, 0),
    )
    session.commit()

    slots = slot_service.build_day_slots(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=day,
        now=_future_datetime(day),
    )
    by_time = {s.time: s for s in slots}
    assert by_time["10:00"].available is False
    assert by_time["10:00"].locked is True
    assert by_time["10:30"].available is True  # the booking ends at 10:30
    assert by_time["11:00"].available is True
    assert "10:00" not in slot_service.get_available_slots(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=day,
        now=_future_datetime(day),
    )


def test_past_slots_are_hidden(session, team):
    day = team["day"]
    now = _future_datetime(day, hour=9, minute=15)
    labels = slot_service.get_available_slots(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=day,
        now=now,
    )
    assert "08:00" not in labels
    assert "09:30" in labels
    assert "18:00" not in labels  # last slot starts at 17:30


def test_closed_weekday_has_no_slots(session, team):
    day = team["day"]
    # find the next Friday (default schedule = closed)
    friday = day + timedelta(days=1)
    while friday.weekday() != 4:
        friday += timedelta(days=1)
    staff_service.set_working_hours(session, team["staff"].id, 6, time(8, 0), time(18, 0),
                                    is_active=False)
    assert slot_service.build_day_slots(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=friday,
    ) == []


def test_holiday_returns_no_slots(session, team):
    from database.models import Holiday

    day = team["day"]
    session.add(Holiday(date=day, note="تعطیل رسمی"))
    session.flush()
    assert slot_service.build_day_slots(
        session, staff_id=team["staff"].id, service_id=team["service"].id, day=day
    ) == []
    assert slot_service.is_holiday(session, day) is True
    assert slot_service.is_working_day(session, team["staff"].id, day) is False


def test_bookable_dates_excludes_holidays_and_past(session, team):
    from database.models import Holiday

    day = team["day"]
    session.add(Holiday(date=day + timedelta(days=2), note=""))
    session.flush()

    allowed = slot_service.bookable_dates(
        session,
        staff_id=team["staff"].id,
        from_day=tehran_today(),
        horizon_days=7,
        service_id=team["service"].id,
    )
    assert day in allowed
    assert day + timedelta(days=2) not in allowed
    # today stays clickable: the user may book a later hour today
    assert tehran_today() in allowed
    # جمعه (Friday) is closed by the default schedule -> never bookable
    friday = tehran_today()
    while friday.weekday() != 4:
        friday += timedelta(days=1)
    assert friday not in allowed


def test_is_slot_available(session, team):
    day = team["day"]
    now = _future_datetime(day)
    assert slot_service.is_slot_available(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=day,
        start=time(9, 0),
        now=now,
    ) is True
    assert slot_service.is_slot_available(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=day,
        start=time(12, 15),  # inside the break
        now=now,
    ) is False


def test_describe_day_is_persian(session, team):
    text = slot_service.describe_day(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=team["day"],
    )
    assert "بازه" in text
