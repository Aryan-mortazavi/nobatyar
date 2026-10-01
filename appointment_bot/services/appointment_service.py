"""
Appointment business rules: create, confirm, cancel, reschedule.

Double-booking prevention (three layers):
  1. availability re-check inside the same transaction (slot_service)
  2. UNIQUE database constraint on appointments.slot_key
  3. IntegrityError is converted to a friendly Persian message

Even if two requests arrive at exactly the same moment, only one of them can
commit - the second one fails at the database level.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database.models import (
    Appointment,
    Holiday,
    Staff,
    StaffService,
    Service,
    User,
    Waitlist,
)
from services import service_service, settings_service, slot_service, staff_service
from utils.calendar import tehran_now, to_jalali
from utils.constants import (
    ACTIVE_STATUSES,
    APPOINTMENT_STATUSES,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_NO_SHOW,
    STATUS_PENDING,
)
from utils.helpers import appointment_datetime, hhmm, tracking_code

logger = logging.getLogger(__name__)


class BookingError(Exception):
    """Any business rule violation. ``str(e)`` is a Persian user message."""


class SlotUnavailableError(BookingError):
    """The requested slot is gone (past, booked, holiday, out of hours...)."""


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_booking(
    session: Session,
    *,
    user: User,
    service: Service,
    staff: Staff,
    day: date,
    start: time,
    now: datetime | None = None,
    ignore_appointment_id: int | None = None,
) -> time:
    """
    Run every booking rule. Returns the calculated end time.

    :param ignore_appointment_id: when rescheduling, this appointment is
        allowed to keep its own slot (it will be moved).
    :raises SlotUnavailableError / BookingError with a Persian message.
    """
    now = now or tehran_now()

    # --- participants -----------------------------------------------------
    if not user.is_active:
        raise BookingError("❌ حساب کاربری شما غیرفعال است.")
    if not service.is_active:
        raise BookingError("❌ خدمت انتخاب‌شده دیگر فعال نیست.")
    if not staff.is_active:
        raise BookingError("❌ کارشناس انتخاب‌شده فعال نیست.")
    # A cached ``staff.services`` collection can go stale (sessions never expire
    # objects on commit) -> ask the database instead of the object graph.
    provides = session.scalar(
        select(StaffService.service_id).where(
            StaffService.staff_id == staff.id,
            StaffService.service_id == service.id,
        )
    )
    if provides is None:
        raise BookingError("❌ این کارشناس خدمت انتخاب‌شده را ارائه نمی‌دهد.")

    # --- date rules -------------------------------------------------------
    today = now.date()
    if day < today:
        raise SlotUnavailableError("❌ تاریخ گذشته قابل رزرو نیست.")
    horizon = settings_service.get_max_days_ahead(session)
    if day > today + timedelta(days=horizon):
        raise SlotUnavailableError(
            f"❌ حداکثر {horizon} روز آینده قابل رزرو است."
        )
    if session.scalar(select(Holiday).where(Holiday.date == day)):
        raise SlotUnavailableError("🚫 این تاریخ تعطیل است.")

    # --- time rules (working hours / breaks / past / already booked) ------
    if not slot_service.is_slot_available(
        session, staff_id=staff.id, service_id=service.id, day=day, start=start, now=now
    ):
        if day == today and appointment_datetime(day, start) <= now:
            raise SlotUnavailableError("❌ این ساعت از امروز گذشته است.")
        raise SlotUnavailableError(
            "⛔ این بازه زمانی رزرو شده یا خارج از ساعات کاری است."
        )

    end = _calculate_end(service, start)

    # Extra safety: make sure no other appointment overlaps this window
    conflict = find_conflict(
        session, staff_id=staff.id, day=day, start=start, end=end,
        ignore_appointment_id=ignore_appointment_id,
    )
    if conflict is not None:
        raise SlotUnavailableError("⛔ این بازه زمانی هم‌زمان رزرو شده است.")

    return end


def _calculate_end(service: Service, start: time) -> time:
    """end = start + service.duration (the duration is expressed in minutes)."""
    total = start.hour * 60 + start.minute + max(int(service.duration or 0), 1)
    total %= 24 * 60
    return time(hour=total // 60, minute=total % 60)


def find_conflict(
    session: Session,
    *,
    staff_id: int,
    day: date,
    start: time,
    end: time,
    ignore_appointment_id: int | None = None,
) -> Appointment | None:
    """Existing non-cancelled appointment that overlaps the requested window."""
    stmt = select(Appointment).where(
        Appointment.staff_id == staff_id,
        Appointment.date == day,
        Appointment.status != STATUS_CANCELLED,
    )
    rows = session.scalars(stmt).all()
    start_min = start.hour * 60 + start.minute
    end_min = end.hour * 60 + end.minute
    if end_min <= start_min:  # crosses midnight (should not happen normally)
        end_min = 24 * 60
    for appt in rows:
        if ignore_appointment_id and appt.id == ignore_appointment_id:
            continue
        a_start = appt.start_time.hour * 60 + appt.start_time.minute
        a_end = appt.end_time.hour * 60 + appt.end_time.minute
        if a_end <= a_start:
            a_end = 24 * 60
        if start_min < a_end and a_start < end_min:
            return appt
    return None


# ---------------------------------------------------------------------------
# Tracking code
# ---------------------------------------------------------------------------
def _unique_tracking_code(session: Session) -> str:
    """Generate APT-XXXXX that does not exist yet."""
    for _ in range(20):
        code = tracking_code()
        exists = session.scalar(
            select(Appointment.id).where(Appointment.tracking_code == code)
        )
        if exists is None:
            return code
    raise BookingError("❌ خطا در تولید کد رهگیری؛ دوباره تلاش کنید.")


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------
def create_appointment(
    session: Session,
    *,
    user: User,
    service_id: int,
    staff_id: int,
    day: date,
    start: time,
    note: str = "",
    now: datetime | None = None,
) -> Appointment:
    """
    Create an appointment after re-validating availability.

    :raises SlotUnavailableError when the slot is no longer free (this is the
        user-visible result of a racing double booking attempt).
    """
    try:
        service = service_service.get_active(session, service_id)
        staff = staff_service.get_active(session, staff_id)
    except ValueError as exc:  # ServiceError / StaffError -> BookingError
        # so every booking entry point only has to handle one exception type
        raise BookingError(str(exc)) from exc

    end = validate_booking(
        session, user=user, service=service, staff=staff, day=day, start=start, now=now
    )

    status = (
        STATUS_CONFIRMED
        if settings_service.is_setting_true(session, "auto_confirm", default=True)
        else STATUS_PENDING
    )

    appointment = Appointment(
        user_id=user.id,
        staff_id=staff.id,
        service_id=service.id,
        date=day,
        start_time=start,
        end_time=end,
        status=status,
        tracking_code=_unique_tracking_code(session),
        slot_key=Appointment.build_slot_key(staff.id, day, start),
        note=note,
    )
    session.add(appointment)
    try:
        session.flush()
    except IntegrityError:
        # Layer 2/3: the UNIQUE index on slot_key rejected the duplicate.
        session.rollback()
        logger.warning("Double booking blocked for staff=%s %s %s", staff.id, day, start)
        raise SlotUnavailableError(
            "⛔ این بازه زمانی هم‌زمان توسط کاربر دیگری رزرو شد. "
            "لطفاً ساعت دیگری انتخاب کنید."
        )

    logger.info(
        "Appointment created: %s by user=%s staff=%s %s %s",
        appointment.tracking_code, user.telegram_id, staff.id, day, hhmm(start),
    )
    _mark_waitlist_booked(session, user_id=user.id, staff_id=staff.id, day=day, start=start)
    return appointment


def _mark_waitlist_booked(
    session: Session, *, user_id: int, staff_id: int, day: date, start: time
) -> None:
    """The user got the slot he was waiting for -> close his waitlist rows."""
    rows = session.scalars(
        select(Waitlist).where(
            Waitlist.user_id == user_id,
            Waitlist.staff_id == staff_id,
            Waitlist.date == day,
            Waitlist.status.in_(("pending", "notified")),
        )
    ).all()
    for row in rows:
        row.status = "booked"


# ---------------------------------------------------------------------------
# Status changes
# ---------------------------------------------------------------------------
def set_status(session: Session, appointment: Appointment, status: str) -> Appointment:
    """
    Change the status (used by the admin panel).

    Cancelling frees the slot (slot_key -> NULL) which is exactly what makes
    the time bookable again and lets the waitlist system kick in.
    """
    if status not in APPOINTMENT_STATUSES:
        raise BookingError("❌ وضعیت نامعتبر است.")
    if appointment.status == STATUS_CANCELLED and status != STATUS_CANCELLED:
        if appointment.slot_key is None:
            # re-occupying a freed slot must respect the unique constraint
            appointment.slot_key = Appointment.build_slot_key(
                appointment.staff_id, appointment.date, appointment.start_time
            )
    appointment.status = status
    if status == STATUS_CANCELLED:
        appointment.slot_key = None
    session.flush()
    logger.info("Appointment %s -> %s", appointment.tracking_code, status)
    return appointment


def confirm(session: Session, appointment: Appointment) -> Appointment:
    return set_status(session, appointment, STATUS_CONFIRMED)


def cancel(session: Session, appointment: Appointment) -> Appointment:
    """Cancel an appointment and free its slot."""
    if appointment.status == STATUS_CANCELLED:
        raise BookingError("❌ این نوبت قبلاً لغو شده است.")
    result = set_status(session, appointment, STATUS_CANCELLED)
    logger.info("Appointment cancelled: %s", appointment.tracking_code)
    return result


def can_cancel(session: Session, appointment: Appointment) -> tuple[bool, str | None]:
    """
    Cancellation window rule (configurable in admin settings).

    :return: (allowed, persian_error_message)
    """
    if appointment.status in (STATUS_CANCELLED, STATUS_COMPLETED, STATUS_NO_SHOW):
        return False, "❌ فقط نوبت‌های آینده قابل لغو هستند."
    limit = settings_service.get_cancellation_limit_hours(session)
    starts_at = appointment_datetime(appointment.date, appointment.start_time)
    remaining_hours = (starts_at - tehran_now()).total_seconds() / 3600
    if remaining_hours < limit:
        return False, (
            f"❌ به دلیل کمتر بودن از {limit} ساعت تا زمان نوبت، "
            "امکان لغو وجود ندارد."
        )
    return True, None


def can_reschedule(session: Session, appointment: Appointment) -> tuple[bool, str | None]:
    """Rescheduling is only allowed for future, active appointments."""
    if appointment.status in (STATUS_CANCELLED, STATUS_COMPLETED, STATUS_NO_SHOW):
        return False, "❌ فقط نوبت‌های آینده قابل تغییر هستند."
    starts_at = appointment_datetime(appointment.date, appointment.start_time)
    if starts_at <= tehran_now():
        return False, "❌ این نوبت گذشته است و قابل تغییر نیست."
    return True, None


def date_blocked_reason(session: Session, staff_id: int, day: date) -> str | None:
    """
    Why a date may not be picked in the calendar (None = bookable).
    Used before showing the time slots so the user never reaches a dead end.
    """
    today = tehran_now().date()
    if day < today:
        return "❌ تاریخ گذشته قابل رزرو نیست."
    horizon = settings_service.get_max_days_ahead(session)
    if day > today + timedelta(days=horizon):
        return f"❌ حداکثر {horizon} روز آینده قابل رزرو است."
    if session.scalar(select(Holiday).where(Holiday.date == day)):
        return "🚫 این تاریخ تعطیل است."
    if not slot_service.is_working_day(session, staff_id, day):
        return "🚫 در این تاریخ کارشناس فعالیت ندارد."
    return None


# ---------------------------------------------------------------------------
# Reschedule
# ---------------------------------------------------------------------------
def reschedule(
    session: Session,
    appointment: Appointment,
    *,
    day: date,
    start: time,
    now: datetime | None = None,
) -> tuple[Appointment, date, time]:
    """
    Move an appointment to a new slot.

    :return: (appointment, old_day, old_start) - the old slot is freed and the
        new one is reserved inside a single UPDATE statement.
    """
    allowed, message = can_reschedule(session, appointment)
    if not allowed:
        raise BookingError(message or "❌ امکان تغییر وقت نوبت وجود ندارد.")

    service = session.get(Service, appointment.service_id)
    staff = session.get(Staff, appointment.staff_id)
    user = session.get(User, appointment.user_id)
    if service is None or staff is None or user is None:
        raise BookingError("❌ اطلاعات نوبت ناقص است.")

    old_day, old_start = appointment.date, appointment.start_time
    end = validate_booking(
        session, user=user, service=service, staff=staff, day=day, start=start,
        now=now, ignore_appointment_id=appointment.id,
    )

    appointment.date = day
    appointment.start_time = start
    appointment.end_time = end
    appointment.slot_key = Appointment.build_slot_key(staff.id, day, start)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise SlotUnavailableError(
            "⛔ بازه جدید هم‌زمان توسط کاربر دیگری رزرو شد. ساعت دیگری انتخاب کنید."
        )

    logger.info(
        "Appointment rescheduled: %s %s %s -> %s %s",
        appointment.tracking_code, to_jalali(old_day), hhmm(old_start),
        to_jalali(day), hhmm(start),
    )
    return appointment, old_day, old_start


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------
def get(session: Session, appointment_id: int) -> Appointment | None:
    return session.get(Appointment, appointment_id)


def get_by_tracking(session: Session, code: str) -> Appointment | None:
    return session.scalar(
        select(Appointment).where(Appointment.tracking_code == code.strip())
    )


def user_future_appointments(session: Session, user_id: int) -> list[Appointment]:
    """Upcoming active appointments of a user (soonest first)."""
    today = tehran_now().date()
    rows = session.scalars(
        select(Appointment).where(
            Appointment.user_id == user_id,
            Appointment.date >= today,
            Appointment.status.in_(ACTIVE_STATUSES),
        )
    ).all()
    rows = [a for a in rows if appointment_datetime(a.date, a.start_time) > tehran_now()]
    return sorted(rows, key=lambda a: (a.date, a.start_time))


def user_past_appointments(session: Session, user_id: int) -> list[Appointment]:
    """Finished appointments (completed / no-show / old confirmed)."""
    rows = session.scalars(
        select(Appointment).where(
            Appointment.user_id == user_id,
            Appointment.status.in_((STATUS_COMPLETED, STATUS_NO_SHOW)),
        )
    ).all()
    rows += [
        a
        for a in session.scalars(
            select(Appointment).where(
                Appointment.user_id == user_id,
                Appointment.status.in_(ACTIVE_STATUSES),
            )
        ).all()
        if appointment_datetime(a.date, a.start_time) <= tehran_now()
    ]
    return sorted(rows, key=lambda appt: (appt.date, appt.start_time), reverse=True)


def user_cancelled_appointments(session: Session, user_id: int) -> list[Appointment]:
    rows = session.scalars(
        select(Appointment).where(
            Appointment.user_id == user_id,
            Appointment.status == STATUS_CANCELLED,
        )
    ).all()
    return sorted(rows, key=lambda a: (a.date, a.start_time), reverse=True)
