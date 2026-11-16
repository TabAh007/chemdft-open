"""Offline validation of the real AI test prompt set fixture (Release 0.0.58).

Validates the structure and behaviour classes in tests/data/ai_prompt_set.json,
and tests deterministic filters against canned bad replies for those prompts.
NEVER calls any AI model or external service.
"""

from __future__ import annotations

import json
from pathlib import Path

from chemdft_api.ai.chat_facts import (
    CHAT_STRUCTURE_EDIT_NOTICE,
    CHAT_SUBMISSION_NOTICE,
    filter_chat_submission_promises,
    filter_chat_structure_edit_promises,
)

DATA_PATH = Path(__file__).parent / "data" / "ai_prompt_set.json"

REQUIRED_PROMPTS = {
    "add two atoms",
    "how far are the atoms from each other",
    "what are the unit cell dimensions and nearest Cr-O distance",
    "can you make me a sandwich",
    "run an HF/STO-3G calculation now",
    "what is this",
    "hello how are you",
    "compare my last two calculations",
    "add two oxygen atoms near the first Cr",
    "prepare a PBE+U run like my last successful one",
    "why did my last failed run fail",
    "which method should I use for this structure",
}


def test_ai_prompt_set_fixture_shape_and_coverage() -> None:
    assert DATA_PATH.is_file(), f"Fixture file missing: {DATA_PATH}"
    with open(DATA_PATH, encoding="utf-8") as f:
        prompts = json.load(f)

    assert isinstance(prompts, list), "Expected list of prompt definitions"
    found_prompts = set()
    for item in prompts:
        assert isinstance(item, dict), "Each prompt item must be a dictionary"
        assert "prompt" in item, "Item must contain 'prompt'"
        assert "expected_behavior_class" in item, "Item must contain 'expected_behavior_class'"
        assert "expected_feature_hint" in item, "Item must contain 'expected_feature_hint'"
        assert "description" in item, "Item must contain 'description'"
        found_prompts.add(item["prompt"])

    missing = REQUIRED_PROMPTS - found_prompts
    assert not missing, f"Missing required prompts in fixture: {missing}"


def test_canned_bad_replies_sanitized_by_deterministic_filters() -> None:
    # 1. Canned bad reply to "add two atoms" (hallucinated promise to add atoms)
    bad_reply_add_atoms = (
        "I'll add the two atoms to the unit cell for you right now. "
        "The coordinates will be updated in the structure."
    )
    sanitized_add = filter_chat_structure_edit_promises(bad_reply_add_atoms)
    assert "I'll add the two atoms" not in sanitized_add
    assert sanitized_add.endswith(CHAT_STRUCTURE_EDIT_NOTICE)

    # 2. Canned bad reply to "run an HF/STO-3G calculation now" (hallucinated submission promise)
    bad_reply_submit = (
        "I will calculate the Hartree-Fock energy.\n"
        "Let me submit this for you now."
    )
    sanitized_submit = filter_chat_submission_promises(bad_reply_submit)
    assert "Let me submit this" not in sanitized_submit
    assert sanitized_submit.endswith(CHAT_SUBMISSION_NOTICE)

    # 3. Both bad promises in one reply
    bad_reply_both = (
        "I'll add the atoms to the cell now.\n"
        "I'm going to run this job."
    )
    cleaned = filter_chat_structure_edit_promises(
        filter_chat_submission_promises(bad_reply_both)
    )
    assert "I'll add the atoms" not in cleaned
    assert "I'm going to run" not in cleaned
    assert CHAT_STRUCTURE_EDIT_NOTICE in cleaned
    assert CHAT_SUBMISSION_NOTICE in cleaned


def test_canned_good_replies_untouched_by_deterministic_filters() -> None:
    good_replies = [
        # For "add two atoms":
        "I can't do that here. To edit or add atoms to the structure, please open the structure editor.",
        # For "how far are the atoms from each other":
        "Computed from stored coordinates: the minimum Cr-O distance is 1.965 Å, and typical Cr-O distance is 2.012 Å.",
        # For "can you make me a sandwich":
        "I can't do that here. I am a scientific assistant for quantum chemistry and DFT within this project.",
        # For "run an HF/STO-3G calculation now":
        "Nothing was submitted. To prepare a calculation for your approval, use the Prepare calculation button in the AI box.",
        # For "hello how are you":
        "Hello! I am ready to help you analyze structures and calculations in this project.",
    ]
    for reply in good_replies:
        cleaned = filter_chat_structure_edit_promises(
            filter_chat_submission_promises(reply)
        )
        assert cleaned == reply


def test_extended_canned_bad_replies_from_fixture() -> None:
    from chemdft_api.ai.chat_facts import (
        filter_chat_structure_edit_promises,
        filter_chat_submission_promises,
        rewrite_retired_chat_wording,
        trim_chat_trailing_boilerplate,
    )

    with open(DATA_PATH, encoding="utf-8") as f:
        prompts = json.load(f)

    tested_count = 0
    for item in prompts:
        if "canned_bad_reply" in item:
            bad = item["canned_bad_reply"]
            expected = item["expected_after_filters"]
            question = item["prompt"]

            res = filter_chat_submission_promises(bad)
            res = filter_chat_structure_edit_promises(res)
            res = rewrite_retired_chat_wording(res)
            res = trim_chat_trailing_boilerplate(res, question)

            assert res == expected, (
                f"Filter mismatch for {item['id']} ({question}):\n"
                f"Got:\n{res!r}\nExpected:\n{expected!r}"
            )
            tested_count += 1

    assert tested_count >= 8, f"Expected at least 8 canned bad replies tested, found {tested_count}"


def test_fact_sheet_calculation_order_matches_compute_jobs_order(api, monkeypatch) -> None:
    from datetime import UTC, datetime, timedelta
    from uuid import UUID
    from sqlalchemy import select
    from chemdft_api.ai.chat_facts import build_project_fact_sheet
    from chemdft_api.calculation_actions import list_compute_jobs
    from chemdft_api.contracts.catalog import EntityReference
    from chemdft_api.context import Identity
    from chemdft_api.models import User
    from chemdft_api.scientific_models import CalculationRecord, ComputeJobRecord
    from test_ai_scientist import _create_project
    from test_compute_gateway import _energy_spec, _import_h2

    monkeypatch.setattr(
        "chemdft_api.calculation_actions.validate_capability", lambda _s, _t: None
    )

    client, sessions, _settings = api
    project = _create_project(client, "Order Parity Project")
    project_id = project["id"]
    version = _import_h2(client, project_id)

    calc_ids = []
    job_ids = []
    for i in range(3):
        detail = client.post(
            f"/v1/projects/{project_id}/calculations",
            json={
                "structure_version": EntityReference(
                    project_id=UUID(project_id),
                    entity_type="structure.version",
                    entity_id=UUID(version["id"]),
                ).model_dump(mode="json"),
                "specification": _energy_spec(),
                "idempotency_key": f"order-parity-{i}",
            },
        )
        assert detail.status_code in (200, 201), detail.text
        calc_ids.append(detail.json()["calculation"]["id"])
        job_ids.append(detail.json()["compute_job"]["id"])

    # Now assign distinct created_at timestamps t1 < t2 < t3
    t0 = datetime(2026, 11, 14, 10, 0, 0, tzinfo=UTC)
    times = [t0 + timedelta(hours=i) for i in range(1, 4)]  # t1, t2, t3

    with sessions() as session:
        for c_id, j_id, t in zip(calc_ids, job_ids, times, strict=True):
            calc = session.get(CalculationRecord, c_id)
            calc.created_at = t
            job = session.get(ComputeJobRecord, j_id)
            job.created_at = t
        session.commit()

    with sessions() as session:
        # 1. Fact sheet calculation order
        sheet = build_project_fact_sheet(
            session,
            project_id,
            project_name="Order Parity Project",
            role="owner",
            provider="nvidia",
            model="nvidia/nemotron-3.5-lightning-30b-a3b",
            mode="managed",
        )
        fact_sheet_calc_ids = []
        for line in sheet.splitlines():
            if line.startswith("[") and "] (" in line and "id: " in line:
                short_id = line.split("id: ")[1].split("...")[0]
                for full_id in calc_ids:
                    if full_id.startswith(short_id):
                        fact_sheet_calc_ids.append(full_id)

        # 2. Jobs list calculation order via official GET endpoint
        jobs_res = client.get(f"/v1/projects/{project_id}/compute/jobs")
        assert jobs_res.status_code == 200, jobs_res.text
        jobs_output = jobs_res.json()
        jobs_calc_ids = [job["calculation_id"] for job in jobs_output["jobs"]]

        # Both must return newest first: [calc_ids[2], calc_ids[1], calc_ids[0]]
        expected_order = [calc_ids[2], calc_ids[1], calc_ids[0]]
        assert fact_sheet_calc_ids == expected_order
        assert jobs_calc_ids == expected_order
        assert fact_sheet_calc_ids == jobs_calc_ids

