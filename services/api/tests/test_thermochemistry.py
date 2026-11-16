"""Thermochemistry V1: symmetry number, validity gates, PySCF worker, contract and firewall.

Real PySCF runs (water optimization + frequency + thermochemistry) use the pinned scientific
worker, like the optimization/vibrational integration tests.
"""

from __future__ import annotations

import ast
import copy
import hashlib
import json
import math
import subprocess
import time
import uuid
from collections.abc import Generator
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from chemdft_api.auth import ensure_dev_identity
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.config import Settings, get_settings
from chemdft_api.context import Identity
from chemdft_api.contracts.results import (
    ThermochemistryResult,
    VibrationalAnalysis,
    thermochemistry_result_hash,
    vibrational_analysis_hash,
)
from chemdft_api.database import Base, get_session
from chemdft_api.main import app
from chemdft_api.scientific.engines import symmetry_number as sn
from chemdft_api.scientific.engines import thermochemistry as tc
from chemdft_api.scientific_models import (
    CalculationResultRecord,
    OptimizationTrajectoryRecord,
)
from chemdft_api.storage import LocalObjectStore
from fastapi.testclient import TestClient
from result_provenance_checks import assert_published_result_binding
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKER_PYTHON = REPO_ROOT / "services/scientific-worker/.venv/bin/python"
WORKER_SCRIPT = REPO_ROOT / "services/api/src/chemdft_api/scientific/engines/pyscf_worker.py"
HARTREE_TO_KCAL = 627.5094740631

# Scratch-reference neighbourhood from THERMOCHEMISTRY_DEPENDENCY_SPIKE.md (B3LYP/def2-SVP,
# optimized water, 298.15 K, 1 atm). Validation references only; production values come
# from the actual workflow.
REFERENCE = {
    "e0": -76.358315351,
    "zpe_kcal": 13.319,
    "u_corr_kcal": 15.098,
    "h_corr_kcal": 15.691,
    "g_corr_kcal": 2.235,
    "entropy_j_mol_k": 188.830,
    "cv_j_mol_k": 25.135,
    "cp_j_mol_k": 33.449,
}


# ----------------------------------------------------------------------------- symmetry


WATER = (["O", "H", "H"], [[0, 0, 0], [0, 0, 0.9572], [0.926627, 0, -0.239987]])


def _molecules() -> dict[str, tuple[list[str], list[list[float]], int]]:
    import math as m

    ring = [(1.397 * m.cos(k * m.pi / 3), 1.397 * m.sin(k * m.pi / 3), 0.0) for k in range(6)]
    hyd = [(2.481 * m.cos(k * m.pi / 3), 2.481 * m.sin(k * m.pi / 3), 0.0) for k in range(6)]
    d = 0.629
    sf = 1.564
    bf = 1.313
    return {
        "H2O": (WATER[0], WATER[1], 2),
        "NH3": (
            ["N", "H", "H", "H"],
            [
                [0, 0, 0.1165],
                [0, 0.9377, -0.2718],
                [0.8121, -0.4689, -0.2718],
                [-0.8121, -0.4689, -0.2718],
            ],
            3,
        ),
        "CH4": (
            ["C", "H", "H", "H", "H"],
            [[0, 0, 0], [d, d, d], [-d, -d, d], [-d, d, -d], [d, -d, -d]],
            12,
        ),
        "C6H6": (["C"] * 6 + ["H"] * 6, [list(p) for p in ring + hyd], 12),
        "C2H4": (
            ["C", "C", "H", "H", "H", "H"],
            [
                [0, 0, 0.667],
                [0, 0, -0.667],
                [0, 0.923, 1.238],
                [0, -0.923, 1.238],
                [0, 0.923, -1.238],
                [0, -0.923, -1.238],
            ],
            4,
        ),
        "BF3": (
            ["B", "F", "F", "F"],
            [[0, 0, 0]]
            + [
                [
                    bf * m.cos(m.pi / 2 + k * 2 * m.pi / 3),
                    bf * m.sin(m.pi / 2 + k * 2 * m.pi / 3),
                    0,
                ]
                for k in range(3)
            ],
            6,
        ),
        "SF6": (
            ["S"] + ["F"] * 6,
            [[0, 0, 0], [sf, 0, 0], [-sf, 0, 0], [0, sf, 0], [0, -sf, 0], [0, 0, sf], [0, 0, -sf]],
            24,
        ),
        "CO2": (["C", "O", "O"], [[0, 0, 0], [0, 0, 1.16], [0, 0, -1.16]], 2),
        "HF": (["H", "F"], [[0, 0, 0], [0, 0, 0.917]], 1),
    }


@pytest.mark.parametrize("name", list(_molecules()))
def test_symmetry_number_exact_geometries(name: str) -> None:
    elements, coordinates, expected = _molecules()[name]
    result = sn.rotational_symmetry_number(elements, coordinates)
    assert result.sigma == expected
    assert result.algorithm == sn.ALGORITHM
    assert result.algorithm_version == sn.ALGORITHM_VERSION
    assert result.tolerance_angstrom == sn.DEFAULT_TOLERANCE_ANGSTROM
    assert len(result.stability_checked_tolerances_angstrom) == 3


def test_water_sigma_is_two_and_survives_optimizer_scale_noise() -> None:
    elements, coordinates = WATER
    rng = np.random.default_rng(11)
    for noise in (1e-6, 1e-5, 1e-4, 1e-3):
        for _ in range(20):
            noisy = np.asarray(coordinates) + rng.normal(scale=noise, size=(3, 3))
            assert sn.rotational_symmetry_number(elements, noisy).sigma == 2


def test_pyscf_point_group_lookup_is_too_strict_but_chemdft_is_not() -> None:
    """The spike's finding, pinned: PySCF reports sigma = 1 for water at 1e-5 A noise."""
    script = (
        "import json, sys, numpy as np\n"
        "from pyscf import gto\n"
        "from pyscf.hessian import thermo\n"
        "rng = np.random.default_rng(1)\n"
        "base = np.array([[0,0,0],[0,0,0.9572],[0.926627,0,-0.239987]])\n"
        "out = []\n"
        "for _ in range(5):\n"
        "    a = base + rng.normal(scale=1e-5, size=base.shape)\n"
        "    m = gto.M(atom=[('O',a[0]),('H',a[1]),('H',a[2])], unit='Angstrom',"
        " basis='sto-3g', verbose=0)\n"
        "    out.append(int(thermo.rotational_symmetry_number(m)))\n"
        "print(json.dumps(out))\n"
    )
    completed = subprocess.run(
        [str(WORKER_PYTHON), "-c", script], capture_output=True, text=True, check=True, timeout=120
    )
    assert json.loads(completed.stdout) == [1, 1, 1, 1, 1]
    elements, coordinates = WATER
    rng = np.random.default_rng(1)
    noisy = np.asarray(coordinates) + rng.normal(scale=1e-5, size=(3, 3))
    assert sn.rotational_symmetry_number(elements, noisy).sigma == 2


def test_symmetry_agrees_with_pymatgen_on_exact_geometries() -> None:
    from pymatgen.core import Molecule
    from pymatgen.symmetry.analyzer import PointGroupAnalyzer

    for name, (elements, coordinates, expected) in _molecules().items():
        molecule = Molecule(elements, coordinates)
        analyzer = PointGroupAnalyzer(molecule, tolerance=0.01)
        assert analyzer.get_rotational_symmetry_number() == expected, name


def test_ambiguous_symmetry_is_rejected_not_defaulted_to_one() -> None:
    elements, coordinates = _molecules()["SF6"][0], _molecules()["SF6"][1]
    rng = np.random.default_rng(5)
    outcomes = []
    for _ in range(12):
        noisy = np.asarray(coordinates) + rng.normal(scale=1e-2, size=(7, 3))
        try:
            outcomes.append(sn.rotational_symmetry_number(elements, noisy).sigma)
        except sn.SymmetryUndetermined:
            outcomes.append("rejected")
    assert "rejected" in outcomes
    with pytest.raises(sn.SymmetryUndetermined):
        sn.rotational_symmetry_number(["H"] * 200, [[float(i), 0.0, 0.0] for i in range(200)])
    with pytest.raises(sn.SymmetryUndetermined):
        sn.rotational_symmetry_number(["H", "H"], [[0, 0, 0]])
    with pytest.raises(sn.SymmetryUndetermined):
        sn.rotational_symmetry_number(*WATER, tolerance_angstrom=1.0)


# ----------------------------------------------------------------------------- worker + contract


def _water_worker_input(
    frequencies: list[float] | None = None,
    *,
    temperature: float = 298.15,
    pressure: float = 101325.0,
    override: int | None = None,
) -> dict:
    return {
        "task": "THERMOCHEMISTRY",
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
        "atoms": [{"element": e, "xyz_angstrom": c} for e, c in zip(*WATER, strict=True)],
        "thermochemistry": {
            "temperature_k": temperature,
            "pressure_pa": pressure,
            "frequencies_cm1": frequencies
            or [1595.7025643827803, 3913.6238169875246, 4020.195278189008],
            "electronic_energy_hartree": -76.35812051264632,
            "symmetry_number_override": override,
            "symmetry_override_reason": "recorded test override" if override else None,
        },
    }


def _run_worker(tmp_path: Path, document: dict) -> tuple[int, dict | None, str]:
    input_path, result_path, log_path = (
        tmp_path / "in.json",
        tmp_path / "out.json",
        tmp_path / "log.txt",
    )
    input_path.write_text(json.dumps(document))
    completed = subprocess.run(
        [
            str(WORKER_PYTHON),
            str(WORKER_SCRIPT),
            "--input",
            str(input_path),
            "--result",
            str(result_path),
            "--log",
            str(log_path),
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    result = json.loads(result_path.read_text()) if result_path.exists() else None
    return completed.returncode, result, completed.stderr


def _fake_evidence(
    worker_result: dict, *, sigma: int = 2, source: str = "chemdft-proper-rotation-count"
):
    frequencies = tuple(worker_result["frequencies_cm1"])
    sha = "a" * 64
    return SimpleNamespace(
        electronic_energy_hartree=-76.35812051264632,
        frequencies_cm1=frequencies,
        frequency_payload=SimpleNamespace(
            atom_identities=("O", "H", "H"),
            result_sha256="b" * 64,
            equilibrium_coordinates_hash="c" * 64,
        ),
        frequency_result=SimpleNamespace(id=str(uuid.uuid4())),
        frequency_calculation_id=str(uuid.uuid4()),
        version=SimpleNamespace(id=str(uuid.uuid4()), structure_id=str(uuid.uuid4())),
        structure_artifact_sha256="d" * 64,
        trajectory=SimpleNamespace(calculation_id=str(uuid.uuid4())),
        optimization_result=SimpleNamespace(id=str(uuid.uuid4())),
        optimization_result_sha256="e" * 64,
        energy_artifact=SimpleNamespace(sha256=sha),
        symmetry={"rotational_symmetry_number": sigma, "source": source, "override_reason": None},
        stationarity={
            "gradient_rms_hartree_per_bohr": 3.0e-6,
            "gradient_norm_hartree_per_bohr": 5.0e-6,
            "criterion_rms_hartree_per_bohr": 3.0e-4,
            "trajectory_step_index": 3,
        },
    )


def _build_payload(worker_result: dict, evidence) -> ThermochemistryResult:
    return tc.build_thermochemistry_payload(
        worker_result,
        evidence,
        calculation_id=str(uuid.uuid4()),
        calculation_input_hash="f" * 64,
        energy_artifact_reference={
            "project_id": str(uuid.uuid4()),
            "artifact_id": str(uuid.uuid4()),
            "sha256": "a" * 64,
        },
    )


@pytest.fixture(scope="module")
def water_worker_result(tmp_path_factory) -> dict:
    code, result, stderr = _run_worker(tmp_path_factory.mktemp("thermo"), _water_worker_input())
    assert code == 0, stderr
    assert result is not None
    return result


def test_worker_reproduces_validated_pyscf_numbers_without_electronic_structure(
    water_worker_result: dict,
) -> None:
    raw = water_worker_result["raw"]
    # Persisted-geometry reference values from the validated spike (reuse path == live PySCF).
    assert raw["ZPE"]["value"] == pytest.approx(0.021709847764912374, abs=1e-12)
    assert raw["E_tot"]["value"] == pytest.approx(-76.3335748184036, abs=1e-10)
    assert raw["H_tot"]["value"] == pytest.approx(-76.33263063384749, abs=1e-10)
    assert raw["G_tot"]["value"] == pytest.approx(-76.3540415926039, abs=1e-10)
    assert raw["S_tot"]["value"] == pytest.approx(7.18127075513171e-05, rel=1e-12)
    assert water_worker_result["symmetry"]["rotational_symmetry_number"] == 2
    assert water_worker_result["symmetry"]["pyscf_cross_check_agrees"] is True
    assert water_worker_result["rotor_type"] == "NONLINEAR"
    assert water_worker_result["engine_version"] == "2.14.0"


def test_thermo_worker_never_imports_scf_dft_or_hessian_code() -> None:
    """T/P changes must not be able to trigger DFT/Hessian: the worker has no such imports."""
    source = (
        REPO_ROOT / "services/api/src/chemdft_api/scientific/engines/thermo_worker.py"
    ).read_text()
    tree = ast.parse(source)
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
            imported.update(f"{node.module}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
    forbidden = {
        "pyscf.dft",
        "pyscf.scf",
        "pyscf.geomopt",
        "pyscf.hessian.rhf",
        "pyscf.hessian.rks",
    }
    assert not (imported & forbidden)
    assert "Hessian(" not in source and ".kernel(" not in source and "geometric" not in source


def test_payload_matches_reference_independent_rrho_and_identities(
    water_worker_result: dict,
) -> None:
    payload = _build_payload(water_worker_result, _fake_evidence(water_worker_result))
    thermo = payload.thermodynamics
    assert payload.conditions.temperature_k == 298.15
    assert payload.conditions.pressure_atm == pytest.approx(1.0)
    assert payload.symmetry.rotational_symmetry_number == 2
    # corrections are explicitly relative to E0 (and include ZPE)
    assert payload.corrections.reference == "electronic_energy_hartree"
    assert payload.corrections.includes_zpe is True
    assert payload.corrections.thermal_correction_internal_energy_hartree == pytest.approx(
        thermo.internal_energy_hartree - thermo.electronic_energy_hartree, abs=1e-12
    )
    assert payload.corrections.thermal_correction_enthalpy_hartree == pytest.approx(
        thermo.enthalpy_hartree - thermo.electronic_energy_hartree, abs=1e-12
    )
    assert payload.corrections.thermal_correction_gibbs_hartree == pytest.approx(
        thermo.gibbs_free_energy_hartree - thermo.electronic_energy_hartree, abs=1e-12
    )
    # H = U + kT, G = H - TS, Cp - Cv = k (checked again, independent of the model validator)
    k_eh = payload.constants.boltzmann_j_per_k / payload.constants.hartree_j
    assert thermo.enthalpy_hartree - thermo.internal_energy_hartree == pytest.approx(
        k_eh * 298.15, abs=1e-12
    )
    assert thermo.gibbs_free_energy_hartree == pytest.approx(
        thermo.enthalpy_hartree - 298.15 * thermo.entropy_hartree_per_k, abs=1e-12
    )
    assert thermo.cp_hartree_per_k - thermo.cv_hartree_per_k == pytest.approx(k_eh, rel=1e-9)


def test_component_decomposition_sums_to_totals(water_worker_result: dict) -> None:
    payload = _build_payload(water_worker_result, _fake_evidence(water_worker_result))
    parts = [
        payload.components.translational,
        payload.components.rotational,
        payload.components.vibrational,
        payload.components.electronic,
    ]
    thermo = payload.thermodynamics
    assert sum(p.energy_hartree for p in parts) == pytest.approx(
        thermo.internal_energy_hartree, abs=1e-10
    )
    assert sum(p.enthalpy_hartree for p in parts) == pytest.approx(
        thermo.enthalpy_hartree, abs=1e-10
    )
    assert sum(p.gibbs_hartree for p in parts) == pytest.approx(
        thermo.gibbs_free_energy_hartree, abs=1e-10
    )
    assert sum(p.entropy_hartree_per_k for p in parts) == pytest.approx(
        thermo.entropy_hartree_per_k, abs=1e-14
    )
    assert sum(p.cv_hartree_per_k for p in parts) == pytest.approx(
        thermo.cv_hartree_per_k, abs=1e-14
    )
    assert payload.components.electronic.energy_hartree == thermo.electronic_energy_hartree
    # per-mode decomposition is exact too
    modes = payload.vibrational_modes
    assert sum(m.zpe_hartree for m in modes) == pytest.approx(thermo.zpe_hartree, abs=1e-14)
    assert sum(m.entropy_hartree_per_k for m in modes) == pytest.approx(
        payload.components.vibrational.entropy_hartree_per_k, abs=1e-14
    )
    assert sum(m.cv_hartree_per_k for m in modes) == pytest.approx(
        payload.components.vibrational.cv_hartree_per_k, abs=1e-14
    )
    assert not any(m.low_frequency for m in modes)
    assert payload.diagnostics.warnings == ()


def test_unit_conversion_is_deterministic_and_consistent(water_worker_result: dict) -> None:
    payload = _build_payload(water_worker_result, _fake_evidence(water_worker_result))
    c = payload.constants
    kj_per_mol = c.hartree_j * c.avogadro_per_mol / 1000.0
    kcal_per_mol = kj_per_mol / c.thermochemical_calorie_j
    assert kj_per_mol == pytest.approx(2625.4996, rel=1e-6)
    assert kcal_per_mol == pytest.approx(627.5095, rel=1e-6)
    zpe = payload.thermodynamics.zpe_hartree
    assert zpe * kj_per_mol / 4.184 == pytest.approx(zpe * kcal_per_mol, rel=1e-12)
    entropy_j = payload.thermodynamics.entropy_hartree_per_k * c.hartree_j * c.avogadro_per_mol
    assert entropy_j == pytest.approx(188.544, abs=1e-3)  # persisted-geometry value from the spike


def test_result_hash_is_stable_and_serialization_roundtrips(water_worker_result: dict) -> None:
    payload = _build_payload(water_worker_result, _fake_evidence(water_worker_result))
    assert thermochemistry_result_hash(payload) == payload.result_sha256
    dumped = payload.model_dump(mode="json")
    again = ThermochemistryResult.model_validate(json.loads(json.dumps(dumped)))
    assert again.result_sha256 == payload.result_sha256
    assert thermochemistry_result_hash(again) == payload.result_sha256
    tampered = copy.deepcopy(dumped)
    tampered["thermodynamics"]["gibbs_free_energy_hartree"] += 1e-6
    with pytest.raises(ValueError, match="Thermochemistry identity violated"):
        ThermochemistryResult.model_validate(tampered)
    assert thermochemistry_result_hash(tampered) != payload.result_sha256


def test_payload_rejects_inconsistent_worker_output(water_worker_result: dict) -> None:
    bad = copy.deepcopy(water_worker_result)
    bad["raw"]["G_tot"]["value"] += 1e-6
    with pytest.raises(ValueError, match="independent RRHO"):
        _build_payload(bad, _fake_evidence(bad))
    bad = copy.deepcopy(water_worker_result)
    with pytest.raises(ValueError, match="symmetry number"):
        _build_payload(bad, _fake_evidence(bad, sigma=1))
    bad = copy.deepcopy(water_worker_result)
    bad["raw"]["E0"]["value"] += 1e-3
    with pytest.raises(ValueError, match="persisted E0"):
        _build_payload(bad, _fake_evidence(water_worker_result))


def test_low_frequency_warning_without_silent_correction(tmp_path: Path) -> None:
    frequencies = [60.0, 1595.7025643827803, 3913.6238169875246]
    code, result, stderr = _run_worker(tmp_path, _water_worker_input(frequencies))
    assert code == 0, stderr
    payload = _build_payload(result, _fake_evidence(result))
    assert payload.diagnostics.low_frequency_mode_indices == (0,)
    assert payload.diagnostics.low_frequency_threshold_cm1 == 100.0
    assert payload.diagnostics.low_frequency_entropy_hartree_per_k == pytest.approx(
        payload.vibrational_modes[0].entropy_hartree_per_k
    )
    assert payload.diagnostics.low_frequency_minus_ts_hartree == pytest.approx(
        298.15 * payload.vibrational_modes[0].entropy_hartree_per_k
    )
    assert any(
        "RRHO" in warning and "below 100" in warning for warning in payload.diagnostics.warnings
    )
    # pure RRHO: the low mode contributes the uncorrected harmonic entropy, same as PySCF's total
    assert payload.components.vibrational.entropy_hartree_per_k == pytest.approx(
        result["raw"]["S_vib"]["value"], abs=1e-15
    )


def test_worker_rejects_imaginary_nonpositive_and_invalid_conditions(tmp_path: Path) -> None:
    for frequencies in ([-300.0, 1595.7, 3913.6], [0.0, 1595.7, 3913.6]):
        code, result, stderr = _run_worker(tmp_path, _water_worker_input(frequencies))
        assert code != 0 and result is None and "positive harmonic frequencies" in stderr
    for temperature in (0.0, -5.0, 10.0, 1e5):
        code, result, stderr = _run_worker(tmp_path, _water_worker_input(temperature=temperature))
        assert code != 0 and result is None
    for pressure in (0.0, -1.0, 1e12):
        code, result, stderr = _run_worker(tmp_path, _water_worker_input(pressure=pressure))
        assert code != 0 and result is None


def test_symmetry_override_is_recorded_not_silent(tmp_path: Path) -> None:
    code, result, stderr = _run_worker(tmp_path, _water_worker_input(override=1))
    assert code == 0, stderr
    assert result["symmetry"]["source"] == "user-override"
    assert result["symmetry"]["override_reason"] == "recorded test override"
    assert result["raw"]["sym_number"]["value"] == 1.0
    payload = _build_payload(result, _fake_evidence(result, sigma=1, source="user-override"))
    assert payload.symmetry.source == "user-override"
    assert payload.symmetry.override_reason == "recorded test override"
    # sigma 2 -> 1 raises S_rot by R ln 2 and G by -T R ln2
    reference = _run_worker(tmp_path, _water_worker_input())[1]
    delta_s = payload.thermodynamics.entropy_hartree_per_k - reference["raw"]["S_tot"]["value"]
    k_eh = payload.constants.boltzmann_j_per_k / payload.constants.hartree_j
    assert delta_s == pytest.approx(k_eh * math.log(2), rel=1e-9)


def test_legacy_vibrational_analysis_hash_compatibility() -> None:
    """Thermochemistry must not disturb sealed legacy VibrationalAnalysis records."""
    from chemdft_api.contracts.results import VibrationalMode

    assert "raman_method" in VibrationalAnalysis.model_fields
    zero = [(0.0, 0.0, 0.0)] * 3
    mode = {
        "index": 0,
        "frequency_cm1": 1600.0,
        "imaginary": False,
        "displacement_vectors": zero,
        "reduced_mass_amu": 1.08,
        "ir_intensity": None,
        "raman_activity": None,
    }
    assert VibrationalMode.model_validate(mode)
    h = "a" * 64
    legacy = {
        "payload_schema": "chemdft.vibrational-analysis",
        "payload_schema_version": "1.0.0",
        "task_type": "FREQUENCY",
        "calculation_id": str(uuid.uuid4()),
        "input_structure_version_id": str(uuid.uuid4()),
        "input_structure_hash": h,
        "calculation_specification_hash": h,
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
        "atom_identities": ["O", "H", "H"],
        "equilibrium_coordinates_angstrom": [[0.0, 0.0, 0.0], [0.0, 0.0, 0.96], [0.93, 0.0, -0.24]],
        "equilibrium_coordinates_hash": h,
        "hessian_artifact": {
            "project_id": str(uuid.uuid4()),
            "artifact_id": str(uuid.uuid4()),
            "sha256": h,
        },
        "hessian_sha256": h,
        "hessian_unit": "Eh/bohr^2",
        "modes": [mode, {**mode, "index": 1}, {**mode, "index": 2}],
        "expected_vibrational_mode_count": 3,
        "mode_ordering": "ascending_eigenvalue",
        "vector_convention": "pyscf_thermo_norm_mode",
        "vector_unit": "amu^-1/2",
        "hessian_type": "analytic",
        "dipole_derivative_method": None,
        "finite_difference_step_bohr": None,
        "intensity_unit": None,
        "coordinate_unit": "angstrom",
        "frequency_unit": "cm^-1",
        "parser_version": "1.0.0",
        "adapter_version": "1.0.0",
        "schema_version": "1.0.0",
    }
    # The legacy sealing algorithm hashed exactly these keys (none of the Raman-era additions).
    legacy["result_sha256"] = hashlib.sha256(
        json.dumps(legacy, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    payload = VibrationalAnalysis.model_validate(legacy)
    assert payload.result_sha256 == vibrational_analysis_hash(payload)


# ----------------------------------------------------------------------------- full chain


@pytest.fixture(scope="module")
def chain(tmp_path_factory) -> Generator[SimpleNamespace, None, None]:
    root = tmp_path_factory.mktemp("thermo-chain")
    settings = Settings(
        database_url=f"sqlite:///{root / 'test.db'}",
        object_root=root / "objects",
        auto_create_schema=True,
        dev_identity_enabled=True,
        dev_identity_header_override_enabled=True,
    )
    settings.scientific_worker_python = WORKER_PYTHON
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
    with engine.connect() as connection:
        connection.execute(text("PRAGMA foreign_keys=ON"))
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)
    with sessions() as session:
        ensure_dev_identity(session, settings)

    def override_session():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as client:
        identity = Identity(
            user_id=settings.dev_user_id, organization_id=settings.dev_organization_id
        )
        store = LocalObjectStore(settings.object_root)

        def run_jobs() -> None:
            with sessions() as session:
                while process_next_compute_job(session, identity, store, settings) is not None:
                    pass

        project = client.post("/v1/projects", json={"name": "Thermo", "slug": "thermo"}).json()
        pid = project["id"]
        imported = client.post(
            f"/v1/projects/{pid}/structures/imports",
            files={
                "upload": (
                    "water.xyz",
                    b"3\nwater\nO 0 0 0\nH 0 0 0.9572\nH 0.926627 0 -0.239987\n",
                    "chemical/x-xyz",
                )
            },
            data={
                "file_format": "XYZ",
                "idempotency_key": "thermo-import",
                "structure_name": "Water",
            },
        )
        assert imported.status_code == 201, imported.text
        source = imported.json()["version"]

        def specification(task: str, **extra) -> dict:
            return {
                "task_type": task,
                "method": {
                    "identifier": "b3lyp",
                    "display_name": "B3LYP",
                    "registry": "chemdft.method",
                },
                "basis": {
                    "identifier": "def2-svp",
                    "display_name": "def2-SVP",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
                **extra,
            }

        def submit(version_id: str, spec: dict, key: str):
            return client.post(
                f"/v1/projects/{pid}/calculations",
                json={
                    "structure_version": {
                        "project_id": pid,
                        "entity_type": "structure.version",
                        "entity_id": version_id,
                    },
                    "specification": spec,
                    "idempotency_key": key,
                },
            )

        hessian = {
            "strategy": "ANALYTIC",
            "exclude_translation_rotation": True,
            "coordinate_unit": "angstrom",
            "hessian_unit": "Eh/bohr^2",
            "frequency_unit": "cm^-1",
        }
        # imported-geometry frequency (NOT stationary): must be refused by the gate
        legacy_frequency = submit(
            source["id"], specification("FREQUENCY", hessian=hessian), "thermo-freq-imported"
        )
        assert legacy_frequency.status_code == 201, legacy_frequency.text
        optimization = submit(
            source["id"],
            specification(
                "GEOMETRY_OPTIMIZATION", optimization={"optimizer": "geometric", "max_steps": 100}
            ),
            "thermo-opt",
        )
        assert optimization.status_code == 201, optimization.text
        run_jobs()
        versions = client.get(
            f"/v1/projects/{pid}/structures/{source['structure_id']}/versions"
        ).json()
        optimized = versions[-1]["version"]
        assert optimized["origin"] == "OPTIMIZED"
        frequency = submit(
            optimized["id"], specification("FREQUENCY", hessian=hessian), "thermo-freq-optimized"
        )
        assert frequency.status_code == 201, frequency.text
        run_jobs()

        def detail(calculation_id: str) -> dict:
            return client.get(f"/v1/projects/{pid}/calculations/{calculation_id}").json()

        state = SimpleNamespace(
            client=client,
            sessions=sessions,
            settings=settings,
            identity=identity,
            store=store,
            project_id=pid,
            source_version=source,
            optimized_version=optimized,
            legacy_frequency=detail(legacy_frequency.json()["calculation"]["id"]),
            optimization=detail(optimization.json()["calculation"]["id"]),
            frequency=detail(frequency.json()["calculation"]["id"]),
            specification=specification,
            submit=submit,
            run_jobs=run_jobs,
            detail=detail,
        )
        assert state.optimization["calculation"]["state"] == "SUCCEEDED"
        assert state.frequency["calculation"]["state"] == "SUCCEEDED", (
            (state.frequency.get("attempt") or {}).get("failure_code"),
            str((state.frequency.get("attempt") or {}).get("diagnostic"))[:600].replace(
                "\n", " | "
            ),
        )
        assert state.legacy_frequency["calculation"]["state"] == "SUCCEEDED"
        yield state
    app.dependency_overrides.clear()
    engine.dispose()


def _thermo_spec(chain, frequency_detail: dict, **options) -> dict:
    return chain.specification(
        "THERMOCHEMISTRY",
        thermochemistry={
            "source_frequency_result_id": frequency_detail["result"]["id"],
            **options,
        },
    )


def _expect_gate(chain, version_id: str, spec: dict, code: str, key: str):
    response = chain.submit(version_id, spec, key)
    assert response.status_code == 422, response.text
    assert code in response.json()["detail"], response.json()["detail"]


def test_water_optimized_chain_publishes_authoritative_thermochemistry(chain) -> None:
    response = chain.submit(
        chain.optimized_version["id"], _thermo_spec(chain, chain.frequency), "thermo-water-default"
    )
    assert response.status_code == 201, response.text
    queued = response.json()
    assert queued["calculation"]["state"] == "QUEUED"
    chain.run_jobs()
    detail = chain.detail(queued["calculation"]["id"])
    assert detail["calculation"]["state"] == "SUCCEEDED", detail.get("attempt")
    result = detail["result"]
    assert result["result_type"] == "chemdft.thermochemistry"
    assert_published_result_binding(chain.sessions, result["id"], chain.optimized_version["id"])
    assert result["authority"] == "AUTHORITATIVE"
    assert result["source_class"] == "CALCULATED"
    assert result["validation_state"] == "VALIDATED"
    payload = result["payload"]
    assert payload["conditions"]["temperature_k"] == 298.15
    assert payload["conditions"]["pressure_pa"] == 101325.0
    assert payload["symmetry"]["rotational_symmetry_number"] == 2
    assert payload["symmetry"]["source"] == "chemdft-proper-rotation-count"
    assert payload["diagnostics"]["stationarity"]["passed"] is True
    assert payload["diagnostics"]["stationarity"]["gradient_rms_hartree_per_bohr"] <= 3e-4
    assert payload["diagnostics"]["imaginary_mode_count"] == 0
    thermo = payload["thermodynamics"]
    corrections = payload["corrections"]
    c = payload["constants"]
    kj = c["hartree_j"] * c["avogadro_per_mol"] / 1000.0
    kcal = kj / 4.184
    assert thermo["electronic_energy_hartree"] == pytest.approx(REFERENCE["e0"], abs=2e-6)
    assert thermo["zpe_hartree"] * kcal == pytest.approx(REFERENCE["zpe_kcal"], abs=0.01)
    assert corrections["thermal_correction_internal_energy_hartree"] * kcal == pytest.approx(
        REFERENCE["u_corr_kcal"], abs=0.01
    )
    assert corrections["thermal_correction_enthalpy_hartree"] * kcal == pytest.approx(
        REFERENCE["h_corr_kcal"], abs=0.01
    )
    assert corrections["thermal_correction_gibbs_hartree"] * kcal == pytest.approx(
        REFERENCE["g_corr_kcal"], abs=0.01
    )
    assert thermo["entropy_hartree_per_k"] * kj * 1000 == pytest.approx(
        REFERENCE["entropy_j_mol_k"], abs=0.02
    )
    assert thermo["cv_hartree_per_k"] * kj * 1000 == pytest.approx(
        REFERENCE["cv_j_mol_k"], abs=0.02
    )
    assert thermo["cp_hartree_per_k"] * kj * 1000 == pytest.approx(
        REFERENCE["cp_j_mol_k"], abs=0.02
    )
    # provenance chain
    assert payload["frequency_result_id"] == chain.frequency["result"]["id"]
    assert payload["optimization_result_id"] == chain.optimization["result"]["id"]
    assert payload["input_structure_version_id"] == chain.optimized_version["id"]
    assert (
        payload["geometry_hash"]
        == chain.frequency["result"]["payload"]["equilibrium_coordinates_hash"]
    )
    assert payload["engine_version"] == "2.14.0"
    assert payload["thermo_api"] == "pyscf.hessian.thermo.thermo"
    kinds = {a["artifact_id"] for a in result["raw_artifacts"]}
    assert payload["energy_artifact"]["artifact_id"] in kinds
    # idempotent: the same request returns the same calculation without re-queueing
    again = chain.submit(
        chain.optimized_version["id"], _thermo_spec(chain, chain.frequency), "thermo-water-default"
    )
    assert again.status_code == 201
    assert again.json()["calculation"]["id"] == queued["calculation"]["id"]


def test_temperature_pressure_change_reuses_persisted_data_without_scf_or_hessian(chain) -> None:
    jobs_before = _compute_job_workloads(chain)
    start = time.monotonic()
    response = chain.submit(
        chain.optimized_version["id"],
        _thermo_spec(chain, chain.frequency, temperature_k=350.0, pressure_pa=202650.0),
        "thermo-water-350k-2atm",
    )
    assert response.status_code == 201, response.text
    chain.run_jobs()
    detail = chain.detail(response.json()["calculation"]["id"])
    assert detail["calculation"]["state"] == "SUCCEEDED", detail.get("attempt")
    elapsed = time.monotonic() - start
    payload = detail["result"]["payload"]
    assert payload["conditions"]["temperature_k"] == 350.0
    assert payload["conditions"]["pressure_atm"] == pytest.approx(2.0)
    default = _default_payload(chain)
    # E0, frequencies and ZPE are temperature/pressure independent; H, S, G are not
    assert (
        payload["thermodynamics"]["electronic_energy_hartree"]
        == default["thermodynamics"]["electronic_energy_hartree"]
    )
    assert payload["thermodynamics"]["zpe_hartree"] == default["thermodynamics"]["zpe_hartree"]
    assert payload["frequencies_cm1"] == default["frequencies_cm1"]
    assert (
        payload["thermodynamics"]["enthalpy_hartree"]
        > default["thermodynamics"]["enthalpy_hartree"]
    )
    assert (
        payload["thermodynamics"]["gibbs_free_energy_hartree"]
        != default["thermodynamics"]["gibbs_free_energy_hartree"]
    )
    # no electronic-structure work was scheduled: only a thermochemistry workload was added,
    # and the new calculation stores no Hessian / trajectory artifacts
    new = _compute_job_workloads(chain) - jobs_before
    assert dict(new) == {"chemdft.pyscf.thermochemistry.v1": 1}
    with chain.sessions() as session:
        from chemdft_api.scientific_models import ScientificArtifactRecord

        artifacts = session.scalars(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.source_relation_id == detail["calculation"]["id"]
            )
        ).all()
        assert not [a for a in artifacts if a.kind in {"HESSIAN_MATRIX", "RAMAN_ANALYSIS"}]
    assert elapsed < 60


def _compute_job_workloads(chain):
    from collections import Counter

    from chemdft_api.scientific_models import ComputeJobRecord

    with chain.sessions() as session:
        return Counter(
            job.workload_json["workload_type"] for job in session.scalars(select(ComputeJobRecord))
        )


def _default_payload(chain) -> dict:
    with chain.sessions() as session:
        records = session.scalars(
            select(CalculationResultRecord).where(
                CalculationResultRecord.result_type == "chemdft.thermochemistry"
            )
        ).all()
    for record in records:
        if record.payload_json["conditions"]["temperature_k"] == 298.15:
            return record.payload_json
    raise AssertionError("default thermochemistry result is missing")


def test_gate_rejects_geometry_that_is_not_a_chemdft_optimization(chain) -> None:
    _expect_gate(
        chain,
        chain.source_version["id"],
        _thermo_spec(chain, chain.legacy_frequency),
        "THERMO_GEOMETRY_NOT_OPTIMIZED",
        "thermo-gate-imported",
    )


@pytest.mark.parametrize("evidence", ["large", "null", "missing"])
def test_gate_rejects_non_stationary_gradient(chain, evidence) -> None:
    with chain.sessions() as session:
        trajectory = session.scalar(
            select(OptimizationTrajectoryRecord).where(
                OptimizationTrajectoryRecord.final_structure_version_id
                == chain.optimized_version["id"]
            )
        )
        original = copy.deepcopy(trajectory.steps_json)
        steps = copy.deepcopy(original)
        if evidence == "missing":
            steps[-1].pop("gradient_rms_hartree_per_bohr")
        else:
            steps[-1]["gradient_rms_hartree_per_bohr"] = None if evidence == "null" else 1.0e-3
        trajectory.steps_json = steps
        session.commit()
    try:
        _expect_gate(
            chain,
            chain.optimized_version["id"],
            _thermo_spec(chain, chain.frequency, temperature_k=310.0),
            "THERMO_GEOMETRY_NOT_STATIONARY",
            "thermo-gate-gradient",
        )
    finally:
        with chain.sessions() as session:
            trajectory = session.scalar(
                select(OptimizationTrajectoryRecord).where(
                    OptimizationTrajectoryRecord.final_structure_version_id
                    == chain.optimized_version["id"]
                )
            )
            trajectory.steps_json = original
            session.commit()


def _set_frequency_record(
    chain, *, payload: dict | None = None, raw_artifacts: list | None = None
) -> None:
    """Results are append-only through the ORM; tests doctor the *test* database with raw SQL."""
    with chain.sessions() as session:
        if payload is not None:
            session.execute(
                text("UPDATE calculation_results SET payload_json = :v WHERE id = :i"),
                {"v": json.dumps(payload), "i": chain.frequency["result"]["id"]},
            )
        if raw_artifacts is not None:
            session.execute(
                text("UPDATE calculation_results SET raw_artifacts_json = :v WHERE id = :i"),
                {"v": json.dumps(raw_artifacts), "i": chain.frequency["result"]["id"]},
            )
        session.commit()


def _frequency_record_snapshot(chain) -> tuple[dict, list]:
    with chain.sessions() as session:
        record = session.get(CalculationResultRecord, chain.frequency["result"]["id"])
        return copy.deepcopy(record.payload_json), copy.deepcopy(record.raw_artifacts_json)


def test_gate_rejects_any_imaginary_mode_before_calling_pyscf(chain) -> None:
    original_payload, original_raw = _frequency_record_snapshot(chain)
    analysis = VibrationalAnalysis.model_validate(original_payload)
    modes = list(analysis.modes)
    modes[0] = modes[0].model_copy(update={"frequency_cm1": -125.0, "imaginary": True})
    mutated = analysis.model_copy(update={"modes": tuple(modes)})
    sealed = mutated.model_copy(update={"result_sha256": vibrational_analysis_hash(mutated)})
    _set_frequency_record(chain, payload=sealed.model_dump(mode="json"))
    try:
        # a doctored but still validly sealed VibrationalAnalysis ...
        assert (
            VibrationalAnalysis.model_validate(_frequency_record_snapshot(chain)[0])
            .modes[0]
            .imaginary
        )
        # ... is refused by ChemDFT before PySCF is ever called (PySCF would silently drop it)
        _expect_gate(
            chain,
            chain.optimized_version["id"],
            _thermo_spec(chain, chain.frequency, temperature_k=311.0),
            "THERMO_IMAGINARY_MODES",
            "thermo-gate-imaginary",
        )
    finally:
        _set_frequency_record(chain, payload=original_payload, raw_artifacts=original_raw)


def test_gate_rejects_missing_electronic_energy_artifact(chain) -> None:
    original_payload, original_raw = _frequency_record_snapshot(chain)
    _set_frequency_record(chain, raw_artifacts=[])
    try:
        _expect_gate(
            chain,
            chain.optimized_version["id"],
            _thermo_spec(chain, chain.frequency, temperature_k=312.0),
            "THERMO_ENERGY_UNAVAILABLE",
            "thermo-gate-energy",
        )
    finally:
        _set_frequency_record(chain, payload=original_payload, raw_artifacts=original_raw)


def test_requests_with_invalid_temperature_or_pressure_are_rejected(chain) -> None:
    for options in (
        {"temperature_k": 0},
        {"temperature_k": -10.0},
        {"temperature_k": 10.0},
        {"temperature_k": 5000.0},
        {"pressure_pa": 0},
        {"pressure_pa": -101325.0},
        {"pressure_pa": 1e12},
    ):
        response = chain.submit(
            chain.optimized_version["id"],
            _thermo_spec(chain, chain.frequency, **options),
            f"thermo-invalid-{json.dumps(options)}",
        )
        assert response.status_code == 422, (options, response.text)


def test_thermochemistry_cannot_request_new_electronic_structure_work(chain) -> None:
    spec = _thermo_spec(chain, chain.frequency, temperature_k=320.0)
    spec["hessian"] = {
        "strategy": "ANALYTIC",
        "exclude_translation_rotation": True,
        "coordinate_unit": "angstrom",
        "hessian_unit": "Eh/bohr^2",
        "frequency_unit": "cm^-1",
    }
    response = chain.submit(chain.optimized_version["id"], spec, "thermo-no-hessian")
    assert response.status_code == 422, response.text
    spec = _thermo_spec(chain, chain.frequency, temperature_k=321.0)
    spec["optimization"] = {"optimizer": "geometric", "max_steps": 5}
    assert chain.submit(chain.optimized_version["id"], spec, "thermo-no-opt").status_code == 422


def test_unknown_source_or_wrong_structure_is_rejected(chain) -> None:
    spec = chain.specification(
        "THERMOCHEMISTRY", thermochemistry={"source_frequency_result_id": str(uuid.uuid4())}
    )
    _expect_gate(
        chain, chain.optimized_version["id"], spec, "THERMO_SOURCE_NOT_FOUND", "thermo-gate-missing"
    )
    _expect_gate(
        chain,
        chain.source_version["id"],
        _thermo_spec(chain, chain.frequency, temperature_k=330.0),
        "THERMO_STRUCTURE_MISMATCH",
        "thermo-gate-structure",
    )


def test_firewall_rejects_tampered_thermochemistry_publication(chain) -> None:
    """The firewall independently re-validates relationships even if a producer lies."""
    from chemdft_api.contracts.provenance import ProvenanceClass  # noqa: F401
    from chemdft_api.contracts.results import AuthoritativeResultSubmission
    from chemdft_api.errors import ScientificValidationFailed
    from chemdft_api.scientific_actions import accept_authoritative_result
    from chemdft_api.scientific_models import ProvenanceRecordRow
    from chemdft_api.trusted_producers import ProducerType, issue_trusted_producer_context

    default = _default_payload(chain)
    with chain.sessions() as session:
        record = next(
            r
            for r in session.scalars(
                select(CalculationResultRecord).where(
                    CalculationResultRecord.result_type == "chemdft.thermochemistry"
                )
            )
            if r.payload_json["conditions"]["temperature_k"] == 298.15
        )
        calculation_id = record.calculation_id
        provenance = session.get(ProvenanceRecordRow, record.provenance_record_id)
        base = {
            "result_type": "chemdft.thermochemistry",
            "project_id": record.project_id,
            "calculation_id": record.calculation_id,
            "calculation_input_id": record.calculation_input_id,
            "producer_software": record.producer_software_json,
            "provenance_record_id": record.provenance_record_id,
            "raw_artifacts": record.raw_artifacts_json,
            "request_id": str(uuid.uuid4()),
            "correlation_id": record.correlation_id,
        }
        del provenance

        def attempt(mutated: dict, key: str) -> None:
            mutated["result_sha256"] = thermochemistry_result_hash(mutated)
            submission = AuthoritativeResultSubmission.model_validate(
                {
                    **base,
                    "payload": mutated,
                    "idempotency_key": key,
                    "request_id": str(uuid.uuid4()),
                }
            )
            producer = issue_trusted_producer_context(
                producer_id="local.pyscf.worker",
                producer_type=ProducerType.SCIENTIFIC_WORKER,
                project_id=uuid.UUID(record.project_id),
                attestation_id="test-attestation",
            )
            # Duplicate publication needs a fresh idempotency key; calculation is already SUCCEEDED.
            accept_authoritative_result(session, producer, submission)

        for field, change in (
            ("symmetry", lambda p: p["symmetry"].update(rotational_symmetry_number=1)),
            ("optimization", lambda p: p.update(optimization_result_sha256="0" * 64)),
            ("frequency", lambda p: p.update(frequency_result_sha256="0" * 64)),
            ("geometry", lambda p: p.update(geometry_hash="1" * 64)),
            ("conditions", lambda p: p["conditions"].update(temperature_k=299.0, pressure_atm=1.0)),
            (
                "stationarity",
                lambda p: p["diagnostics"]["stationarity"].update(
                    gradient_rms_hartree_per_bohr=1e-6
                ),
            ),
        ):
            mutated = copy.deepcopy(default)
            change(mutated)
            if field == "symmetry":
                mutated["symmetry"]["source"] = "chemdft-proper-rotation-count"
            with pytest.raises((ScientificValidationFailed, ValueError)):
                attempt(mutated, f"tamper-{field}")
            session.rollback()
    assert calculation_id
