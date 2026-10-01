"""
Shared pytest fixtures.

Every test runs against its own temporary SQLite file, so tests never touch the
real database (data/app.db) and can run in any order.
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

# --- the project must be importable no matter where pytest is started from ---
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# --- environment is set BEFORE the application modules are imported ---------
os.environ.setdefault("WEB_ADMIN_PASSWORD", "test-password")
os.environ.setdefault("WEB_ADMIN_USERNAME", "tester")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("BOT_TOKEN", "")
os.environ.setdefault("LOG_LEVEL", "WARNING")

import pytest  # noqa: E402

from database.init_db import init_db  # noqa: E402
from database.session import create_session, dispose_engine, init_engine, session_scope  # noqa: E402
from services import service_service, staff_service, user_service  # noqa: E402
from utils.calendar import tehran_today  # noqa: E402


@pytest.fixture()
def db(tmp_path):
    """Create an empty database for one test and dispose it afterwards."""
    init_engine(f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    init_db()
    yield
    dispose_engine()


@pytest.fixture()
def session(db):
    """Committed session scope (changes are visible to other sessions)."""
    scope = session_scope()
    active = scope.__enter__()
    yield active
    scope.__exit__(None, None, None)


@pytest.fixture()
def plain_session(db):
    """Plain session (used when a test wants to observe rollbacks)."""
    active = create_session()
    yield active
    active.rollback()
    active.close()


@pytest.fixture()
def working_day() -> date:
    """A future day on which the default schedule is active (Sat-Thu)."""
    cursor = tehran_today() + timedelta(days=1)
    for _ in range(14):
        if cursor.weekday() != 4:  # Friday is closed by the default schedule
            return cursor
        cursor += timedelta(days=1)
    return tehran_today() + timedelta(days=1)


@pytest.fixture()
def team(session, working_day):
    """
    Ready-to-use test data:
        user + 30min service + staff member that provides it (default schedule)
    """
    user, created = user_service.get_or_create(
        session,
        telegram_id=123456789,
        first_name="علی",
        last_name="تستی",
        phone="09121234567",
    )
    assert created
    service = service_service.create(
        session, name="ویزیت تست", duration=30, price=100000
    )
    member = staff_service.create(session, name="دکشن تست", specialty="عمومی")
    staff_service.assign_services(session, member, [service.id])
    session.commit()
    return {"user": user, "service": service, "staff": member, "day": working_day}
