"""
End-to-end booking flow: the *real* dispatcher, the *real* handlers, no network.

Every update is fed into the dispatcher exactly like Telegram would deliver it,
while a fake session simply records the outgoing API calls.  This catches bugs
that unit tests of the services cannot see - e.g. a keyboard renderer raising
in the middle of the flow (the FSM then no longer matches the screen and every
next tap reports «منقضی شده»).
"""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.fsm.storage.base import StorageKey
from aiogram.types import CallbackQuery, Chat, Message, Update, User

from bot import create_dispatcher
from database.models import Appointment
from utils.calendar import tehran_today
from utils.constants import BTN_BOOK

# A syntactically valid but fake token: nothing ever reaches Telegram.
TOKEN = "1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1"

# Routers are singletons: they may belong to exactly one dispatcher, so the
# dispatcher itself has to be created only once per pytest session.
_SHARED_DP = None


def shared_dispatcher():
    global _SHARED_DP
    if _SHARED_DP is None:
        _SHARED_DP = create_dispatcher()
    return _SHARED_DP


class FakeSession(BaseSession):
    """Records every outbound call instead of performing it."""

    def __init__(self) -> None:
        super().__init__()
        self.methods: list[object] = []

    async def make_request(self, bot, method, timeout=None):
        self.methods.append(method)
        return True

    async def close(self) -> None:
        pass

    async def stream_content(self, *args, **kwargs):  # pragma: no cover
        yield b""


class Harness:
    """Drives the dispatcher the way Telegram drives the production bot."""

    def __init__(self, telegram_id: int) -> None:
        self.telegram_id = telegram_id
        self.update_id = 0
        self.message_id = 0
        self.api = FakeSession()
        self.bot = Bot(
            token=TOKEN,
            session=self.api,
            default=DefaultBotProperties(parse_mode=None),
        )
        self.dp = shared_dispatcher()
        self.screen: Message | None = None

    async def reset(self) -> None:
        """Forget everything the previous scenario left in the FSM."""
        await self.dp.storage.set_state(self._key(), None)
        await self.dp.storage.set_data(self._key(), {})

    def _key(self) -> StorageKey:
        return StorageKey(
            bot_id=self.bot.id,
            chat_id=self.telegram_id,
            user_id=self.telegram_id,
        )

    # -- update builders ---------------------------------------------------
    def _message(self, text: str) -> Message:
        self.message_id += 1
        return Message(
            message_id=self.message_id,
            date=1_760_000_000,
            chat=Chat(id=self.telegram_id, type="private"),
            from_user=User(
                id=self.telegram_id, is_bot=False, first_name="کاربر تست"
            ),
            text=text,
        )

    # -- actions -----------------------------------------------------------
    async def send(self, text: str) -> None:
        self.update_id += 1
        self.screen = self._message(text)
        await self.dp.feed_update(
            self.bot, Update(update_id=self.update_id, message=self.screen)
        )

    async def tap(self, callback_data: str) -> None:
        """Press an inline button of the message currently on screen."""
        assert self.screen is not None, "no screen to tap on"
        self.update_id += 1
        query = CallbackQuery(
            id=str(self.update_id),
            from_user=User(
                id=self.telegram_id, is_bot=False, first_name="کاربر تست"
            ),
            chat_instance="ci",
            data=callback_data,
            message=self.screen,
        )
        await self.dp.feed_update(
            self.bot, Update(update_id=self.update_id, callback_query=query)
        )

    # -- observations ------------------------------------------------------
    async def state(self) -> str | None:
        return await self.dp.storage.get_state(self._key())

    async def data(self) -> dict:
        return await self.dp.storage.get_data(self._key())

    def buttons(self) -> list[list[str]]:
        """callback_data of every button of the last message we sent."""
        outgoing = [
            m
            for m in self.api.methods
            if type(m).__name__ in ("SendMessage", "EditMessageText")
        ]
        assert outgoing, "nothing was sent to Telegram"
        markup = outgoing[-1].reply_markup
        assert markup is not None, "the last screen has no keyboard"
        return [
            [button.callback_data for button in row]
            for row in markup.inline_keyboard
        ]

    def flat_buttons(self) -> list[str]:
        return [data for row in self.buttons() for data in row]

    async def close(self) -> None:
        await self.bot.session.close()


async def _walk_booking_flow(h: Harness, service_id: int, staff_id: int) -> str:
    """Run the whole flow and return the last screen text/state observed."""
    await h.reset()
    # 1) main menu -> booking
    await h.send(BTN_BOOK)
    assert await h.state() == "Booking:service"
    assert any(b.startswith("book:service:") for b in h.flat_buttons())

    # 2) service -> specialist
    await h.tap(f"book:service:{service_id}")
    assert await h.state() == "Booking:staff", "service step must advance"
    staff_buttons = [b for b in h.flat_buttons() if b.startswith("book:staff:")]
    assert f"book:staff:{staff_id}" in staff_buttons

    # 3) specialist -> calendar (this step used to crash -> «منقضی شده»)
    await h.tap(f"book:staff:{staff_id}")
    assert await h.state() == "Booking:date", "calendar must be rendered"

    day_buttons = [b for b in h.flat_buttons() if b.startswith("cal:day:")]
    if not day_buttons:  # the bookable day belongs to the next Jalali month
        nav = next(b for b in h.flat_buttons() if b.startswith("cal:nav:"))
        await h.tap(nav)
        assert await h.state() == "Booking:date"
        day_buttons = [b for b in h.flat_buttons() if b.startswith("cal:day:")]
    assert day_buttons, "at least one bookable day must be offered"

    # 4) day -> free slots (skip days without any free slot)
    slot_buttons: list[str] = []
    for day_button in day_buttons[:5]:
        await h.tap(day_button)
        if await h.state() == "Booking:time":
            slot_buttons = [
                b for b in h.flat_buttons() if b.startswith("slot:")
            ]
            if slot_buttons:
                break
    assert slot_buttons, "a bookable day must offer at least one free slot"

    # 5) slot -> confirmation screen
    await h.tap(slot_buttons[0])
    assert await h.state() == "Booking:confirm"
    data = await h.data()
    assert data.get("date_iso") and data.get("start_time")

    # 6) confirm -> appointment created
    await h.tap("book:confirm:yes")
    assert await h.state() is None, "the flow must reset after booking"
    return " ".join(h.flat_buttons())


def test_full_booking_flow(db, session, team, caplog):
    """Menu -> service -> staff -> day -> slot -> confirm, offline."""
    caplog.set_level(logging.ERROR)
    h = Harness(telegram_id=team["user"].telegram_id)
    try:
        asyncio.run(
            _walk_booking_flow(h, team["service"].id, team["staff"].id)
        )
    finally:
        asyncio.run(h.close())

    # the previous bug was swallowed by the global error observer
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert not errors, f"unexpected error(s): {[r.getMessage() for r in errors]}"

    rows = session.query(Appointment).all()
    assert len(rows) == 1
    booked = rows[0]
    assert booked.status in ("pending", "confirmed")
    assert booked.tracking_code.startswith("APT-")
    assert booked.staff_id == team["staff"].id
    assert booked.service_id == team["service"].id
    assert booked.date >= tehran_today()  # never in the past
    assert booked.slot_key is not None  # double-booking guard is armed


def test_tap_on_stale_screen_reports_expired(db, session, team):
    """A button pressed outside its step is refused instead of crashing."""
    h = Harness(telegram_id=team["user"].telegram_id)
    try:

        async def scenario() -> None:
            await h.reset()
            await h.send(BTN_BOOK)
            assert await h.state() == "Booking:service"
            # jump straight back to the menu, then press an old service button
            await h.tap("menu:home")
            assert await h.state() is None
            await h.tap(f"book:service:{team['service'].id}")
            assert await h.state() is None, "stale button must not advance"

        asyncio.run(scenario())
    finally:
        asyncio.run(h.close())
