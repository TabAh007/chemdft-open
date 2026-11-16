"""Explicit, lower-only planning scope; never infer permissions from untrusted prose."""

from sqlalchemy import select

from ..contracts.ai_planning import (
    EnergyPlanningContext,
    PeriodicEnergyPlanningContext,
    StructureEditPlanningContext,
)
from ..geometry_eligibility import checked_bytes, require_calculation_geometry
from ..scientific.electronic_state import electronic_state_authority
from ..scientific_actions import get_structure_version_detail
from ..scientific_models import ScientificArtifactRecord, StructureVersionRecord
from .providers import AIFoundationError

ENERGY_TOOLS = frozenset({"structure.version.get", "calculation.submit"})
PERIODIC_ENERGY_TOOLS = frozenset({"structure.version.get", "calculation.submit"})
STRUCTURE_EDIT_TOOLS = frozenset({"structure.version.get", "structure.edit.propose"})


def energy_scope() -> dict[str, frozenset[str]]:
    """What a PYSCF_ENERGY_PROPOSAL run may propose, from the engine tables (one source)."""
    from ..scientific.engines.registry import CAPABILITIES

    pyscf = CAPABILITIES["pyscf"]
    return {
        "task": frozenset({"ENERGY"}),
        "engine": frozenset({"pyscf"}),
        "method": pyscf.methods,
        "basis": pyscf.basis_sets,
    }


def energy_planning_context(session, identity, context, object_store):
    version_id = context.selection.selected_structure_version_id
    version = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.id == str(version_id),
            StructureVersionRecord.project_id == str(context.project_id),
        )
    )
    if version is None:
        raise AIFoundationError("STALE_SELECTION", "Select a saved structure version for planning.")
    if not context.can_write or context.sealed:
        raise AIFoundationError("PLANNING_PROFILE_FORBIDDEN", "An editable project is required.")
    # Existing source/geometry/electronic-state guards; no engine, provider or handler invocation.
    require_calculation_geometry(session, object_store, version)
    authority = electronic_state_authority(session, object_store, version)
    for artifact_id in {version.source_artifact_id, version.canonical_artifact_id}:
        artifact = session.get(ScientificArtifactRecord, artifact_id)
        if artifact is None or artifact.project_id != version.project_id:
            raise AIFoundationError("INPUT_PROVENANCE_INVALID", "Input artifact is unavailable.")
        checked_bytes(object_store, artifact)
    detail = get_structure_version_detail(
        session, identity, version.project_id, version.structure_id, version.id
    )
    if detail.version.periodic_cell or detail.version.coordinates is None:
        raise AIFoundationError(
            "PLANNING_PROFILE_UNSUPPORTED",
            "Molecular planning profile requires molecular coordinates. For periodic structures, "
            "configure periodic calculations (PySCF periodic or Quantum ESPRESSO) directly "
            "via the Calculation panel.",
        )
    # Function descriptions remain complete in the selected wire schemas. Keep every policy
    # flag/capability/reference, but don't duplicate that prose in this versioned context.
    policies = tuple(
        p.model_copy(update={"description": ""})
        for p in context.allowed_tools
        if p.tool_id in ENERGY_TOOLS
    )
    if {p.tool_id for p in policies} != ENERGY_TOOLS:
        raise AIFoundationError("PLANNING_PROFILE_FORBIDDEN", "Required tools are unavailable.")
    projected = EnergyPlanningContext(
        **context.model_dump(exclude={"context_version", "allowed_tools"}),
        allowed_tools=policies,
        scientific_input=detail,
        electronic_state_authority=authority,
    )
    if len(projected.model_dump_json().encode()) > 32768:
        raise AIFoundationError("CONTEXT_LIMIT", "Planning input exceeds the safe context limit.")
    return projected


def periodic_energy_planning_context(session, identity, context, object_store):
    version_id = context.selection.selected_structure_version_id
    version = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.id == str(version_id),
            StructureVersionRecord.project_id == str(context.project_id),
        )
    )
    if version is None:
        raise AIFoundationError("STALE_SELECTION", "Select a saved structure version for planning.")
    if not context.can_write or context.sealed:
        raise AIFoundationError("PLANNING_PROFILE_FORBIDDEN", "An editable project is required.")
    detail = get_structure_version_detail(
        session, identity, version.project_id, version.structure_id, version.id
    )
    if detail.version.periodic_cell is None:
        raise AIFoundationError(
            "PLANNING_PROFILE_UNSUPPORTED",
            "Periodic calculation proposal requires a periodic crystal structure with a "
            "periodic cell. For molecular structures, use the Prepare calculation button in the "
            "AI box.",
        )
    from .periodic_proposal import (
        PeriodicProposalRefusalError,
        resolve_periodic_proposal_settings,
    )

    # Validate that periodic proposal logic recognizes this structure
    try:
        resolve_periodic_proposal_settings(
            is_periodic_structure=True,
            user_input_settings={"engine": "quantum_espresso", "task_type": "energy"},
            previous_calculations=None,
        )
    except PeriodicProposalRefusalError as e:
        raise AIFoundationError("PLANNING_PROFILE_UNSUPPORTED", str(e)) from None

    authority = electronic_state_authority(session, object_store, version)
    for artifact_id in {version.source_artifact_id, version.canonical_artifact_id}:
        artifact = session.get(ScientificArtifactRecord, artifact_id)
        if artifact is None or artifact.project_id != version.project_id:
            raise AIFoundationError("INPUT_PROVENANCE_INVALID", "Input artifact is unavailable.")
        checked_bytes(object_store, artifact)
    policies = tuple(
        p.model_copy(update={"description": ""})
        for p in context.allowed_tools
        if p.tool_id in PERIODIC_ENERGY_TOOLS
    )
    if {p.tool_id for p in policies} != PERIODIC_ENERGY_TOOLS:
        raise AIFoundationError("PLANNING_PROFILE_FORBIDDEN", "Required tools are unavailable.")
    projected = PeriodicEnergyPlanningContext(
        **context.model_dump(exclude={"context_version", "allowed_tools"}),
        allowed_tools=policies,
        scientific_input=detail,
        electronic_state_authority=authority,
    )
    if len(projected.model_dump_json().encode()) > 32768:
        raise AIFoundationError("CONTEXT_LIMIT", "Planning input exceeds the safe context limit.")
    return projected


def structure_edit_planning_context(session, identity, context, object_store):
    version_id = context.selection.selected_structure_version_id
    version = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.id == str(version_id),
            StructureVersionRecord.project_id == str(context.project_id),
        )
    )
    if version is None:
        raise AIFoundationError("STALE_SELECTION", "Select a saved structure version for planning.")
    if not context.can_write or context.sealed:
        raise AIFoundationError("PLANNING_PROFILE_FORBIDDEN", "An editable project is required.")
    detail = get_structure_version_detail(
        session, identity, version.project_id, version.structure_id, version.id
    )
    policies_list = [
        p.model_copy(update={"description": ""})
        for p in context.allowed_tools
        if p.tool_id == "structure.version.get"
    ]
    if not policies_list:
        raise AIFoundationError("PLANNING_PROFILE_FORBIDDEN", "Required tools are unavailable.")
    from ..contracts.ai_foundation import AIToolPolicy

    policies_list.append(
        AIToolPolicy(
            tool_id="structure.edit.propose",
            description="",
            input_schema_ref="chemdft.structure-edit-propose-input.v1",
            output_schema_ref="chemdft.structure-edit-propose-output.v1",
            required_capabilities=frozenset({"structure.write"}),
            required_project_role="WRITE",
            project_scope="CURRENT_PROJECT",
            category="MUTATION",
            audit_category="ai.mutation",
            scientific_compute=False,
            mutates=True,
            approval_required=True,
            authoritative_output=False,
        )
    )
    policies = tuple(policies_list)
    projected = StructureEditPlanningContext(
        **context.model_dump(exclude={"context_version", "allowed_tools"}),
        allowed_tools=policies,
        scientific_input=detail,
    )
    if len(projected.model_dump_json().encode()) > 32768:
        raise AIFoundationError("CONTEXT_LIMIT", "Planning input exceeds the safe context limit.")
    return projected


def validate_profile_submission(context, arguments):
    if isinstance(context, EnergyPlanningContext):
        spec = arguments.get("specification") or {}
        engine = (spec.get("engine_preference") or {}).get("engine")
        if (
            spec.get("task_type") != "ENERGY"
            or engine != "pyscf"
            or arguments.get("structure_version", {}).get("entity_id")
            != str(context.selection.selected_structure_version_id)
        ):
            raise AIFoundationError(
                "PLANNING_PROFILE_MISMATCH",
                "This profile permits only a PySCF ENERGY proposal for the selected version.",
            )
    elif isinstance(context, PeriodicEnergyPlanningContext):
        spec = arguments.get("specification") or {}
        engine = (spec.get("engine_preference") or {}).get("engine")
        if (
            spec.get("task_type") not in {"ENERGY", "PERIODIC_ENERGY"}
            or engine not in {"quantum_espresso", "qe", "pyscf"}
            or arguments.get("structure_version", {}).get("entity_id")
            != str(context.selection.selected_structure_version_id)
        ):
            raise AIFoundationError(
                "PLANNING_PROFILE_MISMATCH",
                "This profile permits only a periodic calculation proposal "
                "(Quantum ESPRESSO or PySCF) for the selected periodic version.",
            )
    elif isinstance(context, StructureEditPlanningContext):
        selected_vid = str(context.selection.selected_structure_version_id)
        if str(arguments.get("structure_version_id")) != selected_vid:
            raise AIFoundationError(
                "PLANNING_PROFILE_MISMATCH",
                "This profile permits only structure edits for the selected structure version.",
            )
