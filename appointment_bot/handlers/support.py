"""📞 تماس با پشتیبانی - a tiny support-ticket system (FSM: free text)."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from database.session import session_scope
from handlers.common import require_registered
from handlers.states import Support
from keyboards.user_keyboard import back_cancel_keyboard, main_menu
from services import notification_service, settings_service, ticket_service
from utils.constants import BTN_SUPPORT, DIVIDER

router = Router(name="support")
logger = logging.getLogger(__name__)


@router.message(F.text == BTN_SUPPORT)
async def support_start(message: Message, state: FSMContext) -> None:
    """Show the support greeting (from settings) and ask for a message."""
    user = await require_registered(message, state)
    if user is None:
        return
    with session_scope() as session:
        greeting = settings_service.get_setting(
            session, "support_message", "پیام خود را برای پشتیبانی ارسال کنید."
        )
    await state.set_state(Support.message)
    await message.answer(
        f"{DIVIDER}\n📞 پشتیبانی\n{DIVIDER}\n{greeting}",
        reply_markup=back_cancel_keyboard(),
    )


@router.message(Support.message, StateFilter(Support.message), F.text)
async def receive_support_message(message: Message, state: FSMContext) -> None:
    """Create a ticket and forward it to every admin."""
    user = await require_registered(message, state)
    if user is None:
        return

    with session_scope() as session:
        try:
            ticket = ticket_service.create(
                session, user_id=user.id, message=message.text or ""
            )
            ticket_id = ticket.id
        except ticket_service.TicketError as exc:
            await message.answer(str(exc))
            return
        admin_text = notification_service.ticket_received_text(
            ticket_id, user.full_name, (message.text or "")[:500]
        )

    await state.clear()
    await message.answer(
        "✅ پیام شما ثبت شد.\nکارشناس پشتیبانی به‌زودی پاسخ می‌دهد.",
        reply_markup=main_menu(),
    )
    logger.info("Support ticket #%s created by user=%s", ticket_id, user.telegram_id)

    # Tell the admins (each of them gets a "reply" button)
    from keyboards import inline_keyboard as inline
    from aiogram.types import InlineKeyboardButton

    keyboard = inline.from_rows([
        [InlineKeyboardButton(text="📨 پاسخ به کاربر", callback_data=f"adm:tick:reply:{ticket_id}")]
    ])
    try:
        await notification_service.send_admins(
            admin_text, ntype="admin_message", reply_markup=keyboard
        )
    except Exception:  # pragma: no cover
        logger.warning("Could not notify admins about ticket #%s", ticket_id, exc_info=True)
