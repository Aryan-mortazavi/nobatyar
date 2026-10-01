"""
🚀 Entry point: the Telegram bot, and nothing else.

    python main.py

The bot is a *channel* in front of the NobatYar web app:

    Telegram  ──►  this process  ──HTTP──►  NobatYar /api/v1  ──►  database

There is no local database, no admin panel and no scheduler any more — the web
application owns the calendar, the management screens and the reminders. This
process only speaks to Telegram, which means it can be restarted, scaled or
replaced without touching a single appointment.
"""

from __future__ import annotations

import asyncio
import logging

from bot import create_bot, create_dispatcher, shutdown, startup
from config import setup_logging

logger = logging.getLogger(__name__)


async def run() -> None:
    setup_logging()

    bot = create_bot()
    dispatcher = create_dispatcher()

    # refuses to start if the booking service is down
    await startup(bot)

    try:
        await dispatcher.start_polling(
            bot, allowed_updates=dispatcher.resolve_used_update_types()
        )
    finally:
        await shutdown()
        await bot.session.close()
        logger.info("Goodbye.")


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:  # pragma: no cover
        print("\nStopped by user.")
    except RuntimeError as error:
        # configuration / connectivity problems: say it plainly, not as a trace
        print(f"\n✖️ {error}")


if __name__ == "__main__":
    main()
