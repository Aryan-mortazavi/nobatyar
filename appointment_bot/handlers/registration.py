"""
Registration flow (FSM):

    /start -> first name -> last name -> phone (Telegram contact) -> done

The phone number is collected with Telegram's built-in "share contact"
button; a typed number is also accepted and validated.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import Contact, Message

from config import ADMIN_IDS
from database.session import session_scope
from handlers.states import Registration
from keyboards.user_keyboard import back_cancel_keyboard, contact_request, main_menu
from services import notification_service, user_service
from utils.calendar import tehran_today, to_jalali
from utils.constants import ROLE_ADMIN
from utils.validators import validate_name, validate_phone

router = Router(name="registration")
logger = logging.getLogger(__name__)


async def start_registration(message: Message, state: FSMContext) -> None:
    """Called by /start when this Telegram id is unknown to the system."""
    await state.set_state(Registration.first_name)
    await message.answer(
        "👋 به ربات رزرو نوبت خوش آمدید!\n\n"
        "برای استفاده از امکانات ربات، ابتدا ثبت‌نام کنید.\n\n"
        "👤 لطفاً نام خود را وارد کنید:",
        reply_markup=back_cancel_keyboard(),
    )


# ---------------------------------------------------------------------------
# Step 1: first name
# ---------------------------------------------------------------------------
@router.message(Registration.first_name, StateFilter(Registration.first_name))
async def process_first_name(message: Message, state: FSMContext) -> None:
    if message.text is None:
        await message.answer("❌ لطفاً نام را به صورت متنی ارسال کنید:")
        return
    name, error = validate_name(message.text)
    if error:
        await message.answer(error)
        return
    await state.update_data(first_name=name)
    await state.set_state(Registration.last_name)
    await message.answer(
        "👤 لطفاً نام خانوادگی خود را وارد کنید:",
        reply_markup=back_cancel_keyboard(),
    )


# ---------------------------------------------------------------------------
# Step 2: last name
# ---------------------------------------------------------------------------
@router.message(Registration.last_name, StateFilter(Registration.last_name))
async def process_last_name(message: Message, state: FSMContext) -> None:
    if message.text is None:
        await message.answer("❌ لطفاً نام خانوادگی را به صورت متنی ارسال کنید:")
        return
    name, error = validate_name(message.text)
    if error:
        await message.answer(error.replace("نام", "نام خانوادگی"))
        return
    await state.update_data(last_name=name)
    await state.set_state(Registration.phone)
    await message.answer(
        "📱 شماره موبایل خود را ارسال کنید.\n"
        "می‌توانید دکمه زیر را بزنید تا شماره‌تان به صورت خودکار ارسال شود:",
        reply_markup=contact_request(),
    )


# ---------------------------------------------------------------------------
# Step 3: phone (contact button or typed number)
# ---------------------------------------------------------------------------
@router.message(Registration.phone, StateFilter(Registration.phone), F.contact)
async def process_contact(message: Message, state: FSMContext) -> None:
    contact: Contact = message.contact
    phone, error = validate_phone(contact.phone_number)
    if error:
        await message.answer(error)
        return
    await _finish_registration(message, state, phone)


@router.message(Registration.phone, StateFilter(Registration.phone), F.text)
async def process_phone_text(message: Message, state: FSMContext) -> None:
    phone, error = validate_phone(message.text or "")
    if error:
        await message.answer(error)
        return
    await _finish_registration(message, state, phone)


async def _finish_registration(message: Message, state: FSMContext, phone: str) -> None:
    """Create the user row and open the main menu."""
    data = await state.get_data()
    telegram_id = message.from_user.id
    role = ROLE_ADMIN if telegram_id in ADMIN_IDS else "user"

    with session_scope() as session:
        user, created = user_service.get_or_create(
            session,
            telegram_id=telegram_id,
            first_name=data.get("first_name", ""),
            last_name=data.get("last_name", ""),
            phone=phone,
            role=role,
        )
        if not created:
            # Safety net: the account already existed -> just update the phone
            user_service.update_profile(session, user, phone=phone)
        summary = (
            "✅ ثبت‌نام شما با موفقیت انجام شد.\n\n"
            f"👤 نام: {user.full_name}\n"
            f"📱 موبایل: {user.phone}\n"
            f"🆔 شناسه تلگرام: {user.telegram_id}\n"
            f"🗓 تاریخ ثبت‌نام: {to_jalali(tehran_today())}\n"
        )
        admin_text = (
            f"👤 کاربر جدید ثبت‌نام کرد:\n"
            f"{user.full_name} | {user.phone} | {user.telegram_id}"
        )

    await state.clear()
    await message.answer(summary, reply_markup=main_menu())
    logger.info("New user registered: %s", telegram_id)

    # Inform the admins (never blocks the flow if it fails)
    try:
        await notification_service.send_admins(admin_text, ntype="admin_message")
    except Exception:  # pragma: no cover
        logger.warning("Could not notify admins about new user", exc_info=True)
