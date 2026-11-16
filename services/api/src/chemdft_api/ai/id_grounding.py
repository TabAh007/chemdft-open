"""Grounding for the ids a page publishes (0.0.18): claims, jobs and compared results.

Only stored project records are read. An id that is not in this project is ignored with a
neutral note and never echoed back, so the answer cannot reveal whether it exists elsewhere.
No secret, raw log, diagnostic text or artifact bytes are read.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, defer

from ..context import Identity
from ..contracts.ai_foundation import GroundingFact, ProductSelection
from ..scientific_models import (
    CalculationResultRecord,
    ComputeJobRecord,
    ImportedResultRecord,
)

NOT_FOUND_NOTE = "A selected item was not found in this project and is not used."
GROUNDING_POLICY = (
    "grounding_facts are stored project records. State values only as listed there, with their "
    "evidence_class. If a requested fact is not listed, say it is not in the stored record. "
    "Never invent a value, citation, DOI or structure authority."
)
NOT_VERIFIED = "Not independently verified"
_MAX_TEXT = 300


def _evidence_class(authority: str | None, review: str | None) -> tuple[str, str | None]:
    """Existing vocabulary: CALCULATED, USER_ENTERED, else the source's own class (unverified)."""
    label = (authority or "UNKNOWN").upper()
    verified = (review or "").upper() in {"VERIFIED", "VALIDATED"}
    if label == "CALCULATED" and verified:
        return label, None
    return label, NOT_VERIFIED


def _text(value: Any) -> str | None:
    return None if value is None else str(value)[:_MAX_TEXT]


class IdGrounding:
    def __init__(self, session: Session, identity: Identity) -> None:
        self.session, self.identity = session, identity

    def resolve(
        self, project_id: str, hints: ProductSelection
    ) -> tuple[dict[str, Any], tuple[GroundingFact, ...], tuple[str, ...]]:
        """(verified selection fields, facts, notes). Ids outside the project are dropped."""
        facts: list[GroundingFact] = []
        ignored = 0
        verified: dict[str, Any] = {
            "compared_result_ids": None,
            "selected_claim_id": None,
            "selected_job_id": None,
        }
        if hints.selected_claim_id is not None:
            fact = self._claim(project_id, hints.selected_claim_id)
            if fact is None:
                ignored += 1
            else:
                facts.append(fact)
                verified["selected_claim_id"] = fact.entity_id
        if hints.selected_job_id is not None:
            fact = self._job(project_id, hints.selected_job_id)
            if fact is None:
                ignored += 1
            else:
                facts.append(fact)
                verified["selected_job_id"] = fact.entity_id
        if hints.compared_result_ids:
            kept: list[UUID] = []
            for result_id in dict.fromkeys(hints.compared_result_ids):
                fact = self._result(project_id, result_id)
                if fact is None:
                    ignored += 1
                else:
                    facts.append(fact)
                    kept.append(fact.entity_id)
            verified["compared_result_ids"] = tuple(kept) or None
        notes = (NOT_FOUND_NOTE,) if ignored else ()
        return verified, tuple(facts), notes

    # -- claim ---------------------------------------------------------------------------------
    def _claim(self, project_id: str, claim_id: UUID) -> GroundingFact | None:
        from ..scientific_claim_actions import get_project_scientific_claims

        claims = get_project_scientific_claims(self.session, self.identity, project_id).claims
        claim = next((c for c in claims if c.id == claim_id), None)
        if claim is None:
            return None
        evidence, note = _evidence_class(claim.source_authority, claim.review_state)
        facts: dict[str, str | float | int | bool | None] = {
            "statement": f"{claim.subject} {claim.predicate}"[:_MAX_TEXT],
            "claim_type": claim.claim_type,
            "value": claim.value
            if isinstance(claim.value, (str, int, float, bool))
            else _text(claim.value),
            "unit": claim.unit,
            "original_value_text": claim.original_value_text,
            "qualifier": _text(claim.qualifier),
            "source_authority": claim.source_authority,
            "review_state": claim.review_state,
            "source": _text(claim.source_label),
            "page": claim.page,
        }
        return GroundingFact(
            kind="claim",
            entity_id=claim.id,
            label=f"Claim: {claim.subject}"[:200],
            evidence_class=evidence,
            verification_note=note,
            facts={key: value for key, value in facts.items() if value is not None},
        )

    # -- job -----------------------------------------------------------------------------------
    def _job(self, project_id: str, job_id: UUID) -> GroundingFact | None:
        from ..calculation_actions import _compute_job_view

        record = self.session.scalar(
            select(ComputeJobRecord).where(
                ComputeJobRecord.id == str(job_id), ComputeJobRecord.project_id == project_id
            )
        )
        if record is None:
            return None
        view = _compute_job_view(self.session, record)
        spec = view.specification_summary
        structure = view.structure_summary
        execution = view.latest_execution
        facts: dict[str, str | float | int | bool | None] = {
            "kind": view.workload.workload_type,
            "status": str(getattr(view.state, "value", view.state)),
            "provider": view.provider,
            "attempts": view.attempt_count,
            "task": spec.task_type if spec else None,
            "method": spec.method if spec else None,
            "basis": spec.basis if spec else None,
            "charge": spec.charge if spec else None,
            "multiplicity": spec.multiplicity if spec else None,
            "structure": getattr(structure, "structure_name", None),
            "formula": getattr(structure, "formula_hill", None),
            "execution_state": str(getattr(execution.state, "value", execution.state))
            if execution
            else None,
            "failure_code": getattr(execution, "failure_code", None) if execution else None,
        }
        return GroundingFact(
            kind="job",
            entity_id=UUID(record.id),
            label=f"Job {record.id[:8]}",
            evidence_class="JOB_RECORD",
            verification_note="A job record is not a scientific result.",
            facts={key: value for key, value in facts.items() if value is not None},
        )

    # -- compared result -----------------------------------------------------------------------
    def _result(self, project_id: str, result_id: UUID) -> GroundingFact | None:
        model: type = CalculationResultRecord
        record = self.session.scalar(
            select(CalculationResultRecord)
            .where(
                CalculationResultRecord.id == str(result_id),
                CalculationResultRecord.project_id == project_id,
            )
            .options(defer(CalculationResultRecord.payload_json))
        )
        if record is None:
            model = ImportedResultRecord
            record = self.session.scalar(
                select(ImportedResultRecord)
                .where(
                    ImportedResultRecord.id == str(result_id),
                    ImportedResultRecord.project_id == project_id,
                )
                .options(defer(ImportedResultRecord.payload_json))
            )
        if record is None:
            return None
        evidence, note = _evidence_class(record.source_class, record.verification_state)
        facts: dict[str, str | float | int | bool | None] = {
            "result_type": record.result_type,
            "validation_state": record.validation_state,
            "authority": record.authority,
        }
        energy = self.session.scalar(
            select(model.payload_json["total_energy"]).where(model.id == record.id)
        )
        if isinstance(energy, dict) and isinstance(energy.get("value"), (float, int)):
            facts["total_energy"] = energy["value"]
            unit = energy.get("unit")
            facts["energy_unit"] = (
                str(unit.get("code", ""))[:40] if isinstance(unit, dict) else str(unit)[:40]
            )
        return GroundingFact(
            kind="compared_result",
            entity_id=UUID(record.id),
            label=f"Result: {record.result_type}"[:200],
            evidence_class=evidence,
            verification_note=note,
            facts={key: value for key, value in facts.items() if value is not None},
        )
