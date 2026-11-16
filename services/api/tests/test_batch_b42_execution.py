"""B4.2: real engine acceptance and explicitly synthetic lifecycle/security tests."""

from __future__ import annotations

import os
from copy import deepcopy

import pytest
from chemdft_api.ai.calculation_completion import reconcile_completed_calculations
from chemdft_api.ai_models import AIMessageRecord, AIRunRecord, AIRunStepRecord
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.context import Identity
from chemdft_api.scientific_models import CalculationRecord, ComputeJobRecord
from chemdft_api.service_principals import ensure_service_principals
from chemdft_api.storage import LocalObjectStore
from sqlalchemy import select, update
from test_ai_scientist import _create_project, _import_h2


def approved_h2(api):
    client, _, _ = api
    project = _create_project(client, "B4.2 disposable H2")
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


def reconcile(api):
    _, sessions, settings = api
    with sessions() as session:
        ensure_service_principals(session)
        return reconcile_completed_calculations(session, LocalObjectStore(settings.object_root))


@pytest.mark.scientific_integration
@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_SCIENTIFIC_INTEGRATION") != "1", reason="real PySCF opt-in"
)
def test_real_h2_approved_execution_auto_completion_and_idempotence(api):
    client, sessions, settings = api
    base, run, imported, conversation_id, approval_id = approved_h2(api)
    calc_id = run["waiting_calculation_id"]
    # Duplicate human POST cannot queue another native job.
    again = client.post(f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "APPROVE"})
    assert again.status_code == 200
    assert again.json()["waiting_calculation_id"] == calc_id
    with sessions() as session:
        result = process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b42-real-h2",
        )
        assert result is not None
    detail = client.get(f"{base}/calculations/{calc_id}").json()
    assert detail["calculation"]["state"] == "SUCCEEDED", detail
    assert detail["result"]["payload"]["total_energy"]["value"] == pytest.approx(
        -1.1167593073964255, abs=1e-10
    )
    assert detail["result"]["payload"]["total_energy"]["unit"]["code"] == "Eh"
    assert detail["result"]["payload"]["converged"] is True
    assert detail["result"]["producer_software"]["version"] == "2.14.0"
    # Deliberately corrupt below ORM immutability guards in disposable transactions. Retained
    # native evidence must still reject forged numerical claims, units and producer identity.
    from chemdft_api.ai.calculation_completion import (
        approved_calculation,
        grounded_result,
    )
    from chemdft_api.scientific_models import CalculationResultRecord

    for corruption in ("energy", "units", "engine"):
        with sessions() as session:
            saved_run = session.get(AIRunRecord, run["id"])
            calculation, input_row, command = approved_calculation(session, saved_run, calc_id)
            if corruption == "engine":
                software = deepcopy(detail["result"]["producer_software"])
                software["version"] = "forged"
                change = {"producer_software_json": software}
            else:
                payload = deepcopy(detail["result"]["payload"])
                if corruption == "energy":
                    payload["total_energy"]["value"] = -999.0
                else:
                    payload["total_energy"]["unit"]["code"] = "eV"
                change = {"payload_json": payload}
            session.execute(
                update(CalculationResultRecord)
                .where(CalculationResultRecord.id == detail["result"]["id"])
                .values(**change)
            )
            with pytest.raises(ValueError):
                grounded_result(
                    session,
                    LocalObjectStore(settings.object_root),
                    saved_run,
                    calculation,
                    input_row,
                    command,
                )
            session.rollback()
    assert reconcile(api) == 1
    assert reconcile(api) == 0
    final = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final["status"] == "SUCCEEDED", final.get("error_detail")
    completion = next(
        step for step in final["steps"] if step["step_type"] == "CALCULATION_COMPLETION"
    )
    with sessions() as session:
        proof = session.get(AIRunStepRecord, completion["id"]).tool_output_json
    assert proof["structure_version_id"] == imported["version"]["id"]
    assert proof["result_id"] == detail["result"]["id"]
    assert proof["input_sha256"] == detail["calculation_input_hash"]
    assert proof["completion_principal_type"] == "service"
    assert proof["claims"][0]["quantity"] == detail["result"]["payload"]["total_energy"]
    conversation = client.get(f"{base}/ai/conversations/{conversation_id}").json()
    message = conversation["messages"][-1]
    assert str(detail["result"]["payload"]["total_energy"]["value"]) in message["content"]
    assert message["evidence_status"] == "SUPPORTED"
    assert message["citations"][0]["entity_id"] == calc_id
    assert client.post(f"{base}/ai/runs/{run['id']}/resume").status_code in (200, 409)
    events = client.get(f"{base}/ai/runs/{run['id']}/events").json()["events"]
    assert sum(e["event_type"] == "calculation.result_available" for e in events) == 1


@pytest.mark.parametrize("state", ["FAILED", "CANCELED", "SUCCEEDED"])
def test_synthetic_terminal_jobs_never_invent_missing_results(api, state):
    client, sessions, _ = api
    base, run, _, conversation_id, _ = approved_h2(api)
    with sessions() as session:
        calc = session.get(CalculationRecord, run["waiting_calculation_id"])
        calc.state = state
        job = session.scalar(
            select(ComputeJobRecord).where(ComputeJobRecord.calculation_id == calc.id)
        )
        job.state = state
        session.commit()
    assert reconcile(api) == 1
    final = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final["status"] == ("CANCELED" if state == "CANCELED" else "FAILED")
    message = client.get(f"{base}/ai/conversations/{conversation_id}").json()["messages"][-1]
    assert "RESULT NOT AVAILABLE" in message["content"]
    assert message["citations"] == []
    assert "Authoritative energy:" not in message["content"]


def test_stopped_ai_run_cannot_be_revived_by_calculation_completion(api):
    client, sessions, _ = api
    base, run, _, _, _ = approved_h2(api)
    assert client.post(f"{base}/ai/runs/{run['id']}/cancel").status_code == 200
    with sessions() as session:
        session.get(CalculationRecord, run["waiting_calculation_id"]).state = "FAILED"
        session.commit()
    assert reconcile(api) == 0
    with sessions() as session:
        assert session.get(AIRunRecord, run["id"]).status == "CANCELED"
        assert (
            session.scalar(
                select(AIRunStepRecord).where(
                    AIRunStepRecord.run_id == run["id"],
                    AIRunStepRecord.step_type == "CALCULATION_COMPLETION",
                )
            )
            is None
        )
        assert not session.scalars(
            select(AIMessageRecord).where(
                AIMessageRecord.run_id == run["id"], AIMessageRecord.evidence_status == "SUPPORTED"
            )
        ).all()


def test_recover_submission_commit_gap_without_resubmission(api):
    client, sessions, _ = api
    base, run, _, _, _ = approved_h2(api)
    with sessions() as session:
        saved = session.get(AIRunRecord, run["id"])
        saved.status = "EXECUTING"
        saved.waiting_calculation_id = None
        session.commit()
    assert reconcile(api) == 0  # recovers waiting state, no terminal result yet
    recovered = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert recovered["status"] == "WAITING_FOR_CALCULATION"
    assert recovered["waiting_calculation_id"] == run["waiting_calculation_id"]
    with sessions() as session:
        assert len(session.scalars(select(CalculationRecord)).all()) == 1


def test_unavailable_engine_after_approval_is_reported_without_values(api):
    client, sessions, settings = api
    base, run, _, conversation_id, _ = approved_h2(api)
    settings.scientific_worker_python = settings.object_root / "engine-not-installed"
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b42-unavailable",
        )
    assert reconcile(api) == 1
    final = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final["status"] == "FAILED", final
    message = client.get(f"{base}/ai/conversations/{conversation_id}").json()["messages"][-1]
    assert "RESULT NOT AVAILABLE" in message["content"]


def test_revoked_write_permission_prevents_automatic_result_reporting(api):
    from chemdft_api.models import ProjectMember

    client, sessions, settings = api
    base, run, _, _, _ = approved_h2(api)
    with sessions() as session:
        member = session.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == run["project_id"],
                ProjectMember.user_id == settings.dev_user_id,
            )
        )
        member.role = "VIEWER"
        session.get(CalculationRecord, run["waiting_calculation_id"]).state = "FAILED"
        session.commit()
    assert reconcile(api) == 0
    assert client.post(f"{base}/ai/runs/{run['id']}/resume").status_code == 403
    assert client.get(f"{base}/ai/runs/{run['id']}").json()["status"] == "WAITING_FOR_CALCULATION"


@pytest.mark.parametrize("corruption", ["approval", "calculation", "structure"])
def test_synthetic_mismatched_action_fails_closed(api, corruption):
    from chemdft_api.ai_models import AIApprovalRecord
    from chemdft_api.scientific_models import CalculationInputRecord

    client, sessions, _ = api
    base, run, _, _, approval_id = approved_h2(api)
    with sessions() as session:
        calculation = session.get(CalculationRecord, run["waiting_calculation_id"])
        calculation.state = "FAILED"
        if corruption == "approval":
            # Explicit corruption below the ORM immutability boundary, only in disposable DB.
            session.execute(
                update(AIApprovalRecord)
                .where(AIApprovalRecord.id == approval_id)
                .values(action_fingerprint="0" * 64)
            )
        elif corruption == "calculation":
            calculation.request_hash = "0" * 64
        else:
            other = _create_project(client, "Foreign structure")
            imported = _import_h2(client, other["id"])
            session.execute(
                update(CalculationInputRecord)
                .where(CalculationInputRecord.calculation_id == calculation.id)
                .values(structure_version_id=imported["version"]["id"])
            )
        session.commit()
    assert reconcile(api) == 1
    final = client.get(f"{base}/ai/runs/{run['id']}").json()
    assert final["error_code"] == "INSUFFICIENT_SCIENTIFIC_EVIDENCE"


def test_stop_wins_during_completion_and_rolls_back_pending_message(api, monkeypatch):
    from chemdft_api.ai.execution import AIRunExecutionManager

    client, sessions, _ = api
    base, run, _, _, _ = approved_h2(api)
    with sessions() as session:
        session.get(CalculationRecord, run["waiting_calculation_id"]).state = "FAILED"
        session.commit()
    original = AIRunExecutionManager.transition

    def race(manager, project_id, run_id, epoch, target, **kwargs):
        if target == "FAILED":
            assert client.post(f"{base}/ai/runs/{run_id}/cancel").status_code == 200
        return original(manager, project_id, run_id, epoch, target, **kwargs)

    monkeypatch.setattr(AIRunExecutionManager, "transition", race)
    assert reconcile(api) == 0
    with sessions() as session:
        assert session.get(AIRunRecord, run["id"]).status == "CANCELED"
        assert (
            session.scalar(
                select(AIRunStepRecord).where(
                    AIRunStepRecord.run_id == run["id"],
                    AIRunStepRecord.step_type == "CALCULATION_COMPLETION",
                )
            )
            is None
        )


def test_queued_calculation_canceled_through_existing_api(api):
    client, _, _ = api
    base, run, _, _, _ = approved_h2(api)
    response = client.post(f"{base}/calculations/{run['waiting_calculation_id']}/cancel")
    assert response.status_code == 200, response.text
    assert reconcile(api) == 1
    assert client.get(f"{base}/ai/runs/{run['id']}").json()["status"] == "CANCELED"


def test_corrupted_input_is_refused_before_native_execution(api, monkeypatch):
    from chemdft_api.compute_gateway import LocalComputeProvider
    from chemdft_api.scientific_models import CalculationInputRecord, ScientificArtifactRecord

    client, sessions, settings = api
    base, run, _, _, _ = approved_h2(api)
    calls = []

    def forbidden_execute(*args, **kwargs):
        calls.append(True)
        raise AssertionError("Corrupted input must not reach an engine.")

    monkeypatch.setattr(LocalComputeProvider, "execute", forbidden_execute)
    with sessions() as session:
        input_row = session.scalar(
            select(CalculationInputRecord).where(
                CalculationInputRecord.calculation_id == run["waiting_calculation_id"]
            )
        )
        artifact = session.get(ScientificArtifactRecord, input_row.normalized_input_artifact_id)
        path = settings.object_root / artifact.storage_key
        path.write_bytes(path.read_bytes() + b" ")  # deliberate disposable-store corruption
        detail = process_next_compute_job(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            worker_id="b42-input-corruption",
        )
        assert detail.calculation.state == "FAILED"
        assert detail.attempt.failure_code == "RESULT_VALIDATION_FAILED"
    assert calls == []
    assert reconcile(api) == 1
    assert client.get(f"{base}/ai/runs/{run['id']}").json()["status"] == "FAILED"


def _steps(sessions, run_id):
    with sessions() as session:
        steps = session.scalars(
            select(AIRunStepRecord)
            .where(AIRunStepRecord.run_id == run_id)
            .order_by(AIRunStepRecord.step_number)
        ).all()
        return [
            (s.step_type, s.status, s.created_at, s.finished_at) for s in steps
        ]


def test_terminal_run_has_no_stale_waiting_step_and_ordered_timestamps(api):
    """Independent review: a finished run kept a WAITING approval step and finished<created."""
    _, sessions, _ = api
    _, run, _, _, _ = approved_h2(api)
    with sessions() as session:
        session.get(CalculationRecord, run["waiting_calculation_id"]).state = "FAILED"
        job = session.scalar(
            select(ComputeJobRecord).where(
                ComputeJobRecord.calculation_id == run["waiting_calculation_id"]
            )
        )
        job.state = "FAILED"
        session.commit()
    assert reconcile(api) == 1
    steps = _steps(sessions, run["id"])
    assert [t for t, *_ in steps].count("APPROVAL_REQUEST") == 1
    approval = next(s for s in steps if s[0] == "APPROVAL_REQUEST")
    assert approval[1] == "APPROVED" and approval[3] is not None
    assert not [s for s in steps if s[1] == "WAITING"]
    for step_type, _, created_at, finished_at in steps:
        if finished_at is not None:
            assert finished_at >= created_at, step_type


def test_rejected_approval_resolves_its_request_step(api):
    client, sessions, _ = api
    project = _create_project(client, "B4.2 rejection")
    imported = _import_h2(client, project["id"])
    base = f"/v1/projects/{project['id']}"
    conversation = client.post(f"{base}/ai/conversations", json={"title": "reject"}).json()
    response = client.post(
        f"{base}/ai/conversations/{conversation['conversation']['id']}/messages",
        json={
            "content": "Calculate HF/STO-3G energy",
            "selected_structure_id": imported["structure"]["id"],
        },
    )
    run = response.json()["latest_run"]
    response = client.post(
        f"{base}/ai/approvals/{run['pending_approval']['id']}/decision",
        json={"decision": "REJECT"},
    )
    assert response.status_code == 200, response.text
    steps = _steps(sessions, run["id"])
    approval = next(s for s in steps if s[0] == "APPROVAL_REQUEST")
    assert approval[1] == "REJECTED" and approval[3] is not None
    with sessions() as session:
        assert not session.scalars(select(CalculationRecord)).all()


def test_concurrent_duplicate_approvals_queue_exactly_one_calculation(api):
    """Independent review: racing human POSTs must not create a second job or step."""
    from concurrent.futures import ThreadPoolExecutor

    client, sessions, _ = api
    project = _create_project(client, "B4.2 concurrent approval")
    imported = _import_h2(client, project["id"])
    base = f"/v1/projects/{project['id']}"
    conversation = client.post(f"{base}/ai/conversations", json={"title": "race"}).json()
    run = client.post(
        f"{base}/ai/conversations/{conversation['conversation']['id']}/messages",
        json={
            "content": "Calculate HF/STO-3G energy",
            "selected_structure_id": imported["structure"]["id"],
        },
    ).json()["latest_run"]
    approval_id = run["pending_approval"]["id"]

    def decide(_):
        return client.post(
            f"{base}/ai/approvals/{approval_id}/decision", json={"decision": "APPROVE"}
        ).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        codes = list(pool.map(decide, range(6)))
    assert set(codes) <= {200, 409}, codes
    assert 200 in codes
    with sessions() as session:
        assert len(session.scalars(select(CalculationRecord)).all()) == 1
        assert len(session.scalars(select(ComputeJobRecord)).all()) == 1
        steps = session.scalars(
            select(AIRunStepRecord).where(AIRunStepRecord.run_id == run["id"])
        ).all()
        assert (
            sum(
                s.step_type == "TOOL_RESULT" and s.tool_name == "calculation.submit"
                for s in steps
            )
            == 1
        )
        assert session.get(AIRunRecord, run["id"]).status == "WAITING_FOR_CALCULATION"
