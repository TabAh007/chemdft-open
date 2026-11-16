"""Pin PostgreSQL sessions to UTC so naive ``timestamp`` columns always hold UTC wall time.

ChemDFT stores every instant in a naive ``TIMESTAMP WITHOUT TIME ZONE`` column
(``Mapped[datetime]``) and writes timezone-aware UTC datetimes into it. SQLite simply drops the
tzinfo, which is correct for UTC values. PostgreSQL instead converts a ``timestamptz`` parameter
to the *session* time zone before discarding the zone, so a server, role, database or client
(``PGTZ``) set to anything but UTC silently shifted billing-period boundaries, receipt and ledger
timestamps by the offset (found 2026-10-15 on a host running Asia/Baku, +04).

Every connection the application opens therefore runs ``SET TIME ZONE 'UTC'`` once at connect time.
A plain ``SET`` (not a startup ``options`` parameter) is used because it also works through
connection poolers that reject unknown startup parameters. The setting is committed so a pool
rollback cannot undo it. Values already stored are not rewritten (no migration): rows written by
a UTC session are correct, rows written by a non-UTC session would need a separate, reviewed audit.
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.engine import Engine


def pin_session_timezone_utc(engine: Engine) -> Engine:
    """Make every new PostgreSQL connection of ``engine`` use the UTC session time zone."""
    if engine.dialect.name != "postgresql":
        return engine

    @event.listens_for(engine, "connect")
    def _set_utc(dbapi_connection, _record):  # pragma: no cover - exercised by PostgreSQL tests
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("SET TIME ZONE 'UTC'")
        finally:
            cursor.close()
        dbapi_connection.commit()

    return engine
