"""B4.3: AI Scientist execution reliability, recovery, and adversarial concurrency tests."""

from __future__ import annotations

import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from chemdft_api.ai import calculation_completion
from chemdft_api.ai.calculation_completion import (
    reconcile_completed_calculations,
)
from chemdft_api.ai.events import AIRunEventManager
from chemdft_api.ai.execution import (
    AIRunExecutionManager,
    StaleWorkerFencedError,
)
from chemdft_api.ai_models import (
    AIApprovalRecord,
    AIConversationRecord,
    AIMessageRecord,
    AIRunEventRecord,
    AIRunRecord,
    AIRunStepRecord,
)
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.context import Identity
from chemdft_api.database import Base, create_application_engine
from chemdft_api.models import Organization, Project, ProjectMember, User, utc_now
from chemdft_api.scientific_models import (
    CalculationRecord,
    CalculationResultRecord,
    ComputeJobRecord,
)
from chemdft_api.service_principals import ensure_service_principals
from chemdft_api.storage import LocalObjectStore
from sqlalchemy import create_engine, select, text, update
from sqlalchemy.orm import sessionmaker
from test_ai_scientist import _create_project, _import_h2


def approved_h2(api):
    client, _, _ = api
    project = _create_project(client, "B4.3 disposable H2")
    imported = _import_h2(client, project["id"])
    base = f"/v1/projects/{project['id']}"
    conversation = client.post(f"{base}/ai/conversations", json={"title": "H2 energy"}).json()
    conversation_id = conversation["conversation"]["id"]
    response = client.post(
        f"{base}/ai/conversations/{conversation_id}/messages",
        json={
            "content": "Calculate HF/STO-3G energy",
            "selected_structure_id": imported["structure"]["id"],
        },
    )
    assert response.status_code == 201, response.text
    run = response.json()["latest_run"]
    assert run["status"] == "WAITING_FOR_APPROVAL", run
    approval_id = run["pending_approval"]["id"]
    response = client.post(
        f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "APPROVE"}
    )
    assert response.status_code == 200, response.text
    run = response.json()
    assert run["status"] == "WAITING_FOR_CALCULATION", run
    return base, run, imported, conversation_id, approval_id


def waiting_h2(api):
    client, _, _ = api
    project = _create_project(client, "B4.3 waiting H2")
    imported = _import_h2(client, project["id"])
    base = f"/v1/projects/{project['id']}"
    conversation = client.post(f"{base}/ai/conversations", json={"title": "H2 reject"}).json()
    conversation_id = conversation["conversation"]["id"]
    response = client.post(
        f"{base}/ai/conversations/{conversation_id}/messages",
        json={
            "content": "Calculate HF/STO-3G energy",
            "selected_structure_id": imported["structure"]["id"],
        },
    )
    assert response.status_code == 201, response.text
    run = response.json()["latest_run"]
    assert run["status"] == "WAITING_FOR_APPROVAL", run
    return base, run, imported, conversation_id, run["pending_approval"]["id"]


def reconcile(api):
    _, sessions, settings = api
    with sessions() as session:
        ensure_service_principals(session)
        return reconcile_completed_calculations(session, LocalObjectStore(settings.object_root))


# ---------------------------------------------------------------------------
# Priority 1: Approval Rejection & Terminal State Concurrency
# ---------------------------------------------------------------------------


def test_rejection_idempotency(api):
    client, sessions, _ = api
    base, run, _, _, approval_id = waiting_h2(api)

    resp1 = client.post(
        f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "REJECT"}
    )
    assert resp1.status_code == 200, resp1.text
    view1 = resp1.json()
    assert view1["status"] == "SUCCEEDED"

    # Repeated rejection POST is idempotent: returns 200 with unchanged view.
    resp2 = client.post(
        f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "REJECT"}
    )
    assert resp2.status_code == 200, resp2.text
    view2 = resp2.json()
    assert view2["status"] == "SUCCEEDED"

    with sessions() as session:
        approval = session.get(AIApprovalRecord, approval_id)
        assert approval.status == "REJECTED"
        run_record = session.get(AIRunRecord, run["id"])
        assert run_record.status == "SUCCEEDED"
        events = session.scalars(
            select(AIRunEventRecord).where(
                AIRunEventRecord.run_id == run["id"],
                AIRunEventRecord.event_type == "approval.rejected",
            )
        ).all()
        assert len(events) == 1, "Rejection event must be recorded exactly once"
        # No calculation or compute job was ever queued
        assert not session.scalars(select(CalculationRecord)).all()
        assert not session.scalars(select(ComputeJobRecord)).all()


def test_rejection_after_stopped_run_is_rejected_with_conflict(api):
    client, sessions, _ = api
    base, run, _, _, approval_id = waiting_h2(api)

    # Cancel/stop the run while it is WAITING_FOR_APPROVAL
    stop_resp = client.post(f"{base}/ai/runs/{run['id']}/cancel")
    assert stop_resp.status_code == 200, stop_resp.text
    assert stop_resp.json()["status"] == "CANCELED"

    # Attempting to decide an approval for a stopped run must be rejected with 409
    reject_resp = client.post(
        f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "REJECT"}
    )
    assert reject_resp.status_code == 409, reject_resp.text
    detail_str = str(reject_resp.json()).lower()
    assert "terminal state" in detail_str or "no longer awaiting" in detail_str

    # Terminal state CANCELED must not be overwritten
    with sessions() as session:
        run_record = session.get(AIRunRecord, run["id"])
        assert run_record.status == "CANCELED"


def test_concurrent_rejection_and_stop_never_corrupts_state(api):
    """Adversarial race between user Reject and user Stop/Cancel on WAITING_FOR_APPROVAL."""
    client, sessions, _ = api
    base, run, _, _, approval_id = waiting_h2(api)

    def do_reject():
        return client.post(
            f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "REJECT"}
        ).status_code

    def do_stop():
        return client.post(f"{base}/ai/runs/{run['id']}/cancel").status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        f_reject = executor.submit(do_reject)
        f_stop = executor.submit(do_stop)
        code_reject = f_reject.result()
        code_stop = f_stop.result()

    # One must succeed (200), the other may succeed or 409 conflict
    assert {code_reject, code_stop} <= {200, 409}
    assert 200 in {code_reject, code_stop}

    with sessions() as session:
        run_record = session.get(AIRunRecord, run["id"])
        # The run MUST reach a valid terminal state, never corrupted or left in limbo
        assert run_record.status in ("SUCCEEDED", "CANCELED")
        assert run_record.status != "WAITING_FOR_APPROVAL"
        approval = session.get(AIApprovalRecord, approval_id)
        assert approval.status == "REJECTED"


def test_concurrent_rejection_and_approval_executes_exactly_one_decision(api):
    """Adversarial race between concurrent Reject and Approve requests."""
    client, sessions, _ = api
    base, run, _, _, approval_id = waiting_h2(api)

    def decide(decision: str):
        return client.post(
            f"{base}/ai/approvals/{approval_id}/decision", json={"decision": decision}
        ).status_code

    with ThreadPoolExecutor(max_workers=6) as executor:
        decisions = ["APPROVE", "REJECT", "APPROVE", "REJECT", "APPROVE", "REJECT"]
        codes = list(executor.map(decide, decisions))

    assert set(codes) <= {200, 409}
    assert 200 in codes

    with sessions() as session:
        run_record = session.get(AIRunRecord, run["id"])
        approval = session.get(AIApprovalRecord, approval_id)
        assert approval.status in ("APPROVED", "REJECTED")

        if approval.status == "APPROVED":
            assert run_record.status == "WAITING_FOR_CALCULATION"
            assert len(session.scalars(select(CalculationRecord)).all()) == 1
            assert len(session.scalars(select(ComputeJobRecord)).all()) == 1
        else:
            assert run_record.status == "SUCCEEDED"
            assert len(session.scalars(select(CalculationRecord)).all()) == 0
            assert len(session.scalars(select(ComputeJobRecord)).all()) == 0


def test_resume_cannot_advance_waiting_for_approval_run(api):
    client, _, _ = api
    base, run, _, _, _ = waiting_h2(api)
    resp = client.post(f"{base}/ai/runs/{run['id']}/resume")
    # Resume on WAITING_FOR_APPROVAL is a safe no-op that leaves the run in WAITING_FOR_APPROVAL
    assert resp.status_code == 200
    assert resp.json()["status"] == "WAITING_FOR_APPROVAL"


# ---------------------------------------------------------------------------
# Priority 2: Result Recovery & Scientific Firewall
# ---------------------------------------------------------------------------


def test_transient_grounding_failure_retries_and_recovers_on_subsequent_poll(api, monkeypatch):
    """Transient I/O or network failures during artifact retrieval do not abort the run."""
    monkeypatch.setattr(calculation_completion, "TRANSIENT_RETRY_COOLDOWN_SECONDS", 0)
    client, sessions, settings = api
    base, run, _, conversation_id, _ = approved_h2(api)
    calc_id = run["waiting_calculation_id"]

    # Execute the PySCF compute job to completion
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b43-transient-worker",
        )

    # Verify calculation succeeded in gateway
    detail = client.get(f"{base}/calculations/{calc_id}").json()
    assert detail["calculation"]["state"] == "SUCCEEDED"

    # Simulate transient I/O failure on first poll
    call_count = {"count": 0}
    real_get_bytes = LocalObjectStore.get_bytes

    def transient_get_bytes(self, key, *args, **kwargs):
        call_count["count"] += 1
        if call_count["count"] == 1:
            raise TimeoutError("Simulated transient network timeout connecting to storage")
        return real_get_bytes(self, key, *args, **kwargs)

    monkeypatch.setattr(LocalObjectStore, "get_bytes", transient_get_bytes)

    # First reconciliation attempt: catches transient failure, records retryable event, returns 0
    reconciled_1 = reconcile(api)
    assert reconciled_1 == 0

    with sessions() as session:
        run_record = session.get(AIRunRecord, run["id"])
        assert run_record.status == "WAITING_FOR_CALCULATION", "Run must remain waiting for retry"
        transient_events = session.scalars(
            select(AIRunEventRecord).where(
                AIRunEventRecord.run_id == run["id"],
                AIRunEventRecord.event_type == "calculation.grounding_transient_failure",
            )
        ).all()
        assert len(transient_events) == 1
        assert transient_events[0].payload_json["attempt"] == 1
        assert transient_events[0].payload_json["retryable"] is True

    # Second reconciliation attempt: transient issue resolved, normal grounding succeeds!
    reconciled_2 = reconcile(api)
    assert reconciled_2 == 1

    final_run = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final_run["status"] == "SUCCEEDED"
    conversation = client.get(f"{base}/ai/conversations/{conversation_id}").json()
    last_msg = conversation["messages"][-1]
    assert "Authoritative energy:" in last_msg["content"]
    assert last_msg["evidence_status"] == "SUPPORTED"


def test_transient_grounding_failure_exhausts_and_fails_after_max_attempts(api, monkeypatch):
    """Persistent transient failures exhaust after 3 attempts and fail safely."""
    monkeypatch.setattr(calculation_completion, "TRANSIENT_RETRY_COOLDOWN_SECONDS", 0)
    client, sessions, settings = api
    base, run, _, conversation_id, _ = approved_h2(api)

    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b43-exhaust-worker",
        )

    # Simulate permanent storage I/O failures
    def failing_get_bytes(self, key, *args, **kwargs):
        raise OSError("Persistent hardware I/O read failure")

    monkeypatch.setattr(LocalObjectStore, "get_bytes", failing_get_bytes)

    # Attempt 1: remains waiting
    assert reconcile(api) == 0
    assert client.get(f"{base}/ai/runs/{run['id']}").json()["status"] == "WAITING_FOR_CALCULATION"

    # Attempt 2: remains waiting
    assert reconcile(api) == 0
    assert client.get(f"{base}/ai/runs/{run['id']}").json()["status"] == "WAITING_FOR_CALCULATION"

    # Attempt 3: exceeds MAX_TRANSIENT_GROUNDING_ATTEMPTS (3), fails deterministically
    assert reconcile(api) == 1
    final_run = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final_run["status"] == "FAILED"
    assert final_run.get("error_code") == "TRANSIENT_GROUNDING_EXHAUSTED"

    conversation = client.get(f"{base}/ai/conversations/{conversation_id}").json()
    last_msg = conversation["messages"][-1]
    assert "RESULT NOT AVAILABLE" in last_msg["content"]
    assert "Infrastructure retrieval failed after 3 attempts" in last_msg["content"]

    # Subsequent polls do nothing
    assert reconcile(api) == 0


def test_genuinely_invalid_scientific_evidence_fails_immediately_without_transient_retry(api):
    """Scientific Result Firewall: invalid evidence fails immediately without retrying."""
    client, sessions, settings = api
    base, run, _, conversation_id, _ = approved_h2(api)
    calc_id = run["waiting_calculation_id"]

    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b43-invalid-sci",
        )

    # Deliberately forge/corrupt producer software identity in the database
    with sessions() as session:
        session.execute(
            update(CalculationResultRecord)
            .where(CalculationResultRecord.calculation_id == calc_id)
            .values(producer_software_json={"name": "forged_engine", "version": "9.9.9"})
        )
        session.commit()

    # Reconcile immediately detects the scientific violation
    reconciled = reconcile(api)
    assert reconciled == 1

    final_run = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final_run["status"] == "FAILED"
    assert final_run.get("error_code") == "INSUFFICIENT_SCIENTIFIC_EVIDENCE"

    with sessions() as session:
        # Zero transient failure events logged
        transient_events = session.scalars(
            select(AIRunEventRecord).where(
                AIRunEventRecord.run_id == run["id"],
                AIRunEventRecord.event_type == "calculation.grounding_transient_failure",
            )
        ).all()
        assert len(transient_events) == 0

    conversation = client.get(f"{base}/ai/conversations/{conversation_id}").json()
    last_msg = conversation["messages"][-1]
    assert "RESULT NOT AVAILABLE" in last_msg["content"]
    assert "INSUFFICIENT SCIENTIFIC EVIDENCE" in last_msg["content"]


# ---------------------------------------------------------------------------
# Priority 3 & 4: Worker Reliability & Persistence
# ---------------------------------------------------------------------------


def test_commit_gap_recovery_backfills_missing_tool_result_step(api):
    """Crash between queue creation and API step/waiting write is recovered with clean lineage."""
    client, sessions, settings = api
    base, run, _, _, _ = approved_h2(api)
    calc_id = run["waiting_calculation_id"]

    # Simulate API crash right after calculation commit:
    # Delete the TOOL_RESULT step and put run back in EXECUTING with waiting_calculation_id = None
    with sessions() as session:
        step = session.scalar(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run["id"],
                AIRunStepRecord.step_type == "TOOL_RESULT",
                AIRunStepRecord.tool_name == "calculation.submit",
            )
        )
        if step:
            session.delete(step)
        run_record = session.get(AIRunRecord, run["id"])
        run_record.status = "EXECUTING"
        run_record.waiting_calculation_id = None
        session.commit()

    # First reconcile run triggers _recover_submitted_runs
    reconciled = reconcile(api)
    assert reconciled == 0  # recovered submission, calculation not yet done

    recovered_run = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert recovered_run["status"] == "WAITING_FOR_CALCULATION"
    assert recovered_run["waiting_calculation_id"] == calc_id

    # Verify TOOL_RESULT step was backfilled
    with sessions() as session:
        steps = session.scalars(
            select(AIRunStepRecord)
            .where(AIRunStepRecord.run_id == run["id"])
            .order_by(AIRunStepRecord.step_number)
        ).all()
        tool_step = next(
            (
                s
                for s in steps
                if s.step_type == "TOOL_RESULT" and s.tool_name == "calculation.submit"
            ),
            None,
        )
        assert tool_step is not None
        assert "Recovered from commit gap" in tool_step.summary
        assert tool_step.tool_output_json["calculation"]["id"] == calc_id

    # Now let worker finish the job and verify complete end-to-end recovery
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b43-commit-gap-worker",
        )

    assert reconcile(api) == 1
    final_run = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final_run["status"] == "SUCCEEDED"


def test_duplicate_reconciliation_is_strictly_idempotent(api):
    _, sessions, settings = api
    _, run, _, _, _ = approved_h2(api)

    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b43-idempotence-worker",
        )

    # First reconcile publishes the result
    assert reconcile(api) == 1
    # Subsequent calls must be no-ops
    for _ in range(4):
        assert reconcile(api) == 0

    with sessions() as session:
        steps = session.scalars(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run["id"],
                AIRunStepRecord.step_type == "CALCULATION_COMPLETION",
            )
        ).all()
        assert len(steps) == 1, "Exactly one completion step may exist"
        messages = session.scalars(
            select(AIMessageRecord).where(
                AIMessageRecord.run_id == run["id"],
                AIMessageRecord.evidence_status == "SUPPORTED",
            )
        ).all()
        assert len(messages) == 1, "Exactly one scientific message may be published"


def test_stale_worker_fenced_on_epoch_bump(api):
    client, sessions, settings = api
    project = _create_project(client, "B4.3 epoch bump")
    conv = client.post(
        f"/v1/projects/{project['id']}/ai/conversations", json={"title": "epoch"}
    ).json()["conversation"]

    with sessions() as session:
        events = AIRunEventManager(session)
        manager = AIRunExecutionManager(session, events)

        run = AIRunRecord(
            id=str(uuid.uuid4()),
            project_id=project["id"],
            actor_id=settings.dev_user_id,
            conversation_id=conv["id"],
            status="PLANNING",
            fencing_epoch=1,
            state_version=1,
            budget_json={},
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        session.add(run)
        session.commit()

        # Transition with matching epoch 1 succeeds and bumps state_version
        manager.transition(
            run.project_id,
            run.id,
            1,
            "EXECUTING",
            from_states=("PLANNING",),
            event=("worker.started", "Started execution", {}),
        )
        session.refresh(run)
        assert run.status == "EXECUTING"
        assert run.state_version == 2
        assert run.fencing_epoch == 1

        # Simulate a control operation (like cancel or epoch bump) that bumps fencing_epoch
        session.execute(
            update(AIRunRecord).where(AIRunRecord.id == run.id).values(fencing_epoch=2)
        )
        session.commit()

        # Worker presenting stale epoch 1 is rejected by CAS fence
        with pytest.raises(StaleWorkerFencedError) as exc_info:
            manager.transition(
                run.project_id,
                run.id,
                1,
                "SUCCEEDED",
                from_states=("EXECUTING",),
                event=("worker.stale", "Stale write", {}),
            )
        assert exc_info.value.code == "STALE_WORKER_FENCED"

        # Verify state was not modified by the stale worker
        session.refresh(run)
        assert run.status == "EXECUTING"
        assert run.fencing_epoch == 2


# ---------------------------------------------------------------------------
# Priority 5: PostgreSQL Concurrency Verification (Isolated Disposable DB)
# ---------------------------------------------------------------------------


def test_postgresql_isolated_concurrent_fenced_transitions():
    """Verify CAS state transitions and fencing under PostgreSQL MVCC/row locking."""
    pg_host = os.environ.get("CHEMDFT_TEST_PG_HOST", "localhost")
    pg_port = os.environ.get("CHEMDFT_TEST_PG_PORT", "5432")
    admin_url = f"postgresql+psycopg://{pg_host}:{pg_port}/postgres"

    try:
        admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with admin_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip(
            f"PostgreSQL not accessible on {pg_host}:{pg_port}; skipping PG concurrency test."
        )

    test_db = f"chemdft_test_b43_concurrency_{uuid.uuid4().hex[:8]}"
    with admin_engine.connect() as conn:
        conn.execute(text(f"CREATE DATABASE {test_db}"))
        conn.execute(text(f"ALTER DATABASE {test_db} SET timezone TO 'Asia/Baku'"))  # not UTC

    test_url = f"postgresql+psycopg://{pg_host}:{pg_port}/{test_db}"
    test_engine = create_application_engine(test_url, pool_size=10, max_overflow=5)
    test_sessions = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)

    try:
        # Create all tables in topological order, skipping pgvector-dependent knowledge_embeddings
        for table in Base.metadata.sorted_tables:
            if table.name == "knowledge_embeddings":
                continue
            table.create(test_engine)

        user_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        project_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        conv_id = str(uuid.uuid4())

        with test_sessions() as session:
            session.add(Organization(id=org_id, name="PG Org"))
            session.add(User(id=user_id, email="pg_test@chemdft.local", display_name="PG Tester"))
            session.flush()

            session.add(
                Project(
                    id=project_id,
                    organization_id=org_id,
                    name="PG Concurrency Test",
                    slug="pg-concurrency",
                    created_by=user_id,
                )
            )
            session.flush()

            session.add(
                ProjectMember(project_id=project_id, user_id=user_id, role="owner")
            )
            session.add(
                AIConversationRecord(
                    id=conv_id,
                    project_id=project_id,
                    created_by=user_id,
                    title="Test",
                    created_at=utc_now(),
                )
            )
            session.flush()

            session.add(
                AIRunRecord(
                    id=run_id,
                    project_id=project_id,
                    actor_id=user_id,
                    conversation_id=conv_id,
                    status="WAITING_FOR_APPROVAL",
                    fencing_epoch=1,
                    state_version=1,
                    budget_json={},
                    created_at=utc_now(),
                    updated_at=utc_now(),
                )
            )
            session.commit()

        # Race 8 threads all trying to transition from WAITING_FOR_APPROVAL using epoch 1
        def attempt_transition(worker_idx: int) -> tuple[int, bool]:
            with test_sessions() as session:
                events = AIRunEventManager(session)
                manager = AIRunExecutionManager(session, events)
                target = "SUCCEEDED" if worker_idx % 2 == 0 else "CANCELED"
                try:
                    manager.transition(
                        project_id,
                        run_id,
                        1,  # All present epoch 1
                        target,
                        from_states=("WAITING_FOR_APPROVAL",),
                        event=(f"worker.{worker_idx}", f"Worker {worker_idx} transition", {}),
                    )
                    return worker_idx, True
                except StaleWorkerFencedError:
                    return worker_idx, False

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt_transition, range(8)))

        successes = [idx for idx, ok in results if ok]
        failures = [idx for idx, ok in results if not ok]

        assert len(successes) == 1, f"Exactly one transition must succeed, got {successes}"
        assert len(failures) == 7, f"All 7 other workers must be fenced, got {failures}"

        with test_sessions() as session:
            final_run = session.get(AIRunRecord, run_id)
            assert final_run.status in ("SUCCEEDED", "CANCELED")
            assert final_run.fencing_epoch == 1
            assert final_run.state_version == 2

    finally:
        test_engine.dispose()
        with admin_engine.connect() as conn:
            conn.execute(
                text(
                    f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    f"WHERE datname = '{test_db}' AND pid <> pg_backend_pid()"
                )
            )
            conn.execute(text(f"DROP DATABASE {test_db}"))
        admin_engine.dispose()
