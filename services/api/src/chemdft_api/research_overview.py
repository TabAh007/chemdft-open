"""Project research overview: a bulk-loaded, read-only table of what was run and what is current.

Every scientific field is lifted from a stored record or from `summarize_result` (the same
projection the comparison and exports use), and standing comes from `effective_result_state`.
Nothing here recomputes a value, infers convergence, or upgrades a verification state.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, defer

from .actions import authorize_project_access
from .calculation_summary import hill_formula, summarize_result, version_atoms
from .context import Identity
from .contracts.workflows import (
    OverviewRow,
    OverviewStructure,
    ResearchOverview,
    SavedComparisonListOutput,
)
from .saved_comparisons import list_saved_comparisons
from .scientific_export import _spectrum_availability
from .scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    OptimizationTrajectoryRecord,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)

#: Rows returned at most; `truncated` tells the caller when the project holds more.
MAX_ROWS = 300


def _display(reference: object) -> str | None:
    if not isinstance(reference, dict):
        return None
    return str(reference.get("identifier") or reference.get("display_name") or "") or None


def _visualizations(record: CalculationResultRecord | None) -> tuple[str, ...]:
    if record is None:
        return ()
    payload = record.payload_json or {}
    kind = record.result_type
    if kind == "chemdft.optimization":
        return ("trajectory",)
    if kind == "chemdft.vibrational-analysis":
        modes = payload.get("modes") or []
        found = []
        if any(m.get("ir_intensity") for m in modes):
            found.append("ir-spectrum")
        if any(m.get("raman_activity") for m in modes):
            found.append("raman-spectrum")
        return tuple(found)
    if kind == "chemdft.tddft":
        return ("uv-vis-spectrum",) if payload.get("excited_states") else ()
    if kind == "chemdft.molecular-orbitals":
        return ("molecular-orbitals", "electron-density")
    if kind == "chemdft.thermochemistry":
        return ("thermochemistry",)
    if kind == "chemdft.conformer-ensemble":
        return ("conformers",)
    return ()


def _failure(job: ComputeJobRecord | None, execution: ComputeExecutionRecord | None) -> str | None:
    """Persisted failure text for a failed or lost execution; None for every other state."""
    if job is None or execution is None:
        return None
    failed = str(job.state) == "FAILED" or (
        execution.state == "LOST" and str(job.state) not in {"SUCCEEDED", "CANCELED"}
    )
    if not failed:
        return None
    code = execution.failure_code.lower().replace("_", " ") if execution.failure_code else None
    parts = [p for p in (code, execution.diagnostic) if p]
    return " — ".join(parts)[:500] if parts else None


class _Context:
    """Row-rendering inputs for a set of calculations, bulk-loaded once and project-scoped."""

    def __init__(
        self,
        session: Session,
        identity: Identity,
        project_id: str,
        calculations: Sequence[CalculationRecord],
        results: Mapping[str, CalculationResultRecord],
        saved: SavedComparisonListOutput | None = None,
    ) -> None:
        self.session = session
        self.project_id = project_id
        ids = [c.id for c in calculations]
        self.inputs = {
            i.calculation_id: i
            for i in session.scalars(
                select(CalculationInputRecord).where(
                    CalculationInputRecord.project_id == project_id,
                    CalculationInputRecord.calculation_id.in_(ids),
                )
            )
        } if ids else {}
        self.jobs = {
            j.calculation_id: j
            for j in session.scalars(
                select(ComputeJobRecord).where(
                    ComputeJobRecord.project_id == project_id,
                    ComputeJobRecord.calculation_id.in_(ids),
                )
            )
        } if ids else {}
        self.latest_execution: dict[str, ComputeExecutionRecord] = {}
        if self.jobs:
            for execution in session.scalars(
                select(ComputeExecutionRecord)
                .where(
                    ComputeExecutionRecord.project_id == project_id,
                    ComputeExecutionRecord.job_id.in_([j.id for j in self.jobs.values()]),
                )
                .order_by(ComputeExecutionRecord.created_at, ComputeExecutionRecord.id)
            ):
                # ascending order: the last execution wins
                self.latest_execution[execution.job_id] = execution
        self.trajectories = set(
            session.scalars(
                select(OptimizationTrajectoryRecord.calculation_id).where(
                    OptimizationTrajectoryRecord.project_id == project_id,
                    OptimizationTrajectoryRecord.calculation_id.in_(ids),
                    OptimizationTrajectoryRecord.steps_json.is_not(None),
                )
            )
        ) if ids else set()
        result_ids = [r.id for r in results.values()]
        self.field_results = set(
            session.scalars(
                select(ScientificArtifactRecord.source_relation_id).where(
                    ScientificArtifactRecord.project_id == project_id,
                    ScientificArtifactRecord.kind == "VOLUMETRIC_GRID",
                    ScientificArtifactRecord.format_identifier == "chemdft.volumetric-field.npz",
                    ScientificArtifactRecord.source_relation_id.in_(result_ids),
                )
            )
        ) if result_ids else set()
        version_ids = {i.structure_version_id for i in self.inputs.values()}
        self.versions = {
            v.id: v
            for v in session.scalars(
                select(StructureVersionRecord).where(
                    StructureVersionRecord.project_id == project_id,
                    StructureVersionRecord.id.in_(version_ids),
                )
            )
        } if version_ids else {}
        self.structures_by_id = {
            s.id: s
            for s in session.scalars(
                select(StructureRecord).where(StructureRecord.project_id == project_id)
            )
        }
        self.saved = (
            saved if saved is not None else list_saved_comparisons(session, identity, project_id)
        )
        self.saved_by_result: dict[str, list[UUID]] = defaultdict(list)
        for comparison in self.saved.comparisons:
            for result_id in comparison.result_ids:
                self.saved_by_result[str(result_id)].append(comparison.id)
        self._formula_cache: dict[str, tuple[str | None, int | None]] = {}

    def formula(self, version: StructureVersionRecord) -> tuple[str | None, int | None]:
        if version.id not in self._formula_cache:
            elements = [str(a["element"]) for a in version_atoms(version) if "element" in a]
            self._formula_cache[version.id] = (hill_formula(elements) or None, version.atom_count)
        return self._formula_cache[version.id]

    def row(
        self, calculation: CalculationRecord, record: CalculationResultRecord | None
    ) -> OverviewRow:
        session = self.session
        calc_input = self.inputs.get(calculation.id)
        spec = (calc_input.specification_json if calc_input else None) or {}
        job = self.jobs.get(calculation.id)
        execution = self.latest_execution.get(job.id) if job else None
        summary = summarize_result(session, record) if record is not None else None
        version = self.versions.get(calc_input.structure_version_id) if calc_input else None
        structure = self.structures_by_id.get(version.structure_id) if version else None
        formula_hill, atom_count = self.formula(version) if version else (None, None)

        exports: list[str] = []
        if record is not None:
            exports.append("result-json")
            exports.append("report")
            is_optimization = record.result_type == "chemdft.optimization"
            if is_optimization and calculation.id in self.trajectories:
                exports.append("trajectory-xyz")
            if _spectrum_availability(record)[0]:
                exports.append("spectrum-csv")
            if record.id in self.field_results:
                exports.append("cube")
        if calc_input is not None:
            exports.append("reproducibility-bundle")

        engine_pref = spec.get("engine_preference")
        return OverviewRow(
            calculation_id=UUID(calculation.id),
            calculation_state=str(calculation.state),
            task=str((summary.task if summary else None) or spec.get("task_type") or "UNKNOWN"),
            engine=(summary.engine if summary else None)
            or (engine_pref.get("engine") if isinstance(engine_pref, dict) else None),
            engine_version=summary.engine_version if summary else None,
            method=(summary.method if summary else None) or _display(spec.get("method")),
            basis=(summary.basis if summary else None) or _display(spec.get("basis")),
            dispersion=summary.dispersion if summary else _display(spec.get("dispersion")),
            solvation=summary.solvation if summary else None,
            charge=spec.get("charge") if isinstance(spec.get("charge"), int) else None,
            multiplicity=spec.get("multiplicity")
            if isinstance(spec.get("multiplicity"), int)
            else None,
            structure_id=UUID(structure.id) if structure else None,
            structure_name=structure.name if structure else None,
            structure_version_id=UUID(version.id) if version else None,
            structure_revision=version.revision if version else None,
            formula_hill=formula_hill,
            atom_count=atom_count,
            created_at=calculation.created_at,
            updated_at=calculation.updated_at,
            job_id=UUID(job.id) if job else None,
            job_state=str(job.state) if job else None,
            failure=_failure(job, execution),
            result_id=UUID(record.id) if record else None,
            result_type=record.result_type if record else None,
            quantities=summary.quantities if summary else (),
            conditions=summary.conditions if summary else None,
            effective_state=summary.effective_state if summary else None,
            evidence_use=summary.evidence_use if summary else "NO_RESULT",
            visualizations=_visualizations(record),  # type: ignore[arg-type]
            exports=tuple(exports),
            saved_comparison_ids=tuple(self.saved_by_result.get(record.id, ())) if record else (),
        )


def rows_for_pairs(
    session: Session,
    identity: Identity,
    project_id: str,
    pairs: Sequence[tuple[CalculationRecord, CalculationResultRecord | None]],
    saved: SavedComparisonListOutput | None = None,
) -> tuple[list[OverviewRow], _Context]:
    """Rows for explicit (calculation, result) pairs, built as the overview builds them.

    Callers must authorize project access first. One calculation may appear in several pairs
    (a calculation can have more than one result record); each pair yields its own row.
    """
    calculations = list({c.id: c for c, _r in pairs}.values())
    results = {r.id: r for _c, r in pairs if r is not None}
    context = _Context(session, identity, project_id, calculations, results, saved)
    return [context.row(calculation, record) for calculation, record in pairs], context


def get_research_overview(
    session: Session, identity: Identity, project_id: str
) -> ResearchOverview:
    project, _member = authorize_project_access(session, identity, project_id)
    total = int(
        session.scalar(
            select(func.count()).select_from(CalculationRecord).where(
                CalculationRecord.project_id == project.id
            )
        )
        or 0
    )
    calculations = session.scalars(
        select(CalculationRecord)
        .where(CalculationRecord.project_id == project.id)
        .order_by(CalculationRecord.updated_at.desc(), CalculationRecord.id)
        .limit(MAX_ROWS)
    ).all()
    ids = [c.id for c in calculations]
    results = {
        r.calculation_id: r
        for r in session.scalars(
            select(CalculationResultRecord).where(
                CalculationResultRecord.project_id == project.id,
                CalculationResultRecord.calculation_id.in_(ids),
            )
        )
    } if ids else {}
    context = _Context(session, identity, project.id, calculations, results)
    structures_by_id = context.structures_by_id
    saved = context.saved
    formula = context.formula
    rows = [context.row(calculation, results.get(calculation.id)) for calculation in calculations]

    version_structure: dict[str, str] = {}
    latest: dict[str, StructureVersionRecord] = {}
    for version in session.scalars(
        select(StructureVersionRecord)
        .where(StructureVersionRecord.project_id == project.id)
        .options(defer(StructureVersionRecord.periodic_cell_json))
        .order_by(StructureVersionRecord.revision)
    ):
        version_structure[version.id] = version.structure_id
        latest[version.structure_id] = version  # ascending revision: the newest wins
    per_structure: dict[str, int] = defaultdict(int)
    for version_id, count in session.execute(
        select(CalculationInputRecord.structure_version_id, func.count())
        .where(CalculationInputRecord.project_id == project.id)
        .group_by(CalculationInputRecord.structure_version_id)
    ):
        if version_id in version_structure:
            per_structure[version_structure[version_id]] += count
    overview_structures = []
    for structure in sorted(structures_by_id.values(), key=lambda s: s.created_at, reverse=True):
        newest = latest.get(structure.id)
        formula_hill, atom_count = formula(newest) if newest else (None, None)
        overview_structures.append(
            OverviewStructure(
                structure_id=UUID(structure.id),
                name=structure.name,
                kind=structure.kind,
                latest_version_id=UUID(newest.id) if newest else None,
                latest_revision=newest.revision if newest else None,
                formula_hill=formula_hill,
                atom_count=atom_count,
                calculation_count=per_structure.get(structure.id, 0),
            )
        )

    return ResearchOverview(
        project_id=UUID(project.id),
        generated_at=datetime.now(UTC),
        rows=tuple(rows),
        structures=tuple(overview_structures),
        saved_comparisons=saved,
        truncated=total > len(rows),
        total_calculations=total,
    )
