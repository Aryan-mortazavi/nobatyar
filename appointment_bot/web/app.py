"""
FastAPI admin panel.

    python -m web            # only the web panel (no Telegram bot)
    python main.py           # web panel + bot in one process (recommended)

Everything is created through ``create_app()`` so the tests can build a fresh
application around a temporary database.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from config import SECRET_KEY, setup_logging
from web.render import render, templates

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).resolve().parent / "static"

# Bot / dispatcher injected by main.py (the panel then notifies users live)
_bot = None
_dispatcher = None


def set_context(bot=None, dispatcher=None) -> None:
    """Give the web panel the running bot so it can send messages."""
    global _bot, _dispatcher
    _bot = bot
    _dispatcher = dispatcher


def get_bot():
    return _bot


def get_dispatcher():
    return _dispatcher


@asynccontextmanager
async def _lifespan(app: FastAPI):
    setup_logging()
    from database.init_db import init_db

    init_db()
    logger.info("Web panel ready")
    yield


def create_app() -> FastAPI:
    """Build the FastAPI application (routes, middleware, static files)."""
    app = FastAPI(
        title="پنل مدیریت نوبت‌دهی",
        docs_url="/api/docs",
        redoc_url=None,
        lifespan=_lifespan,
    )

    # --- routes -----------------------------------------------------------
    from web.routes import include_routes

    include_routes(app)

    # --- static files -----------------------------------------------------
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # --- security middleware ----------------------------------------------
    # NOTE: SessionMiddleware is added LAST -> Starlette puts it in front of
    # every other middleware, so ``request.session`` is available everywhere.
    app.add_middleware(
        SessionMiddleware,
        secret_key=SECRET_KEY,
        same_site="lax",
        https_only=False,
        max_age=8 * 60 * 60,  # the panel stays open for 8 hours
    )

    # --- error pages --------------------------------------------------------
    @app.exception_handler(404)
    async def not_found(request: Request, exc):  # pragma: no cover - trivial
        return render(request, "error.html", status_code=404, code=404,
                      title="صفحه پیدا نشد", message="آدرس موردنظر وجود ندارد.")

    @app.exception_handler(403)
    async def forbidden(request: Request, exc):  # pragma: no cover - trivial
        return render(request, "error.html", status_code=403, code=403,
                      title="دسترسی غیرمجاز", message="شما مجوز این عملیات را ندارید.")

    return app


__all__ = ["create_app", "set_context", "get_bot", "get_dispatcher"]
