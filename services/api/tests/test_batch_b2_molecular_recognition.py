"""Batch B2: Molecular Diagram Recognition Test Suite (figure extraction, contract, API).

IMPORTANT - how the B2 tests are organised, and what each kind does and does not show:

* Development lookup tests (`*_development_lookup_*` and the API workflow test below) exercise
  `DevelopmentRecognitionEngine`, a LOOKUP TABLE keyed on the caller-supplied `category`/`hint`
  string; it never inspects image content.  They verify the proposal contract, RDKit validation
  and API wiring - NOT image-to-structure recognition or AI accuracy.
* Scripted/mock tests (`test_batch_b2_review_corrections.py`, fake `subprocess.run`) verify the
  wrapper around DECIMER: gating, status mapping, isolation flags, failure handling.
* Real DECIMER integration test: `test_real_decimer_hint_free_ethanol_drawing` in
  `test_batch_b2_review_corrections.py` (runs the real model when weights and the worker
  environment are provisioned; skipped otherwise).  It is NOT in this file.
* Browser end-to-end tests: `apps/web/tests/e2e/batch-b2-recognition-flow.spec.ts` (real DECIMER
  in a disposable stack).

Validates:
1. Raster figure extraction from scientific PDFs with bounding boxes and SHA-256 provenance.
2. Safety bounds: page limits, image counts, image dimensions, memory protection.
3. Independent development set chemical recognition:
   - Benzene, Ethanol, Acetone, Charged (acetate), Aromatic (pyridine), Stereochemical (L-alanine).
4. Graph-level isomorphism and explicit stereochemical checks (not naive string equality).
5. Adversarial and edge case handling without hallucination:
   - Missing labels, nonchemical images, low-quality diagrams, unrecognizable/corrupted images.
6. Multi-stage scientific validation and proposal contract invariants:
   - Proposals remain unverified (is_scientifically_verified=False).
   - Candidate state remains DETECTED (never auto-promoted to verified research structures).
7. Full API workflow: figure extraction -> figure retrieval -> diagram recognition.
8. Multi-tenant isolation and cross-project access rejection.
"""

from __future__ import annotations

import io
from pathlib import Path
from uuid import uuid4

import pytest
from b2_pdf import build_pdf, jpeg_image_object, raster_pdf
from chemdft_api.scientific.figure_extractor import (
    PageLimitExceededError,
    extract_figures_from_pdf,
)
from chemdft_api.scientific.molecular_recognition.contracts import (
    MolecularRecognitionProposal,
    RecognitionStatus,
)
from chemdft_api.scientific.molecular_recognition.engine import (
    DecimerSubprocessEngine,
    DevelopmentRecognitionEngine,
)
from chemdft_api.scientific.molecular_recognition.validation import (
    validate_molecular_graph_proposal,
)
from chemdft_api.scientific_models import (
    CandidateRepresentationRecord,
    StructureCandidateRecord,
    StructureRecord,
    StructureVersionRecord,
)
from PIL import Image
from rdkit import Chem
from rdkit.Chem import rdMolDescriptors
from sqlalchemy import func, select


def _project(client, name: str) -> dict[str, str]:
    return client.post(
        "/v1/projects",
        json={"name": name, "slug": f"{name.lower().replace(' ', '-')}-{uuid4().hex[:8]}"},
    ).json()


def _make_raster_pdf(images: list[tuple[Image.Image, tuple[float, float, float, float]]]) -> bytes:
    """Strictly valid one-page PDF; rects are (x, y, w, h) in PDF points, origin bottom-left."""
    return raster_pdf(images)


def _compare_chemical_graphs(ref_smiles: str, cand_smiles: str) -> dict[str, object]:
    """Graph-level comparison via InChI layers (connectivity, H, charge, isotopes; stereo apart).

    Substructure matching alone is NOT sufficient: it ignores formal charge and isotopes, so
    acetic acid and acetate would compare as 'isomorphic'.
    """
    from rdkit.Chem import inchi

    ref_mol = Chem.MolFromSmiles(ref_smiles)
    cand_mol = Chem.MolFromSmiles(cand_smiles)
    assert ref_mol is not None, f"Invalid reference SMILES: {ref_smiles}"
    assert cand_mol is not None, f"Invalid candidate SMILES: {cand_smiles}"

    def layers(mol):
        parts = inchi.MolToInchi(mol).split("/")[1:]
        return (
            "/".join(p for p in parts if p[0] not in "btms"),
            "/".join(p for p in parts if p[0] in "btms"),
        )

    ref_graph, ref_stereo = layers(ref_mol)
    cand_graph, cand_stereo = layers(cand_mol)
    return {
        "same_formula": rdMolDescriptors.CalcMolFormula(ref_mol)
        == rdMolDescriptors.CalcMolFormula(cand_mol),
        "same_heavy_atoms": ref_mol.GetNumHeavyAtoms() == cand_mol.GetNumHeavyAtoms(),
        "same_bonds": ref_mol.GetNumBonds() == cand_mol.GetNumBonds(),
        "same_charge": sum(a.GetFormalCharge() for a in ref_mol.GetAtoms())
        == sum(a.GetFormalCharge() for a in cand_mol.GetAtoms()),
        "same_isotopes": sorted(a.GetIsotope() for a in ref_mol.GetAtoms())
        == sorted(a.GetIsotope() for a in cand_mol.GetAtoms()),
        "isomorphic": ref_graph == cand_graph,
        "same_chiral": ref_stereo == cand_stereo,
    }


PAGE_W, PAGE_H = 612.0, 792.0
BBOX_TOL = 1e-3  # extractor rounds to 4 dp; allow for that plus float noise


def _expected_box(x: float, y: float, w: float, h: float) -> tuple[float, float, float, float]:
    """PDF placement (points, origin bottom-left) -> normalised (x, y, w, h), origin top-left."""
    return (x / PAGE_W, (PAGE_H - y - h) / PAGE_H, w / PAGE_W, h / PAGE_H)


def _assert_box(fig, placement: tuple[float, float, float, float]) -> None:
    got = (fig.x, fig.y, fig.width, fig.height)
    want = _expected_box(*placement)
    assert all(abs(g - w) <= BBOX_TOL for g, w in zip(got, want, strict=True)), (got, want)


def test_figure_extractor_raster_bounds_and_safety() -> None:
    """Validate extraction preserves geometry, SHA-256, and respects safety bounds."""
    # 1. Single valid image
    img = Image.new("RGB", (100, 80), color=(0, 128, 255))
    pdf_bytes = _make_raster_pdf([(img, (50, 400, 150, 120))])

    extracted = extract_figures_from_pdf(pdf_bytes, document_id="doc-123")
    assert len(extracted) == 1
    fig = extracted[0]
    assert fig.page_number == 1
    assert fig.pixel_width == 100
    assert fig.pixel_height == 80
    assert fig.image_format == "PNG"
    assert fig.extraction_method == "pypdf-figure-extractor-v2"
    assert len(fig.image_sha256) == 64
    # position and size must match the content-stream placement (50, 400, 150x120 pt), not just
    # lie inside the page
    _assert_box(fig, (50, 400, 150, 120))
    assert fig.width > 0.2 and fig.height > 0.1

    # 2. Minimum dimension filtering: tiny icon (16x16) should be ignored
    tiny_img = Image.new("RGB", (16, 16), color=(255, 0, 0))
    tiny_pdf = _make_raster_pdf([(tiny_img, (10, 10, 20, 20))])
    assert len(extract_figures_from_pdf(tiny_pdf)) == 0

    # 3. Page limit enforcement
    with pytest.raises(PageLimitExceededError):
        extract_figures_from_pdf(pdf_bytes, max_pages=0)


def test_multi_structure_figures_on_single_page() -> None:
    """PDF with multiple diagrams on one page extracts each distinct figure."""
    img1 = Image.new("RGB", (80, 80), color=(255, 100, 100))
    img2 = Image.new("RGB", (90, 70), color=(100, 255, 100))
    pdf_bytes = _make_raster_pdf(
        [
            (img1, (50, 500, 120, 120)),
            (img2, (250, 500, 135, 105)),
        ]
    )

    extracted = extract_figures_from_pdf(pdf_bytes, document_id="multi-fig-doc")
    assert len(extracted) == 2
    f1, f2 = extracted[0], extracted[1]
    assert f1.page_number == 1
    assert f2.page_number == 1
    assert f1.image_sha256 != f2.image_sha256
    assert (f1.pixel_width, f1.pixel_height) == (80, 80)
    assert (f2.pixel_width, f2.pixel_height) == (90, 70)
    _assert_box(f1, (50, 500, 120, 120))
    _assert_box(f2, (250, 500, 135, 105))
    assert f1.x < f2.x  # left-to-right draw order preserved


def test_development_lookup_engine_contract_and_graph_validation() -> None:
    """HINT-DRIVEN LOOKUP (not recognition): checks proposal contract + RDKit graph validation."""
    engine = DevelopmentRecognitionEngine()

    benchmark_cases = [
        {
            "name": "Benzene",
            "category": "benzene",
            "ref_smiles": "c1ccccc1",
            "expected_formula": "C6H6",
            "expected_heavy_atoms": 6,
            "expected_charge": 0,
            "has_stereochemistry": False,
        },
        {
            "name": "Ethanol",
            "category": "ethanol",
            "ref_smiles": "CCO",
            "expected_formula": "C2H6O",
            "expected_heavy_atoms": 3,
            "expected_charge": 0,
            "has_stereochemistry": False,
        },
        {
            "name": "Acetone",
            "category": "acetone",
            "ref_smiles": "CC(=O)C",
            "expected_formula": "C3H6O",
            "expected_heavy_atoms": 4,
            "expected_charge": 0,
            "has_stereochemistry": False,
        },
        {
            "name": "Charged molecule (Acetate)",
            "category": "charged",
            "ref_smiles": "CC(=O)[O-]",
            "expected_formula": "C2H3O2-",
            "expected_heavy_atoms": 4,
            "expected_charge": -1,
            "has_stereochemistry": False,
        },
        {
            "name": "Aromatic heteroatom (Pyridine)",
            "category": "pyridine",
            "ref_smiles": "c1ccncc1",
            "expected_formula": "C5H5N",
            "expected_heavy_atoms": 6,
            "expected_charge": 0,
            "has_stereochemistry": False,
        },
        {
            "name": "Stereochemical structure (L-alanine)",
            "category": "stereochemical",
            "ref_smiles": "N[C@@H](C)C(=O)O",
            "expected_formula": "C3H7NO2",
            "expected_heavy_atoms": 6,
            "expected_charge": 0,
            "has_stereochemistry": True,
        },
    ]

    dummy_image = Image.new("RGB", (100, 100), color=(255, 255, 255))
    buf = io.BytesIO()
    dummy_image.save(buf, format="PNG")
    img_bytes = buf.getvalue()

    for case in benchmark_cases:
        proposal: MolecularRecognitionProposal = engine.recognize_diagram(
            img_bytes,
            metadata={"category": case["category"], "page_number": 1, "document_id": "bench-doc"},
        )

        assert proposal.status in (
            RecognitionStatus.MANUAL_REVIEW_REQUIRED,
            RecognitionStatus.VALIDATED_GRAPH_SYNTAX,
            RecognitionStatus.RECOGNITION_PROPOSAL,
        ), f"Failed for {case['name']}: {proposal.status}"

        # CRITICAL SAFETY INVARIANT: Proposals are NEVER marked as verified
        assert proposal.is_scientifically_verified is False

        assert proposal.formula == case["expected_formula"]
        assert proposal.heavy_atom_count == case["expected_heavy_atoms"]
        assert proposal.formal_charge == case["expected_charge"]
        assert proposal.has_stereochemistry == case["has_stereochemistry"]

        # Graph-level isomorphism check
        comp = _compare_chemical_graphs(case["ref_smiles"], proposal.proposed_smiles)
        assert comp["same_formula"] is True
        assert comp["same_heavy_atoms"] is True
        assert comp["same_charge"] is True
        assert comp["isomorphic"] is True
        assert comp["same_chiral"] is True


def test_development_lookup_engine_failure_categories() -> None:
    """HINT-DRIVEN LOOKUP: abstention here is declared by the caller's category string, so this
    does NOT demonstrate hallucination safety of a real model."""
    engine = DevelopmentRecognitionEngine()
    dummy_img = Image.new("RGB", (100, 100), color=(255, 255, 255))
    buf = io.BytesIO()
    dummy_img.save(buf, format="PNG")
    dummy_bytes = buf.getvalue()
    corrupted_bytes = b"corrupted-invalid-bytes"

    # 1. Non-chemical diagram (plot / photo / XRD)
    p_nonchem = engine.recognize_diagram(dummy_bytes, metadata={"category": "plot"})
    assert p_nonchem.raw_model_output is None
    assert p_nonchem.proposed_smiles is None
    assert p_nonchem.status == RecognitionStatus.UNRECOGNIZABLE
    assert p_nonchem.is_scientifically_verified is False
    assert any(
        "abstained" in d.lower() or "unrecognizable" in d.lower() for d in p_nonchem.diagnostics
    )

    # 2. Corrupted / unreadable image
    p_corrupt = engine.recognize_diagram(corrupted_bytes, metadata={"category": "corrupted"})
    assert p_corrupt.status in (RecognitionStatus.UNRECOGNIZABLE, RecognitionStatus.PARSE_FAILED)
    assert p_corrupt.proposed_smiles is None
    assert p_corrupt.is_scientifically_verified is False

    # 3. Diagram with missing labels -> AMBIGUOUS with warnings
    p_missing = engine.recognize_diagram(dummy_bytes, metadata={"category": "missing_labels"})
    assert p_missing.status in (
        RecognitionStatus.AMBIGUOUS,
        RecognitionStatus.MANUAL_REVIEW_REQUIRED,
    )
    assert p_missing.is_scientifically_verified is False

    # 4. Low-quality / blurry diagram -> high uncertainty
    p_lowqual = engine.recognize_diagram(dummy_bytes, metadata={"category": "low_quality"})
    assert p_lowqual.is_scientifically_verified is False
    assert any("low contrast" in d.lower() or "blur" in d.lower() for d in p_lowqual.diagnostics)

    # 5. Invalid SMILES syntax/valence handling
    v_bad = validate_molecular_graph_proposal("C(=O)(=O)(=O)(=O)O")  # 5 carbonyls on one C
    assert v_bad.is_parseable is False
    assert v_bad.status == RecognitionStatus.PARSE_FAILED
    assert any("valency" in w.lower() for w in v_bad.warnings)


def test_candidate_figure_extraction_and_recognition_api_workflow(api) -> None:
    """REST vertical slice with the DEVELOPMENT LOOKUP engine (enabled for this test only): the
    image is blank and the benzene result comes from category_hint, not from the figure."""
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True  # local test only; default is False
    project = _project(client, "B2 Molecular Recognition Project")

    # Generate PDF with a recognized chemical diagram (benzene)
    img = Image.new("RGB", (120, 100), color=(255, 255, 255))
    pdf_bytes = _make_raster_pdf([(img, (50, 450, 180, 150))])

    # 1. Upload scientific paper
    import_resp = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("chemistry_paper.pdf", pdf_bytes, "application/pdf")},
    )
    assert import_resp.status_code == 201, import_resp.text
    doc_id = import_resp.json()["document"]["id"]

    # 2. Extract figures from paper
    extract_resp = client.post(
        f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract",
    )
    assert extract_resp.status_code == 200, extract_resp.text
    extract_data = extract_resp.json()
    assert "candidates" in extract_data
    candidates = extract_data["candidates"]
    assert len(candidates) == 1
    candidate = candidates[0]
    candidate_id = candidate["id"]
    assert candidate["source_document_id"] == doc_id

    # Verify database state after extraction: candidate exists, state is DETECTED
    with sessions() as session:
        cand_record = session.get(StructureCandidateRecord, candidate_id)
        assert cand_record is not None
        assert cand_record.candidate_state == "DETECTED"
        assert cand_record.source_type == "REPORTED_FIGURE"

        reps = session.scalars(
            select(CandidateRepresentationRecord).where(
                CandidateRepresentationRecord.candidate_id == candidate_id
            )
        ).all()
        rep_types = [r.representation_type for r in reps]
        assert "IMAGE_REFERENCE" in rep_types
        # SMILES should not be present yet
        assert "SMILES" not in rep_types

        # Verify no verified structures were created
        assert session.scalar(select(func.count()).select_from(StructureRecord)) == 0
        assert session.scalar(select(func.count()).select_from(StructureVersionRecord)) == 0

    # 3. Fetch candidate figure image via REST
    fig_resp = client.get(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/figure"
    )
    assert fig_resp.status_code == 200
    assert fig_resp.headers["content-type"] == "image/png"
    assert len(fig_resp.content) > 0

    # 4. Recognize candidate figure
    rec_resp = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/recognize",
        json={"engine": "chemdft-development-engine", "category_hint": "benzene"},
    )
    assert rec_resp.status_code == 200, rec_resp.text
    rec_data = rec_resp.json()
    assert rec_data["candidate"]["id"] == candidate_id
    proposal = rec_data["proposal"]
    assert proposal["recognition_engine"] == "chemdft-development-engine"
    assert proposal["canonical_isomeric_smiles"] == "c1ccccc1"
    assert proposal["formula"] == "C6H6"
    assert proposal["status"] in ("MANUAL_REVIEW_REQUIRED", "VALIDATED_GRAPH_SYNTAX")
    assert proposal["is_scientifically_verified"] is False
    assert len(proposal["validation_warnings"]) >= 1

    # Verify database state after recognition: state is STILL DETECTED (unpromoted proposal)
    with sessions() as session:
        cand_record = session.get(StructureCandidateRecord, candidate_id)
        assert cand_record.candidate_state == "DETECTED"
        assert cand_record.method == "chemdft-development-engine"

        reps = session.scalars(
            select(CandidateRepresentationRecord).where(
                CandidateRepresentationRecord.candidate_id == candidate_id
            )
        ).all()
        rep_map = {r.representation_type: r for r in reps}
        assert "IMAGE_REFERENCE" in rep_map
        assert "SMILES" in rep_map
        assert "MOL_BLOCK" in rep_map
        assert rep_map["SMILES"].payload_json["canonical_isomeric_smiles"] == "c1ccccc1"
        assert "mol_block" in rep_map["MOL_BLOCK"].payload_json

        # Still 0 verified structures
        assert session.scalar(select(func.count()).select_from(StructureRecord)) == 0


def test_multi_tenant_cross_project_isolation(multiuser) -> None:
    """Ensure strict project authorization rejects cross-tenant access to figures/proposals."""
    alice = multiuser.actor("alice")
    bob = multiuser.actor("bob")

    proj_alice = alice.create_project("alice-chemistry", name="Alice Chemistry")
    proj_bob = bob.create_project("bob-chemistry", name="Bob Chemistry")

    # Alice uploads a paper with a figure
    img = Image.new("RGB", (100, 100), color=(200, 200, 255))
    pdf_bytes = _make_raster_pdf([(img, (50, 400, 150, 120))])
    import_resp = alice.post(
        f"/v1/projects/{proj_alice['id']}/documents/imports",
        files={"upload": ("paper.pdf", pdf_bytes, "application/pdf")},
    )
    assert import_resp.status_code == 201
    doc_id = import_resp.json()["document"]["id"]

    # Alice extracts figures
    extract_resp = alice.post(f"/v1/projects/{proj_alice['id']}/documents/{doc_id}/figures/extract")
    assert extract_resp.status_code == 200
    candidate_id = extract_resp.json()["candidates"][0]["id"]

    # Bob attempts to extract Alice's document -> rejected 403 or 404
    bob_extract = bob.post(f"/v1/projects/{proj_alice['id']}/documents/{doc_id}/figures/extract")
    assert bob_extract.status_code in (403, 404)

    # Bob attempts to view Alice's candidate figure -> rejected 403 or 404
    bob_figure = bob.get(
        f"/v1/projects/{proj_alice['id']}/structure-candidates/{candidate_id}/figure"
    )
    assert bob_figure.status_code in (403, 404)

    # Bob attempts to recognize Alice's candidate using his own project ID -> rejected 404
    bob_recognize_foreign = bob.post(
        f"/v1/projects/{proj_bob['id']}/structure-candidates/{candidate_id}/recognize",
        json={"engine": "chemdft-development-engine"},
    )
    assert bob_recognize_foreign.status_code == 404


def test_decimer_model_feasibility_boundary_reporting(tmp_path: Path) -> None:
    """Validate DecimerSubprocessEngine handles missing weights gracefully without crashing."""
    # Empty cache path where saved_model.pb does not exist
    empty_cache = tmp_path / "empty_cache"
    empty_cache.mkdir()

    engine = DecimerSubprocessEngine(timeout_seconds=5, model_cache=empty_cache)
    proposal = engine.recognize_diagram(
        b"fake-image-bytes",
        metadata={"document_id": "doc-no-weights", "page_number": 1},
    )

    assert proposal.status == RecognitionStatus.UNSUPPORTED
    assert proposal.raw_model_output is None
    assert proposal.is_scientifically_verified is False
    assert any("weights not installed" in w.lower() for w in proposal.validation_warnings)


def test_multipage_pdf_with_empty_and_text_only_pages() -> None:
    """Validate PDF with text-only pages and figures correctly attributes page numbers."""
    # Page 1: text only, Page 2: raster figure, Page 3: tiny icon (filtered out)
    big = jpeg_image_object(Image.new("RGB", (100, 100), (100, 200, 150)))
    tiny = jpeg_image_object(Image.new("RGB", (16, 16), (0, 0, 0)))
    pdf = build_pdf(
        [
            ("BT /F1 12 Tf 72 712 Td (Text only page without figures.) Tj ET", {}),
            ("q 150 0 0 150 100 400 cm /Im1 Do Q", {"Im1": big}),
            ("q 20 0 0 20 50 700 cm /Im2 Do Q", {"Im2": tiny}),
        ],
        font_resource=True,
    )

    extracted = extract_figures_from_pdf(pdf, document_id="doc-multipage")
    # Only Page 2's figure should be extracted (Page 1 has none, Page 3 has tiny icon < 32px)
    assert len(extracted) == 1
    assert extracted[0].page_number == 2
    assert extracted[0].pixel_width == 100
    assert extracted[0].pixel_height == 100
    _assert_box(extracted[0], (100, 400, 150, 150))


def test_unsupported_elements_and_mixture_salts_validation() -> None:
    """Verify validation flags unsupported transition elements and multi-component mixtures."""
    # 1. Transition element (Chromium coordination) -> UNSUPPORTED
    v_cr = validate_molecular_graph_proposal("[Cr](Cl)(Cl)Cl")
    assert v_cr.status == RecognitionStatus.UNSUPPORTED
    assert any("Cr" in w or "specialist" in w for w in v_cr.warnings)

    # 2. Salt / mixture with disconnected fragments -> AMBIGUOUS
    v_salt = validate_molecular_graph_proposal("CCO.c1ccccc1")
    assert v_salt.status == RecognitionStatus.AMBIGUOUS
    assert any("disconnected fragments" in w.lower() for w in v_salt.warnings)

    # 3. Unassigned chiral center -> AMBIGUOUS
    v_chiral = validate_molecular_graph_proposal("CC(O)C(=O)O")
    assert v_chiral.status == RecognitionStatus.AMBIGUOUS
    assert any("unassigned" in a.lower() for a in v_chiral.ambiguities)


def test_object_storage_integrity_and_deterministic_sha256(api) -> None:
    """Verify figure images in object store are deterministic PNGs with matching SHA-256."""
    client, _sessions, _settings = api
    project = _project(client, "Storage Integrity Project")

    img = Image.new("RGB", (80, 80), color=(123, 234, 45))
    pdf_bytes = _make_raster_pdf([(img, (50, 400, 100, 100))])

    import_resp = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("integrity.pdf", pdf_bytes, "application/pdf")},
    )
    doc_id = import_resp.json()["document"]["id"]

    extract_resp = client.post(f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract")
    candidate_id = extract_resp.json()["candidates"][0]["id"]

    fig_resp = client.get(
        f"/v1/projects/{project['id']}/structure-candidates/{candidate_id}/figure"
    )
    assert fig_resp.status_code == 200
    png_bytes = fig_resp.content

    # Validate PNG magic header
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"

    # SHA-256 of the served bytes must equal the SHA-256 recorded at extraction time
    import hashlib

    with _sessions() as session:
        rep = session.scalar(
            select(CandidateRepresentationRecord).where(
                CandidateRepresentationRecord.candidate_id == candidate_id,
                CandidateRepresentationRecord.representation_type == "IMAGE_REFERENCE",
            )
        )
        assert rep.content_sha256 == hashlib.sha256(png_bytes).hexdigest()
        assert rep.payload_json["image_sha256"] == rep.content_sha256
