"""AI exposure is a strict subset of the product registry, never a scientific producer."""

from typing import Any
from sqlalchemy.orm import Session

from ..actions import authorize_project_access
from ..config import Settings
from ..context import ServiceIdentity
from ..contracts.ai_foundation import AIToolPolicy
from ..contracts.tools import ToolErrorCode
from ..navigator.service import get_navigator
from ..project_access import ProjectCapability, can
from ..tool_registry.registry import ToolInvocationContext, ToolInvocationError, ToolRegistry

# No project.create, structure.version.create, result writer, arbitrary code or provenance writer.
AI_READ_TOOLS = frozenset(
    {
        "project.get",
        "structure.list",
        "structure.get",
        "structure.version.get",
        "structure_candidate.list",
        "structure_candidate.get",
        "structure_candidate.representation.list",
        "document.list",
        "document.get",
        "document.evidence.list",
        "dataset.get",
        "calculation.get",
        "compute.estimate",
        "knowledge.search",
        "investigation.get",
        "navigator.get",
        "examples.list",
        "molecule.resolve",
        "structure_candidate.validate_graph",
    }
)
AI_WRITE_TOOLS = frozenset({"calculation.submit", "calculation.cancel"})
AI_PLANNING_WRITE_TOOLS = frozenset({"structure.edit.propose"})
AI_BOUNDED_WRITE_TOOLS = frozenset(
    {
        "molecule.draft.create",
        "document.figures.extract",
        "structure_candidate.recognize",
        "structure_candidate.request_review",
    }
)
AI_TOOLS = AI_READ_TOOLS | AI_WRITE_TOOLS | AI_BOUNDED_WRITE_TOOLS


def tool_policies(registry: ToolRegistry, *, can_write: bool) -> tuple[AIToolPolicy, ...]:
    result = []
    for d in registry.discover():
        if d.name not in AI_TOOLS:
            continue
        if (d.name in AI_WRITE_TOOLS or d.name in AI_BOUNDED_WRITE_TOOLS) and not can_write:
            continue
        mutation = (d.name in AI_WRITE_TOOLS) or (d.name in AI_BOUNDED_WRITE_TOOLS)
        approval_req = d.name in AI_WRITE_TOOLS
        compute = d.name == "calculation.submit"
        result.append(
            AIToolPolicy(
                tool_id=d.name,
                description=d.description,
                input_schema_ref=d.input_schema_ref,
                output_schema_ref=d.output_schema_ref,
                required_capabilities=d.required_capabilities,
                required_project_role="WRITE" if mutation else "READ",
                project_scope="PUBLIC_CATALOGUE"
                if d.name == "examples.list"
                else "CURRENT_PROJECT",
                category="SCIENTIFIC_EXECUTION" if compute else "MUTATION" if mutation else "READ",
                approval_required=approval_req,
                mutates=mutation,
                scientific_compute=compute,
                authoritative_output=False,
                audit_category="ai.compute"
                if compute
                else "ai.mutation"
                if mutation
                else "ai.read",
            )
        )
    return tuple(result)


def guard_ai_tool(
    session: Session,
    settings: Settings,
    context: ToolInvocationContext,
    definition,
    arguments: dict,
) -> None:
    if isinstance(context.identity, ServiceIdentity) or not context.project_id:
        raise ToolInvocationError(
            ToolErrorCode.FORBIDDEN, "AI tools require current human project authorization."
        )
    _project, member = authorize_project_access(session, context.identity, str(context.project_id))
    if definition.name not in (AI_TOOLS | AI_PLANNING_WRITE_TOOLS):
        raise ToolInvocationError(
            ToolErrorCode.FORBIDDEN, "This product tool is not permitted for AI."
        )
    if definition.name == "project.get" and str(arguments.get("project_id")) != str(
        context.project_id
    ):
        raise ToolInvocationError(
            ToolErrorCode.FORBIDDEN, "AI tools cannot change the current project scope."
        )
    if definition.name in AI_BOUNDED_WRITE_TOOLS:
        if not can(member, ProjectCapability.WRITE):
            raise ToolInvocationError(
                ToolErrorCode.FORBIDDEN,
                "A current editor/owner role is required for this operation.",
            )
        if definition.name == "structure_candidate.recognize":
            pref = (arguments.get("engine_preference") or arguments.get("engine") or "").lower()
            if pref in {"dev", "development", "test", "chemdft-development-engine"} or (
                pref and pref not in {"decimer", "decimer-image_transformer"}
            ):
                raise ToolInvocationError(
                    ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
                    "Development recognition engine is not permitted in autonomous "
                    "scientific workflows; only real DECIMER is permitted.",
                )
    elif definition.name in (AI_WRITE_TOOLS | AI_PLANNING_WRITE_TOOLS):
        if not can(member, ProjectCapability.WRITE):
            raise ToolInvocationError(
                ToolErrorCode.FORBIDDEN,
                "A current editor/owner role is required; templates remain sealed.",
            )
        if not context.approval_references:
            raise ToolInvocationError(
                ToolErrorCode.APPROVAL_REQUIRED, "This AI mutation requires explicit approval."
            )
        if definition.name == "calculation.submit":
            validate_compute_guidance(
                session, settings, context.identity, str(context.project_id), arguments
            )



def validate_compute_guidance(
    session: Session,
    settings: Settings,
    identity,
    project_id: str,
    arguments: dict,
    *,
    object_store=None,
) -> None:
    from sqlalchemy import select

    from ..aws_compute import aws_supports_specification
    from ..contracts.catalog import CalculationSubmitInput
    from ..contracts.scientific import CalculationTaskType
    from ..errors import StructureElectronicStateMismatch, UnsupportedCalculation
    from ..navigator.capabilities import aws_proposals_available
    from ..scientific.electronic_state import electronic_state_authority
    from ..scientific.engines.normalization import validate_structure_electronic_state
    from ..scientific.engines.registry import (
        validate_capability,
        validate_pyscf_elements,
        validate_pyscf_periodic_elements,
    )
    from ..scientific_models import StructureVersionRecord
    from ..storage import ObjectStore

    parsed = CalculationSubmitInput.model_validate(arguments)
    if (
        aws_proposals_available(settings, parsed.provider_preference)
        and not aws_supports_specification(parsed.specification)
        and (parsed.provider_preference == "CLOUD" or not settings.compute_local_enabled)
    ):
        raise ToolInvocationError(
            ToolErrorCode.CAPABILITY_UNAVAILABLE,
            "AWS execution currently supports PySCF single-point energy, geometry optimization, frequency analysis, thermochemistry, molecular orbitals and TDDFT, and xTB (GFN2) single-point energy and geometry optimization only.",
        )
    # Same implemented engine/method/basis validation used by the normal compute path.
    validate_capability(parsed.specification, settings)
    if (
        str(parsed.structure_version.project_id) != project_id
        or parsed.structure_version.entity_type != "structure.version"
    ):
        raise ToolInvocationError(
            ToolErrorCode.FORBIDDEN, "Calculation target must be in the current project."
        )

    # Check StructureVersionRecord and validate electronic state
    version = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.id == str(parsed.structure_version.entity_id),
            StructureVersionRecord.project_id == project_id,
        )
    )
    if version is None:
        raise ToolInvocationError(
            ToolErrorCode.NOT_FOUND, "Target structure version does not exist in project."
        )

    # Determine whether the structure version carries authoritative electronic
    # state or whether the researcher must declare it at calculation time.
    xyz_declaration = False
    if object_store is not None:
        try:
            state_binding = electronic_state_authority(session, object_store, version)
            xyz_declaration = state_binding.get("authority") == "CALCULATION_USER_DECLARED"
        except StructureElectronicStateMismatch as error:
            raise ToolInvocationError(
                ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
                f"Structure electronic state authority cannot be established: {error.detail}",
            ) from error
    else:
        # Without an object store we cannot verify XYZ import provenance; fail
        # closed rather than inferring neutral singlet from placeholders.
        from ..scientific_models import ScientificArtifactRecord

        source = session.get(ScientificArtifactRecord, version.source_artifact_id)
        if (
            version.origin == "IMPORTED"
            and not version.representation_json.get("geometry_acceptance")
            and source is not None
            and source.format_identifier.upper() == "XYZ"
        ):
            xyz_declaration = True

    try:
        validate_structure_electronic_state(
            version,
            parsed.specification,
            xyz_calculation_declaration=xyz_declaration,
        )
    except StructureElectronicStateMismatch as error:
        raise ToolInvocationError(
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            f"Structure electronic state mismatch: {error.detail}",
        ) from error

    # Element support check for PySCF
    if (
        parsed.specification.engine_preference.engine.lower() == "pyscf"
        and parsed.specification.basis
    ):
        coordinates = (version.representation_json or {}).get("coordinates", {})
        atoms = coordinates.get("atoms", [])
        if atoms:
            atomic_numbers = [
                atom.get("atomic_number") for atom in atoms if "atomic_number" in atom
            ]
            try:
                if (
                    parsed.specification.task_type == CalculationTaskType.PERIODIC_ENERGY
                    or version.periodic_cell_json is not None
                ):
                    validate_pyscf_periodic_elements(atomic_numbers)
                else:
                    validate_pyscf_elements(parsed.specification.basis.identifier, atomic_numbers)
            except UnsupportedCalculation as error:
                raise ToolInvocationError(
                    ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
                    f"Unsupported elements for engine: {error.detail}",
                ) from error

    # Periodic energy calculations are validated by engine capability rules above;
    # they do not flow through Navigator's molecular task catalogue.
    if (
        parsed.specification.task_type == CalculationTaskType.PERIODIC_ENERGY
        or version.periodic_cell_json is not None
    ):
        return

    mapping = {
        "ENERGY": ("energy", "calculation.single_point"),
        "GEOMETRY_OPTIMIZATION": ("optimize", "calculation.optimize"),
        "ORBITAL": ("orbitals", "calculation.orbitals"),
        "FREQUENCY": ("raman", "spectra.predict_raman")
        if parsed.specification.raman
        else ("ir", "spectra.predict_ir"),
        "TDDFT": ("uv_vis", "spectra.predict_uv_vis"),
        "THERMOCHEMISTRY": ("thermochemistry", "thermochemistry.calculate"),
    }
    choice = mapping.get(parsed.specification.task_type.value)
    if not choice:
        raise ToolInvocationError(
            ToolErrorCode.CAPABILITY_UNAVAILABLE,
            "This scientific task is not supported by the current Navigator.",
        )
    state = get_navigator(
        session,
        identity,
        project_id,
        settings,
        goal=choice[0],
        structure_version_id=str(parsed.structure_version.entity_id),
        provider_preference=parsed.provider_preference,
    )
    if choice[1] not in {a.action_id for a in state.next}:
        reasons = next((a.reasons for a in state.blocked if a.action_id == choice[1]), ())
        raise ToolInvocationError(
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            "Navigator does not permit this action: "
            + (
                ", ".join(r.code for r in reasons)
                or "action is not in the current NEXT catalogue (including completed goals)"
            ),
        )


def normalize_calculation_submit_arguments(
    session: Session,
    project_id: str,
    arguments: dict,
    *,
    idempotency_key: str | None = None,
    object_store=None,
) -> dict:
    import json
    from uuid import uuid4
    from sqlalchemy import select
    from ..errors import StructureElectronicStateMismatch
    from ..scientific.electronic_state import electronic_state_authority
    from ..scientific_models import ScientificArtifactRecord, StructureVersionRecord
    from ..tool_registry.registry import ToolErrorCode, ToolInvocationError

    # Unwrap any stringified JSON objects passed by LLM adapters
    if isinstance(arguments.get("structure_version"), str):
        trimmed = arguments["structure_version"].strip()
        if trimmed.startswith("{") and trimmed.endswith("}"):
            try:
                arguments["structure_version"] = json.loads(trimmed)
            except Exception:
                pass

    if isinstance(arguments.get("specification"), str):
        trimmed = arguments["specification"].strip()
        if trimmed.startswith("{") and trimmed.endswith("}"):
            try:
                arguments["specification"] = json.loads(trimmed)
            except Exception:
                pass

    if isinstance(arguments.get("structure_version_id"), str):
        trimmed = arguments["structure_version_id"].strip()
        if trimmed.startswith("{") and trimmed.endswith("}"):
            try:
                parsed_sv = json.loads(trimmed)
                if isinstance(parsed_sv, dict):
                    arguments["structure_version"] = parsed_sv
            except Exception:
                pass

    v_id: str | None = None
    sv_entity_id: str | None = None
    if "structure_version" in arguments:
        sv = arguments["structure_version"]
        if isinstance(sv, dict):
            sv_entity_id = str(sv.get("entity_id") or sv.get("id") or "") or None
            v_id = sv_entity_id
        elif isinstance(sv, str):
            sv_entity_id = sv
            v_id = sv
    alt_sv_id = str(arguments.get("structure_version_id") or "") or None
    # Reject conflicting structure references: if both structure_version and
    # structure_version_id are supplied they must agree, otherwise the model could
    # target an unintended structure.
    if sv_entity_id and alt_sv_id and sv_entity_id != alt_sv_id:
        raise ToolInvocationError(
            ToolErrorCode.VALIDATION_ERROR,
            "Conflicting structure_version references were supplied.",
        )
    if not v_id:
        v_id = alt_sv_id

    if not v_id:
        records = session.scalars(
            select(StructureVersionRecord).where(StructureVersionRecord.project_id == project_id)
        ).all()
        if len(records) == 1:
            v_id = records[0].id

    if not v_id:
        raise ToolInvocationError(
            ToolErrorCode.VALIDATION_ERROR,
            "A target structure_version is required to submit a calculation.",
        )

    version = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.id == v_id,
            StructureVersionRecord.project_id == project_id,
        )
    )
    if version is None:
        raise ToolInvocationError(
            ToolErrorCode.NOT_FOUND,
            f"Target structure version '{v_id}' does not exist in project.",
        )

    structure_version_ref = {
        "project_id": project_id,
        "entity_type": "structure.version",
        "entity_id": v_id,
    }

    raw_spec = arguments.get("specification") if isinstance(arguments.get("specification"), dict) else {}
    spec: dict[str, Any] = dict(raw_spec)

    raw_task = spec.get("task_type") or arguments.get("task_type") or arguments.get("task")
    if not raw_task:
        raise ToolInvocationError(
            ToolErrorCode.VALIDATION_ERROR,
            "A task_type is required to submit a calculation.",
        )
    task_map = {
        "single_point": "ENERGY",
        "energy": "ENERGY",
        "optimize": "GEOMETRY_OPTIMIZATION",
        "optimization": "GEOMETRY_OPTIMIZATION",
        "geometry_optimization": "GEOMETRY_OPTIMIZATION",
        "orbital": "ORBITAL",
        "orbitals": "ORBITAL",
        "molecular_orbital": "ORBITAL",
        "frequency": "FREQUENCY",
        "frequencies": "FREQUENCY",
        "vibrational": "FREQUENCY",
        "tddft": "TDDFT",
        "uv_vis": "TDDFT",
        "thermochemistry": "THERMOCHEMISTRY",
        "periodic_energy": "PERIODIC_ENERGY",
    }
    resolved_task = task_map.get(str(raw_task).lower(), str(raw_task).upper())
    if version.periodic_cell_json is not None and resolved_task == "ENERGY":
        resolved_task = "PERIODIC_ENERGY"
    spec["task_type"] = resolved_task

    raw_method = spec.get("method") or arguments.get("method")
    if not raw_method:
        raise ToolInvocationError(
            ToolErrorCode.VALIDATION_ERROR,
            "A method is required to submit a calculation.",
        )
    from ..scientific.engines.registry import authoritative_method

    if isinstance(raw_method, str):
        m_ident = raw_method.lower()
    elif isinstance(raw_method, dict):
        m_ident = str(raw_method.get("identifier", "")).lower()
    else:
        m_ident = ""
    if not m_ident:
        raise ToolInvocationError(
            ToolErrorCode.VALIDATION_ERROR,
            "A method identifier is required to submit a calculation.",
        )
    meta = authoritative_method(m_ident)
    # display_name and registry always come from the server catalog; the model
    # cannot control labelling or namespace. Fall back to a safe default only if
    # the identifier is not yet catalogued (validation will reject it downstream).
    spec["method"] = {
        "identifier": m_ident,
        "display_name": (meta or {}).get("display_name", m_ident.upper()),
        "registry": (meta or {}).get("registry", "chemdft.method"),
    }

    raw_basis = spec.get("basis") or arguments.get("basis")
    from ..scientific.engines.registry import authoritative_basis

    if isinstance(raw_basis, str):
        b_ident = raw_basis.lower()
    elif isinstance(raw_basis, dict):
        b_ident = str(raw_basis.get("identifier", "")).lower()
    else:
        b_ident = ""
    if b_ident:
        b_meta = authoritative_basis(b_ident)
        spec["basis"] = {
            "identifier": b_ident,
            "display_name": (b_meta or {}).get("display_name", b_ident.upper()),
            "registry": (b_meta or {}).get("registry", "chemdft.basis"),
        }
    else:
        spec["basis"] = None

    # Determine electronic-state authority before resolving charge/multiplicity.
    # Unannotated XYZ imports store (0, 1) as placeholders, not authoritative
    # declarations; the researcher must supply an explicit validated state.
    xyz_declaration = False
    if object_store is not None:
        try:
            state_binding = electronic_state_authority(session, object_store, version)
            xyz_declaration = state_binding.get("authority") == "CALCULATION_USER_DECLARED"
        except StructureElectronicStateMismatch:
            xyz_declaration = True  # fail closed: require explicit declaration
    else:
        source = session.get(ScientificArtifactRecord, version.source_artifact_id)
        if (
            version.origin == "IMPORTED"
            and not version.representation_json.get("geometry_acceptance")
            and source is not None
            and source.format_identifier.upper() == "XYZ"
        ):
            xyz_declaration = True

    has_explicit_charge = "charge" in spec or "charge" in arguments
    has_explicit_multiplicity = "multiplicity" in spec or "multiplicity" in arguments
    if xyz_declaration and not (has_explicit_charge and has_explicit_multiplicity):
        raise ToolInvocationError(
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            "This structure does not carry an authoritative electronic state. "
            "Explicit charge and multiplicity are required before submission.",
        )

    if "charge" not in spec and "charge" in arguments:
        spec["charge"] = arguments["charge"]
    elif "charge" not in spec:
        spec["charge"] = version.overall_charge if version.overall_charge is not None else 0

    if "multiplicity" not in spec and "multiplicity" in arguments:
        spec["multiplicity"] = arguments["multiplicity"]
    elif "multiplicity" not in spec:
        spec["multiplicity"] = version.multiplicity if version.multiplicity is not None else 1

    raw_engine = (
        spec.get("engine_preference")
        or arguments.get("engine_preference")
        or arguments.get("engine")
    )
    if not raw_engine:
        raise ToolInvocationError(
            ToolErrorCode.VALIDATION_ERROR,
            "An engine_preference is required to submit a calculation.",
        )
    if isinstance(raw_engine, str):
        eng = raw_engine.lower()
        if eng == "quantum_espresso":
            eng = "qe"
        spec["engine_preference"] = {"engine": eng}
    elif isinstance(raw_engine, dict):
        engine_name = str(raw_engine.get("engine", "")).lower()
        if not engine_name:
            raise ToolInvocationError(
                ToolErrorCode.VALIDATION_ERROR,
                "An engine name is required to submit a calculation.",
            )
        if engine_name == "quantum_espresso":
            engine_name = "qe"
        # Preserve legitimate preference fields. These are constraints the
        # compute gateway validates against the actual engine identity; they
        # are not display metadata and cannot forge execution attestation.
        preserved: dict[str, Any] = {"engine": engine_name}
        for field in ("allowed_version", "requested_capability", "execution_preference"):
            value = raw_engine.get(field)
            if value is not None:
                preserved[field] = value
        spec["engine_preference"] = preserved

    final_idempotency_key = (
        idempotency_key
        or arguments.get("idempotency_key")
        or f"ai-calc-{uuid4()}"
    )

    return {
        "structure_version": structure_version_ref,
        "specification": spec,
        "provider_preference": arguments.get("provider_preference", "AUTO"),
        "idempotency_key": final_idempotency_key,
    }
