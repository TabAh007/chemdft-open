"""Calculation boundary for drawings, generated candidates and immutable coordinates."""

from __future__ import annotations

import hashlib
import json

from rdkit import Chem
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from .contracts.geometry import GeometryCandidateManifest, GeometryEligibility
from .contracts.structure_candidates import CandidateCoordinateRepresentation
from .errors import ScientificReferenceNotFound
from .scientific.adapters.molecular.rdkit_adapter import (
    _mol_from_candidate,
    require_computational_mol,
)
from .scientific.molecular_geometry import (
    GeometryValidationFailed,
    graph_identity,
    parse_drawing,
    require_explicit_stereochemistry,
    validate_geometry,
    verify_generated_stereochemistry,
)
from .scientific.structures import CanonicalStructureCandidate, StructureSourceFormat
from .scientific_models import ProvenanceRecordRow, ScientificArtifactRecord, StructureVersionRecord
from .storage import ObjectStore

MAX_BYTES = 10 * 1024 * 1024
CANDIDATE_FORMAT = "chemdft.geometry-candidate.v1"
GENERATION_OPERATION = "chemdft.geometry.generate"
ACCEPT_OPERATION = "chemdft.geometry.accept"
# Server-written SOFTWARE provenance that may vouch for a stored candidate. The AI molecule creator
# is a distinct, origin-labelled producer (AI_HYPOTHESIS); it is never recorded as user geometry.
AI_GENERATION_OPERATION = "ai.molecule.draft.create"
AI_GENERATION_PRODUCER = "chemdft.ai.molecule_creator"


def trusted_generation_producer():
    """SQL predicate selecting the provenance rows of trusted candidate generators."""
    return or_(
        and_(
            ProvenanceRecordRow.operation == GENERATION_OPERATION,
            ProvenanceRecordRow.producer_identifier == "chemdft.rdkit.geometry",
        ),
        and_(
            ProvenanceRecordRow.operation == AI_GENERATION_OPERATION,
            ProvenanceRecordRow.producer_identifier == AI_GENERATION_PRODUCER,
        ),
    )


def checked_bytes(store: ObjectStore, artifact: ScientificArtifactRecord) -> bytes:
    try:
        data = store.get_bytes(artifact.storage_key, MAX_BYTES)
    except OSError as error:
        raise GeometryValidationFailed(
            "GEOMETRY_SOURCE_UNAVAILABLE", "Geometry source artifact is unavailable."
        ) from error
    if hashlib.sha256(data).hexdigest() != artifact.sha256:
        raise GeometryValidationFailed(
            "GEOMETRY_ARTIFACT_CHANGED", "Immutable artifact hash mismatch."
        )
    return data


def verified_manifest(
    session: Session, store: ObjectStore, project_id: str, candidate_id: str
) -> tuple[ScientificArtifactRecord, GeometryCandidateManifest]:
    artifact = session.get(ScientificArtifactRecord, candidate_id)
    if (
        artifact is None
        or artifact.project_id != project_id
        or artifact.format_identifier != CANDIDATE_FORMAT
    ):
        raise ScientificReferenceNotFound("Geometry candidate does not exist in this project.")
    producer = session.scalar(
        select(ProvenanceRecordRow).where(
            ProvenanceRecordRow.project_id == project_id,
            ProvenanceRecordRow.subject_type == "geometry.candidate",
            ProvenanceRecordRow.subject_id == candidate_id,
            ProvenanceRecordRow.producer_kind == "SOFTWARE",
            trusted_generation_producer(),
        )
    )
    if producer is None:
        raise GeometryValidationFailed(
            "GEOMETRY_UNTRUSTED_CANDIDATE", "Server generation record required."
        )
    try:
        manifest = GeometryCandidateManifest.model_validate_json(checked_bytes(store, artifact))
    except ValueError as error:
        raise GeometryValidationFailed(
            "GEOMETRY_INVALID_CANDIDATE", "Stored candidate manifest is invalid."
        ) from error
    parameters = {item["key"]: item["value"] for item in producer.parameters_json}
    if (
        parameters.get("candidate_sha256") != artifact.sha256
        or parameters.get("source_graph_sha256") != manifest.source_graph_sha256
    ):
        raise GeometryValidationFailed(
            "GEOMETRY_UNTRUSTED_CANDIDATE", "Generation provenance hash binding failed."
        )
    source = session.get(ScientificArtifactRecord, str(manifest.source_drawing.artifact_id))
    if (
        source is None
        or source.project_id != project_id
        or str(manifest.source_drawing.project_id) != project_id
        or (
            source.sha256 != manifest.source_drawing.sha256
            or producer.source_artifact_id != source.id
            or artifact.source_relation_id != source.id
        )
    ):
        raise GeometryValidationFailed(
            "GEOMETRY_SOURCE_MISMATCH", "Drawing lineage does not match."
        )
    checked_bytes(store, source)
    validate_geometry(manifest.coordinate_representation)
    return artifact, manifest


def require_candidate_stereochemistry(
    session: Session, store: ObjectStore, manifest: GeometryCandidateManifest
) -> None:
    """Recheck pending/accepted candidates created before the stereo safety gate."""
    source = session.get(ScientificArtifactRecord, str(manifest.source_drawing.artifact_id))
    drawing = parse_drawing(checked_bytes(store, source).decode("utf-8"))
    require_explicit_stereochemistry(drawing)
    identity = graph_identity(drawing)
    if (
        identity != manifest.canonical_smiles
        or hashlib.sha256(identity.encode()).hexdigest() != manifest.source_graph_sha256
    ):
        raise GeometryValidationFailed(
            "GEOMETRY_STEREOCHEMISTRY_MISMATCH", "Source stereochemical identity changed."
        )
    representation = manifest.coordinate_representation
    canonical = CanonicalStructureCandidate(
        name=representation.name,
        kind=representation.kind,
        coordinates=representation.coordinates.model_dump(mode="json"),
        overall_charge=representation.overall_charge,
        multiplicity=representation.multiplicity,
        source_format=StructureSourceFormat.MOL,
        parser_name="rdkit",
        parser_version=str(manifest.generation_parameters["rdkit_version"]),
        adapter_name="chemdft.rdkit.geometry",
        adapter_version="1.0.0",
    )
    measured = _mol_from_candidate(canonical)
    Chem.SanitizeMol(measured)
    verify_generated_stereochemistry(measured, identity)


def _require_calculation_geometry(
    session: Session, store: ObjectStore, version: StructureVersionRecord
) -> None:
    if version.periodic_cell_json is not None:
        return  # Existing engine-specific periodic capability gates remain responsible.
    acceptance = version.representation_json.get("geometry_acceptance")
    if acceptance:
        artifact, manifest = verified_manifest(
            session, store, version.project_id, acceptance["candidate_id"]
        )
        provenance = session.get(ProvenanceRecordRow, version.provenance_record_id)
        if (
            version.origin != "GENERATED"
            or provenance is None
            or provenance.subject_id != version.id
            or provenance.subject_type != "structure.version"
            or provenance.operation != ACCEPT_OPERATION
            or provenance.producer_kind != "USER"
            or provenance.source_artifact_id != str(manifest.source_drawing.artifact_id)
            or acceptance["candidate_sha256"] != artifact.sha256
            or version.representation_json["coordinates"]
            != manifest.coordinate_representation.coordinates.model_dump(mode="json")
            or version.overall_charge != manifest.coordinate_representation.overall_charge
            or version.multiplicity != manifest.coordinate_representation.multiplicity
        ):
            raise GeometryValidationFailed(
                "GEOMETRY_ACCEPTANCE_MISMATCH", "Accepted geometry binding failed."
            )
        require_candidate_stereochemistry(session, store, manifest)
        return
    # Historical MOL/SDF saves must be checked against original conformer metadata. A z=0
    # test would incorrectly reject planar chemistry and cannot identify the input workflow.
    artifact = session.get(ScientificArtifactRecord, version.source_artifact_id)
    if artifact is None:
        raise GeometryValidationFailed("GEOMETRY_SOURCE_UNAVAILABLE", "Geometry source is missing.")
    seen: set[str] = set()
    while artifact is not None and artifact.id not in seen:
        seen.add(artifact.id)
        if artifact.project_id != version.project_id:
            raise GeometryValidationFailed(
                "GEOMETRY_SOURCE_MISMATCH", "Geometry source crosses projects."
            )
        if artifact.format_identifier.upper() in {"MOL", "SDF"}:
            data = checked_bytes(store, artifact)
            if artifact.format_identifier.upper() == "SDF":
                supplier = Chem.SDMolSupplier()
                supplier.SetData(data.decode("utf-8"), sanitize=False, removeHs=False)
                molecules = [m for m in supplier if m is not None]
            else:
                molecules = [
                    Chem.MolFromMolBlock(data.decode("utf-8"), sanitize=False, removeHs=False)
                ]
            # Multiple-record SDFs are matched to their canonical atom list, not guessed.
            canonical = version.representation_json["coordinates"]["atoms"]
            matches = [
                m
                for m in molecules
                if m is not None
                and m.GetNumAtoms() == len(canonical)
                and all(
                    a.GetAtomicNum() == b["atomic_number"]
                    for a, b in zip(m.GetAtoms(), canonical, strict=True)
                )
                and m.GetNumConformers()
                and all(
                    abs(getattr(m.GetConformer().GetAtomPosition(i), axis) - atom[axis]) < 1e-4
                    for i, atom in enumerate(canonical)
                    for axis in ("x", "y", "z")
                )
            ]
            # Manual coordinate revisions need not match source positions; source dimensionality
            # is still mandatory. A single-record source unambiguously identifies that workflow.
            if not matches and len(molecules) == 1:
                matches = molecules
            if not matches or matches[0] is None:
                raise GeometryValidationFailed(
                    "GEOMETRY_SOURCE_MISMATCH", "Cannot resolve source conformer."
                )
            require_computational_mol(matches[0])
            break
        if artifact.source_relation_type != "scientific.artifact":
            break
        artifact = session.get(ScientificArtifactRecord, artifact.source_relation_id)
    coordinates = json.loads(json.dumps(version.representation_json["coordinates"]))
    coordinates.pop("structure_version_id", None)
    coordinates.pop("source", None)
    if coordinates["unit"] == "bohr":
        for atom in coordinates["atoms"]:
            for axis in ("x", "y", "z"):
                atom[axis] /= 1.8897261254578281
        coordinates["unit"] = "angstrom"
    representation = CandidateCoordinateRepresentation.model_validate(
        {
            "name": "Calculation input",
            "kind": "MOLECULE",
            "coordinates": coordinates,
            "overall_charge": version.overall_charge,
            "multiplicity": version.multiplicity,
        }
    )
    validate_geometry(representation)


def require_calculation_geometry(
    session: Session, store: ObjectStore, version: StructureVersionRecord
) -> None:
    try:
        _require_calculation_geometry(session, store, version)
    except GeometryValidationFailed:
        raise
    except (ValueError, TypeError, KeyError, RuntimeError) as error:
        raise GeometryValidationFailed(
            "GEOMETRY_INVALID_COORDINATES", "Stored geometry or source metadata is invalid."
        ) from error


def calculation_geometry_eligibility(
    session: Session, store: ObjectStore, version: StructureVersionRecord
) -> GeometryEligibility:
    try:
        require_calculation_geometry(session, store, version)
    except GeometryValidationFailed as error:
        return GeometryEligibility(
            structure_version_id=version.id, eligible=False, code=error.code, detail=error.detail
        )
    return GeometryEligibility(
        structure_version_id=version.id,
        eligible=True,
        code="GEOMETRY_ACCEPTED_3D",
        detail="Computational coordinates accepted; engine capability gates still apply.",
    )
