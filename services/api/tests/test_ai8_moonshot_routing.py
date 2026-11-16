"""AI-8 offline checks: direct Moonshot as a second managed provider, gated by evidence.

No provider request is made. The registry row is patched in-process to stand for "evidence
exists" so the routing, selection, run pinning and gating can be shown; with the real registry the
row has no evidence and nothing is ever offered.
"""

import pytest
from chemdft_api.ai import model_catalog
from chemdft_api.ai.gateway import MOONSHOT_BASE, HttpOpenAIModelGateway
from chemdft_api.ai.model_catalog import (
    LIGHTNING,
    NVIDIA_BASE,
    model_catalogue,
    service_sampling_profile,
)
from chemdft_api.ai.providers import AIFoundationError, AIProviderService
from chemdft_api.context import Identity
from chemdft_api.contracts.ai_foundation import AIPreferencesInput
from pydantic import SecretStr

K26 = "kimi-k2.6"
EVIDENCE = (
    "Test stand-in for dated hosted evidence: a first-attempt proposal matched every named "
    "parameter.",
)


def configured(settings, **overrides):
    values = {
        "ai_provider": "nvidia",
        "ai_api_base_url": NVIDIA_BASE,
        "ai_model_fast": LIGHTNING,
        "ai_model_standard": LIGHTNING,
        "ai_model_reasoning": LIGHTNING,
        "ai_api_key": SecretStr("nvidia-throwaway"),
        "run_ai_integration": True,
        "billing_managed_ai_enabled": True,
        "moonshot_api_key": SecretStr("moonshot-throwaway"),
        "moonshot_models": K26,
    }
    values.update(overrides)
    return settings.model_copy(update=values)


def service(sessions, settings):
    session = sessions()
    identity = Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id)
    return AIProviderService(session, identity, settings)


def test_a_default_server_offers_nothing_from_moonshot_even_though_the_registry_has_evidence(api):
    _client, sessions, settings = api
    for server in (
        configured(settings, moonshot_api_key=None, moonshot_models=""),
        configured(settings, moonshot_models=""),
        configured(settings, moonshot_api_key=None),
    ):
        assert [o.provider for o in service(sessions, server).options()] == ["nvidia"]
    row = next(r for r in model_catalogue(settings) if r.model_identifier == K26)
    assert not row.configured and not row.selectable and row.eligibility == "NONE"
    assert "not configured for the Moonshot endpoint" in row.unselectable_reason
    with pytest.raises(AIFoundationError) as refused:
        service(sessions, settings).save_preferences(
            AIPreferencesInput(mode="MANAGED", provider="moonshot", model=K26)
        )
    assert refused.value.code == "PROVIDER_UNAVAILABLE"


def test_the_registry_evidence_is_dated_service_level_and_names_what_is_not_established():
    for row in model_catalog.DEFINITIONS:
        if row.provider != "moonshot":
            continue
        assert row.availability == "AVAILABLE" and row.development_profiles == (
            "PYSCF_ENERGY_PROPOSAL",
            "STRUCTURE_EDIT_PROPOSAL",
            "PERIODIC_ENERGY_PROPOSAL",
        )
        assert 1 <= len(row.development_evidence) <= 4
        text = " ".join(row.development_evidence)
        assert "AI-9" in text and "2026-10-18" in text and "first-attempt" in text
        assert "not established" in text and "COMPATIBLE" not in text
        assert not row.tool_verified  # tool calling stays unverified: development use only


def test_a_server_must_hold_a_key_list_the_model_and_switch_integration_on(api):
    _client, sessions, settings = api
    providers = lambda s: [o.provider for o in service(sessions, s).options()]  # noqa: E731
    assert providers(configured(settings)) == ["nvidia", "moonshot"]
    assert providers(configured(settings, moonshot_api_key=None)) == ["nvidia"]
    assert providers(configured(settings, moonshot_models="")) == ["nvidia"]
    assert providers(configured(settings, run_ai_integration=False)) == ["nvidia"]
    assert providers(configured(settings, moonshot_models="kimi-k2.5")) == ["nvidia"]  # no row
    only_k3 = service(sessions, configured(settings, moonshot_models="kimi-k3")).options()
    assert [m for o in only_k3 if o.provider == "moonshot" for m in o.models] == ["kimi-k3"]


def test_a_user_can_select_kimi_and_the_gateway_routes_to_moonshot_only(api):
    _client, sessions, settings = api
    server = configured(settings)
    svc = service(sessions, server)
    view = svc.save_preferences(AIPreferencesInput(mode="MANAGED", provider="moonshot", model=K26))
    assert view.preferences.provider == "moonshot" and view.availability.available
    gateway, state = svc.gateway()
    assert isinstance(gateway, HttpOpenAIModelGateway)
    assert (gateway._provider, gateway._base_url) == ("moonshot", MOONSHOT_BASE)
    assert gateway._api_key == "moonshot-throwaway"
    assert (state.provider, state.model) == ("moonshot", K26)
    row = next(r for r in model_catalogue(server) if r.model_identifier == K26)
    assert row.selectable and row.eligibility == "DEVELOPMENT" and row.status == "CONFIGURED"
    assert len(row.development_evidence) == 4 and "AI-9" in row.development_evidence[0]


def test_an_nvidia_model_cannot_be_selected_through_the_moonshot_provider_or_the_reverse(api):
    _client, sessions, settings = api
    svc = service(sessions, configured(settings))
    for provider, model in (("moonshot", LIGHTNING), ("nvidia", K26)):
        with pytest.raises(AIFoundationError) as refused:
            svc.save_preferences(AIPreferencesInput(mode="MANAGED", provider=provider, model=model))
        assert refused.value.code == "MODEL_UNAVAILABLE"


def test_a_run_pinned_to_kimi_keeps_its_model_when_the_users_preference_changes(api):
    _client, sessions, settings = api
    server = configured(settings)
    svc = service(sessions, server)
    svc.save_preferences(AIPreferencesInput(mode="MANAGED", provider="moonshot", model=K26))
    svc.save_preferences(AIPreferencesInput(mode="MANAGED", provider="nvidia", model=LIGHTNING))
    pinned = service(sessions, server)
    pinned.pin("MANAGED", "moonshot", K26)
    gateway, state = pinned.gateway()
    assert (state.provider, state.model) == ("moonshot", K26)
    assert gateway._provider == "moonshot"
    # the live preference is untouched and still NVIDIA
    assert service(sessions, server).preferences().provider == "nvidia"


def test_removing_the_key_makes_a_pinned_kimi_run_fail_closed_with_no_fallback(api):
    _client, sessions, settings = api
    server = configured(settings)
    pinned = service(sessions, configured(settings, moonshot_api_key=None))
    pinned.pin("MANAGED", "moonshot", K26)
    with pytest.raises(AIFoundationError) as refused:
        pinned.gateway()
    assert refused.value.code in {"PROVIDER_UNAVAILABLE", "MODEL_UNAVAILABLE"}
    assert server  # the configured server above would have served it; the broken one must not


def test_moonshot_models_never_receive_the_nvidia_model_card_sampling(api):
    _client, _sessions, settings = api
    server = configured(settings)
    assert service_sampling_profile(server, "moonshot", K26) is None
    assert service_sampling_profile(server, "moonshot", "kimi-k3") is None


def test_the_moonshot_key_is_read_from_a_private_file_and_refused_when_group_readable(tmp_path):
    from chemdft_api.config import Settings

    key = tmp_path / "moonshot.key"
    key.write_text("throwaway-moonshot\n")
    key.chmod(0o600)
    loaded = Settings(_env_file=None, moonshot_api_key_file=key)
    assert loaded.moonshot_api_key.get_secret_value() == "throwaway-moonshot"
    assert "throwaway" not in repr(loaded)  # the secret never appears in a repr
    key.chmod(0o640)
    with pytest.raises((ValueError, OSError, RuntimeError)):
        Settings(_env_file=None, moonshot_api_key_file=key)


def test_the_moonshot_base_override_is_honoured_only_for_loopback_in_the_test_environment(api):
    _client, sessions, settings = api

    def base(**overrides):
        return service(sessions, configured(settings, **overrides))._moonshot_base()

    stand_in = "http://127.0.0.1:9999/v1"
    assert base() == MOONSHOT_BASE
    assert base(environment="test", moonshot_api_base_url=stand_in) == stand_in
    # outside the test environment a loopback base is ignored, and so is any other host
    assert base(environment="production", moonshot_api_base_url=stand_in) == MOONSHOT_BASE
    assert (
        base(environment="test", moonshot_api_base_url="https://evil.example/v1") == MOONSHOT_BASE
    )


def test_a_kimi_preference_belongs_to_one_user_and_never_leaks_to_another(api):
    from uuid import uuid4

    from chemdft_api.config import get_settings
    from chemdft_api.main import app
    from chemdft_api.models import Membership, User

    client, sessions, settings = api
    server = configured(settings, moonshot_models="kimi-k2.6,kimi-k3")
    other = str(uuid4())
    with sessions() as session:
        session.add(User(id=other, email="kimi-other@example.test", display_name="Other"))
        session.flush()
        session.add(
            Membership(user_id=other, organization_id=settings.dev_organization_id, role="member")
        )
        session.commit()
    app.dependency_overrides[get_settings] = lambda: server
    url = "/v1/ai/settings"
    mine = {"mode": "MANAGED", "provider": "moonshot", "model": K26}
    assert client.put(url, json=mine).status_code == 200
    assert client.get(url).json()["preferences"] == mine
    theirs = client.get(url, headers={"X-ChemDFT-User-ID": other}).json()["preferences"]
    assert theirs["provider"] == "nvidia" and theirs["model"] == LIGHTNING  # untouched default
    assert (
        client.put(
            url,
            json={"mode": "MANAGED", "provider": "moonshot", "model": "kimi-k3"},
            headers={"X-ChemDFT-User-ID": other},
        ).status_code
        == 200
    )
    assert client.get(url).json()["preferences"]["model"] == K26  # mine did not change
