# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .base import ArtifactReference, ContractModel, ContractVersion
from .provenance import ProvenanceClass
from .scientific import AxisDefinition, DatasetProcessingState, ExperimentModality


class DocumentSourceType(StrEnum):
    TEXT = "TEXT"
    TABLE = "TABLE"
    FIGURE = "FIGURE"
    REGION = "REGION"


class EvidenceReviewState(StrEnum):
    DETECTED = "DETECTED"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    SUPERSEDED = "SUPERSEDED"


class SourceAnchor(ContractModel):
    document_id: UUID
    page_number: int = Field(ge=1)
    source_type: DocumentSourceType
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    width: float | None = Field(default=None, ge=0, le=1)
    height: float | None = Field(default=None, ge=0, le=1)
    caption: Annotated[str, StringConstraints(max_length=1000)] | None = None
    figure_number: Annotated[str, StringConstraints(max_length=80)] | None = None
    table_number: Annotated[str, StringConstraints(max_length=80)] | None = None
    snippet: Annotated[str, StringConstraints(max_length=4000)] | None = None


class ScientificDocument(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    raw_artifact: ArtifactReference
    sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    media_type: str
    title: str | None = None
    doi: str | None = None
    authors: tuple[str, ...] = Field(default=(), max_length=128)
    journal: str | None = None
    publication_year: int | None = Field(default=None, ge=1000, le=3000)
    language: str | None = None
    page_count: int = Field(ge=0)
    document_type: str
    parser_identifier: str
    parser_version: str
    diagnostics: tuple[dict[str, str], ...] = Field(default=(), max_length=128)
    created_by: UUID
    created_at: datetime


class EvidenceCandidate(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    document_id: UUID
    evidence_type: str
    source_class: Literal["EXTRACTED", "DIGITIZED", "AI_HYPOTHESIS"]
    structured_payload: dict[str, object]
    source_anchor: SourceAnchor | None = None
    extraction_method: str
    extractor_version: str
    diagnostics: tuple[dict[str, str], ...] = Field(default=(), max_length=32)
    review_state: EvidenceReviewState
    created_at: datetime

    @model_validator(mode="after")
    def anchor_matches_document(self) -> EvidenceCandidate:
        if self.source_anchor and self.source_anchor.document_id != self.document_id:
            raise ValueError("Source anchor must refer to the candidate document")
        return self


class EvidenceReviewInput(ContractModel):
    decision: Literal["ACCEPTED", "REJECTED"]
    normalized_payload: dict[str, object] | None = None
    reason: Annotated[str, StringConstraints(max_length=500)] | None = None


class EvidenceReviewOutput(ContractModel):
    candidate: EvidenceCandidate
    source_class: ProvenanceClass
    verification_state: Literal["UNVERIFIED", "VERIFIED", "DISPUTED"]


class DigitizerPoint(ContractModel):
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)


class SourcePixelPoint(ContractModel):
    x: float = Field(ge=0, allow_inf_nan=False)
    y: float = Field(ge=0, allow_inf_nan=False)


class SourcePixelRegion(ContractModel):
    x: float = Field(ge=0, allow_inf_nan=False)
    y: float = Field(ge=0, allow_inf_nan=False)
    width: float = Field(gt=0, allow_inf_nan=False)
    height: float = Field(gt=0, allow_inf_nan=False)


class XrdAxisCalibration(ContractModel):
    pixel_a: SourcePixelPoint
    pixel_b: SourcePixelPoint
    value_a: float = Field(allow_inf_nan=False)
    value_b: float = Field(allow_inf_nan=False)
    label: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    unit: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    scale: Literal["linear"] = "linear"

    @model_validator(mode="after")
    def require_distinct_tick_values(self) -> XrdAxisCalibration:
        if self.pixel_a.x == self.pixel_b.x and self.pixel_a.y == self.pixel_b.y:
            raise ValueError("Axis calibration requires two distinct pixel locations.")
        if self.value_a == self.value_b:
            raise ValueError("Axis calibration requires two distinct tick values.")
        return self


class GraphAxisCalibration(ContractModel):
    pixel_a: SourcePixelPoint
    pixel_b: SourcePixelPoint
    value_a: float = Field(allow_inf_nan=False)
    value_b: float = Field(allow_inf_nan=False)
    label: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    unit: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    scale: Literal["linear", "log"] = "linear"

    @model_validator(mode="after")
    def validate_ticks(self) -> GraphAxisCalibration:
        if self.pixel_a.x == self.pixel_b.x and self.pixel_a.y == self.pixel_b.y:
            raise ValueError("Axis calibration requires two distinct pixel locations.")
        if self.value_a == self.value_b:
            raise ValueError("Axis calibration requires two distinct tick values.")
        if self.scale == "log" and (self.value_a <= 0 or self.value_b <= 0):
            raise ValueError("Log-axis calibration requires positive tick values.")
        return self


class GraphDigitizedPointInput(ContractModel):
    source_pixel: SourcePixelPoint


class GraphDigitizedPoint(ContractModel):
    point_order: int = Field(ge=0)
    source_pixel: SourcePixelPoint
    x_value: float = Field(allow_inf_nan=False)
    y_value: float = Field(allow_inf_nan=False)


class GraphDigitizationSession(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    session_id: UUID
    revision: int = Field(ge=1)
    state: Literal["COMMITTED"] = "COMMITTED"
    source_document_id: UUID
    source_artifact_id: UUID
    source_artifact_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    source_evidence_id: UUID
    page_number: int = Field(ge=1)
    figure_number: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    source_render_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    source_render_version: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    source_render_scale: float = Field(gt=0, allow_inf_nan=False)
    source_pixel_width: int = Field(gt=0, le=20_000)
    source_pixel_height: int = Field(gt=0, le=20_000)
    plot_region: SourcePixelRegion
    x_calibration: GraphAxisCalibration
    y_calibration: GraphAxisCalibration
    point_mode: Literal["CURVE_POINTS", "HISTOGRAM_POINTS"]
    points: tuple[GraphDigitizedPoint, ...] = Field(min_length=1, max_length=200_000)
    operator_id: UUID
    dataset_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    parent_dataset_id: UUID | None = None
    created_at: datetime


class GraphDigitizedDatasetInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    experiment_name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    source_document_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    source_render_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    source_render_version: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    source_render_scale: float = Field(gt=0, allow_inf_nan=False)
    source_pixel_width: int = Field(gt=0, le=20_000)
    source_pixel_height: int = Field(gt=0, le=20_000)
    plot_region: SourcePixelRegion
    x_calibration: GraphAxisCalibration
    y_calibration: GraphAxisCalibration
    point_mode: Literal["CURVE_POINTS", "HISTOGRAM_POINTS"] = "HISTOGRAM_POINTS"
    points: tuple[GraphDigitizedPointInput, ...] = Field(min_length=1, max_length=200_000)


class XrdDigitizedPointInput(ContractModel):
    source_pixel: SourcePixelPoint


class XrdDigitizedPoint(ContractModel):
    point_order: int = Field(ge=0)
    source_pixel: SourcePixelPoint
    two_theta_degree: float = Field(allow_inf_nan=False)
    intensity: float | None = Field(default=None, allow_inf_nan=False)


class XrdReportedPeak(ContractModel):
    evidence_id: UUID
    source_class: Literal["EXTRACTED"] = "EXTRACTED"
    page_number: int = Field(ge=1)
    two_theta_degree: float = Field(allow_inf_nan=False)
    unit: Literal["degree"] = "degree"


class XrdDigitizationSession(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    session_id: UUID
    revision: int = Field(ge=1)
    state: Literal["COMMITTED"] = "COMMITTED"
    source_document_id: UUID
    source_artifact_id: UUID
    source_artifact_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    source_evidence_id: UUID
    page_number: int = Field(ge=1)
    figure_number: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    source_render_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    source_render_version: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    source_render_scale: float = Field(gt=0, allow_inf_nan=False)
    source_pixel_width: int = Field(gt=0, le=20_000)
    source_pixel_height: int = Field(gt=0, le=20_000)
    plot_region: SourcePixelRegion
    x_calibration: XrdAxisCalibration
    y_calibration: XrdAxisCalibration | None = None
    y_unit_status: Literal["UNKNOWN", "ARBITRARY", "SOURCE_DEFINED"] = "UNKNOWN"
    point_mode: Literal["PEAK_PICKING", "CURVE_POINTS"]
    points: tuple[XrdDigitizedPoint, ...] = Field(min_length=1, max_length=200_000)
    reported_peaks: tuple[XrdReportedPeak, ...] = Field(default=(), max_length=1_000)
    operator_id: UUID
    user_action: Literal["MANUAL_PEAK_PICKING", "MANUAL_CURVE_POINTING"]
    dataset_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    parent_dataset_id: UUID | None = None
    created_at: datetime


class DigitizerCalibration(ContractModel):
    page: int = Field(ge=1)
    figure_region: SourceAnchor
    plot_bounds: dict[str, float]
    x_pixel_a: DigitizerPoint
    x_pixel_b: DigitizerPoint
    x_value_a: float
    x_value_b: float
    y_pixel_a: DigitizerPoint
    y_pixel_b: DigitizerPoint
    y_value_a: float
    y_value_b: float
    x_scale: Literal["linear", "log"] = "linear"
    y_scale: Literal["linear", "log"] = "linear"
    x_unit: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    y_unit: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    x_label: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    y_label: Annotated[str, StringConstraints(min_length=1, max_length=120)]


class DigitizedDatasetInput(ContractModel):
    modality: ExperimentModality
    experiment_name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    calibration: DigitizerCalibration
    points: tuple[DigitizerPoint, ...] = Field(min_length=1, max_length=200_000)


class XrdDigitizedDatasetInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    experiment_name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    source_document_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    source_render_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    source_render_version: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    source_render_scale: float = Field(gt=0, allow_inf_nan=False)
    source_pixel_width: int = Field(gt=0, le=20_000)
    source_pixel_height: int = Field(gt=0, le=20_000)
    plot_region: SourcePixelRegion
    x_calibration: XrdAxisCalibration
    y_calibration: XrdAxisCalibration | None = None
    y_unit_status: Literal["UNKNOWN", "ARBITRARY", "SOURCE_DEFINED"] = "UNKNOWN"
    point_mode: Literal["PEAK_PICKING", "CURVE_POINTS"]
    points: tuple[XrdDigitizedPointInput, ...] = Field(min_length=1, max_length=200_000)

    @model_validator(mode="after")
    def validate_y_unit_and_calibration(self) -> XrdDigitizedDatasetInput:
        if self.y_calibration is None and self.y_unit_status != "UNKNOWN":
            raise ValueError("An intensity unit status requires a calibrated Y axis.")
        if self.y_calibration is not None and self.y_unit_status == "UNKNOWN":
            raise ValueError("A calibrated Y axis must declare arbitrary or source-defined units.")
        if self.x_calibration.label.casefold() not in {"2theta", "2θ", "2 theta"}:
            raise ValueError("Figure 3 XRD calibration must declare the 2θ axis.")
        if self.x_calibration.unit != "degree":
            raise ValueError("Figure 3 XRD 2θ calibration must use degrees.")
        return self


class ScientificDocumentImportOutput(ContractModel):
    document: ScientificDocument
    candidates: tuple[EvidenceCandidate, ...] = Field(default=(), max_length=10_000)


class ExperimentalImportInput(ContractModel):
    modality: ExperimentModality
    x_column: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    y_columns: tuple[Annotated[str, StringConstraints(min_length=1, max_length=120)], ...] = Field(
        min_length=1, max_length=8
    )
    x_label: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    x_unit: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    y_label: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    y_unit: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    experiment_name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    delimiter: Annotated[str, StringConstraints(min_length=1, max_length=4)] = ","
    has_header: bool = True


class ExperimentalDatasetView(ContractModel):
    id: UUID
    project_id: UUID
    experiment_id: UUID
    modality: ExperimentModality
    name: str
    state: DatasetProcessingState
    source_class: ProvenanceClass
    artifact: ArtifactReference
    axes: tuple[AxisDefinition, ...]
    values: tuple[dict[str, float], ...] = Field(max_length=200_000)
    point_count: int = Field(ge=1)
    created_at: datetime
    digitization_session: XrdDigitizationSession | GraphDigitizationSession | None = None


class ScientificDocumentListOutput(ContractModel):
    documents: tuple[ScientificDocument, ...] = Field(max_length=10_000)


class ExperimentalDatasetListOutput(ContractModel):
    datasets: tuple[ExperimentalDatasetView, ...] = Field(max_length=10_000)
