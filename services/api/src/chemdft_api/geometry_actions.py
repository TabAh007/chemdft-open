"""Drawing → immutable candidate artifact → explicit human acceptance. No new tables."""

from __future__ import annotations

import hashlib
from io import BytesIO

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .context import Identity
from .contracts.geometry import (
    GeometryAtomMapping,
    GeometryCandidateAcceptInput,
    GeometryCandidateAcceptOutput,
    GeometryCandidateListOutput,
    GeometryCandidateManifest,
    GeometryCandidateView,
    MolecularDrawingGenerateInput,
)
from .contracts.provenance import ProducerKind, ProvenanceClass, ProvenanceDetail, VerificationState
from .errors import ProjectAccessDenied, ScientificReferenceNotFound
from .geometry_eligibility import (
    ACCEPT_OPERATION,
    CANDIDATE_FORMAT,
    GENERATION_OPERATION,
    calculation_geometry_eligibility,
    checked_bytes,
    require_candidate_stereochemistry,
    trusted_generation_producer,
    verified_manifest,
)
from .models import new_id
from .project_access import ProjectCapability, can
from .scientific.molecular_geometry import (
    GENERATION_METHOD,
    GeometryValidationFailed,
    generate_conformer,
    generation_parameters,
    parse_drawing,
)
from .scientific.structures import (
    CanonicalStructureCandidate,
    StructureSourceFormat,
    canonical_bytes,
    canonical_document,
)
from .scientific_actions import (
    _artifact_reference,
    _audit_structure_event,
    _persist_canonical_artifact,
    _provenance_for_structure_version,
    _structure_from_record,
    _version_from_record,
)
from .scientific_models import (
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore


def _authorize(session: Session, identity: Identity, project_id: str, *, write: bool = False):
    project, member = authorize_project_access(session, identity, project_id)
    if write and not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    return project


def _store(
    session: Session,
    identity: Identity,
    store: ObjectStore,
    project_id: str,
    data: bytes,
    *,
    kind: str,
    format_identifier: str,
    source_id: str | None = None,
) -> ScientificArtifactRecord:
    stored = store.put_raw(project_id, BytesIO(data), 10 * 1024 * 1024)
    artifact = ScientificArtifactRecord(
        project_id=project_id,
        kind=kind,
        media_type=("chemical/x-mdl-molfile" if format_identifier == "MOL" else "application/json"),
        format_identifier=format_identifier,
        format_version="1.0.0",
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        storage_key=stored.key,
        created_by=identity.user_id,
        source_relation_type="scientific.artifact" if source_id else None,
        source_relation_id=source_id,
        extensions_json=[],
    )
    session.add(artifact)
    session.flush()
    return artifact


def generate_drawing_geometry(
    session: Session,
    identity: Identity,
    store: ObjectStore,
    project_id: str,
    command: MolecularDrawingGenerateInput,
) -> GeometryCandidateView:
    project = _authorize(session, identity, project_id, write=True)
    if command.parent_structure_version is not None:
        ref = command.parent_structure_version
        parent = session.get(StructureVersionRecord, str(ref.entity_id))
        if (
            ref.entity_type != "structure.version"
            or str(ref.project_id) != project.id
            or (parent is None or parent.project_id != project.id)
        ):
            raise ScientificReferenceNotFound("Parent StructureVersion is outside this project.")
    generated = generate_conformer(
        parse_drawing(command.mol_block), command.name, multiplicity=command.multiplicity
    )
    if generated.coordinates.overall_charge != command.expected_charge:
        raise GeometryValidationFailed(
            "GEOMETRY_CHARGE_MISMATCH", "Requested charge disagrees with the drawing."
        )
    source = _store(
        session,
        identity,
        store,
        project.id,
        command.mol_block.encode("utf-8"),
        kind="STRUCTURE_FILE",
        format_identifier="MOL",
    )
    manifest = GeometryCandidateManifest(
        source_drawing=_artifact_reference(source),
        source_graph_sha256=hashlib.sha256(generated.canonical_smiles.encode()).hexdigest(),
        canonical_smiles=generated.canonical_smiles,
        formula=generated.formula,
        source_atom_count=generated.source_atom_count,
        explicit_hydrogen_count=generated.explicit_hydrogen_count,
        atom_mapping=tuple(
            GeometryAtomMapping(
                generated_atom_index=i,
                source_atom_index=source_index,
                hydrogen_parent_source_index=generated.hydrogen_parent_indices[i],
            )
            for i, source_index in enumerate(generated.source_atom_indices)
        ),
        generation_method=GENERATION_METHOD,
        generation_parameters=generation_parameters(),
        coordinate_representation=generated.coordinates,
        parent_structure_version=command.parent_structure_version,
    )
    artifact = _store(
        session,
        identity,
        store,
        project.id,
        canonical_bytes(manifest.model_dump(mode="json")),
        kind="COORDINATES",
        format_identifier=CANDIDATE_FORMAT,
        source_id=source.id,
    )
    session.add(
        ProvenanceRecordRow(
            project_id=project.id,
            subject_type="geometry.candidate",
            subject_id=artifact.id,
            source_class=ProvenanceClass.USER_SUPPLIED,
            detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
            verification_state=VerificationState.UNVERIFIED,
            producer_kind=ProducerKind.SOFTWARE,
            producer_identifier="chemdft.rdkit.geometry",
            producer_software_version=str(generation_parameters()["rdkit_version"]),
            source_artifact_id=source.id,
            operation=GENERATION_OPERATION,
            operation_version="1.0.0",
            parameters_json=[
                {"key": "candidate_sha256", "value": artifact.sha256},
                {"key": "source_graph_sha256", "value": manifest.source_graph_sha256},
            ],
            approximate=True,
            correlation_id=new_id(),
        )
    )
    session.commit()
    return get_geometry_candidate(session, identity, store, project.id, artifact.id)


def _candidate_origin(session: Session, project_id: str, candidate_id: str) -> str:
    """Provenance class of the candidate being accepted (e.g. AI_HYPOTHESIS vs USER_SUPPLIED)."""
    source_class = session.scalar(
        select(ProvenanceRecordRow.source_class).where(
            ProvenanceRecordRow.project_id == project_id,
            ProvenanceRecordRow.subject_type == "geometry.candidate",
            ProvenanceRecordRow.subject_id == candidate_id,
            trusted_generation_producer(),
        )
    )
    return str(getattr(source_class, "value", source_class) or "UNKNOWN")


def get_geometry_candidate(
    session: Session, identity: Identity, store: ObjectStore, project_id: str, candidate_id: str
) -> GeometryCandidateView:
    project = _authorize(session, identity, project_id)
    artifact, manifest = verified_manifest(session, store, project.id, candidate_id)
    version = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.project_id == project.id,
            StructureVersionRecord.idempotency_key == f"geometry-accept:{artifact.id}",
        )
    )
    return GeometryCandidateView(
        id=artifact.id,
        project_id=project.id,
        candidate_artifact=_artifact_reference(artifact),
        manifest=manifest,
        state="ACCEPTED" if version else "PENDING_ACCEPTANCE",
        accepted_structure_version_id=version.id if version else None,
    )


def list_geometry_candidates(
    session: Session, identity: Identity, store: ObjectStore, project_id: str
) -> GeometryCandidateListOutput:
    project = _authorize(session, identity, project_id)
    ids = session.scalars(
        select(ScientificArtifactRecord.id)
        .join(ProvenanceRecordRow, ProvenanceRecordRow.subject_id == ScientificArtifactRecord.id)
        .where(
            ScientificArtifactRecord.project_id == project.id,
            ScientificArtifactRecord.format_identifier == CANDIDATE_FORMAT,
            ProvenanceRecordRow.project_id == project.id,
            ProvenanceRecordRow.subject_type == "geometry.candidate",
            trusted_generation_producer(),
        )
        .order_by(ScientificArtifactRecord.created_at.desc())
        .limit(256)
    ).all()
    return GeometryCandidateListOutput(
        candidates=tuple(
            get_geometry_candidate(session, identity, store, project.id, candidate_id)
            for candidate_id in ids
        )
    )


def get_source_drawing(
    session: Session, identity: Identity, store: ObjectStore, project_id: str, candidate_id: str
) -> bytes:
    view = get_geometry_candidate(session, identity, store, project_id, candidate_id)
    source = session.get(ScientificArtifactRecord, str(view.manifest.source_drawing.artifact_id))
    return checked_bytes(store, source)


def get_structure_geometry_eligibility(
    session: Session,
    identity: Identity,
    store: ObjectStore,
    project_id: str,
    structure_id: str,
    version_id: str,
):
    project = _authorize(session, identity, project_id)
    version = session.get(StructureVersionRecord, version_id)
    if version is None or version.project_id != project.id or version.structure_id != structure_id:
        raise ScientificReferenceNotFound("StructureVersion does not exist in this project.")
    return calculation_geometry_eligibility(session, store, version)


def accept_geometry_candidate(
    session: Session,
    identity: Identity,
    store: ObjectStore,
    project_id: str,
    candidate_id: str,
    command: GeometryCandidateAcceptInput,
) -> GeometryCandidateAcceptOutput:
    project = _authorize(session, identity, project_id, write=True)
    # Serialize acceptance to make repeated/concurrent confirmation exactly one immutable version.
    session.execute(
        update(type(project)).where(type(project).id == project.id).values(name=type(project).name)
    )
    artifact, manifest = verified_manifest(session, store, project.id, candidate_id)
    if command.candidate_sha256 != artifact.sha256:
        raise GeometryValidationFailed(
            "GEOMETRY_PREVIEW_MISMATCH", "Accept the exact preview hash."
        )
    key = f"geometry-accept:{artifact.id}"
    existing = session.scalar(
        select(StructureVersionRecord).where(
            StructureVersionRecord.project_id == project.id,
            StructureVersionRecord.idempotency_key == key,
        )
    )
    if existing is not None:
        structure = session.get(StructureRecord, existing.structure_id)
        return GeometryCandidateAcceptOutput(
            candidate_id=artifact.id,
            structure=_structure_from_record(structure),
            version=_version_from_record(existing),
            calculation_eligibility=calculation_geometry_eligibility(session, store, existing),
        )
    require_candidate_stereochemistry(session, store, manifest)
    parent = None
    if manifest.parent_structure_version:
        parent = session.get(
            StructureVersionRecord, str(manifest.parent_structure_version.entity_id)
        )
        if parent is None or parent.project_id != project.id:
            raise ScientificReferenceNotFound("Parent StructureVersion is unavailable.")
        structure = session.get(StructureRecord, parent.structure_id)
        if structure.kind != "MOLECULE":
            raise GeometryValidationFailed(
                "GEOMETRY_UNSUPPORTED", "Drawing cannot revise periodic structures."
            )
    else:
        structure = StructureRecord(
            project_id=project.id,
            name=manifest.coordinate_representation.name,
            kind="MOLECULE",
            created_by=identity.user_id,
        )
        session.add(structure)
        session.flush()
    coordinates = manifest.coordinate_representation
    canonical = CanonicalStructureCandidate(
        name=coordinates.name,
        kind=coordinates.kind,
        coordinates=coordinates.coordinates.model_dump(mode="json"),
        overall_charge=coordinates.overall_charge,
        multiplicity=coordinates.multiplicity,
        source_format=StructureSourceFormat.MOL,
        parser_name="rdkit",
        parser_version=str(manifest.generation_parameters["rdkit_version"]),
        adapter_name="chemdft.rdkit.geometry",
        adapter_version="1.0.0",
    )
    source_id = str(manifest.source_drawing.artifact_id)
    canonical_artifact = _persist_canonical_artifact(
        session,
        identity,
        store,
        project_id=project.id,
        document=canonical_document(canonical),
        source_artifact_id=source_id,
    )
    version_id = new_id()
    provenance = _provenance_for_structure_version(
        session,
        identity,
        project_id=project.id,
        version_id=version_id,
        source_artifact_id=source_id,
        operation=ACCEPT_OPERATION,
        operation_version="1.0.0",
        approximate=True,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        parameters=[
            {"key": "geometry_candidate_id", "value": artifact.id},
            {"key": "candidate_sha256", "value": artifact.sha256},
            {"key": "generation_method", "value": manifest.generation_method},
            {"key": "geometry_class", "value": manifest.geometry_class},
            {"key": "source_graph_sha256", "value": manifest.source_graph_sha256},
            {"key": "actor_id", "value": identity.user_id},
            {"key": "coordinate_unit", "value": "angstrom"},
            {
                "key": "candidate_origin",
                "value": _candidate_origin(session, project.id, artifact.id),
            },
        ],
    )
    for position, item in enumerate(
        (
            manifest.source_drawing,
            _artifact_reference(artifact),
            _artifact_reference(canonical_artifact),
        )
    ):
        session.add(
            ProvenanceInputRow(
                project_id=project.id,
                provenance_record_id=provenance.id,
                position=position,
                input_type="ARTIFACT",
                input_id=str(item.artifact_id),
                input_sha256=item.sha256,
            )
        )
    revision = (
        session.scalar(
            select(func.max(StructureVersionRecord.revision)).where(
                StructureVersionRecord.structure_id == structure.id
            )
        )
        or 0
    ) + 1
    version = StructureVersionRecord(
        id=version_id,
        project_id=project.id,
        structure_id=structure.id,
        revision=revision,
        origin="GENERATED",
        parent_version_id=parent.id if parent else None,
        canonical_artifact_id=canonical_artifact.id,
        source_artifact_id=source_id,
        coordinate_system="CARTESIAN",
        coordinate_unit="angstrom",
        atom_count=len(canonical.atoms),
        bond_count=len(canonical.bonds),
        overall_charge=canonical.overall_charge,
        multiplicity=canonical.multiplicity,
        representation_json={
            "source_artifact": manifest.source_drawing.model_dump(mode="json"),
            "canonical_artifact": _artifact_reference(canonical_artifact).model_dump(mode="json"),
            "coordinates": canonical.coordinates,
            "geometry_acceptance": {
                "candidate_id": artifact.id,
                "candidate_sha256": artifact.sha256,
            },
        },
        diagnostics_json=[],
        provenance_record_id=provenance.id,
        idempotency_key=key,
        created_by=identity.user_id,
    )
    session.add(version)
    _audit_structure_event(
        session,
        identity,
        project_id=project.id,
        event_name="structure.geometry.accepted",
        structure_id=structure.id,
        version_id=version.id,
        artifacts=[
            manifest.source_drawing,
            _artifact_reference(artifact),
            _artifact_reference(canonical_artifact),
        ],
    )
    session.flush()
    eligibility = calculation_geometry_eligibility(session, store, version)
    if not eligibility.eligible:
        raise GeometryValidationFailed(eligibility.code, eligibility.detail)
    session.commit()
    return GeometryCandidateAcceptOutput(
        candidate_id=artifact.id,
        structure=_structure_from_record(structure),
        version=_version_from_record(version),
        calculation_eligibility=eligibility,
    )
