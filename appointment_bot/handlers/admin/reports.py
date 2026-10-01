"""
📈 گزارش‌ها (admin)

    daily report  -> default today, or any Jalali date typed by the admin
    monthly report -> Jalali month with previous / next navigation
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.session import session_scope
from handlers.admin.base import ensure_admin, safe_edit
from handlers.states import AdminReportForm
from keyboards.inline_keyboard import from_rows
from services import report_service
from utils.calendar import jalali_month_bounds, tehran_now, to_jalali
from utils.helpers import jalali_ym
from utils.constants import BTN_ADMIN_REPORTS, DIVIDER
from utils.validators import parse_jalali_input

router = Router(name="admin_reports")
logger = logging.getLogger(__name__)


def _month_keyboard(year: int, month: int) -> object:
    return from_rows([
        [
            InlineKeyboardButton(text="➡️ ماه قبل", callback_data=f"adm:rep:month:{_prev(year, month)}"),
            InlineKeyboardButton(text=f"ماه {year}/{month:02d}", callback_data="noop"),
            InlineKeyboardButton(text="ماه بعد ⬅️", callback_data=f"adm:rep:month:{_next(year, month)}"),
        ],
        [
            InlineKeyboardButton(text="📅 گزارش امروز", callback_data="adm:rep:today"),
            InlineKeyboardButton(text="🗓 گزارش روزانه دلخواه", callback_data="adm:rep:askdate"),
        ],
        [InlineKeyboardButton(text="🏠 منوی مدیریت", callback_data="adm:home")],
    ])


def _prev(year: int, month: int) -> str:
    return f"{year}:{month - 1}" if month > 1 else f"{year - 1}:12"


def _next(year: int, month: int) -> str:
    return f"{year}:{month + 1}" if month < 12 else f"{year + 1}:1"


@router.message(F.text == BTN_ADMIN_REPORTS)
async def reports_menu(message: Message) -> None:
    if not await ensure_admin(message):
        return
    year, month = jalali_ym(tehran_now().date())
    await message.answer(
        f"{DIVIDER}📈 گزارش‌ها{DIVIDER}\nنوع گزارش را انتخاب کنید:",
        reply_markup=_month_keyboard(year, month),
    )


@router.callback_query(F.data == "adm:rep:today")
async def daily_today(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    await _send_daily(callback, tehran_now().date())


@router.callback_query(F.data == "adm:rep:askdate")
async def ask_report_date(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    await state.set_state(AdminReportForm.date)
    await callback.message.answer(
        "🗓 تاریخ گزارش را به شمسی وارد کنید (مثال: 1405/07/10):"
    )
    await callback.answer()


@router.message(AdminReportForm.date, StateFilter(AdminReportForm.date), F.text)
async def receive_report_date(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    day = parse_jalali_input(message.text or "")
    if day is None:
        await message.answer("❌ تاریخ نامعتبر است. نمونه: 1405/07/10")
        return
    await state.clear()
    with session_scope() as session:
        report = report_service.daily_report(session, day)
    await message.answer(
        report_service.format_daily(report),
        reply_markup=from_rows([
            [
                InlineKeyboardButton(text="📅 امروز", callback_data="adm:rep:today"),
                InlineKeyboardButton(text="📆 گزارش ماهانه", callback_data=f"adm:rep:month:{_current_month()}"),
            ],
            [InlineKeyboardButton(text="🏠 منوی مدیریت", callback_data="adm:home")],
        ]),
    )


async def _send_daily(callback: CallbackQuery, day) -> None:
    with session_scope() as session:
        report = report_service.daily_report(session, day)
    year, month = jalali_ym(day)
    await safe_edit(
        callback.message,
        report_service.format_daily(report),
        _month_keyboard(year, month),
    )
    await callback.answer()


def _current_month() -> str:
    year, month = jalali_ym(tehran_now().date())
    return f"{year}:{month}"


@router.callback_query(F.data.startswith("adm:rep:month:"))
async def monthly_report(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:rep:month:<year>:<month>
    try:
        year, month = int(parts[3]), int(parts[4])
        if not 1 <= month <= 12:
            raise ValueError
    except (IndexError, ValueError):
        await callback.answer()
        return

    with session_scope() as session:
        report = report_service.monthly_report(session, year, month)
    await safe_edit(callback.message, report_service.format_monthly(report), _month_keyboard(year, month))
    await callback.answer()
