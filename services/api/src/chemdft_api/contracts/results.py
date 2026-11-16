# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .base import ArtifactReference, ContractModel, ContractVersion, NamespacedIdentifier
from .conformers import ConformerEnsembleResult
from .dftd4 import DispersionCorrectedEnergyResult, NativeDispersionCorrectedEnergyResult
from .provenance import ProvenanceClass, VerificationState
from .result_state import EffectiveResultState
from .scientific import CalculationTaskType, EngineReference, ScientificQuantity
from .volumetric import VolumetricGridMetadata


class ResultAuthority(StrEnum):
    CANDIDATE = "CANDIDATE"
    AUTHORITATIVE = "AUTHORITATIVE"
    VERIFICATION = "VERIFICATION"
    IMPORTED = "IMPORTED"


class ResultValidationState(StrEnum):
    PENDING = "PENDING"
    VALIDATED = "VALIDATED"
    REJECTED = "REJECTED"
    DISPUTED = "DISPUTED"
    SUPERSEDED = "SUPERSEDED"


class NamedScientificQuantity(ContractModel):
    name: NamespacedIdentifier
    quantity: ScientificQuantity


class ScientificResultPayload(ContractModel):
    payload_schema: NamespacedIdentifier
    payload_schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    quantities: tuple[NamedScientificQuantity, ...] = Field(default=(), max_length=512)
    artifacts: tuple[ArtifactReference, ...] = Field(default=(), max_length=256)

    @model_validator(mode="after")
    def require_payload_content(self) -> ScientificResultPayload:
        if not self.quantities and not self.artifacts:
            raise ValueError("A scientific result payload must reference typed values or artifacts")
        return self


class EnergyResult(ContractModel):
    payload_schema: Literal["chemdft.energy"] = "chemdft.energy"
    payload_schema_version: Literal["1.0.0"] = "1.0.0"
    task_type: Literal[CalculationTaskType.ENERGY] = CalculationTaskType.ENERGY
    total_energy: ScientificQuantity
    converged: Literal[True] = True
    method: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    basis: Annotated[str, StringConstraints(min_length=1, max_length=120)] | None = None
    scf_iterations: int | None = Field(default=None, ge=0)
    parser_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    validator_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]


class OptimizationResult(ContractModel):
    payload_schema: Literal["chemdft.optimization"] = "chemdft.optimization"
    payload_schema_version: Literal["1.0.0"] = "1.0.0"
    task_type: Literal[CalculationTaskType.GEOMETRY_OPTIMIZATION] = (
        CalculationTaskType.GEOMETRY_OPTIMIZATION
    )
    trajectory_artifact: ArtifactReference
    trajectory_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    final_structure_version_id: UUID
    final_structure_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    final_energy: ScientificQuantity
    step_count: int = Field(ge=1)
    optimization_iterations: int | None = Field(default=None, ge=1)
    method: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    basis: Annotated[str, StringConstraints(min_length=1, max_length=120)] | None
    converged: Literal[True] = True
    parser_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    validator_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]


class VibrationalMode(ContractModel):
    index: int = Field(ge=0)
    frequency_cm1: float
    imaginary: bool
    displacement_vectors: tuple[tuple[float, float, float], ...]
    reduced_mass_amu: float | None = Field(default=None, gt=0)
    ir_intensity: ScientificQuantity | None = None
    raman_activity: ScientificQuantity | None = None
    depolarization_ratio: float | None = Field(default=None, ge=0.0, le=0.751)

    @model_validator(mode="after")
    def validate_mode(self) -> VibrationalMode:
        if not math.isfinite(self.frequency_cm1):
            raise ValueError("Mode frequency must be finite")
        if self.imaginary != (self.frequency_cm1 < 0):
            raise ValueError("Imaginary mode state must match the signed frequency")
        if self.depolarization_ratio is not None and not math.isfinite(self.depolarization_ratio):
            raise ValueError("Depolarization ratio must be finite")
        if not self.displacement_vectors or any(
            len(vector) != 3 or any(not math.isfinite(value) for value in vector)
            for vector in self.displacement_vectors
        ):
            raise ValueError("Mode displacement vectors must be finite Cartesian triples")
        return self


class VibrationalAnalysis(ContractModel):
    payload_schema: Literal["chemdft.vibrational-analysis"]
    payload_schema_version: Literal["1.0.0"]
    task_type: Literal[CalculationTaskType.FREQUENCY]
    calculation_id: UUID
    input_structure_version_id: UUID
    input_structure_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    calculation_specification_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    engine: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    engine_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    method: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    basis: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    charge: int
    multiplicity: int = Field(ge=1)
    atom_identities: tuple[Annotated[str, StringConstraints(pattern=r"^[A-Z][a-z]?$")], ...] = (
        Field(min_length=1)
    )
    equilibrium_coordinates_angstrom: tuple[tuple[float, float, float], ...] = Field(min_length=1)
    equilibrium_coordinates_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    hessian_artifact: ArtifactReference
    hessian_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    hessian_unit: Literal["Eh/bohr^2"]
    modes: tuple[VibrationalMode, ...] = Field(min_length=1)
    expected_vibrational_mode_count: int = Field(ge=1)
    mode_ordering: Literal["ascending_eigenvalue"]
    vector_convention: Literal["pyscf_thermo_norm_mode"]
    vector_unit: Literal["amu^-1/2"]
    hessian_type: Literal["analytic"] = "analytic"
    dipole_derivative_method: Literal["central_finite_difference"] | None = None
    finite_difference_step_bohr: float | None = None
    intensity_unit: Literal["km/mol"] | None = None
    raman_method: Literal["placzek_static"] | None = None
    polarizability_method: Literal["finite_electric_field"] | None = None
    electric_field_step_au: float | None = None
    polarizability_derivative_method: (
        Literal["central_normal_coordinate_difference"] | None
    ) = None
    polarizability_derivative_step_angstrom_amu_half: float | None = None
    polarizability_unit: Literal["angstrom^3"] | None = None
    raman_activity_unit: Literal["angstrom^4/amu", "Angstrom^4/amu"] | None = None
    polarizability_tensor_symmetrization: bool | None = None
    polarizability_antisymmetry_tolerance: float | None = None
    raman_artifact: ArtifactReference | None = None
    raman_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None = None
    coordinate_unit: Literal["angstrom"]
    frequency_unit: Literal["cm^-1"]
    parser_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    adapter_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    schema_version: Literal["1.0.0"]
    result_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]

    @model_validator(mode="after")
    def validate_analysis(self) -> VibrationalAnalysis:
        atom_count = len(self.atom_identities)
        if len(self.equilibrium_coordinates_angstrom) != atom_count:
            raise ValueError("Equilibrium coordinates must match atom ordering")
        if any(
            len(vector) != 3 or any(not math.isfinite(value) for value in vector)
            for vector in self.equilibrium_coordinates_angstrom
        ):
            raise ValueError("Equilibrium coordinates must be finite Cartesian triples")
        if len(self.modes) != self.expected_vibrational_mode_count:
            raise ValueError("Mode count differs from expected vibrational dimensionality")
        if [mode.index for mode in self.modes] != list(range(len(self.modes))):
            raise ValueError("Mode indices must be contiguous and in engine ordering")
        if any(len(mode.displacement_vectors) != atom_count for mode in self.modes):
            raise ValueError("Each mode must contain one displacement vector per atom")
        if self.hessian_artifact.sha256 != self.hessian_sha256:
            raise ValueError("Hessian artifact hash mismatch")
        if self.raman_artifact and self.raman_artifact.sha256 != self.raman_sha256:
            raise ValueError("Raman artifact hash mismatch")
        expected_hash = vibrational_analysis_hash(self)
        if self.result_sha256 != expected_hash:
            raise ValueError(
                f"Vibrational result hash mismatch: {self.result_sha256} != {expected_hash}"
            )
        return self


class MolecularOrbital(ContractModel):
    index: int = Field(ge=0)
    spin_channel: Literal["restricted", "alpha", "beta"]
    occupation: float = Field(ge=0, le=2)
    energy_hartree: float
    energy_ev: float

    @model_validator(mode="after")
    def validate_energy(self) -> MolecularOrbital:
        if not math.isfinite(self.energy_hartree) or not math.isfinite(self.energy_ev):
            raise ValueError("Molecular orbital energies must be finite")
        if not math.isclose(
            self.energy_ev, self.energy_hartree * 27.211386245988, rel_tol=1e-10, abs_tol=1e-10
        ):
            raise ValueError("Molecular orbital eV conversion is inconsistent")
        return self


class OrbitalFrontier(ContractModel):
    spin_channel: Literal["restricted", "alpha", "beta"]
    homo_index: int = Field(ge=0)
    homo_energy_hartree: float
    homo_energy_ev: float
    lumo_index: int = Field(ge=0)
    lumo_energy_hartree: float
    lumo_energy_ev: float
    gap_hartree: float = Field(gt=0)
    gap_ev: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_frontier(self) -> OrbitalFrontier:
        values = (
            self.homo_energy_hartree,
            self.homo_energy_ev,
            self.lumo_energy_hartree,
            self.lumo_energy_ev,
            self.gap_hartree,
            self.gap_ev,
        )
        if any(not math.isfinite(value) for value in values):
            raise ValueError("Frontier orbital energies must be finite")
        if not math.isclose(
            self.gap_hartree,
            self.lumo_energy_hartree - self.homo_energy_hartree,
            rel_tol=1e-10,
            abs_tol=1e-10,
        ):
            raise ValueError("HOMO-LUMO gap is inconsistent with frontier orbital energies")
        if not math.isclose(
            self.gap_ev, self.gap_hartree * 27.211386245988, rel_tol=1e-10, abs_tol=1e-10
        ):
            raise ValueError("HOMO-LUMO gap eV conversion is inconsistent")
        if self.lumo_energy_hartree <= self.homo_energy_hartree:
            raise ValueError("LUMO energy must exceed HOMO energy")
        return self


class MolecularOrbitalAnalysis(ContractModel):
    payload_schema: Literal["chemdft.molecular-orbitals"]
    payload_schema_version: Literal["1.0.0"]
    task_type: Literal[CalculationTaskType.ORBITAL]
    calculation_id: UUID
    input_structure_id: UUID
    input_structure_version_id: UUID
    input_structure_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    calculation_input_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    result_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    engine: Literal["pyscf"]
    engine_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    method: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    basis: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    charge: int
    multiplicity: int = Field(ge=1)
    converged: Literal[True] = True
    total_energy_hartree: float
    scf_iterations: int | None = Field(default=None, ge=0)
    electron_count: int = Field(ge=1)
    alpha_electron_count: int = Field(ge=0)
    beta_electron_count: int = Field(ge=0)
    basis_function_count: int = Field(ge=1)
    molecular_orbital_count: int = Field(ge=1)
    orbitals: tuple[MolecularOrbital, ...] = Field(min_length=1, max_length=10000)
    frontier_by_spin: tuple[OrbitalFrontier, ...] = Field(min_length=1, max_length=2)
    coefficient_artifact: ArtifactReference
    coefficient_artifact_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    coefficient_format: Literal["chemdft.mo-coefficients.npz"]
    energy_unit: Literal["Eh"] = "Eh"
    converted_energy_unit: Literal["eV"] = "eV"
    orbital_gap_label: Literal["HOMO-LUMO orbital-energy gap"] = "HOMO-LUMO orbital-energy gap"
    orbital_gap_note: Literal["Orbital-energy difference; not an excited-state calculation."] = (
        "Orbital-energy difference; not an excited-state calculation."
    )
    producer: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    adapter_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    schema_version: Literal["1.0.0"]

    @model_validator(mode="after")
    def validate_orbitals(self) -> MolecularOrbitalAnalysis:
        if not math.isfinite(self.total_energy_hartree):
            raise ValueError("Total SCF energy must be finite")
        if self.coefficient_artifact.sha256 != self.coefficient_artifact_sha256:
            raise ValueError("Coefficient artifact hash mismatch")
        if self.electron_count != self.alpha_electron_count + self.beta_electron_count:
            raise ValueError("Spin-resolved electron counts must sum to the electron count")
        channels: dict[str, list[MolecularOrbital]] = {}
        for orbital in self.orbitals:
            channels.setdefault(orbital.spin_channel, []).append(orbital)
        for channel_orbitals in channels.values():
            ordered = sorted(channel_orbitals, key=lambda orbital: orbital.index)
            if [orbital.index for orbital in ordered] != list(range(len(ordered))):
                raise ValueError("Orbital indices must be contiguous within each spin channel")
        if any(frontier.spin_channel not in channels for frontier in self.frontier_by_spin):
            raise ValueError("Frontier metadata references a missing spin channel")
        if len({frontier.spin_channel for frontier in self.frontier_by_spin}) != len(
            self.frontier_by_spin
        ):
            raise ValueError("Frontier metadata must be unique per spin channel")
        for frontier in self.frontier_by_spin:
            channel = channels[frontier.spin_channel]
            homo = next(
                (orbital for orbital in channel if orbital.index == frontier.homo_index), None
            )
            lumo = next(
                (orbital for orbital in channel if orbital.index == frontier.lumo_index), None
            )
            if homo is None or lumo is None:
                raise ValueError("Frontier metadata references a missing orbital")
            if homo.occupation <= 0 or lumo.occupation != 0:
                raise ValueError("HOMO must be occupied and LUMO must be unoccupied")
            if not math.isclose(homo.energy_hartree, frontier.homo_energy_hartree, abs_tol=1e-10):
                raise ValueError("HOMO energy does not match orbital table")
            if not math.isclose(lumo.energy_hartree, frontier.lumo_energy_hartree, abs_tol=1e-10):
                raise ValueError("LUMO energy does not match orbital table")
        if sum(orbital.occupation for orbital in self.orbitals) != self.electron_count:
            raise ValueError("Orbital occupations must sum to the total electron count")
        return self


class MolecularOrbitalGridRequest(ContractModel):
    grid_profile: Literal["LEGACY", "STANDARD"] = "STANDARD"
    orbital_index: int = Field(ge=0)
    spin_channel: Literal["restricted", "alpha", "beta"]


class MolecularOrbitalGridManifest(VolumetricGridMetadata):
    orbital_index: int = Field(ge=0)
    spin_channel: Literal["restricted", "alpha", "beta"]
    field_quantity: Literal["MO_AMPLITUDE"] = "MO_AMPLITUDE"
    field_unit: Literal["a0^-3/2"] = "a0^-3/2"
    grid_generator: Literal["pyscf.eval_gto", "pyscf.scf-fields"] = "pyscf.eval_gto"


class MolecularOrbitalGridOutput(ContractModel):
    manifest: MolecularOrbitalGridManifest
    field_values: tuple[float, ...] = Field(min_length=8, max_length=250_000)

    @model_validator(mode="after")
    def validate_field(self) -> MolecularOrbitalGridOutput:
        if len(self.field_values) != math.prod(self.manifest.dimensions):
            raise ValueError("MO grid values do not match declared dimensions")
        if any(not math.isfinite(value) for value in self.field_values):
            raise ValueError("MO grid field values must all be finite")
        return self


# Fields added with Raman support. Omitted from the hash while unset so that
# persisted IR-only results keep the hash they were sealed with.
_RAMAN_ANALYSIS_FIELDS = (
    "raman_method",
    "polarizability_method",
    "electric_field_step_au",
    "polarizability_derivative_method",
    "polarizability_derivative_step_angstrom_amu_half",
    "polarizability_unit",
    "raman_activity_unit",
    "polarizability_tensor_symmetrization",
    "polarizability_antisymmetry_tolerance",
    "raman_artifact",
    "raman_sha256",
)


def vibrational_analysis_hash(analysis: VibrationalAnalysis) -> str:
    return vibrational_payload_hash(analysis.model_dump(mode="json", exclude={"result_sha256"}))


def vibrational_payload_hash(values: dict[str, object]) -> str:
    """Seal a vibrational payload dict exactly as ``vibrational_analysis_hash`` would.

    Publishing code seals the raw dict before model validation; both paths must agree, so the
    unset-field normalisation lives in one place.
    """
    payload = {k: v for k, v in values.items() if k != "result_sha256"}
    for field in _RAMAN_ANALYSIS_FIELDS:
        if payload.get(field) is None:
            payload.pop(field, None)
    payload["modes"] = [
        {k: v for k, v in dict(mode).items() if not (k == "depolarization_ratio" and v is None)}
        for mode in payload.get("modes", [])  # type: ignore[union-attr]
    ]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


class DominantTransition(ContractModel):
    occupied_mo_index: int = Field(ge=0)
    virtual_mo_index: int = Field(ge=0)
    occupied_label: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    virtual_label: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    x: float
    y: float
    magnitude: float = Field(ge=0)

    @model_validator(mode="after")
    def validate_transition(self) -> DominantTransition:
        if not math.isfinite(self.x) or not math.isfinite(self.y) or not math.isfinite(self.magnitude):
            raise ValueError("Transition response amplitudes must be finite")
        return self


class ExcitedState(ContractModel):
    index: int = Field(ge=0)
    state_label: Annotated[str, StringConstraints(pattern=r"^S\d+$")]
    energy_hartree: float = Field(gt=0)
    energy_ev: float = Field(gt=0)
    wavelength_nm: float = Field(gt=0)
    oscillator_strength: float = Field(ge=0)
    oscillator_strength_gauge: Literal["length"] = "length"
    transition_dipole: tuple[float, float, float]
    converged: bool = True
    dominant_transitions: tuple[DominantTransition, ...] = Field(default=(), max_length=32)

    @model_validator(mode="after")
    def validate_state(self) -> ExcitedState:
        values = (self.energy_hartree, self.energy_ev, self.wavelength_nm, self.oscillator_strength)
        if any(not math.isfinite(v) for v in values):
            raise ValueError("Excited state energies and oscillator strength must be finite")
        if any(not math.isfinite(comp) for comp in self.transition_dipole):
            raise ValueError("Transition dipole components must be finite")
        if not math.isclose(self.energy_ev, self.energy_hartree * 27.211386245988, rel_tol=1e-5, abs_tol=1e-5):
            raise ValueError("Excited state eV conversion is inconsistent with Hartree energy")
        if not math.isclose(self.wavelength_nm, 1239.8419843320025 / self.energy_ev, rel_tol=1e-5, abs_tol=1e-5):
            raise ValueError("Excited state wavelength conversion is inconsistent with eV energy")
        return self


class TddftResult(ContractModel):
    payload_schema: Literal["chemdft.tddft"] = "chemdft.tddft"
    payload_schema_version: Literal["1.0.0"] = "1.0.0"
    task_type: Literal[CalculationTaskType.TDDFT] = CalculationTaskType.TDDFT
    calculation_id: UUID
    input_structure_id: UUID
    input_structure_version_id: UUID
    input_structure_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    calculation_input_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    result_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    engine: Literal["pyscf"] = "pyscf"
    engine_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    method: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    basis: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    charge: int
    multiplicity: int = Field(ge=1)
    response_method: Literal["TDDFT"] = "TDDFT"
    reference_method: Literal["RKS"] = "RKS"
    spin_channel: Literal["singlet"] = "singlet"
    converged: Literal[True] = True
    ground_state_energy_hartree: float
    scf_iterations: int | None = Field(default=None, ge=0)
    requested_roots: int = Field(ge=1)
    converged_roots: int = Field(ge=1)
    oscillator_strength_gauge: Literal["length"] = "length"
    nocc: int = Field(ge=1)
    nvir: int = Field(ge=1)
    homo_index: int = Field(ge=0)
    lumo_index: int = Field(ge=0)
    homo_energy_hartree: float
    lumo_energy_hartree: float
    homo_lumo_gap_hartree: float
    homo_lumo_gap_ev: float
    homo_lumo_gap_label: Literal["HOMO-LUMO orbital-energy gap"] = "HOMO-LUMO orbital-energy gap"
    homo_lumo_gap_note: Literal["Orbital-energy difference; not an excited-state calculation."] = (
        "Orbital-energy difference; not an excited-state calculation."
    )
    excited_states: tuple[ExcitedState, ...] = Field(min_length=1, max_length=128)
    dominant_state_index: int = Field(ge=0)
    max_oscillator_strength: float = Field(ge=0)
    amplitudes_artifact: ArtifactReference
    amplitudes_artifact_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    amplitudes_format: Literal["chemdft.tddft-amplitudes.npz"] = "chemdft.tddft-amplitudes.npz"
    energy_unit: Literal["Eh"] = "Eh"
    converted_energy_unit: Literal["eV"] = "eV"
    wavelength_unit: Literal["nm"] = "nm"
    producer: Annotated[str, StringConstraints(min_length=1, max_length=160)] = "local.pyscf.worker"
    adapter_version: Annotated[str, StringConstraints(min_length=1, max_length=64)] = "1.0.0"
    schema_version: Literal["1.0.0"] = "1.0.0"

    @model_validator(mode="after")
    def validate_tddft_payload(self) -> TddftResult:
        if not math.isfinite(self.ground_state_energy_hartree):
            raise ValueError("Ground state energy must be finite")
        if not math.isfinite(self.homo_energy_hartree) or not math.isfinite(self.lumo_energy_hartree):
            raise ValueError("Frontier orbital energies must be finite")
        if self.amplitudes_artifact.sha256 != self.amplitudes_artifact_sha256:
            raise ValueError("Amplitudes artifact hash mismatch")
        if len(self.excited_states) != self.converged_roots:
            raise ValueError("Excited states count must equal converged roots count")
        if [s.index for s in self.excited_states] != list(range(len(self.excited_states))):
            raise ValueError("Excited state indices must be contiguous starting from 0")
        if self.dominant_state_index >= len(self.excited_states):
            raise ValueError("Dominant state index is out of bounds")
        max_f = max(s.oscillator_strength for s in self.excited_states)
        if not math.isclose(self.max_oscillator_strength, max_f, abs_tol=1e-8):
            raise ValueError("Max oscillator strength does not match excited states")
        return self


def tddft_result_hash(analysis: TddftResult | dict[str, object]) -> str:
    if isinstance(analysis, TddftResult):
        payload = analysis.model_dump(mode="json", exclude={"result_sha256"})
    else:
        payload = {k: v for k, v in analysis.items() if k != "result_sha256"}
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


THERMOCHEMISTRY_ENERGY_TOLERANCE_EH = 1e-9
THERMOCHEMISTRY_ENTROPY_TOLERANCE_EH_PER_K = 1e-12


class ThermochemistryConditions(ContractModel):
    temperature_k: float = Field(gt=0)
    pressure_pa: float = Field(gt=0)
    pressure_atm: float = Field(gt=0)
    gas_model: Literal["ideal-gas"] = "ideal-gas"
    thermo_model: Literal["ideal-gas-rrho"] = "ideal-gas-rrho"
    standard_state: Literal["ideal-gas-at-specified-pressure"] = "ideal-gas-at-specified-pressure"
    reference_pressure_pa: float = 101325.0
    assumptions: tuple[
        Annotated[str, StringConstraints(min_length=1, max_length=200)], ...
    ] = Field(min_length=1, max_length=16)


class ThermochemistryMolecule(ContractModel):
    charge: int
    multiplicity: int = Field(ge=1)
    atom_identities: tuple[Annotated[str, StringConstraints(pattern=r"^[A-Z][a-z]?$")], ...] = (
        Field(min_length=2)
    )
    equilibrium_coordinates_angstrom: tuple[tuple[float, float, float], ...] = Field(min_length=2)
    rotor_type: Literal["LINEAR", "NONLINEAR"]
    rotational_constants_ghz: tuple[float, float, float]
    total_mass_amu: float = Field(gt=0)
    mass_convention: Literal["pyscf-isotope-average"] = "pyscf-isotope-average"


class ThermochemistrySymmetry(ContractModel):
    rotational_symmetry_number: int = Field(ge=1, le=120)
    source: Literal["chemdft-proper-rotation-count", "user-override"]
    method: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    algorithm: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    algorithm_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    tolerance_angstrom: float = Field(gt=0)
    stability_tolerances_angstrom: tuple[float, ...] = ()
    override_reason: Annotated[str, StringConstraints(max_length=500)] | None = None
    pyscf_point_group_sigma: int | None = Field(default=None, ge=1)
    pyscf_cross_check_agrees: bool | None = None


class ThermochemistryContribution(ContractModel):
    """Per-term contribution as returned by PySCF (electronic internal energy term is E0)."""

    energy_hartree: float
    enthalpy_hartree: float
    entropy_hartree_per_k: float
    gibbs_hartree: float
    cv_hartree_per_k: float
    cp_hartree_per_k: float


class ThermochemistryComponents(ContractModel):
    translational: ThermochemistryContribution
    rotational: ThermochemistryContribution
    vibrational: ThermochemistryContribution
    electronic: ThermochemistryContribution


class ThermochemistryThermodynamics(ContractModel):
    electronic_energy_hartree: float
    zpe_hartree: float = Field(gt=0)
    e0_plus_zpe_hartree: float
    internal_energy_hartree: float
    enthalpy_hartree: float
    gibbs_free_energy_hartree: float
    entropy_hartree_per_k: float = Field(gt=0)
    cv_hartree_per_k: float = Field(gt=0)
    cp_hartree_per_k: float = Field(gt=0)


class ThermochemistryCorrections(ContractModel):
    """Corrections relative to E0; each includes the zero-point energy (Gaussian convention)."""

    reference: Literal["electronic_energy_hartree"] = "electronic_energy_hartree"
    includes_zpe: Literal[True] = True
    thermal_correction_internal_energy_hartree: float
    thermal_correction_enthalpy_hartree: float
    thermal_correction_gibbs_hartree: float


class ThermochemistryModeContribution(ContractModel):
    """Exact harmonic-oscillator decomposition of the vibrational terms (derived, sum-checked)."""

    index: int = Field(ge=0)
    frequency_cm1: float = Field(gt=0)
    vibrational_temperature_k: float = Field(gt=0)
    zpe_hartree: float = Field(gt=0)
    thermal_energy_hartree: float = Field(ge=0)
    entropy_hartree_per_k: float = Field(ge=0)
    cv_hartree_per_k: float = Field(ge=0)
    low_frequency: bool


class ThermochemistryStationarity(ContractModel):
    source: Literal["optimization-trajectory-final-step"] = "optimization-trajectory-final-step"
    gradient_rms_hartree_per_bohr: float = Field(ge=0)
    gradient_norm_hartree_per_bohr: float = Field(ge=0)
    criterion_rms_hartree_per_bohr: float = Field(gt=0)
    passed: Literal[True] = True
    trajectory_step_index: int = Field(ge=0)


class ThermochemistryDiagnostics(ContractModel):
    imaginary_mode_policy: Literal["reject"] = "reject"
    imaginary_mode_count: Literal[0] = 0
    lowest_real_frequency_cm1: float = Field(gt=0)
    low_frequency_policy: Literal["warn-below-threshold-pure-rrho-no-correction"] = (
        "warn-below-threshold-pure-rrho-no-correction"
    )
    low_frequency_threshold_cm1: float = Field(gt=0)
    low_frequency_mode_indices: tuple[int, ...] = ()
    low_frequency_entropy_hartree_per_k: float = Field(ge=0)
    low_frequency_minus_ts_hartree: float = Field(ge=0)
    stationarity: ThermochemistryStationarity
    warnings: tuple[Annotated[str, StringConstraints(min_length=1, max_length=400)], ...] = Field(
        default=(), max_length=16
    )


class ThermochemistryConstants(ContractModel):
    source: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    boltzmann_j_per_k: float = Field(gt=0)
    planck_j_s: float = Field(gt=0)
    avogadro_per_mol: float = Field(gt=0)
    hartree_j: float = Field(gt=0)
    atomic_mass_kg: float = Field(gt=0)
    bohr_m: float = Field(gt=0)
    speed_of_light_m_per_s: float = Field(gt=0)
    thermochemical_calorie_j: float = 4.184


class ThermochemistryResult(ContractModel):
    payload_schema: Literal["chemdft.thermochemistry"] = "chemdft.thermochemistry"
    payload_schema_version: Literal["1.0.0"] = "1.0.0"
    task_type: Literal[CalculationTaskType.THERMOCHEMISTRY] = CalculationTaskType.THERMOCHEMISTRY
    calculation_id: UUID
    calculation_input_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    engine: Literal["pyscf"] = "pyscf"
    engine_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    thermo_api: Literal["pyscf.hessian.thermo.thermo"] = "pyscf.hessian.thermo.thermo"
    method: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    basis: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    conditions: ThermochemistryConditions
    molecule: ThermochemistryMolecule
    symmetry: ThermochemistrySymmetry
    thermodynamics: ThermochemistryThermodynamics
    corrections: ThermochemistryCorrections
    components: ThermochemistryComponents
    vibrational_modes: tuple[ThermochemistryModeContribution, ...] = Field(min_length=1)
    diagnostics: ThermochemistryDiagnostics
    # Provenance chain
    geometry_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    input_structure_id: UUID
    input_structure_version_id: UUID
    input_structure_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    optimization_calculation_id: UUID
    optimization_result_id: UUID
    optimization_result_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    frequency_calculation_id: UUID
    frequency_result_id: UUID
    frequency_result_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    energy_artifact: ArtifactReference
    energy_artifact_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    energy_source_field: Literal["total_energy_hartree"] = "total_energy_hartree"
    frequencies_cm1: tuple[float, ...] = Field(min_length=1)
    constants: ThermochemistryConstants
    energy_unit: Literal["Eh"] = "Eh"
    entropy_unit: Literal["Eh/K"] = "Eh/K"
    producer: Annotated[str, StringConstraints(min_length=1, max_length=160)] = "local.pyscf.worker"
    adapter_version: Annotated[str, StringConstraints(min_length=1, max_length=64)] = "1.0.0"
    parser_version: Annotated[str, StringConstraints(min_length=1, max_length=64)] = "1.0.0"
    validator_version: Annotated[str, StringConstraints(min_length=1, max_length=64)] = "1.0.0"
    schema_version: Literal["1.0.0"] = "1.0.0"
    result_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]

    @model_validator(mode="after")
    def validate_thermochemistry(self) -> ThermochemistryResult:
        _validate_thermochemistry_identities(self)
        return self


def _validate_thermochemistry_identities(result: ThermochemistryResult) -> None:
    thermo = result.thermodynamics
    comps = result.components
    corr = result.corrections
    temperature = result.conditions.temperature_k
    k_b_eh = result.constants.boltzmann_j_per_k / result.constants.hartree_j
    e_tol = THERMOCHEMISTRY_ENERGY_TOLERANCE_EH
    s_tol = THERMOCHEMISTRY_ENTROPY_TOLERANCE_EH_PER_K

    def close(a: float, b: float, tol: float, label: str) -> None:
        if not (math.isfinite(a) and math.isfinite(b)) or abs(a - b) > tol:
            raise ValueError(f"Thermochemistry identity violated: {label} ({a} vs {b})")

    close(result.conditions.pressure_atm, result.conditions.pressure_pa / 101325.0, 1e-12, "atm")
    close(
        thermo.e0_plus_zpe_hartree,
        thermo.electronic_energy_hartree + thermo.zpe_hartree,
        e_tol,
        "E0+ZPE",
    )
    close(
        corr.thermal_correction_internal_energy_hartree,
        thermo.internal_energy_hartree - thermo.electronic_energy_hartree,
        e_tol,
        "U correction",
    )
    close(
        corr.thermal_correction_enthalpy_hartree,
        thermo.enthalpy_hartree - thermo.electronic_energy_hartree,
        e_tol,
        "H correction",
    )
    close(
        corr.thermal_correction_gibbs_hartree,
        thermo.gibbs_free_energy_hartree - thermo.electronic_energy_hartree,
        e_tol,
        "G correction",
    )
    close(
        thermo.enthalpy_hartree - thermo.internal_energy_hartree,
        k_b_eh * temperature,
        e_tol,
        "H=U+kT",
    )
    close(
        thermo.gibbs_free_energy_hartree,
        thermo.enthalpy_hartree - temperature * thermo.entropy_hartree_per_k,
        e_tol,
        "G=H-TS",
    )
    close(thermo.cp_hartree_per_k - thermo.cv_hartree_per_k, k_b_eh, s_tol, "Cp-Cv=R")
    parts = (comps.translational, comps.rotational, comps.vibrational, comps.electronic)
    close(thermo.internal_energy_hartree, sum(p.energy_hartree for p in parts), e_tol, "sum U")
    close(thermo.enthalpy_hartree, sum(p.enthalpy_hartree for p in parts), e_tol, "sum H")
    close(thermo.gibbs_free_energy_hartree, sum(p.gibbs_hartree for p in parts), e_tol, "sum G")
    close(thermo.entropy_hartree_per_k, sum(p.entropy_hartree_per_k for p in parts), s_tol, "sum S")
    close(thermo.cv_hartree_per_k, sum(p.cv_hartree_per_k for p in parts), s_tol, "sum Cv")
    close(thermo.cp_hartree_per_k, sum(p.cp_hartree_per_k for p in parts), s_tol, "sum Cp")
    close(comps.electronic.energy_hartree, thermo.electronic_energy_hartree, e_tol, "E_elec=E0")

    modes = result.vibrational_modes
    close(sum(m.zpe_hartree for m in modes), thermo.zpe_hartree, e_tol, "sum mode ZPE")
    close(
        sum(m.zpe_hartree + m.thermal_energy_hartree for m in modes),
        comps.vibrational.energy_hartree,
        e_tol,
        "sum mode E_vib",
    )
    close(
        sum(m.entropy_hartree_per_k for m in modes),
        comps.vibrational.entropy_hartree_per_k,
        s_tol,
        "sum mode S",
    )
    close(
        sum(m.cv_hartree_per_k for m in modes),
        comps.vibrational.cv_hartree_per_k,
        s_tol,
        "sum mode Cv",
    )
    atom_count = len(result.molecule.atom_identities)
    expected = 3 * atom_count - (5 if result.molecule.rotor_type == "LINEAR" else 6)
    if len(modes) != expected or len(result.frequencies_cm1) != expected:
        raise ValueError("Thermochemistry vibrational mode count differs from 3N-6/3N-5")
    if any(frequency <= 0 or not math.isfinite(frequency) for frequency in result.frequencies_cm1):
        raise ValueError("Thermochemistry requires finite positive harmonic frequencies")
    threshold = result.diagnostics.low_frequency_threshold_cm1
    flagged = tuple(m.index for m in modes if m.frequency_cm1 < threshold)
    if flagged != result.diagnostics.low_frequency_mode_indices:
        raise ValueError("Low-frequency diagnostics differ from the vibrational mode list")
    if len(result.molecule.equilibrium_coordinates_angstrom) != atom_count:
        raise ValueError("Thermochemistry geometry must match atom ordering")
    symmetry = result.symmetry
    if (symmetry.source == "user-override") != (symmetry.override_reason is not None):
        raise ValueError("Symmetry override must be recorded with its reason")


def thermochemistry_result_hash(result: ThermochemistryResult | dict[str, object]) -> str:
    if isinstance(result, ThermochemistryResult):
        payload = result.model_dump(mode="json", exclude={"result_sha256"})
    else:
        payload = {k: v for k, v in result.items() if k != "result_sha256"}
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


class PeriodicEnergyResult(ContractModel):
    payload_schema: Literal["chemdft.periodic-energy"] = "chemdft.periodic-energy"
    payload_schema_version: Literal["1.0.0"] = "1.0.0"
    task_type: Literal[CalculationTaskType.PERIODIC_ENERGY] = (
        CalculationTaskType.PERIODIC_ENERGY
    )
    total_energy: ScientificQuantity
    converged: Literal[True] = True
    scf_iterations: int | None = Field(default=None, ge=0)
    band_gap: ScientificQuantity | None = None
    k_mesh: tuple[int, int, int] = Field(default=(1, 1, 1))
    magnetic_order: Literal["none", "ferromagnetic", "antiferromagnetic"] = "none"
    u_effective_ev: dict[str, float] = Field(default_factory=dict)
    local_magnetic_moments: dict[str, float] = Field(default_factory=dict)
    total_magnetization: float | None = None
    runtime_seconds: float | None = Field(default=None, ge=0)
    parser_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    validator_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    # Quantum ESPRESSO plane-wave engine (release 0.0.43). All optional: PySCF results (0.0.41/0.0.42) are unchanged.
    engine: Literal["pyscf", "qe"] = "pyscf"
    local_moment_kind: Literal["mulliken-type", "lowdin-projected"] = "mulliken-type"
    fermi_energy_ev: float | None = None
    absolute_magnetization: float | None = None
    irreducible_k_points: int | None = Field(default=None, ge=1)
    pseudopotential_library: str | None = Field(default=None, max_length=80)
    pseudopotential_files: dict[str, str] = Field(default_factory=dict)
    pseudopotential_libraries: dict[str, str] = Field(default_factory=dict)
    cutoffs_ry: dict[str, float] = Field(default_factory=dict)
    used_default_u: bool = False
    relaxation: dict[str, object] | None = None
    dos: dict[str, object] | None = None
    bands: dict[str, object] | None = None


AuthoritativeScientificPayload = (
    ScientificResultPayload
    | EnergyResult
    | DispersionCorrectedEnergyResult
    | NativeDispersionCorrectedEnergyResult
    | OptimizationResult
    | ConformerEnsembleResult
    | VibrationalAnalysis
    | MolecularOrbitalAnalysis
    | TddftResult
    | ThermochemistryResult
    | PeriodicEnergyResult
)


class AuthoritativeResultSubmission(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    result_type: NamespacedIdentifier
    project_id: UUID
    calculation_id: UUID
    calculation_input_id: UUID
    producer_software: EngineReference
    payload: AuthoritativeScientificPayload
    provenance_record_id: UUID
    raw_artifacts: tuple[ArtifactReference, ...] = Field(min_length=1, max_length=256)
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=200)]
    request_id: UUID
    correlation_id: UUID

    @model_validator(mode="after")
    def enforce_project_scope(self) -> AuthoritativeResultSubmission:
        references = list(self.raw_artifacts) + list(getattr(self.payload, "artifacts", ()))
        if self.producer_software.environment_artifact:
            references.append(self.producer_software.environment_artifact)
        if any(reference.project_id != self.project_id for reference in references):
            raise ValueError("Authoritative result artifacts cannot cross project boundaries")
        return self


class CalculationResult(ContractModel):
    effective_state: EffectiveResultState | None = None
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    result_type: NamespacedIdentifier
    project_id: UUID
    calculation_id: UUID
    calculation_input_id: UUID
    authority: ResultAuthority = ResultAuthority.AUTHORITATIVE
    source_class: Literal[ProvenanceClass.CALCULATED] = ProvenanceClass.CALCULATED
    verification_state: VerificationState
    validation_state: ResultValidationState
    trusted_producer_id: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    trusted_producer_type: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    producer_attestation_id: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    producer_software: EngineReference
    payload: AuthoritativeScientificPayload
    provenance_record_id: UUID
    raw_artifacts: tuple[ArtifactReference, ...]
    created_at: datetime
