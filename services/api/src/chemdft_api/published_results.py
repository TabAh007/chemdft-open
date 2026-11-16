"""Server-side pagination and filtering over a project's PUBLISHED scientific results.

The project overview is calculation-centric and bounded (newest 300 calculations), so a project with
many unpublished calculations could push older published results out of it. This module is
result-centric: it starts from the stored result records, so nothing published can be hidden by the
number of calculations.

* Authorization first, every query project-scoped. Nothing is written.
* One row per result record (a calculation with two results yields two rows), built by the SAME row
  builder as the overview, so standing (`effective_result_state`, uncached), quantities, exports and
  visualizations are the platform's own values. Historical and superseded results stay listed with
  their recorded standing; nothing is recomputed, normalized or upgraded here.
* Ordering is stable: (sort value, then result id), missing values last. The cursor is keyset-based
  (the last row's sort value and id), so concurrent publications cannot duplicate or skip rows.
* Counts are exact: total published, total matching the filters, calculations, and calculations
  that produced no published result by outcome.
"""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Sequence
from datetime import UTC, datetime
from functools import cmp_to_key
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .calculation_summary import _TASK_BY_TYPE, TOTAL_ENERGY
from .context import Identity
from .contracts.workflows import (
    OverviewRow,
    PublishedResultsFacets,
    PublishedResultsPage,
    WithoutResultCounts,
)
from .errors import ScientificValidationFailed
from .research_overview import rows_for_pairs
from .saved_comparisons import list_saved_comparisons
from .scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeJobRecord,
)

SORT_KEYS = ("updated", "task", "engine", "formula", "energy")
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
#: Rows are built (summaries, standing) in batches of this many pairs.
_BATCH = 200

_PENDING_CALCULATION = {"DRAFT", "VALIDATED", "AUTHORIZED", "QUEUED", "RUNNING"}
_PENDING_JOB = {"PENDING", "READY", "LEASED", "RUNNING", "CANCEL_REQUESTED"}


class _Entry:
    """The light facts about one published result that need no payload or summary."""

    __slots__ = ("calculation_id", "engine", "result_id", "result_type", "task", "updated_at")

    def __init__(self, result_id, calculation_id, result_type, engine, updated_at):
        self.result_id: str = result_id
        self.calculation_id: str = calculation_id
        self.result_type: str = result_type
        self.engine: str | None = engine
        self.updated_at: datetime = updated_at
        self.task: str | None = _TASK_BY_TYPE.get(result_type)


def _light_entries(session: Session, project_id: str) -> list[_Entry]:
    """Every published result in the project, without payloads (cheap, project-scoped)."""
    rows = session.execute(
        select(
            CalculationResultRecord.id,
            CalculationResultRecord.calculation_id,
            CalculationResultRecord.result_type,
            CalculationResultRecord.producer_software_json,
            CalculationRecord.updated_at,
        )
        .join(
            CalculationRecord,
            (CalculationRecord.id == CalculationResultRecord.calculation_id)
            & (CalculationRecord.project_id == CalculationResultRecord.project_id),
        )
        .where(CalculationResultRecord.project_id == project_id)
    ).all()
    entries = [
        _Entry(
            r.id,
            r.calculation_id,
            r.result_type,
            (r.producer_software_json or {}).get("name"),
            r.updated_at,
        )
        for r in rows
    ]
    # Result types outside the known map take their task from the stored specification, as the
    # result summary does.
    unknown = [e for e in entries if e.task is None]
    if unknown:
        specs = {
            i.calculation_id: i.specification_json
            for i in session.scalars(
                select(CalculationInputRecord).where(
                    CalculationInputRecord.project_id == project_id,
                    CalculationInputRecord.calculation_id.in_({e.calculation_id for e in unknown}),
                )
            )
        }
        for entry in unknown:
            entry.task = str((specs.get(entry.calculation_id) or {}).get("task_type") or "UNKNOWN")
    return entries


def _without_result_counts(session: Session, project_id: str) -> WithoutResultCounts:
    published = select(CalculationResultRecord.calculation_id).where(
        CalculationResultRecord.project_id == project_id
    )
    rows = session.execute(
        select(CalculationRecord.state, ComputeJobRecord.state)
        .outerjoin(
            ComputeJobRecord,
            (ComputeJobRecord.calculation_id == CalculationRecord.id)
            & (ComputeJobRecord.project_id == CalculationRecord.project_id),
        )
        .where(CalculationRecord.project_id == project_id, CalculationRecord.id.not_in(published))
    ).all()
    counts = {"pending": 0, "failed": 0, "canceled": 0, "no_result": 0}
    for calculation_state, job_state in rows:
        calc, job = str(calculation_state), str(job_state) if job_state else None
        if calc == "FAILED":
            counts["failed"] += 1
        elif calc == "CANCELED":
            counts["canceled"] += 1
        elif calc in _PENDING_CALCULATION or (job and job in _PENDING_JOB):
            counts["pending"] += 1
        else:
            counts["no_result"] += 1
    return WithoutResultCounts(**counts)


# -- ordering -----------------------------------------------------------------------------------


def _value(sort: str, entry: _Entry, row: OverviewRow | None) -> Any:
    if sort == "updated":
        return entry.updated_at.isoformat()
    if sort == "task":
        return entry.task
    if sort == "engine":
        return entry.engine
    if row is None:
        return None
    if sort == "formula":
        return row.formula_hill
    # Only a stored total energy in hartree takes part, so a frequency or a gap is never ordered
    # among energies; results without one are last. Values only order the column: energies of
    # different levels of theory are not comparable.
    for quantity in row.quantities:
        if quantity.kind == TOTAL_ENERGY and quantity.unit == "Eh":
            return quantity.value
    return None


def _compare(direction: str):
    sign = 1 if direction == "asc" else -1

    def cmp(a: tuple[Any, str], b: tuple[Any, str]) -> int:
        (av, aid), (bv, bid) = a, b
        if (av is None) != (bv is None):
            return 1 if av is None else -1  # missing values are last in either direction
        if av is not None and bv is not None and av != bv:
            return sign * (-1 if av < bv else 1)
        return -1 if aid < bid else (1 if aid > bid else 0)  # ties: result id, always ascending

    return cmp


def _encode_cursor(sort: str, direction: str, value: Any, result_id: str) -> str:
    payload = {"s": sort, "d": direction, "v": value, "id": result_id}
    raw = json.dumps(payload, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str, sort: str, direction: str) -> tuple[Any, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        data = json.loads(raw)
        value, result_id = data["v"], str(UUID(str(data["id"])))
        if data["s"] != sort or data["d"] != direction:
            raise ValueError("cursor belongs to a different ordering")
        if value is not None and not isinstance(value, (str, int, float)):
            raise ValueError("cursor value")
    except (ValueError, KeyError, TypeError, binascii.Error, json.JSONDecodeError) as error:
        raise ScientificValidationFailed(
            "The page cursor is not valid for this ordering; reload the first page."
        ) from error
    return value, result_id


def _matches_text(row: OverviewRow, needle: str) -> bool:
    level = " / ".join(p for p in (row.method, row.basis) if p)
    haystack = " ".join(
        str(part)
        for part in (
            row.structure_name,
            row.formula_hill,
            row.method,
            row.basis,
            f"{level} + {row.dispersion}" if row.dispersion else level,
            row.engine,
            row.task,
            row.calculation_id,
            row.result_id,
            row.calculation_state,
        )
        if part
    ).lower()
    return needle in haystack


def _build_rows(
    session: Session,
    identity: Identity,
    project_id: str,
    entries: Sequence[_Entry],
    saved,
) -> dict[str, OverviewRow]:
    """Rows for the entries, keyed by result id, built in batches by the overview builder."""
    built: dict[str, OverviewRow] = {}
    for start in range(0, len(entries), _BATCH):
        batch = entries[start : start + _BATCH]
        results = {
            r.id: r
            for r in session.scalars(
                select(CalculationResultRecord).where(
                    CalculationResultRecord.project_id == project_id,
                    CalculationResultRecord.id.in_([e.result_id for e in batch]),
                )
            )
        }
        calculations = {
            c.id: c
            for c in session.scalars(
                select(CalculationRecord).where(
                    CalculationRecord.project_id == project_id,
                    CalculationRecord.id.in_({e.calculation_id for e in batch}),
                )
            )
        }
        pairs = [
            (calculations[e.calculation_id], results[e.result_id])
            for e in batch
            if e.result_id in results and e.calculation_id in calculations
        ]
        rows, _context = rows_for_pairs(session, identity, project_id, pairs, saved)
        for row in rows:
            built[str(row.result_id)] = row
    return built


MAX_RESULT_IDS = 16


def _wanted_result_ids(result_ids: Sequence[str] | None) -> set[str] | None:
    if not result_ids:
        return None
    if len(result_ids) > MAX_RESULT_IDS:
        raise ScientificValidationFailed(f"At most {MAX_RESULT_IDS} result ids may be requested.")
    wanted: set[str] = set()
    for value in result_ids:
        try:
            wanted.add(str(UUID(value)))
        except ValueError as error:
            raise ScientificValidationFailed("Result identifiers must be UUIDs.") from error
    return wanted


def get_published_results_page(
    session: Session,
    identity: Identity,
    project_id: str,
    *,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
    task: str | None = None,
    engine: str | None = None,
    standing: str | None = None,
    text: str | None = None,
    sort: str = "updated",
    direction: str = "desc",
    result_ids: Sequence[str] | None = None,
) -> PublishedResultsPage:
    project, _member = authorize_project_access(session, identity, project_id)
    wanted = _wanted_result_ids(result_ids)
    if sort not in SORT_KEYS or direction not in {"asc", "desc"} or standing not in {
        None, "current", "historical",
    }:
        raise ScientificValidationFailed("Unsupported sort, direction or standing filter.")
    limit = max(1, min(int(limit), MAX_LIMIT))
    needle = (text or "").strip().lower()
    cursor_key = _decode_cursor(cursor, sort, direction) if cursor else None

    total_calculations = int(
        session.scalar(
            select(func.count()).select_from(CalculationRecord).where(
                CalculationRecord.project_id == project.id
            )
        )
        or 0
    )
    saved = list_saved_comparisons(session, identity, project.id)
    entries = _light_entries(session, project.id)
    facets = PublishedResultsFacets(
        tasks=tuple(sorted({e.task for e in entries if e.task})),
        engines=tuple(sorted({e.engine for e in entries if e.engine})),
    )

    # Cheap filters first (no payloads).
    # `result_ids` restricts the page to named results of THIS project (the Compare workspace uses it to
    # re-read the selected results of a shared link). Ids that are not published results of the project
    # are simply absent: a missing id and another project's id are indistinguishable.
    candidates = [
        e for e in entries
        if (task is None or e.task == task)
        and (engine is None or e.engine == engine)
        and (wanted is None or e.result_id in wanted)
    ]
    # Text, standing and the value-based sorts need the platform's own row (summary, uncached
    # standing); build it for every remaining candidate, otherwise only for the page.
    needs_rows = bool(needle) or standing is not None or sort in {"formula", "energy"}
    rows: dict[str, OverviewRow] = {}
    if needs_rows:
        rows = _build_rows(session, identity, project.id, candidates, saved)
        candidates = [e for e in candidates if e.result_id in rows]
        if standing is not None:
            current = {rid for rid, r in rows.items() if r.evidence_use == "CURRENT"}
            want_current = standing == "current"
            candidates = [e for e in candidates if (e.result_id in current) == want_current]
        if needle:
            candidates = [e for e in candidates if _matches_text(rows[e.result_id], needle)]

    keyed = [(_value(sort, e, rows.get(e.result_id)), e.result_id, e) for e in candidates]
    compare = _compare(direction)
    keyed.sort(key=cmp_to_key(lambda a, b: compare((a[0], a[1]), (b[0], b[1]))))
    if cursor_key is not None:
        keyed = [k for k in keyed if compare((k[0], k[1]), cursor_key) > 0]
    page = keyed[:limit]
    has_more = len(keyed) > limit

    if not needs_rows:
        rows = _build_rows(session, identity, project.id, [k[2] for k in page], saved)
    page_rows = tuple(rows[k[1]] for k in page if k[1] in rows)
    next_cursor = _encode_cursor(sort, direction, page[-1][0], page[-1][1]) if has_more else None
    return PublishedResultsPage(
        project_id=UUID(project.id),
        generated_at=datetime.now(UTC),
        rows=page_rows,
        total_published=len(entries),
        total_matching=len(candidates),
        total_calculations=total_calculations,
        without_result=_without_result_counts(session, project.id),
        facets=facets,
        saved_comparisons=saved,
        limit=limit,
        sort=sort,  # type: ignore[arg-type]
        direction=direction,  # type: ignore[arg-type]
        next_cursor=next_cursor,
    )
