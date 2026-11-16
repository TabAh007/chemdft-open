"""Atomic provider observations and append-only platform charges, never prices."""

import hashlib
import json
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import aliased

from ..ai_models import AIModelInvocationRecord
from ..billing_models import AIUsageLedgerEntryRecord
from ..billing_service import BillingService
from ..models import Project, new_id


def reserve_invocation(
    session,
    *,
    project_id,
    run_id,
    provider,
    model,
    mode,
    prompt_version,
    reservation=None,
    invocation_id=None,
    identity=None,
    settings=None,
):
    reservation = dict(reservation or {})
    if identity is not None and settings is not None:
        start, end = BillingService(session, identity, settings).ai_usage_period()
        reservation["billing_period_start"] = start.isoformat()
        reservation["billing_period_end"] = end.isoformat()
    row = AIModelInvocationRecord(
        id=invocation_id or new_id(),
        project_id=project_id,
        run_id=run_id,
        provider=provider,
        model=model,
        prompt_version=prompt_version,
        input_tokens=None,
        output_tokens=None,
        usage_status="UNKNOWN",
        latency_ms=0,
        status="RESERVED",
        reservation_json={"mode": mode, **reservation},
    )
    session.add(row)
    session.flush()
    return row


NOT_DISPATCHED_REASONS = frozenset(
    {
        "INPUT_RESERVATION_INSUFFICIENT",
        "OUTPUT_BUDGET_INSUFFICIENT",
        "CREDENTIAL_MISSING",
        "PROVIDER_NOT_CONFIGURED",
        "REQUEST_REJECTED_LOCALLY",
    }
)


def release_undispatched_invocation(session, invocation_id, *, reason, commit=True):
    """Close a RESERVED receipt whose request provably never left the process.

    No ledger entry is created: no provider observation exists, token columns stay NULL and
    ``usage_status`` stays UNKNOWN (never an invented zero). The receipt is marked
    NOT_DISPATCHED so crash recovery and the pending-usage count do not treat it as an
    uncertain, possibly-billed call. Compare-and-set makes duplicates and races no-ops; a
    receipt that already has an outcome is never rewritten. Returns True when this call
    closed the receipt.
    """
    if reason not in NOT_DISPATCHED_REASONS:
        raise ValueError("Unknown pre-dispatch release reason")
    row = session.scalar(
        select(AIModelInvocationRecord)
        .where(AIModelInvocationRecord.id == invocation_id)
        .execution_options(populate_existing=True)
    )
    if row is None or row.status != "RESERVED" or row.usage_status != "UNKNOWN":
        return False
    reservation = dict(row.reservation_json or {})
    reservation.update(
        dispatch_state="NOT_DISPATCHED",
        not_dispatched_reason=reason,
        released_input_tokens=int(reservation.get("input_tokens", 0)),
        released_output_tokens=int(reservation.get("output_tokens", 0)),
    )
    changed = session.execute(
        update(AIModelInvocationRecord)
        .where(
            AIModelInvocationRecord.id == row.id,
            AIModelInvocationRecord.status == "RESERVED",
            AIModelInvocationRecord.usage_status == "UNKNOWN",
            AIModelInvocationRecord.accounting_version == row.accounting_version,
        )
        .values(
            status="NOT_DISPATCHED",
            accounting_version=row.accounting_version + 1,
            reservation_json=reservation,
        )
        .execution_options(synchronize_session=False)
    )
    session.expire(row)
    if commit:
        session.commit()
    return changed.rowcount == 1


def finish_invocation(
    session, identity, settings, invocation_id, response=None, *, status="SUCCEEDED", commit=True
):
    """CAS the receipt and ledger in one transaction.

    A late reported response after uncertain recovery appends a USAGE_REPORT
    adjustment. It supersedes the unknown observation, never duplicates a
    platform charge. A duplicate receipt cannot create another ledger row.
    The caller may include its budget settlement in this same transaction.
    """
    row = session.scalar(
        select(AIModelInvocationRecord)
        .where(AIModelInvocationRecord.id == invocation_id)
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise ValueError("Usage reservation does not exist")
    project = session.get(Project, row.project_id)
    if project is None or project.organization_id != identity.organization_id:
        raise ValueError("Usage reservation belongs to another organization")
    if row.usage_status == "LEGACY_UNSPECIFIED":
        # Even a historical RESERVED/FAILED status is not a new reservation.
        # Do not overwrite its original counters during automatic recovery.
        return row, False, False
    usage = response.usage if response is not None else None
    counts = (response.reported_usage or {}) if response is not None else {}
    if usage is not None:
        counts = dict(
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cached_tokens=usage.cached_tokens,
        )
    observed = {
        name: counts.get(name) for name in ("input_tokens", "output_tokens", "cached_tokens")
    }
    for count in observed.values():
        if count is not None and (type(count) is not int or count < 0):
            raise ValueError("Invalid reported usage")
    original = None
    late = row.status != "RESERVED"
    if late:
        if row.usage_status == "LEGACY_UNSPECIFIED":
            return row, False, False
        adjustment = aliased(AIUsageLedgerEntryRecord)
        original = session.scalar(
            select(AIUsageLedgerEntryRecord)
            .where(
                AIUsageLedgerEntryRecord.model_invocation_id == row.id,
                ~select(adjustment.id)
                .where(
                    adjustment.adjustment_of_id == AIUsageLedgerEntryRecord.id,
                    adjustment.entry_kind == "USAGE_REPORT",
                )
                .exists(),
            )
            .order_by(AIUsageLedgerEntryRecord.created_at.desc())
        )
        previous = {
            "input_tokens": row.input_tokens,
            "output_tokens": row.output_tokens,
            "cached_tokens": original.cached_tokens if original else None,
        }
        new_information = False
        for name in observed:
            value = observed[name]
            if value is not None and previous[name] is not None and value != previous[name]:
                raise ValueError("Duplicate response has conflicting reported usage")
            new_information |= value is not None and previous[name] is None
            if value is None:
                observed[name] = previous[name]
        if not new_information:
            # Recovery may have charged the uncertain call before its transport failure arrives.
            # Retain that late diagnostic without a second charge, ledger entry or state change.
            transport = response.transport if response is not None else None
            reservation = dict(row.reservation_json or {})
            if (
                row.status == "FAILED_UNCERTAIN"
                and transport is not None
                and "transport" not in reservation
            ):
                session.execute(
                    update(AIModelInvocationRecord)
                    .where(
                        AIModelInvocationRecord.id == row.id,
                        AIModelInvocationRecord.status == "FAILED_UNCERTAIN",
                        AIModelInvocationRecord.accounting_version == row.accounting_version,
                    )
                    .values(
                        reservation_json={**reservation, "transport": transport.as_dict()},
                        latency_ms=transport.elapsed_ms,
                        accounting_version=row.accounting_version + 1,
                    )
                    .execution_options(synchronize_session=False)
                )
                session.expire(row)
                if commit:
                    session.commit()
            # False means no new accounting observation; callers must not settle again.
            return row, False, False
    reported = observed["input_tokens"] is not None and observed["output_tokens"] is not None
    usage_status = "REPORTED" if reported else "UNKNOWN"
    old_status = row.status
    reservation = dict(row.reservation_json or {})
    # These are quota charges, separately named from the observed columns.
    transport = response.transport if response is not None else None
    if transport is not None:
        reservation["transport"] = transport.as_dict()
    # Retain an earlier conservative charge after recovery; a later reported
    # count can increase it, but duplicate settlements never add it again.
    for name in ("input_tokens", "output_tokens"):
        previous = int(reservation.get(f"accounted_{name}", reservation.get(name, 0)))
        observed_count = observed[name]
        if late:
            amount = max(previous, observed_count or 0)
            reservation[f"settlement_delta_{name}"] = amount - previous
        else:
            amount = (
                observed_count
                if reported
                else max(int(reservation.get(name, 0)), observed_count or 0)
            )
        reservation[f"accounted_{name}"] = amount
    changed = session.execute(
        update(AIModelInvocationRecord)
        .where(
            AIModelInvocationRecord.id == row.id,
            AIModelInvocationRecord.status == old_status,
            AIModelInvocationRecord.usage_status == row.usage_status,
            AIModelInvocationRecord.accounting_version == row.accounting_version,
        )
        .values(
            accounting_version=row.accounting_version + 1,
            input_tokens=observed["input_tokens"],
            output_tokens=observed["output_tokens"],
            usage_status=usage_status,
            reservation_json=reservation,
            status=status,
            latency_ms=(
                usage.latency_ms
                if usage is not None
                else transport.elapsed_ms
                if transport is not None
                else row.latency_ms
            ),
        )
        .execution_options(synchronize_session=False)
    )
    if changed.rowcount != 1:
        session.expire(row)
        return row, False, False
    usage_period = None
    if original is not None:
        usage_period = (original.period_start, original.period_end)
    elif reservation.get("billing_period_start") and reservation.get("billing_period_end"):
        usage_period = (
            datetime.fromisoformat(reservation["billing_period_start"]),
            datetime.fromisoformat(reservation["billing_period_end"]),
        )
    BillingService(session, identity, settings).record_ai_usage(
        project_id=row.project_id,
        model_invocation_id=row.id,
        provider=row.provider,
        model=row.model,
        mode=(row.reservation_json or {}).get("mode", "MANAGED"),
        **observed,
        usage_status=usage_status,
        commit=False,
        idempotency_key=f"ai-invocation:{row.id}"
        + (
            ":report:" + hashlib.sha256(json.dumps(observed, sort_keys=True).encode()).hexdigest()
            if late
            else ""
        ),
        entry_kind="USAGE_REPORT" if late else "USAGE",
        adjustment_of_id=original.id if original else None,
        usage_period=usage_period,
        # This code applies no new platform tariff. Provider cost stays NULL.
        billable_minor_units=0,
    )
    session.expire(row)
    if commit:
        session.commit()
    return row, True, late
