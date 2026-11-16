# ruff: noqa: E501
"""Save the relaxed positions of a Quantum ESPRESSO result as a new, immutable structure version (release 0.0.45).

The coordinates come only from the stored result document (`relaxation.final_positions`, written by the QE worker and checked
by the Result Firewall). Nothing is computed or interpolated here. The parent version is never modified: a new version V(n+1)
of the same structure is created with origin DERIVED and provenance authority CALCULATED, the cell and species unchanged.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .context import Identity
from .contracts.base import ArtifactReference
from .contracts.catalog import StructureVersionCreateOutput
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .contracts.scientific import StructureKind, StructureVersionOrigin
from .errors import ProjectAccessDenied, ScientificReferenceNotFound, ScientificValidationFailed
from .models import new_id
from .project_access import ProjectCapability, can
from .scientific.structures import (
    CanonicalStructureCandidate,
    StructureSourceFormat,
    canonical_document,
)
from .scientific_actions import (
    MAX_STRUCTURE_PARSE_BYTES,
    _artifact_reference,
    _audit_structure_event,
    _persist_canonical_artifact,
    _version_from_record,
)
from .scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore

OPERATION = "chemdft.structure.relaxed-from-calculation"
PRODUCER_ID = "chemdft.qe-periodic.worker"
ADAPTER = "chemdft.relaxed-structure"
ADAPTER_VERSION = "1.0.0"
NOTE_TEMPLATE = "cell fixed; positions relaxed with Quantum ESPRESSO {version} PBE+U"


def _payload_sha(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _qe_relaxed_result(session: Session, project_id: str, calculation_id: str) -> CalculationResultRecord:
    results = session.scalars(
        select(CalculationResultRecord)
        .where(
            CalculationResultRecord.project_id == project_id,
            CalculationResultRecord.calculation_id == calculation_id,
        )
        .order_by(CalculationResultRecord.created_at.desc())
    ).all()
    for result in results:
        payload = result.payload_json or {}
        if payload.get("engine") == "qe":
            relaxation = payload.get("relaxation")
            if isinstance(relaxation, dict) and relaxation.get("converged") is True and relaxation.get("final_positions"):
                return result
            raise ScientificValidationFailed(
                "This Quantum ESPRESSO result has no relaxed positions: run it with “Relax atom positions” first."
            )
    raise ScientificValidationFailed("Only a Quantum ESPRESSO periodic result with relaxed positions can be saved as a version.")


def create_relaxed_structure_version(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    *,
    project_id: str,
    calculation_id: str,
) -> StructureVersionCreateOutput:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    calculation = session.get(CalculationRecord, calculation_id)
    if calculation is None or calculation.project_id != project.id:
        raise ScientificReferenceNotFound("Calculation does not exist in this project.")
    result = _qe_relaxed_result(session, project.id, calculation.id)
    idempotency_key = f"relaxed:{result.id}"
    existing = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.project_id == project.id,
            StructureVersionRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return StructureVersionCreateOutput(version=_version_from_record(existing))

    calculation_input = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.calculation_id == calculation.id, CalculationInputRecord.project_id == project.id
        )
    )
    parent = session.get(StructureVersionRecord, calculation_input.structure_version_id) if calculation_input else None
    if parent is None or parent.project_id != project.id:
        raise ScientificReferenceNotFound("The structure version this calculation used does not exist.")
    structure = session.get(StructureRecord, parent.structure_id)
    if structure is None or structure.kind != StructureKind.PERIODIC or not parent.periodic_cell_json:
        raise ScientificValidationFailed("Only a periodic structure with a cell can receive relaxed positions.")

    payload = result.payload_json
    positions = payload["relaxation"]["final_positions"]
    parent_atoms = list(parent.representation_json["coordinates"]["atoms"])
    if len(positions) != len(parent_atoms):
        raise ScientificValidationFailed("The relaxed positions do not match the atoms of the structure that was calculated.")
    atoms: list[dict[str, Any]] = []
    for index, (atom, relaxed) in enumerate(zip(parent_atoms, positions, strict=True)):
        fractional = relaxed.get("fractional")
        if (
            relaxed.get("index") != index
            or relaxed.get("element") != atom.get("element")
            or not isinstance(fractional, list)
            or len(fractional) != 3
            or not all(isinstance(v, int | float) and math.isfinite(float(v)) for v in fractional)
        ):
            raise ScientificValidationFailed("The relaxed positions do not match the atoms of the structure that was calculated.")
        atoms.append({**atom, "x": float(fractional[0]), "y": float(fractional[1]), "z": float(fractional[2])})

    parent_canonical = session.get(ScientificArtifactRecord, parent.canonical_artifact_id)
    parent_document = json.loads(object_store.get_bytes(parent_canonical.storage_key, MAX_STRUCTURE_PARSE_BYTES))
    engine_version = str(payload.get("engine_version") or "7.6")
    coordinates = {
        **parent.representation_json["coordinates"],
        "structure_version_id": "00000000-0000-4000-8000-000000000000",
        "source": None,
        "atoms": atoms,
    }
    candidate = CanonicalStructureCandidate(
        name=structure.name,
        kind=StructureKind.PERIODIC,
        coordinates=coordinates,
        overall_charge=parent.overall_charge,
        multiplicity=parent.multiplicity,
        source_format=StructureSourceFormat(parent_document.get("source", {}).get("format", "CIF")),
        parser_name="quantum-espresso",
        parser_version=engine_version,
        adapter_name=ADAPTER,
        adapter_version=ADAPTER_VERSION,
        periodic_cell=parent.periodic_cell_json,
        diagnostics=(),
    )
    canonical_artifact = _persist_canonical_artifact(
        session, identity, object_store, project_id=project.id, document=canonical_document(candidate),
        source_artifact_id=parent.source_artifact_id,
    )
    note = NOTE_TEMPLATE.format(version=engine_version)
    version_id = new_id()
    provenance = ProvenanceRecordRow(
        project_id=project.id,
        subject_type="structure.version",
        subject_id=version_id,
        source_class=ProvenanceClass.CALCULATED,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SOFTWARE,
        producer_identifier=PRODUCER_ID,
        producer_software_version=engine_version,
        source_artifact_id=parent.source_artifact_id,
        operation=OPERATION,
        operation_version="1.0.0",
        parameters_json=[
            {"key": "calculation_id", "value": calculation.id},
            {"key": "result_id", "value": result.id},
            {"key": "engine", "value": "qe"},
            {"key": "engine_version", "value": engine_version},
            {"key": "parent_version_id", "value": parent.id},
            {"key": "cell", "value": "fixed"},
            {"key": "note", "value": note},
            {"key": "requested_by", "value": identity.user_id},
        ],
        approximate=False,
        supersedes_id=None,
        correlation_id=result.correlation_id,
    )
    session.add(provenance)
    session.flush()
    input_artifact = session.get(ScientificArtifactRecord, calculation_input.normalized_input_artifact_id)
    session.add_all(
        [
            ProvenanceInputRow(
                provenance_record_id=provenance.id, project_id=project.id, position=0, input_type="ENTITY",
                input_id=parent.id, input_sha256=parent_canonical.sha256,
            ),
            ProvenanceInputRow(
                provenance_record_id=provenance.id, project_id=project.id, position=1, input_type="ENTITY",
                input_id=calculation.id, input_sha256=input_artifact.sha256 if input_artifact else None,
            ),
            ProvenanceInputRow(
                provenance_record_id=provenance.id, project_id=project.id, position=2, input_type="ENTITY",
                input_id=result.id, input_sha256=_payload_sha(payload),
            ),
        ]
    )
    # Take the structure's write lock before allocating the revision (as the optimization publisher does).
    session.execute(update(StructureRecord).where(StructureRecord.id == structure.id).values(updated_at=StructureRecord.updated_at))
    revision = (
        session.scalar(
            select(func.max(StructureVersionRecord.revision)).where(StructureVersionRecord.structure_id == structure.id)
        )
        or 0
    ) + 1
    source_ref: ArtifactReference = _artifact_reference(session.get(ScientificArtifactRecord, parent.source_artifact_id))
    representation = {
        "source_artifact": source_ref.model_dump(mode="json"),
        "canonical_artifact": _artifact_reference(canonical_artifact).model_dump(mode="json"),
        "coordinates": coordinates,
        "relaxation": {"calculation_id": calculation.id, "result_id": result.id, "note": note, "cell": "fixed"},
    }
    # The original source of an imported structure stays attached, so it can still be cited for the new version.
    for key in ("cif_source_reference", "source_reference"):
        if key in parent.representation_json:
            representation[key] = parent.representation_json[key]
    version = StructureVersionRecord(
        id=version_id,
        project_id=project.id,
        structure_id=structure.id,
        revision=revision,
        origin=StructureVersionOrigin.DERIVED,
        parent_version_id=parent.id,
        canonical_artifact_id=canonical_artifact.id,
        source_artifact_id=parent.source_artifact_id,
        coordinate_system=parent.coordinate_system,
        coordinate_unit=parent.coordinate_unit,
        atom_count=len(atoms),
        bond_count=parent.bond_count,
        overall_charge=parent.overall_charge,
        multiplicity=parent.multiplicity,
        representation_json=representation,
        periodic_cell_json=parent.periodic_cell_json,
        diagnostics_json=[],
        provenance_record_id=provenance.id,
        idempotency_key=idempotency_key,
        created_by=identity.user_id,
    )
    session.add(version)
    _audit_structure_event(
        session, identity, project_id=project.id, event_name="structure.version.relaxed", structure_id=structure.id,
        version_id=version.id, artifacts=[_artifact_reference(canonical_artifact)],
    )
    session.commit()
    session.refresh(version)
    return StructureVersionCreateOutput(version=_version_from_record(version))
