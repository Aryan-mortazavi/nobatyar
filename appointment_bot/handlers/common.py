"""
Shared handlers and helpers.

Registered first, so «❌ انصراف» always works and no customer can get stuck
inside a multi-step flow.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from channel.api import Catalogue, ChannelError, ChannelUnavailable
from channel.runtime import get_api
from channel.session import Session
from channel.text import error_text
from keyboards.channel_keyboard import FALLBACK, cancel_keyboard, main_menu

router = Router(name="common")
logger = logging.getLogger(__name__)

BTN_CANCEL = FALLBACK["cancel"]


# ---------------------------------------------------------------------------
# Helpers used by every handler
# ---------------------------------------------------------------------------
def session(message: Message, state: FSMContext) -> Session:
    """Build the per-chat session bound to the shared API client."""
    user = message.from_user
    return Session(
        api=get_api(),
        state=state,
        telegram_id=user.id if user else 0,
        username=user.username if user else None,
    )


async def safe_catalogue(chat: Session) -> Catalogue | None:
    """
    The catalogue, or ``None`` when the web app cannot be reached.

    Handlers use this to keep the flow alive (the customer can still press
    «❌ انصراف») instead of raising inside a Telegram handler.
    """
    try:
        return await chat.catalogue()
    except (ChannelError, ChannelUnavailable) as exc:
        logger.warning("catalogue unavailable: %s", exc)
        return None


async def go_home(message: Message, state: FSMContext, greeting: str = "") -> None:
    """Clear the flow and show the main menu."""
    chat = session(message, state)
    await state.clear()
    catalogue = await safe_catalogue(chat)
    text = "یکی از گزینه‌های زیر را انتخاب کنید:"
    if catalogue:
        title = catalogue.workspace.title
        text = f"🏥 <b>{title}</b>\n\n{text}"
    if greeting:
        text = f"{greeting}\n\n{text}"
    await message.answer(text, reply_markup=main_menu(catalogue))


# ---------------------------------------------------------------------------
# Universal escape buttons
# ---------------------------------------------------------------------------
@router.message(F.text == BTN_CANCEL, StateFilter("*"))
async def cancel_flow(message: Message, state: FSMContext) -> None:
    await go_home(message, state)


@router.callback_query(F.data == "noop")
async def ignore_callback(callback: CallbackQuery) -> None:
    """Layout-only buttons must not raise 'query is too old'."""
    await callback.answer()


@router.callback_query(F.data == "menu:home")
async def home_callback(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer()
    if callback.message:
        await go_home(callback.message, state)


# ---------------------------------------------------------------------------
# Error reporting
# ---------------------------------------------------------------------------
async def report_api_error(
    target: Message | CallbackQuery, catalogue: Catalogue | None, exc: Exception
) -> None:
    """
    Turn an API failure into one helpful sentence.

    A Telegram user never sees an HTTP status, a stack trace, or a silent
    nothing-happened.
    """
    if isinstance(exc, ChannelUnavailable):
        logger.error("web app unreachable: %s", exc)
        text = (
            "⚠️ در حال حاضر امکان ارتباط با سامانهٔ رزرو نیست.\n"
            "لطفاً چند دقیقهٔ دیگر دوباره تلاش کنید."
        )
    elif isinstance(exc, ChannelError) and exc.slot_taken:
        text = catalogue.label("slotTaken", "") if catalogue else ""
        text = text or "این بازه هم‌اکنون رزرو شد. لطفاً زمان دیگری انتخاب کنید."
    else:
        text = error_text(catalogue)
        logger.warning("channel API error: %s", exc)
    if isinstance(target, CallbackQuery):
        await target.answer(text, show_alert=True)
    else:
        await target.answer(text, reply_markup=cancel_keyboard(catalogue))


__all__ = ["router", "session", "safe_catalogue", "go_home", "report_api_error"]
