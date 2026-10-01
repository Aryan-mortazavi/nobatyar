"""
📋 «نوبت‌های من»: list and cancel.

The list comes from the web app, so it also contains appointments booked on the
website — the exact thing a customer expects when they ask "do you see my
booking?". Cancelling frees the slot, and the web app immediately offers it to
whoever is on the waitlist.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from channel.api import Appointment, ChannelError, ChannelUnavailable
from channel.text import appointment_card
from handlers.common import go_home, report_api_error, safe_catalogue, session
from handlers.registration import start_registration
from keyboards.channel_keyboard import appointment_detail_menu, main_menu, my_appointments_menu

router = Router(name="my_appointments")
logger = logging.getLogger(__name__)


async def _show(
    target: Message | CallbackQuery, state: FSMContext, scope: str = "upcoming"
) -> None:
    chat = session(target.message if isinstance(target, CallbackQuery) else target, state)
    if not chat.identified:
        await start_registration(
            target.message if isinstance(target, CallbackQuery) else target, state
        )
        return

    catalogue = await safe_catalogue(chat)
    try:
        appointments = await chat.api.my_appointments(
            customer_token=chat.require_token(),
            telegram_id=chat.telegram_id,
            scope=scope,
        )
    except LookupError:
        await start_registration(
            target.message if isinstance(target, CallbackQuery) else target, state
        )
        return
    except (ChannelError, ChannelUnavailable) as exc:
        await report_api_error(target, catalogue, exc)
        return

    if not appointments:
        text = (catalogue.label("noAppointments", "") if catalogue else "") or (
            "هنوز نوبتی ثبت نکرده‌اید."
        )
        buttons = main_menu(catalogue)
        if isinstance(target, CallbackQuery):
            await target.message.edit_text(text, reply_markup=buttons)
        else:
            await target.answer(text, reply_markup=buttons)
        return

    header = (
        f"📋 نوبت‌های پیش‌رو ({len(appointments)})" if scope == "upcoming"
        else f"🗂 نوبت‌های گذشته ({len(appointments)})"
    )
    if scope == "history":
        body = "\n\n".join(appointment_card(item) for item in appointments[:5])
    else:
        body = "یکی از نوبت‌ها را برای جزئیات انتخاب کنید:"

    if isinstance(target, CallbackQuery):
        await target.message.edit_text(
            f"{header}\n\n{body}", reply_markup=my_appointments_menu(appointments if scope == "upcoming" else [])
        )
    else:
        await target.answer(
            f"{header}\n\n{body}",
            reply_markup=my_appointments_menu(appointments if scope == "upcoming" else []),
        )


@router.message(F.text.regexp(r"^📋"))
async def reply_my_appointments(message: Message, state: FSMContext) -> None:
    await _show(message, state, scope="upcoming")


@router.callback_query(F.data == "appts:upcoming")
async def callback_upcoming(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await _show(callback, state, scope="upcoming")


@router.callback_query(F.data == "appts:history")
async def callback_history(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await _show(callback, state, scope="history")


@router.callback_query(F.data.startswith("appt:"))
async def appointment_detail(callback: CallbackQuery, state: FSMContext) -> None:
    """One appointment, with a cancel button when it is still possible."""
    tracking = callback.data.split(":", 1)[1]
    chat = session(callback.message, state)
    catalogue = await safe_catalogue(chat)
    try:
        appointments = await chat.api.my_appointments(
            customer_token=chat.require_token(),
            telegram_id=chat.telegram_id,
            scope="all",
        )
    except (LookupError, ChannelError, ChannelUnavailable) as exc:
        if isinstance(exc, LookupError):
            await start_registration(callback.message, state)
        else:
            await report_api_error(callback, catalogue, exc)
        return

    found: Appointment | None = next(
        (item for item in appointments if item.tracking_code == tracking), None
    )
    if found is None:
        await callback.answer("این نوبت پیدا نشد.", show_alert=True)
        return

    await callback.answer()
    await callback.message.edit_text(
        appointment_card(found), reply_markup=appointment_detail_menu(found)
    )


@router.callback_query(F.data.startswith("cancel:"))
async def cancel_appointment(callback: CallbackQuery, state: FSMContext) -> None:
    """
    Cancel — with one confirmation step.

    Cancelling is destructive, so the first press asks; the second one carries
    ``:yes`` and actually does it.
    """
    parts = callback.data.split(":")
    tracking = parts[1]
    confirmed = len(parts) > 2 and parts[2] == "yes"

    chat = session(callback.message, state)
    catalogue = await safe_catalogue(chat)

    if not confirmed:
        text = (catalogue.label("cancelConfirm", "") if catalogue else "") or (
            "مطمئن هستید که می‌خواهید این نوبت لغو شود؟"
        )
        from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

        await callback.answer()
        await callback.message.answer(
            text,
            reply_markup=InlineKeyboardMarkup(
                inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text="بله، لغو شود", callback_data=f"cancel:{tracking}:yes"
                        ),
                        InlineKeyboardButton(text="❌ انصراف", callback_data=f"appt:{tracking}"),
                    ]
                ]
            ),
        )
        return

    try:
        result = await chat.api.cancel(
            customer_token=chat.require_token(),
            telegram_id=chat.telegram_id,
            tracking_code=tracking,
        )
    except LookupError:
        await start_registration(callback.message, state)
        return
    except ChannelError as exc:
        if exc.code == "CONFLICT":
            await callback.answer(
                (catalogue.label("alreadyCancelled", "") if catalogue else "")
                or "این نوبت قبلاً لغو شده است.",
                show_alert=True,
            )
            return
        await report_api_error(callback, catalogue, exc)
        return
    except ChannelUnavailable as exc:
        await report_api_error(callback, catalogue, exc)
        return

    offers = int(result.get("waitlistOffers") or 0)
    text = result.get("message") or (catalogue.label("cancelled", "") if catalogue else "")
    lines = [f"🗑 {text or 'نوبت شما لغو شد'}"]
    if result.get("seriesCancelled"):
        lines.append("🔁 کل نوبت‌های هفتگی این سری لغو شد.")
    if offers:
        lines.append(f"🎉 این بازه به {offers} نفر دیگر از لیست انتظار پیشنهاد شد.")
    await callback.answer()
    await callback.message.answer("\n".join(lines), reply_markup=main_menu(catalogue))


__all__ = ["router"]
