# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import math
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from .base import (
    ArtifactReference,
    ContractModel,
    ContractVersion,
    EntityReference,
    NamespacedExtension,
    NamespacedIdentifier,
)


class ApproximationState(StrEnum):
    EXACT_AS_REPORTED = "EXACT_AS_REPORTED"
    APPROXIMATE = "APPROXIMATE"
    ESTIMATED = "ESTIMATED"


class UnitStandard(StrEnum):
    UCUM = "UCUM"
    QCSCHEMA = "QCSCHEMA"


class QuantityDimension(StrEnum):
    DIMENSIONLESS = "DIMENSIONLESS"
    LENGTH = "LENGTH"
    ENERGY = "ENERGY"
    FREQUENCY = "FREQUENCY"
    TEMPERATURE = "TEMPERATURE"
    PRESSURE = "PRESSURE"
    TIME = "TIME"
    MASS = "MASS"
    AMOUNT = "AMOUNT"
    INTENSITY = "INTENSITY"
    OTHER_DECLARED = "OTHER_DECLARED"


class UnitReference(ContractModel):
    standard: UnitStandard
    code: Annotated[
        str,
        StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_./*^(){}+-]{0,63}$"),
    ]
    dimension: QuantityDimension


class Precision(ContractModel):
    significant_figures: int | None = Field(default=None, ge=1, le=18)
    decimal_places: int | None = Field(default=None, ge=0, le=18)

    @model_validator(mode="after")
    def require_one_precision_form(self) -> Precision:
        if self.significant_figures is None and self.decimal_places is None:
            raise ValueError("At least one precision field is required")
        return self


class ScientificQuantity(ContractModel):
    value: float
    unit: UnitReference
    source_unit: UnitReference | None = None
    uncertainty: float | None = Field(default=None, ge=0)
    precision: Precision | None = None
    approximation: ApproximationState = ApproximationState.EXACT_AS_REPORTED

    @field_validator("value", "uncertainty")
    @classmethod
    def finite_numbers_only(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("Scientific quantities must be finite")
        return value


class SampleType(StrEnum):
    PHYSICAL = "PHYSICAL"
    CONCEPTUAL = "CONCEPTUAL"


class Sample(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    description: Annotated[str, StringConstraints(max_length=4000)] | None = None
    sample_type: SampleType
    parent_sample_id: UUID | None = None
    created_by: UUID
    created_at: datetime
    extensions: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)


class StructureKind(StrEnum):
    MOLECULE = "MOLECULE"
    ION = "ION"
    RADICAL = "RADICAL"
    COMPLEX = "COMPLEX"
    PERIODIC = "PERIODIC"


class Structure(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    kind: StructureKind
    sample_ids: tuple[UUID, ...] = Field(default=(), max_length=256)
    created_by: UUID
    created_at: datetime


class StructureVersionOrigin(StrEnum):
    IMPORTED = "IMPORTED"
    MANUALLY_EDITED = "MANUALLY_EDITED"
    GENERATED = "GENERATED"
    OPTIMIZED = "OPTIMIZED"
    DERIVED = "DERIVED"
    AI_PROPOSED = "AI_PROPOSED"
    RECONSTRUCTED = "RECONSTRUCTED"
    IMPORTED_CALCULATION = "IMPORTED_CALCULATION"


class CoordinateSystem(StrEnum):
    CARTESIAN = "CARTESIAN"
    FRACTIONAL = "FRACTIONAL"


class CoordinateUnit(StrEnum):
    ANGSTROM = "angstrom"
    BOHR = "bohr"


class DiagnosticSeverity(StrEnum):
    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


class StructureDiagnosticCode(StrEnum):
    UNKNOWN_ELEMENT = "UNKNOWN_ELEMENT"
    ATOMIC_NUMBER_MISMATCH = "ATOMIC_NUMBER_MISMATCH"
    INVALID_BOND_INDEX = "INVALID_BOND_INDEX"
    DUPLICATE_BOND = "DUPLICATE_BOND"
    SANITIZATION_FAILED = "SANITIZATION_FAILED"
    UNUSUAL_VALENCE = "UNUSUAL_VALENCE"
    MISSING_CONNECTIVITY = "MISSING_CONNECTIVITY"
    PARTIAL_OCCUPANCY = "PARTIAL_OCCUPANCY"
    DISORDERED_SITE = "DISORDERED_SITE"
    UNSUPPORTED_FEATURE = "UNSUPPORTED_FEATURE"
    PARSER_WARNING = "PARSER_WARNING"


class StructureDiagnostic(ContractModel):
    severity: DiagnosticSeverity
    code: StructureDiagnosticCode
    message: Annotated[str, StringConstraints(min_length=1, max_length=400)]
    atom_index: int | None = Field(default=None, ge=0)


class Atom(ContractModel):
    index: int = Field(ge=0)
    atomic_number: int = Field(ge=1, le=118)
    element: Annotated[str, StringConstraints(pattern=r"^[A-Z][a-z]?$", max_length=2)]
    x: float
    y: float
    z: float
    isotope: int | None = Field(default=None, ge=1)
    formal_charge: int | None = None
    label: Annotated[str, StringConstraints(max_length=80)] | None = None
    occupancy: float | None = Field(default=None, gt=0, le=1)


class Bond(ContractModel):
    atom_index_a: int = Field(ge=0)
    atom_index_b: int = Field(ge=0)
    order: float | None = Field(default=None, gt=0, le=4)


class CoordinateSet(ContractModel):
    structure_version_id: UUID
    coordinate_system: CoordinateSystem
    unit: CoordinateUnit
    dimensionality: Literal[3] = 3
    atom_ordering: Literal["AS_LISTED"] = "AS_LISTED"
    source: EntityReference | ArtifactReference
    atoms: tuple[Atom, ...] = Field(min_length=1, max_length=10_000)
    bonds: tuple[Bond, ...] = Field(default=(), max_length=40_000)

    @model_validator(mode="after")
    def validate_atom_order(self) -> CoordinateSet:
        indices = [atom.index for atom in self.atoms]
        if indices != list(range(len(indices))):
            raise ValueError("Atom indices must be contiguous and match serialized ordering")
        atom_count = len(indices)
        if any(
            bond.atom_index_a >= atom_count
            or bond.atom_index_b >= atom_count
            or bond.atom_index_a == bond.atom_index_b
            for bond in self.bonds
        ):
            raise ValueError(
                "Bond references must identify two distinct atoms in the coordinate set"
            )
        return self


class PeriodicCell(ContractModel):
    unit: CoordinateUnit = CoordinateUnit.ANGSTROM
    a: float = Field(gt=0)
    b: float = Field(gt=0)
    c: float = Field(gt=0)
    alpha: float = Field(gt=0, lt=180)
    beta: float = Field(gt=0, lt=180)
    gamma: float = Field(gt=0, lt=180)
    lattice_vectors: tuple[
        tuple[float, float, float],
        tuple[float, float, float],
        tuple[float, float, float],
    ]
    periodic_dimensions: tuple[Literal[True], Literal[True], Literal[True]] = (
        True,
        True,
        True,
    )

    @field_validator("a", "b", "c", "alpha", "beta", "gamma")
    @classmethod
    def finite_cell_numbers_only(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Periodic cell values must be finite")
        return value

    @field_validator("lattice_vectors")
    @classmethod
    def finite_lattice_vectors(
        cls,
        value: tuple[
            tuple[float, float, float],
            tuple[float, float, float],
            tuple[float, float, float],
        ],
    ) -> tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]:
        if any(not math.isfinite(component) for row in value for component in row):
            raise ValueError("Periodic lattice vectors must be finite")
        return value


class StructureVersion(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    structure_id: UUID
    revision: int = Field(ge=1)
    origin: StructureVersionOrigin
    parent_version_id: UUID | None = None
    representation_artifacts: tuple[ArtifactReference, ...] = Field(min_length=1, max_length=32)
    coordinates: CoordinateSet | None = None
    periodic_cell: PeriodicCell | None = None
    diagnostics: tuple[StructureDiagnostic, ...] = Field(default=(), max_length=128)
    overall_charge: int
    multiplicity: int = Field(ge=1)
    created_by: UUID
    created_at: datetime

    @model_validator(mode="after")
    def references_match_version(self) -> StructureVersion:
        if self.coordinates and self.coordinates.structure_version_id != self.id:
            raise ValueError("Coordinates must identify their owning structure version")
        if any(ref.project_id != self.project_id for ref in self.representation_artifacts):
            raise ValueError("Structure artifact references must remain within the project")
        if self.coordinates and self.coordinates.source.project_id != self.project_id:
            raise ValueError("Coordinate source must remain within the project")
        if self.periodic_cell and not self.coordinates:
            raise ValueError("Periodic versions require coordinates")
        if (
            self.periodic_cell
            and self.coordinates.coordinate_system is not CoordinateSystem.FRACTIONAL
        ):
            raise ValueError("Periodic versions use canonical fractional coordinates")
        return self


class Conformer(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    structure_version_id: UUID
    rank: int | None = Field(default=None, ge=1)
    relative_energy: ScientificQuantity | None = None
    generation_method: NamespacedIdentifier
    coordinates: CoordinateSet
    created_at: datetime

    @model_validator(mode="after")
    def coordinates_match_parent(self) -> Conformer:
        if self.coordinates.structure_version_id != self.structure_version_id:
            raise ValueError("Conformer coordinates must reference the parent structure version")
        if self.coordinates.source.project_id != self.project_id:
            raise ValueError("Conformer coordinate source must remain within the project")
        return self


class ExperimentModality(StrEnum):
    FTIR = "FTIR"
    RAMAN = "RAMAN"
    NMR = "NMR"
    HRMS = "HRMS"
    XRD = "XRD"
    UV_VIS = "UV_VIS"
    TG_DTA = "TG_DTA"
    DLS = "DLS"
    OTHER = "OTHER"


class AcquisitionCondition(ContractModel):
    name: NamespacedIdentifier
    value: ScientificQuantity | Annotated[str, StringConstraints(max_length=256)]


class FtirExtension(ContractModel):
    modality: Literal["FTIR"] = "FTIR"
    schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    settings: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)


class NmrExtension(ContractModel):
    modality: Literal["NMR"] = "NMR"
    schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    nuclei: tuple[Annotated[str, StringConstraints(min_length=1, max_length=16)], ...] = Field(
        default=(), max_length=32
    )
    settings: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)


class HrmsExtension(ContractModel):
    modality: Literal["HRMS"] = "HRMS"
    schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    ionization_mode: Annotated[str, StringConstraints(max_length=80)] | None = None
    settings: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)


class XrdExtension(ContractModel):
    modality: Literal["XRD"] = "XRD"
    schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    radiation_source: Annotated[str, StringConstraints(max_length=120)] | None = None
    settings: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)


class UvVisExtension(ContractModel):
    modality: Literal["UV_VIS"] = "UV_VIS"
    schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    settings: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)


class TgDtaExtension(ContractModel):
    modality: Literal["TG_DTA"] = "TG_DTA"
    schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    settings: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)


class DlsExtension(ContractModel):
    modality: Literal["DLS"] = "DLS"
    schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    settings: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)


class OtherExperimentExtension(ContractModel):
    modality: Literal["OTHER"] = "OTHER"
    schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    modality_identifier: NamespacedIdentifier
    settings: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)


ExperimentExtension = Annotated[
    FtirExtension
    | NmrExtension
    | HrmsExtension
    | XrdExtension
    | UvVisExtension
    | TgDtaExtension
    | DlsExtension
    | OtherExperimentExtension,
    Field(discriminator="modality"),
]

SpectrumExtension = Annotated[
    FtirExtension | NmrExtension | HrmsExtension | XrdExtension | UvVisExtension,
    Field(discriminator="modality"),
]


class Experiment(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    sample_id: UUID
    modality: ExperimentModality
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    instrument_reference: Annotated[str, StringConstraints(max_length=256)] | None = None
    conditions: tuple[AcquisitionCondition, ...] = Field(default=(), max_length=128)
    operator_or_source: Annotated[str, StringConstraints(max_length=256)] | None = None
    acquired_at: datetime | None = None
    extension: ExperimentExtension | None = None
    created_by: UUID
    created_at: datetime

    @model_validator(mode="after")
    def extension_matches_modality(self) -> Experiment:
        if self.extension and self.extension.modality != self.modality:
            raise ValueError("Experiment extension must match its modality")
        return self


class DatasetProcessingState(StrEnum):
    RAW = "RAW"
    NORMALIZED = "NORMALIZED"
    DERIVED = "DERIVED"


class ProcessingStep(ContractModel):
    algorithm: NamespacedIdentifier
    algorithm_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    parameters: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)
    actor_id: UUID
    performed_at: datetime


class ExperimentalDataset(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    experiment_id: UUID
    state: DatasetProcessingState
    artifact: ArtifactReference
    input_dataset_ids: tuple[UUID, ...] = Field(default=(), max_length=256)
    processing: tuple[ProcessingStep, ...] = Field(default=(), max_length=64)
    created_at: datetime

    @model_validator(mode="after")
    def raw_data_has_no_processing(self) -> ExperimentalDataset:
        if self.state is DatasetProcessingState.RAW and (self.input_dataset_ids or self.processing):
            raise ValueError("Raw datasets cannot claim derived processing")
        if self.artifact.project_id != self.project_id:
            raise ValueError("Dataset artifact must remain within the project")
        return self


class AxisDefinition(ContractModel):
    label: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    unit: UnitReference
    direction: Literal["ASCENDING", "DESCENDING"]


class Spectrum(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    dataset_id: UUID
    modality: Literal["FTIR", "NMR", "HRMS", "XRD", "UV_VIS"]
    x_axis: AxisDefinition
    y_axis: AxisDefinition
    data_artifact: ArtifactReference
    point_count: int = Field(ge=1)
    processing_state: DatasetProcessingState
    extension: SpectrumExtension | None = None

    @model_validator(mode="after")
    def extension_matches_spectrum(self) -> Spectrum:
        if self.data_artifact.project_id != self.project_id:
            raise ValueError("Spectrum data artifact must remain within the project")
        if self.extension and self.extension.modality != self.modality:
            raise ValueError("Spectrum extension must match its modality")
        return self


class ExperimentalSeries(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    dataset_id: UUID
    modality: Literal["TG_DTA", "DLS"]
    axes: tuple[AxisDefinition, ...] = Field(min_length=2, max_length=8)
    data_artifact: ArtifactReference
    point_count: int = Field(ge=1)
    extension: TgDtaExtension | DlsExtension | None = None

    @model_validator(mode="after")
    def extension_matches_series(self) -> ExperimentalSeries:
        if self.data_artifact.project_id != self.project_id:
            raise ValueError("Experimental series artifact must remain within the project")
        if self.extension and self.extension.modality != self.modality:
            raise ValueError("Experimental series extension must match its modality")
        return self


class CalculationTaskType(StrEnum):
    ENERGY = "ENERGY"
    PERIODIC_ENERGY = "PERIODIC_ENERGY"
    GEOMETRY_OPTIMIZATION = "GEOMETRY_OPTIMIZATION"
    FREQUENCY = "FREQUENCY"
    NMR = "NMR"
    ORBITAL = "ORBITAL"
    ESP = "ESP"
    TDDFT = "TDDFT"
    CONFORMER_EVALUATION = "CONFORMER_EVALUATION"
    CONFORMER_SEARCH = "CONFORMER_SEARCH"
    THERMOCHEMISTRY = "THERMOCHEMISTRY"


class ScientificMethodReference(ContractModel):
    identifier: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    display_name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    registry: NamespacedIdentifier
    registry_version: Annotated[str, StringConstraints(max_length=64)] | None = None


class BasisSetReference(ContractModel):
    identifier: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    display_name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    registry: NamespacedIdentifier
    registry_version: Annotated[str, StringConstraints(max_length=64)] | None = None


class EngineReference(ContractModel):
    """Server-issued identity of the engine that actually executed an attempt."""

    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    adapter_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    environment_artifact: ArtifactReference | None = None
    capabilities: tuple[NamespacedIdentifier, ...] = Field(default=(), max_length=128)
    execution_backend: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    environment_digest: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None = None
    hardware_class: Annotated[str, StringConstraints(max_length=120)] | None = None
    library_versions: tuple[NamespacedExtension, ...] = Field(default=(), max_length=16)


class EnginePreference(ContractModel):
    """Public scientific preference. It contains no execution attestation or identity."""

    engine: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,31}$")]
    allowed_version: Annotated[str, StringConstraints(max_length=64)] | None = None
    requested_capability: NamespacedIdentifier | None = None
    execution_preference: Annotated[str, StringConstraints(max_length=80)] | None = None


class SolvationModel(ContractModel):
    model: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    solvent: Annotated[str, StringConstraints(min_length=1, max_length=120)]


class CalculationConstraint(ContractModel):
    kind: NamespacedIdentifier
    atom_indices: tuple[int, ...] = Field(min_length=1, max_length=8)
    target: ScientificQuantity | None = None


class ScfOptions(ContractModel):
    convergence_threshold: float | None = Field(default=None, gt=0)
    max_iterations: int | None = Field(default=None, ge=1, le=100_000)
    reference: Annotated[str, StringConstraints(max_length=32)] | None = None


class OptimizationOptions(ContractModel):
    optimizer: Literal["geometric", "xtb-ancopt"] = "geometric"
    xtb_level: Literal["normal"] | None = None
    max_steps: int = Field(default=100, ge=1, le=500)
    convergence_energy: float | None = Field(default=None, gt=0)
    convergence_grms: float | None = Field(default=None, gt=0)
    convergence_gmax: float | None = Field(default=None, gt=0)
    convergence_drms: float | None = Field(default=None, gt=0)
    convergence_dmax: float | None = Field(default=None, gt=0)
    coordinate_unit: Literal["angstrom"] = "angstrom"
    energy_unit: Literal["Eh"] = "Eh"
    gradient_unit: Literal["Eh/bohr"] = "Eh/bohr"
    displacement_unit: Literal["angstrom"] = "angstrom"


class HessianOptions(ContractModel):
    strategy: Literal["ANALYTIC"]
    exclude_translation_rotation: Literal[True]
    coordinate_unit: Literal["angstrom"]
    hessian_unit: Literal["Eh/bohr^2"]
    frequency_unit: Literal["cm^-1"]


class TddftOptions(ContractModel):
    nstates: int = Field(default=10, ge=1, le=100)
    spin: Literal["singlet"] = "singlet"
    gauge: Literal["length"] = "length"
    conv_tol: float | None = Field(default=None, gt=0)


class RamanOptions(ContractModel):
    method: Literal["placzek_static"] = "placzek_static"
    polarizability_method: Literal["finite_electric_field"] = "finite_electric_field"
    electric_field_step_au: float = Field(default=0.0010, gt=0)
    polarizability_derivative_step_angstrom_amu_half: float = Field(default=0.0100, gt=0)
    symmetrize_polarizability: bool = True
    antisymmetry_tolerance: float = Field(default=1e-4, gt=0)


THERMOCHEMISTRY_TEMPERATURE_RANGE_K = (50.0, 2000.0)
THERMOCHEMISTRY_PRESSURE_RANGE_PA = (1.0e2, 1.0e8)
STANDARD_ATMOSPHERE_PA = 101325.0
DEFAULT_THERMOCHEMISTRY_TEMPERATURE_K = 298.15
LOW_FREQUENCY_WARNING_CM1 = 100.0


class ThermochemistryOptions(ContractModel):
    """Ideal-gas rigid-rotor harmonic-oscillator thermochemistry from a validated frequency result.

    No SCF, optimization or Hessian is ever (re)run for this task: it consumes persisted
    geometry, harmonic frequencies and electronic energy.
    """

    source_frequency_result_id: UUID
    temperature_k: float = Field(
        default=DEFAULT_THERMOCHEMISTRY_TEMPERATURE_K,
        ge=THERMOCHEMISTRY_TEMPERATURE_RANGE_K[0],
        le=THERMOCHEMISTRY_TEMPERATURE_RANGE_K[1],
    )
    pressure_pa: float = Field(
        default=STANDARD_ATMOSPHERE_PA,
        ge=THERMOCHEMISTRY_PRESSURE_RANGE_PA[0],
        le=THERMOCHEMISTRY_PRESSURE_RANGE_PA[1],
    )
    thermo_model: Literal["ideal-gas-rrho"] = "ideal-gas-rrho"
    imaginary_mode_policy: Literal["reject"] = "reject"
    low_frequency_warning_cm1: Literal[100.0] = LOW_FREQUENCY_WARNING_CM1
    symmetry_number_override: int | None = Field(default=None, ge=1, le=120)
    symmetry_override_reason: (
        Annotated[str, StringConstraints(min_length=10, max_length=500)] | None
    ) = None

    @model_validator(mode="after")
    def validate_conditions_and_override(self) -> ThermochemistryOptions:
        if not (math.isfinite(self.temperature_k) and math.isfinite(self.pressure_pa)):
            raise ValueError("Temperature and pressure must be finite")
        if (self.symmetry_number_override is None) != (self.symmetry_override_reason is None):
            raise ValueError(
                "A symmetry-number override and its scientific reason must be given together"
            )
        return self


class ConformerSearchOptions(ContractModel):
    workflow: Literal["imtd-gc"] = "imtd-gc"
    energy_window_kcal_mol: Literal[6.0] = 6.0
    rmsd_threshold_angstrom: Literal[0.125] = 0.125
    energy_threshold_kcal_mol: Literal[0.05] = 0.05
    rotational_constant_threshold: Literal[0.01] = 0.01
    optimization_level: Literal["vtight"] = "vtight"
    threads: Literal[2] = 2
    timeout_seconds: int = Field(default=1800, ge=1, le=3600)


class PeriodicOptions(ContractModel):
    """Periodic (crystal) DFT calculation options for PySCF PBC."""

    k_mesh: tuple[int, int, int] = Field(default=(1, 1, 1))
    u_effective_ev: dict[str, float] = Field(default_factory=dict)
    magnetic_order: Literal["none", "ferromagnetic", "antiferromagnetic"] = "none"
    # Fixed by the worker (not user settings): Fermi smearing 0.005 Ha, density fitting, GTH-PBE,
    # exp_to_discard 0.1, max_cycle 80, conv_tol 1e-6.
    # Quantum ESPRESSO plane-wave engine only (engine_preference.engine == "qe"); the PySCF
    # engine refuses them. Cutoffs and pseudopotentials are fixed by the SSSP library and are
    # not user options. There is no cell relaxation.
    relax: bool = False
    relax_max_steps: int = Field(default=30, ge=1, le=30)
    dos: bool = False
    dos_k_mesh: tuple[int, int, int] = Field(default=(6, 6, 6))
    bands: bool = False


class CalculationSpecification(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    task_type: CalculationTaskType
    method: ScientificMethodReference
    basis: BasisSetReference | None = None
    dispersion: ScientificMethodReference | None = None
    solvation: SolvationModel | None = None
    charge: int
    multiplicity: int = Field(ge=1)
    constraints: tuple[CalculationConstraint, ...] = Field(default=(), max_length=256)
    scf: ScfOptions | None = None
    optimization: OptimizationOptions | None = None
    conformer_search: ConformerSearchOptions | None = None
    hessian: HessianOptions | None = None
    tddft: TddftOptions | None = None
    raman: RamanOptions | None = None
    thermochemistry: ThermochemistryOptions | None = None
    # Hidden from the published JSON schema (and so from the AI tool schemas): periodic setup is a
    # Calculation-panel feature; the AI Scientist does not plan periodic calculations.
    periodic: SkipJsonSchema[PeriodicOptions | None] = None
    property_requests: tuple[NamespacedIdentifier, ...] = Field(default=(), max_length=128)
    engine_preference: EnginePreference
    engine_extensions: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)

    @field_validator("charge", "multiplicity", mode="before")
    @classmethod
    def require_integer_electronic_state(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("Electronic-state declarations must be integers, not coerced values.")
        return value


class CalculationInput(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    calculation_id: UUID
    structure_version: EntityReference
    conformer: EntityReference | None = None
    specification: CalculationSpecification
    normalized_input_artifact: ArtifactReference
    created_at: datetime

    @model_validator(mode="after")
    def enforce_input_project_scope(self) -> CalculationInput:
        references = [self.structure_version.project_id, self.normalized_input_artifact.project_id]
        if self.conformer:
            references.append(self.conformer.project_id)
        if any(project_id != self.project_id for project_id in references):
            raise ValueError("Calculation inputs cannot reference another project")
        if self.structure_version.entity_type != "structure.version":
            raise ValueError("Calculation input requires a StructureVersion reference")
        if self.conformer and self.conformer.entity_type != "structure.conformer":
            raise ValueError("Calculation conformer reference has the wrong entity type")
        return self


class CalculationLifecycle(StrEnum):
    DRAFT = "DRAFT"
    VALIDATED = "VALIDATED"
    AUTHORIZED = "AUTHORIZED"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


class Calculation(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    input_id: UUID
    state: CalculationLifecycle
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class CalculationFailureCode(StrEnum):
    ENGINE_UNAVAILABLE = "ENGINE_UNAVAILABLE"
    ENGINE_VERSION_UNSUPPORTED = "ENGINE_VERSION_UNSUPPORTED"
    UNSUPPORTED_TASK = "UNSUPPORTED_TASK"
    UNSUPPORTED_METHOD = "UNSUPPORTED_METHOD"
    UNSUPPORTED_BASIS = "UNSUPPORTED_BASIS"
    INVALID_CHARGE_MULTIPLICITY = "INVALID_CHARGE_MULTIPLICITY"
    INVALID_COORDINATES = "INVALID_COORDINATES"
    RESOURCE_LIMIT_EXCEEDED = "RESOURCE_LIMIT_EXCEEDED"
    EXECUTION_TIMEOUT = "EXECUTION_TIMEOUT"
    ENGINE_CRASHED = "ENGINE_CRASHED"
    NONCONVERGED = "NONCONVERGED"
    OUTPUT_MISSING = "OUTPUT_MISSING"
    PARSE_FAILED = "PARSE_FAILED"
    RESULT_VALIDATION_FAILED = "RESULT_VALIDATION_FAILED"
    FIREWALL_REJECTED = "FIREWALL_REJECTED"
    CANCELED = "CANCELED"


class CalculationAttempt(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    calculation_id: UUID
    attempt_number: int = Field(ge=1)
    state: CalculationLifecycle
    worker_id: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    engine_identity: EngineReference | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    failure_code: CalculationFailureCode | None = None
    diagnostic: Annotated[str, StringConstraints(max_length=1000)] | None = None
    raw_artifacts: tuple[ArtifactReference, ...] = Field(default=(), max_length=256)
