"""
👥 مدیریت کاربران (admin)

    list with pagination + search, user detail, their appointments
    enable / disable an account
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from sqlalchemy import select

from database.models import Appointment, User
from database.session import session_scope
from handlers.admin.base import ensure_admin, home_button, page_buttons, safe_edit
from handlers.states import AdminUserSearch
from keyboards.inline_keyboard import from_rows
from services import user_service
from utils.calendar import to_jalali
from utils.constants import (
    BTN_ADMIN_USERS,
    DIVIDER,
    PAGE_SIZE_TELEGRAM,
    STATUS_LABELS_FA,
)
from utils.helpers import hhmm, paginate

router = Router(name="admin_users")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Listing (optional search term is kept in the FSM data)
# ---------------------------------------------------------------------------
async def _query_term(state: FSMContext) -> str:
    data = await state.get_data()
    return str(data.get("user_search", "") or "")


def _build_list(term: str, page: int) -> tuple[str, object]:
    with session_scope() as session:
        users = user_service.list_users(session, search=term or None)
        result = paginate(users, page, PAGE_SIZE_TELEGRAM)
        lines = [
            f"{DIVIDER}👥 کاربران" + (f" — جستجو: {term}" if term else ""),
            f"({result.start_index}-{result.end_index} از {result.total}){DIVIDER}",
        ]
        buttons: list[list[InlineKeyboardButton]] = []
        for user in result.items:
            flag = "✅" if user.is_active else "⛔"
            lines.append(
                f"• {flag} {user.full_name} | {user.phone or 'بدون شماره'}\n"
                f"  🆔 {user.telegram_id}"
            )
            buttons.append([
                InlineKeyboardButton(
                    text=f"{flag} {user.full_name}", callback_data=f"adm:user:view:{user.id}"
                )
            ])
        if not result.items:
            lines.append("کاربری یافت نشد.")

    buttons.append(
        page_buttons(f"adm:user:list:{term or '-'}", result.page, result.total_pages)
    )
    buttons.append([
        InlineKeyboardButton(text="🔍 جستجو", callback_data="adm:user:search"),
        InlineKeyboardButton(text="🧹 حذف فیلتر", callback_data="adm:user:list:-:1"),
        home_button(),
    ])
    return "\n".join(lines), from_rows(buttons)


@router.message(F.text == BTN_ADMIN_USERS)
async def users_menu(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    await state.update_data(user_search="")
    text, keyboard = _build_list("", 1)
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("adm:user:list:"))
async def show_users(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:user:list:<term>:<page>
    if len(parts) != 5:
        await callback.answer()
        return
    term = "" if parts[3] == "-" else parts[3]
    try:
        page = max(1, int(parts[4]))
    except ValueError:
        page = 1
    await state.update_data(user_search=term)
    text, keyboard = _build_list(term, page)
    await safe_edit(callback.message, text, keyboard)
    await callback.answer()


@router.callback_query(F.data == "adm:user:search")
async def ask_search(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    await state.set_state(AdminUserSearch.query)
    await callback.message.answer(
        "🔍 نام، شماره موبایل یا شناسه تلگرام کاربر را وارد کنید:"
    )
    await callback.answer()


@router.message(AdminUserSearch.query, StateFilter(AdminUserSearch.query), F.text)
async def process_search(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    term = (message.text or "").strip()
    await state.clear()
    await state.update_data(user_search=term)
    text, keyboard = _build_list(term, 1)
    await message.answer(text, reply_markup=keyboard)


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------
def _build_detail(user_id: int) -> tuple[str, object] | None:
    with session_scope() as session:
        user = user_service.get_by_id(session, user_id)
        if user is None:
            return None
        appointments = user_service.count_appointments(session, user_id)
        upcoming = len(
            [
                a
                for a in session.scalars(
                    select(Appointment).where(Appointment.user_id == user_id)
                ).all()
                if a.status in ("pending", "confirmed")
            ]
        )
        text = (
            f"{DIVIDER}\n👤 جزئیات کاربر\n{DIVIDER}\n"
            f"👤 نام: {user.full_name}\n"
            f"📱 موبایل: {user.phone or '—'}\n"
            f"🆔 شناسه تلگرام: {user.telegram_id}\n"
            f"🔖 نقش: {user.role}\n"
            f"وضعیت: {'✅ فعال' if user.is_active else '⛔ غیرفعال'}\n"
            f"🗓 ثبت‌نام: {to_jalali(user.created_at.date()) if user.created_at else '—'}\n"
            f"📅 کل نوبت‌ها: {appointments} (فعال: {upcoming})\n"
            f"{DIVIDER}"
        )
        buttons = [
            [InlineKeyboardButton(text="📅 نوبت‌های کاربر", callback_data=f"adm:user:appts:{user.id}:1")],
            [InlineKeyboardButton(
                text=("⛔ غیرفعال کردن" if user.is_active else "✅ فعال کردن"),
                callback_data=f"adm:user:toggle:{user.id}",
            )],
            [InlineKeyboardButton(text="🔙 بازگشت به لیست", callback_data="adm:user:list:-:1")],
        ]
    return text, from_rows(buttons)


@router.callback_query(F.data.startswith("adm:user:view:"))
async def show_user(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    user_id = _int(callback.data.split(":")[3])
    built = _build_detail(user_id) if user_id else None
    if built is None:
        await callback.answer("❌ کاربر یافت نشد.", show_alert=True)
        return
    await safe_edit(callback.message, built[0], built[1])
    await callback.answer()


@router.callback_query(F.data.startswith("adm:user:toggle:"))
async def toggle_user(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    user_id = _int(callback.data.split(":")[3])
    if user_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        user = user_service.get_by_id(session, user_id)
        if user is None:
            await callback.answer("❌ کاربر یافت نشد.", show_alert=True)
            return
        user_service.set_active(session, user, not user.is_active)
        new_state = "✅ فعال" if user.is_active else "⛔ غیرفعال"
    logger.info("Admin toggled user #%s -> %s", user_id, new_state)
    built = _build_detail(user_id)
    if built:
        await safe_edit(callback.message, built[0], built[1])
    await callback.answer(f"وضعیت کاربر: {new_state}")


@router.callback_query(F.data.startswith("adm:user:appts:"))
async def show_user_appointments(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:user:appts:<id>:<page>
    if len(parts) != 5:
        await callback.answer()
        return
    user_id, page = _int(parts[3]), _int(parts[4]) or 1
    if user_id is None:
        await callback.answer()
        return

    with session_scope() as session:
        user = user_service.get_by_id(session, user_id)
        items = list(
            session.scalars(select(Appointment).where(Appointment.user_id == user_id)).all()
        )
        items = sorted(items, key=lambda a: (a.date, a.start_time), reverse=True)
        result = paginate(items, page, PAGE_SIZE_TELEGRAM)
        lines = [
            f"{DIVIDER}📅 نوبت‌های {user.full_name if user else '—'}",
            f"({result.start_index}-{result.end_index} از {result.total}){DIVIDER}",
        ]
        for appt in result.items:
            lines.append(
                f"• {to_jalali(appt.date)} {hhmm(appt.start_time)} | {appt.tracking_code} | "
                f"{STATUS_LABELS_FA.get(appt.status, appt.status)}"
            )
        if not result.items:
            lines.append("نوبتی ثبت نشده است.")

    buttons = [
        page_buttons(f"adm:user:appts:{user_id}", result.page, result.total_pages),
        [InlineKeyboardButton(text="🔙 بازگشت", callback_data=f"adm:user:view:{user_id}")],
    ]
    await safe_edit(callback.message, "\n".join(lines), from_rows(buttons))
    await callback.answer()


def _int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
