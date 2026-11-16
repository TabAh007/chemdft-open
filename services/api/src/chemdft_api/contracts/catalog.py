# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from .base import ArtifactReference, ContractModel, ContractVersion, EntityReference, Sha256
from .dftd4 import DispersionCorrectionSpecification
from .results import CalculationResult
from .scientific import (
    Atom,
    Bond,
    Calculation,
    CalculationAttempt,
    CalculationSpecification,
    CoordinateSystem,
    CoordinateUnit,
    EngineReference,
    PeriodicCell,
    Structure,
    StructureDiagnostic,
    StructureKind,
    StructureVersion,
)


class EmptyOutput(ContractModel):
    schema_version: ContractVersion = "1.0.0"


class ProjectListInput(ContractModel):
    pass


class ProjectGetInput(ContractModel):
    project_id: UUID


class ProjectCreateInput(ContractModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    slug: Annotated[
        str,
        StringConstraints(min_length=1, max_length=96, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$"),
    ]


class ProjectSummary(ContractModel):
    id: UUID
    organization_id: UUID
    name: str
    slug: str
    role: str
    created_at: datetime
    updated_at: datetime


class ProjectListOutput(ContractModel):
    projects: tuple[ProjectSummary, ...] = Field(max_length=10_000)


class StructureImportInput(ContractModel):
    project_id: UUID
    source_artifact: ArtifactReference
    requested_format: Annotated[str, StringConstraints(min_length=2, max_length=16)]
    structure_name: Annotated[str, StringConstraints(min_length=1, max_length=160)] | None = None
    selection_index: int = Field(default=0, ge=0)
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=200)]


class StructureEditCoordinateSet(ContractModel):
    coordinate_system: CoordinateSystem
    unit: CoordinateUnit
    dimensionality: Literal[3] = 3
    atom_ordering: Literal["AS_LISTED"] = "AS_LISTED"
    atoms: tuple[Atom, ...] = Field(min_length=1, max_length=10_000)
    bonds: tuple[Bond, ...] = Field(default=(), max_length=40_000)


class StructureVersionCreateInput(ContractModel):
    structure_id: UUID
    parent_version_id: UUID
    representation_artifact: ArtifactReference
    coordinates: StructureEditCoordinateSet
    periodic_cell: PeriodicCell | None = None
    overall_charge: int
    multiplicity: int = Field(ge=1)
    requested_origin: Literal["MANUALLY_EDITED"] = "MANUALLY_EDITED"
    operation: Annotated[str, StringConstraints(min_length=1, max_length=80)] = "manual_edit"
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=200)] | None = None


class StructureSourceReferenceUpdateInput(ContractModel):
    source_reference: str = Field(max_length=2000)


class StructureSummary(ContractModel):
    id: UUID
    project_id: UUID
    name: str
    kind: StructureKind
    latest_version_id: UUID
    latest_revision: int
    atom_count: int
    bond_count: int
    diagnostic_counts: dict[str, int] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class StructureVersionProvenance(ContractModel):
    origin: str
    detail: Annotated[str, StringConstraints(max_length=64)] | None = None
    source_artifact: ArtifactReference | None = None
    parser: Annotated[str, StringConstraints(max_length=160)] | None = None
    parser_version: Annotated[str, StringConstraints(max_length=64)] | None = None
    adapter: Annotated[str, StringConstraints(max_length=160)] | None = None
    adapter_version: Annotated[str, StringConstraints(max_length=64)] | None = None
    operation: Annotated[str, StringConstraints(max_length=160)] | None = None
    operation_version: Annotated[str, StringConstraints(max_length=64)] | None = None
    source_class: Annotated[str, StringConstraints(max_length=64)] | None = None
    coordinate_origin: Annotated[str, StringConstraints(max_length=64)] | None = None
    coordinate_input_format: Annotated[str, StringConstraints(max_length=64)] | None = None
    coordinate_unit: Annotated[str, StringConstraints(max_length=24)] | None = None
    coordinate_file_sha256: Annotated[str, StringConstraints(max_length=64)] | None = None
    candidate_representation_id: UUID | None = None
    verification_state: Annotated[str, StringConstraints(max_length=64)] | None = None
    created_at: datetime | None = None
    actor_id: UUID | None = None
    calculation_id: UUID | None = None
    trajectory_id: UUID | None = None
    final_step_index: int | None = None
    geometry_candidate_id: UUID | None = None
    generation_method: str | None = None
    geometry_class: str | None = None
    candidate_sha256: Sha256 | None = None
    source_reference: str | None = None


class StructureVersionDetail(ContractModel):
    structure: Structure
    version: StructureVersion
    diagnostics: tuple[StructureDiagnostic, ...] = Field(default=(), max_length=128)
    provenance: StructureVersionProvenance | None = None
    # Additive, read-only (0.0.17): who may set charge/multiplicity for a calculation.
    # CALCULATION_USER_DECLARED means a request may differ from the stored values;
    # otherwise the request must equal them. None = older server.
    electronic_state_authority: (
        Literal["STRUCTURE_VERSION", "USER_DECLARED_XYZ", "CALCULATION_USER_DECLARED"] | None
    ) = None


class StructureImportOutput(ContractModel):
    structure: Structure
    version: StructureVersion


class StructureVersionCreateOutput(ContractModel):
    version: StructureVersion


class CalculationSubmitInput(ContractModel):
    structure_version: EntityReference
    specification: CalculationSpecification
    provider_preference: Literal["AUTO", "LOCAL", "CLOUD"] = "AUTO"
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=200)]


class CalculationGetInput(ContractModel):
    calculation: EntityReference


class AcceleratorKind(StrEnum):
    NONE = "NONE"
    NVIDIA_CUDA = "NVIDIA_CUDA"


class IsolationClass(StrEnum):
    LOCAL_DEVELOPMENT = "LOCAL_DEVELOPMENT"
    MANAGED_CONTAINER = "MANAGED_CONTAINER"


class ReproducibilityClass(StrEnum):
    LOCAL_PINNED_ENVIRONMENT = "LOCAL_PINNED_ENVIRONMENT"
    PINNED_CONTAINER_IMAGE = "PINNED_CONTAINER_IMAGE"


class ComputeJobState(StrEnum):
    PENDING = "PENDING"
    READY = "READY"
    LEASED = "LEASED"
    RUNNING = "RUNNING"
    CANCEL_REQUESTED = "CANCEL_REQUESTED"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


class ComputeExecutionState(StrEnum):
    CREATED = "CREATED"
    SUBMITTED = "SUBMITTED"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    FINISHED = "FINISHED"
    LOST = "LOST"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


class ComputeFailureCode(StrEnum):
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    PROVIDER_REJECTED = "PROVIDER_REJECTED"
    LEASE_EXPIRED = "LEASE_EXPIRED"
    WORKER_LOST = "WORKER_LOST"
    SUBMISSION_FAILED = "SUBMISSION_FAILED"
    ARTIFACT_TRANSFER_FAILED = "ARTIFACT_TRANSFER_FAILED"
    PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
    BUDGET_DENIED = "BUDGET_DENIED"
    RESERVATION_FAILED = "RESERVATION_FAILED"
    CANCEL_FAILED = "CANCEL_FAILED"
    METERING_UNAVAILABLE = "METERING_UNAVAILABLE"


class WorkloadReference(ContractModel):
    workload_type: Literal[
        "chemdft.pyscf.energy.v1",
        "chemdft.pyscf.optimization.v1",
        "chemdft.pyscf.frequency.v1",
        "chemdft.pyscf.orbital.v1",
        "chemdft.pyscf.tddft.v1",
        "chemdft.pyscf.thermochemistry.v1",
        "chemdft.pyscf.periodic-energy.v1",
        "chemdft.qe.periodic-energy.v1",
        "chemdft.xtb.energy.v1",
        "chemdft.xtb.optimization.v1",
        "chemdft.crest.conformer-search.v1",
        "chemdft.psi4.energy.v1",
        "chemdft.dftd4.correction.v1",
    ]
    workload_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]


class ComputeRequirement(ContractModel):
    cpu_count: int = Field(ge=1, le=256)
    memory_bytes: int = Field(ge=134_217_728)
    accelerator_kind: AcceleratorKind = AcceleratorKind.NONE
    accelerator_count: int = Field(default=0, ge=0, le=16)
    minimum_gpu_vram_bytes: int | None = Field(default=None, ge=0)
    temporary_storage_bytes: int = Field(default=1_073_741_824, ge=0)
    runtime_limit_seconds: int = Field(ge=1, le=86_400)
    network: Literal["NONE", "CONTROLLED"] = "NONE"
    isolation_class: IsolationClass
    reproducibility_class: ReproducibilityClass
    priority: int = Field(default=0, ge=0, le=100)


class MoneyAmount(ContractModel):
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
    minor_units: int = Field(ge=0)


class ComputeEstimate(ContractModel):
    id: UUID
    project_id: UUID
    requirement_hash: Sha256
    provider: Literal["local", "modal", "aws"]
    provider_summary: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    runtime_low_seconds: int | None = Field(default=None, ge=0)
    runtime_high_seconds: int | None = Field(default=None, ge=0)
    cost_low: MoneyAmount | None = None
    cost_high: MoneyAmount | None = None
    confidence: Literal["LOW", "MEDIUM", "HIGH"]
    assumptions: tuple[Annotated[str, StringConstraints(max_length=240)], ...] = Field(
        default=(), max_length=16
    )
    valid_until: datetime
    created_at: datetime


class ComputeReservationView(ContractModel):
    id: UUID
    project_id: UUID
    estimate_id: UUID
    authorized_max: MoneyAmount
    actual_cost: MoneyAmount | None = None
    state: Literal["RESERVED", "RELEASED", "DENIED"]
    created_at: datetime
    reconciled_at: datetime | None = None


class ProviderMeteringView(ContractModel):
    runtime_ms: int | None = Field(default=None, ge=0)
    cpu_ms: int | None = Field(default=None, ge=0)
    gpu_ms: int | None = Field(default=None, ge=0)
    provider_cost: MoneyAmount | None = None
    provider_cost_status: Literal["UNKNOWN", "AVAILABLE"] = "UNKNOWN"


class ExecutionRequest(ContractModel):
    calculation_id: UUID
    calculation_input_id: UUID
    workload: WorkloadReference
    requirement: ComputeRequirement
    requirement_hash: Sha256
    reservation_id: UUID
    correlation_id: UUID
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=200)]


class ComputeExecutionView(ContractModel):
    id: UUID
    project_id: UUID
    job_id: UUID
    calculation_id: UUID
    calculation_attempt_id: UUID | None = None
    provider: Literal["local", "modal", "aws"]
    state: ComputeExecutionState
    worker_id: Annotated[str, StringConstraints(max_length=160)] | None = None
    lease_owner: Annotated[str, StringConstraints(max_length=160)] | None = None
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    finished_at: datetime | None = None
    hardware_class: Annotated[str, StringConstraints(max_length=160)] | None = None
    metering: ProviderMeteringView | None = None
    failure_code: ComputeFailureCode | None = None
    diagnostic: Annotated[str, StringConstraints(max_length=1000)] | None = None


class JobSpecificationSummary(ContractModel):
    """What the job computes, read from the immutable calculation input (no new claim)."""

    task_type: Annotated[str, StringConstraints(max_length=64)] | None = None
    method: Annotated[str, StringConstraints(max_length=160)] | None = None
    basis: Annotated[str, StringConstraints(max_length=160)] | None = None
    charge: int | None = None
    multiplicity: int | None = Field(default=None, ge=1)


class JobStructureSummary(ContractModel):
    """Which structure version the job computes, read from the immutable calculation input."""

    structure_id: UUID | None = None
    structure_name: Annotated[str, StringConstraints(max_length=160)] | None = None
    structure_version_id: UUID | None = None
    structure_revision: int | None = Field(default=None, ge=0)
    formula_hill: Annotated[str, StringConstraints(max_length=160)] | None = None
    atom_count: int | None = Field(default=None, ge=0)


class ComputeJobView(ContractModel):
    id: UUID
    project_id: UUID
    calculation_id: UUID
    calculation_input_id: UUID
    workload: WorkloadReference
    requirement: ComputeRequirement
    requirement_hash: Sha256
    state: ComputeJobState
    provider: Literal["local", "modal", "aws"]
    priority: int
    estimate: ComputeEstimate | None = None
    reservation: ComputeReservationView | None = None
    latest_execution: ComputeExecutionView | None = None
    attempt_count: int = Field(ge=0)
    specification_summary: JobSpecificationSummary | None = None
    structure_summary: JobStructureSummary | None = None
    # On-demand AWS worker only: researcher-readable startup/pause message while the job waits
    # (e.g. "The AWS worker is starting ..."). None for every other job and deployment.
    worker_status: str | None = Field(default=None, max_length=300)
    submitted_by: UUID
    created_at: datetime
    updated_at: datetime


class ComputeJobListOutput(ContractModel):
    jobs: tuple[ComputeJobView, ...] = Field(max_length=10_000)
    # Additive (0.0.18). `total` = jobs matching the filters before paging; absent on older servers.
    total: int | None = Field(default=None, ge=0)
    next_offset: int | None = Field(default=None, ge=0)


class CalculationDetail(ContractModel):
    calculation: Calculation
    calculation_input_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    specification: CalculationSpecification | DispersionCorrectionSpecification
    attempt: CalculationAttempt | None = None
    result: CalculationResult | None = None
    compute_job: ComputeJobView | None = None
    compute_execution: ComputeExecutionView | None = None
    optimization_trajectory: OptimizationTrajectory | None = None


class OptimizationStep(ContractModel):
    index: int = Field(ge=0)
    coordinates_angstrom: tuple[tuple[float, float, float], ...] = Field(min_length=1)
    energy_hartree: float
    gradient_norm_hartree_per_bohr: float = Field(ge=0)
    gradient_rms_hartree_per_bohr: float | None = Field(default=None, ge=0)
    timestamp: datetime | None = None
    engine_cycle: int | None = Field(default=None, ge=1)
    evaluation_kind: Literal["OPTIMIZER", "FINAL_SINGLE_POINT"] = "OPTIMIZER"
    source_file: Literal["xtbopt.xyz", "xtbopt.log"] | None = None
    source_frame_index: int | None = Field(default=None, ge=0)
    source_sha256: Sha256 | None = None
    converged: bool | None = None


class OptimizationTrajectory(ContractModel):
    id: UUID
    calculation_id: UUID
    input_structure_version_id: UUID
    atom_identities: tuple[Atom, ...]
    steps: tuple[OptimizationStep, ...]
    state: Literal["QUEUED", "RUNNING", "CONVERGED", "NOT_CONVERGED", "FAILED", "CANCELED"]
    artifact_sha256: Sha256 | None = None
    final_structure_version_id: UUID | None = None
    engine: EngineReference | None = None
    input_hash: Sha256


CalculationDetail.model_rebuild()


class EngineMethodBasisPair(ContractModel):
    method: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    basis: Annotated[str, StringConstraints(min_length=1, max_length=120)]


class EngineCapabilityView(ContractModel):
    engine: str
    availability: Literal["AVAILABLE", "UNAVAILABLE", "MISCONFIGURED"]
    version: str | None = None
    supported_tasks: tuple[str, ...]
    supported_methods: tuple[str, ...]
    supported_basis_sets: tuple[str, ...]
    supported_method_basis_pairs: tuple[EngineMethodBasisPair, ...] = Field(
        default=(), max_length=128
    )
    supported_optimizers: tuple[str, ...] = ()
    supported_optimization_levels: tuple[str, ...] = ()
    # Highest atomic number the engine can run correctly per basis set (PySCF: no ECP is supplied).
    # Advisory for clients; the backend rejects unsupported inputs before queueing regardless.
    max_atomic_number_by_basis: dict[
        Annotated[str, StringConstraints(min_length=1, max_length=120)],
        Annotated[int, Field(ge=1, le=118)],
    ] = Field(default_factory=dict, max_length=32)
    diagnostic: str | None = None


class ResultCompareInput(ContractModel):
    left: EntityReference
    right: EntityReference
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=200)] | None = None


class ExperimentDatasetImportInput(ContractModel):
    experiment: EntityReference
    raw_artifact: ArtifactReference
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=200)] | None = None


class VisualizationSceneGetInput(ContractModel):
    subject: EntityReference
