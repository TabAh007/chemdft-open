"""Focused acceptance regressions; real RDKit, isolated DBs, no native QM runs."""

from dataclasses import replace

import pytest
from chemdft_api.database import Base
from chemdft_api.errors import InvalidMolecularName, StructureElectronicStateMismatch
from chemdft_api.scientific.adapters.molecular.rdkit_adapter import export_mol, parse_mol
from chemdft_api.scientific.engines.normalization import normalized_calculation_input
from chemdft_api.scientific.molecular_geometry import (
    GeometryValidationFailed,
    generate_conformer,
    graph_identity,
    verify_generated_stereochemistry,
)
from rdkit import Chem
from rdkit.Chem import AllChem
from sqlalchemy import func, select
from test_calculation_engine import _h2_version, _specification
from test_geometry_workflow import accept, drawing, generate, submission
from test_structure_workspace import _create_project


@pytest.mark.parametrize(
    "smiles",
    [
        "CCCCCC", "CCO", "c1ccccc1", "CC(C)O", "C=C", "CC(=O)C",
        "C[C@H](O)CC", "C[C@@H](O)CC", "C/C=C/C", "C/C=C\\C",
        "C[C@H](O)[C@H](O)C",  # meso 2,3-butanediol
        "C[C@H](O)[C@@H](O)C",  # chiral diastereomer
    ],
)
def test_real_3d_stereo_matches_explicit_source(smiles):
    source = Chem.MolFromMolBlock(drawing(smiles), removeHs=False)
    generated = generate_conformer(source, "Stereo regression")
    assert generated.canonical_smiles == graph_identity(source)
    # Independent reconstruction from serialized coordinates, without inherited stereo tags.
    hydrated = Chem.AddHs(source)
    conformer = Chem.Conformer(hydrated.GetNumAtoms())
    conformer.Set3D(True)
    for atom in generated.coordinates.coordinates.atoms:
        conformer.SetAtomPosition(atom.index, (atom.x, atom.y, atom.z))
    hydrated.RemoveAllConformers()
    hydrated.AddConformer(conformer)
    Chem.RemoveStereochemistry(hydrated)
    Chem.AssignStereochemistryFrom3D(hydrated)
    Chem.AssignStereochemistry(hydrated, cleanIt=True, force=True)
    assert graph_identity(hydrated) == graph_identity(source)
    assert generate_conformer(source, "Stereo regression") == generated


@pytest.mark.parametrize("smiles", ["CC=CC", "CC(O)CC", "CC(O)C(O)C", "C[C@H](O)C(O)C"])
def test_ambiguous_stereo_is_rejected_before_embedding_and_persistence(api, monkeypatch, smiles):
    client, sessions, _ = api
    project = _create_project(client, "Stereo ambiguity")["id"]
    monkeypatch.setattr(AllChem, "EmbedMolecule", lambda *a: pytest.fail("Ambiguous embedding"))
    with sessions() as session:
        before = _row_counts(session)
    response = generate(client, project, mol_block=drawing(smiles))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "GEOMETRY_STEREOCHEMISTRY_UNSPECIFIED"
    assert "Specify stereochemistry" in response.json()["detail"]["message"]
    with sessions() as session:
        assert _row_counts(session) == before


def test_relative_stereo_group_cannot_select_one_enantiomer():
    mol = Chem.MolFromSmiles("C[C@H](O)CC |o1:1|")
    with pytest.raises(GeometryValidationFailed, match="Specify absolute stereochemistry"):
        generate_conformer(mol, "Relative stereo")


@pytest.mark.parametrize("smiles", ["C[C@H](O)CC", "C/C=C/C", "C/C=C\\C", "C[C@H](O)[C@H](O)C"])
def test_assigned_stereo_survives_acceptance_and_calculation_eligibility(api, smiles):
    client, _, _ = api
    project = _create_project(client, "Explicit stereo acceptance")["id"]
    response = generate(client, project, mol_block=drawing(smiles))
    assert response.status_code == 201, response.text
    candidate = response.json()
    parameters = candidate["manifest"]["generation_parameters"]
    assert parameters["stereochemistry_policy"] == "EXPLICIT_ASSIGNMENT_REQUIRED"
    assert parameters["stereochemistry_verification"] == "INDEPENDENT_ASSIGNMENT_FROM_3D"
    accepted = accept(client, project, candidate)
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["calculation_eligibility"]["eligible"] is True


def test_legacy_ambiguous_pending_candidate_cannot_be_accepted(api, monkeypatch):
    client, sessions, _ = api
    project = _create_project(client, "Legacy ambiguous candidate")["id"]
    # Reproduce the old generator with actual RDKit coordinates; restore both gates afterwards.
    with monkeypatch.context() as old:
        old.setattr("chemdft_api.scientific.molecular_geometry.require_explicit_stereochemistry",
                    lambda *a: None)
        old.setattr("chemdft_api.scientific.molecular_geometry.verify_generated_stereochemistry",
                    lambda *a: None)
        candidate = generate(client, project, mol_block=drawing("CC=CC"))
    assert candidate.status_code == 201, candidate.text
    with sessions() as session:
        before = _row_counts(session)
    rejected = accept(client, project, candidate.json())
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "GEOMETRY_STEREOCHEMISTRY_UNSPECIFIED"
    with sessions() as session:
        assert _row_counts(session) == before


@pytest.mark.parametrize("smiles", ["C[C@H](O)CC", "C/C=C/C"])
def test_coordinate_verifier_does_not_trust_inherited_stereo_tags(smiles):
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    assert AllChem.EmbedMolecule(mol, randomSeed=104729) == 0
    expected = graph_identity(mol)
    verify_generated_stereochemistry(mol, expected)
    conformer = mol.GetConformer()
    if "@" in smiles:
        # Mirror coordinates but keep every original chiral tag unchanged.
        for i in range(mol.GetNumAtoms()):
            p = conformer.GetAtomPosition(i)
            conformer.SetAtomPosition(i, (-p.x, p.y, p.z))
    else:
        opposite = Chem.AddHs(Chem.MolFromSmiles("C/C=C\\C"))
        assert AllChem.EmbedMolecule(opposite, randomSeed=104729) == 0
        for i in range(mol.GetNumAtoms()):
            conformer.SetAtomPosition(i, opposite.GetConformer().GetAtomPosition(i))
    assert graph_identity(mol) == expected
    with pytest.raises(GeometryValidationFailed, match="GEOMETRY_STEREOCHEMISTRY_MISMATCH"):
        verify_generated_stereochemistry(mol, expected)


def _row_counts(session):
    return {t.name: session.scalar(select(func.count()).select_from(t))
            for t in Base.metadata.sorted_tables}


@pytest.mark.parametrize(
    ("smiles", "stored_charge", "charge", "multiplicity", "code"),
    [
        ("CCCCCC", 0, 2, 1, "CALCULATION_CHARGE_MISMATCH"),
        ("[NH4+]", 1, 0, 1, "CALCULATION_CHARGE_MISMATCH"),
        ("CCCCCC", 0, 0, 3, "CALCULATION_MULTIPLICITY_MISMATCH"),
    ],
)
def test_submission_state_mismatch_is_422_before_any_queue_allocation(
    api, monkeypatch, smiles, stored_charge, charge, multiplicity, code
):
    client, sessions, _ = api
    project = _create_project(client, "Electronic state binding")["id"]
    candidate = generate(client, project, mol_block=drawing(smiles), expected_charge=stored_charge)
    assert candidate.status_code == 201, candidate.text
    accepted = accept(client, project, candidate.json())
    assert accepted.status_code == 201, accepted.text
    version = accepted.json()["version"]
    assert version["overall_charge"] == stored_charge and version["multiplicity"] == 1
    command = submission(project, version["id"])
    command["specification"].update(charge=charge, multiplicity=multiplicity)
    monkeypatch.setattr("chemdft_api.calculation_actions.validate_capability",
                        lambda *a: pytest.fail("Mismatch reached engine availability"))
    monkeypatch.setattr("chemdft_api.calculation_actions.choose_provider",
                        lambda *a: pytest.fail("Mismatch reached provider allocation"))
    with sessions() as session:
        before = _row_counts(session)
    response = client.post(f"/v1/projects/{project}/calculations", json=command)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == code
    with sessions() as session:
        assert _row_counts(session) == before


def test_supported_neutral_singlet_psi4_submission_stays_usable(api, monkeypatch):
    client, _, _ = api
    project = _create_project(client, "Neutral Psi4 submission")["id"]
    candidate = generate(client, project).json()
    version = accept(client, project, candidate).json()["version"]
    command = submission(project, version["id"])
    command["specification"]["engine_preference"] = {"engine": "psi4", "allowed_version": "1.11"}
    # Submission gate only: no scientific responses or results are fabricated.
    monkeypatch.setattr("chemdft_api.calculation_actions.validate_capability", lambda *a: None)
    response = client.post(f"/v1/projects/{project}/calculations", json=command)
    assert response.status_code == 201, response.text
    assert response.json()["calculation"]["state"] == "QUEUED"
    assert response.json()["result"] is None
    replay = client.post(f"/v1/projects/{project}/calculations", json=command)
    assert replay.json()["calculation"]["id"] == response.json()["calculation"]["id"]


@pytest.mark.parametrize("field", ["overall_charge", "multiplicity"])
def test_missing_authoritative_state_is_not_invented(field):
    version = _h2_version()
    setattr(version, field, None)
    with pytest.raises(StructureElectronicStateMismatch) as error:
        normalized_calculation_input(version, _specification(), max_atoms=10)
    assert error.value.code == "STRUCTURE_ELECTRONIC_STATE_UNAVAILABLE"


def test_matching_state_does_not_change_normalized_input_or_hash():
    version = _h2_version()
    version.id = "00000000-0000-4000-8000-000000000099"
    _, _, digest = normalized_calculation_input(version, _specification(), max_atoms=10)
    # Golden hash produced by normalization at accepted HEAD 8c0213f, before this fix.
    assert digest == "51f601251fde909e88da8c1c6b683585c9bdd397ae067804c0d7879fc2105807"


@pytest.mark.parametrize(
    "control", ["\n", "\r", "\t", "\x00", "\x1f", "\x7f", "\x85", "\u2028", "\u2029"]
)
def test_control_character_names_are_rejected_before_generation(api, monkeypatch, control):
    client, sessions, _ = api
    project = _create_project(client, "Name safety")["id"]
    monkeypatch.setattr(AllChem, "EmbedMolecule", lambda *a: pytest.fail("Invalid name embedded"))
    with sessions() as session:
        before = _row_counts(session)
    response = generate(client, project, name="Hexane" + control + "invalid")
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "MOLECULAR_NAME_CONTROL_CHARACTER"
    with sessions() as session:
        assert _row_counts(session) == before


def test_export_defense_rejects_legacy_unsafe_name_without_rewriting_record():
    mol = Chem.AddHs(Chem.MolFromSmiles("CCO"))
    assert AllChem.EmbedMolecule(mol, randomSeed=104729) == 0
    valid = parse_mol(Chem.MolToMolBlock(mol).encode(), fallback_name="Ethanol")
    invalid = replace(valid, name="Ethanol\nInjected header")
    with pytest.raises(InvalidMolecularName):
        export_mol(invalid)
    assert invalid.name == "Ethanol\nInjected header"
