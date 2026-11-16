"""0.0.60 live-fix regressions: the new planning profiles must pass the REAL registry gate.

No fake gateway and no provider call: registry rows, settings and the model-list API view only.
Before the fix, STRUCTURE_EDIT_PROPOSAL and PERIODIC_ENERGY_PROPOSAL were missing from
PROFILE_REQUIREMENTS, so profile_ineligibility() answered "Unknown planning profile." for them.
"""

import typing

import pytest
from chemdft_api.ai.model_catalog import (
    DEFINITIONS,
    PROFILE_REQUIREMENTS,
    model_catalogue,
    profile_ineligibility,
)
from chemdft_api.contracts.ai import PostMessageInput
from chemdft_api.ai.chat_facts import rewrite_retired_chat_wording
from test_ai6_model_sampling import configure

NEW_PROFILES = ("STRUCTURE_EDIT_PROPOSAL", "PERIODIC_ENERGY_PROPOSAL")
DEV_ROWS = [d for d in DEFINITIONS if d.development_profiles]


def test_every_planning_profile_value_has_a_requirement():
    values = set(typing.get_args(PostMessageInput.model_fields["planning_profile"].annotation))
    assert values - set(PROFILE_REQUIREMENTS) == set(), "profile without a registry requirement"
    for profile in NEW_PROFILES:
        assert profile in values and profile in PROFILE_REQUIREMENTS


@pytest.mark.parametrize("definition", DEV_ROWS, ids=lambda d: d.model)
@pytest.mark.parametrize("profile", NEW_PROFILES)
def test_real_gate_accepts_new_profiles_for_every_development_row(api, definition, profile):
    _client, _sessions, settings = api
    configure(settings, standard=definition.model, enabled=",".join(d.model for d in DEV_ROWS))
    row = next(r for r in model_catalogue(settings) if r.model_identifier == definition.model)
    if definition.provider != "nvidia":
        # Moonshot rows need their own endpoint/credential settings; evaluate the row the
        # catalogue would build when enabled, through the same real gate.
        row = row.model_copy(
            update={
                "selectable": True,
                "eligibility": "DEVELOPMENT",
                "unselectable_reason": None,
                "planning_profiles": definition.development_profiles,
            }
        )
    assert row.eligibility == "DEVELOPMENT", row.unselectable_reason
    assert profile_ineligibility(row, profile) is None
    assert set(NEW_PROFILES) <= set(row.planning_profiles)


def test_model_list_api_reports_both_profiles_for_the_nemotron_row(api):
    client, _sessions, settings = api
    nemotron = "nvidia/nemotron-3-super-120b-a12b"
    configure(settings, standard=nemotron, enabled=nemotron)
    rows = client.get("/v1/ai/settings").json()["model_capabilities"]
    row = next(r for r in rows if r["model_identifier"] == nemotron)
    assert set(NEW_PROFILES) <= set(row["planning_profiles"])
    assert row["tool_compatibility_verified"] is False  # development eligibility, not hosted-verified


@pytest.mark.parametrize(
    "bad, expected_part",
    [
        (
            'Use "Prepare periodic calculation for approval" in the Calculation panel.',
            "in the AI panel composer, next to Ask",
        ),
        (
            "The Prepare calculation for approval button is in the Calculation panel.",
            "in the AI panel composer, next to Ask",
        ),
    ],
)
def test_filter_moves_the_proposal_button_out_of_the_calculation_panel(bad, expected_part):
    assert expected_part in rewrite_retired_chat_wording(bad)


def test_filter_leaves_the_separate_calculation_panel_route_alone():
    ok = 'Use "Set up in Calculation panel" to configure it manually in the Calculation panel.'
    assert rewrite_retired_chat_wording(ok) == ok
