import pytest

from chemdft_api.scientific.molecule_identity import (
    resolve_molecule_identity,
)


def test_catalogue_five_target_molecules():
    targets = {
        "methane": ("C", "CH4"),
        "ethane": ("CC", "C2H6"),
        "benzene": ("c1ccccc1", "C6H6"),
        "ethanol": ("CCO", "C2H6O"),
        "acetone": ("CC(C)=O", "C3H6O"),
    }
    for name, (expected_smiles, expected_formula) in targets.items():
        res = resolve_molecule_identity(name)
        assert res.resolved is True, f"Failed to resolve {name}"
        assert res.identity is not None
        assert res.identity.canonical_isomeric_smiles == expected_smiles
        assert res.identity.formula == expected_formula
        assert res.identity.charge == 0
        assert res.identity.multiplicity == 1
        assert res.identity.identity_source == "REVIEWED_CATALOGUE"
        assert len(res.identity.source_hash) == 64


def test_ambiguity_detection_xylene():
    res = resolve_molecule_identity("xylene")
    assert res.resolved is False
    assert res.clarification_required is True
    assert "ortho-xylene" in res.clarification_prompt
    assert len(res.alternatives) == 3
    names = {a.name for a in res.alternatives}
    assert names == {"o-xylene", "m-xylene", "p-xylene"}


def test_ambiguity_detection_butanol():
    res = resolve_molecule_identity("butanol")
    assert res.resolved is False
    assert res.clarification_required is True
    assert len(res.alternatives) == 4


def test_ambiguity_detection_chiral_center_unspecified():
    res = resolve_molecule_identity("2-butanol")
    assert res.resolved is False
    assert res.clarification_required is True
    assert len(res.alternatives) == 2


def test_explicit_smiles_resolution():
    res = resolve_molecule_identity("c1ccncc1")  # Pyridine
    assert res.resolved is True
    assert res.identity.formula == "C5H5N"
    assert res.identity.identity_source in ("REVIEWED_CATALOGUE", "EXPLICIT_SMILES")


def test_disconnected_salts_rejected():
    res = resolve_molecule_identity("[Na+].[Cl-]")
    assert res.resolved is False


def test_unknown_name_fails_safely():
    res = resolve_molecule_identity("completely_fictional_compound_xyz123")
    assert res.resolved is False
    assert res.clarification_required is True
    assert "Could not unambiguously resolve" in res.clarification_prompt
