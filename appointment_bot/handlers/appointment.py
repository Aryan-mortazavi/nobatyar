"""
Appointment booking flow (FSM).

    📝 رزرو نوبت
    -> select service -> select staff -> pick a Jalali date
    -> pick a time slot -> confirm -> appointment created

Every step provides 🔙 بازگشت (previous step) and ❌ انصراف (leave the flow),
so the user can never get stuck.
"""

from __future__ import annotations

import logging
from datetime import date, time

import jdatetime
from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from database.session import session_scope
from handlers.common import require_registered, safe_int
from handlers.states import Booking
from keyboards import inline_keyboard as inline
from services import (
    appointment_service,
    notification_service,
    service_service,
    settings_service,
    slot_service,
    staff_service,
    user_service,
    waitlist_service,
)
from services.appointment_service import BookingError
from utils.calendar import (
    day_name,
    month_title,
    tehran_now,
    to_jalali,
)
from utils.constants import BTN_BACK, BTN_BOOK, DIVIDER
from utils.helpers import hhmm, jalali_ym, minutes_to_time, price_text, time_to_minutes

router = Router(name="appointment")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
async def _edit(message: Message, text: str, reply_markup=None) -> None:
    """Edit in place, ignoring the harmless 'message is not modified' error."""
    try:
        await message.edit_text(text, reply_markup=reply_markup)
    except Exception:  # noqa: BLE001 - Telegram errors must not break a flow
        logger.debug("edit_text skipped", exc_info=True)


async def _expired(callback: CallbackQuery) -> bool:
    """Tell the user the button is too old (stale FSM state)."""
    await callback.answer(
        "⌛ این گزینه منقضی شده است. لطفاً دوباره از منو انتخاب کنید.",
        show_alert=True,
    )
    return False


def _parse_slot(raw: str) -> time | None:
    """'0930' -> 09:30"""
    raw = raw.strip()
    if len(raw) != 4 or not raw.isdigit():
        return None
    hour, minute = int(raw[:2]), int(raw[2:])
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute)


def _month_days(bookable: set[date], year: int, month: int) -> set[date]:
    """Bookable days that belong to the requested Jalali month."""
    return {
        day
        for day in bookable
        if (jdatetime.date.fromgregorian(date=day).year,
            jdatetime.date.fromgregorian(date=day).month) == (year, month)
    }


# ---------------------------------------------------------------------------
# Step renderers
# ---------------------------------------------------------------------------
async def show_services(message: Message, state: FSMContext) -> None:
    """Step 1 - list every active service."""
    with session_scope() as session:
        services = service_service.list_services(session, active_only=True)
    if not services:
        await message.answer("فعلاً خدمتی برای رزرو تعریف نشده است. لطفاً بعداً تلاش کنید.")
        return
    await state.set_state(Booking.service)
    await message.answer(
        "🛠 لطفاً خدمت مورد نظر خود را انتخاب کنید:",
        reply_markup=inline.services(services),
    )


async def _show_staff(callback: CallbackQuery, state: FSMContext, service_id: int) -> None:
    with session_scope() as session:
        service = service_service.get_active(session, service_id)
        staff_list = service_service.staff_for_service(session, service_id)

    if not staff_list:
        await callback.answer(
            "برای این خدمت فعلاً کارشناسی تعیین نشده است.", show_alert=True
        )
        return

    # Render the keyboard FIRST: if anything raises, the FSM still matches the
    # message that is on screen (otherwise the next tap reports "expired").
    markup = inline.staff(staff_list)
    await state.update_data(service_id=service.id, service_name=service.name)
    await state.set_state(Booking.staff)
    await _edit(
        callback.message,
        f"🛠 خدمت: {service.name}\n\n🧑‍💼 کارشناس مورد نظر را انتخاب کنید:",
        reply_markup=markup,
    )
    await callback.answer()


async def _show_calendar(
    target: Message, state: FSMContext, year: int, month: int, *, answer: CallbackQuery | None = None
) -> None:
    """Step 3 - Jalali month view with only bookable days rendered."""
    data = await state.get_data()
    staff_id = safe_int(data.get("staff_id"), 0) or 0

    with session_scope() as session:
        bookable = slot_service.bookable_dates(
            session,
            staff_id=staff_id,
            from_day=tehran_now().date(),
            horizon_days=settings_service.get_max_days_ahead(session),
        )

    # Build the keyboard before touching the FSM (see _show_staff).
    markup = inline.calendar(year, month, _month_days(bookable, year, month))

    await state.set_state(Booking.date)
    await _edit(
        target,
        "📅 تاریخ نوبت خود را انتخاب کنید:\n"
        f"ماه {month_title(year, month)}\n\n"
        "روزهای گذشته، تعطیل و بدون کارشناس نمایش داده نمی‌شوند.",
        reply_markup=markup,
    )
    if answer is not None:
        await answer.answer()


async def _show_slots(target: Message, state: FSMContext, day: date) -> None:
    """Step 4 - free slots of the chosen day (full ones are marked 🔒)."""
    data = await state.get_data()
    with session_scope() as session:
        slots = slot_service.build_day_slots(
            session,
            staff_id=safe_int(data.get("staff_id"), 0) or 0,
            service_id=safe_int(data.get("service_id"), 0) or 0,
            day=day,
        )

    if not slots:
        await _edit(target, "🚫 در این تاریخ ساعت خالی وجود ندارد.")
        return

    free = [s.time for s in slots if s.available]
    text = (
        f"⏰ ساعت‌های {to_jalali(day)} ({day_name(day)})\n\n"
        + ("، ".join(free) if free else "هیچ بازه آزادی باقی نمانده است.")
        + "\n\n🔒 = رزرو شده (برای پیوستن به لیست انتظار روی آن بزنید)"
    )
    markup = inline.slots(slots)
    await state.set_state(Booking.time)
    await _edit(target, text, reply_markup=markup)


async def _offer_waitlist(target: Message, state: FSMContext, preferred: time) -> None:
    await state.update_data(preferred_time=preferred.strftime("%H:%M"))
    await _edit(
        target,
        "⛔ این بازه زمانی پر است.\n\n"
        "آیا می‌خواهید به لیست انتظار بپیوندید تا در صورت آزاد شدن ساعت "
        "به شما اطلاع داده شود؟",
        reply_markup=inline.waitlist_prompt(),
    )


async def show_summary(
    target: Message, state: FSMContext, start: time, telegram_id: int
) -> None:
    """Step 5 - the confirmation screen from the requirements."""
    data = await state.get_data()
    day = date.fromisoformat(data["date_iso"])
    with session_scope() as session:
        service = service_service.get(session, safe_int(data.get("service_id"), 0) or 0)
        staff = staff_service.get(session, safe_int(data.get("staff_id"), 0) or 0)
        user = user_service.get_by_telegram(session, telegram_id)

    end = minutes_to_time(time_to_minutes(start) + (service.duration if service else 0))
    price_line = (
        f"💰 قیمت (فقط اطلاع‌رسانی): {price_text(service.price)}\n" if service and service.price else ""
    )

    text = (
        f"{DIVIDER}\n📅 جزئیات نوبت\n{DIVIDER}\n"
        f"👤 کاربر: {user.full_name if user else '—'}\n"
        f"🛠 خدمت: {service.name if service else '—'}\n"
        f"🧑‍💼 کارشناس: {staff.name if staff else '—'}\n"
        f"📅 تاریخ: {to_jalali(day)} ({day_name(day)})\n"
        f"⏰ ساعت: {hhmm(start)} - {hhmm(end)}\n"
        f"{price_line}"
        f"{DIVIDER}\n\nآیا اطلاعات درست است؟"
    )
    markup = inline.confirm("book:confirm")
    await state.update_data(start_time=start.strftime("%H:%M"))
    await state.set_state(Booking.confirm)
    await _edit(target, text, reply_markup=markup)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
@router.message(F.text == BTN_BOOK)
async def booking_start(message: Message, state: FSMContext) -> None:
    """📝 رزرو نوبت from the main menu."""
    user = await require_registered(message, state)
    if user is None:
        return
    await show_services(message, state)


# ---------------------------------------------------------------------------
# Step 1 -> 2: service -> staff
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("book:service:"))
async def on_select_service(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Booking.service.state:
        await _expired(callback)
        return
    service_id = safe_int(callback.data.split(":")[2])
    if service_id is None:
        await _expired(callback)
        return
    try:
        await _show_staff(callback, state, service_id)
    except (BookingError, ValueError) as exc:  # BookingError | ServiceError
        await callback.answer(str(exc), show_alert=True)


# ---------------------------------------------------------------------------
# Step 2 -> 3: staff -> calendar
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("book:staff:"))
async def on_select_staff(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Booking.staff.state:
        await _expired(callback)
        return
    staff_id = safe_int(callback.data.split(":")[2])
    if staff_id is None:
        await _expired(callback)
        return
    try:
        with session_scope() as session:
            member = staff_service.get_active(session, staff_id)
    except (BookingError, ValueError) as exc:  # BookingError | StaffError
        await callback.answer(str(exc), show_alert=True)
        return

    await state.update_data(staff_id=member.id, staff_name=member.name)
    year, month = jalali_ym(tehran_now().date())
    await _show_calendar(callback.message, state, year, month, answer=callback)


# ---------------------------------------------------------------------------
# Step 3: Jalali calendar
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("cal:nav:"))
async def on_calendar_nav(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Booking.date.state:
        await _expired(callback)
        return
    parts = callback.data.split(":")  # cal:nav:<year>:<month>
    year, month = safe_int(parts[2]), safe_int(parts[3])
    if year is None or month is None or not 1 <= month <= 12:
        await _expired(callback)
        return
    await _show_calendar(callback.message, state, year, month, answer=callback)


@router.callback_query(F.data.startswith("cal:day:"))
async def on_calendar_day(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Booking.date.state:
        await _expired(callback)
        return
    parts = callback.data.split(":")  # cal:day:<year>:<month>:<day>
    year, month, day_number = (safe_int(p) for p in parts[2:5])
    if None in (year, month, day_number):
        await _expired(callback)
        return

    try:
        day = jdatetime.date(year, month, day_number).togregorian()
    except ValueError:
        await callback.answer("❌ تاریخ نامعتبر است.", show_alert=True)
        return

    data = await state.get_data()
    staff_id = safe_int(data.get("staff_id"), 0) or 0
    with session_scope() as session:
        reason = appointment_service.date_blocked_reason(session, staff_id, day)
    if reason:
        await callback.answer(reason, show_alert=True)
        return

    await state.update_data(date_iso=day.isoformat())
    await _show_slots(callback.message, state, day)
    await callback.answer()


# ---------------------------------------------------------------------------
# Step 4: time slots
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("slotfull:"))
async def on_locked_slot(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Booking.time.state:
        await _expired(callback)
        return
    slot = _parse_slot(callback.data.split(":", 1)[1])
    if slot is None:
        await _expired(callback)
        return
    await _offer_waitlist(callback.message, state, slot)
    await callback.answer("⛔ این بازه رزرو شده است.", show_alert=True)


@router.callback_query(F.data.startswith("slot:"))
async def on_select_slot(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Booking.time.state:
        await _expired(callback)
        return
    slot = _parse_slot(callback.data.split(":", 1)[1])
    if slot is None:
        await _expired(callback)
        return

    data = await state.get_data()
    day = date.fromisoformat(data.get("date_iso", tehran_now().date().isoformat()))
    with session_scope() as session:
        available = slot_service.is_slot_available(
            session,
            staff_id=safe_int(data.get("staff_id"), 0) or 0,
            service_id=safe_int(data.get("service_id"), 0) or 0,
            day=day,
            start=slot,
        )
    if not available:
        await _offer_waitlist(callback.message, state, slot)
        await callback.answer("⛔ این بازه رزرو شده است.", show_alert=True)
        return

    await show_summary(callback.message, state, slot, callback.from_user.id)
    await callback.answer()


# ---------------------------------------------------------------------------
# Waitlist
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("wl:"))
async def on_waitlist_choice(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Booking.time.state:
        await _expired(callback)
        return
    choice = callback.data.split(":")[1]
    data = await state.get_data()
    day = date.fromisoformat(data.get("date_iso", tehran_now().date().isoformat()))

    if choice == "no":
        await _show_slots(callback.message, state, day)
        await callback.answer()
        return

    preferred = data.get("preferred_time", "")
    try:
        preferred_time = time.fromisoformat(preferred) if preferred else None
    except ValueError:
        preferred_time = None

    with session_scope() as session:
        user = user_service.get_by_telegram(session, callback.from_user.id)
        if user is None:
            await callback.answer("❌ ابتدا ثبت‌نام کنید.", show_alert=True)
            return
        waitlist_service.add(
            session,
            user_id=user.id,
            staff_id=safe_int(data.get("staff_id"), 0) or 0,
            service_id=safe_int(data.get("service_id"), 0) or 0,
            day=day,
            preferred_time=preferred_time,
        )

    await state.clear()
    await _edit(
        callback.message,
        "⏳ شما به لیست انتظار پیوستید.\n"
        "در صورت آزاد شدن یک بازه، پیامی دریافت خواهید کرد.",
        reply_markup=inline.back_to_menu(),
    )
    await callback.answer("✅ عضویت در لیست انتظار انجام شد.")


# ---------------------------------------------------------------------------
# Step 5: confirmation -> appointment created
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("book:confirm:"))
async def on_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Booking.confirm.state:
        await _expired(callback)
        return
    choice = callback.data.split(":")[2]

    if choice == "no":
        await state.clear()
        await _edit(callback.message, "❌ رزرو نوبت لغو شد.", reply_markup=inline.back_to_menu())
        await callback.answer()
        return

    data = await state.get_data()
    if not data.get("date_iso") or not data.get("start_time"):
        await _expired(callback)
        return
    day = date.fromisoformat(data["date_iso"])
    start = time.fromisoformat(data["start_time"])

    with session_scope() as session:
        user = user_service.get_by_telegram(session, callback.from_user.id)
        if user is None:
            await callback.answer("❌ ابتدا ثبت‌نام کنید.", show_alert=True)
            return
        try:
            appointment = appointment_service.create_appointment(
                session,
                user=user,
                service_id=safe_int(data.get("service_id"), 0) or 0,
                staff_id=safe_int(data.get("staff_id"), 0) or 0,
                day=day,
                start=start,
            )
            text = notification_service.appointment_created_text(session, appointment)
            chat_id = user.telegram_id
        except (BookingError, ValueError) as exc:
            error_message = str(exc)
            appointment = None
        except Exception:
            logger.exception("Booking failed")
            error_message = "❌ خطای غیرمنتظره رخ داد. لطفاً دوباره تلاش کنید."
            appointment = None

    if appointment is None:
        await callback.answer(error_message, show_alert=True)
        await _show_slots(callback.message, state, day)
        return

    # The confirmation message itself is the notification (no duplicate text)
    notification_service.record_delivered(chat_id, text, "appointment_created")
    await state.clear()
    await _edit(callback.message, text, reply_markup=inline.back_to_menu())
    await callback.answer("✅ نوبت شما ثبت شد.")


# ---------------------------------------------------------------------------
# ⏳ waitlist offer: "رزرو این ساعت" button inside the notification message
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("wlbook:"))
async def on_waitlist_offer(callback: CallbackQuery, state: FSMContext) -> None:
    entry_id = safe_int(callback.data.split(":")[1])
    if entry_id is None:
        await _expired(callback)
        return

    with session_scope() as session:
        entry = waitlist_service.get(session, entry_id)
        if entry is None:
            await callback.answer("❌ این فرصت دیگر معتبر نیست.", show_alert=True)
            return
        user = user_service.get_by_telegram(session, callback.from_user.id)
        if user is None or entry.user_id != user.id:
            await callback.answer("❌ شما مجوز این عملیات را ندارید.", show_alert=True)
            return
        if entry.status not in ("pending", "notified"):
            await callback.answer("❌ این فرصت منقضی شده است.", show_alert=True)
            return

        free = slot_service.get_available_slots(
            session,
            staff_id=entry.staff_id,
            service_id=entry.service_id,
            day=entry.date,
        )
        chosen: time | None = None
        if entry.preferred_time is not None and hhmm(entry.preferred_time) in free:
            chosen = entry.preferred_time
        elif free:
            chosen = time.fromisoformat(free[0])

        if chosen is None:
            waitlist_service.set_status(session, entry, "expired")
            await callback.answer("⌛ متأسفانه این بازه نیز پر شد.", show_alert=True)
            return
        service_id, staff_id, day = entry.service_id, entry.staff_id, entry.date

    # Reuse the normal confirmation step of the booking flow
    await state.set_state(Booking.confirm)
    await state.update_data(
        service_id=service_id,
        staff_id=staff_id,
        date_iso=day.isoformat(),
        start_time=chosen.strftime("%H:%M"),
    )
    await show_summary(callback.message, state, chosen, callback.from_user.id)
    await callback.answer("✅ یک بازه آزاد شد!")


# ---------------------------------------------------------------------------
# 🔙 بازگشت -> previous step
# ---------------------------------------------------------------------------
@router.message(Booking.staff, StateFilter(Booking.staff), F.text == BTN_BACK)
async def back_to_services(message: Message, state: FSMContext) -> None:
    await show_services(message, state)


@router.message(Booking.date, StateFilter(Booking.date), F.text == BTN_BACK)
async def back_to_staff(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    service_id = safe_int(data.get("service_id"), 0) or 0
    with session_scope() as session:
        staff_list = service_service.staff_for_service(session, service_id)
    if not staff_list:
        await show_services(message, state)
        return
    await state.set_state(Booking.staff)
    await message.answer(
        "🧑‍💼 کارشناس مورد نظر را انتخاب کنید:",
        reply_markup=inline.staff(staff_list),
    )


@router.message(Booking.time, StateFilter(Booking.time), F.text == BTN_BACK)
async def back_to_calendar(message: Message, state: FSMContext) -> None:
    year, month = jalali_ym(tehran_now().date())
    data = await state.get_data()
    staff_id = safe_int(data.get("staff_id"), 0) or 0
    with session_scope() as session:
        bookable = slot_service.bookable_dates(
            session,
            staff_id=staff_id,
            from_day=tehran_now().date(),
            horizon_days=settings_service.get_max_days_ahead(session),
        )
    await state.set_state(Booking.date)
    await message.answer(
        f"📅 تاریخ نوبت خود را انتخاب کنید ({month_title(year, month)}):",
        reply_markup=inline.calendar(year, month, _month_days(bookable, year, month)),
    )


@router.message(Booking.confirm, StateFilter(Booking.confirm), F.text == BTN_BACK)
async def back_to_slots(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    if not data.get("date_iso"):
        await show_services(message, state)
        return
    await _show_slots(message, state, date.fromisoformat(data["date_iso"]))
