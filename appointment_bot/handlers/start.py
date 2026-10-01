"""
Entry point of the bot: /start, /help and the "درباره ما" page.

/start logic:
    unknown user  -> start the registration flow (FSM)
    known user    -> show the main menu (admins also get a hint for /admin)
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from handlers.common import go_home, safe_int
from handlers.registration import start_registration
from keyboards.user_keyboard import main_menu
from services import auth_service, settings_service, user_service
from database.session import session_scope
from utils.constants import BTN_ABOUT, DIVIDER, MENU_TITLE

router = Router(name="start")
logger = logging.getLogger(__name__)


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    """First contact with the bot."""
    await state.clear()
    telegram_id = safe_int(message.from_user.id, 0) or 0

    with session_scope() as session:
        user = user_service.get_by_telegram(session, telegram_id)
        is_admin = auth_service.is_admin(session, telegram_id)

    if user is None:
        # Not registered yet -> registration FSM takes over
        await start_registration(message, state)
        return

    if not user.is_active:
        await message.answer(
            "❌ حساب شما غیرفعال شده است.\nبرای اطلاعات بیشتر با پشتیبانی تماس بگیرید."
        )
        return

    text = (
        f"سلام {user.full_name} عزیز 👋\n"
        f"به ربات رزرو نوبت خوش آمدید.\n\n"
        f"{MENU_TITLE}"
    )
    await message.answer(text, reply_markup=main_menu())
    if is_admin:
        await message.answer("شما دسترسی مدیریت دارید. برای ورود: /admin")


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    """List of available commands."""
    await message.answer(
        "📖 راهنمای ربات\n\n"
        "/start - منوی اصلی\n"
        "/admin - پنل مدیریت (فقط مدیر)\n"
        "/help - همین راهنما\n\n"
        "از دکمه‌های زیر هم می‌توانید استفاده کنید:"
    )


@router.message(F.text == BTN_ABOUT)
async def about_us(message: Message) -> None:
    """ℹ️ درباره ما - data comes from the settings table."""
    with session_scope() as session:
        settings = settings_service.get_all_settings(session)

    await message.answer(
        f"{DIVIDER}\n"
        f"ℹ️ درباره ما\n"
        f"{DIVIDER}\n"
        f"🏢 {settings.get('center_name', '')}\n\n"
        f"📞 تلفن: {settings.get('phone', '')}\n"
        f"📍 آدرس: {settings.get('address', '')}\n\n"
        f"{settings.get('about_text', '')}\n"
        f"{DIVIDER}"
    )
