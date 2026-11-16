"""Deterministic, user-triggered transforms of a spectrum version. Every call returns a NEW version; nothing mutates its input.

Derived versions are stored in ASCENDING x (a high-to-low display is a view option, not a storage order). The raw version keeps
the order of the file. Parameters are expressed in the physical x unit (stiffness length, window width), never as a raw
`lam` or sample count; the derived internal values are stored beside them (`resolved`) so a run can be re-executed exactly.

Authority: a derived version is DETERMINISTIC_TRANSFORM output of its parent. It never replaces or edits the parent.
"""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import math
import platform
import warnings as pywarnings
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pybaselines
import scipy
from pybaselines import Baseline
from scipy import signal

from . import SCHEMA_VERSION, WORKER_VERSION
from .canonical import array_bytes, array_sha256, sha256_hex
from .textio import MAX_POINTS, MIN_POINTS

SCHEMA_TRANSFORM = "chemdft.experimental-spectrum.transform"
SCHEMA_PEAKS = "chemdft.experimental-spectrum.peaks"
MAX_PEAKS = 2000
SG_MODES = ("interp", "mirror", "nearest", "wrap", "constant")
OPS = (
    "baseline.arpls",
    "baseline.snip",
    "baseline.imodpoly",
    "baseline.offset",
    "smooth.savgol",
    "normalize.max",
    "normalize.area",
    "resample.linear",
    "crop",
    "convert.absorbance_from_transmittance",
)


class TransformError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Version:
    x: np.ndarray
    y: np.ndarray
    x_unit: str
    y_quantity: str
    y_unit: str
    representation: str = "ABSOLUTE"  # ABSOLUTE | RELATIVE (normalised)
    aux: dict[str, np.ndarray] = field(default_factory=dict)

    @property
    def artifact_sha256(self) -> str:
        return sha256_hex(array_bytes(self.x) + array_bytes(self.y))


@dataclass
class TransformResult:
    version: Version
    record: dict[str, Any]


def environment() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "pybaselines": pybaselines.__version__,
        "platform": platform.platform(),
        "machine": platform.machine(),
    }


# ------------------------------------------------------------------------------------------------ helpers
def _ascending(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, bool]:
    if len(x) > 1 and x[0] > x[-1]:
        return x[::-1].copy(), y[::-1].copy(), True
    return x.copy(), y.copy(), False


def spacing(x: np.ndarray) -> dict[str, float]:
    step = np.abs(np.diff(x))
    median = float(np.median(step))
    return {"median": median, "relative_variation": float((step.max() - step.min()) / median)}


def _check_params(op: str, params: dict[str, Any], allowed: set[str], required: frozenset[str] | set[str] = frozenset()) -> None:
    unknown = set(params) - allowed
    if unknown:
        raise TransformError("PARAMETER_UNKNOWN", f"{op}: unknown parameter(s) {sorted(unknown)}; allowed: {sorted(allowed)}")
    missing = set(required) - set(params)
    if missing:
        raise TransformError("PARAMETER_MISSING", f"{op}: missing parameter(s) {sorted(missing)}")


def _positive(op: str, name: str, value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise TransformError("PARAMETER_INVALID", f"{op}: {name} must be a number") from None
    if not math.isfinite(number) or number <= 0:
        raise TransformError("PARAMETER_INVALID", f"{op}: {name} must be a finite number greater than 0")
    return number


def _integer(op: str, name: str, value: Any, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float) or float(value) != int(value):
        raise TransformError("PARAMETER_INVALID", f"{op}: {name} must be an integer")
    number = int(value)
    if not lo <= number <= hi:
        raise TransformError("PARAMETER_INVALID", f"{op}: {name} must be between {lo} and {hi}")
    return number


def noise_sigma(y: np.ndarray) -> float:
    """Robust white-noise estimate from the second difference: sigma = 1.4826 * MAD(d2) / sqrt(6)."""
    d2 = y[2:] - 2.0 * y[1:-1] + y[:-2]
    return float(1.4826 * np.median(np.abs(d2 - np.median(d2))) / math.sqrt(6.0))


def _io(version: Version, x_descending: bool | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "artifact_sha256": version.artifact_sha256,
        "x_sha256": array_sha256(version.x),
        "y_sha256": array_sha256(version.y),
        "point_count": len(version.x),
        "x_unit": version.x_unit,
        "y_quantity": version.y_quantity,
        "y_unit": version.y_unit,
        "representation": version.representation,
    }
    if x_descending is not None:
        body["x_order"] = "DESCENDING" if x_descending else "ASCENDING"
    return body


def _finish(
    op: str,
    library: str,
    library_version: str,
    params: dict[str, Any],
    resolved: dict[str, Any],
    parent: Version,
    child: Version,
    flipped: bool,
    warnings: list[dict[str, str]],
    input_has_y_error: bool,
) -> TransformResult:
    if input_has_y_error:
        warnings = [*warnings, _warn("Y_ERROR_NOT_PROPAGATED", "the parent has a y uncertainty column; derived versions do not carry or propagate it")]
    if len(child.x) < MIN_POINTS:
        raise TransformError("TOO_FEW_POINTS_AFTER_TRANSFORM", f"{op} leaves {len(child.x)} points; at least {MIN_POINTS} are required")
    if len(child.x) > MAX_POINTS:
        raise TransformError("TOO_MANY_POINTS", f"{op} would create {len(child.x)} points; the limit is {MAX_POINTS}")
    if not (np.isfinite(child.y).all() and np.isfinite(child.x).all()):
        raise TransformError("NON_FINITE_OUTPUT", f"{op} produced NaN/Inf values; nothing was created")
    aux_hashes = {name: {"sha256": array_sha256(values), "point_count": len(values)} for name, values in sorted(child.aux.items())}
    record: dict[str, Any] = {
        "schema": SCHEMA_TRANSFORM,
        "schema_version": SCHEMA_VERSION,
        "worker_version": WORKER_VERSION,
        "op": op,
        "library": library,
        "library_version": library_version,
        "params": params,
        "resolved": resolved,
        "input": _io(parent, flipped),
        "output": {**_io(child, False), "aux": aux_hashes},
        "input_was_descending": flipped,
        "warnings": warnings,
        "deterministic": True,
        "authority": "DETERMINISTIC_TRANSFORM",
        "environment": environment(),
    }
    return TransformResult(child, record)


def _warn(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


# ------------------------------------------------------------------------------------------------ baseline
def _call(sink: list[dict[str, str]], fit: Any) -> Any:
    """Run a pybaselines fit and surface its Python warnings in the transform record instead of losing them."""
    with pywarnings.catch_warnings(record=True) as caught:
        pywarnings.simplefilter("always")
        result = fit()
    for item in caught:
        sink.append(_warn("LIBRARY_WARNING", f"{item.category.__name__}: {item.message}"))
    return result


def _baseline(parent: Version, op: str, params: dict[str, Any], input_has_y_error: bool) -> TransformResult:
    x, y, flipped = _ascending(parent.x, parent.y)
    sp = spacing(x)
    step = sp["median"]
    warnings: list[dict[str, str]] = []
    resolved: dict[str, Any] = {"median_step_x": step}
    method = op.split(".", 1)[1]
    library, library_version = "pybaselines", pybaselines.__version__
    if method == "arpls":
        _check_params(op, params, {"stiffness_length_x", "diff_order", "max_iter", "tol"}, {"stiffness_length_x"})
        length = _positive(op, "stiffness_length_x", params["stiffness_length_x"])
        diff_order = _integer(op, "diff_order", params.get("diff_order", 2), 1, 3)
        max_iter = _integer(op, "max_iter", params.get("max_iter", 50), 1, 500)
        tol = _positive(op, "tol", params.get("tol", 1e-3))
        if length / step < 2.0:
            raise TransformError("PARAMETER_INVALID", f"{op}: stiffness_length_x must span at least 2 points ({2 * step:g} {parent.x_unit})")
        lam = float((length / step) ** 4)
        base, info = _call(warnings, lambda: Baseline(x_data=x).arpls(y, lam=lam, diff_order=diff_order, max_iter=max_iter, tol=tol))
        history = info.get("tol_history")
        final_tol = float(history[-1]) if history is not None and len(history) else None
        resolved.update({"lam": lam, "lam_rule": "lam = (stiffness_length_x / median_step_x) ** 4", "final_tol": final_tol, "converged": None if final_tol is None else final_tol <= tol})
        if final_tol is not None and final_tol > tol:
            warnings.append(_warn("ITERATION_LIMIT", "the iteration limit was reached before the tolerance was met; the baseline may not be converged"))
        if sp["relative_variation"] > 1e-3:
            warnings.append(_warn("NON_UNIFORM_SPACING", "lam is defined on sample index, not on x: non-uniform spacing makes the same lam stiffer in some regions"))
        normalised = {"stiffness_length_x": length, "diff_order": diff_order, "max_iter": max_iter, "tol": tol}
    elif method == "snip":
        _check_params(op, params, {"half_window_x", "decreasing", "smooth_half_window"}, {"half_window_x"})
        half = _positive(op, "half_window_x", params["half_window_x"])
        decreasing = bool(params.get("decreasing", True))
        smooth_half = params.get("smooth_half_window")
        smooth_half = None if smooth_half is None else _integer(op, "smooth_half_window", smooth_half, 0, 1000)
        samples = max(1, round(half / step))
        if samples >= len(y) // 2:
            raise TransformError("PARAMETER_INVALID", f"{op}: half_window_x covers {samples} samples; it must be below half of the {len(y)} points")
        base, _info = _call(warnings, lambda: Baseline(x_data=x).snip(y, max_half_window=samples, decreasing=decreasing, smooth_half_window=smooth_half))
        resolved.update({"max_half_window_samples": samples})
        normalised = {"half_window_x": half, "decreasing": decreasing, "smooth_half_window": smooth_half}
        if sp["relative_variation"] > 1e-3:
            warnings.append(_warn("NON_UNIFORM_SPACING", "the SNIP window is a sample count: non-uniform spacing changes its width in x across the spectrum"))
    elif method == "imodpoly":
        _check_params(op, params, {"poly_order", "max_iter", "tol", "num_std"}, {"poly_order"})
        order = _integer(op, "poly_order", params["poly_order"], 1, 10)
        max_iter = _integer(op, "max_iter", params.get("max_iter", 250), 1, 1000)
        tol = _positive(op, "tol", params.get("tol", 1e-3))
        num_std = _positive(op, "num_std", params.get("num_std", 1.0))
        base, info = _call(warnings, lambda: Baseline(x_data=x).imodpoly(y, poly_order=order, max_iter=max_iter, tol=tol, num_std=num_std))
        history = info.get("tol_history")
        final_tol = float(history[-1]) if history is not None and len(history) else None
        resolved.update({"final_tol": final_tol, "converged": None if final_tol is None else final_tol <= tol})
        if final_tol is not None and final_tol > tol:
            warnings.append(_warn("ITERATION_LIMIT", "the iteration limit was reached before the tolerance was met"))
        warnings.append(_warn("POLYNOMIAL_EDGE_FLARE", "a polynomial baseline can flare at the edges and cannot follow a wiggly baseline; inspect the baseline curve"))
        normalised = {"poly_order": order, "max_iter": max_iter, "tol": tol, "num_std": num_std}
    elif method == "offset":
        _check_params(op, params, {"percentile", "value"})
        if ("percentile" in params) == ("value" in params):
            raise TransformError("PARAMETER_INVALID", f"{op}: give exactly one of percentile (0-100) or value")
        library, library_version = "numpy", np.__version__
        if "percentile" in params:
            percentile = float(params["percentile"])
            if not 0.0 <= percentile <= 100.0:
                raise TransformError("PARAMETER_INVALID", f"{op}: percentile must be between 0 and 100")
            constant = float(np.percentile(y, percentile))
            normalised = {"percentile": percentile}
        else:
            constant = float(params["value"])
            if not math.isfinite(constant):
                raise TransformError("PARAMETER_INVALID", f"{op}: value must be finite")
            normalised = {"value": constant}
        base = np.full_like(y, constant)
        resolved.update({"offset": constant})
    else:  # pragma: no cover - guarded by OPS
        raise TransformError("OP_UNKNOWN", f"unknown baseline method {method}")
    base = np.asarray(base, dtype=float)
    corrected = y - base
    if np.any(base > y + 1e-12 * np.abs(y).max()):
        warnings.append(_warn("BASELINE_ABOVE_SIGNAL", "the baseline lies above the signal in places; the corrected spectrum has negative values there"))
    child = Version(x, corrected, parent.x_unit, parent.y_quantity, parent.y_unit, parent.representation, {"baseline": base})
    return _finish(op, library, library_version, normalised, resolved, parent, child, flipped, warnings, input_has_y_error)


# ------------------------------------------------------------------------------------------------ smoothing
def _lorentz(x: np.ndarray, centre: float, fwhm: float) -> np.ndarray:
    return (fwhm / 2) ** 2 / ((x - centre) ** 2 + (fwhm / 2) ** 2)


def savgol_height_loss(window_points: int, polyorder: int, fwhm_points: float) -> float:
    """Relative height loss when Savitzky-Golay is applied to a noise-free Lorentzian of the given width (in samples)."""
    half = int(max(window_points, 8 * fwhm_points)) + 5
    grid = np.arange(-half, half + 1, dtype=float)
    clean = _lorentz(grid, 0.0, fwhm_points)
    smoothed = signal.savgol_filter(clean, window_points, polyorder, mode="interp")
    return float(1.0 - smoothed[half] / clean[half])


def _smooth(parent: Version, params: dict[str, Any], input_has_y_error: bool) -> TransformResult:
    op = "smooth.savgol"
    _check_params(op, params, {"window_x", "window_points", "polyorder", "mode"})
    if ("window_x" in params) == ("window_points" in params):
        raise TransformError("PARAMETER_INVALID", f"{op}: give exactly one of window_x (physical units) or window_points")
    x, y, flipped = _ascending(parent.x, parent.y)
    sp = spacing(x)
    step = sp["median"]
    polyorder = _integer(op, "polyorder", params.get("polyorder", 3), 1, 10)
    mode = str(params.get("mode", "interp"))
    if mode not in SG_MODES:
        raise TransformError("PARAMETER_INVALID", f"{op}: mode must be one of {SG_MODES}")
    if "window_x" in params:
        window_x = _positive(op, "window_x", params["window_x"])
        window = max(round(window_x / step), 3)
        window = window if window % 2 == 1 else window + 1
    else:
        window = _integer(op, "window_points", params["window_points"], 3, MAX_POINTS)
    if window % 2 == 0 or window <= polyorder or window > len(y):
        raise TransformError(
            "PARAMETER_INVALID",
            f"{op}: the window must be odd, larger than polyorder ({polyorder}) and no longer than the {len(y)} points; got {window} points"
            + (f" (window_x = {params['window_x']:g} {parent.x_unit} at a {step:g} step)" if "window_x" in params else ""),
        )
    warnings: list[dict[str, str]] = []
    if sp["relative_variation"] > 0.01:
        warnings.append(_warn("NON_UNIFORM_SPACING", f"x spacing varies by {sp['relative_variation']:.1%}; Savitzky-Golay assumes uniform spacing: resample first or accept a position-dependent effective window"))
    window_equivalent = float(window * step)
    advisory = _smoothing_advisory(x, y, window, polyorder, step)
    if advisory["narrowest_peak_fwhm_x"] is not None:
        ratio = window_equivalent / advisory["narrowest_peak_fwhm_x"]
        advisory["window_over_fwhm"] = ratio
        if ratio > 0.5:
            warnings.append(
                _warn(
                    "WINDOW_LARGE_VS_PEAK_WIDTH",
                    f"the window ({window_equivalent:g} {parent.x_unit}) is {ratio:.2f} times the narrowest significant peak width "
                    f"({advisory['narrowest_peak_fwhm_x']:.3g} {parent.x_unit}); simulated height loss for such a peak is {advisory['simulated_height_loss']:.2%}"
                    + ("; peak shifts can appear for asymmetric bands" if ratio > 0.9 else ""),
                )
            )
    smoothed = signal.savgol_filter(y, window, polyorder, mode=mode)
    resolved = {"window_points": int(window), "window_x_equivalent": window_equivalent, "median_step_x": step, "advisory": advisory}
    normalised = {"window_x": float(params["window_x"]) if "window_x" in params else None, "window_points": int(window), "polyorder": polyorder, "mode": mode}
    child = Version(x, smoothed, parent.x_unit, parent.y_quantity, parent.y_unit, parent.representation)
    return _finish(op, "scipy", scipy.__version__, normalised, resolved, parent, child, flipped, warnings, input_has_y_error)


def _smoothing_advisory(x: np.ndarray, y: np.ndarray, window: int, polyorder: int, step: float) -> dict[str, Any]:
    advisory: dict[str, Any] = {"narrowest_peak_fwhm_x": None, "simulated_height_loss": None, "window_over_fwhm": None, "noise_sigma": None, "peaks_considered": 0}
    sigma = noise_sigma(y)
    advisory["noise_sigma"] = sigma
    if sigma <= 0:
        return advisory
    # Only features that are clearly signal count: >= 10 sigma prominent and at least 3 samples wide (white-noise spikes are 1-2 samples).
    peaks = _find(x, y, prominence=10.0 * sigma, polarity="maxima", min_width_x=None, min_distance_x=None, height=None, threshold=None, refine=False)
    widths = [p["fwhm_x"] for p in peaks if p["fwhm_x"] >= 3.0 * step]
    advisory["peaks_considered"] = len(widths)
    if widths:
        narrowest = float(min(widths))
        advisory["narrowest_peak_fwhm_x"] = narrowest
        advisory["simulated_height_loss"] = savgol_height_loss(window, polyorder, max(narrowest / step, 1.0))
    return advisory


# ------------------------------------------------------------------------------------------------ normalisation, resampling, crop, conversion
def _normalize(parent: Version, op: str, params: dict[str, Any], input_has_y_error: bool) -> TransformResult:
    x, y, flipped = _ascending(parent.x, parent.y)
    warnings: list[dict[str, str]] = [_warn("RELATIVE_REPRESENTATION", "original intensity units are kept in the parent version; this is a relative representation and is never treated as a measurement")]
    if parent.representation == "RELATIVE":
        warnings.append(_warn("ALREADY_RELATIVE", "the parent is already a relative (normalised) version"))
    if op == "normalize.max":
        _check_params(op, params, {"target"})
        target = float(params.get("target", 1.0))
        if target not in (1.0, 100.0):
            raise TransformError("PARAMETER_INVALID", f"{op}: target must be 1 or 100")
        peak = float(np.max(y))
        if peak <= 0:
            raise TransformError("PARAMETER_INVALID", f"{op}: the maximum must be positive")
        scale = target / peak
        normalised = {"target": target}
        resolved = {"scale_factor": scale, "reference_value": peak, "reference_x": float(x[int(np.argmax(y))])}
    else:
        _check_params(op, params, {"target", "x_range"})
        target = _positive(op, "target", params.get("target", 1.0))
        x_range = params.get("x_range")
        if x_range is None:
            lo, hi = float(x[0]), float(x[-1])
            warnings.append(_warn("AREA_OVER_WHOLE_AXIS", "area over the whole axis is rarely meaningful; choose a band or a baseline-corrected range"))
        else:
            if not (isinstance(x_range, list | tuple) and len(x_range) == 2):
                raise TransformError("PARAMETER_INVALID", f"{op}: x_range must be [low, high]")
            lo, hi = float(x_range[0]), float(x_range[1])
            if not lo < hi:
                raise TransformError("PARAMETER_INVALID", f"{op}: x_range must have low < high")
        mask = (x >= lo) & (x <= hi)
        if mask.sum() < 3:
            raise TransformError("PARAMETER_INVALID", f"{op}: fewer than 3 points inside x_range")
        area = float(np.trapezoid(y[mask], x[mask]))
        if area <= 0:
            raise TransformError("PARAMETER_INVALID", f"{op}: the area must be positive; baseline-correct first or choose a band")
        scale = target / area
        normalised = {"target": target, "x_range": [lo, hi] if x_range is not None else None}
        resolved = {"scale_factor": scale, "area": area, "area_unit": f"{parent.y_unit}*{parent.x_unit}", "x_range_used": [lo, hi], "integration": "trapezoid"}
    child = Version(x, y * scale, parent.x_unit, parent.y_quantity, "relative", "RELATIVE")
    return _finish(op, "numpy", np.__version__, normalised, resolved, parent, child, flipped, warnings, input_has_y_error)


def _resample(parent: Version, params: dict[str, Any], input_has_y_error: bool) -> TransformResult:
    op = "resample.linear"
    _check_params(op, params, {"step"}, {"step"})
    x, y, flipped = _ascending(parent.x, parent.y)
    step = _positive(op, "step", params["step"])
    start = math.ceil(x[0] / step - 1e-9) * step
    count = math.floor((x[-1] - start) / step + 1e-9) + 1
    if count < MIN_POINTS:
        raise TransformError("TOO_FEW_POINTS_AFTER_TRANSFORM", f"{op}: step {step:g} gives {count} points")
    if count > MAX_POINTS:
        raise TransformError("TOO_MANY_POINTS", f"{op}: step {step:g} gives {count} points; the limit is {MAX_POINTS}")
    grid = start + step * np.arange(count, dtype=float)
    out = np.interp(grid, x, y)
    warnings = []
    if step > spacing(x)["median"]:
        warnings.append(_warn("DOWNSAMPLING", "down-sampling by linear interpolation can lower sharp peak heights; smooth or integrate instead when areas matter"))
    warnings.append(_warn("NOT_REVERSIBLE", "resampling loses information; the parent version remains the record of the measured points"))
    child = Version(grid, out, parent.x_unit, parent.y_quantity, parent.y_unit, parent.representation)
    return _finish(op, "numpy", np.__version__, {"step": step}, {"first_x": float(grid[0]), "last_x": float(grid[-1]), "point_count": count, "interpolation": "linear, no extrapolation"}, parent, child, flipped, warnings, input_has_y_error)


def _crop(parent: Version, params: dict[str, Any], input_has_y_error: bool) -> TransformResult:
    op = "crop"
    _check_params(op, params, {"x_min", "x_max"}, {"x_min", "x_max"})
    lo, hi = float(params["x_min"]), float(params["x_max"])
    if not (math.isfinite(lo) and math.isfinite(hi) and lo < hi):
        raise TransformError("PARAMETER_INVALID", f"{op}: x_min must be below x_max")
    x, y, flipped = _ascending(parent.x, parent.y)
    mask = (x >= lo) & (x <= hi)
    child = Version(x[mask], y[mask], parent.x_unit, parent.y_quantity, parent.y_unit, parent.representation)
    return _finish(op, "numpy", np.__version__, {"x_min": lo, "x_max": hi}, {"kept_points": int(mask.sum())}, parent, child, flipped, [_warn("REMOVES_CONTEXT", "cropping removes data outside the window from this version; the parent keeps it")], input_has_y_error)


def _t_to_a(parent: Version, params: dict[str, Any], input_has_y_error: bool) -> TransformResult:
    op = "convert.absorbance_from_transmittance"
    _check_params(op, params, set())
    if parent.y_quantity != "TRANSMITTANCE":
        raise TransformError("PARAMETER_INVALID", f"{op}: the parent must be transmittance, not {parent.y_quantity}")
    x, y, flipped = _ascending(parent.x, parent.y)
    fraction = y / 100.0 if parent.y_unit == "percent" else y.copy()
    bad = fraction <= 0
    if bad.any():
        raise TransformError("TRANSMITTANCE_NOT_POSITIVE", f"{op}: {int(bad.sum())} transmittance values are zero or negative (first at x = {x[bad][0]:g}); absorbance = -log10(T) is undefined there, so nothing was created")
    warnings = [_warn("EXPLICIT_CONVERSION", "A = -log10(T) was applied because you requested it; transmittance is never converted automatically")]
    if (fraction > 1.0).any():
        warnings.append(_warn("TRANSMITTANCE_ABOVE_100", f"{int((fraction > 1.0).sum())} values exceed 100 %; they give negative absorbance"))
    child = Version(x, -np.log10(fraction), parent.x_unit, "ABSORBANCE", "absorbance", "ABSOLUTE")
    return _finish(op, "numpy", np.__version__, {}, {"input_scale": parent.y_unit, "formula": "A = -log10(T / T_full_scale)"}, parent, child, flipped, warnings, input_has_y_error)


# ------------------------------------------------------------------------------------------------ dispatch
def run_transform(op: str, params: dict[str, Any], parent: Version, input_has_y_error: bool = False) -> TransformResult:
    if op not in OPS:
        raise TransformError("OP_UNKNOWN", f"unknown transform {op!r}; available: {', '.join(OPS)}")
    if len(parent.x) < MIN_POINTS or len(parent.x) != len(parent.y):
        raise TransformError("INPUT_INVALID", "the input version is not a valid spectrum")
    if op.startswith("baseline."):
        return _baseline(parent, op, params, input_has_y_error)
    if op == "smooth.savgol":
        return _smooth(parent, params, input_has_y_error)
    if op.startswith("normalize."):
        return _normalize(parent, op, params, input_has_y_error)
    if op == "resample.linear":
        return _resample(parent, params, input_has_y_error)
    if op == "crop":
        return _crop(parent, params, input_has_y_error)
    return _t_to_a(parent, params, input_has_y_error)


# ------------------------------------------------------------------------------------------------ peaks
def _vertex(x: np.ndarray, y: np.ndarray, i: int) -> tuple[float, float]:
    """Three-point parabolic vertex. Used only where the peak spans at least 3 samples at half height."""
    if i <= 0 or i >= len(x) - 1:
        return float(x[i]), float(y[i])
    x0, x1, x2 = x[i - 1], x[i], x[i + 1]
    y0, y1, y2 = y[i - 1], y[i], y[i + 1]
    num = (x1 - x0) ** 2 * (y1 - y2) - (x1 - x2) ** 2 * (y1 - y0)
    den = (x1 - x0) * (y1 - y2) - (x1 - x2) * (y1 - y0)
    if den == 0:
        return float(x1), float(y1)
    xv = x1 - 0.5 * num / den
    if not (x0 <= xv <= x2):
        return float(x1), float(y1)
    yv = (
        y0 * (xv - x1) * (xv - x2) / ((x0 - x1) * (x0 - x2))
        + y1 * (xv - x0) * (xv - x2) / ((x1 - x0) * (x1 - x2))
        + y2 * (xv - x0) * (xv - x1) / ((x2 - x0) * (x2 - x1))
    )
    return float(xv), float(yv)


def _find(
    x: np.ndarray,
    y: np.ndarray,
    prominence: float,
    polarity: str,
    min_width_x: float | None,
    min_distance_x: float | None,
    height: float | None,
    threshold: float | None,
    refine: bool,
) -> list[dict[str, Any]]:
    step = spacing(x)["median"]
    signal_y = y if polarity == "maxima" else -y
    kwargs: dict[str, Any] = {"prominence": prominence}
    if height is not None:
        kwargs["height"] = height if polarity == "maxima" else -height
    if threshold is not None:
        kwargs["threshold"] = threshold
    if min_width_x is not None:
        kwargs["width"] = max(1.0, min_width_x / step)
    if min_distance_x is not None:
        kwargs["distance"] = max(1.0, min_distance_x / step)
    idx, props = signal.find_peaks(signal_y, **kwargs)
    if len(idx) == 0:
        return []
    widths, _heights, left, right = signal.peak_widths(signal_y, idx, rel_height=0.5, prominence_data=(props["prominences"], props["left_bases"], props["right_bases"]))
    grid = np.arange(len(x), dtype=float)
    top = float(np.max(np.abs(y[idx]))) or 1.0
    peaks: list[dict[str, Any]] = []
    for k, i in enumerate(idx):
        fwhm_samples = float(widths[k])
        refined = bool(refine and fwhm_samples >= 3.0)
        xv, yv = _vertex(x, signal_y, int(i)) if refined else (float(x[i]), float(signal_y[i]))
        yv = yv if polarity == "maxima" else -yv
        peaks.append(
            {
                "index": int(i),
                "x_sample": float(x[i]),
                "y_sample": float(y[i]),
                "x": float(xv),
                "y": float(yv),
                "prominence": float(props["prominences"][k]),
                "fwhm_x": float(np.interp(right[k], grid, x) - np.interp(left[k], grid, x)),
                "left_base_x": float(x[props["left_bases"][k]]),
                "right_base_x": float(x[props["right_bases"][k]]),
                "relative_height": float(abs(y[i]) / top),
                "refined": 1.0 if refined else 0.0,
            }
        )
    return peaks


def detect_peaks(parent: Version, params: dict[str, Any], input_has_y_error: bool = False) -> dict[str, Any]:
    """Deterministic, parameterised peak picking. Peaks are DERIVED values (DERIVED_NOT_RAW), never raw measurements."""
    op = "peaks"
    _check_params(op, params, {"prominence", "prominence_sigma", "polarity", "height", "min_width_x", "min_distance_x", "threshold", "refine"})
    if ("prominence" in params) == ("prominence_sigma" in params):
        raise TransformError("PARAMETER_INVALID", f"{op}: give exactly one of prominence (y units) or prominence_sigma (multiples of the noise estimate)")
    x, y, flipped = _ascending(parent.x, parent.y)
    sp = spacing(x)
    sigma = noise_sigma(y)
    polarity = str(params.get("polarity") or ("minima" if parent.y_quantity == "TRANSMITTANCE" else "maxima"))
    if polarity not in ("maxima", "minima"):
        raise TransformError("PARAMETER_INVALID", f"{op}: polarity must be maxima or minima")
    if "prominence_sigma" in params:
        multiple = _positive(op, "prominence_sigma", params["prominence_sigma"])
        if sigma <= 0:
            raise TransformError("PARAMETER_INVALID", f"{op}: the noise estimate is zero; give an absolute prominence")
        prominence = multiple * sigma
    else:
        multiple = None
        prominence = _positive(op, "prominence", params["prominence"])
    height = None if params.get("height") is None else float(params["height"])
    threshold = None if params.get("threshold") is None else _positive(op, "threshold", params["threshold"])
    min_width_x = None if params.get("min_width_x") is None else _positive(op, "min_width_x", params["min_width_x"])
    min_distance_x = None if params.get("min_distance_x") is None else _positive(op, "min_distance_x", params["min_distance_x"])
    refine = bool(params.get("refine", True))
    peaks = _find(x, y, prominence, polarity, min_width_x, min_distance_x, height, threshold, refine)
    if len(peaks) > MAX_PEAKS:
        raise TransformError("TOO_MANY_PEAKS", f"{len(peaks)} peaks exceed the limit of {MAX_PEAKS}; raise the prominence")
    warnings: list[dict[str, str]] = []
    if input_has_y_error:
        warnings.append(_warn("Y_ERROR_NOT_PROPAGATED", "the parent has a y uncertainty column; it is not used by peak detection"))
    if sp["relative_variation"] > 0.01:
        warnings.append(_warn("NON_UNIFORM_SPACING", "x spacing is non-uniform; width and distance limits use the median step"))
    narrow = sum(1 for p in peaks if p["fwhm_x"] < 3.0 * sp["median"])
    if narrow:
        warnings.append(_warn("PEAK_NARROWER_THAN_3_SAMPLES", f"{narrow} of {len(peaks)} peaks are narrower than 3 samples; they may be noise spikes or undersampled bands, and their width and position are poorly defined"))
    if multiple is not None and multiple < 3.0:
        warnings.append(_warn("PROMINENCE_NEAR_NOISE", f"the prominence is {multiple:g} x the noise estimate; noise features may be reported as peaks"))
    return {
        "schema": SCHEMA_PEAKS,
        "schema_version": SCHEMA_VERSION,
        "worker_version": WORKER_VERSION,
        "algorithm": "scipy.signal.find_peaks + peak_widths(rel_height=0.5) + three-point parabolic vertex where fwhm >= 3 samples",
        "library": "scipy",
        "library_version": scipy.__version__,
        "params": {
            "prominence": prominence,
            "prominence_sigma": multiple,
            "polarity": polarity,
            "height": height,
            "min_width_x": min_width_x,
            "min_distance_x": min_distance_x,
            "threshold": threshold,
            "refine": refine,
        },
        "resolved": {"noise_sigma_estimate": sigma, "median_step_x": sp["median"], "samples_per_x": 1.0 / sp["median"]},
        "input": _io(parent, flipped),
        "peaks": peaks,
        "peak_count": len(peaks),
        "warnings": warnings,
        "authority": "DERIVED_NOT_RAW",
        "deterministic": True,
        "environment": environment(),
    }
