"""Offline hosted-proposal regression: scripted model, disposable DBs, no AWS/science.

The fixture's absent session represents a stopped pilot. It is not live AWS or
scientific acceptance evidence. PostgreSQL cases use only the existing local test server.
"""

import hashlib
import json
import subprocess
from copy import deepcopy
from pathlib import Path

import pytest
from chemdft_api import aws_compute, calculation_actions
from chemdft_api.ai import providers
from chemdft_api.ai import service as ai_service
from chemdft_api.ai.gateway import ModelToolCall
from chemdft_api.ai_models import (
    AIApprovalRecord,
    AIContextSnapshotRecord,
    AIModelInvocationRecord,
    AIRunRecord,
    AIRunStepRecord,
)
from chemdft_api.compute_gateway import LocalComputeProvider
from chemdft_api.context import Identity
from chemdft_api.contracts.catalog import CalculationSubmitInput
from chemdft_api.contracts.tools import ToolErrorCode
from chemdft_api.errors import (
    ApplicationError,
    CrossProjectReference,
    ProjectAccessDenied,
    StructureElectronicStateMismatch,
    UnsupportedCalculation,
)
from chemdft_api.navigator import capabilities
from chemdft_api.navigator.facts import Capabilities
from chemdft_api.scientific_models import (
    CalculationRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
)
from chemdft_api.storage import LocalObjectStore
from chemdft_api.tool_registry.registry import ToolInvocationError
from sqlalchemy import func, select
from test_ai_execution_durability import ScriptedGateway, _final_response, _tool_response
from test_ai_scientist import _create_project, _import_h2
from test_batch_b43_review_pg import pg_api  # noqa: F401 -- disposable PostgreSQL fixture


def forbidden(*_args, **_kwargs):
    raise AssertionError("Proposal/approval must not invoke AWS, a guard, or a scientific process")


def configure_hosted(settings, tmp_path):
    settings.compute_aws_enabled = True
    settings.compute_default_provider = "aws"
    settings.compute_local_enabled = False
    settings.aws_queue_without_session = True
    settings.aws_credential_mode = "instance_role"
    settings.aws_pilot_bucket = "chemdft-ec2-pilot-artifacts-offline"
    settings.aws_instance_id = "i-" "0123456789abcdef0"
    settings.aws_image_id = "sha256:" + "a" * 64
    settings.aws_session_file = tmp_path / "absent-session.json"
    settings.aws_session_s3_key = aws_compute.SESSION_KEY
    settings.scientific_worker_python = tmp_path / "no-local-scientific-python"


def arguments(project, version, preference="AUTO"):
    return {
        "structure_version": {
            "project_id": project,
            "entity_type": "structure.version",
            "entity_id": version,
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {"identifier": "hf", "display_name": "HF", "registry": "chemdft.method"},
            "basis": {
                "identifier": "sto-3g",
                "display_name": "STO-3G",
                "registry": "chemdft.basis",
            },
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
        },
        "provider_preference": preference,
        "idempotency_key": "offline-proposal-only",
    }


def setup(api, tmp_path, monkeypatch, preference="AUTO"):
    client, sessions, settings = api
    project = _create_project(client)["id"]
    version = _import_h2(client, project)["version"]["id"]
    configure_hosted(settings, tmp_path)
    base = f"/v1/projects/{project}/ai"
    conversation = client.post(base + "/conversations", json={}).json()["conversation"]["id"]
    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(subprocess, "Popen", forbidden)
    monkeypatch.setattr(aws_compute.AwsCli, "call", forbidden)
    monkeypatch.setattr(aws_compute.AwsCli, "ssm_run_line", forbidden)
    monkeypatch.setattr(aws_compute.AwsCli, "invoke_guard", forbidden)
    monkeypatch.setattr(aws_compute.AwsEc2ComputeProvider, "capabilities", forbidden)
    monkeypatch.setattr(aws_compute.AwsEc2ComputeProvider, "execute", forbidden)
    monkeypatch.setattr(LocalComputeProvider, "execute", forbidden)
    monkeypatch.setattr(capabilities, "_observe", forbidden)
    return (
        client,
        sessions,
        settings,
        project,
        version,
        base,
        conversation,
        arguments(project, version, preference),
    )


def send(env, monkeypatch, args):
    client, _sessions, _settings, _project, _version, base, conversation, _args = env
    gateway = ScriptedGateway(
        [
            _tool_response(
                ModelToolCall(
                    id="offline-propose", name="calculation.submit", arguments_json=json.dumps(args)
                )
            ),
            _final_response(),
        ]
    )
    monkeypatch.setattr(providers, "build_model_gateway", lambda _settings: gateway)
    response = client.post(
        base + f"/conversations/{conversation}/messages",
        json={
            "content": "Offline fixture: propose H2 HF/STO-3G energy, charge 0 multiplicity 1.",
            "selected_structure_version_id": env[4],
            "run_limits": {
                "max_model_calls": 2,
                "max_input_tokens": 60000,
                "max_output_tokens": 4096,
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["latest_run"], gateway


def no_compute(sessions):
    with sessions() as session:
        for model in (
            CalculationRecord,
            ComputeJobRecord,
            ComputeExecutionRecord,
            CalculationResultRecord,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize("database_fixture", ["api", "pg_api"])
def test_hosted_proposal_persists_then_only_explicit_approval_queues(
    database_fixture, request, tmp_path, monkeypatch
):
    env = setup(request.getfixturevalue(database_fixture), tmp_path, monkeypatch)
    client, sessions, settings, _project, version, base, conversation, args = env
    run, gateway = send(env, monkeypatch, args)
    assert run["status"] == "WAITING_FOR_APPROVAL"
    approval = run["pending_approval"]
    assert approval["status"] == "PENDING" and approval["tool_name"] == "calculation.submit"
    normalized = approval["normalized_arguments"]
    assert normalized["structure_version"]["entity_id"] == version
    parsed = CalculationSubmitInput.model_validate(normalized)
    assert parsed.specification.task_type == "ENERGY"
    assert parsed.specification.method.identifier == "hf"
    assert parsed.specification.basis.identifier == "sto-3g"
    assert parsed.specification.charge == 0 and parsed.specification.multiplicity == 1
    assert parsed.specification.engine_preference.engine == "pyscf"
    assert parsed.specification.engine_preference.allowed_version == "2.14.0"
    assert len(approval["action_fingerprint"]) == 64
    no_compute(sessions)
    with sessions() as session:
        assert session.get(AIApprovalRecord, approval["id"]).consumed_at is None
        assert session.get(AIRunRecord, run["id"]).budget_json["max_model_calls"] == 2
        assert session.scalar(select(func.count()).select_from(AIContextSnapshotRecord)) == 2
        assert session.scalar(select(AIModelInvocationRecord)).status == "SUCCEEDED"
        assert session.scalar(select(AIRunStepRecord)).step_type == "APPROVAL_REQUEST"
        assert session.scalar(select(func.count()).select_from(ProvenanceRecordRow)) == 1
        artifacts = [
            (a.id, a.sha256, a.size_bytes)
            for a in session.scalars(select(ScientificArtifactRecord))
        ]
        for artifact in session.scalars(select(ScientificArtifactRecord)):
            content = (Path(settings.object_root) / artifact.storage_key).read_bytes()
            assert len(content) == artifact.size_bytes
            assert hashlib.sha256(content).hexdigest() == artifact.sha256
    # Fresh HTTP reads/sessions model browser reload, with no second model call.
    reloaded = client.get(base + f"/conversations/{conversation}").json()["latest_run"]
    assert reloaded["pending_approval"] == approval and reloaded["status"] == run["status"]
    assert client.get(base + f"/runs/{run['id']}").json()["pending_approval"] == approval
    assert gateway.calls == 1
    no_compute(sessions)
    with sessions() as session:
        assert artifacts == [
            (a.id, a.sha256, a.size_bytes)
            for a in session.scalars(select(ScientificArtifactRecord))
        ]

    # Offline-only explicit researcher decision queues a job; it does not execute it.
    decision = client.post(
        base + f"/approvals/{approval['id']}/decision",
        json={"decision": "APPROVE", "decision_notes": "Explicit offline test-only owner approval"},
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["status"] == "WAITING_FOR_CALCULATION"
    with sessions() as session:
        job = session.scalar(select(ComputeJobRecord))
        assert job.provider == "aws" and job.state == "READY"
        assert session.scalar(select(func.count()).select_from(ComputeExecutionRecord)) == 0
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
    reads = []
    monkeypatch.setattr(aws_compute.AwsCli, "get", lambda *args: reads.append(args) or False)
    aws_compute._S3_SESSION_CACHE.clear()
    try:
        with sessions() as session:
            assert (
                calculation_actions.process_next_compute_job(
                    session,
                    Identity(settings.dev_user_id, settings.dev_organization_id),
                    LocalObjectStore(settings.object_root),
                    settings,
                    worker_id="offline-no-session",
                )
                is None
            )
            assert session.scalar(select(ComputeJobRecord)).state == "READY"
            assert session.scalar(select(func.count()).select_from(ComputeExecutionRecord)) == 0
        assert len(reads) == 1  # The worker alone checks the session; no actual AWS request.
    finally:
        aws_compute._S3_SESSION_CACHE.clear()
    assert gateway.calls == 1


@pytest.mark.parametrize("preference", ["AUTO", "CLOUD"])
def test_proposal_does_not_read_a_closed_or_missing_aws_session(
    api, tmp_path, monkeypatch, preference
):
    env = setup(api, tmp_path, monkeypatch, preference)
    monkeypatch.setattr(aws_compute, "current_session", forbidden)
    monkeypatch.setattr(aws_compute.AwsCli, "get", forbidden)
    run, gateway = send(env, monkeypatch, env[-1])
    assert run["status"] == "WAITING_FOR_APPROVAL" and gateway.calls == 1
    no_compute(env[1])


@pytest.mark.parametrize(
    "change,diagnostic",
    [
        pytest.param("method", "SCIENTIFIC_VALIDATION_FAILED", id="method"),
        pytest.param("basis", "SCIENTIFIC_VALIDATION_FAILED", id="basis"),
        pytest.param("version", "SCIENTIFIC_VALIDATION_FAILED", id="version"),
        pytest.param("electronic_state", "SCIENTIFIC_VALIDATION_FAILED", id="electronic_state"),
        pytest.param("task", "CAPABILITY_UNAVAILABLE", id="task"),
        pytest.param("engine", "CAPABILITY_UNAVAILABLE", id="engine"),
        pytest.param("local", "SCIENTIFIC_VALIDATION_FAILED", id="local"),
        pytest.param("foreign_structure", "NOT_FOUND", id="foreign_structure"),
    ],
)
def test_invalid_or_unsupported_proposal_is_rejected_without_compute(
    api, tmp_path, monkeypatch, change, diagnostic
):
    env = setup(api, tmp_path, monkeypatch)
    args = deepcopy(env[-1])
    spec = args["specification"]
    if change == "method":
        spec["method"] = {"family": "HF", "identifier": "invented-method"}
    elif change == "basis":
        spec["basis"]["identifier"] = "invented-basis"
    elif change == "version":
        spec["engine_preference"]["allowed_version"] = "0.0.0"
    elif change == "electronic_state":
        spec["multiplicity"] = 2  # H2 neutral doublet has inconsistent electron/spin parity.
    elif change == "task":
        spec["task_type"] = "NMR"
    elif change == "engine":
        spec["engine_preference"]["engine"] = "psi4"
    elif change == "local":
        args["provider_preference"] = "LOCAL"
    else:
        foreign = _create_project(env[0])["id"]
        args["structure_version"]["entity_id"] = _import_h2(env[0], foreign)["version"]["id"]
    run, gateway = send(env, monkeypatch, args)
    assert run["pending_approval"] is None and run["status"] != "WAITING_FOR_APPROVAL"
    assert run["status"] == "SUCCEEDED" and run["error_code"] is None
    assert gateway.calls == 2  # Rejection is delivered back to the scripted planner.
    with env[1]() as session:
        assert session.scalar(select(func.count()).select_from(AIApprovalRecord)) == 0
        step = session.scalar(select(AIRunStepRecord))
        assert step.status == "FAILED" and step.error_code == "TOOL_REJECTED"
        assert step.project_id == env[3] and step.run_id == run["id"]
        assert step.tool_input_json is None
        # The established diagnostics are unchanged; AI-6 adds the server-authored refusal that
        # went back to the model (a stable code, a summary, sanitized issues and the next step).
        output = dict(step.tool_output_json)
        assert output.pop("operational_diagnostics") == {
            "kind": "SCIENTIFIC_OR_POLICY_VALIDATION", "code": diagnostic,
        }
        assert set(output) == {"refusal"}
        assert set(output["refusal"]) == {"code", "summary", "issues", "next_step"}
        assert step.error_detail == output["refusal"]["summary"]
        assert step.error_detail and step.finished_at is not None
    reloaded = env[0].get(env[5] + f"/runs/{run['id']}")
    assert reloaded.status_code == 200
    assert reloaded.json()["status"] == run["status"]
    no_compute(env[1])


@pytest.mark.parametrize(
    "error,code",
    [
        (UnsupportedCalculation("PRIVATE-REJECTED-DETAIL"), "SCIENTIFIC_VALIDATION_FAILED"),
        (CrossProjectReference("PRIVATE-REJECTED-DETAIL"), "SCIENTIFIC_VALIDATION_FAILED"),
        (StructureElectronicStateMismatch("untrusted-code", "PRIVATE-REJECTED-DETAIL"),
         "SCIENTIFIC_VALIDATION_FAILED"),
        (ProjectAccessDenied("PRIVATE-REJECTED-DETAIL"), "FORBIDDEN"),
        (ApplicationError("PRIVATE-REJECTED-DETAIL"), "INTERNAL_ERROR"),
        (providers.AIFoundationError("PLANNING_PROFILE_MISMATCH", "Safe scope rejection."),
         "PLANNING_PROFILE_MISMATCH"),
        (ToolInvocationError(ToolErrorCode.CAPABILITY_UNAVAILABLE, "Safe policy rejection."),
         "CAPABILITY_UNAVAILABLE"),
        (ValueError("PRIVATE-REJECTED-DETAIL"), "INVALID_TOOL_ARGUMENTS"),
    ],
)
def test_proposal_rejection_classifies_domain_errors_without_echoing_details(
    api, tmp_path, monkeypatch, error, code
):
    env = setup(api, tmp_path, monkeypatch)

    def reject(*_args, **_kwargs):
        raise error

    monkeypatch.setattr(ai_service, "validate_compute_guidance", reject)
    run, _gateway = send(env, monkeypatch, env[-1])
    with env[1]() as session:
        step = session.scalar(select(AIRunStepRecord))
        assert step.error_code == "TOOL_REJECTED" and step.status == "FAILED"
        assert step.tool_output_json["operational_diagnostics"]["code"] == code
        assert step.tool_input_json is None
        assert session.scalar(select(func.count()).select_from(AIApprovalRecord)) == 0
    assert run["pending_approval"] is None and run["status"] == "SUCCEEDED"
    assert "PRIVATE-REJECTED-DETAIL" not in json.dumps(run)
    assert "untrusted-code" not in json.dumps(run)
    no_compute(env[1])


def test_proposal_schema_rejection_has_stable_diagnostic_and_redacts_input(
    api, tmp_path, monkeypatch
):
    env = setup(api, tmp_path, monkeypatch)
    args = deepcopy(env[-1])
    args["specification"]["multiplicity"] = "PRIVATE-INVALID-INPUT"
    run, _gateway = send(env, monkeypatch, args)
    with env[1]() as session:
        step = session.scalar(select(AIRunStepRecord))
        assert step.error_code == "TOOL_REJECTED" and step.status == "FAILED"
        output = dict(step.tool_output_json)
        assert output.pop("operational_diagnostics") == {
            "kind": "INVALID_TOOL_ARGUMENTS", "code": "INVALID_TOOL_ARGUMENTS",
        }
        refusal = output.pop("refusal")
        assert not output and refusal["code"] == "ARGUMENT_SCHEMA"
        assert refusal["summary"] == "Tool arguments failed schema validation."
        assert [i["field"] for i in refusal["issues"]] == ["specification.multiplicity"]
        assert "PRIVATE-INVALID-INPUT" not in json.dumps(refusal)
        assert step.tool_input_json is None
        assert session.scalar(select(func.count()).select_from(AIApprovalRecord)) == 0
    assert "PRIVATE-INVALID-INPUT" not in json.dumps(run)
    assert run["pending_approval"] is None
    no_compute(env[1])


def test_navigator_provider_scope_and_local_fallback(api, tmp_path, monkeypatch):
    settings = api[2]
    configure_hosted(settings, tmp_path)
    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(aws_compute.AwsEc2ComputeProvider, "capabilities", forbidden)
    assert capabilities.observe(settings).tasks == {"ENERGY"}
    assert not capabilities.observe(settings).optimizer
    assert not capabilities.observe(settings, provider_preference="LOCAL").tasks
    settings.compute_aws_enabled = False
    assert not capabilities.observe(settings).tasks
    settings.compute_aws_enabled = True
    settings.aws_image_id = "invalid-unpinned-image"
    assert not capabilities.observe(settings).tasks
    settings.aws_image_id = "sha256:" + "a" * 64
    settings.compute_local_enabled = True
    local = Capabilities(frozenset({"ENERGY", "ORBITAL", "GEOMETRY_OPTIMIZATION"}), True)
    monkeypatch.setattr(capabilities, "_observe", lambda *_args: local)
    assert capabilities.observe(settings) == local  # AUTO preserves supported local fallback.
    assert capabilities.observe(settings, provider_preference="CLOUD").tasks == {"ENERGY"}
    assert capabilities.observe(settings, provider_preference="LOCAL") == local
    settings.compute_default_provider = "local"
    assert capabilities.observe(settings) == local


def test_local_provider_still_creates_an_approval_proposal(api, tmp_path, monkeypatch):
    from chemdft_api.scientific.engines import registry

    env = setup(api, tmp_path, monkeypatch, "LOCAL")
    settings = env[2]
    settings.compute_default_provider = "local"
    settings.compute_local_enabled = True
    local = Capabilities(frozenset({"ENERGY"}))
    monkeypatch.setattr(capabilities, "_observe", lambda *_args: local)
    # Availability is an offline fixture; no engine is launched or result produced.
    monkeypatch.setattr(registry, "_probe_python", lambda *_args: ("AVAILABLE", "2.14.0", None))
    monkeypatch.setattr(aws_compute, "current_session", forbidden)
    run, gateway = send(env, monkeypatch, env[-1])
    assert run["status"] == "WAITING_FOR_APPROVAL" and gateway.calls == 1
    assert run["pending_approval"]["normalized_arguments"]["provider_preference"] == "LOCAL"
    no_compute(env[1])


def test_hosted_pyscf_optimisation_proposal_is_refused_with_the_hosted_message_and_no_compute(
    api, tmp_path, monkeypatch
):
    """Release 0.0.53: the hosted image has no geomeTRIC. A recorded planner call proposing PySCF
    optimisation must be refused at proposal time (no approval, no job) and the planner is told why."""
    env = setup(api, tmp_path, monkeypatch)
    args = deepcopy(env[-1])
    args["specification"]["task_type"] = "GEOMETRY_OPTIMIZATION"
    args["specification"]["optimization"] = {"optimizer": "geometric", "max_steps": 20}
    run, gateway = send(env, monkeypatch, args)
    print("DEBUG_RUN:", run)
    print("DEBUG_GATEWAY_CALLS:", gateway.calls)
    with env[1]() as session:
        for s in session.scalars(select(AIRunStepRecord)).all():
            print("DEBUG_STEP:", s.step_number, s.status, s.tool_name, s.error_code, s.error_detail)
            print("DEBUG_TOOL_OUTPUT:", s.tool_output_json)
    assert run["pending_approval"] is None and run["status"] != "WAITING_FOR_APPROVAL"
    assert gateway.calls == 2  # the refusal went back to the scripted planner
    with env[1]() as session:
        assert session.scalar(select(func.count()).select_from(AIApprovalRecord)) == 0
        step = session.scalar(select(AIRunStepRecord))
        assert step.status == "FAILED" and step.error_code == "TOOL_REJECTED"
        refusal = dict(step.tool_output_json)["refusal"]
        # The planner gets the stable typed code and "explain, do not retry" (details are not echoed to the model).
        assert refusal["code"] == "ENGINE_UNAVAILABLE"
        assert "explain that it is unavailable" in refusal["next_step"]
    no_compute(env[1])
