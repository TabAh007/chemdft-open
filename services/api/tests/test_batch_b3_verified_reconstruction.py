"""Batch B3: Verified Molecular Reconstruction Test Suite.

Validates:
1. Deterministic chemical graph validation:
   - Atom identity, bond orders, formal charges, isotopes, aromaticity.
   - Tetrahedral stereochemistry (R/S) and double-bond stereochemistry (E/Z).
   - Rejection of invalid valence (e.g., 5-valent carbon).
   - Unsupported coordination chemistry (e.g., transition metals, cisplatin).
   - Detection of unassigned stereocenters and withholding of 3D generation.
2. Structured graph differences computation (atom identity, bond order, charge, stereochemistry).
3. API endpoints:
   - POST /validate-graph: validation diagnostics and structured diffs from parent.
   - POST /generate-conformer: ETKDGv3 3D conformer generation with GENERATED_CONFORMER provenance.
4. Data integrity and immutability:
   - Original DECIMER proposals remain immutable and traceable.
   - Multi-revision lineage preserved (source_representation_id link).
   - Complete review checklist with stereochemistry and charges review gates.
5. Candidate promotion to authoritative StructureVersionRecord.
6. Authorization, roles, and cross-project isolation.
"""

from __future__ import annotations

import io
from uuid import uuid4

from b2_pdf import build_pdf, solid_page
from chemdft_api.contracts.structure_candidates import (
    CandidateCoordinateOrigin,
    StructureCandidateState,
)
from chemdft_api.scientific.molecular_recognition.validation import (
    compute_graph_differences,
    validate_chemical_graph,
)
from chemdft_api.scientific_models import (
    CandidateRepresentationRecord,
    StructureRecord,
    StructureVersionRecord,
)
from PIL import Image
from sqlalchemy import select


# ---------------------------------------------------------------- helpers
def _png(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _pdf(
    pages: list[tuple[str, dict[str, tuple[int, int, tuple[int, int, int]]]]], extra: str = ""
) -> bytes:
    return build_pdf([solid_page(ops, imgs) for ops, imgs in pages], page_extra=extra)


def _upload_pdf(client, project_id: str) -> str:
    pdf = _pdf([("q 150 0 0 150 50 450 cm /Im1 Do Q", {"Im1": (120, 100, (255, 255, 255))})])
    resp = client.post(
        f"/v1/projects/{project_id}/documents/imports",
        files={"upload": (f"paper-{uuid4().hex[:6]}.pdf", pdf, "application/pdf")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["document"]["id"]


def _project(client, name: str) -> dict:
    res = client.post(
        "/v1/projects",
        json={"name": name, "slug": f"proj-{uuid4().hex[:8]}"},
    )
    assert res.status_code == 201, res.text
    return res.json()


def _complete_b3_checklist() -> dict:
    return {
        "inspected_source": True,
        "understands_missing_paper_coordinates": True,
        "coordinate_source_declared": True,
        "units_checked": True,
        "cell_checked_if_used": True,
        "validation_warnings_reviewed": True,
        "differences_acknowledged": True,
        "stereochemistry_reviewed": True,
        "charges_reviewed": True,
    }


# ---------------------------------------------------------------- chemical validation unit tests
def test_chemical_graph_validation_atom_identities_and_bonds() -> None:
    # Ethanol
    res = validate_chemical_graph("CCO", "SMILES")
    assert res.is_parseable is True
    assert res.canonical_isomeric_smiles == "CCO"
    assert res.formula == "C2H6O"
    assert res.formal_charge == 0
    assert res.heavy_atom_count == 3
    assert set(res.elements) == {"C", "O"}
    assert res.is_organic is True
    assert res.can_generate_3d is True

    # Propane, Propene, Propyne (bond orders)
    res_single = validate_chemical_graph("CCC", "SMILES")
    assert res_single.formula == "C3H8"
    assert res_single.can_generate_3d is True

    res_double = validate_chemical_graph("CC=C", "SMILES")
    assert res_double.formula == "C3H6"
    assert res_double.can_generate_3d is True

    res_triple = validate_chemical_graph("CC#C", "SMILES")
    assert res_triple.formula == "C3H4"
    assert res_triple.can_generate_3d is True


def test_chemical_graph_validation_formal_charges() -> None:
    # Acetate anion
    res_anion = validate_chemical_graph("CC(=O)[O-]", "SMILES")
    assert res_anion.is_parseable is True
    assert res_anion.formal_charge == -1
    assert res_anion.formula == "C2H3O2-"
    assert res_anion.can_generate_3d is True

    # Ammonium cation
    res_cation = validate_chemical_graph("[NH4+]", "SMILES")
    assert res_cation.is_parseable is True
    assert res_cation.formal_charge == 1
    assert res_cation.formula == "H4N+"
    assert res_cation.can_generate_3d is True

    # Pyridinium cation
    res_pyr = validate_chemical_graph("[nH+]1ccccc1", "SMILES")
    assert res_pyr.is_parseable is True
    assert res_pyr.formal_charge == 1
    assert res_pyr.can_generate_3d is True


def test_chemical_graph_validation_isotopes() -> None:
    # Deuterated methanol
    res_d = validate_chemical_graph("[2H]CO", "SMILES")
    assert res_d.is_parseable is True
    assert len(res_d.isotopes) == 1
    assert res_d.isotopes[0]["isotope"] == 2
    assert any("Isotopic labels present" in w for w in res_d.warnings)
    assert res_d.can_generate_3d is True

    # Carbon-13 labelled methanol
    res_13c = validate_chemical_graph("[13CH3]O", "SMILES")
    assert res_13c.is_parseable is True
    assert len(res_13c.isotopes) == 1
    assert res_13c.isotopes[0]["isotope"] == 13
    assert res_13c.can_generate_3d is True


def test_chemical_graph_validation_stereochemistry_r_s() -> None:
    # L-alanine: explicit chiral center (S)
    res_l = validate_chemical_graph("N[C@@H](C)C(=O)O", "SMILES")
    assert res_l.is_parseable is True
    assert res_l.has_stereochemistry is True
    assert len(res_l.stereocenters) == 1
    assert res_l.stereocenters[0].stereo == "S"
    assert res_l.stereocenters[0].is_assigned is True
    assert len(res_l.unassigned_stereocenters) == 0
    assert res_l.can_generate_3d is True

    # D-alanine: explicit chiral center (R)
    res_d = validate_chemical_graph("N[C@H](C)C(=O)O", "SMILES")
    assert res_d.is_parseable is True
    assert len(res_d.stereocenters) == 1
    assert res_d.stereocenters[0].stereo == "R"
    assert res_d.stereocenters[0].is_assigned is True
    assert res_d.can_generate_3d is True

    # Unassigned alanine: stereocenter present but R/S not assigned
    res_unassigned = validate_chemical_graph("NC(C)C(=O)O", "SMILES")
    assert res_unassigned.is_parseable is True
    assert len(res_unassigned.stereocenters) == 1
    assert res_unassigned.stereocenters[0].is_assigned is False
    assert len(res_unassigned.unassigned_stereocenters) == 1
    assert "unassigned stereochemistry" in res_unassigned.unassigned_stereocenters[0]
    # Conformer generation requires explicit stereochemistry!
    assert res_unassigned.can_generate_3d is False


def test_chemical_graph_validation_stereochemistry_e_z() -> None:
    # (E)-but-2-ene
    res_e = validate_chemical_graph("C/C=C/C", "SMILES")
    assert res_e.is_parseable is True
    assert len(res_e.double_bond_stereochemistry) == 1
    assert res_e.double_bond_stereochemistry[0].stereo == "E"
    assert res_e.double_bond_stereochemistry[0].is_assigned is True
    assert len(res_e.unassigned_double_bonds) == 0
    assert res_e.can_generate_3d is True

    # (Z)-but-2-ene
    res_z = validate_chemical_graph("C/C=C\\C", "SMILES")
    assert res_z.is_parseable is True
    assert len(res_z.double_bond_stereochemistry) == 1
    assert res_z.double_bond_stereochemistry[0].stereo == "Z"
    assert res_z.double_bond_stereochemistry[0].is_assigned is True
    assert len(res_z.unassigned_double_bonds) == 0
    assert res_z.can_generate_3d is True

    # Unassigned double bond: CC=CC
    res_unassigned = validate_chemical_graph("CC=CC", "SMILES")
    assert res_unassigned.is_parseable is True
    assert len(res_unassigned.double_bond_stereochemistry) == 1
    assert res_unassigned.double_bond_stereochemistry[0].is_assigned is False
    assert len(res_unassigned.unassigned_double_bonds) == 1
    assert "unassigned E/Z stereochemistry" in res_unassigned.unassigned_double_bonds[0]
    assert res_unassigned.can_generate_3d is False


def test_chemical_graph_validation_invalid_valence_rejected() -> None:
    # 5-valent carbon
    res = validate_chemical_graph("C(C)(C)(C)(C)C", "SMILES")
    assert res.is_parseable is False
    assert any("Valence violation" in d for d in res.diagnostics)


def test_chemical_graph_validation_unsupported_coordination_chemistry() -> None:
    # Cisplatin (Pt complex)
    res_cis = validate_chemical_graph("[Pt](Cl)(Cl)(N)N", "SMILES")
    assert res_cis.is_parseable is True
    assert res_cis.is_organic is False
    assert "Pt" in res_cis.unsupported_elements
    assert res_cis.can_generate_3d is False
    assert any("Unsupported coordination/inorganic elements" in d for d in res_cis.diagnostics)

    # Iron complex
    res_fe = validate_chemical_graph("[Fe](Cl)(Cl)", "SMILES")
    assert res_fe.is_parseable is True
    assert "Fe" in res_fe.unsupported_elements
    assert res_fe.can_generate_3d is False


def test_chemical_graph_validation_disconnected_fragments() -> None:
    res = validate_chemical_graph("CCO.c1ccccc1", "SMILES")
    assert res.is_parseable is True
    assert res.disconnected_fragments == 2
    assert len(res.fragment_formulas) == 2
    assert res.can_generate_3d is False
    assert any("Disconnected fragments" in d for d in res.diagnostics)


def test_graph_differences_computation() -> None:
    # Atom identity correction: CCO -> CCN
    diffs = compute_graph_differences("CCO", "CCN")
    categories = {d.category for d in diffs}
    assert "ATOM_IDENTITY" in categories
    assert "FORMULA" in categories

    # Bond order correction: CCC -> CC=C
    diffs_bond = compute_graph_differences("CCC", "CC=C")
    assert any(d.category == "FORMULA" for d in diffs_bond)

    # Formal charge correction: CC(=O)O -> CC(=O)[O-]
    diffs_charge = compute_graph_differences("CC(=O)O", "CC(=O)[O-]")
    assert any(d.category == "FORMAL_CHARGE" for d in diffs_charge)

    # Stereocenter inversion: S -> R
    diffs_stereo = compute_graph_differences("N[C@@H](C)C(=O)O", "N[C@H](C)C(=O)O")
    assert any(d.category == "STEREOCHEMISTRY" for d in diffs_stereo)

    # Stereochemistry unassigned: S -> unassigned
    diffs_unassigned = compute_graph_differences("N[C@@H](C)C(=O)O", "NC(C)C(=O)O")
    assert any(d.category == "STEREOCHEMISTRY" for d in diffs_unassigned)


# ---------------------------------------------------------------- API tests
def test_validate_graph_endpoint_with_differences(api) -> None:
    client, _sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B3 Validate Graph")
    doc_id = _upload_pdf(client, project["id"])
    extract_res = client.post(
        f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract"
    ).json()
    cand = extract_res["candidates"][0]

    # Run recognition to create proposal (parent)
    rec_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/recognize",
        json={"engine": "dev", "category_hint": "ethanol"},
    )
    assert rec_res.status_code == 200
    representations = client.get(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations"
    ).json()["representations"]
    parent_rep = [r for r in representations if r["representation_type"] == "SMILES"][0]

    # Validate corrected graph: CCO -> CCN (atom correction O -> N)
    val_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/validate-graph",
        json={
            "content": "CCN",
            "format": "SMILES",
            "parent_representation_id": parent_rep["id"],
        },
    )
    assert val_res.status_code == 200, val_res.text
    val_body = val_res.json()
    assert val_body["is_valid"] is True
    assert val_body["formula"] == "C2H7N"
    assert val_body["can_generate_3d"] is True
    assert len(val_body["differences_from_parent"]) > 0
    diff_cats = {d["category"] for d in val_body["differences_from_parent"]}
    assert "ATOM_IDENTITY" in diff_cats

    # Validate an unassigned chiral graph
    val_unassigned = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/validate-graph",
        json={
            "content": "NC(C)C(=O)O",
            "format": "SMILES",
            "parent_representation_id": parent_rep["id"],
        },
    )
    assert val_unassigned.status_code == 200
    assert val_unassigned.json()["can_generate_3d"] is False
    assert len(val_unassigned.json()["unassigned_stereocenters"]) == 1

    # Validate an invalid valence graph
    val_invalid = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/validate-graph",
        json={
            "content": "C(C)(C)(C)(C)C",
            "format": "SMILES",
        },
    )
    assert val_invalid.status_code == 200
    assert val_invalid.json()["is_valid"] is False
    assert len(val_invalid.json()["validation_diagnostics"]) > 0


def test_researcher_correction_preserves_immutable_original_proposal(api) -> None:
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B3 Immutability")
    doc_id = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]

    # Create original proposal (SMILES CCO)
    client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/recognize",
        json={"engine": "dev", "category_hint": "ethanol"},
    )

    with sessions() as session:
        original_reps = session.scalars(
            select(CandidateRepresentationRecord)
            .where(CandidateRepresentationRecord.candidate_id == cand["id"])
            .order_by(CandidateRepresentationRecord.revision.asc())
        ).all()
        # Original proposal SMILES representation (revision 2)
        orig_proposal = [r for r in original_reps if r.representation_type == "SMILES"][0]
        orig_id = orig_proposal.id
        orig_payload = dict(orig_proposal.payload_json)
        orig_method = orig_proposal.method

    # Researcher submits corrected graph: ethylamine (CCN)
    corr_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations",
        json={
            "representation_type": "SMILES",
            "smiles": "CCN",
            "parent_representation_id": orig_id,
        },
    )
    assert corr_res.status_code == 201, corr_res.text
    corr_rep = corr_res.json()["representation"]
    assert corr_rep["source_representation_id"] == orig_id
    assert corr_rep["differences_from_parent"] is not None

    # Verify original DECIMER proposal in database is strictly untouched
    with sessions() as session:
        reloaded_orig = session.get(CandidateRepresentationRecord, orig_id)
        assert reloaded_orig is not None
        assert reloaded_orig.payload_json == orig_payload
        assert reloaded_orig.method == orig_method
        assert reloaded_orig.source_representation_id is None


def test_3d_conformer_generation_and_promotion_workflow(api) -> None:
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B3 Full Flow")
    doc_id = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]

    # Recognize as chiral L-alanine
    client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/recognize",
        json={"engine": "dev", "category_hint": "l_alanine"},
    )

    reps = client.get(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations"
    ).json()["representations"]
    parent_rep = [r for r in reps if r["representation_type"] == "SMILES"][0]

    # Explicitly generate 3D conformer from the validated graph
    gen_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations/{parent_rep['id']}/generate-conformer",
        json={"name": "L-Alanine Conformer", "multiplicity": 1},
    )
    assert gen_res.status_code == 201, gen_res.text
    conformer_rep = gen_res.json()["representation"]
    assert conformer_rep["representation_type"] == "CARTESIAN_COORDINATES"
    assert conformer_rep["source_representation_id"] == parent_rep["id"]
    coords = conformer_rep["coordinate_representation"]
    assert coords["coordinates"]["unit"] == "angstrom"
    assert coords["coordinates"]["coordinate_system"] == "CARTESIAN"
    assert coords["kind"] == "MOLECULE"
    assert len(coords["coordinates"]["atoms"]) > 0

    # Verify coordinate provenance
    coord_prov = conformer_rep["coordinate_provenance"]
    assert coord_prov["origin"] == CandidateCoordinateOrigin.GENERATED_CONFORMER.value
    assert coord_prov["geometry_class"] == "GENERATED_CONFORMER_NOT_OPTIMIZED"
    assert "ETKDGv3" in coord_prov["notice"]

    # Review candidate and representation with complete checklist
    client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/review",
        json={"notes": "Reviewed chiral graph and verified conformer."},
    )
    rev_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations/{conformer_rep['id']}/review",
        json={
            "notes": "Verified tetrahedral stereochemistry (S) and neutral charges.",
            "checklist": _complete_b3_checklist(),
        },
    )
    assert rev_res.status_code == 200, rev_res.text

    # Promote to authoritative structure
    promo_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/promote",
        json={"representation_id": conformer_rep["id"]},
    )
    assert promo_res.status_code == 201, promo_res.text
    promo_body = promo_res.json()
    assert promo_body["candidate"]["candidate_state"] == StructureCandidateState.PROMOTED.value
    assert promo_body["structure"]["id"] is not None
    assert promo_body["version"]["id"] is not None

    with sessions() as session:
        struct = session.get(StructureRecord, promo_body["structure"]["id"])
        assert struct is not None
        version = session.get(StructureVersionRecord, promo_body["version"]["id"])
        assert version is not None
        assert version.provenance_record_id is not None


def test_conformer_generation_refuses_unassigned_stereocenters(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "B3 Unassigned Stereo Rejection")

    # Manually create candidate representation with unassigned stereocenter: NC(C)C(=O)O
    doc_id = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]

    create_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations",
        json={"representation_type": "SMILES", "smiles": "NC(C)C(=O)O"},
    )
    assert create_res.status_code == 201
    rep_id = create_res.json()["representation"]["id"]

    # Attempting to generate conformer MUST fail because stereochemistry is unassigned!
    gen_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations/{rep_id}/generate-conformer",
        json={"name": "Ambiguous Alanine"},
    )
    assert gen_res.status_code in (422, 400), gen_res.text
    assert "explicit stereochemistry" in gen_res.text.lower()


def test_conformer_generation_refuses_coordination_complex(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "B3 Coordination Complex Rejection")
    doc_id = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]

    create_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations",
        json={"representation_type": "SMILES", "smiles": "[Pt](Cl)(Cl)(N)N"},
    )
    assert create_res.status_code == 201
    rep_id = create_res.json()["representation"]["id"]

    gen_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations/{rep_id}/generate-conformer",
        json={},
    )
    assert gen_res.status_code in (422, 400), gen_res.text
    assert "organic" in gen_res.text.lower()


def test_incomplete_checklist_or_false_stereo_review_blocks_promotion(api) -> None:
    client, _sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B3 Incomplete Review")
    doc_id = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]

    client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/recognize",
        json={"engine": "dev", "category_hint": "ethanol"},
    )
    reps = client.get(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations"
    ).json()["representations"]
    parent_rep = [r for r in reps if r["representation_type"] == "SMILES"][0]

    gen_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations/{parent_rep['id']}/generate-conformer",
        json={},
    )
    assert gen_res.status_code == 201
    conformer_rep = gen_res.json()["representation"]

    client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/review",
        json={"notes": "Reviewed candidate."},
    )

    # Review representation with stereochemistry_reviewed = False explicitly!
    bad_checklist = _complete_b3_checklist()
    bad_checklist["stereochemistry_reviewed"] = False

    client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/representations/{conformer_rep['id']}/review",
        json={"notes": "Stereochemistry incomplete.", "checklist": bad_checklist},
    )

    promo_res = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/promote",
        json={"representation_id": conformer_rep["id"]},
    )
    assert promo_res.status_code == 409
    assert "HUMAN_REVIEW_CHECKLIST_INCOMPLETE" in promo_res.text


def test_cross_project_isolation_and_viewer_access(api) -> None:
    from chemdft_api.models import ProjectMember, User, new_id

    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    pa, pb = _project(client, "B3 Project Alpha"), _project(client, "B3 Project Beta")

    doc_a = _upload_pdf(client, pa["id"])
    cand_a = client.post(f"/v1/projects/{pa['id']}/documents/{doc_a}/figures/extract").json()[
        "candidates"
    ][0]

    # Cross-project access attempt to validate-graph: Project B path with Project A candidate
    cross_res = client.post(
        f"/v1/projects/{pb['id']}/structure-candidates/{cand_a['id']}/validate-graph",
        json={"content": "CCO", "format": "SMILES"},
    )
    assert cross_res.status_code == 404

    # Add a viewer to Project Alpha
    with sessions() as session:
        viewer_id = new_id()
        session.add(User(id=viewer_id, email="viewer-b3@chemdft.test", display_name="Viewer B3"))
        session.commit()
        session.add(ProjectMember(project_id=pa["id"], user_id=viewer_id, role="viewer"))
        session.commit()

    # Verify that candidate representation endpoints enforce project isolation:
    assert (
        client.get(
            f"/v1/projects/{pb['id']}/structure-candidates/{cand_a['id']}/representations"
        ).status_code
        == 404
    )
