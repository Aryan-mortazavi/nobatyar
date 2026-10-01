"""
🤖 Bot assembly: objects, start-up sequence, global error handling.

The FastAPI panel (``main.py``) reuses the very same bot/dispatcher objects so
that both the web routes and the Telegram handlers share one event loop and one
database connection pool.
"""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.exceptions import TelegramAPIError, TelegramRetryAfter
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import ErrorEvent, TelegramObject

from config import ADMIN_IDS, BOT_TOKEN, setup_logging
from database.init_db import init_db
from database.session import session_scope
from handlers import get_routers
from services import notification_service, user_service

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
    # Persian texts contain characters that break HTML (e.g. '<' in times),
    # therefore no default parse mode is configured: every message is sent as
    # plain text and formatting is done with the keyboards themselves.
    return Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=None))


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

    Returns True when the exception was recognised and handled, so aiogram
    stops propagating it.

    This observer must never raise: a bug here would swallow the very error
    we are trying to report (it happened once - Update.update_type does not
    exist in aiogram 3, the correct attribute is Update.event_type).
    """
    exception = event.exception
    update = event.update

    try:
        if isinstance(exception, TelegramRetryAfter):
            await asyncio.sleep(exception.retry_after + 1)
            return True

        if isinstance(exception, TelegramAPIError):
            # Typical cases: expired inline button (query is too old), edited
            # message that did not change, blocked bot...
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
    Everything that must happen before the first update is processed:

      1. create the tables (idempotent)
      2. sync ADMIN_IDS (.env) with the User.role column
      3. hand the bot over to the notification service
      4. deliver messages recorded while the bot was offline
      5. start APScheduler (reminders + waitlist maintenance)
    """
    setup_logging()

    init_db()

    with session_scope() as session:
        synced = user_service.apply_admin_roles(session, ADMIN_IDS)
    if synced:
        logger.info("Synchronized %s admin role(s) from ADMIN_IDS", synced)

    notification_service.init(bot)

    delivered = await notification_service.flush_pending()
    if delivered:
        logger.info("Delivered %s message(s) queued while offline", delivered)

    from scheduler import start as start_scheduler

    start_scheduler()

    me = await bot.get_me()
    logger.info("Bot @%s started", me.username)


async def shutdown() -> None:
    """Stop the background jobs cleanly."""
    from scheduler import stop as stop_scheduler

    stop_scheduler()
    logger.info("Bot shut down complete")


__all__ = [
    "create_bot",
    "create_dispatcher",
    "startup",
    "shutdown",
    "handle_error",
]
