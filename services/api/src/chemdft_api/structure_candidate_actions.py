from __future__ import annotations

import hashlib
import io
import json
import re
from dataclasses import dataclass
from uuid import UUID

from rdkit import Chem, rdBase
from rdkit.Chem import AllChem
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .config import Settings
from .context import Identity
from .contracts.phase7 import SourceAnchor
from .contracts.provenance import (
    ProducerKind,
    ProvenanceClass,
    ProvenanceDetail,
    VerificationState,
)
from .contracts.scientific import (
    CoordinateSystem,
    StructureKind,
    StructureVersionOrigin,
)
from .contracts.structure_candidates import (
    CandidateCoordinateOrigin,
    CandidateCoordinateRepresentation,
    CandidateRepresentationOrigin,
    CandidateRepresentationReviewChecklist,
    CandidateRepresentationReviewState,
    CandidateRepresentationType,
    CandidateRepresentationValidationState,
    CandidateRepresentationView,
    StructureCandidate,
    StructureCandidateListOutput,
    StructureCandidatePromotionOutput,
    StructureCandidateReviewOutput,
    StructureCandidateSourceType,
    StructureCandidateState,
)
from .errors import (
    CandidateCoordinatesRequired,
    CandidateStateConflict,
    ProjectAccessDenied,
    RecognitionEngineUnavailable,
    ScientificReferenceNotFound,
    ScientificValidationFailed,
    StructureCandidateNotFound,
)
from .models import new_id, utc_now
from .project_access import ProjectCapability, can, require_capability
from .scientific.adapters.molecular.rdkit_adapter import atomic_number_for_symbol
from .scientific.figure_extractor import FigureExtractionError, extract_figures_from_pdf
from .scientific.molecular_recognition import (
    DecimerSubprocessEngine,
    MolecularRecognitionProposal,
    RecognitionStatus,
    resolve_recognition_engine,
)
from .scientific.structures import (
    CanonicalStructureCandidate,
    StructureSourceFormat,
    canonical_document,
)
from .scientific_actions import (
    _artifact_reference,
    _audit_structure_event,
    _persist_canonical_artifact,
    _structure_from_record,
    _version_from_record,
)
from .scientific_models import (
    AuditEventRecord,
    CandidateRepresentationRecord,
    CandidateRepresentationReviewRecord,
    DocumentSourceAnchorRecord,
    EvidenceCandidateRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    ScientificDocumentRecord,
    StructureCandidateRecord,
    StructureCandidateReviewRecord,
    StructureRecord,
    StructureVersionRecord,
)
from .storage import ObjectStore


def _candidate_for_evidence(
    session: Session,
    identity: Identity,
    project_id: str,
    evidence: EvidenceCandidateRecord,
) -> StructureCandidateRecord | None:
    if (
        evidence.project_id != project_id
        or evidence.evidence_type != "STRUCTURE_FIGURE_CANDIDATE"
        or evidence.source_class != ProvenanceClass.EXTRACTED.value
        or evidence.anchor_id is None
    ):
        return None
    anchor = session.scalar(
        select(DocumentSourceAnchorRecord).where(
            DocumentSourceAnchorRecord.id == evidence.anchor_id,
            DocumentSourceAnchorRecord.project_id == project_id,
        )
    )
    if anchor is None or anchor.source_type != "FIGURE":
        return None
    existing = session.scalar(
        select(StructureCandidateRecord).where(
            StructureCandidateRecord.project_id == project_id,
            StructureCandidateRecord.source_evidence_id == evidence.id,
            StructureCandidateRecord.source_type
            == StructureCandidateSourceType.REPORTED_FIGURE.value,
        )
    )
    if existing is not None:
        return existing
    document = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.id == evidence.document_id,
            ScientificDocumentRecord.project_id == project_id,
        )
    )
    if document is None:
        raise ScientificReferenceNotFound("Structure evidence source document is missing.")
    candidate = StructureCandidateRecord(
        project_id=project_id,
        source_type=StructureCandidateSourceType.REPORTED_FIGURE.value,
        source_evidence_id=evidence.id,
        source_document_id=document.id,
        source_anchor_id=anchor.id,
        candidate_state=StructureCandidateState.DETECTED.value,
        provenance_class=evidence.source_class,
        method=evidence.extraction_method,
        method_version=evidence.extractor_version,
        approximation="REPORTED_UNVERIFIED",
        created_by=identity.user_id,
    )
    session.add(candidate)
    session.flush()
    session.add(
        CandidateRepresentationRecord(
            project_id=project_id,
            candidate_id=candidate.id,
            representation_type=CandidateRepresentationType.IMAGE_REFERENCE.value,
            provenance_class=evidence.source_class,
            method=evidence.extraction_method,
            method_version=evidence.extractor_version,
            approximation="REPORTED_UNVERIFIED",
            payload_json=None,
            created_by=identity.user_id,
        )
    )
    return candidate


def ensure_document_structure_candidates(
    session: Session,
    identity: Identity,
    project_id: str,
    document_id: str,
) -> tuple[StructureCandidateRecord, ...]:
    project, _member = authorize_project_access(session, identity, project_id)
    evidence_records = session.scalars(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.project_id == project.id,
            EvidenceCandidateRecord.document_id == document_id,
            EvidenceCandidateRecord.evidence_type == "STRUCTURE_FIGURE_CANDIDATE",
        )
    ).all()
    return tuple(
        candidate
        for item in evidence_records
        if (candidate := _candidate_for_evidence(session, identity, project.id, item)) is not None
    )


def _candidate_view(session: Session, record: StructureCandidateRecord) -> StructureCandidate:
    anchor = None
    if record.source_anchor_id:
        anchor = session.scalar(
            select(DocumentSourceAnchorRecord).where(
                DocumentSourceAnchorRecord.id == record.source_anchor_id,
                DocumentSourceAnchorRecord.project_id == record.project_id,
            )
        )
    anchor_view = (
        SourceAnchor(
            document_id=UUID(anchor.document_id),
            page_number=anchor.page_number,
            source_type=anchor.source_type,
            x=anchor.x,
            y=anchor.y,
            width=anchor.width,
            height=anchor.height,
            caption=anchor.caption,
            figure_number=anchor.figure_number,
            table_number=anchor.table_number,
            snippet=anchor.snippet,
        )
        if anchor
        else None
    )
    representations = session.scalars(
        select(CandidateRepresentationRecord)
        .where(
            CandidateRepresentationRecord.candidate_id == record.id,
            CandidateRepresentationRecord.project_id == record.project_id,
        )
        .order_by(CandidateRepresentationRecord.created_at.asc())
    ).all()
    representation_views = tuple(_representation_summary(session, item) for item in representations)
    representation_types = tuple(
        CandidateRepresentationType(item.representation_type) for item in representations
    )
    coordinates_available = any(item.coordinates_available for item in representation_views)
    return StructureCandidate(
        id=UUID(record.id),
        project_id=UUID(record.project_id),
        source_type=StructureCandidateSourceType(record.source_type),
        source_evidence_id=UUID(record.source_evidence_id),
        source_document_id=UUID(record.source_document_id),
        source_page=anchor.page_number if anchor else None,
        source_anchor_id=UUID(record.source_anchor_id) if record.source_anchor_id else None,
        source_anchor=anchor_view,
        candidate_state=StructureCandidateState(record.candidate_state),
        provenance_class=ProvenanceClass(record.provenance_class),
        method=record.method,
        method_version=record.method_version,
        approximation=record.approximation,
        representations=representation_views,
        representation_types=representation_types,
        coordinates_available=coordinates_available,
        created_by=UUID(record.created_by),
        created_at=record.created_at,
        reviewed_by=UUID(record.reviewed_by) if record.reviewed_by else None,
        reviewed_at=record.reviewed_at,
        promoted_structure_version_id=(
            UUID(record.promoted_structure_version_id)
            if record.promoted_structure_version_id
            else None
        ),
    )


def _representation_review_state(
    session: Session, representation_id: str
) -> CandidateRepresentationReviewState:
    review = _latest_representation_review(session, representation_id)
    if review is None:
        return CandidateRepresentationReviewState.NOT_REVIEWED
    return CandidateRepresentationReviewState(review.decision)


def _latest_representation_review(
    session: Session, representation_id: str
) -> CandidateRepresentationReviewRecord | None:
    return session.scalar(
        select(CandidateRepresentationReviewRecord)
        .where(CandidateRepresentationReviewRecord.representation_id == representation_id)
        .order_by(
            CandidateRepresentationReviewRecord.created_at.desc(),
            CandidateRepresentationReviewRecord.id.desc(),
        )
    )


def _representation_summary(
    session: Session, item: CandidateRepresentationRecord
) -> CandidateRepresentationView:
    latest_review = _latest_representation_review(session, item.id)
    return CandidateRepresentationView(
        id=UUID(item.id),
        representation_type=CandidateRepresentationType(item.representation_type),
        revision=item.revision,
        content_sha256=item.content_sha256,
        representation_origin=item.representation_origin,
        coordinates_available=item.representation_type
        in {
            CandidateRepresentationType.COORDINATES.value,
            CandidateRepresentationType.CARTESIAN_COORDINATES.value,
            CandidateRepresentationType.CRYSTAL_COORDINATES.value,
        }
        and item.payload_json is not None,
        validation_state=CandidateRepresentationValidationState(item.validation_state),
        validation_diagnostics=tuple(item.validation_diagnostics_json or ()),
        review_state=_representation_review_state(session, item.id),
        source_representation_id=(
            UUID(item.source_representation_id) if item.source_representation_id else None
        ),
        provenance_class=ProvenanceClass(item.provenance_class),
        method=item.method,
        method_version=item.method_version,
        approximation=item.approximation,
        created_by=UUID(item.created_by),
        created_at=item.created_at,
        generation_parameters=item.generation_parameters_json or {},
        coordinate_provenance=item.coordinate_provenance_json,
        cell_provenance=item.cell_provenance_json,
        review_checklist=(
            CandidateRepresentationReviewChecklist.model_validate(latest_review.checklist_json)
            if latest_review and latest_review.checklist_json
            else None
        ),
    )


def _graph_review_requirements(
    session: Session, record: CandidateRepresentationRecord
) -> tuple[bool, bool]:
    """Which B3 review items apply to a coordinate representation, from its molecular graph.

    The nearest SMILES/MOL ancestor is the graph the coordinates were built from. Stereochemistry
    review applies when that graph has stereo elements; charge review applies when any atom is
    formally charged (zwitterions included) or the coordinates themselves declare charge.
    Representations with no graph ancestor and no generated-conformer origin keep the legacy
    seven-item checklist.
    """
    from .scientific.molecular_recognition.validation import validate_chemical_graph

    provenance = record.coordinate_provenance_json or {}
    is_generated = provenance.get("origin") == CandidateCoordinateOrigin.GENERATED_CONFORMER.value
    node = record
    seen: set[str] = set()
    graph_types = {
        CandidateRepresentationType.SMILES.value,
        CandidateRepresentationType.MOL.value,
        CandidateRepresentationType.MOL_BLOCK.value,
    }
    ancestor: CandidateRepresentationRecord | None = None
    while node is not None and node.id not in seen:
        seen.add(node.id)
        if node.representation_type in graph_types:
            ancestor = node
            break
        parent_id = node.source_representation_id
        node = (
            session.scalar(
                select(CandidateRepresentationRecord).where(
                    CandidateRepresentationRecord.id == parent_id,
                    CandidateRepresentationRecord.project_id == record.project_id,
                    CandidateRepresentationRecord.candidate_id == record.candidate_id,
                )
            )
            if parent_id
            else None
        )
    if ancestor is None and not is_generated:
        return False, False
    needs_stereo = False
    needs_charges = False
    if ancestor is not None:
        payload = ancestor.payload_json or {}
        smiles = payload.get("smiles") or payload.get("canonical_isomeric_smiles")
        text, fmt = (smiles, "SMILES") if smiles else (payload.get("mol_block"), "MOL")
        evaluation = validate_chemical_graph(text, fmt)
        if evaluation.is_parseable and evaluation.mol is not None:
            needs_stereo = bool(
                evaluation.stereocenters or evaluation.double_bond_stereochemistry
            )
            needs_charges = any(a.GetFormalCharge() for a in evaluation.mol.GetAtoms())
        else:
            # An unreadable ancestor cannot establish that these items are not applicable.
            needs_stereo = needs_charges = True
    coordinate_payload = record.payload_json or {}
    coordinate_payload = coordinate_payload.get("coordinate_representation", coordinate_payload)
    try:
        if coordinate_payload.get("overall_charge"):
            needs_charges = True
        atoms = (coordinate_payload.get("coordinates") or {}).get("atoms") or []
        if any(atom.get("formal_charge") for atom in atoms):
            needs_charges = True
    except AttributeError:
        needs_charges = True
    return needs_stereo, needs_charges


def _authorized_candidate(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    *,
    write: bool = False,
) -> tuple[StructureCandidateRecord, str]:
    project, member = authorize_project_access(session, identity, project_id)
    if write and not can(member, ProjectCapability.WRITE):
        raise ProjectAccessDenied()
    candidate = session.scalar(
        select(StructureCandidateRecord).where(
            StructureCandidateRecord.id == candidate_id,
            StructureCandidateRecord.project_id == project.id,
        )
    )
    if candidate is None:
        raise StructureCandidateNotFound()
    return candidate, project.id


def list_structure_candidates(
    session: Session, identity: Identity, project_id: str
) -> StructureCandidateListOutput:
    project, _member = authorize_project_access(session, identity, project_id)
    rows = session.scalars(
        select(StructureCandidateRecord)
        .where(StructureCandidateRecord.project_id == project.id)
        .order_by(StructureCandidateRecord.created_at.asc(), StructureCandidateRecord.id.asc())
    ).all()
    return StructureCandidateListOutput(
        candidates=tuple(_candidate_view(session, row) for row in rows)
    )


def get_structure_candidate(
    session: Session, identity: Identity, project_id: str, candidate_id: str
) -> StructureCandidate:
    row, _project = _authorized_candidate(session, identity, project_id, candidate_id)
    return _candidate_view(session, row)


def _candidate_audit(
    session: Session,
    identity: Identity,
    *,
    project_id: str,
    candidate_id: str,
    event_name: str,
    outcome: str = "SUCCEEDED",
    artifacts: list[dict[str, str]] | None = None,
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
                    "entity_type": "structure.candidate",
                    "entity_id": candidate_id,
                }
            ],
            outcome=outcome,
            artifact_references_json=artifacts or [],
            safe_metadata_json=[],
        )
    )


def review_structure_candidate(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    notes: str | None,
) -> StructureCandidateReviewOutput:
    candidate, scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id, write=True
    )
    if candidate.candidate_state == StructureCandidateState.PROMOTED.value:
        raise CandidateStateConflict("PROMOTED_CANDIDATE_CANNOT_BE_REVIEWED")
    if candidate.candidate_state == StructureCandidateState.REJECTED.value:
        raise CandidateStateConflict("REJECTED_CANDIDATE_CANNOT_BE_REVIEWED")
    if candidate.candidate_state != StructureCandidateState.REVIEWED.value:
        now = utc_now()
        candidate.candidate_state = StructureCandidateState.REVIEWED.value
        candidate.reviewed_by = identity.user_id
        candidate.reviewed_at = now
        session.add(
            StructureCandidateReviewRecord(
                project_id=scoped_project_id,
                candidate_id=candidate.id,
                decision=StructureCandidateState.REVIEWED.value,
                notes=notes,
                actor_id=identity.user_id,
            )
        )
        _candidate_audit(
            session,
            identity,
            project_id=scoped_project_id,
            candidate_id=candidate.id,
            event_name="structure_candidate.reviewed",
        )
        session.commit()
    return StructureCandidateReviewOutput(candidate=_candidate_view(session, candidate))


def reject_structure_candidate(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    reason: str | None,
) -> StructureCandidateReviewOutput:
    candidate, scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id, write=True
    )
    if candidate.candidate_state == StructureCandidateState.PROMOTED.value:
        raise CandidateStateConflict("PROMOTED_CANDIDATE_CANNOT_BE_REJECTED")
    if candidate.candidate_state != StructureCandidateState.REJECTED.value:
        candidate.candidate_state = StructureCandidateState.REJECTED.value
        candidate.reviewed_by = identity.user_id
        candidate.reviewed_at = utc_now()
        session.add(
            StructureCandidateReviewRecord(
                project_id=scoped_project_id,
                candidate_id=candidate.id,
                decision=StructureCandidateState.REJECTED.value,
                notes=reason,
                actor_id=identity.user_id,
            )
        )
        _candidate_audit(
            session,
            identity,
            project_id=scoped_project_id,
            candidate_id=candidate.id,
            event_name="structure_candidate.rejected",
        )
        session.commit()
    return StructureCandidateReviewOutput(candidate=_candidate_view(session, candidate))


def _validated_canonical_candidate(
    representation: CandidateCoordinateRepresentation,
    record: CandidateRepresentationRecord,
) -> CanonicalStructureCandidate:
    coordinates = representation.coordinates
    canonical = CanonicalStructureCandidate(
        name=representation.name,
        kind=representation.kind,
        coordinates={
            "coordinate_system": coordinates.coordinate_system.value,
            "unit": coordinates.unit.value,
            "dimensionality": 3,
            "atom_ordering": "AS_LISTED",
            "atoms": [atom.model_dump(mode="json") for atom in coordinates.atoms],
            "bonds": [bond.model_dump(mode="json") for bond in coordinates.bonds],
        },
        overall_charge=representation.overall_charge,
        multiplicity=representation.multiplicity,
        source_format=(
            StructureSourceFormat.CIF
            if representation.kind is StructureKind.PERIODIC
            else StructureSourceFormat.MOL
        ),
        parser_name="chemdft.candidate-coordinate-validator",
        parser_version=record.method_version,
        adapter_name="chemdft.candidate-coordinate-adapter",
        adapter_version="1.0.0",
        periodic_cell=(
            representation.periodic_cell.model_dump(mode="json")
            if representation.periodic_cell
            else None
        ),
        diagnostics=(),
    )
    canonical_document(canonical)
    if representation.kind is StructureKind.PERIODIC:
        try:
            from pymatgen.core import Lattice
            from pymatgen.core import Structure as PymatgenStructure

            cell = representation.periodic_cell
            assert cell is not None
            PymatgenStructure(
                Lattice.from_parameters(cell.a, cell.b, cell.c, cell.alpha, cell.beta, cell.gamma),
                [atom.element for atom in coordinates.atoms],
                [[atom.x, atom.y, atom.z] for atom in coordinates.atoms],
                site_properties={
                    "occupancy": [atom.occupancy or 1.0 for atom in coordinates.atoms]
                },
            )
        except Exception as error:
            raise ScientificValidationFailed(
                "Periodic candidate coordinate validation failed."
            ) from error
        if coordinates.coordinate_system is not CoordinateSystem.FRACTIONAL:
            raise ScientificValidationFailed("Periodic candidate coordinates must be fractional.")
        return canonical
    try:
        molecule = Chem.RWMol()
        for atom in coordinates.atoms:
            rd_atom = Chem.Atom(atomic_number_for_symbol(atom.element))
            if atom.formal_charge is not None:
                rd_atom.SetFormalCharge(atom.formal_charge)
            if atom.isotope is not None:
                rd_atom.SetIsotope(atom.isotope)
            molecule.AddAtom(rd_atom)
        bond_types = {
            1.0: Chem.BondType.SINGLE,
            1.5: Chem.BondType.AROMATIC,
            2.0: Chem.BondType.DOUBLE,
            3.0: Chem.BondType.TRIPLE,
        }
        for bond in coordinates.bonds:
            order = float(bond.order or 1)
            if order not in bond_types:
                raise ScientificValidationFailed(
                    "Candidate bond order is not chemically supported."
                )
            molecule.AddBond(bond.atom_index_a, bond.atom_index_b, bond_types[order])
        rd_molecule = molecule.GetMol()
        Chem.SanitizeMol(rd_molecule)
    except ScientificValidationFailed:
        raise
    except Exception as error:
        raise ScientificValidationFailed(
            "Candidate coordinate chemistry validation failed."
        ) from error
    return canonical


def _promotion_output(
    session: Session,
    candidate: StructureCandidateRecord,
    structure: StructureRecord,
    version: StructureVersionRecord,
    provenance: ProvenanceRecordRow,
) -> StructureCandidatePromotionOutput:
    from .scientific_actions import _provenance_from_version_record

    details = _provenance_from_version_record(session, version)
    if details is None:
        raise ScientificReferenceNotFound("Promoted structure provenance is missing.")
    return StructureCandidatePromotionOutput(
        candidate=_candidate_view(session, candidate),
        structure=_structure_from_record(structure),
        version=_version_from_record(version),
        provenance=details,
    )


def promote_structure_candidate(
    session: Session,
    identity: Identity,
    object_store: ObjectStore,
    project_id: str,
    candidate_id: str,
    representation_id: str | None = None,
) -> StructureCandidatePromotionOutput:
    candidate, scoped_project_id = _authorized_candidate(
        session, identity, project_id, candidate_id, write=True
    )
    if candidate.candidate_state == StructureCandidateState.PROMOTED.value:
        structure = session.scalar(
            select(StructureRecord).where(
                StructureRecord.project_id == scoped_project_id,
                StructureRecord.id
                == select(StructureVersionRecord.structure_id)
                .where(
                    StructureVersionRecord.id == candidate.promoted_structure_version_id,
                    StructureVersionRecord.project_id == scoped_project_id,
                )
                .scalar_subquery(),
            )
        )
        version = session.scalar(
            select(StructureVersionRecord).where(
                StructureVersionRecord.id == candidate.promoted_structure_version_id,
                StructureVersionRecord.project_id == scoped_project_id,
            )
        )
        provenance = (
            session.get(ProvenanceRecordRow, version.provenance_record_id) if version else None
        )
        if structure is None or version is None or provenance is None:
            raise ScientificReferenceNotFound("Previously promoted structure version is missing.")
        return _promotion_output(session, candidate, structure, version, provenance)
    if candidate.candidate_state != StructureCandidateState.REVIEWED.value:
        raise CandidateStateConflict("CANDIDATE_REVIEW_REQUIRED")
    if representation_id is None:
        eligible_representations = session.scalars(
            select(CandidateRepresentationRecord).where(
                CandidateRepresentationRecord.candidate_id == candidate.id,
                CandidateRepresentationRecord.project_id == scoped_project_id,
                CandidateRepresentationRecord.representation_type.in_(
                    {
                        CandidateRepresentationType.COORDINATES.value,
                        CandidateRepresentationType.CARTESIAN_COORDINATES.value,
                        CandidateRepresentationType.CRYSTAL_COORDINATES.value,
                    }
                ),
                CandidateRepresentationRecord.payload_json.is_not(None),
            )
        ).all()
        if not eligible_representations:
            raise CandidateCoordinatesRequired()
        reviewed_representations = [
            item
            for item in eligible_representations
            if session.scalar(
                select(CandidateRepresentationReviewRecord.id).where(
                    CandidateRepresentationReviewRecord.project_id == scoped_project_id,
                    CandidateRepresentationReviewRecord.candidate_id == candidate.id,
                    CandidateRepresentationReviewRecord.representation_id == item.id,
                    CandidateRepresentationReviewRecord.decision
                    == CandidateRepresentationReviewState.REVIEWED.value,
                )
            )
        ]
        if len(reviewed_representations) != 1:
            raise CandidateStateConflict("CANDIDATE_REPRESENTATION_ID_REQUIRED")
        representation_id = reviewed_representations[0].id
    representation_record = session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.id == representation_id,
            CandidateRepresentationRecord.candidate_id == candidate.id,
            CandidateRepresentationRecord.project_id == scoped_project_id,
            CandidateRepresentationRecord.representation_type.in_(
                {
                    CandidateRepresentationType.COORDINATES.value,
                    CandidateRepresentationType.CARTESIAN_COORDINATES.value,
                    CandidateRepresentationType.CRYSTAL_COORDINATES.value,
                }
            ),
            CandidateRepresentationRecord.payload_json.is_not(None),
        )
    )
    if representation_record is None:
        raise CandidateCoordinatesRequired()
    representation_review = session.scalar(
        select(CandidateRepresentationReviewRecord)
        .where(
            CandidateRepresentationReviewRecord.project_id == scoped_project_id,
            CandidateRepresentationReviewRecord.candidate_id == candidate.id,
            CandidateRepresentationReviewRecord.representation_id == representation_record.id,
        )
        .order_by(
            CandidateRepresentationReviewRecord.created_at.desc(),
            CandidateRepresentationReviewRecord.id.desc(),
        )
    )
    if (
        representation_review is None
        or representation_review.decision != CandidateRepresentationReviewState.REVIEWED.value
    ):
        raise CandidateStateConflict("CANDIDATE_REPRESENTATION_REVIEW_REQUIRED")
    checklist = CandidateRepresentationReviewChecklist.model_validate(
        representation_review.checklist_json or {}
    )
    needs_stereo, needs_charges = _graph_review_requirements(session, representation_record)
    if not checklist.complete_for(
        stereochemistry_required=needs_stereo, charges_required=needs_charges
    ):
        missing = [
            name
            for name, required in (
                ("stereochemistry_reviewed", needs_stereo),
                ("charges_reviewed", needs_charges),
            )
            if required and getattr(checklist, name) is not True
        ]
        suffix = f": explicit review required for {', '.join(missing)}" if missing else ""
        raise CandidateStateConflict(f"HUMAN_REVIEW_CHECKLIST_INCOMPLETE{suffix}")
    if representation_record.provenance_class in {
        ProvenanceClass.EXPERIMENTAL.value,
        ProvenanceClass.CALCULATED.value,
    }:
        raise ScientificValidationFailed(
            "Candidate promotion cannot assert experimental or calculated provenance."
        )
    try:
        coordinate_payload = representation_record.payload_json
        if "coordinate_representation" in coordinate_payload:
            coordinate_payload = coordinate_payload["coordinate_representation"]
        coordinate_representation = CandidateCoordinateRepresentation.model_validate(
            coordinate_payload
        )
    except Exception as error:
        raise ScientificValidationFailed(
            "Candidate coordinate representation is invalid."
        ) from error
    coordinate_provenance = representation_record.coordinate_provenance_json
    if not coordinate_provenance:
        raise CandidateStateConflict("COORDINATE_PROVENANCE_REQUIRED")
    try:
        coordinate_origin = CandidateCoordinateOrigin(coordinate_provenance.get("origin"))
    except ValueError as error:
        raise CandidateStateConflict("COORDINATE_ORIGIN_NOT_ALLOWED") from error
    if (
        coordinate_provenance.get("source_evidence_id") != candidate.source_evidence_id
        or coordinate_provenance.get("source_document_id") != candidate.source_document_id
        or coordinate_provenance.get("user_id") != representation_record.created_by
        or coordinate_provenance.get("coordinate_unit")
        != coordinate_representation.coordinates.unit.value
    ):
        raise CandidateStateConflict("COORDINATE_PROVENANCE_MISMATCH")
    if coordinate_origin is CandidateCoordinateOrigin.USER_IMPORTED_FILE:
        file_hash = coordinate_provenance.get("original_file_sha256")
        if not isinstance(file_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", file_hash):
            raise CandidateStateConflict("IMPORTED_COORDINATE_FILE_HASH_REQUIRED")
    parent_representation_id = coordinate_provenance.get("parent_representation_id")
    if parent_representation_id:
        parent = session.scalar(
            select(CandidateRepresentationRecord).where(
                CandidateRepresentationRecord.id == parent_representation_id,
                CandidateRepresentationRecord.project_id == scoped_project_id,
                CandidateRepresentationRecord.candidate_id == candidate.id,
            )
        )
        if parent is None:
            raise CandidateStateConflict("PARENT_REPRESENTATION_NOT_FOUND_IN_CANDIDATE")
    if coordinate_representation.kind is StructureKind.PERIODIC:
        cell_provenance = representation_record.cell_provenance_json
        if not cell_provenance or not cell_provenance.get("source"):
            raise CandidateStateConflict("CELL_PROVENANCE_REQUIRED")
        if cell_provenance.get("source") == "PAPER_EVIDENCE" and not cell_provenance.get(
            "source_evidence_id"
        ):
            raise CandidateStateConflict("CELL_SOURCE_EVIDENCE_REQUIRED")
    canonical = _validated_canonical_candidate(coordinate_representation, representation_record)

    evidence = session.scalar(
        select(EvidenceCandidateRecord).where(
            EvidenceCandidateRecord.id == candidate.source_evidence_id,
            EvidenceCandidateRecord.project_id == scoped_project_id,
        )
    )
    document = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.id == candidate.source_document_id,
            ScientificDocumentRecord.project_id == scoped_project_id,
        )
    )
    if evidence is None or document is None or evidence.document_id != document.id:
        raise ScientificReferenceNotFound("Candidate source evidence is missing.")
    source_artifact = session.scalar(
        select(ScientificArtifactRecord).where(
            ScientificArtifactRecord.id == document.raw_artifact_id,
            ScientificArtifactRecord.project_id == scoped_project_id,
        )
    )
    if source_artifact is None:
        raise ScientificReferenceNotFound("Candidate source document artifact is missing.")
    canonical_artifact = _persist_canonical_artifact(
        session,
        identity,
        object_store,
        project_id=scoped_project_id,
        document=canonical_document(canonical),
        source_artifact_id=source_artifact.id,
    )
    structure = StructureRecord(
        project_id=scoped_project_id,
        name=canonical.name,
        kind=canonical.kind.value,
        created_by=identity.user_id,
    )
    session.add(structure)
    session.flush()
    version_id = new_id()
    canonical_ref = _artifact_reference(canonical_artifact)
    source_ref = _artifact_reference(source_artifact)
    coordinate_payload = dict(canonical.coordinates)
    coordinate_payload["structure_version_id"] = version_id
    coordinate_payload["source"] = canonical_ref.model_dump(mode="json")
    provenance_detail = ProvenanceDetail.MANUAL_ENTRY
    provenance = ProvenanceRecordRow(
        project_id=scoped_project_id,
        subject_type="structure.version",
        subject_id=version_id,
        source_class=representation_record.provenance_class,
        detail=provenance_detail.value,
        verification_state=VerificationState.VERIFIED.value,
        producer_kind=ProducerKind.USER.value,
        producer_identifier=identity.user_id,
        producer_software_version=None,
        source_artifact_id=source_artifact.id,
        operation="chemdft.structure_candidate.promote",
        operation_version="1.0.0",
        parameters_json=[
            {"key": "candidate_id", "value": candidate.id},
            {"key": "source_evidence_id", "value": evidence.id},
            {"key": "representation_id", "value": representation_record.id},
            {"key": "method", "value": representation_record.method},
            {"key": "method_version", "value": representation_record.method_version},
            {"key": "approximation", "value": representation_record.approximation},
            {"key": "representation_origin", "value": representation_record.representation_origin},
            {"key": "representation_revision", "value": str(representation_record.revision)},
            {"key": "coordinate_origin", "value": coordinate_origin.value},
            {
                "key": "coordinate_input_format",
                "value": str(coordinate_provenance.get("input_format")),
            },
            {"key": "coordinate_unit", "value": coordinate_representation.coordinates.unit.value},
            {
                "key": "coordinate_file_sha256",
                "value": str(coordinate_provenance.get("original_file_sha256") or ""),
            },
            {
                "key": "cell_provenance",
                "value": json.dumps(representation_record.cell_provenance_json, sort_keys=True),
            },
            {
                "key": "human_review_checklist",
                "value": json.dumps(representation_review.checklist_json, sort_keys=True),
            },
            {"key": "representation_reviewed_by", "value": representation_review.actor_id},
            {
                "key": "representation_reviewed_at",
                "value": representation_review.created_at.isoformat(),
            },
        ],
        approximate=representation_record.approximation != "EXACT",
        supersedes_id=None,
        correlation_id=new_id(),
    )
    session.add(provenance)
    session.flush()
    provenance_inputs = [
        ProvenanceInputRow(
            provenance_record_id=provenance.id,
            project_id=scoped_project_id,
            position=0,
            input_type="ENTITY",
            input_id=document.id,
            input_sha256=document.sha256,
        ),
        ProvenanceInputRow(
            provenance_record_id=provenance.id,
            project_id=scoped_project_id,
            position=1,
            input_type="ENTITY",
            input_id=candidate.id,
            input_sha256=None,
        ),
        ProvenanceInputRow(
            provenance_record_id=provenance.id,
            project_id=scoped_project_id,
            position=2,
            input_type="ENTITY",
            input_id=evidence.id,
            input_sha256=None,
        ),
        ProvenanceInputRow(
            provenance_record_id=provenance.id,
            project_id=scoped_project_id,
            position=3,
            input_type="ENTITY",
            input_id=representation_record.id,
            input_sha256=representation_record.content_sha256,
        ),
        ProvenanceInputRow(
            provenance_record_id=provenance.id,
            project_id=scoped_project_id,
            position=4,
            input_type="ENTITY",
            input_id=representation_review.id,
            input_sha256=None,
        ),
    ]
    next_input_position = 5
    if parent_representation_id and parent is not None:
        provenance_inputs.append(
            ProvenanceInputRow(
                provenance_record_id=provenance.id,
                project_id=scoped_project_id,
                position=next_input_position,
                input_type="ENTITY",
                input_id=parent.id,
                input_sha256=parent.content_sha256,
            )
        )
        next_input_position += 1
    # The whole revision chain (recognition proposal -> corrections -> graph used for the
    # conformer) is recorded, not only the immediate parent, so the promoted version can be traced
    # to the original recognition evidence.
    recorded_inputs = {item.input_id for item in provenance_inputs}
    ancestor_id = representation_record.source_representation_id
    for _hop in range(64):
        ancestor = (
            session.scalar(
                select(CandidateRepresentationRecord).where(
                    CandidateRepresentationRecord.id == ancestor_id,
                    CandidateRepresentationRecord.project_id == scoped_project_id,
                    CandidateRepresentationRecord.candidate_id == candidate.id,
                )
            )
            if ancestor_id
            else None
        )
        if ancestor is None:
            break
        if ancestor.id not in recorded_inputs:
            provenance_inputs.append(
                ProvenanceInputRow(
                    provenance_record_id=provenance.id,
                    project_id=scoped_project_id,
                    position=next_input_position,
                    input_type="ENTITY",
                    input_id=ancestor.id,
                    input_sha256=ancestor.content_sha256,
                )
            )
            recorded_inputs.add(ancestor.id)
            next_input_position += 1
        ancestor_id = ancestor.source_representation_id
    cell_source_evidence_id = (representation_record.cell_provenance_json or {}).get(
        "source_evidence_id"
    )
    if cell_source_evidence_id:
        provenance_inputs.append(
            ProvenanceInputRow(
                provenance_record_id=provenance.id,
                project_id=scoped_project_id,
                position=next_input_position,
                input_type="ENTITY",
                input_id=str(cell_source_evidence_id),
                input_sha256=None,
            )
        )
        next_input_position += 1
    provenance_inputs.append(
        ProvenanceInputRow(
            provenance_record_id=provenance.id,
            project_id=scoped_project_id,
            position=next_input_position,
            input_type="ARTIFACT",
            input_id=source_artifact.id,
            input_sha256=source_artifact.sha256,
        )
    )
    session.add_all(provenance_inputs)
    version = StructureVersionRecord(
        id=version_id,
        project_id=scoped_project_id,
        structure_id=structure.id,
        revision=1,
        origin=StructureVersionOrigin.RECONSTRUCTED.value,
        parent_version_id=None,
        canonical_artifact_id=canonical_artifact.id,
        source_artifact_id=source_artifact.id,
        coordinate_system=canonical.coordinates["coordinate_system"],
        coordinate_unit=canonical.coordinates["unit"],
        atom_count=len(canonical.atoms),
        bond_count=len(canonical.bonds),
        overall_charge=canonical.overall_charge,
        multiplicity=canonical.multiplicity,
        representation_json={
            "source_artifact": source_ref.model_dump(mode="json"),
            "canonical_artifact": canonical_ref.model_dump(mode="json"),
            "coordinates": coordinate_payload,
        },
        periodic_cell_json=canonical.periodic_cell,
        diagnostics_json=[item.model_dump(mode="json") for item in canonical.diagnostics],
        provenance_record_id=provenance.id,
        idempotency_key=f"candidate-promotion:{candidate.id}",
        created_by=identity.user_id,
    )
    session.add(version)
    # The candidate has a project-scoped FK to the immutable version. Persist
    # the version row before updating that FK (sessions disable autoflush).
    session.flush()
    candidate.candidate_state = StructureCandidateState.PROMOTED.value
    candidate.promoted_structure_version_id = version.id
    _audit_structure_event(
        session,
        identity,
        project_id=scoped_project_id,
        event_name="structure.candidate.promoted",
        structure_id=structure.id,
        version_id=version.id,
        artifacts=[source_ref, canonical_ref],
    )
    _candidate_audit(
        session,
        identity,
        project_id=scoped_project_id,
        candidate_id=candidate.id,
        event_name="structure_candidate.promoted",
        artifacts=[source_ref.model_dump(mode="json"), canonical_ref.model_dump(mode="json")],
    )
    session.commit()
    session.refresh(candidate)
    session.refresh(structure)
    session.refresh(version)
    return _promotion_output(session, candidate, structure, version, provenance)


def extract_document_figure_candidates(
    session: Session,
    identity: Identity,
    project_id: str,
    document_id: str,
    object_store: ObjectStore,
    settings: Settings,
) -> tuple[StructureCandidate, ...]:
    """Extract candidate figures from a document and register unverified structure candidates."""
    project, member = authorize_project_access(session, identity, project_id)
    require_capability(member, ProjectCapability.WRITE)
    doc = session.scalar(
        select(ScientificDocumentRecord).where(
            ScientificDocumentRecord.id == document_id,
            ScientificDocumentRecord.project_id == project.id,
        )
    )
    if doc is None:
        raise ScientificReferenceNotFound("Scientific document not found in project.")
    artifact = session.scalar(
        select(ScientificArtifactRecord).where(
            ScientificArtifactRecord.id == doc.raw_artifact_id,
            ScientificArtifactRecord.project_id == project.id,
        )
    )
    if (
        artifact is None
        or not artifact.storage_key.startswith(f"projects/{project.id}/")
        or ".." in artifact.storage_key
    ):
        raise ScientificReferenceNotFound("Raw document artifact not found.")

    raw_pdf_bytes = object_store.get_bytes(artifact.storage_key, settings.max_upload_bytes)
    if hashlib.sha256(raw_pdf_bytes).hexdigest() != artifact.sha256:
        raise ScientificValidationFailed(
            "Stored source document does not match its recorded SHA-256; refusing to extract."
        )
    try:
        figures = extract_figures_from_pdf(
            raw_pdf_bytes,
            document_id=doc.id,
            document_sha256=doc.sha256,
            max_pages=500,
        )
    except FigureExtractionError as error:
        raise ScientificValidationFailed(f"Figure extraction failed: {error}") from error

    created_candidates: list[StructureCandidateRecord] = []
    for fig in figures:
        existing_anchor = session.scalar(
            select(DocumentSourceAnchorRecord).where(
                DocumentSourceAnchorRecord.project_id == project.id,
                DocumentSourceAnchorRecord.document_id == doc.id,
                DocumentSourceAnchorRecord.page_number == fig.page_number,
                DocumentSourceAnchorRecord.figure_number == fig.figure_number,
            )
        )
        if existing_anchor is not None:
            cand = session.scalar(
                select(StructureCandidateRecord).where(
                    StructureCandidateRecord.project_id == project.id,
                    StructureCandidateRecord.source_anchor_id == existing_anchor.id,
                )
            )
            if cand is not None:
                created_candidates.append(cand)
                continue

        stored_fig = object_store.put_raw(
            project.id, io.BytesIO(fig.image_bytes), settings.max_upload_bytes
        )

        anchor = DocumentSourceAnchorRecord(
            project_id=project.id,
            document_id=doc.id,
            page_number=fig.page_number,
            source_type="FIGURE",
            x=fig.x,
            y=fig.y,
            width=fig.width,
            height=fig.height,
            caption=fig.caption,
            figure_number=fig.figure_number,
            snippet=(
                f"Extracted figure from page {fig.page_number} "
                f"({fig.pixel_width}x{fig.pixel_height} px)"
            ),
        )
        session.add(anchor)
        session.flush()

        evidence = EvidenceCandidateRecord(
            project_id=project.id,
            document_id=doc.id,
            evidence_type="STRUCTURE_FIGURE_CANDIDATE",
            source_class=ProvenanceClass.EXTRACTED.value,
            payload_json={
                "storage_key": stored_fig.key,
                "image_sha256": fig.image_sha256,
                "pixel_width": fig.pixel_width,
                "pixel_height": fig.pixel_height,
                "format": "PNG",
                "extracted_at": fig.extracted_at,
            },
            anchor_id=anchor.id,
            extraction_method=fig.extraction_method,
            extractor_version="1.0.0",
            diagnostics_json=[],
            review_state="DETECTED",
        )
        session.add(evidence)
        session.flush()

        candidate = StructureCandidateRecord(
            project_id=project.id,
            source_type=StructureCandidateSourceType.REPORTED_FIGURE.value,
            source_evidence_id=evidence.id,
            source_document_id=doc.id,
            source_anchor_id=anchor.id,
            candidate_state=StructureCandidateState.DETECTED.value,
            provenance_class=ProvenanceClass.EXTRACTED.value,
            method=fig.extraction_method,
            method_version="1.0.0",
            approximation="REPORTED_UNVERIFIED",
            created_by=identity.user_id,
        )
        session.add(candidate)
        session.flush()

        representation = CandidateRepresentationRecord(
            project_id=project.id,
            candidate_id=candidate.id,
            representation_type=CandidateRepresentationType.IMAGE_REFERENCE.value,
            content_sha256=fig.image_sha256,
            representation_origin=CandidateRepresentationOrigin.SOURCE_REFERENCE.value,
            provenance_class=ProvenanceClass.EXTRACTED.value,
            method=fig.extraction_method,
            method_version="1.0.0",
            approximation="REPORTED_UNVERIFIED",
            payload_json={
                "storage_key": stored_fig.key,
                "image_sha256": fig.image_sha256,
                "pixel_width": fig.pixel_width,
                "pixel_height": fig.pixel_height,
                "figure_number": fig.figure_number,
                "page_number": fig.page_number,
                "bounding_box": [fig.x, fig.y, fig.width, fig.height],
            },
            validation_state=CandidateRepresentationValidationState.PREVIEWABLE.value,
            validation_diagnostics_json=[],
            created_by=identity.user_id,
        )
        session.add(representation)
        created_candidates.append(candidate)

    session.commit()
    return tuple(_candidate_view(session, c) for c in created_candidates)


def _owned_figure_bytes(
    object_store: ObjectStore, project_id: str, image_rep: CandidateRepresentationRecord
) -> bytes:
    """Read a candidate's stored figure, refusing any key outside the caller's project prefix."""
    storage_key = str((image_rep.payload_json or {}).get("storage_key", ""))
    if not storage_key.startswith(f"projects/{project_id}/") or ".." in storage_key:
        raise ScientificReferenceNotFound("Figure image reference missing for this candidate.")
    image_bytes = object_store.get_bytes(storage_key, 20 * 1024 * 1024)
    expected_sha = image_rep.content_sha256
    if expected_sha and hashlib.sha256(image_bytes).hexdigest() != expected_sha:
        raise ScientificValidationFailed("Stored figure image does not match its recorded SHA-256.")
    return image_bytes


def recognize_candidate_figure(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    object_store: ObjectStore,
    settings: Settings,
    engine_name: str | None = None,
    category_hint: str | None = None,
    *,
    skip_if_recognized: bool = False,
) -> tuple[StructureCandidate, MolecularRecognitionProposal]:
    """Execute molecular diagram recognition on an extracted figure candidate.

    With ``skip_if_recognized`` the persisted proposal of a concurrent identical request wins and
    this one is discarded (``_AlreadyRecognized``) instead of appending a duplicate.
    """
    project, member = authorize_project_access(session, identity, project_id)
    require_capability(member, ProjectCapability.WRITE)
    # Row lock serialises concurrent recognitions of one candidate on PostgreSQL (no-op on SQLite;
    # the unique (candidate, revision) constraint is the backstop, handled below).
    candidate = session.scalar(
        select(StructureCandidateRecord)
        .where(
            StructureCandidateRecord.id == candidate_id,
            StructureCandidateRecord.project_id == project.id,
        )
        .with_for_update()
    )
    if candidate is None:
        raise StructureCandidateNotFound("Structure candidate not found in project.")

    image_rep = session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.candidate_id == candidate.id,
            CandidateRepresentationRecord.project_id == project.id,
            CandidateRepresentationRecord.representation_type
            == CandidateRepresentationType.IMAGE_REFERENCE.value,
        )
    )
    if (
        image_rep is None
        or not image_rep.payload_json
        or "storage_key" not in image_rep.payload_json
    ):
        raise ScientificReferenceNotFound("Figure image reference missing for this candidate.")

    image_bytes = _owned_figure_bytes(object_store, project.id, image_rep)

    anchor = (
        session.get(DocumentSourceAnchorRecord, candidate.source_anchor_id)
        if candidate.source_anchor_id
        else None
    )
    anchor_box = (
        (anchor.x or 0.0, anchor.y or 0.0, anchor.width or 1.0, anchor.height or 1.0)
        if anchor
        else (0.0, 0.0, 1.0, 1.0)
    )
    meta = {
        "document_id": candidate.source_document_id,
        "page_number": anchor.page_number if anchor else 1,
        "figure_number": anchor.figure_number if anchor else None,
        "anchor_id": anchor.id if anchor else None,
        "figure_region": anchor_box,
        "category": category_hint or "",
    }

    engine = resolve_recognition_engine(engine_name, settings)
    proposal = engine.recognize_diagram(image_bytes, metadata=meta)

    # Infrastructure failures are not scientific outcomes: report them, persist nothing.
    if proposal.status in (RecognitionStatus.ENGINE_ERROR,) or (
        proposal.status == RecognitionStatus.UNSUPPORTED
        and any("weights not installed" in w for w in proposal.validation_warnings)
    ):
        raise RecognitionEngineUnavailable(
            "Molecular recognition engine unavailable: "
            + "; ".join((*proposal.validation_warnings, *proposal.diagnostics))
        )

    if skip_if_recognized:
        session.expire_all()
        winner = _find_reusable_recognition(
            session,
            project.id,
            candidate.id,
            proposal.figure_sha256,
            proposal.recognition_engine,
            proposal.engine_version,
        )
        if winner is not None:
            raise _AlreadyRecognized(winner.id)

    max_revision = (
        session.scalar(
            select(func.max(CandidateRepresentationRecord.revision)).where(
                CandidateRepresentationRecord.candidate_id == candidate.id,
                CandidateRepresentationRecord.project_id == project.id,
            )
        )
        or 0
    )
    next_revision = max_revision + 1

    smiles_rep = CandidateRepresentationRecord(
        # Explicit id: the MOL_BLOCK below must record this proposal as its source, and column
        # defaults are only applied at flush (the link was silently None before).
        id=new_id(),
        project_id=project.id,
        candidate_id=candidate.id,
        representation_type=CandidateRepresentationType.SMILES.value,
        revision=next_revision,
        content_sha256=(
            hashlib.sha256(proposal.canonical_isomeric_smiles.encode()).hexdigest()
            if proposal.canonical_isomeric_smiles
            else None
        ),
        representation_origin=CandidateRepresentationOrigin.IMAGE_RECONSTRUCTION.value,
        provenance_class=ProvenanceClass.EXTRACTED.value,
        method=proposal.recognition_engine,
        method_version=proposal.engine_version,
        approximation="REPORTED_UNVERIFIED",
        payload_json=proposal.to_dict(),
        validation_state=(
            CandidateRepresentationValidationState.PARSEABLE.value
            if proposal.canonical_isomeric_smiles
            else CandidateRepresentationValidationState.INVALID.value
        ),
        validation_diagnostics_json=list(proposal.validation_warnings) + list(proposal.diagnostics),
        created_by=identity.user_id,
    )
    session.add(smiles_rep)

    if proposal.canonical_isomeric_smiles:
        with rdBase.BlockLogs():
            mol = Chem.MolFromSmiles(proposal.canonical_isomeric_smiles)
            if mol is not None:
                AllChem.Compute2DCoords(mol)
                mol_block = Chem.MolToMolBlock(mol)
                mol_rep = CandidateRepresentationRecord(
                    project_id=project.id,
                    candidate_id=candidate.id,
                    representation_type=CandidateRepresentationType.MOL_BLOCK.value,
                    revision=next_revision + 1,
                    content_sha256=hashlib.sha256(mol_block.encode()).hexdigest(),
                    representation_origin=CandidateRepresentationOrigin.IMAGE_RECONSTRUCTION.value,
                    provenance_class=ProvenanceClass.EXTRACTED.value,
                    method=proposal.recognition_engine,
                    method_version=proposal.engine_version,
                    approximation="REPORTED_UNVERIFIED",
                    payload_json={"mol_block": mol_block, "formula": proposal.formula},
                    validation_state=CandidateRepresentationValidationState.PREVIEWABLE.value,
                    validation_diagnostics_json=list(proposal.validation_warnings),
                    source_representation_id=smiles_rep.id,
                    created_by=identity.user_id,
                )
                session.add(mol_rep)

    candidate.method = proposal.recognition_engine
    candidate.method_version = proposal.engine_version
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise CandidateStateConflict("CANDIDATE_RECOGNITION_CONFLICT") from error
    session.refresh(candidate)

    return _candidate_view(session, candidate), proposal


class _AlreadyRecognized(Exception):
    """Another worker persisted the same proposal while this inference was running."""

    def __init__(self, representation_id: str) -> None:
        self.representation_id = representation_id


@dataclass(frozen=True, slots=True)
class RecognitionOutcome:
    """Result of an idempotent autonomous recognition request."""

    candidate: StructureCandidate
    proposal: dict
    representation_id: str | None
    reused: bool


def _find_reusable_recognition(
    session: Session,
    project_id: str,
    candidate_id: str,
    figure_sha256: str,
    engine_name: str,
    engine_version: str,
) -> CandidateRepresentationRecord | None:
    """Return a prior raw DECIMER proposal for exactly this figure, engine and engine revision.

    Researcher-authored or corrected SMILES, development-engine output, proposals for different
    figure bytes and proposals from another engine revision are never reused: they are not the
    recognition of this figure by this engine and must not be reported as such.
    """
    rows = session.scalars(
        select(CandidateRepresentationRecord)
        .where(
            CandidateRepresentationRecord.candidate_id == candidate_id,
            CandidateRepresentationRecord.project_id == project_id,
            CandidateRepresentationRecord.representation_type
            == CandidateRepresentationType.SMILES.value,
            CandidateRepresentationRecord.representation_origin
            == CandidateRepresentationOrigin.IMAGE_RECONSTRUCTION.value,
        )
        .order_by(CandidateRepresentationRecord.revision.desc())
    ).all()
    for row in rows:
        payload = row.payload_json or {}
        if (
            payload.get("recognition_engine") == engine_name
            and payload.get("engine_version") == engine_version
            and payload.get("figure_sha256") == figure_sha256
            and row.method == engine_name
            and payload.get("status") != RecognitionStatus.ENGINE_ERROR.value
        ):
            return row
    return None


def recognize_candidate_figure_once(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    object_store: ObjectStore,
    settings: Settings,
    category_hint: str | None = None,
) -> RecognitionOutcome:
    """Autonomous recognition with real DECIMER only; never repeats an identical inference.

    The candidate row is locked (PostgreSQL) before the reuse check, so a concurrent or replayed
    request observes the first request's committed proposal instead of running DECIMER again.
    The immutable original proposal is only ever appended to, never replaced.
    """
    project, member = authorize_project_access(session, identity, project_id)
    require_capability(member, ProjectCapability.WRITE)
    candidate = session.scalar(
        select(StructureCandidateRecord)
        .where(
            StructureCandidateRecord.id == candidate_id,
            StructureCandidateRecord.project_id == project.id,
        )
        .with_for_update()
    )
    if candidate is None:
        raise StructureCandidateNotFound("Structure candidate not found in project.")
    image_rep = session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.candidate_id == candidate.id,
            CandidateRepresentationRecord.project_id == project.id,
            CandidateRepresentationRecord.representation_type
            == CandidateRepresentationType.IMAGE_REFERENCE.value,
        )
    )
    if (
        image_rep is None
        or not image_rep.payload_json
        or "storage_key" not in image_rep.payload_json
    ):
        raise ScientificReferenceNotFound("Figure image reference missing for this candidate.")
    figure_sha256 = hashlib.sha256(
        _owned_figure_bytes(object_store, project.id, image_rep)
    ).hexdigest()
    reusable = _find_reusable_recognition(
        session,
        project.id,
        candidate.id,
        figure_sha256,
        DecimerSubprocessEngine.engine_name,
        DecimerSubprocessEngine.engine_version,
    )
    if reusable is not None:
        return RecognitionOutcome(
            candidate=_candidate_view(session, candidate),
            proposal=dict(reusable.payload_json or {}),
            representation_id=reusable.id,
            reused=True,
        )
    try:
        view, proposal = recognize_candidate_figure(
            session,
            identity,
            project_id,
            candidate_id,
            object_store,
            settings,
            engine_name="decimer",
            category_hint=category_hint,
            skip_if_recognized=True,
        )
    except _AlreadyRecognized as won:
        winner = session.get(CandidateRepresentationRecord, won.representation_id)
        return RecognitionOutcome(
            candidate=_candidate_view(session, candidate),
            proposal=dict(winner.payload_json or {}),
            representation_id=winner.id,
            reused=True,
        )
    created = _find_reusable_recognition(
        session,
        project.id,
        candidate.id,
        figure_sha256,
        DecimerSubprocessEngine.engine_name,
        DecimerSubprocessEngine.engine_version,
    )
    return RecognitionOutcome(
        candidate=view,
        proposal=proposal.to_dict(),
        representation_id=created.id if created is not None else None,
        reused=False,
    )


def get_candidate_figure_image(
    session: Session,
    identity: Identity,
    project_id: str,
    candidate_id: str,
    object_store: ObjectStore,
) -> tuple[bytes, str]:
    """Retrieve original extracted figure image bytes for a candidate with tenant authorization."""
    project, _member = authorize_project_access(session, identity, project_id)
    candidate = session.scalar(
        select(StructureCandidateRecord).where(
            StructureCandidateRecord.id == candidate_id,
            StructureCandidateRecord.project_id == project.id,
        )
    )
    if candidate is None:
        raise StructureCandidateNotFound("Structure candidate not found in project.")

    image_rep = session.scalar(
        select(CandidateRepresentationRecord).where(
            CandidateRepresentationRecord.candidate_id == candidate.id,
            CandidateRepresentationRecord.project_id == project.id,
            CandidateRepresentationRecord.representation_type
            == CandidateRepresentationType.IMAGE_REFERENCE.value,
        )
    )
    if (
        image_rep is None
        or not image_rep.payload_json
        or "storage_key" not in image_rep.payload_json
    ):
        raise ScientificReferenceNotFound("Figure image reference missing for this candidate.")

    return _owned_figure_bytes(object_store, project.id, image_rep), "image/png"
