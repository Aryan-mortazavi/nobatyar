"""
Database package.

Importing this package gives you:
    Base                -> SQLAlchemy declarative base
    init_engine(url)    -> create/replace the engine
    create_session()    -> new Session
    session_scope()     -> transaction helper (commit / rollback / close)
    all ORM models      -> registered on Base.metadata
"""

from database.session import (
    Base,
    create_session,
    dispose_engine,
    get_engine,
    init_engine,
    session_scope,
)
from database import models  # noqa: F401  (registers every model)

__all__ = [
    "Base",
    "create_session",
    "dispose_engine",
    "get_engine",
    "init_engine",
    "session_scope",
    "models",
]
