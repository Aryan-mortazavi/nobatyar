"""Reply keyboards shown to normal users (all texts are Persian)."""

from __future__ import annotations

from aiogram.types import (
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)
from aiogram.utils.keyboard import ReplyKeyboardBuilder

from utils.constants import (
    BTN_ABOUT,
    BTN_BACK_TO_MENU,
    BTN_BOOK,
    BTN_CANCEL,
    BTN_CANCEL_APPOINTMENT,
    BTN_MY_APPOINTMENTS,
    BTN_PROFILE,
    BTN_RESCHEDULE,
    BTN_SUPPORT,
)


def _markup(builder: ReplyKeyboardBuilder, *, resize: bool = True) -> ReplyKeyboardMarkup:
    return builder.as_markup(resize_keyboard=True, input_field_placeholder="پیام خود را بنویسید...")


def main_menu() -> ReplyKeyboardMarkup:
    """🏠 منوی اصلی - the home screen of the bot."""
    builder = ReplyKeyboardBuilder()
    builder.button(text=BTN_BOOK)
    builder.button(text=BTN_MY_APPOINTMENTS)
    builder.row(KeyboardButton(text=BTN_RESCHEDULE), KeyboardButton(text=BTN_CANCEL_APPOINTMENT))
    builder.row(KeyboardButton(text=BTN_PROFILE), KeyboardButton(text=BTN_SUPPORT))
    builder.button(text=BTN_ABOUT)
    builder.adjust(1, 2, 2, 1)
    return _markup(builder)


def contact_request() -> ReplyKeyboardMarkup:
    """Keyboard with Telegram's 'share contact' button (registration step 3)."""
    builder = ReplyKeyboardBuilder()
    builder.button(text="📱 ارسال شماره تماس من", request_contact=True)
    builder.button(text=BTN_CANCEL)
    builder.adjust(1, 1)
    return _markup(builder)


def cancel_keyboard() -> ReplyKeyboardMarkup:
    """❌ انصراف - shown during every multi-step form."""
    builder = ReplyKeyboardBuilder()
    builder.button(text=BTN_CANCEL)
    builder.adjust(1)
    return _markup(builder)


def back_cancel_keyboard() -> ReplyKeyboardMarkup:
    """🔙 بازگشت + ❌ انصراف - the safety net of every step."""
    builder = ReplyKeyboardBuilder()
    builder.button(text=BTN_BACK_TO_MENU)
    builder.button(text=BTN_CANCEL)
    builder.adjust(2)
    return _markup(builder)


def remove() -> ReplyKeyboardRemove:
    """Hide the reply keyboard (used right after registration)."""
    return ReplyKeyboardRemove()
