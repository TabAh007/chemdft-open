"""Axis conversions and the oscillator-strength relations, checked against hard-coded oracles."""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import math

import numpy as np
import pytest
from chemdft_spectra_worker import units


def test_axis_conversions_against_hard_coded_values() -> None:
    assert units.to_wavenumber_cm1(np.array([500.0]), "nm")[0] == pytest.approx(20000.0)
    assert units.to_wavenumber_cm1(np.array([10.0]), "um")[0] == pytest.approx(1000.0)
    assert units.to_wavenumber_cm1(np.array([1.0]), "eV")[0] == pytest.approx(8065.54, rel=1e-5)
    assert units.to_ev(np.array([620.0]), "nm")[0] == pytest.approx(1.99974, rel=1e-4)
    assert units.convert_axis(np.array([2.0]), "eV", "nm")[0] == pytest.approx(619.9210, rel=1e-5)
    assert units.convert_axis(np.array([250.0]), "nm", "cm^-1")[0] == pytest.approx(40000.0)


def test_round_trip_conversions() -> None:
    x = np.linspace(200.0, 800.0, 7)
    for unit in ("eV", "cm^-1"):
        there = units.convert_axis(x, "nm", unit)
        back = units.convert_axis(there, unit, "nm")
        assert np.allclose(back, x, rtol=1e-12)


def test_oscillator_strength_prefactor_and_epsilon_factor() -> None:
    assert pytest.approx(1.1296e12, rel=2e-4) == units.F_PER_CM2_CM1
    assert pytest.approx(2.6154e20, rel=2e-4) == units.SIGMA_TO_EPSILON


def test_gaussian_band_recovers_its_oscillator_strength() -> None:
    f_true = 0.37
    centre, width = 40000.0, 1800.0  # cm^-1
    nu = np.linspace(centre - 6 * width, centre + 6 * width, 4001)
    shape = np.exp(-0.5 * ((nu - centre) / width) ** 2) / (width * math.sqrt(2 * math.pi))
    sigma = f_true / units.F_PER_CM2_CM1 * shape
    assert units.band_oscillator_strength(nu, sigma) == pytest.approx(f_true, rel=1e-4)


def test_cross_section_epsilon_round_trip() -> None:
    sigma = np.array([1e-19, 3.2e-18])
    assert np.allclose(units.epsilon_to_cross_section(units.cross_section_to_epsilon(sigma)), sigma)


def test_density_conversion_conserves_the_integral() -> None:
    nm = np.linspace(250.0, 350.0, 20001)
    density = np.exp(-0.5 * ((nm - 300.0) / 8.0) ** 2)  # per nm
    nu, per_cm = units.density_to_wavenumber(nm, density)
    order = np.argsort(nu)
    assert np.trapezoid(per_cm[order], nu[order]) == pytest.approx(np.trapezoid(density, nm), rel=1e-4)


def test_label_vocabulary_is_graded() -> None:
    assert units.guess_x_unit("Wavenumber (cm-1)").level is units.EvidenceLevel.EXPLICIT_UNIT
    assert units.guess_x_unit("Wavenumber (cm-1)").unit == "cm^-1"
    assert units.guess_x_unit("Raman shift").level is units.EvidenceLevel.QUANTITY_NAME
    assert units.guess_x_unit("x").level is units.EvidenceLevel.NONE
    assert units.guess_y_unit("%T").unit == "percent"
    assert units.guess_y_unit("Transmittance").level is units.EvidenceLevel.QUANTITY_NAME
    assert units.guess_y_unit("Absorbance").unit == "absorbance"
    assert units.guess_y_unit("cross section (cm^2/molecule)").quantity == "CROSS_SECTION"
    assert not units.EvidenceLevel.HINT_ONLY.accepted and not units.EvidenceLevel.QUANTITY_NAME.accepted
    assert units.EvidenceLevel.USER_CONFIRMED.accepted and units.EvidenceLevel.EXPLICIT_UNIT.accepted
