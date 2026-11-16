"""Typed, fail-closed authorization for a live NVIDIA probe.

The owner writes an authorization file outside Git. Nothing here reads credentials or opens a
socket. Every limit can only be tightened below the hard ceilings in this module; a missing,
unknown, expired, placeholder or over-limit field refuses the whole probe.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from chemdft_api.ai.gateway import MOONSHOT_BASE, MOONSHOT_MODELS
from chemdft_api.ai.model_catalog import (
    DEFINITIONS,
    NVIDIA_BASE,
    sampling_profile,
)

from .molecules import CASE_IDS, REFERENCE_FIXTURE_ID, reference_cases_digest
from .plan import CASES

SCHEMA = "chemdft.nvidia-probe-authorization.v1"
# A second, separate schema authorizes production-flow runs (flow.py): the real AI Scientist service
# with its repair loop. A probe file cannot be read as a flow file or the other way round.
FLOW_SCHEMA = "chemdft.nvidia-flow-authorization.v1"
FLOW_PLANNING_PROFILE = "PYSCF_ENERGY_PROPOSAL"
FLOW_INPUT_BASIS = "SERVICE_RESERVATION"  # admit each request at the service's own reservation
FLOW_HARD_MAX_MODEL_CALLS_PER_MODEL = 4
FLOW_READ_TIMEOUT_SECONDS = (30, 180)
SAMPLING_MODES = ("MODEL_CARD_PROFILE", "PRODUCTION_DEFAULT")
FIXTURE_ID = "chemdft-probe-h2-v1"
# Ceilings raised by the owner on 2026-10-17 (AI-4 nine-model free-endpoint batch) from 3 models,
# 6 calls, 120,000 tokens and 1,800 s. Every other safeguard is unchanged.
HARD_MAX_MODELS = 10
HARD_MAX_CALLS = 30
HARD_MAX_INPUT_TOKENS_PER_REQUEST = 32_768
HARD_MAX_OUTPUT_TOKENS_PER_REQUEST = 4_096
HARD_MAX_TOTAL_TOKENS = 250_000
HARD_MAX_WALL_CLOCK_SECONDS = 3_600
HARD_MAX_AUTHORIZATION_HOURS = 24
NEMOTRON_MIN_OUTPUT_TOKENS = 512  # the gateway refuses lower budgets before sending

PROVIDER_ENDPOINTS = {NVIDIA_BASE: "nvidia", MOONSHOT_BASE: "moonshot"}
_KEYS = {
    "schema",
    "authorized_by",
    "authorized_at",
    "expires_at",
    "endpoint",
    "models",
    "max_total_calls",
    "max_input_tokens_per_request",
    "max_output_tokens_per_request",
    "max_total_tokens",
    "max_wall_clock_seconds",
    "per_call_wall_clock_seconds",
    "spend_control",
    "sampling",
    "no_retries",
    "no_fallback",
    "no_scientific_compute",
    "no_production_data",
    "fixture",
}
# Optional narrowing: a per-model list of the cases that may run. It can only remove calls from the
# default plan (every model, every case); it never adds a model, a case or a call.
_OPTIONAL_KEYS = {"case_plan"}
_FLOW_KEYS = {
    "planning_profile",
    "max_model_calls_per_model",
    "input_token_basis",
    "read_timeout_seconds",
}
# Reference-molecule mode (AI-6): the flow block may also name planning cases (tools/nvidia_probe/
# molecules.py) and carry the digest of exactly what they send and expect. Both or neither.
_FLOW_CASE_KEYS = {"cases", "cases_sha256"}
# Optional pacing for a provider with a low request-rate tier (Moonshot Tier0: 3 requests a minute).
_FLOW_PACING_KEY = "min_seconds_between_requests"
_MUST_BE_TRUE = ("no_retries", "no_fallback", "no_scientific_compute", "no_production_data")


class AuthorizationError(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


@dataclass(frozen=True, slots=True)
class SpendControl:
    kind: str  # USD_CEILING | TOKEN_CEILING_ONLY
    ceiling_usd: float | None = None
    input_usd_per_million_tokens: float | None = None
    output_usd_per_million_tokens: float | None = None
    pricing_source: str | None = None

    def worst_case_usd(self, input_tokens: int, output_tokens: int) -> float | None:
        if self.kind != "USD_CEILING":
            return None
        return (
            input_tokens * float(self.input_usd_per_million_tokens)
            + output_tokens * float(self.output_usd_per_million_tokens)
        ) / 1_000_000


@dataclass(frozen=True, slots=True)
class FlowAuthorization:
    """The flow-specific limits of a production-flow authorization."""

    max_model_calls_per_model: int  # the service run limit, including its repair requests
    read_timeout_seconds: int  # per socket operation; never above the per-call wall clock
    input_token_basis: str = FLOW_INPUT_BASIS
    planning_profile: str = FLOW_PLANNING_PROFILE
    # Empty: the one supplied-H2 flow (fixture chemdft-probe-h2-v1). Otherwise one flow per model
    # and case, in this order, each on a fresh project holding the case's reference molecule.
    cases: tuple[str, ...] = ()
    cases_sha256: str | None = None
    # A pause before each request after the first: a wait, never a retry (the call count is fixed).
    min_seconds_between_requests: int = 0


@dataclass(frozen=True, slots=True)
class ProbeAuthorization:
    authorized_by: str
    authorized_at: datetime
    expires_at: datetime
    endpoint: str
    models: tuple[str, ...]
    max_total_calls: int
    max_input_tokens_per_request: int
    max_output_tokens_per_request: int
    max_total_tokens: int
    max_wall_clock_seconds: int
    per_call_wall_clock_seconds: int
    spend_control: SpendControl
    sha256: str
    case_plan: tuple[tuple[str, tuple[str, ...]], ...] | None = None
    sampling: str = "MODEL_CARD_PROFILE"
    flow: FlowAuthorization | None = None
    # Models the owner explicitly accepted although the registry holds no verified availability for
    # them (AI-8: Kimi K2.6 on NVIDIA). Only a flow authorization can carry one, only for a row that
    # reads UNKNOWN (never DEPRECATED or unsupported), and only with a USD spend ceiling because the
    # cost is unverified. It changes nothing in the registry or in what a browser may select.
    owner_exceptions: tuple[str, ...] = ()
    provider: str = "nvidia"


def _require(condition: bool, code: str, detail: str = "") -> None:
    if not condition:
        raise AuthorizationError(code, detail)


def _integer(data: dict, name: str, low: int, high: int) -> int:
    value = data.get(name)
    _require(
        type(value) is int and low <= value <= high, "LIMIT_INVALID", f"{name} in {low}..{high}"
    )
    return value


def _timestamp(data: dict, name: str) -> datetime:
    try:
        value = datetime.fromisoformat(str(data[name]).replace("Z", "+00:00"))
    except (KeyError, ValueError):
        raise AuthorizationError("TIMESTAMP_INVALID", name) from None
    _require(value.tzinfo is not None, "TIMESTAMP_INVALID", f"{name} needs a UTC offset")
    return value.astimezone(UTC)


def _spend(data: dict) -> SpendControl:
    raw = data.get("spend_control")
    _require(isinstance(raw, dict), "SPEND_CONTROL_REQUIRED")
    kind = raw.get("kind")
    if kind == "TOKEN_CEILING_ONLY":
        _require(
            set(raw) == {"kind", "acknowledged_no_cost_information"}
            and raw["acknowledged_no_cost_information"] is True,
            "SPEND_CONTROL_INVALID",
            "token-only control must acknowledge that cost information is unknown",
        )
        return SpendControl(kind)
    _require(kind == "USD_CEILING", "SPEND_CONTROL_INVALID", "unknown kind")
    _require(
        set(raw)
        == {
            "kind",
            "ceiling_usd",
            "input_usd_per_million_tokens",
            "output_usd_per_million_tokens",
            "pricing_source",
        },
        "SPEND_CONTROL_INVALID",
        "USD control needs ceiling, both owner-supplied prices and their source",
    )
    numbers = [
        raw[k]
        for k in ("ceiling_usd", "input_usd_per_million_tokens", "output_usd_per_million_tokens")
    ]
    _require(
        all(type(n) in (int, float) and n >= 0 for n in numbers) and numbers[0] > 0,
        "SPEND_CONTROL_INVALID",
        "ceiling must be positive and prices non-negative",
    )
    _require(
        isinstance(raw["pricing_source"], str) and len(raw["pricing_source"].strip()) >= 8,
        "SPEND_CONTROL_INVALID",
        "pricing_source must cite where the owner verified the price",
    )
    return SpendControl(
        kind, float(numbers[0]), float(numbers[1]), float(numbers[2]), raw["pricing_source"].strip()
    )


def _case_plan(
    data: dict, models: list, calls: int
) -> tuple[tuple[str, tuple[str, ...]], ...] | None:
    if "case_plan" not in data:
        return None
    raw = data["case_plan"]
    _require(isinstance(raw, dict), "CASE_PLAN_INVALID", "an object of model -> cases")
    _require(
        set(raw) == set(models), "CASE_PLAN_INVALID", "exactly the authorized models, none extra"
    )
    for model in models:
        cases = raw[model]
        _require(
            isinstance(cases, list)
            and cases
            and len(set(cases)) == len(cases)
            and all(isinstance(c, str) and c in CASES for c in cases),
            "CASE_PLAN_INVALID",
            f"{model}: a non-empty list of unique cases from {list(CASES)}",
        )
    planned = sum(len(raw[m]) for m in models)
    _require(
        planned <= calls,
        "CASE_PLAN_INVALID",
        f"the plan has {planned} calls but max_total_calls is {calls}: nothing is silently dropped",
    )
    return tuple((m, tuple(c for c in CASES if c in raw[m])) for m in models)


def _flow_block(data: dict, models: list, calls: int, per_call: int) -> FlowAuthorization:
    raw = data["flow"]
    _require(
        isinstance(raw, dict)
        and _FLOW_KEYS <= set(raw) <= _FLOW_KEYS | _FLOW_CASE_KEYS | {_FLOW_PACING_KEY}
        and ("cases" in raw) == ("cases_sha256" in raw),
        "FLOW_INVALID",
        f"flow must hold {sorted(_FLOW_KEYS)}, and may add {sorted(_FLOW_CASE_KEYS)} together",
    )
    _require(
        raw["planning_profile"] == FLOW_PLANNING_PROFILE,
        "FLOW_INVALID",
        f"planning_profile must be {FLOW_PLANNING_PROFILE}",
    )
    _require(
        raw["input_token_basis"] == FLOW_INPUT_BASIS,
        "FLOW_INVALID",
        f"input_token_basis must be {FLOW_INPUT_BASIS}",
    )
    per_model = _integer(raw, "max_model_calls_per_model", 1, FLOW_HARD_MAX_MODEL_CALLS_PER_MODEL)
    timeout = _integer(raw, "read_timeout_seconds", *FLOW_READ_TIMEOUT_SECONDS)
    _require(timeout <= per_call, "LIMIT_INVALID", "read timeout exceeds the per-call wall clock")
    cases: tuple[str, ...] = ()
    digest = None
    if "cases" in raw:
        ids = raw["cases"]
        _require(
            isinstance(ids, list)
            and ids
            and len(set(map(str, ids))) == len(ids)
            and all(isinstance(i, str) and i in CASE_IDS for i in ids),
            "CASES_INVALID",
            f"a non-empty list of unique case ids from {list(CASE_IDS)}",
        )
        try:
            digest = reference_cases_digest(ids)
        except ValueError:
            raise AuthorizationError(
                "CASES_CHANGED", "a reference molecule file differs from its recorded hash"
            ) from None
        _require(
            raw["cases_sha256"] == digest,
            "CASES_CHANGED",
            "the cases or molecules differ from the ones this authorization was written for",
        )
        cases = tuple(ids)
    flows = len(models) * (len(cases) or 1)
    _require(
        flows <= calls <= flows * per_model,
        "FLOW_INVALID",
        "max_total_calls covers one request per flow (model x case) and at most flows x "
        "per-flow calls",
    )
    gap = _integer(raw, _FLOW_PACING_KEY, 0, 120) if _FLOW_PACING_KEY in raw else 0
    return FlowAuthorization(
        per_model, timeout, cases=cases, cases_sha256=digest, min_seconds_between_requests=gap
    )


def _owner_exceptions(data: dict, models: list, flow_mode: bool) -> dict:
    """The models the owner accepted without verified availability, each with a written reason."""
    raw = data.get("owner_exceptions")
    if raw is None:
        return {}
    _require(flow_mode, "OWNER_EXCEPTION_NOT_ALLOWED", "only a production-flow authorization")
    _require(
        isinstance(raw, dict)
        and raw
        and set(raw) <= set(models)
        and all(isinstance(v, str) and len(v.strip()) >= 40 for v in raw.values()),
        "OWNER_EXCEPTION_INVALID",
        "a non-empty map from an authorized model to a written reason of at least 40 characters",
    )
    spend = data.get("spend_control")
    _require(
        isinstance(spend, dict) and spend.get("kind") == "USD_CEILING",
        "OWNER_EXCEPTION_NEEDS_USD_CEILING",
        "an unverified model has unknown cost: a USD ceiling with owner prices is required",
    )
    return raw


def parse_authorization(
    raw: bytes, *, now: datetime | None = None, require_unexpired: bool = True
) -> ProbeAuthorization:
    now = now or datetime.now(UTC)
    try:
        data = json.loads(raw)
    except ValueError:
        raise AuthorizationError("NOT_JSON") from None
    _require(isinstance(data, dict), "NOT_AN_OBJECT")
    flow_mode = data.get("schema") == FLOW_SCHEMA
    _require(data.get("schema") == (FLOW_SCHEMA if flow_mode else SCHEMA), "SCHEMA_MISMATCH")
    required = _KEYS | ({"flow"} if flow_mode else set())
    optional = {"owner_exceptions"} if flow_mode else _OPTIONAL_KEYS
    keys = set(data)
    _require(
        required <= keys <= required | optional,
        "KEYS_MISMATCH",
        f"unexpected {sorted((keys ^ required) - optional)}",
    )
    for name in _MUST_BE_TRUE:
        _require(data[name] is True, "SAFEGUARD_NOT_ACCEPTED", name)
    # A flow that names reference cases runs on the reference molecules, not the supplied H2; the
    # fixture id must say which, so neither kind of file can be read as the other.
    flow_block = data.get("flow") if flow_mode else None
    reference_mode = isinstance(flow_block, dict) and bool(_FLOW_CASE_KEYS & set(flow_block))
    _require(
        data["fixture"] == (REFERENCE_FIXTURE_ID if reference_mode else FIXTURE_ID),
        "FIXTURE_MISMATCH",
    )
    # Sampling is never free-form. A probe applies each model's provider-documented profile
    # (model_catalog.SAMPLING_PROFILES) and a model without one cannot be probed. A production-flow
    # run may instead keep production's own defaults (temperature 0, no top_p, no reasoning field).
    sampling = data["sampling"]
    _require(
        sampling in (SAMPLING_MODES if flow_mode else ("MODEL_CARD_PROFILE",)),
        "SAMPLING_NOT_ACCEPTED",
    )
    who = data["authorized_by"]
    _require(
        isinstance(who, str) and len(who.strip()) >= 2 and "<" not in who,
        "AUTHORIZER_MISSING",
        "name the person who approved this probe",
    )
    issued, expires = _timestamp(data, "authorized_at"), _timestamp(data, "expires_at")
    _require(
        issued < expires <= issued + timedelta(hours=HARD_MAX_AUTHORIZATION_HOURS),
        "WINDOW_INVALID",
        f"expiry must be within {HARD_MAX_AUTHORIZATION_HOURS} h of authorization",
    )
    if require_unexpired:
        _require(issued <= now < expires, "AUTHORIZATION_NOT_CURRENT")
    provider = PROVIDER_ENDPOINTS.get(data["endpoint"])
    _require(provider is not None, "ENDPOINT_NOT_ALLOWED", "only an exact reviewed provider base")
    # Moonshot fixes its own sampling and has no compact probe: only a production flow, and only
    # with the service's own settings, may reach it.
    _require(
        provider == "nvidia" or (flow_mode and sampling == "PRODUCTION_DEFAULT"),
        "PROVIDER_REQUIRES_FLOW_WITH_PRODUCTION_DEFAULT",
        "a non-NVIDIA endpoint needs a flow authorization with sampling PRODUCTION_DEFAULT",
    )
    models = data["models"]
    _require(
        isinstance(models, list)
        and 1 <= len(models) <= HARD_MAX_MODELS
        and len(set(models)) == len(models)
        and all(isinstance(m, str) for m in models),
        "MODELS_INVALID",
        f"1-{HARD_MAX_MODELS} unique exact model identifiers",
    )
    registry = {d.model: d for d in DEFINITIONS if d.provider == provider}
    exceptions = _owner_exceptions(data, models, flow_mode)
    spend = data.get("spend_control")
    _require(
        provider != "moonshot" or (isinstance(spend, dict) and spend.get("kind") == "USD_CEILING"),
        "PAID_PROVIDER_NEEDS_USD_CEILING",
        "a direct Moonshot run is billed: a USD ceiling with owner prices is required",
    )
    for model in models:
        row = registry.get(model)
        _require(row is not None, "MODEL_NOT_REGISTERED", model)
        if model in exceptions:
            _require(
                row.availability == "UNKNOWN",
                "MODEL_NOT_AVAILABLE",
                f"{model}: an owner exception covers only an UNKNOWN row, not {row.availability}",
            )
        else:
            _require(
                row.availability == "AVAILABLE",
                "MODEL_NOT_AVAILABLE",
                f"{model}: {row.availability}",
            )
        # The product path may not route a provider yet; a flow probe needs only a reviewed
        # request shape in the gateway.
        supported = model in MOONSHOT_MODELS if provider == "moonshot" else row.adapter_supported
        _require(supported, "MODEL_NOT_SUPPORTED", model)
        if sampling == "MODEL_CARD_PROFILE":
            _require(sampling_profile(model) is not None, "MODEL_HAS_NO_SAMPLING_PROFILE", model)
    calls = _integer(data, "max_total_calls", 1, HARD_MAX_CALLS)
    inputs = _integer(data, "max_input_tokens_per_request", 256, HARD_MAX_INPUT_TOKENS_PER_REQUEST)
    low_output = NEMOTRON_MIN_OUTPUT_TOKENS if any("nemotron" in m.lower() for m in models) else 1
    outputs = _integer(
        data, "max_output_tokens_per_request", low_output, HARD_MAX_OUTPUT_TOKENS_PER_REQUEST
    )
    total = _integer(data, "max_total_tokens", 1, HARD_MAX_TOTAL_TOKENS)
    _require(
        total <= calls * (inputs + outputs),
        "TOKEN_CEILING_LOOSE",
        "aggregate ceiling above calls x per-request caps authorizes nothing extra",
    )
    wall = _integer(data, "max_wall_clock_seconds", 30, HARD_MAX_WALL_CLOCK_SECONDS)
    per_call = _integer(data, "per_call_wall_clock_seconds", 30, 180)
    _require(per_call <= wall, "LIMIT_INVALID", "per-call wall clock exceeds the total")
    case_plan = None if flow_mode else _case_plan(data, models, calls)
    flow = _flow_block(data, models, calls, per_call) if flow_mode else None
    return ProbeAuthorization(
        authorized_by=who.strip(),
        authorized_at=issued,
        expires_at=expires,
        endpoint=data["endpoint"],
        models=tuple(models),
        max_total_calls=calls,
        max_input_tokens_per_request=inputs,
        max_output_tokens_per_request=outputs,
        max_total_tokens=total,
        max_wall_clock_seconds=wall,
        per_call_wall_clock_seconds=per_call,
        spend_control=_spend(data),
        sha256=hashlib.sha256(raw).hexdigest(),
        case_plan=case_plan,
        sampling=sampling,
        flow=flow,
        owner_exceptions=tuple(exceptions),
        provider=provider,
    )


def load_authorization(path: Path, **kwargs) -> ProbeAuthorization:
    _require(path.is_file() and not path.is_symlink(), "AUTHORIZATION_FILE_MISSING", str(path))
    return parse_authorization(path.read_bytes(), **kwargs)
