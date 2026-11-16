"""Candidate matching, metrics, scaling, UV/Vis band integration and phase diagnostics."""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import math

import numpy as np
import pytest
from chemdft_spectra_worker import units
from chemdft_spectra_worker.compare import CompareError, compare, gated_assignment


def peak(x: float, y: float = 1.0, prominence: float = 0.5) -> dict:
    return {"x": x, "y": y, "prominence": prominence, "fwhm_x": 10.0}


def vib_request(calc: list[float], exp: list[float], tolerance: float = 30.0, **extra: dict) -> dict:
    return {
        "technique": "IR",
        "experimental": {"x_unit": "cm^-1", "x_min": 400.0, "x_max": 4000.0, "peaks": [peak(v) for v in exp], "y_quantity": "ABSORBANCE"},
        "calculated": {"modes": [{"index": i + 1, "frequency_cm1": f, "intensity": 100.0 / (i + 1)} for i, f in enumerate(calc)], "phase": "GAS", "intensity_basis": "IR_INTENSITY_KM_MOL"},
        "matching": {"tolerance_cm1": tolerance, "min_relative_intensity": 0.0},
        "experimental_phase": "GAS",
        **extra,
    }


def test_gated_assignment_is_one_to_one_and_optimal() -> None:
    # greedy nearest would give the first calculated mode the 1000 peak and strand the second; optimal assignment pairs both
    pairs = gated_assignment(np.array([1000.0, 1020.0]), np.array([1010.0, 1040.0]), 30.0)
    assert [(p["calc_position"], p["exp_position"]) for p in pairs] == [(0, 0), (1, 1)]
    assert len({p["exp_position"] for p in pairs}) == len(pairs)


def test_gate_excludes_distant_pairs() -> None:
    assert gated_assignment(np.array([1000.0]), np.array([1100.0]), 30.0) == []


def test_no_assigned_status_exists() -> None:
    record = compare(vib_request([1000, 1700, 2900], [1010, 1720, 3300]))
    statuses = {p["status"] for p in record["pairs"]} | {u["status"] for u in record["unmatched_calculated"]} | {u["status"] for u in record["unmatched_experimental"]}
    assert statuses <= {"CANDIDATE_MATCH", "AMBIGUOUS_CANDIDATE", "UNMATCHED_EXPERIMENTAL", "UNMATCHED_CALCULATED"}
    assert "ASSIGNED" not in repr(record)
    assert "not assignments" in record["assignment_statement"]


def test_metrics_and_delta_sign() -> None:
    record = compare(vib_request([1000, 1700, 2900], [1010, 1690, 3300]))
    metrics = record["metrics"]
    assert metrics["matched"] == 2 and metrics["unmatched_calculated"] == 1 and metrics["unmatched_experimental"] == 1
    deltas = {p["calc_mode_index"]: p["delta_cm1"] for p in record["pairs"]}
    assert deltas == {1: 10.0, 2: -10.0}  # experimental minus calculated
    assert metrics["signed_bias"] == 0.0 and metrics["mae"] == 10.0 and metrics["rmse"] == pytest.approx(10.0)
    assert metrics["matched_fraction_of_experimental_peaks"] == pytest.approx(2 / 3)
    assert metrics["matched_fraction_of_considered_modes"] == pytest.approx(2 / 3)
    assert metrics["max_abs_delta"] == 10.0
    assert metrics["mae_upper_bound_by_construction_cm1"] == 30.0
    assert "unmatched" in metrics["mae_note"] and "bounded" in metrics["mae_note"]
    assert [row["tolerance"] for row in metrics["tolerance_sensitivity"]] == [15.0, 30.0, 60.0]
    assert record["unmatched_experimental"][0]["exp_position_cm1"] == 3300.0
    assert record["unmatched_calculated"][0]["calc_mode_index"] == 3


def test_ambiguity_is_flagged_not_resolved() -> None:
    record = compare(vib_request([1000, 1015], [1008]))
    assert record["metrics"]["matched"] == 1
    assert record["pairs"][0]["status"] == "AMBIGUOUS_CANDIDATE"
    assert record["pairs"][0]["candidates_for_exp_peak"] == 2
    assert record["metrics"]["unmatched_calculated"] == 1
    assert "AMBIGUOUS_CANDIDATES" in [d["code"] for d in record["diagnostics"]]


def test_coverage_warning_when_most_are_unmatched() -> None:
    record = compare(vib_request([500, 700, 900, 1100, 1300, 1500], [1105, 3000, 3200, 3400]))
    assert "LOW_COVERAGE" in [d["code"] for d in record["diagnostics"]]


def test_tolerance_is_required_and_bounded() -> None:
    request = vib_request([1000], [1005])
    del request["matching"]["tolerance_cm1"]
    with pytest.raises(CompareError) as info:
        compare(request)
    assert info.value.code == "TOLERANCE_REQUIRED"
    for bad in (0, -5, 1000, float("nan")):
        with pytest.raises(CompareError):
            compare(vib_request([1000], [1005], tolerance=bad))


def test_scaling_is_explicit_and_recorded() -> None:
    unscaled = compare(vib_request([1000, 1700], [960, 1632]))
    assert unscaled["scaling"]["mode"] == "UNSCALED" and unscaled["scaling"]["factor"] is None
    assert unscaled["metrics"]["matched"] == 0
    scaled = compare(vib_request([1000, 1700], [960, 1632], scaling={"mode": "USER_FACTOR", "factor": 0.96}))
    assert scaled["scaling"]["factor"] == 0.96 and "not a library or literature value" in scaled["scaling"]["source"]
    assert scaled["metrics"]["matched"] == 2 and scaled["metrics"]["mae"] == pytest.approx(0.0, abs=1e-9)
    assert scaled["pairs"][0]["calc_frequency_cm1"] == 1000.0 and scaled["pairs"][0]["calc_frequency_compared_cm1"] == pytest.approx(960.0)
    assert "USER_SCALE_FACTOR" in [d["code"] for d in scaled["diagnostics"]]


@pytest.mark.parametrize("scaling", [{"mode": "USER_FACTOR"}, {"mode": "USER_FACTOR", "factor": 0.2}, {"mode": "USER_FACTOR", "factor": 3}, {"mode": "LITERATURE"}, {"mode": "USER_FACTOR", "factor": "abc"}])
def test_scaling_cannot_be_silent_or_implausible(scaling: dict) -> None:
    with pytest.raises(CompareError) as info:
        compare(vib_request([1000], [1005], scaling=scaling))
    assert info.value.code == "SCALING_INVALID"


def test_modes_outside_the_window_imaginary_and_weak_are_counted_not_hidden() -> None:
    request = vib_request([1000, 1700, 200, 4500, -50], [1005])
    request["calculated"]["modes"][4]["imaginary"] = True
    request["calculated"]["modes"][1]["intensity"] = 0.1
    request["matching"]["min_relative_intensity"] = 0.01
    metrics = compare(request)["metrics"]
    excluded = metrics["calculated_modes_excluded"]
    assert excluded == {"imaginary_or_nonpositive": 1, "outside_experimental_window": 2, "below_intensity_threshold": 1}
    assert metrics["calculated_modes_total"] == 5 and metrics["calculated_modes_considered"] == 1


def test_relative_intensities_are_orientation_only() -> None:
    record = compare(vib_request([1000, 1700], [1005, 1710]))
    assert record["pairs"][0]["relative_intensity_calc"] == 1.0
    assert "no intensity agreement is claimed" in record["intensity_statement"]
    assert "intensity" not in {k for k in record["metrics"] if "intensity_agree" in k}


@pytest.mark.parametrize(
    ("experimental", "calculated", "code"),
    [
        ("LIQUID", "GAS", "PHASE_MISMATCH"),
        ("SOLID", "GAS", "PHASE_MISMATCH"),
        ("NOT_SUPPLIED", "GAS", "PHASE_UNKNOWN"),
        ("GAS", "GAS", "PHASE_CONSISTENT"),
        ("GAS", "UNKNOWN", "CALCULATION_PHASE_UNKNOWN"),
    ],
)
def test_phase_diagnostics(experimental: str, calculated: str, code: str) -> None:
    request = vib_request([1000], [1005], experimental_phase=experimental)
    request["calculated"]["phase"] = calculated
    assert code in [d["code"] for d in compare(request)["diagnostics"]]


def test_display_similarity_is_secondary_and_labelled() -> None:
    nu = np.arange(400.0, 4000.0, 2.0)
    experimental = sum(1.0 / (1 + ((nu - c) / 8.0) ** 2) for c in (1000.0, 1700.0))
    request = vib_request([1002, 1698], [1000, 1700], similarity={"lorentzian_fwhm_cm1": 16.0, "window_cm1": [800, 2000], "step_cm1": 1.0})
    request["experimental"]["point_count"] = len(nu)
    result = compare(request, (nu, experimental))
    similarity = result["similarity"]
    assert similarity["authority"] == "DISPLAY_ONLY" and similarity["computed"] is True
    assert similarity["pearson_r"] > 0.9 and "validation score" in similarity["note"]
    assert similarity["settings"]["lorentzian_fwhm_cm1"] == 16.0
    request["experimental"]["y_quantity"] = "TRANSMITTANCE"
    assert compare(request, (nu, experimental))["similarity"]["computed"] is False


# ------------------------------------------------------------------------------------------------ UV/Vis
def gaussian_cross_section(nm: np.ndarray, centre_nm: float, width_cm1: float, f: float) -> np.ndarray:
    nu = 1e7 / nm
    shape = np.exp(-0.5 * ((nu - 1e7 / centre_nm) / width_cm1) ** 2) / (width_cm1 * math.sqrt(2 * math.pi))
    return f / units.F_PER_CM2_CM1 * shape


def uv_request(states: list[tuple[float, float]], peaks_nm: list[float], axis: str = "eV", tolerance: float = 0.3, **extra: dict) -> dict:
    return {
        "technique": "UVVIS",
        "experimental": {"x_unit": "nm", "x_min": 200.0, "x_max": 400.0, "peaks": [peak(v) for v in peaks_nm], "y_quantity": "CROSS_SECTION", "y_unit": "cm^2/molecule", "representation": "ABSOLUTE", "point_count": 2001},
        "calculated": {"states": [{"index": i + 1, "energy_ev": e, "oscillator_strength": f} for i, (e, f) in enumerate(states)], "phase": "GAS"},
        "axis": axis,
        "matching": {"tolerance": tolerance},
        "experimental_phase": "GAS",
        **extra,
    }


def test_uv_band_oscillator_strength_is_recovered_over_a_linear_axis() -> None:
    nm = np.linspace(200.0, 400.0, 2001)
    sigma = gaussian_cross_section(nm, 280.0, 2000.0, 0.042)
    record = compare(uv_request([(4.5, 0.040), (5.1, 0.002)], [280.0], bands=[{"label": "n-pi*", "lo_nm": 230.0, "hi_nm": 340.0}]), (nm, sigma))
    band = record["bands"][0]
    assert band["experimental"]["f"] == pytest.approx(0.042, rel=0.01)
    assert band["f_calculated_sum"] == pytest.approx(0.042)  # 4.5 eV (275.5 nm) and 5.1 eV (243.1 nm) both lie inside 230-340 nm
    assert band["calculated_states_in_band"] == [1, 2]
    assert band["limit_sensitivity"]["f_min"] <= band["experimental"]["f"] <= band["limit_sensitivity"]["f_max"]
    assert any(n["code"] == "RATIO_IS_NOT_A_SCORE" for n in band["notes"])
    assert "cm^-1" in band["integration_domain"]


def test_integrating_over_wavelength_would_be_wrong_but_the_worker_does_not() -> None:
    nm = np.linspace(200.0, 400.0, 2001)
    sigma = gaussian_cross_section(nm, 280.0, 2000.0, 0.042)
    naive = units.F_PER_CM2_CM1 * float(np.trapezoid(sigma, nm))  # the forbidden shortcut: integral over nm
    record = compare(uv_request([(4.5, 0.040)], [280.0], bands=[{"lo_nm": 230.0, "hi_nm": 340.0}]), (nm, sigma))
    assert abs(naive - 0.042) / 0.042 > 0.5
    assert record["bands"][0]["experimental"]["f"] == pytest.approx(0.042, rel=0.01)


def test_uv_molar_absorptivity_is_converted_to_cross_section() -> None:
    nm = np.linspace(200.0, 400.0, 2001)
    sigma = gaussian_cross_section(nm, 280.0, 2000.0, 0.042)
    epsilon = units.cross_section_to_epsilon(sigma)
    request = uv_request([(4.5, 0.040)], [280.0], bands=[{"lo_nm": 230.0, "hi_nm": 340.0}])
    request["experimental"]["y_quantity"], request["experimental"]["y_unit"] = "MOLAR_ABSORPTIVITY", "L/(mol*cm)"
    assert compare(request, (nm, epsilon))["bands"][0]["experimental"]["f"] == pytest.approx(0.042, rel=0.01)


@pytest.mark.parametrize(("quantity", "representation"), [("ABSORBANCE", "ABSOLUTE"), ("TRANSMITTANCE", "ABSOLUTE"), ("CROSS_SECTION", "RELATIVE")])
def test_uv_without_an_absolute_scale_gives_no_quantitative_band(quantity: str, representation: str) -> None:
    nm = np.linspace(200.0, 400.0, 2001)
    request = uv_request([(4.5, 0.040)], [280.0], bands=[{"lo_nm": 230.0, "hi_nm": 340.0}])
    request["experimental"]["y_quantity"], request["experimental"]["representation"] = quantity, representation
    band = compare(request, (nm, gaussian_cross_section(nm, 280.0, 2000.0, 0.04)))["bands"][0]
    assert band["experimental"] is None and band["f_ratio_calc_over_exp"] is None
    assert "NO_QUANTITATIVE_EXPERIMENTAL_BAND" in [n["code"] for n in band["notes"]]


def test_uv_empty_band_and_edge_states_are_called_out() -> None:
    nm = np.linspace(200.0, 400.0, 2001)
    sigma = gaussian_cross_section(nm, 280.0, 2000.0, 0.042)
    record = compare(uv_request([(3.0, 0.5), (1239.84198 / 229.0, 0.01)], [280.0], tolerance=0.1, bands=[{"lo_nm": 230.0, "hi_nm": 340.0}]), (nm, sigma))
    codes = [n["code"] for n in record["bands"][0]["notes"]]
    assert "NO_CALCULATED_STATE_IN_BAND" in codes and "STATES_NEAR_BAND_EDGE" in codes


def test_uv_position_matching_in_each_axis() -> None:
    for axis, tolerance in (("eV", 0.3), ("nm", 20.0), ("cm^-1", 2000.0)):
        record = compare(uv_request([(4.5, 0.04), (6.2, 0.2)], [276.0], axis=axis, tolerance=tolerance))
        assert record["metrics"]["matched"] == 1 and record["axis"] == axis
        assert record["pairs"][0]["status"] in ("CANDIDATE_MATCH", "AMBIGUOUS_CANDIDATE")
        assert record["metrics"]["delta_unit"] == axis
    nm_delta = compare(uv_request([(4.5, 0.04)], [276.0], axis="nm", tolerance=20.0))["pairs"][0]["delta"]
    assert nm_delta == pytest.approx(276.0 - 1239.84198 / 4.5, abs=1e-6)


def test_uv_states_outside_the_measured_range_are_excluded_and_counted() -> None:
    record = compare(uv_request([(4.5, 0.04), (7.0, 0.5), (2.0, 0.01), (4.4, 0.0001)], [276.0], axis="eV"))
    assert record["metrics"]["calculated_states_excluded"]["outside_experimental_window"] == 2
    request = uv_request([(4.5, 0.04), (4.4, 0.0001)], [276.0])
    request["matching"]["min_oscillator_strength"] = 0.001
    assert compare(request)["metrics"]["calculated_states_excluded"]["below_oscillator_strength_threshold"] == 1


def test_uv_has_no_energy_scaling_and_notes_vertical_excitations() -> None:
    record = compare(uv_request([(4.5, 0.04)], [276.0]))
    assert record["scaling"]["mode"] == "UNSCALED" and "VERTICAL_EXCITATIONS" in [d["code"] for d in record["diagnostics"]]


def test_unknown_technique_or_axis() -> None:
    with pytest.raises(CompareError):
        compare({"technique": "NMR"})
    with pytest.raises(CompareError):
        compare(uv_request([(4.5, 0.04)], [276.0], axis="furlongs"))
    with pytest.raises(CompareError):
        compare(uv_request([(4.5, 0.04)], [276.0], bands=[{"lo_nm": 300.0, "hi_nm": 200.0}]))
