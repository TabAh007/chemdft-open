"""AI-6 offline checks: the reference molecules are genuine, traceable and imported unchanged.

Each source is parsed by ChemDFT's own adapters, checked against the recorded formula, identity and
geometry, and imported through the real import actions: the stored source artifact must be the
original bytes and the stored coordinates, elements, charge and multiplicity must be the file's own.
No calculation is run and nothing is invented. Planning cases are checked against the production
request reader and the engine capability tables, so they can be compared across offline and hosted
runs.
"""

import hashlib
import itertools
import math
import re
import sys
from collections import Counter
from dataclasses import replace
from pathlib import Path

import pytest
from chemdft_api.ai.request_match import read_request
from chemdft_api.scientific.adapters.molecular.rdkit_adapter import parse_sdf, parse_xyz
from chemdft_api.scientific.engines.registry import CAPABILITIES
from chemdft_api.scientific_actions import get_structure_version_detail
from chemdft_api.scientific_models import ScientificArtifactRecord, StructureVersionRecord
from rdkit import Chem
from rdkit.Chem import rdMolDescriptors

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe.molecules import (  # noqa: E402
    PLANNING_CASES,
    planning_cases,
    reference_molecules,
)
from nvidia_probe.replica import Replica  # noqa: E402

COVALENT = {"H": 0.31, "C": 0.76, "O": 0.66}  # Cordero et al. 2008, only to sanity-check bonds
MOLECULES = reference_molecules()


def parsed(molecule):
    parser = parse_xyz if molecule.format == "XYZ" else parse_sdf
    return parser(molecule.data())


def positions(candidate):
    return [(a["element"], a["x"], a["y"], a["z"]) for a in candidate.atoms]


def distance(a, b):
    return math.dist(a[1:], b[1:])


@pytest.fixture(scope="module")
def replica():
    built = Replica.build()
    try:
        yield built
    finally:
        built.close()


def test_exactly_the_three_requested_molecules_are_recorded_with_sources():
    assert set(MOLECULES) == {"h2", "h2o", "ethanol"}
    for molecule in MOLECULES.values():
        assert molecule.source["authority"] and molecule.source["identifier"]
        assert molecule.source["url"].startswith("https://")
        assert molecule.reuse_basis and molecule.structure_name
        assert (molecule.charge, molecule.multiplicity) == (0, 1)
    assert MOLECULES["h2"].source["kind"] == "EXPERIMENTAL_CONSTANT_CONSTRUCTED"
    assert {MOLECULES[k].source["kind"] for k in ("h2o", "ethanol")} == {
        "PUBCHEM_COMPUTED_3D_CONFORMER"
    }
    assert MOLECULES["h2o"].source["identifier"] == "PubChem CID 962"
    assert MOLECULES["ethanol"].source["identifier"] == "PubChem CID 702"


@pytest.mark.parametrize("key", sorted(MOLECULES))
def test_the_stored_bytes_are_the_recorded_source_and_a_changed_file_is_refused(key):
    molecule = MOLECULES[key]
    assert hashlib.sha256(molecule.path.read_bytes()).hexdigest() == molecule.sha256
    assert molecule.data() == molecule.path.read_bytes()
    with pytest.raises(ValueError, match="REFERENCE_MOLECULE_HASH_MISMATCH"):
        replace(molecule, sha256="0" * 64).data()


@pytest.mark.parametrize("key", sorted(MOLECULES))
def test_each_source_parses_through_chemdfts_adapters_with_the_recorded_identity(key):
    molecule = MOLECULES[key]
    candidate = parsed(molecule)
    counts = Counter(a["element"] for a in candidate.atoms)
    recorded = Counter()
    for element, number in re.findall(r"([A-Z][a-z]?)(\d*)", molecule.formula):
        recorded[element] += int(number or 1)
    assert counts == recorded and len(candidate.atoms) == molecule.atoms
    assert (candidate.overall_charge, candidate.multiplicity) == (
        molecule.charge,
        molecule.multiplicity,
    )
    if molecule.format == "SDF":
        mol = Chem.MolFromMolBlock(molecule.data().decode(), removeHs=False)
        assert rdMolDescriptors.CalcMolFormula(mol) == molecule.formula
        assert Chem.MolToInchiKey(mol) == molecule.inchikey
    else:
        assert Chem.MolToInchiKey(Chem.MolFromSmiles("[H][H]")) == molecule.inchikey


@pytest.mark.parametrize("key", sorted(MOLECULES))
def test_geometry_is_physically_sane_and_clash_free(key):
    atoms = positions(parsed(MOLECULES[key]))
    for a, b in itertools.combinations(atoms, 2):
        assert distance(a, b) > 0.5, (key, a[0], b[0])  # no clashes
    if key != "h2":  # bonded pairs sit near the sum of covalent radii
        mol = Chem.MolFromMolBlock(MOLECULES[key].data().decode(), removeHs=False)
        for bond in mol.GetBonds():
            i, j = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
            expected = COVALENT[atoms[i][0]] + COVALENT[atoms[j][0]]
            assert abs(distance(atoms[i], atoms[j]) - expected) < 0.30


def test_h2_is_built_from_the_cited_bond_length_and_nothing_else():
    molecule = MOLECULES["h2"]
    first, second = positions(parsed(molecule))
    expected = molecule.expected
    assert abs(distance(first, second) - expected["bond_length_angstrom"]) < expected["tolerance"]
    assert first[1:3] == (0.0, 0.0) and second[1:3] == (0.0, 0.0)
    assert abs(first[3] + second[3]) < 1e-12  # centred on the origin
    assert (
        "0.74144" in molecule.data().decode()
        and "chemdft:charge=0;multiplicity=1" in molecule.data().decode()
    )


def test_the_recorded_water_and_ethanol_geometry_numbers_are_the_files_own():
    water = positions(parsed(MOLECULES["h2o"]))
    o, h1, h2 = water
    expected = MOLECULES["h2o"].expected
    angle = math.degrees(
        math.acos(
            sum((a - c) * (b - c) for a, b, c in zip(h1[1:], h2[1:], o[1:], strict=True))
            / (distance(o, h1) * distance(o, h2))
        )
    )
    assert abs(distance(o, h1) - expected["oh_bond_length_angstrom"]) < expected["tolerance_length"]
    assert abs(distance(o, h2) - expected["oh_bond_length_angstrom"]) < expected["tolerance_length"]
    assert abs(angle - expected["hoh_angle_degrees"]) < expected["tolerance_angle"]
    assert "computed model" in expected["note"]  # labelled as computed, never as experiment
    heavy = [a for a in positions(parsed(MOLECULES["ethanol"])) if a[0] != "H"]
    assert (
        len(heavy) == 3
        and max(abs(a[3]) for a in heavy)
        < MOLECULES["ethanol"].expected["heavy_atom_planar_rms_angstrom_max"]
    )


@pytest.mark.parametrize("key", sorted(MOLECULES))
def test_import_preserves_the_original_bytes_coordinates_elements_and_electronic_state(
    replica, key
):
    molecule = MOLECULES[key]
    project = replica.new_project(molecule)
    with replica.sessions() as session:
        version = session.get(StructureVersionRecord, project.version_id)
        detail = get_structure_version_detail(
            session, replica.identity, project.project_id, project.structure_id, project.version_id
        )
        source = session.get(ScientificArtifactRecord, version.source_artifact_id)
    assert source.sha256 == molecule.sha256 and source.format_identifier == molecule.format
    assert (version.overall_charge, version.multiplicity) == (
        molecule.charge,
        molecule.multiplicity,
    )
    assert version.origin == "IMPORTED"
    stored = [(a.element, a.x, a.y, a.z) for a in detail.version.coordinates.atoms]
    original = positions(parsed(molecule))
    assert [s[0] for s in stored] == [o[0] for o in original]
    for s, o in zip(stored, original, strict=True):
        assert all(abs(x - y) < 1e-6 for x, y in zip(s[1:], o[1:], strict=True))
    assert detail.version.coordinates.unit.value == "angstrom"


def test_each_molecule_has_proposal_and_conflict_cases_and_every_case_names_a_real_molecule():
    for key in MOLECULES:
        kinds = {case.kind for case in planning_cases(key)}
        assert "PROPOSE" in kinds and len(planning_cases(key)) == 3
    assert {case.molecule for case in PLANNING_CASES} == set(MOLECULES)
    assert len({case.id for case in PLANNING_CASES}) == len(PLANNING_CASES)
    assert {case.kind for case in PLANNING_CASES} == {
        "PROPOSE", "EXPLAIN_UNAVAILABLE", "EXPLAIN_OUT_OF_SCOPE"
    }  # fmt: skip


@pytest.mark.parametrize(
    "case", [c for c in PLANNING_CASES if c.kind == "PROPOSE"], ids=lambda c: c.id
)
def test_a_proposal_case_states_exactly_what_a_correct_proposal_contains_and_the_server_can_run_it(
    case,
):
    constraints = {c.parameter: c.value for c in read_request(case.prompt).constraints}
    for parameter in ("method", "basis", "engine", "task"):
        assert constraints[parameter].lower() == str(case.expect[parameter]).lower(), case.id
    assert (constraints["charge"], constraints["multiplicity"]) == (0, 1)
    assert {
        c.parameter: c.supported for c in read_request(case.prompt).constraints
    } == dict.fromkeys(constraints, True)
    pyscf = CAPABILITIES["pyscf"]
    assert case.expect["method"] in pyscf.methods and case.expect["basis"] in pyscf.basis_sets
    assert MOLECULES[case.molecule].charge == case.expect["charge"]


@pytest.mark.parametrize(
    "case", [c for c in PLANNING_CASES if c.kind != "PROPOSE"], ids=lambda c: c.id
)
def test_a_request_the_server_cannot_meet_names_the_unavailable_thing_explicitly(case):
    reading = read_request(case.prompt)
    if case.kind == "EXPLAIN_UNAVAILABLE":
        assert any(not c.supported for c in reading.constraints), case.id
    else:
        assert reading.constraint("task").value == "GEOMETRY_OPTIMIZATION"
