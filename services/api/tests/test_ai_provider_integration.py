import json
import os
import urllib.error
from unittest.mock import patch

import pytest
from chemdft_api.ai.gateway import (
    HttpOpenAIModelGateway,
    ModelAuthenticationError,
    ModelGatewayError,
    ModelMessage,
    ModelProviderUnavailableError,
    ModelRateLimitError,
    ModelRequest,
    ModelTier,
    ModelTimeoutError,
    ModelToolDefinition,
    UnavailableModelGateway,
    build_model_gateway,
)
from chemdft_api.ai.providers import AIProviderService
from chemdft_api.config import Settings
from chemdft_api.context import Identity
from pydantic import SecretStr

# ==============================================================================
# OFFLINE UNIT & CONTRACT TESTS (Always Run, No Network Required)
# ==============================================================================


def test_model_gateway_builder_respects_backend_configuration():
    """Verify that build_model_gateway correctly instantiates HttpOpenAIModelGateway

    when backend credentials and integration opt-in are provided.
    """
    settings_inactive = Settings(
        ai_provider="openai",
        ai_api_key=SecretStr("sk-backend-secret-test"),
        run_ai_integration=False,
    )
    assert isinstance(build_model_gateway(settings_inactive), UnavailableModelGateway)

    settings_active = Settings(
        ai_provider="openai",
        ai_api_key=SecretStr("sk-backend-secret-test"),
        run_ai_integration=True,
    )
    gateway = build_model_gateway(settings_active)
    assert isinstance(gateway, HttpOpenAIModelGateway)


def test_openai_gateway_wire_tool_name_translation():
    """Verify that dot-separated product tool names (e.g. calculation.submit)

    are translated to wire-safe names (e.g. calculation__submit) on the wire
    and mapped back to the canonical product tool names in the response.
    """
    settings = Settings(
        ai_provider="openai",
        ai_api_key=SecretStr("sk-backend-secret-test"),
        run_ai_integration=True,
    )
    gateway = HttpOpenAIModelGateway(settings)

    tools = (
        ModelToolDefinition(
            name="calculation.submit",
            description="Submit a quantum chemical calculation",
            parameters_schema={
                "type": "object",
                "properties": {"task": {"type": "string"}},
                "required": ["task"],
            },
        ),
        ModelToolDefinition(
            name="molecule.resolve",
            description="Resolve a molecule name to canonical representation",
            parameters_schema={
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
        ),
    )

    request = ModelRequest(
        system_prompt="You are a computational chemistry assistant.",
        messages=(ModelMessage(role="user", content="Calculate methane energy"),),
        tools=tools,
        model_tier=ModelTier.STANDARD,
    )

    mock_response_payload = {
        "model": "gpt-4o-mini",
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_123",
                            "type": "function",
                            "function": {
                                "name": "calculation__submit",
                                "arguments": json.dumps({"task": "ENERGY"}),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 50, "completion_tokens": 20},
    }

    class MockHTTPResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def read(self, limit=-1):
            return json.dumps(mock_response_payload).encode("utf-8")

    captured_requests = []

    def mock_urlopen(req, timeout=None):
        captured_requests.append(req)
        return MockHTTPResponse()

    with patch("chemdft_api.ai.gateway.open_response", side_effect=mock_urlopen):
        response = gateway.generate(request)

    assert len(captured_requests) == 1
    sent_body = json.loads(captured_requests[0].data.decode("utf-8"))

    # Verify wire names were sanitized with double underscore
    wire_tool_names = [t["function"]["name"] for t in sent_body["tools"]]
    assert "calculation__submit" in wire_tool_names
    assert "molecule__resolve" in wire_tool_names

    # Verify response tool call name was translated back to product name with dot
    assert len(response.tool_calls) == 1
    assert response.tool_calls[0].name == "calculation.submit"
    assert json.loads(response.tool_calls[0].arguments_json) == {"task": "ENERGY"}


def test_openai_gateway_error_mapping_without_credential_leakage():
    """Verify that HTTP errors (401, 429, timeout) map to typed gateway exceptions

    without exposing sensitive credentials.
    """
    settings = Settings(
        ai_provider="openai",
        ai_api_key=SecretStr("sk-super-secret-key-12345"),
        run_ai_integration=True,
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test",
        messages=(ModelMessage(role="user", content="Ping"),),
    )

    # 401 Unauthorized -> ModelAuthenticationError
    with patch(
        "chemdft_api.ai.gateway.open_response",
        side_effect=urllib.error.HTTPError(
            "https://api.openai.com/v1", 401, "Unauthorized", {}, None
        ),
    ):
        with pytest.raises(ModelAuthenticationError) as exc_info:
            gateway.generate(request)
        assert "sk-super-secret-key-12345" not in str(exc_info.value)

    # 429 Rate Limit -> ModelRateLimitError
    with patch(
        "chemdft_api.ai.gateway.open_response",
        side_effect=urllib.error.HTTPError(
            "https://api.openai.com/v1", 429, "Too Many Requests", {}, None
        ),
    ):
        with pytest.raises(ModelRateLimitError) as exc_info:
            gateway.generate(request)
        assert "sk-super-secret-key-12345" not in str(exc_info.value)

    # Timeout -> ModelTimeoutError
    with patch("chemdft_api.ai.gateway.open_response", side_effect=TimeoutError("Request timed out")):
        with pytest.raises(ModelTimeoutError) as exc_info:
            gateway.generate(request)
        assert "sk-super-secret-key-12345" not in str(exc_info.value)


class _MockHTTPResponse:
    def __init__(self, payload):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self, limit=-1):
        return json.dumps(self._payload).encode("utf-8")


def _ok_response(**overrides):
    payload = {
        "model": "gpt-4o-mini",
        "choices": [{"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }
    payload.update(overrides)
    return _MockHTTPResponse(payload)


def test_rate_limit_429_is_retried_with_retry_after():
    """A 429 is a provider-side refusal that did not bill the request; it is
    retried, honoring the Retry-After header."""
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test", messages=(ModelMessage(role="user", content="Ping"),)
    )

    calls = {"n": 0}
    sleep_calls = []

    def mock_urlopen(req, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError(
                "https://api.openai.com/v1",
                429,
                "Too Many Requests",
                {"Retry-After": "2"},
                None,
            )
        return _ok_response()

    with patch("chemdft_api.ai.gateway.open_response", side_effect=mock_urlopen), patch(
        "chemdft_api.ai.gateway.time.sleep", side_effect=lambda s: sleep_calls.append(s)
    ):
        response = gateway.generate(request)

    assert calls["n"] == 2  # retried once
    assert sleep_calls and sleep_calls[0] >= 2  # honored Retry-After
    assert response.usage is not None
    assert response.usage.input_tokens == 10


def test_server_error_500_is_retried_then_recovers():
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test", messages=(ModelMessage(role="user", content="Ping"),)
    )

    calls = {"n": 0}

    def mock_urlopen(req, timeout=None):
        calls["n"] += 1
        if calls["n"] <= 2:
            raise urllib.error.HTTPError(
                "https://api.openai.com/v1", 500, "Internal Server Error", {}, None
            )
        return _ok_response()

    with patch("chemdft_api.ai.gateway.open_response", side_effect=mock_urlopen), patch(
        "chemdft_api.ai.gateway.time.sleep"
    ):
        response = gateway.generate(request)

    assert calls["n"] == 3
    assert response.content == "ok"


def test_retry_exhaustion_raises_provider_unavailable():
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test", messages=(ModelMessage(role="user", content="Ping"),)
    )

    with patch(
        "chemdft_api.ai.gateway.open_response",
        side_effect=urllib.error.HTTPError(
            "https://api.openai.com/v1", 503, "Service Unavailable", {}, None
        ),
    ), patch("chemdft_api.ai.gateway.time.sleep"):
        with pytest.raises(ModelProviderUnavailableError):
            gateway.generate(request)


def test_timeout_is_not_retried():
    """A connection timeout is ambiguous: the request may have been billed.
    It must not be retried so the service layer can settle uncertain usage."""
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test", messages=(ModelMessage(role="user", content="Ping"),)
    )

    calls = {"n": 0}

    def mock_urlopen(req, timeout=None):
        calls["n"] += 1
        raise TimeoutError("timed out")

    with patch("chemdft_api.ai.gateway.open_response", side_effect=mock_urlopen), patch(
        "chemdft_api.ai.gateway.time.sleep"
    ) as sleep_mock:
        with pytest.raises(ModelTimeoutError):
            gateway.generate(request)

    assert calls["n"] == 1  # no retry
    sleep_mock.assert_not_called()


def test_retry_after_http_date_falls_back_to_backoff():
    """An HTTP-date Retry-After value cannot be parsed as a float; the gateway
    must fall back to bounded exponential backoff rather than sleeping for an
    unbounded or negative duration."""
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test", messages=(ModelMessage(role="user", content="Ping"),)
    )

    calls = {"n": 0}
    sleep_calls = []

    def mock_urlopen(req, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError(
                "https://api.openai.com/v1",
                429,
                "Too Many Requests",
                {"Retry-After": "Wed, 21 Oct 2099 07:28:00 GMT"},
                None,
            )
        return _ok_response()

    with patch("chemdft_api.ai.gateway.open_response", side_effect=mock_urlopen), patch(
        "chemdft_api.ai.gateway.time.sleep", side_effect=lambda s: sleep_calls.append(s)
    ):
        response = gateway.generate(request)

    assert calls["n"] == 2
    # Bounded exponential backoff for attempt 0: min(1.0 * 2**0, 10.0) == 1.0
    assert sleep_calls and sleep_calls[0] == 1.0
    assert response.usage is not None


def test_retry_after_long_delay_is_not_retried_prematurely():
    """A Retry-After value larger than the configured synchronous retry window
    must NOT be retried prematurely. The gateway surfaces the rate limit so the
    caller can back off or notify the user, rather than retrying after a shorter
    delay and risking double-billing."""
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test", messages=(ModelMessage(role="user", content="Ping"),)
    )

    calls = {"n": 0}
    sleep_calls = []

    def mock_urlopen(req, timeout=None):
        calls["n"] += 1
        raise urllib.error.HTTPError(
            "https://api.openai.com/v1",
            429,
            "Too Many Requests",
            {"Retry-After": "3600"},
            None,
        )

    with patch("chemdft_api.ai.gateway.open_response", side_effect=mock_urlopen), patch(
        "chemdft_api.ai.gateway.time.sleep", side_effect=lambda s: sleep_calls.append(s)
    ), pytest.raises(ModelRateLimitError):
        gateway.generate(request)

    # Only one attempt: the long Retry-After means we do not retry.
    assert calls["n"] == 1
    assert sleep_calls == []


def test_missing_usage_returns_none_not_zero():
    """When the provider omits the usage block, the gateway must not invent
    zero token counts; it returns usage=None so the budget is settled as
    uncertain."""
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test", messages=(ModelMessage(role="user", content="Ping"),)
    )

    with patch("chemdft_api.ai.gateway.open_response", return_value=_ok_response(usage=None)):
        response = gateway.generate(request)

    assert response.usage is None


def test_truncated_response_is_rejected():
    """A finish_reason of 'length' means the output token limit was hit and the
    response may be incomplete; it must be refused rather than consumed."""
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test", messages=(ModelMessage(role="user", content="Ping"),)
    )

    truncated = {
        "model": "gpt-4o-mini",
        "choices": [
            {"message": {"role": "assistant", "content": "partial"}, "finish_reason": "length"}
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }
    with patch("chemdft_api.ai.gateway.open_response", return_value=_MockHTTPResponse(truncated)):
        with pytest.raises(ModelGatewayError):
            gateway.generate(request)


def test_reasoning_content_is_never_returned():
    """Provider chain-of-thought must be stripped so it cannot be persisted."""
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test", messages=(ModelMessage(role="user", content="Ping"),)
    )

    payload = {
        "model": "gpt-4o-mini",
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "answer",
                    "reasoning_content": "internal chain of thought",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }
    with patch("chemdft_api.ai.gateway.open_response", return_value=_MockHTTPResponse(payload)):
        response = gateway.generate(request)

    assert response.content == "answer"


def test_strict_output_limit_is_sent_on_wire():
    """The per-request max_tokens must be forwarded to the provider so the
    provider enforces the output budget the service reserved."""
    settings = Settings(
        ai_provider="openai", ai_api_key=SecretStr("sk-test"), run_ai_integration=True,
        ai_model_standard="gpt-4o",
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test",
        messages=(ModelMessage(role="user", content="Ping"),),
        max_tokens=128,
    )

    captured = {}

    def mock_urlopen(req, timeout=None):
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return _ok_response()

    with patch("chemdft_api.ai.gateway.open_response", side_effect=mock_urlopen):
        gateway.generate(request)

    assert captured["body"].get("max_tokens") == 128


@pytest.mark.parametrize("usage", [{}, {"prompt_tokens": 12}, {"completion_tokens": 4}])
def test_incomplete_provider_usage_is_unknown(usage):
    gateway = HttpOpenAIModelGateway(Settings(
        _env_file=None, ai_provider="nvidia", ai_api_key=SecretStr("offline-test"),
        ai_model_standard="nvidia/nemotron-3.5-lightning-30b-a3b",
    ))
    with patch("chemdft_api.ai.gateway.open_response", return_value=_ok_response(usage=usage)):
        response = gateway.generate(ModelRequest(system_prompt="Test", messages=(), max_tokens=512))
    assert response.usage is None
    assert response.reported_usage["input_tokens"] == usage.get("prompt_tokens")
    assert response.reported_usage["output_tokens"] == usage.get("completion_tokens")


@pytest.mark.parametrize("status", [429, 500])
def test_one_authorized_attempt_never_retries_implicitly(status):
    gateway = HttpOpenAIModelGateway(Settings(
        _env_file=None, ai_api_key=SecretStr("offline-test"), ai_model_standard="gpt-4o",
    ))
    error = urllib.error.HTTPError("https://example.invalid", status, "offline", {}, None)
    with patch("chemdft_api.ai.gateway.open_response", side_effect=error) as calls, patch("time.sleep") as sleep:
        with pytest.raises(ModelGatewayError):
            gateway.generate(ModelRequest(system_prompt="Offline", messages=(), max_tokens=512,
                                          max_attempts=1))
    assert calls.call_count == 1
    sleep.assert_not_called()


def test_truncated_output_preserves_valid_usage_for_accounting():
    gateway = HttpOpenAIModelGateway(Settings(
        _env_file=None, ai_api_key=SecretStr("offline-test"), ai_model_standard="gpt-4o",
    ))
    body = _ok_response(choices=[{"message": {"content": "incomplete"}, "finish_reason": "length"}])
    with patch("chemdft_api.ai.gateway.open_response", return_value=body):
        with pytest.raises(ModelGatewayError) as caught:
            gateway.generate(ModelRequest(system_prompt="Offline", messages=(), max_tokens=512))
    assert caught.value.usage.input_tokens == 10
    assert caught.value.usage.output_tokens == 5


@pytest.mark.parametrize("counts", [(0, 0), (12, 4)])
def test_complete_provider_usage_preserves_confirmed_counts(counts):
    gateway = HttpOpenAIModelGateway(Settings(
        _env_file=None, ai_api_key=SecretStr("offline-test"), ai_model_standard="gpt-4o",
    ))
    usage = {"prompt_tokens": counts[0], "completion_tokens": counts[1]}
    with patch("chemdft_api.ai.gateway.open_response", return_value=_ok_response(usage=usage)):
        response = gateway.generate(ModelRequest(system_prompt="Test", messages=(), max_tokens=512))
    assert response.usage is not None
    assert (response.usage.input_tokens, response.usage.output_tokens) == counts


def test_nemotron_budget_below_minimum_raises_typed_error():
    """Nemotron requires a minimum output budget. The gateway must raise an
    explicit typed error rather than silently increasing max_tokens beyond the
    authorized reservation."""
    from chemdft_api.ai.gateway import ModelOutputBudgetInsufficientError

    settings = Settings(
        ai_provider="nvidia",
        ai_model_standard="nvidia/nemotron-3.5-lightning-30b-a3b",
        ai_api_key=SecretStr("nvapi-test"),
        run_ai_integration=True,
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test",
        messages=(ModelMessage(role="user", content="Ping"),),
        max_tokens=128,  # below Nemotron minimum of 512
    )

    with pytest.raises(ModelOutputBudgetInsufficientError) as caught:
        gateway.generate(request)

    assert caught.value.required_min_tokens == 512
    assert caught.value.requested_tokens == 128


def test_nemotron_budget_at_minimum_is_sent_unmodified():
    """When the authorized budget meets the Nemotron minimum, the gateway must
    send the exact reserved value (not bumped up) so the provider enforces the
    authorized output budget."""
    settings = Settings(
        ai_provider="nvidia",
        ai_model_standard="nvidia/nemotron-3.5-lightning-30b-a3b",
        ai_api_key=SecretStr("nvapi-test"),
        run_ai_integration=True,
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test",
        messages=(ModelMessage(role="user", content="Ping"),),
        max_tokens=512,
    )

    captured = {}

    def mock_urlopen(req, timeout=None):
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return _ok_response()

    with patch("chemdft_api.ai.gateway.open_response", side_effect=mock_urlopen):
        gateway.generate(request)

    assert captured["body"].get("max_tokens") == 512


def test_nvidia_provider_identity_is_tracked_correctly():
    """NVIDIA calls must be identified as provider 'nvidia', not mislabeled as
    'openai' even though the request uses the OpenAI-compatible wire format."""
    settings = Settings(
        ai_provider="nvidia",
        ai_model_standard="nvidia/nemotron-3.5-lightning-30b-a3b",
        ai_api_key=SecretStr("nvapi-test"),
        run_ai_integration=True,
    )
    gateway = HttpOpenAIModelGateway(settings)
    request = ModelRequest(
        system_prompt="Test",
        messages=(ModelMessage(role="user", content="Ping"),),
        max_tokens=512,
    )

    with patch(
        "chemdft_api.ai.gateway.open_response",
        return_value=_ok_response(model="nvidia/nemotron-3.5-lightning-30b-a3b"),
    ):
        response = gateway.generate(request)

    assert response.provider == "nvidia"
    assert response.model_identifier == "nvidia/nemotron-3.5-lightning-30b-a3b"


def test_backend_managed_ai_availability_without_user_byok(api):
    """Verify that backend-only API key configuration marks MANAGED AI available

    without requiring an end-user BYOK key.
    """
    _client, sessions, _settings = api
    settings = Settings(
        ai_provider="openai",
        ai_model_standard="gpt-4o-mini",
        ai_api_key=SecretStr("sk-backend-secret"),
        run_ai_integration=True,
        billing_managed_ai_enabled=True,
    )
    identity = Identity(user_id="user-123", organization_id="org-456")

    with sessions() as session:
        service = AIProviderService(session, identity, settings)
        availability = service.availability()

        assert availability.available is True
        assert availability.error_code is None
        assert availability.managed_enabled is True
        assert availability.mode == "MANAGED"
        assert availability.provider == "openai"


def test_ai_settings_endpoint_never_exposes_backend_api_key(api):
    """Verify that GET /v1/ai/settings and /v1/ai/preferences do not expose

    the backend secret key in HTTP responses.
    """
    client, _sessions, settings = api
    settings.ai_provider = "openai"
    settings.ai_api_key = SecretStr("sk-" "backend-never-leak-this-token")
    settings.run_ai_integration = True

    response = client.get("/v1/ai/settings")
    assert response.status_code == 200
    text_content = response.text
    assert "sk-" "backend-never-leak-this-token" not in text_content


# ==============================================================================
# LIVE OPT-IN REAL PROVIDER INTEGRATION TESTS
# ==============================================================================


@pytest.mark.ai_integration
def test_real_ai_provider_connectivity():
    """FIRST LIVE TEST: Verifies connectivity to the real AI provider (e.g. NVIDIA nemotron),

    token counting, and bounded JSON response generation.
    """
    settings = Settings()
    if not (settings.run_ai_integration and settings.ai_api_key):
        pytest.skip("Live real AI API call requires run_ai_integration=True and configured ai_api_key")

    gateway = HttpOpenAIModelGateway(settings)

    request = ModelRequest(
        system_prompt="You are a quantum chemistry assistant. Answer strictly in JSON format.",
        messages=(
            ModelMessage(
                role="user",
                content=(
                    "What is the chemical formula of water? "
                    "Output format: {\"formula\": \"H2O\"}"
                ),
            ),
        ),
        model_tier=ModelTier.STANDARD,
        temperature=0.0,
        max_tokens=64,
    )

    response = gateway.generate(request)

    assert response.content is not None
    assert "H2O" in response.content
    assert response.usage.input_tokens > 0
    assert response.usage.output_tokens > 0
    assert response.usage.latency_ms > 0
    assert response.provider == settings.ai_provider


@pytest.mark.ai_integration
def test_real_ai_provider_structured_tool_calling():
    """SECOND LIVE TEST: Verifies that the real LLM accurately calls a ChemDFT application tool

    (molecule.resolve) with structured JSON arguments matching our Pydantic schema.
    """
    settings = Settings()
    if not (settings.run_ai_integration and settings.ai_api_key):
        pytest.skip("Live real AI API call requires run_ai_integration=True and configured ai_api_key")

    gateway = HttpOpenAIModelGateway(settings)

    tools = (
        ModelToolDefinition(
            name="molecule.resolve",
            description="Resolve a chemical name to identifiers and structure.",
            parameters_schema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Chemical name to resolve"}
                },
                "required": ["name"],
            },
        ),
    )

    request = ModelRequest(
        system_prompt=(
            "You are an AI computational chemist. When asked to resolve or inspect a molecule, "
            "you MUST call the molecule.resolve tool."
        ),
        messages=(
            ModelMessage(
                role="user",
                content="Please resolve the molecular structure for benzene.",
            ),
        ),
        tools=tools,
        model_tier=ModelTier.STANDARD,
        temperature=0.0,
        max_tokens=128,
    )

    response = gateway.generate(request)

    assert len(response.tool_calls) >= 1
    call = response.tool_calls[0]
    assert call.name == "molecule.resolve"
    args = json.loads(call.arguments_json)
    assert "benzene" in args.get("name", "").lower()
