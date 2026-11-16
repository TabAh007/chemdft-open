import json
from io import BytesIO

from chemdft_api.ai.context_builder import AIContextBuilder
from chemdft_api.ai_models import AIMessageRecord, AIRunStepRecord
from chemdft_api.context import Identity
from chemdft_api.contracts.phase7 import DocumentSourceType
from chemdft_api.contracts.provenance import ProvenanceClass
from chemdft_api.knowledge_models import KnowledgeChunkRecord
from chemdft_api.models import StoredFile
from chemdft_api.phase7_actions import _figure_evidence_type, _metadata, _reported_values
from chemdft_api.scientific_models import (
    CalculationResultRecord,
    DocumentSourceAnchorRecord,
    EvidenceCandidateRecord,
    ScientificArtifactRecord,
    ScientificDocumentRecord,
)
from pypdf import PdfWriter
from sqlalchemy import func, select


def test_russian_crystal_structure_caption_is_classified_for_candidate_review() -> None:
    assert (
        _figure_evidence_type("Структура сформировавшегося Cr(III)Cat")
        == "STRUCTURE_FIGURE_CANDIDATE"
    )


def _drain_worker(sessions, settings) -> None:
    from chemdft_api.context import Identity
    from chemdft_api.knowledge_worker import claim_next_job, process_claimed_job

    identity = Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id)
    with sessions() as session:
        while (claimed := claim_next_job(session, "test-worker")) is not None:
            process_claimed_job(session, identity, claimed[0], claimed[2])


def _pdf() -> bytes:
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=400)
    writer.add_metadata({"/Title": "Chromium CVD report"})
    writer.write(output)
    return output.getvalue()


def _pdf_with_text(text: str) -> bytes:
    encoded = text.encode("latin-1", errors="replace")
    stream_content = b"BT\n/F1 12 Tf\n72 712 Td\n(" + encoded + b") Tj\nET"
    length = len(stream_content)
    page_obj = (
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
    )
    pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        + page_obj
        + b"4 0 obj << /Length "
        + str(length).encode()
        + b" >>\nstream\n"
        + stream_content
        + b"\nendstream\nendobj\n"
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        b"xref\n0 6\n0000000000 65535 f \n"
        b"0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n"
        b"trailer << /Size 6 /Root 1 0 R >>\nstartxref\n400\n%%EOF\n"
    )
    return pdf


def test_pdf_import_creates_project_scoped_document_without_storage_leak(api) -> None:
    client, _sessions, _settings = api
    project = client.post("/v1/projects", json={"name": "Paper", "slug": "paper"}).json()
    response = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("paper.pdf", _pdf(), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["document"]["title"] == "Chromium CVD report"
    assert "storage_key" not in response.text
    listed = client.get(f"/v1/projects/{project['id']}/documents")
    assert listed.status_code == 200
    assert listed.json()["documents"][0]["id"] == body["document"]["id"]
    source = client.get(f"/v1/projects/{project['id']}/documents/{body['document']['id']}/source")
    assert source.status_code == 200
    assert source.headers["content-type"].startswith("application/pdf")
    assert source.content.startswith(b"%PDF-")
    assert "storage_key" not in source.text


def test_title_extraction_rejects_classification_and_uses_article_title() -> None:
    parsed = {"metadata": {"title": "УДК 316"}}
    pages = [
        {
            "page": 1,
            "text": "Journal header\nНаучная статья\nУДК 544.478\n"  # noqa: RUF001
            "doi: 10.1234/example\n\nSynthesis of chromium compound by CVD\n"
            "and its study by physical methods\nA. Example Author",
        }
    ]

    assert _metadata(parsed, pages)["title"] == (
        "Synthesis of chromium compound by CVD and its study by physical methods"
    )


def test_reported_xrd_numbers_support_parentheses_and_decimal_comma() -> None:
    evidence = _reported_values(
        "X-ray diffraction peaks: 24,482(2θ), 33,588 (2theta), 36.191 (2θ), 54.865(2θ)."
    )
    positions = [item["reported_value"] for item in evidence if item.get("quantity") == "2theta"]

    assert positions == [24.482, 33.588, 36.191, 54.865]


def test_imported_xrd_numeric_evidence_is_searchable_and_source_bound(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "XRD paper", "slug": "xrd-paper"}).json()
    pdf = _pdf_with_text(
        "Scientific article\nDOI: 10.1234/example\n\nX-ray diffraction results\n"
        "Main peaks: 24.482 (2theta), 33.588 (2theta), 36.191 (2theta), 54.865 (2theta).\n"
        "Unit-cell dimensions: a = b = 4.958 angstrom, c = 13.593 angstrom, "
        "alpha = beta = 90 degrees, gamma = 120 degrees."
    )
    imported = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("synthetic-xrd.pdf", pdf, "application/pdf")},
    )
    assert imported.status_code == 201, imported.text
    _drain_worker(sessions, settings)

    queries = (
        ("XRD peaks", "24.482"),
        ("24.482", "24.482"),
        ("33.588", "33.588"),
        ("2theta", "peak"),
        ("lattice parameters", "4.958"),
    )
    for query, expected in queries:
        response = client.post(
            f"/v1/projects/{project['id']}/knowledge/search",
            json={"query": query, "limit": 10},
        )
        assert response.status_code == 200, response.text
        assert any(expected in result["content"] for result in response.json()["results"])
        result = next(item for item in response.json()["results"] if expected in item["content"])
        assert result["source_class"] == "EXTRACTED"
        assert result["document_id"] == imported.json()["document"]["id"]
        assert result["page_number"] == 1
        assert result["source_anchor_id"]

    conversation = client.post(
        f"/v1/projects/{project['id']}/ai/conversations",
        json={"title": "XRD evidence question"},
    ).json()
    answer = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/"
        f"{conversation['conversation']['id']}/messages",
        json={"content": "What XRD peaks does the paper report?"},
    )
    assert answer.status_code == 201, answer.text
    run_id = answer.json()["latest_run"]["id"]
    with sessions() as session:
        search_step = session.scalars(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run_id,
                AIRunStepRecord.tool_name == "knowledge.search",
                AIRunStepRecord.status == "SUCCEEDED",
            )
        ).one()
        assert "XRD peaks" in search_step.tool_input_json["query"]
        assert "24.482" in str(search_step.tool_output_json)
        assert search_step.tool_output_json["results"][0]["page_number"] == 1

    with sessions() as session:
        evidence_chunks = session.scalars(
            select(KnowledgeChunkRecord).where(
                KnowledgeChunkRecord.content.like("%Reported X-ray diffraction peak position%")
            )
        ).all()
        assert evidence_chunks
        assert all("{'parameter':" not in chunk.content for chunk in evidence_chunks)

    conversation = client.post(
        f"/v1/projects/{project['id']}/ai/conversations",
        json={"title": "XRD evidence"},
    ).json()["conversation"]
    answer = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conversation['id']}/messages",
        json={"content": "What are the main XRD peaks reported in the paper?"},
    )
    assert answer.status_code == 201, answer.text
    assistant = answer.json()["messages"][-1]
    for value in ("24.482", "33.588", "36.191", "54.865"):
        assert value in assistant["content"]
    assert "EXTRACTED" in assistant["content"]
    assert "{'" not in assistant["content"]
    assert assistant["citations"]
    assert assistant["citations"][0]["page_number"] == 1
    assert assistant["citations"][0]["source_anchor_id"]


def test_experimental_csv_import_is_raw_and_finite(api) -> None:
    client, _sessions, _settings = api
    project = client.post("/v1/projects", json={"name": "Data", "slug": "data"}).json()
    response = client.post(
        f"/v1/projects/{project['id']}/experimental/imports",
        data={
            "modality": "XRD",
            "x_column": "x",
            "y_columns": "y",
            "x_label": "2theta",
            "x_unit": "degree",
            "y_label": "Intensity",
            "y_unit": "count",
            "experiment_name": "Imported XRD",
        },
        files={"upload": ("xrd.csv", b"x,y\n10,2\n11,3\n", "text/csv")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source_class"] == "EXPERIMENTAL"
    assert body["state"] == "RAW"
    assert body["point_count"] == 2
    assert "storage_key" not in response.text


def test_pdf_evidence_review_does_not_change_source_class(api) -> None:
    client, _sessions, _settings = api
    project = client.post("/v1/projects", json={"name": "Review", "slug": "review"}).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("paper.pdf", _pdf(), "application/pdf")},
    ).json()
    candidate = imported["candidates"][0] if imported["candidates"] else None
    if candidate is None:
        return
    reviewed = client.post(
        f"/v1/projects/{project['id']}/evidence/{candidate['id']}/review",
        json={"decision": "ACCEPTED"},
    )
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["source_class"] == "EXTRACTED"
    assert reviewed.json()["candidate"]["review_state"] == "ACCEPTED"


def test_unified_import_routes_pdf_and_csv_by_content_family(api) -> None:
    client, _sessions, _settings = api
    project = client.post("/v1/projects", json={"name": "Unified", "slug": "unified"}).json()
    pdf = client.post(
        f"/v1/projects/{project['id']}/imports",
        files={"upload": ("paper.pdf", _pdf(), "application/pdf")},
    )
    assert pdf.status_code == 201, pdf.text
    assert pdf.json()["family"] == "DOCUMENT"
    csv = client.post(
        f"/v1/projects/{project['id']}/imports",
        files={"upload": ("series.csv", b"x,y\n1,2\n", "text/csv")},
    )
    assert csv.status_code == 201, csv.text
    assert csv.json()["family"] == "EXPERIMENTAL_DATA"


def test_digitized_dataset_preserves_source_anchor_and_is_not_raw_experimental(api) -> None:
    client, sessions, _settings = api
    project = client.post("/v1/projects", json={"name": "Digitizer", "slug": "digitizer"}).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("paper.pdf", _pdf(), "application/pdf")},
    ).json()
    with sessions() as session:
        anchor = DocumentSourceAnchorRecord(
            project_id=project["id"],
            document_id=imported["document"]["id"],
            page_number=1,
            source_type=DocumentSourceType.FIGURE.value,
            x=0.1,
            y=0.2,
            width=0.3,
            height=0.4,
            figure_number="1",
            snippet="Figure 1. Thermal analysis.",
        )
        session.add(anchor)
        session.flush()
        candidate = EvidenceCandidateRecord(
            project_id=project["id"],
            document_id=imported["document"]["id"],
            evidence_type="TG_DTG_DTA_FIGURE",
            source_class=ProvenanceClass.EXTRACTED.value,
            payload_json={"caption": "Thermal analysis"},
            anchor_id=anchor.id,
            extraction_method="test-fixture",
            extractor_version="test",
            diagnostics_json=[],
        )
        session.add(candidate)
        session.commit()
        candidate_id = candidate.id
    response = client.post(
        f"/v1/projects/{project['id']}/evidence/{candidate_id}/digitized-datasets",
        json={
            "modality": "TG_DTA",
            "experiment_name": "Digitized thermal curve",
            "calibration": {
                "page": 1,
                "figure_region": {
                    "document_id": imported["document"]["id"],
                    "page_number": 1,
                    "source_type": "FIGURE",
                    "x": 0.1,
                    "y": 0.2,
                    "width": 0.3,
                    "height": 0.4,
                },
                "plot_bounds": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                "x_pixel_a": {"x": 0, "y": 100},
                "x_pixel_b": {"x": 100, "y": 100},
                "x_value_a": 0,
                "x_value_b": 100,
                "y_pixel_a": {"x": 0, "y": 100},
                "y_pixel_b": {"x": 0, "y": 0},
                "y_value_a": 0,
                "y_value_b": 500,
                "x_scale": "linear",
                "y_scale": "linear",
                "x_unit": "degC",
                "y_unit": "pct",
                "x_label": "Temperature",
                "y_label": "Mass",
            },
            "points": [{"x": 10, "y": 90}, {"x": 20, "y": 80}],
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source_class"] == "DIGITIZED"
    assert body["state"] == "DERIVED"
    assert body["modality"] == "TG_DTA"
    assert body["point_count"] == 2
    assert "storage_key" not in response.text


def test_xrd_digitization_commits_source_pixels_and_new_immutable_revision(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "Figure 3", "slug": "figure-3-xrd"}).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("paper.pdf", _pdf(), "application/pdf")},
    ).json()
    document = imported["document"]
    with sessions() as session:
        anchor = DocumentSourceAnchorRecord(
            project_id=project["id"],
            document_id=document["id"],
            page_number=6,
            source_type="FIGURE",
            x=0,
            y=0,
            width=1,
            height=1,
            figure_number="3",
            caption="X-Ray образца Cr(III)Cat",
        )
        session.add(anchor)
        session.flush()
        candidate = EvidenceCandidateRecord(
            project_id=project["id"],
            document_id=document["id"],
            evidence_type="FIGURE",
            source_class="EXTRACTED",
            payload_json={"caption": anchor.caption},
            anchor_id=anchor.id,
            extraction_method="fixture",
            extractor_version="fixture",
            diagnostics_json=[],
        )
        session.add(candidate)
        report_anchor = DocumentSourceAnchorRecord(
            project_id=project["id"],
            document_id=document["id"],
            page_number=6,
            source_type="TEXT",
            x=None,
            y=None,
            width=None,
            height=None,
            figure_number=None,
            caption=None,
            snippet="The paper reports 24.482 degrees.",
        )
        session.add(report_anchor)
        session.flush()
        reported = EvidenceCandidateRecord(
            project_id=project["id"],
            document_id=document["id"],
            evidence_type="REPORTED_NUMERIC_VALUE",
            source_class="EXTRACTED",
            payload_json={
                "quantity": "2theta",
                "reported_value": 24.482,
                "reported_unit": "degree",
            },
            anchor_id=report_anchor.id,
            extraction_method="fixture",
            extractor_version="fixture",
            diagnostics_json=[],
        )
        session.add(reported)
        session.commit()
        candidate_id, reported_id = candidate.id, reported.id

    payload = {
        "experiment_name": "Figure 3 XRD · DIGITIZED",
        "source_document_sha256": document["sha256"],
        "source_render_sha256": "a" * 64,
        "source_render_version": "pdfjs-test",
        "source_render_scale": 1.25,
        "source_pixel_width": 1000,
        "source_pixel_height": 1200,
        "plot_region": {"x": 100, "y": 200, "width": 700, "height": 600},
        "x_calibration": {
            "pixel_a": {"x": 200, "y": 700},
            "pixel_b": {"x": 700, "y": 700},
            "value_a": 20,
            "value_b": 60,
            "label": "2θ",
            "unit": "degree",
            "scale": "linear",
        },
        "y_unit_status": "UNKNOWN",
        "point_mode": "PEAK_PICKING",
        "points": [{"source_pixel": {"x": 300, "y": 500}}, {"source_pixel": {"x": 500, "y": 450}}],
    }
    first = client.post(
        f"/v1/projects/{project['id']}/evidence/{candidate_id}/xrd-digitizations", json=payload
    )
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["source_class"] == "DIGITIZED"
    assert body["state"] == "DERIVED"
    assert body["modality"] == "XRD"
    assert body["values"] == [{"2theta_degree": 28.0}, {"2theta_degree": 44.0}]
    assert body["values"][0].get("intensity") is None
    session_data = body["digitization_session"]
    assert session_data["source_artifact_sha256"] == document["sha256"]
    assert session_data["plot_region"] == payload["plot_region"]
    assert session_data["points"][0]["source_pixel"] == {"x": 300, "y": 500}
    assert session_data["reported_peaks"][0]["evidence_id"] == reported_id
    assert session_data["reported_peaks"][0]["source_class"] == "EXTRACTED"
    second = client.post(
        f"/v1/projects/{project['id']}/evidence/{candidate_id}/xrd-digitizations", json=payload
    )
    assert second.status_code == 201, second.text
    assert second.json()["digitization_session"]["revision"] == 2
    assert second.json()["digitization_session"]["parent_dataset_id"] == body["id"]
    listed = client.get(f"/v1/projects/{project['id']}/experimental/datasets")
    assert [row["id"] for row in listed.json()["datasets"]] == [second.json()["id"], body["id"]]
    with sessions() as session:
        context = AIContextBuilder(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            project["id"],
        ).build_context()
    assert f"[P {body['id']}]" in context.summary_text
    assert "DIGITIZED XRD dataset reconstructed manually from Figure 3" in context.summary_text
    assert "28.0000° 2θ, intensity absent" in context.summary_text
    assert f"[E {reported_id}]" in context.summary_text
    assert "not instrument data or experimental raw data" in context.summary_text
    project_context = context.structured_context["project_context"]
    assert (
        project_context.datasets[0]["digitization_session"]["points"][0]["two_theta_degree"] == 28.0
    )

    _drain_worker(sessions, settings)
    searched = client.post(
        f"/v1/projects/{project['id']}/knowledge/search",
        json={"query": "Figure 3 XRD DIGITIZED dataset stored points provenance", "limit": 8},
    )
    assert searched.status_code == 200, searched.text
    digitized_result = next(
        result for result in searched.json()["results"] if result["source_class"] == "DIGITIZED"
    )
    assert "28.0000° 2θ / intensity absent" in digitized_result["content"]
    assert "not raw instrument data" in digitized_result["content"]

    conversation = client.post(
        f"/v1/projects/{project['id']}/ai/conversations", json={"title": "Digitized XRD"}
    ).json()["conversation"]
    answer = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conversation['id']}/messages",
        json={
            "content": (
                "Explain the committed Figure 3 XRD dataset and provenance. Is it raw data? "
                "Give the stored point and distinguish it from the paper's reported peak."
            ),
            "mode": "EVIDENCE",
        },
    )
    assert answer.status_code == 201, answer.text
    assistant = answer.json()["messages"][-1]
    assert assistant["evidence_status"] in {"SUPPORTED", "PARTIAL"}
    assert "DIGITIZED, manually reconstructed" in assistant["content"]
    assert "28.0000° 2θ / intensity absent" in assistant["content"]
    assert "not raw instrument data" in assistant["content"]
    assert "24.482" in assistant["content"]
    dataset_evidence = next(
        evidence for evidence in assistant["evidence"] if evidence["source_class"] == "DIGITIZED"
    )
    assert dataset_evidence["citation_id"].startswith("P")
    assert any(
        evidence["source_class"] == "EXTRACTED" and evidence["citation_id"].startswith("E")
        for evidence in assistant["evidence"]
    )


def test_xrd_digitization_rejects_wrong_source_hash_and_points_outside_user_region(api) -> None:
    client, sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "Figure 3 invalid", "slug": "figure-3-invalid"}
    ).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("paper.pdf", _pdf(), "application/pdf")},
    ).json()
    document = imported["document"]
    with sessions() as session:
        anchor = DocumentSourceAnchorRecord(
            project_id=project["id"],
            document_id=document["id"],
            page_number=6,
            source_type="FIGURE",
            x=0,
            y=0,
            width=1,
            height=1,
            figure_number="3",
            caption="X-Ray pattern",
        )
        session.add(anchor)
        session.flush()
        candidate = EvidenceCandidateRecord(
            project_id=project["id"],
            document_id=document["id"],
            evidence_type="FIGURE",
            source_class="EXTRACTED",
            payload_json={},
            anchor_id=anchor.id,
            extraction_method="fixture",
            extractor_version="fixture",
            diagnostics_json=[],
        )
        session.add(candidate)
        session.commit()
        candidate_id = candidate.id
    payload = {
        "experiment_name": "Invalid XRD draft",
        "source_document_sha256": "b" * 64,
        "source_render_sha256": "a" * 64,
        "source_render_version": "pdfjs-test",
        "source_render_scale": 1,
        "source_pixel_width": 1000,
        "source_pixel_height": 1200,
        "plot_region": {"x": 100, "y": 200, "width": 700, "height": 600},
        "x_calibration": {
            "pixel_a": {"x": 200, "y": 700},
            "pixel_b": {"x": 700, "y": 700},
            "value_a": 20,
            "value_b": 60,
            "label": "2theta",
            "unit": "degree",
        },
        "point_mode": "PEAK_PICKING",
        "points": [{"source_pixel": {"x": 300, "y": 500}}],
    }
    wrong_hash = client.post(
        f"/v1/projects/{project['id']}/evidence/{candidate_id}/xrd-digitizations", json=payload
    )
    assert wrong_hash.status_code == 403
    payload["source_document_sha256"] = document["sha256"]
    payload["points"] = [{"source_pixel": {"x": 900, "y": 500}}]
    outside = client.post(
        f"/v1/projects/{project['id']}/evidence/{candidate_id}/xrd-digitizations", json=payload
    )
    assert outside.status_code == 422


def test_duplicate_pdf_reimport_creates_no_orphan_scientific_artifact_rows(api) -> None:
    """Explicitly verify DB row counts before import, after first import, and after re-import:
    - Exactly 1 ScientificArtifactRecord row for the project
    - Exactly 1 StoredFile row for the project
    - Exactly 1 ScientificDocumentRecord row for the project
    - No orphan ScientificArtifactRecord or StoredFile rows are committed
    - Re-import returns the same existing document without errors or append-only violations."""
    client, sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "ReimportCheck", "slug": "reimport-check"}
    ).json()
    project_id = project["id"]
    pdf_bytes = _pdf()

    def count_rows():
        with sessions() as session:
            artifacts = session.scalar(
                select(func.count(ScientificArtifactRecord.id)).where(
                    ScientificArtifactRecord.project_id == project_id
                )
            )
            files = session.scalar(
                select(func.count(StoredFile.id)).where(StoredFile.project_id == project_id)
            )
            docs = session.scalar(
                select(func.count(ScientificDocumentRecord.id)).where(
                    ScientificDocumentRecord.project_id == project_id
                )
            )
            return artifacts, files, docs

    # Before first import: all 0
    assert count_rows() == (0, 0, 0)

    # First import
    first = client.post(
        f"/v1/projects/{project_id}/documents/imports",
        files={"upload": ("paper.pdf", pdf_bytes, "application/pdf")},
    )
    assert first.status_code == 201, first.text
    first_id = first.json()["document"]["id"]

    # After first import: exactly 1 artifact, 1 stored file, 1 document
    assert count_rows() == (1, 1, 1)

    # Second import of identical bytes must succeed idempotently
    second = client.post(
        f"/v1/projects/{project_id}/documents/imports",
        files={"upload": ("paper.pdf", pdf_bytes, "application/pdf")},
    )
    assert second.status_code == 201, second.text
    assert second.json()["document"]["id"] == first_id
    assert "storage_key" not in second.text

    # After re-import: MUST REMAIN EXACTLY (1, 1, 1) - no orphan duplicate artifact or file
    assert count_rows() == (1, 1, 1)

    # Document list must contain exactly one entry
    listed = client.get(f"/v1/projects/{project_id}/documents")
    assert listed.status_code == 200
    docs = listed.json()["documents"]
    assert len(docs) == 1
    assert docs[0]["id"] == first_id


def test_chained_lattice_parameter_extraction(api) -> None:
    """Verify generic extraction of chained equalities like 'a = b = 4.958 A'
    and 'alpha = beta = 90 deg, gamma = 120 deg' extracts all individual parameters."""
    client, _sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "LatticeChain", "slug": "lattice-chain"}
    ).json()
    project_id = project["id"]
    pdf_bytes = _pdf_with_text(
        "Lattice parameters: a = b = 4.958 A, c = 13.593 A, alpha = beta = 90 deg, gamma = 120 deg."
    )
    imported = client.post(
        f"/v1/projects/{project_id}/documents/imports",
        files={"upload": ("paper.pdf", pdf_bytes, "application/pdf")},
    )
    assert imported.status_code == 201, imported.text
    candidates = imported.json()["candidates"]

    # Check reported numeric values
    numeric_params = {
        c["structured_payload"].get("parameter"): c["structured_payload"].get("reported_value")
        for c in candidates
        if c["evidence_type"] == "REPORTED_NUMERIC_VALUE" and "parameter" in c["structured_payload"]
    }
    assert numeric_params.get("a") == 4.958
    assert numeric_params.get("b") == 4.958
    assert numeric_params.get("c") == 13.593
    assert numeric_params.get("alpha") == 90.0
    assert numeric_params.get("beta") == 90.0
    assert numeric_params.get("gamma") == 120.0

    # Check reported cell parameters
    cell_params = {
        c["structured_payload"].get("parameter"): c["structured_payload"].get("reported_value")
        for c in candidates
        if c["evidence_type"] == "REPORTED_CELL_PARAMETER"
    }
    assert cell_params.get("a") == 4.958
    assert cell_params.get("b") == 4.958
    assert cell_params.get("c") == 13.593


def test_evidence_answer_persists_citations_and_reopens_with_source_passage(api) -> None:
    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "Evidence workspace", "slug": "evidence-workspace"}
    ).json()
    project_id = project["id"]
    imported = client.post(
        f"/v1/projects/{project_id}/documents/imports",
        files={
            "upload": (
                "synthetic-diameter.pdf",
                _pdf_with_text("The synthetic sample reports a 4.2 nm particle diameter."),
                "application/pdf",
            )
        },
    )
    assert imported.status_code == 201, imported.text
    _drain_worker(sessions, settings)
    conversation = client.post(
        f"/v1/projects/{project_id}/ai/conversations", json={"title": "Evidence question"}
    ).json()
    conversation_id = conversation["conversation"]["id"]
    answered = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conversation_id}/messages",
        json={"content": "What particle diameter was reported?", "mode": "EVIDENCE"},
    )
    assert answered.status_code == 201, answered.text
    message = answered.json()["messages"][-1]
    assert message["evidence_status"] == "SUPPORTED"
    assert "4.2 nm" in message["content"]
    assert message["citations"][0]["citation_id"] == "E1"
    assert "[[E1]]" in message["content"]
    assert "4.2 nm" in message["evidence"][0]["passage"]
    assert message["evidence"][0]["page_number"] == 1
    assert message["evidence"][0]["document_id"] == imported.json()["document"]["id"]
    assert message["evidence"][0]["source_class"] == "EXTRACTED"
    assert message["evidence"][0]["verification_state"] == "UNVERIFIED"
    reopened = client.get(f"/v1/projects/{project_id}/ai/conversations/{conversation_id}")
    assert reopened.status_code == 200
    assert reopened.json()["messages"][-1] == message
    with sessions() as session:
        stored = session.get(AIMessageRecord, message["id"])
        assert stored is not None
        assert stored.evidence_refs_json[0]["knowledge_chunk_id"]
        assert "passage" not in stored.evidence_refs_json[0]
        step = session.scalar(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == message["run_id"],
                AIRunStepRecord.tool_name == "knowledge.search",
            )
        )
        assert step is not None
        assert "content" not in str(step.tool_output_json)
        assert (
            session.scalar(
                select(func.count(CalculationResultRecord.id)).where(
                    CalculationResultRecord.project_id == project_id
                )
            )
            == 0
        )
        chunk = session.get(KnowledgeChunkRecord, message["citations"][0]["knowledge_chunk_id"])
        assert chunk is not None
        chunk.content = "Source changed after the answer was saved."
        session.commit()
    stale = client.get(f"/v1/projects/{project_id}/ai/conversations/{conversation_id}")
    assert stale.status_code == 200
    stale_answer = stale.json()["messages"][-1]
    assert stale_answer["evidence_status"] == "INSUFFICIENT_EVIDENCE"
    assert stale_answer["citations"] == []
    assert "4.2 nm" not in stale_answer["content"]


def test_evidence_question_in_empty_project_returns_no_answer(api) -> None:
    client, _sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "Empty evidence", "slug": "empty-evidence"}
    ).json()
    project_id = project["id"]
    conversation_id = client.post(
        f"/v1/projects/{project_id}/ai/conversations", json={"title": "Empty question"}
    ).json()["conversation"]["id"]
    answered = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conversation_id}/messages",
        json={"content": "What was the reported NMR shift?", "mode": "EVIDENCE"},
    )
    assert answered.status_code == 201, answered.text
    message = answered.json()["messages"][-1]
    assert message["evidence_status"] == "INSUFFICIENT_EVIDENCE"
    assert message["citations"] == []
    assert message["evidence"] == []
    assert "NMR shift" not in message["content"]


def test_dls_figure4_digitization_preserves_axes_and_revision_provenance(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "Figure 4", "slug": "figure-4-dls"}).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("paper.pdf", _pdf(), "application/pdf")},
    ).json()
    document = imported["document"]
    with sessions() as session:
        anchor = DocumentSourceAnchorRecord(
            project_id=project["id"],
            document_id=document["id"],
            page_number=7,
            source_type="FIGURE",
            x=None,
            y=None,
            width=None,
            height=None,
            figure_number="4",
            caption="DLS histogram · Diameter (nm) · q (%)",
        )
        session.add(anchor)
        session.flush()
        candidate = EvidenceCandidateRecord(
            project_id=project["id"],
            document_id=document["id"],
            evidence_type="FIGURE",
            source_class="EXTRACTED",
            payload_json={"caption": anchor.caption},
            anchor_id=anchor.id,
            extraction_method="fixture",
            extractor_version="fixture",
            diagnostics_json=[],
        )
        session.add(candidate)
        session.flush()
        candidate_id = candidate.id
        for page_number, evidence_type, payload_text in (
            (
                2,
                "DLS_EVIDENCE",
                (
                    "The distribution of particles of a synthesized Cr(III)Cat sample formed "
                    "in the range of 800-2000 nm, the hydrodynamic radii of 1482.3 nm, was "
                    "studied using the dynamic light scattering (DLS) method."
                ),
            ),
            (
                8,
                "DOCUMENT_TEXT",
                (
                    "Значения параметров спектра ДРС Cr(III)Cat; dH, нм Mean Median Mode "
                    "1496,1 1428,3 1588,2; 1,2263"
                ),
            ),
        ):
            source_anchor = DocumentSourceAnchorRecord(
                project_id=project["id"],
                document_id=document["id"],
                page_number=page_number,
                source_type="TEXT",
                x=None,
                y=None,
                width=None,
                height=None,
                figure_number=None,
                caption=None,
                snippet=payload_text,
            )
            session.add(source_anchor)
            session.flush()
            session.add(
                EvidenceCandidateRecord(
                    project_id=project["id"],
                    document_id=document["id"],
                    evidence_type=evidence_type,
                    source_class="EXTRACTED",
                    payload_json={
                        "reported_text" if evidence_type == "DLS_EVIDENCE" else "text": payload_text
                    },
                    anchor_id=source_anchor.id,
                    extraction_method="fixture",
                    extractor_version="fixture",
                    diagnostics_json=[],
                )
            )
        session.commit()
    payload = {
        "experiment_name": "Figure 4 DLS · DIGITIZED",
        "source_document_sha256": document["sha256"],
        "source_render_sha256": "b" * 64,
        "source_render_version": "pdfjs-test",
        "source_render_scale": 1.25,
        "source_pixel_width": 1000,
        "source_pixel_height": 1200,
        "plot_region": {"x": 100, "y": 200, "width": 700, "height": 600},
        "x_calibration": {
            "pixel_a": {"x": 200, "y": 700},
            "pixel_b": {"x": 700, "y": 700},
            "value_a": 1,
            "value_b": 1000,
            "label": "Diameter",
            "unit": "nm",
            "scale": "log",
        },
        "y_calibration": {
            "pixel_a": {"x": 200, "y": 700},
            "pixel_b": {"x": 200, "y": 300},
            "value_a": 0,
            "value_b": 25,
            "label": "q",
            "unit": "%",
            "scale": "linear",
        },
        "point_mode": "HISTOGRAM_POINTS",
        "points": [
            {"source_pixel": {"x": 366.6666667, "y": 500}},
            {"source_pixel": {"x": 500, "y": 400}},
        ],
    }
    url = f"/v1/projects/{project['id']}/evidence/{candidate_id}/graph-digitizations"
    first = client.post(url, json=payload)
    assert first.status_code == 201, first.text
    body = first.json()
    assert (
        body["source_class"] == "DIGITIZED"
        and body["state"] == "DERIVED"
        and body["modality"] == "DLS"
    )
    assert body["axes"][0]["label"] == "Diameter"
    assert body["axes"][1]["label"] == "q"
    assert body["digitization_session"]["x_calibration"]["scale"] == "log"
    assert round(body["values"][0]["diameter_nm"], 5) == 10
    assert body["values"][0]["q_percent"] == 12.5
    assert body["digitization_session"]["points"][0]["source_pixel"]["x"] == 366.6666667
    assert body["digitization_session"]["page_number"] == 7
    second = client.post(url, json=payload)
    assert second.status_code == 201, second.text
    assert second.json()["digitization_session"]["revision"] == 2
    assert second.json()["digitization_session"]["parent_dataset_id"] == body["id"]
    bad_semantics = {
        **payload,
        "x_calibration": {**payload["x_calibration"], "label": "Hydrodynamic radius"},
    }
    rejected = client.post(url, json=bad_semantics)
    assert rejected.status_code == 422
    bad_hash = {**payload, "source_document_sha256": "c" * 64}
    rejected_hash = client.post(url, json=bad_hash)
    assert rejected_hash.status_code == 403
    rejected_inputs = (
        {**payload, "points": [{"source_pixel": {"x": 900, "y": 500}}]},
        {
            **payload,
            "x_calibration": {**payload["x_calibration"], "value_a": float("nan")},
        },
        {**payload, "x_calibration": {**payload["x_calibration"], "unit": ""}},
        {**payload, "source_class": "EXPERIMENTAL"},
    )
    for rejected_input in rejected_inputs:
        rejected_response = client.post(
            url,
            content=json.dumps(rejected_input, allow_nan=True),
            headers={"Content-Type": "application/json"},
        )
        assert rejected_response.status_code == 422, rejected_response.text

    _drain_worker(sessions, settings)
    conversation = client.post(
        f"/v1/projects/{project['id']}/ai/conversations", json={"title": "DLS evidence"}
    ).json()["conversation"]
    answer = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conversation['id']}/messages",
        json={
            "content": (
                "Explain the Figure 4 DLS digitized distribution and distinguish it from the "
                "paper's extracted hydrodynamic radius and table mean diameter. Is 1482.3 nm "
                "directly comparable to the table mean?"
            ),
            "mode": "EVIDENCE",
        },
    )
    assert answer.status_code == 201, answer.text
    answer_message = answer.json()["messages"][-1]
    assert answer_message["evidence_status"] == "SUPPORTED"
    assert any(citation["citation_id"].startswith("P") for citation in answer_message["citations"])
    assert any(citation["citation_id"].startswith("E") for citation in answer_message["citations"])
    assert "1482.3 nm" in answer_message["content"]
    assert "1496,1" in answer_message["content"]
    assert "Figure 4 DLS dataset is DIGITIZED" in answer_message["content"]
    assert "raw instrument data" in answer_message["content"]
    assert "not directly comparable as labeled" in answer_message["content"]
    dls_citation = next(c for c in answer_message["citations"] if c["citation_type"] == "DATASET")
    assert dls_citation["label"] == "DIGITIZED DLS dataset"
