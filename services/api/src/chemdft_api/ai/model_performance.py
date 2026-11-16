"""Per-model operational metrics computed from records the AI Scientist already keeps.

No table, migration, prompt, response, structure or document is read or stored: only run status,
receipt status/latency/token counters, transport kinds and step outcome codes. The reader sees
only their own runs inside their organization. Everything here is observation, never a
benchmark: it does not rank models, estimate cost or certify scientific correctness.
"""

from collections import defaultdict

from sqlalchemy import select

from ..ai_models import AIModelInvocationRecord, AIRunRecord, AIRunStepRecord
from ..context import Identity
from ..contracts.ai_performance import (
    AIModelPerformanceView,
    LatencySummary,
    MetricDefinition,
    ModelPerformanceRow,
    PerformanceWindow,
    ProposalSummary,
    RequestOutcomes,
    RunOutcomes,
    TokenSummary,
    ToolCallSummary,
)
from ..models import Project

RUN_WINDOW = 500
P95_MINIMUM_OBSERVATIONS = 20
REJECTION_CODES = frozenset({"TOOL_REJECTED", "TOOL_NOT_IN_PROFILE"})
PROPOSAL_TOOL = "calculation.submit"
_TERMINAL = {"SUCCEEDED", "FAILED", "CANCELED"}

DEFINITIONS = (
    MetricDefinition(
        metric="Request latency",
        definition=(
            "Wall-clock time of one model HTTP request, from dispatch until the full response "
            "was read and parsed. Excludes budget reservation, tool execution, human approval "
            "waits and scientific calculation. Not time-to-first-token: responses are not "
            "streamed."
        ),
        measured_in="milliseconds",
        denominator="Successful requests with a recorded duration",
        missing_data="Null when there are no observations; p95 needs 20 or more.",
    ),
    MetricDefinition(
        metric="Timeout and provider-error counts",
        definition=(
            "Failed dispatched requests classified by the recorded transport kind: any timeout "
            "kind is a timeout; other recorded transport failures (HTTP, DNS, TLS, network, "
            "protocol) are provider errors; failures with no transport record are unclassified."
        ),
        measured_in="requests",
        denominator="Requests dispatched (not-dispatched and in-flight receipts are excluded)",
        missing_data="Unclassified failures are counted, never folded into another class.",
    ),
    MetricDefinition(
        metric="Token usage",
        definition="Sums of provider-reported input and output tokens.",
        measured_in="tokens",
        denominator="Requests whose provider reported both counts",
        missing_data="UNKNOWN (null), never zero, when no request reported usage.",
    ),
    MetricDefinition(
        metric="Tool-call conformance",
        definition=(
            "Model-emitted tool calls that passed ChemDFT's schema, scope and authorization "
            "checks, over all model-emitted calls. Execution of an already approved action is "
            "not a model call."
        ),
        measured_in="ratio 0-1",
        denominator="Model-emitted tool calls attributed to this model",
        missing_data="Null when the model emitted no tool calls.",
    ),
    MetricDefinition(
        metric="Proposal validity",
        definition=(
            "Calculation proposals that passed deterministic validation and reached a human "
            "approval, over proposals reaching validation. This is not scientific correctness "
            "and not human acceptance."
        ),
        measured_in="ratio 0-1",
        denominator="calculation.submit proposals reaching validation",
        missing_data="Null when the model made no calculation proposals.",
    ),
    MetricDefinition(
        metric="Run outcomes",
        definition="Final status of runs attributed to this model; includes human waits.",
        measured_in="runs",
        denominator="Runs with at least one dispatched or recorded model request",
        missing_data="Run wall time is deliberately not reported: it includes approval waits.",
    ),
)

LIMITATIONS = (
    "Observations come from your own runs in this organization only; no other user's data.",
    "Runs that used more than one model before run-level binding existed are listed as "
    "unattributed rather than assigned to a model.",
    "Offline fixture rows have synthetic timings and are not evidence about any real model.",
    "Counts are descriptive and carry no significance claim; small samples are not a benchmark.",
    "Time-to-first-token, tool execution time, scientific calculation time and cost are not "
    "measured here. Cost is never estimated without verified billing information.",
)


def _nearest_rank(values: list[int], percentile: int) -> int:
    """Nearest-rank percentile with integer arithmetic (no float rounding at boundaries)."""
    ordered = sorted(values)
    return ordered[max(1, (percentile * len(ordered) + 99) // 100) - 1]


def latency_summary(durations: list[int]) -> LatencySummary:
    if not durations:
        return LatencySummary(observations=0)
    return LatencySummary(
        observations=len(durations),
        median_ms=_nearest_rank(durations, 50),
        p95_ms=(
            _nearest_rank(durations, 95) if len(durations) >= P95_MINIMUM_OBSERVATIONS else None
        ),
        max_ms=max(durations),
    )


def classify_failure(reservation: dict | None) -> str:
    transport = (reservation or {}).get("transport")
    kind = transport.get("kind") if isinstance(transport, dict) else None
    if not isinstance(kind, str) or not kind:
        return "unclassified_failure"
    return "timeout" if "TIMEOUT" in kind else "provider_error"


class _Bucket:
    def __init__(self) -> None:
        self.counts: dict[str, int] = defaultdict(int)
        self.durations: list[int] = []
        self.input_tokens = 0
        self.output_tokens = 0

    def __getitem__(self, key: str) -> int:
        return self.counts[key]

    def add(self, key: str, amount: int = 1) -> None:
        self.counts[key] += amount


def _rate(good: int, total: int) -> float | None:
    return round(good / total, 4) if total else None


def model_performance(session, identity: Identity) -> AIModelPerformanceView:
    runs = session.execute(
        select(AIRunRecord.id, AIRunRecord.status, AIRunRecord.error_code)
        .join(Project, Project.id == AIRunRecord.project_id)
        .where(
            AIRunRecord.actor_id == identity.user_id,
            Project.organization_id == identity.organization_id,
        )
        .order_by(AIRunRecord.created_at.desc(), AIRunRecord.id)
        .limit(RUN_WINDOW + 1)
    ).all()
    truncated = len(runs) > RUN_WINDOW
    runs = runs[:RUN_WINDOW]
    run_status = {row.id: row.status for row in runs}
    run_error = {row.id: row.error_code for row in runs}
    run_ids = list(run_status)

    invocations = []
    steps = []
    for start in range(0, len(run_ids), 400):
        chunk = run_ids[start : start + 400]
        invocations += session.execute(
            select(
                AIModelInvocationRecord.run_id,
                AIModelInvocationRecord.provider,
                AIModelInvocationRecord.model,
                AIModelInvocationRecord.status,
                AIModelInvocationRecord.usage_status,
                AIModelInvocationRecord.input_tokens,
                AIModelInvocationRecord.output_tokens,
                AIModelInvocationRecord.latency_ms,
                AIModelInvocationRecord.reservation_json,
            ).where(AIModelInvocationRecord.run_id.in_(chunk))
        ).all()
        steps += session.execute(
            select(
                AIRunStepRecord.run_id,
                AIRunStepRecord.step_type,
                AIRunStepRecord.status,
                AIRunStepRecord.tool_name,
                AIRunStepRecord.error_code,
                AIRunStepRecord.step_number,
                AIRunStepRecord.tool_output_json,
            ).where(
                AIRunStepRecord.run_id.in_(chunk),
                AIRunStepRecord.step_type.in_(("APPROVAL_REQUEST", "TOOL_RESULT")),
            )
        ).all()

    buckets: dict[tuple[str, str], _Bucket] = defaultdict(_Bucket)
    models_by_run: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for row in invocations:
        key = (row.provider, row.model)
        models_by_run[row.run_id].add(key)
        bucket = buckets[key]
        if row.status == "NOT_DISPATCHED":
            bucket.add("not_dispatched")
        elif row.status == "RESERVED":
            bucket.add("in_flight")
        else:
            bucket.add("dispatched")
            if row.status == "SUCCEEDED":
                bucket.add("succeeded")
                if row.latency_ms and row.latency_ms > 0:
                    bucket.durations.append(row.latency_ms)
            else:
                bucket.add(classify_failure(row.reservation_json))
            if row.usage_status == "REPORTED" and None not in (
                row.input_tokens,
                row.output_tokens,
            ):
                bucket.add("tokens_reported")
                bucket.input_tokens += row.input_tokens
                bucket.output_tokens += row.output_tokens
            else:
                bucket.add("tokens_unknown")

    run_model: dict[str, tuple[str, str]] = {}
    unattributed = 0
    for run_id, used in models_by_run.items():
        if len(used) == 1:
            run_model[run_id] = next(iter(used))
        else:
            unattributed += 1

    # Proposal history per run, in step order: the stable refusal class, or None for a proposal
    # that reached approval. Only the class is read from the stored refusal; no text.
    proposal_events: dict[str, list[tuple[int, str | None]]] = defaultdict(list)
    for step in steps:
        if step.tool_name != PROPOSAL_TOOL:
            continue
        if step.step_type == "APPROVAL_REQUEST":
            proposal_events[step.run_id].append((step.step_number, None))
        elif step.error_code in REJECTION_CODES:
            refusal = (step.tool_output_json or {}).get("refusal")
            code = refusal.get("code") if isinstance(refusal, dict) else None
            proposal_events[step.run_id].append(
                (step.step_number, code if isinstance(code, str) and code.isupper() else "UNKNOWN")
            )
    reasons: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))

    approval_tools: dict[str, set[str]] = defaultdict(set)
    for step in steps:
        if step.step_type == "APPROVAL_REQUEST" and step.tool_name:
            approval_tools[step.run_id].add(step.tool_name)
    for step in steps:
        key = run_model.get(step.run_id)
        if key is None:
            continue
        bucket = buckets[key]
        proposal = step.tool_name == PROPOSAL_TOOL
        if step.step_type == "APPROVAL_REQUEST":
            bucket.add("tool_emitted")
            if proposal:
                bucket.add("proposal_validated")
        elif step.error_code in REJECTION_CODES:
            bucket.add("tool_emitted")
            bucket.add("tool_rejected")
            if step.error_code == "TOOL_NOT_IN_PROFILE":
                bucket.add("tool_outside_scope")
            if proposal:
                bucket.add("proposal_rejected")
        elif step.tool_name not in approval_tools[step.run_id] and step.status in {
            "SUCCEEDED",
            "FAILED",
        }:
            # A finished model-loop tool call; results of approved actions are human-decided.
            bucket.add("tool_emitted")
    for run_id, key in run_model.items():
        bucket = buckets[key]
        events = [code for _, code in sorted(proposal_events.get(run_id, []), key=lambda e: e[0])]
        if events and events[0] is None:
            bucket.add("proposal_first_attempt")
        if None in events:
            bucket.add("proposal_repairs", events.index(None))
        for code in events:
            if code is not None:
                reasons[key][code] += 1
        if run_error.get(run_id) == "PROPOSAL_NOT_REPAIRED":
            bucket.add("proposal_unrepaired")
    for run_id, key in run_model.items():
        status = run_status[run_id]
        bucket = buckets[key]
        bucket.add("runs")
        bucket.add("run_" + (status.lower() if status in _TERMINAL else "other"))

    rows = []
    for (provider, model), b in sorted(buckets.items()):
        rows.append(
            ModelPerformanceRow(
                model_provider=provider,
                model_name=model,
                synthetic=provider == "fake",
                requests=RequestOutcomes(
                    dispatched=b["dispatched"],
                    succeeded=b["succeeded"],
                    timeout=b["timeout"],
                    provider_error=b["provider_error"],
                    unclassified_failure=b["unclassified_failure"],
                    not_dispatched=b["not_dispatched"],
                    in_flight=b["in_flight"],
                ),
                request_latency=latency_summary(b.durations),
                tokens=TokenSummary(
                    requests_reported=b["tokens_reported"],
                    requests_unknown=b["tokens_unknown"],
                    input_tokens=b.input_tokens if b["tokens_reported"] else None,
                    output_tokens=b.output_tokens if b["tokens_reported"] else None,
                ),
                tool_calls=ToolCallSummary(
                    emitted=b["tool_emitted"],
                    rejected_by_validation=b["tool_rejected"],
                    outside_run_scope=b["tool_outside_scope"],
                    conformance_rate=_rate(
                        b["tool_emitted"] - b["tool_rejected"], b["tool_emitted"]
                    ),
                ),
                proposals=ProposalSummary(
                    validated_for_approval=b["proposal_validated"],
                    rejected_by_validation=b["proposal_rejected"],
                    validity_rate=_rate(
                        b["proposal_validated"], b["proposal_validated"] + b["proposal_rejected"]
                    ),
                    accepted_first_attempt=b["proposal_first_attempt"],
                    repairs_before_approval=b["proposal_repairs"],
                    unrepaired_runs=b["proposal_unrepaired"],
                    rejections_by_reason=dict(sorted(reasons[(provider, model)].items())),
                ),
                run_outcomes=RunOutcomes(
                    runs=b["runs"],
                    succeeded=b["run_succeeded"],
                    failed=b["run_failed"],
                    canceled=b["run_canceled"],
                    other=b["run_other"],
                ),
            )
        )
    return AIModelPerformanceView(
        window=PerformanceWindow(
            runs_considered=len(run_ids),
            invocations_considered=len(invocations),
            truncated=truncated,
            unattributed_runs=unattributed,
        ),
        rows=tuple(rows),
        metric_definitions=DEFINITIONS,
        caveats=LIMITATIONS,
    )
