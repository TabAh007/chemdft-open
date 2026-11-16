"""CHAT mode: free conversation grounded in a server-built fact sheet, with cited answers kept."""

from __future__ import annotations

import pytest
from chemdft_api.ai.chat_facts import CHAT_REPLY_NOTE, build_project_fact_sheet
from chemdft_api.ai.gateway import FakeModelGateway, ModelResponse, ModelUsage
from chemdft_api.ai.service import _chat_needs_cited_evidence
from test_ai_scientist import _create_project, _import_h2


@pytest.fixture
def chat_gateway(monkeypatch):
    requests = []

    def generate(self, request):
        requests.append(request)
        return ModelResponse(
            content="Hello! I can help with this project.",
            usage=ModelUsage(input_tokens=50, output_tokens=10, latency_ms=1),
        )

    monkeypatch.setattr(FakeModelGateway, "generate", generate)
    return requests


def _conversation(client, project_id: str) -> str:
    return client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()[
        "conversation"
    ]["id"]


def _ask(client, project_id: str, conversation: str, content: str):
    response = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conversation}/messages",
        json={"content": content, "mode": "CHAT"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_chat_reply_is_labelled_not_evidence_and_sees_the_fact_sheet(api, chat_gateway) -> None:
    client, _sessions, _settings = api
    project = _create_project(client, "Chat water")
    _import_h2(client, project["id"])
    conversation = _conversation(client, project["id"])

    body = _ask(client, project["id"], conversation, "tell me about the project")

    reply = body["messages"][-1]
    assert reply["role"] == "assistant"
    assert reply["content"] == "Hello! I can help with this project."
    assert reply["evidence_status"] is None
    assert reply["evidence_note"] == CHAT_REPLY_NOTE
    assert reply["citations"] == []
    assert body["latest_run"]["status"] == "SUCCEEDED"

    request = chat_gateway[-1]
    assert request.tools == ()
    assert "CHAT MODE" in request.system_prompt
    sent = request.messages[-1].content
    assert "[PROJECT FACTS" in sent and "[END PROJECT FACTS]" in sent
    assert "Structures: 1" in sent
    assert "H2 Molecule (MOLECULE): formula H2, 2 atoms" in sent
    assert "Calculations, newest first (by created time): 0" in sent
    assert "Documents: 0" in sent
    assert "QUESTION:\ntell me about the project" in sent


def test_chat_fact_sheet_names_the_serving_model_from_server_settings(api, chat_gateway) -> None:
    client, _sessions, _settings = api
    project = _create_project(client, "Chat model identity")
    conversation = _conversation(client, project["id"])

    _ask(client, project["id"], conversation, "what model are you")

    sent = chat_gateway[-1].messages[-1].content
    assert "AI serving this chat:" in sent
    assert "via fake" in sent


def test_chat_keeps_cited_evidence_for_document_and_result_questions(api, chat_gateway) -> None:
    client, _sessions, _settings = api
    project = _create_project(client, "Chat evidence routing")
    conversation = _conversation(client, project["id"])

    body = _ask(client, project["id"], conversation, "What does the uploaded paper report about X?")

    reply = body["messages"][-1]
    assert reply["evidence_status"] == "INSUFFICIENT_EVIDENCE"
    assert reply["evidence_note"] != CHAT_REPLY_NOTE
    assert chat_gateway == []


@pytest.mark.parametrize(
    ("question", "cited"),
    [
        ("hey how are you", False),
        ("what model are you", False),
        ("how many molecules are there", False),
        ("how many calculations did I run", False),
        ("what is a naphthenic acid", False),
        ("what is the HOMO energy", True),
        ("what does the paper say about XRD", True),
        ("summarize this project", True),
        ("what can I do next", True),
        ("what is the frequency of the strongest mode", True),
    ],
)
def test_chat_routes_only_result_view_and_document_questions_to_cited_evidence(
    question: str, cited: bool
) -> None:
    assert _chat_needs_cited_evidence(question) is cited


@pytest.mark.parametrize(
    ("question", "cited"),
    [
        ("hey how are you", False),
        ("what model are you", False),
        ("how many molecules are in this project", False),
        ("what is a naphthenic acid", False),
        ("At what temperature was the CVD synthesis carried out?", True),
        ("What method was used to synthesize the compound?", True),
        ("what is the annealing temperature here", True),
        ("which conditions were used", True),
    ],
)
def test_chat_with_documents_sends_unclear_questions_to_the_cited_path(
    question: str, cited: bool
) -> None:
    assert _chat_needs_cited_evidence(question, has_sources=True) is cited


def test_fact_sheet_has_no_numeric_scientific_values_and_counts_records(api) -> None:
    client, sessions, _settings = api
    project = _create_project(client, "Fact sheet")
    _import_h2(client, project["id"])
    _import_h2(client, project["id"])

    with sessions() as session:
        sheet = build_project_fact_sheet(
            session,
            project["id"],
            project_name="Fact sheet",
            role="owner",
            provider="nvidia",
            model="nvidia/nemotron-3.5-lightning-30b-a3b",
            mode="managed",
        )

    assert "Structures: 2" in sheet
    assert "nvidia/nemotron-3.5-lightning-30b-a3b via nvidia (managed mode)" in sheet
    for forbidden in ("energy", "hartree", "cm-1", "frequency", "Eh"):
        assert forbidden not in sheet


def test_web_chat_label_uses_the_exact_backend_note() -> None:
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[3] / "apps" / "web" / "src" / "lib" / "ai-chat-reply.ts"
    ).read_text(encoding="utf-8")
    assert CHAT_REPLY_NOTE in source


def test_chat_usage_records_a_short_prompt_version(api, chat_gateway) -> None:
    from chemdft_api.ai.chat_facts import CHAT_POLICY_VERSION

    assert len(CHAT_POLICY_VERSION) <= 64
    client, sessions, _settings = api
    project = _create_project(client, "Chat prompt version")
    conversation = _conversation(client, project["id"])
    _ask(client, project["id"], conversation, "what structures exist")
    from chemdft_api.ai_models import AIModelInvocationRecord  # noqa: PLC0415
    from sqlalchemy import select

    with sessions() as session:
        versions = session.scalars(select(AIModelInvocationRecord.prompt_version)).all()
    assert CHAT_POLICY_VERSION in versions


def test_resolve_quote_maps_layout_differences_back_to_exact_source_text() -> None:
    from chemdft_api.ai.evidence_answer import resolve_quote

    passage = "The cell is a = b = 4.958 Å,\nc = 13.593 Å (hexagonal), measured by X-ray; the crystal-\nlographic data agree."  # noqa: RUF001
    assert resolve_quote("c = 13.593 Å", passage) == "c = 13.593 Å"
    assert resolve_quote("4.958 Å, c = 13.593 Å", passage) == "4.958 Å,\nc = 13.593 Å"
    assert resolve_quote("measured by X-ray; the crystallographic data", passage) == (
        "measured by X-ray; the crystal-\nlographic data"
    )
    assert resolve_quote("a = b = 4.958 A, c = 13.593 A", passage) is None  # letters never altered
    assert resolve_quote("c = 99.999 Å", passage) is None
    assert resolve_quote("short", passage) is None


def test_evidence_validator_shows_the_sources_own_text() -> None:
    from chemdft_api.ai.evidence_answer import validate_extracted_answer

    refs = [
        {
            "citation_id": "E1",
            "source_class": "EXTRACTED",
            "document_id": "d1",
            "page_number": 1,
            "source_anchor_id": None,
            "knowledge_chunk_id": "c1",
            "source_title": "Paper",
            "source_type": "DOCUMENT_TEXT",
            "source_entity_id": "d1",
        }
    ]
    passages = {"E1": "Samples were annealed at 400-800°C\nin an Ar and H2 flow."}
    model = '{"claims":[{"evidence_id":"E1","quote":"annealed at 400–800°C in an Ar and H2 flow"}]}'  # noqa: RUF001
    answer = validate_extracted_answer(model, refs, passages)
    assert answer.status == "SUPPORTED"
    assert "annealed at 400-800°C\nin an Ar and H2 flow" in answer.content


def test_truncated_reply_gets_its_own_clear_error_not_provider_unavailable(
    api, monkeypatch
) -> None:
    from chemdft_api.ai.gateway import FakeModelGateway, ModelOutputTruncatedError

    def generate(self, request):
        raise ModelOutputTruncatedError("cut off")

    monkeypatch.setattr(FakeModelGateway, "generate", generate)
    client, _sessions, _settings = api
    project = _create_project(client, "Chat truncated")
    conversation = _conversation(client, project["id"])
    body = _ask(client, project["id"], conversation, "tell me what calculations are here")
    assert "cut off before it finished" in body["messages"][-1]["content"]
    assert body["latest_run"]["error_code"] == "PROVIDER_OUTPUT_TRUNCATED"


def test_direct_answer_switch_only_for_models_whose_card_documents_it() -> None:
    from chemdft_api.ai.model_catalog import LIGHTNING, direct_answer_kwargs

    assert direct_answer_kwargs("nvidia", LIGHTNING) == (("enable_thinking", False),)
    assert direct_answer_kwargs("nvidia", "nvidia/nemotron-3-super-120b-a12b") is None
    assert direct_answer_kwargs("moonshot", "kimi-k3") is None


def test_resolve_quote_tolerates_pdf_split_words_but_shows_the_source_text() -> None:
    from chemdft_api.ai.evidence_answer import resolve_quote

    passage = "The article presents the hypoth etical structure of a synthesized Cr(III)Cat sample."
    assert resolve_quote("presents the hypothetical structure of a synthesized", passage) == (
        "presents the hypoth etical structure of a synthesized"
    )
    assert resolve_quote("presents the hypothetical structure of a different", passage) is None


def test_resolve_quote_handles_ligatures_and_degree_circle() -> None:  # noqa: RUF001
    from chemdft_api.ai.evidence_answer import resolve_quote

    passage = (
        "Cu anode ceramic X-ray tube (Kα1 = 1.540598 Å) with a long thin focus, Ni-Kβ\n"  # noqa: RUF001
        "ﬁlter, and PIXCEL1D detector. Samples were calcined at 500 ◦C for 1 h."
    )
    assert resolve_quote("Ni-Kβ filter, and PIXCEL1D detector", passage) == (
        "Ni-Kβ\nﬁlter, and PIXCEL1D detector"
    )
    assert resolve_quote("calcined at 500 °C for 1 h", passage) == "calcined at 500 ◦C for 1 h"
    assert resolve_quote("calcined at 600 °C", passage) is None
    # a quote ending inside a ligature still maps to the source's own character
    assert resolve_quote("Ni-Kβ fi", passage) == "Ni-Kβ\nﬁ"


def test_evidence_answer_retries_once_when_the_model_returns_no_claims(api, monkeypatch) -> None:
    import json

    from test_ai_scientist import _pdf_with_text

    from test_phase9_knowledge import _drain_worker

    client, sessions, settings = api
    project = _create_project(client, "Retry on empty claims")
    pid = project["id"]
    sentence = "The calculations were implemented in the WIEN2K computational code"
    imported = client.post(
        f"/v1/projects/{pid}/documents/imports",
        files={
            "upload": (
                "p.pdf",
                _pdf_with_text(sentence + " for all structures."),
                "application/pdf",
            )
        },
    )
    assert imported.status_code == 201, imported.text
    client.post(f"/v1/projects/{pid}/knowledge/reindex")
    _drain_worker(sessions, settings)
    calls: list[int] = []

    def generate(self, request):
        calls.append(1)
        usage = ModelUsage(input_tokens=50, output_tokens=10, latency_ms=1)
        if len(calls) == 1:
            return ModelResponse(content='{"claims":[]}', usage=usage)
        payload = json.loads(request.messages[-1].content)
        hit = next(item for item in payload["evidence"] if "WIEN2K" in item["passage"])
        answer = {"claims": [{"evidence_id": hit["id"], "quote": sentence}]}
        return ModelResponse(content=json.dumps(answer), usage=usage)

    monkeypatch.setattr(FakeModelGateway, "generate", generate)
    conversation = _conversation(client, pid)
    response = client.post(
        f"/v1/projects/{pid}/ai/conversations/{conversation}/messages",
        json={
            "content": "Which software package was used for the calculations?",
            "mode": "EVIDENCE",
        },
    )
    assert response.status_code == 201, response.text
    reply = response.json()["messages"][-1]
    assert len(calls) == 2
    assert reply["evidence_status"] == "SUPPORTED" and "WIEN2K" in reply["content"]


def test_chat_policy_prefers_not_sure_over_a_confident_guess_and_trusts_project_formulas() -> None:
    from chemdft_api.ai.chat_facts import CHAT_POLICY

    flat = " ".join(CHAT_POLICY.split())
    assert "I am not sure" in flat
    assert "formula is authoritative" in flat
    assert "I do not know from the project records" in flat


def test_chat_policy_never_promises_to_submit_and_points_to_plan_a_calculation() -> None:
    from chemdft_api.ai.chat_facts import CHAT_POLICY

    flat = " ".join(CHAT_POLICY.split())
    assert "cannot submit, run, queue or start anything" in flat
    assert "Never say or imply that you are submitting" in flat
    assert "use the Prepare calculation button" in flat
    assert "nothing has been submitted" in flat


def test_filter_chat_submission_promises_exact_observed_reply() -> None:
    from chemdft_api.ai.chat_facts import CHAT_SUBMISSION_NOTICE, filter_chat_submission_promises

    observed_reply = (
        "I can help you calculate the energy of this molecule.\n"
        "1. Method: HF\n"
        "2. Basis: STO-3G\n"
        "Let me submit this for you now."
    )
    filtered = filter_chat_submission_promises(observed_reply)
    assert "Let me submit this for you now." not in filtered
    assert filtered.endswith(CHAT_SUBMISSION_NOTICE)
    assert "1. Method: HF" in filtered
    assert "2. Basis: STO-3G" in filtered


def test_filter_chat_submission_promises_variants() -> None:
    from chemdft_api.ai.chat_facts import CHAT_SUBMISSION_NOTICE, filter_chat_submission_promises

    variants = [
        ("I will submit this for you now.", CHAT_SUBMISSION_NOTICE),
        ("I'll run this calculation now.", CHAT_SUBMISSION_NOTICE),
        ("Submitting this now.", CHAT_SUBMISSION_NOTICE),
        ("I'm going to run this job.", CHAT_SUBMISSION_NOTICE),
        ("I am going to start the calculation.", CHAT_SUBMISSION_NOTICE),
        (
            "Here is the plan. I'll submit this calculation for you. Please check back soon.",
            f"Here is the plan. Please check back soon.\n\n{CHAT_SUBMISSION_NOTICE}",
        ),
    ]
    for raw, expected in variants:
        assert filter_chat_submission_promises(raw) == expected


def test_filter_chat_submission_promises_negatives_do_not_trigger() -> None:
    from chemdft_api.ai.chat_facts import filter_chat_submission_promises

    negatives = [
        # Past tense
        "The job was submitted earlier by the researcher.",
        "A calculation was submitted yesterday and finished with status SUCCEEDED.",
        # Explaining approval is required
        "In ChemDFT, calculations must be submitted through the approval flow in plan mode.",
        "A calculation can only be submitted after your explicit approval.",
        # Quoting the user
        'You asked: "Can you submit this for me?"',
        "You wrote 'let me submit this' in your previous message.",
    ]
    for text in negatives:
        filtered = filter_chat_submission_promises(text)
        assert filtered == text, f"Negative triggered unexpectedly on: {text}"


def test_chat_mode_endpoint_strips_submission_promise(api, monkeypatch) -> None:
    from chemdft_api.ai.chat_facts import CHAT_SUBMISSION_NOTICE

    client, _sessions, _settings = api
    project = _create_project(client, "Chat Filter Test")
    _import_h2(client, project["id"])
    conversation = _conversation(client, project["id"])

    def generate(self, request):
        return ModelResponse(
            content=(
                "I will calculate the Hartree-Fock energy.\n"
                "1. Engine: PySCF\n"
                "2. Method: HF/STO-3G\n"
                "Let me submit this for you now."
            ),
            usage=ModelUsage(input_tokens=40, output_tokens=25, latency_ms=1),
        )

    monkeypatch.setattr(FakeModelGateway, "generate", generate)

    body = _ask(client, project["id"], conversation, "calculate energy for H2")
    reply = body["messages"][-1]
    assert "Let me submit this for you now" not in reply["content"]
    assert reply["content"].endswith(CHAT_SUBMISSION_NOTICE)
    assert "1. Engine: PySCF" in reply["content"]


def test_filter_chat_structure_edit_promises_exact_observed_and_variants() -> None:
    from chemdft_api.ai.chat_facts import (
        CHAT_STRUCTURE_EDIT_NOTICE,
        filter_chat_structure_edit_promises,
    )

    observed_variants = [
        ("I'll add the atoms to the structure now.", CHAT_STRUCTURE_EDIT_NOTICE),
        ("I will add two atoms.", CHAT_STRUCTURE_EDIT_NOTICE),
        ("I have added the atoms for you.", CHAT_STRUCTURE_EDIT_NOTICE),
        ("I've added two atoms.", CHAT_STRUCTURE_EDIT_NOTICE),
        ("Let me add two atoms.", CHAT_STRUCTURE_EDIT_NOTICE),
        ("I am going to add the atoms.", CHAT_STRUCTURE_EDIT_NOTICE),
        ("I'm adding two atoms to the cell.", CHAT_STRUCTURE_EDIT_NOTICE),
        ("I modified the structure.", CHAT_STRUCTURE_EDIT_NOTICE),
        ("I created a new structure with 2 atoms.", CHAT_STRUCTURE_EDIT_NOTICE),
        (
            "Here is the result. I'll add the atoms for you now. Check the viewer.",
            f"Here is the result. Check the viewer.\n\n{CHAT_STRUCTURE_EDIT_NOTICE}",
        ),
    ]
    for raw, expected in observed_variants:
        filtered = filter_chat_structure_edit_promises(raw)
        assert filtered == expected, f"Failed on raw: {raw!r}, got: {filtered!r}"


def test_filter_chat_structure_edit_promises_negatives_do_not_trigger() -> None:
    from chemdft_api.ai.chat_facts import filter_chat_structure_edit_promises

    negatives = [
        # Explaining how the user can edit
        "To edit the structure or add atoms, use the structure editor.",
        "You can add two atoms using the structure editor.",
        "Structures are edited in the structure editor, where you can add or remove atoms.",
        # Past tense about project records
        "The structure was created in 2024 from an uploaded CIF file.",
        "The researcher added two atoms in revision V2.",
        "A new structure was created by importing water.xyz.",
        # Quoting the user
        'The user asked: "Can you add two atoms?"',
        'You asked: "I will add the atoms, right?"',
        # Explicit inability / refusal
        "I cannot add atoms to a committed structure.",
        "I can't edit structures or add atoms here.",
        "I am unable to add atoms to your project.",
        "I will not modify the structure.",
    ]
    for text in negatives:
        filtered = filter_chat_structure_edit_promises(text)
        assert filtered == text, f"Negative triggered unexpectedly on: {text}"


def test_canned_replies_do_not_have_capability_boilerplate_appended_by_code() -> None:
    from chemdft_api.ai.capabilities import CAN_CAPABILITIES, CANNOT_CAPABILITIES
    from chemdft_api.ai.chat_facts import (
        filter_chat_submission_promises,
        filter_chat_structure_edit_promises,
    )

    canned_replies = [
        "Hello! How can I help you with your project today?",
        "Water has a bent geometry with a bond angle of approximately 104.5 degrees.",
        "The project contains 1 structure and 3 calculations.",
        "The Cr-O nearest neighbour distance is 1.965 Å, computed from stored coordinates.",
    ]
    for reply in canned_replies:
        processed = filter_chat_structure_edit_promises(filter_chat_submission_promises(reply))
        assert processed == reply
        for cap in CAN_CAPABILITIES:
            assert cap not in processed, f"Capability {cap!r} was unexpectedly appended by code"
        for cap in CANNOT_CAPABILITIES:
            assert cap not in processed, f"Cannot capability {cap!r} was unexpectedly appended by code"


def test_fact_sheet_injects_computed_structure_measurements(api) -> None:
    from chemdft_api.ai.chat_facts import build_project_fact_sheet

    client, sessions, _settings = api
    project = _create_project(client, "Fact sheet with structure")
    _import_h2(client, project["id"])

    with sessions() as session:
        sheet = build_project_fact_sheet(
            session,
            project["id"],
            project_name="Fact sheet with structure",
            role="owner",
            provider="nvidia",
            model="nvidia/nemotron-3.5-lightning-30b-a3b",
            mode="managed",
        )

    assert "[Computed by ChemDFT from the stored coordinates of" in sheet
    assert "Formula: H2" in sheet
    assert "Coordinate type: CARTESIAN" in sheet
    assert "H to H: min 0.740 Å" in sheet
    assert "[END COMPUTED STRUCTURE MEASUREMENTS]" in sheet


def test_history_hygiene_sanitizes_retired_product_wording() -> None:
    from chemdft_api.ai.chat_facts import (
        RETIRED_CHAT_HISTORY_PLACEHOLDER,
        sanitize_chat_history_message,
    )

    # Exact observed phrases
    assert (
        sanitize_chat_history_message("assistant", 'use "Plan a calculation" in the AI interface')
        == RETIRED_CHAT_HISTORY_PLACEHOLDER
    )
    assert (
        sanitize_chat_history_message("assistant", "You should switch to Plan mode.")
        == RETIRED_CHAT_HISTORY_PLACEHOLDER
    )
    assert (
        sanitize_chat_history_message("assistant", "See Chat | Plan tab for details.")
        == RETIRED_CHAT_HISTORY_PLACEHOLDER
    )
    assert (
        sanitize_chat_history_message("assistant", "Call plan_a_calculation tool.")
        == RETIRED_CHAT_HISTORY_PLACEHOLDER
    )
    # User message with retired phrasing is NOT replaced
    assert (
        sanitize_chat_history_message("user", 'how do I "Plan a calculation"?')
        == 'how do I "Plan a calculation"?'
    )
    # Normal assistant reply is NOT replaced
    assert (
        sanitize_chat_history_message("assistant", "The structure has 2 atoms.")
        == "The structure has 2 atoms."
    )


def test_history_hygiene_limits_to_6_and_omits_retired_phrases_in_gateway_call(
    api, chat_gateway
) -> None:
    from datetime import UTC, datetime
    from chemdft_api.ai.chat_facts import RETIRED_CHAT_HISTORY_PLACEHOLDER
    from chemdft_api.ai_models import AIMessageRecord
    from chemdft_api.models import new_id

    client, sessions, _settings = api
    project = _create_project(client, "History hygiene project")
    conversation = _conversation(client, project["id"])

    # Seed 18 messages in history
    with sessions() as session:
        for i in range(18):
            role = "user" if i % 2 == 0 else "assistant"
            if role == "assistant" and i == 15:
                content = 'Assistant message 15: use "Plan a calculation" in the AI interface'
            elif role == "assistant" and i == 17:
                content = "Assistant message 17: normal reply about project"
            else:
                content = f"Message {i} from {role}"
            session.add(
                AIMessageRecord(
                    id=new_id(),
                    project_id=project["id"],
                    conversation_id=conversation,
                    run_id=None,
                    role=role,
                    content=content,
                    citations_json=[],
                    evidence_refs_json=[],
                    created_at=datetime(2026, 11, 14, 12, 0, i, tzinfo=UTC),
                )
            )
        session.commit()

    # Now ask question 19
    _ask(client, project["id"], conversation, "compare the calculations")

    # Gateway should have received at most 6 past messages + 1 user prompt
    request = chat_gateway[-1]
    past_messages = request.messages[:-1]
    assert len(past_messages) == 6

    # Verify message 15 was replaced with RETIRED_CHAT_HISTORY_PLACEHOLDER
    msg_15_in_gateway = [m for m in past_messages if m.content == RETIRED_CHAT_HISTORY_PLACEHOLDER]
    assert len(msg_15_in_gateway) == 1

    # Verify database still has original text!
    with sessions() as session:
        stored_15 = session.query(AIMessageRecord).filter(
            AIMessageRecord.conversation_id == conversation,
            AIMessageRecord.content.like("%Assistant message 15%"),
        ).first()
        assert stored_15 is not None
        assert 'use "Plan a calculation"' in stored_15.content


def test_reply_rules_appended_to_user_message_and_user_text_unchanged(api, chat_gateway) -> None:
    from chemdft_api.ai.chat_facts import CHAT_REPLY_RULES

    client, _sessions, _settings = api
    project = _create_project(client, "Reply rules project")
    conversation = _conversation(client, project["id"])

    user_query = "what is the bond length between atoms 1 and 2?"
    _ask(client, project["id"], conversation, user_query)

    request = chat_gateway[-1]
    last_msg = request.messages[-1].content
    assert last_msg.endswith(CHAT_REPLY_RULES)
    assert f"QUESTION:\n{user_query}\n\n{CHAT_REPLY_RULES}" in last_msg
    assert "1. Answer only the question asked." in CHAT_REPLY_RULES
    assert "2. Do NOT repeat the project summary" in CHAT_REPLY_RULES
    assert "4. Never say you can submit, run, or queue anything" in CHAT_REPLY_RULES
    assert "5. Never mention \"Plan a calculation\"." in CHAT_REPLY_RULES


def test_capabilities_contain_no_submit_a_calculation_and_plain_methods() -> None:
    from chemdft_api.ai.capabilities import (
        AI_CAPABILITIES_POLICY,
        AI_CAPABILITIES_SUMMARY,
        CAN_CAPABILITIES,
        CANNOT_CAPABILITIES,
    )

    combined = (
        AI_CAPABILITIES_POLICY
        + " "
        + AI_CAPABILITIES_SUMMARY
        + " "
        + " ".join(CAN_CAPABILITIES)
        + " "
        + " ".join(CANNOT_CAPABILITIES)
    ).lower()

    assert "submit a calculation" not in combined
    assert "submit a calculation proposal" not in combined
    assert "hartree-fock (hf)" in combined
    assert "b3lyp" in combined
    assert "pbe" in combined
    assert "prepare a periodic calculation proposal for approval" in combined
    assert "propose structure edits for approval" in combined


def test_rewrite_retired_chat_wording() -> None:
    from chemdft_api.ai.chat_facts import rewrite_retired_chat_wording

    assert (
        rewrite_retired_chat_wording('use "Plan a calculation" in the AI interface')
        == "use the Prepare calculation button in the AI interface"
    )
    assert (
        rewrite_retired_chat_wording("You can use Plan mode to proceed.")
        == "You can use the Prepare calculation button to proceed."
    )
    assert (
        rewrite_retired_chat_wording("In plan mode, you can draft structures.")
        == "In the Prepare calculation button, you can draft structures."
    )


def test_pure_greeting_or_thanks_short_circuits_without_gateway_call(api, chat_gateway) -> None:
    from chemdft_api.ai.chat_facts import GREETING_SHORT_CIRCUIT_REPLY, CHAT_REPLY_NOTE

    client, _sessions, _settings = api
    project = _create_project(client, "Greeting short circuit")
    conversation = _conversation(client, project["id"])

    # Test pure greetings
    greetings = [
        "hello",
        "Hi!",
        "hey",
        "good morning",
        "how are you?",
        "hello how are you",
        "Thanks",
        "thank you very much!",
        "cheers",
    ]
    for g in greetings:
        body = _ask(client, project["id"], conversation, g)
        reply = body["messages"][-1]
        assert reply["role"] == "assistant"
        assert reply["content"] == GREETING_SHORT_CIRCUIT_REPLY
        assert reply["evidence_note"] == CHAT_REPLY_NOTE
        assert body["latest_run"]["status"] == "SUCCEEDED"

    # Gateway should have received zero calls!
    assert len(chat_gateway) == 0


def test_greeting_near_misses_reach_the_model(api, chat_gateway) -> None:
    client, _sessions, _settings = api
    project = _create_project(client, "Greeting near misses")
    conversation = _conversation(client, project["id"])

    near_misses = [
        "hello what is the cell volume",
        "hi compare my calculations",
        "thanks for calculating that",
        "can you make me a sandwich",
    ]
    for nm in near_misses:
        count_before = len(chat_gateway)
        _ask(client, project["id"], conversation, nm)
        assert len(chat_gateway) == count_before + 1


def test_trim_chat_trailing_boilerplate_observed_sandwich_and_hello() -> None:
    from chemdft_api.ai.chat_facts import trim_chat_trailing_boilerplate

    # Observed sandwich reply
    sandwich_reply = (
        "I cannot make a sandwich. I am an AI assistant for chemistry.\n\n"
        "Project summary: 1 structure, 18 calculations, 12 succeeded.\n\n"
        "I can: Review calculations, report structure measurements, plan new calculations."
    )
    trimmed = trim_chat_trailing_boilerplate(sandwich_reply, "can you make me a sandwich")
    assert "I can:" not in trimmed
    assert "I cannot make a sandwich" in trimmed
    assert "Project summary: 1 structure" in trimmed

    # Observed hello reply
    hello_reply = (
        "Hello! How can I assist you with your chemistry project today?\n\n"
        "Here's what I can do:\n"
        "- Answer questions about project records\n"
        "- Report computed structure measurements"
    )
    trimmed_hello = trim_chat_trailing_boilerplate(hello_reply, "hello how are you")
    assert "Here's what I can do:" not in trimmed_hello
    assert "Hello! How can I assist" in trimmed_hello

    # Refusal that names app feature in paragraph 1 is NOT trimmed
    refusal_with_feature = (
        "I can't edit or add atoms to a committed structure; please use the structure editor.\n\n"
        "Here's what I can do:\n"
        "- Report structure measurements"
    )
    assert (
        trim_chat_trailing_boilerplate(refusal_with_feature, "add two atoms")
        == refusal_with_feature
    )

    # User asks what AI can do - reply is NOT trimmed
    what_can_you_do_reply = (
        "Here's what I can do:\n"
        "- Answer questions about project records\n"
        "- Report computed structure measurements"
    )
    assert (
        trim_chat_trailing_boilerplate(what_can_you_do_reply, "what can you do?")
        == what_can_you_do_reply
    )
    assert (
        trim_chat_trailing_boilerplate(what_can_you_do_reply, "can you help me?")
        == what_can_you_do_reply
    )


def test_calculation_ordering_newest_first_with_timestamps(api) -> None:
    from datetime import UTC, datetime
    from chemdft_api.ai.chat_facts import build_project_fact_sheet
    from chemdft_api.scientific_models import CalculationRecord, CalculationInputRecord
    from chemdft_api.models import new_id

    client, sessions, _settings = api
    project = _create_project(client, "Calc ordering test")
    _import_h2(client, project["id"])

    with sessions() as session:
        from chemdft_api.models import User
        from chemdft_api.scientific_models import ScientificArtifactRecord
        from sqlalchemy import select

        user = session.scalars(select(User)).first()
        assert user is not None

        art_id = new_id()
        session.add(
            ScientificArtifactRecord(
                id=art_id,
                project_id=project["id"],
                kind="STRUCTURE_NORMALIZED",
                media_type="text/plain",
                format_identifier="xyz",
                size_bytes=10,
                sha256="0" * 64,
                storage_key=f"projects/{project['id']}/structures/{art_id}",
                created_by=user.id,
                extensions_json=[],
            )
        )
        session.flush()

        t1 = datetime(2026, 11, 14, 10, 0, 0, tzinfo=UTC)
        t2 = datetime(2026, 11, 14, 11, 0, 0, tzinfo=UTC)
        t3 = datetime(2026, 11, 14, 12, 0, 0, tzinfo=UTC)

        c1 = CalculationRecord(id="c1111111-1111-1111-1111-111111111111", project_id=project["id"], state="COMPLETED", created_by=user.id, created_at=t1)
        c2 = CalculationRecord(id="c2222222-2222-2222-2222-222222222222", project_id=project["id"], state="COMPLETED", created_by=user.id, created_at=t2)
        c3 = CalculationRecord(id="c3333333-3333-3333-3333-333333333333", project_id=project["id"], state="COMPLETED", created_by=user.id, created_at=t3)

        session.add_all([c1, c2, c3])
        session.flush()
        session.add(CalculationInputRecord(id=new_id(), project_id=project["id"], calculation_id=c1.id, structure_version_id=new_id(), normalized_input_artifact_id=art_id, specification_json={"task_type": "energy", "method": {"display_name": "HF"}, "basis": {"display_name": "STO-3G"}}))
        session.add(CalculationInputRecord(id=new_id(), project_id=project["id"], calculation_id=c2.id, structure_version_id=new_id(), normalized_input_artifact_id=art_id, specification_json={"task_type": "energy", "method": {"display_name": "B3LYP"}, "basis": {"display_name": "6-31G"}}))
        session.add(CalculationInputRecord(id=new_id(), project_id=project["id"], calculation_id=c3.id, structure_version_id=new_id(), normalized_input_artifact_id=art_id, specification_json={"task_type": "energy", "method": {"display_name": "PBE"}, "basis": {"display_name": "def2-SVP"}}))
        session.commit()

        sheet = build_project_fact_sheet(
            session,
            project["id"],
            project_name="Calc ordering test",
            role="owner",
            provider="nvidia",
            model="nvidia/nemotron-3.5-lightning-30b-a3b",
            mode="managed",
        )

    assert "Calculations, newest first (by created time): 3 (3 COMPLETED)" in sheet
    assert "[1] (2026-11-14 12:00:00) energy / PBE / def2-SVP (id: c3333333...): COMPLETED" in sheet
    assert "[2] (2026-11-14 11:00:00) energy / B3LYP / 6-31G (id: c2222222...): COMPLETED" in sheet
    assert "[3] (2026-11-14 10:00:00) energy / HF / STO-3G (id: c1111111...): COMPLETED" in sheet



