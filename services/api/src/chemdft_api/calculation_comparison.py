"""Multi-calculation comparison with explicit, testable comparability rules.

A comparison never changes a result's authority, validation or verification state, and numerical
agreement is never reported as verification. Differences are only produced when every rule that
makes the subtraction meaningful has been checked against stored specifications.

Rules (a pair of results is compared against the first/"reference" result):

  R1 STATE        PASS if both results are currently eligible; otherwise LIMITATION (the pair is
                  historical context only; stored values are shown, never as current evidence).
  R2 MOLECULE     FAIL unless both input structures have the same Hill formula and atom count.
  R3 CHARGE       FAIL unless both charges are recorded and equal.
  R4 MULTIPLICITY FAIL unless both multiplicities are recorded and equal.
  R5 LEVEL        FAIL unless method, basis, dispersion treatment and solvation all match. Total
                  energies from different levels of theory share no energy zero, so no difference
                  is formed (e.g. xTB vs Psi4 total energies).
  R6 ENGINE       PASS for the same engine and version; LIMITATION for another version or another
                  engine at the same level (numerical agreement is expected only to implementation
                  tolerance and is not verification).
  R7 GEOMETRY     PASS for the identical structure version or coordinates identical within
                  1e-3 angstrom; LIMITATION when the geometries differ or cannot be aligned.
  R8 THERMO       LIMITATION when thermochemistry temperature/pressure differ: thermal quantities
                  are then omitted.

Label: any FAIL -> NOT_SCIENTIFICALLY_COMPARABLE; else any LIMITATION ->
COMPARABLE_WITH_LIMITATIONS; else DIRECTLY_COMPARABLE.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .calculation_summary import summarize_result, version_atoms
from .context import Identity
from .contracts.analysis import (
    CalculationComparisonOutput,
    CalculationPairComparison,
    ComparisonCandidate,
    ComparisonCandidateListOutput,
    ComparisonDelta,
    ComparisonRuleOutcome,
    GeometryRelation,
    ResultSummary,
)
from .errors import ScientificReferenceNotFound, ScientificValidationFailed
from .scientific_models import CalculationResultRecord, StructureVersionRecord

MIN_RESULTS = 2
MAX_RESULTS = 8
GEOMETRY_IDENTICAL_TOLERANCE_ANGSTROM = 1e-3

KJ_PER_MOL_PER_EH = 2625.4996394799  # CODATA 2018
KCAL_PER_MOL_PER_EH = KJ_PER_MOL_PER_EH / 4.184  # thermochemical calorie
CONVERSION_FACTORS = {
    "kJ/mol per Eh": KJ_PER_MOL_PER_EH,
    "kcal/mol per Eh": KCAL_PER_MOL_PER_EH,
}

_THERMAL_KINDS = {"zero_point_energy", "enthalpy", "gibbs_free_energy"}
_RANK = {
    "DIRECTLY_COMPARABLE": 0,
    "COMPARABLE_WITH_LIMITATIONS": 1,
    "NOT_SCIENTIFICALLY_COMPARABLE": 2,
}

NOTICE = (
    "Differences are other minus reference and are shown only where every comparability rule was "
    "checked against the stored calculation specifications. Different methods, bases or engines "
    "legitimately give different absolute energies. Numerical agreement between results is not "
    "independent verification and never changes a result's verification state."
)


def _norm(value: str | None) -> str | None:
    return None if value is None else " ".join(value.casefold().split())


def _kabsch_rmsd(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean(axis=0)
    b = b - b.mean(axis=0)
    u, _s, vt = np.linalg.svd(b.T @ a)
    d = np.sign(np.linalg.det(u @ vt))
    rotation = u @ np.diag([1.0, 1.0, d]) @ vt
    return float(np.sqrt(((b @ rotation - a) ** 2).sum(axis=1).mean()))


def _geometry(
    session: Session, project_id: str, ref: ResultSummary, other: ResultSummary
) -> GeometryRelation:
    a_id, b_id = ref.structure.structure_version_id, other.structure.structure_version_id
    if a_id is None or b_id is None:
        return GeometryRelation(relation="UNAVAILABLE", note="A structure version is not recorded.")
    if a_id == b_id:
        return GeometryRelation(relation="IDENTICAL_STRUCTURE_VERSION", rmsd_angstrom=0.0)
    if ref.structure.element_sequence != other.structure.element_sequence:
        return GeometryRelation(
            relation="NOT_ATOM_ALIGNED",
            note="Atom order differs between the two structures, so coordinates were not aligned.",
        )
    coords: list[np.ndarray] = []
    for version_id in (a_id, b_id):
        version = session.scalar(
            select(StructureVersionRecord).where(
                StructureVersionRecord.id == str(version_id),
                StructureVersionRecord.project_id == project_id,
            )
        )
        atoms = version_atoms(version) if version else []
        if not atoms:
            return GeometryRelation(
                relation="UNAVAILABLE", note="Structure coordinates are unavailable."
            )
        coords.append(np.array([[a["x"], a["y"], a["z"]] for a in atoms], dtype=float))
    rmsd = _kabsch_rmsd(coords[0], coords[1])
    return GeometryRelation(
        relation="SAME_ATOM_ORDER_DIFFERENT_COORDINATES",
        rmsd_angstrom=rmsd,
        note=(
            "All-atom RMSD after optimal rigid superposition (Kabsch), no mass weighting."
        ),
    )


def _thermo_conditions(record: CalculationResultRecord | None) -> tuple[float, float] | None:
    if record is None or record.result_type != "chemdft.thermochemistry":
        return None
    conditions = (record.payload_json or {}).get("conditions") or {}
    t, p = conditions.get("temperature_k"), conditions.get("pressure_pa")
    return (
        (float(t), float(p))
        if isinstance(t, (int, float)) and isinstance(p, (int, float))
        else None
    )


def _rules(
    ref: ResultSummary,
    other: ResultSummary,
    geometry: GeometryRelation,
    thermo_mismatch: bool,
) -> list[ComparisonRuleOutcome]:
    rules: list[ComparisonRuleOutcome] = []

    def add(rule_id: str, outcome: str, detail: str) -> None:
        rules.append(ComparisonRuleOutcome(rule_id=rule_id, outcome=outcome, detail=detail))  # type: ignore[arg-type]

    inactive = [s for s in (ref, other) if s.evidence_use != "CURRENT"]
    if not inactive:
        add("R1_STATE", "PASS", "Both results are currently authoritative evidence.")
    else:
        add(
            "R1_STATE",
            "LIMITATION",
            "Historical context only: "
            + "; ".join(
                f"result {str(s.result_id)[:8]} "
                + (
                    s.effective_state.reason
                    if s.effective_state and s.effective_state.reason
                    else "has no effective scientific state"
                )
                for s in inactive
            ),
        )

    f1, f2 = ref.structure.formula_hill, other.structure.formula_hill
    if f1 and f2 and f1 == f2 and ref.structure.atom_count == other.structure.atom_count:
        add("R2_MOLECULE", "PASS", f"Same molecular formula ({f1}).")
    else:
        add(
            "R2_MOLECULE",
            "FAIL",
            f"Molecular identity differs or is unknown ({f1 or 'unknown'} vs {f2 or 'unknown'}).",
        )

    if ref.charge is not None and ref.charge == other.charge:
        add("R3_CHARGE", "PASS", f"Both calculations use charge {ref.charge:+d}.")
    else:
        add(
            "R3_CHARGE",
            "FAIL",
            f"Charge differs or is unrecorded ({ref.charge} vs {other.charge}).",
        )

    if ref.multiplicity is not None and ref.multiplicity == other.multiplicity:
        add("R4_MULTIPLICITY", "PASS", f"Both calculations use multiplicity {ref.multiplicity}.")
    else:
        add(
            "R4_MULTIPLICITY",
            "FAIL",
            f"Multiplicity differs or is unrecorded ({ref.multiplicity} vs {other.multiplicity}).",
        )

    mismatches = [
        f"{label} ({a or 'none'} vs {b or 'none'})"
        for label, a, b in (
            ("method", ref.method, other.method),
            ("basis", ref.basis, other.basis),
            ("dispersion", ref.dispersion, other.dispersion),
            ("solvation", ref.solvation, other.solvation),
        )
        if _norm(a) != _norm(b)
    ]
    if not ref.method or not other.method:
        add("R5_LEVEL", "FAIL", "The level of theory is not recorded for one of the results.")
    elif mismatches:
        add(
            "R5_LEVEL",
            "FAIL",
            "Different level of theory: "
            + "; ".join(mismatches)
            + ". Absolute energies at different levels share no common energy zero.",
        )
    else:
        add("R5_LEVEL", "PASS", f"Same level of theory ({ref.method}/{ref.basis or 'no basis'}).")

    if ref.engine and ref.engine == other.engine and ref.engine_version == other.engine_version:
        add("R6_ENGINE", "PASS", f"Same engine and version ({ref.engine} {ref.engine_version}).")
    elif ref.engine and ref.engine == other.engine:
        add(
            "R6_ENGINE",
            "LIMITATION",
            f"Different {ref.engine} versions ({ref.engine_version} vs {other.engine_version}).",
        )
    else:
        add(
            "R6_ENGINE",
            "LIMITATION",
            f"Different engines ({ref.engine or 'unknown'} vs "
            f"{other.engine or 'unknown'}) at the same stated "
            "level: expect differences from integration grids, convergence and implementation. "
            "Agreement would not be independent verification.",
        )

    if geometry.relation == "IDENTICAL_STRUCTURE_VERSION" or (
        geometry.rmsd_angstrom is not None
        and geometry.rmsd_angstrom <= GEOMETRY_IDENTICAL_TOLERANCE_ANGSTROM
    ):
        add("R7_GEOMETRY", "PASS", "Both results refer to the same geometry.")
    elif geometry.rmsd_angstrom is not None:
        add(
            "R7_GEOMETRY",
            "LIMITATION",
            f"Different geometries (RMSD {geometry.rmsd_angstrom:.4f} Å). "
            "Differences include geometric "
            "relaxation or conformer effects and are not an energy change at a fixed geometry.",
        )
    else:
        add(
            "R7_GEOMETRY",
            "LIMITATION",
            geometry.note or "Geometry relation could not be established.",
        )

    if thermo_mismatch:
        add(
            "R8_THERMO",
            "LIMITATION",
            "Thermochemistry temperature or pressure differ; thermal quantities are not compared.",
        )
    return rules


def _label(rules: list[ComparisonRuleOutcome]) -> str:
    if any(r.outcome == "FAIL" for r in rules):
        return "NOT_SCIENTIFICALLY_COMPARABLE"
    if any(r.outcome == "LIMITATION" for r in rules):
        return "COMPARABLE_WITH_LIMITATIONS"
    return "DIRECTLY_COMPARABLE"


def _deltas(
    ref: ResultSummary, other: ResultSummary, label: str, limitations: list[str], skip_thermal: bool
) -> list[ComparisonDelta]:
    if label == "NOT_SCIENTIFICALLY_COMPARABLE":
        return []
    other_by_kind = {q.kind: q for q in other.quantities}
    assumptions = (
        "Same molecule, charge, multiplicity and level of theory were verified from "
        "stored specifications.",
        "Difference = other minus reference.",
        *(f"Limitation: {text}" for text in limitations),
    )
    out: list[ComparisonDelta] = []
    for q in ref.quantities:
        o = other_by_kind.get(q.kind)
        if o is None or o.unit != q.unit or (skip_thermal and q.kind in _THERMAL_KINDS):
            continue
        delta = o.value - q.value
        energy = q.unit == "Eh"
        out.append(
            ComparisonDelta(
                quantity_kind=q.kind,
                label=q.label,
                reference_value=q.value,
                other_value=o.value,
                unit=q.unit,
                delta=delta,
                delta_kcal_per_mol=delta * KCAL_PER_MOL_PER_EH if energy else None,
                delta_kj_per_mol=delta * KJ_PER_MOL_PER_EH if energy else None,
                assumptions=assumptions,
            )
        )
    return out


def _records(
    session: Session, project_id: str, result_ids: list[str]
) -> list[CalculationResultRecord]:
    if not MIN_RESULTS <= len(result_ids) <= MAX_RESULTS:
        raise ScientificValidationFailed(
            f"Select between {MIN_RESULTS} and {MAX_RESULTS} results to compare."
        )
    if len(set(result_ids)) != len(result_ids):
        raise ScientificValidationFailed("Each result may be selected only once.")
    records = []
    for rid in result_ids:
        try:
            UUID(rid)
        except ValueError as error:
            raise ScientificValidationFailed("Result identifiers must be UUIDs.") from error
        record = session.scalar(
            select(CalculationResultRecord).where(
                CalculationResultRecord.id == rid, CalculationResultRecord.project_id == project_id
            )
        )
        if record is None:
            # Identical response for "missing" and "belongs to another project".
            raise ScientificReferenceNotFound("Result does not exist in this project.")
        records.append(record)
    return records


def compare_results(
    session: Session, identity: Identity, project_id: str, result_ids: list[str]
) -> CalculationComparisonOutput:
    project, _member = authorize_project_access(session, identity, project_id)
    records = _records(session, project.id, result_ids)
    summaries = [summarize_result(session, r) for r in records]
    reference, ref_record = summaries[0], records[0]
    pairs: list[CalculationPairComparison] = []
    for other, other_record in zip(summaries[1:], records[1:], strict=True):
        geometry = _geometry(session, project.id, reference, other)
        a, b = _thermo_conditions(ref_record), _thermo_conditions(other_record)
        # Only two thermochemistry results can pair thermal quantities.
        thermo_mismatch = a is not None and b is not None and a != b
        rules = _rules(reference, other, geometry, thermo_mismatch)
        label = _label(rules)
        limitations = [r.detail for r in rules if r.outcome == "LIMITATION"]
        blockers = [r.detail for r in rules if r.outcome == "FAIL"]
        pairs.append(
            CalculationPairComparison(
                reference_result_id=reference.result_id,
                other_result_id=other.result_id,
                label=label,  # type: ignore[arg-type]
                rules=tuple(rules),
                limitations=tuple(limitations),
                blockers=tuple(blockers),
                geometry=geometry,
                deltas=tuple(_deltas(reference, other, label, limitations, thermo_mismatch)),
                evidence_standing="CURRENT"
                if reference.evidence_use == "CURRENT" and other.evidence_use == "CURRENT"
                else "HISTORICAL_CONTEXT",
            )
        )
    overall = max((p.label for p in pairs), key=lambda value: _RANK[value])
    return CalculationComparisonOutput(
        project_id=project.id,  # type: ignore[arg-type]
        reference_result_id=reference.result_id,
        results=tuple(summaries),
        pairs=tuple(pairs),
        overall=overall,  # type: ignore[arg-type]
        conversion_factors=CONVERSION_FACTORS,
        notice=NOTICE,
    )


def list_comparison_candidates(
    session: Session, identity: Identity, project_id: str
) -> ComparisonCandidateListOutput:
    project, _member = authorize_project_access(session, identity, project_id)
    records = session.scalars(
        select(CalculationResultRecord)
        .where(CalculationResultRecord.project_id == project.id)
        .order_by(CalculationResultRecord.created_at.desc(), CalculationResultRecord.id)
        .limit(500)
    ).all()
    candidates = []
    for record in records:
        summary = summarize_result(session, record)
        if summary.quantities:
            candidates.append(ComparisonCandidate(summary=summary))
    return ComparisonCandidateListOutput(project_id=project.id, candidates=tuple(candidates))  # type: ignore[arg-type]


# --------------------------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------------------------


def comparison_json(output: CalculationComparisonOutput) -> bytes:
    import json

    document: dict[str, Any] = {
        "exported_at": datetime.now(UTC).isoformat(),
        **output.model_dump(mode="json"),
    }
    return (json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()


def comparison_csv(output: CalculationComparisonOutput) -> bytes:
    import csv
    import io

    def line(text: object) -> str:
        return " ".join(str(text).split())

    buffer = io.StringIO()
    buffer.write("# ChemDFT calculation comparison (schema chemdft.calculation-comparison.v1)\n")
    buffer.write(f"# exported_at: {datetime.now(UTC).isoformat()}\n")
    buffer.write(f"# project_id: {output.project_id}\n")
    buffer.write(f"# delta_convention: {output.delta_convention}\n")
    buffer.write(f"# overall: {output.overall}\n")
    buffer.write(f"# notice: {line(output.notice)}\n")
    for s in output.results:
        buffer.write(
            f"# result {s.result_id}: engine={s.engine} {s.engine_version} "
            f"method={s.method} basis={s.basis} "
            f"charge={s.charge} multiplicity={s.multiplicity} evidence_use={s.evidence_use} "
            f"authority={s.effective_state.authority if s.effective_state else 'UNKNOWN'} "
            f"verification="
            f"{s.effective_state.verification_state if s.effective_state else 'UNKNOWN'}\n"
        )
    for p in output.pairs:
        for text in p.blockers:
            buffer.write(f"# pair {str(p.other_result_id)[:8]} BLOCKER: {line(text)}\n")
        for text in p.limitations:
            buffer.write(f"# pair {str(p.other_result_id)[:8]} LIMITATION: {line(text)}\n")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(
        [
            "reference_result_id",
            "other_result_id",
            "comparability",
            "evidence_standing",
            "quantity",
            "unit",
            "reference_value",
            "other_value",
            "delta_other_minus_reference",
            "delta_kcal_per_mol",
            "delta_kj_per_mol",
        ]
    )
    for p in output.pairs:
        if not p.deltas:
            writer.writerow(
                [
                    p.reference_result_id,
                    p.other_result_id,
                    p.label,
                    p.evidence_standing,
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                ]
            )
        for d in p.deltas:
            writer.writerow(
                [
                    p.reference_result_id,
                    p.other_result_id,
                    p.label,
                    p.evidence_standing,
                    d.label,
                    d.unit,
                    repr(d.reference_value),
                    repr(d.other_value),
                    "" if d.delta is None else repr(d.delta),
                    "" if d.delta_kcal_per_mol is None else repr(d.delta_kcal_per_mol),
                    "" if d.delta_kj_per_mol is None else repr(d.delta_kj_per_mol),
                ]
            )
    return buffer.getvalue().encode()
