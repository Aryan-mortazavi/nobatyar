"""
⏳ لیست انتظار (admin)

    view who is waiting for which day / staff member
    change the status of an entry (or delete it)
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message
from sqlalchemy import select

from database.models import User, Waitlist
from database.session import session_scope
from handlers.admin.base import ensure_admin, home_button, page_buttons, safe_edit
from keyboards.inline_keyboard import from_rows
from services import waitlist_service
from utils.calendar import to_jalali
from utils.constants import (
    BTN_ADMIN_WAITLIST,
    DIVIDER,
    PAGE_SIZE_TELEGRAM,
    WAITLIST_LABELS_FA,
    WAITLIST_STATUSES,
)
from utils.helpers import hhmm, paginate

router = Router(name="admin_waitlist")
logger = logging.getLogger(__name__)


def _build_list(status: str | None, page: int) -> tuple[str, object]:
    with session_scope() as session:
        entries = waitlist_service.list_entries(session, status=status)
        result = paginate(entries, page, PAGE_SIZE_TELEGRAM)
        title = WAITLIST_LABELS_FA.get(status, "همه") if status else "همه"
        lines = [
            f"{DIVIDER}⏳ لیست انتظار — {title}",
            f"({result.start_index}-{result.end_index} از {result.total}){DIVIDER}",
        ]
        buttons: list[list[InlineKeyboardButton]] = []
        for entry in result.items:
            user = session.get(User, entry.user_id)
            preferred = hhmm(entry.preferred_time) if entry.preferred_time else "—"
            lines.append(
                f"• {user.full_name if user else '—'} | {to_jalali(entry.date)} | "
                f"{entry.staff.name} | ساعت مورد علاقه: {preferred}\n"
                f"  وضعیت: {WAITLIST_LABELS_FA.get(entry.status, entry.status)}"
            )
            buttons.append([
                InlineKeyboardButton(
                    text=f"👤 {user.full_name if user else '—'} | {to_jalali(entry.date)}",
                    callback_data=f"adm:wl:view:{entry.id}",
                )
            ])
        if not result.items:
            lines.append("موردی در لیست انتظار نیست.")

    prefix = f"adm:wl:list:{status or '-'}"
    buttons.append(page_buttons(prefix, result.page, result.total_pages))
    filter_row = [
        InlineKeyboardButton(
            text=("✅ " if status == s else "") + WAITLIST_LABELS_FA[s],
            callback_data=f"adm:wl:list:{s}:1",
        )
        for s in ("pending", "notified", "booked")
    ]
    buttons.append(filter_row)
    buttons.append([
        InlineKeyboardButton(text="🧹 همه", callback_data="adm:wl:list:-:1"),
        home_button(),
    ])
    return "\n".join(lines), from_rows(buttons)


@router.message(F.text == BTN_ADMIN_WAITLIST)
async def waitlist_menu(message: Message) -> None:
    if not await ensure_admin(message):
        return
    text, keyboard = _build_list(None, 1)
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("adm:wl:list:"))
async def show_waitlist(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:wl:list:<status>:<page>
    if len(parts) != 5:
        await callback.answer()
        return
    status = None if parts[3] == "-" else parts[3]
    page = _page(parts[4])
    text, keyboard = _build_list(status, page)
    await safe_edit(callback.message, text, keyboard)
    await callback.answer()


@router.callback_query(F.data.startswith("adm:wl:view:"))
async def show_entry(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    entry_id = _int(callback.data.split(":")[3])
    if entry_id is None:
        await callback.answer()
        return
    built = _build_detail(entry_id)
    if built is None:
        await callback.answer("❌ مورد یافت نشد.", show_alert=True)
        return
    await safe_edit(callback.message, built[0], built[1])
    await callback.answer()


def _build_detail(entry_id: int) -> tuple[str, object] | None:
    with session_scope() as session:
        entry = waitlist_service.get(session, entry_id)
        if entry is None:
            return None
        user = session.get(User, entry.user_id)
        text = (
            f"{DIVIDER}\n⏳ جزئیات لیست انتظار\n{DIVIDER}\n"
            f"👤 کاربر: {user.full_name if user else '—'}\n"
            f"📱 موبایل: {user.phone if user else '—'}\n"
            f"🛠 خدمت: {entry.service.name}\n"
            f"🧑‍💼 کارشناس: {entry.staff.name}\n"
            f"📅 تاریخ: {to_jalali(entry.date)}\n"
            f"⏰ ساعت مورد علاقه: {hhmm(entry.preferred_time) if entry.preferred_time else '—'}\n"
            f"📌 وضعیت: {WAITLIST_LABELS_FA.get(entry.status, entry.status)}\n"
            f"🕓 ثبت: {entry.created_at:%Y-%m-%d %H:%M} UTC\n"
            f"{DIVIDER}"
        )
        rows = [
            [InlineKeyboardButton(
                text=f"🔄 {WAITLIST_LABELS_FA[s]}",
                callback_data=f"adm:wl:set:{entry.id}:{s}",
            )]
            for s in WAITLIST_STATUSES
            if s != entry.status
        ]
        rows.append([
            InlineKeyboardButton(text="🗑 حذف از لیست", callback_data=f"adm:wl:del:{entry.id}")
        ])
        rows.append([
            InlineKeyboardButton(text="🔙 بازگشت", callback_data="adm:wl:list:-:1")
        ])
    return text, from_rows(rows)


@router.callback_query(F.data.startswith("adm:wl:set:"))
async def set_status(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:wl:set:<id>:<status>
    entry_id, status = _int(parts[3]), parts[4]
    if entry_id is None or status not in WAITLIST_STATUSES:
        await callback.answer()
        return
    with session_scope() as session:
        entry = waitlist_service.get(session, entry_id)
        if entry is None:
            await callback.answer("❌ مورد یافت نشد.", show_alert=True)
            return
        waitlist_service.set_status(session, entry, status)
    logger.info("Admin set waitlist #%s -> %s", entry_id, status)
    await callback.answer(f"✅ وضعیت: {WAITLIST_LABELS_FA[status]}")
    built = _build_detail(entry_id)
    if built:
        await safe_edit(callback.message, built[0], built[1])


@router.callback_query(F.data.startswith("adm:wl:del:"))
async def delete_entry(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    entry_id = _int(callback.data.split(":")[3])
    if entry_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        entry = waitlist_service.get(session, entry_id)
        if entry is None:
            await callback.answer("❌ مورد یافت نشد.", show_alert=True)
            return
        waitlist_service.remove(session, entry)
    logger.info("Admin deleted waitlist entry #%s", entry_id)
    await callback.answer("🗑 حذف شد.")
    text, keyboard = _build_list(None, 1)
    await safe_edit(callback.message, text, keyboard)


def _page(value: str) -> int:
    try:
        return max(1, int(value))
    except ValueError:
        return 1


def _int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
