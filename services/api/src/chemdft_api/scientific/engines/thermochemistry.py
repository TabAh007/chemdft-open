# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Thermochemistry V1: validity gates, worker-input construction and result validation.

Ideal-gas / rigid-rotor / harmonic-oscillator thermochemistry from a *validated, persisted*
frequency result. Nothing here runs electronic-structure code. PySCF's ``thermo`` is invoked only
inside the trusted worker (see ``thermo_worker.py``); this module decides *whether* it may be
invoked and verifies what comes back.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...contracts.results import (
    ThermochemistryResult,
    VibrationalAnalysis,
    thermochemistry_result_hash,
)
from ...contracts.scientific import (
    LOW_FREQUENCY_WARNING_CM1,
    ThermochemistryOptions,
)
from ...errors import ScientificValidationFailed
from ...scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    OptimizationTrajectoryRecord,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from ...storage import ObjectStore
from . import symmetry_number
from .vibrational import expected_mode_count

STATIONARITY_RMS_CRITERION_HARTREE_PER_BOHR = 3.0e-4
BOHR_PER_ANGSTROM = 1.8897261254578281
THERMOCHEMISTRY_ADAPTER_VERSION = "1.0.0"
THERMOCHEMISTRY_VALIDATOR_VERSION = "1.0.0"
PYSCF_THERMO_VERSION = "2.14.0"
ASSUMPTIONS = (
    "Ideal gas",
    "Rigid rotor",
    "Harmonic oscillator (pure RRHO, no quasi-RRHO correction)",
    "Gas phase; no solvation; no 1 M solution standard state",
    "Electronic degeneracy limited to spin multiplicity",
)


class ThermochemistryGateFailed(ScientificValidationFailed):
    """A scientific validity gate rejected the request; ``code`` is machine readable."""

    default_detail = "Thermochemistry validity gate failed."

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


@dataclass(frozen=True, slots=True)
class ThermochemistryGateEvidence:
    frequency_payload: VibrationalAnalysis
    frequency_result: CalculationResultRecord
    frequency_calculation_id: str
    frequency_specification: dict[str, Any]
    version: StructureVersionRecord
    structure_artifact_sha256: str
    trajectory: OptimizationTrajectoryRecord
    optimization_result: CalculationResultRecord
    optimization_result_sha256: str
    energy_artifact: ScientificArtifactRecord
    electronic_energy_hartree: float
    stationarity: dict[str, Any]
    symmetry: dict[str, Any]
    frequencies_cm1: tuple[float, ...]


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def evaluate_thermochemistry_gates(
    session: Session,
    object_store: ObjectStore,
    *,
    project_id: str,
    options: ThermochemistryOptions,
    max_artifact_bytes: int,
) -> ThermochemistryGateEvidence:
    """Run every V1 validity gate; raise ``ThermochemistryGateFailed`` on the first failure."""
    result = session.get(CalculationResultRecord, str(options.source_frequency_result_id))
    if result is None or result.project_id != project_id:
        raise ThermochemistryGateFailed(
            "THERMO_SOURCE_NOT_FOUND", "The source frequency result does not exist in this project."
        )
    if (
        result.result_type != "chemdft.vibrational-analysis"
        or result.authority != "AUTHORITATIVE"
        or result.validation_state != "VALIDATED"
    ):
        raise ThermochemistryGateFailed(
            "THERMO_SOURCE_NOT_AUTHORITATIVE",
            "Thermochemistry requires a validated authoritative vibrational-analysis result.",
        )
    try:
        payload = VibrationalAnalysis.model_validate(result.payload_json)
    except ValueError as error:  # includes the sealed result-hash check
        raise ThermochemistryGateFailed(
            "THERMO_SOURCE_INVALID", f"Source frequency result failed re-validation: {error}"
        ) from error

    # Gate: imaginary modes (never rely on PySCF silently dropping them).
    imaginary = [
        mode.frequency_cm1 for mode in payload.modes if mode.frequency_cm1 < 0 or mode.imaginary
    ]
    if imaginary:
        listing = ", ".join(f"{value:.1f}" for value in imaginary)
        raise ThermochemistryGateFailed(
            "THERMO_IMAGINARY_MODES",
            f"Source frequencies include {len(imaginary)} imaginary mode(s) ({listing} cm^-1). "
            "Minimum-geometry thermochemistry is not defined; re-optimize the structure first.",
        )
    frequencies = tuple(float(mode.frequency_cm1) for mode in payload.modes)
    if any((not math.isfinite(value)) or value <= 0 for value in frequencies):
        raise ThermochemistryGateFailed(
            "THERMO_FREQUENCIES_INVALID", "Harmonic frequencies must be finite and positive."
        )
    coordinates = [list(point) for point in payload.equilibrium_coordinates_angstrom]
    if payload.multiplicity != 1:
        raise ThermochemistryGateFailed(
            "THERMO_OPEN_SHELL_UNSUPPORTED",
            "Thermochemistry V1 supports closed-shell singlets (the frequency worker's scope).",
        )
    expected = expected_mode_count(coordinates)
    if len(payload.modes) != expected or payload.expected_vibrational_mode_count != expected:
        raise ThermochemistryGateFailed(
            "THERMO_MODE_COUNT_INVALID",
            f"Vibrational mode count {len(payload.modes)} differs from 3N-6/3N-5 = {expected}.",
        )

    frequency_input = session.get(CalculationInputRecord, result.calculation_input_id)
    frequency_calculation = session.get(CalculationRecord, result.calculation_id)
    if (
        frequency_input is None
        or frequency_calculation is None
        or frequency_input.project_id != project_id
        or frequency_calculation.state != "SUCCEEDED"
    ):
        raise ThermochemistryGateFailed(
            "THERMO_SOURCE_NOT_AUTHORITATIVE", "Source frequency calculation record is unavailable."
        )
    frequency_spec = dict(frequency_input.specification_json)
    if frequency_spec.get("task_type") != "FREQUENCY":
        raise ThermochemistryGateFailed(
            "THERMO_SOURCE_NOT_AUTHORITATIVE", "Source calculation is not a frequency calculation."
        )
    if frequency_spec.get("dispersion") or frequency_spec.get("solvation"):
        raise ThermochemistryGateFailed(
            "THERMO_LEVEL_MISMATCH", "Dispersion/solvation frequency results are not supported."
        )

    # Gate: source geometry must be a ChemDFT optimization at the same level of theory.
    version = session.get(StructureVersionRecord, frequency_input.structure_version_id)
    if version is None or version.project_id != project_id:
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_NOT_OPTIMIZED", "The frequency calculation's structure is unavailable."
        )
    if version.origin != "OPTIMIZED":
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_NOT_OPTIMIZED",
            "The frequency calculation was not run on a ChemDFT-optimized geometry. "
            "Run Optimize -> Frequencies -> Thermochemistry.",
        )
    trajectory = session.scalar(
        select(OptimizationTrajectoryRecord).where(
            OptimizationTrajectoryRecord.project_id == project_id,
            OptimizationTrajectoryRecord.final_structure_version_id == version.id,
        )
    )
    if trajectory is None or trajectory.state != "CONVERGED" or not trajectory.steps_json:
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_NOT_OPTIMIZED",
            "No converged ChemDFT optimization trajectory produced the source geometry.",
        )
    optimization_input = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.calculation_id == trajectory.calculation_id,
            CalculationInputRecord.project_id == project_id,
        )
    )
    optimization_calculation = session.get(CalculationRecord, trajectory.calculation_id)
    if (
        optimization_input is None
        or optimization_calculation is None
        or optimization_calculation.state != "SUCCEEDED"
    ):
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_NOT_OPTIMIZED", "The optimization calculation did not succeed."
        )
    optimization_spec = dict(optimization_input.specification_json)

    def level(specification: dict[str, Any]) -> tuple[Any, ...]:
        basis = specification.get("basis") or {}
        return (
            (specification.get("method") or {}).get("identifier", "").lower(),
            str(basis.get("identifier", "")).lower(),
            specification.get("charge"),
            specification.get("multiplicity"),
            bool(specification.get("dispersion")),
            bool(specification.get("solvation")),
        )

    if optimization_spec.get("task_type") != "GEOMETRY_OPTIMIZATION" or level(
        optimization_spec
    ) != level(frequency_spec):
        raise ThermochemistryGateFailed(
            "THERMO_LEVEL_MISMATCH",
            "The optimization and frequency calculations are not at the same level of theory "
            f"(optimization {level(optimization_spec)[:2]}, "
            f"frequency {level(frequency_spec)[:2]}).",
        )
    optimization_result = session.scalar(
        select(CalculationResultRecord).where(
            CalculationResultRecord.calculation_id == trajectory.calculation_id,
            CalculationResultRecord.result_type == "chemdft.optimization",
            CalculationResultRecord.authority == "AUTHORITATIVE",
            CalculationResultRecord.validation_state == "VALIDATED",
        )
    )
    if (
        optimization_result is None
        or optimization_result.payload_json.get("final_structure_version_id") != version.id
    ):
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_NOT_OPTIMIZED",
            "No authoritative optimization result publishes the source geometry.",
        )

    # Gate: stationarity from the optimization's own final gradient evidence.
    final_step = trajectory.steps_json[-1]
    if any(
        final_step.get(metric) is None
        for metric in ("gradient_rms_hartree_per_bohr", "gradient_norm_hartree_per_bohr")
    ):
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_NOT_STATIONARY",
            "Final optimization gradient RMS and norm evidence are required.",
        )
    rms = float(final_step["gradient_rms_hartree_per_bohr"])
    norm = float(final_step["gradient_norm_hartree_per_bohr"])
    if not (math.isfinite(rms) and rms <= STATIONARITY_RMS_CRITERION_HARTREE_PER_BOHR):
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_NOT_STATIONARY",
            f"Final optimization gradient RMS {rms:.3e} Eh/bohr exceeds "
            f"{STATIONARITY_RMS_CRITERION_HARTREE_PER_BOHR:.1e}.",
        )

    # Gate: geometry/provenance relationships.
    version_atoms = version.representation_json["coordinates"]["atoms"]
    version_coordinates = [
        [float(atom[axis]) for axis in ("x", "y", "z")] for atom in version_atoms
    ]
    if version.representation_json["coordinates"]["unit"] == "bohr":
        version_coordinates = [[v / BOHR_PER_ANGSTROM for v in xyz] for xyz in version_coordinates]
    if (
        [atom["element"] for atom in version_atoms] != list(payload.atom_identities)
        or version_coordinates != coordinates
        or [list(map(float, row)) for row in final_step["coordinates_angstrom"]]
        != version_coordinates
    ):
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_PROVENANCE_INVALID",
            "Frequency geometry, optimized StructureVersion and final optimization step differ.",
        )
    structure_artifact = session.get(ScientificArtifactRecord, version.canonical_artifact_id)
    if structure_artifact is None or structure_artifact.sha256 != payload.input_structure_hash:
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_PROVENANCE_INVALID",
            "Structure artifact hash does not match the frequency input.",
        )
    if version.id != str(payload.input_structure_version_id):
        raise ThermochemistryGateFailed(
            "THERMO_GEOMETRY_PROVENANCE_INVALID",
            "Frequency result refers to a different StructureVersion.",
        )

    # Gate: E0 from a hash-referenced raw artifact of the frequency result.
    energy_artifact, energy = _read_electronic_energy(
        session,
        object_store,
        project_id=project_id,
        result=result,
        payload=payload,
        max_bytes=max_artifact_bytes,
    )

    # Gate: rotational symmetry number (never a silent fallback to sigma = 1).
    if options.symmetry_number_override is not None:
        symmetry = {
            "rotational_symmetry_number": options.symmetry_number_override,
            "source": "user-override",
            "override_reason": options.symmetry_override_reason,
        }
    else:
        try:
            detected = symmetry_number.rotational_symmetry_number(
                list(payload.atom_identities), coordinates
            )
        except symmetry_number.SymmetryUndetermined as error:
            raise ThermochemistryGateFailed("THERMO_SYMMETRY_UNDETERMINED", str(error)) from error
        symmetry = {
            "rotational_symmetry_number": detected.sigma,
            "source": "chemdft-proper-rotation-count",
            "override_reason": None,
        }

    return ThermochemistryGateEvidence(
        frequency_payload=payload,
        frequency_result=result,
        frequency_calculation_id=result.calculation_id,
        frequency_specification=frequency_spec,
        version=version,
        structure_artifact_sha256=structure_artifact.sha256,
        trajectory=trajectory,
        optimization_result=optimization_result,
        optimization_result_sha256=canonical_sha256(optimization_result.payload_json),
        energy_artifact=energy_artifact,
        electronic_energy_hartree=energy,
        stationarity={
            "gradient_rms_hartree_per_bohr": rms,
            "gradient_norm_hartree_per_bohr": norm,
            "criterion_rms_hartree_per_bohr": STATIONARITY_RMS_CRITERION_HARTREE_PER_BOHR,
            "trajectory_step_index": int(final_step["index"]),
        },
        symmetry=symmetry,
        frequencies_cm1=frequencies,
    )


def _read_electronic_energy(
    session: Session,
    object_store: ObjectStore,
    *,
    project_id: str,
    result: CalculationResultRecord,
    payload: VibrationalAnalysis,
    max_bytes: int,
) -> tuple[ScientificArtifactRecord, float]:
    for reference in result.raw_artifacts_json:
        artifact = session.get(ScientificArtifactRecord, str(reference["artifact_id"]))
        if (
            artifact is None
            or artifact.project_id != project_id
            or artifact.kind != "NORMALIZED_RESULT"
            or artifact.format_identifier != "chemdft.worker.vibrational-analysis"
        ):
            continue
        if artifact.sha256 != reference["sha256"]:
            raise ThermochemistryGateFailed(
                "THERMO_ENERGY_UNAVAILABLE",
                "Electronic-energy artifact hash differs from provenance.",
            )
        data = object_store.get_bytes(artifact.storage_key, max_bytes)
        if hashlib.sha256(data).hexdigest() != artifact.sha256:
            raise ThermochemistryGateFailed(
                "THERMO_ENERGY_UNAVAILABLE", "Electronic-energy artifact content hash mismatch."
            )
        document = json.loads(data)
        energy = document.get("total_energy_hartree")
        if (
            not isinstance(energy, (int, float))
            or not math.isfinite(float(energy))
            or document.get("converged") is not True
        ):
            raise ThermochemistryGateFailed(
                "THERMO_ENERGY_UNAVAILABLE", "Electronic energy E0 is missing or not converged."
            )
        stored = [float(value) for value in document.get("frequencies_cm1", [])]
        mine = [float(mode.frequency_cm1) for mode in payload.modes]
        if len(stored) != len(mine) or any(
            abs(a - b) > 1e-9 for a, b in zip(stored, mine, strict=True)
        ):
            raise ThermochemistryGateFailed(
                "THERMO_ENERGY_UNAVAILABLE",
                "Energy artifact frequencies differ from the result payload.",
            )
        return artifact, float(energy)
    raise ThermochemistryGateFailed(
        "THERMO_ENERGY_UNAVAILABLE",
        "No hash-referenced electronic-energy artifact accompanies the frequency result.",
    )


def thermochemistry_input_fields(
    evidence: ThermochemistryGateEvidence, options: ThermochemistryOptions
) -> dict[str, Any]:
    """Fields added to the normalized worker input; the worker needs nothing else."""
    return {
        "source_frequency_result_id": str(options.source_frequency_result_id),
        "frequency_result_sha256": evidence.frequency_payload.result_sha256,
        "frequency_calculation_id": evidence.frequency_calculation_id,
        "optimization_result_id": evidence.optimization_result.id,
        "optimization_result_sha256": evidence.optimization_result_sha256,
        "optimization_calculation_id": evidence.trajectory.calculation_id,
        "energy_artifact_id": evidence.energy_artifact.id,
        "energy_artifact_sha256": evidence.energy_artifact.sha256,
        "electronic_energy_hartree": evidence.electronic_energy_hartree,
        "frequencies_cm1": list(evidence.frequencies_cm1),
        "geometry_hash": evidence.frequency_payload.equilibrium_coordinates_hash,
        "temperature_k": options.temperature_k,
        "pressure_pa": options.pressure_pa,
        "thermo_model": options.thermo_model,
        "imaginary_mode_policy": options.imaginary_mode_policy,
        "low_frequency_warning_cm1": options.low_frequency_warning_cm1,
        "symmetry_number_override": options.symmetry_number_override,
        "symmetry_override_reason": options.symmetry_override_reason,
        "stationarity": evidence.stationarity,
    }


# --------------------------------------------------------------------------------------
# Independent reference implementation (numpy) used to validate PySCF output at publication.
# --------------------------------------------------------------------------------------


def reference_rrho(
    *,
    temperature: float,
    pressure: float,
    total_mass_amu: float,
    rotational_constants_ghz: list[float],
    rotor_type: str,
    sigma: int,
    multiplicity: int,
    frequencies_cm1: list[float],
    electronic_energy: float,
    constants: dict[str, float],
) -> dict[str, float]:
    """Closed-form RRHO from the recorded constants (Eh, Eh/K). Independent of PySCF."""
    kb = constants["boltzmann_j_per_k"]
    h = constants["planck_j_s"]
    eh = constants["hartree_j"]
    c = constants["speed_of_light_m_per_s"]
    amu = constants["atomic_mass_kg"]
    t = temperature
    r = kb / eh  # Eh/K
    q_trans = (2 * math.pi * total_mass_amu * amu * kb * t / h**2) ** 1.5 * kb * t / pressure
    s_trans = r * (2.5 + math.log(q_trans))
    abc = [x * 1e9 for x in rotational_constants_ghz]
    if rotor_type == "LINEAR":
        q_rot = kb * t / (sigma * h * abc[1])
        s_rot = r * (1 + math.log(q_rot))
        e_rot, cv_rot = r * t, r
    else:
        q_rot = (
            (kb * t / h) ** 1.5 * math.sqrt(math.pi) / (sigma * math.sqrt(abc[0] * abc[1] * abc[2]))
        )
        s_rot = r * (1.5 + math.log(q_rot))
        e_rot, cv_rot = 1.5 * r * t, 1.5 * r
    theta = [nu * 1e2 * c * h / kb for nu in frequencies_cm1]
    x = [th / t for th in theta]
    zpe = r * 0.5 * sum(theta)
    thermal_vib = r * t * sum(xi / math.expm1(xi) for xi in x)
    s_vib = r * sum(xi / math.expm1(xi) - math.log1p(-math.exp(-xi)) for xi in x)
    cv_vib = r * sum(math.exp(-xi) * xi**2 / (1 - math.exp(-xi)) ** 2 for xi in x)
    s_elec = r * math.log(multiplicity)
    s_total = s_trans + s_rot + s_vib + s_elec
    energy = electronic_energy + 1.5 * r * t + e_rot + zpe + thermal_vib
    enthalpy = energy + r * t
    return {
        "zpe": zpe,
        "entropy": s_total,
        "internal_energy": energy,
        "enthalpy": enthalpy,
        "gibbs": enthalpy - t * s_total,
        "cv": 1.5 * r + cv_rot + cv_vib,
        "cp": 2.5 * r + cv_rot + cv_vib,
    }


def build_thermochemistry_payload(
    worker_result: dict[str, Any],
    evidence: ThermochemistryGateEvidence,
    *,
    calculation_id: str,
    calculation_input_hash: str,
    energy_artifact_reference: dict[str, Any],
) -> ThermochemistryResult:
    """Assemble and fully validate the authoritative payload from worker output.

    Raises ``ValueError`` (surfaced as RESULT_VALIDATION_FAILED) on any disagreement.
    """
    if (
        worker_result.get("schema") != "chemdft.worker.thermochemistry"
        or worker_result.get("task") != "THERMOCHEMISTRY"
    ):
        raise ValueError("Worker result type does not match THERMOCHEMISTRY")
    if worker_result.get("converged") is not True or worker_result.get("finite") is not True:
        raise ValueError("Non-finite thermochemistry result cannot be published")
    if worker_result.get("engine_version") != PYSCF_THERMO_VERSION:
        raise ValueError("Thermochemistry is validated for PySCF 2.14.0 only")
    raw = worker_result["raw"]

    def value(key: str) -> float:
        return float(raw[key]["value"])

    temperature = float(worker_result["temperature_k"])
    pressure = float(worker_result["pressure_pa"])
    constants = worker_result["constants"]
    e0 = value("E0")
    if e0 != evidence.electronic_energy_hartree:
        raise ValueError("Worker electronic energy differs from the validated persisted E0")
    if [float(x) for x in worker_result["frequencies_cm1"]] != list(evidence.frequencies_cm1):
        raise ValueError("Worker frequencies differ from the validated persisted frequencies")
    if worker_result["atom_identities"] != list(evidence.frequency_payload.atom_identities):
        raise ValueError("Worker atom ordering differs from the persisted geometry")

    # Recompute sigma independently on the API side (deterministic) and require agreement.
    symmetry = dict(worker_result["symmetry"])
    sigma = int(symmetry["rotational_symmetry_number"])
    expected_sigma = evidence.symmetry["rotational_symmetry_number"]
    if sigma != expected_sigma or symmetry["source"] != evidence.symmetry["source"]:
        raise ValueError("Worker symmetry number differs from the validated symmetry determination")
    if int(raw["sym_number"]["value"]) != sigma:
        raise ValueError("Thermochemistry kernel used a different symmetry number")

    reference = reference_rrho(
        temperature=temperature,
        pressure=pressure,
        total_mass_amu=float(worker_result["total_mass_amu"]),
        rotational_constants_ghz=list(worker_result["rotational_constants_ghz"]),
        rotor_type=worker_result["rotor_type"],
        sigma=sigma,
        multiplicity=int(worker_result["multiplicity"]),
        frequencies_cm1=list(worker_result["frequencies_cm1"]),
        electronic_energy=e0,
        constants=constants,
    )
    engine = {
        "zpe": value("ZPE"),
        "entropy": value("S_tot"),
        "internal_energy": value("E_tot"),
        "enthalpy": value("H_tot"),
        "gibbs": value("G_tot"),
        "cv": value("Cv_tot"),
        "cp": value("Cp_tot"),
    }
    for key, expected in reference.items():
        tolerance = 1e-12 if key in {"entropy", "cv", "cp"} else 1e-9
        if abs(engine[key] - expected) > tolerance:
            raise ValueError(
                f"PySCF {key} disagrees with the independent RRHO evaluation "
                f"({engine[key]!r} vs {expected!r})"
            )

    def component(name: str) -> dict[str, float]:
        return {
            "energy_hartree": value(f"E_{name}"),
            "enthalpy_hartree": value(f"H_{name}"),
            "entropy_hartree_per_k": value(f"S_{name}"),
            "gibbs_hartree": value(f"G_{name}"),
            "cv_hartree_per_k": float(raw.get(f"Cv_{name}", {"value": 0.0})["value"]),
            "cp_hartree_per_k": float(raw.get(f"Cp_{name}", {"value": 0.0})["value"]),
        }

    threshold = LOW_FREQUENCY_WARNING_CM1
    modes = [
        {**mode, "low_frequency": mode["frequency_cm1"] < threshold}
        for mode in worker_result["vibrational_modes"]
    ]
    low_modes = [m for m in modes if m["low_frequency"]]
    low_entropy = sum(m["entropy_hartree_per_k"] for m in low_modes)
    warnings: list[str] = []
    if low_modes:
        listing = ", ".join(f"{m['frequency_cm1']:.1f}" for m in low_modes)
        warnings.append(
            f"{len(low_modes)} real mode(s) below {threshold:.0f} cm^-1 ({listing} cm^-1): "
            "pure-RRHO entropy may be unreliable for very soft modes; no correction was applied."
        )
    if symmetry.get("pyscf_cross_check_agrees") is False and symmetry["source"] != "user-override":
        warnings.append(
            "PySCF's point-group symmetry number differs from ChemDFT's tolerance-aware value "
            f"({symmetry.get('pyscf_point_group_sigma')} vs {sigma}); ChemDFT's value was used."
        )
    stationarity = evidence.stationarity
    thermodynamics = {
        "electronic_energy_hartree": e0,
        "zpe_hartree": engine["zpe"],
        "e0_plus_zpe_hartree": value("E_0K"),
        "internal_energy_hartree": engine["internal_energy"],
        "enthalpy_hartree": engine["enthalpy"],
        "gibbs_free_energy_hartree": engine["gibbs"],
        "entropy_hartree_per_k": engine["entropy"],
        "cv_hartree_per_k": engine["cv"],
        "cp_hartree_per_k": engine["cp"],
    }
    values: dict[str, Any] = {
        "payload_schema": "chemdft.thermochemistry",
        "payload_schema_version": "1.0.0",
        "task_type": "THERMOCHEMISTRY",
        "calculation_id": calculation_id,
        "calculation_input_hash": calculation_input_hash,
        "engine": "pyscf",
        "engine_version": worker_result["engine_version"],
        "thermo_api": "pyscf.hessian.thermo.thermo",
        "method": worker_result["method"],
        "basis": worker_result["basis"],
        "conditions": {
            "temperature_k": temperature,
            "pressure_pa": pressure,
            "pressure_atm": pressure / 101325.0,
            "gas_model": "ideal-gas",
            "thermo_model": "ideal-gas-rrho",
            "standard_state": "ideal-gas-at-specified-pressure",
            "reference_pressure_pa": 101325.0,
            "assumptions": list(ASSUMPTIONS),
        },
        "molecule": {
            "charge": worker_result["charge"],
            "multiplicity": worker_result["multiplicity"],
            "atom_identities": worker_result["atom_identities"],
            "equilibrium_coordinates_angstrom": worker_result["equilibrium_coordinates_angstrom"],
            "rotor_type": worker_result["rotor_type"],
            "rotational_constants_ghz": worker_result["rotational_constants_ghz"],
            "total_mass_amu": worker_result["total_mass_amu"],
            "mass_convention": "pyscf-isotope-average",
        },
        "symmetry": symmetry,
        "thermodynamics": thermodynamics,
        "corrections": {
            "reference": "electronic_energy_hartree",
            "includes_zpe": True,
            "thermal_correction_internal_energy_hartree": engine["internal_energy"] - e0,
            "thermal_correction_enthalpy_hartree": engine["enthalpy"] - e0,
            "thermal_correction_gibbs_hartree": engine["gibbs"] - e0,
        },
        "components": {
            "translational": component("trans"),
            "rotational": component("rot"),
            "vibrational": component("vib"),
            "electronic": component("elec"),
        },
        "vibrational_modes": modes,
        "diagnostics": {
            "imaginary_mode_policy": "reject",
            "imaginary_mode_count": 0,
            "lowest_real_frequency_cm1": min(evidence.frequencies_cm1),
            "low_frequency_policy": "warn-below-threshold-pure-rrho-no-correction",
            "low_frequency_threshold_cm1": threshold,
            "low_frequency_mode_indices": [m["index"] for m in low_modes],
            "low_frequency_entropy_hartree_per_k": low_entropy,
            "low_frequency_minus_ts_hartree": temperature * low_entropy,
            "stationarity": {
                "source": "optimization-trajectory-final-step",
                "gradient_rms_hartree_per_bohr": stationarity["gradient_rms_hartree_per_bohr"],
                "gradient_norm_hartree_per_bohr": stationarity["gradient_norm_hartree_per_bohr"],
                "criterion_rms_hartree_per_bohr": stationarity["criterion_rms_hartree_per_bohr"],
                "passed": True,
                "trajectory_step_index": stationarity["trajectory_step_index"],
            },
            "warnings": warnings,
        },
        "geometry_hash": evidence.frequency_payload.equilibrium_coordinates_hash,
        "input_structure_id": evidence.version.structure_id,
        "input_structure_version_id": evidence.version.id,
        "input_structure_hash": evidence.structure_artifact_sha256,
        "optimization_calculation_id": evidence.trajectory.calculation_id,
        "optimization_result_id": evidence.optimization_result.id,
        "optimization_result_sha256": evidence.optimization_result_sha256,
        "frequency_calculation_id": evidence.frequency_calculation_id,
        "frequency_result_id": evidence.frequency_result.id,
        "frequency_result_sha256": evidence.frequency_payload.result_sha256,
        "energy_artifact": energy_artifact_reference,
        "energy_artifact_sha256": evidence.energy_artifact.sha256,
        "energy_source_field": "total_energy_hartree",
        "frequencies_cm1": list(evidence.frequencies_cm1),
        "constants": constants,
        "energy_unit": "Eh",
        "entropy_unit": "Eh/K",
        "producer": "local.pyscf.worker",
        "adapter_version": worker_result["adapter_version"],
        "parser_version": worker_result["parser_version"],
        "validator_version": THERMOCHEMISTRY_VALIDATOR_VERSION,
        "schema_version": "1.0.0",
    }
    # Seal over the validated model's canonical serialization (not the raw dict) so that the
    # stored hash always equals ``thermochemistry_result_hash(payload)`` after any round trip.
    unsealed = ThermochemistryResult.model_validate({**values, "result_sha256": "0" * 64})
    return ThermochemistryResult.model_validate(
        {**unsealed.model_dump(mode="json"), "result_sha256": thermochemistry_result_hash(unsealed)}
    )
