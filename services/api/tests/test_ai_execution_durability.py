# ruff: noqa: E501
"""Deterministic concurrency / crash / authorization tests for AI Scientist durable execution.

No test relies on sleeps for correctness: concurrent interleavings are forced with
``threading.Event``/``Barrier`` handshakes (sleep-free), and crashes are simulated by stopping the
worker at an exact commit boundary. The model is a scripted gateway, i.e. NOT a real provider.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from uuid import UUID, uuid4

import pytest
from chemdft_api.ai import molecule_tools as molecule_tools_module
from chemdft_api.ai import service as service_module
from chemdft_api.ai.action_receipts import ActionConflictError, begin_action
from chemdft_api.ai.budgets import AIBudgetInvalidError, AIRunBudget
from chemdft_api.ai.events import AIRunEventManager
from chemdft_api.ai.execution import (
    AIRunExecutionManager,
    RunControlInvalidStateError,
    StaleWorkerFencedError,
)
from chemdft_api.ai.gateway import ModelResponse, ModelToolCall, ModelUsage
from chemdft_api.ai.molecule_tools import draft_arguments_digest
from chemdft_api.ai.service import AIScientistService
from chemdft_api.ai_models import (
    AIActionReceiptRecord,
    AIConversationRecord,
    AIMessageRecord,
    AIModelInvocationRecord,
    AIRunEventRecord,
    AIRunRecord,
    AIRunStepRecord,
)
from chemdft_api.context import Identity
from chemdft_api.contracts.molecule_tools import MoleculeDraftCreateInput
from chemdft_api.contracts.tools import ToolErrorCode
from chemdft_api.errors import ApplicationError, ScientificReferenceNotFound
from chemdft_api.geometry_eligibility import CANDIDATE_FORMAT
from chemdft_api.models import ProjectMember, User, new_id
from chemdft_api.scientific_models import ProvenanceRecordRow, ScientificArtifactRecord
from chemdft_api.storage import LocalObjectStore
from chemdft_api.tool_registry.catalog import build_application_tool_registry
from chemdft_api.tool_registry.registry import (
    ExecutionBinding,
    ToolInvocationContext,
    ToolInvocationError,
)
from sqlalchemy import func, select
from test_ai_scientist import _create_project

WAIT = 30  # seconds; only a deadlock guard, never a synchronization mechanism


def _draft_call(name: str, smiles: str, key: str = "model-key-0001", call_id: str | None = None):
    return ModelToolCall(
        id=call_id or f"call_{uuid4().hex[:8]}",
        name="molecule.draft.create",
        arguments_json=json.dumps(
            {"name": name, "canonical_isomeric_smiles": smiles, "action_key": key}
        ),
    )


def _tool_response(*calls: ModelToolCall) -> ModelResponse:
    return ModelResponse(
        content="working",
        tool_calls=tuple(calls),
        usage=ModelUsage(input_tokens=100, output_tokens=20, latency_ms=1),
        model_identifier="fake-standard",
        provider="fake",
    )


def _final_response() -> ModelResponse:
    return ModelResponse(
        content="done",
        usage=ModelUsage(input_tokens=50, output_tokens=10, latency_ms=1),
        model_identifier="fake-standard",
        provider="fake",
    )


@dataclass
class ScriptedGateway:
    """Returns scripted responses; ``before[n]`` runs inside call n (may block)."""

    responses: list[ModelResponse]
    before: dict[int, object] = field(default_factory=dict)
    calls: int = 0

    def generate(self, request):
        index = self.calls
        self.calls += 1
        hook = self.before.get(index)
        if hook is not None:
            hook()
        return self.responses[min(index, len(self.responses) - 1)]


class Env:
    def __init__(self, api):
        self.client, self.sessions, self.settings = api
        self.project_id = _create_project(self.client, name=f"Durable {uuid4().hex[:6]}")["id"]
        self.store = LocalObjectStore(self.settings.object_root)
        self.identity = Identity(self.settings.dev_user_id, self.settings.dev_organization_id)
        conversation = self.client.post(
            f"/v1/projects/{self.project_id}/ai/conversations", json={"title": "durable"}
        ).json()["conversation"]
        self.conversation_id = conversation["id"]

    def service(self, session, gateway=None) -> AIScientistService:
        return AIScientistService(session, self.identity, self.store, self.settings, gateway)

    def make_run(self, *, status="PLANNING", budget=None, prompt="Please create methane.") -> str:
        with self.sessions() as session:
            session.add(
                AIMessageRecord(
                    project_id=self.project_id,
                    conversation_id=self.conversation_id,
                    role="user",
                    content=prompt,
                    citations_json=[],
                )
            )
            run = AIRunRecord(
                id=new_id(),
                project_id=self.project_id,
                conversation_id=self.conversation_id,
                actor_id=self.settings.dev_user_id,
                status=status,
                current_step=0,
                max_steps=10,
                budget_json=budget,
            )
            session.add(run)
            session.commit()
            return run.id

    def execute(self, run_id, gateway):
        """Run the orchestration loop for an existing run in a fresh session (a 'worker')."""
        with self.sessions() as session:
            service = self.service(session, gateway)
            run = session.get(AIRunRecord, run_id)
            conversation = session.get(AIConversationRecord, run.conversation_id)
            try:
                service._execute_run(self.project_id, conversation, run)
            except ApplicationError:
                raise

    def control(self, action: str, run_id: str):
        with self.sessions() as session:
            return getattr(self.service(session), f"{action}_run")(self.project_id, run_id)

    def resume(self, run_id: str, gateway):
        with self.sessions() as session:
            return self.service(session, gateway).resume_run(self.project_id, run_id)

    # --- observations -------------------------------------------------------------------
    def run_row(self, run_id) -> AIRunRecord:
        with self.sessions() as session:
            run = session.get(AIRunRecord, run_id)
            session.expunge(run)
            return run

    def candidates(self) -> int:
        with self.sessions() as session:
            return session.scalar(
                select(func.count())
                .select_from(ScientificArtifactRecord)
                .where(
                    ScientificArtifactRecord.project_id == self.project_id,
                    ScientificArtifactRecord.kind == "COORDINATES",
                    ScientificArtifactRecord.format_identifier == CANDIDATE_FORMAT,
                )
            )

    def event_types(self, run_id) -> list[str]:
        with self.sessions() as session:
            return list(
                session.scalars(
                    select(AIRunEventRecord.event_type)
                    .where(AIRunEventRecord.run_id == run_id)
                    .order_by(AIRunEventRecord.sequence)
                )
            )

    def receipts(self) -> list[AIActionReceiptRecord]:
        with self.sessions() as session:
            rows = session.scalars(
                select(AIActionReceiptRecord).where(
                    AIActionReceiptRecord.project_id == self.project_id
                )
            ).all()
            for row in rows:
                session.expunge(row)
            return list(rows)

    def tool_context(self, run_id, epoch, key, *, identity=None) -> ToolInvocationContext:
        return ToolInvocationContext(
            request_id=uuid4(),
            identity=identity or self.identity,
            project_id=UUID(self.project_id),
            capabilities=frozenset({"project.read", "project.write"}),
            approval_references=frozenset(),
            transport="test",
            execution=ExecutionBinding(run_id=run_id, epoch=epoch, action_key=key),
        )


@pytest.fixture
def env(api):
    return Env(api)


def _draft_args(name="methane", smiles="C", key="whatever-key"):
    return {"name": name, "canonical_isomeric_smiles": smiles, "action_key": key}


def _key(env: Env, name="methane", smiles="C", occurrence=0) -> str:
    from chemdft_api.ai.action_receipts import server_action_key

    digest = draft_arguments_digest(
        MoleculeDraftCreateInput.model_validate(_draft_args(name, smiles))
    )
    with env.sessions() as session:
        turn = session.scalar(
            select(AIMessageRecord.id)
            .where(AIMessageRecord.conversation_id == env.conversation_id)
            .order_by(AIMessageRecord.created_at.desc(), AIMessageRecord.id.desc())
            .limit(1)
        )
    return server_action_key(
        env.project_id, env.conversation_id, turn, "molecule.draft.create", digest, occurrence
    )


# =================================================================== durable events
def test_event_sequences_are_unique_and_gap_free_under_concurrent_writers(env):
    run_id = env.make_run()
    barrier = threading.Barrier(8)
    errors: list[BaseException] = []

    def writer(worker: int):
        try:
            barrier.wait(WAIT)
            with env.sessions() as session:
                events = AIRunEventManager(session)
                for n in range(5):
                    events.record_event(env.project_id, run_id, "tool.executed", f"{worker}-{n}")
                    session.commit()
        except BaseException as error:
            errors.append(error)

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(8)]
    [t.start() for t in threads]
    [t.join(WAIT) for t in threads]
    assert not errors, errors
    with env.sessions() as session:
        sequences = list(
            session.scalars(
                select(AIRunEventRecord.sequence)
                .where(AIRunEventRecord.run_id == run_id)
                .order_by(AIRunEventRecord.sequence)
            )
        )
    assert sequences == list(range(1, 41))
    assert env.run_row(run_id).last_event_sequence == 40


def test_event_not_persisted_when_state_transaction_rolls_back(env):
    run_id = env.make_run()
    with env.sessions() as session:
        AIRunEventManager(session).record_event(env.project_id, run_id, "run.started", "x")
        session.rollback()
    assert env.event_types(run_id) == []
    assert env.run_row(run_id).last_event_sequence == 0


def test_events_survive_restart_and_resume_numbering(env):
    run_id = env.make_run()
    for _ in range(3):  # three separate "processes"
        with env.sessions() as session:
            AIRunEventManager(session).record_event(env.project_id, run_id, "tool.executed", "e")
            session.commit()
    with env.sessions() as session:
        events = AIRunEventManager(session).get_events(env.project_id, run_id, after_sequence=1)
    assert [e.sequence for e in events] == [2, 3]


def test_run_events_are_private_to_the_run_owner(env):
    run_id = env.make_run()
    with env.sessions() as session:
        other = User(id=new_id(), email="peer@chemdft.test", display_name="Peer")
        session.add(other)
        session.commit()
        session.add(ProjectMember(project_id=env.project_id, user_id=other.id, role="editor"))
        session.commit()
        peer = Identity(other.id, env.settings.dev_organization_id)
        service = AIScientistService(session, peer, env.store, env.settings)
        with pytest.raises(ScientificReferenceNotFound):
            service.get_run_events(env.project_id, run_id)
        with pytest.raises(ScientificReferenceNotFound):
            service.cancel_run(env.project_id, run_id)  # nor can a peer stop it
        with pytest.raises(ScientificReferenceNotFound):
            service.pause_run(env.project_id, run_id)
    assert env.run_row(run_id).status == "PLANNING"
    other_project = _create_project(env.client, name="Other project")["id"]
    with env.sessions() as session, pytest.raises(ScientificReferenceNotFound):
        env.service(session).get_run_events(other_project, run_id)


# ============================================================ control state machine
def test_stop_cannot_overwrite_terminal_runs_and_is_idempotent(env):
    done = env.make_run(status="SUCCEEDED")
    with pytest.raises(RunControlInvalidStateError):
        env.control("cancel", done)
    assert env.run_row(done).status == "SUCCEEDED"

    run_id = env.make_run()
    assert env.control("cancel", run_id).status == "CANCELED"
    assert env.control("cancel", run_id).status == "CANCELED"  # idempotent, one event
    assert env.event_types(run_id).count("status.changed") == 1


def test_pause_resume_validity_matrix_and_epochs(env):
    run_id = env.make_run()
    assert env.run_row(run_id).fencing_epoch == 1
    assert env.control("pause", run_id).status == "PAUSED"
    assert env.run_row(run_id).fencing_epoch == 2
    with pytest.raises(RunControlInvalidStateError):
        env.control("pause", run_id)  # already paused
    # Resume of a non-paused run is an idempotent no-op: it never starts a second worker.
    for status in ("WAITING_FOR_APPROVAL", "PLANNING", "FAILED"):
        other = env.make_run(status=status)
        gateway = ScriptedGateway([_final_response()])
        assert env.resume(other, gateway).status == status
        assert gateway.calls == 0
        assert env.run_row(other).fencing_epoch == 1


def test_late_worker_callback_cannot_revive_or_complete_a_stopped_run(env):
    run_id = env.make_run()
    env.control("cancel", run_id)
    with env.sessions() as session:
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        session.add(
            AIMessageRecord(
                project_id=env.project_id,
                conversation_id=env.conversation_id,
                run_id=run_id,
                role="assistant",
                content="late answer",
                citations_json=[],
            )
        )
        with pytest.raises(StaleWorkerFencedError):
            manager.transition(env.project_id, run_id, 1, "SUCCEEDED")
        with pytest.raises(StaleWorkerFencedError):
            manager.verify_worker_epoch(env.project_id, run_id, 1)
        with pytest.raises(StaleWorkerFencedError):
            manager.reserve_model_call(env.project_id, run_id, 1, 10, 10)
    assert env.run_row(run_id).status == "CANCELED"
    with env.sessions() as session:  # the late assistant message was rolled back, not published
        assert session.scalar(
            select(func.count()).select_from(AIMessageRecord).where(
                AIMessageRecord.run_id == run_id
            )
        ) == 0


# ====================================== pause / stop during a provider call (no sleeps)
def _run_worker_in_thread(env, run_id, gateway):
    outcome: dict[str, object] = {}

    def target():
        try:
            env.execute(run_id, gateway)
        except BaseException as error:
            outcome["error"] = error

    thread = threading.Thread(target=target)
    thread.start()
    return thread, outcome


@pytest.mark.parametrize("control, final_status", [("pause", "PAUSED"), ("cancel", "CANCELED")])
def test_control_during_provider_call_blocks_all_later_dispatch(env, control, final_status):
    run_id = env.make_run()
    inside, release = threading.Event(), threading.Event()

    def provider_call():
        inside.set()
        assert release.wait(WAIT)

    gateway = ScriptedGateway(
        [_tool_response(_draft_call("methane", "C")), _final_response()], before={0: provider_call}
    )
    thread, outcome = _run_worker_in_thread(env, run_id, gateway)
    assert inside.wait(WAIT)  # worker is blocked inside the provider call
    assert env.control(control, run_id).status == final_status
    release.set()  # the "late response" now arrives and asks for a tool
    thread.join(WAIT)
    assert "error" not in outcome, outcome
    # The late response authorized nothing.
    assert gateway.calls == 1
    assert env.candidates() == 0
    assert env.receipts() == []
    assert "object.created" not in env.event_types(run_id)
    row = env.run_row(run_id)
    assert row.status == final_status
    assert row.fencing_epoch == 2
    # The spend that did happen is recorded exactly once and the reservation released.
    budget = AIRunBudget.from_dict(row.budget_json)
    assert (budget.model_calls_used, budget.model_call_in_flight) == (1, False)
    assert budget.input_tokens_used == 100
    with env.sessions() as session:
        assert session.scalar(select(func.count()).select_from(AIModelInvocationRecord)) == 1
    # Honest reporting: the provider call was not cancelled, only made irrelevant.
    status_events = env.event_types(run_id)
    assert status_events.count("status.changed") == 1


def test_resume_after_pause_preserves_counters_and_creates_the_draft_once(env):
    run_id = env.make_run()
    inside, release = threading.Event(), threading.Event()

    def provider_call():
        inside.set()
        assert release.wait(WAIT)

    first = ScriptedGateway([_tool_response(_draft_call("methane", "C"))], {0: provider_call})
    thread, _ = _run_worker_in_thread(env, run_id, first)
    assert inside.wait(WAIT)
    env.control("pause", run_id)
    release.set()
    thread.join(WAIT)
    before = AIRunBudget.from_dict(env.run_row(run_id).budget_json)

    second = ScriptedGateway([_tool_response(_draft_call("methane", "C", "other-key-9999")), _final_response()])
    resumed = env.resume(run_id, second)  # a brand-new service/session == server restart
    assert resumed.status == "SUCCEEDED"
    assert env.candidates() == 1
    after = AIRunBudget.from_dict(env.run_row(run_id).budget_json)
    assert after.model_calls_used == before.model_calls_used + 2  # counters continued, not reset
    assert after.max_model_calls == before.max_model_calls
    assert env.run_row(run_id).fencing_epoch == 3
    types = env.event_types(run_id)
    assert types.count("object.created") == 1
    assert types.count("run.started") == 1  # resume does not fake a second start


# ======================================== pause / stop immediately before dispatch
@pytest.mark.parametrize(
    "control, status, receipt_status",
    [("pause", "PAUSED", "INTENT"), ("cancel", "CANCELED", "ABANDONED")],
)
def test_control_between_intent_and_effect_commit_is_fenced(
    env, monkeypatch, control, status, receipt_status
):
    run_id = env.make_run()
    original = service_module.begin_action
    fired: list[str] = []

    def begin_then_control(*args, **kwargs):
        receipt = original(*args, **kwargs)  # intent committed ...
        if not fired:
            fired.append(control)
            env.control(control, run_id)  # ... then Pause/Stop lands "before dispatch"
        return receipt

    monkeypatch.setattr(service_module, "begin_action", begin_then_control)
    gateway = ScriptedGateway([_tool_response(_draft_call("methane", "C")), _final_response()])
    env.execute(run_id, gateway)

    assert env.candidates() == 0, "a fenced worker must not publish a draft"
    assert env.run_row(run_id).status == status
    assert [r.status for r in env.receipts()] == [receipt_status]
    assert "object.created" not in env.event_types(run_id)
    with env.sessions() as session:
        step = session.scalars(
            select(AIRunStepRecord).where(AIRunStepRecord.tool_name == "molecule.draft.create")
        ).one()
        assert step.error_code == "STALE_WORKER_FENCED"
        assert session.scalar(select(func.count()).select_from(ProvenanceRecordRow)) == 0


def test_stale_epoch_worker_cannot_commit_even_if_dispatched(env):
    run_id = env.make_run()
    key = _key(env)
    env.control("pause", run_id)  # epoch 1 -> 2; the worker below still holds epoch 1
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke("molecule.draft.create", _draft_args(), env.tool_context(run_id, 1, key))
    assert isinstance(caught.value.__cause__, StaleWorkerFencedError)
    assert env.candidates() == 0


# ============================================== idempotency and server-owned identity
def test_model_chosen_keys_cannot_alias_and_separate_steps_stay_distinct(env):
    run_id = env.make_run()
    gateway = ScriptedGateway(
        [
            _tool_response(
                _draft_call("methane", "C", "the-same-key"),
                _draft_call("ethane", "CC", "the-same-key"),  # same model key, other molecule
                _draft_call("methane", "C", "the-same-key"),  # identical args, 2nd logical step
            ),
            _final_response(),
        ]
    )
    env.execute(run_id, gateway)
    assert env.run_row(run_id).status == "SUCCEEDED"
    assert env.candidates() == 3  # no aliasing by the model key; identical steps are distinct
    keys = {r.action_key for r in env.receipts()}
    assert len(keys) == 3 and not any("key" in k for k in keys)
    assert env.event_types(run_id).count("object.created") == 3


def test_same_logical_action_retried_has_one_effect_and_new_requests_are_distinct(env):
    first = env.make_run(prompt="Please create methane twice.")
    script = lambda: ScriptedGateway(  # noqa: E731
        [_tool_response(_draft_call("methane", "C"), _draft_call("methane", "C")), _final_response()]
    )
    env.execute(first, script())
    assert env.candidates() == 2
    # Retry/replay of the very same request (crash recovery re-executing the run): no new effects.
    env.execute(first, script())
    assert env.candidates() == 2 and len(env.receipts()) == 2
    # A separate, later researcher request with identical arguments is a new authorized action.
    second = env.make_run(prompt="Please create methane again.")
    env.execute(second, ScriptedGateway([_tool_response(_draft_call("methane", "C")), _final_response()]))
    assert env.candidates() == 3
    assert "object.created" in env.event_types(second)


def test_completed_action_replayed_by_another_run_is_reported_as_reused(env):
    first = env.make_run()
    key = _key(env)
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        created = registry.invoke("molecule.draft.create", _draft_args(), env.tool_context(first, 1, key))
    env.control("cancel", first)
    other = env.make_run()
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        again = registry.invoke("molecule.draft.create", _draft_args(), env.tool_context(other, 1, key))
    assert again.candidate_id == created.candidate_id and env.candidates() == 1
    assert "object.reused" in env.event_types(other)
    assert "object.created" not in env.event_types(other)


def test_unfinished_receipt_cannot_be_hijacked_by_another_active_run(env, monkeypatch):
    run_a, run_b = env.make_run(), env.make_run()
    key = _key(env)
    digest = draft_arguments_digest(MoleculeDraftCreateInput.model_validate(_draft_args()))
    with env.sessions() as session:  # run A committed its intent and is mid-flight
        begin_action(
            session, project_id=env.project_id, run_id=run_a, epoch=1,
            tool_name="molecule.draft.create", action_key=key, arguments_sha256=digest,
        )
    with env.sessions() as session:  # active run B asks for the same action
        registry = build_application_tool_registry(session, env.store, env.settings)
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke("molecule.draft.create", _draft_args(), env.tool_context(run_b, 1, key))
    assert caught.value.code == ToolErrorCode.CONFLICT
    owner = env.receipts()[0]
    assert (owner.run_id, owner.epoch, owner.status) == (run_a, 1, "INTENT")
    assert env.candidates() == 0

    # Even if B somehow reached completion, the atomic condition (run_id, epoch) refuses it.
    from chemdft_api.ai.action_receipts import ActionOwnershipLostError, complete_action

    with env.sessions() as session, pytest.raises(ActionOwnershipLostError):
        complete_action(
            session, AIRunEventManager(session), project_id=env.project_id, action_key=key,
            run_id=run_b, epoch=1, result={}, effect_entity_id="x", event=None,
        )
    assert env.receipts()[0].status == "INTENT"

    # Run A finishes normally and exactly one effect exists.
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        registry.invoke("molecule.draft.create", _draft_args(), env.tool_context(run_a, 1, key))
    assert env.candidates() == 1


def test_two_active_runs_racing_for_the_same_action_one_owner_one_effect(env, monkeypatch):
    run_a, run_b = env.make_run(), env.make_run()
    key = _key(env)
    real = molecule_tools_module.generate_conformer
    a_inside, release_a = threading.Event(), threading.Event()

    def hold_a(*args, **kwargs):
        a_inside.set()
        assert release_a.wait(WAIT)
        return real(*args, **kwargs)

    monkeypatch.setattr(molecule_tools_module, "generate_conformer", hold_a)
    outcome: dict[str, object] = {}

    def run_a_worker():
        with env.sessions() as session:
            registry = build_application_tool_registry(session, env.store, env.settings)
            outcome["a"] = registry.invoke(
                "molecule.draft.create", _draft_args(), env.tool_context(run_a, 1, key)
            ).candidate_id

    thread = threading.Thread(target=run_a_worker)
    thread.start()
    assert a_inside.wait(WAIT)  # A owns the intent and is mid-effect
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke("molecule.draft.create", _draft_args(), env.tool_context(run_b, 1, key))
    assert caught.value.code == ToolErrorCode.CONFLICT  # B cannot take A's unfinished action
    release_a.set()
    thread.join(WAIT)
    assert env.candidates() == 1
    [receipt] = env.receipts()
    assert (receipt.run_id, receipt.status) == (run_a, "COMPLETED")
    assert env.event_types(run_a).count("object.created") == 1
    assert env.event_types(run_b) == []


def test_same_key_with_different_arguments_is_a_conflict(env):
    key = _key(env)
    with env.sessions() as session:
        begin_action(
            session, project_id=env.project_id, run_id=None, epoch=None,
            tool_name="molecule.draft.create", action_key=key, arguments_sha256="a" * 64,
        )
        with pytest.raises(ActionConflictError):
            begin_action(
                session, project_id=env.project_id, run_id=None, epoch=None,
                tool_name="molecule.draft.create", action_key=key, arguments_sha256="b" * 64,
            )
    run_id = env.make_run()
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke("molecule.draft.create", _draft_args(), env.tool_context(run_id, 1, key))
    assert caught.value.code == ToolErrorCode.CONFLICT
    assert env.candidates() == 0


def test_two_workers_same_action_produce_exactly_one_effect(env, monkeypatch):
    run_id = env.make_run()
    key = _key(env)
    real = molecule_tools_module.generate_conformer
    barrier = threading.Barrier(2)

    def rendezvous(*args, **kwargs):
        barrier.wait(WAIT)  # both workers are past intent and about to write the effect
        return real(*args, **kwargs)

    monkeypatch.setattr(molecule_tools_module, "generate_conformer", rendezvous)
    results: list[object] = []
    errors: list[BaseException] = []

    def worker():
        try:
            with env.sessions() as session:
                registry = build_application_tool_registry(session, env.store, env.settings)
                out = registry.invoke(
                    "molecule.draft.create", _draft_args(), env.tool_context(run_id, 1, key)
                )
                results.append(out.candidate_id)
        except BaseException as error:
            errors.append(error)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    [t.start() for t in threads]
    [t.join(WAIT) for t in threads]
    assert not errors, errors
    assert len(set(results)) == 1 and len(results) == 2
    assert env.candidates() == 1
    with env.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ProvenanceRecordRow)) == 1
    assert env.event_types(run_id).count("object.created") == 1
    assert [r.status for r in env.receipts()] == ["COMPLETED"]


# ================================================================== crash recovery
def test_crash_after_intent_is_recovered_by_redispatch_without_duplicates(env):
    run_id = env.make_run()
    key = _key(env)
    digest = draft_arguments_digest(MoleculeDraftCreateInput.model_validate(_draft_args()))
    with env.sessions() as session:  # worker 1 died right after committing intent
        begin_action(
            session, project_id=env.project_id, run_id=run_id, epoch=1,
            tool_name="molecule.draft.create", action_key=key, arguments_sha256=digest,
        )
    assert env.candidates() == 0 and [r.status for r in env.receipts()] == ["INTENT"]
    env.execute(run_id, ScriptedGateway([_tool_response(_draft_call("methane", "C")), _final_response()]))
    assert env.candidates() == 1
    assert [r.status for r in env.receipts()] == ["COMPLETED"]


def test_crash_after_effect_commit_before_step_checkpoint_replays_stored_result(env):
    run_id = env.make_run()
    key = _key(env)
    with env.sessions() as session:  # worker 1 committed the effect, then died (no step row)
        registry = build_application_tool_registry(session, env.store, env.settings)
        first = registry.invoke("molecule.draft.create", _draft_args(), env.tool_context(run_id, 1, key))
    # A restarted worker replays the whole request.
    env.execute(run_id, ScriptedGateway([_tool_response(_draft_call("methane", "C")), _final_response()]))
    assert env.candidates() == 1
    with env.sessions() as session:
        receipt = session.scalars(select(AIActionReceiptRecord)).one()
        assert receipt.result_json["candidate_id"] == str(first.candidate_id)
    assert env.event_types(run_id).count("object.created") == 1


def test_failure_inside_effect_transaction_leaves_nothing_behind(env, monkeypatch):
    run_id = env.make_run()
    key = _key(env)
    boom = RuntimeError("disk full")

    def explode(*_a, **_k):
        raise boom

    monkeypatch.setattr(molecule_tools_module, "complete_action", explode)
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        with pytest.raises(ToolInvocationError):
            registry.invoke("molecule.draft.create", _draft_args(), env.tool_context(run_id, 1, key))
    assert env.candidates() == 0, "artifacts must not exist without their receipt"
    assert [r.status for r in env.receipts()] == ["FAILED"]  # retryable, no effect


# ============================================================ authorization
def _as_member(env, role: str) -> Identity:
    with env.sessions() as session:
        user = User(id=new_id(), email=f"{role}-{uuid4().hex[:6]}@chemdft.test", display_name=role)
        session.add(user)
        session.commit()
        session.add(ProjectMember(project_id=env.project_id, user_id=user.id, role=role))
        session.commit()
        return Identity(user.id, env.settings.dev_organization_id)


def test_read_only_member_cannot_create_even_with_forged_capabilities(env):
    viewer = _as_member(env, "viewer")
    run_id = env.make_run()
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke(
                "molecule.draft.create", _draft_args(),
                env.tool_context(run_id, 1, _key(env), identity=viewer),
            )
    assert caught.value.code == ToolErrorCode.FORBIDDEN
    assert env.candidates() == 0 and env.receipts() == []


def test_non_member_and_cross_project_binding_are_rejected(env):
    with env.sessions() as session:
        user = User(id=new_id(), email="stranger@chemdft.test", display_name="Stranger")
        session.add(user)
        session.commit()
        stranger = Identity(user.id, env.settings.dev_organization_id)
    run_id = env.make_run()
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        with pytest.raises(ToolInvocationError):
            registry.invoke(
                "molecule.draft.create", _draft_args(),
                env.tool_context(run_id, 1, _key(env), identity=stranger),
            )
    other_project = _create_project(env.client, name="Elsewhere")["id"]
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        ctx = env.tool_context(run_id, 1, _key(env))
        forged = ToolInvocationContext(
            request_id=ctx.request_id, identity=ctx.identity, project_id=UUID(other_project),
            capabilities=ctx.capabilities, approval_references=frozenset(), transport="test",
            execution=ctx.execution,  # run belongs to the *first* project
        )
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke("molecule.draft.create", _draft_args(), forged)
    assert isinstance(caught.value.__cause__, StaleWorkerFencedError)
    assert env.candidates() == 0


def test_resume_requires_current_write_while_pause_and_stop_stay_available(env):
    run_id = env.make_run()
    env.control("pause", run_id)
    with env.sessions() as session:  # researcher is downgraded to READ-only while paused
        member = session.scalars(
            select(ProjectMember).where(
                ProjectMember.project_id == env.project_id,
                ProjectMember.user_id == env.settings.dev_user_id,
            )
        ).one()
        member.role = "viewer"
        session.commit()
    gateway = ScriptedGateway([_tool_response(_draft_call("methane", "C")), _final_response()])
    with pytest.raises(ApplicationError):
        env.resume(run_id, gateway)  # autonomous execution cannot be re-enabled without WRITE
    row = env.run_row(run_id)
    assert (row.status, row.fencing_epoch) == ("PAUSED", 2)
    assert gateway.calls == 0 and env.candidates() == 0 and env.receipts() == []
    # Reducing activity stays possible with READ: Stop works, and is the policy for Pause too.
    other = env.make_run()
    assert env.control("pause", other).status == "PAUSED"
    assert env.control("cancel", other).status == "CANCELED"
    # Removed from the project entirely: nothing is readable or controllable.
    with env.sessions() as session:
        session.query(ProjectMember).filter_by(
            project_id=env.project_id, user_id=env.settings.dev_user_id
        ).delete()
        session.commit()
    with env.sessions() as session:
        with pytest.raises(ApplicationError):
            env.service(session).get_run_events(env.project_id, run_id)
        with pytest.raises(ApplicationError):
            env.service(session).cancel_run(env.project_id, run_id)


def test_model_arguments_cannot_carry_authority_or_identity(env):
    run_id = env.make_run()
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        ctx = env.tool_context(run_id, 1, _key(env))
        for forged in (
            {**_draft_args(), "project_id": str(uuid4())},
            {**_draft_args(), "capabilities": ["project.write"]},
            {**_draft_args(), "actor_id": "someone-else"},
            {**_draft_args(name="x" * 5000)},
            {**_draft_args(smiles="C" * 5000)},
        ):
            with pytest.raises(ToolInvocationError) as caught:
                registry.invoke("molecule.draft.create", forged, ctx)
            assert caught.value.code == ToolErrorCode.VALIDATION_ERROR
    assert env.candidates() == 0


def test_name_must_match_structure_and_unverified_smiles_are_refused(env):
    run_id = env.make_run()
    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        for name, smiles in (("methane", "CC"), ("not a real compound", "CCO")):
            with pytest.raises(ToolInvocationError) as caught:
                registry.invoke(
                    "molecule.draft.create", _draft_args(name, smiles),
                    env.tool_context(run_id, 1, _key(env, name, smiles)),
                )
            assert caught.value.code == ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED
    assert env.candidates() == 0
    # Through the orchestrator: a model-invented explicit SMILES the researcher never typed.
    run2 = env.make_run(prompt="Please create ethanol.")
    env.execute(run2, ScriptedGateway([_tool_response(_draft_call("CC(=O)O", "CC(=O)O")), _final_response()]))
    assert env.candidates() == 0
    with env.sessions() as session:
        step = session.scalars(
            select(AIRunStepRecord).where(AIRunStepRecord.run_id == run2, AIRunStepRecord.error_code == "TOOL_REJECTED")
        ).one()
        assert "not supplied by the researcher" in step.error_detail
    # The researcher *did* type it, so it is accepted.
    run3 = env.make_run(prompt="Create the molecule CC(=O)O please.")
    env.execute(run3, ScriptedGateway([_tool_response(_draft_call("CC(=O)O", "CC(=O)O")), _final_response()]))
    assert env.candidates() == 1


# ================================================================== budgets
def test_budget_unit_semantics():
    budget = AIRunBudget(max_input_tokens=1000, max_output_tokens=500, max_model_calls=2, max_tool_calls=1)
    budget.reserve(400, 100)
    with pytest.raises(Exception):
        budget.reserve(1, 1)  # one call in flight at a time
    assert budget.settle_uncertain() is True  # crash recovery keeps the spend
    assert (budget.input_tokens_used, budget.output_tokens_used, budget.model_calls_used) == (400, 100, 1)
    budget.record_tool_call()
    with pytest.raises(Exception):
        budget.record_tool_call()
    assert budget.tool_calls_used == 1  # the refused call is not counted
    zero = AIRunBudget(max_model_calls=0)
    with pytest.raises(Exception):
        zero.reserve(1, 1)  # zero means no allocation, never unlimited
    for bad in ({"max_input_tokens": -1}, {"max_model_calls": "7"}, {"tool_calls_used": True}):
        with pytest.raises(AIBudgetInvalidError):
            AIRunBudget.from_dict(bad)
    assert AIRunBudget.from_dict(None).max_model_calls > 0  # absent => finite server default


def test_model_call_ceiling_fails_the_run_and_counters_are_durable(env):
    run_id = env.make_run(budget={"max_model_calls": 1})
    gateway = ScriptedGateway([_tool_response(_draft_call("methane", "C")), _final_response()])
    env.execute(run_id, gateway)
    row = env.run_row(run_id)
    assert (row.status, row.error_code) == ("FAILED", "BUDGET_EXCEEDED")
    assert gateway.calls == 1  # the second call was never sent
    assert AIRunBudget.from_dict(row.budget_json).model_calls_used == 1
    assert env.resume(run_id, gateway).status == "FAILED"  # terminal: resume cannot raise it
    assert gateway.calls == 1
    assert AIRunBudget.from_dict(env.run_row(run_id).budget_json).max_model_calls == 1


def test_tool_call_ceiling_and_corrupt_budget_block_execution(env):
    run_id = env.make_run(budget={"max_tool_calls": 1})
    gateway = ScriptedGateway(
        [_tool_response(_draft_call("methane", "C"), _draft_call("ethane", "CC")), _final_response()]
    )
    env.execute(run_id, gateway)
    assert env.run_row(run_id).error_code == "BUDGET_EXCEEDED"
    assert env.candidates() == 1  # the second tool call was refused by the server
    corrupt = env.make_run(budget={"max_input_tokens": "unlimited"})
    env.execute(corrupt, ScriptedGateway([_final_response()]))
    assert env.run_row(corrupt).error_code == "AI_BUDGET_INVALID"


def test_unreconciled_provider_call_is_charged_on_recovery(env):
    run_id = env.make_run()
    with env.sessions() as session:  # crash after reservation, before settlement
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        manager.reserve_model_call(env.project_id, run_id, 1, 1500, 512)
    with env.sessions() as session:
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        _epoch, budget = manager.claim_execution(env.project_id, run_id)
    assert (budget.model_calls_used, budget.input_tokens_used) == (1, 1500)
    assert not budget.model_call_in_flight


class CapturingGateway:
    """Records the max_tokens sent on each request."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.request_max_tokens = []
        self.calls = 0

    def generate(self, request):
        self.request_max_tokens.append(request.max_tokens)
        self.calls += 1
        return self.responses[min(self.calls - 1, len(self.responses) - 1)]


def test_per_request_output_limit_capped_at_reserved_budget(env):
    """The gateway must never request more output tokens than were reserved."""
    run_id = env.make_run(budget={"max_output_tokens": 500, "max_model_calls": 2})
    gateway = CapturingGateway([_final_response()])
    env.execute(run_id, gateway)
    # The per-request reservation is min(max_output_tokens, 2048) = 500.
    assert gateway.request_max_tokens
    assert all(mt <= 500 for mt in gateway.request_max_tokens)


def test_missing_provider_usage_settled_as_uncertain(env):
    """A response without usage must not be treated as zero spend."""
    run_id = env.make_run(budget={"max_output_tokens": 2048, "max_model_calls": 3})
    no_usage_response = ModelResponse(
        content="done",
        usage=None,
        model_identifier="fake-standard",
        provider="fake",
    )
    gateway = ScriptedGateway([no_usage_response, _final_response()])
    env.execute(run_id, gateway)
    budget = AIRunBudget.from_dict(env.run_row(run_id).budget_json)
    # The first call had no usage; its reservation (1500 in, 2048 out) is
    # counted as spent rather than zero.
    assert budget.model_calls_used >= 1
    assert budget.input_tokens_used >= 1500
    assert budget.output_tokens_used >= 1


def test_repeated_model_calls_track_budget(env):
    run_id = env.make_run(budget={"max_model_calls": 3, "max_output_tokens": 4096})
    gateway = ScriptedGateway([
        _tool_response(_draft_call("methane", "C")),
        _tool_response(_draft_call("ethane", "CC")),
        _final_response(),
    ])
    env.execute(run_id, gateway)
    budget = AIRunBudget.from_dict(env.run_row(run_id).budget_json)
    assert budget.model_calls_used == 3
    assert not budget.model_call_in_flight


def test_output_budget_exhaustion_fails_run(env):
    """If actual output exceeds the budget, the run fails at settlement."""
    run_id = env.make_run(budget={"max_output_tokens": 10, "max_model_calls": 5})
    # The provider reports more output tokens than the budget allows.
    overspent_response = ModelResponse(
        content="done",
        usage=ModelUsage(input_tokens=100, output_tokens=100, latency_ms=1),
        model_identifier="fake-standard",
        provider="fake",
    )
    gateway = ScriptedGateway([overspent_response])
    env.execute(run_id, gateway)
    row = env.run_row(run_id)
    assert row.status == "FAILED"
    assert row.error_code == "BUDGET_EXCEEDED"
    assert gateway.calls == 1
