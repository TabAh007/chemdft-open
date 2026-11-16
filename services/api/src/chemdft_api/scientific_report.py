# ruff: noqa: E501  (HTML/Markdown rendering templates)
"""Evidence-backed scientific reports (HTML, Markdown, JSON) built from stored records only.

A report is generated at request time from the live records: authorization, effective scientific
state and comparison rules are evaluated *now* and stamped with `generated_at`. Nothing is taken
from a saved comparison snapshot as current. Every value is copied from a stored result or
specification; no value, spectrum, geometry or citation is invented, and a section is omitted
(with the reason listed under limitations) when the stored evidence does not support it.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from html import escape
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import portable_export_policy as portable_policy
from . import report_charts
from .actions import authorize_project_access
from .calculation_comparison import compare_results
from .calculation_summary import hill_formula, summarize_result, version_atoms
from .context import Identity
from .contracts.analysis import ResultSummary
from .errors import ScientificReferenceNotFound, ScientificValidationFailed
from .saved_comparisons import open_saved_comparison
from .scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    OptimizationTrajectoryRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)

REPORT_SCHEMA = "chemdft.scientific-report.v1"
MAX_RESULTS = 8
MAX_ATOMS_LISTED = 80

_TASK = {
    "ENERGY": "Single-point energy",
    "GEOMETRY_OPTIMIZATION": "Geometry optimization",
    "FREQUENCY": "Vibrational frequencies",
    "ORBITAL": "Molecular orbitals",
    "TDDFT": "TDDFT excited states",
    "THERMOCHEMISTRY": "Thermochemistry",
    "CONFORMER_SEARCH": "Conformer search",
}
_VERIFICATION = {
    "UNVERIFIED": "Not independently verified. Validation means the platform's checks passed; "
    "agreement with another calculation is not independent verification.",
    "VERIFIED": "Independently verified (as recorded).",
}


def sha256_json(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def standing(summary: ResultSummary) -> dict[str, Any]:
    """Plain, fail-closed statement of current standing (never stronger than the effective state)."""
    state = summary.effective_state
    if state is None:
        return {
            "evidence_use": "UNKNOWN",
            "headline": "Standing unknown — no current authority is claimed.",
            "authority": None,
            "validation_state": None,
            "verification_state": None,
            "source_lineage_validity": None,
            "verification_statement": "No verification state is available.",
            "stored": None,
        }
    current = state.eligible_for_derivation
    verification = state.verification_state
    return {
        "evidence_use": "CURRENT" if current else "HISTORICAL_ONLY",
        "headline": (
            "Current — authoritative and validated"
            if current and state.authority == "AUTHORITATIVE" and state.validation_state == "VALIDATED"
            else f"Historical evidence — source lineage {state.source_lineage_validity.lower()}; "
            "not current authority"
            if not current
            else f"Not presented as authoritative (authority {state.authority}, "
            f"validation {state.validation_state})"
        ),
        "authority": state.authority,
        "validation_state": state.validation_state,
        "verification_state": verification,
        "source_lineage_validity": state.source_lineage_validity,
        "verification_statement": _VERIFICATION.get(
            verification, f"Recorded verification state: {verification}."
        ),
        "stored": {
            "authority": state.stored_authority,
            "validation_state": state.stored_validation_state,
            "verification_state": state.stored_verification_state,
        },
    }


def _result_records(
    session: Session, project_id: str, result_ids: list[str]
) -> list[CalculationResultRecord]:
    if not 1 <= len(result_ids) <= MAX_RESULTS:
        raise ScientificValidationFailed(f"Select between 1 and {MAX_RESULTS} results.")
    if len(set(result_ids)) != len(result_ids):
        raise ScientificValidationFailed("A report cannot select the same result twice.")
    records = []
    for result_id in result_ids:
        try:
            UUID(result_id)
        except ValueError as error:
            raise ScientificReferenceNotFound("Result does not exist in this project.") from error
        record = session.scalar(
            select(CalculationResultRecord).where(
                CalculationResultRecord.id == result_id,
                CalculationResultRecord.project_id == project_id,
            )
        )
        if record is None:
            raise ScientificReferenceNotFound("Result does not exist in this project.")
        records.append(record)
    return records


def _spectral_points(record: CalculationResultRecord) -> list[dict[str, Any]]:
    """Stored stick data only: the same fields the spectrum exports read."""
    payload = record.payload_json or {}
    charts: list[dict[str, Any]] = []
    if record.result_type == "chemdft.vibrational-analysis":
        modes = [m for m in payload.get("modes") or [] if not m.get("imaginary")]
        ir = [
            (float(m["frequency_cm1"]), float(m["ir_intensity"]["value"]))
            for m in modes
            if isinstance(m.get("ir_intensity"), dict)
            and isinstance(m["ir_intensity"].get("value"), (int, float))
        ]
        if ir:
            charts.append(
                {
                    "kind": "ir-sticks",
                    "title": "Infrared stick spectrum (stored modes, no broadening)",
                    "x_label": "Frequency (cm⁻¹)",
                    "y_label": "IR intensity (km/mol)",
                    "points": ir,
                }
            )
    elif record.result_type == "chemdft.tddft":
        pts = [
            (float(s["energy_ev"]), float(s["oscillator_strength"]))
            for s in payload.get("excited_states") or []
            if isinstance(s.get("energy_ev"), (int, float))
            and isinstance(s.get("oscillator_strength"), (int, float))
        ]
        if pts:
            charts.append(
                {
                    "kind": "uvvis-sticks",
                    "title": "Excited-state stick spectrum (stored states, no broadening)",
                    "x_label": "Excitation energy (eV)",
                    "y_label": "Oscillator strength (1)",
                    "points": pts,
                }
            )
    return charts


def _registry_or_none(value: str | None) -> str | None:
    """Method/basis identifiers are exported only when they are in the reviewed registries."""
    return portable_policy.safe_enum(value, portable_policy.projector("payload").vocabulary)


def _dossier(session: Session, project_id: str, record: CalculationResultRecord) -> dict[str, Any]:
    summary = summarize_result(session, record)
    calculation = session.get(CalculationRecord, record.calculation_id)
    calc_input = session.scalar(
        select(CalculationInputRecord).where(
            CalculationInputRecord.id == record.calculation_input_id,
            CalculationInputRecord.project_id == project_id,
        )
    )
    version = (
        session.scalar(
            select(StructureVersionRecord).where(
                StructureVersionRecord.id == calc_input.structure_version_id,
                StructureVersionRecord.project_id == project_id,
            )
        )
        if calc_input
        else None
    )
    structure = session.get(StructureRecord, version.structure_id) if version else None
    atoms = version_atoms(version) if version else []
    provenance = session.scalar(
        select(ProvenanceRecordRow).where(
            ProvenanceRecordRow.id == record.provenance_record_id,
            ProvenanceRecordRow.project_id == project_id,
        )
    )
    artifact_ids = [str(r.get("artifact_id")) for r in record.raw_artifacts_json or []]
    artifacts = {
        a.id: a
        for a in session.scalars(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.project_id == project_id,
                ScientificArtifactRecord.id.in_(artifact_ids),
            )
        )
    } if artifact_ids else {}
    charts = _spectral_points(record)
    if record.result_type == "chemdft.optimization":
        trajectory = session.scalar(
            select(OptimizationTrajectoryRecord).where(
                OptimizationTrajectoryRecord.calculation_id == record.calculation_id,
                OptimizationTrajectoryRecord.project_id == project_id,
            )
        )
        pts = [
            (float(i), float(s["energy_hartree"]))
            for i, s in enumerate((trajectory.steps_json if trajectory else None) or [])
            if isinstance(s.get("energy_hartree"), (int, float))
        ]
        if len(pts) >= 2:
            charts.append(
                {
                    "kind": "optimization-energy",
                    "title": "Energy at each stored optimization geometry",
                    "x_label": "Geometry evaluation index",
                    "y_label": "Energy (Eh)",
                    "points": pts,
                }
            )
    # Raw stored metadata is never embedded: producer and specification go through the same
    # reviewed projections as the portable archive.
    omissions = portable_policy.Omissions()
    producer = portable_policy.projector("engine").project(
        record.producer_software_json, "engine", omissions
    )
    projected_spec = (
        portable_policy.projector("specification").project(
            calc_input.specification_json, "specification", omissions
        )
        if calc_input
        else None
    )
    return {
        "result_id": record.id,
        "calculation_id": record.calculation_id,
        "calculation_state": str(calculation.state) if calculation else None,
        "task": summary.task,
        "task_label": _TASK.get(summary.task, summary.task),
        "result_type": record.result_type,
        "created_at": record.created_at.isoformat(),
        "standing": standing(summary),
        "engine": {
            "name": (producer or {}).get("name") if isinstance(producer, dict) else None,
            "version": (producer or {}).get("version") if isinstance(producer, dict) else None,
            "producer": producer,
        },
        "specification": projected_spec,
        "level_of_theory": {
            "method": _registry_or_none(summary.method),
            "basis": _registry_or_none(summary.basis),
            "dispersion": summary.dispersion,
            "solvation": summary.solvation,
            "charge": summary.charge,
            "multiplicity": summary.multiplicity,
        },
        "structure": {
            "name": structure.name if structure else None,
            "structure_id": structure.id if structure else None,
            "structure_version_id": version.id if version else None,
            "revision": version.revision if version else None,
            "formula_hill": hill_formula([str(a["element"]) for a in atoms if "element" in a])
            or None,
            "atom_count": version.atom_count if version else None,
            "geometry_role": summary.structure.geometry_role,
            "coordinate_unit": version.coordinate_unit if version else None,
            "atoms": [
                {"element": a.get("element"), "x": a.get("x"), "y": a.get("y"), "z": a.get("z")}
                for a in atoms[:MAX_ATOMS_LISTED]
            ],
            "atoms_listed_truncated": len(atoms) > MAX_ATOMS_LISTED,
        },
        "quantities": [q.model_dump(mode="json") for q in summary.quantities],
        "provenance": {
            "record_id": record.provenance_record_id,
            "operation": provenance.operation
            if provenance and portable_policy.OPERATION_RE.fullmatch(provenance.operation or "")
            else None,
            "operation_version": portable_policy.safe_version(
                provenance.operation_version if provenance else None
            ),
            "producer": provenance.producer_identifier
            if provenance and portable_policy.PRODUCER_RE.fullmatch(provenance.producer_identifier or "")
            else None,
            "created_at": provenance.created_at.isoformat() if provenance else None,
            "verification_state": provenance.verification_state if provenance else None,
            "api_reference": f"/v1/projects/{project_id}/results/{record.id}/provenance",
            "result_payload_sha256": sha256_json(record.payload_json),
            "artifacts": [
                {
                    "artifact_id": a.id,
                    "kind": portable_policy.safe_enum(a.kind, portable_policy.ARTIFACT_KINDS)
                    or "UNKNOWN",
                    "size_bytes": a.size_bytes,
                    "sha256": a.sha256,
                }
                for a in (artifacts[i] for i in artifact_ids if i in artifacts)
            ],
        },
        "charts": charts,
    }


def _methods_text(dossiers: list[dict[str, Any]]) -> str:
    sentences = []
    for d in dossiers:
        level = d["level_of_theory"]
        engine = " ".join(p for p in (d["engine"]["name"], d["engine"]["version"]) if p)
        theory = " / ".join(p for p in (level["method"], level["basis"]) if p) or "level not recorded"
        if level["dispersion"]:
            theory += f" with {level['dispersion']}"
        state = (
            f"charge {level['charge']:+d}, multiplicity {level['multiplicity']}"
            if level["charge"] is not None and level["multiplicity"] is not None
            else "charge and multiplicity not recorded"
        )
        sentences.append(
            f"{d['task_label']} of {d['structure']['formula_hill'] or 'the stored structure'} "
            f"(structure version {d['structure']['structure_version_id']}) was run with "
            f"{engine or 'an engine not recorded'} at {theory} ({state}); energies are in "
            "Hartree (Eh)."
        )
    return " ".join(sentences)


def build_report_document(
    session: Session,
    identity: Identity,
    project_id: str,
    result_ids: list[str],
    *,
    saved_comparison_id: str | None = None,
) -> dict[str, Any]:
    project, _member = authorize_project_access(session, identity, project_id)
    saved = None
    if saved_comparison_id is not None:
        saved = open_saved_comparison(session, identity, project.id, saved_comparison_id)
        result_ids = [str(i) for i in saved.saved.result_ids]
        if saved.comparison is None:
            raise ScientificValidationFailed(
                "A source result of this saved comparison no longer exists; it cannot be reported."
            )
    records = _result_records(session, project.id, result_ids)
    dossiers = [_dossier(session, project.id, r) for r in records]
    comparison = compare_results(session, identity, project.id, result_ids) if len(records) > 1 else None
    limitations: list[str] = []
    for d in dossiers:
        if d["standing"]["evidence_use"] != "CURRENT":
            limitations.append(
                f"Result {d['result_id'][:8]} is not current evidence ({d['standing']['headline']})."
            )
        if not d["charts"]:
            limitations.append(
                f"Result {d['result_id'][:8]}: no chart is shown because no stored stick data or "
                "optimization frames support one."
            )
        if d["standing"]["verification_state"] in (None, "UNVERIFIED"):
            limitations.append(
                f"Result {d['result_id'][:8]} is not independently verified."
            )
    if comparison is not None:
        limitations.append(comparison.notice)
    all_current = all(d["standing"]["evidence_use"] == "CURRENT" for d in dossiers)
    document: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "generated_at": datetime.now(UTC).isoformat(),
        "standing_evaluated_at_generation": True,
        "project": {"id": project.id, "name": project.name},
        "scope": {
            "kind": "saved-comparison" if saved else ("comparison" if comparison else "calculation"),
            "saved_comparison": None
            if saved is None
            else {
                "id": str(saved.saved.id),
                "name": saved.saved.name,
                "revalidation_status": saved.status,
                "revalidated_at": saved.revalidated_at.isoformat(),
                "sources": [
                    {"result_id": str(r.result_id), "status": r.status, "detail": r.detail}
                    for r in saved.revalidation
                ],
                "saved_snapshot_is_historical": True,
            },
        },
        "evidence_use": "CURRENT" if all_current else "HISTORICAL_ONLY",
        "results": dossiers,
        "comparison": comparison.model_dump(mode="json") if comparison else None,
        "methods_text": _methods_text(dossiers),
        "limitations": limitations,
        "reproducibility_note": (
            "This report summarizes stored evidence. For inputs, parameters, software identity "
            "and artifact hashes download the reproducibility archive for each calculation; a "
            "report alone does not reproduce a calculation."
        ),
    }
    document["integrity"] = {
        "algorithm": "sha256 of this document without the integrity field (canonical JSON)",
        "sha256": sha256_json(document),
    }
    return document


# --------------------------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------------------------


def _value(value: float) -> str:
    return repr(float(value))


def _chart_svg(chart: dict[str, Any]) -> str:
    points = [tuple(p) for p in chart["points"]]
    if chart["kind"] == "optimization-energy":
        return report_charts.line(
            points, title=chart["title"], x_label=chart["x_label"], y_label=chart["y_label"]
        )
    return report_charts.sticks(
        points, title=chart["title"], x_label=chart["x_label"], y_label=chart["y_label"]
    )


def _comparison_chart(comparison: dict[str, Any]) -> str | None:
    """Bars of the stored first delta (kcal/mol) of each pair that formed one."""
    items = []
    for pair in comparison["pairs"]:
        for delta in pair["deltas"]:
            if delta.get("delta_kcal_per_mol") is not None:
                items.append((str(pair["other_result_id"])[:8], float(delta["delta_kcal_per_mol"])))
                break
    if not items:
        return None
    return report_charts.bars(
        items,
        title="Energy difference against the reference (other minus reference)",
        y_label="Δ (kcal/mol)",
    )


_CSS = (
    "body{font:14px/1.45 -apple-system,Segoe UI,sans-serif;color:#1a1a1a;background:#fff;"
    "max-width:980px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0 0 4px}"
    "h2{font-size:17px;border-bottom:1px solid #d1d5db;padding-bottom:3px;margin-top:28px}"
    "h3{font-size:14px;margin:16px 0 4px}table{border-collapse:collapse;width:100%;margin:6px 0}"
    "th,td{border:1px solid #d1d5db;padding:3px 7px;text-align:left;vertical-align:top}"
    "th{background:#f3f4f6;font-weight:600}td.n{text-align:right;font-family:ui-monospace,monospace}"
    ".mono{font-family:ui-monospace,monospace;font-size:12px;word-break:break-all}"
    ".banner{border:1px solid #9ca3af;border-left-width:5px;padding:5px 9px;margin:8px 0}"
    ".current{border-left-color:#1a7f37}.historical{border-left-color:#b45309;background:#fff7ed}"
    ".muted{color:#4b5563}pre{background:#f3f4f6;padding:8px;overflow:auto;font-size:12px}"
    "@media print{body{margin:0}}"
)


def _table(headers: list[str], rows: list[list[str]], numeric: set[int] | None = None) -> str:
    numeric = numeric or set()
    head = "".join(f'<th scope="col">{escape(h)}</th>' for h in headers)
    body = "".join(
        "<tr>"
        + "".join(
            f'<td class="{"n" if i in numeric else ""}">{escape(c)}</td>' for i, c in enumerate(r)
        )
        + "</tr>"
        for r in rows
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def render_html(document: dict[str, Any]) -> str:
    out: list[str] = []
    project = document["project"]
    out.append(f"<h1>{escape(project['name'])} — scientific report</h1>")
    out.append(
        f'<p class="muted">Generated {escape(document["generated_at"])} · project '
        f'<span class="mono">{escape(project["id"])}</span> · schema {escape(document["schema"])}. '
        "Scientific standing below was evaluated at generation time.</p>"
    )
    current = document["evidence_use"] == "CURRENT"
    out.append(
        f'<div class="banner {"current" if current else "historical"}" role="note">'
        f"<strong>Evidence use: {escape(document['evidence_use'])}.</strong> "
        + (
            "Every included result is currently eligible evidence."
            if current
            else "At least one included result is historical or of unknown standing and must not "
            "be cited as current authoritative evidence."
        )
        + "</div>"
    )
    saved = document["scope"]["saved_comparison"]
    if saved:
        out.append(
            f"<h2>Saved comparison: {escape(saved['name'])}</h2><p>Reopened and revalidated "
            f"{escape(saved['revalidated_at'])}; status <strong>{escape(saved['revalidation_status'])}"
            "</strong>. The saved snapshot is historical context only.</p>"
            + _table(
                ["Result", "Revalidation", "Detail"],
                [[s["result_id"][:8], s["status"], s["detail"]] for s in saved["sources"]],
            )
        )
    out.append("<h2>Methods</h2><p>" + escape(document["methods_text"]) + "</p>")
    for index, d in enumerate(document["results"], start=1):
        out.append(f"<h2>Result {index}: {escape(d['task_label'])}</h2>")
        s = d["standing"]
        out.append(
            f'<div class="banner {"current" if s["evidence_use"] == "CURRENT" else "historical"}">'
            f"<strong>{escape(s['headline'])}</strong><br>"
            f"Authority {escape(str(s['authority']))} · validation "
            f"{escape(str(s['validation_state']))} · lineage "
            f"{escape(str(s['source_lineage_validity']))}.<br>"
            f"{escape(s['verification_statement'])}</div>"
        )
        st, lv = d["structure"], d["level_of_theory"]
        out.append("<h3>Structure and calculation</h3>")
        out.append(
            _table(
                ["Item", "Value"],
                [
                    ["Structure", f"{st['name'] or '—'} (revision {st['revision']})"],
                    ["Structure version", str(st["structure_version_id"])],
                    ["Formula (Hill) · atoms", f"{st['formula_hill'] or '—'} · {st['atom_count']}"],
                    ["Geometry used", str(st["geometry_role"]) + " geometry"],
                    ["Calculation", f"{d['calculation_id']} ({d['calculation_state']})"],
                    ["Engine", " ".join(p for p in (d["engine"]["name"], d["engine"]["version"]) if p) or "not recorded"],
                    ["Method / basis", f"{lv['method'] or '—'} / {lv['basis'] or '—'}"],
                    ["Dispersion · solvation", f"{lv['dispersion'] or 'none recorded'} · {lv['solvation'] or 'none recorded'}"],
                    ["Charge · multiplicity", f"{lv['charge']} · {lv['multiplicity']}"],
                ],
            )
        )
        if st["atoms"]:
            rows = [[str(a["element"]), _value(a["x"]), _value(a["y"]), _value(a["z"])] for a in st["atoms"]]
            out.append(
                f"<details><summary>Coordinates ({escape(str(st['coordinate_unit']))}, "
                f"{len(rows)} atoms listed{', truncated' if st['atoms_listed_truncated'] else ''})"
                "</summary>" + _table(["Element", "x", "y", "z"], rows, {1, 2, 3}) + "</details>"
            )
        out.append("<h3>Results</h3>")
        if d["quantities"]:
            out.append(
                _table(
                    ["Quantity", "Value", "Unit"],
                    [[q["label"], _value(q["value"]), "—" if q["unit"] == "1" else q["unit"]] for q in d["quantities"]],
                    {1},
                )
            )
        else:
            out.append('<p class="muted">This result type has no scalar summary quantity.</p>')
        for chart in d["charts"]:
            out.append(f"<figure>{_chart_svg(chart)}<figcaption class=\"muted\">{escape(chart['title'])}</figcaption></figure>")
        pv = d["provenance"]
        out.append("<h3>Provenance</h3>")
        out.append(
            _table(
                ["Item", "Value"],
                [
                    ["Provenance record", pv["record_id"]],
                    ["Operation", f"{pv['operation']} {pv['operation_version']}"],
                    ["Producer", str(pv["producer"])],
                    ["Result payload SHA-256", pv["result_payload_sha256"]],
                    ["API reference", pv["api_reference"]],
                ],
            )
        )
        if pv["artifacts"]:
            out.append(
                _table(
                    ["Artifact", "Kind", "Size (B)", "SHA-256"],
                    [[a["artifact_id"][:8], a["kind"], str(a["size_bytes"]), a["sha256"]] for a in pv["artifacts"]],
                    {2},
                )
            )
    comparison = document["comparison"]
    if comparison:
        out.append("<h2>Comparison</h2>")
        out.append(
            f"<p>Overall: <strong>{escape(comparison['overall'].replace('_', ' ').lower())}</strong>."
            f" Differences are other minus reference; {escape(comparison['notice'])}</p>"
        )
        chart = _comparison_chart(comparison)
        if chart:
            out.append(f"<figure>{chart}</figure>")
        for pair in comparison["pairs"]:
            out.append(
                f"<h3>{escape(pair['other_result_id'][:8])} against reference "
                f"{escape(pair['reference_result_id'][:8])}: "
                f"{escape(pair['label'].replace('_', ' ').lower())} "
                f"({escape(pair['evidence_standing'].replace('_', ' ').lower())})</h3>"
            )
            out.append(_table(["Rule", "Outcome", "Detail"], [[r["rule_id"], r["outcome"], r["detail"]] for r in pair["rules"]]))
            if pair["deltas"]:
                out.append(
                    _table(
                        ["Quantity", "Reference", "Other", "Unit", "Δ", "Δ kcal/mol", "Δ kJ/mol"],
                        [
                            [
                                x["label"], _value(x["reference_value"]), _value(x["other_value"]),
                                "—" if x["unit"] == "1" else x["unit"],
                                "—" if x["delta"] is None else _value(x["delta"]),
                                "—" if x["delta_kcal_per_mol"] is None else _value(x["delta_kcal_per_mol"]),
                                "—" if x["delta_kj_per_mol"] is None else _value(x["delta_kj_per_mol"]),
                            ]
                            for x in pair["deltas"]
                        ],
                        {1, 2, 4, 5, 6},
                    )
                )
            else:
                out.append('<p class="muted">No difference is shown: ' + escape("; ".join(pair["blockers"]) or "no shared quantity.") + "</p>")
    out.append("<h2>Limitations</h2><ul>" + "".join(f"<li>{escape(t)}</li>" for t in document["limitations"]) + "</ul>")
    out.append(f"<p class=\"muted\">{escape(document['reproducibility_note'])}</p>")
    out.append(
        f'<p class="muted mono">Report SHA-256 {escape(document["integrity"]["sha256"])}</p>'
    )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
        "style-src 'unsafe-inline'\">"
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(project['name'])} — ChemDFT scientific report</title>"
        f"<style>{_CSS}</style></head><body>" + "".join(out) + "</body></html>"
    )


def _md(text: object) -> str:
    return " ".join(str(text).replace("|", "\\|").split())


def _md_table(headers: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(_md(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def render_markdown(document: dict[str, Any]) -> str:
    project = document["project"]
    out = [
        f"# {_md(project['name'])} — scientific report",
        f"Generated {document['generated_at']} · project `{project['id']}` · "
        f"schema {document['schema']}. Standing was evaluated at generation time.",
        f"**Evidence use: {document['evidence_use']}.**"
        + ("" if document["evidence_use"] == "CURRENT" else " Not current authoritative evidence."),
    ]
    saved = document["scope"]["saved_comparison"]
    if saved:
        out.append(
            f"## Saved comparison: {_md(saved['name'])}\nRevalidated {saved['revalidated_at']}: "
            f"**{saved['revalidation_status']}**. The saved snapshot is historical context only.\n\n"
            + _md_table(["Result", "Revalidation", "Detail"],
                        [[s["result_id"][:8], s["status"], s["detail"]] for s in saved["sources"]])
        )
    out.append("## Methods\n" + document["methods_text"])
    for index, d in enumerate(document["results"], start=1):
        s, st, lv = d["standing"], d["structure"], d["level_of_theory"]
        out.append(f"## Result {index}: {d['task_label']}")
        out.append(
            f"**{s['headline']}** — authority {s['authority']}, validation {s['validation_state']}, "
            f"lineage {s['source_lineage_validity']}. {s['verification_statement']}"
        )
        out.append(
            _md_table(
                ["Item", "Value"],
                [
                    ["Structure", f"{st['name']} (revision {st['revision']}), version {st['structure_version_id']}"],
                    ["Formula · atoms", f"{st['formula_hill']} · {st['atom_count']}"],
                    ["Calculation", f"{d['calculation_id']} ({d['calculation_state']})"],
                    ["Engine", f"{d['engine']['name']} {d['engine']['version']}"],
                    ["Method / basis", f"{lv['method']} / {lv['basis']}"],
                    ["Dispersion · solvation", f"{lv['dispersion']} · {lv['solvation']}"],
                    ["Charge · multiplicity", f"{lv['charge']} · {lv['multiplicity']}"],
                ],
            )
        )
        if d["quantities"]:
            out.append(
                _md_table(
                    ["Quantity", "Value", "Unit"],
                    [[q["label"], _value(q["value"]), "—" if q["unit"] == "1" else q["unit"]] for q in d["quantities"]],
                )
            )
        if d["charts"]:
            out.append("_Charts are included in the HTML report._")
        pv = d["provenance"]
        out.append(
            f"Provenance record `{pv['record_id']}` · {pv['operation']} {pv['operation_version']} · "
            f"payload SHA-256 `{pv['result_payload_sha256']}`"
        )
        if pv["artifacts"]:
            out.append(
                _md_table(
                    ["Artifact", "Kind", "Size (B)", "SHA-256"],
                    [[a["artifact_id"][:8], a["kind"], str(a["size_bytes"]), a["sha256"]] for a in pv["artifacts"]],
                )
            )
    comparison = document["comparison"]
    if comparison:
        out.append(f"## Comparison\nOverall: **{comparison['overall']}**. {comparison['notice']}")
        for pair in comparison["pairs"]:
            out.append(
                f"### {pair['other_result_id'][:8]} vs reference {pair['reference_result_id'][:8]}: "
                f"{pair['label']} ({pair['evidence_standing']})"
            )
            out.append(_md_table(["Rule", "Outcome", "Detail"], [[r["rule_id"], r["outcome"], r["detail"]] for r in pair["rules"]]))
            if pair["deltas"]:
                out.append(
                    _md_table(
                        ["Quantity", "Reference", "Other", "Unit", "Δ", "Δ kcal/mol", "Δ kJ/mol"],
                        [
                            [x["label"], _value(x["reference_value"]), _value(x["other_value"]),
                             "—" if x["unit"] == "1" else x["unit"],
                             "—" if x["delta"] is None else _value(x["delta"]),
                             "—" if x["delta_kcal_per_mol"] is None else _value(x["delta_kcal_per_mol"]),
                             "—" if x["delta_kj_per_mol"] is None else _value(x["delta_kj_per_mol"])]
                            for x in pair["deltas"]
                        ],
                    )
                )
            else:
                out.append("No difference is shown: " + ("; ".join(pair["blockers"]) or "no shared quantity."))
    out.append("## Limitations\n" + "\n".join(f"- {t}" for t in document["limitations"]))
    out.append(document["reproducibility_note"])
    out.append(f"Report SHA-256 `{document['integrity']['sha256']}`")
    return "\n\n".join(out) + "\n"


def render_report(document: dict[str, Any], fmt: str) -> tuple[bytes, str, str]:
    """Returns (content, media_type, extension)."""
    if fmt == "html":
        return render_html(document).encode(), "text/html; charset=utf-8", "html"
    if fmt == "markdown":
        return render_markdown(document).encode(), "text/markdown; charset=utf-8", "md"
    if fmt == "json":
        text = json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
        return text.encode(), "application/json", "json"
    raise ScientificValidationFailed("Report format must be html, markdown or json.")
