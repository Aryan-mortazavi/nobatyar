"""نوبت‌ها: ساخت، کد رهگیری، وضعیت‌ها، لغو، تغییر وقت و قوانین."""

from __future__ import annotations

import re
from datetime import datetime, time, timedelta

import pytest

from services import appointment_service, settings_service
from services.appointment_service import BookingError, SlotUnavailableError
from utils.calendar import tehran_now, tehran_today
from utils.constants import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_NO_SHOW,
)


def _book(session, team, start=time(9, 0), day=None, **kwargs):
    return appointment_service.create_appointment(
        session,
        user=team["user"],
        service_id=team["service"].id,
        staff_id=team["staff"].id,
        day=day or team["day"],
        start=start,
        **kwargs,
    )


def test_create_appointment(session, team):
    appointment = _book(session, team)
    session.commit()

    assert appointment.id is not None
    assert re.fullmatch(r"APT-\d{5}", appointment.tracking_code)
    assert appointment.status == STATUS_CONFIRMED  # auto_confirm = yes by default
    assert appointment.slot_key == (
        f"{team['staff'].id}:{team['day'].isoformat()}:09:00"
    )
    assert appointment.end_time == time(9, 30)  # 09:00 + 30 minutes
    assert appointment.reminder_24h_sent is False
    assert appointment.reminder_1h_sent is False


def test_tracking_codes_are_unique(session, team):
    first = _book(session, team, start=time(9, 0))
    second = _book(session, team, start=time(10, 0))
    assert first.tracking_code != second.tracking_code


def test_pending_status_when_auto_confirm_is_off(session, team):
    settings_service.set_setting(session, "auto_confirm", "no")
    appointment = _book(session, team)
    assert appointment.status == "pending"
    settings_service.set_setting(session, "auto_confirm", "yes")
    assert _book(session, team, start=time(11, 0)).status == STATUS_CONFIRMED


def test_booking_in_the_past_is_rejected(session, team):
    yesterday = tehran_today() - timedelta(days=1)
    with pytest.raises(SlotUnavailableError):
        _book(session, team, day=yesterday)


def test_booking_beyond_horizon_is_rejected(session, team):
    horizon = settings_service.get_max_days_ahead(session)
    too_far = tehran_today() + timedelta(days=horizon + 2)
    with pytest.raises(SlotUnavailableError) as exc:
        _book(session, team, day=too_far)
    assert "روز آینده" in str(exc.value)


def test_booking_outside_working_hours(session, team):
    with pytest.raises(SlotUnavailableError):
        _book(session, team, start=time(6, 0))


def test_staff_without_the_service_cannot_take_it(session, team):
    from services import service_service

    stranger = service_service.create(session, name="خدمت بیگانه", duration=30)
    with pytest.raises(BookingError) as exc:
        appointment_service.create_appointment(
            session,
            user=team["user"],
            service_id=stranger.id,
            staff_id=team["staff"].id,
            day=team["day"],
            start=time(9, 0),
        )
    assert "ارائه نمی‌دهد" in str(exc.value)


def test_inactive_participants_are_rejected(session, team):
    from services import service_service, staff_service

    staff_service.set_active(session, team["staff"], False)
    with pytest.raises(BookingError):
        _book(session, team)
    staff_service.set_active(session, team["staff"], True)

    service_service.set_active(session, team["service"], False)
    with pytest.raises(BookingError):
        _book(session, team)
    service_service.set_active(session, team["service"], True)


def test_status_changes_and_labels(session, team):
    appointment = _book(session, team)
    session.commit()

    appointment_service.confirm(session, appointment)
    assert appointment.status == STATUS_CONFIRMED

    appointment_service.set_status(session, appointment, STATUS_COMPLETED)
    assert appointment.status == STATUS_COMPLETED

    appointment_service.set_status(session, appointment, STATUS_NO_SHOW)
    assert appointment.status == STATUS_NO_SHOW

    with pytest.raises(BookingError):
        appointment_service.set_status(session, appointment, "unknown-status")


def test_cancel_frees_the_slot(session, team):
    appointment = _book(session, team)
    session.commit()
    assert appointment.slot_key is not None

    appointment_service.cancel(session, appointment)
    session.commit()
    assert appointment.status == STATUS_CANCELLED
    assert appointment.slot_key is None

    # the very same minute can be booked again after cancelling
    again = _book(session, team, start=time(9, 0))
    assert again.id != appointment.id
    assert again.slot_key is not None


def test_cannot_cancel_twice(session, team):
    appointment = _book(session, team)
    appointment_service.cancel(session, appointment)
    with pytest.raises(BookingError):
        appointment_service.cancel(session, appointment)


def test_cancellation_limit(session, team):
    appointment = _book(session, team)
    settings_service.set_setting(session, "cancellation_limit_hours", "48")

    allowed, message = appointment_service.can_cancel(session, appointment)
    assert allowed is False
    assert "48" in message

    settings_service.set_setting(session, "cancellation_limit_hours", "1")
    allowed, message = appointment_service.can_cancel(session, appointment)
    assert allowed is True
    assert message is None

    appointment_service.set_status(session, appointment, STATUS_COMPLETED)
    allowed, message = appointment_service.can_cancel(session, appointment)
    assert allowed is False


def test_reschedule_moves_the_appointment(session, team):
    old_day, old_start = team["day"], time(9, 0)
    appointment = _book(session, team, start=old_start, day=old_day)
    session.commit()

    new_start = time(14, 0)
    appointment_service.reschedule(session, appointment, day=old_day, start=new_start)
    session.commit()

    assert appointment.start_time == new_start
    assert appointment.end_time == time(14, 30)
    assert appointment.slot_key == (
        f"{team['staff'].id}:{old_day.isoformat()}:14:00"
    )

    from services import slot_service

    # the old minute is free again
    assert "09:00" in slot_service.get_available_slots(
        session,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=old_day,
    )


def test_reschedule_to_a_taken_slot_is_rejected(session, team):
    taken = _book(session, team, start=time(9, 0))
    other = _book(session, team, start=time(10, 0))
    session.commit()

    with pytest.raises(SlotUnavailableError):
        appointment_service.reschedule(session, other, day=team["day"], start=time(9, 0))


def test_cannot_reschedule_past_appointment(session, team):
    appointment = _book(session, team)
    with pytest.raises(BookingError):
        appointment_service.reschedule(
            session,
            appointment,
            day=team["day"],
            start=time(15, 0),
            now=datetime.combine(
                team["day"], time(23, 0), tzinfo=tehran_now().tzinfo
            ),
        )


def test_user_appointment_lists(session, team):
    future = _book(session, team, start=time(9, 0))
    session.commit()

    future_list = appointment_service.user_future_appointments(session, team["user"].id)
    assert [a.id for a in future_list] == [future.id]
    assert appointment_service.user_cancelled_appointments(session, team["user"].id) == []

    appointment_service.cancel(session, future)
    session.commit()
    assert appointment_service.user_future_appointments(session, team["user"].id) == []
    assert [a.id for a in appointment_service.user_cancelled_appointments(
        session, team["user"].id
    )] == [future.id]


def test_get_by_tracking_code(session, team):
    appointment = _book(session, team)
    session.commit()
    found = appointment_service.get_by_tracking(session, appointment.tracking_code)
    assert found.id == appointment.id
    assert appointment_service.get_by_tracking(session, "APT-00000") is None


def test_date_blocked_reason(session, team):
    from database.models import Holiday

    assert appointment_service.date_blocked_reason(
        session, team["staff"].id, tehran_today() - timedelta(days=1)
    )
    assert appointment_service.date_blocked_reason(
        session, team["staff"].id, tehran_today() + timedelta(days=60)
    )
    session.add(Holiday(date=team["day"], note=""))
    session.flush()
    assert "تعطیل" in appointment_service.date_blocked_reason(
        session, team["staff"].id, team["day"]
    )


def test_status_history_is_recorded(session, team):
    appointment = _book(session, team)
    appointment_service.set_status(session, appointment, STATUS_CANCELLED)
    session.commit()
    reloaded = appointment_service.get(session, appointment.id)
    assert reloaded.status == STATUS_CANCELLED
    assert reloaded.updated_at is not None
