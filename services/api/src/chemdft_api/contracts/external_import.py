# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""External Computational Import contracts (Gaussian 09/16, ORCA 5.x/6.x).

Imported records are a SEPARATE domain from ChemDFT engine results: they never use `CalculationResult`, carry
`source_class = IMPORTED`, `authority = IMPORTED` and are produced by `VALIDATED_IMPORT_PIPELINE`. Payloads are provider-neutral
(`chemdft.imported.*`) so no external semantics are forced into PySCF-specific contracts (singlet-only TDDFT, Hessian-bound vibrations,
RRHO thermochemistry).
"""
# ruff: noqa: E501  (long human-readable diagnostics and separators)

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .base import ContractModel, ContractVersion, Sha256

FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
PositiveFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]
ShortText = Annotated[str, StringConstraints(min_length=0, max_length=2000)]
Triple = tuple[FiniteFloat, FiniteFloat, FiniteFloat]

PREVIEW_SCHEMA = "chemdft.external-import.preview"
IMPORT_ENGINES = Literal["Gaussian", "ORCA"]
CONVERSION_IDS = Literal[
    "cclib.eV->Eh/1", "cclib.cm-1->Eh/1", "cclib.cm-1->eV/1", "cm-1->nm/1", "atm->Pa/1", "identity"
]
CCLIB_WAVENUMBER_TO_HARTREE = 219474.6313708
CCLIB_EV_TO_WAVENUMBER = 8065.54429
THERMO_MAX_ABS_CORRECTION_HARTREE = 5.0


def canonical_json(value: object) -> bytes:
    """Byte-identical to the import worker's canonical form: the preview hash is computed over exactly these bytes."""
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False, ensure_ascii=True)
        + "\n"
    ).encode("ascii")


def body_sha256(body: object) -> str:
    return hashlib.sha256(canonical_json(body)).hexdigest()


# ---------------------------------------------------------------------------------------------------------- shared
class ImportedSource(ContractModel):
    program: IMPORT_ENGINES
    program_label: Annotated[str, StringConstraints(min_length=1, max_length=80)]


class ImportedQuantity(ContractModel):
    """A value in canonical units that keeps the raw parsed value, its unit and the exact conversion used."""

    value: FiniteFloat
    unit: Literal["Eh", "Eh/K"]
    raw_value: FiniteFloat
    raw_unit: Literal["eV", "Eh", "Eh/K"]
    conversion: CONVERSION_IDS


class _ImportedPayloadBase(ContractModel):
    payload_schema_version: Literal["1.0.0"] = "1.0.0"
    source_class: Literal["IMPORTED"] = "IMPORTED"
    source: ImportedSource
    normalization_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    source_attributes: tuple[
        Annotated[str, StringConstraints(min_length=1, max_length=40)], ...
    ] = Field(min_length=1, max_length=40)


class ImportedAtom(ContractModel):
    index: int = Field(ge=0)
    element: Annotated[str, StringConstraints(pattern=r"^[A-Z][a-z]?$")]
    atomic_number: int = Field(ge=1, le=118)
    x: FiniteFloat
    y: FiniteFloat
    z: FiniteFloat


def _atoms_ok(atoms: tuple[ImportedAtom, ...]) -> None:
    if not atoms or any(a.index != i for i, a in enumerate(atoms)):
        raise ValueError("Atom indices must match their serialized order")


# ---------------------------------------------------------------------------------------------------------- structure
class ImportedFrame(ContractModel):
    orientation: ShortText
    frame_index: int = Field(ge=0)
    frame_count: int = Field(ge=1)


class ImportedStructurePayload(_ImportedPayloadBase):
    payload_schema: Literal["chemdft.imported.structure"] = "chemdft.imported.structure"
    atoms: tuple[ImportedAtom, ...] = Field(min_length=1, max_length=10_000)
    coordinate_unit: Literal["angstrom"]
    charge: int
    multiplicity: int = Field(ge=1)
    geometry_role: Literal["final-optimized", "single-geometry", "final-frame"]
    frame: ImportedFrame
    optimized: bool
    bonds: ShortText

    @model_validator(mode="after")
    def _check(self) -> ImportedStructurePayload:
        _atoms_ok(self.atoms)
        if self.optimized != (self.geometry_role == "final-optimized"):
            raise ValueError("`optimized` must match geometry_role")
        if self.frame.frame_index >= self.frame.frame_count:
            raise ValueError("Frame index is outside the frame count")
        return self


# ---------------------------------------------------------------------------------------------------------- energy
class ImportedEnergyPayload(_ImportedPayloadBase):
    payload_schema: Literal["chemdft.imported.energy"] = "chemdft.imported.energy"
    energy_kind: ShortText
    scf_energy: ImportedQuantity
    scf_energy_count: int = Field(ge=1)
    reference: Literal["restricted", "unrestricted", "restricted-open-shell", "unknown"]
    method: ShortText
    includes_dispersion_correction: ShortText | None = None
    solvent_model: ShortText | None = None
    excited_state_energies: ShortText

    @model_validator(mode="after")
    def _check(self) -> ImportedEnergyPayload:
        q = self.scf_energy
        if q.unit != "Eh" or q.raw_unit != "eV" or q.conversion != "cclib.eV->Eh/1":
            raise ValueError(
                "SCF energy must be recovered from the parser's eV with the parser's own constant"
            )
        if not math.isclose(q.value, q.raw_value / 27.21138505, rel_tol=1e-15, abs_tol=1e-15):
            raise ValueError(
                "SCF energy does not equal the raw value converted with the recorded convention"
            )
        return self


# ---------------------------------------------------------------------------------------------------------- optimization
class ImportedOptimizationPayload(_ImportedPayloadBase):
    payload_schema: Literal["chemdft.imported.optimization"] = "chemdft.imported.optimization"
    converged: Literal[True]
    convergence_evidence: ShortText
    cclib_optdone: bool | None
    frame_count: int = Field(ge=1)
    final_frame_index: int = Field(ge=0)
    frames_angstrom: tuple[tuple[Triple, ...], ...] | None
    frames_omitted_reason: ShortText | None
    scf_energies_hartree: tuple[FiniteFloat, ...]
    scf_energy_unit_note: ShortText
    final_criteria_values: tuple[FiniteFloat, ...] | None
    criteria_targets: tuple[FiniteFloat, ...] | None
    criteria_names: ShortText
    final_structure: ShortText

    @model_validator(mode="after")
    def _check(self) -> ImportedOptimizationPayload:
        if self.final_frame_index != self.frame_count - 1:
            raise ValueError("The final frame must be the last frame")
        if self.frames_angstrom is not None and len(self.frames_angstrom) != self.frame_count:
            raise ValueError("Frame array length differs from frame_count")
        return self


# ---------------------------------------------------------------------------------------------------------- orbitals
class ImportedOrbitalChannel(ContractModel):
    label: Annotated[str, StringConstraints(min_length=1, max_length=24)]
    orbital_count: int = Field(ge=1)
    homo_index: int | None = Field(default=None, ge=0)
    energies_hartree: tuple[FiniteFloat, ...]
    raw_energies_ev: tuple[FiniteFloat, ...]
    occupations: tuple[FiniteFloat, ...] | None
    symmetries: tuple[Annotated[str, StringConstraints(max_length=24)], ...] | None

    @model_validator(mode="after")
    def _check(self) -> ImportedOrbitalChannel:
        n = self.orbital_count
        if len(self.energies_hartree) != n or len(self.raw_energies_ev) != n:
            raise ValueError("Orbital arrays must have orbital_count entries")
        if self.occupations is not None and len(self.occupations) != n:
            raise ValueError("Occupation array length differs from orbital_count")
        if self.symmetries is not None and len(self.symmetries) != n:
            raise ValueError("Symmetry array length differs from orbital_count")
        for h, ev in zip(self.energies_hartree, self.raw_energies_ev, strict=True):
            if not math.isclose(h, ev / 27.21138505, rel_tol=1e-15, abs_tol=1e-15):
                raise ValueError(
                    "Orbital energy does not equal the raw value converted with the recorded convention"
                )
        return self


class ImportedOrbitalTablePayload(_ImportedPayloadBase):
    payload_schema: Literal["chemdft.imported.orbital-table"] = "chemdft.imported.orbital-table"
    spin_channels: tuple[ImportedOrbitalChannel, ...] = Field(min_length=1, max_length=2)
    raw_unit: Literal["eV"]
    conversion: Literal["cclib.eV->Eh/1"]
    occupation_basis: ShortText
    orbital_coefficients: ShortText


# ---------------------------------------------------------------------------------------------------------- vibrations
class ImportedMode(ContractModel):
    index: int = Field(ge=0)
    frequency_cm1: FiniteFloat
    imaginary: bool
    ir_intensity_km_mol: FiniteFloat | None
    raman_activity_a4_amu: FiniteFloat | None
    reduced_mass_amu: PositiveFloat | None
    displacement: tuple[Triple, ...] = Field(min_length=1)
    displacement_euclidean_norm: FiniteFloat

    @model_validator(mode="after")
    def _check(self) -> ImportedMode:
        if self.imaginary != (self.frequency_cm1 < 0):
            raise ValueError("The imaginary flag must match the signed frequency")
        return self


class ImportedDisplacementConvention(ContractModel):
    statement: ShortText
    euclidean_norm_min: FiniteFloat
    euclidean_norm_max: FiniteFloat
    frame: ShortText
    eckart_rotation_worst_relative: FiniteFloat | None


class ImportedEquilibriumGeometry(ContractModel):
    coordinate_unit: Literal["angstrom"]
    atoms: tuple[ImportedAtom, ...] = Field(min_length=1)


class ImportedVibrationsPayload(_ImportedPayloadBase):
    payload_schema: Literal["chemdft.imported.vibrations"] = "chemdft.imported.vibrations"
    mode_count: int = Field(ge=1)
    expected_mode_count: int | None = Field(default=None, ge=1)
    linear: bool
    imaginary_mode_count: int = Field(ge=0)
    modes: tuple[ImportedMode, ...] = Field(min_length=1)
    has_ir_intensities: bool
    has_raman_activities: bool
    depolarization_ratios: ShortText
    frequency_unit: Literal["cm^-1"]
    ir_intensity_unit: Literal["km/mol"]
    raman_activity_unit: Literal["angstrom^4/amu"]
    frequency_sign: ShortText
    displacement_convention: ImportedDisplacementConvention
    equilibrium_geometry: ImportedEquilibriumGeometry
    zero_modes: ShortText
    ordering: ShortText
    ir_intensity_note: ShortText | None = None
    raman_activity_note: ShortText | None = None

    @model_validator(mode="after")
    def _check(self) -> ImportedVibrationsPayload:
        natom = len(self.equilibrium_geometry.atoms)
        _atoms_ok(self.equilibrium_geometry.atoms)
        n = len(self.modes)
        if self.mode_count != n:
            raise ValueError("mode_count must equal the number of modes")
        if self.expected_mode_count is not None and self.expected_mode_count not in (
            3 * natom - 6,
            3 * natom - 5,
        ):
            raise ValueError("The expected mode count must be 3N-6 or 3N-5")
        if self.expected_mode_count is not None and n != self.expected_mode_count:
            raise ValueError(
                "The vibrational mode count must equal 3N-6 (3N-5 for linear molecules)"
            )
        if self.imaginary_mode_count != sum(m.imaginary for m in self.modes):
            raise ValueError("imaginary_mode_count must equal the number of imaginary modes")
        if any(len(m.displacement) != natom for m in self.modes):
            raise ValueError("Every mode needs one displacement vector per atom")
        if any(m.index != i for i, m in enumerate(self.modes)):
            raise ValueError("Mode indices must follow the reported order")
        ir_all = all(m.ir_intensity_km_mol is not None for m in self.modes)
        ir_none = all(m.ir_intensity_km_mol is None for m in self.modes)
        raman_all = all(m.raman_activity_a4_amu is not None for m in self.modes)
        raman_none = all(m.raman_activity_a4_amu is None for m in self.modes)
        if self.has_ir_intensities != ir_all or (not ir_all and not ir_none):
            raise ValueError("IR intensities must be present for every mode or for none")
        if self.has_raman_activities != raman_all or (not raman_all and not raman_none):
            raise ValueError("Raman activities must be present for every mode or for none")
        return self


# ---------------------------------------------------------------------------------------------------------- excitations
class ImportedTransition(ContractModel):
    from_orbital: int = Field(ge=0)
    from_spin: int = Field(ge=0, le=1)
    to_orbital: int = Field(ge=0)
    to_spin: int = Field(ge=0, le=1)
    coefficient: FiniteFloat


SPIN_LABELS = Literal["singlet", "doublet", "triplet", "quartet", "quintet", "sextet", "unknown"]
_SPIN_MULT = {"singlet": 1, "doublet": 2, "triplet": 3, "quartet": 4, "quintet": 5, "sextet": 6}


class ImportedExcitedState(ContractModel):
    index: int = Field(ge=0)
    source_state_number: int = Field(ge=1)
    spin_label: SPIN_LABELS
    spin_multiplicity: int | None = Field(default=None, ge=1)
    symmetry: Annotated[str, StringConstraints(max_length=40)] | None
    source_label: Annotated[str, StringConstraints(max_length=80)] | None
    energy_cm1_raw: PositiveFloat
    energy_hartree: PositiveFloat
    energy_ev: PositiveFloat
    wavelength_nm: PositiveFloat
    oscillator_strength: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None
    transitions: tuple[ImportedTransition, ...] = Field(default=(), max_length=64)
    transitions_truncated: bool

    @model_validator(mode="after")
    def _check(self) -> ImportedExcitedState:
        if self.spin_label == "unknown":
            if self.spin_multiplicity is not None:
                raise ValueError("An unknown spin label cannot carry a multiplicity")
        elif self.spin_multiplicity != _SPIN_MULT[self.spin_label]:
            raise ValueError("Spin label and multiplicity disagree")
        if self.source_state_number != self.index + 1:
            raise ValueError("State order must be the original order")
        if not math.isclose(
            self.energy_hartree, self.energy_cm1_raw / CCLIB_WAVENUMBER_TO_HARTREE, rel_tol=1e-12
        ):
            raise ValueError(
                "Excitation energy (Eh) does not equal the raw value converted with the recorded convention"
            )
        if not math.isclose(
            self.energy_ev, self.energy_cm1_raw / CCLIB_EV_TO_WAVENUMBER, rel_tol=1e-12
        ):
            raise ValueError(
                "Excitation energy (eV) does not equal the raw value converted with the recorded convention"
            )
        if not math.isclose(self.wavelength_nm, 1.0e7 / self.energy_cm1_raw, rel_tol=1e-12):
            raise ValueError("Wavelength does not equal the reciprocal of the raw wavenumber")
        return self


class ImportedExcitationConversions(ContractModel):
    hartree: Literal["cclib.cm-1->Eh/1"]
    ev: Literal["cclib.cm-1->eV/1"]
    wavelength: Literal["cm-1->nm/1"]


class ImportedExcitationsPayload(_ImportedPayloadBase):
    payload_schema: Literal["chemdft.imported.excitations"] = "chemdft.imported.excitations"
    state_count: int = Field(ge=1)
    method: ShortText
    ordering: ShortText
    states: tuple[ImportedExcitedState, ...] = Field(min_length=1, max_length=2000)
    spin_semantics: ShortText
    oscillator_strength_gauge: ShortText
    transition_amplitudes_note: ShortText
    energy_precision_note: ShortText
    energy_conversion: ImportedExcitationConversions
    transition_dipoles: ShortText

    @model_validator(mode="after")
    def _check(self) -> ImportedExcitationsPayload:
        if self.state_count != len(self.states) or any(
            s.index != i for i, s in enumerate(self.states)
        ):
            raise ValueError("States must keep the original order and count")
        return self


# ---------------------------------------------------------------------------------------------------------- thermochemistry
class ImportedThermoPlausibility(ContractModel):
    h_minus_e0_hartree: FiniteFloat | None
    g_minus_e0_hartree: FiniteFloat | None


class ImportedThermochemistryPayload(_ImportedPayloadBase):
    payload_schema: Literal["chemdft.imported.thermochemistry"] = "chemdft.imported.thermochemistry"
    reported_by: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    temperature_k: PositiveFloat
    pressure_atm: PositiveFloat | None
    pressure_pa: PositiveFloat | None
    zero_point_energy_hartree: ImportedQuantity
    enthalpy_hartree: ImportedQuantity
    gibbs_free_energy_hartree: ImportedQuantity
    entropy_hartree_per_k: ImportedQuantity
    enthalpy_and_gibbs_include_electronic_energy: Literal[True]
    electronic_energy_hartree: FiniteFloat | None
    plausibility: ImportedThermoPlausibility
    model: ShortText
    recomputed_by_chemdft: Literal[False]
    temperature_pressure_preview: ShortText
    component_breakdown: ShortText

    @model_validator(mode="after")
    def _check(self) -> ImportedThermochemistryPayload:
        if (self.pressure_atm is None) != (self.pressure_pa is None):
            raise ValueError("Pressure must be given in both units or neither")
        if self.pressure_atm is not None and not math.isclose(
            self.pressure_pa or 0.0, self.pressure_atm * 101325.0, rel_tol=1e-12
        ):
            raise ValueError("Pressure conversion is inconsistent")
        if self.zero_point_energy_hartree.value <= 0 or self.entropy_hartree_per_k.value <= 0:
            raise ValueError("Reported ZPE and entropy must be positive")
        dh = self.plausibility.h_minus_e0_hartree
        if dh is not None and not (0 < dh < THERMO_MAX_ABS_CORRECTION_HARTREE):
            raise ValueError(
                "Reported H must exceed E0 by a plausible amount (not a thermal correction masquerading as a total)"
            )
        return self


ImportedPayload = Annotated[
    ImportedStructurePayload
    | ImportedEnergyPayload
    | ImportedOptimizationPayload
    | ImportedOrbitalTablePayload
    | ImportedVibrationsPayload
    | ImportedExcitationsPayload
    | ImportedThermochemistryPayload,
    Field(discriminator="payload_schema"),
]
IMPORTED_RESULT_TYPES = (
    "chemdft.imported.structure",
    "chemdft.imported.energy",
    "chemdft.imported.optimization",
    "chemdft.imported.orbital-table",
    "chemdft.imported.vibrations",
    "chemdft.imported.excitations",
    "chemdft.imported.thermochemistry",
)


# ---------------------------------------------------------------------------------------------------------- preview report
class ImportParserInfo(ContractModel):
    name: Literal["cclib"]
    version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    commit: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{40}$")]
    wheel_sha256: Sha256


class ImportSourceInfo(ContractModel):
    sha256: Sha256
    size_bytes: int = Field(ge=0)
    line_count: int | None = Field(default=None, ge=0)
    encoding: str | None = None
    replaced_bytes: int | None = Field(default=None, ge=0)


class ImportProgramInfo(ContractModel):
    engine: IMPORT_ENGINES | None
    version: str | None
    label: str | None


class ImportValueWithStatus(ContractModel):
    value: Annotated[str, StringConstraints(max_length=200)]
    status: Literal["ESTABLISHED", "REPORTED", "UNKNOWN"]
    evidence: tuple[Annotated[str, StringConstraints(max_length=600)], ...] = ()


class ImportTermination(ContractModel):
    status: Literal["COMPLETED", "INCOMPLETE", "ERROR_TERMINATION"]
    evidence: ShortText


class ImportScfConvergence(ContractModel):
    status: Literal["CONVERGED", "NOT_CONVERGED", "UNKNOWN"]
    evidence: ShortText


class ImportOptimizationConvergence(ContractModel):
    requested: bool
    status: Literal["CONVERGED", "NOT_CONVERGED", "NOT_REQUESTED"]
    evidence: ShortText


class ImportConvergence(ContractModel):
    scf: ImportScfConvergence
    optimization: ImportOptimizationConvergence


class ImportJobSummary(ContractModel):
    job_count: int = Field(ge=1)
    index: int = Field(ge=0)
    line_range: tuple[int, int]
    internal_steps: int = Field(ge=1)
    job_type: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    job_type_evidence: tuple[Annotated[str, StringConstraints(max_length=600)], ...] = ()
    method: ImportValueWithStatus
    basis: ImportValueWithStatus
    charge: int | None
    multiplicity: int | None
    reference: Literal["restricted", "unrestricted", "restricted-open-shell", "unknown"]
    n_atoms: int | None
    orientation: ShortText
    solvent_model: ShortText | None
    termination: ImportTermination
    convergence: ImportConvergence


class ImportJobBrief(ContractModel):
    index: int = Field(ge=0)
    line_range: tuple[int, int]
    internal_steps: int = Field(ge=1)
    job_type: str
    termination: ImportTermination


class ImportItem(ContractModel):
    id: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    state: Literal["DETECTED", "UNAVAILABLE", "WARNING", "REJECTED"]
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    detail: ShortText
    result_type: str | None


class ImportDiagnostic(ContractModel):
    code: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    severity: Literal["reject", "warning", "info"]
    message: ShortText
    line: int | None = None


class ImportLocator(ContractModel):
    line_start: int = Field(ge=0)
    line_end: int = Field(ge=0)


class ImportResultEntry(ContractModel):
    result_type: Literal[
        "chemdft.imported.structure",
        "chemdft.imported.energy",
        "chemdft.imported.optimization",
        "chemdft.imported.orbital-table",
        "chemdft.imported.vibrations",
        "chemdft.imported.excitations",
        "chemdft.imported.thermochemistry",
    ]
    payload: ImportedPayload
    source_attributes: tuple[str, ...]
    source_locators: dict[str, ImportLocator]

    @model_validator(mode="after")
    def _check(self) -> ImportResultEntry:
        if self.payload.payload_schema != self.result_type:
            raise ValueError("Result type must equal the payload schema")
        return self


class ImportCclibInfo(ContractModel):
    success_flag: bool | str
    error_logs: tuple[str, ...] = ()
    network_or_archive_attempts: int = Field(ge=0)


class ImportPreviewBody(ContractModel):
    importer_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    normalization_version: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    parser: ImportParserInfo
    source: ImportSourceInfo
    status: Literal["READY", "REJECTED"]
    program: ImportProgramInfo
    job: ImportJobSummary | None
    jobs: tuple[ImportJobBrief, ...] = ()
    items: tuple[ImportItem, ...] = ()
    results: tuple[ImportResultEntry, ...] = ()
    diagnostics: tuple[ImportDiagnostic, ...] = ()
    cclib: ImportCclibInfo | None
    semantic: dict[str, int | float | bool | str] | None = None

    @model_validator(mode="after")
    def _check(self) -> ImportPreviewBody:
        has_reject = any(d.severity == "reject" for d in self.diagnostics)
        if self.status == "READY" and (has_reject or not self.results or self.job is None):
            raise ValueError("A READY preview needs results, a job, and no rejection")
        if self.status == "REJECTED" and self.results:
            raise ValueError("A rejected preview cannot carry importable results")
        if (
            self.status == "READY"
            and self.job is not None
            and self.job.termination.status != "COMPLETED"
        ):
            raise ValueError("Only normally terminated jobs can be READY")
        if self.status == "READY" and self.job is not None and self.job.job_count != 1:
            raise ValueError("Only single-job outputs can be READY in V1")
        types = [r.result_type for r in self.results]
        if len(set(types)) != len(types):
            raise ValueError("Each result type may appear once")
        if self.status == "READY" and "chemdft.imported.structure" not in types:
            raise ValueError("A READY preview must include a structure")
        return self


class ImportPreviewReport(ContractModel):
    schema_id: Literal["chemdft.external-import.preview"] = Field(alias="schema")
    schema_version: ContractVersion = "1.0.0"
    body: ImportPreviewBody
    preview_sha256: Sha256

    model_config = ContractModel.model_config | {"populate_by_name": True}


# ---------------------------------------------------------------------------------------------------------- API views
class ImportResultSummary(ContractModel):
    result_type: str
    source_attributes: tuple[str, ...]


class ImportPreviewView(ContractModel):
    """The preview as shown to the user: everything except the (large) payloads, which are only stored and hash-bound."""

    importer_version: str
    normalization_version: str
    parser: ImportParserInfo
    source: ImportSourceInfo
    status: Literal["READY", "REJECTED"]
    program: ImportProgramInfo
    job: ImportJobSummary | None
    jobs: tuple[ImportJobBrief, ...] = ()
    items: tuple[ImportItem, ...] = ()
    results: tuple[ImportResultSummary, ...] = ()
    diagnostics: tuple[ImportDiagnostic, ...] = ()
    cclib: ImportCclibInfo | None
    semantic: dict[str, int | float | bool | str] | None = None


class ExternalImportSourceView(ContractModel):
    sha256: Sha256
    size_bytes: int = Field(ge=0)
    original_name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    media_class: Literal["text/plain; chemdft=external-output"]
    uploaded_at: datetime
    raw_artifact_id: UUID | None
    immutable: Literal[True] = True


class ExternalImportConfirmation(ContractModel):
    confirmed_at: datetime
    confirmed_by: UUID
    preview_sha256: Sha256


class ExternalImportSummaryView(ContractModel):
    id: UUID
    project_id: UUID
    state: Literal["PREVIEW_READY", "REJECTED", "IMPORTED"]
    source_filename: str
    source_sha256: Sha256
    engine: str | None
    program_label: str | None
    job_type: str | None
    method: str | None
    basis: str | None
    preview_sha256: Sha256
    created_at: datetime
    confirmed_at: datetime | None
    structure_id: UUID | None = None


class ExternalImportView(ContractModel):
    id: UUID
    project_id: UUID
    state: Literal["PREVIEW_READY", "REJECTED", "IMPORTED"]
    source: ExternalImportSourceView
    preview_sha256: Sha256
    preview_artifact_id: UUID | None
    importer_version: str
    created_at: datetime
    created_by: UUID
    parse_timestamp: datetime
    preview: ImportPreviewView
    confirmation: ExternalImportConfirmation | None = None


class ExternalImportConfirmInput(ContractModel):
    preview_sha256: Sha256
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=200)]


class ExternalImportJobView(ContractModel):
    id: UUID
    import_id: UUID
    job_index: int = Field(ge=0)
    line_range: tuple[int, int]
    source_job_type: str
    method: ImportValueWithStatus
    basis: ImportValueWithStatus
    charge: int
    multiplicity: int = Field(ge=1)
    termination: ImportTermination
    convergence: ImportConvergence
    structure_id: UUID
    structure_version_id: UUID
    created_at: datetime


class ImportedResultView(ContractModel):
    id: UUID
    project_id: UUID
    import_id: UUID
    import_job_id: UUID
    result_type: Literal[
        "chemdft.imported.structure",
        "chemdft.imported.energy",
        "chemdft.imported.optimization",
        "chemdft.imported.orbital-table",
        "chemdft.imported.vibrations",
        "chemdft.imported.excitations",
        "chemdft.imported.thermochemistry",
    ]
    payload: ImportedPayload
    payload_sha256: Sha256
    source_class: Literal["IMPORTED"] = "IMPORTED"
    authority: Literal["IMPORTED"] = "IMPORTED"
    producer_type: Literal["VALIDATED_IMPORT_PIPELINE"] = "VALIDATED_IMPORT_PIPELINE"
    producer_id: str
    provenance_record_id: UUID
    source_attributes: tuple[str, ...]
    source_locators: dict[str, ImportLocator]
    normalization_version: str
    verification_state: Literal["UNVERIFIED"] = "UNVERIFIED"
    validation_state: Literal["VALIDATED"] = "VALIDATED"
    created_at: datetime


class ExternalImportDetail(ContractModel):
    import_record: ExternalImportView
    jobs: tuple[ExternalImportJobView, ...] = ()
    results: tuple[ImportedResultView, ...] = ()


class ExternalImportListOutput(ContractModel):
    imports: tuple[ExternalImportSummaryView, ...]
