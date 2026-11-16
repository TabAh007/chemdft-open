from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, ForeignKeyConstraint, String, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import new_id, utc_now


class ScientificArtifactRecord(Base):
    __tablename__ = "scientific_artifacts"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("project_id", "storage_key"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(40))
    media_type: Mapped[str] = mapped_column(String(160))
    format_identifier: Mapped[str] = mapped_column(String(120))
    format_version: Mapped[str | None] = mapped_column(String(64))
    size_bytes: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_key: Mapped[str] = mapped_column(String(500))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    source_relation_type: Mapped[str | None] = mapped_column(String(120))
    source_relation_id: Mapped[str | None] = mapped_column(String(36))
    compression: Mapped[str | None] = mapped_column(String(32))
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    extensions_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)


class ScientificDocumentRecord(Base):
    __tablename__ = "scientific_documents"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("project_id", "raw_artifact_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    raw_artifact_id: Mapped[str] = mapped_column(String(36))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    media_type: Mapped[str] = mapped_column(String(160))
    title: Mapped[str | None] = mapped_column(String(500))
    doi: Mapped[str | None] = mapped_column(String(240))
    authors_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    journal: Mapped[str | None] = mapped_column(String(240))
    publication_year: Mapped[int | None]
    language: Mapped[str | None] = mapped_column(String(32))
    page_count: Mapped[int] = mapped_column(default=0)
    document_type: Mapped[str] = mapped_column(String(64), default="SCIENTIFIC_ARTICLE")
    parser_identifier: Mapped[str] = mapped_column(String(160))
    parser_version: Mapped[str] = mapped_column(String(64))
    text_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    diagnostics_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class DocumentSourceAnchorRecord(Base):
    __tablename__ = "document_source_anchors"
    __table_args__ = (UniqueConstraint("id", "project_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[str] = mapped_column(String(36), index=True)
    page_number: Mapped[int] = mapped_column()
    source_type: Mapped[str] = mapped_column(String(24))
    x: Mapped[float | None]
    y: Mapped[float | None]
    width: Mapped[float | None]
    height: Mapped[float | None]
    caption: Mapped[str | None] = mapped_column(String(1000))
    figure_number: Mapped[str | None] = mapped_column(String(80))
    table_number: Mapped[str | None] = mapped_column(String(80))
    snippet: Mapped[str | None] = mapped_column(String(4000))


class EvidenceCandidateRecord(Base):
    __tablename__ = "evidence_candidates"
    __table_args__ = (UniqueConstraint("id", "project_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[str] = mapped_column(String(36), index=True)
    evidence_type: Mapped[str] = mapped_column(String(80))
    source_class: Mapped[str] = mapped_column(String(32))
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    anchor_id: Mapped[str | None] = mapped_column(String(36))
    extraction_method: Mapped[str] = mapped_column(String(160))
    extractor_version: Mapped[str] = mapped_column(String(64))
    diagnostics_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    review_state: Mapped[str] = mapped_column(String(24), default="DETECTED")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class EvidenceReviewRecord(Base):
    __tablename__ = "evidence_reviews"
    __table_args__ = (UniqueConstraint("candidate_id", "project_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    candidate_id: Mapped[str] = mapped_column(String(36), index=True)
    decision: Mapped[str] = mapped_column(String(24))
    normalized_payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    reason: Mapped[str | None] = mapped_column(String(500))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class ExperimentRecord(Base):
    __tablename__ = "experiments"
    __table_args__ = (UniqueConstraint("id", "project_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    modality: Mapped[str] = mapped_column(String(24), index=True)
    sample_id: Mapped[str | None] = mapped_column(String(36))
    instrument_reference: Mapped[str | None] = mapped_column(String(256))
    conditions_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    operator_or_source: Mapped[str | None] = mapped_column(String(256))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class ExperimentalDatasetRecord(Base):
    __tablename__ = "experimental_datasets"
    __table_args__ = (UniqueConstraint("id", "project_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    experiment_id: Mapped[str] = mapped_column(String(36), index=True)
    state: Mapped[str] = mapped_column(String(24))
    artifact_id: Mapped[str] = mapped_column(String(36))
    source_class: Mapped[str] = mapped_column(String(32))
    axes_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    values_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    point_count: Mapped[int]
    processing_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    # Matches `ExperimentalDataset.input_dataset_ids`: the parents of a derived dataset.
    input_dataset_ids_json: Mapped[list[str] | None] = mapped_column(JSON, default=None)
    # Spectrum contract (units, evidence, source, parser, metadata, transform). NOT NULL = spectrum
    # dataset, which is immutable once written (see `_reject_spectrum_mutation`).
    spectrum_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class ProvenanceRecordRow(Base):
    __tablename__ = "provenance_records"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(
            ["source_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        ForeignKeyConstraint(
            ["supersedes_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    subject_type: Mapped[str] = mapped_column(String(120))
    subject_id: Mapped[str] = mapped_column(String(36), index=True)
    source_class: Mapped[str] = mapped_column(String(32))
    detail: Mapped[str] = mapped_column(String(48))
    verification_state: Mapped[str] = mapped_column(String(32))
    producer_kind: Mapped[str] = mapped_column(String(24))
    producer_identifier: Mapped[str] = mapped_column(String(160))
    producer_software_version: Mapped[str | None] = mapped_column(String(64))
    source_artifact_id: Mapped[str | None] = mapped_column(String(36))
    operation: Mapped[str] = mapped_column(String(160))
    operation_version: Mapped[str] = mapped_column(String(64))
    parameters_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    approximate: Mapped[bool] = mapped_column(default=False)
    supersedes_id: Mapped[str | None] = mapped_column(String(36))
    correlation_id: Mapped[str] = mapped_column(String(36), index=True)
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class ProvenanceInputRow(Base):
    __tablename__ = "provenance_inputs"
    __table_args__ = (
        UniqueConstraint("provenance_record_id", "position"),
        ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
            ondelete="CASCADE",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    provenance_record_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    position: Mapped[int]
    input_type: Mapped[str] = mapped_column(String(24))
    input_id: Mapped[str] = mapped_column(String(36))
    input_sha256: Mapped[str | None] = mapped_column(String(64))


class CalculationRecord(Base):
    __tablename__ = "calculations"
    __table_args__ = (UniqueConstraint("id", "project_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    state: Mapped[str] = mapped_column(String(24), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(200), default=lambda: f"legacy:{new_id()}")
    request_hash: Mapped[str] = mapped_column(String(64), default=lambda: "0" * 64)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class CalculationAttemptRecord(Base):
    __tablename__ = "calculation_attempts"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("calculation_id", "attempt_number"),
        ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
            ondelete="CASCADE",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    calculation_id: Mapped[str] = mapped_column(String(36), index=True)
    attempt_number: Mapped[int]
    state: Mapped[str] = mapped_column(String(24), index=True)
    worker_id: Mapped[str] = mapped_column(String(160))
    engine_identity_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    failure_code: Mapped[str | None] = mapped_column(String(64))
    diagnostic: Mapped[str | None] = mapped_column(String(1000))
    raw_artifacts_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)


class OptimizationTrajectoryRecord(Base):
    __tablename__ = "optimization_trajectories"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("calculation_id"),
        ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
            ondelete="CASCADE",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    calculation_id: Mapped[str] = mapped_column(String(36), index=True)
    input_structure_version_id: Mapped[str] = mapped_column(String(36))
    atom_identities_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    steps_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    state: Mapped[str] = mapped_column(String(24))
    artifact_id: Mapped[str | None] = mapped_column(String(36))
    artifact_sha256: Mapped[str | None] = mapped_column(String(64))
    final_structure_version_id: Mapped[str | None] = mapped_column(String(36))
    engine_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    input_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class StructureRecord(Base):
    __tablename__ = "structures"
    __table_args__ = (UniqueConstraint("id", "project_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(24), index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class StructureVersionRecord(Base):
    __tablename__ = "structure_versions"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("structure_id", "revision"),
        UniqueConstraint("project_id", "idempotency_key"),
        ForeignKeyConstraint(
            ["structure_id", "project_id"],
            ["structures.id", "structures.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["parent_version_id", "project_id"],
            ["structure_versions.id", "structure_versions.project_id"],
        ),
        ForeignKeyConstraint(
            ["canonical_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        ForeignKeyConstraint(
            ["source_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    structure_id: Mapped[str] = mapped_column(String(36), index=True)
    revision: Mapped[int]
    origin: Mapped[str] = mapped_column(String(32))
    parent_version_id: Mapped[str | None] = mapped_column(String(36))
    canonical_artifact_id: Mapped[str] = mapped_column(String(36))
    source_artifact_id: Mapped[str] = mapped_column(String(36))
    coordinate_system: Mapped[str] = mapped_column(String(24))
    coordinate_unit: Mapped[str] = mapped_column(String(24))
    atom_count: Mapped[int]
    bond_count: Mapped[int]
    overall_charge: Mapped[int]
    multiplicity: Mapped[int]
    representation_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    periodic_cell_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    diagnostics_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    provenance_record_id: Mapped[str] = mapped_column(String(36))
    idempotency_key: Mapped[str] = mapped_column(String(200))
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class StructureCandidateRecord(Base):
    __tablename__ = "structure_candidates"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("project_id", "source_evidence_id", "source_type"),
        ForeignKeyConstraint(
            ["source_evidence_id", "project_id"],
            ["evidence_candidates.id", "evidence_candidates.project_id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["source_document_id", "project_id"],
            ["scientific_documents.id", "scientific_documents.project_id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["source_anchor_id", "project_id"],
            ["document_source_anchors.id", "document_source_anchors.project_id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["promoted_structure_version_id", "project_id"],
            ["structure_versions.id", "structure_versions.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    source_type: Mapped[str] = mapped_column(String(48))
    source_evidence_id: Mapped[str] = mapped_column(String(36), index=True)
    source_document_id: Mapped[str] = mapped_column(String(36), index=True)
    source_anchor_id: Mapped[str | None] = mapped_column(String(36))
    candidate_state: Mapped[str] = mapped_column(String(24), index=True)
    provenance_class: Mapped[str] = mapped_column(String(32))
    method: Mapped[str] = mapped_column(String(160))
    method_version: Mapped[str] = mapped_column(String(64))
    approximation: Mapped[str] = mapped_column(String(80))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None]
    promoted_structure_version_id: Mapped[str | None] = mapped_column(String(36))


class CandidateRepresentationRecord(Base):
    __tablename__ = "candidate_representations"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("candidate_id", "project_id", "revision"),
        ForeignKeyConstraint(
            ["candidate_id", "project_id"],
            ["structure_candidates.id", "structure_candidates.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["source_representation_id", "project_id"],
            ["candidate_representations.id", "candidate_representations.project_id"],
            ondelete="RESTRICT",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    candidate_id: Mapped[str] = mapped_column(String(36), index=True)
    representation_type: Mapped[str] = mapped_column(String(32))
    revision: Mapped[int] = mapped_column(default=1)
    content_sha256: Mapped[str | None] = mapped_column(String(64), index=True)
    representation_origin: Mapped[str] = mapped_column(String(32), default="USER_DRAFT")
    provenance_class: Mapped[str] = mapped_column(String(32))
    method: Mapped[str] = mapped_column(String(160))
    method_version: Mapped[str] = mapped_column(String(64))
    approximation: Mapped[str] = mapped_column(String(80))
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    validation_state: Mapped[str] = mapped_column(String(24), default="PARSEABLE")
    validation_diagnostics_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    generation_parameters_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    coordinate_unit: Mapped[str | None] = mapped_column(String(24))
    coordinate_provenance_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    cell_provenance_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    source_representation_id: Mapped[str | None] = mapped_column(String(36), index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class CandidateRepresentationReviewRecord(Base):
    __tablename__ = "candidate_representation_reviews"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(
            ["candidate_id", "project_id"],
            ["structure_candidates.id", "structure_candidates.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["representation_id", "project_id"],
            ["candidate_representations.id", "candidate_representations.project_id"],
            ondelete="CASCADE",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    candidate_id: Mapped[str] = mapped_column(String(36), index=True)
    representation_id: Mapped[str] = mapped_column(String(36), index=True)
    decision: Mapped[str] = mapped_column(String(24))
    notes: Mapped[str | None] = mapped_column(String(500))
    checklist_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class StructureCandidateReviewRecord(Base):
    __tablename__ = "structure_candidate_reviews"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(
            ["candidate_id", "project_id"],
            ["structure_candidates.id", "structure_candidates.project_id"],
            ondelete="CASCADE",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    candidate_id: Mapped[str] = mapped_column(String(36), index=True)
    decision: Mapped[str] = mapped_column(String(24))
    notes: Mapped[str | None] = mapped_column(String(500))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class CalculationInputRecord(Base):
    __tablename__ = "calculation_inputs"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["normalized_input_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    calculation_id: Mapped[str] = mapped_column(String(36), unique=True)
    structure_version_id: Mapped[str] = mapped_column(String(36), index=True)
    conformer_id: Mapped[str | None] = mapped_column(String(36))
    specification_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    normalized_input_artifact_id: Mapped[str] = mapped_column(String(36))
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class CalculationResultRecord(Base):
    __tablename__ = "calculation_results"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("project_id", "idempotency_key"),
        ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
        ),
        ForeignKeyConstraint(
            ["calculation_input_id", "project_id"],
            ["calculation_inputs.id", "calculation_inputs.project_id"],
        ),
        ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    calculation_id: Mapped[str] = mapped_column(String(36), index=True)
    calculation_input_id: Mapped[str] = mapped_column(String(36))
    result_type: Mapped[str] = mapped_column(String(160))
    authority: Mapped[str] = mapped_column(String(24))
    source_class: Mapped[str] = mapped_column(String(24))
    verification_state: Mapped[str] = mapped_column(String(24))
    validation_state: Mapped[str] = mapped_column(String(24))
    trusted_producer_id: Mapped[str] = mapped_column(String(160))
    trusted_producer_type: Mapped[str] = mapped_column(String(64))
    producer_attestation_id: Mapped[str] = mapped_column(String(160))
    producer_software_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    provenance_record_id: Mapped[str] = mapped_column(String(36))
    raw_artifacts_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    idempotency_key: Mapped[str] = mapped_column(String(200))
    request_id: Mapped[str] = mapped_column(String(36), index=True)
    correlation_id: Mapped[str] = mapped_column(String(36), index=True)
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class ComputeEstimateRecord(Base):
    __tablename__ = "compute_estimates"
    __table_args__ = (UniqueConstraint("id", "project_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    requirement_hash: Mapped[str] = mapped_column(String(64), index=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    provider_summary: Mapped[str] = mapped_column(String(160))
    runtime_low_seconds: Mapped[int | None]
    runtime_high_seconds: Mapped[int | None]
    cost_low_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    cost_high_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    confidence: Mapped[str] = mapped_column(String(16))
    assumptions_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    valid_until: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class ComputeReservationRecord(Base):
    __tablename__ = "compute_reservations"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(
            ["estimate_id", "project_id"],
            ["compute_estimates.id", "compute_estimates.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    estimate_id: Mapped[str] = mapped_column(String(36), index=True)
    authorized_max_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    actual_cost_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(24), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    reconciled_at: Mapped[datetime | None]


class ComputeJobRecord(Base):
    __tablename__ = "compute_jobs"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("calculation_id"),
        UniqueConstraint("idempotency_key"),
        ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["calculation_input_id", "project_id"],
            ["calculation_inputs.id", "calculation_inputs.project_id"],
        ),
        ForeignKeyConstraint(
            ["estimate_id", "project_id"],
            ["compute_estimates.id", "compute_estimates.project_id"],
        ),
        ForeignKeyConstraint(
            ["reservation_id", "project_id"],
            ["compute_reservations.id", "compute_reservations.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    calculation_id: Mapped[str] = mapped_column(String(36), index=True)
    calculation_input_id: Mapped[str] = mapped_column(String(36), index=True)
    workload_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    requirement_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    requirement_hash: Mapped[str] = mapped_column(String(64), index=True)
    state: Mapped[str] = mapped_column(String(24), index=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    priority: Mapped[int] = mapped_column(default=0)
    idempotency_key: Mapped[str] = mapped_column(String(200), index=True)
    estimate_id: Mapped[str] = mapped_column(String(36))
    reservation_id: Mapped[str] = mapped_column(String(36))
    submitted_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    retry_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class ComputeExecutionRecord(Base):
    __tablename__ = "compute_executions"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("provider", "provider_execution_ref"),
        ForeignKeyConstraint(
            ["job_id", "project_id"],
            ["compute_jobs.id", "compute_jobs.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["calculation_id", "project_id"],
            ["calculations.id", "calculations.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    job_id: Mapped[str] = mapped_column(String(36), index=True)
    calculation_id: Mapped[str] = mapped_column(String(36), index=True)
    calculation_attempt_id: Mapped[str | None] = mapped_column(String(36), index=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    provider_execution_ref: Mapped[str | None] = mapped_column(String(500))
    state: Mapped[str] = mapped_column(String(24), index=True)
    worker_id: Mapped[str | None] = mapped_column(String(160))
    lease_owner: Mapped[str | None] = mapped_column(String(160))
    authorization_hash: Mapped[str] = mapped_column(String(64), index=True)
    authorization_expires_at: Mapped[datetime]
    started_at: Mapped[datetime | None]
    heartbeat_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    environment_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    hardware_class: Mapped[str | None] = mapped_column(String(160))
    metering_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    actual_cost_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    raw_artifacts_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    failure_code: Mapped[str | None] = mapped_column(String(64))
    diagnostic: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)


class ComputeLeaseRecord(Base):
    __tablename__ = "compute_leases"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("lease_token_hash"),
        ForeignKeyConstraint(
            ["job_id", "project_id"],
            ["compute_jobs.id", "compute_jobs.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["execution_id", "project_id"],
            ["compute_executions.id", "compute_executions.project_id"],
            ondelete="CASCADE",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    job_id: Mapped[str] = mapped_column(String(36), index=True)
    execution_id: Mapped[str] = mapped_column(String(36), index=True)
    owner: Mapped[str] = mapped_column(String(160), index=True)
    lease_token_hash: Mapped[str] = mapped_column(String(64), index=True)
    issued_at: Mapped[datetime] = mapped_column(default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(index=True)
    heartbeat_deadline_at: Mapped[datetime] = mapped_column(index=True)
    heartbeat_at: Mapped[datetime | None]
    state: Mapped[str] = mapped_column(String(24), index=True)


class AuditEventRecord(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    occurred_at: Mapped[datetime] = mapped_column(default=utc_now)
    event_name: Mapped[str] = mapped_column(String(160), index=True)
    actor_or_service_id: Mapped[str] = mapped_column(String(160))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"), index=True)
    request_id: Mapped[str] = mapped_column(String(36), index=True)
    tool_name: Mapped[str | None] = mapped_column(String(160))
    tool_version: Mapped[str | None] = mapped_column(String(32))
    targets_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    outcome: Mapped[str] = mapped_column(String(24))
    error_category: Mapped[str | None] = mapped_column(String(80))
    approval_reference: Mapped[str | None] = mapped_column(String(36))
    artifact_references_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    safe_metadata_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0.0")


class ToolInvocationRecordRow(Base):
    __tablename__ = "tool_invocations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    request_id: Mapped[str] = mapped_column(String(36), index=True)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    tool_name: Mapped[str] = mapped_column(String(160), index=True)
    tool_version: Mapped[str] = mapped_column(String(32))
    transport: Mapped[str] = mapped_column(String(24))
    input_fingerprint: Mapped[str] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(24))
    error_code: Mapped[str | None] = mapped_column(String(64))
    result_reference: Mapped[str | None] = mapped_column(String(500))
    invoked_at: Mapped[datetime] = mapped_column(default=utc_now)


class ExternalImportRecord(Base):
    """Immutable record of an uploaded external output and its hash-bound preview (no results)."""

    __tablename__ = "external_imports"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("project_id", "idempotency_key"),
        ForeignKeyConstraint(
            ["raw_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
        ForeignKeyConstraint(
            ["preview_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(200))
    state: Mapped[str] = mapped_column(String(24), index=True)  # PREVIEW_READY | REJECTED
    raw_artifact_id: Mapped[str | None] = mapped_column(String(36))
    preview_artifact_id: Mapped[str | None] = mapped_column(String(36))
    source_filename: Mapped[str] = mapped_column(String(160))
    source_sha256: Mapped[str] = mapped_column(String(64), index=True)
    source_size_bytes: Mapped[int]
    media_class: Mapped[str] = mapped_column(String(64))
    engine: Mapped[str | None] = mapped_column(String(24))
    program_label: Mapped[str | None] = mapped_column(String(80))
    job_type: Mapped[str | None] = mapped_column(String(80))
    method_value: Mapped[str | None] = mapped_column(String(200))
    basis_value: Mapped[str | None] = mapped_column(String(200))
    preview_sha256: Mapped[str] = mapped_column(String(64), index=True)
    importer_version: Mapped[str] = mapped_column(String(64))
    normalization_version: Mapped[str] = mapped_column(String(64))
    parser_commit: Mapped[str] = mapped_column(String(40))
    parse_timestamp: Mapped[datetime] = mapped_column(default=utc_now)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0.0")


class ExternalImportConfirmationRecord(Base):
    """Confirmation of one exact preview hash; its existence makes an import IMPORTED."""

    __tablename__ = "external_import_confirmations"
    __table_args__ = (
        UniqueConstraint("import_id"),
        UniqueConstraint("project_id", "idempotency_key"),
        ForeignKeyConstraint(
            ["import_id", "project_id"],
            ["external_imports.id", "external_imports.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    import_id: Mapped[str] = mapped_column(String(36))
    preview_sha256: Mapped[str] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(200))
    confirmed_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime] = mapped_column(default=utc_now)


class ExternalImportJobRecord(Base):
    __tablename__ = "external_import_jobs"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("import_id", "job_index"),
        ForeignKeyConstraint(
            ["import_id", "project_id"],
            ["external_imports.id", "external_imports.project_id"],
        ),
        ForeignKeyConstraint(
            ["structure_version_id", "project_id"],
            ["structure_versions.id", "structure_versions.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    import_id: Mapped[str] = mapped_column(String(36), index=True)
    job_index: Mapped[int]
    line_start: Mapped[int]
    line_end: Mapped[int]
    source_job_type: Mapped[str] = mapped_column(String(80))
    method_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    basis_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    charge: Mapped[int]
    multiplicity: Mapped[int]
    termination_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    convergence_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    structure_id: Mapped[str] = mapped_column(String(36))
    structure_version_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class ImportedResultRecord(Base):
    """Provider-neutral imported result; separate from `calculation_results` (never CALCULATED)."""

    __tablename__ = "imported_results"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("project_id", "idempotency_key"),
        ForeignKeyConstraint(
            ["import_id", "project_id"],
            ["external_imports.id", "external_imports.project_id"],
        ),
        ForeignKeyConstraint(
            ["import_job_id", "project_id"],
            ["external_import_jobs.id", "external_import_jobs.project_id"],
        ),
        ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    import_id: Mapped[str] = mapped_column(String(36), index=True)
    import_job_id: Mapped[str] = mapped_column(String(36), index=True)
    result_type: Mapped[str] = mapped_column(String(160), index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    payload_sha256: Mapped[str] = mapped_column(String(64))
    source_class: Mapped[str] = mapped_column(String(24))
    authority: Mapped[str] = mapped_column(String(24))
    verification_state: Mapped[str] = mapped_column(String(24))
    validation_state: Mapped[str] = mapped_column(String(24))
    producer_type: Mapped[str] = mapped_column(String(64))
    producer_id: Mapped[str] = mapped_column(String(160))
    producer_attestation_id: Mapped[str] = mapped_column(String(160))
    provenance_record_id: Mapped[str] = mapped_column(String(36))
    source_attributes_json: Mapped[list[str]] = mapped_column(JSON)
    source_locators_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    normalization_version: Mapped[str] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(200))
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class SpectrumUploadRecord(Base):
    """One uploaded spectrum file. The raw bytes are an immutable artifact, not a record."""

    __tablename__ = "experimental_spectrum_uploads"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("project_id", "idempotency_key"),
        ForeignKeyConstraint(
            ["raw_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(200))
    technique: Mapped[str] = mapped_column(String(8), index=True)
    raw_artifact_id: Mapped[str | None] = mapped_column(String(36))
    source_filename: Mapped[str] = mapped_column(String(160))
    source_sha256: Mapped[str] = mapped_column(String(64), index=True)
    source_size_bytes: Mapped[int]
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class SpectrumPreviewRecord(Base):
    """One resolved preview (source, technique, the user's choices); nothing authoritative."""

    __tablename__ = "experimental_spectrum_previews"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("upload_id", "preview_sha256"),
        ForeignKeyConstraint(
            ["upload_id", "project_id"],
            ["experimental_spectrum_uploads.id", "experimental_spectrum_uploads.project_id"],
        ),
        ForeignKeyConstraint(
            ["preview_artifact_id", "project_id"],
            ["scientific_artifacts.id", "scientific_artifacts.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    upload_id: Mapped[str] = mapped_column(String(36), index=True)
    preview_sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(24))  # READY | NEEDS_CONFIRMATION | REJECTED
    preview_artifact_id: Mapped[str] = mapped_column(String(36))
    choices_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    worker_version: Mapped[str] = mapped_column(String(64))
    parser_version: Mapped[str] = mapped_column(String(32))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class SpectrumConfirmationRecord(Base):
    """Confirmation of one exact preview hash; it makes the upload IMPORTED (single use)."""

    __tablename__ = "experimental_spectrum_confirmations"
    __table_args__ = (
        UniqueConstraint("upload_id"),
        UniqueConstraint("preview_id"),
        UniqueConstraint("project_id", "idempotency_key"),
        ForeignKeyConstraint(
            ["upload_id", "project_id"],
            ["experimental_spectrum_uploads.id", "experimental_spectrum_uploads.project_id"],
        ),
        ForeignKeyConstraint(
            ["preview_id", "project_id"],
            ["experimental_spectrum_previews.id", "experimental_spectrum_previews.project_id"],
        ),
        ForeignKeyConstraint(
            ["dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    upload_id: Mapped[str] = mapped_column(String(36))
    preview_id: Mapped[str] = mapped_column(String(36))
    preview_sha256: Mapped[str] = mapped_column(String(64))
    dataset_id: Mapped[str] = mapped_column(String(36), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(200))
    confirmed_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime] = mapped_column(default=utc_now)


class SpectrumAssociationRecord(Base):
    """Append-only association history; the newest row is current, no row means UNASSIGNED."""

    __tablename__ = "experimental_spectrum_associations"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(
            ["dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    dataset_id: Mapped[str] = mapped_column(String(36), index=True)
    state: Mapped[str] = mapped_column(String(32))
    structure_id: Mapped[str | None] = mapped_column(String(36), index=True)
    sample_label: Mapped[str | None] = mapped_column(String(160))
    note: Mapped[str | None] = mapped_column(String(1000))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class SpectrumOperationRecord(Base):
    """Idempotency + lineage index of transform and peak requests (one row per derived dataset)."""

    __tablename__ = "experimental_spectrum_operations"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("project_id", "idempotency_key"),
        ForeignKeyConstraint(
            ["parent_dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
        ForeignKeyConstraint(
            ["dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(200))
    request_sha256: Mapped[str] = mapped_column(String(64))
    parent_dataset_id: Mapped[str] = mapped_column(String(36), index=True)
    dataset_id: Mapped[str] = mapped_column(String(36), index=True)
    op: Mapped[str] = mapped_column(String(60))
    record_sha256: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class SpectrumComparisonRecord(Base):
    """A persisted calculated/imported <-> experimental comparison (a transform, never a result)."""

    __tablename__ = "experimental_spectrum_comparisons"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        UniqueConstraint("project_id", "idempotency_key"),
        ForeignKeyConstraint(
            ["experimental_dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
        ForeignKeyConstraint(
            ["peak_set_dataset_id", "project_id"],
            ["experimental_datasets.id", "experimental_datasets.project_id"],
        ),
        ForeignKeyConstraint(
            ["provenance_record_id", "project_id"],
            ["provenance_records.id", "provenance_records.project_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(200))
    request_sha256: Mapped[str] = mapped_column(String(64))
    technique: Mapped[str] = mapped_column(String(8), index=True)
    experimental_dataset_id: Mapped[str] = mapped_column(String(36), index=True)
    peak_set_dataset_id: Mapped[str] = mapped_column(String(36))
    source_kind: Mapped[str] = mapped_column(String(24))
    source_id: Mapped[str] = mapped_column(String(36), index=True)
    params_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    record_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    record_sha256: Mapped[str] = mapped_column(String(64))
    worker_version: Mapped[str] = mapped_column(String(64))
    provenance_record_id: Mapped[str] = mapped_column(String(36))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


def _reject_mutation(_mapper: object, _connection: object, target: object) -> None:
    raise ValueError(f"{type(target).__name__} is append-only")


for append_only_type in (
    ScientificArtifactRecord,
    ProvenanceRecordRow,
    ProvenanceInputRow,
    CalculationInputRecord,
    CalculationAttemptRecord,
    StructureVersionRecord,
    CandidateRepresentationRecord,
    CandidateRepresentationReviewRecord,
    StructureCandidateReviewRecord,
    CalculationResultRecord,
    ComputeEstimateRecord,
    AuditEventRecord,
    ToolInvocationRecordRow,
    ExternalImportRecord,
    ExternalImportConfirmationRecord,
    ExternalImportJobRecord,
    ImportedResultRecord,
    SpectrumUploadRecord,
    SpectrumPreviewRecord,
    SpectrumConfirmationRecord,
    SpectrumAssociationRecord,
    SpectrumOperationRecord,
    SpectrumComparisonRecord,
):
    event.listen(append_only_type, "before_update", _reject_mutation)
    event.listen(append_only_type, "before_delete", _reject_mutation)


def _reject_spectrum_mutation(_mapper: object, _connection: object, target: object) -> None:
    """Spectrum datasets are immutable. Legacy digitization still finishes a dataset after its
    first insert, so the guard applies only to rows that carry `spectrum_json`."""
    if getattr(target, "spectrum_json", None) is not None:
        raise ValueError("Experimental spectrum datasets are append-only")


event.listen(ExperimentalDatasetRecord, "before_update", _reject_spectrum_mutation)
event.listen(ExperimentalDatasetRecord, "before_delete", _reject_spectrum_mutation)


class SavedComparisonRecord(Base):
    """RW-3: a named selection of project results plus a labelled snapshot of their standing.

    The row carries no scientific authority. Opening it recomputes every source's effective state
    and compares it with `snapshot_json`; the snapshot is historical context only. Rows are never
    deleted: archiving sets `archived_at`.
    """

    __tablename__ = "saved_comparisons"
    __table_args__ = (UniqueConstraint("id", "project_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(String(500))
    result_ids_json: Mapped[list[str]] = mapped_column(JSON)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    schema_version: Mapped[int] = mapped_column(default=1)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    archived_at: Mapped[datetime | None]
