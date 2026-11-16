from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from chemdft_api.ai.context_builder import AIContextBuilder
from chemdft_api.context import Identity
from chemdft_api.contracts.scientific_claims import ScientificClaim
from chemdft_api.scientific_claim_actions import _relations
from chemdft_api.scientific_models import (
    DocumentSourceAnchorRecord,
    EvidenceCandidateRecord,
    ScientificDocumentRecord,
)
from sqlalchemy import func, select


def _claim(
    *,
    claim_id: str,
    authority: str,
    quantity: str,
    value: float,
    unit: str = "nm",
    document_id: str | None = None,
) -> ScientificClaim:
    return ScientificClaim(
        id=uuid4(),
        project_id=uuid4(),
        claim_type="PARTICLE_SIZE",
        subject="DLS",
        predicate=claim_id,
        value=value,
        unit=unit,
        quantity_key=quantity,
        source_authority=authority,
        source_record_type="evidence_candidate",
        source_record_id=uuid4(),
        source_document_id=UUID(document_id) if document_id else None,
        review_state="DETECTED",
        source_label="fixture",
    )


def test_project_claim_endpoint_projects_text_with_original_authority_and_source(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "Claims", "slug": "claims"}).json()
    document_id = str(uuid4())
    anchor_id = str(uuid4())
    evidence_id = str(uuid4())
    with sessions() as session:
        session.add(
            ScientificDocumentRecord(
                id=document_id,
                project_id=project["id"],
                raw_artifact_id=str(uuid4()),
                sha256="a" * 64,
                media_type="application/pdf",
                title="Claim source",
                doi=None,
                authors_json=[],
                journal=None,
                publication_year=None,
                language="en",
                page_count=4,
                document_type="SCIENTIFIC_ARTICLE",
                parser_identifier="fixture",
                parser_version="1",
                text_json=[],
                diagnostics_json=[],
                created_by=settings.dev_user_id,
            )
        )
        session.add(
            DocumentSourceAnchorRecord(
                id=anchor_id,
                project_id=project["id"],
                document_id=document_id,
                page_number=4,
                source_type="TEXT",
                x=None,
                y=None,
                width=None,
                height=None,
                caption=None,
                figure_number=None,
                table_number=None,
                snippet="Ar and H2 in a ratio of 2:1 for 4\u20138 h at 400\u2013800°C",
            )
        )
        session.add(
            EvidenceCandidateRecord(
                id=evidence_id,
                project_id=project["id"],
                document_id=document_id,
                evidence_type="DOCUMENT_TEXT",
                source_class="EXTRACTED",
                payload_json={
                    "text": "Ar and H2 in a ratio of 2:1 for 4\u20138 h at 400\u2013800°C"
                },
                anchor_id=anchor_id,
                extraction_method="fixture",
                extractor_version="1",
                diagnostics_json=[],
                review_state="DETECTED",
            )
        )
        session.commit()
        before = session.scalar(
            select(func.count())
            .select_from(EvidenceCandidateRecord)
            .where(EvidenceCandidateRecord.project_id == project["id"])
        )

    response = client.get(f"/v1/projects/{project['id']}/scientific-claims?locale=en")
    assert response.status_code == 200, response.text
    claims = response.json()["claims"]
    assert {claim["predicate"] for claim in claims} >= {
        "argon to hydrogen feed ratio",
        "deposition duration",
        "deposition temperature",
    }
    ratio = next(claim for claim in claims if claim["predicate"] == "argon to hydrogen feed ratio")
    assert ratio["source_authority"] == "EXTRACTED"
    assert ratio["review_state"] == "DETECTED"
    assert ratio["evidence_id"] == evidence_id
    assert ratio["page"] == 4
    assert ratio["source_href"].endswith("page=4")
    with sessions() as session:
        context = AIContextBuilder(
            session,
            Identity(
                user_id=settings.dev_user_id,
                organization_id=settings.dev_organization_id,
            ),
            project["id"],
        ).build_context()
        assert "argon to hydrogen feed ratio" in context.summary_text
        assert context.structured_context["scientific_claim_count"] >= 3
    assert client.post(f"/v1/projects/{project['id']}/scientific-claims").status_code == 405
    with sessions() as session:
        after = session.scalar(
            select(func.count())
            .select_from(EvidenceCandidateRecord)
            .where(EvidenceCandidateRecord.project_id == project["id"])
        )
    assert before == after


def test_claim_projection_requires_project_membership_and_excludes_other_projects(api) -> None:
    client, sessions, _settings = api
    first = client.post("/v1/projects", json={"name": "First", "slug": "first"}).json()
    second = client.post("/v1/projects", json={"name": "Second", "slug": "second"}).json()
    with sessions() as session:
        session.add(
            EvidenceCandidateRecord(
                id=str(uuid4()),
                project_id=first["id"],
                document_id=str(uuid4()),
                evidence_type="REPORTED_CELL_PARAMETER",
                source_class="EXTRACTED",
                payload_json={"parameter": "a", "reported_value": 4.958, "reported_unit": "Å"},
                anchor_id=None,
                extraction_method="fixture",
                extractor_version="1",
                diagnostics_json=[],
                review_state="DETECTED",
            )
        )
        session.commit()
    listed = client.get(f"/v1/projects/{second['id']}/scientific-claims")
    assert listed.status_code == 200
    assert listed.json()["claims"] == []
    first_claims = client.get(f"/v1/projects/{first['id']}/scientific-claims").json()["claims"]
    assert first_claims[0]["semantic_status"] == "SOURCE_UNAVAILABLE"
    assert first_claims[0]["source_href"] is None
    assert client.get(f"/v1/projects/{uuid4()!s}/scientific-claims").status_code == 404


def test_cell_parameter_claim_prefers_semantic_source_and_links_page_passage(api) -> None:
    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "Cell claims", "slug": "cell-claims"}
    ).json()
    document_id = str(uuid4())
    page_text_id, generic_id, structural_id = (str(uuid4()) for _ in range(3))
    page_text = (
        "X-ray analysis determined the crystal cell dimensions: a = b = 4.958 Å, "
        "c = 13.593 Å, α = β = 90°, γ = 120°."  # noqa: RUF001
    )
    with sessions() as session:
        session.add(
            ScientificDocumentRecord(
                id=document_id,
                project_id=project["id"],
                raw_artifact_id=str(uuid4()),
                sha256="b" * 64,
                media_type="application/pdf",
                title="Cell dimensions source",
                doi=None,
                authors_json=[],
                journal=None,
                publication_year=None,
                language="en",
                page_count=2,
                document_type="SCIENTIFIC_ARTICLE",
                parser_identifier="fixture",
                parser_version="1",
                text_json=[{"page": 1, "text": page_text}],
                diagnostics_json=[],
                created_by=settings.dev_user_id,
            )
        )
        anchor_id = str(uuid4())
        session.add(
            DocumentSourceAnchorRecord(
                id=anchor_id,
                project_id=project["id"],
                document_id=document_id,
                page_number=1,
                source_type="TEXT",
                x=None,
                y=None,
                width=None,
                height=None,
                caption=None,
                figure_number=None,
                table_number=None,
                snippet=page_text,
            )
        )
        session.add_all(
            [
                EvidenceCandidateRecord(
                    id=page_text_id,
                    project_id=project["id"],
                    document_id=document_id,
                    evidence_type="DOCUMENT_TEXT",
                    source_class="EXTRACTED",
                    payload_json={"text": page_text},
                    anchor_id=anchor_id,
                    extraction_method="fixture",
                    extractor_version="1",
                    diagnostics_json=[],
                    review_state="DETECTED",
                ),
                EvidenceCandidateRecord(
                    id=generic_id,
                    project_id=project["id"],
                    document_id=document_id,
                    evidence_type="REPORTED_NUMERIC_VALUE",
                    source_class="EXTRACTED",
                    payload_json={
                        "parameter": "a",
                        "reported_value": 4.958,
                        "reported_unit": "Å",
                    },
                    anchor_id=anchor_id,
                    extraction_method="generic-number",
                    extractor_version="1",
                    diagnostics_json=[],
                    review_state="DETECTED",
                ),
                EvidenceCandidateRecord(
                    id=structural_id,
                    project_id=project["id"],
                    document_id=document_id,
                    evidence_type="REPORTED_CELL_PARAMETER",
                    source_class="EXTRACTED",
                    payload_json={
                        "parameter": "a",
                        "reported_value": 4.958,
                        "reported_unit": "Å",
                    },
                    anchor_id=anchor_id,
                    extraction_method="cell-parameter",
                    extractor_version="1",
                    diagnostics_json=[],
                    review_state="DETECTED",
                ),
            ]
        )
        for parameter, value, unit in (
            ("b", 4.958, "Å"),
            ("c", 13.593, "Å"),
            ("alpha", 90, "°"),
            ("beta", 90, "°"),
            ("gamma", 120, "°"),
        ):
            session.add(
                EvidenceCandidateRecord(
                    id=str(uuid4()),
                    project_id=project["id"],
                    document_id=document_id,
                    evidence_type="REPORTED_CELL_PARAMETER",
                    source_class="EXTRACTED",
                    payload_json={
                        "parameter": parameter,
                        "reported_value": value,
                        "reported_unit": unit,
                    },
                    anchor_id=anchor_id,
                    extraction_method="cell-parameter",
                    extractor_version="1",
                    diagnostics_json=[],
                    review_state="DETECTED",
                )
            )
        session.commit()

    response = client.get(f"/v1/projects/{project['id']}/scientific-claims?locale=en")
    assert response.status_code == 200, response.text
    claim = next(
        item for item in response.json()["claims"] if item["quantity_key"] == "crystal.cell.a"
    )
    assert claim["source_record_id"] == structural_id
    assert claim["source_label"] == "Evidence · Reported Cell Parameter"
    assert claim["evidence_id"] == page_text_id
    assert claim["source_document_id"] == document_id
    assert claim["page"] == 1
    assert claim["source_authority"] == "EXTRACTED"
    assert f"selection=documentEvidence:{page_text_id}" in claim["source_href"]
    projected = response.json()["claims"]
    for parameter, value in (
        ("b", 4.958),
        ("c", 13.593),
        ("alpha", 90),
        ("beta", 90),
        ("gamma", 120),
    ):
        cell_claim = next(
            item for item in projected if item["quantity_key"] == f"crystal.cell.{parameter}"
        )
        assert cell_claim["value"] == value
        assert cell_claim["semantic_status"] == "EXPLICIT"
        assert cell_claim["page"] == 1
        assert f"selection=documentEvidence:{page_text_id}" in cell_claim["source_href"]
    with sessions() as session:
        resolved = session.get(EvidenceCandidateRecord, claim["evidence_id"])
    assert "a = b = 4.958 Å" in resolved.payload_json["text"]


def test_cell_parameter_claim_has_no_irrelevant_source_fallback(api) -> None:
    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "Unbound cell", "slug": "unbound-cell"}
    ).json()
    document_id, anchor_id, evidence_id = (str(uuid4()) for _ in range(3))
    with sessions() as session:
        session.add(
            ScientificDocumentRecord(
                id=document_id,
                project_id=project["id"],
                raw_artifact_id=str(uuid4()),
                sha256="c" * 64,
                media_type="application/pdf",
                title="No matching passage",
                doi=None,
                authors_json=[],
                journal=None,
                publication_year=None,
                language="en",
                page_count=2,
                document_type="SCIENTIFIC_ARTICLE",
                parser_identifier="fixture",
                parser_version="1",
                text_json=[],
                diagnostics_json=[],
                created_by=settings.dev_user_id,
            )
        )
        session.add(
            DocumentSourceAnchorRecord(
                id=anchor_id,
                project_id=project["id"],
                document_id=document_id,
                page_number=2,
                source_type="TEXT",
                x=None,
                y=None,
                width=None,
                height=None,
                caption=None,
                figure_number=None,
                table_number=None,
                snippet="Author biographies and references.",
            )
        )
        session.add_all(
            [
                EvidenceCandidateRecord(
                    id=evidence_id,
                    project_id=project["id"],
                    document_id=document_id,
                    evidence_type="REPORTED_CELL_PARAMETER",
                    source_class="EXTRACTED",
                    payload_json={
                        "parameter": "a",
                        "reported_value": 4.958,
                        "reported_unit": "Å",
                    },
                    anchor_id=anchor_id,
                    extraction_method="fixture",
                    extractor_version="1",
                    diagnostics_json=[],
                    review_state="DETECTED",
                ),
                EvidenceCandidateRecord(
                    id=str(uuid4()),
                    project_id=project["id"],
                    document_id=document_id,
                    evidence_type="DOCUMENT_TEXT",
                    source_class="EXTRACTED",
                    payload_json={"text": "Author biographies and references."},
                    anchor_id=anchor_id,
                    extraction_method="fixture",
                    extractor_version="1",
                    diagnostics_json=[],
                    review_state="DETECTED",
                ),
            ]
        )
        session.commit()

    claims = client.get(f"/v1/projects/{project['id']}/scientific-claims").json()["claims"]
    claim = next(item for item in claims if item["quantity_key"] == "crystal.cell.a")
    assert claim["source_record_id"] == evidence_id
    assert claim["semantic_status"] == "SOURCE_UNAVAILABLE"
    assert claim["source_href"] is None


def test_claim_relations_pair_xrd_peaks_and_never_convert_radius_to_diameter() -> None:
    document_id = str(uuid4())
    reported = [
        _claim(
            claim_id=f"reported-{value}",
            authority="EXTRACTED",
            quantity="xrd.two_theta.peak_position",
            value=value,
            unit="degree",
            document_id=document_id,
        )
        for value in (24.482, 33.588)
    ]
    digitized = [
        _claim(
            claim_id=f"digitized-{value}",
            authority="DIGITIZED",
            quantity="xrd.two_theta.peak_position",
            value=value,
            unit="degree",
            document_id=document_id,
        )
        for value in (24.4565, 33.5869)
    ]
    radius = _claim(
        claim_id="radius",
        authority="EXTRACTED",
        quantity="dls.hydrodynamic_radius",
        value=1482.3,
        document_id=document_id,
    )
    diameter_mean = _claim(
        claim_id="mean",
        authority="DIGITIZED",
        quantity="dls.hydrodynamic_diameter.mean",
        value=1496.1,
        document_id=document_id,
    )
    relations = _relations(reported + digitized + [radius, diameter_mean])
    xrd = [relation for relation in relations if relation.relation == "SAME_QUANTITY"]
    assert len(xrd) == 2
    assert xrd[0].numeric_delta == pytest.approx(0.0255)
    semantic = [
        relation for relation in relations if relation.relation == "NOT_DIRECTLY_COMPARABLE"
    ]
    assert any(
        {relation.left_claim_id, relation.right_claim_id} == {radius.id, diameter_mean.id}
        for relation in semantic
    )
    assert all(relation.numeric_delta is None for relation in semantic)


def test_claim_relations_do_not_pair_xrd_claims_across_documents() -> None:
    source = _claim(
        claim_id="source-a",
        authority="EXTRACTED",
        quantity="xrd.two_theta.peak_position",
        value=24.482,
        unit="degree",
        document_id=str(uuid4()),
    )
    digitized = _claim(
        claim_id="digitized-b",
        authority="DIGITIZED",
        quantity="xrd.two_theta.peak_position",
        value=24.4565,
        unit="degree",
        document_id=str(uuid4()),
    )

    assert _relations([source, digitized]) == []


def _seed_text(api, text: str):
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "Lit", "slug": "lit"}).json()
    document_id, anchor_id = str(uuid4()), str(uuid4())
    with sessions() as session:
        session.add(ScientificDocumentRecord(
            id=document_id, project_id=project["id"], raw_artifact_id=str(uuid4()), sha256="b" * 64,
            media_type="application/pdf", title="Src", doi=None, authors_json=[], journal=None,
            publication_year=None, language="en", page_count=7, document_type="SCIENTIFIC_ARTICLE",
            parser_identifier="fixture", parser_version="1", text_json=[], diagnostics_json=[],
            created_by=settings.dev_user_id))
        session.add(DocumentSourceAnchorRecord(
            id=anchor_id, project_id=project["id"], document_id=document_id, page_number=7,
            source_type="TEXT", x=None, y=None, width=None, height=None, caption=None,
            figure_number=None, table_number=None, snippet=text[:80]))
        session.add(EvidenceCandidateRecord(
            id=str(uuid4()), project_id=project["id"], document_id=document_id,
            evidence_type="DOCUMENT_TEXT", source_class="EXTRACTED", payload_json={"text": text},
            anchor_id=anchor_id, extraction_method="fixture", extractor_version="1",
            diagnostics_json=[], review_state="DETECTED"))
        session.commit()
    response = client.get(f"/v1/projects/{project['id']}/scientific-claims?locale=en")
    assert response.status_code == 200, response.text
    return response.json()["claims"]


def test_non_cvd_temperature_is_not_labelled_deposition(api) -> None:
    claims = _seed_text(api, "Reactions in the ionic liquid proceed at relatively mild temperatures (70-100 oC).")
    predicates = {claim["predicate"] for claim in claims}
    assert "deposition temperature" not in predicates
    assert "reaction temperature" in predicates
    assert all(claim.get("quantity_key") != "cvd.temperature" for claim in claims)


def test_relative_energy_statements_are_extracted_with_page_and_quote(api) -> None:
    claims = _seed_text(
        api,
        "Complex b lies 10.2 kcal mol-1 higher than that of the most stable complex a. "
        "The proton-transfer form is 7.7 kcal/mol lower than the constrained one.",
    )
    energy = [claim for claim in claims if claim["unit"] == "kcal/mol"]
    assert sorted(claim["value"] for claim in energy) == [-7.7, 10.2]
    assert all(claim["page"] == 7 and "paper reports" in claim["qualifier"] for claim in energy)
    assert any("10.2 kcal mol-1 higher than" in claim["qualifier"] for claim in energy)


def test_running_header_is_not_a_document_title() -> None:
    from chemdft_api.phase7_actions import _valid_article_title

    assert not _valid_article_title("ISSN: print - 1726-4685; online - 2519-2876 375 UDC 547.781.1")
    assert _valid_article_title("Lophine-nitric acid complexes in an ionic liquid")


def test_manual_paper_claim_is_user_entered_with_page_and_quote(api) -> None:
    client, sessions, settings = api
    claims = _seed_text(api, "Nothing numeric here.")
    with sessions() as session:
        document = session.scalars(select(ScientificDocumentRecord)).first()
        document_id, project = document.id, {"id": document.project_id}
    response = client.post(
        f"/v1/projects/{project['id']}/scientific-claims/manual",
        json={"document_id": document_id, "page": 7, "quantity": "relative energy b-a", "value": 10.2,
              "unit": "kcal/mol", "quote": "10.2 kcal mol-1 higher than that of the most stable", "system": "complex b"},
    )
    assert response.status_code == 201, response.text
    claims = client.get(f"/v1/projects/{project['id']}/scientific-claims?locale=en").json()["claims"]
    entered = [c for c in claims if c["source_authority"] == "USER_ENTERED"]
    assert len(entered) == 1 and entered[0]["value"] == 10.2 and entered[0]["page"] == 7
    assert "CALCULATED" not in entered[0]["source_authority"]
    missing = client.post(
        f"/v1/projects/{project['id']}/scientific-claims/manual",
        json={"document_id": str(uuid4()), "page": 1, "quantity": "x", "value": 1, "unit": "", "quote": "abc", "system": "s"},
    )
    assert missing.status_code in {404, 422}


def test_comparison_refuses_to_pair_a_paper_energy_with_chemdft_results(api) -> None:
    client, sessions, settings = api
    _seed_text(api, "Complex b lies 10.2 kcal mol-1 higher than that of the most stable complex a.")
    with sessions() as session:
        project_id = session.scalars(select(ScientificDocumentRecord)).first().project_id
    rows = client.get(f"/v1/projects/{project_id}/scientific-comparison?locale=en").json()["rows"]
    energy = [r for r in rows if r.get("quantity_key") == "literature.relative_energy"]
    assert energy and energy[0]["relation"] == "UNRESOLVED"
    assert "not the same quantity" in energy[0]["unresolved_reason"] or "Not compared" in energy[0]["unresolved_reason"]
    assert not energy[0]["project_claims"]


def test_the_papers_three_energy_statements_are_all_extracted(api) -> None:
    claims = _seed_text(
        api,
        "Enforcing proton transfer via bond constraints increased the total energy by 7.7 kcal mol-1 "
        "relative to the global minimum (Fig. 3a), demonstrating that full proton transfer is unfavorable. "
        "Optimization of this structure resulted in a local minimum (Fig. 3b) with an energy 10.2 kcal mol-1 "
        "higher than that of the most stable configuration. The constraint resulted in a substantial "
        "destabilization of 35.8 kcal mol-1 relative to Fig. 3a, rendering this mode highly unfavorable.",
    )
    values = sorted(c["value"] for c in claims if c["unit"] == "kcal/mol")
    assert values == [7.7, 10.2, 35.8]
    assert all(c["source_authority"] == "EXTRACTED" and "paper reports" in c["qualifier"] for c in claims if c["unit"] == "kcal/mol")
