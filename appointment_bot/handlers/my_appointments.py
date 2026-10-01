"""
"📅 نوبت‌های من" / "❌ لغو نوبت" / "🔄 تغییر وقت نوبت"

    tabs (Upcoming / Past / Cancelled) with pagination
    -> appointment detail
    -> cancel (respecting the configurable time limit)
    -> reschedule (new date + new time, availability re-checked again)

Every action verifies that the appointment belongs to the caller - a user can
never touch somebody else's appointment.
"""

from __future__ import annotations

import logging
from datetime import date, time

import jdatetime
from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.models import Appointment, User
from database.session import session_scope
from handlers.common import require_registered, safe_int
from handlers.states import Reschedule
from keyboards import inline_keyboard as inline
from services import (
    appointment_service,
    notification_service,
    settings_service,
    slot_service,
    user_service,
)
from services.appointment_service import BookingError
from utils.calendar import day_name, month_title, tehran_now, to_jalali
from utils.helpers import jalali_ym
from utils.constants import (
    BTN_BACK,
    BTN_CANCEL_APPOINTMENT,
    BTN_MY_APPOINTMENTS,
    BTN_RESCHEDULE,
    DIVIDER,
    PAGE_SIZE_TELEGRAM,
    STATUS_LABELS_FA,
    TAB_CANCELLED,
    TAB_LABELS_FA,
    TAB_PAST,
    TAB_UPCOMING,
)
from utils.helpers import hhmm, paginate

router = Router(name="my_appointments")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# List (tabs + pagination)
# ---------------------------------------------------------------------------
def _items_for(session, user_id: int, tab: str) -> list[Appointment]:
    if tab == TAB_PAST:
        return appointment_service.user_past_appointments(session, user_id)
    if tab == TAB_CANCELLED:
        return appointment_service.user_cancelled_appointments(session, user_id)
    return appointment_service.user_future_appointments(session, user_id)


def build_list(user_id: int, tab: str, page: int) -> tuple[str, object]:
    """(text, keyboard) of one tab - shared by messages and callbacks."""
    with session_scope() as session:
        items = _items_for(session, user_id, tab)
    result = paginate(items, page, PAGE_SIZE_TELEGRAM)

    lines = [
        f"📅 نوبت‌های من — {TAB_LABELS_FA[tab]}",
        f"({result.start_index}-{result.end_index} از {result.total})",
        "",
    ]
    buttons: list[list[InlineKeyboardButton]] = []
    for appt in result.items:
        lines.append(
            f"• {to_jalali(appt.date)} ساعت {hhmm(appt.start_time)}\n"
            f"  🔑 {appt.tracking_code} | 📌 "
            f"{STATUS_LABELS_FA.get(appt.status, appt.status)}"
        )
        buttons.append([
            InlineKeyboardButton(
                text=f"{to_jalali(appt.date)} | {hhmm(appt.start_time)} | {appt.tracking_code}",
                callback_data=f"appt:{appt.id}",
            )
        ])
    if not result.items:
        lines.append("موردی برای نمایش وجود ندارد.")

    buttons.append(_tabs_row(tab))
    buttons.extend(_pager(f"my:{tab}", result.page, result.total_pages))
    return "\n".join(lines), inline.from_rows(buttons)


def _tabs_row(tab: str) -> list[InlineKeyboardButton]:
    return [
        InlineKeyboardButton(
            text=("✅ " if key == tab else "") + TAB_LABELS_FA[key],
            callback_data=f"my:{key}:1",
        )
        for key in (TAB_UPCOMING, TAB_PAST, TAB_CANCELLED)
    ]


def _pager(prefix: str, page: int, total_pages: int) -> list[list[InlineKeyboardButton]]:
    row: list[InlineKeyboardButton] = []
    if page > 1:
        row.append(InlineKeyboardButton(text="⬅️ قبلی", callback_data=f"{prefix}:{page - 1}"))
    row.append(InlineKeyboardButton(text=f"صفحه {page}/{total_pages}", callback_data="noop"))
    if page < total_pages:
        row.append(InlineKeyboardButton(text="بعدی ➡️", callback_data=f"{prefix}:{page + 1}"))
    return [row]


async def _send_list(
    message: Message, state: FSMContext, tab: str, intro: str | None = None
) -> None:
    user = await require_registered(message, state)
    if user is None:
        return
    text, keyboard = build_list(user.id, tab, 1)
    await message.answer((intro + "\n\n" if intro else "") + text, reply_markup=keyboard)


@router.message(F.text == BTN_MY_APPOINTMENTS)
async def my_appointments(message: Message, state: FSMContext) -> None:
    await _send_list(message, state, TAB_UPCOMING)


@router.message(F.text == BTN_CANCEL_APPOINTMENT)
async def cancel_entry(message: Message, state: FSMContext) -> None:
    await _send_list(
        message, state, TAB_UPCOMING,
        intro="برای لغو، ابتدا نوبت موردنظر را از لیست انتخاب کنید:",
    )


@router.message(F.text == BTN_RESCHEDULE)
async def reschedule_entry(message: Message, state: FSMContext) -> None:
    await _send_list(
        message, state, TAB_UPCOMING,
        intro="برای تغییر وقت، ابتدا نوبت موردنظر را انتخاب کنید:",
    )


@router.callback_query(F.data.startswith("my:"))
async def on_tab(callback: CallbackQuery) -> None:
    parts = callback.data.split(":")  # my:<tab>:<page>
    if len(parts) != 3:
        await callback.answer()
        return
    tab, page = parts[1], safe_int(parts[2], 1) or 1
    if tab not in (TAB_UPCOMING, TAB_PAST, TAB_CANCELLED):
        await callback.answer()
        return

    with session_scope() as session:
        user = user_service.get_by_telegram(session, callback.from_user.id)
    if user is None:
        await callback.answer("❌ ابتدا ثبت‌نام کنید.", show_alert=True)
        return

    text, keyboard = build_list(user.id, tab, page)
    try:
        await callback.message.edit_text(text, reply_markup=keyboard)
    except Exception:  # noqa: BLE001 - 'message is not modified' is harmless
        logger.debug("list edit skipped", exc_info=True)
    await callback.answer()


# ---------------------------------------------------------------------------
# Appointment detail
# ---------------------------------------------------------------------------
def build_detail(appt_id: int) -> tuple[str, object] | None:
    with session_scope() as session:
        appt = appointment_service.get(session, appt_id)
        if appt is None:
            return None
        owner = session.get(User, appt.user_id)
        text = (
            f"{DIVIDER}\n📅 جزئیات نوبت\n{DIVIDER}\n"
            f"👤 کاربر: {owner.full_name if owner else '—'}\n"
            f"🛠 خدمت: {appt.service.name}\n"
            f"🧑‍💼 کارشناس: {appt.staff.name}\n"
            f"📅 تاریخ: {to_jalali(appt.date)} ({day_name(appt.date)})\n"
            f"⏰ ساعت: {hhmm(appt.start_time)} - {hhmm(appt.end_time)}\n"
            f"🔑 کد رهگیری: {appt.tracking_code}\n"
            f"📌 وضعیت: {STATUS_LABELS_FA.get(appt.status, appt.status)}\n"
            f"{DIVIDER}"
        )
        can_cancel, _ = appointment_service.can_cancel(session, appt)
        can_reschedule, _ = appointment_service.can_reschedule(session, appt)
        keyboard = inline.appointment_actions(
            appt.id, can_cancel=can_cancel, can_reschedule=can_reschedule
        )
    return text, keyboard


def _load_own(telegram_id: int, appt_id: int) -> Appointment | None:
    """Return the appointment only when it belongs to this Telegram user."""
    with session_scope() as session:
        user = user_service.get_by_telegram(session, telegram_id)
        if user is None:
            return None
        appt = appointment_service.get(session, appt_id)
        if appt is None or appt.user_id != user.id:
            return None
        # touch the relationships while the session is still open
        _ = (appt.service.name, appt.staff.name, appt.user.full_name)
        return appt


@router.callback_query(F.data.startswith("appt:"))
async def on_appointment_action(callback: CallbackQuery, state: FSMContext) -> None:
    """
    Callback formats:
        appt:<id>                -> detail view
        appt:cancelask:<id>      -> "are you sure?"
        appt:cancel:<id>:yes|no  -> execute / abort the cancellation
        appt:resched:<id>        -> start the reschedule flow
    """
    parts = callback.data.split(":")
    if len(parts) == 2:
        appt_id = safe_int(parts[1])
        if appt_id is None:
            await callback.answer()
            return
        await _show_detail(callback, appt_id)
        return

    action = parts[1]
    appt_id = safe_int(parts[2]) if len(parts) > 2 else None
    if appt_id is None:
        await callback.answer()
        return

    if action == "cancelask":
        await _ask_cancel(callback, appt_id)
    elif action == "cancel" and len(parts) == 4:
        await _do_cancel(callback, appt_id, parts[3] == "yes")
    elif action == "resched":
        await _start_reschedule(callback, state, appt_id)
    else:
        await callback.answer()


async def _show_detail(callback: CallbackQuery, appt_id: int) -> None:
    built = build_detail(appt_id)
    if built is None:
        await callback.answer("❌ نوبت یافت نشد.", show_alert=True)
        return
    text, keyboard = built
    try:
        await callback.message.edit_text(text, reply_markup=keyboard)
    except Exception:  # noqa: BLE001
        logger.debug("detail edit skipped", exc_info=True)
    await callback.answer()


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------
async def _ask_cancel(callback: CallbackQuery, appt_id: int) -> None:
    snapshot = _load_own(callback.from_user.id, appt_id)
    if snapshot is None:
        await callback.answer("❌ شما مجوز این عملیات را ندارید.", show_alert=True)
        return
    with session_scope() as session:
        appt = appointment_service.get(session, appt_id)
        allowed, error = appointment_service.can_cancel(session, appt)
    if not allowed:
        await callback.answer(error, show_alert=True)
        return

    await callback.message.edit_text(
        "❓ آیا از لغو این نوبت مطمئن هستید؟\n\n"
        f"📅 {to_jalali(snapshot.date)} ساعت {hhmm(snapshot.start_time)}\n"
        f"🔑 {snapshot.tracking_code}",
        reply_markup=inline.confirm(
            f"appt:cancel:{appt_id}", yes="✅ بله، لغو شود", no="❌ خیر"
        ),
    )
    await callback.answer()


async def _do_cancel(callback: CallbackQuery, appt_id: int, confirmed: bool) -> None:
    if not confirmed:
        await _show_detail(callback, appt_id)
        return

    with session_scope() as session:
        user = user_service.get_by_telegram(session, callback.from_user.id)
        appt = appointment_service.get(session, appt_id)
        if user is None or appt is None or appt.user_id != user.id:
            await callback.answer("❌ شما مجوز این عملیات را ندارید.", show_alert=True)
            return
        allowed, error = appointment_service.can_cancel(session, appt)
        if not allowed:
            await callback.answer(error, show_alert=True)
            return

        appointment_service.cancel(session, appt)          # frees the slot
        text = notification_service.appointment_cancelled_text(session, appt)
        my_telegram_id = user.telegram_id
        staff_id, day = appt.staff_id, appt.date

    notification_service.record_delivered(my_telegram_id, text, "appointment_cancelled")

    # The slot is free again -> inform everybody waiting for that day
    await notification_service.notify_waitlist_entries(staff_id, day)

    try:
        await callback.message.edit_text(
            "✅ نوبت شما لغو شد.\n"
            "بازه زمانی آزاد شد و اکنون برای دیگران قابل رزرو است.",
            reply_markup=inline.back_to_menu(),
        )
    except Exception:  # noqa: BLE001
        logger.debug("cancel edit skipped", exc_info=True)
    await callback.answer("نوبت لغو شد.")


# ---------------------------------------------------------------------------
# Reschedule
# ---------------------------------------------------------------------------
async def _start_reschedule(callback: CallbackQuery, state: FSMContext, appt_id: int) -> None:
    snapshot = _load_own(callback.from_user.id, appt_id)
    if snapshot is None:
        await callback.answer("❌ شما مجوز این عملیات را ندارید.", show_alert=True)
        return
    with session_scope() as session:
        appt = appointment_service.get(session, appt_id)
        allowed, error = appointment_service.can_reschedule(session, appt)
    if not allowed:
        await callback.answer(error, show_alert=True)
        return

    await state.set_state(Reschedule.date)
    await state.update_data(appt_id=appt_id, staff_id=snapshot.staff_id)
    year, month = jalali_ym(tehran_now().date())
    await _render_reschedule_calendar(callback, state, year, month)


def _month_bookable(staff_id: int, year: int, month: int) -> set[date]:
    with session_scope() as session:
        bookable = slot_service.bookable_dates(
            session,
            staff_id=staff_id,
            from_day=tehran_now().date(),
            horizon_days=settings_service.get_max_days_ahead(session),
        )
    return {
        day
        for day in bookable
        if (jdatetime.date.fromgregorian(date=day).year,
            jdatetime.date.fromgregorian(date=day).month) == (year, month)
    }


async def _render_reschedule_calendar(
    callback: CallbackQuery, state: FSMContext, year: int, month: int
) -> None:
    data = await state.get_data()
    month_days = _month_bookable(safe_int(data.get("staff_id"), 0) or 0, year, month)
    try:
        await callback.message.edit_text(
            f"🔄 تاریخ جدید نوبت را انتخاب کنید ({month_title(year, month)}):",
            reply_markup=inline.calendar(
                year, month, month_days, nav_prefix="res:nav", day_prefix="res:day"
            ),
        )
    except Exception:  # noqa: BLE001
        logger.debug("calendar edit skipped", exc_info=True)
    await callback.answer()


@router.callback_query(F.data.startswith("res:nav:"))
async def on_reschedule_nav(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Reschedule.date.state:
        await callback.answer("⌛ این گزینه منقضی شده است.", show_alert=True)
        return
    parts = callback.data.split(":")
    year, month = safe_int(parts[2]), safe_int(parts[3])
    if year is None or month is None or not 1 <= month <= 12:
        await callback.answer()
        return
    await _render_reschedule_calendar(callback, state, year, month)


@router.callback_query(F.data.startswith("res:day:"))
async def on_reschedule_day(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Reschedule.date.state:
        await callback.answer("⌛ این گزینه منقضی شده است.", show_alert=True)
        return
    parts = callback.data.split(":")
    year, month, day_number = (safe_int(p) for p in parts[2:5])
    if None in (year, month, day_number):
        await callback.answer()
        return
    try:
        day = jdatetime.date(year, month, day_number).togregorian()
    except ValueError:
        await callback.answer("❌ تاریخ نامعتبر است.", show_alert=True)
        return

    data = await state.get_data()
    with session_scope() as session:
        reason = appointment_service.date_blocked_reason(
            session, safe_int(data.get("staff_id"), 0) or 0, day
        )
    if reason:
        await callback.answer(reason, show_alert=True)
        return

    await state.update_data(date_iso=day.isoformat())
    await _render_reschedule_slots(callback, state, day)


async def _render_reschedule_slots(
    callback: CallbackQuery, state: FSMContext, day: date
) -> None:
    data = await state.get_data()
    appt_id = safe_int(data.get("appt_id"), 0) or 0
    with session_scope() as session:
        appt = appointment_service.get(session, appt_id)
        if appt is None:
            await callback.answer("❌ نوبت یافت نشد.", show_alert=True)
            return
        slots = slot_service.build_day_slots(
            session,
            staff_id=appt.staff_id,
            service_id=appt.service_id,
            day=day,
            ignore_appointment_id=appt.id,  # its own slot stays visible/free
        )

    free = [s.time for s in slots if s.available]
    text = (
        f"⏰ ساعت جدید برای {to_jalali(day)} ({day_name(day)}):\n\n"
        + ("، ".join(free) if free else "هیچ بازه آزادی وجود ندارد.")
        + "\n\n🔒 = رزرو شده"
    )
    await state.set_state(Reschedule.time)
    try:
        await callback.message.edit_text(
            text, reply_markup=inline.slots(slots, prefix="res:slot")
        )
    except Exception:  # noqa: BLE001
        logger.debug("slots edit skipped", exc_info=True)
    await callback.answer()


@router.callback_query(F.data.startswith("res:slotfull:"))
async def on_reschedule_locked(callback: CallbackQuery) -> None:
    await callback.answer("⛔ این بازه زمانی پر است.", show_alert=True)


@router.callback_query(F.data.startswith("res:slot:"))
async def on_reschedule_slot(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Reschedule.time.state:
        await callback.answer("⌛ این گزینه منقضی شده است.", show_alert=True)
        return
    raw = callback.data.split(":")[2]
    if len(raw) != 4 or not raw.isdigit():
        await callback.answer()
        return
    start = time(int(raw[:2]), int(raw[2:]))

    data = await state.get_data()
    appt_id = safe_int(data.get("appt_id"), 0) or 0
    if not data.get("date_iso"):
        await callback.answer("⌛ ابتدا تاریخ را انتخاب کنید.", show_alert=True)
        return
    day = date.fromisoformat(data["date_iso"])

    with session_scope() as session:
        appt = appointment_service.get(session, appt_id)
        if appt is None:
            await callback.answer("❌ نوبت یافت نشد.", show_alert=True)
            return
        available = slot_service.is_slot_available(
            session,
            staff_id=appt.staff_id,
            service_id=appt.service_id,
            day=day,
            start=start,
            ignore_appointment_id=appt.id,
        )
        old_day, old_start = appt.date, appt.start_time
        service_name = appt.service.name
        staff_name = appt.staff.name
        tracking = appt.tracking_code

    if not available:
        await callback.answer("⛔ این بازه رزرو شده است.", show_alert=True)
        return

    await state.update_data(start_time=start.strftime("%H:%M"))
    await state.set_state(Reschedule.confirm)
    text = (
        f"{DIVIDER}\n🔄 تغییر وقت نوبت\n{DIVIDER}\n"
        f"⛔ زمان قبلی: {to_jalali(old_day)} ساعت {hhmm(old_start)}\n"
        f"✅ زمان جدید: {to_jalali(day)} ساعت {hhmm(start)}\n"
        f"🛠 خدمت: {service_name}\n"
        f"🧑‍💼 کارشناس: {staff_name}\n"
        f"🔑 کد رهگیری: {tracking}\n"
        f"{DIVIDER}\n\nآیا تأیید می‌کنید؟"
    )
    try:
        await callback.message.edit_text(text, reply_markup=inline.confirm("res:confirm"))
    except Exception:  # noqa: BLE001
        logger.debug("summary edit skipped", exc_info=True)
    await callback.answer()


@router.callback_query(F.data.startswith("res:confirm:"))
async def on_reschedule_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    if (await state.get_state()) != Reschedule.confirm.state:
        await callback.answer("⌛ این گزینه منقضی شده است.", show_alert=True)
        return
    if callback.data.split(":")[2] == "no":
        await state.clear()
        await callback.message.edit_text(
            "❌ تغییر وقت نوبت لغو شد.", reply_markup=inline.back_to_menu()
        )
        await callback.answer()
        return

    data = await state.get_data()
    appt_id = safe_int(data.get("appt_id"), 0) or 0
    if not data.get("date_iso") or not data.get("start_time"):
        await callback.answer("⌛ اطلاعات ناقص است؛ دوباره تلاش کنید.", show_alert=True)
        return
    day = date.fromisoformat(data["date_iso"])
    start = time.fromisoformat(data["start_time"])

    with session_scope() as session:
        user = user_service.get_by_telegram(session, callback.from_user.id)
        appt = appointment_service.get(session, appt_id)
        if user is None or appt is None or appt.user_id != user.id:
            await callback.answer("❌ شما مجوز این عملیات را ندارید.", show_alert=True)
            return
        try:
            appointment, old_day, old_start = appointment_service.reschedule(
                session, appt, day=day, start=start
            )
            text = notification_service.appointment_rescheduled_text(
                session, appointment, old_day, old_start
            )
            my_telegram_id = user.telegram_id
        except BookingError as exc:
            await callback.answer(str(exc), show_alert=True)
            return

    notification_service.record_delivered(my_telegram_id, text, "appointment_rescheduled")
    await state.clear()
    try:
        await callback.message.edit_text(text, reply_markup=inline.back_to_menu())
    except Exception:  # noqa: BLE001
        logger.debug("confirm edit skipped", exc_info=True)
    await callback.answer("🔄 وقت نوبت تغییر کرد.")


# ---------------------------------------------------------------------------
# 🔙 بازگشت inside the reschedule flow
# ---------------------------------------------------------------------------
@router.message(Reschedule.time, StateFilter(Reschedule.time), F.text == BTN_BACK)
async def reschedule_back_to_calendar(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    year, month = jalali_ym(tehran_now().date())
    month_days = _month_bookable(safe_int(data.get("staff_id"), 0) or 0, year, month)
    await state.set_state(Reschedule.date)
    await message.answer(
        f"📅 تاریخ جدید را انتخاب کنید ({month_title(year, month)}):",
        reply_markup=inline.calendar(
            year, month, month_days, nav_prefix="res:nav", day_prefix="res:day"
        ),
    )


@router.message(Reschedule.confirm, StateFilter(Reschedule.confirm), F.text == BTN_BACK)
async def reschedule_back_to_slots(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    if not data.get("date_iso") or not data.get("appt_id"):
        await state.clear()
        await message.answer("❌ عملیات لغو شد.")
        return
    day = date.fromisoformat(data["date_iso"])
    appt_id = safe_int(data["appt_id"], 0) or 0
    with session_scope() as session:
        appt = appointment_service.get(session, appt_id)
        slots = slot_service.build_day_slots(
            session,
            staff_id=appt.staff_id,
            service_id=appt.service_id,
            day=day,
            ignore_appointment_id=appt.id,
        ) if appt else []

    free = [s.time for s in slots if s.available]
    await state.set_state(Reschedule.time)
    await message.answer(
        f"⏰ ساعت جدید برای {to_jalali(day)}:\n"
        + ("، ".join(free) if free else "هیچ بازه آزادی وجود ندارد."),
        reply_markup=inline.slots(slots, prefix="res:slot"),
    )
