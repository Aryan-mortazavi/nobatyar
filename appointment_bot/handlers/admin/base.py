"""
Telegram admin panel - shared plumbing.

    /admin                 -> permission check + admin menu
    adm:home               -> back to the admin menu
    helpers used by every admin sub-module

Authorization is based on ADMIN_IDS from the .env file (never hard-coded) and
on the User.role column, so new roles can be introduced later.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.session import session_scope
from handlers.states import AdminReportForm, AdminSettingsForm
from keyboards.admin_keyboard import admin_menu
from keyboards.inline_keyboard import from_rows
from services import auth_service
from utils.constants import (
    ADMIN_MENU_TITLE,
    BTN_DASHBOARD,
    NO_PERMISSION_MESSAGE,
)

router = Router(name="admin_base")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------
async def ensure_admin(target: Message | CallbackQuery) -> bool:
    """Return True when this Telegram user may use the admin panel."""
    if target.from_user is None:
        return False
    telegram_id = target.from_user.id
    with session_scope() as session:
        allowed = auth_service.is_admin(session, telegram_id)

    if not allowed:
        logger.warning("Unauthorized admin attempt from user=%s", telegram_id)
        if isinstance(target, CallbackQuery):
            await target.answer(NO_PERMISSION_MESSAGE, show_alert=True)
        else:
            await target.answer(NO_PERMISSION_MESSAGE)
    return allowed


def build_menu() -> str:
    """Short headline with the live counters of the admin menu."""
    from database.queries import dashboard_stats

    with session_scope() as session:
        stats = dashboard_stats(session)
    return (
        f"{ADMIN_MENU_TITLE}\n\n"
        f"👥 کاربران: {stats['total_users']}\n"
        f"📅 نوبت‌های امروز: {stats['today']}\n"
        f"📨 تیکت‌های باز: {stats['open_tickets']}\n"
        f"⏳ لیست انتظار: {stats['waitlist_pending']}"
    )


@router.message(Command("admin"), StateFilter("*"))
async def admin_entry(message: Message, state: FSMContext) -> None:
    """Only users listed in ADMIN_IDS (.env) can open the panel."""
    if not await ensure_admin(message):
        return
    await state.clear()
    await message.answer(build_menu(), reply_markup=admin_menu())


@router.callback_query(F.data == "adm:home")
async def admin_home(callback: CallbackQuery, state: FSMContext) -> None:
    """Generic 'back to admin menu' button used inside the panel."""
    if not await ensure_admin(callback):
        return
    await state.clear()
    await callback.message.edit_text(build_menu())
    await callback.answer()


# ---------------------------------------------------------------------------
# Small helpers shared by the admin modules
# ---------------------------------------------------------------------------
def page_buttons(prefix: str, page: int, total_pages: int) -> list[InlineKeyboardButton]:
    """⬅️ Previous | Page x/y | Next ➡️"""
    row: list[InlineKeyboardButton] = []
    if page > 1:
        row.append(InlineKeyboardButton(text="⬅️ قبلی", callback_data=f"{prefix}:{page - 1}"))
    row.append(InlineKeyboardButton(text=f"صفحه {page}/{total_pages}", callback_data="noop"))
    if page < total_pages:
        row.append(InlineKeyboardButton(text="بعدی ➡️", callback_data=f"{prefix}:{page + 1}"))
    return row


def home_button() -> InlineKeyboardButton:
    return InlineKeyboardButton(text="🏠 منوی مدیریت", callback_data="adm:home")


async def safe_edit(message: Message, text: str, keyboard=None) -> None:
    """Edit without crashing on 'message is not modified'."""
    try:
        await message.edit_text(text, reply_markup=keyboard)
    except Exception:  # noqa: BLE001
        logger.debug("admin edit skipped", exc_info=True)


async def send_or_edit(target: Message | CallbackQuery, text: str, keyboard=None) -> None:
    """Answer a message, or edit the message behind a callback."""
    if isinstance(target, CallbackQuery):
        await safe_edit(target.message, text, keyboard)
        await target.answer()
    else:
        await target.answer(text, reply_markup=keyboard)


def status_label(status: str) -> str:
    from utils.constants import STATUS_LABELS_FA

    return STATUS_LABELS_FA.get(status, status)


__all__ = [
    "router",
    "ensure_admin",
    "build_menu",
    "page_buttons",
    "home_button",
    "safe_edit",
    "send_or_edit",
    "status_label",
    "AdminReportForm",
    "AdminSettingsForm",
]
