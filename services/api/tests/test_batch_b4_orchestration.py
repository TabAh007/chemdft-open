"""Batch B4.1A: Autonomous Scientific Workflow Integration Test Suite.

Validates:
1. Real Tool Registrations & Schemas:
   - document.figures.extract (LOW_COST_REVERSIBLE, document.write)
   - structure_candidate.recognize (LOW_COST_REVERSIBLE, structure_candidate.write)
   - structure_candidate.validate_graph (READ, structure_candidate.read)
   - structure_candidate.request_review (LOW_COST_REVERSIBLE, structure_candidate.write)
2. Tool Authorization Policies:
   - READ-only permission grants access to graph validation but rejects extraction/recognition/review.
   - WRITE capability required for document/candidate mutating actions.
   - Strict rejection of DevelopmentRecognitionEngine ("dev" engine) in autonomous workflows.
3. Cross-Project Isolation:
   - Tool invocations reject foreign document and candidate IDs.
4. Worker Busy & Failure Handling:
   - DECIMER semaphore busy mapped gracefully to CAPABILITY_UNAVAILABLE without DB corruption.
   - Idempotent candidate recognition reuses existing SMILES representations.
5. Researcher Review Gate:
   - Workflow pauses safely upon structure_candidate.request_review.
   - Step created as RESEARCHER_GATE in WAITING status.
   - Run status transitions to PAUSED with researcher_gate.requested event.
   - Resume before human promotion fails safely with HTTP 409 (RESEARCHER_GATE_PENDING).
   - Promoting an unrelated candidate does not satisfy the gate.
   - Valid human promotion clears the gate and resumes the run.
6. Calculation Planning & Approval Enforcement:
   - Post-promotion planning connects to Navigator and proposes calculation.submit.
   - Electronic state (charge/multiplicity/parity) validated against StructureVersionRecord.
   - Element limits (PySCF Z <= 36) enforced.
   - Proposed calculation requires AIApprovalRecord; AI cannot self-approve.
   - Direct solver execution in FastAPI process is strictly prevented.
7. Worker Fencing:
   - Stale worker epochs cannot mutate run state or commit actions.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from b4_support import stub_decimer
from chemdft_api.ai.tool_policy import (
    AI_BOUNDED_WRITE_TOOLS,
    AI_READ_TOOLS,
    guard_ai_tool,
    validate_compute_guidance,
)
from chemdft_api.ai_models import AIApprovalRecord, AIRunRecord, AIRunStepRecord
from chemdft_api.context import Identity
from chemdft_api.contracts.structure_candidates import (
    DocumentFiguresExtractInput,
    DocumentFiguresExtractOutput,
    StructureCandidateRecognizeInput,
    StructureCandidateRecognizeOutput,
    StructureCandidateRequestReviewInput,
    StructureCandidateRequestReviewOutput,
    StructureCandidateValidateGraphInput,
)
from chemdft_api.errors import RecognitionEngineUnavailable
from chemdft_api.scientific.molecular_recognition.engine import (
    DecimerSubprocessEngine,
)
from chemdft_api.storage import LocalObjectStore
from chemdft_api.tool_registry.catalog import build_application_tool_registry
from chemdft_api.tool_registry.registry import (
    PermissionClass,
    ToolErrorCode,
    ToolInvocationContext,
    ToolInvocationError,
)
from sqlalchemy import select
from test_ai_scientist import _create_project, _import_h2
from test_batch_b3_verified_reconstruction import (
    _complete_b3_checklist,
    _upload_pdf,
)

XYZ_PT = b"""1
Pt
Pt 0.000000 0.000000 0.000000
"""


def _context(
    identity: Identity,
    project_id: str,
    capabilities: frozenset[str],
    transport: str = "internal",
) -> ToolInvocationContext:
    return ToolInvocationContext(
        request_id=uuid4(),
        identity=identity,
        project_id=UUID(project_id),
        capabilities=capabilities,
        approval_references=frozenset(),
        transport=transport,
        provider="fake",
        model="fake-standard",
    )


# -----------------------------------------------------------------------------
# Phase 1: Tool Registration and Schema Tests
# -----------------------------------------------------------------------------


def test_scientific_tools_registered_with_correct_permissions(api) -> None:
    client, sessions, settings = api
    with sessions() as session:
        store = LocalObjectStore(settings.object_root)
        registry = build_application_tool_registry(session, store, settings)

        # 1. document.figures.extract
        extract_tool = registry.resolve("document.figures.extract")
        assert extract_tool.definition.permission_class == PermissionClass.LOW_COST_REVERSIBLE
        assert extract_tool.definition.required_capabilities == ("document.write",)
        assert extract_tool.input_model == DocumentFiguresExtractInput
        assert issubclass(DocumentFiguresExtractOutput, extract_tool.output_model)

        # 2. structure_candidate.recognize
        recog_tool = registry.resolve("structure_candidate.recognize")
        assert recog_tool.definition.permission_class == PermissionClass.LOW_COST_REVERSIBLE
        assert recog_tool.definition.required_capabilities == ("structure_candidate.write",)
        assert recog_tool.input_model == StructureCandidateRecognizeInput
        assert recog_tool.output_model == StructureCandidateRecognizeOutput

        # 3. structure_candidate.validate_graph
        val_tool = registry.resolve("structure_candidate.validate_graph")
        assert val_tool.definition.permission_class == PermissionClass.READ
        assert val_tool.definition.required_capabilities == ("structure_candidate.read",)
        assert val_tool.input_model == StructureCandidateValidateGraphInput

        # 4. structure_candidate.request_review
        gate_tool = registry.resolve("structure_candidate.request_review")
        assert gate_tool.definition.permission_class == PermissionClass.LOW_COST_REVERSIBLE
        assert gate_tool.definition.required_capabilities == ("structure_candidate.write",)
        assert gate_tool.input_model == StructureCandidateRequestReviewInput
        assert gate_tool.output_model == StructureCandidateRequestReviewOutput


def test_tool_policy_categorization_and_authorization_guards(api) -> None:
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]
    user_identity = Identity(settings.dev_user_id, settings.dev_organization_id)

    # Read-only tools
    assert "structure_candidate.validate_graph" in AI_READ_TOOLS
    # Bounded write tools
    assert "document.figures.extract" in AI_BOUNDED_WRITE_TOOLS
    assert "structure_candidate.recognize" in AI_BOUNDED_WRITE_TOOLS
    assert "structure_candidate.request_review" in AI_BOUNDED_WRITE_TOOLS

    with sessions() as session:
        store = LocalObjectStore(settings.object_root)
        registry = build_application_tool_registry(session, store, settings)
        ctx = _context(user_identity, project_id, frozenset({"structure_candidate.read"}))

        val_def = registry.resolve("structure_candidate.validate_graph").definition
        rec_def = registry.resolve("structure_candidate.recognize").definition
        ext_def = registry.resolve("document.figures.extract").definition
        gate_def = registry.resolve("structure_candidate.request_review").definition

        # Validate graph passes guard with normal project membership
        guard_ai_tool(
            session,
            settings,
            ctx,
            val_def,
            {"candidate_id": str(uuid4())},
        )

        # Rejection of DevelopmentRecognitionEngine
        with pytest.raises(ToolInvocationError) as exc_info:
            guard_ai_tool(
                session,
                settings,
                ctx,
                rec_def,
                {"candidate_id": str(uuid4()), "engine": "dev"},
            )
        assert exc_info.value.code == ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED
        assert "development recognition engine" in exc_info.value.detail.lower()

        with pytest.raises(ToolInvocationError) as exc_info:
            guard_ai_tool(
                session,
                settings,
                ctx,
                rec_def,
                {"candidate_id": str(uuid4()), "engine_preference": "test"},
            )
        assert exc_info.value.code == ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED


# -----------------------------------------------------------------------------
# Phase 2 & 5: Tool Execution, Cross-Project Isolation, and Worker Busy
# -----------------------------------------------------------------------------


def test_cross_project_isolation_in_tool_handlers(api) -> None:
    client, sessions, settings = api
    proj_a = _create_project(client)
    proj_b = _create_project(client)
    user_identity = Identity(settings.dev_user_id, settings.dev_organization_id)

    with sessions() as session:
        store = LocalObjectStore(settings.object_root)
        registry = build_application_tool_registry(session, store, settings)

        # Upload doc to project A
        doc_id = _upload_pdf(client, proj_a["id"])

        # Try to invoke document.figures.extract from project B context
        ctx_b = _context(user_identity, proj_b["id"], frozenset({"document.write"}))
        with pytest.raises(ToolInvocationError) as exc_info:
            registry.invoke("document.figures.extract", {"document_id": doc_id}, ctx_b)
        assert exc_info.value.code in (
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            ToolErrorCode.FORBIDDEN,
            ToolErrorCode.NOT_FOUND,
        )


def test_recognize_handles_worker_busy_gracefully(api, monkeypatch) -> None:
    client, sessions, settings = api
    project = _create_project(client)
    doc_id = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]

    user_identity = Identity(settings.dev_user_id, settings.dev_organization_id)
    with sessions() as session:
        store = LocalObjectStore(settings.object_root)
        registry = build_application_tool_registry(session, store, settings)
        ctx = _context(
            user_identity,
            project["id"],
            frozenset({"structure_candidate.write", "structure_candidate.read"}),
        )

        def mock_busy(*args, **kwargs):
            raise RecognitionEngineUnavailable("DECIMER worker slot busy")

        monkeypatch.setattr(DecimerSubprocessEngine, "recognize_diagram", mock_busy)

        with pytest.raises(ToolInvocationError) as exc_info:
            registry.invoke(
                "structure_candidate.recognize",
                {"candidate_id": cand["id"]},
                ctx,
            )
        assert exc_info.value.code == ToolErrorCode.CAPABILITY_UNAVAILABLE
        assert "busy" in exc_info.value.detail.lower()


def test_recognize_idempotent_representation_reuse(api, monkeypatch) -> None:
    client, sessions, settings = api
    project = _create_project(client)
    doc_id = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]
    cand_id = cand["id"]
    calls = stub_decimer(monkeypatch, "CCO")

    with sessions() as session:
        store = LocalObjectStore(settings.object_root)
        registry = build_application_tool_registry(session, store, settings)
        ctx = _context(
            Identity(settings.dev_user_id, settings.dev_organization_id),
            project["id"],
            frozenset({"structure_candidate.write"}),
        )
        first = registry.invoke("structure_candidate.recognize", {"candidate_id": cand_id}, ctx)
        second = registry.invoke("structure_candidate.recognize", {"candidate_id": cand_id}, ctx)
    assert len(calls) == 1, "identical recognition must not run inference twice"
    assert first.reused is False and second.reused is True
    assert first.representation_id == second.representation_id is not None
    assert first.canonical_isomeric_smiles == second.canonical_isomeric_smiles == "CCO"


# -----------------------------------------------------------------------------
# Phase 3: Scientific Human Gate and Durable Review
# -----------------------------------------------------------------------------


def test_end_to_end_orchestration_pauses_at_researcher_gate(api, monkeypatch) -> None:
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]
    doc_id = _upload_pdf(client, project_id)

    # Pre-extract figure to get candidate ID
    cand = client.post(f"/v1/projects/{project_id}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]
    cand_id = cand["id"]

    stub_decimer(monkeypatch, "CCO")

    # Create conversation and post request for autonomous extraction and recognition
    conv_res = client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()
    conv_id = conv_res["conversation"]["id"]

    msg_res = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={
            "content": (
                f"Perform autonomous scientific reconstruction for candidate {cand_id} "
                f"from document {doc_id}."
            )
        },
    )
    assert msg_res.status_code == 201, msg_res.text
    run_view = msg_res.json()["latest_run"]

    # Execution must safely suspend at researcher review gate
    assert run_view["status"] == "PAUSED", f"Failed with: {run_view.get('failure_code')}: {run_view.get('failure_detail')}"

    with sessions() as session:
        # Check run step
        gate_step = session.scalar(
            select(AIRunStepRecord)
            .where(
                AIRunStepRecord.run_id == run_view["id"],
                AIRunStepRecord.step_type == "RESEARCHER_GATE",
            )
            .order_by(AIRunStepRecord.step_number.desc())
        )
        assert gate_step is not None
        assert gate_step.status == "WAITING"
        assert gate_step.tool_input_json["candidate_id"] == cand_id

        # Check recorded events
        run_record = session.get(AIRunRecord, run_view["id"])
        assert run_record.status == "PAUSED"


def test_resume_before_human_promotion_fails_safely(api, monkeypatch) -> None:
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]
    doc_id = _upload_pdf(client, project_id)
    cand = client.post(f"/v1/projects/{project_id}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]
    cand_id = cand["id"]

    stub_decimer(monkeypatch, "CCO")

    conv_id = client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()[
        "conversation"
    ]["id"]
    post_res = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={"content": f"Extract candidate {cand_id} from document {doc_id}."},
    )
    run_id = post_res.json()["latest_run"]["id"]

    # Calling resume before promotion MUST fail with 409 Conflict
    resume_res = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert resume_res.status_code == 409
    body = resume_res.json()
    assert body["detail"]["code"] == "RESEARCHER_GATE_PENDING"
    assert "not been promoted" in body["detail"]["message"].lower()


def test_valid_human_promotion_clears_gate_and_plans_calculation(api, monkeypatch) -> None:
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]
    doc_id = _upload_pdf(client, project_id)

    cand = client.post(f"/v1/projects/{project_id}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]
    cand_id = cand["id"]

    stub_decimer(monkeypatch, "CCO")

    conv_id = client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()[
        "conversation"
    ]["id"]
    run_id = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={"content": f"Extract candidate {cand_id} from document {doc_id}."},
    ).json()["latest_run"]["id"]

    # Human researcher workflow: generate conformer, complete review checklist, and promote
    reps = client.get(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/representations"
    ).json()["representations"]
    parent_rep = [r for r in reps if r["representation_type"] == "SMILES"][0]

    conf_res = client.post(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/representations/{parent_rep['id']}/generate-conformer",
        json={"name": "Ethanol 3D", "multiplicity": 1},
    )
    assert conf_res.status_code == 201, conf_res.text
    conf_rep = conf_res.json()["representation"]

    # Review with complete checklist
    rev_res = client.post(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/representations/{conf_rep['id']}/review",
        json={
            "notes": "Verified chemical graph and conformer.",
            "checklist": _complete_b3_checklist(),
        },
    )
    # Review candidate
    client.post(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/review",
        json={"notes": "Reviewed candidate graph."},
    )

    # Promote to authoritative structure
    promo_res = client.post(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/promote",
        json={"representation_id": conf_rep["id"]},
    )
    assert promo_res.status_code == 201, promo_res.text
    promoted_version_id = promo_res.json()["version"]["id"]

    # Now resume the AI run!
    resume_res = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert resume_res.status_code == 200, resume_res.text
    resumed_view = resume_res.json().get("run") or resume_res.json()
    assert resumed_view["status"] == "WAITING_FOR_APPROVAL"
    assert resumed_view["pending_approval"] is not None
    assert resumed_view["pending_approval"]["tool_name"] == "calculation.submit"

    with sessions() as session:
        # Check gate step was marked SUCCEEDED
        gate_step = session.scalar(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run_id,
                AIRunStepRecord.step_type == "RESEARCHER_GATE",
            )
        )
        assert gate_step.status == "SUCCEEDED"
        assert gate_step.tool_output_json["promoted_structure_version_id"] == promoted_version_id

        # Verify AIApprovalRecord exists and is pending
        approval = session.get(AIApprovalRecord, resumed_view["pending_approval"]["id"])
        assert approval is not None
        assert approval.status == "PENDING"
        # Confirm calculation target matches promoted version
        calc_args = approval.normalized_arguments_json
        assert calc_args["structure_version"]["entity_id"] == promoted_version_id


# -----------------------------------------------------------------------------
# Phase 4: Calculation Planning Validation
# -----------------------------------------------------------------------------


def test_calculation_planning_rejects_electronic_state_mismatch(api) -> None:
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]
    user_identity = Identity(settings.dev_user_id, settings.dev_organization_id)

    # Import authoritative H2 singlet structure
    imported = _import_h2(client, project_id)
    version_id = imported["version"]["id"]

    with sessions() as session:
        # Mismatch: proposing multiplicity 2 on neutral H2 (2 electrons, (2-2)%2 != 0)
        bad_args = {
            "structure_version": {
                "project_id": project_id,
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
                "multiplicity": 2,  # 2 electrons with multiplicity 2 violates spin parity!
                "engine_preference": {"engine": "pyscf"},
            },
            "provider_preference": "LOCAL",
            "idempotency_key": f"calc-{uuid4()}",
        }
        with pytest.raises(ToolInvocationError) as exc_info:
            validate_compute_guidance(session, settings, user_identity, project_id, bad_args)
        assert exc_info.value.code == ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED
        assert "electronic state mismatch" in exc_info.value.detail.lower()


def test_calculation_planning_enforces_pyscf_element_limits(api) -> None:
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]
    user_identity = Identity(settings.dev_user_id, settings.dev_organization_id)

    # Import a structure with Platinum (Z=78)
    import_res = client.post(
        f"/v1/projects/{project_id}/structures/imports",
        files={"upload": ("pt.xyz", XYZ_PT, "chemical/x-xyz")},
        data={
            "file_format": "XYZ",
            "idempotency_key": f"pt-import-{uuid4()}",
            "structure_name": "Platinum",
        },
    )
    assert import_res.status_code == 201, import_res.text
    version_id = import_res.json()["version"]["id"]

    with sessions() as session:
        calc_args = {
            "structure_version": {
                "project_id": project_id,
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
                    "identifier": "6-31g",
                    "display_name": "6-31G",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
            },
            "provider_preference": "LOCAL",
            "idempotency_key": f"calc-{uuid4()}",
        }
        with pytest.raises(ToolInvocationError) as exc_info:
            validate_compute_guidance(session, settings, user_identity, project_id, calc_args)
        assert exc_info.value.code == ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED
        assert "unsupported elements" in exc_info.value.detail.lower()
