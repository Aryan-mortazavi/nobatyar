"""
Entry points: /start, /help and the «دربارهٔ ما» page.

/start is the only place that decides whether a person is known:
a chat that already holds a customer token goes straight to the menu,
everybody else is welcomed and taken through identification.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from config import PUBLIC_WEB_URL
from channel.api import ChannelError, ChannelUnavailable
from channel.session import KEY_PHONE
from handlers.common import go_home, report_api_error, safe_catalogue, session
from keyboards.channel_keyboard import main_menu

router = Router(name="start")
logger = logging.getLogger(__name__)

ABOUT_TEXT = "ℹ️ دربارهٔ ما"


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    """First contact — greet, then either identify or show the menu."""
    chat = session(message, state)
    data = await state.get_data()
    name = data.get("ch_name", "")
    phone = data.get(KEY_PHONE, "")

    if name and phone:
        await go_home(message, state, greeting=f"سلام {name} عزیز 👋")
        return

    catalogue = await safe_catalogue(chat)
    if catalogue is None:
        # the web app is down: say so instead of asking for a phone number we
        # could not store anywhere
        await message.answer(
            "⚠️ در حال حاضر امکان ارتباط با سامانهٔ رزرو نیست.\n"
            "لطفاً چند دقیقهٔ دیگر /start را دوباره بفرستید."
        )
        return

    workspace = catalogue.workspace
    await message.answer(
        f"{workspace.title} 👋\n\n"
        "برای رزرو نوبت، نام و شمارهٔ موبایل خود را ثبت کنید.\n"
        "با همین حساب می‌توانید نوبت‌هایتان را ببینید یا لغو کنید.",
        reply_markup=main_menu(catalogue),
    )


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    """What this bot can do — no API call needed."""
    await message.answer(
        "📖 راهنمای ربات\n\n"
        "🗓 رزرو نوبت — خدمت، کارشناس، تاریخ و ساعت را انتخاب کنید.\n"
        "📋 نوبت‌های من — نوبت‌های پیش‌رو و گذشته، با امکان لغو.\n"
        "🎁 بسته‌های من — جلسات باقیماندهٔ بستهٔ خریداری‌شده.\n"
        "💬 پشتیبانی — پیام شما در پنل مدیریت ثبت می‌شود.\n"
        "🌐 رزرو در وب‌سایت — همان خدمات، در مرورگر شما.\n\n"
        f"وب‌سایت: {PUBLIC_WEB_URL}\n\n"
        "دستورها: /start · /help"
    )


@router.message(F.text == ABOUT_TEXT)
async def about(message: Message, state: FSMContext) -> None:
    """Business details, straight from the web app's settings."""
    chat = session(message, state)
    try:
        catalogue = await chat.catalogue()
    except (ChannelError, ChannelUnavailable) as exc:
        await report_api_error(message, None, exc)
        return

    workspace = catalogue.workspace
    lines = [f"🏥 <b>{workspace.title}</b>"]
    if workspace.phone:
        lines.append(f"📞 {workspace.phone}")
    if workspace.address:
        lines.append(f"📍 {workspace.address}")
    lines.append(f"🌐 {workspace.web_url or PUBLIC_WEB_URL}")
    lines.append("همهٔ نوبت‌های اینجا و در وب‌سایت یکی هستند؛ هرجا رزرو کنید، همان‌جا می‌بینید.")
    await message.answer("\n".join(lines), reply_markup=main_menu(catalogue))


__all__ = ["router", "ABOUT_TEXT"]
