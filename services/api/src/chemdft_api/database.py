from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings
from .db_timezone import pin_session_timezone_utc
from .test_environment import validate_test_process


class Base(DeclarativeBase):
    pass


def _ensure_sqlite_parent(database_url: str) -> None:
    prefix = "sqlite:///"
    if database_url.startswith(prefix) and ":memory:" not in database_url:
        Path(database_url.removeprefix(prefix)).parent.mkdir(parents=True, exist_ok=True)


settings = get_settings()
validate_test_process(settings, Path(__file__).resolve().parents[4])
_ensure_sqlite_parent(settings.database_url)


def create_application_engine(database_url: str, **kwargs) -> Engine:
    """The one way the application (and PostgreSQL tests) build an engine.

    PostgreSQL sessions are pinned to UTC (see ``db_timezone``): timestamps are stored in naive
    columns as UTC and must not depend on the server, role or client time zone.
    """
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    kwargs.setdefault("pool_pre_ping", True)
    return pin_session_timezone_utc(
        create_engine(database_url, connect_args=connect_args, **kwargs)
    )


engine = create_application_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
