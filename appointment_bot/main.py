"""
🚀 Application entry point: Telegram bot + FastAPI admin panel in ONE process.

    python main.py

Why one process?
    * the web panel and the bot share the same SQLite connection pool
    * actions done in the web panel (cancel / confirm ...) can notify the user
      through the very same bot instance
    * for the student demo only one command has to be started

    Bot  -> long polling (no webhook configuration needed)
    Web  -> uvicorn task inside the same asyncio event loop
"""

from __future__ import annotations

import asyncio
import logging

import uvicorn

from config import WEB_HOST, WEB_PORT, setup_logging
from bot import create_bot, create_dispatcher, shutdown, startup
from database.init_db import init_db

logger = logging.getLogger(__name__)


async def run() -> None:
    setup_logging()
    init_db()

    bot = create_bot()
    dispatcher = create_dispatcher()

    # start-up jobs (tables, admin roles, queued notifications, scheduler)
    await startup(bot)

    # the FastAPI application created in web.app reuses this bot instance
    from web.app import create_app, set_context

    set_context(bot=bot, dispatcher=dispatcher)
    app = create_app()

    config = uvicorn.Config(
        app,
        host=WEB_HOST,
        port=WEB_PORT,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    web_task = asyncio.create_task(server.serve(), name="uvicorn")

    logger.info("Web admin panel on http://%s:%s", WEB_HOST, WEB_PORT)

    try:
        # blocks until Ctrl+C - updates are handled in this loop
        await dispatcher.start_polling(
            bot, allowed_updates=dispatcher.resolve_used_update_types()
        )
    finally:
        server.should_exit = True
        try:
            await asyncio.wait_for(web_task, timeout=10)
        except (asyncio.TimeoutError, asyncio.CancelledError):  # pragma: no cover
            web_task.cancel()
        await shutdown()
        await bot.session.close()
        logger.info("Goodbye.")


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:  # pragma: no cover
        print("\nStopped by user.")


if __name__ == "__main__":
    main()
