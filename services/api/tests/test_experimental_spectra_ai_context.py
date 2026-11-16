# ruff: noqa: E501
"""The AI Scientist's experimental-spectra context is rendered deterministically from stored records; no model writes it."""
from __future__ import annotations

import re

import pytest
from chemdft_api import external_import_actions
from chemdft_api.ai.context_builder import AIContextBuilder
from chemdft_api.context import Identity
from chemdft_api.models import Project
from external_import_support import fake_runner
from spectra_support import (
    import_spectrum,
    ir_text,
    peaks,
    report_with_excitations,
    requires_spectra_worker,
    transform,
)

pytestmark = requires_spectra_worker
WATER_PEAKS = ((1595.0, 18.0, 0.9), (3705.0, 30.0, 0.5), (3790.0, 30.0, 0.4))


@pytest.fixture
def project(api):
    client, _, _ = api
    return client.post("/v1/projects", json={"name": "Spectra AI", "slug": "spectra-ai"}).json()["id"]


def build(sessions, project_id):
    with sessions() as session:
        row = session.get(Project, project_id)
        return AIContextBuilder(session, Identity(user_id=row.created_by, organization_id=row.organization_id), row.id).build_context()


def claims_assignment(text: str) -> bool:
    return any(not re.search(r"(?:\bnot|\bno|\bnever)\s+(?:an?\s+|'is'\s+or\s+')?$", text[max(0, m.start() - 24) : m.start()].lower()) for m in re.finditer(r"\bassign(?:ed|ment|ments)?\b", text.lower()))


def test_context_without_spectra_says_so(api, project):
    _, sessions, _ = api
    context = build(sessions, project)
    assert "Experimental spectra (0 raw measurement(s)" in context.summary_text and "No experimental spectra imported yet." in context.summary_text


def test_context_is_grounded_in_dataset_version_peaks_and_comparison(api, project, monkeypatch):
    client, sessions, _ = api
    monkeypatch.setattr(external_import_actions, "run_import_worker", fake_runner(lambda data: report_with_excitations(data, raman=True)))
    upload = client.post(f"/v1/projects/{project}/external-imports", files={"upload": ("water.log", b"synthetic external output placeholder\n" * 20, "text/plain")}, data={"idempotency_key": "import-key-ai-0001"}).json()
    detail = client.post(f"/v1/projects/{project}/external-imports/{upload['id']}/confirm", json={"preview_sha256": upload["preview_sha256"], "idempotency_key": "import-confirm-ai1"}).json()
    source = next(r["id"] for r in detail["results"] if r["result_type"] == "chemdft.imported.vibrations")

    raw = import_spectrum(client, project, ir_text(peaks=WATER_PEAKS), key="ir-ai-key-0001", association={"state": "ASSOCIATED_WITH_SAMPLE", "sample_label": "water vapour"})
    corrected = transform(client, project, raw["id"], "baseline.snip", {"half_window_x": 80}).json()
    found = peaks(client, project, corrected["id"], {"prominence_sigma": 8}).json()
    body = {"experimental_dataset_id": corrected["id"], "peak_set_dataset_id": found["id"], "calculated": {"kind": "IMPORTED_RESULT", "id": source}, "tolerance": 30.0, "idempotency_key": "cmp-ai-key-0001"}
    comparison = client.post(f"/v1/projects/{project}/experimental/spectra/comparisons", json=body).json()

    context = build(sessions, project)
    text = context.summary_text
    assert "Experimental spectra (1 raw measurement(s), 2 derived record(s), 1 comparison(s))" in text
    assert f"Spectrum '{raw['name']}' [P {raw['id']}] · IR/FTIR" in text and "RAW EXPERIMENTAL" in text and "unit written in the file" in text
    assert "never edited" in text and "NEW derived version" in text
    assert "Association: sample 'water vapour'" in text
    assert f"Version [P {corrected['id']}]" in text and "baseline.snip by pybaselines 1.2.1" in text and "half_window_x=80.0" in text
    assert f"Peaks on '{corrected['name']}' [P {found['id']}]" in text and "DERIVED, NOT RAW" in text and "prominence_sigma=8.0" in text
    assert f"[C {comparison['id']}]" in text and "gated_optimal_assignment within ±30.0 cm⁻¹" in text and "unscaled" in text
    assert "CANDIDATE: calculated item 1 at 1600 cm⁻¹" in text
    assert "candidate matches by position, not assignments" in text and "Experimental peaks do not contain displacement vectors" in text
    assert "PHASE_UNKNOWN" in text or "CALCULATION_PHASE_UNKNOWN" in text
    section = text.split("Experimental spectra (")[1].split("Projected Scientific Claims")[0]
    assert not claims_assignment(section)

    refs = {item["entity_id"] for item in context.structured_context["project_context"].datasets and [{"entity_id": d["id"]} for d in context.structured_context["project_context"].datasets]}
    assert {raw["id"], corrected["id"], found["id"]} <= refs
    assert context.structured_context["dataset_count"] == 3
    graph_dataset = next(d for d in context.structured_context["project_context"].datasets if d["id"] == found["id"])
    assert graph_dataset["spectrum"]["authority"] == "DERIVED_NOT_RAW" and graph_dataset["values"] == ()


def test_knowledge_index_describes_spectra_with_their_authority(api, project):
    from chemdft_api.knowledge.service import KnowledgeService

    client, sessions, _ = api
    raw = import_spectrum(client, project, ir_text(peaks=WATER_PEAKS), key="ir-kn-key-0001")
    corrected = transform(client, project, raw["id"], "baseline.snip", {"half_window_x": 80}).json()
    found = peaks(client, project, corrected["id"], {"prominence_sigma": 8}).json()
    with sessions() as session:
        row = session.get(Project, project)
        service = KnowledgeService(session, Identity(user_id=row.created_by, organization_id=row.organization_id))
        chunks = {chunk.source_entity_id: chunk.content for chunk in service._source_chunks(project)}
    assert "raw measured data exactly as supplied, never edited" in chunks[raw["id"]] and "EXPLICIT_UNIT" in chunks[raw["id"]]
    assert "not raw data" in chunks[corrected["id"]] and "baseline.snip by pybaselines 1.2.1" in chunks[corrected["id"]]
    assert "derived, not raw data" in chunks[found["id"]] and "peaks" in chunks[found["id"]]
