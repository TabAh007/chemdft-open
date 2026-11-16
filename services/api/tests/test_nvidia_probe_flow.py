"""The production-flow harness: the real AI Scientist service on a replica, with a fake gateway.

The gateway is the only model: no test reads a credential, resolves a name or opens a socket.
Flows that reach the approval step ask the configured PySCF worker for its version (as every
approval-flow test does), so those tests skip where the ignored worker environment is absent.
"""

import json
import sys
from pathlib import Path

import pytest
from chemdft_api.ai.gateway import (
    ModelAuthenticationError,
    ModelGatewayError,
    ModelProviderUnavailableError,
    ModelRequestNotSentError,
    ModelResponse,
    ModelTimeoutError,
    ModelToolCall,
    ModelUsage,
)
from chemdft_api.ai.http_transport import TransportDiagnostic
from chemdft_api.ai.service import AIScientistService
from chemdft_api.config import Settings
from chemdft_api.scientific.engines.registry import _probe_python, configured_path
from test_nvidia_probe_preflight import authorize

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import plan as probe_plan  # noqa: E402
from nvidia_probe import runner  # noqa: E402
from nvidia_probe.authorization import AuthorizationError  # noqa: E402
from nvidia_probe.flow import BudgetedFlowGateway, ProductionFlow  # noqa: E402

SENTINEL = "SENTINEL-PRIVATE-VALUE-5519"
SUPER = "nvidia/nemotron-3-super-120b-a12b"
LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b"


def _worker_available() -> bool:
    state, _version, _diagnostic = _probe_python(
        configured_path(Settings(_env_file=None).scientific_worker_python)
    )
    return state == "AVAILABLE"


needs_worker = pytest.mark.skipif(
    not _worker_available(),
    reason="PySCF worker venv absent (ignored directory): compute guidance cannot reach approval",
)


@pytest.fixture(scope="module")
def fixture():
    return probe_plan.load_fixture()


@pytest.fixture(scope="module")
def flow(fixture):
    with ProductionFlow.build(fixture) as built:
        yield built


# --- scripted models -----------------------------------------------------------------------------


def context_of(request):
    from chemdft_api.contracts.ai_planning import EnergyPlanningContext

    return EnergyPlanningContext.model_validate_json(
        request.system_prompt.split(probe_plan._CONTEXT_MARKER, 1)[1]
    )


def proposal(request):
    """What a conforming model would send, built from the ids in the request it was given."""
    context = context_of(request)
    return {
        "structure_version": {
            "project_id": str(context.project_id),
            "entity_type": "structure.version",
            "entity_id": str(context.selection.selected_structure_version_id),
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
            "engine_preference": {"engine": "pyscf"},
        },
        "provider_preference": "AUTO",
        "idempotency_key": "flow-test-h2-hf-sto3g",
    }


def call(shape, name="calculation.submit"):
    def respond(request):
        arguments = shape(request) if callable(shape) else shape
        return ModelResponse(
            content=None,
            tool_calls=(ModelToolCall("call-1", name, json.dumps(arguments)),),
            usage=ModelUsage(100, 50, 10),
            model_identifier=request.model_identifier,
            provider="fake",
            finish_reason="tool_calls",
        )

    return respond


def text(content="Done."):
    def respond(request):
        return ModelResponse(
            content=content,
            usage=ModelUsage(50, 20, 5),
            model_identifier=request.model_identifier,
            provider="fake",
        )

    return respond


class Script:
    """A pluggable fake gateway: answers from a list, optionally repeating the last answer."""

    def __init__(self, *steps, repeat_last=False):
        self.steps, self.repeat_last, self.requests = list(steps), repeat_last, []

    def generate(self, request):
        self.requests.append(request)
        step = self.steps[0] if self.repeat_last and len(self.steps) == 1 else self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        return step(request)


def mutated(change):
    def shape(request):
        arguments = proposal(request)
        change(arguments)
        return arguments

    return shape


def wrong_version(arguments):
    arguments["structure_version"]["entity_id"] = "11111111-1111-4111-8111-111111111111"


def other_engine(arguments):
    arguments["specification"]["engine_preference"]["engine"] = "xtb"


def no_engine(arguments):
    arguments["specification"].pop("engine_preference")


def no_basis(arguments):
    arguments["specification"].pop("basis")


def other_basis(arguments):
    arguments["specification"]["basis"]["identifier"] = "6-31g"


def stringified(arguments):
    arguments["structure_version"] = json.dumps(arguments["structure_version"])
    arguments["specification"] = json.dumps(arguments["specification"])


def last_tool_message(request):
    message = request.messages[-1]
    assert message.role == "tool"
    return json.loads(message.content)


# --- the harness drives the real service ---------------------------------------------------------


def test_the_flow_sends_the_real_production_request(flow, fixture):
    gateway = Script(text())
    verdict = flow.run(gateway)
    request = gateway.requests[0]
    frozen = fixture["proposal_request"]
    assert verdict["flow"] == "REAL_AI_SCIENTIST_SERVICE" and verdict["run_status"] == "FAILED"  # no proposal: PROPOSAL_NOT_PRODUCED
    # The same tools with the same complete schemas the frozen production capture holds ...
    frozen_tools = {t["name"]: t for t in frozen["tools"]}
    assert (
        {t.name for t in request.tools}
        == set(frozen_tools)
        == {
            "calculation.submit",
            "structure.version.get",
        }
    )
    for tool in request.tools:
        assert tool.parameters_schema == frozen_tools[tool.name]["parameters_schema"], (
            "the probe fixture is stale: rerun tools/nvidia_probe/capture_fixture.py offline"
        )
        assert tool.description == frozen_tools[tool.name]["description"]
    # ... the same system policy and context shape, and the user's own words.
    marker = probe_plan._CONTEXT_MARKER
    assert request.system_prompt.split(marker, 1)[0] == frozen["system_prompt"].split(marker, 1)[0]
    assert set(json.loads(request.system_prompt.split(marker, 1)[1])) == set(
        json.loads(frozen["system_prompt"].split(marker, 1)[1])
    )
    assert [m.content for m in request.messages if m.role == "user"] == [fixture["user_prompt"]]
    assert (request.temperature, request.max_attempts, request.max_tokens) == (0.0, 1, 2048)


def test_a_plain_answer_ends_the_run_without_a_proposal(flow):
    verdict = flow.run(Script(text()))
    # A proposal request that ends without a proposal is a loud failure, never a chat answer.
    assert verdict["run_status"] == "FAILED" and verdict["approvals"] == []
    assert verdict["run_error_code"] == "PROPOSAL_NOT_PRODUCED"
    assert verdict["result"] == "NO_PROPOSAL" and verdict["steps"] == []
    assert len(verdict["model_invocations"]) == 1


def test_a_refused_proposal_goes_back_to_the_model_until_the_repair_bound_ends_the_run(flow):
    gateway = Script(call(mutated(no_engine)), repeat_last=True)
    verdict = flow.run(gateway, max_model_calls=10)
    # One proposal and two repairs, then the run ends with the real blocker (AI-6), not at the
    # step limit or when the budget runs out.
    assert len(gateway.requests) == 3 and len(verdict["model_invocations"]) == 3
    assert verdict["run_status"] == "FAILED"
    assert verdict["run_error_code"] == "PROPOSAL_NOT_REPAIRED"
    assert verdict["repairs"] == 3 and verdict["result"] == "NO_PROPOSAL"
    assert {s["diagnostic"] for s in verdict["steps"]} == {"VALIDATION_ERROR"}
    # Each later request carries the assistant's refused call and the server's error message.
    assert "error" in last_tool_message(gateway.requests[1])
    assert [m.role for m in gateway.requests[2].messages[-4:]] == [
        "assistant",
        "tool",
        "assistant",
        "tool",
    ]
    assert verdict["side_effects"] == {"approvals_decided": 0, "calculations": 0, "compute_jobs": 0}


def test_a_provider_failure_fails_the_run_after_one_request(flow):
    gateway = Script(ModelProviderUnavailableError("down"), repeat_last=True)
    verdict = flow.run(gateway)
    assert len(gateway.requests) == 1  # no retry, no other model
    assert verdict["run_status"] == "FAILED" and verdict["run_error_code"] == "PROVIDER_UNAVAILABLE"
    assert verdict["result"] == "NO_PROPOSAL"


def test_the_verdict_holds_no_model_or_argument_content(flow):
    def leaky(request):
        arguments = proposal(request)
        arguments["idempotency_key"] = SENTINEL
        arguments["specification"][SENTINEL] = SENTINEL  # an extra key: refused, never approved
        return arguments

    gateway = Script(call(leaky), text(f"final words {SENTINEL}"))
    verdict = flow.run(gateway)
    assert verdict["repairs"] == 1 and verdict["run_status"] == "SUCCEEDED"
    assert SENTINEL not in json.dumps(verdict)
    odd_tool = Script(call({"x": SENTINEL}, name="sk-live-" + SENTINEL), text())
    assert SENTINEL not in json.dumps(flow.run(odd_tool))


def test_nothing_is_ever_approved_or_computed(flow, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("the harness must never decide an approval")

    monkeypatch.setattr(AIScientistService, "decide_approval", forbidden)
    verdict = flow.run(Script(call(mutated(other_engine)), call(mutated(no_engine)), text()))
    assert verdict["approvals"] == [] and verdict["run_status"] == "SUCCEEDED"
    assert verdict["side_effects"] == {"approvals_decided": 0, "calculations": 0, "compute_jobs": 0}


# --- flows that reach production's approval step (compute guidance included) -------------------


@needs_worker
def test_a_conforming_first_attempt_waits_for_approval_and_nothing_runs(flow, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("the harness must never decide an approval")

    monkeypatch.setattr(AIScientistService, "decide_approval", forbidden)
    verdict = flow.run(Script(call(proposal)))
    assert verdict["run_status"] == "WAITING_FOR_APPROVAL" and verdict["repairs"] == 0
    assert verdict["result"] == "PROPOSAL_VALID_FOR_PROMPT" and verdict["first_attempt_accepted"]
    (approval,) = verdict["approvals"]
    assert approval["status"] == "PENDING" and approval["decided"] is False
    assert approval["adherence_failure_codes"] == [] and len(approval["arguments_sha256"]) == 64
    assert verdict["side_effects"] == {"approvals_decided": 0, "calculations": 0, "compute_jobs": 0}


@needs_worker
def test_nested_objects_sent_as_json_strings_are_accepted_first_time(flow):
    verdict = flow.run(Script(call(mutated(stringified))))
    assert verdict["run_status"] == "WAITING_FOR_APPROVAL" and verdict["first_attempt_accepted"]


@needs_worker
def test_a_wrong_version_id_is_repaired_from_the_servers_message(flow):
    gateway = Script(call(mutated(wrong_version)), call(proposal))
    verdict = flow.run(gateway)
    assert [s["diagnostic"] for s in verdict["steps"] if s["status"] == "FAILED"] == ["NOT_FOUND"]
    assert "does not exist" in last_tool_message(gateway.requests[1])["error"]
    assert verdict["repairs"] == 1 and verdict["result"] == "PROPOSAL_VALID_FOR_PROMPT"
    assert verdict["first_attempt_accepted"] is False and len(gateway.requests) == 2


@needs_worker
def test_a_profile_guard_refusal_is_repaired_from_the_servers_message(flow):
    gateway = Script(call(mutated(other_engine)), call(proposal))
    verdict = flow.run(gateway)
    assert [s["diagnostic"] for s in verdict["steps"] if s["status"] == "FAILED"] == [
        "PLANNING_PROFILE_MISMATCH"
    ]
    assert "PySCF ENERGY proposal" in last_tool_message(gateway.requests[1])["error"]
    assert verdict["run_status"] == "WAITING_FOR_APPROVAL" and verdict["repairs"] == 1


@needs_worker
def test_compute_guidance_refuses_a_missing_basis_and_the_model_can_repair(flow):
    gateway = Script(call(mutated(no_basis)), call(proposal))
    verdict = flow.run(gateway)
    assert [s["diagnostic"] for s in verdict["steps"] if s["status"] == "FAILED"] == [
        "SCIENTIFIC_VALIDATION_FAILED"
    ]
    assert verdict["result"] == "PROPOSAL_VALID_FOR_PROMPT" and verdict["repairs"] == 1


def test_a_different_basis_no_longer_reaches_approval_for_a_prompt_that_names_one(flow):
    """The AI-5 gap, closed in AI-6: HF/6-31G must not be presented for an HF/STO-3G request."""
    gateway = Script(call(mutated(other_basis)), repeat_last=True)
    verdict = flow.run(gateway, max_model_calls=1)
    assert verdict["approvals"] == [] and verdict["result"] == "NO_PROPOSAL"
    (refused,) = [s for s in verdict["steps"] if s["tool"] == "calculation.submit"]
    assert refused["status"] == "FAILED" and refused["refusal"] == "REQUEST_MISMATCH"
    assert refused["refusal_fields"] == ["specification.basis.identifier"]


@needs_worker
def test_a_different_basis_for_a_prompt_that_names_none_still_waits_for_the_researcher(flow):
    verdict = flow.run(
        Script(call(mutated(other_basis))), prompt="Calculate the energy for H2 with PySCF."
    )
    assert verdict["run_status"] == "WAITING_FOR_APPROVAL" and verdict["first_attempt_accepted"]
    # Nothing was requested, so nothing conflicts; the approval screen shows it as model-chosen.
    approval = flow.last_detail.latest_run.pending_approval
    assert {i.parameter: i.outcome for i in approval.request_match}["basis"] == "NOT_SPECIFIED"


# --- the budgeted adapter for a real gateway -----------------------------------------------------


class Inner:
    """Stands in for the real NVIDIA gateway: records what it is sent."""

    def __init__(self, *steps, model=SUPER):
        self.steps, self.model, self.sent = list(steps), model, []

    def generate(self, request):
        self.sent.append(request)
        step = self.steps.pop(0) if self.steps else None
        if isinstance(step, Exception):
            raise step
        if callable(step):
            return step(request)
        return ModelResponse(
            content=f"reply {SENTINEL}",
            tool_calls=(ModelToolCall("a", "calculation.submit", json.dumps({"k": SENTINEL})),),
            usage=ModelUsage(120, 40, 55),
            model_identifier=self.model,
            provider="nvidia",
            finish_reason="tool_calls",
        )


def budget(**overrides):
    values = {
        "models": [SUPER, LIGHTNING],
        "max_total_calls": 2,
        "max_input_tokens_per_request": 32_768,
        "max_output_tokens_per_request": 2_048,
        "max_total_tokens": 69_000,
        "max_wall_clock_seconds": 300,
    }
    values.update(overrides)
    return authorize(**values)


def pinned_request(**extra):
    from chemdft_api.ai.gateway import ModelMessage, ModelRequest

    return ModelRequest(
        system_prompt="s",
        messages=(ModelMessage(role="user", content="u"),),
        model_identifier="fake-standard",
        max_tokens=1024,
        **extra,
    )


def test_the_adapter_applies_the_model_card_profile_and_hides_the_real_identity():
    inner = Inner()
    gateway = BudgetedFlowGateway(inner, budget(), SUPER)
    answer = gateway.generate(pinned_request())
    sent = inner.sent[0]
    assert sent.model_identifier == SUPER and sent.max_attempts == 1
    assert (sent.temperature, sent.top_p) == (1.0, 0.95)
    assert dict(sent.chat_template_kwargs) == {"enable_thinking": True, "low_effort": True}
    assert (answer.provider, answer.model_identifier) == ("fake", "fake-standard")
    assert answer.usage.input_tokens == 120 and answer.tool_calls[0].name == "calculation.submit"
    (record,) = gateway.summary()["requests"]
    assert record["outcome"] == "SUCCEEDED" and record["input_tokens"] == 120
    assert record["tool_calls"] == ["calculation.submit"]
    assert record["sampling"]["source"] == "MODEL_CARD_PROFILE"
    assert SENTINEL not in json.dumps(gateway.summary())


def test_production_default_sampling_leaves_the_request_untouched():
    inner = Inner()
    BudgetedFlowGateway(inner, budget(), SUPER, sampling="PRODUCTION_DEFAULT").generate(
        pinned_request()
    )
    sent = inner.sent[0]
    assert (sent.temperature, sent.top_p, sent.chat_template_kwargs) == (0.0, None, None)
    assert sent.model_identifier == SUPER


def test_the_adapter_refuses_an_unauthorized_model_or_one_without_a_reviewed_profile(monkeypatch):
    from chemdft_api.ai import model_catalog

    with pytest.raises(AuthorizationError) as other:
        BudgetedFlowGateway(Inner(), budget(), "nvidia/nemotron-3-ultra-550b-a55b")
    assert other.value.code == "MODEL_NOT_AUTHORIZED"
    with pytest.raises(ValueError):
        BudgetedFlowGateway(Inner(), budget(), SUPER, sampling="TEMPERATURE_0_7")
    authorization = budget()
    monkeypatch.delitem(model_catalog.SAMPLING_PROFILES, SUPER)
    with pytest.raises(AuthorizationError) as bare:
        BudgetedFlowGateway(Inner(), authorization, SUPER)
    assert bare.value.code == "MODEL_HAS_NO_SAMPLING_PROFILE"
    # production-default sampling needs no profile, so it still works
    BudgetedFlowGateway(Inner(), authorization, SUPER, sampling="PRODUCTION_DEFAULT")


def test_the_ledger_stops_a_request_the_budget_does_not_allow():
    inner = Inner()
    gateway = BudgetedFlowGateway(inner, budget(max_total_calls=1, max_total_tokens=34_000), SUPER)
    gateway.generate(pinned_request())
    with pytest.raises(ModelRequestNotSentError):
        gateway.generate(pinned_request())
    assert len(inner.sent) == 1 and gateway.stopped_by == "CALL_CEILING"
    assert gateway.summary()["requests"][1]["outcome"] == "NOT_SENT_BUDGET_STOP"


def test_a_response_from_another_model_is_rejected_and_recorded():
    gateway = BudgetedFlowGateway(Inner(model="private/other-model"), budget(), SUPER)
    with pytest.raises(ModelGatewayError):
        gateway.generate(pinned_request())
    assert gateway.stopped_by == "MODEL_IDENTITY_MISMATCH"
    assert gateway.summary()["requests"][0]["outcome"] == "MODEL_IDENTITY_MISMATCH"


@pytest.mark.parametrize(
    "error, stopped",
    [
        (ModelAuthenticationError("bad key"), "AUTHENTICATION_FAILED"),
        (
            ModelGatewayError(
                "refused",
                transport=TransportDiagnostic(
                    phase="RESPONSE_HEADERS",
                    kind="HTTP_ERROR",
                    elapsed_ms=30,
                    timeout_seconds=60,
                    http_status=402,
                ),
            ),
            "PROVIDER_REFUSED_HTTP_402",
        ),
        (
            ModelGatewayError(
                "limited",
                transport=TransportDiagnostic(
                    phase="RESPONSE_HEADERS",
                    kind="HTTP_ERROR",
                    elapsed_ms=30,
                    timeout_seconds=60,
                    http_status=429,
                ),
            ),
            "PROVIDER_REFUSED_HTTP_429",
        ),
        (ModelTimeoutError("slow"), None),
    ],
)
def test_provider_errors_are_recorded_and_the_payment_or_rate_limit_ones_name_the_stop(
    error, stopped
):
    gateway = BudgetedFlowGateway(Inner(error), budget(), SUPER)
    with pytest.raises(type(error)):
        gateway.generate(pinned_request())
    assert gateway.stopped_by == stopped
    assert gateway.summary()["requests"][0]["outcome"] in {"PROVIDER_ERROR", "TIMEOUT"}


def test_a_request_that_outlives_its_wall_clock_is_a_timeout(monkeypatch):
    def too_slow(inner, request, seconds):
        raise runner.WallClockExceeded()

    monkeypatch.setattr(runner, "_call_with_wall_clock", too_slow)
    gateway = BudgetedFlowGateway(Inner(), budget(), SUPER)
    with pytest.raises(ModelTimeoutError):
        gateway.generate(pinned_request())
    assert gateway.stopped_by == "WALL_CLOCK_EXCEEDED"
    assert gateway.ledger.unknown_usage_calls == 1  # unknown usage keeps its reservation


def test_the_flow_runs_a_real_gateway_wrapper_within_its_budget(flow):
    """The adapter plugs into the real service; the second request is refused by the ledger."""

    def refused(request):
        return call(mutated(no_engine))(request)

    # The inner model answers as NVIDIA would; the wrapper returns it under the replica's label.
    def as_nvidia(step):
        def respond(request):
            response = step(request)
            return ModelResponse(
                content=response.content,
                tool_calls=response.tool_calls,
                usage=response.usage,
                model_identifier=SUPER,
                provider="nvidia",
                finish_reason=response.finish_reason,
            )

        return respond

    inner = Inner(as_nvidia(refused), as_nvidia(refused))
    wrapper = BudgetedFlowGateway(
        inner,
        budget(max_total_calls=1, max_total_tokens=34_000),
        SUPER,
        sampling="PRODUCTION_DEFAULT",
    )
    verdict = flow.run(wrapper, max_model_calls=4)
    summary = verdict["gateway"]
    assert len(inner.sent) == 1 and summary["stopped_by"] == "CALL_CEILING"
    assert verdict["run_status"] == "FAILED" and verdict["result"] == "NO_PROPOSAL"
    assert [r["outcome"] for r in summary["requests"]] == ["SUCCEEDED", "NOT_SENT_BUDGET_STOP"]
    first = summary["requests"][0]
    assert first["input_token_bound"] < 32_768  # the real request fits the probe's per-request cap
    assert SENTINEL not in json.dumps(verdict)
