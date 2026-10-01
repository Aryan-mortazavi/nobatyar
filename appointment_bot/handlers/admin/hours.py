"""
🕐 ساعات کاری و استراحت (admin)

For each staff member:
    week view -> day view -> set / toggle / delete working hours
                             + add / toggle / delete break times

Closing a day = deleting (or disabling) its working-hour row.
"""

from __future__ import annotations

import logging
from datetime import time

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.models import BreakTime
from database.session import session_scope
from handlers.admin.base import ensure_admin, safe_edit
from handlers.states import AdminHourForm
from keyboards.inline_keyboard import from_rows
from services import staff_service
from services.staff_service import StaffError
from utils.constants import BTN_ADMIN_HOURS, DIVIDER, PERSIAN_DAYS
from utils.validators import parse_time_input

router = Router(name="admin_hours")
logger = logging.getLogger(__name__)

MODE_WORK = "work"
MODE_BREAK = "break"


# ---------------------------------------------------------------------------
# Staff picker
# ---------------------------------------------------------------------------
@router.message(F.text == BTN_ADMIN_HOURS)
async def pick_staff(message: Message) -> None:
    if not await ensure_admin(message):
        return
    with session_scope() as session:
        staff_list = staff_service.list_staff(session)
    rows = [
        [InlineKeyboardButton(text=f"🧑‍💼 {s.name}", callback_data=f"adm:hour:staff:{s.id}")]
        for s in staff_list
    ] or [[InlineKeyboardButton(text="— کارشناسی ثبت نشده —", callback_data="noop")]]
    await message.answer("🧑‍💼 کارشناس موردنظر را انتخاب کنید:", reply_markup=from_rows(rows))


@router.callback_query(F.data.startswith("adm:hour:pick"))
async def pick_staff_callback(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    with session_scope() as session:
        staff_list = staff_service.list_staff(session)
    rows = [
        [InlineKeyboardButton(text=f"🧑‍💼 {s.name}", callback_data=f"adm:hour:staff:{s.id}")]
        for s in staff_list
    ]
    rows.append([InlineKeyboardButton(text="🏠 منوی مدیریت", callback_data="adm:home")])
    await safe_edit(callback.message, "🧑‍💼 کارشناس موردنظر را انتخاب کنید:", from_rows(rows))
    await callback.answer()


# ---------------------------------------------------------------------------
# Week view
# ---------------------------------------------------------------------------
def _week_view(staff_id: int) -> tuple[str, object] | None:
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            return None
        hours = {h.day_of_week: h for h in staff_service.working_hours(session, staff_id)}
        breaks = staff_service.breaks(session, staff_id)

    text = f"{DIVIDER}\n🕐 ساعات کاری «{member.name}»{DIVIDER}\n\n"
    rows: list[list[InlineKeyboardButton]] = []
    for index, day_name in enumerate(PERSIAN_DAYS):
        row = hours.get(index)
        if row is None or not row.is_active:
            status = "تعطیل"
        else:
            status = f"{row.start_time.strftime('%H:%M')} تا {row.end_time.strftime('%H:%M')}"
        day_breaks = [
            f"{b.start_time.strftime('%H:%M')}-{b.end_time.strftime('%H:%M')}"
            for b in breaks
            if b.day_of_week == index and b.is_active
        ]
        text += f"• {day_name}: {status}"
        if day_breaks:
            text += f" (استراحت: {', '.join(day_breaks)})"
        text += "\n"
        rows.append([
            InlineKeyboardButton(
                text=f"✏️ {day_name}: {status}", callback_data=f"adm:hour:day:{staff_id}:{index}"
            )
        ])

    rows.append([InlineKeyboardButton(text="🔙 بازگشت", callback_data=f"adm:staff:view:{staff_id}")])
    return text, from_rows(rows)


@router.callback_query(F.data.startswith("adm:hour:staff:"))
async def show_week(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    staff_id = _int(callback.data.split(":")[3])
    built = _week_view(staff_id) if staff_id else None
    if built is None:
        await callback.answer("❌ کارشناس یافت نشد.", show_alert=True)
        return
    await safe_edit(callback.message, built[0], built[1])
    await callback.answer()


# ---------------------------------------------------------------------------
# Day view
# ---------------------------------------------------------------------------
def _day_view(staff_id: int, day_of_week: int) -> tuple[str, object] | None:
    if not 0 <= day_of_week <= 6:
        return None
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            return None
        row = staff_service.working_hours_for_day(session, staff_id, day_of_week)
        breaks = staff_service.breaks(session, staff_id, day_of_week)

    day_name = PERSIAN_DAYS[day_of_week]
    if row is None:
        interval, active = "تعریف نشده (تعطیل)", False
    else:
        active = row.is_active
        interval = f"{row.start_time.strftime('%H:%M')} تا {row.end_time.strftime('%H:%M')}"

    text = (
        f"{DIVIDER}\n🕐 {day_name} — {member.name}{DIVIDER}\n"
        f"ساعات کاری: {interval}\n"
        f"وضعیت: {'✅ فعال' if active and row else '⛔ تعطیل'}\n\n"
        "😴 زمان‌های استراحت:\n"
    )
    if breaks:
        for brk in breaks:
            text += (
                f"  • {brk.start_time.strftime('%H:%M')} تا {brk.end_time.strftime('%H:%M')} "
                f"{'✅' if brk.is_active else '⛔'}\n"
            )
    else:
        text += "  —\n"

    rows: list[list[InlineKeyboardButton]] = []
    if row is None:
        rows.append([
            InlineKeyboardButton(text="➕ تعریف ساعات کاری", callback_data=f"adm:hour:add:{staff_id}:{day_of_week}")
        ])
    else:
        rows.append([
            InlineKeyboardButton(text="✏️ ویرایش ساعت", callback_data=f"adm:hour:edit:{staff_id}:{day_of_week}"),
            InlineKeyboardButton(
                text=("▶️ فعال کردن" if not row.is_active else "⏸ غیرفعال"),
                callback_data=f"adm:hour:tg:{staff_id}:{day_of_week}",
            ),
        ])
        rows.append([
            InlineKeyboardButton(text="🗑 حذف (تعطیل کردن)", callback_data=f"adm:hour:del:{staff_id}:{day_of_week}")
        ])
    rows.append([
        InlineKeyboardButton(text="➕ افزودن استراحت", callback_data=f"adm:hour:brkadd:{staff_id}:{day_of_week}")
    ])
    for brk in breaks:
        rows.append([
            InlineKeyboardButton(
                text=f"😴 {brk.start_time.strftime('%H:%M')}-{brk.end_time.strftime('%H:%M')} "
                f"{'⏸' if brk.is_active else '▶️'}",
                callback_data=f"adm:hour:brktg:{brk.id}",
            ),
            InlineKeyboardButton(text="🗑", callback_data=f"adm:hour:brkdel:{brk.id}"),
        ])
    rows.append([
        InlineKeyboardButton(text="🔙 بازگشت به هفته", callback_data=f"adm:hour:staff:{staff_id}")
    ])
    return text, from_rows(rows)


@router.callback_query(F.data.startswith("adm:hour:day:"))
async def show_day(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:hour:day:<staff>:<day>
    staff_id, day_of_week = _int(parts[3]), _int(parts[4])
    built = _day_view(staff_id, day_of_week) if staff_id is not None and day_of_week is not None else None
    if built is None:
        await callback.answer("❌ اطلاعات نامعتبر است.", show_alert=True)
        return
    await safe_edit(callback.message, built[0], built[1])
    await callback.answer()


# ---------------------------------------------------------------------------
# Working hours form (start -> end)
# ---------------------------------------------------------------------------
async def _ask_time(
    callback: CallbackQuery, state: FSMContext, *, staff_id: int, day_of_week: int, mode: str,
    first_step: bool,
) -> None:
    await state.set_state(AdminHourForm.start if first_step else AdminHourForm.end)
    await state.update_data(hour_staff=staff_id, hour_day=day_of_week, hour_mode=mode)
    what = "شروع" if first_step else "پایان"
    label = "ساعات کاری" if mode == MODE_WORK else "استراحت"
    await callback.message.answer(
        f"🕐 ساعت {what} {label} ({PERSIAN_DAYS[day_of_week]}) را به صورت 24 ساعته وارد کنید "
        f"(مثال: 08:00):",
        reply_markup=_back(),
    )


@router.callback_query(F.data.startswith("adm:hour:add:"))
async def ask_add_hours(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:hour:add:<staff>:<day>
    staff_id, day_of_week = _int(parts[3]), _int(parts[4])
    if staff_id is None or day_of_week is None:
        await callback.answer()
        return
    await _ask_time(
        callback, state, staff_id=staff_id, day_of_week=day_of_week, mode=MODE_WORK, first_step=True
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:hour:edit:"))
async def ask_edit_hours(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:hour:edit:<staff>:<day>
    staff_id, day_of_week = _int(parts[3]), _int(parts[4])
    if staff_id is None or day_of_week is None:
        await callback.answer()
        return
    await _ask_time(
        callback, state, staff_id=staff_id, day_of_week=day_of_week, mode=MODE_WORK, first_step=True
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:hour:brkadd:"))
async def ask_add_break(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:hour:brkadd:<staff>:<day>
    staff_id, day_of_week = _int(parts[3]), _int(parts[4])
    if staff_id is None or day_of_week is None:
        await callback.answer()
        return
    await _ask_time(
        callback, state, staff_id=staff_id, day_of_week=day_of_week, mode=MODE_BREAK, first_step=True
    )
    await callback.answer()


@router.message(AdminHourForm.start, StateFilter(AdminHourForm.start), F.text)
async def receive_start_time(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    value = parse_time_input(message.text or "")
    if value is None:
        await message.answer("❌ ساعت نامعتبر است. نمونه: 08:00")
        return
    await state.update_data(hour_start=value.strftime("%H:%M"))
    await state.set_state(AdminHourForm.end)
    await message.answer("🕐 ساعت پایان را وارد کنید (مثال: 18:00):", reply_markup=_back())


@router.message(AdminHourForm.end, StateFilter(AdminHourForm.end), F.text)
async def receive_end_time(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    end = parse_time_input(message.text or "")
    if end is None:
        await message.answer("❌ ساعت نامعتبر است. نمونه: 18:00")
        return

    data = await state.get_data()
    staff_id = int(data.get("hour_staff", 0))
    day_of_week = int(data.get("hour_day", 0))
    mode = data.get("hour_mode", MODE_WORK)
    start = time.fromisoformat(data.get("hour_start", "08:00"))

    try:
        with session_scope() as session:
            if mode == MODE_BREAK:
                staff_service.add_break(session, staff_id, day_of_week, start, end)
            else:
                staff_service.set_working_hours(session, staff_id, day_of_week, start, end)
    except StaffError as exc:
        await message.answer(str(exc))
        return

    logger.info(
        "Admin set %s for staff=%s day=%s (%s-%s)",
        mode, staff_id, day_of_week, start.strftime("%H:%M"), end.strftime("%H:%M"),
    )
    await state.clear()
    await message.answer("✅ با موفقیت ذخیره شد.")
    built = _day_view(staff_id, day_of_week)
    if built:
        await message.answer(built[0], reply_markup=built[1])


# ---------------------------------------------------------------------------
# Toggle / delete
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("adm:hour:tg:"))
async def toggle_hour(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:hour:tg:<staff>:<day>
    staff_id, day_of_week = _int(parts[3]), _int(parts[4])
    if staff_id is None or day_of_week is None:
        await callback.answer()
        return
    with session_scope() as session:
        row = staff_service.working_hours_for_day(session, staff_id, day_of_week)
        if row is None:
            await callback.answer("❌ ساعات کاری تعریف نشده است.", show_alert=True)
            return
        active = staff_service.toggle_working_hour(session, row.id)
    await callback.answer("✅ فعال شد." if active else "⏸ غیرفعال شد.")
    built = _day_view(staff_id, day_of_week)
    if built:
        await safe_edit(callback.message, built[0], built[1])


@router.callback_query(F.data.startswith("adm:hour:del:"))
async def delete_hour(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:hour:del:<staff>:<day>
    staff_id, day_of_week = _int(parts[3]), _int(parts[4])
    if staff_id is None or day_of_week is None:
        await callback.answer()
        return
    with session_scope() as session:
        row = staff_service.working_hours_for_day(session, staff_id, day_of_week)
        if row is not None:
            staff_service.delete_working_hour(session, row.id)
    logger.info("Admin removed working hour staff=%s day=%s", staff_id, day_of_week)
    await callback.answer("🗑 حذف شد (این روز تعطیل است).")
    built = _day_view(staff_id, day_of_week)
    if built:
        await safe_edit(callback.message, built[0], built[1])


@router.callback_query(F.data.startswith("adm:hour:brktg:"))
async def toggle_break(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    break_id = _int(callback.data.split(":")[3])
    if break_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        row = session.get(BreakTime, break_id)
        if row is None:
            await callback.answer("❌ مورد یافت نشد.", show_alert=True)
            return
        staff_id, day_of_week = row.staff_id, row.day_of_week
        staff_service.toggle_break(session, break_id)
    await callback.answer("تغییر کرد.")
    built = _day_view(staff_id, day_of_week)
    if built:
        await safe_edit(callback.message, built[0], built[1])


@router.callback_query(F.data.startswith("adm:hour:brkdel:"))
async def delete_break(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    break_id = _int(callback.data.split(":")[3])
    if break_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        row = session.get(BreakTime, break_id)
        if row is None:
            await callback.answer("❌ مورد یافت نشد.", show_alert=True)
            return
        staff_id, day_of_week = row.staff_id, row.day_of_week
        staff_service.delete_break(session, break_id)
    await callback.answer("🗑 حذف شد.")
    built = _day_view(staff_id, day_of_week)
    if built:
        await safe_edit(callback.message, built[0], built[1])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _back():
    from keyboards.user_keyboard import back_cancel_keyboard

    return back_cancel_keyboard()


def _int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None

