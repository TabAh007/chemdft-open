"""AI-8 offline checks: the direct Moonshot request shape, validated before any I/O.

Moonshot's own API fixes sampling and has per-model thinking controls; the gateway sends only the
reviewed fields and refuses a model or a sampling field it has not reviewed. No test contacts
Moonshot or reads a credential: the HTTP layer is replaced and the key is a throwaway string.
"""

import json
from unittest.mock import patch

import pytest
from chemdft_api.ai.gateway import (
    MOONSHOT_BASE,
    MOONSHOT_MODELS,
    HttpOpenAIModelGateway,
    ModelMessage,
    ModelRequest,
    ModelRequestNotSentError,
)
from chemdft_api.config import Settings
from pydantic import SecretStr
from test_ai_provider_integration import _ok_response


def gateway(provider="moonshot", base=MOONSHOT_BASE):
    return HttpOpenAIModelGateway(
        Settings(
            _env_file=None,
            ai_api_key=SecretStr("offline-test"),
            ai_provider=provider,
            ai_api_base_url=base,
        )
    )


def request(model, **extra):
    return ModelRequest(
        system_prompt="s",
        messages=(ModelMessage(role="user", content="u"),),
        model_identifier=model,
        max_tokens=2048,
        max_attempts=1,
        **extra,
    )


def sent(model, **extra):
    with patch("chemdft_api.ai.gateway.open_response", return_value=_ok_response()) as opened:
        answer = gateway().generate(request(model, **extra))
    wire = opened.call_args.args[0]
    return json.loads(wire.data), wire, answer


def test_k26_sends_only_the_reviewed_fields_and_never_temperature_or_top_p():
    payload, wire, answer = sent("kimi-k2.6")
    assert set(payload) == {"model", "messages", "thinking", "max_tokens"}
    assert payload["thinking"] == {"type": "disabled"} and payload["max_tokens"] == 2048
    assert wire.full_url == "https://api.moonshot.ai/v1/chat/completions"
    assert wire.get_header("Authorization") == "Bearer offline-test"
    assert answer.provider == "moonshot"  # the real provider is the label the service records


def test_k3_uses_its_own_token_field_and_a_low_reasoning_effort():
    payload, _wire, _answer = sent("kimi-k3")
    assert set(payload) == {"model", "messages", "reasoning_effort", "max_completion_tokens"}
    assert payload["reasoning_effort"] == "low" and payload["max_completion_tokens"] == 2048


def test_only_reviewed_moonshot_models_are_accepted_and_nothing_is_sent_for_others():
    assert set(MOONSHOT_MODELS) == {"kimi-k3", "kimi-k2.6"}
    with patch("chemdft_api.ai.gateway.open_response") as opened:
        for model in ("kimi-k2.5", "moonshot-v1-8k", "kimi-k2.7-code", "nvidia/x"):
            with pytest.raises(ModelRequestNotSentError):
                gateway().generate(request(model))
    opened.assert_not_called()


@pytest.mark.parametrize(
    "extra",
    [{"top_p": 0.95}, {"chat_template_kwargs": (("enable_thinking", True),)}],
)
def test_sampling_fields_that_moonshot_fixes_are_refused_before_any_io(extra):
    with (
        patch("chemdft_api.ai.gateway.open_response") as opened,
        pytest.raises(ModelRequestNotSentError),
    ):
        gateway().generate(request("kimi-k2.6", **extra))
    opened.assert_not_called()


def test_a_non_moonshot_provider_keeps_the_pre_existing_payload_byte_for_byte():
    with patch("chemdft_api.ai.gateway.open_response", return_value=_ok_response()) as opened:
        gateway("nvidia", "https://integrate.api.nvidia.com/v1").generate(
            request("nvidia/nemotron-3.5-lightning-30b-a3b")
        )
    payload = json.loads(opened.call_args.args[0].data)
    assert set(payload) == {"model", "messages", "temperature", "max_tokens"}
    assert payload["temperature"] == 0.0
