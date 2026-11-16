"""Release 0.0.24 Part B: workflow / how-to messages are answered as AI replies, not forced through document search.

The AI gateway is mocked (FakeModelGateway). Live verification with the real model is NOT RUN.
"""

from __future__ import annotations

import re
from uuid import uuid4

import pytest
from chemdft_api.ai import app_guide
from chemdft_api.ai.app_guide import APP_GUIDE_FACTS, is_workflow_howto_request
from chemdft_api.ai.chat_facts import CHAT_REPLY_NOTE
from chemdft_api.ai.gateway import FakeModelGateway, ModelResponse, ModelUsage
from chemdft_api.ai.service import _chat_needs_cited_evidence
from chemdft_api.scientific.structures import StructureSourceFormat
from chemdft_api.scientific_models import ScientificDocumentRecord
from test_ai_scientist import _create_project

WORKFLOW = [
    "i want to import molecule",
    "I want to import a molecule",
    "How do I import a structure file?",
    "where do I upload my XYZ file",
    "how to draw a molecule",
    "how can I build a structure from scratch",
    "Can I add a molecule to this project?",
    "how to start a calculation",
    "How do I run a calculation on my molecule?",
    "where can I find the jobs page",
    "what does the Results tab do",
    "what does the Compare button do?",
    "what is the Advanced Workbench",
    "where do I start",
    "getting started",
    "upload a dataset",
    "i would like to load a file",
    "open the settings",
    "как импортировать молекулу",
    "necə molekul idxal edim",
]

CITED = [
    "import the molecule from the paper",
    "what does the paper say about HNO3 and how do I import it",
    "what is the total energy of the selected job",
    "what is the HOMO-LUMO gap",
    "which value was reported in the document",
    "is this result verified",
    "cite the source for the bond length",
    "At what temperature was the CVD synthesis carried out?",
]

OTHER_ROUTING = [
    ("hey how are you", False, False),
    ("what model are you", False, False),
    ("what is a naphthenic acid", False, False),
    ("what can I do next", True, False),
    ("summarize this project", True, False),
]


@pytest.mark.parametrize("message", WORKFLOW)
def test_workflow_phrasings_are_classified_and_leave_the_cited_path(message: str) -> None:
    assert is_workflow_howto_request(message)
    assert _chat_needs_cited_evidence(message, has_sources=True) is False
    assert _chat_needs_cited_evidence(message, has_sources=False) is False


@pytest.mark.parametrize("message", CITED)
def test_science_and_mixed_messages_are_never_swallowed(message: str) -> None:
    assert not is_workflow_howto_request(message)
    assert _chat_needs_cited_evidence(message, has_sources=True) is True


@pytest.mark.parametrize(("message", "cited", "workflow"), OTHER_ROUTING)
def test_small_talk_definitions_and_inspection_keep_their_routing(message, cited, workflow) -> None:
    assert is_workflow_howto_request(message) is workflow
    assert _chat_needs_cited_evidence(message, has_sources=True) is cited or message.startswith(
        ("hey", "what model", "what is a")
    )


def test_selected_record_questions_still_use_stored_records_not_documents() -> None:
    q = "For the selected claim, what is its exact value, unit, source and review state?"
    assert _chat_needs_cited_evidence(q, has_sources=True, grounded=True) is False
    assert not is_workflow_howto_request(q)


def test_app_guide_lists_only_supported_formats_and_real_sections() -> None:
    enum_formats = {f.value for f in StructureSourceFormat} - {"EXTERNAL_CALCULATION_OUTPUT"}
    assert set(app_guide.APP_GUIDE_IMPORT_FORMATS) == enum_formats
    for fmt in ("SDF", "MOL", "XYZ", "CIF"):
        assert fmt in APP_GUIDE_FACTS
    for unsupported in ("PDB", "SMILES file", "mol2", "MOL2", "POSCAR", "Gaussian input", "drag and drop"):
        assert unsupported not in APP_GUIDE_FACTS
    for place in ("Draw molecule", "Import structure file", "Files & Data", "Calculation setup", "Jobs", "Results",
                  "Compare", "Claims", "Paper vs ChemDFT", "Settings", "Guided", "Advanced Workbench",
                  "Plan this as a calculation"):
        assert place in APP_GUIDE_FACTS
    assert not re.search(r"\d+\.\d+", APP_GUIDE_FACTS.replace(app_guide.APP_GUIDE_VERSION, ""))


@pytest.fixture
def chat_gateway(monkeypatch):
    requests = []

    def generate(self, request):
        requests.append(request)
        return ModelResponse(
            content="Use Draw molecule or Import structure file in the Workspace.",
            usage=ModelUsage(input_tokens=50, output_tokens=10, latency_ms=1),
        )

    monkeypatch.setattr(FakeModelGateway, "generate", generate)
    return requests


def _add_document(sessions, settings, project_id: str) -> None:
    with sessions() as session:
        session.add(
            ScientificDocumentRecord(
                id=str(uuid4()), project_id=project_id, raw_artifact_id=str(uuid4()), sha256="a" * 64,
                media_type="application/pdf", title="Some paper", doi=None, authors_json=[], journal=None,
                publication_year=None, language="en", page_count=4, document_type="SCIENTIFIC_ARTICLE",
                parser_identifier="fixture", parser_version="1", text_json=[], diagnostics_json=[],
                created_by=settings.dev_user_id,
            )
        )
        session.commit()


def _ask(client, project_id: str, content: str) -> dict:
    conversation = client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()["conversation"]["id"]
    response = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conversation}/messages",
        json={"content": content, "mode": "CHAT"},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("with_documents", [False, True])
def test_exact_owner_message_gets_an_ai_reply_with_the_app_guide(api, chat_gateway, with_documents) -> None:
    client, sessions, settings = api
    project = _create_project(client, "Workflow chat")
    if with_documents:
        _add_document(sessions, settings, project["id"])

    body = _ask(client, project["id"], "i want to import molecule")

    reply = body["messages"][-1]
    assert body["latest_run"]["status"] == "SUCCEEDED"
    assert reply["evidence_status"] is None and reply["citations"] == []
    assert reply["evidence_note"] == CHAT_REPLY_NOTE
    assert "Insufficient project evidence" not in reply["content"]
    request = chat_gateway[-1]
    assert request.tools == ()
    assert "[APP GUIDE" in request.system_prompt and "Import structure file" in request.system_prompt
    assert not re.search(r"\[\[E\d+\]\]", reply["content"])
    assert not re.search(r"\d+\.\d+", reply["content"])


def test_mixed_message_with_documents_keeps_the_cited_path(api, chat_gateway) -> None:
    client, sessions, settings = api
    project = _create_project(client, "Mixed chat")
    _add_document(sessions, settings, project["id"])

    body = _ask(client, project["id"], "what does the paper say about HNO3 and how do I import it")

    assert not chat_gateway or "[APP GUIDE" not in chat_gateway[-1].system_prompt
    assert body["messages"][-1]["evidence_note"] != CHAT_REPLY_NOTE or body["messages"][-1]["evidence_status"]
