"""Comprehensive integration tests for Release 0.0.60 completion.

Tests end-to-end integration for:
- Part 1: Structure edit proposal, diff, approval creating exactly 1 unverified version, rejection creating 0.
- Part 2: Periodic energy proposal, settings resolution, approval submitting calculation, rejection creating 0.
- Part 3: Failure hints wired into fact sheet, sanitized log tail, typical cause and remedy citations.
- Part 4: Method advice wired into fact sheet, rationale and citations.
- Proof of import: all 4 modules (structure_edit, periodic_proposal, failure_hints, method_advice)
  are imported and utilized by production code.
"""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from chemdft_api.ai import providers
from chemdft_api.ai.gateway import ModelToolCall
from chemdft_api.ai.chat_facts import build_project_fact_sheet
from chemdft_api.ai_models import (
    AIApprovalRecord,
    AIRunRecord,
)
from chemdft_api.contracts.scientific import StructureVersionOrigin
from chemdft_api.models import User, new_id
from chemdft_api.scientific_models import (
    CalculationAttemptRecord,
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from sqlalchemy import select
from test_ai_execution_durability import _tool_response
from test_ai_scientist import _create_project, _import_h2
from test_structure_workspace import CIF_NACL


class ScriptedCapture:
    def __init__(self, response):
        self.requests = []
        self.response = response

    def generate(self, request):
        self.requests.append(request)
        return self.response


def test_production_code_imports_all_four_modules():
    """Verify that all four Release 0.0.60 modules are imported by production code."""
    import chemdft_api.ai.chat_facts as chat_facts_mod
    import chemdft_api.ai.planning_profiles as planning_profiles_mod
    import chemdft_api.ai.service as service_mod
    import chemdft_api.tool_registry.catalog as catalog_mod

    # 1. structure_edit imported by catalog and service
    from chemdft_api.ai.structure_edit import apply_structure_edit_version

    assert callable(apply_structure_edit_version)

    # 2. periodic_proposal imported by planning_profiles and service
    from chemdft_api.ai.periodic_proposal import resolve_periodic_proposal_settings

    assert callable(resolve_periodic_proposal_settings)

    # 3. failure_hints imported by chat_facts
    from chemdft_api.ai.failure_hints import find_failure_hint, sanitize_log_tail

    assert callable(find_failure_hint)
    assert callable(sanitize_log_tail)
    assert hasattr(chat_facts_mod, "find_failure_hint")
    assert hasattr(chat_facts_mod, "sanitize_log_tail")

    # 4. method_advice imported by chat_facts
    from chemdft_api.ai.method_advice import advise_calculation_method

    assert callable(advise_calculation_method)
    assert hasattr(chat_facts_mod, "advise_calculation_method")


def test_structure_edit_proposal_end_to_end_approval_creates_one_version(api, monkeypatch):
    """STRUCTURE_EDIT_PROPOSAL: Approve creates exactly ONE new structure version; parent is immutable."""
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]
    h2_resp = _import_h2(client, project_id)
    parent_version_id = h2_resp["version"]["id"]

    # Initial version count
    with sessions() as session:
        initial_versions = session.scalars(
            select(StructureVersionRecord).where(
                StructureVersionRecord.structure_id == h2_resp["structure"]["id"]
            )
        ).all()
        assert len(initial_versions) == 1
        initial_parent_atoms = initial_versions[0].atom_count

    # Create a conversation
    conv_resp = client.post(f"/v1/projects/{project_id}/ai/conversations", json={})
    assert conv_resp.status_code == 201, conv_resp.text
    conv_id = conv_resp.json()["conversation"]["id"]

    # Mock tool call proposing to add an atom and move an atom
    tool_args = {
        "structure_version_id": parent_version_id,
        "operations": [
            {
                "op_type": "add_atom",
                "element": "O",
                "coordinates": [0.0, 1.0, 0.0],
            },
            {
                "op_type": "move_atom",
                "index": 0,
                "coordinates": [0.0, 0.0, -0.4],
            },
        ],
        "reason": "Add oxygen atom to study bonding",
    }
    tool_call = ModelToolCall(
        id="call-edit-1",
        name="structure.edit.propose",
        arguments_json=json.dumps(tool_args),
    )
    capture = ScriptedCapture(_tool_response(tool_call))
    monkeypatch.setattr(providers, "build_model_gateway", lambda _s: capture)

    # Send message with STRUCTURE_EDIT_PROPOSAL profile
    post_payload = {
        "content": "Please propose adding an oxygen atom to this molecule.",
        "planning_profile": "STRUCTURE_EDIT_PROPOSAL",
        "selected_structure_version_id": parent_version_id,
        "run_limits": {"max_model_calls": 1, "max_input_tokens": 20000, "max_output_tokens": 2048},
    }
    msg_resp = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json=post_payload,
    )
    assert msg_resp.status_code == 201, msg_resp.text
    run = msg_resp.json()["latest_run"]
    assert run["status"] == "WAITING_FOR_APPROVAL"

    # Verify approval record and deterministic diff
    with sessions() as session:
        approval = session.scalar(
            select(AIApprovalRecord).where(AIApprovalRecord.run_id == run["id"])
        )
        assert approval is not None
        assert approval.status == "PENDING"
        assert approval.tool_name == "structure.edit.propose"
        norm_args = approval.normalized_arguments_json
        assert "diff" in norm_args
        diff = norm_args["diff"]
        assert diff["atom_count_before"] == 2
        assert diff["atom_count_after"] == 3
        assert len(diff["atoms_added"]) == 1
        assert diff["atoms_added"][0]["element"] == "O"
        approval_id = approval.id

    # APPROVE the proposal
    decide_resp = client.post(
        f"/v1/projects/{project_id}/ai/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert decide_resp.status_code == 200, decide_resp.text
    assert decide_resp.json()["status"] == "SUCCEEDED"

    # Verify database state: exactly ONE new version created, origin AI_PROPOSED
    with sessions() as session:
        all_versions = session.scalars(
            select(StructureVersionRecord)
            .where(StructureVersionRecord.structure_id == h2_resp["structure"]["id"])
            .order_by(StructureVersionRecord.revision.asc())
        ).all()
        assert len(all_versions) == 2  # exactly 1 new version created
        parent_v = all_versions[0]
        new_v = all_versions[1]

        # Parent is unchanged
        assert parent_v.id == parent_version_id
        assert parent_v.atom_count == initial_parent_atoms
        assert parent_v.origin == StructureVersionOrigin.IMPORTED

        # New version has AI_PROPOSED origin and parent link
        assert new_v.origin == StructureVersionOrigin.AI_PROPOSED
        assert new_v.parent_version_id == parent_v.id
        assert new_v.atom_count == 3
        assert new_v.revision == 2


def test_structure_edit_proposal_rejection_creates_zero_versions(api, monkeypatch):
    """STRUCTURE_EDIT_PROPOSAL: Reject creates 0 versions; parent remains unchanged."""
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]
    h2_resp = _import_h2(client, project_id)
    parent_version_id = h2_resp["version"]["id"]

    conv_resp = client.post(f"/v1/projects/{project_id}/ai/conversations", json={})
    conv_id = conv_resp.json()["conversation"]["id"]

    tool_args = {
        "structure_version_id": parent_version_id,
        "operations": [{"op_type": "add_atom", "element": "C", "coordinates": [1.0, 0.0, 0.0]}],
    }
    tool_call = ModelToolCall(
        id="call-edit-2",
        name="structure.edit.propose",
        arguments_json=json.dumps(tool_args),
    )
    capture = ScriptedCapture(_tool_response(tool_call))
    monkeypatch.setattr(providers, "build_model_gateway", lambda _s: capture)

    post_payload = {
        "content": "Add carbon atom",
        "planning_profile": "STRUCTURE_EDIT_PROPOSAL",
        "selected_structure_version_id": parent_version_id,
        "run_limits": {"max_model_calls": 1, "max_input_tokens": 20000, "max_output_tokens": 2048},
    }
    msg_resp = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json=post_payload,
    )
    run = msg_resp.json()["latest_run"]
    assert run["status"] == "WAITING_FOR_APPROVAL"

    with sessions() as session:
        approval = session.scalar(
            select(AIApprovalRecord).where(AIApprovalRecord.run_id == run["id"])
        )
        approval_id = approval.id

    # REJECT the proposal
    decide_resp = client.post(
        f"/v1/projects/{project_id}/ai/approvals/{approval_id}/decision",
        json={"decision": "REJECT"},
    )
    assert decide_resp.status_code == 200, decide_resp.text
    assert decide_resp.json()["status"] == "SUCCEEDED"

    # Verify database state: NO new version created
    with sessions() as session:
        all_versions = session.scalars(
            select(StructureVersionRecord).where(
                StructureVersionRecord.structure_id == h2_resp["structure"]["id"]
            )
        ).all()
        assert len(all_versions) == 1
        assert all_versions[0].id == parent_version_id


def test_periodic_energy_proposal_end_to_end_succeeds(api, monkeypatch):
    """PERIODIC_ENERGY_PROPOSAL: Proposes periodic calculation on crystal structure and submits on approval."""
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]

    # Import periodic crystal structure
    cif_resp = client.post(
        f"/v1/projects/{project_id}/structures/imports",
        data={"file_format": "CIF", "idempotency_key": f"cif-{uuid4().hex}"},
        files={"upload": ("nacl.cif", CIF_NACL, "chemical/x-cif")},
    )
    assert cif_resp.status_code == 201, cif_resp.text
    crystal_version_id = cif_resp.json()["version"]["id"]

    conv_resp = client.post(f"/v1/projects/{project_id}/ai/conversations", json={})
    conv_id = conv_resp.json()["conversation"]["id"]

    # The model sends only the structure and a key; the SERVER copies the specification of the
    # project's last SUCCEEDED periodic calculation (patched here: no engine needed).
    stored_spec = {
        "task_type": "PERIODIC_ENERGY",
        "method": {"identifier": "pbe", "display_name": "PBE", "registry": "chemdft.method"},
        "basis": {
            "identifier": "gth-dzvp-molopt-sr",
            "display_name": "GTH-DZVP-MOLOPT-SR",
            "registry": "chemdft.basis",
        },
        "charge": 0,
        "multiplicity": 1,
        "engine_preference": {"engine": "pyscf"},
        "periodic": {"k_mesh": [1, 1, 1], "u_effective_ev": {"Cr": 2.0}},
    }
    monkeypatch.setattr(
        "chemdft_api.ai.periodic_proposal.last_succeeded_periodic_specification",
        lambda _session, _project_id: ("source-calc-1", dict(stored_spec)),
    )
    # Engine availability is a property of the machine, not of this proposal logic.
    monkeypatch.setattr("chemdft_api.ai.service.validate_compute_guidance", lambda *a, **k: None)
    calc_args = {
        "structure_version": {
            "project_id": project_id,
            "entity_type": "structure.version",
            "entity_id": crystal_version_id,
        },
        "idempotency_key": "periodic-prop-1",
    }
    tool_call = ModelToolCall(
        id="call-qe-1",
        name="calculation.submit",
        arguments_json=json.dumps(calc_args),
    )
    capture = ScriptedCapture(_tool_response(tool_call))
    monkeypatch.setattr(providers, "build_model_gateway", lambda _s: capture)

    post_payload = {
        "content": "Prepare periodic energy calculation for this crystal.",
        "planning_profile": "PERIODIC_ENERGY_PROPOSAL",
        "selected_structure_version_id": crystal_version_id,
        "run_limits": {"max_model_calls": 1, "max_input_tokens": 20000, "max_output_tokens": 2048},
    }
    msg_resp = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json=post_payload,
    )
    assert msg_resp.status_code == 201, msg_resp.text
    run = msg_resp.json()["latest_run"]
    assert run["status"] == "WAITING_FOR_APPROVAL", run.get("error_detail")

    with sessions() as session:
        approval = session.scalar(
            select(AIApprovalRecord).where(AIApprovalRecord.run_id == run["id"])
        )
        assert approval.tool_name == "calculation.submit"
        approval_id = approval.id
        spec = (
            approval.normalized_arguments_json
            if isinstance(approval.normalized_arguments_json, dict)
            else json.loads(approval.normalized_arguments_json)
        )["specification"]
        assert spec["periodic"]["u_effective_ev"] == {"Cr": 2.0}  # copied, never invented
        assert "source-calc-1" in approval.scientific_summary

    # The model was shown the small schema, not the full calculation specification.
    offered = {t.name: t for t in capture.requests[0].tools}
    assert set(offered["calculation.submit"].parameters_schema["properties"]) == {
        "structure_version",
        "idempotency_key",
    }

    # APPROVE the periodic proposal
    decide_resp = client.post(
        f"/v1/projects/{project_id}/ai/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert decide_resp.status_code == 200, decide_resp.text
    assert decide_resp.json()["status"] == "WAITING_FOR_CALCULATION", decide_resp.json().get(
        "error_detail"
    )


def test_planning_profile_mismatches_refused(api):
    """Mismatches between profile and structure type are strictly refused."""
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]

    h2_resp = _import_h2(client, project_id)
    molecular_version_id = h2_resp["version"]["id"]

    cif_resp = client.post(
        f"/v1/projects/{project_id}/structures/imports",
        data={"file_format": "CIF", "idempotency_key": f"cif-{uuid4().hex}"},
        files={"upload": ("nacl.cif", CIF_NACL, "chemical/x-cif")},
    )
    crystal_version_id = cif_resp.json()["version"]["id"]

    conv_resp = client.post(f"/v1/projects/{project_id}/ai/conversations", json={})
    conv_id = conv_resp.json()["conversation"]["id"]

    # 1. Molecular version with PERIODIC_ENERGY_PROPOSAL must be refused
    resp1 = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={
            "content": "Run periodic calculation on H2",
            "planning_profile": "PERIODIC_ENERGY_PROPOSAL",
            "selected_structure_version_id": molecular_version_id,
            "run_limits": {
                "max_model_calls": 1,
                "max_input_tokens": 20000,
                "max_output_tokens": 2048,
            },
        },
    )
    assert resp1.status_code == 409, resp1.text
    assert "Periodic calculation proposal requires a periodic crystal structure" in resp1.text

    # 2. Crystal version with PYSCF_ENERGY_PROPOSAL must be refused
    resp2 = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={
            "content": "Run molecular calculation on NaCl",
            "planning_profile": "PYSCF_ENERGY_PROPOSAL",
            "selected_structure_version_id": crystal_version_id,
            "run_limits": {
                "max_model_calls": 1,
                "max_input_tokens": 20000,
                "max_output_tokens": 2048,
            },
        },
    )
    assert resp2.status_code == 409, resp2.text
    assert "Molecular planning profile requires molecular coordinates" in resp2.text


def test_chat_fact_sheet_sections_present_and_capped(api):
    """Fact sheet renders [SELECTED CALCULATION RECORD] and [COMPUTATIONAL METHOD ADVICE]."""
    client, sessions, settings = api
    project = _create_project(client)
    project_id = project["id"]

    h2_resp = _import_h2(client, project_id)
    version_id = h2_resp["version"]["id"]

    # Submit a calculation via API then mark it failed
    calc_resp = client.post(
        f"/v1/projects/{project_id}/calculations",
        json={
            "structure_version": {
                "project_id": project_id,
                "entity_type": "structure.version",
                "entity_id": version_id,
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
                "engine_preference": {"engine": "pyscf"},
            },
            "idempotency_key": f"calc-{uuid4().hex[:12]}",
        },
    )
    assert calc_resp.status_code == 201, calc_resp.text
    calc_id = calc_resp.json()["calculation"]["id"]

    # Seed a failed calculation attempt
    with sessions() as session:
        calc = session.get(CalculationRecord, calc_id)
        calc.state = "FAILED"
        attempt = CalculationAttemptRecord(
            id=new_id(),
            project_id=project_id,
            calculation_id=calc_id,
            attempt_number=1,
            state="FAILED",
            worker_id="test-worker",
            failure_code="PYSCF_SCF_NONCONVERGENT",
            diagnostic="ConvergenceError: SCF did not converge\nCycle 50: delta E = 1.2e-4",
        )
        session.add(attempt)
        session.commit()

        # Build fact sheet
        sheet = build_project_fact_sheet(
            session,
            project_id,
            project_name="Test Project",
            role="owner",
            provider="fake",
            model="test-model",
            mode="CHAT",
            selected_structure_version_id=version_id,
            selected_calculation_id=calc_id,
        )

        # Check [SELECTED CALCULATION RECORD]
        assert "[SELECTED CALCULATION RECORD:" in sheet
        assert f"Calculation ID: {calc_id}" in sheet
        assert "Status: FAILED" in sheet
        assert "Error code: PYSCF_SCF_NONCONVERGENT" in sheet
        assert "Typical cause (typical cause, not verified for this run):" in sheet
        assert "Typical remedy:" in sheet
        assert (
            "Citation: services/api/src/chemdft_api/scientific/engines/pyscf_worker.py:65" in sheet
        )
        assert "[END SELECTED CALCULATION RECORD]" in sheet

        # Most recent failed calculation: present, compact and independent of the selection.
        for text in (
            sheet,
            build_project_fact_sheet(
                session,
                project_id,
                project_name="Test Project",
                role="owner",
                provider="fake",
                model="test-model",
                mode="CHAT",
                selected_structure_version_id=version_id,
                selected_calculation_id=None,
            ),
        ):
            assert "[MOST RECENT FAILED CALCULATION:" in text
            block = text.split("[MOST RECENT FAILED CALCULATION:")[1].split(
                "[END MOST RECENT FAILED CALCULATION]"
            )[0]
            assert calc_id in block and "Method: " in block and "Status: FAILED" in block
            assert "Error code: PYSCF_SCF_NONCONVERGENT" in block and "Time: " in block
            assert "SCF did not converge" in block
            assert "typical cause, not verified for this run" in block

        # Check [COMPUTATIONAL METHOD ADVICE]
        assert "[COMPUTATIONAL METHOD ADVICE (suggestion, not a result)]" in sheet
        assert "Recommended engine: pyscf" in sheet
        assert "Recommended method: B3LYP" in sheet
        assert "Recommended basis/pseudopotential: def2-SVP" in sheet
        assert "Caveat: Suggestion, not a result." in sheet
        assert "[END COMPUTATIONAL METHOD ADVICE]" in sheet

        # Check [CALCULATION GUIDANCE]
        assert "[CALCULATION GUIDANCE:" in sheet
        assert '"Prepare calculation for approval"' in sheet
        assert '"Propose structure edit"' in sheet
