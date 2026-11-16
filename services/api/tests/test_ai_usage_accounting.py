"""Disposable SQLite/PostgreSQL accounting tests; no provider/scientific calls."""

import importlib.util
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from chemdft_api.ai.budgets import AIBudgetExceededError
from chemdft_api.ai.gateway import ModelMessage, ModelRequest, ModelResponse, ModelUsage
from chemdft_api.ai.usage_accounting import finish_invocation, reserve_invocation
from chemdft_api.ai_models import AIConversationRecord, AIModelInvocationRecord, AIRunRecord
from chemdft_api.billing_models import AIUsageLedgerEntryRecord
from chemdft_api.billing_service import BillingService
from chemdft_api.context import Identity
from chemdft_api.errors import InvalidLifecycleTransition
from chemdft_api.investigation_models import InvestigationRecord
from chemdft_api.investigation_service import InvestigationService
from chemdft_api.models import new_id, utc_now
from sqlalchemy import event, func, select, text
from test_batch_b43_review_pg import pg_api  # noqa: F401
from test_investigation_accounting import _investigation


@pytest.fixture(params=["api", "pg_api"])
def usage_api(request):
    return request.getfixturevalue(request.param)


def _identity(settings):
    return Identity(settings.dev_user_id, settings.dev_organization_id)


def _run(session, settings, pid, iid=None):
    conv = AIConversationRecord(id=new_id(), project_id=pid, created_by=settings.dev_user_id)
    run = AIRunRecord(
        id=new_id(),
        project_id=pid,
        conversation_id=conv.id,
        actor_id=settings.dev_user_id,
        status="SUCCEEDED",
        investigation_id=iid,
    )
    session.add_all([conv, run])
    session.flush()
    return run


def _service(session, settings, iid):
    svc = InvestigationService(session, _identity(settings), settings=settings)
    svc._decision_investigation = session.get(InvestigationRecord, iid)
    svc._decision_human = _identity(settings)
    return svc


def _request():
    return ModelRequest(
        system_prompt="Offline bookkeeping",
        messages=(ModelMessage(role="user", content="Bookkeeping fixture"),),
    )


STATE = SimpleNamespace(provider="fake", model="fake-standard", mode="MANAGED")


def _response(input_count=15, output_count=5):
    return ModelResponse(
        content="offline",
        usage=ModelUsage(input_count, output_count, 1),
        provider="fake",
        model_identifier="fake-standard",
    )


@pytest.mark.parametrize(
    "counts",
    [None, {"input_tokens": 12}, {"output_tokens": 4}, {"input_tokens": 0, "output_tokens": 0}],
)
def test_observations_unknown_partial_zero_and_platform_charges(usage_api, counts):
    _, sessions, settings = usage_api
    pid, _ = _investigation(usage_api)
    with sessions() as session:
        run = _run(session, settings, pid)
        receipt = reserve_invocation(
            session,
            project_id=pid,
            run_id=run.id,
            provider="fake",
            model="fake-standard",
            mode="BYOK",
            prompt_version="OFFLINE",
        )
        session.commit()
        response = ModelResponse(content="offline", reported_usage=counts)
        row, changed, _ = finish_invocation(
            session, _identity(settings), settings, receipt.id, response
        )
        assert changed
        reported = counts is not None and {"input_tokens", "output_tokens"} <= counts.keys()
        assert row.usage_status == ("REPORTED" if reported else "UNKNOWN")
        assert row.input_tokens == (counts or {}).get("input_tokens")
        assert row.output_tokens == (counts or {}).get("output_tokens")
        ledger = session.scalar(select(AIUsageLedgerEntryRecord))
        assert ledger.cached_tokens is None
        assert ledger.provider_cost_minor_units is None
        assert ledger.billable_minor_units == 0
        summary = BillingService(session, _identity(settings), settings)._ai_summary(
            [ledger], "USD"
        )
        assert summary.billable.minor_units == 0  # confirmed platform no-charge, not provider cost
        assert summary.provider_cost is None
        assert summary.input_tokens == (counts or {}).get("input_tokens")
        assert summary.output_tokens == (counts or {}).get("output_tokens")
        assert summary.byok_entries == 1
        assert (
            finish_invocation(session, _identity(settings), settings, receipt.id, response)[1]
            is False
        )
        assert session.scalar(select(func.count()).select_from(AIUsageLedgerEntryRecord)) == 1


def test_reservation_settlement_duplicate_crash_and_late_response(usage_api, monkeypatch):
    _, sessions, settings = usage_api
    _pid, iid = _investigation(usage_api)
    with sessions() as session:
        inv = session.get(InvestigationRecord, iid)
        inv.status = "ACTIVE"
        session.commit()
        svc = _service(session, settings, iid)
        _, first_id = svc._reserve_ai_invocation(_request(), STATE)
        reserved = dict(session.get(InvestigationRecord, iid).budget_json["ai_reservation"])
        real_update = svc._update_budget
        with monkeypatch.context() as m:
            m.setattr(
                svc,
                "_update_budget",
                lambda *a, **k: (_ for _ in ()).throw(RuntimeError("crash before budget commit")),
            )
            with pytest.raises(RuntimeError):
                svc._settle_ai_invocation(first_id, _response())
            session.rollback()
        assert session.get(AIModelInvocationRecord, first_id).status == "RESERVED"
        assert session.scalar(select(func.count()).select_from(AIUsageLedgerEntryRecord)) == 0
        assert svc._update_budget == real_update
        # Simulate expiry after a crash, without inventing observations.
        inv = session.get(InvestigationRecord, iid)
        budget = dict(inv.budget_json)
        budget["ai_reservation"] = {
            **budget["ai_reservation"],
            "expires_at": (utc_now() - timedelta(seconds=1)).isoformat(),
        }
        inv.budget_json = budget
        session.commit()
        assert svc._recover_ai_reservation(inv)
        assert session.get(AIModelInvocationRecord, first_id).input_tokens is None
        assert (
            session.get(InvestigationRecord, iid).budget_json["ai_token_budget"][
                "input_tokens_used"
            ]
            == reserved["input_tokens"]
        )
        _, second_id = svc._reserve_ai_invocation(_request(), STATE)
        # Late old response records observations but leaves the new slot intact.
        svc._settle_ai_invocation(first_id, _response())
        assert (
            session.get(InvestigationRecord, iid).budget_json["ai_reservation"]["invocation_id"]
            == second_id
        )
        svc._settle_ai_invocation(first_id, _response())
        svc._settle_ai_invocation(second_id, _response(0, 0))
        svc._settle_ai_invocation(second_id, _response(0, 0))
        budget = session.get(InvestigationRecord, iid).budget_json
        assert budget["ai_calls_used"] == 2
        assert budget["ai_token_budget"]["model_calls_used"] == 2
        assert budget["ai_token_budget"]["input_tokens_used"] == reserved["input_tokens"]
        ledgers = session.scalars(select(AIUsageLedgerEntryRecord)).all()
        assert len(ledgers) == 3  # old unknown, append-only report, new zero report
        summary = BillingService(session, _identity(settings), settings)._ai_summary(ledgers, "USD")
        assert summary.input_tokens == 15
        assert summary.output_tokens == 5
        assert summary.reported_entries == 2
        assert summary.unknown_entries == 0
        assert summary.billable.minor_units == 0


def test_concurrent_investigation_reservations_allow_one_dispatch(usage_api):
    _, sessions, settings = usage_api
    pid, iid = _investigation(usage_api)
    with sessions() as session:
        inv = session.get(InvestigationRecord, iid)
        inv.status = "ACTIVE"
        inv.policy_json = {**inv.policy_json, "max_ai_calls": 2}
        _run(session, settings, pid, iid)
        BillingService(session, _identity(settings), settings)._account()
        session.commit()
    barrier = threading.Barrier(2)
    local = threading.local()
    engine = sessions.kw["bind"]

    def overlap(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("SELECT investigations.budget_json") and not getattr(
            local, "seen", False
        ):
            local.seen = True
            barrier.wait(timeout=15)

    def reserve(_):
        with sessions() as session:
            svc = _service(session, settings, iid)
            try:
                return svc._reserve_ai_invocation(_request(), STATE)[1]
            except InvalidLifecycleTransition:
                session.rollback()
                return None

    event.listen(engine, "before_cursor_execute", overlap)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(reserve, range(2)))
    finally:
        event.remove(engine, "before_cursor_execute", overlap)
    assert sum(result is not None for result in results) == 1
    with sessions() as session:
        assert session.get(InvestigationRecord, iid).budget_json["ai_calls_used"] == 1
        assert session.scalar(select(func.count()).select_from(AIModelInvocationRecord)) == 1


def test_partial_observations_and_late_reports_do_not_undercharge_quota(usage_api):
    _, sessions, settings = usage_api
    _pid, iid = _investigation(usage_api)
    with sessions() as session:
        session.get(InvestigationRecord, iid).status = "ACTIVE"
        session.commit()
        svc = _service(session, settings, iid)
        _, receipt_id = svc._reserve_ai_invocation(_request(), STATE)
        # Reported input exceeds the input estimate; output remains unknown.
        partial = ModelResponse(content="offline", reported_usage={"input_tokens": 3000})
        svc._settle_ai_invocation(receipt_id, partial)
        assert session.get(AIModelInvocationRecord, receipt_id).output_tokens is None
        assert (
            session.get(InvestigationRecord, iid).budget_json["ai_token_budget"][
                "input_tokens_used"
            ]
            == 3000
        )
        later = ModelResponse(content="offline", reported_usage={"output_tokens": 5})
        svc._settle_ai_invocation(receipt_id, later)
        svc._settle_ai_invocation(receipt_id, later)
        budget = session.get(InvestigationRecord, iid).budget_json["ai_token_budget"]
        assert budget["input_tokens_used"] == 3000
        assert budget["model_calls_used"] == 1
        summary = BillingService(session, _identity(settings), settings)._ai_summary(
            session.scalars(select(AIUsageLedgerEntryRecord)).all(), "USD"
        )
        assert summary.input_tokens == 3000 and summary.output_tokens == 5
        assert summary.reported_entries == 1


def test_ai_scientist_late_settlement_cannot_consume_a_successor_slot(usage_api):
    from chemdft_api.ai.events import AIRunEventManager
    from chemdft_api.ai.execution import AIRunExecutionManager

    _, sessions, settings = usage_api
    pid, _ = _investigation(usage_api)
    with sessions() as session:
        run = _run(session, settings, pid)
        run.status = "PLANNING"
        session.commit()
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        first = manager.reserve_model_call(pid, run.id, 1, 100, 50)
        manager.claim_execution(pid, run.id)
        second = manager.reserve_model_call(pid, run.id, 1, 100, 50)
        manager.settle_model_usage(pid, run.id, 10, 5, reservation_id=first.reservation_id)
        manager.settle_uncertain_usage(pid, run.id, reservation_id=first.reservation_id)
        session.refresh(run)
        assert run.budget_json["reservation_id"] == second.reservation_id
        assert run.budget_json["model_call_in_flight"]
        assert run.budget_json["input_tokens_used"] == 100
        assert run.budget_json["model_calls_used"] == 1


def test_ai_scientist_receipt_recovery_gap_and_atomic_settlement(usage_api, monkeypatch):
    from chemdft_api.ai.service import AIScientistService
    from chemdft_api.storage import LocalObjectStore

    _, sessions, settings = usage_api
    pid, _ = _investigation(usage_api)
    with sessions() as session:
        run = _run(session, settings, pid)
        run.status = "PLANNING"
        session.commit()
        svc = AIScientistService(
            session, _identity(settings), LocalObjectStore(settings.object_root), settings
        )
        first = svc._execution_manager.reserve_model_call(pid, run.id, 1, 100, 50)
        svc._usage_reservation_id = first.reservation_id
        svc._begin_model_usage(pid, run.id, STATE)
        first_id = svc._pending_invocation_id
        receipt = session.get(AIModelInvocationRecord, first_id)
        assert receipt.reservation_json["input_tokens"] == 100
        assert receipt.reservation_json["output_tokens"] == 50
        with monkeypatch.context() as patch:
            patch.setattr(
                svc._execution_manager,
                "settle_model_usage",
                lambda *a, **k: (_ for _ in ()).throw(RuntimeError("settlement crash")),
            )
            with pytest.raises(RuntimeError, match="settlement crash"):
                svc._record_model_usage(pid, run.id, _response(), "OFFLINE")
            session.rollback()
        assert session.get(AIModelInvocationRecord, first_id).status == "RESERVED"
        assert session.scalar(select(func.count()).select_from(AIUsageLedgerEntryRecord)) == 0
        # Crash after durable budget recovery but before receipt recovery.
        svc._execution_manager.claim_execution(pid, run.id)
        second = svc._execution_manager.reserve_model_call(pid, run.id, 1, 100, 50)
        svc._record_model_usage(pid, run.id, _response(3000, 5), "OFFLINE")
        svc._record_model_usage(pid, run.id, _response(3000, 5), "OFFLINE")
        session.refresh(run)
        assert run.budget_json["reservation_id"] == second.reservation_id
        assert run.budget_json["model_call_in_flight"]
        assert run.budget_json["input_tokens_used"] == 3000
        assert run.budget_json["output_tokens_used"] == 50
        assert run.budget_json["model_calls_used"] == 1
        receipt = session.get(AIModelInvocationRecord, first_id)
        assert receipt.usage_status == "REPORTED"
        assert (receipt.input_tokens, receipt.output_tokens) == (3000, 5)
        entries = session.scalars(select(AIUsageLedgerEntryRecord)).all()
        assert len(entries) == 2
        summary = BillingService(session, _identity(settings), settings)._ai_summary(entries, "USD")
        assert summary.input_tokens == 3000 and summary.output_tokens == 5
        assert summary.billable.minor_units == 0


def test_usage_reports_remain_in_the_original_billing_period(usage_api):
    _, sessions, settings = usage_api
    pid, _ = _investigation(usage_api)
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
        assert receipt.reservation_json["billing_period_start"]
        past_start = utc_now() - timedelta(days=60)
        past_end = past_start + timedelta(days=30)
        receipt.reservation_json = {
            **receipt.reservation_json,
            "billing_period_start": past_start.isoformat(),
            "billing_period_end": past_end.isoformat(),
        }
        session.commit()
        finish_invocation(session, identity, settings, receipt.id)
        finish_invocation(session, identity, settings, receipt.id, _response())
        entries = session.scalars(select(AIUsageLedgerEntryRecord)).all()
        assert len(entries) == 2
        assert entries[0].period_start == entries[1].period_start
        assert entries[0].period_end == entries[1].period_end
        assert entries[0].period_start.date() == past_start.date()
        summary = BillingService(session, identity, settings)._ai_summary(entries, "USD")
        assert summary.input_tokens == 15 and summary.output_tokens == 5
        assert summary.byok_entries == 1


@pytest.mark.parametrize("exhausted", ["input", "output"])
def test_unknown_usage_keeps_authorized_token_ceiling(usage_api, exhausted):
    _, sessions, settings = usage_api
    _pid, iid = _investigation(usage_api)
    with sessions() as session:
        inv = session.get(InvestigationRecord, iid)
        inv.status = "ACTIVE"
        inv.policy_json = {
            **inv.policy_json,
            "max_ai_input_tokens": 2048 if exhausted == "input" else 5000,
            "max_ai_output_tokens": 512 if exhausted == "output" else 12000,
        }
        session.commit()
        svc = _service(session, settings, iid)
        request, receipt_id = svc._reserve_ai_invocation(_request(), STATE)
        assert request.max_tokens <= inv.policy_json["max_ai_output_tokens"]
        svc._settle_ai_invocation(receipt_id, ModelResponse(content="offline"))
        with pytest.raises(AIBudgetExceededError):
            svc._reserve_ai_invocation(_request(), STATE)
        session.rollback()
        assert session.get(InvestigationRecord, iid).budget_json["ai_calls_used"] == 1
        assert session.get(AIModelInvocationRecord, receipt_id).input_tokens is None


def test_stale_worker_accounts_old_response_without_dispatching_again(usage_api):
    _, sessions, settings = usage_api
    _pid, iid = _investigation(usage_api)
    with sessions() as session:
        inv = session.get(InvestigationRecord, iid)
        inv.status = "ACTIVE"
        inv.lease_owner = "old-token"
        inv.lease_expires_at = utc_now() + timedelta(minutes=1)
        session.commit()
        old = _service(session, settings, iid)
        old._active_worker_id = "old-token"
        _, receipt_id = old._reserve_ai_invocation(_request(), STATE)
        with sessions() as successor:
            successor.get(InvestigationRecord, iid).lease_owner = "new-token"
            successor.commit()
        old._settle_ai_invocation(receipt_id, _response())
        with pytest.raises(InvalidLifecycleTransition, match="stale"):
            old._reserve_ai_invocation(_request(), STATE)
        session.rollback()
        assert session.get(AIModelInvocationRecord, receipt_id).usage_status == "REPORTED"
        assert session.get(InvestigationRecord, iid).lease_owner == "new-token"


def test_duplicate_billing_charge_and_pending_summary(usage_api):
    _, sessions, settings = usage_api
    pid, _ = _investigation(usage_api)
    with sessions() as session:
        run = _run(session, settings, pid)
        receipt = reserve_invocation(
            session,
            project_id=pid,
            run_id=run.id,
            provider="fake",
            model="fake-standard",
            mode="BYOK",
            prompt_version="OFFLINE",
        )
        session.commit()
        receipt_id = receipt.id
        billing = BillingService(session, _identity(settings), settings)
        snapshot = billing.snapshot()
        assert snapshot.ai_usage.pending_entries == 1
        assert snapshot.ai_usage.input_tokens is None
        assert snapshot.ai_usage.provider_cost is None
        assert snapshot.ai_usage.billable.minor_units == 0
    barrier = threading.Barrier(2)

    def charge(_):
        with sessions() as session:
            service = BillingService(session, _identity(settings), settings)
            barrier.wait(timeout=15)
            return service.record_ai_usage(
                project_id=pid,
                model_invocation_id=receipt_id,
                provider="fake",
                model="fake-standard",
                mode="BYOK",
                input_tokens=15,
                output_tokens=5,
                billable_minor_units=7,
            ).id

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(charge, range(2)))
    assert ids[0] == ids[1]
    with sessions() as session:
        snapshot = BillingService(session, _identity(settings), settings).snapshot()
        assert snapshot.ai_usage.billable.minor_units == 7
        assert snapshot.allowance.ai_consumed.minor_units == 7
        assert session.scalar(select(func.count()).select_from(AIUsageLedgerEntryRecord)) == 1


def _revision():
    path = Path(__file__).parents[1] / "migrations/versions/0028_ai_usage_status.py"
    spec = importlib.util.spec_from_file_location("ai_usage_revision", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_preserves_history_and_refuses_lossy_rollback(usage_api):
    _, sessions, settings = usage_api
    pid, _ = _investigation(usage_api)
    with sessions() as session:
        run = _run(session, settings, pid)
        historical = AIModelInvocationRecord(
            id=new_id(),
            project_id=pid,
            run_id=run.id,
            provider="fake",
            model="historical",
            prompt_version="LEGACY",
            input_tokens=0,
            output_tokens=7,
            latency_ms=1,
            status="SUCCEEDED",
            usage_status="LEGACY_UNSPECIFIED",
        )
        account = BillingService(session, _identity(settings), settings)._account()
        ledger = AIUsageLedgerEntryRecord(
            id=new_id(),
            billing_account_id=account.id,
            project_id=pid,
            model_invocation_id=historical.id,
            provider="fake",
            model="historical",
            mode="BYOK",
            input_tokens=0,
            output_tokens=7,
            cached_tokens=0,
            billable_minor_units=42,
            provider_cost_minor_units=11,
            currency="USD",
            period_start=utc_now(),
            period_end=utc_now() + timedelta(days=1),
            idempotency_key="historical-key",
            usage_status="LEGACY_UNSPECIFIED",
        )
        session.add_all([historical, ledger])
        session.commit()
        ids = historical.id, ledger.id
    engine = sessions.kw["bind"]
    revision = _revision()

    def rows(connection):
        return (
            connection.execute(
                text(
                    "SELECT id, project_id, run_id, input_tokens, output_tokens, latency_ms "
                    "FROM ai_model_invocations"
                )
            ).fetchall(),
            connection.execute(
                text(
                    "SELECT id, model_invocation_id, input_tokens, output_tokens, cached_tokens, "
                    "billable_minor_units, provider_cost_minor_units, idempotency_key "
                    "FROM ai_usage_ledger_entries"
                )
            ).fetchall(),
        )

    with engine.begin() as connection:
        before = rows(connection)
        with Operations.context(MigrationContext.configure(connection)):
            revision.downgrade()  # establish the genuine pre-0028 structure
            assert rows(connection) == before
            revision.upgrade()
            assert rows(connection) == before
            assert (
                connection.execute(text("SELECT usage_status FROM ai_model_invocations")).scalar()
                == "LEGACY_UNSPECIFIED"
            )
            assert (
                connection.execute(
                    text("SELECT usage_status FROM ai_usage_ledger_entries")
                ).scalar()
                == "LEGACY_UNSPECIFIED"
            )
            revision.downgrade()
            assert rows(connection) == before
            revision.upgrade()
    with sessions() as session:
        summary = BillingService(session, _identity(settings), settings)._ai_summary(
            session.scalars(select(AIUsageLedgerEntryRecord)).all(), "USD"
        )
        assert summary.input_tokens is None and summary.output_tokens is None
        assert summary.legacy_entries == 1
        assert summary.billable.minor_units == 42
        historical = session.get(AIModelInvocationRecord, ids[0])
        historical.status = "RESERVED"
        session.commit()
        assert not finish_invocation(
            session, _identity(settings), settings, historical.id, _response()
        )[1]
        assert historical.usage_status == "LEGACY_UNSPECIFIED"
        assert (historical.input_tokens, historical.output_tokens) == (0, 7)
        run = session.get(AIRunRecord, run.id)
        receipt = reserve_invocation(
            session,
            project_id=pid,
            run_id=run.id,
            provider="fake",
            model="fake-standard",
            mode="MANAGED",
            prompt_version="OFFLINE",
        )
        session.commit()
        finish_invocation(session, _identity(settings), settings, receipt.id)
    with engine.begin() as connection:
        all_before = rows(connection)
        with (
            Operations.context(MigrationContext.configure(connection)),
            pytest.raises(RuntimeError, match="nothing was changed"),
        ):
            revision.downgrade()
        assert rows(connection) == all_before
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM ai_usage_ledger_entries WHERE id=:id"), {"id": ids[1]}
            ).scalar()
            == 1
        )
