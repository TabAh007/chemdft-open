"""B4.3 independent review: real-API concurrency against a disposable PostgreSQL database.

Complements the unit-level CAS race in test_batch_b43_reliability.py by driving the actual HTTP
decision/stop endpoints and the completion worker path on PostgreSQL row locking (READ COMMITTED).
Skips when no local PostgreSQL is reachable. Only a throw-away database is created and dropped.
"""

from __future__ import annotations

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from chemdft_api.ai import calculation_completion
from chemdft_api.ai.calculation_completion import reconcile_completed_calculations
from chemdft_api.ai_models import (
    AIApprovalRecord,
    AIMessageRecord,
    AIRunEventRecord,
    AIRunRecord,
    AIRunStepRecord,
)
from chemdft_api.auth import ensure_dev_identity
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.config import Settings, get_settings
from chemdft_api.context import Identity
from chemdft_api.database import Base, create_application_engine, get_session
from chemdft_api.main import app
from chemdft_api.scientific_models import CalculationRecord, ComputeJobRecord
from chemdft_api.service_principals import ensure_service_principals
from chemdft_api.storage import LocalObjectStore
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text, update
from sqlalchemy.orm import sessionmaker
from test_batch_b43_reliability import approved_h2, waiting_h2


@pytest.fixture
def pg_api(tmp_path):
    host = os.environ.get("CHEMDFT_TEST_PG_HOST", "localhost")
    port = os.environ.get("CHEMDFT_TEST_PG_PORT", "5432")
    admin_url = f"postgresql+psycopg://{host}:{port}/postgres"
    try:
        admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip(f"PostgreSQL not accessible on {host}:{port}")
    name = f"chemdft_test_b43_review_{uuid.uuid4().hex[:8]}"
    with admin.connect() as conn:
        conn.execute(text(f"CREATE DATABASE {name}"))
        # Deliberately NOT UTC, whatever the host uses: the application engine must pin its own
        # sessions to UTC (db_timezone). This is what exposed the billing-period shift.
        conn.execute(text(f"ALTER DATABASE {name} SET timezone TO 'Asia/Baku'"))
    url = f"postgresql+psycopg://{host}:{port}/{name}"
    engine = create_application_engine(url, pool_size=20, max_overflow=10)
    try:
        for table in Base.metadata.sorted_tables:
            if table.name == "knowledge_embeddings":
                continue
            table.create(engine)
        settings = Settings(
            ai_provider="fake",
            ai_api_key=None,
            run_ai_integration=False,
            database_url=url,
            object_root=tmp_path / "objects",
            auto_create_schema=False,
            dev_identity_enabled=True,
            dev_identity_header_override_enabled=True,
        )
        sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        with sessions() as session:
            ensure_dev_identity(session, settings)

        def override_session():
            with sessions() as session:
                yield session

        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_session] = override_session
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client, sessions, settings
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    f"WHERE datname = '{name}' AND pid <> pg_backend_pid()"
                )
            )
            conn.execute(text(f"DROP DATABASE {name}"))
        admin.dispose()


def _race(calls):
    barrier = threading.Barrier(len(calls))

    def run(call):
        barrier.wait()
        return call()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def _seed_principals(pg_api):
    with pg_api[1]() as session:
        ensure_service_principals(session)


def _reconcile(pg_api):
    _, sessions, settings = pg_api
    with sessions() as session:
        return reconcile_completed_calculations(session, LocalObjectStore(settings.object_root))


def _run_job(pg_api, worker):
    _, sessions, settings = pg_api
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id=worker,
        )


@pytest.mark.parametrize("round_index", range(6))
def test_pg_reject_vs_stop_race_is_serialised_without_5xx(pg_api, round_index):
    client, sessions, _ = pg_api
    base, run, _, _, approval_id = waiting_h2(pg_api)
    codes = _race(
        [
            lambda: client.post(
                f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "REJECT"}
            ).status_code,
            lambda: client.post(f"{base}/ai/runs/{run['id']}/cancel").status_code,
        ]
    )
    with sessions() as session:
        record = session.get(AIRunRecord, run["id"])
        approval = session.get(AIApprovalRecord, approval_id)
        assert record.status in ("SUCCEEDED", "CANCELED")
        assert approval.status == "REJECTED"
        assert not session.scalars(select(CalculationRecord)).all()
    assert set(codes) <= {200, 409}, f"unexpected status codes {codes}"


@pytest.mark.parametrize("round_index", range(4))
def test_pg_approve_vs_reject_vs_stop_exactly_one_effect(pg_api, round_index):
    sessions = pg_api[1]
    client = pg_api[0]
    base, run, _, _, approval_id = waiting_h2(pg_api)

    def decide(decision):
        return lambda: client.post(
            f"{base}/ai/approvals/{approval_id}/decision", json={"decision": decision}
        ).status_code

    codes = _race(
        [
            decide("APPROVE"),
            decide("REJECT"),
            decide("APPROVE"),
            decide("REJECT"),
            lambda: client.post(f"{base}/ai/runs/{run['id']}/cancel").status_code,
        ]
    )
    with sessions() as session:
        record = session.get(AIRunRecord, run["id"])
        calculations = session.scalars(select(CalculationRecord)).all()
        jobs = session.scalars(select(ComputeJobRecord)).all()
        assert len(calculations) <= 1 and len(jobs) <= 1
        if calculations:
            assert record.status in ("WAITING_FOR_CALCULATION", "CANCELED")
        else:
            assert record.status in ("SUCCEEDED", "CANCELED")
        assert record.status != "WAITING_FOR_APPROVAL"
    assert set(codes) <= {200, 409}, f"unexpected status codes {codes}"


@pytest.mark.parametrize("round_index", range(4))
def test_pg_stop_vs_reject_lock_order_deadlock_prevented(pg_api, round_index):
    """Regression test for AS-C0 Task 2: consistent PostgreSQL lock acquisition order.

    Verifies that when a transaction locks AIRunRecord (simulating stop_run),
    a concurrent decide_approval(REJECT) acquires the AIRunRecord row lock first (via
    FOR UPDATE) rather than updating AIApprovalRecord first. Thus, the holding transaction
    can update AIApprovalRecord without encountering a PostgreSQL deadlock (SQLSTATE 40P01).
    """
    import time

    client, sessions, _ = pg_api
    base, run, _, _, approval_id = waiting_h2(pg_api)

    hold_lock_barrier = threading.Barrier(2)
    decision_result = {}

    def run_concurrent_decide():
        hold_lock_barrier.wait()
        res = client.post(
            f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "REJECT"}
        )
        decision_result["status_code"] = res.status_code
        decision_result["body"] = res.json()

    thread = threading.Thread(target=run_concurrent_decide)
    thread.start()

    with sessions() as lock_session:
        # Step 1: Explicitly lock AIRunRecord (simulating stop_run beginning).
        lock_session.execute(
            select(AIRunRecord.id)
            .where(AIRunRecord.id == run["id"])
            .with_for_update()
        )
        hold_lock_barrier.wait()
        # Allow thread to reach decide_approval and block on AIRunRecord lock.
        time.sleep(0.1)

        # Step 2: Update AIApprovalRecord.
        # Under the old defect (AB-BA), the thread would hold a lock on AIApprovalRecord
        # and lock_session would block here, causing a deadlock when PostgreSQL detected the cycle.
        # With consistent locking (AIRunRecord -> AIApprovalRecord), this update completes immediately!
        lock_session.execute(
            update(AIApprovalRecord)
            .where(AIApprovalRecord.run_id == run["id"], AIApprovalRecord.status == "PENDING")
            .values(status="REJECTED")
        )
        lock_session.execute(
            update(AIRunRecord)
            .where(AIRunRecord.id == run["id"])
            .values(status="CANCELED")
        )
        lock_session.commit()

    thread.join(timeout=5)
    assert not thread.is_alive(), "Concurrent decide thread hung or deadlocked!"
    assert decision_result["status_code"] in (200, 409), f"Unexpected response: {decision_result}"
    with sessions() as check_session:
        final_run = check_session.get(AIRunRecord, run["id"])
        final_approval = check_session.get(AIApprovalRecord, approval_id)
        assert final_run.status == "CANCELED"
        assert final_approval.status == "REJECTED"


def test_pg_concurrent_completion_publishes_exactly_once(pg_api):
    sessions = pg_api[1]
    run = approved_h2(pg_api)[1]
    _run_job(pg_api, "b43-review-pg")
    _seed_principals(pg_api)
    results = _race([lambda: _reconcile(pg_api) for _ in range(5)])
    assert sum(results) == 1, results
    with sessions() as session:
        completion = session.scalars(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run["id"],
                AIRunStepRecord.step_type == "CALCULATION_COMPLETION",
            )
        ).all()
        supported = session.scalars(
            select(AIMessageRecord).where(
                AIMessageRecord.run_id == run["id"],
                AIMessageRecord.evidence_status == "SUPPORTED",
            )
        ).all()
        assert len(completion) == 1 and len(supported) == 1
        assert session.get(AIRunRecord, run["id"]).status == "SUCCEEDED"


def test_pg_concurrent_transient_failures_do_not_overspend_attempts(pg_api, monkeypatch):
    """One poll round from several competing workers must not burn the whole retry budget."""
    sessions = pg_api[1]
    run = approved_h2(pg_api)[1]
    _run_job(pg_api, "b43-review-pg-transient")
    _seed_principals(pg_api)

    def failing(self, key, *args, **kwargs):
        raise TimeoutError("simulated storage timeout")

    monkeypatch.setattr(LocalObjectStore, "get_bytes", failing)
    _race([lambda: _reconcile(pg_api) for _ in range(6)])
    with sessions() as session:
        attempts = session.scalar(
            select(func.count(AIRunEventRecord.id)).where(
                AIRunEventRecord.run_id == run["id"],
                AIRunEventRecord.event_type == "calculation.grounding_transient_failure",
            )
        )
        status = session.get(AIRunRecord, run["id"]).status
    assert attempts <= 1, f"{attempts} attempts consumed by a single poll round"
    assert status == "WAITING_FOR_CALCULATION"


# ---------------------------------------------------------------------------
# SQLite regressions for the review corrections (retry pacing, missing object)
# ---------------------------------------------------------------------------


def _transient_events(sessions, run_id):
    with sessions() as session:
        return session.scalars(
            select(AIRunEventRecord)
            .where(
                AIRunEventRecord.run_id == run_id,
                AIRunEventRecord.event_type == "calculation.grounding_transient_failure",
            )
            .order_by(AIRunEventRecord.sequence)
        ).all()


def _sqlite_reconcile(api):
    _, sessions, settings = api
    with sessions() as session:
        ensure_service_principals(session)
        return reconcile_completed_calculations(session, LocalObjectStore(settings.object_root))


def test_rapid_polls_do_not_exhaust_the_transient_budget(api, monkeypatch):
    """The worker polls every ~2 s: an outage of a few seconds must not fail the run."""
    client, sessions, settings = api
    base, run, _, _, _ = approved_h2(api)
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b43-review-pacing",
        )

    def failing(self, key, *args, **kwargs):
        raise TimeoutError("simulated storage timeout")

    monkeypatch.setattr(LocalObjectStore, "get_bytes", failing)
    for _ in range(6):  # six polls inside one cooldown window
        assert _sqlite_reconcile(api) == 0
    assert len(_transient_events(sessions, run["id"])) == 1
    assert client.get(f"{base}/ai/runs/{run['id']}").json()["status"] == "WAITING_FOR_CALCULATION"

    # Elapsed cooldown permits the next attempt; the third attempt exhausts explicitly.
    for expected_attempt in (2, 3):
        with sessions() as session:
            session.execute(
                update(AIRunEventRecord)
                .where(AIRunEventRecord.event_type == "calculation.grounding_transient_failure")
                .values(
                    occurred_at=utc_now_minus(
                        calculation_completion.TRANSIENT_RETRY_COOLDOWN_SECONDS + 5
                    )
                )
            )
            session.commit()
        _sqlite_reconcile(api)
        assert len(_transient_events(sessions, run["id"])) == expected_attempt
    final = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final["status"] == "FAILED"
    assert final["error_code"] == "TRANSIENT_GROUNDING_EXHAUSTED"


def utc_now_minus(seconds):
    from chemdft_api.models import utc_now

    return utc_now() - timedelta(seconds=seconds)


def test_missing_artifact_object_fails_immediately_as_invalid_evidence(api, monkeypatch):
    client, sessions, settings = api
    base, run, _, _, _ = approved_h2(api)
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b43-review-missing",
        )

    def missing(self, key, *args, **kwargs):
        raise FileNotFoundError(key)

    monkeypatch.setattr(LocalObjectStore, "get_bytes", missing)
    assert _sqlite_reconcile(api) == 1
    final = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final["status"] == "FAILED"
    assert final["error_code"] == "INSUFFICIENT_SCIENTIFIC_EVIDENCE"
    assert not _transient_events(sessions, run["id"])


def test_approve_retry_after_completion_stays_idempotent(api):
    """A client retry of an already-honoured APPROVE must not turn into an error after the run
    finishes (it never dispatches again either way); Stop remains a conflict."""
    client, sessions, settings = api
    base, _run, _, _, approval_id = approved_h2(api)
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b43-review-approve-retry",
        )
    assert _sqlite_reconcile(api) == 1
    retry = client.post(
        f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "APPROVE"}
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["status"] == "SUCCEEDED"
    with sessions() as session:
        assert len(session.scalars(select(CalculationRecord)).all()) == 1
        assert len(session.scalars(select(ComputeJobRecord)).all()) == 1
    # A contradictory decision after the fact is still refused.
    contradictory = client.post(
        f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "REJECT"}
    )
    assert contradictory.status_code == 409


def test_pg_concurrent_commit_gap_recovery_is_single_effect(pg_api):
    sessions = pg_api[1]
    run = approved_h2(pg_api)[1]
    calc_id = run["waiting_calculation_id"]
    with sessions() as session:
        for step in session.scalars(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run["id"],
                AIRunStepRecord.tool_name == "calculation.submit",
                AIRunStepRecord.step_type == "TOOL_RESULT",
            )
        ):
            session.delete(step)
        record = session.get(AIRunRecord, run["id"])
        record.status = "EXECUTING"
        record.waiting_calculation_id = None
        session.commit()
    _seed_principals(pg_api)
    _race([lambda: _reconcile(pg_api) for _ in range(5)])
    with sessions() as session:
        record = session.get(AIRunRecord, run["id"])
        assert record.status == "WAITING_FOR_CALCULATION"
        assert record.waiting_calculation_id == calc_id
        steps = session.scalars(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run["id"],
                AIRunStepRecord.tool_name == "calculation.submit",
                AIRunStepRecord.step_type == "TOOL_RESULT",
            )
        ).all()
        assert len(steps) == 1
        queued = session.scalars(
            select(AIRunEventRecord).where(
                AIRunEventRecord.run_id == run["id"],
                AIRunEventRecord.event_type == "calculation.queued",
            )
        ).all()
        recovered = [e for e in queued if (e.payload_json or {}).get("recovered")]
        assert len(recovered) == 1
        assert len(session.scalars(select(CalculationRecord)).all()) == 1
        assert len(session.scalars(select(ComputeJobRecord)).all()) == 1
        numbers = [s.step_number for s in session.scalars(
            select(AIRunStepRecord).where(AIRunStepRecord.run_id == run["id"])
        )]
        assert len(numbers) == len(set(numbers)), "step numbers must stay unique"


def test_stop_while_waiting_for_calculation_never_publishes_a_result(api):
    client, sessions, settings = api
    base, run, _, _, _ = approved_h2(api)
    assert client.post(f"{base}/ai/runs/{run['id']}/cancel").status_code == 200
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b43-review-stop-wait",
        )
    assert _sqlite_reconcile(api) == 0
    with sessions() as session:
        assert session.get(AIRunRecord, run["id"]).status == "CANCELED"
        assert not session.scalars(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run["id"],
                AIRunStepRecord.step_type == "CALCULATION_COMPLETION",
            )
        ).all()
        assert not session.scalars(
            select(AIMessageRecord).where(
                AIMessageRecord.run_id == run["id"],
                AIMessageRecord.evidence_status == "SUPPORTED",
            )
        ).all()
