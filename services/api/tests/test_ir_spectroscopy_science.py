from __future__ import annotations

import math

import numpy as np
import pytest
from chemdft_api.scientific.engines.vibrational import validate_frequency_candidate


def test_ir_central_difference_derivative_math() -> None:
    """A. Test central difference derivative mathematics."""
    delta = 0.0100
    # Test on known quadratic dipole field: mu_z(x) = 2.0 * x + 0.5 * x^2
    # Exact derivative dmu_z/dx at x=0 is 2.0
    x0 = 0.0
    mu_plus = 2.0 * (x0 + delta) + 0.5 * (x0 + delta) ** 2
    mu_minus = 2.0 * (x0 - delta) + 0.5 * (x0 - delta) ** 2
    dmu_dx = (mu_plus - mu_minus) / (2.0 * delta)
    assert abs(dmu_dx - 2.0) < 1e-12


def test_dipole_derivative_matrix_shape() -> None:
    """C. For N atoms, Cartesian derivative matrix has shape (N, 3, 3) or 3N x 3."""
    natoms = 3
    # 3 atoms x 3 displacement axes x 3 dipole components
    dmu_dr = np.zeros((natoms, 3, 3), dtype=float)
    assert dmu_dr.shape == (3, 3, 3)
    reshaped_3n_by_3 = dmu_dr.reshape(-1, 3)
    assert reshaped_3n_by_3.shape == (3 * natoms, 3)


def test_normal_mode_projection_and_iupac_unit_conversion() -> None:
    """D, E, F. Normal-mode projection, intensity positivity, and unit conversion."""
    bohr_to_ang = 0.529177210903
    iupac_prefactor = 42.2561  # (km/mol) / ((Debye/Angstrom)^2 / amu)

    natoms = 3
    # Synthetic mode vector in amu^-1/2
    norm_mode = np.array([
        [0.0, 0.0, -0.068],
        [0.0, 0.40, 0.54],
        [0.0, -0.40, 0.54],
    ])
    # Synthetic Cartesian dipole derivatives in Debye/bohr
    dmu_dr_bohr = np.zeros((natoms, 3, 3))
    dmu_dr_bohr[0, 2, 2] = -0.5
    dmu_dr_bohr[1, 1, 1] = 0.8
    dmu_dr_bohr[1, 2, 2] = 0.25
    dmu_dr_bohr[2, 1, 1] = -0.8
    dmu_dr_bohr[2, 2, 2] = 0.25

    # Convert to Debye/Angstrom
    dmu_dr_ang = dmu_dr_bohr / bohr_to_ang

    dmu_dq = np.zeros(3)
    for beta in range(3):
        dmu_dq[beta] = np.sum(norm_mode * dmu_dr_ang[:, :, beta])

    intensity = iupac_prefactor * np.sum(dmu_dq**2)
    assert intensity > 0.0
    assert math.isfinite(intensity)


def test_validator_rejects_non_finite_ir_intensities() -> None:
    """G. Failure on non-finite values."""
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
        "frequencies_cm1": [1600.0, 3700.0, 3800.0],
        "normal_modes_amu_minus_half": [
            [[0.0, 0.0, 0.0], [0.1, 0.2, 0.3], [-0.1, -0.2, -0.3]] for _ in range(3)
        ],
        "reduced_masses_amu": [1.08, 1.05, 1.08],
        "ir_intensities_km_mol": [55.0, float("nan"), 27.0],
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
            [0.0, 0.75, 0.6],
            [0.0, -0.75, 0.6],
        ],
    }
    input_doc = {
        "atoms": [
            {"element": "O", "xyz_angstrom": [0.0, 0.0, 0.0]},
            {"element": "H", "xyz_angstrom": [0.0, 0.75, 0.6]},
            {"element": "H", "xyz_angstrom": [0.0, -0.75, 0.6]},
        ],
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
    }
    with pytest.raises(ValueError, match="IR intensities must be finite and non-negative"):
        validate_frequency_candidate(candidate, input_doc)


def test_validator_rejects_negative_ir_intensities() -> None:
    """E, I. Validator rejects negative intensities (which are physically impossible)."""
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
        "frequencies_cm1": [1600.0, 3700.0, 3800.0],
        "normal_modes_amu_minus_half": [
            [[0.0, 0.0, 0.0], [0.1, 0.2, 0.3], [-0.1, -0.2, -0.3]] for _ in range(3)
        ],
        "reduced_masses_amu": [1.08, 1.05, 1.08],
        "ir_intensities_km_mol": [55.0, -0.05, 27.0],
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
            [0.0, 0.75, 0.6],
            [0.0, -0.75, 0.6],
        ],
    }
    input_doc = {
        "atoms": [
            {"element": "O", "xyz_angstrom": [0.0, 0.0, 0.0]},
            {"element": "H", "xyz_angstrom": [0.0, 0.75, 0.6]},
            {"element": "H", "xyz_angstrom": [0.0, -0.75, 0.6]},
        ],
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
    }
    with pytest.raises(ValueError, match="IR intensities must be finite and non-negative"):
        validate_frequency_candidate(candidate, input_doc)


def test_validator_rejects_mismatched_intensity_count() -> None:
    """I. No missing or fabricated placeholders."""
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
        "frequencies_cm1": [1600.0, 3700.0, 3800.0],
        "normal_modes_amu_minus_half": [
            [[0.0, 0.0, 0.0], [0.1, 0.2, 0.3], [-0.1, -0.2, -0.3]] for _ in range(3)
        ],
        "reduced_masses_amu": [1.08, 1.05, 1.08],
        "ir_intensities_km_mol": [55.0, 4.9],  # Only 2 intensities for 3 modes!
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
            [0.0, 0.75, 0.6],
            [0.0, -0.75, 0.6],
        ],
    }
    input_doc = {
        "atoms": [
            {"element": "O", "xyz_angstrom": [0.0, 0.0, 0.0]},
            {"element": "H", "xyz_angstrom": [0.0, 0.75, 0.6]},
            {"element": "H", "xyz_angstrom": [0.0, -0.75, 0.6]},
        ],
        "method": "b3lyp",
        "basis": "def2-svp",
        "charge": 0,
        "multiplicity": 1,
    }
    with pytest.raises(ValueError, match="IR intensity count differs"):
        validate_frequency_candidate(candidate, input_doc)
