"""Offline accounting fixtures: no model network calls or scientific execution."""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from chemdft_api.context import Identity
from chemdft_api.errors import InvalidLifecycleTransition, ScientificValidationFailed
from chemdft_api.investigation_models import InvestigationRecord, InvestigationStepRecord
from chemdft_api.investigation_service import InvestigationService
from chemdft_api.models import new_id, utc_now
from chemdft_api.scientific_models import ComputeExecutionRecord
from sqlalchemy import event, select
from test_batch_b43_review_pg import pg_api  # noqa: F401 -- disposable PostgreSQL fixture
from test_investigations import _energy_args, _make_structure, _project


@pytest.fixture(params=["api", "pg_api"])
def accounting_api(request):
    return request.getfixturevalue(request.param)


def _investigation(api):
    client, _, _ = api
    pid = _project(client)["id"]
    iid = client.post(
        f"/v1/projects/{pid}/investigations",
        json={
            "title": "Accounting fixture",
            "objective": "Accounting only",
        },
    ).json()["id"]
    return pid, iid


def _service(session, settings):
    return InvestigationService(
        session, Identity(settings.dev_user_id, settings.dev_organization_id)
    )


def test_overlapping_budget_updates_preserve_both_amounts(accounting_api):
    _, sessions, settings = accounting_api
    pid, iid = _investigation(accounting_api)
    engine = sessions.kw["bind"]
    barrier = threading.Barrier(2)
    local = threading.local()

    def before_write(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("UPDATE investigations SET budget_json") and not getattr(
            local, "seen", False
        ):
            local.seen = True
            barrier.wait(timeout=15)

    event.listen(engine, "before_cursor_execute", before_write)
    try:

        def add(amount):
            with sessions() as session:
                # Each participant holds its own stale ORM snapshot too.
                session.get(InvestigationRecord, iid)

                def mutate(budget):
                    budget["compute_actual_minor_units"] = (
                        int(budget.get("compute_actual_minor_units", 0)) + amount
                    )

                _service(session, settings)._update_budget(pid, iid, mutate)

        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(add, [100, 200]))
    finally:
        event.remove(engine, "before_cursor_execute", before_write)
    with sessions() as session:
        assert (
            session.get(InvestigationRecord, iid).budget_json["compute_actual_minor_units"] == 300
        )


def test_api_resume_does_not_compete_with_worker(api, monkeypatch):
    client, sessions, settings = api
    pid, iid = _investigation(api)
    with sessions() as session:
        row = session.get(InvestigationRecord, iid)
        row.status = "ACTIVE"
        row.lease_owner = "worker-token"
        row.lease_expires_at = utc_now() + timedelta(minutes=1)
        session.commit()
    monkeypatch.setattr(
        InvestigationService, "_evaluate_decision", lambda *a, **k: pytest.fail("API raced worker")
    )
    assert client.post(f"/v1/projects/{pid}/investigations/{iid}/resume").status_code == 200
    with sessions() as session:
        svc = _service(session, settings)
        svc._active_worker_id = "old-worker"
        with pytest.raises(InvalidLifecycleTransition, match="stale"):
            svc._update_budget(pid, iid, lambda b: b.update(ai_calls_used=99))
        assert session.get(InvestigationRecord, iid).budget_json["ai_calls_used"] == 0


def test_expired_worker_cannot_heartbeat_or_write(api):
    _, sessions, settings = api
    pid, iid = _investigation(api)
    with sessions() as session:
        row = session.get(InvestigationRecord, iid)
        row.status = "ACTIVE"
        row.lease_owner = "expired"
        row.lease_expires_at = utc_now() - timedelta(seconds=1)
        session.commit()
        svc = _service(session, settings)
        assert not svc.heartbeat(pid, iid, "expired")
        svc._active_worker_id = "expired"
        with pytest.raises(InvalidLifecycleTransition):
            svc._update_budget(pid, iid, lambda b: b.update(ai_calls_used=99))


@pytest.mark.parametrize("already_used", [0, 1])
def test_ai_call_limit_reserved_durably_before_model_call(api, already_used):
    from chemdft_api.ai.gateway import ModelResponse, ModelUsage
    from chemdft_api.composition import get_object_store_for_settings

    _, sessions, settings = api
    pid, iid = _investigation(api)
    calls = []

    class OfflineDecisionGateway:
        def generate(self, request):
            calls.append(request)
            with sessions() as observer:
                assert observer.get(InvestigationRecord, iid).budget_json["ai_calls_used"] == 1
            return ModelResponse(
                content=(
                    '{"decision":"INCONCLUSIVE",'
                    '"rationale_summary":"Offline accounting fixture"}'
                ),
                provider="fake",
                model_identifier="fake-standard",
                usage=ModelUsage(10, 5, 1),
            )

    with sessions() as session:
        row = session.get(InvestigationRecord, iid)
        row.status = "ACTIVE"
        row.policy_json = {**row.policy_json, "max_ai_calls": 1}
        row.budget_json = {**row.budget_json, "ai_calls_used": already_used}
        session.commit()
        svc = InvestigationService(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            get_object_store_for_settings(settings),
            settings,
            OfflineDecisionGateway(),
        )
        svc._evaluate_decision(pid, row)
    assert len(calls) == 1 - already_used
    with sessions() as session:
        assert session.get(InvestigationRecord, iid).budget_json["ai_calls_used"] == 1


@pytest.mark.parametrize("old_owner", ["old-token", None])
def test_stale_worker_cannot_commit_after_successor_claim(accounting_api, old_owner):
    _, sessions, settings = accounting_api
    pid, iid = _investigation(accounting_api)
    with sessions() as session:
        row = session.get(InvestigationRecord, iid)
        row.status = "ACTIVE"
        row.lease_owner = old_owner
        row.lease_expires_at = utc_now() + timedelta(minutes=1)
        session.commit()
    with sessions() as old, sessions() as successor:
        old_row = old.get(InvestigationRecord, iid)
        svc = _service(old, settings)
        svc._active_worker_id = old_owner
        new_row = successor.get(InvestigationRecord, iid)
        new_row.lease_owner = "new-token"
        successor.commit()
        old_row.status = "COMPLETED"
        with pytest.raises(InvalidLifecycleTransition, match="stale"):
            svc._commit_worker(pid, iid)
    with sessions() as session:
        assert session.get(InvestigationRecord, iid).status == "ACTIVE"
        assert session.get(InvestigationRecord, iid).lease_owner == "new-token"


def test_overlapping_reservations_enforce_ceiling(accounting_api):
    _, sessions, settings = accounting_api
    pid, iid = _investigation(accounting_api)
    with sessions() as session:
        row = session.get(InvestigationRecord, iid)
        row.policy_json = {**row.policy_json, "max_compute_minor_units": 250}
        session.commit()
    barrier = threading.Barrier(2)
    local = threading.local()
    engine = sessions.kw["bind"]

    def before_write(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("UPDATE investigations SET budget_json") and not getattr(
            local, "seen", False
        ):
            local.seen = True
            barrier.wait(timeout=15)

    def reserve(amount):
        from types import SimpleNamespace

        with sessions() as session:
            svc = _service(session, settings)
            row = session.get(InvestigationRecord, iid)
            try:
                svc._reserve_compute(pid, row, SimpleNamespace(id=new_id()), amount)
                return True
            except ScientificValidationFailed:
                session.rollback()
                return False

    event.listen(engine, "before_cursor_execute", before_write)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(reserve, [100, 200]))
    finally:
        event.remove(engine, "before_cursor_execute", before_write)
    assert sorted(outcomes) == [False, True]
    with sessions() as session:
        budget = session.get(InvestigationRecord, iid).budget_json
        assert budget["compute_reserved_minor_units"] in (100, 200)
        assert budget["calculations_used"] == 1


def _queued_calculation(api):
    client, sessions, _settings = api
    pid, iid = _investigation(api)
    version = _make_structure(client, pid, "cost-fixture")
    args = _energy_args(pid, version, idem_key=str(uuid4()))
    base = f"/v1/projects/{pid}/investigations/{iid}"
    client.post(
        base + "/plans",
        json={
            "steps": [
                {
                    "action": "calculation.submit",
                    "intent": "Queue only, no execution",
                    "approval_class": "EXPENSIVE",
                    "tool_arguments": args,
                }
            ]
        },
    )
    waiting = client.post(base + "/start").json()
    approved = client.post(
        base + f"/approvals/{waiting['pending_approval_id']}/decision", json={"decision": "APPROVE"}
    )
    assert approved.status_code == 200, approved.text
    with sessions() as session:
        step = session.scalar(
            select(InvestigationStepRecord).where(InvestigationStepRecord.project_id == pid)
        )
        return pid, iid, step.id, dict(step.result_ref_json)


def _execution(pid, refs, amount, state="FAILED", currency="USD"):
    return ComputeExecutionRecord(
        id=new_id(),
        project_id=pid,
        job_id=refs["compute_job_id"],
        calculation_id=refs["calculation_id"],
        provider="local",
        state=state,
        authorization_hash="a" * 64,
        authorization_expires_at=utc_now() + timedelta(hours=1),
        actual_cost_json=None if amount is None else {"currency": currency, "minor_units": amount},
    )


def test_all_attempts_failed_canceled_late_corrected_and_no_double_counting(api):
    client, sessions, settings = api
    pid, iid, step_id, refs = _queued_calculation(api)
    with sessions() as session:
        first = _execution(pid, refs, 100, "FAILED")
        second = _execution(pid, refs, 200, "CANCELED")
        session.add_all([first, second])
        session.get(InvestigationStepRecord, step_id).status = "FAILED"
        session.get(InvestigationRecord, iid).status = "COMPLETED"
        session.commit()
        first_id = first.id
        svc = _service(session, settings)
        snapshot = svc._compute_cost_snapshot(pid, iid)
        assert snapshot["compute_actual_minor_units"] == 300
        assert svc._compute_cost_snapshot(pid, iid) == snapshot
        session.get(ComputeExecutionRecord, first_id).actual_cost_json = {
            "currency": "USD",
            "minor_units": 150,
        }
        session.commit()
    # Terminal GETs still see corrections and newly arrived metering.
    base = f"/v1/projects/{pid}/investigations/{iid}"
    assert client.get(base).json()["budget"]["compute_actual_minor_units"] == 350
    with sessions() as session:
        third = _execution(pid, refs, None)
        session.add(third)
        session.commit()
        third_id = third.id
    budget = client.get(base).json()["budget"]
    assert budget["compute_actual_minor_units"] is None
    assert budget["compute_known_actual_minor_units"] == 350
    assert not budget["compute_usage_complete"]
    with sessions() as session:
        session.get(ComputeExecutionRecord, third_id).actual_cost_json = {
            "currency": "USD",
            "minor_units": 50,
        }
        session.commit()
    budget = client.get(base).json()["budget"]
    assert budget["compute_actual_minor_units"] == 400
    assert budget["compute_reserved_minor_units"] == 0  # local estimate, separate from actual


@pytest.mark.parametrize("amount,currency", [(100, "EUR"), (-1, "USD"), (True, "USD")])
def test_invalid_metering_never_becomes_usd_spend(api, amount, currency):
    _, sessions, settings = api
    pid, iid, _, refs = _queued_calculation(api)
    with sessions() as session:
        session.add(_execution(pid, refs, amount, currency=currency))
        session.commit()
        with pytest.raises(ScientificValidationFailed, match="cost or currency"):
            _service(session, settings)._compute_cost_snapshot(pid, iid)
