"""Offline preflight for the authorized NVIDIA probe: every limit is enforced against mocks.

No test here reads a credential, resolves a name or opens a socket. The real gateway is never
constructed; the autouse network guard stays on.
"""

import copy
import hashlib
import json
import subprocess
import sys
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from chemdft_api.ai.gateway import (
    ModelAuthenticationError,
    ModelGatewayError,
    ModelRateLimitError,
    ModelRequest,
    ModelResponse,
    ModelTimeoutError,
    ModelToolCall,
    ModelUsage,
)
from chemdft_api.ai.http_transport import TransportDiagnostic
from chemdft_api.ai.model_catalog import LIGHTNING, NVIDIA_BASE, sampling_profile
from chemdft_api.ai.model_discovery import probe_candidates

SUPER_VL = "nvidia/nemotron-3.5-super-vl-120b-a12b"
NINE_BATCH = (
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-ultra-550b-a55b",
    SUPER_VL,
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "deepseek-ai/deepseek-v4.1-flash",
    "meta/muse-glimmer-30b",
    "stepfun-ai/step-5-preview",
    "google/gemma-4-31b-it",
)

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import plan as probe_plan  # noqa: E402
from nvidia_probe import runner  # noqa: E402
from nvidia_probe.authorization import (  # noqa: E402
    FIXTURE_ID,
    HARD_MAX_CALLS,
    HARD_MAX_MODELS,
    HARD_MAX_TOTAL_TOKENS,
    HARD_MAX_WALL_CLOCK_SECONDS,
    SCHEMA,
    AuthorizationError,
    parse_authorization,
)
from nvidia_probe.ledger import BudgetLedger, BudgetStop  # noqa: E402

SUPER = "nvidia/nemotron-3-super-120b-a12b"
NOW = datetime(2026, 10, 18, 9, 0, tzinfo=UTC)


def authorization_dict(**overrides):
    data = {
        "schema": SCHEMA,
        "authorized_by": "Test Owner",
        "authorized_at": NOW.isoformat(),
        "expires_at": (NOW + timedelta(hours=2)).isoformat(),
        "endpoint": NVIDIA_BASE,
        "models": [LIGHTNING, SUPER],
        "max_total_calls": 6,
        "max_input_tokens_per_request": 6_000,
        "max_output_tokens_per_request": 1_024,
        "max_total_tokens": 40_000,
        "max_wall_clock_seconds": 600,
        "per_call_wall_clock_seconds": 90,
        "spend_control": {"kind": "TOKEN_CEILING_ONLY", "acknowledged_no_cost_information": True},
        "sampling": "MODEL_CARD_PROFILE",
        "no_retries": True,
        "no_fallback": True,
        "no_scientific_compute": True,
        "no_production_data": True,
        "fixture": FIXTURE_ID,
    }
    data.update(overrides)
    return data


def authorize(**overrides):
    return parse_authorization(json.dumps(authorization_dict(**overrides)).encode(), now=NOW)


def test_a_registered_model_without_a_reviewed_sampling_profile_cannot_be_authorized(monkeypatch):
    from chemdft_api.ai import model_catalog

    monkeypatch.delitem(model_catalog.SAMPLING_PROFILES, SUPER)
    with pytest.raises(AuthorizationError) as refused:
        authorize(models=[LIGHTNING, SUPER])
    assert refused.value.code == "MODEL_HAS_NO_SAMPLING_PROFILE"


def test_hard_ceilings_are_the_owner_approved_values_and_are_still_enforced():
    assert (HARD_MAX_MODELS, HARD_MAX_CALLS) == (10, 30)
    assert (HARD_MAX_TOTAL_TOKENS, HARD_MAX_WALL_CLOCK_SECONDS) == (250_000, 3_600)
    candidates = sorted(NINE_BATCH)
    # the helper skips models a probe found INCOMPATIBLE; an authorization may still name them
    assert set(probe_candidates()) == set(candidates) - {SUPER_VL}
    batch = dict(
        models=candidates,
        max_total_calls=27,
        max_input_tokens_per_request=6_500,
        max_output_tokens_per_request=2_048,
        max_total_tokens=220_000,
        max_wall_clock_seconds=2_700,
    )
    approved = authorize(**batch)
    assert len(approved.models) == 9 and approved.max_total_calls == 27
    for overrides, code in (
        ({"models": [*candidates, candidates[0]]}, "MODELS_INVALID"),  # duplicate
        ({"max_total_calls": HARD_MAX_CALLS + 1}, "LIMIT_INVALID"),
        ({"max_total_tokens": HARD_MAX_TOTAL_TOKENS + 1}, "LIMIT_INVALID"),
        ({"max_wall_clock_seconds": HARD_MAX_WALL_CLOCK_SECONDS + 1}, "LIMIT_INVALID"),
    ):
        with pytest.raises(AuthorizationError) as refused:
            authorize(**{**batch, **overrides})
        assert refused.value.code == code, overrides
    eleven = [f"x/model-{i}" for i in range(HARD_MAX_MODELS + 1)]
    with pytest.raises(AuthorizationError) as refused:
        authorize(**{**batch, "models": eleven})
    assert refused.value.code == "MODELS_INVALID"


def test_the_nine_model_plan_fits_the_margin_rule_and_the_ceiling(fixture):
    candidates = sorted(NINE_BATCH)
    plan = probe_plan.build_plan(tuple(candidates), 27)
    assert len(plan) == 27 and {c.case for c in plan} == {"TEXT", "TOOL", "PROPOSAL"}
    worst = 0
    for call in plan:
        request, bound = probe_plan.build_request(
            fixture, call.case, call.model, 2_048, sampling=sampling_profile(call.model)
        )
        worst += bound + request.max_tokens
    assert worst == 129_339 and worst / 220_000 <= runner.MAX_PLANNED_UTILIZATION


SECOND_RUN_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "meta/muse-glimmer-30b",
    "stepfun-ai/step-5-preview",
]
SECOND_RUN_CASE_PLAN = {
    "nvidia/nemotron-3-super-120b-a12b": ["PROPOSAL"],
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": ["PROPOSAL"],
    "meta/muse-glimmer-30b": ["PROPOSAL"],
    "stepfun-ai/step-5-preview": ["TOOL", "PROPOSAL"],
}


def second_run(**overrides):
    return authorize(
        models=SECOND_RUN_MODELS,
        case_plan=SECOND_RUN_CASE_PLAN,
        max_total_calls=5,
        max_input_tokens_per_request=10_000,
        max_output_tokens_per_request=2_048,
        max_total_tokens=60_000,
        max_wall_clock_seconds=600,
        **overrides,
    )


def test_a_case_plan_only_narrows_the_plan_and_runs_exactly_those_calls(fixture):
    approved = second_run()
    plan = probe_plan.build_plan(approved.models, approved.max_total_calls, approved.case_plan)
    assert [(c.model.split("/")[-1], c.case) for c in plan] == [
        ("step-5-preview", "TOOL"),
        ("nemotron-3-super-120b-a12b", "PROPOSAL"),
        ("nemotron-3-nano-omni-30b-a3b-reasoning", "PROPOSAL"),
        ("muse-glimmer-30b", "PROPOSAL"),
        ("step-5-preview", "PROPOSAL"),
    ]
    worst = 0
    for call in plan:
        request, bound = probe_plan.build_request(
            fixture, call.case, call.model, 2_048, sampling=sampling_profile(call.model)
        )
        worst += bound + request.max_tokens
    assert worst == 32_653 and worst / 60_000 <= runner.MAX_PLANNED_UTILIZATION
    gateway = ScriptedGateway(fixture)
    report = runner.run_probe(approved, fixture, gateway)
    assert report.stopped_by is None and len(gateway.requests) == 5
    assert [
        (r.model_identifier, c["request_class"])
        for r, c in zip(gateway.requests, report.calls, strict=True)
    ] == [(c.model, c.case) for c in plan]
    assert all(c["request_class"] != "TEXT" for c in report.calls)  # no repeated TEXT calls
    # without a case plan nothing changes: every model, every case
    assert len(probe_plan.build_plan(tuple(SECOND_RUN_MODELS), 12)) == 12


@pytest.mark.parametrize(
    "case_plan",
    [
        "PROPOSAL",
        {m: SECOND_RUN_CASE_PLAN[m] for m in SECOND_RUN_MODELS[:3]},  # a model left out
        {**SECOND_RUN_CASE_PLAN, "x/extra": ["TOOL"]},  # a model that is not authorized
        {**SECOND_RUN_CASE_PLAN, "meta/muse-glimmer-30b": ["PROPOSALS"]},
        {**SECOND_RUN_CASE_PLAN, "meta/muse-glimmer-30b": []},
        {**SECOND_RUN_CASE_PLAN, "meta/muse-glimmer-30b": ["TOOL", "TOOL"]},
        {**SECOND_RUN_CASE_PLAN, "meta/muse-glimmer-30b": ["TEXT", "TOOL", "PROPOSAL"]},  # 7 calls
    ],
)
def test_an_invalid_case_plan_is_refused(case_plan):
    with pytest.raises(AuthorizationError) as refused:
        authorize(
            models=SECOND_RUN_MODELS,
            case_plan=case_plan,
            max_total_calls=5,
            max_input_tokens_per_request=10_000,
            max_output_tokens_per_request=2_048,
            max_total_tokens=60_000,
            max_wall_clock_seconds=600,
        )
    assert refused.value.code == "CASE_PLAN_INVALID"


@pytest.mark.parametrize(
    "overrides, code",
    [
        ({"schema": "other"}, "SCHEMA_MISMATCH"),
        ({"endpoint": "https://api.openai.com/v1"}, "ENDPOINT_NOT_ALLOWED"),
        ({"endpoint": NVIDIA_BASE + "/"}, "ENDPOINT_NOT_ALLOWED"),
        ({"endpoint": "http://integrate.api.nvidia.com/v1"}, "ENDPOINT_NOT_ALLOWED"),
        ({"models": ["unknown/model"]}, "MODEL_NOT_REGISTERED"),
        ({"models": ["moonshotai/kimi-k3"]}, "MODEL_NOT_AVAILABLE"),  # deprecated
        ({"models": ["deepseek-ai/deepseek-v4-flash"]}, "MODEL_NOT_AVAILABLE"),
        ({"models": ["moonshotai/kimi-k2.6"]}, "MODEL_NOT_AVAILABLE"),  # availability unknown
        ({"models": ["kimi-k3"]}, "MODEL_NOT_REGISTERED"),  # direct Moonshot id, not NVIDIA
        ({"models": [LIGHTNING, LIGHTNING]}, "MODELS_INVALID"),
        ({"models": []}, "MODELS_INVALID"),
        ({"max_total_calls": HARD_MAX_CALLS + 1}, "LIMIT_INVALID"),
        ({"max_total_calls": 0}, "LIMIT_INVALID"),
        ({"max_output_tokens_per_request": 64}, "LIMIT_INVALID"),  # below the Nemotron minimum
        ({"max_input_tokens_per_request": 40_000}, "LIMIT_INVALID"),
        ({"max_total_tokens": 500_000}, "LIMIT_INVALID"),
        ({"max_total_calls": 1, "max_total_tokens": 80_000}, "TOKEN_CEILING_LOOSE"),
        ({"max_wall_clock_seconds": 100_000}, "LIMIT_INVALID"),
        ({"per_call_wall_clock_seconds": 700}, "LIMIT_INVALID"),
        ({"no_retries": False}, "SAFEGUARD_NOT_ACCEPTED"),
        ({"no_fallback": False}, "SAFEGUARD_NOT_ACCEPTED"),
        ({"no_scientific_compute": False}, "SAFEGUARD_NOT_ACCEPTED"),
        ({"no_production_data": 1}, "SAFEGUARD_NOT_ACCEPTED"),
        ({"authorized_by": "<owner name>"}, "AUTHORIZER_MISSING"),
        ({"expires_at": (NOW + timedelta(hours=48)).isoformat()}, "WINDOW_INVALID"),
        ({"expires_at": (NOW - timedelta(hours=1)).isoformat()}, "WINDOW_INVALID"),
        ({"authorized_at": "not a date"}, "TIMESTAMP_INVALID"),
        ({"fixture": "other-fixture"}, "FIXTURE_MISMATCH"),
        ({"sampling": "temperature=0.7"}, "SAMPLING_NOT_ACCEPTED"),
        ({"sampling": None}, "SAMPLING_NOT_ACCEPTED"),
        ({"spend_control": None}, "SPEND_CONTROL_REQUIRED"),
        (
            {
                "spend_control": {
                    "kind": "TOKEN_CEILING_ONLY",
                    "acknowledged_no_cost_information": False,
                }
            },
            "SPEND_CONTROL_INVALID",
        ),
        ({"spend_control": {"kind": "USD_CEILING", "ceiling_usd": 1}}, "SPEND_CONTROL_INVALID"),
        (
            {
                "spend_control": {
                    "kind": "USD_CEILING",
                    "ceiling_usd": 1.0,
                    "input_usd_per_million_tokens": 0.1,
                    "output_usd_per_million_tokens": 0.2,
                    "pricing_source": "n/a",
                }
            },
            "SPEND_CONTROL_INVALID",
        ),
    ],
)
def test_authorization_fails_closed(overrides, code):
    with pytest.raises(AuthorizationError) as refused:
        authorize(**overrides)
    assert refused.value.code == code


def test_authorization_rejects_unknown_keys_missing_keys_and_expiry():
    data = authorization_dict()
    with pytest.raises(AuthorizationError) as extra:
        parse_authorization(json.dumps({**data, "max_retries": 3}).encode(), now=NOW)
    assert extra.value.code == "KEYS_MISMATCH"
    missing = {k: v for k, v in data.items() if k != "spend_control"}
    with pytest.raises(AuthorizationError) as absent:
        parse_authorization(json.dumps(missing).encode(), now=NOW)
    assert absent.value.code == "KEYS_MISMATCH"
    with pytest.raises(AuthorizationError) as stale:
        parse_authorization(json.dumps(data).encode(), now=NOW + timedelta(hours=3))
    assert stale.value.code == "AUTHORIZATION_NOT_CURRENT"
    with pytest.raises(AuthorizationError) as junk:
        parse_authorization(b"not json", now=NOW)
    assert junk.value.code == "NOT_JSON"


def test_shipped_example_is_refused_until_the_owner_completes_it():
    raw = (ROOT / "tools/nvidia_probe/authorization.example.json").read_bytes()
    with pytest.raises(AuthorizationError):
        parse_authorization(raw, now=NOW)


def test_fixture_is_frozen_and_hash_checked(tmp_path):
    fixture = probe_plan.load_fixture()
    assert fixture["fixture"] == FIXTURE_ID
    copy_path = tmp_path / "h2_probe_v1.json"
    copy_path.write_text(probe_plan.FIXTURE_PATH.read_text().replace("H2", "H3", 1))
    copy_path.with_suffix(".sha256").write_text(
        probe_plan.FIXTURE_PATH.with_suffix(".sha256").read_text()
    )
    with pytest.raises(probe_plan.FixtureError):
        probe_plan.load_fixture(copy_path)


def test_plan_is_round_robin_truncated_and_models_are_exactly_the_allowlist():
    plan = probe_plan.build_plan((LIGHTNING, SUPER), 6)
    assert [(c.case, c.model) for c in plan] == [
        ("TEXT", LIGHTNING),
        ("TEXT", SUPER),
        ("TOOL", LIGHTNING),
        ("TOOL", SUPER),
        ("PROPOSAL", LIGHTNING),
        ("PROPOSAL", SUPER),
    ]
    assert [(c.case, c.model) for c in probe_plan.build_plan((LIGHTNING, SUPER), 4)][-1] == (
        "TOOL",
        SUPER,
    )  # a smaller ceiling drops the proposals for every model, never just one
    assert len(probe_plan.build_plan((LIGHTNING,), 6)) == 3
    assert len(probe_plan.build_plan((LIGHTNING, SUPER), 2)) == 2


def test_requests_are_single_attempt_reserved_and_within_the_authorized_caps():
    fixture = probe_plan.load_fixture()
    auth = authorize()
    for case in probe_plan.CASES:
        request, bound = probe_plan.build_request(fixture, case, SUPER, 1_024)
        assert request.max_attempts == 1  # retries disabled
        assert request.model_identifier == SUPER and request.max_tokens == 1_024
        assert request.reserved_input_tokens == bound <= auth.max_input_tokens_per_request
        assert request.temperature == 0.0
    proposal, _ = probe_plan.build_request(fixture, "PROPOSAL", LIGHTNING, 1_024)
    assert {t.name for t in proposal.tools} == {"calculation.submit"}  # compact stand-in


def test_the_first_probe_uses_compact_frozen_requests_with_real_operating_margin(fixture):
    auth = authorize()
    bounds = {c: probe_plan.build_request(fixture, c, SUPER, 1_024)[1] for c in probe_plan.CASES}
    assert (
        bounds["PROPOSAL"] <= 5_200
        and max(bounds.values()) < 0.9 * auth.max_input_tokens_per_request
    )
    # the retained full production request needed ~30.7k conservative tokens; the probe sends ~1/6
    assert bounds["PROPOSAL"] < 0.2 * 30_744
    worst = 2 * sum(bound + 1_024 for bound in bounds.values())  # two models, no continuation
    assert worst == 22_598 and worst <= 0.6 * auth.max_total_tokens


def test_pruned_schema_drops_only_optional_fields_and_production_validation_is_unchanged(fixture):
    full = next(
        t for t in fixture["proposal_request"]["tools"] if t["name"] == "calculation.submit"
    )
    pruned = probe_plan.prune_submit_schema(full["parameters_schema"])
    spec = pruned["$defs"]["CalculationSpecification"]["properties"]
    assert set(spec) == set(probe_plan.KEEP_SPEC_FIELDS)
    assert len(json.dumps(pruned)) < len(json.dumps(full["parameters_schema"])) / 3
    assert "OptimizationOptions" not in pruned["$defs"] and "EntityReference" in pruned["$defs"]
    # a reply that the pruned schema never described is still judged by the full contract
    bad = valid_proposal(fixture)
    bad["specification"]["scf"] = {"max_iterations": 3}
    codes = probe_plan.judge(
        "PROPOSAL",
        fixture,
        ModelResponse(
            content=None,
            tool_calls=(ModelToolCall("x", "calculation.submit", json.dumps(bad)),),
            usage=ModelUsage(1, 1, 1),
            model_identifier=LIGHTNING,
            provider="nvidia",
        ),
    )
    assert codes["tool_call_schema_valid"] is True  # extra optional fields are legal in production
    bad["specification"]["multiplicity"] = "1"
    verdict = probe_plan.judge(
        "PROPOSAL",
        fixture,
        ModelResponse(
            content=None,
            tool_calls=(ModelToolCall("x", "calculation.submit", json.dumps(bad)),),
            usage=ModelUsage(1, 1, 1),
            model_identifier=LIGHTNING,
            provider="nvidia",
        ),
    )
    assert verdict["tool_call_schema_valid"] is False and verdict["proposal_valid"] is False


def test_ledger_enforces_calls_tokens_usd_and_wall_clock():
    ledger = BudgetLedger(authorize(max_total_calls=2, max_total_tokens=3_000))
    ledger.admit(input_bound=1_000, output_cap=1_024, elapsed_seconds=0)
    with pytest.raises(BudgetStop) as unsettled:
        ledger.admit(input_bound=10, output_cap=512, elapsed_seconds=1)
    assert unsettled.value.reason == "CALL_NOT_SETTLED"
    ledger.settle(None)  # unknown usage keeps the worst-case reservation
    assert ledger.committed_tokens == 2_024 and ledger.unknown_usage_calls == 1
    with pytest.raises(BudgetStop) as tokens:
        ledger.admit(input_bound=1_000, output_cap=1_024, elapsed_seconds=2)
    assert tokens.value.reason == "TOKEN_CEILING"
    ledger.admit(input_bound=100, output_cap=512, elapsed_seconds=2)
    ledger.settle((40, 30))  # reported usage replaces the reservation
    assert ledger.committed_tokens == 2_024 + 70
    with pytest.raises(BudgetStop) as calls:
        ledger.admit(input_bound=1, output_cap=512, elapsed_seconds=3)
    assert calls.value.reason == "CALL_CEILING"
    with pytest.raises(BudgetStop) as wall:
        BudgetLedger(authorize()).admit(input_bound=1, output_cap=512, elapsed_seconds=560)
    assert wall.value.reason == "WALL_CLOCK"
    usd = authorize(
        spend_control={
            "kind": "USD_CEILING",
            "ceiling_usd": 0.001,
            "input_usd_per_million_tokens": 1.0,
            "output_usd_per_million_tokens": 2.0,
            "pricing_source": "owner-verified billing page",
        }
    )
    with pytest.raises(BudgetStop) as money:
        BudgetLedger(usd).admit(input_bound=5_000, output_cap=1_024, elapsed_seconds=0)
    assert money.value.reason == "USD_CEILING"
    with pytest.raises(BudgetStop) as cap:
        BudgetLedger(authorize()).admit(input_bound=6_001, output_cap=512, elapsed_seconds=0)
    assert cap.value.reason == "INPUT_CAP"
    with pytest.raises(BudgetStop) as out:
        BudgetLedger(authorize()).admit(input_bound=10, output_cap=1_025, elapsed_seconds=0)
    assert out.value.reason == "OUTPUT_CAP"


class ScriptedGateway:
    """Stands in for the HTTP gateway: records every request and answers from a script."""

    def __init__(self, fixture, script=None, sleep=0.0):
        self.fixture, self.script, self.sleep = fixture, script or {}, sleep
        self.requests: list[ModelRequest] = []

    def generate(self, request):
        import time

        self.requests.append(request)
        if self.sleep:
            time.sleep(self.sleep)
        action = self.script.get(len(self.requests))
        if isinstance(action, Exception):
            raise action
        if callable(action):
            return action(request)
        return self.default(request)

    def default(self, request):
        names = {t.name for t in request.tools}
        usage = ModelUsage(900, 40, 321, cached_tokens=None)
        context = probe_plan.planning_context(self.fixture)
        calls: tuple = ()
        if "calculation.submit" in names:
            calls = (
                ModelToolCall(
                    "p", "calculation.submit", json.dumps(valid_proposal(self.fixture, context))
                ),
            )
        elif names:
            calls = (
                ModelToolCall(
                    "t",
                    "structure.version.get",
                    json.dumps(
                        {
                            "structure_id": self.fixture["structure_id"],
                            "version_id": self.fixture["version_id"],
                        }
                    ),
                ),
            )
        return ModelResponse(
            content=None if calls else "SENTINEL-REPLY-TEXT diatomic.",
            tool_calls=calls,
            usage=usage,
            model_identifier=request.model_identifier,
            provider="nvidia",
        )


def valid_proposal(fixture, context=None):
    context = context or probe_plan.planning_context(fixture)
    return {
        "structure_version": {
            "project_id": str(context.project_id),
            "entity_type": "structure.version",
            "entity_id": fixture["version_id"],
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {"identifier": "hf", "display_name": "HF", "registry": "chemdft.method"},
            "basis": {
                "identifier": "sto-3g",
                "display_name": "STO-3G",
                "registry": "chemdft.basis",
            },
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
        },
        "provider_preference": "AUTO",
        "idempotency_key": "probe-h2-hf-sto3g",
    }


@pytest.fixture(scope="module")
def fixture():
    return probe_plan.load_fixture()


def test_happy_path_records_per_call_metrics_without_content_or_ranking(fixture):
    gateway = ScriptedGateway(fixture)
    report = runner.run_probe(authorize(), fixture, gateway)
    assert len(gateway.requests) == 6 and report.stopped_by is None
    assert [r.model_identifier for r in gateway.requests] == [
        LIGHTNING,
        SUPER,
        LIGHTNING,
        SUPER,
        LIGHTNING,
        SUPER,
    ]
    assert {r.max_attempts for r in gateway.requests} == {1}
    for record in report.calls:
        assert record["outcome"] == "SUCCEEDED" and record["retry_count"] == 0
        assert record["sampling"]["source"] == "MODEL_CARD_PROFILE"
        assert (record["sampling"]["temperature"], record["sampling"]["top_p"]) == (1.0, 0.95)
        assert record["provider"] == "nvidia" and record["model"] in (LIGHTNING, SUPER)
        assert record["input_tokens"] == 900 and record["duration_ms"] >= 0
    assert {r.top_p for r in gateway.requests} == {0.95}
    assert {r.temperature for r in gateway.requests} == {1.0}
    by_model = {r.model_identifier: r.chat_template_kwargs for r in gateway.requests}
    assert by_model[LIGHTNING] is None  # no reasoning switch is documented for it
    assert dict(by_model[SUPER]) == {"enable_thinking": True, "low_effort": True}
    verdicts = {c["request_class"]: c["verdict"] for c in report.calls}
    assert verdicts["TEXT"]["response_nonempty"] and verdicts["TEXT"]["failure_codes"] == []
    assert verdicts["TOOL"]["tool_call_schema_valid"] is True
    assert (
        verdicts["PROPOSAL"]["proposal_valid"] is True
        and verdicts["PROPOSAL"]["failure_codes"] == []
    )
    serialized = json.dumps(report.as_dict())
    assert "SENTINEL-REPLY-TEXT" not in serialized  # hashes and codes only, never raw replies
    assert "rank" not in report.as_dict() and "score" not in serialized
    assert "NONE" in report.as_dict()["comparability"]
    assert report.totals["retries"] == 0


def test_unreported_usage_stays_unknown_and_budget_stays_conservative(fixture):
    def no_usage(request):
        return ModelResponse(
            content="x", usage=None, model_identifier=request.model_identifier, provider="nvidia"
        )

    report = runner.run_probe(
        authorize(max_total_calls=1, max_total_tokens=3_500),
        fixture,
        ScriptedGateway(fixture, {1: no_usage}),
    )
    assert (
        report.calls[0]["input_tokens"] == "UNKNOWN"
        and report.calls[0]["output_tokens"] == "UNKNOWN"
    )
    assert (
        report.totals["unknown_usage_calls"] == 1
        and report.totals["committed_tokens_upper_bound"] > 0
    )


def test_timeout_is_recorded_not_retried_and_the_next_planned_call_still_respects_limits(fixture):
    timeout = ModelTimeoutError(
        "t",
        transport=TransportDiagnostic(
            phase="RESPONSE_BODY", kind="READ_TIMEOUT", elapsed_ms=60_000, timeout_seconds=60
        ),
    )
    gateway = ScriptedGateway(fixture, {1: timeout})
    report = runner.run_probe(authorize(), fixture, gateway)
    assert len(gateway.requests) == 6  # the timed-out request was NOT re-sent
    first = report.calls[0]
    assert first["outcome"] == "TIMEOUT" and first["failure_class"] == "timeout"
    assert first["transport_kind"] == "READ_TIMEOUT" and first["retry_count"] == 0
    assert [r.model_identifier for r in gateway.requests].count(LIGHTNING) == 3


def test_provider_error_and_authentication_failure_are_classified_and_auth_stops_the_probe(fixture):
    http = ModelGatewayError(
        "e",
        transport=TransportDiagnostic(
            phase="RESPONSE_HEADERS",
            kind="HTTP_ERROR",
            elapsed_ms=90,
            timeout_seconds=60,
            http_status=503,
        ),
    )
    report = runner.run_probe(
        authorize(max_total_calls=2, max_total_tokens=14_000),
        fixture,
        ScriptedGateway(fixture, {1: http}),
    )
    assert report.calls[0]["outcome"] == "PROVIDER_ERROR" and report.calls[0]["http_status"] == 503
    assert (
        report.calls[0]["failure_class"] == "provider_error"
        and report.calls[1]["outcome"] == "SUCCEEDED"
    )
    gateway = ScriptedGateway(fixture, {1: ModelAuthenticationError("bad key")})
    stopped = runner.run_probe(authorize(), fixture, gateway)
    assert stopped.stopped_by == "AUTHENTICATION_FAILED" and len(gateway.requests) == 1


@pytest.mark.parametrize("status", [402, 429])
def test_a_payment_or_rate_limit_refusal_stops_the_whole_probe(fixture, status):
    refusal = ModelGatewayError(
        "refused",
        transport=TransportDiagnostic(
            phase="RESPONSE_HEADERS",
            kind="HTTP_ERROR",
            elapsed_ms=40,
            timeout_seconds=60,
            http_status=status,
        ),
    )
    gateway = ScriptedGateway(fixture, {2: refusal})
    report = runner.run_probe(authorize(), fixture, gateway)
    assert len(gateway.requests) == 2  # nothing was sent after the refusal
    assert report.stopped_by == f"PROVIDER_REFUSED_HTTP_{status}"
    assert report.calls[1]["outcome"] == "PROVIDER_ERROR" and report.calls[1]["retry_count"] == 0
    typed = ScriptedGateway(fixture, {1: ModelRateLimitError("slow down")})
    limited = runner.run_probe(authorize(), fixture, typed)
    assert limited.stopped_by == "PROVIDER_REFUSED_HTTP_429" and len(typed.requests) == 1
    other = ScriptedGateway(
        fixture,
        {
            1: ModelGatewayError(
                "gone",
                transport=TransportDiagnostic(
                    phase="RESPONSE_HEADERS",
                    kind="HTTP_ERROR",
                    elapsed_ms=40,
                    timeout_seconds=60,
                    http_status=404,
                ),
            )
        },
    )
    assert runner.run_probe(authorize(), fixture, other).stopped_by is None  # a 404 is per-model


def test_limits_stop_the_probe_before_any_further_request(fixture):
    gateway = ScriptedGateway(fixture)
    report = runner.run_probe(
        authorize(max_total_calls=2, max_total_tokens=14_000), fixture, gateway
    )
    assert len(gateway.requests) == 2  # the plan itself is truncated at the call ceiling
    tight = ScriptedGateway(fixture)
    capped = runner.run_probe(authorize(max_total_calls=6, max_total_tokens=3_500), fixture, tight)
    assert (
        capped.stopped_by == "TOKEN_CEILING"
        and capped.calls[-1]["outcome"] == "NOT_SENT_BUDGET_STOP"
    )
    assert len(tight.requests) == len(
        [c for c in capped.calls if c["outcome"] != "NOT_SENT_BUDGET_STOP"]
    )
    assert len(tight.requests) < 6 and report.stopped_by is None


def test_proposal_that_exceeds_the_input_cap_is_never_sent(fixture):
    gateway = ScriptedGateway(fixture)
    report = runner.run_probe(
        authorize(max_input_tokens_per_request=4_000, max_total_tokens=25_000), fixture, gateway
    )
    assert report.stopped_by == "INPUT_CAP"
    assert all(len(r.messages) for r in gateway.requests)
    assert "calculation.submit" not in {t.name for r in gateway.requests for t in r.tools}


def test_per_call_wall_clock_is_a_real_failure_and_stops_the_probe(fixture):
    auth = replace(authorize(), per_call_wall_clock_seconds=0.05, max_wall_clock_seconds=5)
    gateway = ScriptedGateway(fixture, sleep=0.5)
    report = runner.run_probe(auth, fixture, gateway)
    assert report.calls[0]["outcome"] == "WALL_CLOCK_EXCEEDED"
    assert report.stopped_by == "WALL_CLOCK_EXCEEDED" and len(report.calls) == 1


def test_a_response_from_another_model_is_rejected_and_stops_the_probe(fixture):
    def other(request):
        return ModelResponse(
            content="x",
            usage=ModelUsage(1, 1, 1),
            model_identifier="someone/else",
            provider="nvidia",
        )

    report = runner.run_probe(authorize(), fixture, ScriptedGateway(fixture, {1: other}))
    assert report.calls[0]["outcome"] == "MODEL_IDENTITY_MISMATCH"
    assert report.stopped_by == "MODEL_IDENTITY_MISMATCH" and len(report.calls) == 1


def test_judges_distinguish_schema_validity_from_proposal_validity(fixture):
    def respond(name, args):
        return ModelResponse(
            content=None,
            tool_calls=(ModelToolCall("x", name, json.dumps(args)),),
            usage=ModelUsage(1, 1, 1),
            model_identifier=LIGHTNING,
            provider="nvidia",
        )

    good = valid_proposal(fixture)
    assert probe_plan.judge("PROPOSAL", fixture, respond("calculation.submit", good))[
        "proposal_valid"
    ]
    wrong_basis = copy.deepcopy(good)
    wrong_basis["specification"]["basis"]["identifier"] = "6-31g"
    verdict = probe_plan.judge("PROPOSAL", fixture, respond("calculation.submit", wrong_basis))
    assert verdict["tool_call_schema_valid"] is True and verdict["proposal_valid"] is False
    assert "BASIS_NOT_STO3G" in verdict["failure_codes"]
    wrong_version = copy.deepcopy(good)
    wrong_version["structure_version"]["entity_id"] = "00000000-0000-4000-8000-000000000000"
    codes = probe_plan.judge("PROPOSAL", fixture, respond("calculation.submit", wrong_version))[
        "failure_codes"
    ]
    assert "STRUCTURE_VERSION_MISMATCH" in codes
    broken = probe_plan.judge("PROPOSAL", fixture, respond("calculation.submit", {"nonsense": 1}))
    assert broken["tool_call_schema_valid"] is False and broken["proposal_valid"] is False
    read_first = probe_plan.judge(
        "PROPOSAL",
        fixture,
        respond(
            "structure.version.get",
            {"structure_id": fixture["structure_id"], "version_id": fixture["version_id"]},
        ),
    )
    assert read_first["proposal_valid"] is False
    assert "READ_TOOL_FIRST_NO_CONTINUATION_BUDGET" in read_first["failure_codes"]
    truncated = ModelResponse(
        content="cut",
        finish_reason="length",
        usage=ModelUsage(1, 1, 1),
        model_identifier=LIGHTNING,
        provider="nvidia",
    )
    assert (
        "TRUNCATED_AT_OUTPUT_CAP" in probe_plan.judge("TEXT", fixture, truncated)["failure_codes"]
    )
    wrong_tool = probe_plan.judge("TOOL", fixture, respond("calculation.submit", good))
    assert "TOOL_CALL_NOT_BOUND_TO_FIXTURE" in wrong_tool["failure_codes"]


def write_authorization(tmp_path, **overrides):
    path = tmp_path / "authorization.json"
    now = datetime.now(UTC)
    path.write_text(
        json.dumps(
            authorization_dict(
                authorized_at=(now - timedelta(minutes=5)).isoformat(),
                expires_at=(now + timedelta(hours=1)).isoformat(),
                **overrides,
            )
        )
    )
    return path


def refusing_factory():
    raise AssertionError("the gateway must not be constructed on a refused path")


def test_validate_mode_builds_no_gateway_reads_no_secret_and_sends_nothing(tmp_path):
    lines = []
    code = runner.main(
        ["--authorization", str(write_authorization(tmp_path))],
        gateway_factory=refusing_factory,
        environ={},
        out=lines.append,
    )
    summary = json.loads("\n".join(lines))
    assert code == 0 and summary["mode"] == "VALIDATE_ONLY_NO_NETWORK"
    assert summary["retries"] == 0 and summary["fallback"] == "none"
    assert len(summary["planned_calls"]) == 6 and summary["worst_case_usd"] == "UNKNOWN"
    assert summary["worst_case_tokens"] <= 0.6 * summary["token_ceiling"]
    assert summary["planned_worst_case_utilization"] <= 0.6


def test_a_plan_without_operating_margin_below_the_ceiling_refuses_to_start(tmp_path):
    path = write_authorization(tmp_path, max_total_tokens=25_000)  # worst case 22,562 is 90%
    out = []
    code = runner.main(
        ["--authorization", str(path)], gateway_factory=refusing_factory, environ={}, out=out.append
    )
    assert code == 2 and out[0].startswith("REFUSED_INSUFFICIENT_MARGIN")
    out.clear()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    assert runner.main(
        ["--authorization", str(path), "--execute"],
        gateway_factory=refusing_factory,
        environ={runner.ARM_ENV: f"EXECUTE-{digest}"},
        out=out.append,
    ) == 2 and out[0].startswith("REFUSED_INSUFFICIENT_MARGIN")  # even when armed


def test_execute_requires_arming_bound_to_the_exact_authorization_file(tmp_path):
    path = write_authorization(tmp_path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    out = []
    base = ["--authorization", str(path), "--execute", "--output", str(tmp_path / "out")]
    for environ, expected in (
        ({}, "REFUSED_NOT_ARMED"),
        ({runner.ARM_ENV: "EXECUTE-" + "0" * 16}, "REFUSED_NOT_ARMED"),
        ({runner.ARM_ENV: "yes"}, "REFUSED_NOT_ARMED"),
        (
            {runner.ARM_ENV: f"EXECUTE-{digest}", "CHEMDFT_E2E_OFFLINE": "1"},
            "REFUSED_OFFLINE_ENVIRONMENT",
        ),
    ):
        out.clear()
        assert (
            runner.main(base, gateway_factory=refusing_factory, environ=environ, out=out.append)
            == 2
        )
        assert out == [expected]
    # a modified authorization changes the digest, so an old arming value no longer works
    path.write_text(
        path.read_text().replace(
            '"per_call_wall_clock_seconds": 90', '"per_call_wall_clock_seconds": 91'
        )
    )
    out.clear()
    assert (
        runner.main(
            base,
            gateway_factory=refusing_factory,
            environ={runner.ARM_ENV: f"EXECUTE-{digest}"},
            out=out.append,
        )
        == 2
    )
    assert out == ["REFUSED_NOT_ARMED"]
    assert not (tmp_path / "out").exists()


def test_execute_without_a_private_key_file_is_refused_before_any_network(tmp_path, monkeypatch):
    path = write_authorization(tmp_path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    key = tmp_path / "key"
    key.write_text("sentinel")
    key.chmod(0o644)  # group/world readable
    out = []
    environ = {runner.ARM_ENV: f"EXECUTE-{digest}", runner.KEY_FILE_ENV: str(key)}
    monkeypatch.setattr(runner, "install_host_allowlist", lambda *a, **k: pytest.fail("installed"))
    assert (
        runner.main(["--authorization", str(path), "--execute"], environ=environ, out=out.append)
        == 2
    )
    assert "KEY_FILE_NOT_PRIVATE" in out[0] and "sentinel" not in out[0]
    out.clear()
    environ[runner.KEY_FILE_ENV] = str(tmp_path / "missing")
    assert (
        runner.main(["--authorization", str(path), "--execute"], environ=environ, out=out.append)
        == 2
    )


def test_armed_execution_with_a_mock_gateway_writes_a_report_and_respects_limits(tmp_path, fixture):
    path = write_authorization(tmp_path, max_total_calls=3, max_total_tokens=14_000)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    out = []
    gateway = ScriptedGateway(fixture)
    code = runner.main(
        ["--authorization", str(path), "--execute", "--output", str(tmp_path / "out")],
        gateway_factory=lambda: gateway,
        environ={runner.ARM_ENV: f"EXECUTE-{digest}"},
        out=out.append,
    )
    report = json.loads((tmp_path / "out/report.json").read_text())
    assert code == 0 and len(gateway.requests) == 3 and len(report["calls"]) == 3
    assert report["authorization_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert report["hosted_verification_claim"].startswith("NONE")


def test_usd_ceiling_below_the_worst_case_refuses_to_start(tmp_path):
    path = write_authorization(
        tmp_path,
        spend_control={
            "kind": "USD_CEILING",
            "ceiling_usd": 0.0001,
            "input_usd_per_million_tokens": 1.0,
            "output_usd_per_million_tokens": 2.0,
            "pricing_source": "owner-verified billing page",
        },
    )
    out = []
    assert (
        runner.main(
            ["--authorization", str(path)],
            gateway_factory=refusing_factory,
            environ={},
            out=out.append,
        )
        == 2
    )
    assert "USD ceiling" in out[0]


def test_expired_or_missing_authorization_is_refused(tmp_path):
    out = []
    assert (
        runner.main(["--authorization", str(tmp_path / "none.json")], environ={}, out=out.append)
        == 2
    )
    expired = tmp_path / "expired.json"
    long_ago = NOW - timedelta(days=400)  # fixed dates: a window relative to NOW is open for 2 h
    expired.write_text(
        json.dumps(
            authorization_dict(
                authorized_at=long_ago.isoformat(),
                expires_at=(long_ago + timedelta(hours=2)).isoformat(),
            )
        )
    )
    assert runner.main(["--authorization", str(expired)], environ={}, out=out.append) == 2
    assert all(line.startswith("REFUSED") for line in out)


def test_host_allowlist_hook_blocks_other_hosts_in_an_isolated_process():
    code = (
        "import socket,sys\n"
        "sys.path.insert(0,'tools'); sys.path.insert(0,'services/api/src')\n"
        "from nvidia_probe.runner import install_host_allowlist\n"
        "install_host_allowlist()\n"
        "for host in ('example.invalid','api.openai.com','93.184.216.34'):\n"
        "    try: socket.getaddrinfo(host,443)\n"
        "    except RuntimeError as e: assert 'OUTBOUND_HOST_NOT_ALLOWED' in str(e)\n"
        "    else: raise SystemExit('reached '+host)\n"
        "print('BLOCKED')\n"
    )
    env = {
        key: value
        for key, value in __import__("os").environ.items()
        if key not in ("PYTHONPATH", "CHEMDFT_E2E_OFFLINE")
    }
    result = subprocess.run(
        [sys.executable, "-B", "-c", code],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.stdout.strip() == "BLOCKED", result.stderr


def test_nothing_in_the_default_test_path_imports_a_live_gateway_constructor():
    assert "HttpOpenAIModelGateway" not in vars(runner)


def test_key_file_handling_refuses_unsafe_files_and_never_echoes_the_key(tmp_path):
    secret = "sentinel-not-" "a-credential-0123456789"
    private = tmp_path / "private.key"
    private.write_text(secret + "\n")
    private.chmod(0o600)
    assert runner._read_key(private) == secret
    shared = tmp_path / "shared.key"
    shared.write_text(secret)
    shared.chmod(0o640)
    link = tmp_path / "link.key"
    link.symlink_to(private)
    empty = tmp_path / "empty.key"
    empty.write_text("\n")
    empty.chmod(0o600)
    for path, code in (
        (shared, "KEY_FILE_NOT_PRIVATE"),
        (link, "KEY_FILE_NOT_PRIVATE"),
        (empty, "KEY_FILE_EMPTY"),
        (tmp_path, "KEY_FILE_NOT_PRIVATE"),
    ):
        with pytest.raises(AuthorizationError) as refused:
            runner._read_key(path)
        assert refused.value.code == code and secret not in str(refused.value)


def test_an_unexpected_local_error_stops_the_probe_and_keeps_the_evidence(fixture):
    gateway = ScriptedGateway(
        fixture, {2: RuntimeError("OUTBOUND_HOST_NOT_ALLOWED: example.invalid")}
    )
    report = runner.run_probe(authorize(), fixture, gateway)
    assert len(gateway.requests) == 2 and report.stopped_by == "UNEXPECTED_ERROR"
    last = report.calls[-1]
    assert last["outcome"] == "UNEXPECTED_ERROR" and last["error_type"] == "RuntimeError"
    assert "example.invalid" not in json.dumps(report.as_dict())  # type only, never the message
    assert report.totals["unknown_usage_calls"] == 1  # the reservation stayed conservative


def test_total_wall_clock_stops_the_probe_before_the_next_request(fixture):
    ticks = iter(range(0, 10_000, 1))
    now = {"t": 0.0}

    def clock():
        now["t"] += 1.0
        return now["t"]

    def slow(request):
        now["t"] += 520.0  # a very slow, but successful, reply
        return ModelResponse(
            content="x",
            usage=ModelUsage(10, 10, 5),
            model_identifier=request.model_identifier,
            provider="nvidia",
        )

    del ticks
    gateway = ScriptedGateway(fixture, {1: slow})
    report = runner.run_probe(authorize(), fixture, gateway, clock=clock)
    assert report.stopped_by == "WALL_CLOCK" and len(gateway.requests) == 1
    assert report.calls[-1]["outcome"] == "NOT_SENT_BUDGET_STOP"


def test_runner_and_plan_have_no_compute_or_process_path(tmp_path):
    import ast

    for name in ("runner.py", "plan.py", "ledger.py", "authorization.py"):
        tree = ast.parse((ROOT / "tools/nvidia_probe" / name).read_text())
        imported = {
            (node.module or "") if isinstance(node, ast.ImportFrom) else alias.name
            for node in ast.walk(tree)
            for alias in (node.names if isinstance(node, (ast.Import, ast.ImportFrom)) else [])
        } | {node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
        assert not {m for m in imported if "subprocess" in m or "compute" in m or "worker" in m}, (
            name
        )
        assert not {m for m in imported if m.startswith("chemdft_api.scientific.engines")}, name
    code = (
        "import sys\n"
        "sys.path[:0]=['tools','services/api/src']\n"
        "import nvidia_probe.runner, nvidia_probe.plan\n"
        "bad=[m for m in sys.modules if m.startswith('chemdft_api') and any(w in m for w in "
        "('compute_worker','compute_queue','compute_gateway','engines.psi4','engines.crest','engines.xtb'))]\n"
        "print('CLEAN' if not bad else bad)\n"
    )
    env = {
        k: v
        for k, v in __import__("os").environ.items()
        if k not in ("PYTHONPATH", "CHEMDFT_E2E_OFFLINE")
    }
    # A script file, not -c: engine-looking text in an argument would rightly trip the guard.
    script = tmp_path / "check_imports.py"
    script.write_text(code)
    result = subprocess.run(
        [sys.executable, "-B", str(script)],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.stdout.strip() == "CLEAN", result.stdout + result.stderr
