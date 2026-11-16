"""Retrievable text for experimental spectrum records; the authority of each record stays explicit."""
# ruff: noqa: E501  (long human-readable lines)

from __future__ import annotations


def spectrum_chunk_text(spectrum: dict[str, object], point_count: int, state: str) -> str:
    """Retrievable description of an experimental spectrum record that keeps its authority explicit."""
    kind = str(spectrum.get("kind"))
    x, y = spectrum.get("x") or {}, spectrum.get("y") or {}
    technique = {"IR": "IR/FTIR", "RAMAN": "Raman", "UVVIS": "UV/Vis"}.get(str(spectrum.get("technique")), str(spectrum.get("technique")))
    authority = {
        "RAW": "raw measured data exactly as supplied, never edited",
        "TRANSFORM": "a derived version made by a recorded deterministic transform; not raw data",
        "PEAKS": "peaks detected by an algorithm with recorded parameters; derived, not raw data",
    }.get(kind, kind)
    transform = spectrum.get("transform") or spectrum.get("peaks") or {}
    steps = f"; {transform.get('op', 'peak detection')} by {transform.get('library')} {transform.get('library_version')}" if transform else ""
    return (
        f"Experimental {technique} spectrum '{spectrum.get('name')}': {authority}{steps}; "
        f"x unit {x.get('unit')} ({x.get('unit_evidence')}), signal {y.get('quantity')} in {y.get('unit')} ({y.get('unit_evidence')}); "
        f"{point_count} {'peaks' if kind == 'PEAKS' else 'points'}; state {state}; representation {spectrum.get('representation')}."
    )
