"""
Application configuration and logging.

Every secret value (bot token, admin IDs, web password...) is read from the
environment / .env file. Nothing secret is ever hard-coded in the source code.
"""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Base folders
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
LOG_DIR = BASE_DIR / "logs"

# Load .env that sits next to config.py (works no matter where we run from)
load_dotenv(BASE_DIR / ".env")

DATA_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Small helpers that convert raw environment values into python values
# ---------------------------------------------------------------------------
def _parse_admin_ids(raw: str) -> list[int]:
    """ADMIN_IDS="1, 2, 3" -> [1, 2, 3] (invalid entries are ignored)."""
    ids: list[int] = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            ids.append(int(part))
    return ids


def _resolve_sqlite_url(url: str) -> str:
    """
    Convert a relative SQLite path into an absolute one, so the database file
    is always created inside the project folder (data/app.db) even if the
    program is started from another working directory.
    """
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return url
    raw_path = url[len(prefix):]
    if raw_path in (":memory:", "") or raw_path.startswith("file:"):
        return url
    path = Path(raw_path)
    if not path.is_absolute():
        path = BASE_DIR / path
    return prefix + path.resolve().as_posix()


# ---------------------------------------------------------------------------
# Configuration values
# ---------------------------------------------------------------------------
BOT_TOKEN: str = os.getenv("BOT_TOKEN", "").strip()
ADMIN_IDS: list[int] = _parse_admin_ids(os.getenv("ADMIN_IDS", ""))
DATABASE_URL: str = _resolve_sqlite_url(
    os.getenv("DATABASE_URL", "").strip() or "sqlite:///./data/app.db"
)
SECRET_KEY: str = os.getenv("SECRET_KEY", "").strip()
WEB_ADMIN_USERNAME: str = os.getenv("WEB_ADMIN_USERNAME", "admin").strip()
WEB_ADMIN_PASSWORD: str = os.getenv("WEB_ADMIN_PASSWORD", "")
TIMEZONE: str = os.getenv("TIMEZONE", "Asia/Tehran").strip() or "Asia/Tehran"
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO"
WEB_HOST: str = os.getenv("WEB_HOST", "127.0.0.1").strip() or "127.0.0.1"
WEB_PORT: int = int(os.getenv("WEB_PORT", "8000") or 8000)

# ---------------------------------------------------------------------------
# Channel bridge (the web app is the single source of truth)
# ---------------------------------------------------------------------------
# Base URL of the NobatYar deployment this bot books into.
WEB_API_URL: str = os.getenv("WEB_API_URL", "http://localhost:3000").strip()
# Shared secret the bot presents as `Authorization: Bearer …` on every call.
# It is the same value as CHANNEL_API_SECRET in the web app's .env.
CHANNEL_API_SECRET: str = os.getenv("CHANNEL_API_SECRET", "").strip()
# Public website the customers are handed over to ("book on the website").
PUBLIC_WEB_URL: str = os.getenv("PUBLIC_WEB_URL", WEB_API_URL).strip()
# Language of the bot's interface.
LOCALE: str = os.getenv("LOCALE", "fa").strip() or "fa"

if not CHANNEL_API_SECRET:
    raise RuntimeError(
        "CHANNEL_API_SECRET is empty.\n"
        "Copy the value from the web app's .env (CHANNEL_API_SECRET) into this "
        "project's .env — without it the API refuses every call."
    )

# A weak secret key must not be accepted by the web admin panel.
if not SECRET_KEY:
    # Generated once per process: fine for local development, and it forces the
    # user to set SECRET_KEY in .env for a stable login session.
    import secrets

    SECRET_KEY = secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
_LOG_FORMAT = logging.Formatter(
    fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


def setup_logging() -> logging.Logger:
    """
    Configure root logging:
      * console  -> what we see while developing
      * file     -> logs/app.log kept for later inspection

    Secrets (tokens, passwords) are never passed to the logger anywhere in the
    project, so they can never leak into the log files.
    """
    root = logging.getLogger()
    root.setLevel(LOG_LEVEL)

    # Avoid duplicated handlers when the function is called twice
    if root.handlers:
        return root

    console = logging.StreamHandler(stream=sys.stdout)
    console.setFormatter(_LOG_FORMAT)
    root.addHandler(console)

    file_handler = RotatingFileHandler(
        LOG_DIR / "app.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(_LOG_FORMAT)
    root.addHandler(file_handler)

    # Third party libraries are too verbose at DEBUG level
    logging.getLogger("aiogram").setLevel(logging.INFO)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    return root


logger = logging.getLogger("appointment_bot")
