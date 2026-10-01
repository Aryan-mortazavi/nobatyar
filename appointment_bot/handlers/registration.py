"""
Identification: Telegram account → real customer of the web app.

The bot asks for a name and a mobile number, hands both to
``/api/v1/customers/identify`` and keeps the token the API mints. From that
moment the person exists in the web app: their appointments, packages and
history are the same whether they use Telegram or the website.

Matching by phone is the important part — someone who already booked on the
web and then opens the bot keeps *their* history instead of becoming a second,
empty customer.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from channel.api import ChannelError, ChannelUnavailable
from channel.session import BookingFlow
from handlers.common import go_home, report_api_error, safe_catalogue, session
from keyboards.channel_keyboard import cancel_keyboard, contact_keyboard, main_menu, remove

router = Router(name="registration")
logger = logging.getLogger(__name__)

SKIP_WORDS = {"بی نطر", "بی‌نظر", "ندارم", "skip", "-", "—", "رد"}


def _clean_name(raw: str) -> str | None:
    """A person name must have at least two letters; anything else is noise."""
    cleaned = " ".join(raw.strip().split())
    if len(cleaned) < 3 or len(cleaned) > 80:
        return None
    if cleaned.isdigit():
        return None
    return cleaned


async def _identify(message: Message, state: FSMContext, name: str, phone: str) -> None:
    """Call the API and, on success, open the menu."""
    chat = session(message, state)
    catalogue = await safe_catalogue(chat)
    try:
        customer = await chat.api.identify(
            telegram_id=chat.telegram_id,
            name=name,
            phone=phone,
            telegram_username=chat.username,
        )
    except ChannelError as exc:
        # a phone already owned by another Telegram account deserves a real
        # explanation, not "something went wrong"
        if exc.code == "CONFLICT":
            await message.answer(
                "⚠️ این شمارهٔ موبایل به یک حساب دیگر وصل است.\n"
                "اگر حساب شما همان است، از طریق وب‌سایت وارد شوید:\n"
                f"{catalogue.workspace.web_url if catalogue else ''}\n"
                "در غیر این صورت با پشتیبانی تماس بگیرید."
            )
            return
        await report_api_error(message, catalogue, exc)
        return
    except ChannelUnavailable as exc:
        await report_api_error(message, catalogue, exc)
        return

    await chat.link(customer)
    await state.set_state(None)
    await message.answer("حساب شما آماده شد ✅", reply_markup=remove())
    await go_home(message, state, greeting=customer.welcome or f"سلام {customer.name} عزیز 👋")


@router.message(BookingFlow.name)
async def ask_name(message: Message, state: FSMContext) -> None:
    """Step 1 — name."""
    chat = session(message, state)
    catalogue = await safe_catalogue(chat)
    prompt = catalogue.label("askName", "") if catalogue else ""
    await message.answer(
        prompt or "نام و نام خانوادگی خود را بنویسید:",
        reply_markup=cancel_keyboard(catalogue),
    )
    await state.set_state(BookingFlow.name)


@router.message(BookingFlow.name, F.text)
async def collect_name(message: Message, state: FSMContext) -> None:
    name = _clean_name(message.text or "")
    if not name:
        await message.answer("لطفاً نام و نام خانوادگی خود را کامل بنویسید.")
        return

    chat = session(message, state)
    await chat.remember(ch_name=name)
    catalogue = await safe_catalogue(chat)
    await message.answer(
        (catalogue.label("askPhone", "") if catalogue else "")
        or "شمارهٔ موبایل خود را بنویسید (مثلاً ۰۹۱۲۱۲۳۴۵۶۷۸):",
        reply_markup=contact_keyboard(catalogue),
    )
    await state.set_state(BookingFlow.phone)


@router.message(BookingFlow.phone, F.contact)
async def collect_shared_contact(message: Message, state: FSMContext) -> None:
    """Telegram filled the number for us — still normalised by the API."""
    if message.contact is None or not message.contact.phone_number:
        await message.answer("شماره‌ای دریافت نشد. لطفاً دستی بنویسید:")
        return
    data = await state.get_data()
    name = data.get("ch_name", "")
    if not name:
        await state.set_state(BookingFlow.name)
        return
    await _identify(message, state, name, message.contact.phone_number)


@router.message(BookingFlow.phone, F.text)
async def collect_phone(message: Message, state: FSMContext) -> None:
    raw = (message.text or "").strip()
    if raw.lower() in SKIP_WORDS:
        await message.answer("برای رزرو، شمارهٔ موبایل لازم است.")
        return

    data = await state.get_data()
    name = data.get("ch_name", "")
    if not name:
        await state.set_state(BookingFlow.name)
        await message.answer("اول نام خود را بنویسید.")
        return

    chat = session(message, state)
    catalogue = await safe_catalogue(chat)
    await _identify(message, state, name, raw)


@router.message(F.text.regexp(r"^/start"))
async def restart(message: Message, state: FSMContext) -> None:
    """`/start` while identifying: forget everything and begin again."""
    await state.clear()
    await go_home(message, state)


__all__ = ["router", "start_registration"]


async def start_registration(message: Message, state: FSMContext) -> None:
    """Enter the identification flow (used by the booking handler)."""
    await state.set_state(BookingFlow.name)
    chat = session(message, state)
    catalogue = await safe_catalogue(chat)
    await message.answer(
        (catalogue.label("askName", "") if catalogue else "")
        or "برای رزرو نوبت، نام و نام خانوادگی خود را بنویسید:",
        reply_markup=cancel_keyboard(catalogue),
    )
