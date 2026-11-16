"""AI-2 offline checks: model selection is server-validated, deterministic and provenance-safe.

No provider request is made: the gateway is the local fixture or a monkeypatched stand-in.
"""

import json
from uuid import uuid4

import pytest
from chemdft_api.ai.gateway import (
    FakeModelGateway,
    ModelResponse,
    ModelTimeoutError,
    ModelToolCall,
    ModelUsage,
)
from chemdft_api.ai.http_transport import TransportDiagnostic
from chemdft_api.ai.model_catalog import LIGHTNING, NVIDIA_BASE, PROFILE_REQUIREMENTS, model_catalogue
from chemdft_api.ai.providers import AIFoundationError, AIProviderService
from chemdft_api.ai_models import AIModelInvocationRecord, AIRunRecord
from chemdft_api.context import Identity
from chemdft_api.contracts.ai_foundation import AIPreferencesInput
from sqlalchemy import select
from test_ai_scientist import _create_project

SETTINGS_URL = "/v1/ai/settings"


def new_conversation(client, project_id):
    return client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()[
        "conversation"
    ]["id"]


def select_model(client, model, headers=None):
    return client.put(
        SETTINGS_URL,
        json={"mode": "MANAGED", "provider": "fake", "model": model},
        headers=headers or {},
    )


def ask(client, project_id, conversation, text="Explain a qualitative concept."):
    response = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conversation}/messages",
        json={"content": text, "mode": "STANDARD"},
    )
    assert response.status_code == 201, response.text
    return response.json()["latest_run"]


def nvidia_settings(settings, *, fast=None):
    return settings.model_copy(
        update={
            "ai_provider": "nvidia",
            "ai_api_base_url": NVIDIA_BASE,
            "ai_model_standard": LIGHTNING,
            "ai_model_reasoning": LIGHTNING,
            "ai_model_fast": fast or LIGHTNING,
        }
    )


def test_registry_reports_eligibility_from_evidence_not_from_listing(api):
    _client, _sessions, settings = api
    rows = {
        r.model_identifier: r
        for r in model_catalogue(
            nvidia_settings(settings, fast="nvidia/nemotron-3-super-120b-a12b")
        )
    }
    lightning = rows[LIGHTNING]
    assert lightning.selectable and lightning.unselectable_reason is None
    assert lightning.planning_profiles == tuple(PROFILE_REQUIREMENTS)
    # Configured by this server, still not selectable: tool calling is unverified.
    super_ = rows["nvidia/nemotron-3-super-120b-a12b"]
    assert super_.configured and not super_.selectable and super_.planning_profiles == ()
    assert "not verified" in super_.unselectable_reason
    assert "deprecated" in rows["moonshotai/kimi-k3"].unselectable_reason
    direct = next(r for r in model_catalogue(settings) if r.provider == "moonshot")
    assert "not configured for the Moonshot endpoint" in direct.unselectable_reason
    assert not direct.selectable and direct.eligibility == "NONE"
    assert not any(r.proposal_workflow_verified for r in rows.values())


def test_server_validates_every_save_and_never_substitutes(api):
    client, _sessions, _settings = api
    view = client.get(SETTINGS_URL).json()
    fixture = view["providers"][0]
    assert fixture["provider"] == "fake" and fixture["local_test_only"]
    assert fixture["models"] == ["fake-standard", "fake-alternate"]
    assert select_model(client, "fake-alternate").json()["preferences"]["model"] == "fake-alternate"
    assert client.get(SETTINGS_URL).json()["preferences"]["model"] == "fake-alternate"
    for payload, code in (
        ({"mode": "MANAGED", "provider": "fake", "model": "invented-model"}, "MODEL_UNAVAILABLE"),
        ({"mode": "MANAGED", "provider": "nvidia", "model": LIGHTNING}, "PROVIDER_UNAVAILABLE"),
        ({"mode": "BYOK", "provider": "fake", "model": "fake-standard"}, "PROVIDER_UNAVAILABLE"),
    ):
        response = client.put(SETTINGS_URL, json=payload)
        assert response.status_code == 422, response.text
        assert code in response.text
        # A refused request never changes, resets or "falls back" the saved preference.
        assert client.get(SETTINGS_URL).json()["preferences"]["model"] == "fake-alternate"


def test_new_requests_use_the_selection_and_earlier_runs_keep_theirs(api):
    client, sessions, _settings = api
    project = _create_project(client)
    conversation = new_conversation(client, project["id"])
    first = ask(client, project["id"], conversation)
    assert first["status"] == "SUCCEEDED" and first["ai_model"] == "fake-standard"
    assert select_model(client, "fake-alternate").status_code == 200
    second = ask(client, project["id"], conversation)
    assert second["status"] == "SUCCEEDED" and second["ai_model"] == "fake-alternate"
    reread = client.get(f"/v1/projects/{project['id']}/ai/runs/{first['id']}").json()
    assert (reread["ai_provider"], reread["ai_model"]) == ("fake", "fake-standard")
    with sessions() as session:
        used = {
            run_id: set(models)
            for run_id, models in (
                (
                    r,
                    session.scalars(
                        select(AIModelInvocationRecord.model).where(
                            AIModelInvocationRecord.run_id == r
                        )
                    ).all(),
                )
                for r in (first["id"], second["id"])
            )
        }
    assert used == {first["id"]: {"fake-standard"}, second["id"]: {"fake-alternate"}}


def test_switching_during_a_run_never_changes_the_model_that_run_uses(api, monkeypatch):
    client, sessions, settings = api
    project = _create_project(client)
    conversation = new_conversation(client, project["id"])
    seen = []

    def switching(_gateway, request):
        seen.append(request.model_identifier)
        if len(seen) == 1:
            with sessions() as other:  # a concurrent settings save by the same researcher
                AIProviderService(
                    other, Identity(settings.dev_user_id, settings.dev_organization_id), settings
                ).save_preferences(
                    AIPreferencesInput(mode="MANAGED", provider="fake", model="fake-alternate")
                )
            return ModelResponse(
                content=None,
                tool_calls=(ModelToolCall("read", "structure.list", "{}"),),
                usage=ModelUsage(10, 2, 1),
                model_identifier=request.model_identifier,
                provider="fake",
            )
        return ModelResponse(
            content="Done.",
            usage=ModelUsage(10, 2, 1),
            model_identifier=request.model_identifier,
            provider="fake",
        )

    monkeypatch.setattr(FakeModelGateway, "generate", switching)
    run = ask(client, project["id"], conversation)
    assert run["status"] == "SUCCEEDED"
    # Two model calls in the one run, one bound model, even though the preference changed between.
    assert seen == ["fake-standard", "fake-standard"]
    assert client.get(SETTINGS_URL).json()["preferences"]["model"] == "fake-alternate"
    with sessions() as session:
        models = session.scalars(
            select(AIModelInvocationRecord.model).where(AIModelInvocationRecord.run_id == run["id"])
        ).all()
    assert models == ["fake-standard", "fake-standard"]
    # The next request, and only the next request, uses the new selection.
    seen.clear()
    monkeypatch.setattr(FakeModelGateway, "generate", lambda g, r: switching(g, r))
    assert ask(client, project["id"], conversation)["ai_model"] == "fake-alternate"


def test_provider_failure_never_activates_a_fallback_model(api, monkeypatch):
    client, sessions, _settings = api
    project = _create_project(client)
    conversation = new_conversation(client, project["id"])
    assert select_model(client, "fake-alternate").status_code == 200
    attempts = []

    def times_out(_gateway, request):
        attempts.append(request.model_identifier)
        raise ModelTimeoutError(
            "timeout",
            transport=TransportDiagnostic(
                phase="RESPONSE_BODY", kind="READ_TIMEOUT", elapsed_ms=60_000, timeout_seconds=60
            ),
        )

    monkeypatch.setattr(FakeModelGateway, "generate", times_out)
    response = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conversation}/messages",
        json={"content": "Explain a qualitative concept.", "mode": "STANDARD"},
    )
    assert attempts == ["fake-alternate"]  # one request, one model, no retry on another model
    with sessions() as session:
        run = session.scalars(select(AIRunRecord)).one()
        invocations = session.scalars(select(AIModelInvocationRecord)).all()
    assert run.status == "FAILED" and run.error_code == "PROVIDER_READ_TIMEOUT", response.text
    assert [(i.model, i.status) for i in invocations] == [("fake-alternate", "FAILED_UNCERTAIN")]
    assert client.get(SETTINGS_URL).json()["preferences"]["model"] == "fake-alternate"


def test_a_bound_model_that_becomes_ineligible_fails_closed(api):
    _client, sessions, settings = api
    config = nvidia_settings(settings)
    identity = Identity(settings.dev_user_id, settings.dev_organization_id)
    with sessions() as session:
        service = AIProviderService(session, identity, config)
        service.pin("MANAGED", "nvidia", "nvidia/nemotron-3-super-120b-a12b")
        assert service.availability().error_code == "MODEL_UNAVAILABLE"
        with pytest.raises(AIFoundationError) as refused:
            service.gateway()
        assert refused.value.code == "MODEL_UNAVAILABLE"
        # The binding is not replaced by the server's own default or any other model.
        assert service.preferences().model == "nvidia/nemotron-3-super-120b-a12b"


def test_profile_gate_checks_capabilities_the_request_needs(api, monkeypatch):
    _client, sessions, settings = api
    config = nvidia_settings(settings)
    identity = Identity(settings.dev_user_id, settings.dev_organization_id)
    with sessions() as session:
        service = AIProviderService(session, identity, config)
        for profile in PROFILE_REQUIREMENTS:
            service.profile_gate(profile)

        def text_only(settings_):
            return tuple(
                row.model_copy(
                    update={
                        "documented_capabilities": ("Text",),
                        "tool_compatibility_verified": False,
                    }
                )
                for row in model_catalogue(settings_)
            )

        monkeypatch.setattr("chemdft_api.ai.providers.model_catalogue", text_only)
        service.profile_gate("EVIDENCE")
        for profile in ("GENERAL", "PYSCF_ENERGY_PROPOSAL"):
            with pytest.raises(AIFoundationError) as refused:
                service.profile_gate(profile)
            assert refused.value.code == "MODEL_PROFILE_INELIGIBLE"
            assert "no fallback" in refused.value.detail


def test_preferences_are_per_user(api):
    client, sessions, settings = api
    from chemdft_api.models import Membership, User

    other = str(uuid4())
    with sessions() as session:
        session.add(User(id=other, email="ai2-other@example.test", display_name="Other"))
        session.flush()
        session.add(
            Membership(user_id=other, organization_id=settings.dev_organization_id, role="member")
        )
        session.commit()
    headers = {"X-ChemDFT-User-ID": other}
    assert select_model(client, "fake-alternate", headers).status_code == 200
    assert client.get(SETTINGS_URL).json()["preferences"]["model"] == "fake-standard"
    assert (
        client.get(SETTINGS_URL, headers=headers).json()["preferences"]["model"] == "fake-alternate"
    )
    assert json.dumps(client.get(SETTINGS_URL).json()).count(other) == 0
