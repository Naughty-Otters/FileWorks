from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine | None:
    global _engine, _SessionLocal
    settings = get_settings()
    if not settings.database_url:
        return None
    if _engine is None:
        _engine = create_engine(settings.database_url, pool_pre_ping=True)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _engine


def init_db() -> None:
    """Apply Alembic migrations (no-op when DATABASE_URL is unset)."""
    from app.db.upgrade import upgrade_db

    upgrade_db()


def get_db() -> Generator[Session | None, None, None]:
    if _SessionLocal is None:
        get_engine()
    if _SessionLocal is None:
        yield None
        return
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def session_scope() -> Session | None:
    if _SessionLocal is None:
        get_engine()
    if _SessionLocal is None:
        return None
    return _SessionLocal()
