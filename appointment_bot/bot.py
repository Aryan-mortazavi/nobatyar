"""
🤖 Bot assembly: the Telegram client, the dispatcher and the channel bridge.

There is exactly one source of truth — the NobatYar web app. This process owns
no database and no business rules; it asks ``/api/v1`` what is true and renders
the answer. Start-up therefore has two jobs and only two:

  1. build the Telegram client and the channel client
  2. refuse to run if the web app cannot answer, because a bot that books
     against a dead service would silently eat customers' requests
"""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.exceptions import TelegramAPIError, TelegramRetryAfter
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import ErrorEvent, TelegramObject

from channel.api import ChannelApi
from channel.runtime import close_api, set_api
from channel.telegram_session import build_session
from config import BOT_TOKEN, CHANNEL_API_SECRET, WEB_API_URL, setup_logging
from handlers import get_routers

logger = logging.getLogger(__name__)
errors_router = Router(name="global_errors")


# ---------------------------------------------------------------------------
# Objects
# ---------------------------------------------------------------------------
def create_bot() -> Bot:
    """Create the Telegram client (token comes exclusively from .env)."""
    if not BOT_TOKEN:
        raise RuntimeError(
            "BOT_TOKEN is empty - copy .env.example to .env and set your token."
        )
    # the session is tuned so a half-configured IPv6 stack on the host cannot
    # make Telegram look unreachable (see channel/telegram_session.py)
    return Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode="HTML"),
        session=build_session(),
    )


def create_api() -> ChannelApi:
    """Create the channel client that talks to the web app."""
    return ChannelApi(WEB_API_URL, CHANNEL_API_SECRET)


def create_dispatcher() -> Dispatcher:
    """Create the dispatcher and register every router of the application."""
    dp = Dispatcher(storage=MemoryStorage())
    for router in get_routers():
        dp.include_router(router)
    dp.include_router(errors_router)
    return dp


# ---------------------------------------------------------------------------
# Global error handling
# ---------------------------------------------------------------------------
def _event_type(update: object) -> str:
    """Name of the incoming update ('message', 'callback_query', ...)."""
    if update is None:
        return "?"
    try:
        return str(update.event_type)  # aiogram 3: Update.event_type
    except Exception:  # noqa: BLE001 - an empty Update has no event type
        return "?"


@errors_router.error()
async def handle_error(event: ErrorEvent) -> bool:
    """
    Last line of defence: nothing may crash the polling loop.

    This observer must never raise: a bug here would swallow the very error we
    are trying to report.
    """
    exception = event.exception
    update = event.update

    try:
        if isinstance(exception, TelegramRetryAfter):
            await asyncio.sleep(exception.retry_after + 1)
            return True

        if isinstance(exception, TelegramAPIError):
            logger.warning(
                "Telegram API error in %s: %s", _event_type(update), exception
            )
            return True

        logger.error(
            "Unhandled error while processing an update (%s): %s",
            _event_type(update),
            exception,
            exc_info=exception,
        )
    except Exception:  # noqa: BLE001 - the observer itself must never fail
        logger.exception("Error while reporting another error")
    return False


# ---------------------------------------------------------------------------
# Start-up / shut-down
# ---------------------------------------------------------------------------
async def startup(bot: Bot) -> None:
    """
    Connect to the web app, verify it answers, then announce ourselves.

    Failing fast is deliberate: if the booking service is unreachable, the
    business should see a clear error now, not a bot that accepts messages and
    then goes quiet.
    """
    setup_logging()

    api = create_api()
    set_api(api)

    if not await api.health():
        await api.aclose()
        raise RuntimeError(
            f"The booking service at {WEB_API_URL} is not answering.\n"
            "Start the web app (npm run dev) or fix WEB_API_URL, then start the bot again."
        )

    me = await bot.get_me()
    logger.info("Bot @%s started, connected to %s", me.username, WEB_API_URL)


async def shutdown() -> None:
    """Release the channel client cleanly."""
    await close_api()
    logger.info("Bot shut down complete")


__all__ = [
    "create_bot",
    "create_api",
    "create_dispatcher",
    "startup",
    "shutdown",
    "handle_error",
]
