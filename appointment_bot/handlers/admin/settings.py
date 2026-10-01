"""
⚙️ تنظیمات (admin)

Every row of the `settings` table can be edited from Telegram.
Values are stored as strings; typed getters apply defaults elsewhere.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.session import session_scope
from handlers.admin.base import ensure_admin, home_button, page_buttons, safe_edit
from handlers.states import AdminSettingsForm
from keyboards.inline_keyboard import from_rows
from services import settings_service
from utils.constants import BTN_ADMIN_SETTINGS, DIVIDER, PAGE_SIZE_TELEGRAM
from utils.helpers import paginate

router = Router(name="admin_settings")
logger = logging.getLogger(__name__)


def _build_list(page: int) -> tuple[str, object]:
    with session_scope() as session:
        rows = settings_service.get_described_settings(session)
    result = paginate(rows, page, PAGE_SIZE_TELEGRAM)
    lines = [
        f"{DIVIDER}⚙️ تنظیمات سامانه",
        f"({result.start_index}-{result.end_index} از {result.total}){DIVIDER}",
    ]
    buttons: list[list[InlineKeyboardButton]] = []
    for key, value, description, _flag in result.items:
        shown = value if len(value) <= 40 else value[:37] + "..."
        lines.append(f"• {description}\n  {key} = {shown}")
        buttons.append([
            InlineKeyboardButton(text=f"✏️ {description}", callback_data=f"adm:set:edit:{key}")
        ])

    buttons.append(page_buttons("adm:set:list", result.page, result.total_pages))
    buttons.append([home_button()])
    return "\n".join(lines), from_rows(buttons)


@router.message(F.text == BTN_ADMIN_SETTINGS)
async def settings_menu(message: Message) -> None:
    if not await ensure_admin(message):
        return
    text, keyboard = _build_list(1)
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("adm:set:list"))
async def show_settings(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    page = _page(callback.data.rsplit(":", 1)[-1])
    text, keyboard = _build_list(page)
    await safe_edit(callback.message, text, keyboard)
    await callback.answer()


@router.callback_query(F.data.startswith("adm:set:edit:"))
async def ask_setting_value(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    key = callback.data.split(":", 3)[3]
    if not key:
        await callback.answer()
        return
    with session_scope() as session:
        current = settings_service.get_setting(session, key)
    await state.set_state(AdminSettingsForm.value)
    await state.update_data(setting_key=key)
    await callback.message.answer(
        f"⚙️ مقدار جدید برای «{key}» را وارد کنید:\n"
        f"مقدار فعلی: {current}",
        reply_markup=_back(),
    )
    await callback.answer()


@router.message(AdminSettingsForm.value, StateFilter(AdminSettingsForm.value), F.text)
async def save_setting(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    data = await state.get_data()
    key = data.get("setting_key")
    if not key:
        await state.clear()
        await message.answer("❌ خطای داخلی؛ دوباره تلاش کنید.")
        return
    value = (message.text or "").strip()
    if value == "-":
        value = ""

    with session_scope() as session:
        settings_service.set_setting(session, key, value)

    logger.info("Admin updated setting %s", key)
    await state.clear()
    await message.answer(f"✅ تنظیم «{key}» به‌روزرسانی شد.")
    text, keyboard = _build_list(1)
    await message.answer(text, reply_markup=keyboard)


def _page(value: str) -> int:
    try:
        return max(1, int(value))
    except ValueError:
        return 1


def _back():
    from keyboards.user_keyboard import back_cancel_keyboard

    return back_cancel_keyboard()
