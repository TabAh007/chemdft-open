"""Resolve an uploaded text file plus the user's choices into a deterministic, hash-bound preview.

`resolve_preview` is a pure function of (bytes, technique, choices): the same inputs always yield the same body and the
same SHA-256. The API calls it once at upload and again at confirmation; the confirmation must quote the hash the user saw.
Nothing here writes anything: it only describes what a commit WOULD store.

Commit policy (never weakened):
  * both axes need unit evidence that is EXPLICIT_UNIT (written in the file) or USER_CONFIRMED;
  * a value-range or file-name hint is only a suggestion;
  * metadata is AS_REPORTED_IN_FILE, USER_ENTERED or NOT_SUPPLIED, never inferred;
  * duplicate x, non-monotonic x, NaN/Inf rows and too-few points are refused, not repaired.
"""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

from __future__ import annotations

import re
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import numpy as np

from . import PARSER_NAME, PARSER_VERSION, SCHEMA_PREVIEW, SCHEMA_VERSION, WORKER_VERSION
from .canonical import array_bytes, array_sha256, body_sha256, sha256_hex
from .textio import (
    MIN_POINTS,
    Analysis,
    analyze_text_spectrum,
    recognised_metadata,
)
from .units import (
    ALLOWED_X_UNITS,
    ALLOWED_Y,
    TECHNIQUES,
    X_QUANTITY_FOR_UNIT,
    EvidenceLevel,
    UnitGuess,
    guess_x_unit,
    guess_y_unit,
    range_hint_x,
    unit_allowed,
    y_allowed,
)

DISPLAY_BUCKETS = 2000
PHASES = ("GAS", "LIQUID", "SOLUTION", "SOLID", "OTHER")
ACQUISITION_FIELDS: dict[str, tuple[tuple[str, str], ...]] = {
    # (field, kind) where kind is number | integer | text | phase | sampling
    "IR": (("sampling_mode", "sampling"), ("path_length_cm", "number"), ("resolution_cm1", "number"), ("phase", "phase")),
    "RAMAN": (
        ("excitation_wavelength_nm", "number"),
        ("integration_time_s", "number"),
        ("accumulations", "integer"),
        ("polarization", "text"),
        ("phase", "phase"),
    ),
    "UVVIS": (("path_length_cm", "number"), ("concentration", "text"), ("solvent", "text"), ("bandwidth_nm", "number"), ("phase", "phase")),
}
SAMPLING_MODES = ("TRANSMISSION", "ATR", "GAS_CELL", "DRIFTS", "OTHER")
_FILE_KEYS = {
    "excitation_wavelength_nm": "excitation_wavelength_nm",
    "integration_time_s": "integration_time_s",
    "accumulations": "accumulations",
    "resolution_cm1": "resolution_cm1",
    "path_length_cm": "path_length_cm",
}
_PHASE_WORDS = {
    "GAS": re.compile(r"\b(gas|vapou?r)\b", re.I),
    "LIQUID": re.compile(r"\b(liquid|neat)\b", re.I),
    "SOLUTION": re.compile(r"\b(solution|aqueous|dissolved)\b", re.I),
    "SOLID": re.compile(r"\b(solid|powder|film|pellet|kbr)\b", re.I),
}


@dataclass
class Arrays:
    x: np.ndarray
    y: np.ndarray
    y_error: np.ndarray | None

    def artifact_bytes(self) -> bytes:
        """x, then y, then (optional) y_error; float64 little-endian. The artifact the API stores and later re-hashes."""
        parts = [array_bytes(self.x), array_bytes(self.y)]
        if self.y_error is not None:
            parts.append(array_bytes(self.y_error))
        return b"".join(parts)


@dataclass
class Preview:
    body: dict[str, Any]
    preview_sha256: str
    arrays: Arrays | None


def _diag(code: str, severity: str, message: str, line: int | None = None) -> dict[str, Any]:
    return {"code": code, "severity": severity, "message": message, "line": line}


def _decimate(x: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    """Deterministic min/max bucket decimation for DISPLAY only (the stored arrays are never decimated)."""
    n = len(x)
    if n <= DISPLAY_BUCKETS * 2:
        return {"x": x.tolist(), "y": y.tolist(), "decimated": False, "source_points": n, "buckets": None}
    edges = np.linspace(0, n, DISPLAY_BUCKETS + 1).astype(int)
    xs: list[float] = []
    ys: list[float] = []
    for lo, hi in pairwise(edges):
        if hi <= lo:
            continue
        seg = y[lo:hi]
        i_min, i_max = int(np.argmin(seg)) + lo, int(np.argmax(seg)) + lo
        for i in sorted({i_min, i_max}):
            xs.append(float(x[i]))
            ys.append(float(y[i]))
    return {"x": xs, "y": ys, "decimated": True, "source_points": n, "buckets": DISPLAY_BUCKETS}


def _guess_label(analysis: Analysis, index: int) -> str | None:
    labels = analysis.column_labels or []
    return labels[index] if index < len(labels) else None


def _free_text_field(name: str, choices: dict[str, Any], recognised: dict[str, dict[str, Any]]) -> dict[str, Any]:
    entered = str(choices.get(name) or "").strip()[:200]
    if entered:
        return _supplied("USER_ENTERED", entered, entered)
    found = recognised.get(name)
    if found:
        return _supplied("AS_REPORTED_IN_FILE", found["as_reported"][:200], found["as_reported"], found["line"])
    return _supplied("NOT_SUPPLIED")


def _supplied(status: str, value: Any = None, as_written: str | None = None, line: int | None = None, file_reported: str | None = None) -> dict[str, Any]:
    return {"status": status, "value": value, "as_written": as_written, "line": line, "file_reported": file_reported}


def _phase_from_text(text: str) -> str | None:
    hits = [name for name, pattern in _PHASE_WORDS.items() if pattern.search(text)]
    return hits[0] if len(hits) == 1 else None


def _build_acquisition(technique: str, analysis: Analysis, user: dict[str, Any], diagnostics: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    recognised = recognised_metadata(analysis.metadata)
    acquisition: dict[str, dict[str, Any]] = {}
    for name, kind in ACQUISITION_FIELDS[technique]:
        entered = user.get(name)
        reported = recognised.get(_FILE_KEYS.get(name, ""))
        file_text = reported["as_reported"] if reported else None
        if entered not in (None, ""):
            value = _coerce(name, kind, entered, diagnostics)
            if value is not None:
                acquisition[name] = _supplied("USER_ENTERED", value, str(entered), None, file_text)
                continue
        if reported is not None and kind in ("number", "integer") and reported.get("number") is not None:
            number = float(reported["number"])
            acquisition[name] = _supplied("AS_REPORTED_IN_FILE", int(number) if kind == "integer" else number, reported["as_reported"], reported["line"])
            continue
        if name == "phase":
            text = next((m.value for m in analysis.metadata if re.search(r"\b(phase|state|sample\s*state)\b", m.key, re.I)), None)
            if text:
                phase = _phase_from_text(text)
                if phase:
                    line = next(m.line for m in analysis.metadata if m.value == text)
                    acquisition[name] = _supplied("AS_REPORTED_IN_FILE", phase, text, line)
                    continue
                diagnostics.append(_diag("PHASE_TEXT_AMBIGUOUS", "warning", f'the file mentions a phase/state ("{text}") that does not map to exactly one class; enter it explicitly'))
        acquisition[name] = _supplied("NOT_SUPPLIED")
    return acquisition


def _coerce(name: str, kind: str, raw: Any, diagnostics: list[dict[str, Any]]) -> Any:
    try:
        if kind == "number":
            number = float(raw)
            if not np.isfinite(number) or number <= 0:
                raise ValueError
            return number
        if kind == "integer":
            number = int(raw)
            if number <= 0:
                raise ValueError
            return number
        if kind == "phase":
            value = str(raw).upper()
            if value not in PHASES:
                raise ValueError
            return value
        if kind == "sampling":
            value = str(raw).upper()
            if value not in SAMPLING_MODES:
                raise ValueError
            return value
        text = str(raw).strip()
        return text[:200] if text else None
    except (TypeError, ValueError):
        diagnostics.append(_diag("USER_METADATA_INVALID", "warning", f"the value entered for {name} was not valid and was ignored"))
        return None


def _rejected(raw: bytes, technique: str, analysis: Analysis, diagnostics: list[dict[str, Any]]) -> Preview:
    body = {
        "schema": SCHEMA_PREVIEW,
        "schema_version": SCHEMA_VERSION,
        "worker_version": WORKER_VERSION,
        "technique": technique,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "source": _source(analysis, raw),
        "status": "REJECTED",
        "needs": [],
        "columns": [],
        "choice": None,
        "x": None,
        "y": None,
        "y_error": None,
        "proposals": {"x": None, "y": None},
        "point_count": 0,
        "display": None,
        "arrays": None,
        "metadata_verbatim": [],
        "acquisition": {},
        "instrument": _supplied("NOT_SUPPLIED"),
        "sample": _supplied("NOT_SUPPLIED"),
        "display_name": None,
        "diagnostics": diagnostics,
    }
    return Preview(body, body_sha256(body), None)


def _source(analysis: Analysis, raw: bytes) -> dict[str, Any]:
    return {
        "sha256": analysis.file_sha256 or sha256_hex(raw),
        "size_bytes": analysis.size_bytes,
        "encoding": analysis.encoding if analysis.delimiter else None,
        "newline": analysis.newline if analysis.delimiter else None,
        "delimiter": analysis.delimiter,
        "decimal": analysis.decimal,
        "orientation": analysis.orientation if analysis.delimiter else None,
        "first_data_line": analysis.first_data_line,
        "last_data_line": analysis.last_data_line,
        "header_line_count": len(analysis.header_lines),
    }


def _proposal_dict(guess: UnitGuess) -> dict[str, Any]:
    return {"quantity": guess.quantity, "unit": guess.unit, "level": guess.level.value, "evidence": guess.evidence}


def _metadata_unit_guess(analysis: Analysis, key: str) -> str | None:
    meta = {re.sub(r"[\s_\-]", "", m.key).lower(): m.value for m in analysis.metadata}
    return meta.get(key)


def resolve_preview(raw: bytes, technique: str, choices: dict[str, Any] | None = None) -> Preview:
    choices = dict(choices or {})
    diagnostics: list[dict[str, Any]] = []
    analysis = analyze_text_spectrum(raw)
    for issue in analysis.issues:
        diagnostics.append(_diag(issue.code, "error" if issue.severity == "ERROR" else issue.severity.lower(), issue.message, issue.line))
    if technique not in TECHNIQUES:
        diagnostics.append(_diag("TECHNIQUE_NOT_SUPPORTED", "error", f"technique {technique!r} is not supported; choose IR, RAMAN or UVVIS"))
        return _rejected(raw, technique, analysis, diagnostics)
    if analysis.errors or not analysis.columns:
        return _rejected(raw, technique, analysis, diagnostics)

    needs: list[str] = []
    n_cols = len(analysis.columns)
    columns = []
    for index, column in enumerate(analysis.columns):
        finite = column[np.isfinite(column)]
        columns.append(
            {
                "index": index,
                "label": _guess_label(analysis, index),
                "count": len(column),
                "invalid_count": int(len(column) - len(finite)),
                "min": float(finite.min()) if len(finite) else None,
                "max": float(finite.max()) if len(finite) else None,
            }
        )

    # --- column roles: with exactly two columns they are x and y; with more, a person must say which is which
    x_index = choices.get("x_index")
    y_index = choices.get("y_index")
    y_error_index = choices.get("y_error_index")
    if n_cols == 2:
        x_index = 0 if x_index is None else x_index
        y_index = 1 if y_index is None else y_index
    if n_cols > 2 and (x_index is None or y_index is None):
        needs.append("column_roles")
        x_index = 0 if x_index is None else x_index
        y_index = 1 if y_index is None else y_index  # used only to draw a provisional preview
    for name, value in (("x_index", x_index), ("y_index", y_index), ("y_error_index", y_error_index)):
        if value is not None and not (isinstance(value, int) and 0 <= value < n_cols):
            diagnostics.append(_diag("COLUMN_OUT_OF_RANGE", "error", f"{name} refers to a column that does not exist"))
            return _rejected(raw, technique, analysis, diagnostics)
    if x_index == y_index:
        diagnostics.append(_diag("COLUMN_ROLES_INVALID", "error", "x and y must be different columns"))
        return _rejected(raw, technique, analysis, diagnostics)

    # --- unit evidence
    x_label, y_label = _guess_label(analysis, x_index), _guess_label(analysis, y_index)
    x_guess, y_guess = guess_x_unit(x_label), guess_y_unit(y_label)
    xmeta = _metadata_unit_guess(analysis, "xunits")
    ymeta = _metadata_unit_guess(analysis, "yunits")
    if x_guess.level is EvidenceLevel.NONE and xmeta:
        g = guess_x_unit(xmeta)
        x_guess = UnitGuess(g.quantity, g.unit, g.level, f'header metadata XUNITS = "{xmeta}"') if g.level is EvidenceLevel.EXPLICIT_UNIT else g
    if y_guess.level is EvidenceLevel.NONE and ymeta:
        g = guess_y_unit(ymeta)
        y_guess = UnitGuess(g.quantity, g.unit, g.level, f'header metadata YUNITS = "{ymeta}"') if g.level is EvidenceLevel.EXPLICIT_UNIT else g
    if x_guess.level is EvidenceLevel.NONE:
        x_guess = range_hint_x(analysis.columns[x_index], technique)

    chosen_x, chosen_yq, chosen_yu = choices.get("x_unit"), choices.get("y_quantity"), choices.get("y_unit")
    if chosen_x:
        x_unit, x_level = chosen_x, EvidenceLevel.USER_CONFIRMED
        x_text = "confirmed by the user in the import preview"
        if x_guess.level is EvidenceLevel.EXPLICIT_UNIT and x_guess.unit != chosen_x:
            diagnostics.append(_diag("UNIT_OVERRIDES_FILE", "warning", f"the file says {x_guess.unit} but {chosen_x} was confirmed; the file label is kept in provenance"))
    else:
        x_unit, x_level, x_text = x_guess.unit, x_guess.level, x_guess.evidence
    if chosen_yq or chosen_yu:
        y_quantity = chosen_yq or y_guess.quantity
        y_unit = chosen_yu or (y_guess.unit if y_guess.quantity == y_quantity else None)
        y_level, y_text = EvidenceLevel.USER_CONFIRMED, "confirmed by the user in the import preview"
        if y_guess.level is EvidenceLevel.EXPLICIT_UNIT and (y_guess.quantity, y_guess.unit) != (y_quantity, y_unit):
            diagnostics.append(_diag("UNIT_OVERRIDES_FILE", "warning", f"the file says {y_guess.quantity} ({y_guess.unit}) but {y_quantity} ({y_unit}) was confirmed"))
    else:
        y_quantity, y_unit, y_level, y_text = y_guess.quantity, y_guess.unit, y_guess.level, y_guess.evidence

    x_ok = x_level.accepted and x_unit is not None
    if x_ok and not unit_allowed(technique, x_unit):
        diagnostics.append(_diag("X_UNIT_NOT_SUPPORTED_FOR_TECHNIQUE", "error", f"{x_unit} is not a supported axis unit for {technique} in V1 (allowed: {', '.join(ALLOWED_X_UNITS[technique])}); choose another technique or unit"))
        return _rejected_with_columns(raw, technique, analysis, diagnostics, columns, x_guess, y_guess)
    if not x_ok:
        needs.append("x_unit")
    y_ok = y_level.accepted and y_quantity is not None and y_unit is not None
    if y_level.accepted and y_quantity is not None and y_unit is None:
        needs.append("y_transmittance_scale" if y_quantity == "TRANSMITTANCE" else "y_quantity_and_unit")
    elif not y_ok:
        needs.append("y_quantity_and_unit")
    elif not y_allowed(technique, y_quantity, y_unit):
        allowed = "; ".join(f"{q}: {', '.join(u)}" for q, u in ALLOWED_Y[technique].items())
        diagnostics.append(_diag("Y_QUANTITY_NOT_SUPPORTED_FOR_TECHNIQUE", "error", f"{y_quantity} ({y_unit}) is not supported for {technique} in V1 (allowed: {allowed})"))
        return _rejected_with_columns(raw, technique, analysis, diagnostics, columns, x_guess, y_guess)

    # --- series validation (never repaired)
    x_all = analysis.columns[x_index].copy()
    y_all = analysis.columns[y_index].copy()
    err_all = analysis.columns[y_error_index].copy() if y_error_index is not None else None
    first_line = analysis.first_data_line or 1
    line_numbers = np.arange(first_line, first_line + len(x_all))
    if analysis.orientation == "ROWS":
        line_numbers = np.arange(1, len(x_all) + 1)
    bad = ~np.isfinite(x_all) | ~np.isfinite(y_all)
    excluded: list[int] = []
    exclude_rows = bool(choices.get("exclude_invalid_rows", False))
    if bad.any():
        if not exclude_rows:
            diagnostics.append(_diag("INVALID_VALUES_IN_SERIES", "error", f"{int(bad.sum())} rows contain NaN/Inf/placeholder values (first at line {int(line_numbers[bad][0])}); choose 'exclude invalid rows' to drop them explicitly", int(line_numbers[bad][0])))
            return _rejected_with_columns(raw, technique, analysis, diagnostics, columns, x_guess, y_guess)
        excluded = [int(v) for v in line_numbers[bad][:100]]
        x_all, y_all, line_numbers = x_all[~bad], y_all[~bad], line_numbers[~bad]
        err_all = err_all[~bad] if err_all is not None else None
        diagnostics.append(_diag("ROWS_EXCLUDED", "warning", f"{int(bad.sum())} invalid rows excluded by explicit choice (first lines: {excluded[:10]})"))
    if len(x_all) < MIN_POINTS:
        diagnostics.append(_diag("TOO_FEW_POINTS", "error", f"{len(x_all)} points; at least {MIN_POINTS} are required"))
        return _rejected_with_columns(raw, technique, analysis, diagnostics, columns, x_guess, y_guess)
    dx = np.diff(x_all)
    if (dx == 0).any():
        first = int(np.flatnonzero(dx == 0)[0])
        diagnostics.append(_diag("DUPLICATE_X", "error", f"{int((dx == 0).sum())} repeated x values (first at line {int(line_numbers[first + 1])}); averaging duplicates would be a transform, so it is refused at import", int(line_numbers[first + 1])))
        return _rejected_with_columns(raw, technique, analysis, diagnostics, columns, x_guess, y_guess)
    if not ((dx > 0).all() or (dx < 0).all()):
        sign = np.sign(dx[np.flatnonzero(dx != 0)[0]])
        first = int(np.flatnonzero(np.sign(dx) != sign)[0])
        diagnostics.append(_diag("NON_MONOTONIC_X", "error", f"x is not monotonic (first reversal at line {int(line_numbers[first + 1])}); sorting would be a transform, so it is refused at import", int(line_numbers[first + 1])))
        return _rejected_with_columns(raw, technique, analysis, diagnostics, columns, x_guess, y_guess)
    direction = "ASCENDING" if dx[0] > 0 else "DESCENDING"
    step = np.abs(dx)
    spacing = {
        "count": len(x_all),
        "median": float(np.median(step)),
        "min": float(step.min()),
        "max": float(step.max()),
        "relative_variation": float((step.max() - step.min()) / np.median(step)),
        "uniform": bool((step.max() - step.min()) <= 1e-3 * np.median(step)),
    }
    if not spacing["uniform"]:
        diagnostics.append(_diag("NON_UNIFORM_SPACING", "warning", f"x spacing varies by {spacing['relative_variation']:.1%}; smoothing needs a uniform grid, so resample first or accept a position-dependent window"))
    if y_all.min() < 0 and y_quantity in ("ABSORBANCE", "INTENSITY", "CROSS_SECTION", "MOLAR_ABSORPTIVITY"):
        diagnostics.append(_diag("NEGATIVE_SIGNAL", "info", "negative signal values are present (noise/baseline); they are kept exactly as measured"))
    if y_quantity == "TRANSMITTANCE" and y_unit == "percent" and y_all.max() <= 1.5:
        diagnostics.append(_diag("TRANSMITTANCE_SCALE_SUSPECT", "warning", "stated as percent but every value is <= 1.5; confirm the scale"))
    if y_quantity == "TRANSMITTANCE" and y_unit == "fraction" and y_all.max() > 1.5:
        diagnostics.append(_diag("TRANSMITTANCE_SCALE_SUSPECT", "warning", "stated as fraction but values exceed 1.5; confirm the scale"))

    x_unit_final = x_unit if x_ok else None
    arrays = Arrays(x_all, y_all, err_all)
    metadata_verbatim = [{"key": m.key[:120], "value": m.value[:1000], "line": m.line} for m in analysis.metadata[:100]]
    recognised = recognised_metadata(analysis.metadata)
    acquisition = _build_acquisition(technique, analysis, dict(choices.get("metadata") or {}), diagnostics)
    instrument = _free_text_field("instrument", choices, recognised)
    sample = _free_text_field("sample", choices, recognised)

    status = "READY" if not needs else "NEEDS_CONFIRMATION"
    arrays_block = {
        "layout": "float64-le: x, y" + (", y_error" if err_all is not None else ""),
        "x_sha256": array_sha256(x_all),
        "y_sha256": array_sha256(y_all),
        "y_error_sha256": array_sha256(err_all) if err_all is not None else None,
        "artifact_sha256": sha256_hex(arrays.artifact_bytes()),
    }
    body: dict[str, Any] = {
        "schema": SCHEMA_PREVIEW,
        "schema_version": SCHEMA_VERSION,
        "worker_version": WORKER_VERSION,
        "technique": technique,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "source": _source(analysis, raw),
        "status": status,
        "needs": sorted(set(needs)),
        "columns": columns,
        "choice": {
            "x_index": x_index,
            "y_index": y_index,
            "y_error_index": y_error_index,
            "x_unit": x_unit_final,
            "y_quantity": y_quantity if y_ok else None,
            "y_unit": y_unit if y_ok else None,
            "exclude_invalid_rows": exclude_rows,
            "excluded_lines": excluded,
        },
        "x": {
            "unit": x_unit_final,
            "quantity": X_QUANTITY_FOR_UNIT.get(x_unit_final or "", None),
            "unit_evidence": x_level.value if x_unit is not None else "NONE",
            "unit_evidence_text": x_text,
            "direction_in_file": direction,
            "label_in_file": x_label,
            "spacing": spacing,
            "min": float(x_all.min()),
            "max": float(x_all.max()),
            "sha256": arrays_block["x_sha256"],
        },
        "y": {
            "quantity": y_quantity if y_ok else None,
            "unit": y_unit if y_ok else None,
            "unit_evidence": y_level.value if y_quantity is not None else "NONE",
            "unit_evidence_text": y_text,
            "label_in_file": y_label,
            "min": float(y_all.min()),
            "max": float(y_all.max()),
            "sha256": arrays_block["y_sha256"],
        },
        "y_error": ({"column": y_error_index, "unit": y_unit, "sha256": arrays_block["y_error_sha256"]} if err_all is not None else None),
        "proposals": {"x": _proposal_dict(x_guess), "y": _proposal_dict(y_guess)},
        "point_count": len(x_all),
        "display": _decimate(x_all, y_all),
        "arrays": arrays_block,
        "metadata_verbatim": metadata_verbatim,
        "acquisition": acquisition,
        "instrument": instrument,
        "sample": sample,
        "display_name": str(choices["display_name"])[:160] if choices.get("display_name") else None,
        "diagnostics": diagnostics,
    }
    return Preview(body, body_sha256(body), arrays)


def _rejected_with_columns(raw: bytes, technique: str, analysis: Analysis, diagnostics: list[dict[str, Any]], columns: list[dict[str, Any]], x_guess: UnitGuess, y_guess: UnitGuess) -> Preview:
    preview = _rejected(raw, technique, analysis, diagnostics)
    preview.body["columns"] = columns
    preview.body["proposals"] = {"x": _proposal_dict(x_guess), "y": _proposal_dict(y_guess)}
    preview.preview_sha256 = body_sha256(preview.body)
    return preview
