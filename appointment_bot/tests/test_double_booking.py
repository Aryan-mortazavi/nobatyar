"""
جلوگیری از رزرو هم‌زمان (double booking) - سه لایه محافظت:

    1. بررسی دوباره در دسترس بودن بازه، داخل همان تراکنش
    2. ایندکس UNIQUE روی appointments.slot_key در خود دیتابیس
    3. تبدیل IntegrityError به پیام فارسی برای کاربر

این تست‌ها هر سه لیست و همچنین رقابت هم‌زمان (چند نخ) را پوشش می‌دهند.
"""

from __future__ import annotations

import threading
from datetime import time, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from database.models import Appointment
from database.session import session_scope
from services import appointment_service, service_service, staff_service, user_service
from services.appointment_service import SlotUnavailableError
from utils.calendar import tehran_today


def _setup(session):
    """A user, a service and a staff member (committed)."""
    user, _ = user_service.get_or_create(
        session, telegram_id=777000, first_name="رقابت", phone="09120000000"
    )
    service = service_service.create(session, name="خدمت رقابتی", duration=30)
    member = staff_service.create(session, name="کارشناس رقابت")
    staff_service.assign_services(session, member, [service.id])
    session.commit()

    day = tehran_today()
    for _ in range(10):
        day = day + timedelta(days=1)
        if day.weekday() != 4:
            break
    return user, service, member, day


def _book(session, user, service, member, day, start):
    return appointment_service.create_appointment(
        session,
        user=user,
        service_id=service.id,
        staff_id=member.id,
        day=day,
        start=start,
    )


# ---------------------------------------------------------------------------
# 1) availability re-check inside the transaction
# ---------------------------------------------------------------------------
def test_second_booking_of_the_same_minute_is_rejected(session):
    user, service, member, day = _setup(session)

    first = _book(session, user, service, member, day, time(9, 0))
    session.commit()
    assert first.slot_key is not None

    with pytest.raises(SlotUnavailableError) as exc:
        _book(session, user, service, member, day, time(9, 0))
    assert "رزرو" in str(exc.value)  # Persian message, never an SQL error


def test_overlapping_window_is_rejected(session):
    user, service, member, day = _setup(session)
    _book(session, user, service, member, day, time(9, 0))
    session.commit()

    with pytest.raises(SlotUnavailableError):
        _book(session, user, service, member, day, time(9, 15))


# ---------------------------------------------------------------------------
# 2) the database itself refuses a duplicate slot_key
# ---------------------------------------------------------------------------
def test_unique_index_rejects_duplicate_slot_key(session):
    user, service, member, day = _setup(session)
    _book(session, user, service, member, day, time(9, 0))
    session.commit()

    key = Appointment.build_slot_key(member.id, day, time(9, 0))
    session.add(
        Appointment(
            user_id=user.id,
            staff_id=member.id,
            service_id=service.id,
            date=day,
            start_time=time(9, 0),
            end_time=time(9, 30),
            status="confirmed",
            tracking_code="APT-99999",
            slot_key=key,
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_cancelled_appointment_does_not_hold_the_slot(session):
    """slot_key becomes NULL on cancel -> the same minute may be booked again."""
    user, service, member, day = _setup(session)
    first = _book(session, user, service, member, day, time(9, 0))
    session.commit()

    appointment_service.cancel(session, first)
    session.commit()
    assert first.slot_key is None

    second = _book(session, user, service, member, day, time(9, 0))
    session.commit()
    assert second.id != first.id


# ---------------------------------------------------------------------------
# 3) IntegrityError is converted into a Persian user message
# ---------------------------------------------------------------------------
def test_integrity_error_becomes_persian_message(session, monkeypatch):
    user, service, member, day = _setup(session)
    _book(session, user, service, member, day, time(9, 0))
    session.commit()

    # simulate the race: validation happened BEFORE the competing booking
    def fake_validate(sess, *, user, service, staff, day, start, now=None, **kwargs):
        # the booking was checked BEFORE the competing request arrived
        from datetime import time as time_type

        return time_type(start.hour, (start.minute + service.duration) % 60)

    monkeypatch.setattr(appointment_service, "validate_booking", fake_validate)

    with pytest.raises(SlotUnavailableError) as exc:
        _book(session, user, service, member, day, time(9, 0))
    message = str(exc.value)
    assert "هم‌زمان" in message
    assert "انتخاب کنید" in message


# ---------------------------------------------------------------------------
# real concurrency: several threads book the same minute
# ---------------------------------------------------------------------------
def test_concurrent_bookings_only_one_wins(db):
    from datetime import timedelta

    with session_scope() as session:
        user, service, member, day = _setup(session)
        user_id, service_id, member_id = user.id, service.id, member.id
        day = day

    results: list[object] = []
    barrier = threading.Barrier(4)

    def worker():
        try:
            barrier.wait(timeout=10)
            with session_scope() as worker_session:
                from database.models import User

                worker_user = worker_session.get(User, user_id)
                appointment = appointment_service.create_appointment(
                    worker_session,
                    user=worker_user,
                    service_id=service_id,
                    staff_id=member_id,
                    day=day,
                    start=time(9, 0),
                )
                results.append(("ok", appointment.id))
        except SlotUnavailableError as exc:  # expected for the losers
            results.append(("busy", str(exc)))
        except Exception as exc:  # noqa: BLE001
            results.append(("error", f"{type(exc).__name__}: {exc}"))

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    wins = [item for item in results if item[0] == "ok"]
    errors = [item for item in results if item[0] == "error"]
    assert not errors, errors
    assert len(wins) == 1, results
    assert len(results) == 4

    # exactly one row really exists in the database
    with session_scope() as session:
        from sqlalchemy import select

        rows = list(
            session.scalars(
                select(Appointment).where(
                    Appointment.staff_id == member_id,
                    Appointment.date == day,
                    Appointment.status != "cancelled",
                )
            )
        )
        assert len(rows) == 1
        assert rows[0].start_time == time(9, 0)
