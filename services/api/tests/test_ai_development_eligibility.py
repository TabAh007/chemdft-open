"""AI-6 offline checks: the controlled development eligibility path for Nemotron 3 Super and Step 5.

No provider request is made: registry rows, settings and request building only. The path is opt-in
(an operator setting AND registry evidence), limited to the profiles with hosted evidence, never a
default or fallback, and never a COMPATIBLE label.
"""

import pytest
from chemdft_api.ai.gateway import ModelRequest
from chemdft_api.ai.model_catalog import (
    LIGHTNING,
    NVIDIA_BASE,
    SAMPLING_PROFILES,
    development_models,
    model_catalogue,
    PROFILE_REQUIREMENTS,
    nvidia_route_configured,
    profile_ineligibility,
    selectable_nvidia_models,
    service_sampling_profile,
)
from chemdft_api.ai.providers import AIProviderService
from chemdft_api.context import Identity
from test_ai_model_switching import nvidia_settings

SUPER = "nvidia/nemotron-3-super-120b-a12b"
STEP5 = "stepfun-ai/step-5-preview"
DEV = f"{SUPER},{STEP5}"
DEV_PROFILES = ("PYSCF_ENERGY_PROPOSAL", "STRUCTURE_EDIT_PROPOSAL", "PERIODIC_ENERGY_PROPOSAL")


def development_settings(settings, *, enabled=DEV, fast=STEP5, standard=SUPER):
    return nvidia_settings(settings, fast=fast).model_copy(
        update={
            "ai_model_standard": standard,
            "ai_model_reasoning": standard,
            "ai_development_models": enabled,
        }
    )


def rows_of(config):
    return {row.model_identifier: row for row in model_catalogue(config)}


def test_nothing_changes_until_the_operator_enables_development_models(api):
    _client, _sessions, settings = api
    config = development_settings(settings, enabled="")
    rows = rows_of(config)
    for model in (SUPER, STEP5):
        row = rows[model]
        assert row.configured and not row.selectable and row.eligibility == "NONE"
        assert row.planning_profiles == () and row.development_evidence == ()
        assert "Development eligibility is not enabled" in row.unselectable_reason
    assert selectable_nvidia_models(config) == frozenset()
    assert development_models(config) == frozenset()


def test_an_enabled_model_is_selectable_for_the_profile_its_evidence_covers_only(api):
    _client, _sessions, settings = api
    rows = rows_of(development_settings(settings))
    for model in (SUPER, STEP5):
        row = rows[model]
        assert row.selectable and row.configured and row.eligibility == "DEVELOPMENT"
        assert row.status == "CONFIGURED"  # never LIVE-VERIFIED
        assert not row.tool_compatibility_verified and not row.proposal_workflow_verified
        assert row.planning_profiles == DEV_PROFILES
        assert row.unselectable_reason is None
        assert "AI-5 run 5" in row.development_evidence[0]
        assert "AI-6 run 6" in row.development_evidence[1]
        assert "AI-6 run 7" in row.development_evidence[2]
        assert "water" in row.development_evidence[2] and "ethanol" in row.development_evidence[2]
        assert "AI-8 live browser run" in row.development_evidence[3]
        assert "first-attempt" in row.development_evidence[3]
        assert "rejected" in row.development_evidence[3]
        assert len(row.development_evidence) == 4
        limitations = " ".join(row.limitations)
        assert "Single samples" in limitations and "not established" in limitations
        assert "one molecule" not in " ".join(row.development_evidence + row.limitations)
        assert any("Development eligibility" in line for line in row.limitations)
        assert "not a COMPATIBLE label" in row.verification_scope
        assert profile_ineligibility(row, "PYSCF_ENERGY_PROPOSAL") is None
        for other in ("GENERAL", "EVIDENCE"):
            assert "Development eligibility covers only" in profile_ineligibility(row, other)
    assert selectable_nvidia_models(development_settings(settings)) == frozenset({SUPER, STEP5})


def test_both_conditions_are_required_the_operator_list_and_a_configured_slot(api):
    _client, _sessions, settings = api
    only_super = rows_of(development_settings(settings, enabled=SUPER))
    assert only_super[SUPER].selectable and not only_super[STEP5].selectable
    # Listed by the operator but not configured as the fast, standard or reasoning model.
    unconfigured = rows_of(development_settings(settings, fast=LIGHTNING, standard=LIGHTNING))
    for model in (SUPER, STEP5):
        assert not unconfigured[model].configured and not unconfigured[model].selectable
        assert unconfigured[model].eligibility == "NONE"


def test_registry_evidence_is_required_the_operator_cannot_invent_eligibility(api):
    _client, _sessions, settings = api
    gemma = "google/gemma-4-31b-it"
    config = development_settings(settings, enabled=f"{DEV},{gemma}", fast=gemma)
    row = rows_of(config)[gemma]
    assert row.configured and not row.selectable and row.eligibility == "NONE"
    assert "Tool calling is not verified" in row.unselectable_reason
    assert service_sampling_profile(config, "nvidia", gemma) is None


def test_the_standard_tier_is_unchanged_and_never_becomes_development(api):
    _client, _sessions, settings = api
    config = development_settings(settings, enabled=f"{DEV},{LIGHTNING}", fast=LIGHTNING)
    lightning = rows_of(config)[LIGHTNING]
    assert lightning.selectable and lightning.eligibility == "STANDARD"
    assert lightning.planning_profiles == tuple(PROFILE_REQUIREMENTS)
    assert lightning.development_evidence == ()
    assert service_sampling_profile(config, "nvidia", LIGHTNING) is None


def test_other_providers_and_endpoints_get_no_development_eligibility(api):
    _client, _sessions, settings = api
    other_provider = development_settings(settings).model_copy(update={"ai_provider": "openai"})
    assert not any(row.selectable for row in model_catalogue(other_provider))
    other_endpoint = development_settings(settings).model_copy(
        update={"ai_api_base_url": "https://example.invalid/v1"}
    )
    assert not nvidia_route_configured(other_endpoint)
    assert not any(row.selectable for row in model_catalogue(other_endpoint))


@pytest.mark.parametrize(
    "environment, base, expected",
    [
        ("development", "http://127.0.0.1:9999/v1", False),
        ("production", "http://localhost:9999/v1", False),
        ("test", "http://127.0.0.1:9999/v1", True),
        ("test", "http://localhost:9999/v1", True),
        ("test", "https://example.invalid/v1", False),
        ("test", "http://127.0.0.1.example.invalid/v1", False),
        ("test", NVIDIA_BASE, True),
        ("production", NVIDIA_BASE, True),
    ],
)
def test_loopback_stands_in_for_the_endpoint_only_in_the_isolated_test_environment(
    api, environment, base, expected
):
    _client, _sessions, settings = api
    config = development_settings(settings).model_copy(
        update={"environment": environment, "ai_api_base_url": base}
    )
    assert nvidia_route_configured(config) is expected


def test_the_documented_profile_is_applied_to_service_requests_only_for_development_models(api):
    _client, _sessions, settings = api
    config = development_settings(settings)
    super_profile = service_sampling_profile(config, "nvidia", SUPER)
    step_profile = service_sampling_profile(config, "nvidia", STEP5)
    assert super_profile is SAMPLING_PROFILES[SUPER] and step_profile is SAMPLING_PROFILES[STEP5]
    assert (super_profile.temperature, super_profile.top_p) == (1.0, 0.95)
    assert dict(super_profile.chat_template_kwargs) == {"enable_thinking": True, "low_effort": True}
    assert step_profile.chat_template_kwargs is None
    # Not enabled, wrong provider, and unknown models keep the gateway default.
    assert (
        service_sampling_profile(development_settings(settings, enabled=""), "nvidia", SUPER)
        is None
    )
    assert service_sampling_profile(config, "fake", SUPER) is None
    assert service_sampling_profile(config, "nvidia", "private/other") is None
    # The default request really is temperature 0 with nothing else set.
    default = ModelRequest(system_prompt="s", messages=())
    assert (default.temperature, default.top_p, default.chat_template_kwargs) == (0.0, None, None)


def test_the_provider_service_offers_only_what_the_registry_allows(api):
    _client, sessions, settings = api
    identity = Identity(settings.dev_user_id, settings.dev_organization_id)
    with sessions() as session:
        on = AIProviderService(session, identity, development_settings(settings)).options()
        off = AIProviderService(
            session, identity, development_settings(settings, enabled="")
        ).options()
    assert [option.provider for option in on] == ["nvidia"]
    assert set(on[0].models) == {SUPER, STEP5} and len(on[0].models) <= 3
    assert off[0].models == ()
