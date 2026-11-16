"""Offline provider-observation regression; no live request or scientific execution."""

from unittest.mock import patch

from chemdft_api.ai.gateway import HttpOpenAIModelGateway, ModelRequest
from chemdft_api.config import Settings
from pydantic import SecretStr
from test_ai_provider_integration import _ok_response


def test_nvidia_observed_usage_is_not_replaced_with_budget_values():
    gateway = HttpOpenAIModelGateway(Settings(
        _env_file=None, ai_api_key=SecretStr("offline-test"), ai_provider="nvidia",
        ai_model_standard="nvidia/nemotron-3.5-lightning-30b-a3b",
    ))
    usage = {"prompt_tokens": 16384, "completion_tokens": 1045}
    with patch("chemdft_api.ai.gateway.open_response", return_value=_ok_response(usage=usage)):
        response = gateway.generate(ModelRequest(
            system_prompt="Offline usage regression", messages=(), max_tokens=2048,
        ))
    assert response.provider == "nvidia"
    assert response.usage is not None
    assert (response.usage.input_tokens, response.usage.output_tokens) == (16384, 1045)
    assert response.reported_usage == {
        "input_tokens": 16384, "output_tokens": 1045, "cached_tokens": None,
    }
