"""
🚫 تعطیلات (admin) - complete CRUD.

A holiday blocks the whole day: no slot is generated for any staff member.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message
from sqlalchemy import select

from database.models import Holiday
from database.session import session_scope
from handlers.admin.base import ensure_admin, home_button, page_buttons, safe_edit
from handlers.states import AdminHolidayForm
from keyboards.inline_keyboard import from_rows
from utils.calendar import persian_weekday, to_jalali
from utils.constants import BTN_ADMIN_HOLIDAYS, DIVIDER, PAGE_SIZE_TELEGRAM, PERSIAN_DAYS
from utils.helpers import paginate
from utils.validators import parse_jalali_input

router = Router(name="admin_holidays")
logger = logging.getLogger(__name__)


def _build_list(page: int) -> tuple[str, object]:
    with session_scope() as session:
        rows = list(session.scalars(select(Holiday).order_by(Holiday.date)).all())
        result = paginate(rows, page, PAGE_SIZE_TELEGRAM)
        lines = [
            f"{DIVIDER}🚫 تعطیلات",
            f"({result.start_index}-{result.end_index} از {result.total}){DIVIDER}",
        ]
        buttons: list[list[InlineKeyboardButton]] = []
        for holiday in result.items:
            day = holiday.date
            lines.append(
                f"• {to_jalali(day)} ({PERSIAN_DAYS[persian_weekday(day)]})"
                + (f" — {holiday.note}" if holiday.note else "")
            )
            buttons.append([
                InlineKeyboardButton(
                    text=f"🗑 {to_jalali(day)}", callback_data=f"adm:hol:del:{holiday.id}"
                )
            ])
        if not result.items:
            lines.append("تعطیلی ثبت نشده است.")

    buttons.append(page_buttons("adm:hol:list", result.page, result.total_pages))
    buttons.append([
        InlineKeyboardButton(text="➕ افزودن تعطیلی", callback_data="adm:hol:add"),
        home_button(),
    ])
    return "\n".join(lines), from_rows(buttons)


@router.message(F.text == BTN_ADMIN_HOLIDAYS)
async def holidays_menu(message: Message) -> None:
    if not await ensure_admin(message):
        return
    text, keyboard = _build_list(1)
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("adm:hol:list"))
async def show_holidays(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    page = _page(callback.data.rsplit(":", 1)[-1])
    text, keyboard = _build_list(page)
    await safe_edit(callback.message, text, keyboard)
    await callback.answer()


@router.callback_query(F.data == "adm:hol:add")
async def ask_holiday_date(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    await state.set_state(AdminHolidayForm.date)
    await callback.message.answer(
        "🗓 تاریخ تعطیل را به شمسی وارد کنید (مثال: 1405/07/15):",
        reply_markup=_back(),
    )
    await callback.answer()


@router.message(AdminHolidayForm.date, StateFilter(AdminHolidayForm.date), F.text)
async def receive_holiday_date(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    day = parse_jalali_input(message.text or "")
    if day is None:
        await message.answer("❌ تاریخ نامعتبر است. نمونه: 1405/07/15")
        return
    await state.update_data(holiday_date=day.isoformat())
    await state.set_state(AdminHolidayForm.note)
    await message.answer(
        "📝 دلیل / توضیح تعطیلی را وارد کنید (برای رد شدن: -):", reply_markup=_back()
    )


@router.message(AdminHolidayForm.note, StateFilter(AdminHolidayForm.note), F.text)
async def save_holiday(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    from datetime import date as date_type

    data = await state.get_data()
    day = date_type.fromisoformat(data["holiday_date"])
    note_raw = (message.text or "").strip()
    note = "" if note_raw in ("-", "") else note_raw

    with session_scope() as session:
        exists = session.scalar(select(Holiday).where(Holiday.date == day))
        if exists is not None:
            await state.clear()
            await message.answer("❌ این تاریخ قبلاً به عنوان تعطیلی ثبت شده است.")
            return
        session.add(Holiday(date=day, note=note))

    logger.info("Admin added holiday %s (%s)", day.isoformat(), note)
    await state.clear()
    await message.answer(f"✅ تاریخ {to_jalali(day)} به تعطیلات اضافه شد.")
    text, keyboard = _build_list(1)
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("adm:hol:del:"))
async def delete_holiday(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    holiday_id = _int(callback.data.split(":")[3])
    if holiday_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        holiday = session.get(Holiday, holiday_id)
        if holiday is None:
            await callback.answer("❌ مورد یافت نشد.", show_alert=True)
            return
        label = to_jalali(holiday.date)
        session.delete(holiday)

    logger.info("Admin removed holiday #%s (%s)", holiday_id, label)
    await callback.answer("🗑 تعطیلی حذف شد.")
    text, keyboard = _build_list(1)
    await safe_edit(callback.message, f"✅ تعطیلی {label} حذف شد.\n\n{text}", keyboard)


def _page(value: str) -> int:
    try:
        return max(1, int(value))
    except ValueError:
        return 1


def _int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
