"""Tests for Structure Edit Validation, Periodic Minimum-Image Warnings, and Diffing (Release 0.0.60, Part 1)."""

from __future__ import annotations

import math
import pytest

from chemdft_api.ai.structure_edit import (
    AddAtomOp,
    MoveAtomOp,
    RemoveAtomOp,
    ReplaceElementOp,
    StructureEditValidationError,
    apply_structure_edits,
    compute_minimum_distances_and_warnings,
)
from chemdft_api.scientific.adapters.periodic.pymatgen_adapter import parse_cif
from pathlib import Path


@pytest.fixture
def cr2o3_fixture():
    cif_path = (
        Path(__file__).resolve().parents[3]
        / "apps"
        / "web"
        / "src"
        / "app"
        / "_components"
        / "home"
        / "reference"
        / "cod-9014036-cr2o3.cif"
    )
    raw_cif = cif_path.read_bytes()
    candidate = parse_cif(raw_cif)
    atoms = candidate.coordinates["atoms"]
    cell = candidate.periodic_cell
    coord_sys = candidate.coordinates.get("coordinate_system", "FRACTIONAL")
    return atoms, cell, coord_sys


@pytest.fixture
def water_molecule():
    atoms = [
        {"element": "O", "coordinates": (0.0, 0.0, 0.0)},
        {"element": "H", "coordinates": (0.757, 0.586, 0.0)},
        {"element": "H", "coordinates": (-0.757, 0.586, 0.0)},
    ]
    return atoms, None, "CARTESIAN"


def test_validation_invalid_element(water_molecule):
    atoms, cell, coord_sys = water_molecule
    with pytest.raises(StructureEditValidationError, match="Invalid element symbol 'Kryptonite'"):
        apply_structure_edits(
            parent_version_id="p1",
            atoms=atoms,
            periodic_cell=cell,
            coordinate_system=coord_sys,
            operations=[AddAtomOp(element="Kryptonite", coordinates=(1.0, 1.0, 1.0))],
        )


def test_validation_non_finite_coordinates(water_molecule):
    atoms, cell, coord_sys = water_molecule
    with pytest.raises(StructureEditValidationError, match="coordinates must be finite"):
        apply_structure_edits(
            parent_version_id="p1",
            atoms=atoms,
            periodic_cell=cell,
            coordinate_system=coord_sys,
            operations=[AddAtomOp(element="C", coordinates=(float("nan"), 0.0, 0.0))],
        )


def test_validation_index_out_of_range(water_molecule):
    atoms, cell, coord_sys = water_molecule
    with pytest.raises(StructureEditValidationError, match="out of range"):
        apply_structure_edits(
            parent_version_id="p1",
            atoms=atoms,
            periodic_cell=cell,
            coordinate_system=coord_sys,
            operations=[RemoveAtomOp(index=99)],
        )


def test_validation_remove_all_atoms():
    single_atom = [{"element": "H", "coordinates": (0.0, 0.0, 0.0)}]
    with pytest.raises(StructureEditValidationError, match="retain at least one atom"):
        apply_structure_edits(
            parent_version_id="p1",
            atoms=single_atom,
            periodic_cell=None,
            coordinate_system="CARTESIAN",
            operations=[RemoveAtomOp(index=0)],
        )


def test_fractional_periodic_wrap_across_boundary(cr2o3_fixture):
    atoms, cell, coord_sys = cr2o3_fixture
    # Add atom with coordinates outside [0, 1) e.g. (1.2, -0.3, 2.5) -> should wrap to (0.2, 0.7, 0.5)
    new_atoms, diff = apply_structure_edits(
        parent_version_id="cr2o3-v1",
        atoms=atoms,
        periodic_cell=cell,
        coordinate_system=coord_sys,
        operations=[AddAtomOp(element="Cr", coordinates=(1.2, -0.3, 2.5))],
    )
    added = diff.atoms_added[0]
    assert math.isclose(added["coordinates"][0], 0.2, abs_tol=1e-5)
    assert math.isclose(added["coordinates"][1], 0.7, abs_tol=1e-5)
    assert math.isclose(added["coordinates"][2], 0.5, abs_tol=1e-5)


def test_minimum_image_distance_warning_across_cell_boundary():
    # Cubic cell 10 Å x 10 Å x 10 Å
    cell = {"a": 10.0, "b": 10.0, "c": 10.0, "alpha": 90.0, "beta": 90.0, "gamma": 90.0}
    # Two atoms placed across the periodic boundary: (0.01, 0.5, 0.5) and (0.99, 0.5, 0.5)
    # The direct distance in fractional is 0.98 -> 9.8 Å, but minimum image distance is 0.02 -> 0.2 Å!
    # 0.2 Å is well below threshold and triggers a warning!
    atoms = [
        {"element": "O", "coordinates": (0.01, 0.5, 0.5)},
        {"element": "O", "coordinates": (0.99, 0.5, 0.5)},
    ]
    min_dist, warnings = compute_minimum_distances_and_warnings(atoms, cell, "FRACTIONAL")
    assert min_dist is not None
    assert math.isclose(min_dist, 0.2, abs_tol=1e-3)
    assert len(warnings) > 0
    assert "below the threshold" in warnings[0]


def test_crud_operations_on_molecule_water(water_molecule):
    atoms, cell, coord_sys = water_molecule
    # 1. Add C atom
    # 2. Replace H at index 1 with F
    # 3. Move H at index 2
    # 4. Remove O at index 0
    ops = [
        AddAtomOp(element="C", coordinates=(1.5, 0.0, 0.0)),
        ReplaceElementOp(index=1, element="F"),
        MoveAtomOp(index=2, coordinates=(-1.0, 0.5, 0.0)),
        RemoveAtomOp(index=0),
    ]
    new_atoms, diff = apply_structure_edits(
        parent_version_id="water-v1",
        atoms=atoms,
        periodic_cell=cell,
        coordinate_system=coord_sys,
        operations=ops,
    )
    assert diff.formula_before == "H2O"
    assert diff.atom_count_before == 3
    assert diff.atom_count_after == 3
    assert len(diff.atoms_added) == 1
    assert len(diff.elements_replaced) == 1
    assert len(diff.atoms_moved) == 1
    assert len(diff.atoms_removed) == 1


def test_crud_operations_on_cr2o3_fixture(cr2o3_fixture):
    atoms, cell, coord_sys = cr2o3_fixture
    initial_count = len(atoms)
    assert initial_count == 30

    # Add O atom, replace atom 0 (Cr -> Fe), move atom 1
    ops = [
        AddAtomOp(element="O", coordinates=(0.1, 0.2, 0.3)),
        ReplaceElementOp(index=0, element="Fe"),
        MoveAtomOp(index=1, coordinates=(0.5, 0.5, 0.5)),
    ]
    new_atoms, diff = apply_structure_edits(
        parent_version_id="cr2o3-v1",
        atoms=atoms,
        periodic_cell=cell,
        coordinate_system=coord_sys,
        operations=ops,
    )
    assert diff.atom_count_before == 30
    assert diff.atom_count_after == 31
    assert len(diff.atoms_added) == 1
    assert len(diff.elements_replaced) == 1
    assert len(diff.atoms_moved) == 1
    assert diff.elements_replaced[0]["old_element"] == "Cr"
    assert diff.elements_replaced[0]["new_element"] == "Fe"


def test_parent_immutability(cr2o3_fixture):
    atoms, cell, coord_sys = cr2o3_fixture
    import copy
    atoms_copy = copy.deepcopy(atoms)

    # Perform edits
    ops = [RemoveAtomOp(index=0), AddAtomOp(element="Ti", coordinates=(0.0, 0.0, 0.0))]
    new_atoms, diff = apply_structure_edits(
        parent_version_id="cr2o3-v1",
        atoms=atoms,
        periodic_cell=cell,
        coordinate_system=coord_sys,
        operations=ops,
    )
    # Check parent atoms list was not mutated
    assert atoms == atoms_copy
    assert len(atoms) == 30
