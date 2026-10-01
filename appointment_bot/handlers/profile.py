"""👤 پروفایل من - view and edit personal information."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from database.session import session_scope
from handlers.common import require_registered
from handlers.states import ProfileEdit
from keyboards import inline_keyboard as inline
from keyboards.user_keyboard import back_cancel_keyboard, contact_request, main_menu
from services import user_service
from utils.calendar import to_jalali
from utils.constants import BTN_PROFILE, DIVIDER
from utils.validators import validate_name, validate_phone

router = Router(name="profile")
logger = logging.getLogger(__name__)


def _profile_text(user_id: int) -> str:
    with session_scope() as session:
        user = user_service.get_by_id(session, user_id)
        if user is None:
            return "❌ پروفایل یافت نشد."
        appointments = user_service.count_appointments(session, user_id)
        created = to_jalali(user.created_at.date()) if user.created_at else "—"
    return (
        f"{DIVIDER}\n👤 پروفایل من\n{DIVIDER}\n"
        f"👤 نام: {user.full_name}\n"
        f"📱 موبایل: {user.phone or '—'}\n"
        f"🆔 شناسه تلگرام: {user.telegram_id}\n"
        f"🗓 تاریخ ثبت‌نام: {created}\n"
        f"📅 تعداد نوبت‌ها: {appointments}\n"
        f"{DIVIDER}"
    )


def _profile_keyboard() -> object:
    return inline.simple(
        [
            ("✏️ ویرایش نام", "prof:first"),
            ("✏️ ویرایش نام خانوادگی", "prof:last"),
            ("📱 تغییر شماره تماس", "prof:phone"),
            ("🏠 منوی اصلی", "menu:home"),
        ]
    )


@router.message(F.text == BTN_PROFILE)
async def show_profile(message: Message, state: FSMContext) -> None:
    user = await require_registered(message, state)
    if user is None:
        return
    await message.answer(_profile_text(user.id), reply_markup=_profile_keyboard())


@router.callback_query(F.data.startswith("prof:"))
async def on_edit_request(callback: CallbackQuery, state: FSMContext) -> None:
    field = callback.data.split(":")[1]
    states = {
        "first": (ProfileEdit.first_name, "✏️ نام جدید خود را وارد کنید:"),
        "last": (ProfileEdit.last_name, "✏️ نام خانوادگی جدید را وارد کنید:"),
        "phone": (ProfileEdit.phone, "📱 شماره موبایل جدید را ارسال کنید:"),
    }
    if field not in states:
        await callback.answer()
        return
    new_state, prompt = states[field]
    await state.set_state(new_state)
    reply = contact_request() if field == "phone" else back_cancel_keyboard()
    try:
        await callback.message.answer(prompt, reply_markup=reply)
    except Exception:  # noqa: BLE001
        logger.debug("profile prompt failed", exc_info=True)
    await callback.answer()


@router.message(ProfileEdit.first_name, StateFilter(ProfileEdit.first_name), F.text)
async def save_first_name(message: Message, state: FSMContext) -> None:
    name, error = validate_name(message.text or "")
    if error:
        await message.answer(error)
        return
    user = await require_registered(message, state)
    if user is None:
        return
    with session_scope() as session:
        current = user_service.get_by_id(session, user.id)
        user_service.update_profile(session, current, first_name=name)
    await state.clear()
    await message.answer(
        "✅ نام به‌روزرسانی شد.", reply_markup=None
    )
    await message.answer(_profile_text(user.id), reply_markup=_profile_keyboard())


@router.message(ProfileEdit.last_name, StateFilter(ProfileEdit.last_name), F.text)
async def save_last_name(message: Message, state: FSMContext) -> None:
    name, error = validate_name(message.text or "")
    if error:
        await message.answer(error.replace("نام", "نام خانوادگی"))
        return
    user = await require_registered(message, state)
    if user is None:
        return
    with session_scope() as session:
        current = user_service.get_by_id(session, user.id)
        user_service.update_profile(session, current, last_name=name)
    await state.clear()
    await message.answer("✅ نام خانوادگی به‌روزرسانی شد.")
    await message.answer(_profile_text(user.id), reply_markup=_profile_keyboard())


@router.message(ProfileEdit.phone, StateFilter(ProfileEdit.phone), F.contact)
async def save_contact_phone(message: Message, state: FSMContext) -> None:
    phone, error = validate_phone(message.contact.phone_number)
    if error:
        await message.answer(error)
        return
    await _save_phone(message, state, phone)


@router.message(ProfileEdit.phone, StateFilter(ProfileEdit.phone), F.text)
async def save_typed_phone(message: Message, state: FSMContext) -> None:
    phone, error = validate_phone(message.text or "")
    if error:
        await message.answer(error)
        return
    await _save_phone(message, state, phone)


async def _save_phone(message: Message, state: FSMContext, phone: str) -> None:
    user = await require_registered(message, state)
    if user is None:
        return
    with session_scope() as session:
        current = user_service.get_by_id(session, user.id)
        user_service.update_profile(session, current, phone=phone)
    await state.clear()
    await message.answer("✅ شماره تماس به‌روزرسانی شد.")
    await message.answer(_profile_text(user.id), reply_markup=_profile_keyboard())
