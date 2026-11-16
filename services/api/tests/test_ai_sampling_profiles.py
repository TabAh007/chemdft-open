"""Model-card sampling profiles are opt-in, validated before any I/O, and leave production alone."""

import json
from unittest.mock import patch

import pytest
from chemdft_api.ai.gateway import (
    ALLOWED_CHAT_TEMPLATE_KWARGS,
    HttpOpenAIModelGateway,
    ModelMessage,
    ModelRequest,
    ModelRequestNotSentError,
)
from chemdft_api.ai.model_catalog import (
    DEFINITIONS,
    LIGHTNING,
    SAMPLING_PROFILES,
    sampling_profile,
)
from chemdft_api.config import Settings
from pydantic import SecretStr
from test_ai_provider_integration import _ok_response

SUPER = "nvidia/nemotron-3-super-120b-a12b"


def gateway():
    return HttpOpenAIModelGateway(
        Settings(_env_file=None, ai_api_key=SecretStr("offline-test"), ai_provider="nvidia")
    )


def request(**extra):
    return ModelRequest(
        system_prompt="s",
        messages=(ModelMessage(role="user", content="u"),),
        model_identifier=LIGHTNING,
        max_tokens=512,
        max_attempts=1,
        **extra,
    )


def sent_payload(req):
    with patch("chemdft_api.ai.gateway.open_response", return_value=_ok_response()) as opened:
        gateway().generate(req)
    return json.loads(opened.call_args.args[0].data)


def test_default_request_is_byte_for_byte_the_pre_existing_production_payload():
    payload = sent_payload(request())
    assert payload["temperature"] == 0.0
    assert "top_p" not in payload and "chat_template_kwargs" not in payload
    assert set(payload) == {"model", "messages", "temperature", "max_tokens"}
    plain = ModelRequest(system_prompt="s", messages=())
    assert plain.temperature == 0.0 and plain.top_p is None and plain.chat_template_kwargs is None


def test_profile_fields_reach_the_wire_exactly_as_documented():
    payload = sent_payload(
        request(
            temperature=1.0,
            top_p=0.95,
            chat_template_kwargs=(("enable_thinking", True), ("low_effort", True)),
        )
    )
    assert (payload["temperature"], payload["top_p"]) == (1.0, 0.95)
    assert payload["chat_template_kwargs"] == {"enable_thinking": True, "low_effort": True}
    only_top_p = sent_payload(request(temperature=1.0, top_p=0.95))
    assert only_top_p["top_p"] == 0.95 and "chat_template_kwargs" not in only_top_p


@pytest.mark.parametrize(
    "extra",
    [
        {"top_p": 0},
        {"top_p": 1.5},
        {"top_p": -0.1},
        {"top_p": True},
        {"top_p": "0.95"},
        {"chat_template_kwargs": ()},
        {"chat_template_kwargs": (("enable_thinking", 1),)},
        {"chat_template_kwargs": (("enable_thinking", "yes"),)},
        {"chat_template_kwargs": (("reasoning_budget", True),)},  # not an allowlisted switch
        {"chat_template_kwargs": (("enable_thinking", True), ("enable_thinking", False))},
    ],
)
def test_invalid_sampling_is_refused_before_any_network_use(extra):
    with patch("chemdft_api.ai.gateway.open_response") as opened:
        with pytest.raises(ModelRequestNotSentError):
            gateway().generate(request(**extra))
        opened.assert_not_called()


REVIEWED = {
    LIGHTNING,
    SUPER,
    "nvidia/nemotron-3-ultra-550b-a55b",
    "nvidia/nemotron-3.5-super-vl-120b-a12b",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "deepseek-ai/deepseek-v4.1-flash",
    "meta/muse-glimmer-30b",
    "stepfun-ai/step-5-preview",
    "google/gemma-4-31b-it",
    "moonshotai/kimi-k2.6",  # AI-8: probe-only; the row stays UNKNOWN and not selectable
}


def test_profiles_are_card_backed_documented_and_cover_only_reviewed_models():
    assert set(SAMPLING_PROFILES) == REVIEWED
    registered = {d.model for d in DEFINITIONS}
    assert set(SAMPLING_PROFILES) <= registered
    for model, profile in SAMPLING_PROFILES.items():
        assert profile.source_urls and all(
            u.startswith(("https://docs.api.nvidia.com/", "https://build.nvidia.com/"))
            for u in profile.source_urls
        )
        assert profile.top_p == 0.95 and profile.temperature in {1.0, 0.6}, model
        assert profile.reviewed_on in {"2026-10-17", "2026-10-18"} and profile.note
        names = {name for name, _ in profile.chat_template_kwargs or ()}
        assert names <= ALLOWED_CHAT_TEMPLATE_KWARGS, model
    # only the three models whose pages document chat_template_kwargs switches send any
    assert {m for m, p in SAMPLING_PROFILES.items() if p.chat_template_kwargs} == {
        SUPER,
        "nvidia/nemotron-3-ultra-550b-a55b",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    }
    assert SAMPLING_PROFILES["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"].temperature == 0.6
    assert sampling_profile("unknown/model") is None
    assert sampling_profile("moonshotai/kimi-k2.5") is None  # not in the API: not probeable


def test_production_code_applies_a_profile_only_through_the_one_service_guard():
    """AI-4 allowed no production code to apply a profile. AI-6 allows exactly one call site: the
    service, only through service_sampling_profile, which returns a profile for nothing but a
    development-eligible NVIDIA model (test_ai6_model_sampling.py shows every other model keeps
    temperature 0). The contract may only record what a call used."""
    import re
    from pathlib import Path

    source = Path(__import__("chemdft_api").__file__).parent
    for path in source.rglob("*.py"):
        if path.name in {"model_catalog.py", "gateway.py", "model_discovery.py"}:  # read-only use
            continue
        text = path.read_text()
        if path.parent.name == "ai" and path.name == "service.py":
            assert "SAMPLING_PROFILES" not in text, path  # the table stays inside the catalogue
            assert not re.search(r"(?<![A-Za-z_])sampling_profile\(", text), path  # no raw lookup
            assert text.count("service_sampling_profile(") == 1, path  # one guarded call site
            continue
        if path.parent.name == "contracts" and path.name == "ai.py":
            assert "SAMPLING_PROFILES" not in text and "sampling_profile" not in text, path
            # one field that records what a call used, never an application of a profile
            assert text.count("chat_template_kwargs") == 1 and "top_p=" not in text, path
            continue
        assert "SAMPLING_PROFILES" not in text and "sampling_profile" not in text, path
        assert "chat_template_kwargs" not in text and "top_p=" not in text, path
