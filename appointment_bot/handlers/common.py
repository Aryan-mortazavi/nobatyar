"""
Shared handlers + helpers used by every router.

This router is registered FIRST, so "❌ انصراف" and "🔙 بازگشت به منو" always
work - the user can never get trapped inside a multi-step flow.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from database.models import User
from database.session import session_scope
from keyboards.user_keyboard import main_menu
from utils.constants import BTN_BACK_TO_MENU, BTN_CANCEL, MENU_TITLE

router = Router(name="common")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Universal escape buttons
# ---------------------------------------------------------------------------
async def go_home(message: Message, state: FSMContext) -> None:
    """Clear any FSM state and show the main menu."""
    await state.clear()
    await message.answer(MENU_TITLE, reply_markup=main_menu())


@router.message(F.text.in_({BTN_CANCEL, BTN_BACK_TO_MENU}), StateFilter("*"))
async def cancel_flow(message: Message, state: FSMContext) -> None:
    """❌ انصراف / 🔙 بازگشت به منو -> always safe."""
    await go_home(message, state)


@router.callback_query(F.data == "noop")
async def ignore_callback(callback: CallbackQuery) -> None:
    """Layout-only buttons must not raise 'query is too old'."""
    await callback.answer()


@router.callback_query(F.data == "menu:home")
async def home_callback(callback: CallbackQuery, state: FSMContext) -> None:
    """🏠 button placed at the end of several inline keyboards."""
    await state.clear()
    await callback.message.edit_text(MENU_TITLE)
    await callback.answer()


# ---------------------------------------------------------------------------
# Small helpers shared by the other handler modules
# ---------------------------------------------------------------------------
async def require_registered(message: Message, state: FSMContext) -> User | None:
    """
    Return the registered User of this chat, or answer with a hint and None.

    Booking, profile and appointments are only available after registration.
    The returned object is detached from the session but every column it needs
    (id, telegram_id, name, phone, role, is_active) is already loaded.
    """
    from services import user_service

    telegram_id = message.from_user.id if message.from_user else 0
    with session_scope() as session:
        user = user_service.get_by_telegram(session, telegram_id)

    if user is None:
        await message.answer(
            "❌ هنوز ثبت‌نام نکرده‌اید.\nبرای شروع /start را بزنید."
        )
        await state.clear()
        return None
    return user


def safe_int(value: object, default: int | None = None) -> int | None:
    """Parse an id coming from callback data; never raises."""
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return default
