"""Controlled NVIDIA compatibility probe. NOT executed by any test, task or default command.

validate mode (default): checks the authorization and prints the plan and worst-case budget. It
reads no credential and opens no socket. execute mode additionally needs --execute, an arming
variable bound to the exact authorization file, a private key file, and a host-allowlist guard.

The core (`run_probe`) takes an injected gateway so every limit is tested with mocks.

A second authorization schema (FLOW_SCHEMA) selects the production-flow mode: the same arming,
key file and host guard, but the model is asked through the real AI Scientist service (flow.py),
with its own repair loop, under one shared budget ledger. See `_main_flow`.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import stat
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from chemdft_api.ai.gateway import (
    ModelAuthenticationError,
    ModelGatewayError,
    ModelRateLimitError,
    ModelTimeoutError,
)
from chemdft_api.ai.model_catalog import sampling_profile
from chemdft_api.ai.model_performance import classify_failure

from .authorization import AuthorizationError, ProbeAuthorization, load_authorization
from .flow import ProductionFlow, measure_flow, plan_flow, run_flow_probe
from .ledger import BudgetLedger, BudgetStop
from .plan import (
    CASES,
    PlannedCall,
    build_plan,
    build_request,
    fixture_sha256,
    judge,
    load_fixture,
)
from .replay import NOT_REPLAYED, PIPELINE, ProductionReplay

ALLOWED_HOST = "integrate.api.nvidia.com"
# The planned worst case must leave real operating margin below the aggregate ceiling.
MAX_PLANNED_UTILIZATION = 0.60
# A payment-required or rate-limit refusal means the free allowance (or its rate window) is the
# binding constraint: stop the whole run rather than probing further against it.
FREE_ALLOWANCE_STOP_STATUSES = frozenset({402, 429})
ARM_ENV = "CHEMDFT_NVIDIA_PROBE_ARMED"
KEY_FILE_ENV = "CHEMDFT_NVIDIA_PROBE_KEY_FILE"
MOONSHOT_KEY_FILE_ENV = "CHEMDFT_MOONSHOT_PROBE_KEY_FILE"  # a key never crosses providers


class WallClockExceeded(Exception):
    pass


@dataclass(slots=True)
class ProbeReport:
    authorization_sha256: str
    fixture_sha256: str
    started_at: str
    calls: list[dict] = field(default_factory=list)
    stopped_by: str | None = None
    totals: dict = field(default_factory=dict)
    replay_status: str = "NOT_ENABLED"

    def as_dict(self) -> dict:
        return {
            "report_kind": "COMPATIBILITY_PROBE",
            "comparability": "NONE: one request per model and case; not a benchmark or ranking",
            "authorization_sha256": self.authorization_sha256,
            "fixture_sha256": self.fixture_sha256,
            "started_at": self.started_at,
            "stopped_by": self.stopped_by,
            "totals": self.totals,
            "production_replay": {
                "status": self.replay_status,
                "pipeline": PIPELINE,
                "not_replayed": list(NOT_REPLAYED),
            },
            "calls": self.calls,
            "hosted_verification_claim": "NONE: a probe result is evidence, not a registry change",
        }


def _call_with_wall_clock(gateway, request, seconds: float):
    box: dict = {}

    def work() -> None:
        try:
            box["response"] = gateway.generate(request)
        except BaseException as error:  # recorded and classified by the caller
            box["error"] = error

    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    thread.join(seconds)
    if thread.is_alive():
        raise WallClockExceeded()
    if "error" in box:
        raise box["error"]
    return box["response"]


def _usage(response) -> tuple[int, int] | None:
    if response.usage is not None:
        return response.usage.input_tokens, response.usage.output_tokens
    counts = response.reported_usage or {}
    if counts.get("input_tokens") is not None and counts.get("output_tokens") is not None:
        return counts["input_tokens"], counts["output_tokens"]
    return None


def run_probe(
    authorization: ProbeAuthorization,
    fixture: dict,
    gateway,
    *,
    clock=time.monotonic,
    plan: list[PlannedCall] | None = None,
    replay=None,
) -> ProbeReport:
    """One request per planned call; never a retry, never another model, never past a limit."""
    plan = (
        plan
        if plan is not None
        else build_plan(
            authorization.models, authorization.max_total_calls, authorization.case_plan
        )
    )
    ledger = BudgetLedger(authorization)
    report = ProbeReport(
        authorization.sha256, fixture_sha256(), datetime.now(UTC).isoformat(timespec="seconds")
    )
    if replay is not None:
        report.replay_status = "ENABLED"
    started = clock()
    for call in plan:
        profile = sampling_profile(call.model)  # provider-documented values, or the default
        request, bound = build_request(
            fixture,
            call.case,
            call.model,
            authorization.max_output_tokens_per_request,
            sampling=profile,
        )
        record: dict = {
            "call": call.index,
            "model": call.model,
            "provider": "nvidia",
            "request_class": call.case,
            "sampling": {
                "temperature": request.temperature,
                "top_p": request.top_p,
                "chat_template_kwargs": dict(request.chat_template_kwargs or ()) or None,
                "source": "MODEL_CARD_PROFILE" if profile else "GATEWAY_DEFAULT",
            },
            "input_token_bound": bound,
            "output_token_cap": request.max_tokens,
            "retry_count": 0,
        }
        try:
            ledger.admit(
                input_bound=bound,
                output_cap=request.max_tokens,
                elapsed_seconds=clock() - started,
            )
        except BudgetStop as stop:
            record.update(outcome="NOT_SENT_BUDGET_STOP", stop_reason=stop.reason)
            report.calls.append(record)
            report.stopped_by = stop.reason
            break
        began = clock()
        try:
            response = _call_with_wall_clock(
                gateway, request, authorization.per_call_wall_clock_seconds
            )
        except WallClockExceeded:
            ledger.settle(None)
            record.update(outcome="WALL_CLOCK_EXCEEDED", duration_ms=int((clock() - began) * 1000))
            report.calls.append(record)
            report.stopped_by = "WALL_CLOCK_EXCEEDED"  # a hung request: stop, never overlap calls
            break
        except ModelGatewayError as error:
            transport = error.transport.as_dict() if error.transport else None
            kind = classify_failure({"transport": transport})
            usage = (
                (error.usage.input_tokens, error.usage.output_tokens)
                if getattr(error, "usage", None)
                else None
            )
            ledger.settle(usage if error.request_sent else (0, 0))
            record.update(
                outcome="TIMEOUT" if isinstance(error, ModelTimeoutError) else "PROVIDER_ERROR",
                failure_class=kind,
                transport_kind=transport["kind"] if transport else None,
                http_status=transport.get("http_status") if transport else None,
                attempts=transport.get("attempt") if transport else None,
                request_sent=error.request_sent,
                usage_reported=usage is not None,
                duration_ms=int((clock() - began) * 1000),
                error_type=type(error).__name__,
            )
            report.calls.append(record)
            if isinstance(error, ModelAuthenticationError):
                report.stopped_by = "AUTHENTICATION_FAILED"
                break
            refusal = record["http_status"]
            if refusal not in FREE_ALLOWANCE_STOP_STATUSES and isinstance(
                error, ModelRateLimitError
            ):
                refusal = 429
            if refusal in FREE_ALLOWANCE_STOP_STATUSES:
                report.stopped_by = f"PROVIDER_REFUSED_HTTP_{refusal}"
                break
            continue
        except Exception as error:  # an unclassified local failure: stop safely, keep the evidence
            ledger.settle(None)
            record.update(
                outcome="UNEXPECTED_ERROR",
                error_type=type(error).__name__,
                duration_ms=int((clock() - began) * 1000),
            )
            report.calls.append(record)
            report.stopped_by = "UNEXPECTED_ERROR"
            break
        duration_ms = int((clock() - began) * 1000)
        usage = _usage(response)
        ledger.settle(usage)
        identity_ok = response.provider == "nvidia" and response.model_identifier == call.model
        record.update(
            outcome="SUCCEEDED" if identity_ok else "MODEL_IDENTITY_MISMATCH",
            duration_ms=duration_ms,
            gateway_latency_ms=response.usage.latency_ms if response.usage else None,
            input_tokens=usage[0] if usage else "UNKNOWN",
            output_tokens=usage[1] if usage else "UNKNOWN",
            response_model=response.model_identifier,
            transport_attempt=response.transport.attempt if response.transport else None,
            **{"verdict": judge(call.case, fixture, response, replay)},
        )
        report.calls.append(record)
        if not identity_ok:
            report.stopped_by = "MODEL_IDENTITY_MISMATCH"
            break
    report.totals = {
        "calls_sent": ledger.calls_admitted,
        "calls_planned": len(plan),
        "committed_tokens_upper_bound": ledger.committed_tokens,
        "unknown_usage_calls": ledger.unknown_usage_calls,
        "elapsed_seconds": round(clock() - started, 3),
        "retries": 0,
        "cases": list(CASES),
    }
    return report


def install_host_allowlist(allowed_host: str = ALLOWED_HOST) -> None:
    """Defence in depth for execute mode: this process may resolve only the approved host."""

    def audit(event, args):
        if event in {"socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyaddr"}:
            host = args[0].decode() if isinstance(args[0], bytes) else str(args[0])
            if host in {allowed_host, "localhost"}:
                return
            try:
                if ipaddress.ip_address(host).is_loopback:
                    return
            except ValueError:
                pass
            raise RuntimeError(f"OUTBOUND_HOST_NOT_ALLOWED: {host}")

    sys.addaudithook(audit)


def _arming_error(auth: ProbeAuthorization, environ) -> str | None:
    if environ.get("CHEMDFT_E2E_OFFLINE") == "1":
        return "REFUSED_OFFLINE_ENVIRONMENT"
    if environ.get(ARM_ENV) != f"EXECUTE-{auth.sha256[:16]}":
        return "REFUSED_NOT_ARMED"
    return None


def _read_key(path: Path) -> str:
    info = path.stat()
    if not path.is_file() or path.is_symlink() or info.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise AuthorizationError("KEY_FILE_NOT_PRIVATE", "use a regular 0600 file")
    key = path.read_text().strip()
    if not key:
        raise AuthorizationError("KEY_FILE_EMPTY")
    return key


def _build_gateway(auth, environ, gateway_factory, timeout_seconds: int):
    """The injected gateway, or the real one for the authorized provider (private key file)."""
    if gateway_factory is not None:
        return gateway_factory()
    from chemdft_api.ai.gateway import HttpOpenAIModelGateway
    from chemdft_api.config import Settings
    from pydantic import SecretStr

    provider = getattr(auth, "provider", "nvidia")
    key = _read_key(
        Path(environ.get(MOONSHOT_KEY_FILE_ENV if provider == "moonshot" else KEY_FILE_ENV, ""))
    )
    install_host_allowlist(urlsplit(auth.endpoint).hostname or ALLOWED_HOST)
    settings = Settings(
        _env_file=None,
        ai_provider=provider,
        ai_api_base_url=auth.endpoint,
        ai_api_key=SecretStr(key),
        run_ai_integration=True,
        ai_timeout_seconds=timeout_seconds,
    )
    return HttpOpenAIModelGateway(settings)


def _main_flow(args, auth, fixture, gateway_factory, environ, out) -> int:
    """Production-flow mode: size the real requests offline, then (armed) run the flows.

    One flow per model on the supplied H2, or one per model and reference case when the
    authorization names cases.
    """
    try:
        flow = ProductionFlow.build(fixture)
    except Exception as error:
        out(f"REFUSED: the production replica could not be built ({type(error).__name__})")
        return 2
    try:
        measurement = measure_flow(flow, auth)
        plan = plan_flow(auth, measurement)
        refusal = plan.pop("refusal")
        if refusal:
            out(f"{refusal[0]}: {refusal[1]}")
            return 2
        summary = {
            "authorized_by": auth.authorized_by,
            "expires_at": auth.expires_at.isoformat(),
            "authorization_sha256": auth.sha256,
            "models": list(auth.models),
            "sampling": auth.sampling,
            "max_model_calls_per_model": auth.flow.max_model_calls_per_model,
            "read_timeout_seconds": auth.flow.read_timeout_seconds,
            **plan,
            "spend_control": auth.spend_control.kind,
            "retries": 0,
            "fallback": "none",
            "repair_loop": "the service's own: a refused call returns to the model, bounded by "
            "max_model_calls_per_model",
            "never_approves": True,
        }
        if not args.execute:
            out(json.dumps({"mode": "FLOW_VALIDATE_ONLY_NO_NETWORK", **summary}, indent=1))
            return 0
        refusal = _arming_error(auth, environ)
        if refusal:
            out(refusal)
            return 2
        try:
            gateway = _build_gateway(auth, environ, gateway_factory, auth.flow.read_timeout_seconds)
        except (AuthorizationError, OSError) as error:
            out(f"REFUSED: {error}")
            return 2
        report = run_flow_probe(auth, gateway, flow=flow, measurement=measurement)
        target = args.output or Path("output/nvidia-probe") / datetime.now(UTC).strftime(
            "%Y%m%dT%H%M%SZ"
        )
        target.mkdir(parents=True, exist_ok=False)
        (target / "report.json").write_text(json.dumps(report.as_dict(), indent=1) + "\n")
        out(f"report written: {target / 'report.json'} (stopped_by={report.stopped_by})")
        return 0
    finally:
        flow.close()


def main(argv=None, *, gateway_factory=None, environ=os.environ, out=print) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authorization", required=True, type=Path)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        auth = load_authorization(args.authorization)
        fixture = load_fixture()
    except Exception as error:
        out(f"REFUSED: {error}")
        return 2
    if auth.flow is not None:
        return _main_flow(args, auth, fixture, gateway_factory, environ, out)
    plan = build_plan(auth.models, auth.max_total_calls, auth.case_plan)
    ledger = BudgetLedger(auth)
    worst_tokens = worst_usd = 0
    for call in plan:
        _, bound = build_request(
            fixture,
            call.case,
            call.model,
            auth.max_output_tokens_per_request,
            sampling=sampling_profile(call.model),
        )
        tokens, usd = ledger.worst_case(bound, auth.max_output_tokens_per_request)
        worst_tokens, worst_usd = worst_tokens + tokens, worst_usd + (usd or 0)
    summary = {
        "authorized_by": auth.authorized_by,
        "expires_at": auth.expires_at.isoformat(),
        "authorization_sha256": auth.sha256,
        "models": list(auth.models),
        "planned_calls": [{"call": c.index, "model": c.model, "case": c.case} for c in plan],
        "worst_case_tokens": worst_tokens,
        "token_ceiling": auth.max_total_tokens,
        "worst_case_usd": round(worst_usd, 6)
        if auth.spend_control.kind == "USD_CEILING"
        else "UNKNOWN",
        "spend_control": auth.spend_control.kind,
        "retries": 0,
        "fallback": "none",
    }
    summary["planned_worst_case_utilization"] = round(worst_tokens / auth.max_total_tokens, 3)
    if worst_tokens > MAX_PLANNED_UTILIZATION * auth.max_total_tokens:
        margin = round((1 - MAX_PLANNED_UTILIZATION) * 100)
        out(
            f"REFUSED_INSUFFICIENT_MARGIN: the planned worst case uses {worst_tokens} of "
            f"{auth.max_total_tokens} tokens; at least {margin}% of the ceiling must remain "
            "as margin"
        )
        return 2
    if auth.spend_control.kind == "USD_CEILING" and worst_usd > auth.spend_control.ceiling_usd:
        out("REFUSED: planned worst-case spend exceeds the authorized USD ceiling")
        return 2
    if not args.execute:
        out(json.dumps({"mode": "VALIDATE_ONLY_NO_NETWORK", **summary}, indent=1))
        return 0
    refusal = _arming_error(auth, environ)
    if refusal:
        out(refusal)
        return 2
    try:
        gateway = _build_gateway(auth, environ, gateway_factory, 60)
    except (AuthorizationError, OSError) as error:
        out(f"REFUSED: {error}")
        return 2
    replay, replay_status = None, "UNAVAILABLE"
    try:
        replay = ProductionReplay.build(fixture)
    except Exception as error:  # the strict verdict still runs; the replay is additive
        replay_status = f"UNAVAILABLE:{type(error).__name__}"
    try:
        report = run_probe(auth, fixture, gateway, replay=replay)
    finally:
        if replay is not None:
            replay.close()
    if replay is None:
        report.replay_status = replay_status
    target = args.output or Path("output/nvidia-probe") / datetime.now(UTC).strftime(
        "%Y%m%dT%H%M%SZ"
    )
    target.mkdir(parents=True, exist_ok=False)
    (target / "report.json").write_text(json.dumps(report.as_dict(), indent=1) + "\n")
    out(f"report written: {target / 'report.json'} (stopped_by={report.stopped_by})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
