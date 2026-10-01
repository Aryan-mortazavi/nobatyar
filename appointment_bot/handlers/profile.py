"""
🎁 «بسته‌های من» and 💬 «پشتیبانی».

The package screen is the channel-side twin of the web app's prepaid bundles:
the customer sees the same quota, spends a session while booking in Telegram,
and finds the counter already reduced on the website.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from channel.api import ChannelError, ChannelUnavailable
from channel.session import BookingFlow
from channel.text import package_card
from handlers.common import go_home, report_api_error, safe_catalogue, session
from handlers.registration import start_registration
from keyboards.channel_keyboard import cancel_keyboard, main_menu

router = Router(name="profile")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Packages
# ---------------------------------------------------------------------------
async def _show_packages(message: Message, state: FSMContext) -> None:
    chat = session(message, state)
    if not chat.identified:
        await start_registration(message, state)
        return

    catalogue = await safe_catalogue(chat)
    try:
        packages = await chat.api.packages(
            customer_token=chat.require_token(), telegram_id=chat.telegram_id
        )
    except LookupError:
        await start_registration(message, state)
        return
    except (ChannelError, ChannelUnavailable) as exc:
        await report_api_error(message, catalogue, exc)
        return

    if not packages:
        text = (catalogue.label("noPackages", "") if catalogue else "") or (
            "بستهٔ فعالی ندارید."
        )
        await message.answer(
            f"{text}\n\nخرید بسته از طریق کسب‌وکار انجام می‌شود؛ پس از خرید، "
            "همین‌جا می‌توانید جلسات باقیمانده را ببینید و در رزرو مصرف کنید.",
            reply_markup=main_menu(catalogue),
        )
        return

    title = (catalogue.label("packagesTitle", "") if catalogue else "") or "بسته‌های من"
    body = "\n\n".join(package_card(package) for package in packages)
    await message.answer(f"🎁 {title}\n\n{body}", reply_markup=main_menu(catalogue))


@router.message(F.text.regexp(r"^🎁"))
async def reply_packages(message: Message, state: FSMContext) -> None:
    await _show_packages(message, state)


# ---------------------------------------------------------------------------
# Support
# ---------------------------------------------------------------------------
@router.message(F.text.regexp(r"^💬"))
async def reply_support(message: Message, state: FSMContext) -> None:
    chat = session(message, state)
    if not chat.identified:
        await start_registration(message, state)
        return
    catalogue = await safe_catalogue(chat)
    await state.set_state(BookingFlow.support)
    await message.answer(
        (catalogue.label("supportPrompt", "") if catalogue else "")
        or "پیام خود را بنویسید؛ تیم پشتیبانی در پنل مدیریت پاسخ می‌دهد:",
        reply_markup=cancel_keyboard(catalogue),
    )


@router.message(BookingFlow.support, F.text)
async def send_support(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if len(text) < 5:
        await message.answer("پیام کوتاه است؛ کمی بیشتر توضیح دهید:")
        return

    chat = session(message, state)
    catalogue = await safe_catalogue(chat)
    try:
        result = await chat.api.send_support(
            customer_token=chat.require_token(),
            telegram_id=chat.telegram_id,
            message=text,
        )
    except LookupError:
        await start_registration(message, state)
        return
    except (ChannelError, ChannelUnavailable) as exc:
        await report_api_error(message, catalogue, exc)
        return

    await state.set_state(None)
    confirmation = result.get("message") or (
        (catalogue.label("supportSent", "") if catalogue else "")
        or "پیام شما ثبت شد."
    )
    await message.answer(f"✅ {confirmation}", reply_markup=main_menu(catalogue))


__all__ = ["router"]
