"""Tests for Chat Guidance (Release 0.0.60, Part 0A).

Validates calculation_guidance for molecular, periodic, unsaved, and read-only records,
rule text updates, and deterministic filter coverage for new submission promise phrases.
"""

from __future__ import annotations

from chemdft_api.ai.chat_facts import (
    CHAT_POLICY,
    CHAT_REPLY_RULES,
    CHAT_SUBMISSION_NOTICE,
    RETIRED_CHAT_HISTORY_PLACEHOLDER,
    calculation_guidance,
    filter_chat_submission_promises,
    rewrite_retired_chat_wording,
    sanitize_chat_history_message,
)
from chemdft_api.scientific_models import StructureVersionRecord


def test_calculation_guidance_molecular_saved_editable() -> None:
    version = StructureVersionRecord(id="v1", periodic_cell_json=None)
    guidance = calculation_guidance(version, is_periodic=False, is_editable=True, is_saved=True)

    assert "Prepare calculation for approval" in guidance
    assert "Prepare periodic calculation for approval" in guidance  # as NOT available note
    assert "NOT available for molecular structures" in guidance
    assert "the AI cannot run, submit or start anything; the user approves, engines compute" in guidance


def test_calculation_guidance_periodic_saved_editable() -> None:
    version = StructureVersionRecord(id="v2", periodic_cell_json={"a": 5.0, "b": 5.0, "c": 13.0})
    guidance = calculation_guidance(version, is_periodic=True, is_editable=True, is_saved=True)

    assert "Prepare periodic calculation for approval" in guidance
    assert "Set up in Calculation panel" in guidance
    assert "NOT available for periodic structures" in guidance
    assert "the AI cannot run, submit or start anything; the user approves, engines compute" in guidance


def test_calculation_guidance_unsaved() -> None:
    guidance = calculation_guidance(None, is_saved=False)

    assert "No saved structure version selected" in guidance
    assert "Neither action is available" in guidance
    assert "the AI cannot run, submit or start anything; the user approves, engines compute" in guidance


def test_calculation_guidance_read_only() -> None:
    version = StructureVersionRecord(id="v1", periodic_cell_json=None)
    guidance = calculation_guidance(version, is_editable=False, is_saved=True)

    assert "Project is read-only" in guidance
    assert "Neither action is available" in guidance
    assert "the AI cannot run, submit or start anything; the user approves, engines compute" in guidance


def test_filter_chat_submission_promises_new_phrases() -> None:
    # "I'll run it"
    p1 = "I will configure the parameters. I'll run it now."
    c1 = filter_chat_submission_promises(p1)
    assert "I'll run it" not in c1
    assert c1.endswith(CHAT_SUBMISSION_NOTICE)

    # "I have started"
    p2 = "I have started the calculation for you."
    c2 = filter_chat_submission_promises(p2)
    assert "I have started" not in c2
    assert c2.endswith(CHAT_SUBMISSION_NOTICE)

    # "running now"
    p3 = "The job is running now on the cluster."
    c3 = filter_chat_submission_promises(p3)
    assert "running now" not in c3
    assert c3.endswith(CHAT_SUBMISSION_NOTICE)

    # "I will submit a proposal"
    p4 = "I will submit a proposal for your review."
    c4 = filter_chat_submission_promises(p4)
    assert "submit a proposal" not in c4
    assert c4.endswith(CHAT_SUBMISSION_NOTICE)


def test_rewrite_retired_chat_wording_submit_proposal() -> None:
    raw = "To run this calculation, submit a proposal."
    rewritten = rewrite_retired_chat_wording(raw)
    assert "submit a proposal" not in rewritten
    assert "prepare a proposal for approval" in rewritten


def test_sanitize_chat_history_message_submit_proposal() -> None:
    raw = "Please submit a proposal using the button."
    sanitized = sanitize_chat_history_message("assistant", raw)
    assert sanitized == RETIRED_CHAT_HISTORY_PLACEHOLDER


def test_chat_policy_and_rules_contain_guidance_and_off_topic_policy() -> None:
    assert "CALCULATION GUIDANCE" in CHAT_POLICY
    assert "6 sentences or fewer" in CHAT_POLICY
    assert "off-topic" in CHAT_POLICY
    assert "6 sentences or fewer" in CHAT_REPLY_RULES
    assert "off-topic" in CHAT_REPLY_RULES
    assert "CALCULATION GUIDANCE" in CHAT_REPLY_RULES
