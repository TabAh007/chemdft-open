from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from chemdft_api.ai_models import AIApprovalRecord, AIRunRecord
from chemdft_api.context import Identity
from chemdft_api.investigation_models import InvestigationRecord, InvestigationStepRecord
from chemdft_api.models import new_id, utc_now
from sqlalchemy import update

H2_XYZ = b"""2
H2
H 0 0 -0.37
H 0 0 0.37
"""


def _project(client):
    return client.post(
        "/v1/projects", json={"name": "Investigation", "slug": f"inv-sec-{uuid4().hex[:8]}"}
    ).json()


def _setup_waiting_approval(client, pid):
    imported = client.post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": ("h2.xyz", H2_XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": f"inv-sec-h2-{uuid4()}"},
    )
    assert imported.status_code == 201, imported.text
    version_id = imported.json()["version"]["id"]

    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "H2 comparison", "objective": "Compare two energies"},
    ).json()
    iid = investigation["id"]

    client.post(
        f"/v1/projects/{pid}/investigations/{iid}/hypotheses",
        json={"statement": "Energy comparison hypothesis", "source_class": "AI_HYPOTHESIS"},
    )

    args = {
        "structure_version": {
            "project_id": pid,
            "entity_type": "structure.version",
            "entity_id": version_id,
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {
                "identifier": "hf",
                "display_name": "Hartree-Fock",
                "registry": "chemdft.method",
            },
            "basis": {
                "identifier": "sto-3g",
                "display_name": "STO-3G",
                "registry": "chemdft.basis",
            },
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf"},
        },
        "provider_preference": "LOCAL",
    }

    client.post(
        f"/v1/projects/{pid}/investigations/{iid}/plans",
        json={
            "steps": [
                {
                    "action": "calculation.submit",
                    "intent": "Run HF energy calculation",
                    "approval_class": "EXPENSIVE",
                    "tool_arguments": args,
                }
            ]
        },
    )

    waiting = client.post(f"/v1/projects/{pid}/investigations/{iid}/start")
    assert waiting.status_code == 200, waiting.text
    waiting_body = waiting.json()
    assert waiting_body["status"] == "WAITING_FOR_APPROVAL"
    approval_id = waiting_body["pending_approval_id"]
    return iid, approval_id


def test_investigation_approval_rejects_stale_and_expired(api):
    client, sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    iid, approval_id = _setup_waiting_approval(client, pid)

    # 1. Expired approval request
    with sessions() as session:
        session.execute(
            update(AIApprovalRecord)
            .where(AIApprovalRecord.id == approval_id)
            .values(expires_at=utc_now() - timedelta(minutes=5))
        )
        session.commit()

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "expired" in res.json()["detail"].lower()

    # Reset expires_at to future, set status to APPROVED
    with sessions() as session:
        session.execute(
            update(AIApprovalRecord)
            .where(AIApprovalRecord.id == approval_id)
            .values(expires_at=utc_now() + timedelta(hours=1), status="APPROVED")
        )
        session.commit()

    # 2. Already decided / no longer pending
    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "no longer pending" in res.json()["detail"].lower()


def test_investigation_approval_rejects_failed_state(api):
    client, sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    iid, approval_id = _setup_waiting_approval(client, pid)

    # 1. Investigation is FAILED
    with sessions() as session:
        inv = session.get(InvestigationRecord, iid)
        inv.status = "FAILED"
        session.commit()

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "terminal state 'failed'" in res.json()["detail"].lower()

    # 2. Reset investigation to WAITING_FOR_APPROVAL, set run to FAILED
    with sessions() as session:
        inv = session.get(InvestigationRecord, iid)
        inv.status = "WAITING_FOR_APPROVAL"
        approval = session.get(AIApprovalRecord, approval_id)
        run = session.get(AIRunRecord, approval.run_id)
        run.status = "FAILED"
        session.commit()

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "terminal state 'failed'" in res.json()["detail"].lower()


def test_investigation_approval_rejects_completed_state(api):
    client, sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    iid, approval_id = _setup_waiting_approval(client, pid)

    # 1. Investigation is COMPLETED
    with sessions() as session:
        inv = session.get(InvestigationRecord, iid)
        inv.status = "COMPLETED"
        session.commit()

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "terminal state 'completed'" in res.json()["detail"].lower()

    # 2. Reset investigation to WAITING_FOR_APPROVAL, set run to COMPLETED
    with sessions() as session:
        inv = session.get(InvestigationRecord, iid)
        inv.status = "WAITING_FOR_APPROVAL"
        approval = session.get(AIApprovalRecord, approval_id)
        run = session.get(AIRunRecord, approval.run_id)
        run.status = "COMPLETED"
        session.commit()

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "terminal state 'completed'" in res.json()["detail"].lower()


def test_investigation_approval_rejects_canceled_state(api):
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    iid, approval_id = _setup_waiting_approval(client, pid)

    # Cancel via API endpoint
    cancel_res = client.post(f"/v1/projects/{pid}/investigations/{iid}/cancel")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "CANCELED"

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "terminal state 'canceled'" in res.json()["detail"].lower()


def test_investigation_approval_rejects_cross_project(api):
    client, sessions, _settings = api
    project_a = _project(client)
    project_b = _project(client)
    pid_a = project_a["id"]
    pid_b = project_b["id"]

    iid_a, approval_id_a = _setup_waiting_approval(client, pid_a)
    _iid_b, approval_id_b = _setup_waiting_approval(client, pid_b)

    # 1. Attempt to decide approval from Project B in Project A's investigation
    res = client.post(
        f"/v1/projects/{pid_a}/investigations/{iid_a}/approvals/{approval_id_b}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 403
    detail = res.json()["detail"].lower()
    assert "cross project" in detail or "belongs to another project" in detail

    # 2. Tampered run pointing to different project
    with sessions() as session:
        approval = session.get(AIApprovalRecord, approval_id_a)
        run = session.get(AIRunRecord, approval.run_id)
        run.project_id = pid_b
        session.commit()

    res = client.post(
        f"/v1/projects/{pid_a}/investigations/{iid_a}/approvals/{approval_id_a}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 403

    # Reset run project_id, tamper step project_id
    with sessions() as session:
        approval = session.get(AIApprovalRecord, approval_id_a)
        run = session.get(AIRunRecord, approval.run_id)
        run.project_id = pid_a
        step = session.get(InvestigationStepRecord, approval.step_id)
        step.project_id = pid_b
        session.commit()

    res = client.post(
        f"/v1/projects/{pid_a}/investigations/{iid_a}/approvals/{approval_id_a}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 403


def test_investigation_approval_rejects_mismatched_actions(api):
    client, sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    iid, approval_id = _setup_waiting_approval(client, pid)

    # 1. Action fingerprint mismatch (tampered arguments in approval)
    with sessions() as session:
        session.execute(
            update(AIApprovalRecord)
            .where(AIApprovalRecord.id == approval_id)
            .values(action_fingerprint="tampered_bad_fingerprint_value")
        )
        session.commit()

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "no longer match" in res.json()["detail"].lower()

    # 2. Step action mismatch
    with sessions() as session:
        approval = session.get(AIApprovalRecord, approval_id)
        from chemdft_api.investigation_service import InvestigationService
        inv_svc = InvestigationService(session, None)
        valid_fp = inv_svc._fingerprint(approval.normalized_arguments_json)
        session.execute(
            update(AIApprovalRecord)
            .where(AIApprovalRecord.id == approval_id)
            .values(action_fingerprint=valid_fp)
        )
        step = session.get(InvestigationStepRecord, approval.step_id)
        step.action = "tampered.action.name"
        session.commit()

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "does not match" in res.json()["detail"].lower()

    # 3. Step tool arguments mismatch
    with sessions() as session:
        approval = session.get(AIApprovalRecord, approval_id)
        step = session.get(InvestigationStepRecord, approval.step_id)
        step.action = approval.tool_name
        step.result_ref_json = {"tool_arguments": {"tampered": True}}
        session.commit()

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert res.status_code == 422
    assert "do not match" in res.json()["detail"].lower()

    # 4. Unknown decision keyword
    with sessions() as session:
        approval = session.get(AIApprovalRecord, approval_id)
        step = session.get(InvestigationStepRecord, approval.step_id)
        step.result_ref_json = {"tool_arguments": approval.normalized_arguments_json}
        session.commit()

    res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "MAYBE"},
    )
    assert res.status_code == 422


def test_approval_verifier_rejects_non_executing_run(api):
    """Regression for AS-C1.2 finding #4.

    The investigation approval *consumption* verifier previously checked
    ``run.status not in ("CANCELED", "FAILED", "COMPLETED")``. AIRunRecord terminal
    states are SUCCEEDED/FAILED/CANCELED — there is no "COMPLETED" — so a SUCCEEDED
    run would incorrectly pass and allow an already-consumed/stale approval to be
    re-executed. The verifier must now require ``run.status == "EXECUTING"``.
    """
    from chemdft_api.ai.service import _make_approval_verifier
    from chemdft_api.tool_registry.catalog import build_application_tool_registry
    from chemdft_api.tool_registry.registry import ToolInvocationContext, ToolInvocationError

    client, sessions, settings = api
    project = _project(client)
    pid = project["id"]
    iid, approval_id = _setup_waiting_approval(client, pid)

    # Approve the investigation.
    approve_res = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert approve_res.status_code == 200, approve_res.text

    # Obtain the real calculation.submit ToolDefinition from the application registry.
    with sessions() as session:
        registry = build_application_tool_registry(session, None, settings)
        definition = registry.resolve("calculation.submit").definition

    with sessions() as session:
        approval = session.get(AIApprovalRecord, approval_id)
        run = session.get(AIRunRecord, approval.run_id)
        # Simulate a stale/terminal run that the old buggy check would have allowed
        # (SUCCEEDED was absent from the old terminal list).
        run.status = "SUCCEEDED"
        session.commit()

        human = Identity(
            user_id=run.actor_id, organization_id=project["organization_id"]
        )
        context = ToolInvocationContext(
            request_id=UUID(new_id()),
            identity=human,
            project_id=UUID(pid),
            capabilities=frozenset({"calculation.submit"}),
            approval_references=frozenset({UUID(approval_id)}),
            transport="investigation",
            provider=None,
            model=None,
        )
        verifier = _make_approval_verifier(session)
        with pytest.raises(ToolInvocationError):
            verifier(context, definition, approval.normalized_arguments_json)

    # Also confirm a PAUSED run is rejected (the old permissive check allowed it).
    with sessions() as session:
        approval = session.get(AIApprovalRecord, approval_id)
        run = session.get(AIRunRecord, approval.run_id)
        run.status = "PAUSED"
        session.commit()

        human = Identity(
            user_id=run.actor_id, organization_id=project["organization_id"]
        )
        context = ToolInvocationContext(
            request_id=UUID(new_id()),
            identity=human,
            project_id=UUID(pid),
            capabilities=frozenset({"calculation.submit"}),
            approval_references=frozenset({UUID(approval_id)}),
            transport="investigation",
            provider=None,
            model=None,
        )
        verifier = _make_approval_verifier(session)
        with pytest.raises(ToolInvocationError):
            verifier(context, definition, approval.normalized_arguments_json)

