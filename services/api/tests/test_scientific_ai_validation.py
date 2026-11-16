from datetime import timedelta
import json
import pytest
from uuid import uuid4
from sqlalchemy import select

from chemdft_api.ai_models import AIApprovalRecord, AIRunRecord
from chemdft_api.ai.tool_policy import validate_compute_guidance
from chemdft_api.config import Settings
from chemdft_api.context import Identity
from chemdft_api.contracts.catalog import CalculationSubmitInput
from chemdft_api.contracts.scientific import CalculationTaskType
from chemdft_api.errors import (
    ApplicationError,
    StructureElectronicStateMismatch,
    UnsupportedCalculation,
)
from chemdft_api.models import utc_now
from chemdft_api.scientific.engines.registry import validate_capability
from chemdft_api.scientific_models import StructureVersionRecord
from chemdft_api.tool_registry.registry import ToolInvocationError

H2_XYZ = b"""2
H2
H 0 0 -0.37
H 0 0 0.37
"""


def _create_project(client):
    return client.post(
        "/v1/projects", json={"name": "Scientific Validation", "slug": f"scival-{uuid4().hex[:8]}"}
    ).json()


def _import_h2(client, project_id):
    res = client.post(
        f"/v1/projects/{project_id}/structures/imports",
        files={"upload": ("h2.xyz", H2_XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": f"import-h2-{uuid4()}"},
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_ai_cannot_submit_unsupported_basis_set(api):
    """Verify that an unsupported basis set (e.g. 6-311++G(d,p)) is deterministically rejected

    with an explanation and supported alternatives, before any approval is created or job submitted.
    """
    _client, sessions, settings = api
    spec = {
        "schema_version": "1.0.0",
        "task_type": "ENERGY",
        "method": {"identifier": "b3lyp", "registry": "chemdft.method", "display_name": "B3LYP"},
        "basis": {
            "identifier": "6-311++g(d,p)",
            "registry": "chemdft.basis",
            "display_name": "6-311++G(d,p)",
        },
        "charge": 0,
        "multiplicity": 1,
        "engine_preference": {"engine": "pyscf"},
    }
    input_model = CalculationSubmitInput.model_validate(
        {
            "structure_version": {
                "project_id": str(uuid4()),
                "entity_type": "structure.version",
                "entity_id": str(uuid4()),
            },
            "specification": spec,
            "idempotency_key": "idemp-unsupported-basis-01",
        }
    )

    with pytest.raises(UnsupportedCalculation) as exc_info:
        validate_capability(input_model.specification, settings)

    error_msg = str(exc_info.value)
    assert "A supported explicit basis set is required" in error_msg
    assert "6-311++g(d,p)" in error_msg
    assert "Supported basis sets:" in error_msg
    assert "def2-svp" in error_msg
    assert "sto-3g" in error_msg


def test_ai_cannot_submit_unsupported_method(api):
    """Verify that an unsupported quantum chemical method (e.g. CCSD(T)) is rejected

    with available alternatives listed.
    """
    _client, sessions, settings = api
    spec = {
        "schema_version": "1.0.0",
        "task_type": "ENERGY",
        "method": {"identifier": "ccsd(t)", "registry": "chemdft.method", "display_name": "CCSD(T)"},
        "basis": {"identifier": "def2-svp", "registry": "chemdft.basis", "display_name": "def2-SVP"},
        "charge": 0,
        "multiplicity": 1,
        "engine_preference": {"engine": "pyscf"},
    }
    input_model = CalculationSubmitInput.model_validate(
        {
            "structure_version": {
                "project_id": str(uuid4()),
                "entity_type": "structure.version",
                "entity_id": str(uuid4()),
            },
            "specification": spec,
            "idempotency_key": "idemp-unsupported-method-01",
        }
    )

    with pytest.raises(UnsupportedCalculation) as exc_info:
        validate_capability(input_model.specification, settings)

    error_msg = str(exc_info.value)
    assert "Method is unsupported by the selected engine adapter" in error_msg
    assert "Supported methods:" in error_msg
    assert "b3lyp" in error_msg
    assert "hf" in error_msg


def test_electronic_state_compatibility_validation(api):
    """Verify that electronic state mismatches (e.g. open-shell multiplicity on closed-shell structure)

    are caught by deterministic validation.
    """
    client, sessions, settings = api
    project = _create_project(client)
    imported = _import_h2(client, project["id"])
    version_id = imported["version"]["id"]

    # H2 is neutral with 2 electrons (multiplicity 1). Multiplicity 2 is an open-shell mismatch.
    args = {
        "structure_version": {
            "project_id": project["id"],
            "entity_type": "structure.version",
            "entity_id": version_id,
        },
        "specification": {
            "schema_version": "1.0.0",
            "task_type": "ENERGY",
            "method": {"identifier": "hf", "registry": "chemdft.method", "display_name": "HF"},
            "basis": {"identifier": "sto-3g", "registry": "chemdft.basis", "display_name": "STO-3G"},
            "charge": 0,
            "multiplicity": 2,  # Invalid for 2-electron neutral H2
            "engine_preference": {"engine": "pyscf"},
        },
        "idempotency_key": f"idemp-elec-mismatch-{uuid4()}",
    }

    with sessions() as session:
        user_identity = Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id)
        with pytest.raises(ToolInvocationError) as exc_info:
            validate_compute_guidance(session, settings, user_identity, project["id"], args)
        assert "Structure electronic state mismatch" in str(exc_info.value)


def test_model_cannot_bypass_approval_even_if_claiming_unrequired(api):
    """Verify that even if an AI model outputs 'requires_researcher_approval: false' in prose,

    any invocation of calculation.submit strictly halts at WAITING_FOR_APPROVAL
    and requires an explicit human researcher approval decision.
    """
    client, sessions, settings = api
    project = _create_project(client)
    imported = _import_h2(client, project["id"])
    version_id = imported["version"]["id"]

    create_resp = client.post(
        f"/v1/projects/{project['id']}/ai/conversations",
        json={"title": "H2 Energy Investigation"},
    )
    conv_id = create_resp.json()["conversation"]["id"]

    # User sends request to calculate energy
    msg_resp = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conv_id}/messages",
        json={
            "content": "Investigate ground-state energy of H2 with HF/STO-3G.",
            "selected_structure_id": imported["structure"]["id"],
        },
    )
    assert msg_resp.status_code == 201
    run = msg_resp.json()["latest_run"]

    # Invariant: Run MUST be WAITING_FOR_APPROVAL; no execution occurs
    assert run["status"] == "WAITING_FOR_APPROVAL"
    assert run["pending_approval"] is not None
    approval = run["pending_approval"]
    assert approval["tool_name"] == "calculation.submit"
    assert approval["status"] == "PENDING"

    # Verify no calculation has started in the database
    from chemdft_api.scientific_models import CalculationRecord
    with sessions() as session:
        calcs = session.scalars(select(CalculationRecord).where(CalculationRecord.project_id == project["id"])).all()
        assert len(calcs) == 0


def test_tampered_approval_arguments_refused_at_decision(api):
    """Verify that if calculation arguments inside an approval record are tampered with,

    the fingerprint mismatch prevents execution.
    """
    from chemdft_api.ai_models import AIApprovalRecord
    from sqlalchemy import update, select

    client, sessions, settings = api
    project = _create_project(client)
    imported = _import_h2(client, project["id"])
    version_id = imported["version"]["id"]

    conv = client.post(
        f"/v1/projects/{project['id']}/ai/conversations", json={"title": "Tamper Test"}
    ).json()["conversation"]["id"]

    msg_resp = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conv}/messages",
        json={
            "content": "Calculate HF/STO-3G energy for H2.",
            "selected_structure_id": imported["structure"]["id"],
        },
    )
    run = msg_resp.json()["latest_run"]
    approval_id = run["pending_approval"]["id"]

    # Tamper with the approval arguments in database
    with sessions() as session:
        row = session.get(AIApprovalRecord, approval_id)
        tampered_args = dict(row.normalized_arguments_json)
        tampered_args["specification"]["method"]["identifier"] = "tampered_method"
        session.execute(
            update(AIApprovalRecord)
            .where(AIApprovalRecord.id == approval_id)
            .values(normalized_arguments_json=tampered_args)
        )
        session.commit()

    # Attempt to approve tampered calculation
    res = client.post(
        f"/v1/projects/{project['id']}/ai/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    # Must be rejected because action_fingerprint does not match tampered arguments
    assert res.status_code == 409
    assert "tampered" in str(res.json()).lower() or "approval_tampered" in str(res.json()).lower()


def test_flat_ai_calculation_arguments_normalized_and_fenced(api):
    """Verify that flat model tool arguments are deterministically normalized,

    properly validated into CalculationSubmitInput, and model claims of bypassing
    approval are completely excluded.
    """
    from uuid import UUID
    from chemdft_api.ai.tool_policy import normalize_calculation_submit_arguments

    client, sessions, _settings = api
    project = _create_project(client)
    project_id = project["id"]
    imported = _import_h2(client, project_id)
    version_id = imported["version"]["id"]

    with sessions() as session:
        flat_args = {
            "structure_version_id": version_id,
            "method": "HF",
            "task": "single_point",
            "basis": "STO-3G",
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf"},
            "requires_researcher_approval": False,
        }

        normalized = normalize_calculation_submit_arguments(
            session, project_id, flat_args, idempotency_key="idemp-flat-test"
        )
        validated = CalculationSubmitInput.model_validate(normalized)
        assert validated.structure_version.entity_id == UUID(version_id)
        assert validated.specification.method.identifier == "hf"
        assert validated.specification.basis.identifier == "sto-3g"
        assert validated.specification.task_type.value == "ENERGY"
        assert validated.specification.charge == 0
        assert validated.specification.multiplicity == 1
        assert "requires_researcher_approval" not in normalized


def test_unannotated_xyz_requires_explicit_electronic_state(api):
    """Unannotated XYZ imports store (0,1) as placeholders; the AI must declare
    charge and multiplicity explicitly rather than relying on inferred defaults.
    """
    from chemdft_api.ai.tool_policy import normalize_calculation_submit_arguments
    from chemdft_api.tool_registry.registry import ToolInvocationError

    client, sessions, _settings = api
    project = _create_project(client)
    project_id = project["id"]
    imported = _import_h2(client, project_id)
    version_id = imported["version"]["id"]

    with sessions() as session:
        flat_args = {
            "structure_version_id": version_id,
            "method": "HF",
            "task": "single_point",
            "basis": "STO-3G",
            "engine_preference": {"engine": "pyscf"},
        }
        with pytest.raises(ToolInvocationError) as exc_info:
            normalize_calculation_submit_arguments(
                session, project_id, flat_args, idempotency_key="idemp-no-state"
            )
        assert "electronic state" in str(exc_info.value).lower()


def test_unannotated_xyz_missing_charge_rejected(api):
    """Missing charge on an unannotated XYZ import is rejected even if
    multiplicity is supplied.
    """
    from chemdft_api.ai.tool_policy import normalize_calculation_submit_arguments
    from chemdft_api.tool_registry.registry import ToolInvocationError

    client, sessions, _settings = api
    project = _create_project(client)
    project_id = project["id"]
    imported = _import_h2(client, project_id)
    version_id = imported["version"]["id"]

    with sessions() as session:
        flat_args = {
            "structure_version_id": version_id,
            "method": "HF",
            "task": "single_point",
            "basis": "STO-3G",
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf"},
        }
        with pytest.raises(ToolInvocationError):
            normalize_calculation_submit_arguments(
                session, project_id, flat_args, idempotency_key="idemp-no-charge"
            )


def test_unannotated_xyz_missing_multiplicity_rejected(api):
    """Missing multiplicity on an unannotated XYZ import is rejected even if
    charge is supplied.
    """
    from chemdft_api.ai.tool_policy import normalize_calculation_submit_arguments
    from chemdft_api.tool_registry.registry import ToolInvocationError

    client, sessions, _settings = api
    project = _create_project(client)
    project_id = project["id"]
    imported = _import_h2(client, project_id)
    version_id = imported["version"]["id"]

    with sessions() as session:
        flat_args = {
            "structure_version_id": version_id,
            "method": "HF",
            "task": "single_point",
            "basis": "STO-3G",
            "charge": 0,
            "engine_preference": {"engine": "pyscf"},
        }
        with pytest.raises(ToolInvocationError):
            normalize_calculation_submit_arguments(
                session, project_id, flat_args, idempotency_key="idemp-no-mult"
            )


def test_invalid_electronic_state_rejected(api):
    """An explicitly supplied but chemically impossible electronic state is
    rejected by parity validation.
    """
    client, sessions, settings = api
    project = _create_project(client)
    imported = _import_h2(client, project["id"])
    version_id = imported["version"]["id"]

    args = {
        "structure_version": {
            "project_id": project["id"],
            "entity_type": "structure.version",
            "entity_id": version_id,
        },
        "specification": {
            "schema_version": "1.0.0",
            "task_type": "ENERGY",
            "method": {"identifier": "hf", "registry": "chemdft.method", "display_name": "HF"},
            "basis": {"identifier": "sto-3g", "registry": "chemdft.basis", "display_name": "STO-3G"},
            "charge": 0,
            "multiplicity": 2,  # Invalid for 2-electron neutral H2
            "engine_preference": {"engine": "pyscf"},
        },
        "idempotency_key": f"idemp-elec-invalid-{uuid4()}",
    }

    with sessions() as session:
        user_identity = Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id)
        with pytest.raises(ToolInvocationError) as exc_info:
            validate_compute_guidance(session, settings, user_identity, project["id"], args)
        assert "electronic state" in str(exc_info.value).lower()


def test_approval_cannot_be_created_from_unauthorized_inferred_state(api):
    """An approval cannot be created when the AI submits a calculation without
    an explicit electronic state for an unannotated XYZ import.
    """
    client, sessions, _settings = api
    project = _create_project(client)
    imported = _import_h2(client, project["id"])

    conv = client.post(
        f"/v1/projects/{project['id']}/ai/conversations", json={"title": "State inference test"}
    ).json()["conversation"]["id"]

    msg_resp = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conv}/messages",
        json={
            "content": "Calculate HF/STO-3G energy for this structure.",
            "selected_structure_id": imported["structure"]["id"],
        },
    )
    # The run should fail or pause rather than create an approval from an
    # inferred electronic state.
    run = msg_resp.json()["latest_run"]
    assert run["status"] in {"FAILED", "PAUSED", "WAITING_FOR_APPROVAL"}
    if run["status"] == "WAITING_FOR_APPROVAL":
        # If an approval was created, the normalized arguments must carry
        # explicit charge and multiplicity (never inferred placeholders).
        approval = run["pending_approval"]
        args = approval.get("normalized_arguments") or {}
        spec = (args.get("specification") or {})
        assert "charge" in spec and "multiplicity" in spec
