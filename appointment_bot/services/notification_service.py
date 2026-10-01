"""
Notification service: the single place that talks to Telegram for
out-of-system messages (reminders, confirmations, waitlist offers...).

Every message is also stored in the ``notifications`` table. If the bot is not
running (for example when an admin cancels an appointment from the web panel)
the message stays marked as "not sent" and is flushed on the next bot start.
"""

from __future__ import annotations

import logging
from datetime import date, time

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from aiogram.types import InlineKeyboardMarkup, ReplyKeyboardMarkup
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import ADMIN_IDS
from database.models import Appointment, Notification, Service, Staff, User, Waitlist
from database.session import session_scope
from utils.calendar import to_jalali
from utils.constants import (
    STATUS_CANCELLED,
    STATUS_LABELS_FA,
    WAITLIST_LABELS_FA,
)
from utils.helpers import appointment_card, hhmm

logger = logging.getLogger(__name__)

_bot: Bot | None = None


# ---------------------------------------------------------------------------
# Bot handle (set once at startup so every module can send messages)
# ---------------------------------------------------------------------------
def init(bot: Bot) -> None:
    global _bot
    _bot = bot


def get_bot() -> Bot | None:
    return _bot


def is_ready() -> bool:
    return _bot is not None


def _owner_id(session: Session, telegram_id: int) -> int | None:
    """
    Translate a chat id into the primary key of ``users``.

    ``notifications.user_id`` is a foreign key to ``users.id``, but every
    caller (and Telegram itself) works with the chat/telegram id.  Resolving it
    here keeps the INSERT valid instead of failing with a FK error.
    """
    row = session.scalar(select(User.id).where(User.telegram_id == telegram_id))
    return int(row) if row is not None else None


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------
async def send(
    user_id: int,
    text: str,
    *,
    ntype: str = "admin_message",
    reply_markup: ReplyKeyboardMarkup | InlineKeyboardMarkup | None = None,
) -> bool:
    """Store + deliver one message. Never raises (a failed send is only logged)."""
    notif_id: int | None = None
    try:
        with session_scope() as session:
            owner_id = _owner_id(session, user_id)  # user_id = chat id here
            if owner_id is None:
                logger.debug(
                    "Chat %s is not registered - message sent without a history row",
                    user_id,
                )
            else:
                record = Notification(
                    user_id=owner_id, type=ntype, message=text, is_sent=False
                )
                session.add(record)
                session.flush()
                notif_id = record.id
    except Exception:  # pragma: no cover - notification must never break a flow
        logger.exception("Could not persist notification for user=%s", user_id)

    if _bot is None:
        return False  # web-only mode -> flushed later at bot startup

    try:
        await _bot.send_message(chat_id=user_id, text=text, reply_markup=reply_markup)
        sent = True
    except TelegramAPIError as exc:
        logger.warning("Telegram send failed for user=%s: %s", user_id, exc.__class__.__name__)
        sent = False
    except Exception:  # pragma: no cover
        logger.exception("Unexpected error while sending to user=%s", user_id)
        sent = False

    if notif_id is not None:
        try:
            with session_scope() as session:
                row = session.get(Notification, notif_id)
                if row is not None:
                    row.is_sent = sent
        except Exception:  # pragma: no cover
            logger.exception("Could not update notification #%s", notif_id)
    return sent


def record_delivered(telegram_id: int, text: str, ntype: str = "appointment_created") -> None:
    """
    Store a message that was already shown inside the current chat
    (the booking confirmation, for example) without sending it twice.

    ``telegram_id`` is the chat id; the row stores the matching ``users.id``.
    """
    try:
        with session_scope() as session:
            owner_id = _owner_id(session, telegram_id)
            if owner_id is None:
                logger.debug("Chat %s is not registered - nothing to record", telegram_id)
                return
            session.add(
                Notification(user_id=owner_id, type=ntype, message=text, is_sent=True)
            )
    except Exception:  # pragma: no cover - never break the user flow
        logger.exception("Could not record delivered notification for user=%s", telegram_id)


async def notify_waitlist_entries(staff_id: int, day: date) -> int:
    """
    Call right after a slot was freed (cancellation / rescheduling).

    Every waiting user who can now book is informed with a "رزرو این ساعت"
    button; their waitlist row moves to 'notified'.
    """
    from keyboards import inline_keyboard as inline
    from services import waitlist_service

    payload: list[tuple[int, int, str]] = []  # (telegram_id, entry_id, text)
    with session_scope() as session:
        for entry, free_time in waitlist_service.offers_for_cancellation(
            session, staff_id=staff_id, day=day
        ):
            waiting_user = session.get(User, entry.user_id)
            if waiting_user is None:
                continue
            waitlist_service.set_status(session, entry, "notified")
            payload.append(
                (
                    waiting_user.telegram_id,
                    entry.id,
                    waitlist_offer_text(session, entry, free_time),
                )
            )

    sent = 0
    for telegram_id, entry_id, text in payload:
        if await send(
            telegram_id,
            text,
            ntype="waitlist_available",
            reply_markup=inline.waitlist_offer(entry_id),
        ):
            sent += 1
    return sent


async def send_admins(
    text: str, *, ntype: str = "admin_message",
    reply_markup: InlineKeyboardMarkup | None = None,
) -> int:
    """Broadcast one message to every admin configured in .env (ADMIN_IDS)."""
    delivered = 0
    for admin_id in ADMIN_IDS:
        if await send(admin_id, text, ntype=ntype, reply_markup=reply_markup):
            delivered += 1
    return delivered


async def flush_pending(limit: int = 100) -> int:
    """Deliver messages that were recorded while the bot was offline."""
    if _bot is None:
        return 0
    with session_scope() as session:
        rows = list(
            session.scalars(
                select(Notification)
                .where(Notification.is_sent.is_(False))
                .order_by(Notification.created_at)
                .limit(limit)
            )
        )
        user_ids = {row.user_id for row in rows}
        owners: dict[int, int] = {}
        if user_ids:
            owners = {
                user.id: user.telegram_id
                for user in session.scalars(select(User).where(User.id.in_(user_ids)))
            }
        payload: list[tuple[int, int, str]] = []
        for row in rows:
            chat_id = owners.get(row.user_id)
            if chat_id is None:
                # the account behind this row is gone - never retry forever
                logger.warning("Dropping orphan notification #%s", row.id)
                row.is_sent = True
                continue
            payload.append((row.id, chat_id, row.message))

    delivered = 0
    for notif_id, chat_id, message in payload:
        try:
            await _bot.send_message(chat_id=chat_id, text=message)
            ok = True
        except TelegramAPIError:
            ok = False
        with session_scope() as session:
            row = session.get(Notification, notif_id)
            if row is not None:
                row.is_sent = ok
        if ok:
            delivered += 1
    if delivered:
        logger.info("Flushed %s pending notification(s)", delivered)
    return delivered


# ---------------------------------------------------------------------------
# Text builders (session is passed explicitly - no detached ORM objects)
# ---------------------------------------------------------------------------
def _names(session: Session, appointment: Appointment) -> tuple[str, str, str]:
    """(user_name, service_name, staff_name) - always queried from the DB."""
    user = session.get(User, appointment.user_id)
    staff = session.get(Staff, appointment.staff_id)
    service = session.get(Service, appointment.service_id)
    return (
        user.full_name if user else "—",
        service.name if service else "—",
        staff.name if staff else "—",
    )


def appointment_created_text(session: Session, appointment: Appointment) -> str:
    user_name, service_name, staff_name = _names(session, appointment)
    body = appointment_card(
        user=user_name,
        service=service_name,
        staff=staff_name,
        jalali_date=to_jalali(appointment.date),
        start=f"{hhmm(appointment.start_time)} - {hhmm(appointment.end_time)}",
        tracking=appointment.tracking_code,
        status_fa=STATUS_LABELS_FA.get(appointment.status, appointment.status),
        title="نوبت شما ثبت شد",
    )
    return f"✅ نوبت شما با موفقیت ثبت شد.\n\n{body}\n\n🔑 کد رهگیری: {appointment.tracking_code}"


def appointment_cancelled_text(
    session: Session, appointment: Appointment, *, by_admin: bool = False
) -> str:
    user_name, service_name, staff_name = _names(session, appointment)
    who = "توسط مدیر" if by_admin else "توسط شما"
    return (
        "❌ نوبت لغو شد\n\n"
        + appointment_card(
            user=user_name,
            service=service_name,
            staff=staff_name,
            jalali_date=to_jalali(appointment.date),
            start=f"{hhmm(appointment.start_time)} - {hhmm(appointment.end_time)}",
            tracking=appointment.tracking_code,
            status_fa=STATUS_LABELS_FA[STATUS_CANCELLED],
        )
        + f"\n\nاین نوبت {who} لغو شد. بازه زمانی مربوطه آزاد شد."
    )


def appointment_rescheduled_text(
    session: Session, appointment: Appointment, old_day: date, old_start: time
) -> str:
    user_name, service_name, staff_name = _names(session, appointment)
    return (
        "🔄 وقت نوبت شما تغییر کرد\n\n"
        f"⛔ زمان قبلی: {to_jalali(old_day)} ساعت {hhmm(old_start)}\n"
        + appointment_card(
            user=user_name,
            service=service_name,
            staff=staff_name,
            jalali_date=to_jalali(appointment.date),
            start=f"{hhmm(appointment.start_time)} - {hhmm(appointment.end_time)}",
            tracking=appointment.tracking_code,
            status_fa=STATUS_LABELS_FA.get(appointment.status, appointment.status),
            title="زمان جدید",
        )
    )


def appointment_status_text(
    session: Session, appointment: Appointment, status: str
) -> str:
    """Generic status update message (confirm / complete / no-show...)."""
    user_name, service_name, staff_name = _names(session, appointment)
    return (
        "📌 وضعیت نوبت شما تغییر کرد\n\n"
        + appointment_card(
            user=user_name,
            service=service_name,
            staff=staff_name,
            jalali_date=to_jalali(appointment.date),
            start=f"{hhmm(appointment.start_time)} - {hhmm(appointment.end_time)}",
            tracking=appointment.tracking_code,
            status_fa=STATUS_LABELS_FA.get(status, status),
        )
    )


def reminder_text(session: Session, appointment: Appointment, hours: int) -> str:
    user_name, service_name, staff_name = _names(session, appointment)
    when = "فردا" if hours >= 24 else "به زودی"
    return (
        "🔔 یادآوری نوبت\n\n"
        f"شما {when} نوبت دارید.\n"
        + appointment_card(
            user=user_name,
            service=service_name,
            staff=staff_name,
            jalali_date=to_jalali(appointment.date),
            start=f"{hhmm(appointment.start_time)} - {hhmm(appointment.end_time)}",
            tracking=appointment.tracking_code,
            status_fa=STATUS_LABELS_FA.get(appointment.status, appointment.status),
            title="یادآوری",
        )
    )


def waitlist_offer_text(session: Session, entry: Waitlist, free_time: time) -> str:
    """Sent to a waiting user when one of his slots became free."""
    staff = session.get(Staff, entry.staff_id)
    service = session.get(Service, entry.service_id)
    return (
        "⏳ فرصت رزرو فراهم شد!\n\n"
        f"یک بازه آزاد برای {staff.name if staff else '—'} در تاریخ "
        f"{to_jalali(entry.date)} ساعت {hhmm(free_time)} آزاد شده است.\n"
        f"🛠 خدمت: {service.name if service else '—'}\n\n"
        "در صورت تمایل همین حالا رزرو کنید."
    )


def support_reply_text(message: str) -> str:
    return f"📨 پاسخ پشتیبانی:\n\n{message}"


def waitlist_status_text(entry: Waitlist) -> str:
    label = WAITLIST_LABELS_FA.get(entry.status, entry.status)
    return (
        f"⏳ وضعیت لیست انتظار شما تغییر کرد.\n"
        f"📅 تاریخ: {to_jalali(entry.date)}\n"
        f"📌 وضعیت: {label}"
    )


def ticket_received_text(ticket_id: int, user_name: str, message: str) -> str:
    return (
        f"📨 تیکت جدید پشتیبانی #{ticket_id}\n"
        f"👤 کاربر: {user_name}\n\n"
        f"{message}"
    )
