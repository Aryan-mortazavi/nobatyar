"""
🗓 Booking flow: service → specialist → day → time → confirm.

Every step asks the web app what is true and renders the answer; the customer's
choice is sent straight back. No availability is ever computed in this file —
if the API says a time is free, it is free, and the same rules that protect the
website protect the bot.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from channel.api import ChannelError, ChannelUnavailable, Service
from channel.session import BookingFlow
from config import PUBLIC_WEB_URL
from handlers.common import go_home, report_api_error, safe_catalogue, session
from handlers.registration import start_registration
from keyboards.channel_keyboard import (
    confirm_menu,
    confirmation_card,
    date_menu,
    main_menu,
    services_menu,
    staff_menu,
    time_menu,
)

router = Router(name="booking")
logger = logging.getLogger(__name__)

BOOKING_DAYS = 30
DATES_PER_PAGE = 10


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------
async def begin_booking(message: Message, state: FSMContext) -> None:
    """Reply-keyboard «رزرو نوبت جدید» or callback ``book:new``."""
    chat = session(message, state)
    if not chat.identified:
        await start_registration(message, state)
        return

    await state.set_state(BookingFlow.service)
    catalogue = await safe_catalogue(chat)
    if catalogue is None:
        await message.answer(
            "⚠️ در حال حاضر امکان ارتباط با سامانهٔ رزرو نیست.",
            reply_markup=main_menu(None),
        )
        return

    if not catalogue.services:
        await message.answer("در حال حاضر خدمتی برای رزرو فعال نیست.", reply_markup=main_menu(catalogue))
        return

    await message.answer(
        catalogue.label("pickService", "") or "کدام خدمت را می‌خواهید؟",
        reply_markup=services_menu(catalogue, catalogue.workspace.currency),
    )


@router.message(F.text.regexp(r"^🗓"), F.text.contains("رزرو"))
async def reply_book(message: Message, state: FSMContext) -> None:
    await begin_booking(message, state)


@router.callback_query(F.data == "book:new")
async def callback_book_new(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    if callback.message:
        await begin_booking(callback.message, state)


# ---------------------------------------------------------------------------
# Step 1 — service
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("svc:"), BookingFlow.service)
async def pick_service(callback: CallbackQuery, state: FSMContext) -> None:
    service_id = callback.data.split(":", 1)[1]
    chat = session(callback.message, state)
    catalogue = await safe_catalogue(chat)
    if catalogue is None:
        await report_api_error(callback, None, ChannelUnavailable())
        return

    service = catalogue.service(service_id)
    if service is None:
        await report_api_error(callback, catalogue, ChannelError("NOT_FOUND", "unknown service"))
        return

    await state.update_data(ch_service=service_id)
    await state.set_state(BookingFlow.staff)
    await callback.answer()
    await callback.message.edit_text(
        catalogue.label("pickStaff", "") or "کدام کارشناس را ترجیح می‌دهید؟",
        reply_markup=staff_menu(catalogue, service, has_branches=bool(catalogue.locations)),
    )


# ---------------------------------------------------------------------------
# Step 2 — specialist
# ---------------------------------------------------------------------------
async def _show_dates(
    callback_or_message: CallbackQuery | Message, state: FSMContext, page: int = 0
) -> None:
    chat = session(callback_or_message.message if isinstance(callback_or_message, CallbackQuery) else callback_or_message, state)
    catalogue = await safe_catalogue(chat)
    if catalogue is None:
        await report_api_error(callback_or_message, None, ChannelUnavailable())
        return

    data = await state.get_data()
    service_id = data.get("ch_service", "")
    staff_id = data.get("ch_staff")
    if not service_id:
        await report_api_error(callback_or_message, catalogue, ChannelError("NOT_FOUND", "no service"))
        return

    try:
        days = await chat.api.availability_days(
            service_id=service_id,
            staff_id=None if staff_id in (None, "any") else staff_id,
            days=BOOKING_DAYS,
        )
    except (ChannelError, ChannelUnavailable) as exc:
        await report_api_error(callback_or_message, catalogue, exc)
        return

    bookable = [day for day in days if day.bookable]
    if not bookable:
        text = catalogue.label("noFreeSlot", "") or "در حال حاضر روز آزادی وجود ندارد."
        if isinstance(callback_or_message, CallbackQuery):
            await callback_or_message.message.edit_text(text, reply_markup=main_menu(catalogue))
        else:
            await callback_or_message.answer(text, reply_markup=main_menu(catalogue))
        return

    has_next = (page + 1) * DATES_PER_PAGE < len(bookable)
    text = catalogue.label("pickDate", "") or "انتخاب تاریخ:"
    if isinstance(callback_or_message, CallbackQuery):
        await callback_or_message.message.edit_text(
            text,
            reply_markup=date_menu(
                bookable, page=page, per_page=DATES_PER_PAGE, has_next=has_next
            ),
        )
    else:
        await callback_or_message.answer(
            text,
            reply_markup=date_menu(
                bookable, page=page, per_page=DATES_PER_PAGE, has_next=has_next
            ),
        )


@router.callback_query(F.data.startswith("stf:"), BookingFlow.staff)
async def pick_staff(callback: CallbackQuery, state: FSMContext) -> None:
    staff_id = callback.data.split(":", 1)[1]
    await state.update_data(ch_staff=staff_id)
    await state.set_state(BookingFlow.date)
    await callback.answer()
    await _show_dates(callback, state, page=0)


@router.callback_query(F.data.startswith("date:page:"), BookingFlow.date)
async def page_dates(callback: CallbackQuery, state: FSMContext) -> None:
    page = int(callback.data.rsplit(":", 1)[1])
    await callback.answer()
    await _show_dates(callback, state, page=page)


# ---------------------------------------------------------------------------
# Step 3 — day
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("day:"), BookingFlow.date)
async def pick_date(callback: CallbackQuery, state: FSMContext) -> None:
    date = callback.data.split(":", 1)[1]
    chat = session(callback.message, state)
    catalogue = await safe_catalogue(chat)
    data = await state.get_data()
    service_id = data.get("ch_service", "")
    staff_id = data.get("ch_staff")

    try:
        day = await chat.api.availability_day(
            service_id=service_id,
            staff_id=None if staff_id in (None, "any") else staff_id,
            date=date,
        )
    except (ChannelError, ChannelUnavailable) as exc:
        await report_api_error(callback, catalogue, exc)
        return

    if not day.has_free:
        await report_api_error(callback, catalogue, ChannelError("SLOT_TAKEN", "no free slot"))
        return

    await state.update_data(ch_date=date)
    await state.set_state(BookingFlow.time)
    await callback.answer()
    await callback.message.edit_text(
        catalogue.label("pickTime", "") if catalogue else "انتخاب ساعت:",
        reply_markup=time_menu(list(day.slots), service_id, staff_id or "any", date),
    )


@router.callback_query(F.data == "back:date", BookingFlow.time)
async def back_to_date(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(BookingFlow.date)
    await callback.answer()
    await _show_dates(callback, state, page=0)


# ---------------------------------------------------------------------------
# Step 4 — time
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("slot:"), BookingFlow.time)
async def pick_time(callback: CallbackQuery, state: FSMContext) -> None:
    """Store the chosen slot and show the summary."""
    _, service_id, staff_id, date, start = callback.data.split(":")
    chat = session(callback.message, state)
    catalogue = await safe_catalogue(chat)

    data = await state.get_data()
    try:
        day = await chat.api.availability_day(
            service_id=service_id,
            staff_id=None if staff_id == "any" else staff_id,
            date=date,
        )
    except (ChannelError, ChannelUnavailable) as exc:
        await report_api_error(callback, catalogue, exc)
        return

    chosen = next((slot for slot in day.slots if str(slot.start) == start), None)
    if chosen is None or not chosen.available:
        await report_api_error(callback, catalogue, ChannelError("SLOT_TAKEN", "slot gone"))
        return

    service = catalogue.service(service_id) if catalogue else None
    member = next(
        (m for m in (catalogue.staff if catalogue else ()) if m.id == staff_id), None
    )
    # the API returns the definitive view of the slot we are about to book
    preview = await _preview(chat, service, member, chosen, date, staff_id)
    if preview is None:
        await report_api_error(callback, catalogue, ChannelError("NOT_FOUND", "cannot preview"))
        return

    has_bundle = False
    try:
        has_bundle = (
            await chat.api.remaining_for(
                customer_token=chat.require_token(),
                telegram_id=chat.telegram_id,
                service_id=service_id,
            )
            > 0
        )
    except (ChannelError, ChannelUnavailable, LookupError):
        has_bundle = False

    await state.update_data(ch_start=start, ch_service=service_id, ch_staff=staff_id, ch_date=date)
    await state.set_state(BookingFlow.confirm)
    await callback.answer()
    await callback.message.edit_text(
        confirmation_card(preview),
        reply_markup=confirm_menu(
            service_id=service_id,
            staff_id=staff_id,
            start=int(start),
            has_bundle=has_bundle,
        ),
    )


async def _preview(chat, service: Service | None, member, slot, date: str, staff_id: str):
    """
    Build the short appointment view shown on the confirmation card.

    The bot deliberately does not format the date itself: the API already
    returns the authoritative, correctly localised strings, so the card cannot
    drift away from what the website shows.
    """
    from channel.api import Appointment

    return Appointment(
        tracking_code="—",
        status="PENDING",
        status_label="در انتظار تأیید",
        is_upcoming=True,
        cancellable=False,
        service_title=service.title if service else "",
        # "any" means the API picks whoever is free first
        staff_name=member.name if member else "⚡️ نزدیک‌ترین زمان آزاد",
        when_text=f"{date} · {slot.label}",
        when_iso="",
        location_title=None,
        used_package_session=False,
        web_url=service.web_url if service else "",
    )


# ---------------------------------------------------------------------------
# Step 5 — confirm and book
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("book:"), BookingFlow.confirm)
async def confirm_booking(callback: CallbackQuery, state: FSMContext) -> None:
    parts = callback.data.split(":")
    use_bundle = len(parts) == 5 and parts[1] == "bundle"
    if use_bundle:
        _, _, service_id, staff_id, start = parts
    else:
        _, service_id, staff_id, start = parts

    chat = session(callback.message, state)
    catalogue = await safe_catalogue(chat)
    data = await state.get_data()
    try:
        token = chat.require_token()
    except LookupError:
        await state.set_state(BookingFlow.name)
        await callback.answer("ابتدا شمارهٔ موبایل خود را ثبت کنید.", show_alert=True)
        return

    package_purchase_id = None
    if use_bundle:
        try:
            packages = await chat.api.packages(
                customer_token=token, telegram_id=chat.telegram_id
            )
            for package in packages:
                for line in package.lines:
                    if line.service_id == service_id and line.remaining > 0:
                        package_purchase_id = package.id
                        break
                if package_purchase_id:
                    break
        except (ChannelError, ChannelUnavailable):
            package_purchase_id = None

    await callback.answer("در حال ثبت…")
    try:
        result = await chat.api.book(
            customer_token=token,
            telegram_id=chat.telegram_id,
            service_id=service_id,
            staff_id=None if staff_id == "any" else staff_id,
            location_id=data.get("ch_location"),
            notes=data.get("ch_notes"),
            slot=int(start),
            package_purchase_id=package_purchase_id,
        )
    except ChannelError as exc:
        if exc.slot_taken:
            await callback.message.answer(
                (catalogue.label("slotTaken", "") if catalogue else "")
                or "این بازه هم‌اکنون رزرو شد. لطفاً زمان دیگری انتخاب کنید."
            )
            await state.set_state(BookingFlow.date)
            await _show_dates(callback, state, page=0)
            return
        await report_api_error(callback, catalogue, exc)
        return
    except ChannelUnavailable as exc:
        await report_api_error(callback, catalogue, exc)
        return

    await state.clear()
    lines = [f"✅ {result.message or 'نوبت شما ثبت شد'}"]
    if result.tracking_code:
        lines.append(f"🔖 کد رهگیری: {result.tracking_code}")
    if result.count > 1:
        lines.append(f"🔁 {result.count} جلسهٔ هفتگی برای شما ثبت شد.")
    lines.append("")
    lines.append("همین نوبت در وب‌سایت هم دیده می‌شود؛ برای لغو یا جابه‌جایی:")
    lines.append(PUBLIC_WEB_URL)
    await callback.message.answer("\n".join(lines), reply_markup=main_menu(catalogue))


# ---------------------------------------------------------------------------
# Hand-off to the website
# ---------------------------------------------------------------------------
@router.callback_query(F.data == "web:service")
async def open_website(callback: CallbackQuery, state: FSMContext) -> None:
    """Deep link: send the customer to the web app, pre-filled with the service."""
    chat = session(callback.message, state)
    data = await state.get_data()
    catalogue = await safe_catalogue(chat)
    service = catalogue.service(data.get("ch_service", "")) if catalogue else None
    url = service.web_url if service else (catalogue.workspace.web_url if catalogue else PUBLIC_WEB_URL)
    await callback.answer()
    if callback.message:
        await callback.message.answer(
            f"🌐 برای رزرو در وب‌سایت:\n{url}\n\n"
            "نوبت‌های هر دو جا یکی هستند؛ هرجا رزرو کنید، همان‌جا می‌بینید."
        )


__all__ = ["router", "begin_booking"]
