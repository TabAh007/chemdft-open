"""Offline catalogue and selection gates: documentation cannot activate inference."""

import pytest
from chemdft_api.ai.model_catalog import LIGHTNING, NVIDIA_BASE, model_catalogue
from chemdft_api.ai.providers import AIFoundationError, AIProviderService
from chemdft_api.context import Identity
from chemdft_api.contracts.ai_foundation import AIPreferencesInput


def configured(settings, *models):
    return settings.model_copy(
        update={
            "ai_provider": "nvidia",
            "ai_api_base_url": NVIDIA_BASE,
            "ai_model_standard": models[0],
            "ai_model_fast": models[-1],
            "ai_model_reasoning": models[-1],
        }
    )


def rows(settings):
    return {(r.provider, r.model_identifier): r for r in model_catalogue(settings)}


def test_historical_tool_verification_never_claims_proposal_acceptance(api):
    _client, _sessions, settings = api
    catalogue = rows(configured(settings, LIGHTNING))
    lightning = catalogue["nvidia", LIGHTNING]
    assert lightning.status == "LIVE-VERIFIED" and lightning.selectable
    assert lightning.tool_compatibility_verified
    assert not lightning.proposal_workflow_verified
    assert "historical" in lightning.verification_scope
    assert all(not r.selectable for key, r in catalogue.items() if key != ("nvidia", LIGHTNING))


@pytest.mark.parametrize(
    "model",
    [
        "nvidia/nemotron-3-super-120b-a12b",
        "deepseek-ai/deepseek-v4.1-flash",
        "deepseek-ai/deepseek-v4-flash",
        "moonshotai/kimi-k3",
        "moonshotai/kimi-k2.6",
        "unknown/model",
    ],
)
def test_even_server_config_cannot_make_untested_or_deprecated_model_selectable(api, model):
    _client, sessions, settings = api
    config = configured(settings, LIGHTNING, model)
    with sessions() as db:
        service = AIProviderService(
            db, Identity(settings.dev_user_id, settings.dev_organization_id), config
        )
        assert service.options()[0].models == (LIGHTNING,)
        with pytest.raises(AIFoundationError) as exc:
            service.save_preferences(
                AIPreferencesInput(mode="MANAGED", provider="nvidia", model=model)
            )
        assert exc.value.code == "MODEL_UNAVAILABLE"
        assert service.preferences().model == LIGHTNING


def test_bad_endpoint_does_not_inherit_nvidia_live_verification(api):
    _client, sessions, settings = api
    config = configured(settings, LIGHTNING).model_copy(
        update={"ai_api_base_url": "https://another.invalid/v1"}
    )
    lightning = rows(config)["nvidia", LIGHTNING]
    assert lightning.status == "DOCUMENTED" and not lightning.selectable
    assert not lightning.tool_compatibility_verified
    with sessions() as db:
        service = AIProviderService(
            db, Identity(settings.dev_user_id, settings.dev_organization_id), config
        )
        assert service.options()[0].models == ()
        assert service.availability().error_code == "MODEL_UNAVAILABLE"
        assert service.preferences().model == LIGHTNING  # no replacement/fallback


def test_registry_distinguishes_documented_configured_unavailable_unsupported(api):
    client, _sessions, settings = api
    config = configured(settings, "nvidia/nemotron-3-super-120b-a12b")
    catalogue = rows(config)
    assert catalogue["nvidia", "nvidia/nemotron-3-super-120b-a12b"].status == "CONFIGURED"
    assert catalogue["nvidia", LIGHTNING].status == "DOCUMENTED"
    assert catalogue["nvidia", "deepseek-ai/deepseek-v4-flash"].status == "UNAVAILABLE"
    # AI-8: the direct Moonshot route exists but no server lists it and no evidence exists.
    assert catalogue["moonshot", "kimi-k3"].status == "DOCUMENTED"
    assert not catalogue["moonshot", "kimi-k3"].selectable
    response = client.get("/v1/ai/settings")
    assert response.status_code == 200
    entries = response.json()["model_capabilities"]
    assert len(entries) == len(catalogue)
    assert all(not r["selectable"] for r in entries)  # fixture is fake, not NVIDIA
    assert all("source_urls" in r and "configuration_requirements" in r for r in entries)
    assert "api_key" not in response.text and "secret_reference" not in response.text
