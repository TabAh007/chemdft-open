"""Calculated/imported versus experimental comparison. Discrete data are never merged with sampled data.

Calculated (or externally imported) spectra are DISCRETE: modes with frequencies and intensities, or states with energies and
oscillator strengths. Experimental spectra are SAMPLED signals. Therefore:
  * discrete <-> discrete comparison: CANDIDATE peak matching by position (never an assignment);
  * UV/Vis band intensity: the one defensible quantitative comparison, an oscillator strength from cross sections taken over a
    LINEAR energy-like axis (cm^-1) with explicit band limits;
  * sampled <-> sampled similarity: only after an explicit, recorded broadening and normalisation, labelled DISPLAY_ONLY.

Match statuses are CANDIDATE_MATCH, AMBIGUOUS_CANDIDATE, UNMATCHED_EXPERIMENTAL and UNMATCHED_CALCULATED. There is no "assigned".
"""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment

from . import SCHEMA_VERSION, WORKER_VERSION
from .units import (
    EV_NM_PRODUCT,
    F_PER_CM2_CM1,
    SIGMA_TO_EPSILON,
    convert_axis,
    to_wavenumber_cm1,
)

SCHEMA_COMPARISON = "chemdft.experimental-spectrum.comparison"
MATCH_METHOD = "gated_optimal_assignment"
STATUSES = ("CANDIDATE_MATCH", "AMBIGUOUS_CANDIDATE", "UNMATCHED_EXPERIMENTAL", "UNMATCHED_CALCULATED")
SCALE_RANGE = (0.5, 1.5)
HC_OVER_KB_CM_K = 1.438776877


class CompareError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _diag(code: str, severity: str, message: str) -> dict[str, str]:
    return {"code": code, "severity": severity, "message": message}


# ------------------------------------------------------------------------------------------------ matching
def gated_assignment(calc: np.ndarray, exp: np.ndarray, tolerance: float) -> list[dict[str, Any]]:
    """One-to-one CANDIDATE pairs: the optimal (minimum total |delta|) assignment restricted to pairs within the tolerance gate."""
    calc, exp = np.asarray(calc, float), np.asarray(exp, float)
    if len(calc) == 0 or len(exp) == 0:
        return []
    d = np.abs(calc[:, None] - exp[None, :])
    cost = np.where(d <= tolerance, d, 1e6)
    rows, cols = linear_sum_assignment(cost)
    within = d <= tolerance
    n_calc_candidates = within.sum(axis=1)
    n_exp_candidates = within.sum(axis=0)
    pairs: list[dict[str, Any]] = []
    for i, j in sorted((int(r), int(c)) for r, c in zip(rows, cols, strict=True) if d[r, c] <= tolerance):
        others = np.sort(np.delete(d[i], j))
        margin = float((others[0] - d[i, j]) / tolerance) if len(others) else None
        competing = bool(n_calc_candidates[i] > 1 or n_exp_candidates[j] > 1)
        pairs.append(
            {
                "calc_position": i,
                "exp_position": j,
                "delta": float(exp[j] - calc[i]),
                "candidates_for_calc_mode": int(n_calc_candidates[i]),
                "candidates_for_exp_peak": int(n_exp_candidates[j]),
                "margin_to_next_exp_peak": margin,
                "status": "AMBIGUOUS_CANDIDATE" if competing else "CANDIDATE_MATCH",
            }
        )
    return pairs


def _summary(deltas: np.ndarray) -> dict[str, float | None]:
    if len(deltas) == 0:
        return {"signed_bias": None, "mae": None, "rmse": None, "max_abs_delta": None, "median_delta": None}
    return {
        "signed_bias": float(deltas.mean()),
        "mae": float(np.mean(np.abs(deltas))),
        "rmse": float(math.sqrt(float(np.mean(deltas**2)))),
        "max_abs_delta": float(np.abs(deltas).max()),
        "median_delta": float(np.median(deltas)),
    }


def _sensitivity(calc: np.ndarray, exp: np.ndarray, tolerance: float) -> list[dict[str, Any]]:
    """How the gated statistics move with the gate itself: the honest companion to any gated MAE."""
    rows = []
    for factor in (0.5, 1.0, 2.0):
        tol = tolerance * factor
        pairs = gated_assignment(calc, exp, tol)
        deltas = np.array([p["delta"] for p in pairs])
        rows.append({"tolerance": tol, "matched": len(pairs), **{k: v for k, v in _summary(deltas).items() if k in ("mae", "rmse", "signed_bias")}})
    return rows


def _phase_diagnostics(experimental_phase: str, calculated_phase: str, technique: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    exp_phase = (experimental_phase or "NOT_SUPPLIED").upper()
    calc_phase = (calculated_phase or "UNKNOWN").upper()
    condensed = {"LIQUID", "SOLUTION", "SOLID"}
    if exp_phase in ("NOT_SUPPLIED", "UNKNOWN", ""):
        out.append(_diag("PHASE_UNKNOWN", "warning", "the experimental sample phase was not supplied, so phase/sample mismatch with the calculation cannot be judged (UNKNOWN)"))
    elif calc_phase == "UNKNOWN":
        out.append(_diag("CALCULATION_PHASE_UNKNOWN", "warning", f"the calculated phase is unknown; the experiment is {exp_phase}"))
    elif exp_phase in condensed and calc_phase == "GAS":
        out.append(
            _diag(
                "PHASE_MISMATCH",
                "warning",
                f"the experiment is {exp_phase} but the calculation is an isolated gas-phase molecule; intermolecular interactions and solvent shift positions and intensities, "
                "so deviations are not evidence about the calculation alone",
            )
        )
    elif exp_phase == "GAS" and calc_phase == "GAS":
        out.append(_diag("PHASE_CONSISTENT", "info", "both the experiment and the calculation are gas phase; rotational band structure of a gas-phase experiment still limits peak-position precision"))
    elif exp_phase == "OTHER":
        out.append(_diag("PHASE_OTHER", "info", "the experimental phase was entered as OTHER; consistency with the calculation was not assessed"))
    elif calc_phase != exp_phase:
        out.append(_diag("PHASE_DIFFERENCE", "info", f"experiment {exp_phase}, calculation {calc_phase}"))
    return out


# ------------------------------------------------------------------------------------------------ calculated-side display (secondary similarity only)
def lorentzian_curve(nu: np.ndarray, freqs: np.ndarray, intensities: np.ndarray, fwhm: float) -> np.ndarray:
    """AREA-normalised Lorentzian sum (the ChemDFT IR/Raman display convention): each mode integrates to its intensity."""
    half = fwhm / 2.0
    d = nu[:, None] - np.asarray(freqs)[None, :]
    return ((np.asarray(intensities)[None, :] / math.pi) * (half / (d * d + half * half))).sum(axis=1)


def raman_relative_intensities(freqs: np.ndarray, activities: np.ndarray, laser_nm: float, temperature_k: float = 298.15) -> np.ndarray:
    """ChemDFT's derived Raman intensity: activity * (nu_L - nu)^4 / (nu * (1 - exp(-hc nu / kT))), max-normalised."""
    nu_laser = 1e7 / laser_nm
    out = np.zeros(len(freqs))
    for k, (nu, act) in enumerate(zip(freqs, activities, strict=True)):
        if nu <= 0 or nu >= nu_laser or not np.isfinite(act):
            continue
        bose = 1.0 - math.exp(-HC_OVER_KB_CM_K * nu / temperature_k)
        out[k] = act * (nu_laser - nu) ** 4 / (nu * max(bose, 1e-12))
    peak = out.max()
    return out / peak if peak > 0 else out


def similarity_on_common_grid(x1: np.ndarray, y1: np.ndarray, x2: np.ndarray, y2: np.ndarray, lo: float, hi: float, step: float) -> dict[str, float]:
    """Pearson r and cosine similarity after EXPLICIT preprocessing: linear resampling to one grid and max-normalisation.

    The numbers depend on the chosen window, step, broadening and baseline; they are display diagnostics, never a validation score.
    """
    grid = np.arange(lo, hi + 1e-12, step)
    a = np.interp(grid, np.sort(x1), np.asarray(y1)[np.argsort(x1)])
    b = np.interp(grid, np.sort(x2), np.asarray(y2)[np.argsort(x2)])
    if a.max() <= 0 or b.max() <= 0:
        raise CompareError("SIMILARITY_NOT_DEFINED", "a curve has no positive maximum in the chosen window")
    a, b = a / a.max(), b / b.max()
    return {"pearson_r": float(np.corrcoef(a, b)[0, 1]), "cosine": float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b))), "grid_points": len(grid)}


# ------------------------------------------------------------------------------------------------ IR / Raman
def _scaling(request: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    scaling = request.get("scaling") or {"mode": "UNSCALED"}
    mode = scaling.get("mode", "UNSCALED")
    if mode == "UNSCALED":
        return 1.0, {"mode": "UNSCALED", "factor": None, "source": "no scaling applied"}
    if mode != "USER_FACTOR":
        raise CompareError("SCALING_INVALID", "scaling.mode must be UNSCALED or USER_FACTOR; there is no default literature factor")
    try:
        factor = float(scaling["factor"])
    except (KeyError, TypeError, ValueError):
        raise CompareError("SCALING_INVALID", "USER_FACTOR needs a numeric factor") from None
    if not (SCALE_RANGE[0] < factor < SCALE_RANGE[1]):
        raise CompareError("SCALING_INVALID", f"the factor must lie between {SCALE_RANGE[0]} and {SCALE_RANGE[1]}")
    return factor, {"mode": "USER_FACTOR", "factor": factor, "source": "entered by the user for this comparison; not a library or literature value"}


def compare_vibrational(request: dict[str, Any], exp_arrays: tuple[np.ndarray, np.ndarray] | None = None) -> dict[str, Any]:
    technique = request["technique"]
    if technique not in ("IR", "RAMAN"):
        raise CompareError("TECHNIQUE_INVALID", "compare_vibrational handles IR and RAMAN")
    experimental = request["experimental"]
    calculated = request["calculated"]
    matching = request.get("matching") or {}
    try:
        tolerance = float(matching["tolerance_cm1"])
    except (KeyError, TypeError, ValueError):
        raise CompareError("TOLERANCE_REQUIRED", "a matching tolerance in cm^-1 must be supplied; there is no default") from None
    if not (math.isfinite(tolerance) and 0 < tolerance <= 500):
        raise CompareError("TOLERANCE_INVALID", "the tolerance must be between 0 and 500 cm^-1")
    min_relative = float(matching.get("min_relative_intensity", 0.01))
    if not 0.0 <= min_relative < 1.0:
        raise CompareError("THRESHOLD_INVALID", "min_relative_intensity must be in [0, 1)")
    x_unit = experimental["x_unit"]
    if x_unit not in ("cm^-1", "um"):  # IR measured in micrometres is relabelled to cm^-1 as points, deterministically
        raise CompareError("AXIS_UNSUPPORTED", f"cannot compare {technique} peaks given in {x_unit}")
    exp_peaks = list(experimental["peaks"])
    exp_positions = np.array([float(convert_axis(np.array([p["x"]]), x_unit, "cm^-1")[0]) for p in exp_peaks])
    x_lo = float(min(to_wavenumber_cm1(np.array([experimental["x_min"], experimental["x_max"]]), x_unit)))
    x_hi = float(max(to_wavenumber_cm1(np.array([experimental["x_min"], experimental["x_max"]]), x_unit)))
    factor, scaling = _scaling(request)

    modes = list(calculated["modes"])
    real = [m for m in modes if not m.get("imaginary") and float(m["frequency_cm1"]) > 0]
    imaginary = len(modes) - len(real)
    intensities = [m.get("intensity") for m in real]
    have_intensity = all(v is not None for v in intensities) and len(real) > 0
    reference = float(max(intensities)) if have_intensity and max(intensities) > 0 else None  # type: ignore[type-var]
    considered: list[dict[str, Any]] = []
    outside = below = 0
    for m in real:
        scaled = float(m["frequency_cm1"]) * factor
        if not (x_lo <= scaled <= x_hi):
            outside += 1
            continue
        relative = (float(m["intensity"]) / reference) if (have_intensity and reference) else None
        if relative is not None and relative < min_relative:
            below += 1
            continue
        considered.append({**m, "scaled_frequency_cm1": scaled, "relative_intensity": relative})
    calc_positions = np.array([c["scaled_frequency_cm1"] for c in considered])

    pairs_raw = gated_assignment(calc_positions, exp_positions, tolerance)
    top_peak = max((abs(p["y"]) for p in exp_peaks), default=0.0)
    pairs = []
    for p in pairs_raw:
        c = considered[p["calc_position"]]
        e = exp_peaks[p["exp_position"]]
        pairs.append(
            {
                "calc_mode_index": c["index"],
                "calc_frequency_cm1": float(c["frequency_cm1"]),
                "calc_frequency_compared_cm1": c["scaled_frequency_cm1"],
                "exp_peak_index": p["exp_position"],
                "exp_position_cm1": float(exp_positions[p["exp_position"]]),
                "delta_cm1": p["delta"],
                "tolerance_cm1": tolerance,
                "candidates_for_calc_mode": p["candidates_for_calc_mode"],
                "candidates_for_exp_peak": p["candidates_for_exp_peak"],
                "margin_to_next_exp_peak": p["margin_to_next_exp_peak"],
                "status": p["status"],
                "relative_intensity_calc": c["relative_intensity"],
                "relative_intensity_exp": (abs(e["y"]) / top_peak) if top_peak else None,
            }
        )
    matched_calc = {p["calc_position"] for p in pairs_raw}
    matched_exp = {p["exp_position"] for p in pairs_raw}
    unmatched_calc = [
        {"calc_mode_index": c["index"], "calc_frequency_cm1": float(c["frequency_cm1"]), "calc_frequency_compared_cm1": c["scaled_frequency_cm1"], "relative_intensity_calc": c["relative_intensity"], "status": "UNMATCHED_CALCULATED"}
        for i, c in enumerate(considered)
        if i not in matched_calc
    ]
    unmatched_exp = [
        {"exp_peak_index": j, "exp_position_cm1": float(exp_positions[j]), "prominence": float(p["prominence"]), "relative_intensity_exp": (abs(p["y"]) / top_peak) if top_peak else None, "status": "UNMATCHED_EXPERIMENTAL"}
        for j, p in enumerate(exp_peaks)
        if j not in matched_exp
    ]
    deltas = np.array([p["delta"] for p in pairs_raw])
    n_exp, n_calc = len(exp_peaks), len(considered)
    metrics: dict[str, Any] = {
        "calculated_modes_total": len(modes),
        "calculated_modes_considered": n_calc,
        "calculated_modes_excluded": {"imaginary_or_nonpositive": imaginary, "outside_experimental_window": outside, "below_intensity_threshold": below},
        "experimental_peaks": n_exp,
        "matched": len(pairs),
        "ambiguous_pairs": sum(1 for p in pairs if p["status"] == "AMBIGUOUS_CANDIDATE"),
        "matched_fraction_of_experimental_peaks": (len(pairs) / n_exp) if n_exp else None,
        "matched_fraction_of_considered_modes": (len(pairs) / n_calc) if n_calc else None,
        "unmatched_calculated": len(unmatched_calc),
        "unmatched_experimental": len(unmatched_exp),
        **_summary(deltas),
        "delta_definition": "experimental position minus calculated (scaled) position",
        "mae_upper_bound_by_construction_cm1": tolerance,
        "mae_note": "MAE, RMSE and bias are computed over MATCHED pairs only and are bounded by the tolerance gate; a small gated MAE says nothing about the modes and peaks that were left unmatched. Read it together with coverage and the unmatched lists.",
        "tolerance_sensitivity": _sensitivity(calc_positions, exp_positions, tolerance),
    }
    diagnostics = _phase_diagnostics(request.get("experimental_phase", "NOT_SUPPLIED"), calculated.get("phase", "UNKNOWN"), technique)
    if scaling["mode"] == "UNSCALED":
        diagnostics.append(_diag("UNSCALED", "info", "no frequency scaling was applied; harmonic calculated frequencies are compared as computed"))
    else:
        diagnostics.append(_diag("USER_SCALE_FACTOR", "info", f"every calculated frequency was multiplied by the user factor {factor:g}; agreement after scaling is not independent evidence of the calculation"))
    if metrics["ambiguous_pairs"]:
        diagnostics.append(_diag("AMBIGUOUS_CANDIDATES", "warning", f"{metrics['ambiguous_pairs']} candidate pairs have more than one candidate inside the tolerance; the pairing is the optimal one under the gate, not a unique one"))
    if len(pairs) and len(pairs) < max(n_exp, n_calc) / 2:
        diagnostics.append(_diag("LOW_COVERAGE", "warning", "fewer than half of the experimental peaks or considered modes found a candidate; the matched statistics describe a minority of the spectrum"))
    if not have_intensity:
        diagnostics.append(_diag("NO_CALCULATED_INTENSITIES", "info", "calculated intensities are not available; no modes were excluded by intensity and no relative intensities are shown"))
    similarity = None
    if request.get("similarity"):
        similarity = _vibrational_similarity(request["similarity"], considered, exp_arrays, experimental, calculated.get("intensity_basis"))
    return {
        "schema": SCHEMA_COMPARISON,
        "schema_version": SCHEMA_VERSION,
        "worker_version": WORKER_VERSION,
        "kind": "VIBRATIONAL_POSITION_MATCH",
        "technique": technique,
        "method": MATCH_METHOD,
        "tolerance": {"value": tolerance, "unit": "cm^-1", "min_relative_intensity": min_relative, "intensity_reference": reference},
        "scaling": scaling,
        "axis": "cm^-1",
        "pairs": pairs,
        "unmatched_calculated": unmatched_calc,
        "unmatched_experimental": unmatched_exp,
        "metrics": metrics,
        "diagnostics": diagnostics,
        "similarity": similarity,
        "intensity_statement": "Intensities are shown as relative values for orientation only. Calculated IR intensities and Raman activities and experimental peak heights are different quantities; no intensity agreement is claimed.",
        "assignment_statement": "Pairs are CANDIDATE matches by position within the stated tolerance. They are not assignments.",
        "authority": "DETERMINISTIC_TRANSFORM",
        "deterministic": True,
    }


def _vibrational_similarity(settings: dict[str, Any], considered: list[dict[str, Any]], exp_arrays: tuple[np.ndarray, np.ndarray] | None, experimental: dict[str, Any], basis: str | None) -> dict[str, Any]:
    if exp_arrays is None:
        raise CompareError("SIMILARITY_NEEDS_ARRAYS", "similarity needs the experimental arrays")
    if experimental.get("y_quantity") == "TRANSMITTANCE":
        return {"computed": False, "reason": "TRANSMITTANCE_NOT_SUPPORTED", "authority": "DISPLAY_ONLY"}
    if not considered or any(c["relative_intensity"] is None for c in considered):
        return {"computed": False, "reason": "NO_CALCULATED_INTENSITIES", "authority": "DISPLAY_ONLY"}
    try:
        fwhm = float(settings["lorentzian_fwhm_cm1"])
        lo, hi, step = float(settings["window_cm1"][0]), float(settings["window_cm1"][1]), float(settings["step_cm1"])
    except (KeyError, TypeError, ValueError, IndexError):
        raise CompareError("SIMILARITY_SETTINGS_INVALID", "similarity needs lorentzian_fwhm_cm1, window_cm1 [lo, hi] and step_cm1") from None
    if not (fwhm > 0 and step > 0 and lo < hi and (hi - lo) / step <= 100_000):
        raise CompareError("SIMILARITY_SETTINGS_INVALID", "similarity settings are out of range")
    x, y = exp_arrays
    grid = np.arange(lo, hi + 1e-12, step)
    curve = lorentzian_curve(grid, np.array([c["scaled_frequency_cm1"] for c in considered]), np.array([c["relative_intensity"] for c in considered]), fwhm)
    xc = to_wavenumber_cm1(x, experimental["x_unit"])
    try:
        values = similarity_on_common_grid(xc, y, grid, curve, lo, hi, step)
    except CompareError as exc:
        return {"computed": False, "reason": exc.code, "message": exc.message, "authority": "DISPLAY_ONLY"}
    return {
        "computed": True,
        **values,
        "settings": {"lorentzian_fwhm_cm1": fwhm, "window_cm1": [lo, hi], "step_cm1": step, "normalisation": "each curve divided by its own maximum in the window", "calculated_curve": "area-normalised Lorentzian sum of the considered modes (relative intensities)", "intensity_basis": basis},
        "authority": "DISPLAY_ONLY",
        "note": "Depends on the chosen window, broadening, step, baseline and normalisation. It is a display diagnostic, never a validation score.",
    }


# ------------------------------------------------------------------------------------------------ UV/Vis
def _sigma_from(y: np.ndarray, y_quantity: str) -> np.ndarray | None:
    if y_quantity == "CROSS_SECTION":
        return np.asarray(y, float)
    if y_quantity == "MOLAR_ABSORPTIVITY":
        return np.asarray(y, float) / SIGMA_TO_EPSILON
    return None


def _band_experimental(nu: np.ndarray, sigma: np.ndarray, lo_nm: float, hi_nm: float) -> dict[str, Any] | None:
    lo, hi = 1e7 / hi_nm, 1e7 / lo_nm
    mask = (nu >= lo) & (nu <= hi)
    if mask.sum() < 3:
        return None
    n, s = nu[mask], sigma[mask]
    order = np.argsort(n)
    n, s = n[order], s[order]
    area = float(np.trapezoid(s, n))
    centroid = float(np.trapezoid(n * s, n) / area * 1.239841984e-4) if area > 0 else None
    return {"f": float(F_PER_CM2_CM1 * area), "integral_sigma_dnu_cm2_per_cm": area, "points": int(mask.sum()), "nu_lo_cm1": float(n[0]), "nu_hi_cm1": float(n[-1]), "centroid_ev": centroid}


def compare_uvvis(request: dict[str, Any], exp_arrays: tuple[np.ndarray, np.ndarray] | None = None) -> dict[str, Any]:
    experimental = request["experimental"]
    calculated = request["calculated"]
    matching = request.get("matching") or {}
    axis = request.get("axis", "eV")
    if axis not in ("eV", "nm", "cm^-1"):
        raise CompareError("AXIS_UNSUPPORTED", "the comparison axis must be eV, nm or cm^-1")
    try:
        tolerance = float(matching["tolerance"])
    except (KeyError, TypeError, ValueError):
        raise CompareError("TOLERANCE_REQUIRED", f"a matching tolerance in {axis} must be supplied; there is no default") from None
    if not (math.isfinite(tolerance) and tolerance > 0):
        raise CompareError("TOLERANCE_INVALID", "the tolerance must be positive")
    min_f = float(matching.get("min_oscillator_strength", 0.0))
    if min_f < 0:
        raise CompareError("THRESHOLD_INVALID", "min_oscillator_strength cannot be negative")
    x_unit = experimental["x_unit"]
    exp_peaks = list(experimental["peaks"])
    exp_positions = convert_axis(np.array([float(p["x"]) for p in exp_peaks], float), x_unit, axis) if exp_peaks else np.array([])
    edges_nm = np.sort(convert_axis(np.array([experimental["x_min"], experimental["x_max"]], float), x_unit, "nm"))
    states = list(calculated["states"])
    considered: list[dict[str, Any]] = []
    outside = below = 0
    for s in states:
        e_ev = float(s["energy_ev"])
        if e_ev <= 0:
            continue
        wavelength = EV_NM_PRODUCT / e_ev
        if not (edges_nm[0] <= wavelength <= edges_nm[1]):
            outside += 1
            continue
        if float(s["oscillator_strength"]) < min_f:
            below += 1
            continue
        position = float(convert_axis(np.array([e_ev]), "eV", axis)[0])
        considered.append({**s, "wavelength_nm": wavelength, "position": position})
    calc_positions = np.array([c["position"] for c in considered])
    pairs_raw = gated_assignment(calc_positions, exp_positions, tolerance)
    pairs = []
    for p in pairs_raw:
        c = considered[p["calc_position"]]
        e = exp_peaks[p["exp_position"]]
        pairs.append(
            {
                "calc_state_index": c["index"],
                "calc_energy_ev": float(c["energy_ev"]),
                "calc_wavelength_nm": c["wavelength_nm"],
                "calc_oscillator_strength": float(c["oscillator_strength"]),
                "calc_position": c["position"],
                "exp_peak_index": p["exp_position"],
                "exp_position": float(exp_positions[p["exp_position"]]),
                "exp_position_native": float(e["x"]),
                "delta": p["delta"],
                "tolerance": tolerance,
                "candidates_for_calc_state": p["candidates_for_calc_mode"],
                "candidates_for_exp_peak": p["candidates_for_exp_peak"],
                "margin_to_next_exp_peak": p["margin_to_next_exp_peak"],
                "status": p["status"],
            }
        )
    matched_calc = {p["calc_position"] for p in pairs_raw}
    matched_exp = {p["exp_position"] for p in pairs_raw}
    unmatched_calc = [
        {"calc_state_index": c["index"], "calc_energy_ev": float(c["energy_ev"]), "calc_wavelength_nm": c["wavelength_nm"], "calc_position": c["position"], "calc_oscillator_strength": float(c["oscillator_strength"]), "status": "UNMATCHED_CALCULATED"}
        for i, c in enumerate(considered)
        if i not in matched_calc
    ]
    unmatched_exp = [
        {"exp_peak_index": j, "exp_position": float(exp_positions[j]), "exp_position_native": float(p["x"]), "prominence": float(p["prominence"]), "status": "UNMATCHED_EXPERIMENTAL"}
        for j, p in enumerate(exp_peaks)
        if j not in matched_exp
    ]
    deltas = np.array([p["delta"] for p in pairs_raw])
    n_exp, n_calc = len(exp_peaks), len(considered)
    metrics: dict[str, Any] = {
        "calculated_states_total": len(states),
        "calculated_states_considered": n_calc,
        "calculated_states_excluded": {"outside_experimental_window": outside, "below_oscillator_strength_threshold": below},
        "experimental_peaks": n_exp,
        "matched": len(pairs),
        "ambiguous_pairs": sum(1 for p in pairs if p["status"] == "AMBIGUOUS_CANDIDATE"),
        "matched_fraction_of_experimental_peaks": (len(pairs) / n_exp) if n_exp else None,
        "matched_fraction_of_considered_states": (len(pairs) / n_calc) if n_calc else None,
        "unmatched_calculated": len(unmatched_calc),
        "unmatched_experimental": len(unmatched_exp),
        **_summary(deltas),
        "delta_unit": axis,
        "delta_definition": f"experimental position minus calculated position, in {axis}",
        "mae_upper_bound_by_construction": tolerance,
        "mae_note": "MAE, RMSE and bias are computed over MATCHED pairs only and are bounded by the tolerance gate; read them with coverage and the unmatched lists.",
        "tolerance_sensitivity": _sensitivity(calc_positions, exp_positions, tolerance),
    }
    bands = _bands(request.get("bands") or [], experimental, exp_arrays, considered, states, tolerance_ev=_tolerance_ev(tolerance, axis, considered))
    diagnostics = _phase_diagnostics(request.get("experimental_phase", "NOT_SUPPLIED"), calculated.get("phase", "UNKNOWN"), "UVVIS")
    diagnostics.append(_diag("VERTICAL_EXCITATIONS", "info", "calculated states are vertical excitations of one geometry; vibronic structure, band shape and solvent shifts are not modelled, so band maxima are not expected to coincide with vertical energies"))
    if metrics["ambiguous_pairs"]:
        diagnostics.append(_diag("AMBIGUOUS_CANDIDATES", "warning", f"{metrics['ambiguous_pairs']} candidate pairs have more than one candidate inside the tolerance"))
    return {
        "schema": SCHEMA_COMPARISON,
        "schema_version": SCHEMA_VERSION,
        "worker_version": WORKER_VERSION,
        "kind": "UVVIS_POSITION_AND_BAND_COMPARISON",
        "technique": "UVVIS",
        "method": MATCH_METHOD,
        "tolerance": {"value": tolerance, "unit": axis, "min_oscillator_strength": min_f},
        "scaling": {"mode": "UNSCALED", "factor": None, "source": "no energy scaling is offered for UV/Vis in V1"},
        "axis": axis,
        "axis_conversion": "positions are converted as points (nm = 1239.84198/eV, cm^-1 = 1e7/nm); no Jacobian is needed for point positions",
        "pairs": pairs,
        "unmatched_calculated": unmatched_calc,
        "unmatched_experimental": unmatched_exp,
        "metrics": metrics,
        "bands": bands,
        "diagnostics": diagnostics,
        "assignment_statement": "Pairs are CANDIDATE matches by position within the stated tolerance. They are not assignments.",
        "authority": "DETERMINISTIC_TRANSFORM",
        "deterministic": True,
    }


def _tolerance_ev(tolerance: float, axis: str, considered: list[dict[str, Any]]) -> float:
    if axis == "eV":
        return tolerance
    if axis == "cm^-1":
        return tolerance * 1.239841984e-4
    if not considered:
        return 0.0
    centre = float(np.median([c["wavelength_nm"] for c in considered]))
    return tolerance * 1239.84198 / centre**2  # dE = hc/lambda^2 * dlambda, evaluated at the median considered wavelength


def _bands(
    windows: list[dict[str, Any]],
    experimental: dict[str, Any],
    exp_arrays: tuple[np.ndarray, np.ndarray] | None,
    considered: list[dict[str, Any]],
    states: list[dict[str, Any]],
    tolerance_ev: float,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    sigma = None
    nu = None
    if exp_arrays is not None and experimental.get("representation", "ABSOLUTE") == "ABSOLUTE":
        sigma = _sigma_from(exp_arrays[1], experimental["y_quantity"])
        if sigma is not None:
            nu = to_wavenumber_cm1(exp_arrays[0], experimental["x_unit"])
    for index, window in enumerate(windows):
        try:
            lo_nm, hi_nm = float(window["lo_nm"]), float(window["hi_nm"])
        except (KeyError, TypeError, ValueError):
            raise CompareError("BAND_INVALID", "each band needs lo_nm and hi_nm") from None
        if not (0 < lo_nm < hi_nm):
            raise CompareError("BAND_INVALID", "a band needs 0 < lo_nm < hi_nm")
        inside = [s for s in states if float(s["energy_ev"]) > 0 and lo_nm <= EV_NM_PRODUCT / float(s["energy_ev"]) <= hi_nm]
        f_calc = float(sum(float(s["oscillator_strength"]) for s in inside))
        centroid_calc = float(sum(float(s["energy_ev"]) * float(s["oscillator_strength"]) for s in inside) / f_calc) if f_calc > 0 else None
        inside_ids = {int(t["index"]) for t in inside}
        edges_ev = (EV_NM_PRODUCT / lo_nm, EV_NM_PRODUCT / hi_nm)
        near = [
            t
            for t in states
            if float(t["energy_ev"]) > 0 and int(t["index"]) not in inside_ids and min(abs(float(t["energy_ev"]) - edge) for edge in edges_ev) <= tolerance_ev
        ]
        notes: list[dict[str, str]] = []
        band: dict[str, Any] = {
            "label": str(window.get("label") or f"band {index + 1}"),
            "lo_nm": lo_nm,
            "hi_nm": hi_nm,
            "calculated_states_in_band": [int(s["index"]) for s in inside],
            "f_calculated_sum": f_calc,
            "centroid_calculated_ev": centroid_calc,
            "experimental": None,
            "f_ratio_calc_over_exp": None,
            "integration_domain": "cm^-1 (linear in energy); f = 1.1296e12 * integral(sigma d nu~), sigma in cm^2/molecule, nu~ in cm^-1, trapezoid on the native grid",
            "limit_sensitivity": None,
            "notes": notes,
        }
        if not inside:
            notes.append(_diag("NO_CALCULATED_STATE_IN_BAND", "warning", "no calculated state lies inside this band, so the calculated oscillator-strength sum is zero by omission, not by prediction"))
        if near:
            notes.append(_diag("STATES_NEAR_BAND_EDGE", "warning", f"{len(near)} calculated state(s) lie just outside the band edges (within the matching tolerance); the calculated sum depends on where the limits are drawn"))
        if sigma is None or nu is None:
            reason = "RELATIVE_OR_NORMALISED_DATA" if experimental.get("representation") == "RELATIVE" else f"{experimental['y_quantity']}_HAS_NO_ABSOLUTE_SCALE"
            notes.append(_diag("NO_QUANTITATIVE_EXPERIMENTAL_BAND", "info", f"an experimental oscillator strength needs an absolute cross section or molar absorptivity ({reason}); absorbance without concentration and path length gives positions only"))
        else:
            result = _band_experimental(nu, sigma, lo_nm, hi_nm)
            if result is None:
                notes.append(_diag("BAND_OUTSIDE_EXPERIMENTAL_RANGE", "warning", "fewer than 3 experimental points lie inside the band"))
            else:
                band["experimental"] = result
                if result["f"] > 0:
                    band["f_ratio_calc_over_exp"] = f_calc / result["f"]
                width = hi_nm - lo_nm
                variants = []
                for shrink in (-0.1, 0.1):
                    r = _band_experimental(nu, sigma, lo_nm + shrink * width, hi_nm - shrink * width)
                    if r is not None:
                        variants.append(r["f"])
                if variants:
                    band["limit_sensitivity"] = {"f_min": float(min([result["f"], *variants])), "f_max": float(max([result["f"], *variants])), "edges_moved": "each edge by 10% of the band width, inward and outward"}
                if (sigma < 0).any():
                    notes.append(_diag("NEGATIVE_CROSS_SECTION_VALUES", "info", "negative cross-section values (noise or baseline) are included in the integral as measured"))
                if band["f_ratio_calc_over_exp"] is not None:
                    notes.append(_diag("RATIO_IS_NOT_A_SCORE", "info", "the ratio of two oscillator-strength sums depends on the band limits and on how many states fall inside; it is not an agreement score"))
        out.append(band)
    return out


def compare(request: dict[str, Any], exp_arrays: tuple[np.ndarray, np.ndarray] | None = None) -> dict[str, Any]:
    technique = request.get("technique")
    if technique in ("IR", "RAMAN"):
        return compare_vibrational(request, exp_arrays)
    if technique == "UVVIS":
        return compare_uvvis(request, exp_arrays)
    raise CompareError("TECHNIQUE_INVALID", f"unsupported technique {technique!r}")
