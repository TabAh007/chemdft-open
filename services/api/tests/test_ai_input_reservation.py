"""INPUT_RESERVATION_V1 regression tests: offline, scripted gateways, no provider request.

Provider-reported counts used here are synthetic test inputs. They are never treated as
independently verified HTTP usage, and no provider price or billed cost is derived.
"""

# ruff: noqa: E501, F811
from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from unittest.mock import patch

import pytest
from chemdft_api.ai.budgets import AIBudgetExceededError, AIRunBudget
from chemdft_api.ai.events import AIRunEventManager
from chemdft_api.ai.execution import AIRunExecutionManager
from chemdft_api.ai.gateway import (
    HttpOpenAIModelGateway,
    ModelCredentialMissingError,
    ModelInputBudgetInsufficientError,
    ModelMessage,
    ModelOutputBudgetInsufficientError,
    ModelProviderNotConfiguredError,
    ModelRequest,
    ModelRequestNotSentError,
    ModelResponse,
    ModelTimeoutError,
    ModelToolCall,
    ModelToolDefinition,
    ModelUsage,
    request_input_bound,
)
from chemdft_api.ai.token_policy import (
    PER_MESSAGE_ALLOWANCE_TOKENS,
    PER_TOOL_ALLOWANCE_TOKENS,
    PROTOCOL_ALLOWANCE_TOKENS,
    bound_from_bytes,
)
from chemdft_api.ai_models import AIModelInvocationRecord
from chemdft_api.config import Settings
from pydantic import SecretStr
from sqlalchemy import select
from test_ai_execution_durability import (  # noqa: F401 -- fixtures and scripted helpers
    _draft_call,
    _final_response,
    _tool_response,
    env,
)

NEMOTRON = "nvidia/nemotron-3.5-lightning-30b-a3b"


def _request(system="s", content="hello", tools=(), messages=None) -> ModelRequest:
    return ModelRequest(
        system_prompt=system,
        messages=messages
        if messages is not None
        else (ModelMessage(role="user", content=content),),
        tools=tools,
    )


def _tool(name="molecule.draft.create", size=0) -> ModelToolDefinition:
    return ModelToolDefinition(
        name=name,
        description="d" * size,
        parameters_schema={"type": "object", "properties": {"x": {"type": "string"}}},
    )


class Recorder:
    """Scripted gateway recording each request exactly as the service hands it over."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests: list[ModelRequest] = []

    def generate(self, request):
        self.requests.append(request)
        item = self.responses[min(len(self.requests) - 1, len(self.responses) - 1)]
        if isinstance(item, Exception):
            raise item
        return item


def _usage_response(input_tokens, output_tokens=50, *, tools=()):
    return ModelResponse(
        content="ok" if not tools else "working",
        tool_calls=tuple(tools),
        usage=ModelUsage(input_tokens=input_tokens, output_tokens=output_tokens, latency_ms=1),
        model_identifier="fake-standard",
        provider="fake",
    )


def _budget(env, run_id) -> AIRunBudget:
    return AIRunBudget.from_dict(env.run_row(run_id).budget_json)


def _invocations(env, run_id):
    with env.sessions() as session:
        rows = session.scalars(
            select(AIModelInvocationRecord)
            .where(AIModelInvocationRecord.run_id == run_id)
            .order_by(AIModelInvocationRecord.created_at)
        ).all()
        for row in rows:
            session.expunge(row)
        return list(rows)


def _probe_bound(env) -> int:
    """Reserved input for the standard planning request of this fixture project."""
    probe = env.make_run()
    recorder = Recorder([_final_response()])
    env.execute(probe, recorder)
    return recorder.requests[0].reserved_input_tokens


# ----------------------------------------------------------------- estimator unit tests
def test_small_and_large_prompts_scale_with_exact_utf8_bytes():
    small = request_input_bound(_request(content="hi"), 1.0)
    large = request_input_bound(_request(content="x" * 40_000), 1.0)
    assert large.tokens - small.tokens >= 39_990  # one token per byte
    assert small.tokens >= PROTOCOL_ALLOWANCE_TOKENS + 2 * PER_MESSAGE_ALLOWANCE_TOKENS
    assert large.tokens > 1500  # the retired flat constant


def test_static_content_uses_the_floor_but_dynamic_content_never_does():
    # System prompt and tool schemas are server-authored (measured 2.7-4.3 bytes/token) and are
    # divided by the floor; user/tool/document text can be digits or coordinates (about one token
    # per byte) so it is reserved 1:1 whatever the configured floor.
    big_system = _request(system="s" * 40_000)
    assert (
        request_input_bound(big_system, 1.0).tokens - request_input_bound(big_system, 2.0).tokens
        >= 19_990
    )
    big_user = _request(content="x" * 40_000)
    assert (
        abs(request_input_bound(big_user, 1.0).tokens - request_input_bound(big_user, 2.0).tokens)
        < 30
    )
    assert request_input_bound(big_user, 2.0).dynamic_bytes >= 40_000
    assert request_input_bound(big_system, 2.0).dynamic_bytes < 200


def test_numeric_tables_are_reserved_at_least_one_token_per_digit():
    # Measured with the published tokenizer: single digits are one token each, so a digit-dense
    # message must reserve at least one token per digit even at the default floor.
    digits = " ".join(str(n % 10) for n in range(30_000))
    bound = request_input_bound(_request(content=digits), 2.0)
    assert bound.tokens >= 30_000
    coordinates = "\n".join(
        f"C {i * 0.12345678:.8f} {i * -0.98765432:.8f} 1.00000000" for i in range(2_000)
    )
    assert request_input_bound(_request(content=coordinates), 2.0).tokens >= len(coordinates) * 0.9


def test_tool_schemas_calls_and_results_are_part_of_the_estimate():
    base = request_input_bound(_request(), 1.0)
    with_tools = request_input_bound(_request(tools=(_tool(size=5_000),)), 1.0)
    assert with_tools.tokens - base.tokens >= 5_000 + PER_TOOL_ALLOWANCE_TOKENS
    assert with_tools.tool_count == 1
    call = ModelToolCall(id="c1", name="molecule.draft.create", arguments_json="y" * 3_000)
    messages = (
        ModelMessage(role="user", content="go"),
        ModelMessage(role="assistant", content="", tool_calls=(call,)),
        ModelMessage(role="tool", content="z" * 2_000, tool_call_id="c1"),
    )
    loop = request_input_bound(_request(messages=messages), 1.0)
    assert loop.tokens - request_input_bound(_request(content="go"), 1.0).tokens >= 5_000


def test_non_ascii_text_is_counted_as_decoded_utf8_not_ascii_escapes():
    text = "Å" * 1_000  # 2 UTF-8 bytes each; Å escaping would be 6 bytes each
    bound = request_input_bound(_request(content=text), 1.0)
    assert (
        2_000
        <= bound.request_bytes - request_input_bound(_request(content=""), 1.0).request_bytes
        <= 2_100
    )


def test_estimate_covers_every_content_byte_the_adapter_serializes():
    system = "policy " * 200
    request = _request(system=system, content="question " * 100, tools=(_tool(size=700),))
    bound = request_input_bound(request, 1.0)
    content_bytes = (
        len(system.encode())
        + sum(len(m.content.encode()) for m in request.messages)
        + sum(
            len(t.description.encode()) + len(json.dumps(t.parameters_schema))
            for t in request.tools
        )
    )
    assert bound.request_bytes >= content_bytes
    assert bound.tokens >= content_bytes + PROTOCOL_ALLOWANCE_TOKENS


def test_floor_is_validated_and_never_below_sound_bound():
    for bad in (0.99, 0.0, -1.0, 8.1):
        with pytest.raises(ValueError):
            bound_from_bytes(100, 1, 0, bad)
    assert bound_from_bytes(100, 1, 0, 1.0).tokens > bound_from_bytes(100, 1, 0, 8.0).tokens
    with pytest.raises(ValueError):
        bound_from_bytes(100, 1, 0, 2.0, dynamic_bytes=101)
    with pytest.raises(ValueError):
        bound_from_bytes(100, 1, 0, 2.0, dynamic_bytes=-1)
    with pytest.raises(ValueError):
        Settings(_env_file=None, ai_input_bytes_per_token_floor=0.5)


def test_gateway_refuses_before_any_network_io_when_reservation_is_too_small():
    gateway = HttpOpenAIModelGateway(
        Settings(
            _env_file=None,
            ai_api_key=SecretStr("offline-test-key"),
            ai_provider="nvidia",
            ai_model_standard=NEMOTRON,
        )
    )
    request = _request(content="x" * 10_000)
    need = request_input_bound(request, 1.0).tokens
    with patch("chemdft_api.ai.gateway.open_response") as opened:
        with pytest.raises(ModelInputBudgetInsufficientError) as caught:
            gateway.generate(
                replace(
                    request,
                    max_tokens=1024,
                    reserved_input_tokens=need - 1,
                    input_bytes_per_token_floor=1.0,
                    model_identifier=NEMOTRON,
                )
            )
        opened.assert_not_called()
    assert caught.value.required_input_tokens == need
    assert "offline-test-key" not in str(caught.value)


def test_gateway_dispatches_with_exact_provider_and_model_when_reservation_fits():
    gateway = HttpOpenAIModelGateway(
        Settings(
            _env_file=None,
            ai_api_key=SecretStr("offline-test-key"),
            ai_provider="nvidia",
            ai_model_standard=NEMOTRON,
        )
    )
    request = _request(content="x" * 10_000)
    need = request_input_bound(request, 2.0).tokens
    sent = {}

    def fake_urlopen(req, timeout=None):
        sent["body"] = json.loads(req.data)
        from test_ai_provider_integration import _ok_response

        return _ok_response(usage={"prompt_tokens": 16384, "completion_tokens": 1045})

    with patch("chemdft_api.ai.gateway.open_response", side_effect=fake_urlopen):
        response = gateway.generate(
            ModelRequest(
                system_prompt=request.system_prompt,
                messages=request.messages,
                max_tokens=1024,
                reserved_input_tokens=need,
                input_bytes_per_token_floor=2.0,
                model_identifier=NEMOTRON,
            )
        )
    assert sent["body"]["model"] == NEMOTRON
    assert response.provider == "nvidia"
    # Reported counts stay exactly as received: not clamped to, or replaced by, the reservation.
    assert (response.usage.input_tokens, response.usage.output_tokens) == (16384, 1045)
    assert need != 16384


# ----------------------------------------------------------------- budget unit tests
def test_reservation_is_rejected_not_truncated_when_it_does_not_fit():
    budget = AIRunBudget(max_input_tokens=1_000, max_output_tokens=4_000, max_model_calls=5)
    with pytest.raises(AIBudgetExceededError) as caught:
        budget.reserve_model_call(1_001, 512)
    assert caught.value.resource == "input reservation"
    assert (budget.reserved_input_tokens, budget.model_call_in_flight) == (0, False)
    budget.reserve_model_call(1_000, 512)  # exactly the remaining allowance is fine
    assert budget.reserved_input_tokens == 1_000


def test_overrun_is_counted_never_clamped_and_forces_the_sound_floor():
    budget = AIRunBudget(max_input_tokens=100_000, max_output_tokens=10_000, max_model_calls=5)
    first = budget.reserve_request(8_000, 2, 0, 2.0, 512)
    assert first.bytes_per_token_floor == 2.0
    with pytest.raises(AIBudgetExceededError):
        budget.reserve_request(8_000, 2, 0, 2.0, 512)  # one call in flight at a time
    budget.reconcile_model_usage(first.tokens + 3_000, 100)
    assert budget.input_overruns == 1
    assert budget.input_tokens_used == first.tokens + 3_000  # reported value, unclamped
    second = budget.reserve_request(8_000, 2, 0, 2.0, 512)
    assert second.bytes_per_token_floor == 1.0
    assert second.tokens > first.tokens
    assert AIRunBudget.from_dict(budget.to_dict()).input_overruns == 1  # durable
    assert AIRunBudget.from_dict({}).input_overruns == 0  # historical rows are valid


def test_no_overrun_recorded_when_reported_input_does_not_exceed_the_reservation():
    budget = AIRunBudget(max_input_tokens=100_000, max_output_tokens=10_000)
    bound = budget.reserve_request(8_000, 2, 0, 2.0, 512)
    budget.reconcile_model_usage(bound.tokens, 10)
    assert budget.input_overruns == 0 and budget.input_tokens_used == bound.tokens


# ------------------------------------------------------------ service-level regressions
def test_service_reserves_from_the_exact_request_not_a_flat_constant(env):
    run_id = env.make_run()
    recorder = Recorder([_final_response()])
    env.execute(run_id, recorder)
    request = recorder.requests[0]
    expected = request_input_bound(request, 2.0)
    assert request.reserved_input_tokens == expected.tokens
    assert request.reserved_input_tokens > 1500
    assert len(request.tools) > 0 and expected.tool_count == len(request.tools)
    assert request.max_tokens == 2048  # output stays bounded by max_tokens on the wire
    rows = _invocations(env, run_id)
    reservation = rows[0].reservation_json
    assert reservation["input_tokens"] == expected.tokens
    assert reservation["estimated_input_tokens"] == expected.tokens
    assert reservation["estimated_input_request_bytes"] == expected.request_bytes
    assert reservation["input_estimate_policy"] == "INPUT_RESERVATION_V2"
    # Estimated and reserved are quota facts; provider-reported counts are separate columns.
    assert (rows[0].input_tokens, rows[0].usage_status) == (50, "REPORTED")


def test_reported_input_exceeding_the_estimate_is_stored_as_received_and_tightens_the_run(env):
    run_id = env.make_run()
    reported = 1_000_000  # synthetic: larger than any estimate; not a verified HTTP receipt
    recorder = Recorder(
        [
            _usage_response(reported, tools=(_draft_call("methane", "C"),)),
            _final_response(),
        ]
    )
    env.execute(run_id, recorder)
    row = env.run_row(run_id)
    budget = AIRunBudget.from_dict(row.budget_json)
    # Default 60k run allowance: settlement of the oversized report fails the run explicitly.
    assert (row.status, row.error_code) == ("FAILED", "BUDGET_EXCEEDED")
    assert budget.input_tokens_used == reported and budget.input_overruns == 1
    assert len(recorder.requests) == 1  # no later dispatch after the breach
    invocation = _invocations(env, run_id)[0]
    assert invocation.input_tokens == reported
    assert invocation.reservation_json["estimated_input_tokens"] < reported


def test_overrun_within_run_allowance_switches_the_next_reservation_to_the_sound_floor(env):
    run_id = env.make_run(budget={"max_input_tokens": 500_000, "max_model_calls": 5})
    bound = _probe_bound(env)
    recorder = Recorder(
        [
            _usage_response(bound + 5_000, tools=(_draft_call("methane", "C"),)),
            _final_response(),
        ]
    )
    env.execute(run_id, recorder)
    first, second = recorder.requests
    assert first.input_bytes_per_token_floor == 2.0
    assert second.input_bytes_per_token_floor == 1.0
    assert second.reserved_input_tokens > first.reserved_input_tokens
    assert _budget(env, run_id).input_overruns == 1


def test_multiple_planning_iterations_reserve_each_call_and_stop_before_overspend(env):
    bound = _probe_bound(env)
    # Allowance fits exactly one reservation plus half of another.
    run_id = env.make_run(budget={"max_input_tokens": bound + bound // 2, "max_model_calls": 5})
    recorder = Recorder(
        [
            _usage_response(bound, tools=(_draft_call("methane", "C"),)),  # reported == reserved
            _final_response(),
        ]
    )
    env.execute(run_id, recorder)
    row = env.run_row(run_id)
    assert len(recorder.requests) == 1  # second reservation refused before dispatch
    assert (row.status, row.error_code) == ("FAILED", "BUDGET_EXCEEDED")
    budget = AIRunBudget.from_dict(row.budget_json)
    assert budget.input_tokens_used == bound and budget.input_tokens_used <= budget.max_input_tokens
    assert (budget.model_call_in_flight, budget.reserved_input_tokens) == (False, 0)
    assert len(_invocations(env, run_id)) == 1  # the refused call left no invocation receipt


def test_three_iterations_fit_when_the_allowance_covers_each_reservation(env):
    bound = _probe_bound(env)
    run_id = env.make_run(budget={"max_input_tokens": bound * 6, "max_model_calls": 5})
    recorder = Recorder(
        [
            _usage_response(bound // 2, tools=(_draft_call("methane", "C"),)),
            _usage_response(bound // 2, tools=(_draft_call("ethane", "CC"),)),
            _usage_response(bound // 2),
        ]
    )
    env.execute(run_id, recorder)
    row = env.run_row(run_id)
    budget = AIRunBudget.from_dict(row.budget_json)
    assert len(recorder.requests) == 3 and row.status == "SUCCEEDED"
    assert budget.input_tokens_used == 3 * (bound // 2)
    assert [r.reserved_input_tokens >= bound for r in recorder.requests] == [True] * 3


def test_reservation_exhaustion_rejects_before_dispatch_and_before_a_receipt(env):
    run_id = env.make_run(budget={"max_input_tokens": 1_000})
    recorder = Recorder([_final_response()])
    env.execute(run_id, recorder)
    row = env.run_row(run_id)
    assert recorder.requests == []  # nothing was sent to any provider
    assert (row.status, row.error_code) == ("FAILED", "BUDGET_EXCEEDED")
    budget = AIRunBudget.from_dict(row.budget_json)
    assert (budget.model_calls_used, budget.input_tokens_used, budget.model_call_in_flight) == (
        0,
        0,
        False,
    )
    assert _invocations(env, run_id) == []


def test_unknown_provider_usage_keeps_the_request_derived_reservation_and_no_invented_counts(env):
    run_id = env.make_run()
    recorder = Recorder(
        [
            ModelResponse(
                content="done", usage=None, model_identifier="fake-standard", provider="fake"
            )
        ]
    )
    env.execute(run_id, recorder)
    reserved = recorder.requests[0].reserved_input_tokens
    budget = _budget(env, run_id)
    assert budget.input_tokens_used == reserved and reserved > 1500
    assert budget.input_overruns == 0  # unknown is not an observed overrun
    invocation = _invocations(env, run_id)[0]
    assert (invocation.input_tokens, invocation.output_tokens) == (None, None)
    assert invocation.usage_status == "UNKNOWN"


def test_failed_provider_request_is_settled_as_uncertain_at_the_reserved_amount(env):
    run_id = env.make_run()
    recorder = Recorder([ModelTimeoutError("AI provider connection timed out.")])
    env.execute(run_id, recorder)
    row = env.run_row(run_id)
    reserved = recorder.requests[0].reserved_input_tokens
    budget = AIRunBudget.from_dict(row.budget_json)
    assert (row.status, row.error_code) == ("FAILED", "PROVIDER_TIMEOUT")
    assert (budget.input_tokens_used, budget.model_calls_used) == (reserved, 1)
    assert not budget.model_call_in_flight and budget.reservation_id is None
    invocation = _invocations(env, run_id)[0]
    assert invocation.usage_status == "UNKNOWN" and invocation.input_tokens is None
    assert invocation.status == "FAILED_UNCERTAIN"


def _ledger_rows(env, run_id):
    from chemdft_api.billing_models import AIUsageLedgerEntryRecord

    ids = [row.id for row in _invocations(env, run_id)]
    with env.sessions() as session:
        return session.scalars(
            select(AIUsageLedgerEntryRecord).where(
                AIUsageLedgerEntryRecord.model_invocation_id.in_(ids)
            )
        ).all()


def _assert_released_never_sent(env, run_id, reason):
    budget = _budget(env, run_id)
    assert (budget.input_tokens_used, budget.output_tokens_used) == (0, 0)  # nothing spent
    assert budget.model_calls_used == 0  # a request that was never made is not a model call
    assert (budget.model_call_in_flight, budget.reserved_input_tokens, budget.reservation_id) == (
        False,
        0,
        None,
    )
    receipt = _invocations(env, run_id)[0]
    assert receipt.status == "NOT_DISPATCHED"
    assert (receipt.input_tokens, receipt.output_tokens) == (None, None)  # never an invented 0
    assert receipt.usage_status == "UNKNOWN"
    assert receipt.reservation_json["dispatch_state"] == "NOT_DISPATCHED"
    assert receipt.reservation_json["not_dispatched_reason"] == reason
    assert receipt.reservation_json["released_input_tokens"] > 0
    assert _ledger_rows(env, run_id) == []  # no usage entry for a call that never happened


@pytest.mark.parametrize(
    ("error", "code", "reason"),
    [
        (
            ModelInputBudgetInsufficientError(required=10_000, reserved=1_000),
            "PROVIDER_INPUT_BUDGET_INSUFFICIENT",
            "INPUT_RESERVATION_INSUFFICIENT",
        ),
        (
            ModelOutputBudgetInsufficientError(required=512, requested=100),
            "PROVIDER_OUTPUT_BUDGET_INSUFFICIENT",
            "OUTPUT_BUDGET_INSUFFICIENT",
        ),
        (
            ModelCredentialMissingError("AI API key is not configured."),
            "PROVIDER_AUTHENTICATION_FAILED",
            "CREDENTIAL_MISSING",
        ),
        (
            ModelProviderNotConfiguredError("The selected AI provider is unavailable."),
            "PROVIDER_UNAVAILABLE",
            "PROVIDER_NOT_CONFIGURED",
        ),
        (
            ModelRequestNotSentError("Invalid bounded provider attempt count."),
            "PROVIDER_UNAVAILABLE",
            "REQUEST_REJECTED_LOCALLY",
        ),
    ],
)
def test_requests_rejected_before_dispatch_release_the_reservation_without_spend(
    env, error, code, reason
):
    run_id = env.make_run()
    recorder = Recorder([error])
    env.execute(run_id, recorder)
    row = env.run_row(run_id)
    assert (row.status, row.error_code) == ("FAILED", code)
    assert len(recorder.requests) == 1  # one local attempt, no provider I/O
    _assert_released_never_sent(env, run_id, reason)


def test_real_gateway_without_a_credential_never_reaches_the_network_and_is_released(env):
    run_id = env.make_run()
    gateway = HttpOpenAIModelGateway(Settings(_env_file=None, ai_api_key=None))
    with patch("chemdft_api.ai.gateway.open_response") as opened:
        env.execute(run_id, gateway)
        opened.assert_not_called()
    _assert_released_never_sent(env, run_id, "CREDENTIAL_MISSING")


def test_provider_selection_failure_releases_before_any_receipt_exists(env):
    from chemdft_api.ai.providers import AIFoundationError, AIProviderService

    run_id = env.make_run()
    unavailable = AIFoundationError(
        "AI_UNAVAILABLE", "The selected AI mode/provider is unavailable.", 503
    )
    with patch.object(AIProviderService, "gateway", side_effect=unavailable):
        env.execute(run_id, Recorder([_final_response()]))
    budget = _budget(env, run_id)
    assert (budget.input_tokens_used, budget.model_calls_used, budget.model_call_in_flight) == (
        0,
        0,
        False,
    )
    assert _invocations(env, run_id) == []


def test_dispatched_requests_with_uncertain_outcomes_are_still_charged(env):
    # The contrast case: a timeout may have reached the provider, so the reservation is spent.
    run_id = env.make_run()
    recorder = Recorder([ModelTimeoutError("AI provider connection timed out.")])
    env.execute(run_id, recorder)
    reserved = recorder.requests[0].reserved_input_tokens
    budget = _budget(env, run_id)
    assert (budget.input_tokens_used, budget.model_calls_used) == (reserved, 1)
    receipt = _invocations(env, run_id)[0]
    assert receipt.status == "FAILED_UNCERTAIN" and receipt.usage_status == "UNKNOWN"
    assert "dispatch_state" not in receipt.reservation_json
    assert len(_ledger_rows(env, run_id)) == 1  # unknown usage is ledgered, conservatively


def test_unsent_release_is_idempotent_scoped_and_never_rewrites_an_outcome(env):
    from chemdft_api.ai.usage_accounting import release_undispatched_invocation

    run_id = env.make_run()
    with env.sessions() as session:
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        epoch, _ = manager.claim_execution(env.project_id, run_id)
        budget, _ = manager.reserve_model_request(
            env.project_id,
            run_id,
            epoch,
            request_bytes=10_000,
            message_count=2,
            tool_count=1,
            configured_bytes_per_token_floor=2.0,
            output_tokens=1024,
        )
        reservation = budget.reservation_id
        # A stale or foreign reservation id cannot free the in-flight slot.
        assert (
            manager.release_unsent_reservation(env.project_id, run_id, reservation_id="other")
            is False
        )
        assert (
            manager.release_unsent_reservation(env.project_id, run_id, reservation_id=None) is False
        )
        assert _budget(env, run_id).model_call_in_flight
        assert (
            manager.release_unsent_reservation(env.project_id, run_id, reservation_id=reservation)
            is True
        )
        assert (
            manager.release_unsent_reservation(env.project_id, run_id, reservation_id=reservation)
            is False
        )
    settled = _budget(env, run_id)
    assert (settled.model_calls_used, settled.input_tokens_used, settled.model_call_in_flight) == (
        0,
        0,
        False,
    )

    # Receipt level: first close wins, duplicates and unknown reasons are rejected,
    # and a receipt that already has a provider outcome can never be rewritten.
    run_two = env.make_run()
    recorder = Recorder([_usage_response(321)])
    env.execute(run_two, recorder)
    receipt = _invocations(env, run_two)[0]
    assert receipt.status == "SUCCEEDED"
    with env.sessions() as session:
        assert (
            release_undispatched_invocation(session, receipt.id, reason="CREDENTIAL_MISSING")
            is False
        )
        with pytest.raises(ValueError):
            release_undispatched_invocation(session, receipt.id, reason="because I said so")
    assert (_invocations(env, run_two)[0].status, _invocations(env, run_two)[0].input_tokens) == (
        "SUCCEEDED",
        321,
    )


def test_late_release_cannot_free_a_recovered_reservation(env):
    run_id = env.make_run()
    with env.sessions() as session:  # crash after reservation: recovery charges it
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        epoch, _ = manager.claim_execution(env.project_id, run_id)
        budget, bound = manager.reserve_model_request(
            env.project_id,
            run_id,
            epoch,
            request_bytes=10_000,
            message_count=2,
            tool_count=1,
            configured_bytes_per_token_floor=2.0,
            output_tokens=1024,
        )
        old = budget.reservation_id
    with env.sessions() as session:
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        manager.claim_execution(env.project_id, run_id)  # settle_uncertain on recovery
        assert (
            manager.release_unsent_reservation(env.project_id, run_id, reservation_id=old) is False
        )
    recovered = _budget(env, run_id)
    assert (recovered.model_calls_used, recovered.input_tokens_used) == (1, bound.tokens)


@pytest.mark.parametrize("never_sent", [True, False])
def test_investigation_release_vs_uncertain_settlement(api, never_sent):
    from chemdft_api.composition import get_object_store_for_settings
    from chemdft_api.context import Identity
    from chemdft_api.investigation_models import InvestigationRecord
    from chemdft_api.investigation_service import InvestigationService
    from test_investigation_accounting import _investigation

    _, sessions, settings = api
    pid, iid = _investigation(api)
    error = (
        ModelInputBudgetInsufficientError(required=10_000, reserved=1_000)
        if never_sent
        else ModelTimeoutError("AI provider connection timed out.")
    )

    class Gateway:
        def generate(self, request):
            raise error

    with sessions() as session:
        row = session.get(InvestigationRecord, iid)
        row.status = "ACTIVE"
        session.commit()
        InvestigationService(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            get_object_store_for_settings(settings),
            settings,
            Gateway(),
        )._evaluate_decision(pid, row)
    with sessions() as session:
        budget = session.get(InvestigationRecord, iid).budget_json
        receipt = session.scalars(select(AIModelInvocationRecord)).all()[-1]
    tokens = AIRunBudget.from_dict(budget["ai_token_budget"])
    assert budget["ai_reservation"] is None
    assert not tokens.model_call_in_flight
    if never_sent:
        assert (budget["ai_calls_used"], tokens.input_tokens_used, tokens.model_calls_used) == (
            0,
            0,
            0,
        )
        assert receipt.status == "NOT_DISPATCHED"
    else:
        assert (budget["ai_calls_used"], tokens.model_calls_used) == (1, 1)
        assert tokens.input_tokens_used > 0 and receipt.status == "FAILED_UNCERTAIN"


def test_duplicate_and_stale_settlements_cannot_double_count(env):
    run_id = env.make_run()
    with env.sessions() as session:
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        epoch, _ = manager.claim_execution(env.project_id, run_id)
        budget, bound = manager.reserve_model_request(
            env.project_id,
            run_id,
            epoch,
            request_bytes=10_000,
            message_count=2,
            tool_count=3,
            configured_bytes_per_token_floor=2.0,
            output_tokens=1024,
        )
        reservation = budget.reservation_id
        manager.settle_model_usage(env.project_id, run_id, 111, 22, reservation_id=reservation)
        manager.settle_model_usage(env.project_id, run_id, 111, 22, reservation_id=reservation)
        manager.settle_uncertain_usage(env.project_id, run_id, reservation_id=reservation)
        manager.settle_model_usage(env.project_id, run_id, 999, 99, reservation_id="not-current")
    settled = _budget(env, run_id)
    assert (settled.model_calls_used, settled.input_tokens_used, settled.output_tokens_used) == (
        1,
        111,
        22,
    )
    assert bound.tokens > 111  # reservation was larger; settlement used the reported value


def test_concurrent_reservations_on_one_run_admit_exactly_one(env):
    run_id = env.make_run()
    barrier = threading.Barrier(4)

    def attempt(_):
        with env.sessions() as session:
            manager = AIRunExecutionManager(session, AIRunEventManager(session))
            barrier.wait(timeout=30)
            try:
                manager.reserve_model_request(
                    env.project_id,
                    run_id,
                    None,
                    request_bytes=20_000,
                    message_count=2,
                    tool_count=0,
                    configured_bytes_per_token_floor=2.0,
                    output_tokens=512,
                )
                return True
            except AIBudgetExceededError:
                session.rollback()
                return False

    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(attempt, range(4)))
    assert outcomes.count(True) == 1
    budget = _budget(env, run_id)
    assert budget.model_call_in_flight and budget.reserved_input_tokens <= budget.max_input_tokens


def test_concurrent_runs_each_stay_inside_their_own_authorized_allowance(env):
    bound = _probe_bound(env)
    allowance = bound + bound // 2  # one reservation fits; after reporting it, a second never can
    runs = [
        env.make_run(budget={"max_input_tokens": allowance, "max_model_calls": 5}) for _ in range(3)
    ]
    barrier = threading.Barrier(len(runs))

    def work(run_id):
        recorder = Recorder(
            [
                _usage_response(
                    bound, tools=(_draft_call(f"m{run_id[:4]}", "C", key=f"key-{run_id[:8]}"),)
                ),
                _final_response(),
            ]
        )
        barrier.wait(timeout=30)
        env.execute(run_id, recorder)
        return len(recorder.requests)

    with ThreadPoolExecutor(max_workers=len(runs)) as pool:
        sent = list(pool.map(work, runs))
    assert sent == [1, 1, 1]  # the second call is refused before dispatch in every run
    for run_id in runs:
        budget = _budget(env, run_id)
        assert budget.input_tokens_used <= allowance
        assert not budget.model_call_in_flight and budget.reserved_input_tokens == 0


def test_stale_worker_epoch_cannot_reserve(env):
    from chemdft_api.ai.execution import StaleWorkerFencedError

    run_id = env.make_run()
    with env.sessions() as session:
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        epoch, _ = manager.claim_execution(env.project_id, run_id)
        with pytest.raises(StaleWorkerFencedError):
            manager.reserve_model_request(
                env.project_id,
                run_id,
                epoch + 5,
                request_bytes=1_000,
                message_count=1,
                tool_count=0,
                configured_bytes_per_token_floor=2.0,
                output_tokens=512,
            )
    assert not _budget(env, run_id).model_call_in_flight


# --------------------------------------------------- investigation path (already request-derived)
def test_investigation_reservation_covers_every_byte_of_its_request(api):
    from chemdft_api.composition import get_object_store_for_settings
    from chemdft_api.context import Identity
    from chemdft_api.investigation_models import InvestigationRecord
    from chemdft_api.investigation_service import InvestigationService
    from test_investigation_accounting import _investigation

    _, sessions, settings = api
    pid, iid = _investigation(api)
    seen = {}

    class Gateway:
        def generate(self, request):
            with sessions() as observer:
                reserved = observer.get(InvestigationRecord, iid).budget_json["ai_reservation"]
            seen.update(request=request, reserved=reserved)
            return ModelResponse(
                content='{"decision":"INCONCLUSIVE","rationale_summary":"Offline accounting fixture"}',
                provider="fake",
                model_identifier="fake-standard",
                usage=ModelUsage(10, 5, 1),
            )

    with sessions() as session:
        row = session.get(InvestigationRecord, iid)
        row.status = "ACTIVE"
        session.commit()
        svc = InvestigationService(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            get_object_store_for_settings(settings),
            settings,
            Gateway(),
        )
        svc._evaluate_decision(pid, row)
    request = seen["request"]
    content_bytes = len(request.system_prompt.encode()) + sum(
        len(m.content.encode()) for m in request.messages
    )
    assert seen["reserved"]["input_tokens"] >= content_bytes + 1024  # sound 1 byte/token floor
    assert seen["reserved"]["input_tokens"] >= request_input_bound(request, 1.0).tokens - 64


def test_investigation_token_ceiling_pauses_before_dispatch(api):
    from chemdft_api.composition import get_object_store_for_settings
    from chemdft_api.context import Identity
    from chemdft_api.investigation_models import InvestigationRecord
    from chemdft_api.investigation_service import InvestigationService
    from test_investigation_accounting import _investigation

    _, sessions, settings = api
    pid, iid = _investigation(api)
    calls = []

    class Gateway:
        def generate(self, request):
            calls.append(request)
            raise AssertionError("must not dispatch")

    with sessions() as session:
        row = session.get(InvestigationRecord, iid)
        row.status = "ACTIVE"
        row.policy_json = {**row.policy_json, "max_ai_input_tokens": 500}
        session.commit()
        InvestigationService(
            session,
            Identity(settings.dev_user_id, settings.dev_organization_id),
            get_object_store_for_settings(settings),
            settings,
            Gateway(),
        )._evaluate_decision(pid, row)
    assert calls == []
    with sessions() as session:
        row = session.get(InvestigationRecord, iid)
        assert row.status == "PAUSED" and row.limit_reason == "AI_TOKEN_BUDGET_REACHED"
