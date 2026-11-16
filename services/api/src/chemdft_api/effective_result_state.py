"""One uncached projection of current usability, preserving stored scientific axes.

Callers must authorize project access first. Every dependency query is project-scoped.
No result/provenance row is mutated; append-only status successors remain audit evidence.
"""

from __future__ import annotations

import hashlib
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import defer

from .contracts.result_state import EffectiveResultState
from .errors import ScientificValidationFailed
from .scientific_models import CalculationRecord, CalculationResultRecord, ProvenanceRecordRow


def effective_result_state(session, record, *, _seen=frozenset()):
    # populate_existing avoids trusting a worker's earlier ORM identity-map snapshot.
    current = (
        session.scalar(
            select(CalculationResultRecord)
            .where(
                CalculationResultRecord.id == record.id,
                CalculationResultRecord.project_id == record.project_id,
            )
            .options(defer(CalculationResultRecord.payload_json))
            .execution_options(populate_existing=True)
        )
        if session
        else None
    )
    row = current or record
    state = "ACTIVE"
    inactive = []
    if session is None or current is None or row.id in _seen:
        state = "INVALIDATED"
    else:
        provenance = session.scalar(
            select(ProvenanceRecordRow)
            .where(
                ProvenanceRecordRow.id == row.provenance_record_id,
                ProvenanceRecordRow.project_id == row.project_id,
            )
            .execution_options(populate_existing=True)
        )
        successors = session.scalars(
            select(ProvenanceRecordRow)
            .where(
                ProvenanceRecordRow.supersedes_id == row.provenance_record_id,
                ProvenanceRecordRow.project_id == row.project_id,
            )
            .execution_options(populate_existing=True)
        ).all()
        statuses = {row.verification_state, *(p.verification_state for p in successors)}
        if provenance:
            statuses.add(provenance.verification_state)
        if "RETRACTED" in statuses:
            state = "RETRACTED"
        elif "DISPUTED" in statuses or row.validation_state == "DISPUTED":
            state = "DISPUTED"
        elif "SUPERSEDED" in statuses or row.validation_state == "SUPERSEDED" or successors:
            state = "SUPERSEDED"
        elif (
            provenance is None
            or row.authority != "AUTHORITATIVE"
            or row.validation_state != "VALIDATED"
        ):
            state = "INVALIDATED"
        if state == "ACTIVE" and row.result_type == "chemdft.dispersion-corrected-energy":
            try:
                payload = session.scalar(
                    select(CalculationResultRecord.payload_json).where(
                        CalculationResultRecord.id == row.id,
                        CalculationResultRecord.project_id == row.project_id,
                    )
                )
                binding = payload["source"]
                source = session.scalar(
                    select(CalculationResultRecord)
                    .where(
                        CalculationResultRecord.id == str(binding["result_id"]),
                        CalculationResultRecord.project_id == row.project_id,
                    )
                    .execution_options(populate_existing=True)
                )
                if source is None or str(binding["project_id"]) != row.project_id:
                    state = "INVALIDATED"
                else:
                    dependency = effective_result_state(session, source, _seen=_seen | {row.id})
                    state = dependency.source_lineage_validity
                    inactive.extend(dependency.inactive_result_ids)
                    payload_hash = hashlib.sha256(
                        json.dumps(
                            source.payload_json, sort_keys=True, separators=(",", ":")
                        ).encode()
                    ).hexdigest()
                    calc = session.scalar(
                        select(CalculationRecord)
                        .where(
                            CalculationRecord.id == source.calculation_id,
                            CalculationRecord.project_id == row.project_id,
                        )
                        .execution_options(populate_existing=True)
                    )
                    if (
                        payload_hash != binding["result_payload_sha256"]
                        or source.calculation_id != str(binding["calculation_id"])
                        or source.calculation_input_id != str(binding["calculation_input_id"])
                        or source.provenance_record_id != str(binding["provenance_id"])
                        or calc is None
                        or calc.state != "SUCCEEDED"
                    ):
                        state = "INVALIDATED"
            except (KeyError, TypeError, ValueError):
                state = "INVALIDATED"
    if state != "ACTIVE":
        inactive.append(UUID(row.id))
    return EffectiveResultState(
        stored_authority=row.authority,
        stored_validation_state=row.validation_state,
        stored_verification_state=row.verification_state,
        authority=row.authority if state == "ACTIVE" else "CANDIDATE",
        validation_state=row.validation_state
        if state == "ACTIVE"
        else ("SUPERSEDED" if state == "SUPERSEDED" else "DISPUTED"),
        # Loss of a dependency is not evidence about independent verification.
        verification_state=row.verification_state,
        source_lineage_validity=state,
        eligible_for_derivation=state == "ACTIVE",
        inactive_result_ids=tuple(dict.fromkeys(inactive)),
        reason=None
        if state == "ACTIVE"
        else f"Historical result; current source lineage is {state}.",
    )


def require_current_result(session, record):
    state = effective_result_state(session, record)
    if not state.eligible_for_derivation:
        raise ScientificValidationFailed(state.reason)
    return state
