from __future__ import annotations

import numpy as np
import pytest
from chemdft_api.scientific.engines.vibrational import validate_frequency_candidate


def test_raman_placzek_invariants_and_activity_math() -> None:
    """J, K, L, M. Test Placzek alpha-bar, gamma-squared, Raman activity,
    and depolarization ratio."""
    # Synthetic symmetric derivative tensor dalpha/dQ:
    # Let dalpha_dQ be diagonal: [2.0, 1.0, 1.0] A^2/amu^0.5
    dalpha = np.diag([2.0, 1.0, 1.0])
    alpha_bar = np.trace(dalpha) / 3.0  # (2 + 1 + 1) / 3 = 4/3
    assert abs(alpha_bar - 4.0 / 3.0) < 1e-12

    # Anisotropy:
    # 0.5 * [ (2-1)^2 + (1-1)^2 + (1-2)^2 + 6*0 ] = 0.5 * [1 + 0 + 1] = 1.0
    gamma_sq = 0.5 * (
        (dalpha[0, 0] - dalpha[1, 1]) ** 2
        + (dalpha[1, 1] - dalpha[2, 2]) ** 2
        + (dalpha[2, 2] - dalpha[0, 0]) ** 2
        + 6.0 * (dalpha[0, 1] ** 2 + dalpha[1, 2] ** 2 + dalpha[2, 0] ** 2)
    )
    assert abs(gamma_sq - 1.0) < 1e-12

    # Activity: S_k = 45 * alpha_bar^2 + 7 * gamma_sq
    # = 45 * (16/9) + 7 * 1 = 80 + 7 = 87.0
    sk = 45.0 * (alpha_bar**2) + 7.0 * gamma_sq
    assert abs(sk - 87.0) < 1e-12

    # Depolarization ratio: rho_p = 3 * gamma_sq / (45 * alpha_bar^2 + 4 * gamma_sq)
    # = 3 * 1 / (80 + 4) = 3 / 84 = 1 / 28
    rho_p = 3.0 * gamma_sq / (45.0 * (alpha_bar**2) + 4.0 * gamma_sq)
    assert abs(rho_p - 1.0 / 28.0) < 1e-12
    assert 0.0 <= rho_p <= 0.75


def test_raman_non_totally_symmetric_selection_rule() -> None:
    """M. Traceless polarizability derivative yields exact rho_p = 0.7500 (depolarized)."""
    # For a B2/asymmetric mode, trace(dalpha/dQ) == 0
    dalpha = np.array([
        [0.0, 0.0, 1.5],
        [0.0, 0.0, 0.0],
        [1.5, 0.0, 0.0],
    ])
    alpha_bar = np.trace(dalpha) / 3.0
    assert abs(alpha_bar) < 1e-12

    gamma_sq = 0.5 * (
        (dalpha[0, 0] - dalpha[1, 1]) ** 2
        + (dalpha[1, 1] - dalpha[2, 2]) ** 2
        + (dalpha[2, 2] - dalpha[0, 0]) ** 2
        + 6.0 * (dalpha[0, 1] ** 2 + dalpha[1, 2] ** 2 + dalpha[2, 0] ** 2)
    )
    denom = 45.0 * (alpha_bar**2) + 4.0 * gamma_sq
    rho_p = 3.0 * gamma_sq / denom
    assert abs(rho_p - 0.75) < 1e-12


def test_tensor_symmetrization_and_antisymmetry_residual() -> None:
    """E, F, G. Tensor approximate symmetry, symmetrization, and threshold."""
    # Synthetic nearly symmetric tensor
    alpha_raw = np.array([
        [1.0, 0.00002, 0.00001],
        [0.00001, 2.0, 0.00003],
        [0.00002, 0.00004, 3.0],
    ])
    antisym = alpha_raw - alpha_raw.T
    max_asym = float(np.max(np.abs(antisym)))
    assert max_asym == pytest.approx(1e-5, abs=1e-7)

    alpha_sym = 0.5 * (alpha_raw + alpha_raw.T)
    sym_diff = alpha_sym - alpha_sym.T
    assert np.allclose(sym_diff, 0.0, atol=1e-15)


def test_validator_rejects_non_finite_raman_activities() -> None:
    """O. Validator rejects NaN / Inf in Raman activities."""
    candidate = {
        "schema": "chemdft.worker.vibrational-analysis",
        "task": "FREQUENCY",
        "converged": True,
        "finite": True,
        "mode_count": 3,
        "hessian_hartree_per_bohr2": [
            [[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]] for _ in range(3)]
            for _ in range(3)
        ],
        "frequencies_cm1": [1595.7, 3913.6, 4020.2],
        "normal_modes_amu_minus_half": [
            [[0.0, 0.0, 0.0], [0.1, 0.2, 0.3], [-0.1, -0.2, -0.3]] for _ in range(3)
        ],
        "reduced_masses_amu": [1.08, 1.05, 1.08],
        "ir_intensities_km_mol": [59.0, 5.6, 32.4],
        "raman_activities_angstrom4_per_amu": [6.38, float("nan"), 34.7],
        "depolarization_ratios": [0.52, 0.17, 0.75],
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "mode_ordering": "ascending_eigenvalue",
        "vector_convention": "pyscf_thermo_norm_mode",
        "equilibrium_coordinates_angstrom": [
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 0.9572],
            [0.926627, 0.0, -0.239987],
        ],
    }
    input_doc = {
        "atoms": [
            {"element": "O", "xyz_angstrom": [0.0, 0.0, 0.0]},
            {"element": "H", "xyz_angstrom": [0.0, 0.0, 0.9572]},
            {"element": "H", "xyz_angstrom": [0.926627, 0.0, -0.239987]},
        ],
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
    }
    with pytest.raises(ValueError, match="Raman activities must be finite and non-negative"):
        validate_frequency_candidate(candidate, input_doc)


def test_validator_rejects_out_of_range_depolarization_ratio() -> None:
    """M, O. Depolarization ratio must be within physical range [0, 0.75]."""
    candidate = {
        "schema": "chemdft.worker.vibrational-analysis",
        "task": "FREQUENCY",
        "converged": True,
        "finite": True,
        "mode_count": 3,
        "hessian_hartree_per_bohr2": [
            [[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]] for _ in range(3)]
            for _ in range(3)
        ],
        "frequencies_cm1": [1595.7, 3913.6, 4020.2],
        "normal_modes_amu_minus_half": [
            [[0.0, 0.0, 0.0], [0.1, 0.2, 0.3], [-0.1, -0.2, -0.3]] for _ in range(3)
        ],
        "reduced_masses_amu": [1.08, 1.05, 1.08],
        "ir_intensities_km_mol": [59.0, 5.6, 32.4],
        "raman_activities_angstrom4_per_amu": [6.38, 74.42, 34.72],
        "depolarization_ratios": [0.52, 0.95, 0.75],  # 0.95 is unphysical!
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "mode_ordering": "ascending_eigenvalue",
        "vector_convention": "pyscf_thermo_norm_mode",
        "equilibrium_coordinates_angstrom": [
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 0.9572],
            [0.926627, 0.0, -0.239987],
        ],
    }
    input_doc = {
        "atoms": [
            {"element": "O", "xyz_angstrom": [0.0, 0.0, 0.0]},
            {"element": "H", "xyz_angstrom": [0.0, 0.0, 0.9572]},
            {"element": "H", "xyz_angstrom": [0.926627, 0.0, -0.239987]},
        ],
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
    }
    with pytest.raises(ValueError, match="Depolarization ratio out of physical range"):
        validate_frequency_candidate(candidate, input_doc)


def test_validator_rejects_excessive_polarizability_antisymmetry() -> None:
    """G. Excessively asymmetric polarizability tensor triggers validation rejection."""
    candidate = {
        "schema": "chemdft.worker.vibrational-analysis",
        "task": "FREQUENCY",
        "converged": True,
        "finite": True,
        "mode_count": 3,
        "hessian_hartree_per_bohr2": [
            [[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]] for _ in range(3)]
            for _ in range(3)
        ],
        "frequencies_cm1": [1595.7, 3913.6, 4020.2],
        "normal_modes_amu_minus_half": [
            [[0.0, 0.0, 0.0], [0.1, 0.2, 0.3], [-0.1, -0.2, -0.3]] for _ in range(3)
        ],
        "reduced_masses_amu": [1.08, 1.05, 1.08],
        "ir_intensities_km_mol": [59.0, 5.6, 32.4],
        "raman_activities_angstrom4_per_amu": [6.38, 74.42, 34.72],
        "depolarization_ratios": [0.52, 0.17, 0.75],
        "max_abs_antisymmetry": 0.005,  # 0.005 > 0.0001
        "polarizability_antisymmetry_tolerance": 0.0001,
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "mode_ordering": "ascending_eigenvalue",
        "vector_convention": "pyscf_thermo_norm_mode",
        "equilibrium_coordinates_angstrom": [
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 0.9572],
            [0.926627, 0.0, -0.239987],
        ],
    }
    input_doc = {
        "atoms": [
            {"element": "O", "xyz_angstrom": [0.0, 0.0, 0.0]},
            {"element": "H", "xyz_angstrom": [0.0, 0.0, 0.9572]},
            {"element": "H", "xyz_angstrom": [0.926627, 0.0, -0.239987]},
        ],
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
    }
    with pytest.raises(ValueError, match="Polarizability tensor antisymmetry residual"):
        validate_frequency_candidate(candidate, input_doc)


@pytest.mark.timeout(60)
def test_exact_water_raman_pyscf_regression(tmp_path) -> None:
    """R. Real PySCF integration test on exact persisted StructureVersion coordinates.
    
    Verifies:
    - Mode 1: ~1595.70 cm^-1, ~6.38 A^4/amu, rho ~0.52
    - Mode 2: ~3913.62 cm^-1, ~74.42 A^4/amu, rho ~0.17
    - Mode 3: ~4020.20 cm^-1, ~34.72 A^4/amu, rho ~0.75
    - IR / Raman complementarity: Mode 1 strongest in IR, Mode 2 strongest in Raman
    """
    import json
    import subprocess
    import sys
    from pathlib import Path

    worker_script = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "chemdft_api"
        / "scientific"
        / "engines"
        / "pyscf_worker.py"
    )
    repo_root = Path(__file__).resolve().parents[3]
    py_candidates = [
        repo_root / ".scientific-venv" / "bin" / "python",
        repo_root / "services" / "scientific-worker" / ".venv" / "bin" / "python",
    ]
    python_bin = next((p for p in py_candidates if p.exists()), Path(sys.executable))

    input_doc = {
        "schema": "chemdft.calculation_input",
        "schema_version": "1.0.0",
        "structure_version_id": "de89ad41-298b-43ee-9eea-c796f6347391",
        "atom_ordering": "AS_LISTED",
        "coordinate_unit": "angstrom",
        "atoms": [
            {
                "index": 0, "atomic_number": 8, "element": "O",
                "xyz_angstrom": [0.00000000, 0.00000000, 0.00000000],
            },
            {
                "index": 1, "atomic_number": 1, "element": "H",
                "xyz_angstrom": [0.00000000, 0.00000000, 0.95720000],
            },
            {
                "index": 2, "atomic_number": 1, "element": "H",
                "xyz_angstrom": [0.92662700, 0.00000000, -0.23998700],
            },
        ],
        "charge": 0,
        "multiplicity": 1,
        "task": "FREQUENCY",
        "method": "b3lyp",
        "basis": "def2-svp",
        "hessian": {
            "strategy": "ANALYTIC",
            "exclude_translation_rotation": True,
            "coordinate_unit": "angstrom",
            "hessian_unit": "Eh/bohr^2",
            "frequency_unit": "cm^-1",
        },
        "raman": {
            "method": "placzek_static",
            "polarizability_method": "finite_electric_field",
            "electric_field_step_au": 0.0010,
            "polarizability_derivative_step_angstrom_amu_half": 0.0100,
            "symmetrize_polarizability": True,
            "antisymmetry_tolerance": 0.0002,
        },
        "property_requests": [],
    }
    input_file = tmp_path / "input.json"
    result_file = tmp_path / "result.json"
    log_file = tmp_path / "worker.log"
    input_file.write_text(json.dumps(input_doc))

    proc = subprocess.run(
        [
            str(python_bin),
            str(worker_script),
            "--input",
            str(input_file),
            "--result",
            str(result_file),
            "--log",
            str(log_file),
        ],
        capture_output=True,
        text=True,
    )
    error_detail = log_file.read_text() if log_file.exists() else proc.stderr
    assert proc.returncode == 0, f"Worker failed: {error_detail}"

    res = json.loads(result_file.read_text())
    assert res["converged"] is True
    assert res["finite"] is True

    freqs = res["frequencies_cm1"]
    irs = res["ir_intensities_km_mol"]
    ramans = res["raman_activities_angstrom4_per_amu"]
    depols = res["depolarization_ratios"]

    assert len(freqs) == 3
    assert len(ramans) == 3
    assert len(depols) == 3

    # Frequencies match frozen IR result to high precision
    assert abs(freqs[0] - 1595.70) < 0.5
    assert abs(freqs[1] - 3913.62) < 0.5
    assert abs(freqs[2] - 4020.20) < 0.5

    # Raman activities reproduce accepted references
    # Mode 1: ~6.3840 A^4/amu
    assert abs(ramans[0] - 6.3840) < 0.10
    # Mode 2: ~74.4214 A^4/amu
    assert abs(ramans[1] - 74.4214) < 0.50
    # Mode 3: ~34.7163 A^4/amu
    assert abs(ramans[2] - 34.7163) < 0.50

    # Depolarization ratios
    assert abs(depols[0] - 0.5248) < 0.01
    assert abs(depols[1] - 0.1669) < 0.01
    assert abs(depols[2] - 0.7500) < 0.005  # B2 non-totally symmetric is depolarized (0.75)

    # IR / Raman complementarity
    # IR: Mode 1 is strongest, Mode 2 is weakest
    assert irs[0] > irs[2] > irs[1]
    # Raman: Mode 2 is strongest, Mode 1 is weakest
    assert ramans[1] > ramans[2] > ramans[0]


# ---------------------------------------------------------------------------
# Depolarization ratio boundary validation (epsilon-tolerance, no clipping)
# ---------------------------------------------------------------------------

# Shared 3-atom water fixture for boundary tests
_WATER_HESSIAN_3X3 = [
    [[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]] for _ in range(3)]
    for _ in range(3)
]
_WATER_MODES_3 = [
    [[0.0, 0.0, 0.0], [0.1, 0.2, 0.3], [-0.1, -0.2, -0.3]] for _ in range(3)
]
_WATER_ATOMS_3 = [
    {"element": "O", "xyz_angstrom": [0.0, 0.0, 0.0]},
    {"element": "H", "xyz_angstrom": [0.0, 0.0, 0.9572]},
    {"element": "H", "xyz_angstrom": [0.926627, 0.0, -0.239987]},
]
_WATER_INPUT_DOC = {
    "atoms": _WATER_ATOMS_3,
    "method": "b3lyp",
    "basis": "def2-svp",
    "charge": 0,
    "multiplicity": 1,
}


def _make_depol_candidate(depol_ratios: list) -> dict:
    """Build a minimal valid water candidate with the given depolarization ratios."""
    return {
        "schema": "chemdft.worker.vibrational-analysis",
        "task": "FREQUENCY",
        "converged": True,
        "finite": True,
        "mode_count": 3,
        "hessian_hartree_per_bohr2": _WATER_HESSIAN_3X3,
        "frequencies_cm1": [1595.7, 3913.6, 4020.2],
        "normal_modes_amu_minus_half": _WATER_MODES_3,
        "reduced_masses_amu": [1.08, 1.05, 1.08],
        "ir_intensities_km_mol": [59.0, 5.6, 32.4],
        "raman_activities_angstrom4_per_amu": [6.38, 74.42, 34.72],
        "depolarization_ratios": depol_ratios,
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
        "engine": "pyscf",
        "engine_version": "2.14.0",
        "mode_ordering": "ascending_eigenvalue",
        "vector_convention": "pyscf_thermo_norm_mode",
        "equilibrium_coordinates_angstrom": [
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 0.9572],
            [0.926627, 0.0, -0.239987],
        ],
    }


def test_depolarization_boundary_fp_noise_accepted() -> None:
    """rho_p = 0.750000000000001 (tiny FP overshoot) is within epsilon and
    should be accepted by the validator without raising.

    The validator tolerance is 0.751, so 0.750000000000001 < 0.751 → PASS.
    This must NOT be silently clipped to 0.75 during worker computation;
    it IS accepted at the validator layer because it's within the epsilon band.
    """
    from chemdft_api.scientific.engines.vibrational import validate_frequency_candidate

    # [0.52, 0.16, 0.750000000000001] — last value just above 0.75 by 1e-15
    candidate = _make_depol_candidate([0.52, 0.16, 0.750000000000001])
    # Must not raise — 0.750000000000001 < 0.751 (validator epsilon)
    validate_frequency_candidate(candidate, _WATER_INPUT_DOC)


def test_depolarization_materially_high_rejected() -> None:
    """rho_p = 0.80 is materially outside [0, 0.75] and MUST be rejected.

    This is NOT floating-point noise — 0.80 is 6.7% above 0.75.
    The validator must raise, not silently clip to 0.75.
    """
    from chemdft_api.scientific.engines.vibrational import validate_frequency_candidate

    candidate = _make_depol_candidate([0.52, 0.80, 0.75])  # 0.80 is unphysical!
    with pytest.raises(ValueError, match="Depolarization ratio out of physical range"):
        validate_frequency_candidate(candidate, _WATER_INPUT_DOC)


def test_depolarization_negative_rejected() -> None:
    """rho_p = -0.05 is materially negative and MUST be rejected.

    The validator allows -1e-4 (FP boundary), but -0.05 is far outside
    that tolerance and indicates a computation error.
    """
    from chemdft_api.scientific.engines.vibrational import validate_frequency_candidate

    candidate = _make_depol_candidate([-0.05, 0.16, 0.75])  # -0.05 is unphysical!
    with pytest.raises(ValueError, match="Depolarization ratio out of physical range"):
        validate_frequency_candidate(candidate, _WATER_INPUT_DOC)

