"""لیست انتظار: عضویت، پیشنهاد بازه آزاد پس از لغو، وضعیت‌ها و انقضا."""

from __future__ import annotations

from datetime import time, timedelta

import pytest

from services import appointment_service, waitlist_service
from services.waitlist_service import WaitlistError
from utils.calendar import tehran_today


def test_join_waitlist(session, team):
    entry, created = waitlist_service.add(
        session,
        user_id=team["user"].id,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=team["day"],
        preferred_time=time(10, 0),
    )
    session.flush()
    assert created is True
    assert entry.status == "pending"
    assert entry.preferred_time == time(10, 0)


def test_join_twice_updates_the_same_row(session, team):
    first, created = waitlist_service.add(
        session,
        user_id=team["user"].id,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=team["day"],
    )
    second, created_again = waitlist_service.add(
        session,
        user_id=team["user"].id,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=team["day"],
        preferred_time=time(11, 0),
    )
    assert created is True
    assert created_again is False
    assert first.id == second.id
    assert second.preferred_time == time(11, 0)


def test_status_validation(session, team):
    entry, _ = waitlist_service.add(
        session,
        user_id=team["user"].id,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=team["day"],
    )
    waitlist_service.set_status(session, entry, "notified")
    session.flush()
    assert entry.status == "notified"

    with pytest.raises(WaitlistError):
        waitlist_service.set_status(session, entry, "whatever")


def test_pending_for_day_is_sorted_by_preferred_time(session, team):
    from services import user_service

    other_user, _ = user_service.get_or_create(
        session, telegram_id=888777, first_name="دوم"
    )
    waitlist_service.add(
        session, user_id=team["user"].id, staff_id=team["staff"].id,
        service_id=team["service"].id, day=team["day"], preferred_time=time(15, 0),
    )
    waitlist_service.add(
        session, user_id=other_user.id, staff_id=team["staff"].id,
        service_id=team["service"].id, day=team["day"], preferred_time=time(9, 0),
    )
    session.flush()

    rows = waitlist_service.pending_for_day(session, team["staff"].id, team["day"])
    assert [r.preferred_time for r in rows] == [time(9, 0), time(15, 0)]


def test_cancellation_offers_the_freed_slot(session, team):
    appointment = appointment_service.create_appointment(
        session,
        user=team["user"],
        service_id=team["service"].id,
        staff_id=team["staff"].id,
        day=team["day"],
        start=time(9, 0),
    )
    session.commit()

    waiter, _ = waitlist_service.add(
        session,
        user_id=team["user"].id,
        staff_id=team["staff"].id,
        service_id=team["service"].id,
        day=team["day"],
        preferred_time=time(9, 0),
    )
    session.commit()

    # the preferred slot is busy -> it is not offered yet (other free
    # minutes of that day are, and that is correct)
    offers_before = waitlist_service.offers_for_cancellation(
        session, staff_id=team["staff"].id, day=team["day"]
    )
    assert all(free_time != time(9, 0) for _, free_time in offers_before)

    appointment_service.cancel(session, appointment)
    session.commit()

    offers = waitlist_service.offers_for_cancellation(
        session, staff_id=team["staff"].id, day=team["day"]
    )
    assert len(offers) == 1
    entry, free_time = offers[0]
    assert entry.id == waiter.id
    assert free_time == time(9, 0)


def test_offer_goes_to_a_different_user(session, team):
    from services import user_service

    appointment = appointment_service.create_appointment(
        session,
        user=team["user"],
        service_id=team["service"].id,
        staff_id=team["staff"].id,
        day=team["day"],
        start=time(9, 0),
    )
    other, _ = user_service.get_or_create(
        session, telegram_id=555444, first_name="انتظار"
    )
    waitlist_service.add(
        session, user_id=other.id, staff_id=team["staff"].id,
        service_id=team["service"].id, day=team["day"], preferred_time=time(9, 0),
    )
    session.commit()

    appointment_service.cancel(session, appointment)
    session.commit()

    offers = waitlist_service.offers_for_cancellation(
        session, staff_id=team["staff"].id, day=team["day"]
    )
    assert [entry.user_id for entry, _ in offers] == [other.id]


def test_booking_marks_waitlist_entry_as_booked(session, team):
    from services import user_service

    waiter, _ = user_service.get_or_create(
        session, telegram_id=999111, first_name="صبر"
    )
    waitlist_service.add(
        session, user_id=waiter.id, staff_id=team["staff"].id,
        service_id=team["service"].id, day=team["day"], preferred_time=time(9, 0),
    )
    session.commit()

    appointment_service.create_appointment(
        session,
        user=waiter,
        service_id=team["service"].id,
        staff_id=team["staff"].id,
        day=team["day"],
        start=time(9, 0),
    )
    session.commit()

    entries = waitlist_service.list_entries(session, day=team["day"])
    assert len(entries) == 1
    assert entries[0].status == "booked"


def test_expire_old_entries(session, team):
    from services import user_service

    old_day = team["day"] - timedelta(days=3)
    user, _ = user_service.get_or_create(session, telegram_id=121212, first_name="قدیمی")
    waitlist_service.add(
        session, user_id=user.id, staff_id=team["staff"].id,
        service_id=team["service"].id, day=old_day,
    )
    session.commit()

    assert waitlist_service.expire_old_entries(session) == 1
    session.commit()
    entry = waitlist_service.list_entries(session)[0]
    assert entry.status == "expired"


def test_remove_entry(session, team):
    entry, _ = waitlist_service.add(
        session, user_id=team["user"].id, staff_id=team["staff"].id,
        service_id=team["service"].id, day=team["day"],
    )
    session.flush()
    waitlist_service.remove(session, entry)
    session.flush()
    assert waitlist_service.get(session, entry.id) is None
