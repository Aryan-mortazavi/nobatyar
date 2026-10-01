"""
اعلان‌ها: هر پیام رزرو/لغو/یادآوری باید در جدول notifications با کلید خارجی
درست ذخیره شود و پیام‌های ارسال‌نشده بعد از روشن شدن ربات تحویل داده شوند.

(یک باگ واقعی: chat id به‌جای users.id در ستون user_id ذخیره می‌شد و درج
با خطای FOREIGN KEY شکست می‌خورد.)
"""

from __future__ import annotations

import asyncio
import sqlite3

import pytest
from aiogram.exceptions import TelegramForbiddenError
from aiogram.methods import GetMe

from database.models import Notification
from services import notification_service, user_service


class StubBot:
    """Just enough Bot for notification_service: records send_message calls."""

    def __init__(self, *, blocked: bool = False) -> None:
        self.sent: list[tuple[int, str]] = []
        self.blocked = blocked

    async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
        if self.blocked:
            raise TelegramForbiddenError(method=GetMe(), message="bot was blocked")
        self.sent.append((chat_id, text))
        return True


@pytest.fixture()
def stub_bot():
    bot = StubBot()
    notification_service.init(bot)
    yield bot
    notification_service.init(None)


def _rows(session):
    # the services work on their own sessions: forget the cached rows
    session.expire_all()
    return session.query(Notification).order_by(Notification.id).all()


def _register(session, telegram_id: int = 111222333):
    user, created = user_service.get_or_create(
        session,
        telegram_id=telegram_id,
        first_name="کاربر",
        last_name="تست",
        phone="09121234567",
    )
    session.commit()
    return user


def test_send_records_row_with_correct_foreign_key(db, session, plain_session, stub_bot):
    user = _register(session)
    assert asyncio.run(notification_service.send(user.telegram_id, "سلام")) is True

    assert stub_bot.sent == [(user.telegram_id, "سلام")]
    rows = _rows(plain_session)
    assert len(rows) == 1
    assert rows[0].user_id == user.id  # users.id, not the chat id
    assert rows[0].is_sent is True


def test_send_to_unregistered_chat_is_delivered_without_history(
    db, session, plain_session, stub_bot
):
    _register(session)
    assert asyncio.run(notification_service.send(999_000_111, "مهمان")) is True

    assert stub_bot.sent == [(999_000_111, "مهمان")]
    assert _rows(plain_session) == []  # no orphan row, no crash


def test_message_queued_while_offline_is_flushed_to_the_right_chat(
    db, session, plain_session
):
    user = _register(session)
    notification_service.init(None)  # bot is down (e.g. web-only mode)

    assert asyncio.run(notification_service.send(user.telegram_id, "یادآوری")) is False
    pending = _rows(plain_session)
    assert len(pending) == 1
    assert pending[0].is_sent is False

    bot = StubBot()
    notification_service.init(bot)
    try:
        assert asyncio.run(notification_service.flush_pending()) == 1
    finally:
        notification_service.init(None)

    assert bot.sent == [(user.telegram_id, "یادآوری")]  # chat id, not users.id
    assert _rows(plain_session)[0].is_sent is True


def test_flush_pending_drops_rows_of_deleted_accounts(db, session, plain_session):
    # a row that survived the deletion of its user: the ORM cannot create it
    # (the FK is enforced), so the raw connection is used to reproduce it.
    from pathlib import Path

    from database.session import get_engine

    path = Path(str(get_engine().url.database))
    with sqlite3.connect(path) as raw:
        raw.execute(
            "INSERT INTO notifications (user_id, type, message, is_sent, created_at)"
            " VALUES (?,?,?,?,datetime('now'))",
            (999_000, "admin_message", "بی‌صاحب", 0),
        )

    bot = StubBot()
    notification_service.init(bot)
    try:
        assert asyncio.run(notification_service.flush_pending()) == 0
    finally:
        notification_service.init(None)

    assert bot.sent == []
    assert _rows(plain_session)[0].is_sent is True  # never retried forever


def test_record_delivered_keeps_the_message_in_the_history(db, session, plain_session):
    user = _register(session)
    notification_service.record_delivered(user.telegram_id, "✅ نوبت ثبت شد")

    rows = _rows(plain_session)
    assert len(rows) == 1
    assert rows[0].user_id == user.id
    assert rows[0].is_sent is True  # shown in the chat, never sent twice


def test_blocked_user_keeps_the_row_pending(db, session, plain_session):
    user = _register(session)
    notification_service.init(StubBot(blocked=True))

    assert asyncio.run(notification_service.send(user.telegram_id, "سلام")) is False
    rows = _rows(plain_session)
    assert len(rows) == 1
    assert rows[0].is_sent is False  # will be retried on the next bot start
