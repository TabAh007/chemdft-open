"""Deterministic AI context for experimental spectra.

No model writes any of this. The lines are rendered from stored records (dataset, processing version, detected peaks, comparison
and its candidate pairs) so an answer can only restate what ChemDFT recorded. Every comparison line carries the standing
caveats: candidate matches by position, not assignments; gated errors are not a quality score; experimental peaks have no
displacement vectors.
"""
# ruff: noqa: E501, RUF001  (long human-readable lines and scientific symbols)

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..contracts.experimental_spectra import SpectrumComparisonView, SpectrumDatasetView

MAX_PEAK_LINES = 12
MAX_PAIR_LINES = 16
_X_UNIT = {"cm^-1": "cm⁻¹", "um": "µm", "nm": "nm", "eV": "eV"}
_TECHNIQUE = {"IR": "IR/FTIR", "RAMAN": "Raman", "UVVIS": "UV/Vis"}
_EVIDENCE = {
    "EXPLICIT_UNIT": "unit written in the file",
    "USER_CONFIRMED": "unit confirmed by the user",
    "QUANTITY_NAME": "quantity named, unit not written",
    "HINT_ONLY": "suggestion only",
    "NONE": "not identified",
}


def _supplied(value: Any) -> str:
    if value is None or value.status.value == "NOT_SUPPLIED":
        return "not supplied"
    shown = value.as_written if value.value is None else value.value
    return f"{shown} ({'as reported in the file' if value.status.value == 'AS_REPORTED_IN_FILE' else 'entered by the user'})"


def _params(rows: Any) -> str:
    return ", ".join(f"{row.key}={row.value}" for row in rows if row.value is not None and not row.key.startswith("advisory.")) or "none"


def _unit(code: str) -> str:
    return _X_UNIT.get(code, code)


def dataset_record(view: SpectrumDatasetView) -> dict[str, object]:
    """The `datasets` entry shape the project context already uses (values stay in artifacts, not in the prompt)."""
    return {
        "id": str(view.id),
        "name": view.name,
        "modality": str(view.modality.value),
        "state": view.state.value,
        "point_count": view.point_count,
        "source_class": view.source_class.value,
        "axes": [view.x.definition.model_dump(mode="json"), view.y.definition.model_dump(mode="json")],
        "values": [],
        "digitization_session": None,
        "spectrum": {"kind": view.kind.value, "technique": view.technique.value, "authority": view.authority.value, "parent_dataset_id": str(view.parent_dataset_id) if view.parent_dataset_id else None},
    }


def spectrum_lines(datasets: list[SpectrumDatasetView], comparisons: list[SpectrumComparisonView]) -> list[str]:
    roots = [d for d in datasets if d.kind.value == "RAW"]
    lines = [f"Experimental spectra ({len(roots)} raw measurement(s), {len(datasets) - len(roots)} derived record(s), {len(comparisons)} comparison(s)):"]
    if not datasets:
        return [*lines, "No experimental spectra imported yet."]
    lines.append(
        "Raw spectra are measured data stored exactly as supplied and are never edited; every processing step is a NEW derived version "
        "with its parent, parameters, library versions and hashes; detected peaks are algorithm output (DERIVED, NOT RAW). "
        "Do not treat a derived version, a normalized spectrum or a peak list as a raw measurement."
    )
    by_parent: dict[str, list[SpectrumDatasetView]] = {}
    for item in datasets:
        if item.parent_dataset_id:
            by_parent.setdefault(str(item.parent_dataset_id), []).append(item)
    for root in roots:
        x_unit = _unit(root.x.definition.unit.code)
        lines.append(
            f"- Spectrum '{root.name}' [P {root.id}] · {_TECHNIQUE[root.technique.value]} · x {root.x.definition.label} in {x_unit} ({_EVIDENCE[root.x.unit_evidence.value]}); "
            f"signal {root.y.definition.label} in {root.y.definition.unit.code} ({_EVIDENCE[root.y.unit_evidence.value]}); {root.point_count} points over {root.x_min}–{root.x_max} {x_unit}; "
            f"stored in file order ({root.x_order.lower()}); RAW EXPERIMENTAL"
            + (f"; source SHA-256 {root.source.sha256}" if root.source else "")
        )
        a = root.acquisition
        if a is not None:
            fields = [("sample phase", a.phase), ("laser wavelength (nm)", a.excitation_wavelength_nm if root.technique.value == "RAMAN" else None), ("resolution (cm⁻¹)", a.resolution_cm1 if root.technique.value == "IR" else None), ("path length (cm)", a.path_length_cm)]
            lines.append("  Metadata: " + "; ".join(f"{label} {_supplied(value)}" for label, value in fields if value is not None or label == "sample phase") + f"; instrument {_supplied(root.instrument)}; sample {_supplied(root.sample)}")
        assoc = root.association
        lines.append("  Association: " + {"UNASSIGNED": "not associated with a molecule or sample", "ASSOCIATED_WITH_STRUCTURE": f"structure {assoc.structure_name or assoc.structure_id}", "ASSOCIATED_WITH_SAMPLE": f"sample '{assoc.sample_label}'"}[assoc.state.value])

        def walk(parent: SpectrumDatasetView, depth: int, x_unit: str = x_unit) -> None:
            for child in by_parent.get(str(parent.id), []):
                indent = "  " * (depth + 1)
                if child.kind.value == "PEAKS" and child.peak_set is not None:
                    peaks = sorted(child.peak_set.peaks, key=lambda p: -p.prominence)[:MAX_PEAK_LINES]
                    shown = "; ".join(f"{p.x:.2f} {x_unit} (height {p.y:.3g}, FWHM {p.fwhm_x:.3g}, prominence {p.prominence:.3g})" for p in peaks)
                    lines.append(f"{indent}Peaks on '{parent.name}' [P {child.id}]: {child.peak_set.peak_count} detected by {child.peak_set.library} {child.peak_set.library_version} (DERIVED, NOT RAW; {_params(child.peak_set.parameters)}); strongest by prominence: {shown or 'none'}")
                elif child.transform is not None:
                    lines.append(f"{indent}Version [P {child.id}] '{child.name}' · {child.transform.op} by {child.transform.library} {child.transform.library_version} (DERIVED from '{parent.name}'; parameters {_params(child.transform.parameters)}; internal values {_params(child.transform.resolved)}); state {child.state.value}"
                                 + (f"; WARNINGS: {'; '.join(w.code for w in child.transform.warnings)}" if child.transform.warnings else "")
                                 + ("; RELATIVE (normalized), not a measured intensity" if child.representation == "RELATIVE" else ""))
                walk(child, depth + 1, x_unit)

        walk(root, 0)
    for comparison in comparisons:
        unit = _unit(comparison.axis)
        m = comparison.metrics
        lines.append(
            f"- Comparison [C {comparison.id}] of '{comparison.experimental_dataset_name}' with {comparison.calculated.label} ({'IMPORTED' if comparison.calculated.kind.value == 'IMPORTED_RESULT' else 'calculated by ChemDFT'}; {comparison.calculated.phase.lower()} phase) · "
            f"{comparison.method} within ±{comparison.tolerance} {unit} · {'unscaled' if comparison.scaling.mode == 'UNSCALED' else f'scale factor {comparison.scaling.factor} entered by the user'}: "
            f"{m.matched} of {m.experimental_peaks} experimental peaks and {m.matched} of {m.calculated_considered} considered calculated items have a candidate; "
            f"{m.unmatched_experimental} experimental and {m.unmatched_calculated} calculated items are unmatched; {m.ambiguous_pairs} ambiguous; "
            f"signed bias {_num(m.signed_bias)} {unit}, MAE {_num(m.mae)} {unit}, RMSE {_num(m.rmse)} {unit} (matched pairs only; bounded by the tolerance, so they say nothing about unmatched items)"
        )
        for pair in comparison.pairs[:MAX_PAIR_LINES]:
            lines.append(f"    CANDIDATE: calculated item {pair.calculated_index + 1} at {pair.calculated_position:.4g} {unit} ↔ experimental peak at {pair.experimental_position:.4g} {unit} (Δ {pair.delta:+.3g}; {pair.status})")
        for band in comparison.bands:
            lines.append(f"    Band {band.lo_nm}–{band.hi_nm} nm: calculated f sum {band.f_calculated_sum:.3g}; experimental f " + (f"{band.experimental.f:.3g}" if band.experimental else "not available") + " (integrated over a linear wavenumber axis)")
        for note in comparison.diagnostics:
            if note.severity != "info":
                lines.append(f"    {note.severity.upper()}: {note.code} — {note.message}")
        lines.append("    These are candidate matches by position, not assignments. Experimental peaks do not contain displacement vectors; the 3D animation shows the calculated normal mode only. Never state that a peak 'is' a particular mode, and never describe a candidate as a definitive match.")
    return lines


def _num(value: float | None) -> str:
    return "n/a" if value is None else f"{value:+.3g}"


def referenced_entities(datasets: list[SpectrumDatasetView]) -> list[Mapping[str, str]]:
    return [{"entity_type": "experimental_dataset", "entity_id": str(item.id)} for item in datasets]
