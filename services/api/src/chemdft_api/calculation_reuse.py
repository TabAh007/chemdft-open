"""Safe reuse of a previous calculation's settings.

This module only *plans*: it re-checks, against the current records, that the stored specification
can be submitted again for the same structure version, and returns the exact specification.
Submission itself stays on the existing `POST /calculations` route with a fresh idempotency key, so
canonical calculation identity, idempotency and every scientific gate are unchanged and a previous
calculation, its input and its result are never edited or overwritten.
"""

from __future__ import annotations

import hashlib
import json
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .config import Settings
from .context import Identity
from .contracts.scientific import CalculationSpecification
from .contracts.workflows import ReuseCheck, ReusePlan
from .errors import ApplicationError, ScientificReferenceNotFound
from .geometry_eligibility import require_calculation_geometry
from .project_access import ProjectCapability, can
from .scientific.electronic_state import electronic_state_authority
from .scientific.engines.normalization import validate_structure_electronic_state
from .scientific.engines.registry import validate_capability, validate_pyscf_elements
from .scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore

NOTICE = (
    "Reusing settings creates a new calculation with a new identity. The earlier calculation, its "
    "input and its result are never modified. Every scientific gate is evaluated again when the "
    "new calculation is submitted."
)


def _detail(error: Exception) -> str:
    return str(getattr(error, "detail", None) or error)[:480]


def get_reuse_plan(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    settings: Settings,
    project_id: str,
    calculation_id: str,
) -> ReusePlan:
    project, member = authorize_project_access(session, identity, project_id)
    calculation = session.get(CalculationRecord, calculation_id)
    if calculation is None or calculation.project_id != project.id:
        raise ScientificReferenceNotFound("Calculation does not exist.")
    calc_input = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.calculation_id == calculation.id,
            CalculationInputRecord.project_id == project.id,
        )
    )
    checks: list[ReuseCheck] = []

    def add(check_id: str, outcome: str, detail: str) -> None:
        checks.append(ReuseCheck(check_id=check_id, outcome=outcome, detail=detail))  # type: ignore[arg-type]

    def blocked(spec: CalculationSpecification | None = None) -> ReusePlan:
        return _plan(project.id, calculation, calc_input, spec, checks, [], None)

    if calc_input is None:
        add("SOURCE_INPUT", "FAIL", "The immutable calculation input is missing.")
        return blocked()
    try:
        spec = CalculationSpecification.model_validate(calc_input.specification_json)
    except ValidationError:
        add(
            "SOURCE_SPECIFICATION",
            "FAIL",
            "This calculation's stored specification is not a reusable calculation request "
            "(for example a DFT-D4 correction bound to one source result).",
        )
        return blocked()
    add("SOURCE_SPECIFICATION", "PASS", "Stored specification is valid and unmodified.")

    if can(member, ProjectCapability.WRITE):
        add("WRITE_ACCESS", "PASS", "Your role may submit calculations in this project.")
    else:
        add("WRITE_ACCESS", "FAIL", "Your role is read-only; submitting needs edit access.")

    state = str(calculation.state)
    if state == "SUCCEEDED":
        add("SOURCE_STATE", "PASS", "The source calculation succeeded.")
    else:
        add(
            "SOURCE_STATE",
            "WARNING",
            f"The source calculation ended {state}; reusing its settings repeats the same request.",
        )

    version = session.get(StructureVersionRecord, calc_input.structure_version_id)
    if version is None or version.project_id != project.id:
        add("STRUCTURE_VERSION", "FAIL", "The structure version used by this calculation is gone.")
        return blocked(spec)
    newer = session.scalar(
        select(StructureVersionRecord.revision)
        .where(
            StructureVersionRecord.structure_id == version.structure_id,
            StructureVersionRecord.project_id == project.id,
            StructureVersionRecord.revision > version.revision,
        )
        .limit(1)
    )
    add(
        "STRUCTURE_VERSION",
        "WARNING" if newer is not None else "PASS",
        f"Same structure version (revision {version.revision}); a newer revision exists and is NOT "
        "used."
        if newer is not None
        else f"Same structure version (revision {version.revision}) will be used.",
    )

    _check_structure_hash(session, object_store, settings, calc_input, version, add)

    try:
        validate_structure_electronic_state(
            version,
            spec,
            xyz_calculation_declaration=(
                electronic_state_authority(session, object_store, version)["authority"]
                == "CALCULATION_USER_DECLARED"
            ),
        )
        add(
            "ELECTRONIC_STATE",
            "PASS",
            f"Charge {spec.charge:+d} and multiplicity {spec.multiplicity} are consistent with the "
            "structure version.",
        )
    except ApplicationError as error:
        add("ELECTRONIC_STATE", "FAIL", _detail(error))
    try:
        require_calculation_geometry(session, object_store, version)
        add("GEOMETRY", "PASS", "Stored geometry is accepted for calculation.")
    except ApplicationError as error:
        add("GEOMETRY", "FAIL", _detail(error))
    try:
        validate_capability(spec, settings)
        if spec.engine_preference.engine == "pyscf" and spec.basis:
            validate_pyscf_elements(
                spec.basis.identifier,
                [
                    atom["atomic_number"]
                    for atom in version.representation_json["coordinates"]["atoms"]
                ],
            )
        basis = f" / {spec.basis.identifier}" if spec.basis else ""
        add(
            "ENGINE_CAPABILITY",
            "PASS",
            f"{spec.engine_preference.engine}: {spec.method.identifier}{basis} is available now.",
        )
    except ApplicationError as error:
        add("ENGINE_CAPABILITY", "FAIL", _detail(error))
    if spec.thermochemistry is not None or spec.conformer_search is not None:
        add(
            "SOURCE_EVIDENCE",
            "WARNING",
            "This task depends on other stored evidence (e.g. a frequency result); that evidence "
            "is re-validated at submission and may now be rejected.",
        )

    equivalent = [
        UUID(other.calculation_id)
        for other in session.scalars(
            select(CalculationInputRecord).where(
                CalculationInputRecord.project_id == project.id,
                CalculationInputRecord.structure_version_id == calc_input.structure_version_id,
                CalculationInputRecord.calculation_id != calculation.id,
            )
        )
        if other.specification_json == calc_input.specification_json
    ]
    if equivalent:
        add(
            "DUPLICATE",
            "WARNING",
            f"{len(equivalent) + 1} calculations in this project already share this structure "
            "version and specification. A new one adds another independent run.",
        )
    return _plan(project.id, calculation, calc_input, spec, checks, equivalent, version)


def _check_structure_hash(session, object_store, settings, calc_input, version, add) -> None:
    artifact = session.get(ScientificArtifactRecord, calc_input.normalized_input_artifact_id)
    canonical = session.get(ScientificArtifactRecord, version.canonical_artifact_id)
    if artifact is None or canonical is None:
        add("STRUCTURE_IDENTITY", "FAIL", "A stored input or structure artifact record is missing.")
        return
    try:
        data = object_store.get_bytes(artifact.storage_key, settings.scientific_max_output_bytes)
        if hashlib.sha256(data).hexdigest() != artifact.sha256:
            add("STRUCTURE_IDENTITY", "FAIL", "The stored calculation input fails its hash check.")
            return
        recorded = json.loads(data).get("input_structure_hash")
    except (OSError, ValueError, ApplicationError):
        add("STRUCTURE_IDENTITY", "FAIL", "The stored calculation input could not be read.")
        return
    if recorded is None:
        add(
            "STRUCTURE_IDENTITY",
            "WARNING",
            "This task does not record a structure hash in its input; identity rests on the "
            "structure version id.",
        )
    elif recorded == canonical.sha256:
        add("STRUCTURE_IDENTITY", "PASS", "Structure hash matches the hash recorded in the input.")
    else:
        add(
            "STRUCTURE_IDENTITY",
            "FAIL",
            "The structure hash recorded in the original input differs from the current structure "
            "version artifact.",
        )


def _plan(project_id, calculation, calc_input, spec, checks, equivalent, version) -> ReusePlan:
    can_reuse = (
        spec is not None and version is not None and all(c.outcome != "FAIL" for c in checks)
    )
    return ReusePlan(
        project_id=UUID(project_id),
        source_calculation_id=UUID(calculation.id),
        source_state=str(calculation.state),
        task=spec.task_type.value if spec else None,
        engine=spec.engine_preference.engine if spec else None,
        method=spec.method.identifier if spec else None,
        basis=spec.basis.identifier if spec and spec.basis else None,
        charge=spec.charge if spec else None,
        multiplicity=spec.multiplicity if spec else None,
        structure_version_id=UUID(calc_input.structure_version_id) if calc_input else None,
        can_reuse=can_reuse,
        checks=tuple(checks),
        equivalent_calculation_ids=tuple(equivalent),
        specification=spec.model_dump(mode="json") if can_reuse and spec else None,
        notice=NOTICE,
    )
