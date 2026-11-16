from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import UUID, uuid4

from chemdft_api.context import Identity
from chemdft_api.scientific_models import (
    CalculationInputRecord,
    CandidateRepresentationRecord,
    EvidenceCandidateRecord,
    StructureCandidateRecord,
    StructureCandidateReviewRecord,
    StructureRecord,
    StructureVersionRecord,
)
from chemdft_api.tool_registry.catalog import build_application_tool_registry
from chemdft_api.tool_registry.registry import ToolInvocationContext
from sqlalchemy import func, select


def _project(client, name: str) -> dict[str, str]:
    return client.post(
        "/v1/projects",
        json={"name": name, "slug": f"{name.lower().replace(' ', '-')}-{uuid4().hex[:8]}"},
    ).json()


def _structure_figure_pdf() -> bytes:
    encoded = b"Scientific article. Figure 2. Hypothetical chromium crystal structure."
    stream = b"BT\n/F1 12 Tf\n72 712 Td\n(" + encoded + b") Tj\nET"
    return (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
        b"4 0 obj << /Length "
        + str(len(stream)).encode()
        + b" >>\nstream\n"
        + stream
        + b"\nendstream\nendobj\n"
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        b"xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n"
        b"0000000058 00000 n \n0000000115 00000 n \n"
        b"trailer << /Size 6 /Root 1 0 R >>\nstartxref\n400\n%%EOF\n"
    )


def _import_paper(client, project_id: str, pdf: bytes | None = None):
    return client.post(
        f"/v1/projects/{project_id}/documents/imports",
        files={"upload": ("chromium-paper.pdf", pdf or _structure_figure_pdf(), "application/pdf")},
    )


def _coordinates_payload() -> dict[str, object]:
    return {
        "kind": "MOLECULE",
        "name": "Synthetic water reconstruction",
        "coordinates": {
            "coordinate_system": "CARTESIAN",
            "unit": "angstrom",
            "dimensionality": 3,
            "atom_ordering": "AS_LISTED",
            "atoms": [
                {"index": 0, "atomic_number": 8, "element": "O", "x": 0, "y": 0, "z": 0},
                {"index": 1, "atomic_number": 1, "element": "H", "x": 0.7586, "y": 0, "z": 0.5043},
                {"index": 2, "atomic_number": 1, "element": "H", "x": -0.7586, "y": 0, "z": 0.5043},
            ],
            "bonds": [
                {"atom_index_a": 0, "atom_index_b": 1, "order": 1},
                {"atom_index_a": 0, "atom_index_b": 2, "order": 1},
            ],
        },
        "periodic_cell": None,
        "overall_charge": 0,
        "multiplicity": 1,
    }


def _complete_review_checklist() -> dict[str, bool]:
    return {
        "inspected_source": True,
        "understands_missing_paper_coordinates": True,
        "coordinate_source_declared": True,
        "units_checked": True,
        "cell_checked_if_used": True,
        "validation_warnings_reviewed": True,
        "differences_acknowledged": True,
    }


def test_detected_structure_figure_creates_idempotent_image_only_candidate(api) -> None:
    client, sessions, _settings = api
    project = _project(client, "Structure candidate")
    first = _import_paper(client, project["id"])
    assert first.status_code == 201, first.text
    second = _import_paper(client, project["id"])
    assert second.status_code == 201, second.text

    candidates = client.get(f"/v1/projects/{project['id']}/structure-candidates")
    assert candidates.status_code == 200, candidates.text
    body = candidates.json()["candidates"]
    assert len(body) == 1
    candidate = body[0]
    assert candidate["source_type"] == "REPORTED_FIGURE"
    assert candidate["candidate_state"] == "DETECTED"
    assert candidate["representation_types"] == ["IMAGE_REFERENCE"]
    assert candidate["coordinates_available"] is False
    assert candidate["source_document_id"] == first.json()["document"]["id"]
    assert candidate["source_page"] == 1
    assert candidate["source_anchor"]["figure_number"] == "2"
    assert candidate["method"] == "caption-detector"
    assert candidate["provenance_class"] == "EXTRACTED"
    assert "storage_key" not in candidates.text
    assert "object_key" not in candidates.text
    assert client.get(f"/v1/projects/{project['id']}/structures").json() == []

    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(StructureCandidateRecord)) == 1
        assert session.scalar(select(func.count()).select_from(CandidateRepresentationRecord)) == 1
        assert session.scalar(select(func.count()).select_from(StructureVersionRecord)) == 0


def test_evidence_question_context_accepts_image_only_candidate_and_representation(api) -> None:
    client, sessions, _settings = api
    project = _project(client, "Evidence question candidate context")
    imported = _import_paper(client, project["id"])
    assert imported.status_code == 201, imported.text
    candidates = client.get(f"/v1/projects/{project['id']}/structure-candidates")
    assert candidates.status_code == 200, candidates.text
    assert len(candidates.json()["candidates"]) == 1
    assert candidates.json()["candidates"][0]["coordinates_available"] is False

    from chemdft_api.context import Identity
    from chemdft_api.knowledge_worker import claim_next_job, process_claimed_job

    identity = Identity(
        user_id=_settings.dev_user_id,
        organization_id=_settings.dev_organization_id,
    )
    with sessions() as session:
        while (claimed := claim_next_job(session, "candidate-context-test")) is not None:
            process_claimed_job(session, identity, claimed[0], claimed[2])

    conversation = client.post(
        f"/v1/projects/{project['id']}/ai/conversations", json={"title": "Evidence context"}
    )
    assert conversation.status_code == 201, conversation.text
    response = client.post(
        f"/v1/projects/{project['id']}/ai/conversations/{conversation.json()['conversation']['id']}/messages",
        json={"content": "Is the structure shown in Figure 2 authoritative?", "mode": "EVIDENCE"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["latest_run"]["status"] == "SUCCEEDED"
    message = response.json()["messages"][-1]
    assert message["evidence_status"] == "SUPPORTED"
    assert "hypothetical" in message["content"].casefold()
    assert "no committed StructureVersion exists" in message["content"]
    assert "authoritative coordinate-bearing structure" in message["content"]
    assert "cannot be used for calculation" in message["content"]
    assert "[[E1]]" in message["content"] and "[[P1]]" in message["content"]
    assert any(
        citation["citation_type"] == "DOCUMENT" and citation["citation_id"] == "E1"
        for citation in message["citations"]
    )
    assert any(
        citation["citation_type"] == "PROJECT_RECORD"
        and citation["entity_id"] == candidates.json()["candidates"][0]["id"]
        for citation in message["citations"]
    )
    reopened = client.get(
        f"/v1/projects/{project['id']}/ai/conversations/{conversation.json()['conversation']['id']}"
    )
    assert reopened.status_code == 200
    assert reopened.json()["messages"][-1]["citations"] == message["citations"]
    assert reopened.json()["messages"][-1]["evidence_status"] == "SUPPORTED"
    assert reopened.json()["latest_run"]["status"] == "SUCCEEDED"

    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CandidateRepresentationRecord)) == 1
        assert session.scalar(select(func.count()).select_from(StructureVersionRecord)) == 0


def test_candidate_review_reject_and_project_isolation_preserve_evidence(api) -> None:
    client, sessions, _settings = api
    project_a = _project(client, "Candidate project A")
    project_b = _project(client, "Candidate project B")
    imported_response = _import_paper(client, project_a["id"])
    assert imported_response.status_code == 201, imported_response.text
    imported = imported_response.json()
    candidate_list = client.get(f"/v1/projects/{project_a['id']}/structure-candidates")
    assert candidate_list.status_code == 200, candidate_list.text
    assert candidate_list.json()["candidates"], (imported, candidate_list.text)
    candidate = candidate_list.json()["candidates"][0]
    candidate_id = candidate["id"]

    assert (
        client.get(
            f"/v1/projects/{project_b['id']}/structure-candidates/{candidate_id}"
        ).status_code
        == 404
    )
    for action in ("review", "reject", "promote"):
        isolated_action = client.post(
            f"/v1/projects/{project_b['id']}/structure-candidates/{candidate_id}/{action}",
            json={},
        )
        assert isolated_action.status_code == 404
    assert (
        client.post(
            f"/v1/projects/{project_a['id']}/structure-candidates/{candidate_id}/review",
            json={"reviewed_by": "attacker", "candidate_state": "PROMOTED"},
        ).status_code
        == 422
    )
    reviewed = client.post(
        f"/v1/projects/{project_a['id']}/structure-candidates/{candidate_id}/review",
        json={"notes": "Inspected the source figure."},
    )
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["candidate"]["candidate_state"] == "REVIEWED"
    rejected = client.post(
        f"/v1/projects/{project_a['id']}/structure-candidates/{candidate_id}/reject",
        json={"reason": "No machine-readable coordinates in the paper."},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["candidate"]["candidate_state"] == "REJECTED"
    assert client.get(f"/v1/projects/{project_a['id']}/structures").json() == []

    document = imported["document"]
    reread = client.get(f"/v1/projects/{project_a['id']}/documents/{document['id']}")
    assert reread.status_code == 200
    assert any(
        item["evidence_type"] == "STRUCTURE_FIGURE_CANDIDATE"
        for item in reread.json()["candidates"]
    )
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(EvidenceCandidateRecord)) >= 1
        assert session.scalar(select(func.count()).select_from(StructureCandidateReviewRecord)) == 2
        assert session.scalar(select(func.count()).select_from(StructureRecord)) == 0


def test_candidate_without_coordinates_cannot_promote_or_enter_calculation(api) -> None:
    client, sessions, _settings = api
    project = _project(client, "No coordinate candidate")
    imported = _import_paper(client, project["id"])
    assert imported.status_code == 201, imported.text
    candidate_response = client.get(f"/v1/projects/{project['id']}/structure-candidates")
    assert candidate_response.json()["candidates"], candidate_response.text
    candidate = candidate_response.json()["candidates"][0]
    candidate_id = candidate["id"]
    reviewed = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/review", json={}
    )
    assert reviewed.status_code == 200, reviewed.text
    promoted = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/promote", json={}
    )
    assert promoted.status_code == 422
    assert promoted.json()["detail"] == "COORDINATES_REQUIRED"

    rejected_calculation = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": candidate_id,
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {
                    "identifier": "HF",
                    "display_name": "Hartree-Fock",
                    "registry": "qc.method",
                },
                "basis": {"identifier": "STO-3G", "display_name": "STO-3G", "registry": "qc.basis"},
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
            },
            "idempotency_key": f"candidate-calc-{uuid4().hex}",
        },
    )
    assert rejected_calculation.status_code == 404
    assert client.get(f"/v1/projects/{project['id']}/structures").json() == []
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(StructureVersionRecord)) == 0


def test_reviewed_synthetic_coordinate_candidate_promotes_to_immutable_structure(
    api, monkeypatch
) -> None:
    monkeypatch.setattr(
        "chemdft_api.calculation_actions.validate_capability",
        lambda _specification, _settings: None,
    )
    client, sessions, _settings = api
    project = _project(client, "Synthetic coordinate candidate")
    imported = _import_paper(client, project["id"])
    assert imported.status_code == 201, imported.text
    candidate_response = client.get(f"/v1/projects/{project['id']}/structure-candidates")
    assert candidate_response.json()["candidates"], candidate_response.text
    candidate = candidate_response.json()["candidates"][0]
    candidate_id = candidate["id"]
    review = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/review", json={}
    )
    assert review.status_code == 200, review.text
    coordinate = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations",
        json={
            "representation_type": "CARTESIAN_COORDINATES",
            "coordinate_representation": _coordinates_payload(),
            "coordinate_origin": "USER_PASTED",
        },
    )
    assert coordinate.status_code == 201, coordinate.text
    representation_id = coordinate.json()["representation"]["id"]
    reviewed_representation = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations/{representation_id}/review",
        json={"checklist": _complete_review_checklist()},
    )
    assert reviewed_representation.status_code == 200, reviewed_representation.text

    promoted = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/promote", json={}
    )
    assert promoted.status_code == 201, promoted.text
    body = promoted.json()
    assert body["candidate"]["candidate_state"] == "PROMOTED"
    assert body["candidate"]["promoted_structure_version_id"] == body["version"]["id"]
    assert body["version"]["origin"] == "RECONSTRUCTED"
    assert len(body["version"]["coordinates"]["atoms"]) == 3
    assert body["provenance"]["source_class"] == "EXTRACTED"
    assert body["provenance"]["verification_state"] == "VERIFIED"
    assert body["provenance"]["operation"] == "chemdft.structure_candidate.promote"
    assert "storage_key" not in promoted.text and "object_key" not in promoted.text

    structures = client.get(f"/v1/projects/{project['id']}/structures")
    assert structures.status_code == 200
    assert len(structures.json()) == 1
    assert structures.json()[0]["id"] == body["structure"]["id"]
    version_list = client.get(
        f"/v1/projects/{project['id']}/structures/{body['structure']['id']}/versions"
    )
    assert version_list.status_code == 200, version_list.text
    assert version_list.json()[0]["provenance"]["candidate_representation_id"] == representation_id
    assert (
        client.get(f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}").json()[
            "candidate_state"
        ]
        == "PROMOTED"
    )
    again = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/promote", json={}
    )
    assert again.status_code == 201
    assert again.json()["version"]["id"] == body["version"]["id"]
    with sessions() as session:
        versions = session.scalars(select(StructureVersionRecord)).all()
        assert len(versions) == 1

    calculation = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": body["version"]["id"],
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {
                    "identifier": "HF",
                    "display_name": "Hartree-Fock",
                    "registry": "qc.method",
                },
                "basis": {
                    "identifier": "STO-3G",
                    "display_name": "STO-3G",
                    "registry": "qc.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
            },
            "idempotency_key": f"promoted-candidate-calc-{uuid4().hex}",
        },
    )
    assert calculation.status_code == 201, calculation.text
    with sessions() as session:
        calculation_input = session.scalar(
            select(CalculationInputRecord).where(
                CalculationInputRecord.calculation_id == calculation.json()["calculation"]["id"]
            )
        )
        assert calculation_input is not None
        assert calculation_input.structure_version_id == body["version"]["id"]
        from chemdft_api.ai.context_builder import AIContextBuilder

        context = AIContextBuilder(
            session,
            Identity(
                user_id=_settings.dev_user_id,
                organization_id=_settings.dev_organization_id,
            ),
            project["id"],
        ).build_context()
        assert "Figure 2 does not provide full atomic coordinates" in context.summary_text
        assert "coordinates USER_PASTED in angstrom" in context.summary_text
        assert "RECONSTRUCTED · VERIFIED" in context.summary_text


def test_ai_registry_exposes_only_read_only_candidate_tools(api) -> None:
    client, sessions, settings = api
    project = _project(client, "Candidate tool registry")
    imported = _import_paper(client, project["id"])
    assert imported.status_code == 201, imported.text
    with sessions() as session:
        registry = build_application_tool_registry(
            session,
            object_store=None,
            settings=settings,  # type: ignore[arg-type]
        )
        listed = registry.invoke(
            "structure_candidate.list",
            {},
            ToolInvocationContext(
                request_id=uuid4(),
                identity=Identity(
                    user_id=settings.dev_user_id,
                    organization_id=settings.dev_organization_id,
                ),
                project_id=UUID(project["id"]),
                capabilities=frozenset({"structure_candidate.read"}),
                approval_references=frozenset(),
                transport="test",
            ),
        )
        names = {definition.name for definition in registry.discover()}
    assert listed.candidates
    assert {"structure_candidate.list", "structure_candidate.get"}.issubset(names)
    assert not names.intersection(
        {"structure_candidate.review", "structure_candidate.reject", "structure_candidate.promote"}
    )


def test_smiles_creates_immutable_previewable_representations_deterministically(api) -> None:
    client, sessions, _settings = api
    project = _project(client, "Candidate SMILES preview")
    imported = _import_paper(client, project["id"])
    assert imported.status_code == 201, imported.text
    candidate_id = client.get(f"/v1/projects/{project['id']}/structure-candidates").json()[
        "candidates"
    ][0]["id"]

    first = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations",
        json={"representation_type": "SMILES", "smiles": "O"},
    )
    assert first.status_code == 201, first.text
    body = first.json()
    source = body["representation"]
    preview = body["generated_representation"]
    assert source["representation_type"] == "SMILES"
    assert source["validation_state"] == "PARSEABLE"
    assert source["revision"] == 2
    assert preview["representation_type"] == "CARTESIAN_COORDINATES"
    assert preview["validation_state"] == "PREVIEWABLE"
    assert preview["generation_parameters"]["algorithm"] == "ETKDGv3"
    assert preview["generation_parameters"]["random_seed"] == 104729
    assert len(preview["coordinate_representation"]["coordinates"]["atoms"]) >= 3
    assert "storage_key" not in first.text and "object_key" not in first.text

    repeated = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations",
        json={"representation_type": "SMILES", "smiles": "O"},
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["representation"]["id"] == source["id"]
    assert repeated.json()["generated_representation"]["id"] == preview["id"]

    listing = client.get(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations"
    )
    assert listing.status_code == 200, listing.text
    listed = listing.json()["representations"]
    assert [item["revision"] for item in listed] == [1, 2, 3]
    revised = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations",
        json={"representation_type": "SMILES", "smiles": "CO"},
    )
    assert revised.status_code == 201, revised.text
    assert revised.json()["representation"]["revision"] == 4
    assert revised.json()["generated_representation"]["revision"] == 5
    assert len({item["content_sha256"] for item in listed}) == 3
    assert client.get(f"/v1/projects/{project['id']}/structures").json() == []
    with sessions() as session:
        rows = session.scalars(select(CandidateRepresentationRecord)).all()
        first_source = next(item for item in rows if item.id == source["id"])
        first_preview = next(item for item in rows if item.id == preview["id"])
        assert first_preview.source_representation_id == first_source.id
        first_source.payload_json = {"smiles": "silently overwritten"}
        try:
            session.commit()
        except ValueError as error:
            assert "append-only" in str(error)
            session.rollback()
        else:
            raise AssertionError("Candidate representations must be append-only")


def test_invalid_smiles_is_retained_as_invalid_without_preview_or_structure(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "Invalid candidate SMILES")
    imported = _import_paper(client, project["id"])
    assert imported.status_code == 201, imported.text
    candidate_id = client.get(f"/v1/projects/{project['id']}/structure-candidates").json()[
        "candidates"
    ][0]["id"]

    response = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations",
        json={"representation_type": "SMILES", "smiles": "C1(not valid"},
    )
    assert response.status_code == 201, response.text
    representation = response.json()["representation"]
    assert representation["validation_state"] == "INVALID"
    assert representation["validation_diagnostics"]
    assert response.json()["generated_representation"] is None
    assert client.get(f"/v1/projects/{project['id']}/structures").json() == []


def test_mol_block_draft_is_separate_from_structure_version(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "Candidate MOL draft")
    imported = _import_paper(client, project["id"])
    assert imported.status_code == 201, imported.text
    candidate_id = client.get(f"/v1/projects/{project['id']}/structure-candidates").json()[
        "candidates"
    ][0]["id"]
    mol = (
        "Synthetic water\n"
        "  ChemDFT  3D\n\n"
        "  3  2  0  0  0  0  0  0  0  0999 V2000\n"
        "    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n"
        "    0.7586    0.0000    0.5043 H   0  0  0  0  0  0  0  0  0  0  0  0\n"
        "   -0.7586    0.0000    0.5043 H   0  0  0  0  0  0  0  0  0  0  0  0\n"
        "  1  2  1  0  0  0  0\n"
        "  1  3  1  0  0  0  0\n"
        "M  END\n"
    )
    response = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations",
        json={"representation_type": "MOL", "mol_block": mol},
    )
    assert response.status_code == 201, response.text
    assert response.json()["representation"]["representation_type"] == "MOL"
    assert response.json()["representation"]["validation_state"] == "PARSEABLE"
    assert response.json()["generated_representation"]["validation_state"] == "PREVIEWABLE"
    assert client.get(f"/v1/projects/{project['id']}/structures").json() == []


def test_coordinate_candidate_representation_requires_its_own_review_and_lineage(api) -> None:
    client, sessions, settings = api
    project = _project(client, "Reviewed coordinate representation")
    imported = _import_paper(client, project["id"])
    assert imported.status_code == 201, imported.text
    candidate_id = client.get(f"/v1/projects/{project['id']}/structure-candidates").json()[
        "candidates"
    ][0]["id"]
    source_review = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/review", json={}
    )
    assert source_review.status_code == 200, source_review.text
    created = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations",
        json={
            "representation_type": "CARTESIAN_COORDINATES",
            "coordinate_representation": _coordinates_payload(),
            "coordinate_origin": "USER_PASTED",
        },
    )
    assert created.status_code == 201, created.text
    representation_id = created.json()["representation"]["id"]
    missing_representation_review = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/promote",
        json={"representation_id": representation_id},
    )
    assert missing_representation_review.status_code == 409

    review = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations/{representation_id}/review",
        json={
            "notes": "Reviewed synthetic coordinate fixture.",
            "checklist": _complete_review_checklist(),
        },
    )
    assert review.status_code == 200, review.text
    promoted = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/promote",
        json={"representation_id": representation_id},
    )
    assert promoted.status_code == 201, promoted.text
    body = promoted.json()
    assert body["candidate"]["candidate_state"] == "PROMOTED"
    assert body["candidate"]["promoted_structure_version_id"] == body["version"]["id"]
    assert body["version"]["origin"] == "RECONSTRUCTED"
    assert body["provenance"]["verification_state"] == "VERIFIED"
    assert len(client.get(f"/v1/projects/{project['id']}/structures").json()) == 1
    calculation = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": body["version"]["id"],
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {
                    "identifier": "HF",
                    "display_name": "Hartree-Fock",
                    "registry": "qc.method",
                },
                "basis": {"identifier": "STO-3G", "display_name": "STO-3G", "registry": "qc.basis"},
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
            },
            "idempotency_key": f"reconstructed-calculation-{uuid4().hex}",
        },
    )
    assert calculation.status_code == 201, calculation.text
    with sessions() as session:
        representation = session.get(CandidateRepresentationRecord, representation_id)
        assert representation is not None
        assert representation.content_sha256
        assert representation.revision == 2
        assert representation.created_by == settings.dev_user_id
        from chemdft_api.scientific_models import ProvenanceInputRow, ProvenanceRecordRow

        provenance = session.scalar(
            select(ProvenanceRecordRow).where(
                ProvenanceRecordRow.subject_id == body["version"]["id"],
                ProvenanceRecordRow.project_id == project["id"],
            )
        )
        lineage = session.scalars(
            select(ProvenanceInputRow).where(
                ProvenanceInputRow.provenance_record_id == provenance.id
            )
        ).all()
        assert any(item.input_id == candidate_id for item in lineage)
        assert any(item.input_id == representation_id for item in lineage)
        assert any(item.input_id == imported.json()["document"]["id"] for item in lineage)


def test_coordinate_file_import_and_fractional_paste_create_provenanced_revisions(api) -> None:
    client, _sessions, settings = api
    project = _project(client, "Coordinate reconstruction input")
    imported = _import_paper(client, project["id"])
    candidate_id = client.get(f"/v1/projects/{project['id']}/structure-candidates").json()[
        "candidates"
    ][0]["id"]
    source_evidence_id = client.get(f"/v1/projects/{project['id']}/structure-candidates").json()[
        "candidates"
    ][0]["source_evidence_id"]
    image_reference_id = client.get(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations"
    ).json()["representations"][0]["id"]

    fixture_path = Path(__file__).parent / "fixtures" / "test-user-supplied-reconstruction.xyz"
    fixture_bytes = fixture_path.read_bytes()
    uploaded = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations/imports",
        files={"upload": (fixture_path.name, fixture_bytes, "chemical/x-xyz")},
        data={
            "file_format": "XYZ",
            "coordinate_unit": "angstrom",
            "coordinate_origin": "USER_IMPORTED_FILE",
        },
    )
    assert uploaded.status_code == 201, uploaded.text
    revision_two = uploaded.json()["representation"]
    assert revision_two["revision"] == 2
    assert revision_two["validation_state"] == "PREVIEWABLE"
    assert revision_two["coordinate_provenance"] == {
        "origin": "USER_IMPORTED_FILE",
        "input_format": "XYZ",
        "coordinate_unit": "angstrom",
        "original_file_sha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "user_action": "USER_IMPORTED_FILE",
        "user_id": settings.dev_user_id,
        "source_document_id": imported.json()["document"]["id"],
        "source_evidence_id": source_evidence_id,
        "parent_representation_id": image_reference_id,
    }
    assert "TEST USER-SUPPLIED RECONSTRUCTION" in fixture_bytes.decode()

    pasted = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations/paste",
        json={
            "name": "Fractional user reconstruction",
            "coordinate_system": "FRACTIONAL",
            "unit": "angstrom",
            "coordinate_text": "Cr 0.0 0.0 0.0\nO 0.5 0.5 0.0",
            "parent_representation_id": revision_two["id"],
            "cell": {
                "a": 4.958,
                "b": 4.958,
                "c": 13.593,
                "alpha": 90,
                "beta": 90,
                "gamma": 120,
                "unit": "angstrom",
            },
            "cell_source": "USER_ENTERED",
        },
    )
    assert pasted.status_code == 201, pasted.text
    revision_three = pasted.json()["representation"]
    assert revision_three["revision"] == 3
    assert revision_three["validation_state"] == "PREVIEWABLE"
    assert revision_three["coordinate_provenance"]["origin"] == "USER_PASTED"
    assert revision_three["coordinate_provenance"]["parent_representation_id"] == revision_two["id"]
    assert revision_three["cell_provenance"]["source"] == "USER_ENTERED"
    assert revision_three["cell_provenance"]["parameters"]["c"] == 13.593

    malformed = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations/paste",
        json={
            "name": "Malformed coordinate input",
            "coordinate_system": "CARTESIAN",
            "unit": "angstrom",
            "coordinate_text": "Cr NaN 0 0",
        },
    )
    assert malformed.status_code == 422, malformed.text
    missing_cell = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations/paste",
        json={
            "name": "Fractional input without cell",
            "coordinate_system": "FRACTIONAL",
            "unit": "angstrom",
            "coordinate_text": "Cr 0 0 0",
        },
    )
    assert missing_cell.status_code == 422, missing_cell.text


def test_incomplete_human_checklist_blocks_candidate_promotion(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "Incomplete reconstruction review")
    _import_paper(client, project["id"])
    candidate_id = client.get(f"/v1/projects/{project['id']}/structure-candidates").json()[
        "candidates"
    ][0]["id"]
    assert (
        client.post(
            f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/review", json={}
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/promote",
            json={},
        ).status_code
        == 422
    )
    created = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations",
        json={
            "representation_type": "CARTESIAN_COORDINATES",
            "coordinate_representation": _coordinates_payload(),
            "coordinate_origin": "USER_PASTED",
        },
    )
    assert created.status_code == 201, created.text
    representation_id = created.json()["representation"]["id"]
    incomplete_checklist = _complete_review_checklist()
    incomplete_checklist["differences_acknowledged"] = False
    reviewed = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations/{representation_id}/review",
        json={"checklist": incomplete_checklist},
    )
    assert reviewed.status_code == 200, reviewed.text
    blocked = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/promote",
        json={"representation_id": representation_id},
    )
    assert blocked.status_code == 409
    assert "HUMAN_REVIEW_CHECKLIST_INCOMPLETE" in blocked.text
    assert client.get(f"/v1/projects/{project['id']}/structures").json() == []


def test_representation_project_scope_and_ai_registry_are_read_only(api) -> None:
    client, sessions, settings = api
    project_a = _project(client, "Candidate representation project A")
    project_b = _project(client, "Candidate representation project B")
    imported = _import_paper(client, project_a["id"])
    assert imported.status_code == 201, imported.text
    candidate_id = client.get(f"/v1/projects/{project_a['id']}/structure-candidates").json()[
        "candidates"
    ][0]["id"]
    created = client.post(
        f"/v1/projects/{project_a['id']}/structure-candidates/{candidate_id}/representations",
        json={"representation_type": "SMILES", "smiles": "CCO"},
    )
    assert created.status_code == 201, created.text
    representation_id = created.json()["representation"]["id"]
    assert (
        client.get(
            f"/v1/projects/{project_b['id']}/structure-candidates/{candidate_id}/representations"
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/v1/projects/{project_b['id']}/structure-candidates/{candidate_id}/representations/{representation_id}/review",
            json={},
        ).status_code
        == 404
    )

    with sessions() as session:
        registry = build_application_tool_registry(session, object_store=None, settings=settings)
        names = {definition.name for definition in registry.discover()}
        listed = registry.invoke(
            "structure_candidate.representation.list",
            {"candidate_id": candidate_id},
            ToolInvocationContext(
                request_id=uuid4(),
                identity=Identity(
                    user_id=settings.dev_user_id,
                    organization_id=settings.dev_organization_id,
                ),
                project_id=UUID(project_a["id"]),
                capabilities=frozenset({"structure_candidate.read"}),
                approval_references=frozenset(),
                transport="test",
            ),
        )
    assert listed.representations
    assert "structure_candidate.representation.list" in names
    assert not names.intersection(
        {
            "structure_candidate.representation.create",
            "structure_candidate.promote",
        }
    )


def test_coordinate_representation_id_cannot_be_calculation_structure_reference(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "Candidate representation calculation isolation")
    imported = _import_paper(client, project["id"])
    assert imported.status_code == 201, imported.text
    candidate_id = client.get(f"/v1/projects/{project['id']}/structure-candidates").json()[
        "candidates"
    ][0]["id"]
    created = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/representations",
        json={"representation_type": "SMILES", "smiles": "O"},
    )
    representation_id = created.json()["representation"]["id"]
    rejected = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": representation_id,
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {
                    "identifier": "HF",
                    "display_name": "Hartree-Fock",
                    "registry": "qc.method",
                },
                "basis": {
                    "identifier": "STO-3G",
                    "display_name": "STO-3G",
                    "registry": "qc.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
            },
            "idempotency_key": f"candidate-representation-calc-{uuid4().hex}",
        },
    )
    assert rejected.status_code == 404
    assert client.get(f"/v1/projects/{project['id']}/structures").json() == []
