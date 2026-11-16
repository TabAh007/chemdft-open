from __future__ import annotations

import hashlib
import json
from io import BytesIO
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .context import Identity
from .contracts.artifacts import ScientificArtifact, ScientificArtifactRegistration
from .contracts.base import ArtifactReference, EntityReference
from .contracts.catalog import (
    StructureEditCoordinateSet,
    StructureImportInput,
    StructureImportOutput,
    StructureSummary,
    StructureVersionCreateInput,
    StructureVersionCreateOutput,
    StructureVersionDetail,
    StructureVersionProvenance,
)
from .contracts.conformers import ConformerEnsembleResult
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .contracts.results import (
    AuthoritativeResultSubmission,
    CalculationResult,
    EnergyResult,
    MolecularOrbitalAnalysis,
    OptimizationResult,
    PeriodicEnergyResult,
    ResultAuthority,
    ResultValidationState,
    TddftResult,
    ThermochemistryResult,
    VibrationalAnalysis,
    thermochemistry_result_hash,
)
from .contracts.scientific import (
    CalculationLifecycle,
    CoordinateSet,
    EngineReference,
    PeriodicCell,
    Structure,
    StructureKind,
    StructureVersion,
    StructureVersionOrigin,
)
from .errors import (
    ArtifactHashMismatch,
    CrossProjectReference,
    InvalidLifecycleTransition,
    ProjectAccessDenied,
    SchemaVersionUnsupported,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
    TrustedProducerRequired,
)
from .models import Project, StoredFile, new_id, utc_now
from .project_access import ProjectCapability, can
from .scientific.adapters.molecular.rdkit_adapter import (
    export_mol,
    export_sdf,
    export_smiles,
    export_xyz,
    parse_mol,
    parse_sdf,
    parse_xyz,
)
from .scientific.adapters.periodic.pymatgen_adapter import export_cif, parse_cif
from .scientific.structures import (
    CANONICAL_STRUCTURE_FORMAT,
    CANONICAL_STRUCTURE_MEDIA_TYPE,
    CANONICAL_STRUCTURE_SCHEMA_VERSION,
    CanonicalStructureCandidate,
    StructureSourceFormat,
    canonical_bytes,
    canonical_document,
)
from .scientific_models import (
    AuditEventRecord,
    CalculationAttemptRecord,
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    OptimizationTrajectoryRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore
from .trusted_producers import ProducerType, TrustedProducerContext, is_issued_trusted_producer

RECOGNIZED_RESULT_SCHEMA_VERSIONS = frozenset({"1.0.0"})
MAX_STRUCTURE_PARSE_BYTES = 10 * 1024 * 1024


def _artifact_from_record(record: ScientificArtifactRecord) -> ScientificArtifact:
    source_relation = None
    if record.source_relation_type and record.source_relation_id:
        source_relation = EntityReference(
            project_id=UUID(record.project_id),
            entity_type=record.source_relation_type,
            entity_id=UUID(record.source_relation_id),
        )
    return ScientificArtifact(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        kind=record.kind,
        media_type=record.media_type,
        format_identifier=record.format_identifier,
        format_version=record.format_version,
        size_bytes=record.size_bytes,
        sha256=record.sha256,
        created_by=UUID(record.created_by),
        created_at=record.created_at,
        source_relation=source_relation,
        compression=record.compression,
        extensions=record.extensions_json,
    )


def register_scientific_artifact(
    session: Session,
    identity: Identity,
    registration: ScientificArtifactRegistration,
) -> ScientificArtifact:
    if registration.kind in {"MO_COEFFICIENTS", "ORBITAL_GRID", "VOLUMETRIC_GRID"}:
        raise ScientificValidationFailed(
            "Calculated field artifacts require validated engine execution provenance."
        )
    project, member = authorize_project_access(session, identity, str(registration.project_id))
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    if (
        registration.source_relation
        and registration.source_relation.project_id != registration.project_id
    ):
        raise CrossProjectReference()
    stored_file = session.scalar(
        select(StoredFile).where(
            StoredFile.id == str(registration.stored_file_id),
            StoredFile.project_id == project.id,
        )
    )
    if stored_file is None:
        raise ScientificReferenceNotFound("Stored source file does not exist in this project.")
    existing = session.scalar(
        select(ScientificArtifactRecord).where(
            ScientificArtifactRecord.project_id == project.id,
            ScientificArtifactRecord.storage_key == stored_file.object_key,
        )
    )
    if existing is not None:
        if (
            existing.kind != registration.kind
            or existing.format_identifier != registration.format_identifier
            or existing.format_version != registration.format_version
        ):
            raise ScientificValidationFailed(
                "Stored source is already registered with different immutable metadata."
            )
        return _artifact_from_record(existing)

    record = ScientificArtifactRecord(
        project_id=project.id,
        kind=registration.kind,
        media_type=stored_file.media_type,
        format_identifier=registration.format_identifier,
        format_version=registration.format_version,
        size_bytes=stored_file.size_bytes,
        sha256=stored_file.sha256,
        storage_key=stored_file.object_key,
        created_by=identity.user_id,
        source_relation_type=(
            registration.source_relation.entity_type if registration.source_relation else None
        ),
        source_relation_id=(
            str(registration.source_relation.entity_id) if registration.source_relation else None
        ),
        compression=registration.compression,
        schema_version=registration.schema_version,
        extensions_json=[
            extension.model_dump(mode="json") for extension in registration.extensions
        ],
    )
    session.add(record)
    session.flush()
    session.add(
        AuditEventRecord(
            event_name="artifact.registered",
            actor_or_service_id=identity.user_id,
            organization_id=identity.organization_id,
            project_id=project.id,
            request_id=new_id(),
            targets_json=[
                {
                    "project_id": project.id,
                    "entity_type": "scientific.artifact",
                    "entity_id": record.id,
                }
            ],
            outcome="SUCCEEDED",
            artifact_references_json=[
                {
                    "project_id": project.id,
                    "artifact_id": record.id,
                    "sha256": record.sha256,
                }
            ],
            safe_metadata_json=[],
        )
    )
    session.commit()
    session.refresh(record)
    return _artifact_from_record(record)


def _artifact_reference(record: ScientificArtifactRecord) -> ArtifactReference:
    return ArtifactReference(
        project_id=UUID(record.project_id),
        artifact_id=UUID(record.id),
        sha256=record.sha256,
    )


def _audit_structure_event(
    session: Session,
    identity: Identity,
    *,
    project_id: str,
    event_name: str,
    structure_id: str,
    version_id: str | None,
    artifacts: list[ArtifactReference],
) -> None:
    session.add(
        AuditEventRecord(
            event_name=event_name,
            actor_or_service_id=identity.user_id,
            organization_id=identity.organization_id,
            project_id=project_id,
            request_id=new_id(),
            targets_json=[
                {
                    "project_id": project_id,
                    "entity_type": "structure",
                    "entity_id": structure_id,
                },
                *(
                    [
                        {
                            "project_id": project_id,
                            "entity_type": "structure.version",
                            "entity_id": version_id,
                        }
                    ]
                    if version_id
                    else []
                ),
            ],
            outcome="SUCCEEDED",
            artifact_references_json=[ref.model_dump(mode="json") for ref in artifacts],
            safe_metadata_json=[],
        )
    )


def _provenance_for_structure_version(
    session: Session,
    identity: Identity,
    *,
    project_id: str,
    version_id: str,
    source_artifact_id: str,
    operation: str,
    operation_version: str,
    parameters: list[dict[str, object]] | None = None,
    approximate: bool = False,
    detail: ProvenanceDetail = ProvenanceDetail.MANUAL_ENTRY,
) -> ProvenanceRecordRow:
    record = ProvenanceRecordRow(
        project_id=project_id,
        subject_type="structure.version",
        subject_id=version_id,
        source_class=ProvenanceClass.USER_SUPPLIED,
        detail=detail,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.USER,
        producer_identifier=identity.user_id,
        producer_software_version=None,
        source_artifact_id=source_artifact_id,
        operation=operation,
        operation_version=operation_version,
        parameters_json=parameters or [],
        approximate=approximate,
        supersedes_id=None,
        correlation_id=new_id(),
    )
    session.add(record)
    session.flush()
    return record


def _artifact_or_record(
    session: Session,
    project_id: str,
    ref: ArtifactReference,
) -> ScientificArtifactRecord:
    artifact = session.get(ScientificArtifactRecord, str(ref.artifact_id))
    if artifact is None:
        raise ScientificReferenceNotFound("Referenced scientific artifact does not exist.")
    if artifact.project_id != project_id or str(ref.project_id) != project_id:
        raise CrossProjectReference()
    if artifact.sha256 != ref.sha256:
        raise ArtifactHashMismatch()
    return artifact


def _parse_candidate(
    data: bytes,
    requested_format: str,
    *,
    selection_index: int = 0,
) -> CanonicalStructureCandidate:
    normalized = requested_format.strip().upper()
    match normalized:
        case "SDF":
            return parse_sdf(data, selection_index=selection_index)
        case "XYZ":
            return parse_xyz(data, selection_index=selection_index)
        case "CIF":
            return parse_cif(data, selection_index=selection_index)
        case "MOL":
            return parse_mol(data)
        case _:
            raise ScientificValidationFailed("Unsupported structure format.")


def _persist_canonical_artifact(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    *,
    project_id: str,
    document: dict[str, object],
    source_artifact_id: str,
) -> ScientificArtifactRecord:
    payload = canonical_bytes(document)
    stored = object_store.put_raw(project_id, BytesIO(payload), MAX_STRUCTURE_PARSE_BYTES)
    record = ScientificArtifactRecord(
        project_id=project_id,
        kind="COORDINATES",
        media_type=CANONICAL_STRUCTURE_MEDIA_TYPE,
        format_identifier=CANONICAL_STRUCTURE_FORMAT,
        format_version=CANONICAL_STRUCTURE_SCHEMA_VERSION,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        storage_key=stored.key,
        created_by=identity.user_id,
        source_relation_type="scientific.artifact",
        source_relation_id=source_artifact_id,
        compression=None,
        schema_version="1.0.0",
        extensions_json=[],
    )
    session.add(record)
    session.flush()
    return record


def _version_from_record(record: StructureVersionRecord) -> StructureVersion:
    source_artifact = ArtifactReference.model_validate(
        record.representation_json["source_artifact"]
    )
    canonical_artifact = ArtifactReference.model_validate(
        record.representation_json["canonical_artifact"]
    )
    coordinates_payload = dict(record.representation_json["coordinates"])
    coordinates_payload["structure_version_id"] = record.id
    coordinates_payload["source"] = canonical_artifact.model_dump(mode="json")
    coordinates = CoordinateSet.model_validate(coordinates_payload)
    return StructureVersion(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        structure_id=UUID(record.structure_id),
        revision=record.revision,
        origin=StructureVersionOrigin(record.origin),
        parent_version_id=UUID(record.parent_version_id) if record.parent_version_id else None,
        representation_artifacts=(canonical_artifact, source_artifact),
        coordinates=coordinates,
        periodic_cell=(
            PeriodicCell.model_validate(record.periodic_cell_json)
            if record.periodic_cell_json
            else None
        ),
        diagnostics=tuple(record.diagnostics_json),
        overall_charge=record.overall_charge,
        multiplicity=record.multiplicity,
        created_by=UUID(record.created_by),
        created_at=record.created_at,
    )


def _structure_from_record(record: StructureRecord) -> Structure:
    return Structure(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        name=record.name,
        kind=StructureKind(record.kind),
        created_by=UUID(record.created_by),
        created_at=record.created_at,
    )


def import_structure(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    payload: StructureImportInput,
) -> StructureImportOutput:
    project, member = authorize_project_access(session, identity, str(payload.project_id))
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()

    existing = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.project_id == project.id,
            StructureVersionRecord.idempotency_key == payload.idempotency_key,
        )
    )
    if existing is not None:
        structure = session.get(StructureRecord, existing.structure_id)
        if structure is None:
            raise ScientificReferenceNotFound()
        return StructureImportOutput(
            structure=_structure_from_record(structure),
            version=_version_from_record(existing),
        )

    source_artifact = _artifact_or_record(session, project.id, payload.source_artifact)
    data = object_store.get_bytes(source_artifact.storage_key, MAX_STRUCTURE_PARSE_BYTES)
    candidate = _parse_candidate(
        data,
        payload.requested_format,
        selection_index=payload.selection_index,
    )
    if payload.structure_name:
        candidate = CanonicalStructureCandidate(
            name=payload.structure_name,
            kind=candidate.kind,
            coordinates=candidate.coordinates,
            overall_charge=candidate.overall_charge,
            multiplicity=candidate.multiplicity,
            source_format=candidate.source_format,
            parser_name=candidate.parser_name,
            parser_version=candidate.parser_version,
            adapter_name=candidate.adapter_name,
            adapter_version=candidate.adapter_version,
            periodic_cell=candidate.periodic_cell,
            diagnostics=candidate.diagnostics,
            electronic_state_declared=candidate.electronic_state_declared,
        )
    document = canonical_document(candidate)
    canonical_record = _persist_canonical_artifact(
        session,
        identity,
        object_store,
        project_id=project.id,
        document=document,
        source_artifact_id=source_artifact.id,
    )
    structure_record = StructureRecord(
        project_id=project.id,
        name=candidate.name,
        kind=candidate.kind,
        created_by=identity.user_id,
    )
    session.add(structure_record)
    session.flush()
    version_id = new_id()
    cif_ref = candidate.source_reference
    provenance = _provenance_for_structure_version(
        session,
        identity,
        project_id=project.id,
        version_id=version_id,
        source_artifact_id=source_artifact.id,
        operation="chemdft.structure.import",
        operation_version="1.0.0",
        parameters=[
            {"key": "format", "value": candidate.source_format},
            {"key": "parser", "value": candidate.parser_name},
            {"key": "parser_version", "value": candidate.parser_version},
            {"key": "adapter", "value": candidate.adapter_name},
            {"key": "adapter_version", "value": candidate.adapter_version},
            *([
                {"key": "cif_source_reference", "value": json.dumps(cif_ref)},
                {"key": "source_reference", "value": cif_ref["formatted"]},
            ] if cif_ref and cif_ref.get("formatted") else []),
            *([
                {"key": "selection_index", "value": payload.selection_index},
                {"key": "electronic_state_authority", "value": (
                    "USER_DECLARED_XYZ" if candidate.electronic_state_declared
                    else "UNSPECIFIED_XYZ"
                )},
                *([
                    {"key": "declared_charge", "value": candidate.overall_charge},
                    {"key": "declared_multiplicity", "value": candidate.multiplicity},
                ] if candidate.electronic_state_declared else []),
            ] if candidate.source_format == StructureSourceFormat.XYZ else []),
        ],
    )
    source_ref = _artifact_reference(source_artifact)
    canonical_ref = _artifact_reference(canonical_record)
    representation_json = {
        "source_artifact": source_ref.model_dump(mode="json"),
        "canonical_artifact": canonical_ref.model_dump(mode="json"),
        "coordinates": candidate.coordinates,
        **({"cif_source_reference": cif_ref} if cif_ref else {}),
        **(
            {"source_reference": cif_ref.get("formatted")}
            if cif_ref and cif_ref.get("formatted")
            else {}
        ),
    }
    version_record = StructureVersionRecord(
        id=version_id,
        project_id=project.id,
        structure_id=structure_record.id,
        revision=1,
        origin=StructureVersionOrigin.IMPORTED,
        parent_version_id=None,
        canonical_artifact_id=canonical_record.id,
        source_artifact_id=source_artifact.id,
        coordinate_system=candidate.coordinates["coordinate_system"],
        coordinate_unit=candidate.coordinates["unit"],
        atom_count=len(candidate.atoms),
        bond_count=len(candidate.bonds),
        overall_charge=candidate.overall_charge,
        multiplicity=candidate.multiplicity,
        representation_json=representation_json,
        periodic_cell_json=candidate.periodic_cell,
        diagnostics_json=[
            diagnostic.model_dump(mode="json") for diagnostic in candidate.diagnostics
        ],
        provenance_record_id=provenance.id,
        idempotency_key=payload.idempotency_key,
        created_by=identity.user_id,
    )
    session.add(version_record)
    _audit_structure_event(
        session,
        identity,
        project_id=project.id,
        event_name="structure.imported",
        structure_id=structure_record.id,
        version_id=version_record.id,
        artifacts=[source_ref, canonical_ref],
    )
    session.commit()
    session.refresh(structure_record)
    session.refresh(version_record)
    return StructureImportOutput(
        structure=_structure_from_record(structure_record),
        version=_version_from_record(version_record),
    )


def create_structure_version(
    session: Session,
    identity: Identity,
    payload: StructureVersionCreateInput,
) -> StructureVersionCreateOutput:
    structure = session.get(StructureRecord, str(payload.structure_id))
    if structure is None:
        raise ScientificReferenceNotFound("Structure does not exist.")
    project, member = authorize_project_access(session, identity, structure.project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    if payload.requested_origin != "MANUALLY_EDITED":
        raise ScientificValidationFailed("Phase 3 only permits manual edit version creation.")
    if payload.representation_artifact.project_id != UUID(project.id):
        raise CrossProjectReference()
    artifact = _artifact_or_record(session, project.id, payload.representation_artifact)
    parent = session.get(StructureVersionRecord, str(payload.parent_version_id))
    if parent is None or parent.project_id != project.id or parent.structure_id != structure.id:
        raise CrossProjectReference("Parent version must belong to the same structure.")
    if payload.idempotency_key:
        existing = session.scalar(
            select(StructureVersionRecord).where(
                StructureVersionRecord.project_id == project.id,
                StructureVersionRecord.idempotency_key == payload.idempotency_key,
            )
        )
        if existing is not None:
            return StructureVersionCreateOutput(version=_version_from_record(existing))

    latest_revision = (
        session.scalar(
            select(func.max(StructureVersionRecord.revision)).where(
                StructureVersionRecord.structure_id == structure.id
            )
        )
        or 0
    )
    version_id = new_id()
    coordinates_json = payload.coordinates.model_dump(mode="json")
    coordinates_json["structure_version_id"] = version_id
    coordinates_json["source"] = payload.representation_artifact.model_dump(mode="json")
    parent_source = session.get(ScientificArtifactRecord, parent.source_artifact_id)
    if parent_source is None or parent_source.project_id != project.id:
        raise ScientificReferenceNotFound("Parent source artifact is missing.")
    source_ref = _artifact_reference(parent_source)
    provenance = _provenance_for_structure_version(
        session,
        identity,
        project_id=project.id,
        version_id=version_id,
        source_artifact_id=artifact.id,
        operation="chemdft.structure.version.create",
        operation_version="1.0.0",
        parameters=[{"key": "operation", "value": payload.operation}],
    )
    record = StructureVersionRecord(
        id=version_id,
        project_id=project.id,
        structure_id=structure.id,
        revision=latest_revision + 1,
        origin=StructureVersionOrigin.MANUALLY_EDITED,
        parent_version_id=parent.id,
        canonical_artifact_id=artifact.id,
        source_artifact_id=artifact.id,
        coordinate_system=payload.coordinates.coordinate_system,
        coordinate_unit=payload.coordinates.unit,
        atom_count=len(payload.coordinates.atoms),
        bond_count=len(payload.coordinates.bonds),
        overall_charge=payload.overall_charge,
        multiplicity=payload.multiplicity,
        representation_json={
            "source_artifact": source_ref.model_dump(mode="json"),
            "canonical_artifact": payload.representation_artifact.model_dump(mode="json"),
            "coordinates": coordinates_json,
        },
        periodic_cell_json=(
            payload.periodic_cell.model_dump(mode="json") if payload.periodic_cell else None
        ),
        diagnostics_json=[],
        provenance_record_id=provenance.id,
        idempotency_key=payload.idempotency_key or f"manual:{version_id}",
        created_by=identity.user_id,
    )
    session.add(record)
    _audit_structure_event(
        session,
        identity,
        project_id=project.id,
        event_name="structure.version.created",
        structure_id=structure.id,
        version_id=record.id,
        artifacts=[payload.representation_artifact],
    )
    session.commit()
    session.refresh(record)
    return StructureVersionCreateOutput(version=_version_from_record(record))


def create_structure_version_from_source(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    *,
    project_id: str,
    structure_id: str,
    parent_version_id: str,
    source_artifact: ArtifactReference,
    requested_format: str,
    idempotency_key: str,
    operation: str = "ketcher_edit",
) -> StructureVersionCreateOutput:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    structure = session.get(StructureRecord, structure_id)
    parent = session.get(StructureVersionRecord, parent_version_id)
    if (
        structure is None
        or parent is None
        or structure.project_id != project.id
        or parent.project_id != project.id
        or parent.structure_id != structure.id
    ):
        raise ScientificReferenceNotFound("Structure version does not exist in this project.")
    if structure.kind == StructureKind.PERIODIC:
        raise ScientificValidationFailed(
            "Ketcher edits are only supported for molecular structures."
        )
    source_record = _artifact_or_record(session, project.id, source_artifact)
    candidate = _parse_candidate(
        object_store.get_bytes(source_record.storage_key, MAX_STRUCTURE_PARSE_BYTES),
        requested_format,
    )
    if candidate.kind is StructureKind.PERIODIC:
        raise ScientificValidationFailed("Ketcher edits cannot create periodic structure versions.")
    document = canonical_document(candidate)
    canonical_record = _persist_canonical_artifact(
        session,
        identity,
        object_store,
        project_id=project.id,
        document=document,
        source_artifact_id=source_record.id,
    )
    coordinates_payload = dict(candidate.coordinates)
    coordinates_payload.pop("structure_version_id", None)
    coordinates_payload.pop("source", None)
    return create_structure_version(
        session,
        identity,
        StructureVersionCreateInput(
            structure_id=UUID(structure.id),
            parent_version_id=UUID(parent.id),
            representation_artifact=_artifact_reference(canonical_record),
            coordinates=StructureEditCoordinateSet.model_validate(coordinates_payload),
            periodic_cell=(
                PeriodicCell.model_validate(candidate.periodic_cell)
                if candidate.periodic_cell
                else None
            ),
            overall_charge=candidate.overall_charge,
            multiplicity=candidate.multiplicity,
            operation=operation,
            idempotency_key=idempotency_key,
        ),
    )


def list_structures(
    session: Session,
    identity: Identity,
    project_id: str,
) -> tuple[StructureSummary, ...]:
    project, _member = authorize_project_access(session, identity, project_id)
    records = session.scalars(
        select(StructureRecord).where(StructureRecord.project_id == project.id)
    ).all()
    summaries = []
    for structure in records:
        latest = session.scalar(
            select(StructureVersionRecord)
            .where(StructureVersionRecord.structure_id == structure.id)
            .order_by(StructureVersionRecord.revision.desc())
            .limit(1)
        )
        if latest is None:
            continue
        counts: dict[str, int] = {}
        for item in latest.diagnostics_json:
            severity = str(item.get("severity", "INFO"))
            counts[severity] = counts.get(severity, 0) + 1
        summaries.append(
            StructureSummary(
                id=UUID(structure.id),
                project_id=UUID(project.id),
                name=structure.name,
                kind=StructureKind(structure.kind),
                latest_version_id=UUID(latest.id),
                latest_revision=latest.revision,
                atom_count=latest.atom_count,
                bond_count=latest.bond_count,
                diagnostic_counts=counts,
                created_at=structure.created_at,
                updated_at=structure.updated_at,
            )
        )
    return tuple(summaries)


def get_structure_version_detail(
    session: Session,
    identity: Identity,
    project_id: str,
    structure_id: str,
    version_id: str,
    object_store: ObjectStore | None = None,
) -> StructureVersionDetail:
    project, _member = authorize_project_access(session, identity, project_id)
    structure = session.get(StructureRecord, structure_id)
    version = session.get(StructureVersionRecord, version_id)
    if (
        structure is None
        or version is None
        or structure.project_id != project.id
        or version.project_id != project.id
        or version.structure_id != structure.id
    ):
        raise ScientificReferenceNotFound("Structure version does not exist in this project.")
    return StructureVersionDetail(
        structure=_structure_from_record(structure),
        version=_version_from_record(version),
        diagnostics=tuple(version.diagnostics_json),
        provenance=_provenance_from_version_record(session, version),
        electronic_state_authority=_state_authority(session, object_store, version),
    )


def update_structure_version_source_reference(
    session: Session,
    identity: Identity,
    project_id: str,
    structure_id: str,
    version_id: str,
    source_reference: str,
    object_store: ObjectStore | None = None,
) -> StructureVersionDetail:
    project, member = authorize_project_access(session, identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    structure = session.get(StructureRecord, structure_id)
    version = session.get(StructureVersionRecord, version_id)
    if (
        structure is None
        or version is None
        or structure.project_id != project.id
        or version.project_id != project.id
        or version.structure_id != structure.id
    ):
        raise ScientificReferenceNotFound("Structure version does not exist in this project.")

    clean_ref = source_reference.strip()
    rep = dict(version.representation_json or {})
    rep["source_reference"] = clean_ref
    version.representation_json = rep

    if version.provenance_record_id:
        prov = session.get(ProvenanceRecordRow, version.provenance_record_id)
        if prov:
            params = [
                p
                for p in (prov.parameters_json or [])
                if isinstance(p, dict) and p.get("key") != "source_reference"
            ]
            if clean_ref:
                params.append({"key": "source_reference", "value": clean_ref})
            prov.parameters_json = params

    session.flush()
    return get_structure_version_detail(
        session, identity, project_id, structure_id, version_id, object_store
    )


def _state_authority(session: Session, store: ObjectStore | None, version: StructureVersionRecord):
    """Read-only: mirrors the rule the server applies to calculation requests. Never raises."""
    if store is None:
        return None
    from .scientific.electronic_state import electronic_state_authority

    try:
        return electronic_state_authority(session, store, version)["authority"]
    except Exception:
        return "STRUCTURE_VERSION"


def list_structure_versions(
    session: Session,
    identity: Identity,
    project_id: str,
    structure_id: str,
    object_store: ObjectStore | None = None,
) -> tuple[StructureVersionDetail, ...]:
    project, _member = authorize_project_access(session, identity, project_id)
    structure = session.get(StructureRecord, structure_id)
    if structure is None or structure.project_id != project.id:
        raise ScientificReferenceNotFound("Structure does not exist in this project.")
    records = session.scalars(
        select(StructureVersionRecord)
        .where(
            StructureVersionRecord.project_id == project.id,
            StructureVersionRecord.structure_id == structure.id,
        )
        .order_by(StructureVersionRecord.revision.asc())
    ).all()
    return tuple(
        StructureVersionDetail(
            structure=_structure_from_record(structure),
            version=_version_from_record(record),
            diagnostics=tuple(record.diagnostics_json),
            provenance=_provenance_from_version_record(session, record),
            electronic_state_authority=_state_authority(session, object_store, record),
        )
        for record in records
    )


def _provenance_from_version_record(
    session: Session,
    version: StructureVersionRecord,
) -> StructureVersionProvenance | None:
    provenance = session.get(ProvenanceRecordRow, version.provenance_record_id)
    if provenance is None:
        return None
    parameters = {
        str(item.get("key")): item.get("value")
        for item in provenance.parameters_json
        if isinstance(item, dict) and item.get("key") is not None
    }
    source_artifact = session.get(ScientificArtifactRecord, provenance.source_artifact_id)
    source_ref = _artifact_reference(source_artifact) if source_artifact is not None else None
    return StructureVersionProvenance(
        origin=version.origin,
        detail=provenance.detail,
        geometry_candidate_id=(
            UUID(str(parameters["geometry_candidate_id"]))
            if parameters.get("geometry_candidate_id") else None
        ),
        generation_method=parameters.get("generation_method"),
        geometry_class=parameters.get("geometry_class"),
        candidate_sha256=parameters.get("candidate_sha256"),
        source_artifact=source_ref,
        parser=str(parameters["parser"]) if parameters.get("parser") is not None else None,
        parser_version=(
            str(parameters["parser_version"])
            if parameters.get("parser_version") is not None
            else None
        ),
        adapter=str(parameters["adapter"]) if parameters.get("adapter") is not None else None,
        adapter_version=(
            str(parameters["adapter_version"])
            if parameters.get("adapter_version") is not None
            else None
        ),
        operation=provenance.operation,
        operation_version=provenance.operation_version,
        source_class=provenance.source_class,
        coordinate_origin=(
            str(parameters["coordinate_origin"])
            if parameters.get("coordinate_origin") is not None
            else None
        ),
        coordinate_input_format=(
            str(parameters["coordinate_input_format"])
            if parameters.get("coordinate_input_format") is not None
            else None
        ),
        coordinate_unit=(
            str(parameters["coordinate_unit"])
            if parameters.get("coordinate_unit") is not None
            else None
        ),
        coordinate_file_sha256=(
            str(parameters["coordinate_file_sha256"])
            if parameters.get("coordinate_file_sha256")
            else None
        ),
        candidate_representation_id=(
            UUID(str(parameters["representation_id"]))
            if parameters.get("representation_id")
            and provenance.operation == "chemdft.structure_candidate.promote"
            else None
        ),
        verification_state=provenance.verification_state,
        created_at=provenance.created_at,
        actor_id=(
            UUID(provenance.producer_identifier)
            if provenance.producer_kind == ProducerKind.USER and provenance.producer_identifier
            else None
        ),
        calculation_id=UUID(str(parameters["calculation_id"]))
        if parameters.get("calculation_id")
        else None,
        trajectory_id=UUID(str(parameters["trajectory_id"]))
        if parameters.get("trajectory_id")
        else None,
        final_step_index=int(parameters["final_step_index"])
        if parameters.get("final_step_index") is not None
        else None,
        source_reference=(
            str(parameters["source_reference"])
            if parameters.get("source_reference") is not None
            else (
                str(version.representation_json.get("source_reference"))
                if (
                    version.representation_json
                    and version.representation_json.get("source_reference")
                )
                else None
            )
        ),
    )


def export_structure_version(
    session: Session,
    identity: Identity,
    project_id: str,
    structure_id: str,
    version_id: str,
    export_format: str,
) -> tuple[str, str, bytes]:
    project, _member = authorize_project_access(session, identity, project_id)
    structure = session.get(StructureRecord, structure_id)
    version = session.get(StructureVersionRecord, version_id)
    if (
        structure is None
        or version is None
        or structure.project_id != project.id
        or version.project_id != project.id
        or version.structure_id != structure.id
    ):
        raise ScientificReferenceNotFound("Structure version does not exist in this project.")
    candidate = _candidate_from_version_record(structure, version)
    normalized = export_format.strip().upper()
    match normalized:
        case "SDF":
            if candidate.kind is StructureKind.PERIODIC:
                raise ScientificValidationFailed("Periodic structures cannot be exported as SDF.")
            return (f"{structure.name}.sdf", "chemical/x-mdl-sdfile", export_sdf(candidate))
        case "MOL":
            if candidate.kind is StructureKind.PERIODIC:
                raise ScientificValidationFailed("Periodic structures cannot be exported as MOL.")
            return (f"{structure.name}.mol", "chemical/x-mdl-molfile", export_mol(candidate))
        case "XYZ":
            if candidate.kind is StructureKind.PERIODIC:
                raise ScientificValidationFailed("Periodic structures cannot be exported as XYZ.")
            return (f"{structure.name}.xyz", "chemical/x-xyz", export_xyz(candidate))
        case "SMILES":
            if candidate.kind is StructureKind.PERIODIC:
                raise ScientificValidationFailed(
                    "Periodic structures cannot be exported as SMILES."
                )
            return (f"{structure.name}.smi", "chemical/x-daylight-smiles", export_smiles(candidate))
        case "CIF":
            if candidate.kind is not StructureKind.PERIODIC:
                raise ScientificValidationFailed("Only periodic structures can be exported as CIF.")
            return (f"{structure.name}.cif", "chemical/x-cif", export_cif(candidate))
        case _:
            raise ScientificValidationFailed("Unsupported export format.")


def _candidate_from_version_record(
    structure: StructureRecord,
    version: StructureVersionRecord,
) -> CanonicalStructureCandidate:
    kind = StructureKind(structure.kind)
    source = version.representation_json.get("source", {})
    source_format = (
        StructureSourceFormat.CIF if kind is StructureKind.PERIODIC else StructureSourceFormat.SDF
    )
    return CanonicalStructureCandidate(
        name=structure.name,
        kind=kind,
        coordinates=version.representation_json["coordinates"],
        overall_charge=version.overall_charge,
        multiplicity=version.multiplicity,
        source_format=source_format,
        parser_name=str(source.get("parser", "chemdft")),
        parser_version=str(source.get("parser_version", "1.0.0")),
        adapter_name=str(source.get("adapter", "chemdft.export")),
        adapter_version=str(source.get("adapter_version", "1.0.0")),
        periodic_cell=version.periodic_cell_json,
        diagnostics=tuple(version.diagnostics_json),
    )


def _validate_thermochemistry_publication(
    session: Session,
    *,
    project_id: str,
    submission: AuthoritativeResultSubmission,
    specification: ThermochemistryResult,
    stored_specification: dict,
    calculation: CalculationRecord,
    calculation_input: CalculationInputRecord,
    normalized_input_artifact: ScientificArtifactRecord,
) -> None:
    """Scientific Result Firewall checks for ``chemdft.thermochemistry`` publication."""
    from .scientific.engines import symmetry_number
    from .scientific.engines.thermochemistry import (
        STATIONARITY_RMS_CRITERION_HARTREE_PER_BOHR,
        canonical_sha256,
    )

    def reject(message: str) -> None:
        raise ScientificValidationFailed(message)

    if (
        stored_specification.get("task_type") != "THERMOCHEMISTRY"
        or submission.result_type != "chemdft.thermochemistry"
    ):
        reject("Thermochemistry result does not match its task.")
    if (
        submission.producer_software.name != "pyscf"
        or submission.producer_software.environment_artifact is None
        or specification.engine != "pyscf"
        or specification.producer != "local.pyscf.worker"
    ):
        reject("Thermochemistry publication requires attested PySCF provenance.")
    if specification.calculation_id != UUID(calculation.id):
        reject("Thermochemistry calculation identity is invalid.")
    if specification.calculation_input_hash != normalized_input_artifact.sha256:
        reject("Thermochemistry calculation input hash is invalid.")
    if thermochemistry_result_hash(specification) != specification.result_sha256:
        reject("Thermochemistry result hash is invalid.")

    options = stored_specification.get("thermochemistry") or {}
    if (
        options.get("temperature_k") != specification.conditions.temperature_k
        or options.get("pressure_pa") != specification.conditions.pressure_pa
        or options.get("thermo_model") != specification.conditions.thermo_model
        or options.get("source_frequency_result_id") != str(specification.frequency_result_id)
    ):
        reject("Thermochemistry conditions or source differ from the immutable request.")
    stored_basis = stored_specification.get("basis")
    if (
        specification.method != stored_specification["method"]["identifier"].lower()
        or stored_basis is None
        or specification.basis != stored_basis["identifier"].lower()
        or specification.molecule.charge != stored_specification["charge"]
        or specification.molecule.multiplicity != stored_specification["multiplicity"]
    ):
        reject("Thermochemistry method/basis/system differs from the immutable request.")
    if calculation_input.structure_version_id != str(specification.input_structure_version_id):
        reject("Thermochemistry must reference the calculation's optimized StructureVersion.")

    frequency = session.get(CalculationResultRecord, str(specification.frequency_result_id))
    if (
        frequency is None
        or frequency.project_id != project_id
        or frequency.result_type != "chemdft.vibrational-analysis"
        or frequency.authority != "AUTHORITATIVE"
        or frequency.validation_state != "VALIDATED"
        or frequency.calculation_id != str(specification.frequency_calculation_id)
    ):
        reject("Thermochemistry frequency source is not a validated authoritative result.")
    try:
        frequency_payload = VibrationalAnalysis.model_validate(frequency.payload_json)
    except ValueError:
        reject("Thermochemistry frequency source failed re-validation.")
    if (
        frequency_payload.result_sha256 != specification.frequency_result_sha256
        or frequency_payload.equilibrium_coordinates_hash != specification.geometry_hash
        or tuple(frequency_payload.atom_identities) != tuple(specification.molecule.atom_identities)
        or frequency_payload.equilibrium_coordinates_angstrom
        != tuple(tuple(point) for point in specification.molecule.equilibrium_coordinates_angstrom)
        or tuple(mode.frequency_cm1 for mode in frequency_payload.modes)
        != tuple(specification.frequencies_cm1)
        or any(mode.frequency_cm1 < 0 or mode.imaginary for mode in frequency_payload.modes)
        or str(frequency_payload.input_structure_version_id)
        != str(specification.input_structure_version_id)
        or frequency_payload.input_structure_hash != specification.input_structure_hash
    ):
        reject("Thermochemistry geometry/frequencies differ from the frequency result.")

    energy_reference = specification.energy_artifact
    energy_record = _artifact_or_reject(session, project_id, energy_reference)
    if (
        energy_record.kind != "NORMALIZED_RESULT"
        or energy_record.format_identifier != "chemdft.worker.vibrational-analysis"
        or energy_record.sha256 != specification.energy_artifact_sha256
        or energy_reference not in submission.raw_artifacts
        or not any(
            entry.get("artifact_id") == str(energy_reference.artifact_id)
            and entry.get("sha256") == energy_reference.sha256
            for entry in frequency.raw_artifacts_json
        )
    ):
        reject("Thermochemistry E0 artifact is not hash-referenced by the frequency result.")

    optimization = session.get(CalculationResultRecord, str(specification.optimization_result_id))
    if (
        optimization is None
        or optimization.project_id != project_id
        or optimization.result_type != "chemdft.optimization"
        or optimization.authority != "AUTHORITATIVE"
        or optimization.validation_state != "VALIDATED"
        or optimization.calculation_id != str(specification.optimization_calculation_id)
        or optimization.payload_json.get("final_structure_version_id")
        != str(specification.input_structure_version_id)
        or canonical_sha256(optimization.payload_json) != specification.optimization_result_sha256
    ):
        reject("Thermochemistry optimization provenance is invalid.")
    version = session.get(StructureVersionRecord, str(specification.input_structure_version_id))
    if (
        version is None
        or version.project_id != project_id
        or version.origin != "OPTIMIZED"
        or version.structure_id != str(specification.input_structure_id)
    ):
        reject("Thermochemistry source geometry is not an optimized StructureVersion.")
    trajectory = session.scalar(
        select(OptimizationTrajectoryRecord).where(
            OptimizationTrajectoryRecord.project_id == project_id,
            OptimizationTrajectoryRecord.calculation_id
            == str(specification.optimization_calculation_id),
        )
    )
    if trajectory is None or not trajectory.steps_json:
        reject("Thermochemistry optimization trajectory is unavailable.")
    final_step = trajectory.steps_json[-1]
    stationarity = specification.diagnostics.stationarity
    if (
        trajectory.final_structure_version_id != version.id
        or final_step.get("gradient_rms_hartree_per_bohr") is None
        or float(final_step["gradient_rms_hartree_per_bohr"])
        != stationarity.gradient_rms_hartree_per_bohr
        or stationarity.gradient_rms_hartree_per_bohr > STATIONARITY_RMS_CRITERION_HARTREE_PER_BOHR
    ):
        reject("Thermochemistry stationarity evidence does not match the optimization trajectory.")

    symmetry = specification.symmetry
    elements = list(specification.molecule.atom_identities)
    coordinates = [list(point) for point in specification.molecule.equilibrium_coordinates_angstrom]
    if symmetry.source == "user-override":
        if (
            options.get("symmetry_number_override") != symmetry.rotational_symmetry_number
            or not options.get("symmetry_override_reason")
            or options.get("symmetry_override_reason") != symmetry.override_reason
        ):
            reject("Symmetry-number override differs from the immutable request.")
    else:
        try:
            detected = symmetry_number.rotational_symmetry_number(elements, coordinates)
        except symmetry_number.SymmetryUndetermined as error:
            raise ScientificValidationFailed(
                f"Symmetry number cannot be re-established: {error}"
            ) from error
        if (
            detected.sigma != symmetry.rotational_symmetry_number
            or detected.algorithm_version != symmetry.algorithm_version
        ):
            reject("Symmetry number differs from the deterministic ChemDFT determination.")


def _artifact_or_reject(
    session: Session, project_id: str, ref: ArtifactReference
) -> ScientificArtifactRecord:
    artifact = session.get(ScientificArtifactRecord, str(ref.artifact_id))
    if artifact is None:
        raise ScientificReferenceNotFound("Referenced scientific artifact does not exist.")
    if artifact.project_id != project_id or str(ref.project_id) != project_id:
        raise CrossProjectReference()
    if artifact.sha256 != ref.sha256:
        raise ArtifactHashMismatch()
    return artifact


def _result_from_record(record: CalculationResultRecord) -> CalculationResult:
    result = CalculationResult(
        id=UUID(record.id),
        result_type=record.result_type,
        project_id=UUID(record.project_id),
        calculation_id=UUID(record.calculation_id),
        calculation_input_id=UUID(record.calculation_input_id),
        authority=ResultAuthority(record.authority),
        source_class=ProvenanceClass(record.source_class),
        verification_state=VerificationState(record.verification_state),
        validation_state=ResultValidationState(record.validation_state),
        trusted_producer_id=record.trusted_producer_id,
        trusted_producer_type=record.trusted_producer_type,
        producer_attestation_id=record.producer_attestation_id,
        producer_software=EngineReference.model_validate(record.producer_software_json),
        payload=record.payload_json,
        provenance_record_id=UUID(record.provenance_record_id),
        raw_artifacts=record.raw_artifacts_json,
        created_at=record.created_at,
    )
    from sqlalchemy.orm import object_session

    from .effective_result_state import effective_result_state

    state = effective_result_state(object_session(record), record)
    result = result.model_copy(update={
        "effective_state": state,
        "authority": ResultAuthority(state.authority),
        "validation_state": ResultValidationState(state.validation_state),
    })
    return result


def _audit_result_event(
    session: Session,
    *,
    submission: AuthoritativeResultSubmission,
    producer_id: str,
    outcome: str,
    error_category: str | None = None,
    result_id: str | None = None,
) -> None:
    project = session.get(Project, str(submission.project_id))
    if project is None:
        return
    targets = [
        {
            "project_id": str(submission.project_id),
            "entity_type": "calculation.record",
            "entity_id": str(submission.calculation_id),
        }
    ]
    if result_id:
        targets.append(
            {
                "project_id": str(submission.project_id),
                "entity_type": "calculation.result",
                "entity_id": result_id,
            }
        )
    session.add(
        AuditEventRecord(
            event_name=(
                "scientific_result.accepted"
                if outcome == "SUCCEEDED"
                else "scientific_result.rejected"
            ),
            actor_or_service_id=producer_id,
            organization_id=project.organization_id,
            project_id=project.id,
            request_id=str(submission.request_id),
            targets_json=targets,
            outcome=outcome,
            error_category=error_category,
            artifact_references_json=[
                ref.model_dump(mode="json") for ref in submission.raw_artifacts
            ],
            safe_metadata_json=[],
        )
    )


def accept_authoritative_result(
    session: Session,
    producer: TrustedProducerContext,
    submission: AuthoritativeResultSubmission,
    *,
    object_store: ObjectStore | None = None,
    settings=None,
    commit: bool = True,
) -> CalculationResult:
    if not is_issued_trusted_producer(producer):
        raise TrustedProducerRequired()

    project_id = str(submission.project_id)
    try:
        if producer.project_id != submission.project_id:
            raise CrossProjectReference("Trusted producer capability is scoped to another project.")
        if submission.schema_version not in RECOGNIZED_RESULT_SCHEMA_VERSIONS:
            raise SchemaVersionUnsupported()

        existing = session.scalar(
            select(CalculationResultRecord).where(
                CalculationResultRecord.project_id == project_id,
                CalculationResultRecord.idempotency_key == submission.idempotency_key,
            )
        )
        if existing is not None:
            # A retry may return only the same publication, with an intact binding.
            # In particular, do not silently repair historical dangling subjects.
            provenance = session.get(ProvenanceRecordRow, existing.provenance_record_id)
            calculation_input = session.get(CalculationInputRecord, existing.calculation_input_id)
            calculation = session.get(CalculationRecord, existing.calculation_id)
            if provenance is None or calculation_input is None or calculation is None:
                raise ScientificReferenceNotFound()
            if any(
                row.project_id != project_id
                for row in (existing, provenance, calculation_input, calculation)
            ):
                raise CrossProjectReference()
            if (
                provenance.subject_type != "calculation.result"
                or provenance.subject_id != existing.id
                or calculation_input.calculation_id != existing.calculation_id
                or existing.calculation_id != str(submission.calculation_id)
                or existing.calculation_input_id != str(submission.calculation_input_id)
                or existing.provenance_record_id != str(submission.provenance_record_id)
                or existing.result_type != submission.result_type
                or existing.trusted_producer_id != producer.producer_id
                or existing.trusted_producer_type != producer.producer_type
                or existing.producer_attestation_id != producer.attestation_id
                or existing.producer_software_json
                != submission.producer_software.model_dump(mode="json")
                or existing.payload_json != submission.payload.model_dump(mode="json")
                or existing.raw_artifacts_json
                != [ref.model_dump(mode="json") for ref in submission.raw_artifacts]
            ):
                raise ScientificValidationFailed("Idempotent result publication identity differs.")
            return _result_from_record(existing)

        calculation = session.get(CalculationRecord, str(submission.calculation_id))
        calculation_input = session.get(
            CalculationInputRecord, str(submission.calculation_input_id)
        )
        provenance = session.get(ProvenanceRecordRow, str(submission.provenance_record_id))
        if calculation is None or calculation_input is None or provenance is None:
            raise ScientificReferenceNotFound()
        if any(
            record.project_id != project_id
            for record in (calculation, calculation_input, provenance)
        ):
            raise CrossProjectReference()
        if calculation_input.calculation_id != calculation.id:
            raise ScientificValidationFailed(
                "Calculation input does not belong to the calculation."
            )
        if calculation.state != CalculationLifecycle.SUCCEEDED:
            raise InvalidLifecycleTransition(
                "Only a succeeded calculation may publish an authoritative result."
            )
        if provenance.source_class != ProvenanceClass.CALCULATED:
            raise ScientificValidationFailed(
                "Calculated authoritative results require CALCULATED provenance."
            )
        if provenance.verification_state in {
            VerificationState.RETRACTED,
            VerificationState.SUPERSEDED,
        }:
            raise ScientificValidationFailed("Inactive provenance cannot authorize publication.")
        if provenance.subject_type != "calculation.result":
            raise ScientificValidationFailed(
                "Authoritative provenance must describe a calculation result."
            )
        try:
            canonical_subject = str(UUID(provenance.subject_id))
        except ValueError as error:
            raise ScientificValidationFailed("Provenance result subject must be a UUID.") from error
        if canonical_subject != provenance.subject_id:
            raise ScientificValidationFailed(
                "Provenance result subject must use canonical UUID form."
            )
        # All native callers reserve the result subject before entering the Firewall.
        # Never rebind provenance already used by another published result, even
        # when its subject is corrupt or its submission uses a new retry key.
        if (
            session.scalar(
                select(CalculationResultRecord.id).where(
                    CalculationResultRecord.provenance_record_id == provenance.id
                )
            )
            is not None
            or session.get(CalculationResultRecord, provenance.subject_id) is not None
        ):
            raise ScientificValidationFailed("Provenance is already bound to a published result.")

        normalized_input_artifact = session.get(
            ScientificArtifactRecord, calculation_input.normalized_input_artifact_id
        )
        if normalized_input_artifact is None:
            raise ScientificReferenceNotFound("Normalized calculation input artifact is missing.")
        if normalized_input_artifact.project_id != project_id:
            raise CrossProjectReference()
        if provenance.source_artifact_id is None:
            raise ScientificValidationFailed(
                "Calculated provenance must identify an immutable source artifact."
            )
        provenance_artifact = session.get(ScientificArtifactRecord, provenance.source_artifact_id)
        if provenance_artifact is None:
            raise ScientificReferenceNotFound("Provenance source artifact is missing.")
        if provenance_artifact.project_id != project_id:
            raise CrossProjectReference()

        references = list(submission.raw_artifacts) + list(
            getattr(submission.payload, "artifacts", ())
        )
        if submission.producer_software.environment_artifact:
            references.append(submission.producer_software.environment_artifact)
        if (
            isinstance(submission.payload, OptimizationResult)
            and calculation_input.specification_json.get("engine_preference", {}).get("engine")
            == "xtb"
            and any(
                session.get(ScientificArtifactRecord, str(ref.artifact_id)) is None
                for ref in submission.raw_artifacts
            )
        ):
            raise ScientificValidationFailed(
                "Native optimization raw evidence artifact is missing."
            )
        for artifact_reference in references:
            _artifact_or_reject(session, project_id, artifact_reference)

        specification = submission.payload
        stored_specification = calculation_input.specification_json
        from .contracts.dftd4 import (
            DispersionCorrectedEnergyResult,
            NativeDispersionCorrectedEnergyResult,
        )

        if isinstance(
            specification, (DispersionCorrectedEnergyResult, NativeDispersionCorrectedEnergyResult)
        ):
            from .dftd4_firewall import validate_dftd4_publication

            try:
                validate_dftd4_publication(
                    session,
                    producer,
                    submission,
                    calculation,
                    calculation_input,
                    provenance,
                    normalized_input_artifact,
                    object_store,
                    settings,
                )
            except (ValueError, KeyError, TypeError, OSError) as error:
                raise ScientificValidationFailed(
                    "D4 publication rejected: " + str(error)
                ) from error
        elif (
            stored_specification.get("engine_preference", {}).get("engine") == "dftd4"
            or producer.producer_id == "local.dftd4.worker"
            or submission.producer_software.name == "dftd4"
        ):
            raise ScientificValidationFailed(
                "D4 cannot publish a generic energy or unrelated payload."
            )
        elif isinstance(specification, PeriodicEnergyResult):
            if stored_specification.get("task_type") != "PERIODIC_ENERGY":
                raise ScientificValidationFailed(
                    "Periodic energy payload cannot be published for a different task type."
                )
            if submission.result_type != "chemdft.periodic-energy":
                raise ScientificValidationFailed(
                    "Periodic energy result type does not match its payload."
                )
            if specification.total_energy.unit.code != "Eh":
                raise ScientificValidationFailed("Authoritative energy must use canonical Hartree.")
        elif isinstance(specification, EnergyResult):
            if stored_specification.get("task_type") != "ENERGY":
                raise ScientificValidationFailed(
                    "Energy payload cannot be published for a different task type."
                )
            if submission.result_type != "chemdft.energy":
                raise ScientificValidationFailed("Energy result type does not match its payload.")
            if specification.total_energy.unit.code != "Eh":
                raise ScientificValidationFailed("Authoritative energy must use canonical Hartree.")
            if specification.method != stored_specification["method"]["identifier"].lower():
                raise ScientificValidationFailed("Result method does not match immutable input.")
            stored_basis = stored_specification.get("basis")
            if stored_basis is None:
                if specification.basis is not None:
                    raise ScientificValidationFailed("Result basis does not match immutable input.")
            else:
                expected_basis = (
                    stored_basis["identifier"].lower()
                    if isinstance(stored_basis, dict)
                    else str(stored_basis).lower()
                )
                if specification.basis != expected_basis:
                    raise ScientificValidationFailed("Result basis does not match immutable input.")
            if (
                stored_specification.get("engine_preference", {}).get("engine") == "psi4"
                or submission.producer_software.name == "psi4"
            ):
                from .psi4_firewall import validate_psi4_publication

                validate_psi4_publication(
                    session,
                    producer,
                    submission,
                    calculation,
                    calculation_input,
                    provenance,
                    normalized_input_artifact,
                    object_store,
                    settings,
                )
        elif isinstance(specification, ConformerEnsembleResult):
            from .conformer_firewall import validate_crest_publication

            validate_crest_publication(
                session,
                producer,
                submission,
                calculation,
                calculation_input,
                provenance,
                normalized_input_artifact,
                object_store,
                settings,
            )
        elif isinstance(specification, OptimizationResult):
            if (
                stored_specification.get("task_type") != "GEOMETRY_OPTIMIZATION"
                or submission.result_type != "chemdft.optimization"
            ):
                raise ScientificValidationFailed("Optimization result does not match its task.")
            expected_engine = stored_specification.get("engine_preference", {}).get(
                "engine", "pyscf"
            )
            if expected_engine == "pyscf" and stored_specification.get("basis") is None:
                raise ScientificValidationFailed("PySCF optimization requires its Gaussian basis.")
            if expected_engine not in {"pyscf", "xtb"}:
                raise ScientificValidationFailed("Unsupported optimization publication engine.")
            if producer.producer_id != f"local.{expected_engine}.worker":
                raise ScientificValidationFailed(
                    "Optimization producer ID does not match its engine."
                )
            if producer.producer_type != ProducerType.SCIENTIFIC_WORKER:
                raise ScientificValidationFailed(
                    "Optimization requires a scientific worker producer."
                )
            if provenance.producer_identifier != producer.producer_id:
                raise ScientificValidationFailed("Optimization provenance producer does not match.")
            if submission.producer_software.name != expected_engine:
                raise ScientificValidationFailed(
                    "Optimization producer software does not match its engine."
                )
            if submission.producer_software.environment_artifact is None:
                raise ScientificValidationFailed(
                    "Optimization requires engine environment provenance."
                )
            trajectory = session.scalar(
                select(OptimizationTrajectoryRecord).where(
                    OptimizationTrajectoryRecord.calculation_id == calculation.id
                )
            )
            if (
                trajectory is None
                or trajectory.project_id != project_id
                or trajectory.state != "CONVERGED"
            ):
                raise ScientificValidationFailed("A converged validated trajectory is required.")
            if trajectory.engine_json != submission.producer_software.model_dump(mode="json"):
                raise ScientificValidationFailed(
                    "Optimization engine identity differs from validated trajectory provenance."
                )
            if (
                trajectory.input_hash != normalized_input_artifact.sha256
                or trajectory.input_structure_version_id != calculation_input.structure_version_id
            ):
                raise ScientificValidationFailed(
                    "Optimization input differs from immutable calculation input."
                )
            if (
                trajectory.artifact_id != str(specification.trajectory_artifact.artifact_id)
                or trajectory.artifact_sha256 != specification.trajectory_sha256
            ):
                raise ScientificValidationFailed(
                    "Trajectory artifact does not match validated engine output."
                )
            if trajectory.final_structure_version_id != str(
                specification.final_structure_version_id
            ):
                raise ScientificValidationFailed(
                    "Final version does not match trajectory publication."
                )
            final_version = session.get(
                StructureVersionRecord, trajectory.final_structure_version_id
            )
            if (
                final_version is None
                or final_version.project_id != project_id
                or final_version.parent_version_id != calculation_input.structure_version_id
                or final_version.origin != "OPTIMIZED"
            ):
                raise ScientificValidationFailed(
                    "Optimized version lacks the authoritative input lineage."
                )
            final_artifact = session.get(
                ScientificArtifactRecord, final_version.canonical_artifact_id
            )
            if (
                final_artifact is None
                or final_artifact.sha256 != specification.final_structure_hash
            ):
                raise ScientificValidationFailed(
                    "Final structure hash does not match the canonical artifact."
                )
            if len(trajectory.steps_json) != specification.step_count or not trajectory.steps_json:
                raise ScientificValidationFailed(
                    "Published optimization step count differs from engine trajectory."
                )
            final_step = trajectory.steps_json[-1]
            if expected_engine == "xtb":
                attempt = session.scalar(
                    select(CalculationAttemptRecord)
                    .where(
                        CalculationAttemptRecord.calculation_id == calculation.id,
                        CalculationAttemptRecord.state == CalculationLifecycle.SUCCEEDED,
                    )
                    .order_by(CalculationAttemptRecord.attempt_number.desc())
                    .limit(1)
                )
                execution_record = (
                    session.scalar(
                        select(ComputeExecutionRecord).where(
                            ComputeExecutionRecord.calculation_attempt_id == attempt.id,
                            ComputeExecutionRecord.project_id == project_id,
                            ComputeExecutionRecord.state == "FINISHED",
                        )
                    )
                    if attempt
                    else None
                )
                native_records = [
                    session.get(ScientificArtifactRecord, str(ref.artifact_id))
                    for ref in submission.raw_artifacts
                ]
                native_xyz = next(
                    (
                        record
                        for record in native_records
                        if record is not None
                        and record.format_identifier == "xtb.native.xtbopt.xyz"
                    ),
                    None,
                )
                if native_xyz is None:
                    raise ScientificValidationFailed(
                        "Native optimization final XYZ evidence is missing."
                    )
                if submission.producer_software.version != "6.7.1":
                    raise ScientificValidationFailed(
                        "Native optimization engine version is not authorized."
                    )
                if stored_specification.get("method", {}).get("identifier") != "gfn2":
                    raise ScientificValidationFailed("Native optimization method must be GFN2.")
                if stored_specification.get("basis") is not None:
                    raise ScientificValidationFailed("Native optimization basis must be null.")
                if stored_specification.get("optimization", {}).get("optimizer") != "xtb-ancopt":
                    raise ScientificValidationFailed("Native optimization requires ANCopt.")
                if attempt is None:
                    raise ScientificValidationFailed(
                        "Native optimization succeeded attempt is missing."
                    )
                if execution_record is None:
                    raise ScientificValidationFailed(
                        "Native optimization finished execution is missing."
                    )
                if (
                    producer.attestation_id
                    != f"execution:{execution_record.id}:attempt:{attempt.attempt_number}"
                ):
                    raise ScientificValidationFailed(
                        "Native optimization execution attestation does not match."
                    )
                if attempt.engine_identity_json != trajectory.engine_json:
                    raise ScientificValidationFailed(
                        "Native optimization attempt engine does not match."
                    )
                if attempt.raw_artifacts_json != [
                    ref.model_dump(mode="json") for ref in submission.raw_artifacts
                ]:
                    raise ScientificValidationFailed(
                        "Native optimization attempt evidence does not match."
                    )
                if (
                    native_xyz.source_relation_id != calculation.id
                    or native_xyz.source_relation_type != "calculation.record"
                ):
                    raise ScientificValidationFailed(
                        "Native optimization final XYZ belongs to another calculation."
                    )
                if final_step.get("evaluation_kind") != "FINAL_SINGLE_POINT":
                    raise ScientificValidationFailed(
                        "Native optimization endpoint is not a final single-point evaluation."
                    )
                if (
                    final_step.get("source_file") != "xtbopt.xyz"
                    or final_step.get("source_frame_index") != 0
                ):
                    raise ScientificValidationFailed(
                        "Native optimization final frame does not identify final XYZ."
                    )
                if final_step.get("source_sha256") != native_xyz.sha256:
                    raise ScientificValidationFailed(
                        "Native optimization final XYZ hash does not match."
                    )
                if specification.optimization_iterations != len(trajectory.steps_json) - 1:
                    raise ScientificValidationFailed(
                        "Native optimization iteration count includes a non-optimizer evaluation."
                    )
            final_atoms = final_version.representation_json["coordinates"]["atoms"]
            if [
                {key: atom[key] for key in ("index", "element", "atomic_number")}
                for atom in final_atoms
            ] != [
                {key: atom[key] for key in ("index", "element", "atomic_number")}
                for atom in trajectory.atom_identities_json
            ]:
                raise ScientificValidationFailed(
                    "Optimized structure changed immutable atom identities."
                )
            if [[atom["x"], atom["y"], atom["z"]] for atom in final_atoms] != final_step[
                "coordinates_angstrom"
            ]:
                raise ScientificValidationFailed(
                    "Final coordinates do not exactly match the validated engine step."
                )
            if (
                specification.final_energy.value != final_step["energy_hartree"]
                or specification.final_energy.unit.code != "Eh"
            ):
                raise ScientificValidationFailed(
                    "Final energy does not match the validated engine step."
                )
            if specification.method != stored_specification["method"][
                "identifier"
            ].lower() or specification.basis != (
                stored_specification["basis"]["identifier"].lower()
                if stored_specification.get("basis")
                else None
            ):
                raise ScientificValidationFailed(
                    "Optimization method or basis differs from immutable input."
                )
        elif isinstance(specification, VibrationalAnalysis):
            if (
                stored_specification.get("task_type") != "FREQUENCY"
                or submission.result_type != "chemdft.vibrational-analysis"
            ):
                raise ScientificValidationFailed("Vibrational result does not match its task.")
            if (
                submission.producer_software.name != "pyscf"
                or submission.producer_software.environment_artifact is None
            ):
                raise ScientificValidationFailed(
                    "Vibrational publication requires attested PySCF provenance."
                )
            source_version = session.get(
                StructureVersionRecord, calculation_input.structure_version_id
            )
            if source_version is None or source_version.project_id != project_id:
                raise ScientificValidationFailed(
                    "Vibrational input StructureVersion is unavailable."
                )
            source_artifact = session.get(
                ScientificArtifactRecord, source_version.canonical_artifact_id
            )
            if (
                source_artifact is None
                or source_artifact.sha256 != specification.input_structure_hash
            ):
                raise ScientificValidationFailed("Vibrational input structure hash is invalid.")
            expected_spec_hash = hashlib.sha256(
                json.dumps(stored_specification, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            if specification.calculation_specification_hash != expected_spec_hash:
                raise ScientificValidationFailed("Vibrational specification hash is invalid.")
            structure_atoms = source_version.representation_json["coordinates"]["atoms"]
            identities = tuple(atom["element"] for atom in structure_atoms)
            coordinates = tuple(
                tuple(float(atom[axis]) for axis in ("x", "y", "z")) for atom in structure_atoms
            )
            unit = source_version.representation_json["coordinates"]["unit"]
            if unit == "bohr":
                coordinates = tuple(
                    tuple(value / 1.8897261254578281 for value in xyz) for xyz in coordinates
                )
            if specification.input_structure_version_id != UUID(
                calculation_input.structure_version_id
            ):
                raise ScientificValidationFailed(
                    "Vibrational result refers to a different StructureVersion."
                )
            if (
                specification.atom_identities != identities
                or specification.equilibrium_coordinates_angstrom != coordinates
            ):
                raise ScientificValidationFailed(
                    "Vibrational atom ordering or equilibrium coordinates differ from input."
                )
            from .scientific.engines.vibrational import expected_mode_count

            expected_count = expected_mode_count([list(xyz) for xyz in coordinates])
            if specification.expected_vibrational_mode_count != expected_count:
                raise ScientificValidationFailed(
                    "Vibrational mode count differs from molecular degrees of freedom."
                )
            stored_basis = stored_specification.get("basis")
            if (
                specification.engine != "pyscf"
                or specification.method != stored_specification["method"]["identifier"].lower()
                or stored_basis is None
                or specification.basis != stored_basis["identifier"].lower()
                or specification.charge != stored_specification["charge"]
                or specification.multiplicity != stored_specification["multiplicity"]
            ):
                raise ScientificValidationFailed(
                    "Vibrational engine settings differ from immutable input."
                )
            hessian_reference = specification.hessian_artifact
            hessian_record = _artifact_or_reject(session, project_id, hessian_reference)
            if (
                hessian_record.kind != "HESSIAN_MATRIX"
                or hessian_reference not in submission.raw_artifacts
            ):
                raise ScientificValidationFailed(
                    "Validated Hessian artifact is missing from result provenance."
                )
            if specification.raman_artifact is not None:
                raman_reference = specification.raman_artifact
                raman_record = _artifact_or_reject(session, project_id, raman_reference)
                if (
                    raman_record.kind != "RAMAN_ANALYSIS"
                    or raman_reference not in submission.raw_artifacts
                ):
                    raise ScientificValidationFailed(
                        "Validated Raman artifact is missing from result provenance."
                    )
            if specification.calculation_id != UUID(calculation.id):
                raise ScientificValidationFailed(
                    "Vibrational result calculation identity is invalid."
                )
        elif isinstance(specification, MolecularOrbitalAnalysis):
            if (
                stored_specification.get("task_type") != "ORBITAL"
                or submission.result_type != "chemdft.molecular-orbitals"
            ):
                raise ScientificValidationFailed(
                    "Molecular-orbital result does not match its task."
                )
            if (
                submission.producer_software.name != "pyscf"
                or submission.producer_software.environment_artifact is None
                or specification.engine != "pyscf"
                or specification.producer != "local.pyscf.worker"
            ):
                raise ScientificValidationFailed(
                    "Molecular-orbital publication requires attested PySCF provenance."
                )
            source_version = session.get(
                StructureVersionRecord, calculation_input.structure_version_id
            )
            if (
                source_version is None
                or source_version.project_id != project_id
                or specification.input_structure_id != UUID(source_version.structure_id)
                or specification.input_structure_version_id != UUID(source_version.id)
            ):
                raise ScientificValidationFailed(
                    "Molecular-orbital result must reference the calculation StructureVersion."
                )
            structure_artifact = session.get(
                ScientificArtifactRecord, source_version.canonical_artifact_id
            )
            if (
                structure_artifact is None
                or structure_artifact.sha256 != specification.input_structure_hash
            ):
                raise ScientificValidationFailed(
                    "Molecular-orbital input structure hash is invalid."
                )
            if specification.calculation_id != UUID(calculation.id):
                raise ScientificValidationFailed(
                    "Molecular-orbital calculation identity is invalid."
                )
            if specification.calculation_input_hash != normalized_input_artifact.sha256:
                raise ScientificValidationFailed(
                    "Molecular-orbital calculation input hash is invalid."
                )
            stored_method = stored_specification["method"]["identifier"].lower()
            stored_basis = stored_specification.get("basis")
            if (
                specification.method != stored_method
                or stored_basis is None
                or specification.basis != stored_basis["identifier"].lower()
                or specification.charge != stored_specification["charge"]
                or specification.multiplicity != stored_specification["multiplicity"]
            ):
                raise ScientificValidationFailed(
                    "Molecular-orbital method or system charge differs from immutable input."
                )
            coefficient_artifact = _artifact_or_reject(
                session, project_id, specification.coefficient_artifact
            )
            if (
                coefficient_artifact.kind != "MO_COEFFICIENTS"
                or coefficient_artifact.format_identifier != "chemdft.mo-coefficients.npz"
                or coefficient_artifact.sha256 != specification.coefficient_artifact_sha256
                or specification.coefficient_artifact not in submission.raw_artifacts
                or coefficient_artifact.source_relation_type != "calculation.record"
                or coefficient_artifact.source_relation_id != calculation.id
            ):
                raise ScientificValidationFailed(
                    "Molecular-orbital coefficient artifact lacks engine execution provenance."
                )
            from .scientific.engines.orbitals import validate_molecular_orbital_result_hash

            try:
                validate_molecular_orbital_result_hash(specification)
            except ValueError as error:
                raise ScientificValidationFailed(str(error)) from error
        elif isinstance(specification, TddftResult):
            if (
                stored_specification.get("task_type") != "TDDFT"
                or submission.result_type != "chemdft.tddft"
            ):
                raise ScientificValidationFailed(
                    "TDDFT result does not match its task."
                )
            if (
                submission.producer_software.name != "pyscf"
                or submission.producer_software.environment_artifact is None
                or specification.engine != "pyscf"
                or specification.producer != "local.pyscf.worker"
            ):
                raise ScientificValidationFailed(
                    "TDDFT publication requires attested PySCF provenance."
                )
            source_version = session.get(
                StructureVersionRecord, calculation_input.structure_version_id
            )
            if (
                source_version is None
                or source_version.project_id != project_id
                or specification.input_structure_id != UUID(source_version.structure_id)
                or specification.input_structure_version_id != UUID(source_version.id)
            ):
                raise ScientificValidationFailed(
                    "TDDFT result must reference the calculation StructureVersion."
                )
            structure_artifact = session.get(
                ScientificArtifactRecord, source_version.canonical_artifact_id
            )
            if (
                structure_artifact is None
                or structure_artifact.sha256 != specification.input_structure_hash
            ):
                raise ScientificValidationFailed(
                    "TDDFT input structure hash is invalid."
                )
            if specification.calculation_id != UUID(calculation.id):
                raise ScientificValidationFailed(
                    "TDDFT calculation identity is invalid."
                )
            if specification.calculation_input_hash != normalized_input_artifact.sha256:
                raise ScientificValidationFailed(
                    "TDDFT calculation input hash is invalid."
                )
            stored_method = stored_specification["method"]["identifier"].lower()
            stored_basis = stored_specification.get("basis")
            if (
                specification.method != stored_method
                or stored_basis is None
                or specification.basis != stored_basis["identifier"].lower()
                or specification.charge != stored_specification["charge"]
                or specification.multiplicity != stored_specification["multiplicity"]
            ):
                raise ScientificValidationFailed(
                    "TDDFT method or system charge differs from immutable input."
                )
            amplitudes_artifact = _artifact_or_reject(
                session, project_id, specification.amplitudes_artifact
            )
            if (
                amplitudes_artifact.kind != "TDDFT_AMPLITUDES"
                or amplitudes_artifact.format_identifier != "chemdft.tddft-amplitudes.npz"
                or amplitudes_artifact.sha256 != specification.amplitudes_artifact_sha256
                or specification.amplitudes_artifact not in submission.raw_artifacts
                or amplitudes_artifact.source_relation_type != "calculation.record"
                or amplitudes_artifact.source_relation_id != calculation.id
            ):
                raise ScientificValidationFailed(
                    "TDDFT amplitudes artifact lacks engine execution provenance."
                )
            from .scientific.engines.tddft import validate_tddft_result_hash

            try:
                validate_tddft_result_hash(specification)
            except ValueError as error:
                raise ScientificValidationFailed(str(error)) from error
        elif isinstance(specification, ThermochemistryResult):
            _validate_thermochemistry_publication(
                session,
                project_id=project_id,
                submission=submission,
                specification=specification,
                stored_specification=stored_specification,
                calculation=calculation,
                calculation_input=calculation_input,
                normalized_input_artifact=normalized_input_artifact,
            )
        else:
            raise ScientificValidationFailed(
                "Unknown generic payload cannot become authoritative calculated science."
            )

        record = CalculationResultRecord(
            id=provenance.subject_id,
            project_id=project_id,
            calculation_id=str(submission.calculation_id),
            calculation_input_id=str(submission.calculation_input_id),
            result_type=submission.result_type,
            authority=ResultAuthority.AUTHORITATIVE,
            source_class=ProvenanceClass.CALCULATED,
            verification_state=VerificationState.UNVERIFIED,
            validation_state=ResultValidationState.VALIDATED,
            trusted_producer_id=producer.producer_id,
            trusted_producer_type=producer.producer_type,
            producer_attestation_id=producer.attestation_id,
            producer_software_json=submission.producer_software.model_dump(mode="json"),
            payload_json=submission.payload.model_dump(mode="json"),
            provenance_record_id=str(submission.provenance_record_id),
            raw_artifacts_json=[ref.model_dump(mode="json") for ref in submission.raw_artifacts],
            idempotency_key=submission.idempotency_key,
            request_id=str(submission.request_id),
            correlation_id=str(submission.correlation_id),
            schema_version=submission.schema_version,
            created_at=utc_now(),
        )
        # Provenance is append-only: publish using its reserved subject ID.
        # Result insertion still shares the caller's transaction (commit=False).
        session.add(record)
        _audit_result_event(
            session,
            submission=submission,
            producer_id=producer.producer_id,
            outcome="SUCCEEDED",
            result_id=record.id,
        )
        if commit:
            session.commit()
        else:
            session.flush()
        session.refresh(record)
        return _result_from_record(record)
    except ScientificValidationFailed as error:
        session.rollback()
        _audit_result_event(
            session,
            submission=submission,
            producer_id=producer.producer_id,
            outcome="REJECTED",
            error_category=type(error).__name__,
        )
        session.commit()
        raise
