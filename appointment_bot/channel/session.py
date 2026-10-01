"""
Per-chat state for the channel bridge.

Two pieces of state travel with a conversation:

* the **customer token** — minted by the web app when the person identifies
  themselves, and re-usable until it expires;
* a small **cache of the catalogue**, because a booking flow asks for the list
  of services at step 1 and again when the customer walks back from the date
  picker. Refetching every time would be slow and rude to the API.

The token lives in the aiogram FSM state (in memory, per chat), so restarting
the bot simply asks the customer to identify again — no credentials on disk.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from channel.api import Catalogue, ChannelApi

logger = logging.getLogger(__name__)

# FSM keys (kept short: the state object is serialised on every update)
KEY_TOKEN = "ch_token"
KEY_NAME = "ch_name"
KEY_PHONE = "ch_phone"
KEY_LOCALE = "ch_locale"

CATALOGUE_TTL_SECONDS = 300  # five minutes is plenty for one booking session


class BookingFlow(StatesGroup):
    """The customer's journey through the wizard."""

    name = State()
    phone = State()
    service = State()
    staff = State()
    date = State()
    time = State()
    confirm = State()
    note = State()
    support = State()


@dataclass
class Session:
    """Everything one chat needs, resolved lazily from the FSM state."""

    api: ChannelApi
    state: FSMContext
    telegram_id: int
    username: str | None = None
    name: str = ""
    phone: str = ""

    # -- identity ---------------------------------------------------------
    @property
    def identified(self) -> bool:
        return bool(self.name and self.phone)

    @property
    def token(self) -> str | None:
        return self.state.update.get_data().get(KEY_TOKEN)

    async def link(self, customer) -> None:
        """Remember who this chat is, so later steps can act on their behalf."""
        data = self.state.update.get_data()
        data[KEY_TOKEN] = customer.token
        data[KEY_NAME] = customer.name
        data[KEY_PHONE] = customer.phone or ""
        await self.state.update(data=data)

    async def remember(self, **fields: str) -> None:
        data = self.state.update.get_data()
        data.update(fields)
        await self.state.update(data=data)

    def require_token(self) -> str:
        token = self.token
        if not token:
            raise LookupError("this chat has not identified itself yet")
        return token

    # -- catalogue cache --------------------------------------------------
    async def catalogue(self) -> Catalogue:
        data = self.state.update.get_data()
        cached = data.get("ch_catalogue")
        stamp = float(data.get("ch_catalogue_at") or 0)
        if cached and (time.monotonic() - stamp) < CATALOGUE_TTL_SECONDS:
            return cached  # type: ignore[return-value]
        fresh = await self.api.catalogue()
        await self.remember(ch_catalogue=fresh, ch_catalogue_at=time.monotonic())
        return fresh

    async def forget(self) -> None:
        """Drop the identity (used by /start → «شروع مجدد»)."""
        await self.state.clear()


__all__ = ["BookingFlow", "Session", "KEY_TOKEN", "KEY_NAME", "KEY_PHONE", "KEY_LOCALE"]
