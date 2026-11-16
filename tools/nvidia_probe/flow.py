"""Run ChemDFT's real AI Scientist service on a disposable replica with an injected model gateway.

Why this exists: the probe's PROPOSAL case sends a compact stand-in request and judges the first
reply only. Production sends the full planning request (system policy, ProductContext, both energy
tools with their complete schemas) and, when a tool call is refused, returns the server's message to
the model and continues for up to `ai_max_tool_steps` steps. This harness drives that exact service,
`AIScientistService.post_message` with the PYSCF_ENERGY_PROPOSAL profile, against a replica project
holding the supplied H2 (see replica.py). Production's own argument normalization, schema check,
planning-profile guard, compute guidance and repair loop all run; only the model behind the gateway
is injected. A proposal that reaches the approval step is left PENDING: nothing is ever approved,
no calculation or compute job is created, and no scientific engine runs (compute guidance only asks
the configured PySCF worker for its version, as every approval-flow test does).

Content-free: the verdict holds statuses, error codes, token counts, latencies, tool names and a
hash of the normalized proposal. It never holds a prompt, a reply, an argument value or a
validation message. No network and no credentials here; a real gateway is wrapped by
BudgetedFlowGateway.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from uuid import UUID

from .authorization import AuthorizationError
from .ledger import BudgetLedger, BudgetStop
from .molecules import case_by_id, reference_molecules
from .plan import _canonical_hash, fixture_sha256
from .replay import adherence_codes, case_adherence_codes
from .replica import Replica

SAMPLING_MODES = ("MODEL_CARD_PROFILE", "PRODUCTION_DEFAULT")
INPUT_BASES = ("CONSERVATIVE_FLOOR", "SERVICE_RESERVATION")
# Planning allowance, in tokens beyond the previous reply's own length, for the framing and the
# server's message that each repair request adds to the history. The ledger enforces the real
# size at run time; this only sizes the plan.
REPAIR_FRAMING_TOKENS = 512
FREE_ALLOWANCE_STOP_STATUSES = frozenset({402, 429})
REPLICA_PROVIDER = "fake"  # the replica's own provider label; the real identity is checked here
_SAFE_TOOL = re.compile(r"[A-Za-z][A-Za-z0-9_.]{0,63}")
_SAFE_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,63}")
_SAFE_FIELD = re.compile(r"[A-Za-z_][A-Za-z0-9_.\[\]]{0,79}")


def _field(value) -> str | None:
    if value is None:
        return None
    return str(value) if _SAFE_FIELD.fullmatch(str(value)) else "OTHER"


def _tool(name) -> str | None:
    if name is None:
        return None
    return name if _SAFE_TOOL.fullmatch(str(name)) else "<tool>"


def _code(value) -> str | None:
    if value is None:
        return None
    text = str(getattr(value, "value", value))
    return text if _SAFE_CODE.fullmatch(text) else "OTHER"


_LAST_REQUEST_AT: dict[str, float] = {}  # authorization sha256 -> clock time the last request ended


class BudgetedFlowGateway:
    """Adapts a real gateway to the production flow without changing what the service sends.

    It swaps the model identifier and, optionally, applies the model's documented sampling profile;
    it admits every request against the authorization's ledger (calls, tokens, wall clock), makes
    one attempt, verifies the response identity, and records content-free metadata. The service sees
    the replica's own provider label, so production's accounting never meets an unknown model.
    """

    def __init__(
        self,
        inner,
        authorization,
        model: str,
        *,
        sampling: str = "MODEL_CARD_PROFILE",
        input_basis: str = "CONSERVATIVE_FLOOR",
        input_floor: float = 1.0,
        ledger: BudgetLedger | None = None,
        started: float | None = None,
        clock=time.monotonic,
        sleep=time.sleep,
    ) -> None:
        from chemdft_api.ai.model_catalog import sampling_profile

        if sampling not in SAMPLING_MODES:
            raise ValueError(f"sampling must be one of {SAMPLING_MODES}")
        if input_basis not in INPUT_BASES:
            raise ValueError(f"input_basis must be one of {INPUT_BASES}")
        if model not in authorization.models:
            raise AuthorizationError("MODEL_NOT_AUTHORIZED", model)
        self._profile = sampling_profile(model) if sampling == "MODEL_CARD_PROFILE" else None
        if sampling == "MODEL_CARD_PROFILE" and self._profile is None:
            raise AuthorizationError("MODEL_HAS_NO_SAMPLING_PROFILE", model)
        self._inner = inner
        self._authorization = authorization
        self._model = model
        self._sampling = sampling
        self._basis = input_basis
        self._floor = input_floor
        self._clock = clock
        self._sleep = sleep
        # One ledger and one clock can be shared by every model of a run, so the aggregate
        # ceilings bind the whole run and not each model separately.
        self._started = clock() if started is None else started
        self.ledger = ledger if ledger is not None else BudgetLedger(authorization)
        self.records: list[dict] = []
        self.stopped_by: str | None = None

    def summary(self) -> dict:
        return {
            "model": self._model,
            "sampling": self._sampling,
            "input_token_basis": self._basis,
            "requests": list(self.records),
            "stopped_by": self.stopped_by,
            "calls_admitted": self.ledger.calls_admitted,
            "committed_tokens_upper_bound": self.ledger.committed_tokens,
            "unknown_usage_calls": self.ledger.unknown_usage_calls,
        }

    def generate(self, request):
        from chemdft_api.ai.gateway import (
            ModelAuthenticationError,
            ModelGatewayError,
            ModelRateLimitError,
            ModelRequestNotSentError,
            ModelTimeoutError,
            request_input_bound,
        )
        from chemdft_api.ai.http_transport import TransportDiagnostic
        from chemdft_api.ai.model_performance import classify_failure

        from .runner import WallClockExceeded, _call_with_wall_clock

        profile, auth = self._profile, self._authorization
        outbound = replace(
            request,
            model_identifier=self._model,
            max_attempts=1,  # retries are disabled; the service's own steps are the only repeats
            temperature=profile.temperature if profile else request.temperature,
            top_p=profile.top_p if profile else request.top_p,
            chat_template_kwargs=profile.chat_template_kwargs
            if profile
            else request.chat_template_kwargs,
        )
        reserved = request.reserved_input_tokens
        bound = (
            reserved
            if self._basis == "SERVICE_RESERVATION" and reserved
            else request_input_bound(outbound, self._floor).tokens
        )
        record = {
            "index": len(self.records) + 1,
            "input_token_bound": bound,
            "output_token_cap": outbound.max_tokens,
            "sampling": {
                "temperature": outbound.temperature,
                "top_p": outbound.top_p,
                "chat_template_kwargs": dict(outbound.chat_template_kwargs or ()) or None,
                "source": self._sampling,
            },
        }
        gap = auth.flow.min_seconds_between_requests if auth.flow is not None else 0
        previous = _LAST_REQUEST_AT.get(auth.sha256)
        if gap and previous is not None and (wait := previous + gap - self._clock()) > 0:
            self._sleep(wait)  # pacing for a low rate tier; counted in the wall clock below
        try:
            self.ledger.admit(
                input_bound=bound,
                output_cap=outbound.max_tokens or 0,
                elapsed_seconds=self._clock() - self._started,
            )
        except BudgetStop as stop:
            record.update(outcome="NOT_SENT_BUDGET_STOP", stop_reason=stop.reason)
            self.records.append(record)
            self.stopped_by = stop.reason
            raise ModelRequestNotSentError("The harness budget refused this request.") from None
        began = self._clock()
        try:
            response = _call_with_wall_clock(
                self._inner, outbound, auth.per_call_wall_clock_seconds
            )
        except WallClockExceeded:
            self.ledger.settle(None)
            elapsed = int((self._clock() - began) * 1000)
            record.update(outcome="WALL_CLOCK_EXCEEDED", duration_ms=elapsed)
            self.records.append(record)
            self.stopped_by = "WALL_CLOCK_EXCEEDED"
            raise ModelTimeoutError(
                "The harness wall clock for one request was exceeded.",
                transport=TransportDiagnostic(
                    phase="RESPONSE_BODY",
                    kind="READ_TIMEOUT",
                    elapsed_ms=elapsed,
                    timeout_seconds=auth.per_call_wall_clock_seconds,
                ),
            ) from None
        except ModelGatewayError as error:
            transport = error.transport.as_dict() if error.transport else None
            usage = (
                (error.usage.input_tokens, error.usage.output_tokens)
                if getattr(error, "usage", None)
                else None
            )
            self.ledger.settle(usage if error.request_sent else (0, 0))
            status = transport.get("http_status") if transport else None
            record.update(
                outcome="TIMEOUT" if isinstance(error, ModelTimeoutError) else "PROVIDER_ERROR",
                failure_class=classify_failure({"transport": transport}),
                http_status=status,
                request_sent=error.request_sent,
                error_type=type(error).__name__,
                duration_ms=int((self._clock() - began) * 1000),
            )
            self.records.append(record)
            if isinstance(error, ModelAuthenticationError):
                self.stopped_by = "AUTHENTICATION_FAILED"
            elif status in FREE_ALLOWANCE_STOP_STATUSES or isinstance(error, ModelRateLimitError):
                self.stopped_by = f"PROVIDER_REFUSED_HTTP_{status or 429}"
            raise
        except Exception as error:  # an unclassified local failure: keep the evidence, fail the run
            self.ledger.settle(None)
            record.update(
                outcome="UNEXPECTED_ERROR",
                error_type=type(error).__name__,
                duration_ms=int((self._clock() - began) * 1000),
            )
            self.records.append(record)
            self.stopped_by = "UNEXPECTED_ERROR"
            raise
        finally:
            _LAST_REQUEST_AT[auth.sha256] = self._clock()
        usage = (
            (response.usage.input_tokens, response.usage.output_tokens) if response.usage else None
        )
        self.ledger.settle(usage)
        identity_ok = (
            response.provider == getattr(auth, "provider", "nvidia")
            and response.model_identifier == self._model
        )
        record.update(
            outcome="SUCCEEDED" if identity_ok else "MODEL_IDENTITY_MISMATCH",
            duration_ms=int((self._clock() - began) * 1000),
            input_tokens=usage[0] if usage else "UNKNOWN",
            output_tokens=usage[1] if usage else "UNKNOWN",
            finish_reason=response.finish_reason,
            tool_calls=[_tool(call.name) for call in (response.tool_calls or ())],
        )
        self.records.append(record)
        if not identity_ok:
            self.stopped_by = "MODEL_IDENTITY_MISMATCH"
            raise ModelGatewayError("The response came from another provider or model.")
        return replace(
            response, provider=REPLICA_PROVIDER, model_identifier=request.model_identifier
        )


class ProductionFlow:
    """One disposable replica; each `run` gets a fresh project and a fresh conversation."""

    def __init__(self, replica: Replica, fixture: dict) -> None:
        self._replica = replica
        self._fixture = fixture
        # The last conversation detail the service returned. Offline tests read it (run view,
        # blocker, messages); it is deliberately not part of the content-free verdict.
        self.last_detail = None
        self.last_project = None

    @classmethod
    def build(cls, fixture: dict) -> ProductionFlow:
        return cls(Replica.build(), fixture)

    def close(self) -> None:
        self._replica.close()

    def __enter__(self) -> ProductionFlow:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def run(
        self,
        gateway,
        *,
        max_model_calls: int = 4,
        prompt: str | None = None,
        molecule=None,
        case=None,
    ) -> dict:
        from chemdft_api.ai.service import AIScientistService
        from chemdft_api.contracts.ai import (
            AIRunLimitsInput,
            CreateConversationInput,
            PostMessageInput,
        )

        if case is not None:  # a planning case (molecules.py) supplies what it names
            prompt = prompt or case.prompt
            molecule = molecule or reference_molecules()[case.molecule]
        replica = self._replica
        project = replica.new_project(molecule)
        self.last_project = project
        with replica.sessions() as session:
            service = AIScientistService(
                session, replica.identity, replica.store, replica.settings, gateway
            )
            conversation = service.create_conversation(
                project.project_id, CreateConversationInput()
            )
            conversation_id = str(conversation.conversation.id)
            payload = PostMessageInput(
                content=prompt or self._fixture["user_prompt"],
                mode="STANDARD",
                planning_profile="PYSCF_ENERGY_PROPOSAL",
                selected_structure_version_id=UUID(project.version_id),
                run_limits=AIRunLimitsInput(max_model_calls=max_model_calls),
            )
            refused = None
            self.last_detail = None
            try:
                self.last_detail = service.post_message(
                    project.project_id, conversation_id, payload
                )
            except Exception as error:  # a refusal before or after the run: keep the code only
                refused = _code(getattr(error, "code", None)) or type(error).__name__[:48]
            verdict = _verdict(session, project.project_id, conversation_id, refused, case)
        summary = getattr(gateway, "summary", None)
        if callable(summary):
            verdict["gateway"] = summary()
        return verdict


def _verdict(
    session, project_id: str, conversation_id: str, refused: str | None, case=None
) -> dict:
    from chemdft_api.ai_models import (
        AIApprovalRecord,
        AIModelInvocationRecord,
        AIRunRecord,
        AIRunStepRecord,
    )
    from chemdft_api.scientific_models import CalculationRecord, ComputeJobRecord
    from sqlalchemy import func, select

    fresh = {"populate_existing": True}
    run = session.scalar(
        select(AIRunRecord)
        .where(AIRunRecord.project_id == project_id, AIRunRecord.conversation_id == conversation_id)
        .order_by(AIRunRecord.created_at.desc())
        .execution_options(**fresh)
    )
    verdict: dict = {
        "flow": "REAL_AI_SCIENTIST_SERVICE",
        "refused": refused,
        "run_status": run.status if run else None,
        "run_error_code": _code(run.error_code) if run else None,
    }
    steps: list[dict] = []
    approvals: list[dict] = []
    invocations: list[dict] = []
    # What the service's own request check found for the proposal that reached approval:
    # parameter name -> outcome code, never a value.
    request_check: dict[str, str | None] = {}
    if run is not None:
        for row in session.scalars(
            select(AIRunStepRecord)
            .where(AIRunStepRecord.run_id == run.id)
            .order_by(AIRunStepRecord.step_number, AIRunStepRecord.created_at)
            .execution_options(**fresh)
        ):
            output = row.tool_output_json or {}
            diagnostics = output.get("operational_diagnostics") or {}
            refusal = output.get("refusal") or {}
            if row.step_type == "APPROVAL_REQUEST":
                for item in (output.get("proposal") or {}).get("request_match") or []:
                    request_check[_field(item.get("parameter"))] = _code(item.get("outcome"))
            steps.append(
                {
                    "step": row.step_number,
                    "type": row.step_type,
                    "status": row.status,
                    "tool": _tool(row.tool_name),
                    "error_code": _code(row.error_code),
                    "diagnostic": _code(diagnostics.get("code")),
                    # Server-authored refusal class and the fields it named (no values).
                    "refusal": _code(refusal.get("code")),
                    "refusal_fields": [
                        _field(issue.get("field")) for issue in (refusal.get("issues") or [])
                    ][:8],
                }
            )
        for row in session.scalars(
            select(AIModelInvocationRecord)
            .where(AIModelInvocationRecord.run_id == run.id)
            .order_by(AIModelInvocationRecord.created_at)
            .execution_options(**fresh)
        ):
            invocations.append(
                {
                    "status": row.status,
                    "latency_ms": row.latency_ms,
                    "input_tokens": row.input_tokens,
                    "output_tokens": row.output_tokens,
                    "usage_status": row.usage_status,
                }
            )
        for row in session.scalars(
            select(AIApprovalRecord)
            .where(AIApprovalRecord.run_id == run.id)
            .execution_options(**fresh)
        ):
            arguments = row.normalized_arguments_json
            if case is None:
                codes = adherence_codes(arguments["specification"])
            elif case.kind == "PROPOSE":
                codes = case_adherence_codes(arguments["specification"], case.expect)
            else:  # the request names something this server cannot run: any approval is wrong
                codes = ["REQUEST_CANNOT_BE_MET"]
            approvals.append(
                {
                    "tool": _tool(row.tool_name),
                    "status": row.status,
                    "decided": row.decided_by is not None,
                    "arguments_sha256": _canonical_hash(arguments),
                    "adherence_failure_codes": codes,
                    "valid_for_prompt": not codes,
                    "request_check": dict(request_check),
                }
            )
    repairs = sum(1 for s in steps if s["tool"] == "calculation.submit" and s["status"] == "FAILED")
    result = (
        "NO_PROPOSAL"
        if not approvals
        else "PROPOSAL_VALID_FOR_PROMPT"
        if approvals[0]["valid_for_prompt"]
        else "PROPOSAL_WRONG_FOR_PROMPT"
    )
    if case is not None:
        # A case either asks for a proposal that must match, or for something this server cannot
        # run, where the right outcome is no proposal at all.
        verdict["case_expectation_met"] = result == (
            "PROPOSAL_VALID_FOR_PROMPT" if case.kind == "PROPOSE" else "NO_PROPOSAL"
        )
    verdict.update(
        steps=steps,
        model_invocations=invocations,
        repairs=repairs,
        approvals=approvals,
        result=result,
        first_attempt_accepted=bool(approvals) and repairs == 0,
        side_effects={
            "approvals_decided": sum(1 for a in approvals if a["decided"]),
            "calculations": session.scalar(
                select(func.count())
                .select_from(CalculationRecord)
                .where(CalculationRecord.project_id == project_id)
            ),
            "compute_jobs": session.scalar(
                select(func.count())
                .select_from(ComputeJobRecord)
                .where(ComputeJobRecord.project_id == project_id)
            ),
        },
    )
    return verdict


class _CaptureGateway:
    """Answers once with plain text so the real service builds its first request and stops."""

    def __init__(self) -> None:
        self.requests: list = []

    def generate(self, request):
        from chemdft_api.ai.gateway import ModelResponse, ModelUsage

        self.requests.append(request)
        return ModelResponse(
            content="Done.",
            usage=ModelUsage(1, 1, 1),
            model_identifier=request.model_identifier,
            provider=REPLICA_PROVIDER,
        )


def measure_first_request(flow: ProductionFlow, case=None) -> dict:
    """Size of the request production sends first: built by the real service, no model asked.

    With a planning case it is the request for that case's prompt on that case's molecule.
    """
    from chemdft_api.ai.gateway import request_input_bound

    capture = _CaptureGateway()
    if case is None:
        flow.run(capture, max_model_calls=1)
    else:
        flow.run(capture, max_model_calls=1, case=case)
    request = capture.requests[0]
    return {
        "reserved_input_tokens": request.reserved_input_tokens,
        "conservative_input_bound": request_input_bound(request, 1.0).tokens,
        "input_bytes_per_token_floor": request.input_bytes_per_token_floor,
        "output_token_cap": request.max_tokens,
        "tools": sorted(tool.name for tool in request.tools),
    }


def measure_flow(flow: ProductionFlow, auth) -> dict:
    """The measured first request of every distinct flow: one dict, or one per authorized case."""
    if not auth.flow.cases:
        return measure_first_request(flow)
    return {
        case_id: measure_first_request(flow, case_by_id(case_id)) for case_id in auth.flow.cases
    }


def plan_flow(auth, measurement: dict) -> dict:
    """Worst-case plan for a flow authorization, from the real request's measured size.

    Each model may make `max_model_calls_per_model` requests; the k-th carries k earlier replies and
    server messages, planned at `output cap + REPAIR_FRAMING_TOKENS` tokens each. The plan keeps the
    largest `max_total_calls` of those requests and must leave the same 40% margin as a probe.
    With reference cases `measurement` maps each case id to its own measured first request, every
    model runs every case, and the largest requests across all cases are the ones planned for.
    `refusal` is None or a (code, detail) pair; the ledger enforces real sizes at run time.
    """
    from .runner import MAX_PLANNED_UTILIZATION

    ledger = BudgetLedger(auth)
    out = auth.max_output_tokens_per_request
    growth = out + REPAIR_FRAMING_TOKENS
    reference = bool(auth.flow.cases)
    first_requests = (
        {case_id: measurement[case_id] for case_id in auth.flow.cases}
        if reference
        else {None: measurement}
    )
    sizes = [
        first["reserved_input_tokens"] + step * growth
        for first in first_requests.values()
        for step in range(auth.flow.max_model_calls_per_model)
    ]
    worst = sorted(
        (ledger.worst_case(size, out) for size in sizes for _ in auth.models),
        key=lambda pair: pair[0],
        reverse=True,
    )[: auth.max_total_calls]
    tokens = sum(pair[0] for pair in worst)
    usd = sum(pair[1] or 0 for pair in worst)
    plan = {
        ("service_requests" if reference else "service_request"): (
            first_requests if reference else measurement
        ),
        "planned_requests": len(worst),
        "largest_planned_input_tokens": max(sizes),
        "planned_worst_case_tokens": tokens,
        "token_ceiling": auth.max_total_tokens,
        "planned_worst_case_utilization": round(tokens / auth.max_total_tokens, 3),
        "worst_case_usd": round(usd, 6) if auth.spend_control.kind == "USD_CEILING" else "UNKNOWN",
        "refusal": None,
    }
    if reference:
        plan["reference_cases"] = {"ids": list(auth.flow.cases), "sha256": auth.flow.cases_sha256}
        plan["planned_flows"] = len(auth.models) * len(auth.flow.cases)
    requested_output = max(first["output_token_cap"] for first in first_requests.values())
    if requested_output > out:
        plan["refusal"] = (
            "REFUSED_OUTPUT_CAP",
            f"the service requests {requested_output} output tokens per request; "
            f"the authorization allows {out}",
        )
    elif max(sizes) > auth.max_input_tokens_per_request:
        plan["refusal"] = (
            "REFUSED_INPUT_CAP",
            f"the largest planned request is {max(sizes)} input tokens; "
            f"the authorization allows {auth.max_input_tokens_per_request}",
        )
    elif auth.max_total_calls * auth.per_call_wall_clock_seconds > auth.max_wall_clock_seconds:
        plan["refusal"] = (
            "REFUSED_WALL_CLOCK",
            f"{auth.max_total_calls} requests at {auth.per_call_wall_clock_seconds} s do not fit "
            f"in {auth.max_wall_clock_seconds} s",
        )
    elif tokens > MAX_PLANNED_UTILIZATION * auth.max_total_tokens:
        margin = round((1 - MAX_PLANNED_UTILIZATION) * 100)
        plan["refusal"] = (
            "REFUSED_INSUFFICIENT_MARGIN",
            f"the planned worst case uses {tokens} of {auth.max_total_tokens} tokens; at least "
            f"{margin}% of the ceiling must remain as margin",
        )
    elif auth.spend_control.kind == "USD_CEILING" and usd > auth.spend_control.ceiling_usd:
        plan["refusal"] = ("REFUSED_USD_CEILING", "planned worst-case spend exceeds the ceiling")
    return plan


@dataclass(slots=True)
class FlowReport:
    authorization_sha256: str
    fixture_sha256: str
    started_at: str
    service_request: dict
    flows: list[dict] = field(default_factory=list)
    stopped_by: str | None = None
    totals: dict = field(default_factory=dict)
    # Reference-molecule mode: the case ids, the digest they were authorized under and the
    # measured first request of each ("service_request" is then empty).
    reference_cases: dict | None = None

    def as_dict(self) -> dict:
        report = {
            "report_kind": "PRODUCTION_FLOW_PROBE",
            "comparability": "NONE: single runs of the real service; not a benchmark or ranking",
            "authorization_sha256": self.authorization_sha256,
            "fixture_sha256": self.fixture_sha256,
            "started_at": self.started_at,
            "stopped_by": self.stopped_by,
            "service_request": self.service_request,
            "totals": self.totals,
            "flows": self.flows,
            "hosted_verification_claim": "NONE: a flow result is evidence, not a registry change",
        }
        if self.reference_cases is not None:
            report["reference_cases"] = self.reference_cases
        return report


def run_flow_probe(
    auth, gateway, *, flow: ProductionFlow, measurement: dict, clock=time.monotonic
) -> FlowReport:
    """One production flow per authorized model (and case), sequentially, under one shared ledger.

    Without cases that is the supplied-H2 flow once per model. With reference cases it is every case
    in the authorized order and, within a case, every model in the authorized order, each on a fresh
    project holding the case's molecule. A flow may not use requests that later flows still need:
    each keeps at least one. Every request any flow makes is admitted by the authorization's ledger.
    Provider errors and timeouts are recorded and the next flow still runs; a payment or rate-limit
    refusal, a failed credential, a foreign response, a hung request or any exhausted ceiling stops
    the whole run.
    """
    ledger = BudgetLedger(auth)
    started = clock()
    cases = [case_by_id(case_id) for case_id in auth.flow.cases]
    report = FlowReport(
        auth.sha256,
        fixture_sha256(),
        datetime.now(UTC).isoformat(timespec="seconds"),
        {} if cases else measurement,
        reference_cases={
            "ids": list(auth.flow.cases),
            "sha256": auth.flow.cases_sha256,
            "service_requests": measurement,
        }
        if cases
        else None,
    )
    plan = [(case, model) for case in (cases or [None]) for model in auth.models]
    for position, (case, model) in enumerate(plan):
        adapter = BudgetedFlowGateway(
            gateway,
            auth,
            model,
            sampling=auth.sampling,
            input_basis=auth.flow.input_token_basis,
            ledger=ledger,
            started=started,
            clock=clock,
        )
        limit = auth.flow.max_model_calls_per_model
        if case is not None:
            remaining = auth.max_total_calls - ledger.calls_admitted
            limit = max(1, min(limit, remaining - (len(plan) - position - 1)))
        try:
            verdict = (
                flow.run(adapter, max_model_calls=limit)
                if case is None
                else flow.run(adapter, max_model_calls=limit, case=case)
            )
        except Exception as error:  # keep the evidence, stop safely
            failed = {
                "model": model,
                "flow": "REAL_AI_SCIENTIST_SERVICE",
                "error_type": type(error).__name__,
            }
            if case is not None:
                failed["case"] = case.id
            report.flows.append(failed)
            report.stopped_by = "UNEXPECTED_ERROR"
            break
        verdict["model"] = model
        if case is not None:
            verdict.update(case=case.id, molecule=case.molecule, case_kind=case.kind)
        report.flows.append(verdict)
        if adapter.stopped_by:
            report.stopped_by = adapter.stopped_by
            break
    report.totals = {
        "requests_admitted": ledger.calls_admitted,
        "committed_tokens_upper_bound": ledger.committed_tokens,
        "unknown_usage_calls": ledger.unknown_usage_calls,
        "service_repairs": sum(flow_verdict.get("repairs", 0) for flow_verdict in report.flows),
        "elapsed_seconds": round(clock() - started, 3),
        "retries": 0,
    }
    if cases:
        report.totals.update(flows_planned=len(plan), flows_run=len(report.flows))
    return report
