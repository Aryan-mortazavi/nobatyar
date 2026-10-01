"""
Engine / session management.

The engine is created lazily so that tests can point the application to a
temporary database before anything else touches the database.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    """Base class for every ORM model in the project."""


_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def init_engine(url: str | None = None, *, echo: bool = False) -> Engine:
    """
    Create (or replace) the SQLAlchemy engine.

    :param url: SQLAlchemy database URL. Defaults to config.DATABASE_URL.
    :param echo: log every SQL statement (useful while debugging).
    """
    global _engine, _session_factory

    if url is None:
        from config import DATABASE_URL

        url = DATABASE_URL

    connect_args: dict = {}
    if url.startswith("sqlite"):
        # check_same_thread=False -> the same engine may be used from the bot
        # event loop and from the FastAPI worker threads.
        connect_args = {"check_same_thread": False, "timeout": 30}

    engine = create_engine(url, echo=echo, future=True, connect_args=connect_args)

    if url.startswith("sqlite") and ":memory:" not in url:
        # SQLite needs a few pragmas for a reliable multi-process behaviour:
        #  * foreign_keys  -> real referential integrity
        #  * busy_timeout  -> wait instead of failing when the DB is locked
        #  * journal_mode  -> WAL allows concurrent readers + one writer
        @event.listens_for(engine, "connect")
        def _set_sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

    _engine = engine
    _session_factory = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False, future=True
    )
    return engine


def get_engine() -> Engine:
    """Return the current engine, creating it on first use."""
    if _engine is None:
        init_engine()
    assert _engine is not None
    return _engine


def create_session() -> Session:
    """Return a brand new Session (the caller is responsible for closing it)."""
    if _session_factory is None:
        init_engine()
    assert _session_factory is not None
    return _session_factory()


@contextmanager
def session_scope() -> Iterator[Session]:
    """
    Transaction scope used by services and background jobs.

    Commits on success, rolls back on any exception and always closes the
    session -> no half-written data can ever reach the database.
    """
    session = create_session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def dispose_engine() -> None:
    """Close all pooled connections (used when tests switch databases)."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None
