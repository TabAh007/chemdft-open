"""Deterministic transforms: parent/child hash chain, parameter validation, known-answer baselines and smoothing."""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import math

import numpy as np
import pytest
from chemdft_spectra_worker.transforms import (
    OPS,
    TransformError,
    Version,
    detect_peaks,
    run_transform,
    savgol_height_loss,
)


def lorentz(x: np.ndarray, centre: float, fwhm: float, height: float) -> np.ndarray:
    return height * (fwhm / 2) ** 2 / ((x - centre) ** 2 + (fwhm / 2) ** 2)


def make(step: float = 4.0, noise: float = 0.0, seed: int = 7, descending: bool = False) -> tuple[Version, np.ndarray, np.ndarray]:
    x = np.arange(400.0, 4000.0 + 0.5 * step, step)
    peaks = lorentz(x, 1715, 18, 0.9) + lorentz(x, 1220, 24, 0.5) + lorentz(x, 2960, 40, 0.3)
    truth_baseline = 0.05 + 4e-5 * (x - 400) + 0.03 * np.exp(-((x - 600) / 500) ** 2)
    y = peaks + truth_baseline + noise * np.random.default_rng(seed).standard_normal(len(x))
    if descending:
        x, y = x[::-1].copy(), y[::-1].copy()
    return Version(x, y, "cm^-1", "ABSORBANCE", "absorbance"), peaks, truth_baseline


def test_every_declared_op_is_dispatchable() -> None:
    version, _, _ = make()
    params = {
        "baseline.arpls": {"stiffness_length_x": 400},
        "baseline.snip": {"half_window_x": 60},
        "baseline.imodpoly": {"poly_order": 3},
        "baseline.offset": {"percentile": 1},
        "smooth.savgol": {"window_x": 24},
        "normalize.max": {"target": 1},
        "normalize.area": {"x_range": [1500, 1900]},
        "resample.linear": {"step": 8},
        "crop": {"x_min": 1000, "x_max": 3000},
    }
    for op in OPS:
        if op == "convert.absorbance_from_transmittance":
            continue
        assert run_transform(op, params[op], version).record["op"] == op


def test_inputs_are_never_mutated_and_output_chain_is_hashed() -> None:
    version, _, _ = make(noise=0.002, descending=True)
    before_x, before_y, before_hash = version.x.copy(), version.y.copy(), version.artifact_sha256
    first = run_transform("baseline.snip", {"half_window_x": 60}, version)
    assert np.array_equal(version.x, before_x) and np.array_equal(version.y, before_y)
    assert first.record["input"]["artifact_sha256"] == before_hash
    assert first.record["input_was_descending"] is True
    assert first.record["output"]["x_order"] == "ASCENDING"
    second = run_transform("smooth.savgol", {"window_x": 20}, first.version)
    assert second.record["input"]["artifact_sha256"] == first.record["output"]["artifact_sha256"]  # parent/child chain
    assert second.record["output"]["artifact_sha256"] != first.record["output"]["artifact_sha256"]


def test_transforms_are_bitwise_deterministic() -> None:
    version, _, _ = make(noise=0.002)
    for op, params in [("baseline.arpls", {"stiffness_length_x": 400}), ("baseline.imodpoly", {"poly_order": 4}), ("smooth.savgol", {"window_x": 20})]:
        a, b = run_transform(op, params, version), run_transform(op, params, version)
        assert a.record["output"]["artifact_sha256"] == b.record["output"]["artifact_sha256"]
        assert a.record["output"]["aux"] == b.record["output"]["aux"]


def test_record_carries_library_versions_and_params() -> None:
    version, _, _ = make()
    record = run_transform("baseline.arpls", {"stiffness_length_x": 400}, version).record
    assert record["library"] == "pybaselines" and record["library_version"] == "1.2.1"
    assert record["params"] == {"stiffness_length_x": 400.0, "diff_order": 2, "max_iter": 50, "tol": 0.001}
    assert record["resolved"]["lam"] == pytest.approx((400 / 4.0) ** 4)
    assert record["environment"]["scipy"] and record["environment"]["numpy"]
    assert record["authority"] == "DETERMINISTIC_TRANSFORM" and record["deterministic"] is True
    assert "baseline" in record["output"]["aux"]
    smooth = run_transform("smooth.savgol", {"window_x": 20}, version).record
    assert smooth["library"] == "scipy" and smooth["params"]["mode"] == "interp"


@pytest.mark.parametrize("method", [("baseline.arpls", {"stiffness_length_x": 800}), ("baseline.snip", {"half_window_x": 80}), ("baseline.imodpoly", {"poly_order": 4})])
def test_baselines_recover_a_known_baseline(method: tuple[str, dict]) -> None:
    version, _, truth = make(noise=0.001)
    result = run_transform(method[0], method[1], version)
    estimated = result.version.aux["baseline"]
    rmse = float(np.sqrt(np.mean((estimated - truth) ** 2)))
    assert rmse < 0.03
    corrected_height = result.version.y[np.argmin(np.abs(result.version.x - 1715))]
    assert corrected_height == pytest.approx(0.9, abs=0.08)


def test_stiffness_length_is_sampling_independent() -> None:
    errors = []
    for step in (2.0, 8.0):
        version, _, truth = make(step=step)
        estimated = run_transform("baseline.arpls", {"stiffness_length_x": 800}, version).version.aux["baseline"]
        errors.append(float(np.sqrt(np.mean((estimated - truth) ** 2))))
    assert errors[1] == pytest.approx(errors[0], rel=0.2)


def test_baseline_offset_variants() -> None:
    version, _, _ = make()
    by_percentile = run_transform("baseline.offset", {"percentile": 0}, version)
    assert by_percentile.version.y.min() == pytest.approx(0.0, abs=1e-12)
    by_value = run_transform("baseline.offset", {"value": 0.05}, version)
    assert by_value.record["resolved"]["offset"] == 0.05
    with pytest.raises(TransformError):
        run_transform("baseline.offset", {"percentile": 1, "value": 2}, version)
    with pytest.raises(TransformError):
        run_transform("baseline.offset", {}, version)


def test_there_is_no_automatic_baseline_choice() -> None:
    version, _, _ = make()
    with pytest.raises(TransformError) as info:
        run_transform("baseline.arpls", {}, version)
    assert info.value.code == "PARAMETER_MISSING"


@pytest.mark.parametrize(
    ("op", "params", "code"),
    [
        ("baseline.arpls", {"stiffness_length_x": 400, "lam": 1e8}, "PARAMETER_UNKNOWN"),
        ("baseline.arpls", {"stiffness_length_x": -1}, "PARAMETER_INVALID"),
        ("baseline.arpls", {"stiffness_length_x": 4.0}, "PARAMETER_INVALID"),
        ("baseline.snip", {"half_window_x": 1e9}, "PARAMETER_INVALID"),
        ("smooth.savgol", {"window_points": 10}, "PARAMETER_INVALID"),
        ("smooth.savgol", {"window_points": 3, "polyorder": 3}, "PARAMETER_INVALID"),
        ("smooth.savgol", {"window_points": 5001}, "PARAMETER_INVALID"),
        ("smooth.savgol", {"window_points": 5, "window_x": 20}, "PARAMETER_INVALID"),
        ("smooth.savgol", {"window_points": 5, "mode": "bogus"}, "PARAMETER_INVALID"),
        ("normalize.max", {"target": 7}, "PARAMETER_INVALID"),
        ("resample.linear", {"step": 0}, "PARAMETER_INVALID"),
        ("crop", {"x_min": 3000, "x_max": 1000}, "PARAMETER_INVALID"),
        ("crop", {"x_min": 1000, "x_max": 1010}, "TOO_FEW_POINTS_AFTER_TRANSFORM"),
        ("bogus.op", {}, "OP_UNKNOWN"),
    ],
)
def test_invalid_parameters_create_nothing(op: str, params: dict, code: str) -> None:
    version, _, _ = make()
    with pytest.raises(TransformError) as info:
        run_transform(op, params, version)
    assert info.value.code == code


def test_savgol_height_loss_table_matches_the_spike() -> None:
    # window <= 0.5 x FWHM costs well under 0.5 % of peak height; a window comparable to the FWHM costs far more
    small = savgol_height_loss(9, 3, 20.0)
    large = savgol_height_loss(41, 3, 20.0)
    assert 0 <= small < 0.005
    assert large > 0.05


def test_savgol_window_in_physical_units_and_advisory() -> None:
    version, _, _ = make(step=1.0, noise=0.001)
    gentle = run_transform("smooth.savgol", {"window_x": 6}, version)
    assert gentle.record["resolved"]["window_points"] == 7 and gentle.record["resolved"]["window_x_equivalent"] == 7.0
    assert "WINDOW_LARGE_VS_PEAK_WIDTH" not in [w["code"] for w in gentle.record["warnings"]]
    heavy = run_transform("smooth.savgol", {"window_x": 80}, version)
    assert "WINDOW_LARGE_VS_PEAK_WIDTH" in [w["code"] for w in heavy.record["warnings"]]
    advisory = heavy.record["resolved"]["advisory"]
    assert advisory["narrowest_peak_fwhm_x"] > 0 and advisory["simulated_height_loss"] > 0
    peak_before = version.y[np.argmin(np.abs(version.x - 1715))]
    peak_after = heavy.version.y[np.argmin(np.abs(heavy.version.x - 1715))]
    assert peak_after < peak_before  # the advisory is not decoration: height really falls


def test_savgol_edge_mode_defaults_to_interp_and_reduces_noise() -> None:
    version, _, _ = make(noise=0.01)
    out = run_transform("smooth.savgol", {"window_x": 24}, version).version
    assert float(np.std(np.diff(out.y))) < float(np.std(np.diff(version.y)))


def test_non_uniform_spacing_is_warned() -> None:
    x = np.sort(np.concatenate([np.arange(400, 1000, 2.0), np.arange(1000, 4000, 8.0)]))
    version = Version(x, lorentz(x, 1715, 18, 1.0), "cm^-1", "ABSORBANCE", "absorbance")
    assert "NON_UNIFORM_SPACING" in [w["code"] for w in run_transform("smooth.savgol", {"window_points": 7}, version).record["warnings"]]
    assert "NON_UNIFORM_SPACING" in [w["code"] for w in run_transform("baseline.arpls", {"stiffness_length_x": 400}, version).record["warnings"]]


def test_normalisation() -> None:
    version, _, _ = make()
    one = run_transform("normalize.max", {"target": 1}, version)
    hundred = run_transform("normalize.max", {"target": 100}, version)
    assert one.version.y.max() == pytest.approx(1.0) and hundred.version.y.max() == pytest.approx(100.0)
    assert one.version.representation == "RELATIVE" and one.version.y_unit == "relative"
    assert "RELATIVE_REPRESENTATION" in [w["code"] for w in one.record["warnings"]]
    assert version.y.max() > 0.9 and version.representation == "ABSOLUTE"
    area = run_transform("normalize.area", {"x_range": [1500, 1900]}, version)
    mask = (area.version.x >= 1500) & (area.version.x <= 1900)
    assert np.trapezoid(area.version.y[mask], area.version.x[mask]) == pytest.approx(1.0)
    whole = run_transform("normalize.area", {}, version)
    assert "AREA_OVER_WHOLE_AXIS" in [w["code"] for w in whole.record["warnings"]]
    negative = Version(version.x, -np.abs(version.y), "cm^-1", "ABSORBANCE", "absorbance")
    with pytest.raises(TransformError):
        run_transform("normalize.max", {"target": 1}, negative)


def test_resample_never_extrapolates() -> None:
    version, _, _ = make(step=4.0)
    out = run_transform("resample.linear", {"step": 10}, version).version
    assert out.x[0] >= version.x[0] and out.x[-1] <= version.x[-1]
    assert np.allclose(np.diff(out.x), 10.0)
    with pytest.raises(TransformError):
        run_transform("resample.linear", {"step": 1e-7}, version)


def test_transmittance_to_absorbance_only_on_request() -> None:
    x = np.arange(400.0, 4000.0, 4.0)
    t_percent = 100.0 * 10.0 ** (-lorentz(x, 1715, 18, 0.9) - 0.01)
    version = Version(x, t_percent, "cm^-1", "TRANSMITTANCE", "percent")
    out = run_transform("convert.absorbance_from_transmittance", {}, version)
    assert out.version.y_quantity == "ABSORBANCE"
    i = int(np.argmin(np.abs(x - 1715)))
    assert out.version.y[i] == pytest.approx(lorentz(x, 1715, 18, 0.9)[i] + 0.01, abs=1e-9)
    assert "EXPLICIT_CONVERSION" in [w["code"] for w in out.record["warnings"]]
    assert version.y_quantity == "TRANSMITTANCE"
    zero = Version(x, np.where(x > 2000, 0.0, t_percent), "cm^-1", "TRANSMITTANCE", "percent")
    with pytest.raises(TransformError) as info:
        run_transform("convert.absorbance_from_transmittance", {}, zero)
    assert info.value.code == "TRANSMITTANCE_NOT_POSITIVE"
    with pytest.raises(TransformError):
        run_transform("convert.absorbance_from_transmittance", {}, make()[0])


def test_y_uncertainty_is_flagged_as_not_propagated() -> None:
    version, _, _ = make()
    record = run_transform("smooth.savgol", {"window_x": 20}, version, input_has_y_error=True).record
    assert "Y_ERROR_NOT_PROPAGATED" in [w["code"] for w in record["warnings"]]


def test_peak_detection_provenance_and_values() -> None:
    version, _, _ = make(noise=0.001)
    corrected = run_transform("baseline.snip", {"half_window_x": 80}, version).version
    record = detect_peaks(corrected, {"prominence_sigma": 8})
    found = {round(p["x"]): p for p in record["peaks"]}
    assert {1220, 1715, 2960} <= {min(found, key=lambda k, c=c: abs(k - c)) for c in (1220, 1715, 2960)}
    top = min(record["peaks"], key=lambda p: abs(p["x"] - 1715))
    assert top["x"] == pytest.approx(1715.0, abs=1.0) and top["fwhm_x"] == pytest.approx(18.0, rel=0.1)
    assert record["authority"] == "DERIVED_NOT_RAW" and record["library"] == "scipy"
    assert record["params"]["prominence_sigma"] == 8 and record["params"]["prominence"] > 0
    assert record["input"]["artifact_sha256"] == corrected.artifact_sha256
    assert record["resolved"]["noise_sigma_estimate"] > 0
    again = detect_peaks(corrected, {"prominence_sigma": 8})
    assert [p["x"] for p in again["peaks"]] == [p["x"] for p in record["peaks"]]


def test_peak_polarity_follows_transmittance() -> None:
    x = np.arange(400.0, 4000.0, 4.0)
    t = 100.0 * 10.0 ** (-lorentz(x, 1715, 18, 0.9))
    record = detect_peaks(Version(x, t, "cm^-1", "TRANSMITTANCE", "percent"), {"prominence": 5.0})
    assert record["params"]["polarity"] == "minima"
    assert [round(p["x"]) for p in record["peaks"]] == [pytest.approx(1715, abs=2)] or abs(record["peaks"][0]["x"] - 1715) < 2
    assert record["peaks"][0]["y"] < 50.0  # reported at the real (low) transmittance, not a flipped value


def test_peak_parameters_are_validated() -> None:
    version, _, _ = make()
    with pytest.raises(TransformError):
        detect_peaks(version, {})
    with pytest.raises(TransformError):
        detect_peaks(version, {"prominence": 0.1, "prominence_sigma": 5})
    with pytest.raises(TransformError):
        detect_peaks(version, {"prominence": 0.1, "polarity": "sideways"})
    grid = np.arange(0.0, 20000.0)
    noisy = Version(grid, np.random.default_rng(3).standard_normal(len(grid)), "cm^-1", "ABSORBANCE", "absorbance")
    with pytest.raises(TransformError) as info:
        detect_peaks(noisy, {"prominence": 1e-4})
    assert info.value.code == "TOO_MANY_PEAKS"


def test_peak_refinement_only_when_the_peak_spans_samples() -> None:
    x = np.arange(0.0, 200.0, 1.0)
    narrow = lorentz(x, 100.3, 1.5, 1.0)
    wide = lorentz(x, 100.3, 12.0, 1.0)
    narrow_record = detect_peaks(Version(x, narrow, "cm^-1", "ABSORBANCE", "absorbance"), {"prominence": 0.2})
    wide_record = detect_peaks(Version(x, wide, "cm^-1", "ABSORBANCE", "absorbance"), {"prominence": 0.2})
    assert narrow_record["peaks"][0]["refined"] == 0.0 and narrow_record["peaks"][0]["x"] == 100.0
    assert wide_record["peaks"][0]["refined"] == 1.0 and wide_record["peaks"][0]["x"] == pytest.approx(100.3, abs=0.05)


def test_noise_free_flat_spectrum_has_no_sigma_peaks() -> None:
    x = np.arange(0.0, 100.0)
    version = Version(x, np.zeros_like(x), "cm^-1", "ABSORBANCE", "absorbance")
    with pytest.raises(TransformError):
        detect_peaks(version, {"prominence_sigma": 5})
    assert math.isclose(sum(detect_peaks(version, {"prominence": 1.0})["resolved"]["samples_per_x"] for _ in range(1)), 1.0)
