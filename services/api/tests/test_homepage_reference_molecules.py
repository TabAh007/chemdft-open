"""The homepage reference molecules validate through ChemDFT's own structure paths.

Guards the bundled web data (`reference/molecules.json` in the homepage components): it must be exactly what the
committed source records parse to, with the expected formula, identity (InChIKey) and sane geometry. PubChem is not
contacted: the SDF records are committed unmodified. It does not touch any API behaviour.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from chemdft_api.scientific.adapters.molecular.rdkit_adapter import parse_sdf, parse_xyz
from rdkit import Chem
from rdkit.Chem import rdMolDescriptors

ROOT = Path(__file__).resolve().parents[3]
REFERENCE = ROOT / "apps/web/src/app/_components/home/reference"
BUNDLED = json.loads((REFERENCE / "molecules.json").read_text())
WATER_XYZ = ROOT / "services/api/tests/fixtures/structures/test-user-supplied-water.xyz"

PUBCHEM = {
    "benzene": ("pubchem-cid-241-benzene.sdf", "C6H6", "UHOVQNZJYSORNB-UHFFFAOYSA-N", 12, 12),
    "caffeine": ("pubchem-cid-2519-caffeine.sdf", "C8H10N4O2", "RYYVLZVUVIJVGH-UHFFFAOYSA-N", 24, 25),
}


def test_the_bundle_has_exactly_the_four_homepage_molecule_entries_for_the_three_molecules() -> None:
    assert set(BUNDLED) == {"water", "benzene", "caffeine"}


@pytest.mark.parametrize("key", sorted(PUBCHEM))
def test_pubchem_records_validate_and_are_what_the_page_bundles(key: str) -> None:
    filename, formula, inchikey, n_atoms, n_bonds = PUBCHEM[key]
    data = (REFERENCE / "molecules" / filename).read_bytes()
    candidate = parse_sdf(data)
    assert len(candidate.coordinates["atoms"]) == n_atoms
    assert len(candidate.coordinates["bonds"]) == n_bonds
    mol = Chem.MolFromMolBlock(data.decode(), sanitize=True, removeHs=False)
    assert mol is not None
    assert rdMolDescriptors.CalcMolFormula(mol) == formula
    assert Chem.MolToInchiKey(mol) == inchikey
    bundled = BUNDLED[key]
    assert bundled["formula"] == formula and bundled["inchikey"] == inchikey
    assert len(bundled["atoms"]) == n_atoms and len(bundled["bonds"]) == n_bonds
    conformer = mol.GetConformer()
    for index, atom in enumerate(bundled["atoms"]):
        point = conformer.GetAtomPosition(index)
        assert atom["element"] == mol.GetAtomWithIdx(index).GetSymbol()
        assert (atom["x"], atom["y"], atom["z"]) == pytest.approx((point.x, point.y, point.z), abs=6e-5)
    expected_bonds = sorted(
        (b.GetBeginAtomIdx(), b.GetEndAtomIdx(), float(b.GetBondTypeAsDouble())) for b in Chem.MolFromMolBlock(data.decode(), sanitize=False, removeHs=False).GetBonds()
    )
    bundled_bonds = sorted((b["atom_index_a"], b["atom_index_b"], b["order"]) for b in bundled["bonds"])
    assert bundled_bonds == expected_bonds
    assert bundled["source"]["name"] == "PubChem" and bundled["source"]["id"].startswith("CID ")
    assert "computed by PubChem" in bundled["source"]["kind"] and "not a ChemDFT calculation" in bundled["source"]["kind"]


def test_benzene_is_planar_and_aromatic() -> None:
    mol = Chem.MolFromMolBlock((REFERENCE / "molecules" / "pubchem-cid-241-benzene.sdf").read_text(), sanitize=True, removeHs=False)
    assert sum(1 for bond in mol.GetBonds() if bond.GetIsAromatic()) == 6
    carbons = [BUNDLED["benzene"]["atoms"][i] for i in range(12) if BUNDLED["benzene"]["atoms"][i]["element"] == "C"]
    assert all(abs(a["z"]) < 1e-3 for a in carbons)
    ring = [math.dist((a["x"], a["y"], a["z"]), (b["x"], b["y"], b["z"])) for i, a in enumerate(carbons) for b in carbons[i + 1 :]]
    assert min(ring) == pytest.approx(1.39, abs=0.01)  # nearest C-C: the aromatic bond length


def test_water_is_the_repository_test_geometry_not_a_calculation() -> None:
    candidate = parse_xyz(WATER_XYZ.read_bytes())
    atoms = candidate.coordinates["atoms"]
    water = BUNDLED["water"]
    assert [a["element"] for a in water["atoms"]] == ["O", "H", "H"]
    for bundled, source in zip(water["atoms"], atoms, strict=True):
        assert (bundled["x"], bundled["y"], bundled["z"]) == pytest.approx((source["x"], source["y"], source["z"]), abs=1e-6)
    assert water["validation"]["h_o_h_angle_degrees"] == pytest.approx(104.52, abs=0.01)
    assert "not itself a calculation result" in water["source"]["kind"]
