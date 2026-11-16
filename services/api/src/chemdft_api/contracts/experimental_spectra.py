# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Experimental spectra contracts (IR/FTIR, Raman, UV/Vis): raw import, append-only derived versions, comparison.

Authority model (never weakened):
  * A RAW dataset is the measured data exactly as supplied: immutable, EXPERIMENTAL, unit evidence recorded (EXPLICIT_UNIT or
    USER_CONFIRMED; a value-range or file-name hint can never authorise persistence).
  * Every transform creates a NEW dataset (`state` DERIVED/NORMALIZED) whose provenance is DETERMINISTIC_TRANSFORM and whose parent,
    parameters, library versions and input/output hashes are recorded. A peak set is `DERIVED_NOT_RAW`.
  * Comparisons pair calculated or imported DISCRETE data with experimental peaks as CANDIDATE matches. There is no "assigned" status
    and no merged data type.
Worker documents are validated again here (`extra=forbid`) so any drift between the worker and these contracts fails loudly.
"""
# ruff: noqa: E501  (long human-readable diagnostics and separators)

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .base import ContractModel, ContractVersion, Sha256
from .provenance import ProvenanceClass
from .scientific import AxisDefinition, DatasetProcessingState, ExperimentModality

FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
PositiveFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]
ShortText = Annotated[str, StringConstraints(max_length=2000)]
Label = Annotated[str, StringConstraints(min_length=1, max_length=160)]
Idempotency = Annotated[str, StringConstraints(min_length=8, max_length=200)]

PREVIEW_SCHEMA = "chemdft.experimental-spectrum.preview"
TRANSFORM_SCHEMA = "chemdft.experimental-spectrum.transform"
PEAKS_SCHEMA = "chemdft.experimental-spectrum.peaks"
COMPARISON_SCHEMA = "chemdft.experimental-spectrum.comparison"
MAX_DISPLAY_POINTS = 4000


def canonical_json(value: object) -> bytes:
    """Byte-identical to the spectra worker's canonical form (no trailing newline): hashes are computed over exactly these bytes."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False, ensure_ascii=True).encode("ascii")


def body_sha256(body: object) -> str:
    return hashlib.sha256(canonical_json(body)).hexdigest()


# ---------------------------------------------------------------------------------------------------------- vocabulary
class SpectrumTechnique(StrEnum):
    IR = "IR"
    RAMAN = "RAMAN"
    UVVIS = "UVVIS"


class UnitEvidence(StrEnum):
    EXPLICIT_UNIT = "EXPLICIT_UNIT"
    USER_CONFIRMED = "USER_CONFIRMED"
    QUANTITY_NAME = "QUANTITY_NAME"
    HINT_ONLY = "HINT_ONLY"
    NONE = "NONE"


class SuppliedStatus(StrEnum):
    AS_REPORTED_IN_FILE = "AS_REPORTED_IN_FILE"
    USER_ENTERED = "USER_ENTERED"
    NOT_SUPPLIED = "NOT_SUPPLIED"


class SpectrumPreviewStatus(StrEnum):
    READY = "READY"
    NEEDS_CONFIRMATION = "NEEDS_CONFIRMATION"
    REJECTED = "REJECTED"


class SpectrumDatasetKind(StrEnum):
    RAW = "RAW"
    TRANSFORM = "TRANSFORM"
    PEAKS = "PEAKS"


class SpectrumAuthority(StrEnum):
    RAW_MEASUREMENT = "RAW_MEASUREMENT"
    DETERMINISTIC_TRANSFORM = "DETERMINISTIC_TRANSFORM"
    DERIVED_NOT_RAW = "DERIVED_NOT_RAW"


class SpectrumYQuantity(StrEnum):
    ABSORBANCE = "ABSORBANCE"
    TRANSMITTANCE = "TRANSMITTANCE"
    INTENSITY = "INTENSITY"
    CROSS_SECTION = "CROSS_SECTION"
    MOLAR_ABSORPTIVITY = "MOLAR_ABSORPTIVITY"


XUnit = Literal["cm^-1", "um", "nm", "eV"]
YUnit = Literal["absorbance", "percent", "fraction", "counts", "arbitrary", "cm^2/molecule", "L/(mol*cm)", "relative"]
XQuantity = Literal["WAVENUMBER", "WAVELENGTH", "ENERGY", "RAMAN_SHIFT"]
SamplePhase = Literal["GAS", "LIQUID", "SOLUTION", "SOLID", "OTHER"]
SamplingMode = Literal["TRANSMISSION", "ATR", "GAS_CELL", "DRIFTS", "OTHER"]
PreviewNeed = Literal["column_roles", "x_unit", "y_quantity_and_unit", "y_transmittance_scale"]


class Supplied(ContractModel):
    """A metadata value with its origin. NOT_SUPPLIED is a first-class state: nothing is inferred or invented."""

    status: SuppliedStatus
    value: str | float | int | None = None
    as_written: str | None = None
    line: int | None = None
    file_reported: str | None = None


class AcquisitionMetadata(ContractModel):
    sampling_mode: Supplied | None = None
    path_length_cm: Supplied | None = None
    resolution_cm1: Supplied | None = None
    phase: Supplied | None = None
    excitation_wavelength_nm: Supplied | None = None
    integration_time_s: Supplied | None = None
    accumulations: Supplied | None = None
    polarization: Supplied | None = None
    concentration: Supplied | None = None
    solvent: Supplied | None = None
    bandwidth_nm: Supplied | None = None


# ---------------------------------------------------------------------------------------------------------- preview (worker document)
class PreviewDiagnostic(ContractModel):
    code: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    severity: Literal["error", "warning", "info"]
    message: ShortText
    line: int | None = None


class SpectrumParserInfo(ContractModel):
    name: Literal["chemdft-spectra-text"]
    version: Annotated[str, StringConstraints(min_length=1, max_length=32)]


class SpectrumSourceInfo(ContractModel):
    sha256: Sha256
    size_bytes: int = Field(ge=0)
    encoding: str | None = None
    newline: str | None = None
    delimiter: str | None = None
    decimal: str | None = None
    orientation: str | None = None
    first_data_line: int | None = None
    last_data_line: int | None = None
    header_line_count: int = Field(ge=0)


class SpectrumColumn(ContractModel):
    index: int = Field(ge=0)
    label: str | None = None
    count: int = Field(ge=0)
    invalid_count: int = Field(ge=0)
    min: FiniteFloat | None = None
    max: FiniteFloat | None = None


class SpectrumChoiceEcho(ContractModel):
    x_index: int | None = None
    y_index: int | None = None
    y_error_index: int | None = None
    x_unit: XUnit | None = None
    y_quantity: SpectrumYQuantity | None = None
    y_unit: YUnit | None = None
    exclude_invalid_rows: bool
    excluded_lines: tuple[int, ...] = Field(default=(), max_length=100)


class SpacingStats(ContractModel):
    count: int = Field(ge=0)
    median: FiniteFloat
    min: FiniteFloat
    max: FiniteFloat
    relative_variation: FiniteFloat
    uniform: bool


class XAxisPreview(ContractModel):
    unit: XUnit | None
    quantity: XQuantity | None
    unit_evidence: UnitEvidence
    unit_evidence_text: ShortText
    direction_in_file: Literal["ASCENDING", "DESCENDING"]
    label_in_file: str | None
    spacing: SpacingStats
    min: FiniteFloat
    max: FiniteFloat
    sha256: Sha256


class YAxisPreview(ContractModel):
    quantity: SpectrumYQuantity | None
    unit: YUnit | None
    unit_evidence: UnitEvidence
    unit_evidence_text: ShortText
    label_in_file: str | None
    min: FiniteFloat
    max: FiniteFloat
    sha256: Sha256


class YErrorPreview(ContractModel):
    column: int = Field(ge=0)
    unit: YUnit | None
    sha256: Sha256


class UnitProposal(ContractModel):
    quantity: str | None
    unit: str | None
    level: UnitEvidence
    evidence: ShortText


class UnitProposals(ContractModel):
    x: UnitProposal | None
    y: UnitProposal | None


class DisplaySeries(ContractModel):
    x: tuple[FiniteFloat, ...] = Field(max_length=2 * MAX_DISPLAY_POINTS)
    y: tuple[FiniteFloat, ...] = Field(max_length=2 * MAX_DISPLAY_POINTS)
    decimated: bool
    source_points: int = Field(ge=0)
    buckets: int | None = None


class ArraysBlock(ContractModel):
    layout: Annotated[str, StringConstraints(max_length=80)]
    x_sha256: Sha256
    y_sha256: Sha256
    y_error_sha256: Sha256 | None
    artifact_sha256: Sha256


class MetadataLine(ContractModel):
    key: Annotated[str, StringConstraints(max_length=120)]
    value: Annotated[str, StringConstraints(max_length=1000)]
    line: int = Field(ge=1)


class SpectrumPreviewBody(ContractModel):
    """The worker's resolved preview, validated field by field. Its canonical hash is what a person confirms."""

    schema_id: Literal["chemdft.experimental-spectrum.preview"] = Field(alias="schema")
    schema_version: ContractVersion = "1.0.0"
    worker_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    technique: str
    parser: SpectrumParserInfo
    source: SpectrumSourceInfo
    status: SpectrumPreviewStatus
    needs: tuple[PreviewNeed, ...]
    columns: tuple[SpectrumColumn, ...] = Field(max_length=300)
    choice: SpectrumChoiceEcho | None
    x: XAxisPreview | None
    y: YAxisPreview | None
    y_error: YErrorPreview | None
    proposals: UnitProposals
    point_count: int = Field(ge=0, le=200_000)
    display: DisplaySeries | None
    arrays: ArraysBlock | None
    metadata_verbatim: tuple[MetadataLine, ...] = Field(max_length=100)
    acquisition: AcquisitionMetadata
    instrument: Supplied
    sample: Supplied
    display_name: Annotated[str, StringConstraints(max_length=160)] | None
    diagnostics: tuple[PreviewDiagnostic, ...] = Field(max_length=400)

    @model_validator(mode="after")
    def _consistent(self) -> SpectrumPreviewBody:
        if self.status is SpectrumPreviewStatus.READY:
            if self.needs or self.x is None or self.y is None or self.arrays is None:
                raise ValueError("A READY preview has no outstanding needs and carries both axes and arrays")
            if self.x.unit is None or self.y.unit is None or self.y.quantity is None:
                raise ValueError("A READY preview has confirmed units on both axes")
            if not (self.x.unit_evidence.value in ("EXPLICIT_UNIT", "USER_CONFIRMED") and self.y.unit_evidence.value in ("EXPLICIT_UNIT", "USER_CONFIRMED")):
                raise ValueError("A READY preview needs EXPLICIT_UNIT or USER_CONFIRMED evidence on both axes")
        if self.status is SpectrumPreviewStatus.REJECTED and (self.arrays is not None or self.point_count != 0):
            raise ValueError("A rejected preview carries no data")
        return self

    model_config = ContractModel.model_config | {"populate_by_name": True}


class SpectrumPreviewDocument(ContractModel):
    """Envelope stored as an artifact: the canonical body plus the hash that confirmation must quote."""

    body: SpectrumPreviewBody
    preview_sha256: Sha256


# ---------------------------------------------------------------------------------------------------------- user choices (resolve)
class SpectrumUserMetadata(ContractModel):
    """User-entered acquisition metadata. Anything left empty stays NOT_SUPPLIED; it is never filled from a default."""

    sampling_mode: SamplingMode | None = None
    path_length_cm: PositiveFloat | None = None
    resolution_cm1: PositiveFloat | None = None
    phase: SamplePhase | None = None
    excitation_wavelength_nm: PositiveFloat | None = None
    integration_time_s: PositiveFloat | None = None
    accumulations: int | None = Field(default=None, ge=1, le=1_000_000)
    polarization: Annotated[str, StringConstraints(max_length=200)] | None = None
    concentration: Annotated[str, StringConstraints(max_length=200)] | None = None
    solvent: Annotated[str, StringConstraints(max_length=200)] | None = None
    bandwidth_nm: PositiveFloat | None = None


class SpectrumChoices(ContractModel):
    x_index: int | None = Field(default=None, ge=0, le=300)
    y_index: int | None = Field(default=None, ge=0, le=300)
    y_error_index: int | None = Field(default=None, ge=0, le=300)
    x_unit: XUnit | None = None
    y_quantity: SpectrumYQuantity | None = None
    y_unit: YUnit | None = None
    exclude_invalid_rows: bool = False
    metadata: SpectrumUserMetadata | None = None
    instrument: Annotated[str, StringConstraints(max_length=200)] | None = None
    sample: Annotated[str, StringConstraints(max_length=200)] | None = None
    display_name: Annotated[str, StringConstraints(max_length=160)] | None = None


class SpectrumResolveInput(ContractModel):
    choices: SpectrumChoices = SpectrumChoices()


class AssociationState(StrEnum):
    UNASSIGNED = "UNASSIGNED"
    ASSOCIATED_WITH_STRUCTURE = "ASSOCIATED_WITH_STRUCTURE"
    ASSOCIATED_WITH_SAMPLE = "ASSOCIATED_WITH_SAMPLE"


class SpectrumAssociationInput(ContractModel):
    """A spectrum need not belong to a single molecule: it can be unassigned, tied to a structure, or tied to a sample label."""

    state: AssociationState
    structure_id: UUID | None = None
    sample_label: Annotated[str, StringConstraints(min_length=1, max_length=160)] | None = None
    note: Annotated[str, StringConstraints(max_length=1000)] | None = None

    @model_validator(mode="after")
    def _consistent(self) -> SpectrumAssociationInput:
        if self.state is AssociationState.ASSOCIATED_WITH_STRUCTURE and self.structure_id is None:
            raise ValueError("A structure association needs a structure")
        if self.state is AssociationState.ASSOCIATED_WITH_SAMPLE and not self.sample_label:
            raise ValueError("A sample association needs a sample label")
        if self.state is AssociationState.UNASSIGNED and (self.structure_id or self.sample_label):
            raise ValueError("An unassigned spectrum names neither a structure nor a sample")
        return self


class SpectrumConfirmInput(ContractModel):
    preview_sha256: Sha256
    idempotency_key: Idempotency
    association: SpectrumAssociationInput | None = None


# ---------------------------------------------------------------------------------------------------------- upload views
class SpectrumPreviewView(ContractModel):
    id: UUID
    upload_id: UUID
    project_id: UUID
    preview_sha256: Sha256
    status: SpectrumPreviewStatus
    body: SpectrumPreviewBody
    created_at: datetime
    created_by: UUID


class SpectrumPreviewSummary(ContractModel):
    id: UUID
    preview_sha256: Sha256
    status: SpectrumPreviewStatus
    needs: tuple[PreviewNeed, ...]
    created_at: datetime


class SpectrumUploadSource(ContractModel):
    sha256: Sha256
    size_bytes: int = Field(ge=0)
    original_name: str
    uploaded_at: datetime
    raw_artifact_id: UUID | None


class SpectrumUploadView(ContractModel):
    id: UUID
    project_id: UUID
    technique: SpectrumTechnique
    state: Literal["PREVIEW", "IMPORTED", "REJECTED"]
    source: SpectrumUploadSource
    previews: tuple[SpectrumPreviewSummary, ...]
    latest_preview: SpectrumPreviewView
    dataset_id: UUID | None
    created_at: datetime
    created_by: UUID


class SpectrumUploadListOutput(ContractModel):
    uploads: tuple[SpectrumUploadView, ...] = Field(max_length=2000)


# ---------------------------------------------------------------------------------------------------------- transform records
class ParameterValue(ContractModel):
    key: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    value: str | float | int | bool | None = None


class SpectrumWarning(ContractModel):
    code: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    message: ShortText


class VersionIO(ContractModel):
    artifact_sha256: Sha256
    x_sha256: Sha256
    y_sha256: Sha256
    point_count: int = Field(ge=0)
    x_unit: XUnit
    y_quantity: SpectrumYQuantity
    y_unit: YUnit
    representation: Literal["ABSOLUTE", "RELATIVE"]
    x_order: Literal["ASCENDING", "DESCENDING"] | None = None


class AuxHash(ContractModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    sha256: Sha256
    point_count: int = Field(ge=0)


class TransformRecordView(ContractModel):
    op: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    library: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    library_version: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    parameters: tuple[ParameterValue, ...]
    resolved: tuple[ParameterValue, ...]
    warnings: tuple[SpectrumWarning, ...]
    input: VersionIO
    output: VersionIO
    aux: tuple[AuxHash, ...]
    input_was_descending: bool
    environment: tuple[ParameterValue, ...]
    record_sha256: Sha256
    authority: Literal["DETERMINISTIC_TRANSFORM"]


TransformOp = Literal[
    "baseline.arpls",
    "baseline.snip",
    "baseline.imodpoly",
    "baseline.offset",
    "smooth.savgol",
    "normalize.max",
    "normalize.area",
    "resample.linear",
    "crop",
    "convert.absorbance_from_transmittance",
]


class SpectrumTransformParameters(ContractModel):
    """Union of every transform's parameters; the worker enforces which are required and valid for the chosen operation."""

    stiffness_length_x: PositiveFloat | None = None
    diff_order: int | None = Field(default=None, ge=1, le=3)
    max_iter: int | None = Field(default=None, ge=1, le=1000)
    tol: PositiveFloat | None = None
    half_window_x: PositiveFloat | None = None
    decreasing: bool | None = None
    smooth_half_window: int | None = Field(default=None, ge=0, le=1000)
    poly_order: int | None = Field(default=None, ge=1, le=10)
    num_std: PositiveFloat | None = None
    percentile: float | None = Field(default=None, ge=0, le=100)
    value: FiniteFloat | None = None
    window_x: PositiveFloat | None = None
    window_points: int | None = Field(default=None, ge=3, le=200_000)
    polyorder: int | None = Field(default=None, ge=1, le=10)
    mode: Literal["interp", "mirror", "nearest", "wrap", "constant"] | None = None
    target: PositiveFloat | None = None
    x_range: tuple[FiniteFloat, FiniteFloat] | None = None
    step: PositiveFloat | None = None
    x_min: FiniteFloat | None = None
    x_max: FiniteFloat | None = None


class SpectrumTransformInput(ContractModel):
    op: TransformOp
    parameters: SpectrumTransformParameters = SpectrumTransformParameters()
    display_name: Annotated[str, StringConstraints(max_length=160)] | None = None
    idempotency_key: Idempotency


class SpectrumPeakParameters(ContractModel):
    prominence: PositiveFloat | None = None
    prominence_sigma: PositiveFloat | None = None
    polarity: Literal["maxima", "minima"] | None = None
    height: FiniteFloat | None = None
    min_width_x: PositiveFloat | None = None
    min_distance_x: PositiveFloat | None = None
    threshold: PositiveFloat | None = None
    refine: bool | None = None


class SpectrumPeakInput(ContractModel):
    parameters: SpectrumPeakParameters
    idempotency_key: Idempotency


class SpectrumPeak(ContractModel):
    index: int = Field(ge=0)
    x_sample: FiniteFloat
    y_sample: FiniteFloat
    x: FiniteFloat
    y: FiniteFloat
    prominence: FiniteFloat
    fwhm_x: FiniteFloat
    left_base_x: FiniteFloat
    right_base_x: FiniteFloat
    relative_height: FiniteFloat
    refined: bool


class PeakSetView(ContractModel):
    algorithm: ShortText
    library: Annotated[str, StringConstraints(max_length=40)]
    library_version: Annotated[str, StringConstraints(max_length=40)]
    parameters: tuple[ParameterValue, ...]
    resolved: tuple[ParameterValue, ...]
    warnings: tuple[SpectrumWarning, ...]
    input: VersionIO
    peaks: tuple[SpectrumPeak, ...] = Field(max_length=2000)
    peak_count: int = Field(ge=0)
    environment: tuple[ParameterValue, ...]
    record_sha256: Sha256
    authority: Literal["DERIVED_NOT_RAW"]


# ---------------------------------------------------------------------------------------------------------- dataset views
class SpectrumAxisView(ContractModel):
    definition: AxisDefinition
    quantity: str | None
    unit_evidence: UnitEvidence
    unit_evidence_text: ShortText
    label_in_file: str | None


class SpectrumSourceView(ContractModel):
    sha256: Sha256
    size_bytes: int = Field(ge=0)
    original_name: str
    encoding: str | None
    newline: str | None
    delimiter: str | None
    decimal: str | None
    orientation: str | None
    parser_name: str
    parser_version: str
    worker_version: str
    preview_sha256: Sha256
    original_axis_direction: Literal["ASCENDING", "DESCENDING"]
    raw_artifact_id: UUID | None


class SpectrumProcessingStepView(ContractModel):
    dataset_id: UUID
    op: str
    library: str
    library_version: str
    record_sha256: Sha256
    output_artifact_sha256: Sha256
    performed_at: datetime


class SpectrumAssociationView(ContractModel):
    id: UUID | None
    dataset_id: UUID
    state: AssociationState
    structure_id: UUID | None
    structure_name: str | None
    sample_label: str | None
    note: str | None
    created_at: datetime | None
    created_by: UUID | None


class ArtifactRef(ContractModel):
    artifact_id: UUID
    sha256: Sha256
    size_bytes: int = Field(ge=0)


class SpectrumDatasetView(ContractModel):
    id: UUID
    project_id: UUID
    experiment_id: UUID
    modality: ExperimentModality
    technique: SpectrumTechnique
    name: str
    kind: SpectrumDatasetKind
    state: DatasetProcessingState
    source_class: ProvenanceClass
    authority: SpectrumAuthority
    parent_dataset_id: UUID | None
    lineage: tuple[UUID, ...] = Field(max_length=64)
    arrays: ArtifactRef | None
    baseline_curve: ArtifactRef | None
    x: SpectrumAxisView
    y: SpectrumAxisView
    y_error_present: bool
    representation: Literal["ABSOLUTE", "RELATIVE"]
    point_count: int = Field(ge=0)
    x_min: FiniteFloat | None
    x_max: FiniteFloat | None
    x_order: Literal["ASCENDING", "DESCENDING"]
    arrays_sha256: Sha256 | None
    source: SpectrumSourceView | None
    acquisition: AcquisitionMetadata | None
    instrument: Supplied | None
    sample: Supplied | None
    metadata_verbatim: tuple[MetadataLine, ...] = Field(max_length=100)
    processing: tuple[SpectrumProcessingStepView, ...] = Field(max_length=64)
    transform: TransformRecordView | None
    peak_set: PeakSetView | None
    association: SpectrumAssociationView
    provenance_record_id: UUID
    children: tuple[UUID, ...] = Field(max_length=500)
    created_at: datetime
    created_by: UUID


class SpectrumDatasetListOutput(ContractModel):
    datasets: tuple[SpectrumDatasetView, ...] = Field(max_length=5000)


class SpectrumArraysView(ContractModel):
    """The stored arrays (optionally min/max-decimated for display). Decimation never changes what is stored."""

    dataset_id: UUID
    x: tuple[FiniteFloat, ...]
    y: tuple[FiniteFloat, ...]
    y_error: tuple[FiniteFloat, ...] | None
    baseline: tuple[FiniteFloat, ...] | None
    baseline_x: tuple[FiniteFloat, ...] | None
    point_count: int = Field(ge=0)
    returned_points: int = Field(ge=0)
    decimated: bool
    arrays_sha256: Sha256


# ---------------------------------------------------------------------------------------------------------- comparison
ComparisonStatus = Literal["CANDIDATE_MATCH", "AMBIGUOUS_CANDIDATE"]
ComparisonAxis = Literal["cm^-1", "eV", "nm"]


class CalculatedSourceKind(StrEnum):
    CALCULATION_RESULT = "CALCULATION_RESULT"
    IMPORTED_RESULT = "IMPORTED_RESULT"


class CalculatedSourceRef(ContractModel):
    kind: CalculatedSourceKind
    id: UUID


class ComparisonScaling(ContractModel):
    """Unscaled, or one user-entered factor persisted as part of the comparison. There is no default and no literature factor."""

    mode: Literal["UNSCALED", "USER_FACTOR"] = "UNSCALED"
    factor: PositiveFloat | None = None

    @model_validator(mode="after")
    def _consistent(self) -> ComparisonScaling:
        if (self.mode == "USER_FACTOR") != (self.factor is not None):
            raise ValueError("A user factor is given if and only if the mode is USER_FACTOR")
        return self


class ComparisonBandInput(ContractModel):
    label: Annotated[str, StringConstraints(max_length=80)] | None = None
    lo_nm: PositiveFloat
    hi_nm: PositiveFloat

    @model_validator(mode="after")
    def _ordered(self) -> ComparisonBandInput:
        if self.lo_nm >= self.hi_nm:
            raise ValueError("A band needs lo_nm below hi_nm")
        return self


class ComparisonSimilarityInput(ContractModel):
    lorentzian_fwhm_cm1: PositiveFloat
    window_cm1: tuple[PositiveFloat, PositiveFloat]
    step_cm1: PositiveFloat


class SpectrumComparisonInput(ContractModel):
    experimental_dataset_id: UUID
    peak_set_dataset_id: UUID
    calculated: CalculatedSourceRef
    tolerance: PositiveFloat
    scaling: ComparisonScaling = ComparisonScaling()
    axis: ComparisonAxis = "cm^-1"
    min_relative_intensity: Annotated[float, Field(ge=0, lt=1)] = 0.01
    min_oscillator_strength: Annotated[float, Field(ge=0)] = 0.0
    bands: tuple[ComparisonBandInput, ...] = Field(default=(), max_length=16)
    similarity: ComparisonSimilarityInput | None = None
    idempotency_key: Idempotency


class ComparisonDiagnostic(ContractModel):
    code: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    severity: Literal["error", "warning", "info"]
    message: ShortText


class ComparisonPair(ContractModel):
    calculated_index: int = Field(ge=0)
    calculated_position_source: FiniteFloat
    calculated_position: FiniteFloat
    calculated_oscillator_strength: FiniteFloat | None
    experimental_peak_index: int = Field(ge=0)
    experimental_position: FiniteFloat
    delta: FiniteFloat
    tolerance: PositiveFloat
    candidates_for_calculated: int = Field(ge=1)
    candidates_for_experimental: int = Field(ge=1)
    margin_to_next_experimental_peak: FiniteFloat | None
    status: ComparisonStatus
    relative_intensity_calculated: FiniteFloat | None
    relative_intensity_experimental: FiniteFloat | None


class UnmatchedCalculated(ContractModel):
    calculated_index: int = Field(ge=0)
    calculated_position_source: FiniteFloat
    calculated_position: FiniteFloat
    calculated_oscillator_strength: FiniteFloat | None
    relative_intensity_calculated: FiniteFloat | None
    status: Literal["UNMATCHED_CALCULATED"]


class UnmatchedExperimental(ContractModel):
    experimental_peak_index: int = Field(ge=0)
    experimental_position: FiniteFloat
    prominence: FiniteFloat
    relative_intensity_experimental: FiniteFloat | None
    status: Literal["UNMATCHED_EXPERIMENTAL"]


class ExcludedCount(ContractModel):
    reason: Annotated[str, StringConstraints(max_length=80)]
    count: int = Field(ge=0)


class SensitivityRow(ContractModel):
    tolerance: PositiveFloat
    matched: int = Field(ge=0)
    mae: FiniteFloat | None
    rmse: FiniteFloat | None
    signed_bias: FiniteFloat | None


class ComparisonMetrics(ContractModel):
    calculated_considered: int = Field(ge=0)
    calculated_total: int = Field(ge=0)
    calculated_excluded: tuple[ExcludedCount, ...]
    experimental_peaks: int = Field(ge=0)
    matched: int = Field(ge=0)
    ambiguous_pairs: int = Field(ge=0)
    matched_fraction_of_experimental_peaks: FiniteFloat | None
    matched_fraction_of_calculated_considered: FiniteFloat | None
    unmatched_calculated: int = Field(ge=0)
    unmatched_experimental: int = Field(ge=0)
    signed_bias: FiniteFloat | None
    mae: FiniteFloat | None
    rmse: FiniteFloat | None
    max_abs_delta: FiniteFloat | None
    median_delta: FiniteFloat | None
    delta_unit: ComparisonAxis
    delta_definition: ShortText
    mae_upper_bound_by_construction: PositiveFloat
    mae_note: ShortText
    tolerance_sensitivity: tuple[SensitivityRow, ...]


class BandExperimental(ContractModel):
    f: FiniteFloat
    integral_sigma_dnu_cm2_per_cm: FiniteFloat
    points: int = Field(ge=0)
    nu_lo_cm1: FiniteFloat
    nu_hi_cm1: FiniteFloat
    centroid_ev: FiniteFloat | None


class BandLimitSensitivity(ContractModel):
    f_min: FiniteFloat
    f_max: FiniteFloat
    edges_moved: ShortText


class BandComparison(ContractModel):
    label: str
    lo_nm: PositiveFloat
    hi_nm: PositiveFloat
    calculated_states_in_band: tuple[int, ...]
    f_calculated_sum: FiniteFloat
    centroid_calculated_ev: FiniteFloat | None
    experimental: BandExperimental | None
    f_ratio_calc_over_exp: FiniteFloat | None
    integration_domain: ShortText
    limit_sensitivity: BandLimitSensitivity | None
    notes: tuple[ComparisonDiagnostic, ...]


class SimilarityView(ContractModel):
    computed: bool
    reason: str | None
    pearson_r: FiniteFloat | None
    cosine: FiniteFloat | None
    grid_points: int | None
    settings: tuple[ParameterValue, ...]
    authority: Literal["DISPLAY_ONLY"]
    note: ShortText | None


class ComparisonScalingView(ContractModel):
    mode: Literal["UNSCALED", "USER_FACTOR"]
    factor: PositiveFloat | None
    source: ShortText


class CalculatedSourceView(ContractModel):
    kind: CalculatedSourceKind
    id: UUID
    technique: SpectrumTechnique
    label: str
    structure_id: UUID | None
    structure_name: str | None
    method: str | None
    basis: str | None
    engine: str | None
    phase: Literal["GAS", "UNKNOWN"]
    item_count: int = Field(ge=0)
    has_intensities: bool
    structure_version_id: UUID | None
    calculation_id: UUID | None  # the calculation that produced a ChemDFT result (None for imported results)


class SpectrumComparisonView(ContractModel):
    id: UUID
    project_id: UUID
    technique: SpectrumTechnique
    kind: Literal["VIBRATIONAL_POSITION_MATCH", "UVVIS_POSITION_AND_BAND_COMPARISON"]
    experimental_dataset_id: UUID
    peak_set_dataset_id: UUID
    experimental_dataset_name: str
    calculated: CalculatedSourceView
    method: Literal["gated_optimal_assignment"]
    axis: ComparisonAxis
    tolerance: PositiveFloat
    scaling: ComparisonScalingView
    pairs: tuple[ComparisonPair, ...] = Field(max_length=5000)
    unmatched_calculated: tuple[UnmatchedCalculated, ...] = Field(max_length=5000)
    unmatched_experimental: tuple[UnmatchedExperimental, ...] = Field(max_length=5000)
    metrics: ComparisonMetrics
    bands: tuple[BandComparison, ...]
    diagnostics: tuple[ComparisonDiagnostic, ...]
    similarity: SimilarityView | None
    experimental_phase: Supplied
    assignment_statement: ShortText
    intensity_statement: ShortText
    authority: Literal["DETERMINISTIC_TRANSFORM"]
    record_sha256: Sha256
    provenance_record_id: UUID
    worker_version: str
    created_at: datetime
    created_by: UUID


class SpectrumComparisonListOutput(ContractModel):
    comparisons: tuple[SpectrumComparisonView, ...] = Field(max_length=2000)


class CalculatedSourceListOutput(ContractModel):
    sources: tuple[CalculatedSourceView, ...] = Field(max_length=2000)
