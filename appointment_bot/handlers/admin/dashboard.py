"""📊 Dashboard - live statistics of the whole system."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.queries import (
    appointments_by_status,
    appointments_last_days,
    dashboard_stats,
    service_load,
    staff_load,
)
from database.session import session_scope
from handlers.admin.base import ensure_admin, safe_edit
from keyboards.inline_keyboard import from_rows
from utils.calendar import tehran_today, to_jalali
from utils.constants import BTN_DASHBOARD, DIVIDER

router = Router(name="admin_dashboard")
logger = logging.getLogger(__name__)


def build_dashboard() -> tuple[str, object]:
    with session_scope() as session:
        stats = dashboard_stats(session)
        by_status = appointments_by_status(session)
        last_days = appointments_last_days(session, 7)
        services = service_load(session)[:5]
        staff = staff_load(session)[:5]

    text = (
        f"{DIVIDER}\n📊 داشبورد\n{DIVIDER}\n"
        f"📅 امروز ({to_jalali(tehran_today())}): {stats['today']} نوبت\n"
        f"⏭ نوبت‌های آینده: {stats['upcoming']}\n"
        f"🕓 در انتظار تأیید: {stats['pending']}\n"
        f"✅ تأیید شده: {stats['confirmed']}\n"
        f"❌ لغو شده: {stats['cancelled']}\n"
        f"✔ انجام شده: {stats['completed']}\n"
        f"🚫 عدم مراجعه: {stats['no_show']}\n\n"
        f"👥 کل کاربران: {stats['total_users']}\n"
        f"🧑‍💼 کارکنان فعال: {stats['total_staff']}\n"
        f"🛠 خدمات فعال: {stats['total_services']}\n"
        f"📨 تیکت‌های باز: {stats['open_tickets']}\n"
        f"⏳ لیست انتظار: {stats['waitlist_pending']}\n"
        f"🚫 تعطیلات ثبت‌شده: {stats['holidays']}\n"
        f"{DIVIDER}\n"
        f"📈 نوبت‌های ۷ روز اخیر:\n"
        + ("".join(f"  • {d}: {c}\n" for d, c in last_days) or "  —\n")
    )

    if services:
        text += "\n⭐ پرتقاضاترین خدمات:\n" + "".join(
            f"  • {name}: {count}\n" for name, count in services
        )
    if staff:
        text += "\n🧑‍💼 پرکارترین کارکنان:\n" + "".join(
            f"  • {name}: {count}\n" for name, count in staff
        )
    text += f"{DIVIDER}"

    keyboard = from_rows([[
        InlineKeyboardButton(text="🔄 بروزرسانی", callback_data="adm:dash:refresh"),
        InlineKeyboardButton(text="🏠 منوی مدیریت", callback_data="adm:home"),
    ]])
    return text, keyboard


@router.message(F.text == BTN_DASHBOARD)
async def show_dashboard(message: Message) -> None:
    if not await ensure_admin(message):
        return
    text, keyboard = build_dashboard()
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data == "adm:dash:refresh")
async def refresh_dashboard(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    text, keyboard = build_dashboard()
    await safe_edit(callback.message, text, keyboard)
    await callback.answer("🔄 بروزرسانی شد.")
