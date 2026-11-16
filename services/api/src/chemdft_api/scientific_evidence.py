from __future__ import annotations

from collections.abc import Mapping


def format_scientific_evidence(payload: object) -> str:
    """Render extracted scientific payloads as readable, source-searchable text."""
    if not isinstance(payload, Mapping):
        return str(payload)

    snippet = payload.get("snippet")
    value = payload.get("reported_value")
    unit = str(payload.get("reported_unit") or "")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = f"{value:g}"
        unit = {"angstrom": "Å", "Å": "Å", "A": "Å", "degree": "°", "deg": "°"}.get(unit, unit)
        if payload.get("quantity") in {"2theta", "2θ"}:
            return f"Reported X-ray diffraction peak position: {number}{unit or '°'} (2θ)."
        parameter = payload.get("parameter")
        if parameter:
            return f"Reported {parameter} value: {number}{unit}."
        label = payload.get("quantity") or "scientific measurement"
        return f"Reported {label}: {number}{unit}."

    if isinstance(snippet, str) and snippet.strip():
        return snippet.strip()

    parts = [f"{key}: {value}" for key, value in payload.items() if value is not None]
    return "; ".join(parts)
