"""
Database initialisation: create tables and load the default settings.

Run it directly:      python -m database.init_db
"""

from __future__ import annotations

import logging

from sqlalchemy import select

from database.models import Setting
from database.session import Base, get_engine, session_scope
from utils.constants import SETTINGS_DEFAULTS

logger = logging.getLogger(__name__)


def ensure_default_settings() -> None:
    """
    Insert every setting defined in constants.SETTINGS_DEFAULTS that does not
    exist yet. Existing values (edited by the admin) are never overwritten.
    """
    with session_scope() as session:
        existing = {row.key for row in session.scalars(select(Setting))}
        for key, (value, description) in SETTINGS_DEFAULTS.items():
            if key not in existing:
                session.add(Setting(key=key, value=value, description=description))
    logger.info("Default settings checked")


def init_db() -> None:
    """Create all tables (if missing) and seed default settings."""
    engine = get_engine()
    Base.metadata.create_all(engine)
    ensure_default_settings()
    logger.info("Database initialised")


if __name__ == "__main__":  # pragma: no cover
    from config import setup_logging

    setup_logging()
    init_db()
    print("✔ Database is ready.")
