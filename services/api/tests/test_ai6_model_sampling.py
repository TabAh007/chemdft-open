"""AI-6 offline checks: the development path is real end to end, and it is recorded.

Through the API with a recording stand-in for the NVIDIA endpoint (no network): a development
model is selectable only for the profile its evidence covers, its documented sampling reaches the
gateway request, every other model keeps temperature 0, the settings used are recorded with the
model call, and the approval names the model that proposed. No engine runs; nothing is approved.
"""

import json
from dataclasses import dataclass, field

import pytest
from chemdft_api.ai import providers
from chemdft_api.ai.gateway import ModelResponse, ModelToolCall, ModelUsage
from chemdft_api.ai.model_catalog import LIGHTNING, NVIDIA_BASE
from chemdft_api.ai_models import AIModelInvocationRecord
from pydantic import SecretStr
from sqlalchemy import select
from test_hosted_ai_proposals import arguments, setup

SUPER = "nvidia/nemotron-3-super-120b-a12b"
STEP5 = "stepfun-ai/step-5-preview"
PROMPT = "Offline fixture: propose H2 HF/STO-3G energy, charge 0 multiplicity 1."


@dataclass
class Nvidia:
    """Records every request and answers as the model it was asked for."""

    answers: list
    requests: list = field(default_factory=list)

    def generate(self, request):
        self.requests.append(request)
        answer = self.answers[min(len(self.requests) - 1, len(self.answers) - 1)]
        return ModelResponse(
            content=answer.get("content"),
            tool_calls=tuple(answer.get("tool_calls", ())),
            usage=ModelUsage(input_tokens=1000, output_tokens=60, latency_ms=1),
            model_identifier=request.model_identifier,
            provider="nvidia",
            finish_reason="tool_calls" if answer.get("tool_calls") else "stop",
        )


def proposal_call(args):
    return {"tool_calls": [ModelToolCall("call-1", "calculation.submit", json.dumps(args))]}


def configure(settings, *, standard, fast=None, enabled=f"{SUPER},{STEP5}"):
    settings.ai_provider = "nvidia"
    settings.ai_api_base_url = NVIDIA_BASE
    settings.ai_model_standard = standard
    settings.ai_model_fast = fast or standard
    settings.ai_model_reasoning = standard
    settings.ai_development_models = enabled
    settings.run_ai_integration = True
    settings.ai_api_key = SecretStr("offline-not-a-real-key")
    settings.billing_managed_ai_enabled = True


def ask(env, monkeypatch, gateway, *, profile="PYSCF_ENERGY_PROPOSAL", content=PROMPT):
    client, _sessions, _settings, _project, version, base, conversation, _args = env
    monkeypatch.setattr(providers, "build_model_gateway", lambda _settings: gateway)
    return client.post(
        f"{base}/conversations/{conversation}/messages",
        json={
            "content": content,
            "mode": "STANDARD",
            "planning_profile": profile,
            "selected_structure_version_id": version,
            "run_limits": {
                "max_model_calls": 2,
                "max_input_tokens": 60000,
                "max_output_tokens": 4096,
            },
        },
    )


def choose_model(client, model):
    return client.put(
        "/v1/ai/settings", json={"mode": "MANAGED", "provider": "nvidia", "model": model}
    )


@pytest.mark.parametrize(
    "model, thinking",
    [(SUPER, {"enable_thinking": True, "low_effort": True}), (STEP5, None)],
)
def test_a_development_model_proposes_with_its_documented_sampling_and_is_named_on_the_approval(
    api, tmp_path, monkeypatch, model, thinking
):
    env = setup(api, tmp_path, monkeypatch)
    client, sessions, settings, project, version = env[:5]
    configure(settings, standard=model)
    saved = choose_model(client, model)
    assert saved.status_code == 200, saved.text
    row = next(r for r in saved.json()["model_capabilities"] if r["model_identifier"] == model)
    assert row["selectable"] and row["eligibility"] == "DEVELOPMENT"
    assert row["status"] == "CONFIGURED" and row["planning_profiles"] == ["PYSCF_ENERGY_PROPOSAL", "STRUCTURE_EDIT_PROPOSAL", "PERIODIC_ENERGY_PROPOSAL"]

    gateway = Nvidia([proposal_call(arguments(project, version))])
    response = ask(env, monkeypatch, gateway)
    assert response.status_code == 201, response.text
    run = response.json()["latest_run"]
    assert run["status"] == "WAITING_FOR_APPROVAL" and (run["ai_provider"], run["ai_model"]) == (
        "nvidia",
        model,
    )

    (sent,) = gateway.requests
    assert sent.model_identifier == model
    assert (sent.temperature, sent.top_p) == (1.0, 0.95)
    assert (dict(sent.chat_template_kwargs) if sent.chat_template_kwargs else None) == thinking
    assert sent.max_attempts == 1  # no retries, no fallback

    provenance = run["pending_approval"]["proposal_provenance"]
    assert (provenance["provider"], provenance["model"], provenance["eligibility"]) == (
        "nvidia",
        model,
        "DEVELOPMENT",
    )
    assert provenance["repair_attempts"] == 0
    assert provenance["sampling"] == {
        "source": "MODEL_CARD_PROFILE",
        "temperature": 1.0,
        "top_p": 0.95,
        "chat_template_kwargs": thinking,
    }
    outcomes = {i["parameter"]: i["outcome"] for i in run["pending_approval"]["request_match"]}
    assert (
        outcomes["method"] == outcomes["basis"] == "MATCH" and outcomes["engine"] == "NOT_SPECIFIED"
    )

    with sessions() as session:
        receipt = session.scalar(
            select(AIModelInvocationRecord).where(AIModelInvocationRecord.run_id == run["id"])
        )
        assert (receipt.provider, receipt.model) == ("nvidia", model)
        assert receipt.reservation_json["sampling"] == provenance["sampling"]
        assert receipt.usage_status == "REPORTED" and receipt.input_tokens == 1000


def test_a_standard_model_and_every_other_request_keep_the_gateway_default(
    api, tmp_path, monkeypatch
):
    env = setup(api, tmp_path, monkeypatch)
    client, _sessions, settings, project, version = env[:5]
    configure(settings, standard=LIGHTNING, fast=SUPER)
    assert choose_model(client, LIGHTNING).status_code == 200
    gateway = Nvidia([proposal_call(arguments(project, version))])
    run = ask(env, monkeypatch, gateway).json()["latest_run"]
    (sent,) = gateway.requests
    assert (sent.temperature, sent.top_p, sent.chat_template_kwargs) == (0.0, None, None)
    provenance = run["pending_approval"]["proposal_provenance"]
    assert provenance["eligibility"] == "STANDARD"
    assert provenance["sampling"] == {
        "source": "SERVER_DEFAULT",
        "temperature": 0.0,
        "top_p": None,
        "chat_template_kwargs": None,
    }


def test_the_development_model_cannot_serve_a_request_class_without_evidence(
    api, tmp_path, monkeypatch
):
    env = setup(api, tmp_path, monkeypatch)
    client, sessions, settings = env[:3]
    configure(settings, standard=SUPER)
    assert choose_model(client, SUPER).status_code == 200
    gateway = Nvidia([{"content": "never sent"}])
    refused = ask(env, monkeypatch, gateway, profile="GENERAL")
    assert refused.status_code == 422
    assert (
        "MODEL_PROFILE_INELIGIBLE" in refused.text
        and "Development eligibility covers only" in refused.text
    )
    assert "no fallback" in refused.text.lower() and gateway.requests == []
    with sessions() as session:
        assert session.scalars(select(AIModelInvocationRecord)).all() == []


def test_without_the_operator_opt_in_the_model_is_not_selectable_and_nothing_is_sent(
    api, tmp_path, monkeypatch
):
    env = setup(api, tmp_path, monkeypatch)
    client, _sessions, settings = env[:3]
    configure(settings, standard=SUPER, enabled="")
    refused = choose_model(client, SUPER)
    assert refused.status_code == 422 and "MODEL_UNAVAILABLE" in refused.text
    view = client.get("/v1/ai/settings").json()
    row = next(r for r in view["model_capabilities"] if r["model_identifier"] == SUPER)
    assert not row["selectable"] and row["eligibility"] == "NONE"
    assert "Development eligibility is not enabled" in row["unselectable_reason"]


def test_a_reply_from_another_model_is_rejected_and_never_replaces_the_selection(
    api, tmp_path, monkeypatch
):
    env = setup(api, tmp_path, monkeypatch)
    client, _sessions, settings, project, version = env[:5]
    configure(settings, standard=SUPER)
    assert choose_model(client, SUPER).status_code == 200

    class Impostor(Nvidia):
        def generate(self, request):
            response = super().generate(request)
            return ModelResponse(
                content=response.content,
                tool_calls=response.tool_calls,
                usage=response.usage,
                model_identifier=STEP5,
                provider="nvidia",
            )

    run = ask(env, monkeypatch, Impostor([proposal_call(arguments(project, version))])).json()[
        "latest_run"
    ]
    assert run["status"] == "FAILED" and run["error_code"] == "MODEL_IDENTITY_MISMATCH"
    assert run["pending_approval"] is None
    assert client.get("/v1/ai/settings").json()["preferences"]["model"] == SUPER
