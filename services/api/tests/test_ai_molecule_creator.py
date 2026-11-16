from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
from chemdft_api.ai.budgets import AIBudgetExceededError, AIRunBudget
from chemdft_api.ai.execution import StaleWorkerFencedError
from chemdft_api.ai.service import AIScientistService
from chemdft_api.ai.tool_policy import AI_TOOLS
from chemdft_api.ai_models import AIRunRecord
from chemdft_api.context import Identity
from chemdft_api.contracts.geometry import GeometryCandidateManifest
from chemdft_api.geometry_eligibility import CANDIDATE_FORMAT
from chemdft_api.models import Project
from chemdft_api.scientific_models import (
    ProvenanceRecordRow,
    ScientificArtifactRecord,
)
from chemdft_api.storage import LocalObjectStore
from sqlalchemy import select
from test_ai_scientist import _create_project


def test_autonomous_molecule_creator_five_molecules(api):
    client, sessions, settings = api
    project = _create_project(client, name="Flagship Autonomous Molecules")
    project_id = project["id"]

    # 1. Create conversation
    conv_res = client.post(f"/v1/projects/{project_id}/ai/conversations", json={"title": "Flagship 5 Molecules"})
    assert conv_res.status_code == 201, conv_res.text
    conv_id = conv_res.json()["conversation"]["id"]

    # 2. Submit the flagship prompt
    prompt = "Create methane, ethane, benzene, ethanol and acetone and show their 3D structures."
    msg_res = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={"content": prompt},
    )
    assert msg_res.status_code == 201, msg_res.text
    run_view = msg_res.json()["latest_run"]
    assert run_view is not None
    print("RUN VIEW STEPS:", run_view.get("steps"))
    print("MESSAGES:", [m.get("content") for m in msg_res.json().get("messages", [])])
    assert run_view["status"] == "SUCCEEDED", run_view

    # 3. Verify exactly five distinct candidate records were created in the database
    with sessions() as session:
        store = LocalObjectStore(settings.object_root)
        candidate_artifacts = session.scalars(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.project_id == project_id,
                ScientificArtifactRecord.kind == "COORDINATES",
                ScientificArtifactRecord.format_identifier == CANDIDATE_FORMAT,
            )
        ).all()
        assert len(candidate_artifacts) == 5, f"Expected 5 candidate artifacts, found {len(candidate_artifacts)}"

        manifests = [
            GeometryCandidateManifest.model_validate_json(store.get_bytes(a.storage_key, 1024 * 1024))
            for a in candidate_artifacts
        ]
        formulae = {m.formula for m in manifests}
        assert "CH4" in formulae
        assert "C2H6" in formulae
        assert "C6H6" in formulae
        assert "C2H6O" in formulae
        assert "C3H6O" in formulae

        for m in manifests:
            assert m.geometry_class == "GENERATED_CONFORMER_NOT_OPTIMIZED"
            assert len(m.coordinate_representation.coordinates.atoms) > 0
            drawing_art = session.get(ScientificArtifactRecord, str(m.source_drawing.artifact_id))
            assert drawing_art is not None
            drawing_bytes = store.get_bytes(drawing_art.storage_key, 1024 * 1024)
            assert len(drawing_bytes) > 0

        for a in candidate_artifacts:
            prov = session.scalar(
                select(ProvenanceRecordRow).where(
                    ProvenanceRecordRow.project_id == project_id,
                    ProvenanceRecordRow.subject_id == a.id,
                )
            )
            assert prov is not None
            assert prov.source_class == "AI_HYPOTHESIS"
            assert prov.producer_kind == "SOFTWARE"

    # 4. Check sequential authoritative events
    run_id = run_view["id"]
    events_res = client.get(f"/v1/projects/{project_id}/ai/runs/{run_id}/events")
    assert events_res.status_code == 200, events_res.text
    events = events_res.json()["events"]
    assert len(events) >= 11, f"Expected events for start, resolve, create, finish; got {len(events)}"

    # Check monotonic sequences
    sequences = [e["sequence"] for e in events]
    assert sequences == list(range(1, len(events) + 1))

    # Check event types present
    event_types = [e["event_type"] for e in events]
    assert "run.started" in event_types
    assert "identity.resolved" in event_types
    assert "object.created" in event_types
    assert "run.completed" in event_types

    # Check follow AI action payload in object.created events
    created_events = [e for e in events if e["event_type"] == "object.created"]
    assert len(created_events) == 5
    for ce in created_events:
        assert ce["payload"]["view_action"] == "open_molecule_viewer"
        assert ce["payload"]["candidate_id"] is not None


def test_duplicate_action_idempotency(api):
    client, sessions, settings = api
    project = _create_project(client, name="Idempotency Test")
    project_id = project["id"]

    # Post message to create methane
    conv_res = client.post(f"/v1/projects/{project_id}/ai/conversations", json={"title": "Methane Conv"})
    conv_id = conv_res.json()["conversation"]["id"]

    res1 = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={"content": "Create methane and show its 3D structure."},
    )
    assert res1.status_code == 201

    with sessions() as session:
        artifacts1 = session.scalars(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.project_id == project_id,
                ScientificArtifactRecord.kind == "COORDINATES",
                ScientificArtifactRecord.format_identifier == CANDIDATE_FORMAT,
            )
        ).all()
        assert len(artifacts1) == 1
        art_id1 = artifacts1[0].id

    # Post same request again with same action key in conversation
    res2 = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={"content": "Create methane and show its 3D structure."},
    )
    assert res2.status_code == 201

    with sessions() as session:
        artifacts2 = session.scalars(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.project_id == project_id,
                ScientificArtifactRecord.kind == "COORDINATES",
                ScientificArtifactRecord.format_identifier == CANDIDATE_FORMAT,
            )
        ).all()
        # A second, separate researcher request is a new authorized action: a distinct draft.
        # (Retry/replay of the *same* request stays idempotent; see test_ai_execution_durability.)
        assert len(artifacts2) == 2
        assert art_id1 in {a.id for a in artifacts2}


def test_pause_and_resume_run(api):
    client, sessions, settings = api
    project = _create_project(client, name="Pause Resume Project")
    project_id = project["id"]

    conv_res = client.post(f"/v1/projects/{project_id}/ai/conversations", json={"title": "Pause Resume Conv"})
    conv_id = conv_res.json()["conversation"]["id"]

    # Create run directly in DB to simulate active/in-progress run
    with sessions() as session:
        run = AIRunRecord(
            id=str(uuid4()),
            project_id=project_id,
            conversation_id=conv_id,
            actor_id=settings.dev_user_id,
            status="PLANNING",
            current_step=1,
            max_steps=10,
        )
        session.add(run)
        session.commit()
        run_id = run.id

    # 1. Pause run
    pause_res = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/pause")
    assert pause_res.status_code == 200, pause_res.text
    assert pause_res.json()["status"] == "PAUSED"

    # Verify event recorded
    events_res = client.get(f"/v1/projects/{project_id}/ai/runs/{run_id}/events")
    assert events_res.status_code == 200
    events = events_res.json()["events"]
    assert any(e["event_type"] == "status.changed" and e["payload"].get("status") == "PAUSED" for e in events)

    # 2. Resume run
    resume_res = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert resume_res.status_code == 200, resume_res.text
    assert resume_res.json()["status"] in {"PLANNING", "SUCCEEDED"}


def test_cancel_run_and_fencing_epoch(api):
    client, sessions, settings = api
    project = _create_project(client, name="Cancel Fencing Project")
    project_id = project["id"]

    conv_res = client.post(f"/v1/projects/{project_id}/ai/conversations", json={"title": "Cancel Conv"})
    conv_id = conv_res.json()["conversation"]["id"]

    with sessions() as session:
        run = AIRunRecord(
            id=str(uuid4()),
            project_id=project_id,
            conversation_id=conv_id,
            actor_id=settings.dev_user_id,
            status="PLANNING",
            current_step=1,
            max_steps=10,
        )
        session.add(run)
        session.commit()
        run_id = run.id

    # Cancel run
    cancel_res = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/cancel")
    assert cancel_res.status_code == 200, cancel_res.text
    assert cancel_res.json()["status"] == "CANCELED"

    # Verify worker epoch was bumped; stale epoch 1 should be fenced
    with sessions() as session:
        service = AIScientistService(session, Identity(settings.dev_user_id, settings.dev_organization_id), LocalObjectStore(settings.object_root), settings)
        with pytest.raises(StaleWorkerFencedError):
            service._execution_manager.verify_worker_epoch(project_id, run_id, worker_epoch=1)


def test_clarification_on_ambiguous_identity(api):
    client, sessions, settings = api
    project = _create_project(client, name="Ambiguity Project")
    project_id = project["id"]

    conv_res = client.post(f"/v1/projects/{project_id}/ai/conversations", json={"title": "Ambiguity Conv"})
    conv_id = conv_res.json()["conversation"]["id"]

    # Request ambiguous molecule "xylene"
    msg_res = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={"content": "Create xylene and show its structure."},
    )
    assert msg_res.status_code == 201, msg_res.text
    run_view = msg_res.json()["latest_run"]
    assert run_view is not None

    # Verify clarification was requested in events
    events_res = client.get(f"/v1/projects/{project_id}/ai/runs/{run_view['id']}/events")
    assert events_res.status_code == 200
    events = events_res.json()["events"]
    clarif_events = [e for e in events if e["event_type"] == "clarification.requested"]
    assert len(clarif_events) >= 1
    assert "xylene" in clarif_events[0]["summary"].casefold() or "isomer" in clarif_events[0]["summary"].casefold()


def test_token_budget_tracking_and_limit():
    budget = AIRunBudget(max_input_tokens=1000, max_output_tokens=500, max_tool_calls=5)

    # Reservation succeeds within budget
    budget.reserve(400)
    assert budget.reserved_input_tokens == 400

    # Reconciliation updates actual tokens and releases reservation
    budget.reconcile(actual_input=350, actual_output=100)
    assert budget.input_tokens == 350
    assert budget.output_tokens == 100
    assert budget.reserved_input_tokens == 0

    # Tool calls tracked
    budget.record_tool_call()
    assert budget.tool_calls == 1

    # INPUT_RESERVATION_V1: a reservation that exceeds the remaining input allowance is
    # rejected before dispatch and leaves the budget untouched; it is never silently reduced to
    # the remaining headroom. Reserving exactly the remaining 650 is still allowed.
    with pytest.raises(AIBudgetExceededError):
        budget.reserve(1000)  # 350 used + 1000 > 1000
    assert (budget.reserved_input_tokens, budget.model_call_in_flight) == (0, False)
    budget.reserve(650)
    assert budget.reserved_input_tokens == 650
    budget.reconcile(actual_input=650, actual_output=0)

    # Once the budget is fully consumed, further reservations fail closed.
    with pytest.raises(AIBudgetExceededError):
        budget.reserve(1)


def test_security_disallowed_tools():
    # Verify no dangerous tools exist in AI_TOOLS allowlist
    disallowed = ["shell.exec", "terminal.run", "sql.execute", "file.write", "http.request", "python.eval", "delete"]
    for dangerous in disallowed:
        assert dangerous not in AI_TOOLS
