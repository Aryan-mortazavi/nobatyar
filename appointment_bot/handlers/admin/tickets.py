"""
📨 تیکت‌های پشتیبانی (admin)

    list open / answered / closed tickets
    -> read one ticket
    -> type a reply (FSM) -> delivered to the user through Telegram
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.models import User
from database.session import session_scope
from handlers.admin.base import ensure_admin, home_button, page_buttons, safe_edit
from handlers.states import AdminReply
from keyboards.inline_keyboard import from_rows
from services import notification_service, ticket_service
from utils.calendar import to_jalali
from utils.constants import (
    BTN_ADMIN_TICKETS,
    DIVIDER,
    PAGE_SIZE_TELEGRAM,
    TICKET_LABELS_FA,
    TICKET_STATUSES,
)
from utils.helpers import paginate

router = Router(name="admin_tickets")
logger = logging.getLogger(__name__)


def _build_list(status: str | None, page: int) -> tuple[str, object]:
    with session_scope() as session:
        tickets = ticket_service.list_tickets(session, status=status)
        result = paginate(tickets, page, PAGE_SIZE_TELEGRAM)
        lines = [
            f"{DIVIDER}📨 تیکت‌ها — {TICKET_LABELS_FA.get(status, 'همه') if status else 'همه'}",
            f"({result.start_index}-{result.end_index} از {result.total}){DIVIDER}",
        ]
        buttons: list[list[InlineKeyboardButton]] = []
        for ticket in result.items:
            user = session.get(User, ticket.user_id)
            lines.append(
                f"#{ticket.id} | {user.full_name if user else '—'} | "
                f"{TICKET_LABELS_FA.get(ticket.status, ticket.status)}\n"
                f"  {ticket.message[:60]}"
            )
            buttons.append([
                InlineKeyboardButton(
                    text=f"#{ticket.id} | {user.full_name if user else '—'}",
                    callback_data=f"adm:tick:view:{ticket.id}",
                )
            ])
        if not result.items:
            lines.append("تیکتی وجود ندارد.")

    buttons.append(page_buttons(f"adm:tick:list:{status or '-'}", result.page, result.total_pages))
    buttons.append([
        InlineKeyboardButton(
            text=( "✅ " if status == "open" else "") + TICKET_LABELS_FA["open"],
            callback_data="adm:tick:list:open:1",
        ),
        InlineKeyboardButton(
            text=("✅ " if status == "answered" else "") + TICKET_LABELS_FA["answered"],
            callback_data="adm:tick:list:answered:1",
        ),
        InlineKeyboardButton(text="🧹 همه", callback_data="adm:tick:list:-:1"),
    ])
    buttons.append([home_button()])
    return "\n".join(lines), from_rows(buttons)


@router.message(F.text == BTN_ADMIN_TICKETS)
async def tickets_menu(message: Message) -> None:
    if not await ensure_admin(message):
        return
    text, keyboard = _build_list("open", 1)
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("adm:tick:list:"))
async def show_tickets(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:tick:list:<status>:<page>
    if len(parts) != 5:
        await callback.answer()
        return
    status = None if parts[3] == "-" else parts[3]
    text, keyboard = _build_list(status, _page(parts[4]))
    await safe_edit(callback.message, text, keyboard)
    await callback.answer()


def _build_detail(ticket_id: int) -> tuple[str, object] | None:
    with session_scope() as session:
        ticket = ticket_service.get(session, ticket_id)
        if ticket is None:
            return None
        user = session.get(User, ticket.user_id)
        text = (
            f"{DIVIDER}\n📨 تیکت #{ticket.id}\n{DIVIDER}\n"
            f"👤 کاربر: {user.full_name if user else '—'}\n"
            f"📱 موبایل: {user.phone if user else '—'}\n"
            f"🆔 تلگرام: {user.telegram_id if user else '—'}\n"
            f"📅 تاریخ: {to_jalali(ticket.created_at.date()) if ticket.created_at else '—'}\n"
            f"📌 وضعیت: {TICKET_LABELS_FA.get(ticket.status, ticket.status)}\n\n"
            f"💬 پیام کاربر:\n{ticket.message}\n"
            + (f"\n📨 پاسخ شما:\n{ticket.admin_reply}\n" if ticket.admin_reply else "")
            + f"{DIVIDER}"
        )
        rows = [
            [InlineKeyboardButton(text="📨 پاسخ به کاربر", callback_data=f"adm:tick:reply:{ticket.id}")],
        ]
        if ticket.status != "closed":
            rows.append([
                InlineKeyboardButton(
                    text="🔒 بستن تیکت", callback_data=f"adm:tick:close:{ticket.id}"
                )
            ])
        rows.append([
            InlineKeyboardButton(text="🔙 بازگشت", callback_data="adm:tick:list:open:1")
        ])
    return text, from_rows(rows)


@router.callback_query(F.data.startswith("adm:tick:view:"))
async def show_ticket(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    ticket_id = _int(callback.data.split(":")[3])
    built = _build_detail(ticket_id) if ticket_id else None
    if built is None:
        await callback.answer("❌ تیکت یافت نشد.", show_alert=True)
        return
    await safe_edit(callback.message, built[0], built[1])
    await callback.answer()


@router.callback_query(F.data.startswith("adm:tick:reply:"))
async def ask_reply(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    ticket_id = _int(callback.data.split(":")[3])
    if ticket_id is None:
        await callback.answer()
        return
    await state.set_state(AdminReply.message)
    await state.update_data(reply_ticket=ticket_id)
    await callback.message.answer(
        "📨 متن پاسخ خود را بنویسید (برای کاربر ارسال می‌شود):",
        reply_markup=_back(),
    )
    await callback.answer()


@router.message(AdminReply.message, StateFilter(AdminReply.message), F.text)
async def send_reply(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    data = await state.get_data()
    ticket_id = data.get("reply_ticket")

    with session_scope() as session:
        ticket = ticket_service.get(session, ticket_id)
        if ticket is None:
            await state.clear()
            await message.answer("❌ تیکت یافت نشد.")
            return
        ticket_service.reply(session, ticket, message.text or "")
        user = session.get(User, ticket.user_id)
        user_tg = user.telegram_id if user else None

    logger.info("Admin replied to ticket #%s", ticket_id)
    await state.clear()
    if user_tg:
        await notification_service.send(
            user_tg,
            notification_service.support_reply_text(message.text or ""),
            ntype="support_reply",
        )
        await message.answer("✅ پاسخ برای کاربر ارسال شد.")
    else:
        await message.answer("⚠️ کاربر یافت نشد؛ پاسخ ذخیره شد.")

    built = _build_detail(ticket_id)
    if built:
        await message.answer(built[0], reply_markup=built[1])


@router.callback_query(F.data.startswith("adm:tick:close:"))
async def close_ticket(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    ticket_id = _int(callback.data.split(":")[3])
    if ticket_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        ticket = ticket_service.get(session, ticket_id)
        if ticket is None:
            await callback.answer("❌ تیکت یافت نشد.", show_alert=True)
            return
        ticket_service.set_status(session, ticket, "closed")
    logger.info("Admin closed ticket #%s", ticket_id)
    await callback.answer("🔒 تیکت بسته شد.")
    built = _build_detail(ticket_id)
    if built:
        await safe_edit(callback.message, built[0], built[1])


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


def _back():
    from keyboards.user_keyboard import back_cancel_keyboard

    return back_cancel_keyboard()
