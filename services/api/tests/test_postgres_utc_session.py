"""PostgreSQL session time zone: naive timestamp columns must always hold UTC wall time.

Regression for the billing-period shift found on 2026-10-15 (PostgreSQL in Asia/Baku, +04). Each
test database is created with a deliberately non-UTC default time zone, so the result never
depends on the host's zone. Skips when no local PostgreSQL is reachable; only throw-away
databases are created and dropped. No existing database is read or modified.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from chemdft_api.ai.usage_accounting import finish_invocation, reserve_invocation
from chemdft_api.ai_models import AIModelInvocationRecord
from chemdft_api.billing_models import AIUsageLedgerEntryRecord
from chemdft_api.billing_service import BillingService
from chemdft_api.database import create_application_engine
from sqlalchemy import Column, DateTime, Integer, MetaData, Table, create_engine, select, text
from test_ai_usage_accounting import _identity, _response, _run, usage_api  # noqa: F401
from test_batch_b43_review_pg import pg_api  # noqa: F401 -- fixture used by usage_api
from test_investigation_accounting import _investigation

ZONES = [
    "UTC",
    "Asia/Baku",  # +04, the zone where the defect was found
    "America/Los_Angeles",  # -07/-08 with DST
    "Pacific/Kiritimati",  # +14, date line
    "Australia/Lord_Howe",  # +10:30/+11 half-hour DST
]


def naive_utc(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _admin():
    host = os.environ.get("CHEMDFT_TEST_PG_HOST", "localhost")
    port = os.environ.get("CHEMDFT_TEST_PG_PORT", "5432")
    admin = create_engine(
        f"postgresql+psycopg://{host}:{port}/postgres", isolation_level="AUTOCOMMIT"
    )
    try:
        with admin.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip(f"PostgreSQL not accessible on {host}:{port}")
    return admin, host, port


@pytest.fixture(params=ZONES)
def zone_database(request):
    admin, host, port = _admin()
    name = f"chemdft_test_tz_{uuid.uuid4().hex[:8]}"
    with admin.connect() as conn:
        conn.execute(text(f"CREATE DATABASE {name}"))
        conn.execute(text(f"ALTER DATABASE {name} SET timezone TO '{request.param}'"))
    try:
        yield request.param, f"postgresql+psycopg://{host}:{port}/{name}"
    finally:
        with admin.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
        admin.dispose()


def _table():
    return Table(
        "instants",
        MetaData(),
        Column("id", Integer, primary_key=True),
        Column("at", DateTime),  # same type as every ChemDFT `Mapped[datetime]` column
    )


# Month/year ends, leap day, DST transitions of two zones, sub-second precision.
INSTANTS = [
    datetime(2026, 8, 15, 21, 42, 54, 655892, tzinfo=UTC),  # the value from the failing test
    datetime(2026, 10, 31, 23, 59, 59, 999999, tzinfo=UTC),
    datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC),
    datetime(2028, 2, 29, 12, 0, tzinfo=UTC),
    datetime(2026, 3, 8, 10, 0, tzinfo=UTC),  # US spring-forward instant
    datetime(2026, 11, 1, 9, 0, tzinfo=UTC),  # US fall-back instant
    datetime(2026, 4, 4, 15, 30, tzinfo=UTC),  # Lord Howe DST end
]


def test_application_engine_pins_every_session_to_utc(zone_database, monkeypatch):
    zone, url = zone_database
    monkeypatch.setenv("PGTZ", "Asia/Baku" if zone != "Asia/Baku" else "America/Los_Angeles")
    engine = create_application_engine(url)
    try:
        for _ in range(3):  # fresh and reused pooled connections, with a rollback in between
            with engine.connect() as conn:
                assert conn.execute(text("SHOW timezone")).scalar() == "UTC"
                conn.rollback()
            with engine.connect() as conn:
                assert conn.execute(text("SHOW timezone")).scalar() == "UTC"
    finally:
        engine.dispose()


def test_unpinned_engine_reproduces_the_defect_so_the_test_can_fail(zone_database, monkeypatch):
    zone, url = zone_database
    monkeypatch.delenv("PGTZ", raising=False)
    engine = create_engine(url)  # what database.py did before the fix
    table = _table()
    try:
        table.metadata.create_all(engine)
        value = INSTANTS[0]
        with engine.begin() as conn:
            conn.execute(table.insert().values(id=1, at=value))
            stored = conn.execute(select(table.c.at)).scalar_one()
        if zone == "UTC":
            assert stored == naive_utc(value)
        else:
            assert stored != naive_utc(value)  # shifted by the zone offset
    finally:
        engine.dispose()


def test_aware_utc_datetimes_are_stored_and_read_back_as_utc(zone_database):
    zone, url = zone_database
    engine = create_application_engine(url)
    table = _table()
    try:
        table.metadata.create_all(engine)
        with engine.begin() as conn:
            for index, value in enumerate(INSTANTS):
                conn.execute(table.insert().values(id=index, at=value))
        with engine.connect() as conn:
            rows = conn.execute(select(table.c.id, table.c.at).order_by(table.c.id)).all()
            # Stored text is the UTC wall time, so server-side comparisons in UTC agree too.
            literal = conn.execute(
                text(
                    "SELECT to_char(at, 'YYYY-MM-DD\"T\"HH24:MI:SS.US') FROM instants WHERE id = 0"
                )
            ).scalar()
        assert [row.at for row in rows] == [naive_utc(v) for v in INSTANTS], zone
        assert literal == "2026-08-15T21:42:54.655892"
    finally:
        engine.dispose()


# ---------------------------------------------------------------- application-level flows
def test_reservation_settlement_and_period_timestamps_are_utc(usage_api):  # noqa: F811
    """Receipt, ledger and billing-period timestamps on SQLite and on a non-UTC PostgreSQL."""
    _, sessions, settings = usage_api
    pid, _iid = _investigation(usage_api)
    before = datetime.now(UTC).replace(tzinfo=None)
    with sessions() as session:
        run = _run(session, settings, pid)
        identity = _identity(settings)
        start, end = BillingService(session, identity, settings).ai_usage_period()
        receipt = reserve_invocation(
            session,
            project_id=pid,
            run_id=run.id,
            provider="fake",
            model="fake-standard",
            mode="BYOK",
            prompt_version="OFFLINE",
            identity=identity,
            settings=settings,
        )
        session.commit()
        finish_invocation(session, identity, settings, receipt.id, _response())
        after = datetime.now(UTC).replace(tzinfo=None)
        stored = session.get(AIModelInvocationRecord, receipt.id)
        entry = session.scalars(
            select(AIUsageLedgerEntryRecord).where(
                AIUsageLedgerEntryRecord.model_invocation_id == receipt.id
            )
        ).one()
        # Reservation and settlement timestamps are real UTC wall times (no zone offset).
        assert before - timedelta(seconds=5) <= stored.created_at <= after + timedelta(seconds=5)
        assert before - timedelta(seconds=5) <= entry.created_at <= after + timedelta(seconds=5)
        # The period captured before dispatch is the period stored on the ledger entry.
        assert entry.period_start == naive_utc(start)
        assert entry.period_end == naive_utc(end)
        assert entry.period_start <= before < entry.period_end


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (datetime(2026, 10, 1, tzinfo=UTC), datetime(2026, 11, 1, tzinfo=UTC)),
        (datetime(2026, 12, 1, tzinfo=UTC), datetime(2027, 1, 1, tzinfo=UTC)),
        (
            datetime(2026, 10, 31, 23, 59, 59, 999999, tzinfo=UTC),
            datetime(2026, 11, 30, 23, 59, 59, 999999, tzinfo=UTC),
        ),
    ],
)
def test_billing_period_boundaries_survive_exactly(usage_api, start, end):  # noqa: F811
    _, sessions, settings = usage_api
    pid, _iid = _investigation(usage_api)
    with sessions() as session:
        run = _run(session, settings, pid)
        identity = _identity(settings)
        receipt = reserve_invocation(
            session,
            project_id=pid,
            run_id=run.id,
            provider="fake",
            model="fake-standard",
            mode="BYOK",
            prompt_version="OFFLINE",
            identity=identity,
            settings=settings,
        )
        receipt.reservation_json = {
            **receipt.reservation_json,
            "billing_period_start": start.isoformat(),
            "billing_period_end": end.isoformat(),
        }
        session.commit()
        finish_invocation(session, identity, settings, receipt.id, _response())
        # A late duplicate report must land in the SAME period, not one shifted by the zone.
        finish_invocation(session, identity, settings, receipt.id, _response())
        entries = session.scalars(
            select(AIUsageLedgerEntryRecord).where(
                AIUsageLedgerEntryRecord.model_invocation_id == receipt.id
            )
        ).all()
        assert entries, "settlement must create a ledger entry"
        for entry in entries:
            assert (entry.period_start, entry.period_end) == (naive_utc(start), naive_utc(end))
