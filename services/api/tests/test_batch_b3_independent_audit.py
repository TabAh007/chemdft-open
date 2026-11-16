"""Independent B3 audit: adversarial chemistry, lineage, review-gate and API-safety tests.

These complement ``test_batch_b3_verified_reconstruction.py``. Chemistry checks do not rely on
formula or canonical SMILES equality alone: generated conformers are re-read from their
Cartesian coordinates (bond orders from the stored graph, stereo perceived from 3D) and compared
with the researcher's graph; differences are checked for atom-order independence.
"""

from __future__ import annotations

import math
from uuid import uuid4

import pytest
from chemdft_api.contracts.structure_candidates import (
    CandidateRepresentationReviewChecklist,
)
from chemdft_api.errors import ScientificValidationFailed
from chemdft_api.scientific.molecular_geometry import generate_conformer
from chemdft_api.scientific.molecular_recognition.validation import (
    compute_graph_differences,
    validate_chemical_graph,
)
from chemdft_api.scientific_models import CandidateRepresentationRecord
from rdkit import Chem
from rdkit.Chem import AllChem
from sqlalchemy import func, select
from test_batch_b3_verified_reconstruction import (
    _complete_b3_checklist,
    _pdf,
    _project,
)

BASE = "/v1/projects/{p}/structure-candidates"


def _categories(a: str, b: str, fa: str = "SMILES", fb: str = "SMILES") -> set[str]:
    return {d.category for d in compute_graph_differences(a, b, fa, fb)}


def _mol_block(smiles: str, *, wedge: bool = True, three_d: bool = False) -> str:
    mol = Chem.MolFromSmiles(smiles)
    if three_d:
        mol = Chem.AddHs(mol)
        AllChem.EmbedMolecule(mol, randomSeed=7)
        return Chem.MolToMolBlock(mol)
    AllChem.Compute2DCoords(mol)
    if wedge:
        Chem.WedgeMolBonds(mol, mol.GetConformer())
    return Chem.MolToMolBlock(mol)


def _reread_from_coordinates(coordinates) -> str:
    """Independent identity: rebuild an RDKit molecule from the stored Cartesian payload only."""
    atoms = coordinates.coordinates.atoms
    rw = Chem.RWMol()
    for atom in atoms:
        rd_atom = Chem.Atom(atom.atomic_number)
        if atom.isotope:
            rd_atom.SetIsotope(atom.isotope)
        rd_atom.SetFormalCharge(atom.formal_charge or 0)
        rd_atom.SetNoImplicit(True)
        rw.AddAtom(rd_atom)
    orders = {
        1.0: Chem.BondType.SINGLE,
        2.0: Chem.BondType.DOUBLE,
        3.0: Chem.BondType.TRIPLE,
        1.5: Chem.BondType.AROMATIC,
    }
    for bond in coordinates.coordinates.bonds:
        rw.AddBond(bond.atom_index_a, bond.atom_index_b, orders[float(bond.order)])
        if float(bond.order) == 1.5:
            for idx in (bond.atom_index_a, bond.atom_index_b):
                rw.GetAtomWithIdx(idx).SetIsAromatic(True)
            rw.GetBondWithIdx(rw.GetNumBonds() - 1).SetIsAromatic(True)
    mol = rw.GetMol()
    conformer = Chem.Conformer(len(atoms))
    for atom in atoms:
        conformer.SetAtomPosition(atom.index, (atom.x, atom.y, atom.z))
    conformer.Set3D(True)
    mol.AddConformer(conformer)
    Chem.SanitizeMol(mol)
    Chem.AssignStereochemistryFrom3D(mol)
    return Chem.MolToSmiles(Chem.RemoveHs(mol), isomericSmiles=True)


# ------------------------------------------------------------------ MOL block handling
def test_ketcher_style_mol_block_with_blank_title_line_parses() -> None:
    """Regression: stripping the blank title line shifted the MOL header and failed parsing."""
    block = _mol_block("N[C@@H](C)C(=O)O")
    assert block.startswith("\n"), "RDKit/Ketcher MOL blocks start with a blank title line"
    result = validate_chemical_graph(block, "MOL")
    assert result.is_parseable, result.diagnostics
    assert [c.stereo for c in result.stereocenters] == ["S"]
    assert result.can_generate_3d is True
    assert result.canonical_isomeric_smiles == "C[C@H](N)C(=O)O"
    # A JSON layer or client that stripped the blank title line is repaired, not rejected.
    stripped = validate_chemical_graph(block.strip(), "MOL")
    assert stripped.is_parseable and stripped.canonical_isomeric_smiles == "C[C@H](N)C(=O)O"
    # CRLF line endings (Windows exports) are accepted too.
    assert validate_chemical_graph(block.replace("\n", "\r\n"), "MOL_BLOCK").is_parseable


@pytest.mark.parametrize(
    ("smiles", "expected"),
    [
        ("C/C=C/C", "E"),
        ("C/C=C\\C", "Z"),
    ],
)
def test_mol_block_double_bond_geometry_is_perceived_as_e_or_z(smiles: str, expected: str) -> None:
    result = validate_chemical_graph(_mol_block(smiles), "MOL")
    assert result.is_parseable and result.can_generate_3d
    assert [(b.stereo, b.is_assigned) for b in result.double_bond_stereochemistry] == [
        (expected, True)
    ]


def test_mol_block_charge_and_isotope_survive_and_explicit_hydrogens_are_not_identity() -> None:
    result = validate_chemical_graph(_mol_block("[NH3+]C[13CH2]C(=O)[O-]"), "MOL")
    assert result.formal_charge == 0
    assert any(i["isotope"] == 13 for i in result.isotopes)
    assert result.canonical_isomeric_smiles == "[NH3+]C[13CH2]C(=O)[O-]"
    three_d = validate_chemical_graph(_mol_block("N[C@@H](C)C(=O)O", three_d=True), "MOL")
    assert three_d.canonical_isomeric_smiles == "C[C@H](N)C(=O)O"
    assert [c.stereo for c in three_d.stereocenters] == ["S"]


def test_oversized_and_malformed_inputs_are_rejected_before_any_persistence_work() -> None:
    assert validate_chemical_graph("C" * 5000, "SMILES").is_parseable is False
    for text in (
        "garbage",
        "\n\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n",
        "C(C)(C)(C)(C)C",
    ):
        for fmt in ("MOL", "SMILES"):
            result = validate_chemical_graph(text, fmt)
            assert result.is_parseable is False and result.can_generate_3d is False


def test_trailing_text_after_a_smiles_is_not_silently_dropped() -> None:
    assert validate_chemical_graph("CCO CCN", "SMILES").is_parseable is False
    assert validate_chemical_graph("CCO\nCCN", "SMILES").is_parseable is False
    assert validate_chemical_graph("  CCO\n", "SMILES").is_parseable is True
    # CXSMILES extensions are meaningful chemistry and stay accepted.
    cx = validate_chemical_graph("C[C@H](F)Cl |o1:1|", "SMILES")
    assert cx.is_parseable and cx.can_generate_3d is False


def test_relative_stereo_dative_bonds_and_rgroups_withhold_3d() -> None:
    enhanced = Chem.MolFromSmiles("C[C@H](F)Cl |o1:1|")
    block = Chem.MolToMolBlock(enhanced, forceV3000=True)
    relative = validate_chemical_graph(block, "MOL")
    assert relative.is_parseable and relative.can_generate_3d is False
    assert any("AND/OR" in d for d in relative.diagnostics)

    dative = validate_chemical_graph("C[NH2]->[BH3]", "SMILES")
    assert dative.can_generate_3d is False

    rgroup = validate_chemical_graph(
        "\n  test\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n"
        "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n"
        "    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n"
        "    3.0000    0.0000    0.0000 R#  0  0  0  0  0  0  0  0  0  0  0  0\n"
        "  1  2  1  0\n  2  3  1  0\nM  RGP  1   3   1\nM  END\n",
        "MOL",
    )
    assert rgroup.is_parseable and rgroup.can_generate_3d is False
    assert not rgroup.unsupported_elements, "an R-group is a wildcard, not an inorganic element"


def test_radicals_salts_and_metals_are_never_generated() -> None:
    for smiles in ("[CH3]", "[Na+].[Cl-]", "c1ccccc1[Fe]", "C[Se]C", "CC=CC", "NC(C)C(=O)O"):
        assert validate_chemical_graph(smiles, "SMILES").can_generate_3d is False, smiles


# ------------------------------------------------------------------ graph differences
def test_differences_are_atom_order_independent() -> None:
    assert compute_graph_differences("N[C@@H](C)C(=O)O", "OC(=O)[C@H](C)N") == ()
    assert compute_graph_differences("[O-]CC[NH3+]", "[NH3+]CC[O-]") == ()
    # meso-2,3-butanediol written from either end: a constitutional automorphism swaps R and S.
    assert compute_graph_differences("C[C@H](O)[C@@H](C)O", "C[C@@H](O)[C@H](C)O") == ()
    # ...whereas (R,R)/(S,S) differ from meso and must be reported.
    assert _categories("C[C@H](O)[C@@H](C)O", "O[C@@H](C)[C@H](C)O") == {"STEREOCHEMISTRY"}
    assert compute_graph_differences("OC(=O)/C=C/C(=O)O", "O=C(O)/C=C/C(O)=O") == ()
    assert _categories("N[C@@H](C)C(=O)O", "OC(=O)[C@@H](C)N") == {"STEREOCHEMISTRY"}


def test_e_and_z_are_distinguished_in_both_directions() -> None:
    assert _categories("C/C=C/C", "C/C=C\\C") == {"DOUBLE_BOND_STEREOCHEMISTRY"}
    assert _categories("C/C=C\\C", "C/C=C/C") == {"DOUBLE_BOND_STEREOCHEMISTRY"}
    assert _categories("C/C=C/C", "CC=CC") == {"DOUBLE_BOND_STEREOCHEMISTRY"}
    both = _categories("C[C@H](F)/C=C/C", "C[C@@H](F)/C=C\\C")
    assert both == {"STEREOCHEMISTRY", "DOUBLE_BOND_STEREOCHEMISTRY"}


def test_charge_and_isotope_relocation_are_reported_as_such() -> None:
    assert _categories("[13CH3]CO", "C[13CH2]O") == {"ISOTOPE"}
    # explicit isotopic hydrogens are graph atoms: moving one is reported (as connectivity)
    assert _categories("[2H]CO", "CO[2H]") == {"BOND_CONNECTIVITY"}
    assert compute_graph_differences("[13CH3]CO", "C[13CH2]O")[0].description.endswith(
        "relocated to different atoms"
    )
    assert _categories("[O-]c1ccccc1C", "Oc1ccccc1[CH2-]") == {"FORMAL_CHARGE"}
    assert _categories("CC(=O)[O-]", "CC(=O)O") >= {"FORMAL_CHARGE", "FORMULA"}


def test_constitution_bond_order_and_identity_changes_are_not_conflated() -> None:
    assert _categories("CCCO", "CC(C)O") == {"BOND_CONNECTIVITY"}  # identical formula
    assert _categories("CC(=O)N", "CC(O)=N") == {"BOND_ORDER"}  # tautomer: same connectivity
    assert "ATOM_IDENTITY" in _categories("CCO", "CCN")
    assert _categories("CCC", "CC=C") >= {"FORMULA", "BOND_ORDER"}


def test_invalid_or_empty_parent_is_reported_not_ignored() -> None:
    diffs = compute_graph_differences("C(C)(C)(C)(C)C", "CCO")
    assert [d.category for d in diffs] == ["MOLECULAR_IDENTITY"]


# ------------------------------------------------------------------ 3D conformer verification
CONFORMER_PANEL = [
    "N[C@@H](C)C(=O)O",
    "N[C@H](C)C(=O)O",
    "C/C=C/C",
    "C/C=C\\C",
    "OC(=O)/C=C/C(=O)O",
    "OC(=O)/C=C\\C(=O)O",
    "[NH3+]CC(=O)[O-]",
    "C[N+](C)(C)CC(=O)[O-]",
    "[2H]C[C@H](F)Cl",
    "C[13CH2]O",
    "[13CH3]CO",
    "C[C@H](O)[C@@H](C)O",
    "C[C@H](O)[C@H](C)O",
    "O[C@H]1CC[C@@H](O)CC1",
    "O[C@H]1CC[C@H](O)CC1",
    "C[S@](=O)CC",
    "C[S@@](=O)CC",
    "[O-][N+](=O)c1ccccc1",
    "c1ccc2ccccc2c1",
    "FC(F)(F)[C@H](Cl)Br",
    "C[N@@+](CC)(CCC)CCCC",
]


@pytest.mark.parametrize("smiles", CONFORMER_PANEL)
def test_generated_conformer_reproduces_graph_stereo_charge_and_isotopes_from_coordinates(
    smiles: str,
) -> None:
    source = validate_chemical_graph(smiles, "SMILES")
    assert source.can_generate_3d, source.diagnostics
    geometry = generate_conformer(source.mol, "audit")
    coordinates = geometry.coordinates
    assert coordinates.coordinates.unit.value == "angstrom"
    assert coordinates.overall_charge == source.formal_charge
    assert coordinates.multiplicity == 1
    atoms = coordinates.coordinates.atoms
    assert all(math.isfinite(v) for a in atoms for v in (a.x, a.y, a.z))

    # Identity and stereochemistry measured from the coordinates, not from the input string.
    expected = Chem.MolToSmiles(Chem.RemoveHs(source.mol), isomericSmiles=True)
    assert _reread_from_coordinates(coordinates) == expected

    # Charges and isotopes sit on the same atoms as in the graph.
    source_atoms = [
        (a.GetAtomicNum(), a.GetIsotope(), a.GetFormalCharge()) for a in source.mol.GetAtoms()
    ]
    generated_atoms = [(a.atomic_number, a.isotope or 0, a.formal_charge) for a in atoms]
    assert generated_atoms[: len(source_atoms)] == source_atoms

    # Physically sensible geometry: covalent bonds near the radius sum, no overlapping atoms.
    table = Chem.GetPeriodicTable()
    for bond in coordinates.coordinates.bonds:
        a, b = atoms[bond.atom_index_a], atoms[bond.atom_index_b]
        length = math.dist((a.x, a.y, a.z), (b.x, b.y, b.z))
        reference = table.GetRcovalent(a.atomic_number) + table.GetRcovalent(b.atomic_number)
        assert 0.75 * reference <= length <= 1.3 * reference, (smiles, a.element, b.element, length)
    for i, a in enumerate(atoms):
        for b in atoms[:i]:
            assert math.dist((a.x, a.y, a.z), (b.x, b.y, b.z)) > 0.7


def test_conformer_generation_is_deterministic_and_inversion_changes_coordinates_chirality() -> (
    None
):
    first = generate_conformer(validate_chemical_graph("N[C@@H](C)C(=O)O", "SMILES").mol, "a")
    second = generate_conformer(validate_chemical_graph("N[C@@H](C)C(=O)O", "SMILES").mol, "a")
    assert first.coordinates.model_dump() == second.coordinates.model_dump()
    mirror = generate_conformer(validate_chemical_graph("N[C@H](C)C(=O)O", "SMILES").mol, "a")
    assert _reread_from_coordinates(first.coordinates) != _reread_from_coordinates(
        mirror.coordinates
    )


def test_conformer_refuses_unsupported_chemistry_and_multiplicity_mismatch() -> None:
    mol = validate_chemical_graph("CCO", "SMILES").mol
    for multiplicity in (2, 3):
        with pytest.raises(ScientificValidationFailed, match="MULTIPLICITY"):
            generate_conformer(mol, "x", multiplicity=multiplicity)
    for smiles in ("[CH3]", "NC(C)C(=O)O", "CC=CC", "[Na+].[Cl-]"):
        raw = Chem.MolFromSmiles(smiles)
        with pytest.raises(ScientificValidationFailed):
            generate_conformer(raw, "x")
    odd_electrons = Chem.MolFromSmiles("[NH3+][O]")  # radical cation: odd electron count
    with pytest.raises(ScientificValidationFailed):
        generate_conformer(odd_electrons, "x")


# ------------------------------------------------------------------ review gate
_PDF_SEQUENCE = iter(range(1, 10_000))


def _candidate(client, project_id: str) -> str:
    """A fresh structure candidate: every call uploads a distinct PDF (identical bytes dedupe)."""
    shade = next(_PDF_SEQUENCE)
    pdf = _pdf(
        [
            (
                "q 150 0 0 150 50 450 cm /Im1 Do Q",
                {"Im1": (120, 100, (255, 255 - shade % 200, shade % 251))},
            )
        ]
    )
    uploaded = client.post(
        f"/v1/projects/{project_id}/documents/imports",
        files={"upload": (f"audit-{uuid4().hex[:6]}.pdf", pdf, "application/pdf")},
    )
    assert uploaded.status_code == 201, uploaded.text
    doc_id = uploaded.json()["document"]["id"]
    extracted = client.post(f"/v1/projects/{project_id}/documents/{doc_id}/figures/extract").json()
    return extracted["candidates"][0]["id"]


def _conformer(client, project_id: str, candidate_id: str, smiles: str, **extra) -> dict:
    base = BASE.format(p=project_id) + f"/{candidate_id}"
    created = client.post(
        f"{base}/representations", json={"representation_type": "SMILES", "smiles": smiles, **extra}
    )
    assert created.status_code == 201, created.text
    graph_id = created.json()["representation"]["id"]
    generated = client.post(
        f"{base}/representations/{graph_id}/generate-conformer", json={"name": "Audit conformer"}
    )
    assert generated.status_code == 201, generated.text
    return generated.json()["representation"]


def _review_and_promote(client, project_id: str, candidate_id: str, rep_id: str, checklist: dict):
    base = BASE.format(p=project_id) + f"/{candidate_id}"
    assert client.post(f"{base}/review", json={"notes": "candidate"}).status_code == 200
    reviewed = client.post(
        f"{base}/representations/{rep_id}/review", json={"notes": "n", "checklist": checklist}
    )
    assert reviewed.status_code == 200, reviewed.text
    return client.post(f"{base}/promote", json={"representation_id": rep_id})


LEGACY_CHECKLIST = {
    k: v
    for k, v in _complete_b3_checklist().items()
    if k not in {"stereochemistry_reviewed", "charges_reviewed"}
}


def test_missing_stereo_review_blocks_promotion_of_stereo_graphs(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "B3 audit missing stereo")
    for smiles in ("N[C@@H](C)C(=O)O", "C/C=C/C"):
        candidate_id = _candidate(client, project["id"])
        conformer = _conformer(client, project["id"], candidate_id, smiles)
        response = _review_and_promote(
            client, project["id"], candidate_id, conformer["id"], LEGACY_CHECKLIST
        )
        assert response.status_code == 409, (smiles, response.text)
        assert "HUMAN_REVIEW_CHECKLIST_INCOMPLETE" in response.text
        assert "stereochemistry_reviewed" in response.text


def test_missing_charge_review_blocks_promotion_of_charged_graphs_including_zwitterions(
    api,
) -> None:
    client, _sessions, _settings = api
    project = _project(client, "B3 audit missing charge")
    for smiles in ("CC(=O)[O-]", "[NH3+]CC(=O)[O-]"):
        candidate_id = _candidate(client, project["id"])
        conformer = _conformer(client, project["id"], candidate_id, smiles)
        response = _review_and_promote(
            client, project["id"], candidate_id, conformer["id"], LEGACY_CHECKLIST
        )
        assert response.status_code == 409, (smiles, response.text)
        assert "charges_reviewed" in response.text
    # Charge review alone is not a stereo review.
    candidate_id = _candidate(client, project["id"])
    conformer = _conformer(client, project["id"], candidate_id, "N[C@@H](CC(=O)[O-])C(=O)O")
    only_charge = {**LEGACY_CHECKLIST, "charges_reviewed": True}
    response = _review_and_promote(
        client, project["id"], candidate_id, conformer["id"], only_charge
    )
    assert response.status_code == 409 and "stereochemistry_reviewed" in response.text


def test_explicit_false_blocks_and_explicit_true_promotes_with_recorded_reviewer(api) -> None:
    client, sessions, _settings = api
    project = _project(client, "B3 audit review identity")
    candidate_id = _candidate(client, project["id"])
    conformer = _conformer(client, project["id"], candidate_id, "[NH3+]CC(=O)[O-]")
    charges_false = {**_complete_b3_checklist(), "charges_reviewed": False}
    blocked = _review_and_promote(
        client, project["id"], candidate_id, conformer["id"], charges_false
    )
    assert blocked.status_code == 409
    # A later, complete review supersedes the incomplete one (latest review decides).
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"
    again = client.post(
        f"{base}/representations/{conformer['id']}/review",
        json={"notes": "second look", "checklist": _complete_b3_checklist()},
    )
    assert again.status_code == 200
    promoted = client.post(f"{base}/promote", json={"representation_id": conformer["id"]})
    assert promoted.status_code == 201, promoted.text
    assert promoted.json()["candidate"]["candidate_state"] == "PROMOTED"

    from chemdft_api.scientific_models import CandidateRepresentationReviewRecord

    with sessions() as session:
        reviews = session.scalars(
            select(CandidateRepresentationReviewRecord).where(
                CandidateRepresentationReviewRecord.representation_id == conformer["id"]
            )
        ).all()
        assert len(reviews) == 2
        assert all(r.actor_id for r in reviews)
        assert reviews[0].checklist_json["charges_reviewed"] is False  # history is kept


def test_neutral_achiral_graph_keeps_backward_compatible_seven_item_review(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "B3 audit legacy checklist")
    candidate_id = _candidate(client, project["id"])
    conformer = _conformer(client, project["id"], candidate_id, "CCO")
    response = _review_and_promote(
        client, project["id"], candidate_id, conformer["id"], LEGACY_CHECKLIST
    )
    assert response.status_code == 201, response.text


def test_checklist_contract_semantics() -> None:
    legacy = CandidateRepresentationReviewChecklist.model_validate(LEGACY_CHECKLIST)
    assert legacy.complete() is True  # legacy seven-item reviews stay valid where nothing applies
    assert legacy.complete_for(stereochemistry_required=True, charges_required=False) is False
    assert legacy.complete_for(stereochemistry_required=False, charges_required=True) is False
    full = CandidateRepresentationReviewChecklist.model_validate(_complete_b3_checklist())
    assert full.complete_for(stereochemistry_required=True, charges_required=True) is True
    refused = full.model_copy(update={"charges_reviewed": False})
    assert refused.complete() is False


def test_automatic_preview_and_name_collision_cannot_bypass_explicit_generation(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "B3 audit preview")
    candidate_id = _candidate(client, project["id"])
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"
    created = client.post(
        f"{base}/representations", json={"representation_type": "SMILES", "smiles": "CCO"}
    )
    assert created.status_code == 201
    preview = created.json()["generated_representation"]
    assert preview is not None and preview["approximation"] == "APPROXIMATE_PREVIEW"
    assert preview["coordinate_provenance"] is None
    # The preview is reviewable but never promotable: it carries no researcher-triggered provenance.
    response = _review_and_promote(
        client, project["id"], candidate_id, preview["id"], _complete_b3_checklist()
    )
    assert response.status_code == 409
    assert "COORDINATE_PROVENANCE_REQUIRED" in response.text
    # Explicit generation under the preview's own name must not hand the preview back.
    graph_id = created.json()["representation"]["id"]
    collision = client.post(
        f"{base}/representations/{graph_id}/generate-conformer", json={"name": "CCO"}
    )
    assert collision.status_code == 409
    assert "CONFORMER_NAME_COLLIDES_WITH_AUTOMATIC_PREVIEW" in collision.text


# ------------------------------------------------------------------ lineage and immutability
def _recognize(client, project_id: str, candidate_id: str, hint: str) -> dict:
    response = client.post(
        f"{BASE.format(p=project_id)}/{candidate_id}/recognize",
        json={"engine": "dev", "category_hint": hint},
    )
    assert response.status_code == 200, response.text
    reps = client.get(f"{BASE.format(p=project_id)}/{candidate_id}/representations").json()
    return next(r for r in reps["representations"] if r["representation_type"] == "SMILES")


def test_correction_without_explicit_parent_is_linked_to_the_recognition_proposal(api) -> None:
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B3 audit orphan")
    candidate_id = _candidate(client, project["id"])
    proposal = _recognize(client, project["id"], candidate_id, "l_alanine")
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"

    for body in (
        {"representation_type": "SMILES", "smiles": "N[C@H](C)C(=O)O"},
        {"representation_type": "MOL", "mol_block": _mol_block("N[C@H](C)C(=O)O")},
    ):
        created = client.post(f"{base}/representations", json=body)
        assert created.status_code == 201, created.text
        rep = created.json()["representation"]
        assert rep["source_representation_id"] == proposal["id"], "orphaned correction"
        assert rep["differences_from_parent"], (body["representation_type"], rep)
        assert {d["category"] for d in rep["differences_from_parent"]} == {"STEREOCHEMISTRY"}
        assert rep["created_by"]

    with sessions() as session:
        original = session.get(CandidateRepresentationRecord, proposal["id"])
        assert original is not None and original.source_representation_id is None
        assert original.created_by == proposal["created_by"]


def test_candidate_without_recognition_has_no_invented_parent(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "B3 audit manual")
    candidate_id = _candidate(client, project["id"])
    created = client.post(
        f"{BASE.format(p=project['id'])}/{candidate_id}/representations",
        json={"representation_type": "SMILES", "smiles": "CCO"},
    )
    assert created.json()["representation"]["source_representation_id"] is None


def test_parent_must_belong_to_the_same_candidate_and_project(api) -> None:
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    alpha, beta = _project(client, "B3 audit alpha"), _project(client, "B3 audit beta")
    cand_a, cand_b = _candidate(client, alpha["id"]), _candidate(client, beta["id"])
    foreign = _recognize(client, alpha["id"], cand_a, "ethanol")
    sibling = _recognize(client, beta["id"], cand_b, "ethanol")
    # A second candidate of the SAME project is also a foreign parent for this candidate.
    other_in_alpha = _candidate(client, alpha["id"])

    with sessions() as session:
        before = session.scalar(select(func.count()).select_from(CandidateRepresentationRecord))

    for parent_id in (foreign["id"], str(uuid4())):
        created = client.post(
            f"{BASE.format(p=beta['id'])}/{cand_b}/representations",
            json={
                "representation_type": "SMILES",
                "smiles": "CCN",
                "parent_representation_id": parent_id,
            },
        )
        assert created.status_code == 409, created.text
        assert "PARENT_REPRESENTATION_NOT_FOUND_IN_CANDIDATE" in created.text
        validated = client.post(
            f"{BASE.format(p=beta['id'])}/{cand_b}/validate-graph",
            json={"content": "CCN", "format": "SMILES", "parent_representation_id": parent_id},
        )
        assert validated.status_code == 409, validated.text
    cross_candidate = client.post(
        f"{BASE.format(p=alpha['id'])}/{other_in_alpha}/representations",
        json={
            "representation_type": "SMILES",
            "smiles": "CCN",
            "parent_representation_id": foreign["id"],
        },
    )
    assert cross_candidate.status_code == 409

    with sessions() as session:  # nothing was persisted by the refused requests
        after = session.scalar(select(func.count()).select_from(CandidateRepresentationRecord))
    assert after == before
    assert sibling["id"] != foreign["id"]


def test_original_proposal_survives_correction_chain_conformer_review_and_promotion(api) -> None:
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B3 audit immutability chain")
    candidate_id = _candidate(client, project["id"])
    proposal = _recognize(client, project["id"], candidate_id, "ethanol")
    with sessions() as session:
        record = session.get(CandidateRepresentationRecord, proposal["id"])
        snapshot = (
            record.payload_json,
            record.content_sha256,
            record.method,
            record.method_version,
            record.revision,
            record.created_by,
            record.representation_origin,
            record.approximation,
        )
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"
    first = client.post(
        f"{base}/representations",
        json={
            "representation_type": "SMILES",
            "smiles": "CCN",
            "parent_representation_id": proposal["id"],
        },
    ).json()["representation"]
    second = client.post(
        f"{base}/representations",
        json={
            "representation_type": "SMILES",
            "smiles": "CCC",
            "parent_representation_id": first["id"],
        },
    ).json()["representation"]
    assert first["source_representation_id"] == proposal["id"]
    assert second["source_representation_id"] == first["id"]  # revision chain, root preserved
    assert second["revision"] > first["revision"] > proposal["revision"]
    generated = client.post(
        f"{base}/representations/{second['id']}/generate-conformer",
        json={"name": "Chain conformer"},
    ).json()["representation"]
    assert generated["source_representation_id"] == second["id"]
    response = _review_and_promote(
        client, project["id"], candidate_id, generated["id"], LEGACY_CHECKLIST
    )
    assert response.status_code == 201, response.text

    from chemdft_api.scientific_models import ProvenanceInputRow, StructureVersionRecord

    with sessions() as session:
        version = session.get(StructureVersionRecord, response.json()["version"]["id"])
        provenance_id = version.provenance_record_id
        inputs = {
            row.input_id
            for row in session.scalars(
                select(ProvenanceInputRow).where(
                    ProvenanceInputRow.provenance_record_id == provenance_id
                )
            )
        }
    # Promoted version -> conformer -> second correction -> first correction -> DECIMER proposal.
    assert {proposal["id"], first["id"], second["id"], generated["id"]} <= inputs
    with sessions() as session:
        record = session.get(CandidateRepresentationRecord, proposal["id"])
        assert (
            record.payload_json,
            record.content_sha256,
            record.method,
            record.method_version,
            record.revision,
            record.created_by,
            record.representation_origin,
            record.approximation,
        ) == snapshot
        assert record.source_representation_id is None


# ------------------------------------------------------------------ API safety
def test_invalid_input_never_creates_a_reviewable_promotable_or_generating_record(api) -> None:
    client, sessions, _settings = api
    project = _project(client, "B3 audit invalid")
    candidate_id = _candidate(client, project["id"])
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"
    for body in (
        {"representation_type": "SMILES", "smiles": "C(C)(C)(C)(C)C"},
        {"representation_type": "SMILES", "smiles": "not-a-molecule"},
        {"representation_type": "MOL", "mol_block": "garbage\nmol\nblock\n"},
    ):
        created = client.post(f"{base}/representations", json=body)
        assert created.status_code == 201, created.text
        rep = created.json()["representation"]
        assert rep["validation_state"] == "INVALID"
        assert created.json()["generated_representation"] is None
        assert (
            client.post(
                f"{base}/representations/{rep['id']}/review",
                json={"checklist": _complete_b3_checklist()},
            ).status_code
            == 409
        )
        assert (
            client.post(
                f"{base}/representations/{rep['id']}/generate-conformer", json={}
            ).status_code
            == 409
        )
        assert (
            client.post(f"{base}/promote", json={"representation_id": rep["id"]}).status_code == 409
        )
    with sessions() as session:
        coordinate_rows = session.scalar(
            select(func.count())
            .select_from(CandidateRepresentationRecord)
            .where(
                CandidateRepresentationRecord.candidate_id == candidate_id,
                CandidateRepresentationRecord.representation_type == "CARTESIAN_COORDINATES",
            )
        )
        assert coordinate_rows == 0


def test_failed_embedding_leaves_no_partial_record(api) -> None:
    client, sessions, _settings = api
    project = _project(client, "B3 audit failed embedding")
    candidate_id = _candidate(client, project["id"])
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"
    # trans-cyclooctene is graph-valid with full stereo but ETKDG cannot embed it.
    created = client.post(
        f"{base}/representations", json={"representation_type": "SMILES", "smiles": "C1=C/CCCCCC/1"}
    )
    assert created.status_code == 201
    rep = created.json()["representation"]
    assert created.json()["generated_representation"] is None
    with sessions() as session:
        count = lambda: session.scalar(  # noqa: E731
            select(func.count())
            .select_from(CandidateRepresentationRecord)
            .where(CandidateRepresentationRecord.candidate_id == candidate_id)
        )
        before = count()
    response = client.post(f"{base}/representations/{rep['id']}/generate-conformer", json={})
    assert response.status_code == 422, response.text
    assert "GEOMETRY_GENERATION_FAILED" in response.text
    with sessions() as session:
        after = session.scalar(
            select(func.count())
            .select_from(CandidateRepresentationRecord)
            .where(CandidateRepresentationRecord.candidate_id == candidate_id)
        )
    assert after == before


def test_multiplicity_mismatch_over_the_api_is_refused(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "B3 audit multiplicity")
    candidate_id = _candidate(client, project["id"])
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"
    rep = client.post(
        f"{base}/representations", json={"representation_type": "SMILES", "smiles": "CCO"}
    ).json()["representation"]
    response = client.post(
        f"{base}/representations/{rep['id']}/generate-conformer", json={"multiplicity": 3}
    )
    assert response.status_code == 422 and "MULTIPLICITY" in response.text
    assert (
        client.post(
            f"{base}/representations/{rep['id']}/generate-conformer", json={"multiplicity": 0}
        ).status_code
        == 422
    )


def test_concurrent_revision_collision_is_a_clean_409_with_no_partial_state(
    api, monkeypatch
) -> None:
    from chemdft_api import candidate_representation_actions as actions

    client, sessions, _settings = api
    project = _project(client, "B3 audit concurrency")
    candidate_id = _candidate(client, project["id"])
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"
    first = client.post(
        f"{base}/representations", json={"representation_type": "SMILES", "smiles": "CCO"}
    )
    assert first.status_code == 201

    def stale_revision(session, candidate_id, project_id):  # another writer already took it
        return 1

    monkeypatch.setattr(actions, "_next_revision", stale_revision)
    with sessions() as session:
        before = session.scalar(select(func.count()).select_from(CandidateRepresentationRecord))
    for body in (
        {"representation_type": "SMILES", "smiles": "CCN"},
        {"representation_type": "MOL", "mol_block": _mol_block("CCN")},
    ):
        response = client.post(f"{base}/representations", json=body)
        assert response.status_code == 409, response.text
        assert "CANDIDATE_REPRESENTATION_REVISION_CONFLICT" in response.text
    graph_id = first.json()["representation"]["id"]
    generated = client.post(
        f"{base}/representations/{graph_id}/generate-conformer", json={"name": "Fresh name"}
    )
    assert generated.status_code == 409
    assert "CANDIDATE_REPRESENTATION_REVISION_CONFLICT" in generated.text
    with sessions() as session:
        after = session.scalar(select(func.count()).select_from(CandidateRepresentationRecord))
    assert after == before

    monkeypatch.undo()
    assert (
        client.post(
            f"{base}/representations", json={"representation_type": "SMILES", "smiles": "CCN"}
        ).status_code
        == 201
    )


def test_viewer_can_validate_but_cannot_create_generate_review_or_promote(api) -> None:
    from route_audit import add_member

    client, sessions, settings = api
    project = _project(client, "B3 audit viewer")
    candidate_id = _candidate(client, project["id"])
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"
    rep = client.post(
        f"{base}/representations", json={"representation_type": "SMILES", "smiles": "CCO"}
    ).json()["representation"]
    viewer_id = add_member(
        sessions, project["id"], "b3-viewer@x.test", "viewer", settings.dev_organization_id
    )
    headers = {
        "X-ChemDFT-User-ID": viewer_id,
        "X-ChemDFT-Organization-ID": settings.dev_organization_id,
    }
    probes = [
        ("validate-graph", {"content": "CCO", "format": "SMILES"}, 200),
        ("representations", {"representation_type": "SMILES", "smiles": "CCN"}, 403),
        (f"representations/{rep['id']}/generate-conformer", {"name": "v"}, 403),
        (f"representations/{rep['id']}/review", {"checklist": _complete_b3_checklist()}, 403),
        ("promote", {"representation_id": rep["id"]}, 403),
    ]
    statuses = {
        path: client.post(f"{base}/{path}", json=body, headers=headers).status_code
        for path, body, _ in probes
    }
    expected = {path: code for path, _, code in probes}
    assert statuses == expected


def test_ketcher_mol_block_round_trips_through_the_api_without_losing_its_title_line(api) -> None:
    """The JSON contract must not strip the blank title line of a MOL block."""
    client, _sessions, _settings = api
    project = _project(client, "B3 audit mol roundtrip")
    candidate_id = _candidate(client, project["id"])
    base = BASE.format(p=project["id"]) + f"/{candidate_id}"
    block = _mol_block("N[C@@H](C)C(=O)O")
    assert block.startswith("\n")

    validated = client.post(f"{base}/validate-graph", json={"content": block, "format": "MOL"})
    assert validated.status_code == 200
    body = validated.json()
    assert body["is_valid"] and body["can_generate_3d"]
    assert body["canonical_isomeric_smiles"] == "C[C@H](N)C(=O)O"
    assert [c["stereo"] for c in body["stereocenters"]] == ["S"]

    created = client.post(
        f"{base}/representations", json={"representation_type": "MOL", "mol_block": block}
    )
    assert created.status_code == 201, created.text
    rep = created.json()["representation"]
    assert rep["validation_state"] == "PARSEABLE"
    assert rep["mol_block"] == block  # exact researcher text is preserved
    assert created.json()["generated_representation"] is not None
    generated = client.post(
        f"{base}/representations/{rep['id']}/generate-conformer", json={"name": "From Ketcher MOL"}
    )
    assert generated.status_code == 201, generated.text
    assert generated.json()["representation"]["source_representation_id"] == rep["id"]
