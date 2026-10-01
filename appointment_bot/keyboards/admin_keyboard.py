"""Reply keyboards of the Telegram admin panel."""

from __future__ import annotations

from aiogram.types import KeyboardButton, ReplyKeyboardMarkup
from aiogram.utils.keyboard import ReplyKeyboardBuilder

from utils.constants import (
    ADMIN_MENU_BUTTONS,
    ADMIN_MENU_TITLE,
    BTN_ADMIN_APPOINTMENTS,
    BTN_ADMIN_EXIT,
    BTN_BACK_TO_MENU,
    BTN_CANCEL,
    BTN_NO,
    BTN_YES,
)


def admin_menu() -> ReplyKeyboardMarkup:
    """⚙️ پنل مدیریت - every button here has a working handler."""
    builder = ReplyKeyboardBuilder()
    builder.button(text=BTN_ADMIN_APPOINTMENTS)
    builder.button(text="👥 مدیریت کاربران")
    builder.button(text="🧑‍💼 مدیریت کارکنان")
    builder.button(text="🛠 مدیریت خدمات")
    builder.button(text="🕐 ساعات کاری")
    builder.button(text="🚫 تعطیلات")
    builder.button(text="⏳ لیست انتظار")
    builder.button(text="📈 گزارش‌ها")
    builder.button(text="📨 تیکت‌های پشتیبانی")
    builder.button(text="⚙️ تنظیمات")
    builder.button(text="📊 داشبورد")
    builder.button(text=BTN_ADMIN_EXIT)
    builder.adjust(2, 2, 2, 2, 2, 1, 1)
    return builder.as_markup(resize_keyboard=True)


def back_to_menu() -> ReplyKeyboardMarkup:
    """🔙 بازگشت به منو - leaves the admin panel safely."""
    builder = ReplyKeyboardBuilder()
    builder.button(text=BTN_BACK_TO_MENU)
    builder.button(text=BTN_CANCEL)
    builder.adjust(2)
    return builder.as_markup(resize_keyboard=True)


def confirm_keyboard() -> ReplyKeyboardMarkup:
    """✅ بله / ❌ خیر - used before destructive admin actions."""
    builder = ReplyKeyboardBuilder()
    builder.button(text=BTN_YES)
    builder.button(text=BTN_NO)
    builder.adjust(2)
    return builder.as_markup(resize_keyboard=True, input_field_placeholder="پاسخ خود را بنویسید...")
