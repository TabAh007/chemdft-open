from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from rdkit import Chem
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .context import Identity
from .contracts.scientific import CoordinateSystem, CoordinateUnit, PeriodicCell, StructureKind
from .contracts.structure_candidates import (
    CandidateCoordinateInputFormat,
    CandidateCoordinateOrigin,
    CandidateCoordinatePasteInput,
    CandidateCoordinateRepresentation,
    CandidateRepresentationCreateInput,
    CandidateRepresentationCreateOutput,
    CandidateRepresentationDetail,
    CandidateRepresentationListOutput,
    CandidateRepresentationOrigin,
    CandidateRepresentationReviewChecklist,
    CandidateRepresentationReviewOutput,
    CandidateRepresentationReviewState,
    CandidateRepresentationType,
    CandidateRepresentationValidationState,
    ConformerGenerationInput,
    MolecularGraphDifference,
    MolecularGraphValidateInput,
    MolecularGraphValidateOutput,
)
from .errors import CandidateStateConflict, ScientificValidationFailed
from .scientific.molecular_geometry import generate_conformer, generation_parameters, parse_drawing
from .scientific.molecular_recognition.validation import (
    GraphValidationResult,
    compute_graph_differences,
    validate_chemical_graph,
)
from .scientific.structures import atomic_number_for_symbol, canonical_document
from .scientific_models import (
    CandidateRepresentationRecord,
    CandidateRepresentationReviewRecord,
    EvidenceCandidateRecord,
    StructureCandidateRecord,
)
from .structure_candidate_actions import (
    _authorized_candidate,
    _representation_summary,
)

_PREVIEW_METHOD = "rdkit.etkdg3.preview-conformer"


def _content_hash(value: dict[str, Any] | None) -> str:
    content = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode(
        "utf-8"
    )
    return hashlib.sha256(content).hexdigest()


def _detail(
    session: Session, record: CandidateRepresentationRecord
) -> CandidateRepresentationDetail:
    summary = _representation_summary(session, record)
    payload = record.payload_json or {}
    smiles = payload.get("smiles")
    mol_block = payload.get("mol_block")
    coordinates = payload.get("coordinate_representation")
    recognition_proposal = None
    if (
        record.representation_type == CandidateRepresentationType.SMILES.value
        and record.representation_origin == CandidateRepresentationOrigin.IMAGE_RECONSTRUCTION.value
    ):
        # Recognition output stores the whole proposal; only the RDKit-sanitised SMILES is exposed
        # as `smiles` (never the raw, possibly unparseable, model string).
        recognition_proposal = dict(payload)
        smiles = payload.get("canonical_isomeric_smiles")
    diffs = None
    if payload.get("differences_from_parent"):
        diffs = tuple(
            MolecularGraphDifference.model_validate(d)
            for d in payload["differences_from_parent"]
        )
    return CandidateRepresentationDetail(
        **summary.model_dump(),
        candidate_id=record.candidate_id,
        smiles=smiles,
        mol_block=mol_block,
        recognition_proposal=recognition_proposal,
        differences_from_parent=diffs,
        coordinate_representation=(
            CandidateCoordinateRepresentation.model_validate(coordinates)
            if coordinates is not None
            else None
        ),
    )


def _next_revision(session: Session, candidate_id: str, project_id: str) -> int:
    current = session.scalar(
        select(func.max(CandidateRepresentationRecord.revision)).where(
            CandidateRepresentationRecord.candidate_id == candidate_id,
            CandidateRepresentationRecord.project_id == project_id,
        )
    )
    return (current or 0) + 1


def _existing_by_hash(
    session: Session,
    *,
    candidate_id: str,
    project_id: str,
    representation_type: CandidateRepresentationType,
    content_sha256: str,
    source_representation_id: str | None = None,
) -> CandidateRepresentationRecord | None:
    return session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.candidate_id == candidate_id,
            CandidateRepresentationRecord.project_id == project_id,
            CandidateRepresentationRecord.representation_type == representation_type.value,
            CandidateRepresentationRecord.content_sha256 == content_sha256,
            CandidateRepresentationRecord.source_representation_id == source_representation_id,
        )
    )


def _add_record(
    session: Session,
    identity: Identity,
    candidate: StructureCandidateRecord,
    *,
    representation_type: CandidateRepresentationType,
    representation_origin: CandidateRepresentationOrigin,
    content: dict[str, Any] | None,
    method: str,
    method_version: str,
    approximation: str,
    validation_state: CandidateRepresentationValidationState,
    diagnostics: tuple[str, ...] = (),
    generation_parameters: dict[str, Any] | None = None,
    source_representation_id: str | None = None,
    coordinate_unit: str | None = None,
    coordinate_provenance: dict[str, Any] | None = None,
    cell_provenance: dict[str, Any] | None = None,
) -> tuple[CandidateRepresentationRecord, bool]:
    content_sha256 = _content_hash(content) if content is not None else None
    if content_sha256:
        existing = _existing_by_hash(
            session,
            candidate_id=candidate.id,
            project_id=candidate.project_id,
            representation_type=representation_type,
            content_sha256=content_sha256,
            source_representation_id=source_representation_id,
        )
        if existing is not None:
            return existing, False
    record = CandidateRepresentationRecord(
        project_id=candidate.project_id,
        candidate_id=candidate.id,
        representation_type=representation_type.value,
        revision=_next_revision(session, candidate.id, candidate.project_id),
        content_sha256=content_sha256,
        representation_origin=representation_origin.value,
        provenance_class=candidate.provenance_class,
        method=method,
        method_version=method_version,
        approximation=approximation,
        payload_json=content,
        validation_state=validation_state.value,
        validation_diagnostics_json=list(diagnostics),
        generation_parameters_json=generation_parameters or {},
        coordinate_unit=coordinate_unit,
        coordinate_provenance_json=coordinate_provenance,
        cell_provenance_json=cell_provenance,
        source_representation_id=source_representation_id,
        created_by=identity.user_id,
    )
    session.add(record)
    session.flush()
    return record, True


def _find_generated_representation(
    session: Session, source: CandidateRepresentationRecord
) -> CandidateRepresentationRecord | None:
    return session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.candidate_id == source.candidate_id,
            CandidateRepresentationRecord.project_id == source.project_id,
            CandidateRepresentationRecord.source_representation_id == source.id,
            CandidateRepresentationRecord.representation_type
            == CandidateRepresentationType.CARTESIAN_COORDINATES.value,
        )
    )


def _generation_parameters() -> dict[str, str | int | bool]:
    return generation_parameters()


def _attempt_preview(
    graph_eval: GraphValidationResult, name: str
) -> tuple[CandidateCoordinateRepresentation | None, str | None]:
    """Best-effort automatic 2D-to-3D preview; a failure is a diagnostic, never an exception."""
    if not graph_eval.can_generate_3d or graph_eval.mol is None:
        return None, None
    try:
        return _coordinate_candidate(graph_eval.mol, name), None
    except ScientificValidationFailed as error:
        return None, str(error)


def _coordinate_candidate(molecule: Chem.Mol, name: str) -> CandidateCoordinateRepresentation:
    return generate_conformer(molecule, name).coordinates


def _validate_coordinate_payload(
    candidate: StructureCandidateRecord,
    identity: Identity,
    representation: CandidateCoordinateRepresentation,
) -> None:
    from .structure_candidate_actions import _validated_canonical_candidate

    provisional = CandidateRepresentationRecord(
        project_id=candidate.project_id,
        candidate_id=candidate.id,
        representation_type=(
            CandidateRepresentationType.CRYSTAL_COORDINATES.value
            if representation.kind is StructureKind.PERIODIC
            else CandidateRepresentationType.CARTESIAN_COORDINATES.value
        ),
        revision=1,
        representation_origin=CandidateRepresentationOrigin.USER_DRAFT.value,
        provenance_class=candidate.provenance_class,
        method="candidate-coordinate-validator",
        method_version="1.0.0",
        approximation="USER_DRAFT",
        payload_json=representation.model_dump(mode="json"),
        validation_state=CandidateRepresentationValidationState.PREVIEWABLE.value,
        validation_diagnostics_json=[],
        generation_parameters_json={},
        created_by=identity.user_id,
    )
    canonical = _validated_canonical_candidate(representation, provisional)
    canonical_document(canonical)


def _coordinate_record(
    session: Session,
    identity: Identity,
    candidate: StructureCandidateRecord,
    representation: CandidateCoordinateRepresentation,
    *,
    source_representation_id: str | None,
    parameters: dict[str, Any],
    method: str,
    approximation: str,
    origin: CandidateRepresentationOrigin,
    diagnostics: tuple[str, ...] = (),
    coordinate_provenance: dict[str, Any] | None = None,
    cell_provenance: dict[str, Any] | None = None,
) -> tuple[CandidateRepresentationRecord, bool]:
    representation_type = (
        CandidateRepresentationType.CRYSTAL_COORDINATES
        if representation.kind is StructureKind.PERIODIC
        else CandidateRepresentationType.CARTESIAN_COORDINATES
    )
    _validate_coordinate_payload(candidate, identity, representation)
    payload = {"coordinate_representation": representation.model_dump(mode="json")}
    return _add_record(
        session,
        identity,
        candidate,
        representation_type=representation_type,
        representation_origin=origin,
        content=payload,
        method=method,
        method_version=Chem.rdBase.rdkitVersion if method.startswith("rdkit.") else "1.0.0",
        approximation=approximation,
        validation_state=CandidateRepresentationValidationState.PREVIEWABLE,
        diagnostics=diagnostics,
        generation_parameters=parameters,
        source_representation_id=source_representation_id,
        coordinate_unit=representation.coordinates.unit.value,
        coordinate_provenance=coordinate_provenance,
        cell_provenance=cell_provenance,
    )


def _parent_representation(
    session: Session,
    candidate: StructureCandidateRecord,
    project_id: str,
    parent_representation_id: str | None,
) -> CandidateRepresentationRecord | None:
    if parent_representation_id is None:
        return session.scalar(
            select(CandidateRepresentationRecord)
            .where(
                CandidateRepresentationRecord.project_id == project_id,
                CandidateRepresentationRecord.candidate_id == candidate.id,
            )
            .order_by(CandidateRepresentationRecord.revision.desc())
            .limit(1)
        )
    parent = session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.id == parent_representation_id,
            CandidateRepresentationRecord.project_id == project_id,
            CandidateRepresentationRecord.candidate_id == candidate.id,
        )
    )
    if parent is None:
        raise CandidateStateConflict("PARENT_REPRESENTATION_NOT_FOUND_IN_CANDIDATE")
    return parent


_GRAPH_TYPES = (
    CandidateRepresentationType.SMILES.value,
    CandidateRepresentationType.MOL.value,
    CandidateRepresentationType.MOL_BLOCK.value,
)


def _lineage_parent(
    session: Session,
    candidate: StructureCandidateRecord,
    parent_representation_id: str | None,
) -> CandidateRepresentationRecord | None:
    """Parent of a researcher-supplied molecular graph.

    An explicit parent must belong to the same candidate and project. When none is given and the
    candidate carries a recognized-diagram proposal, the latest proposal becomes the parent so a
    correction can never silently lose its link to the original recognition evidence.
    """
    if parent_representation_id is not None:
        return _parent_representation(
            session, candidate, str(candidate.project_id), parent_representation_id
        )
    return session.scalar(
        select(CandidateRepresentationRecord)
        .where(
            CandidateRepresentationRecord.project_id == candidate.project_id,
            CandidateRepresentationRecord.candidate_id == candidate.id,
            CandidateRepresentationRecord.representation_origin
            == CandidateRepresentationOrigin.IMAGE_RECONSTRUCTION.value,
            CandidateRepresentationRecord.representation_type
            == CandidateRepresentationType.SMILES.value,
        )
        .order_by(CandidateRepresentationRecord.revision.desc())
        .limit(1)
    )


def _differences_from_parent(
    parent: CandidateRepresentationRecord | None, content: str, content_format: str
) -> tuple[MolecularGraphDifference, ...]:
    if parent is None:
        return ()
    parent_payload = parent.payload_json or {}
    parent_smiles = parent_payload.get("smiles") or parent_payload.get("canonical_isomeric_smiles")
    parent_text = parent_smiles or parent_payload.get("mol_block")
    if not parent_text:
        return ()
    return compute_graph_differences(
        original_content=parent_text,
        corrected_content=content,
        original_format="SMILES" if parent_smiles else "MOL",
        corrected_format=content_format,
    )


def _cell_provenance(
    session: Session,
    candidate: StructureCandidateRecord,
    project_id: str,
    *,
    source: str,
    source_evidence_id: str | None,
    original_file_sha256: str | None,
) -> dict[str, Any]:
    provenance: dict[str, Any] = {
        "source": source,
        "source_document_id": candidate.source_document_id,
    }
    if source == "PAPER_EVIDENCE":
        evidence = session.scalar(
            select(EvidenceCandidateRecord).where(
                EvidenceCandidateRecord.id == source_evidence_id,
                EvidenceCandidateRecord.project_id == project_id,
                EvidenceCandidateRecord.document_id == candidate.source_document_id,
                EvidenceCandidateRecord.evidence_type == "REPORTED_CELL_PARAMETER",
            )
        )
        if evidence is None:
            raise CandidateStateConflict("CELL_SOURCE_EVIDENCE_NOT_FOUND_IN_CANDIDATE_DOCUMENT")
        provenance["source_evidence_id"] = evidence.id
    if original_file_sha256:
        provenance["original_file_sha256"] = original_file_sha256
    return provenance


def _coordinate_provenance(
    identity: Identity,
    candidate: StructureCandidateRecord,
    *,
    origin: CandidateCoordinateOrigin,
    input_format: CandidateCoordinateInputFormat,
    unit: CoordinateUnit,
    parent: CandidateRepresentationRecord | None,
    original_file_sha256: str | None = None,
) -> dict[str, Any]:
    if origin is CandidateCoordinateOrigin.USER_IMPORTED_FILE and not original_file_sha256:
        raise ScientificValidationFailed("Imported coordinates require the original file hash.")
    return {
        "origin": origin.value,
        "input_format": input_format.value,
        "coordinate_unit": unit.value,
        "original_file_sha256": original_file_sha256,
        "user_action": origin.value,
        "user_id": identity.user_id,
        "source_document_id": candidate.source_document_id,
        "source_evidence_id": candidate.source_evidence_id,
        "parent_representation_id": parent.id if parent else None,
    }


def _parse_pasted_coordinates(text: str) -> tuple[dict[str, Any], ...]:
    atoms: list[dict[str, Any]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        fields = stripped.split()
        if len(fields) != 4:
            raise ScientificValidationFailed(
                f"Coordinate line {line_number} must contain an element and three values."
            )
        element = fields[0]
        try:
            atomic_number = atomic_number_for_symbol(element)
        except Exception as error:
            raise ScientificValidationFailed(
                f"Coordinate line {line_number} has an unsupported element symbol."
            ) from error
        try:
            x, y, z = (float(value) for value in fields[1:])
        except ValueError as error:
            raise ScientificValidationFailed(
                f"Coordinate line {line_number} contains a non-numeric value."
            ) from error
        if any(not math.isfinite(value) for value in (x, y, z)):
            raise ScientificValidationFailed(
                f"Coordinate line {line_number} must contain finite values."
            )
        atoms.append(
            {
                "index": len(atoms),
                "atomic_number": atomic_number,
                "element": element,
                "x": x,
                "y": y,
                "z": z,
                "isotope": None,
                "formal_charge": None,
                "label": None,
                "occupancy": None,
            }
        )
        if len(atoms) > 2_000:
            raise ScientificValidationFailed("Candidate coordinate input exceeds 2,000 atoms.")
    if not atoms:
        raise ScientificValidationFailed("Enter at least one coordinate row.")
    return tuple(atoms)


def paste_candidate_coordinates(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    payload: CandidateCoordinatePasteInput,
) -> tuple[CandidateRepresentationCreateOutput, bool]:
    candidate, scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id, write=True
    )
    if candidate.candidate_state in {"REJECTED", "PROMOTED"}:
        raise CandidateStateConflict("CANDIDATE_DOES_NOT_ACCEPT_NEW_REPRESENTATIONS")
    parent = _parent_representation(
        session,
        candidate,
        scoped_project_id,
        str(payload.parent_representation_id) if payload.parent_representation_id else None,
    )
    try:
        cell = payload.cell.to_periodic_cell() if payload.cell else None
    except ValueError as error:
        raise ScientificValidationFailed(str(error)) from error
    coordinate_system = payload.coordinate_system
    input_format = (
        CandidateCoordinateInputFormat.PASTED_FRACTIONAL
        if coordinate_system is CoordinateSystem.FRACTIONAL
        else CandidateCoordinateInputFormat.PASTED_CARTESIAN
    )
    coordinate = CandidateCoordinateRepresentation.model_validate(
        {
            "kind": StructureKind.PERIODIC.value if cell else StructureKind.MOLECULE.value,
            "name": payload.name,
            "coordinates": {
                "coordinate_system": coordinate_system.value,
                "unit": payload.unit.value,
                "dimensionality": 3,
                "atom_ordering": "AS_LISTED",
                "atoms": _parse_pasted_coordinates(payload.coordinate_text),
                "bonds": [],
            },
            "periodic_cell": cell.model_dump(mode="json") if cell else None,
        }
    )
    coordinate_provenance = _coordinate_provenance(
        identity,
        candidate,
        origin=CandidateCoordinateOrigin.USER_PASTED,
        input_format=input_format,
        unit=payload.unit,
        parent=parent,
    )
    cell_provenance = None
    if cell is not None:
        cell_provenance = _cell_provenance(
            session,
            candidate,
            scoped_project_id,
            source=payload.cell_source or "USER_ENTERED",
            source_evidence_id=(
                str(payload.cell_source_evidence_id) if payload.cell_source_evidence_id else None
            ),
            original_file_sha256=None,
        )
        cell_provenance["unit"] = cell.unit.value
        cell_provenance["parameters"] = cell.model_dump(mode="json")
    record, created = _coordinate_record(
        session,
        identity,
        candidate,
        coordinate,
        source_representation_id=parent.id if parent else None,
        parameters={},
        method="user.pasted-coordinate-entry",
        approximation="USER_RECONSTRUCTION_UNVERIFIED",
        origin=CandidateRepresentationOrigin.USER_DRAFT,
        diagnostics=("No bond connectivity was supplied; no bond orders were inferred.",),
        coordinate_provenance=coordinate_provenance,
        cell_provenance=cell_provenance,
    )
    session.commit()
    session.refresh(record)
    return CandidateRepresentationCreateOutput(representation=_detail(session, record)), created


def import_candidate_coordinates(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    *,
    data: bytes,
    file_format: str,
    coordinate_unit: CoordinateUnit,
    name: str | None,
    parent_representation_id: str | None,
    coordinate_origin: CandidateCoordinateOrigin,
) -> tuple[CandidateRepresentationCreateOutput, bool]:
    candidate, scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id, write=True
    )
    if candidate.candidate_state in {"REJECTED", "PROMOTED"}:
        raise CandidateStateConflict("CANDIDATE_DOES_NOT_ACCEPT_NEW_REPRESENTATIONS")
    if coordinate_origin not in {
        CandidateCoordinateOrigin.USER_IMPORTED_FILE,
        CandidateCoordinateOrigin.USER_CREATED,
        CandidateCoordinateOrigin.USER_EDITED,
    }:
        raise ScientificValidationFailed("This upload method requires an explicit user action.")
    parent = _parent_representation(session, candidate, scoped_project_id, parent_representation_id)
    normalized_format = file_format.strip().upper()
    try:
        from .scientific_actions import _parse_candidate

        parsed = _parse_candidate(data, normalized_format)
        actual_file_hash = hashlib.sha256(data).hexdigest()
        cell = parsed.periodic_cell
        if (
            parsed.kind is StructureKind.PERIODIC
            and cell is not None
            and cell["unit"] != coordinate_unit
        ):
            raise ScientificValidationFailed("CIF coordinate and cell units must match.")
        cell_model = PeriodicCell.model_validate(cell) if cell is not None else None
        atom_fields = (
            "index",
            "atomic_number",
            "element",
            "x",
            "y",
            "z",
            "isotope",
            "formal_charge",
            "label",
            "occupancy",
        )
        atoms = [
            {key: atom.get(key) for key in atom_fields} for atom in parsed.coordinates["atoms"]
        ]
        coordinates = {
            "coordinate_system": parsed.coordinates["coordinate_system"],
            "unit": coordinate_unit.value,
            "dimensionality": 3,
            "atom_ordering": "AS_LISTED",
            "atoms": atoms,
            "bonds": parsed.coordinates.get("bonds", []),
        }
        coordinate = CandidateCoordinateRepresentation.model_validate(
            {
                "kind": parsed.kind.value,
                "name": name or parsed.name,
                "coordinates": coordinates,
                "periodic_cell": cell_model.model_dump(mode="json") if cell_model else None,
                "overall_charge": parsed.overall_charge,
                "multiplicity": parsed.multiplicity,
            }
        )
    except ScientificValidationFailed:
        raise
    except Exception as error:
        raise ScientificValidationFailed("Coordinate file could not be validated.") from error
    format_enum = CandidateCoordinateInputFormat(normalized_format)
    coordinate_provenance = _coordinate_provenance(
        identity,
        candidate,
        origin=coordinate_origin,
        input_format=format_enum,
        unit=coordinate_unit,
        parent=parent,
        original_file_sha256=actual_file_hash,
    )
    cell_provenance = None
    if cell_model is not None:
        cell_provenance = _cell_provenance(
            session,
            candidate,
            scoped_project_id,
            source="USER_IMPORTED_FILE",
            source_evidence_id=None,
            original_file_sha256=actual_file_hash,
        )
        cell_provenance["unit"] = cell_model.unit.value
        cell_provenance["parameters"] = cell_model.model_dump(mode="json")
    diagnostics = tuple(item.message for item in parsed.diagnostics)
    if normalized_format == "XYZ":
        diagnostics += ("XYZ has no bond connectivity; no bond orders were inferred.",)
    record, created = _coordinate_record(
        session,
        identity,
        candidate,
        coordinate,
        source_representation_id=parent.id if parent else None,
        parameters={"input_format": normalized_format, "original_file_sha256": actual_file_hash},
        method=(
            "user.manual-structure-editor"
            if coordinate_origin is CandidateCoordinateOrigin.USER_CREATED
            else "user.coordinate-file-import"
        ),
        approximation="USER_RECONSTRUCTION_UNVERIFIED",
        origin=CandidateRepresentationOrigin.USER_DRAFT,
        diagnostics=diagnostics,
        coordinate_provenance=coordinate_provenance,
        cell_provenance=cell_provenance,
    )
    session.commit()
    session.refresh(record)
    return CandidateRepresentationCreateOutput(representation=_detail(session, record)), created


def _mol_to_coordinate_candidate(
    mol_block: str, name: str
) -> tuple[Chem.Mol, CandidateCoordinateRepresentation]:
    molecule = parse_drawing(mol_block)
    return molecule, _coordinate_candidate(molecule, name)


def list_candidate_representations(
    session: Session, identity: Identity, project_id: str, candidate_id: str
) -> CandidateRepresentationListOutput:
    candidate, scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id
    )
    rows = session.scalars(
        select(CandidateRepresentationRecord)
        .where(
            CandidateRepresentationRecord.project_id == scoped_project_id,
            CandidateRepresentationRecord.candidate_id == candidate.id,
        )
        .order_by(CandidateRepresentationRecord.revision.asc())
    ).all()
    return CandidateRepresentationListOutput(
        candidate_id=candidate.id,
        representations=tuple(_representation_summary(session, row) for row in rows),
    )


def get_candidate_representation(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    representation_id: str,
) -> CandidateRepresentationDetail:
    candidate, scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id
    )
    row = session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.project_id == scoped_project_id,
            CandidateRepresentationRecord.candidate_id == candidate.id,
            CandidateRepresentationRecord.id == representation_id,
        )
    )
    if row is None:
        raise CandidateStateConflict("CANDIDATE_REPRESENTATION_NOT_FOUND")
    return _detail(session, row)


def _coordinate_detail(
    session: Session, record: CandidateRepresentationRecord
) -> CandidateRepresentationDetail:
    return _detail(session, record)


def create_candidate_representation(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    payload: CandidateRepresentationCreateInput,
) -> tuple[CandidateRepresentationCreateOutput, bool]:
    try:
        return _create_candidate_representation(
            session, identity, project_id, candidate_id, payload
        )
    except IntegrityError as error:
        # A concurrent writer took the same revision number; nothing from this request persisted.
        session.rollback()
        raise CandidateStateConflict("CANDIDATE_REPRESENTATION_REVISION_CONFLICT") from error


def _create_candidate_representation(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    payload: CandidateRepresentationCreateInput,
) -> tuple[CandidateRepresentationCreateOutput, bool]:
    candidate, _scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id, write=True
    )
    if candidate.candidate_state in {
        "REJECTED",
        "PROMOTED",
    }:
        raise CandidateStateConflict("CANDIDATE_DOES_NOT_ACCEPT_NEW_REPRESENTATIONS")

    source_record: CandidateRepresentationRecord | None = None
    generated_record: CandidateRepresentationRecord | None = None
    created = False
    if payload.representation_type == CandidateRepresentationType.SMILES.value:
        assert payload.smiles is not None
        parent = _lineage_parent(
            session,
            candidate,
            str(payload.parent_representation_id) if payload.parent_representation_id else None,
        )
        graph_eval = validate_chemical_graph(payload.smiles, "SMILES")
        if not graph_eval.is_parseable or graph_eval.mol is None:
            content = {"smiles": payload.smiles}
            source_record, created = _add_record(
                session,
                identity,
                candidate,
                representation_type=CandidateRepresentationType.SMILES,
                representation_origin=CandidateRepresentationOrigin.USER_DRAFT,
                content=content,
                method="user.smiles-entry",
                method_version="1.0.0",
                approximation="USER_DRAFT",
                validation_state=CandidateRepresentationValidationState.INVALID,
                diagnostics=graph_eval.diagnostics
                or ("RDKit could not parse or sanitize this SMILES string.",),
                source_representation_id=parent.id if parent else None,
            )
        else:
            diffs = _differences_from_parent(parent, payload.smiles, "SMILES")
            canonical_smiles = graph_eval.canonical_isomeric_smiles or Chem.MolToSmiles(
                graph_eval.mol, canonical=True, isomericSmiles=True
            )
            content = {
                "smiles": canonical_smiles,
                "differences_from_parent": (
                    [d.model_dump(mode="json") for d in diffs] if diffs else None
                ),
            }
            # Records are append-only: the preview outcome is known before the record is written.
            coordinate_candidate, preview_error = _attempt_preview(graph_eval, canonical_smiles)
            source_record, created = _add_record(
                session,
                identity,
                candidate,
                representation_type=CandidateRepresentationType.SMILES,
                representation_origin=CandidateRepresentationOrigin.USER_DRAFT,
                content=content,
                method="user.smiles-entry",
                method_version=Chem.rdBase.rdkitVersion,
                approximation="USER_DRAFT",
                validation_state=CandidateRepresentationValidationState.PARSEABLE,
                diagnostics=(*graph_eval.diagnostics, *((preview_error,) if preview_error else ())),
                source_representation_id=parent.id if parent else None,
            )
            generated_record = _find_generated_representation(session, source_record)
            if generated_record is None and coordinate_candidate is not None:
                generated_record, generated_created = _coordinate_record(
                    session,
                    identity,
                    candidate,
                    coordinate_candidate,
                    source_representation_id=source_record.id,
                    parameters=_generation_parameters(),
                    method=_PREVIEW_METHOD,
                    approximation="APPROXIMATE_PREVIEW",
                    origin=CandidateRepresentationOrigin.DERIVED_PREVIEW,
                )
                created = created or generated_created
    elif payload.representation_type in {
        CandidateRepresentationType.MOL.value,
        CandidateRepresentationType.MOL_BLOCK.value,
    }:
        assert payload.mol_block is not None
        parent = _lineage_parent(
            session,
            candidate,
            str(payload.parent_representation_id) if payload.parent_representation_id else None,
        )
        name = "Ketcher candidate draft"
        graph_eval = validate_chemical_graph(payload.mol_block, "MOL")
        if not graph_eval.is_parseable or graph_eval.mol is None:
            source_record, created = _add_record(
                session,
                identity,
                candidate,
                representation_type=CandidateRepresentationType.MOL,
                representation_origin=CandidateRepresentationOrigin.USER_DRAFT,
                content={"mol_block": payload.mol_block},
                method="user.ketcher-mol-output",
                method_version="1.0.0",
                approximation="USER_DRAFT",
                validation_state=CandidateRepresentationValidationState.INVALID,
                diagnostics=graph_eval.diagnostics or ("MOL input is not parseable.",),
                source_representation_id=parent.id if parent else None,
            )
        else:
            diffs = _differences_from_parent(parent, payload.mol_block, "MOL")
            content = {
                "mol_block": payload.mol_block,
                "differences_from_parent": (
                    [d.model_dump(mode="json") for d in diffs] if diffs else None
                ),
            }
            coordinate_candidate, preview_error = _attempt_preview(graph_eval, name)
            source_record, created = _add_record(
                session,
                identity,
                candidate,
                representation_type=CandidateRepresentationType.MOL,
                representation_origin=CandidateRepresentationOrigin.USER_DRAFT,
                content=content,
                method="user.ketcher-mol-output",
                method_version="1.0.0",
                approximation="USER_DRAFT",
                validation_state=CandidateRepresentationValidationState.PARSEABLE,
                diagnostics=(*graph_eval.diagnostics, *((preview_error,) if preview_error else ())),
                source_representation_id=parent.id if parent else None,
            )
            generated_record = _find_generated_representation(session, source_record)
            if generated_record is None and coordinate_candidate is not None:
                generated_record, generated_created = _coordinate_record(
                    session,
                    identity,
                    candidate,
                    coordinate_candidate,
                    source_representation_id=source_record.id,
                    parameters=_generation_parameters(),
                    method=_PREVIEW_METHOD,
                    approximation="APPROXIMATE_PREVIEW",
                    origin=CandidateRepresentationOrigin.DERIVED_PREVIEW,
                )
                created = created or generated_created
    else:
        assert payload.coordinate_representation is not None
        if payload.coordinate_origin is CandidateCoordinateOrigin.USER_IMPORTED_FILE:
            raise ScientificValidationFailed(
                "Imported-file provenance is accepted only through the file import endpoint."
            )
        parent = _parent_representation(
            session,
            candidate,
            str(candidate.project_id),
            str(payload.parent_representation_id) if payload.parent_representation_id else None,
        )
        coordinate_provenance = (
            _coordinate_provenance(
                identity,
                candidate,
                origin=payload.coordinate_origin,
                input_format=(
                    CandidateCoordinateInputFormat.PASTED_FRACTIONAL
                    if payload.coordinate_representation.coordinates.coordinate_system
                    is CoordinateSystem.FRACTIONAL
                    else CandidateCoordinateInputFormat.PASTED_CARTESIAN
                ),
                unit=payload.coordinate_representation.coordinates.unit,
                parent=parent,
            )
            if payload.coordinate_origin
            else None
        )
        cell_provenance = (
            _cell_provenance(
                session,
                candidate,
                str(candidate.project_id),
                source="PAPER_EVIDENCE" if payload.cell_source_evidence_id else "USER_ENTERED",
                source_evidence_id=(
                    str(payload.cell_source_evidence_id)
                    if payload.cell_source_evidence_id
                    else None
                ),
                original_file_sha256=None,
            )
            if payload.coordinate_representation.periodic_cell
            else None
        )
        source_record, created = _coordinate_record(
            session,
            identity,
            candidate,
            payload.coordinate_representation,
            source_representation_id=parent.id if parent else None,
            parameters={},
            method="user.coordinate-entry",
            approximation="USER_RECONSTRUCTION_UNVERIFIED",
            origin=CandidateRepresentationOrigin.USER_DRAFT,
            coordinate_provenance=coordinate_provenance,
            cell_provenance=cell_provenance,
        )

    assert source_record is not None
    session.commit()
    session.refresh(source_record)
    if generated_record is not None:
        session.refresh(generated_record)
    return (
        CandidateRepresentationCreateOutput(
            representation=_detail(session, source_record),
            generated_representation=(
                _coordinate_detail(session, generated_record) if generated_record else None
            ),
        ),
        created,
    )


def _write_review(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    representation_id: str,
    decision: CandidateRepresentationReviewState,
    notes: str | None,
    checklist: CandidateRepresentationReviewChecklist | None = None,
) -> CandidateRepresentationReviewOutput:
    candidate, scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id, write=True
    )
    if candidate.candidate_state in {"REJECTED", "PROMOTED"}:
        raise CandidateStateConflict("CANDIDATE_DOES_NOT_ACCEPT_REPRESENTATION_REVIEWS")
    record = session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.id == representation_id,
            CandidateRepresentationRecord.candidate_id == candidate.id,
            CandidateRepresentationRecord.project_id == scoped_project_id,
        )
    )
    if record is None:
        raise CandidateStateConflict("CANDIDATE_REPRESENTATION_NOT_FOUND")
    if record.validation_state == CandidateRepresentationValidationState.INVALID.value:
        raise CandidateStateConflict("INVALID_REPRESENTATION_CANNOT_BE_REVIEWED")
    current_review = session.scalar(
        select(CandidateRepresentationReviewRecord)
        .where(
            CandidateRepresentationReviewRecord.project_id == scoped_project_id,
            CandidateRepresentationReviewRecord.representation_id == record.id,
        )
        .order_by(
            CandidateRepresentationReviewRecord.created_at.desc(),
            CandidateRepresentationReviewRecord.id.desc(),
        )
    )
    if (
        current_review is not None
        and current_review.decision == CandidateRepresentationReviewState.REJECTED.value
        and decision is CandidateRepresentationReviewState.REVIEWED
    ):
        raise CandidateStateConflict("REJECTED_REPRESENTATION_CANNOT_BE_REOPENED")
    session.add(
        CandidateRepresentationReviewRecord(
            project_id=scoped_project_id,
            candidate_id=candidate.id,
            representation_id=record.id,
            decision=decision.value,
            notes=notes,
            checklist_json=checklist.model_dump(mode="json") if checklist else None,
            actor_id=identity.user_id,
        )
    )
    session.commit()
    return CandidateRepresentationReviewOutput(representation=_detail(session, record))


def review_candidate_representation(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    representation_id: str,
    notes: str | None,
    checklist: CandidateRepresentationReviewChecklist | None = None,
) -> CandidateRepresentationReviewOutput:
    return _write_review(
        session,
        identity,
        project_id,
        candidate_id,
        representation_id,
        CandidateRepresentationReviewState.REVIEWED,
        notes,
        checklist,
    )


def reject_candidate_representation(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    representation_id: str,
    reason: str | None,
) -> CandidateRepresentationReviewOutput:
    return _write_review(
        session,
        identity,
        project_id,
        candidate_id,
        representation_id,
        CandidateRepresentationReviewState.REJECTED,
        reason,
    )


def validate_candidate_graph(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    payload: MolecularGraphValidateInput,
) -> MolecularGraphValidateOutput:
    candidate, _scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id
    )
    graph_eval = validate_chemical_graph(payload.content, payload.format)
    diffs: tuple[MolecularGraphDifference, ...] = ()
    # An explicit parent must exist in this candidate and project; it is never silently ignored.
    parent = _lineage_parent(
        session,
        candidate,
        str(payload.parent_representation_id) if payload.parent_representation_id else None,
    )
    if graph_eval.is_parseable:
        diffs = _differences_from_parent(parent, payload.content, payload.format)
    return MolecularGraphValidateOutput(
        is_valid=graph_eval.is_parseable,
        canonical_isomeric_smiles=graph_eval.canonical_isomeric_smiles,
        formula=graph_eval.formula,
        formal_charge=graph_eval.formal_charge,
        heavy_atom_count=graph_eval.heavy_atom_count,
        elements=graph_eval.elements,
        has_stereochemistry=graph_eval.has_stereochemistry,
        stereocenters=graph_eval.stereocenters,
        double_bond_stereochemistry=graph_eval.double_bond_stereochemistry,
        unassigned_stereocenters=graph_eval.unassigned_stereocenters,
        unassigned_double_bonds=graph_eval.unassigned_double_bonds,
        disconnected_fragments=graph_eval.disconnected_fragments,
        fragment_formulas=tuple(graph_eval.fragment_formulas),
        is_organic=graph_eval.is_organic,
        unsupported_elements=tuple(graph_eval.unsupported_elements),
        can_generate_3d=graph_eval.can_generate_3d,
        validation_warnings=graph_eval.warnings,
        validation_diagnostics=graph_eval.diagnostics,
        differences_from_parent=diffs,
    )


def generate_candidate_representation_conformer(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    representation_id: str,
    payload: ConformerGenerationInput | None = None,
) -> CandidateRepresentationCreateOutput:
    try:
        return _generate_conformer_representation(
            session, identity, project_id, candidate_id, representation_id, payload
        )
    except IntegrityError as error:
        session.rollback()
        raise CandidateStateConflict("CANDIDATE_REPRESENTATION_REVISION_CONFLICT") from error


def _generate_conformer_representation(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    representation_id: str,
    payload: ConformerGenerationInput | None = None,
) -> CandidateRepresentationCreateOutput:
    candidate, scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id, write=True
    )
    if candidate.candidate_state in {"REJECTED", "PROMOTED"}:
        raise CandidateStateConflict("CANDIDATE_DOES_NOT_ACCEPT_NEW_REPRESENTATIONS")

    source_record = session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.id == representation_id,
            CandidateRepresentationRecord.candidate_id == candidate.id,
            CandidateRepresentationRecord.project_id == scoped_project_id,
        )
    )
    if source_record is None:
        raise CandidateStateConflict("CANDIDATE_REPRESENTATION_NOT_FOUND")
    if source_record.validation_state == CandidateRepresentationValidationState.INVALID.value:
        raise CandidateStateConflict("INVALID_REPRESENTATION_CANNOT_BE_USED_FOR_CONFORMER")

    source_payload = source_record.payload_json or {}
    smiles = source_payload.get("smiles") or source_payload.get("canonical_isomeric_smiles")
    mol_block = source_payload.get("mol_block")
    if not smiles and not mol_block:
        raise ScientificValidationFailed(
            "Conformer generation requires a 2D SMILES or MOL representation as parent."
        )

    content = smiles or mol_block
    fmt = "SMILES" if smiles else "MOL"
    graph_eval = validate_chemical_graph(content, fmt)
    if not graph_eval.is_parseable or graph_eval.mol is None:
        raise ScientificValidationFailed("Parent representation molecular graph is not parseable.")
    if not graph_eval.can_generate_3d:
        diag_msg = (
            "; ".join(graph_eval.diagnostics)
            if graph_eval.diagnostics
            else "Unknown chemical incompatibility."
        )
        raise ScientificValidationFailed(
            "Conformer generation requires a single organic closed-shell graph with explicit "
            f"stereochemistry: {diag_msg}"
        )

    name = (
        payload.name if payload and payload.name else None
    ) or f"Candidate {candidate.id[:8]} conformer"
    multiplicity = payload.multiplicity if payload else 1
    generated_geom = generate_conformer(graph_eval.mol, name, multiplicity=multiplicity)
    coordinate_rep = generated_geom.coordinates

    coordinate_provenance = _coordinate_provenance(
        identity,
        candidate,
        origin=CandidateCoordinateOrigin.GENERATED_CONFORMER,
        input_format=CandidateCoordinateInputFormat.GENERATED_CONFORMER,
        unit=coordinate_rep.coordinates.unit,
        parent=source_record,
    )
    coordinate_provenance["generation_parameters"] = _generation_parameters()
    coordinate_provenance["geometry_class"] = "GENERATED_CONFORMER_NOT_OPTIMIZED"
    coordinate_provenance["notice"] = (
        "Deterministic ETKDGv3 conformer without quantum mechanical optimization; "
        "energies and calculation results are not invented."
    )

    record, _created = _coordinate_record(
        session,
        identity,
        candidate,
        coordinate_rep,
        source_representation_id=source_record.id,
        parameters=_generation_parameters(),
        method=_PREVIEW_METHOD,
        approximation="GENERATED_CONFORMER_NOT_OPTIMIZED",
        origin=CandidateRepresentationOrigin.USER_DRAFT,
        coordinate_provenance=coordinate_provenance,
    )
    if record.representation_origin == CandidateRepresentationOrigin.DERIVED_PREVIEW.value:
        # Identical content already exists as the automatic, non-promotable preview. Returning
        # it would silently hand back a record without researcher-triggered provenance.
        session.rollback()
        raise CandidateStateConflict("CONFORMER_NAME_COLLIDES_WITH_AUTOMATIC_PREVIEW")
    session.commit()
    session.refresh(record)
    return CandidateRepresentationCreateOutput(representation=_detail(session, record))
