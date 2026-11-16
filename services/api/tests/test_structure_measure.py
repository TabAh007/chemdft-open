"""Tests for deterministic structure coordinate and cell measurements (Release 0.0.58, Part 1)."""

from __future__ import annotations

import math
from chemdft_api.ai.structure_measure import (
    MAX_SECTION_LINES,
    compute_structure_measurements,
)


def test_missing_coordinates():
    text = compute_structure_measurements(
        version_label="V1",
        coordinates=None,
        periodic_cell=None,
    )
    assert "[Computed by ChemDFT from the stored coordinates of V1 (not an engine result, not AI-written)]" in text
    assert "Coordinates: not stored" in text
    assert "Cell: not stored" in text
    assert "[END COMPUTED STRUCTURE MEASUREMENTS]" in text
    assert len(text.splitlines()) <= MAX_SECTION_LINES


def test_simple_cubic_crystal():
    # 1 atom at (0,0,0) in simple cubic lattice with a=3.0 Å
    a = 3.0
    cell = {
        "unit": "angstrom",
        "a": a,
        "b": a,
        "c": a,
        "alpha": 90.0,
        "beta": 90.0,
        "gamma": 90.0,
        "lattice_vectors": (
            (a, 0.0, 0.0),
            (0.0, a, 0.0),
            (0.0, 0.0, a),
        ),
    }
    coords = {
        "coordinate_system": "FRACTIONAL",
        "unit": "angstrom",
        "atoms": [
            {"element": "Po", "x": 0.0, "y": 0.0, "z": 0.0},
        ],
    }
    text = compute_structure_measurements(
        version_label="V1",
        coordinates=coords,
        periodic_cell=cell,
    )
    assert "Formula: Po (Po: 1; 1 atoms total)" in text
    assert "Cell: a = 3.000 Å, b = 3.000 Å, c = 3.000 Å, α = 90.00°, β = 90.00°, γ = 90.00°, volume = 27.00 Å³" in text  # noqa: RUF001
    # Minimum image distance for the single atom to its nearest periodic image along x/y/z should be 3.000 Å!
    assert "Po to Po: min 3.000 Å" in text
    # In simple cubic, coordination is 6 (6 nearest neighbors at distance a)
    assert "Each Po coordinated by 6 Po (cutoff 3.54 Å)" in text
    assert len(text.splitlines()) <= MAX_SECTION_LINES


def test_nacl_crystal():
    # NaCl primitive or simple cell:
    # a = 5.64 Å. Na at (0,0,0), Cl at (0.5, 0, 0).
    a = 5.64
    cell = {
        "unit": "angstrom",
        "a": a,
        "b": a,
        "c": a,
        "alpha": 90.0,
        "beta": 90.0,
        "gamma": 90.0,
        "lattice_vectors": (
            (a, 0.0, 0.0),
            (0.0, a, 0.0),
            (0.0, 0.0, a),
        ),
    }
    coords = {
        "coordinate_system": "FRACTIONAL",
        "unit": "angstrom",
        "atoms": [
            {"element": "Na", "x": 0.0, "y": 0.0, "z": 0.0},
            {"element": "Cl", "x": 0.5, "y": 0.0, "z": 0.0},
        ],
    }
    text = compute_structure_measurements(
        version_label="NaCl V1",
        coordinates=coords,
        periodic_cell=cell,
    )
    assert "Formula: ClNa (Cl: 1, Na: 1; 2 atoms total)" in text
    # Na-Cl distance is 0.5 * 5.64 = 2.82 Å
    assert "Cl to Na: min 2.820 Å" in text
    assert len(text.splitlines()) <= MAX_SECTION_LINES


def test_cr2o3_crystal_measurements():
    # Cr2O3 reference structure from apps/web/src/app/_components/home/reference/cr2o3-reference.json
    import json
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    ref_file = root / "apps/web/src/app/_components/home/reference/cr2o3-reference.json"
    if not ref_file.exists():
        return

    data = json.loads(ref_file.read_text())
    lat = data["lattice"]
    a, b, c = lat["a"], lat["b"], lat["c"]
    alpha, beta, gamma = lat["alpha"], lat["beta"], lat["gamma"]

    gamma_rad = math.radians(gamma)
    lattice_vectors = (
        (a, 0.0, 0.0),
        (b * math.cos(gamma_rad), b * math.sin(gamma_rad), 0.0),
        (0.0, 0.0, c),
    )
    cell = {
        "unit": "angstrom",
        "a": a,
        "b": b,
        "c": c,
        "alpha": alpha,
        "beta": beta,
        "gamma": gamma,
        "lattice_vectors": lattice_vectors,
    }
    atoms = [
        {"element": site["element"], "x": site["fractional"][0], "y": site["fractional"][1], "z": site["fractional"][2]}
        for site in data["sites"]
    ]
    coords = {
        "coordinate_system": "FRACTIONAL",
        "unit": "angstrom",
        "atoms": atoms,
    }

    text = compute_structure_measurements(
        version_label="Cr2O3 V1",
        coordinates=coords,
        periodic_cell=cell,
    )
    assert "Cr2O3" in text
    assert "Cell: a = 4.957 Å, b = 4.957 Å, c = 13.592 Å" in text
    # The nearest Cr-O distance in eskolaite Cr2O3 is 1.965 Å
    assert "Cr to O: min 1.96" in text
    # In Cr2O3, each Cr has 6 O neighbors and each O has 4 Cr neighbors
    assert "Each Cr coordinated by 6 O" in text
    assert "Each O coordinated by 4 Cr" in text
    assert len(text.splitlines()) <= MAX_SECTION_LINES


def test_molecule_non_periodic():
    # H2O molecule
    coords = {
        "coordinate_system": "CARTESIAN",
        "unit": "angstrom",
        "atoms": [
            {"element": "O", "x": 0.0, "y": 0.0, "z": 0.0},
            {"element": "H", "x": 0.0, "y": 0.757, "z": 0.586},
            {"element": "H", "x": 0.0, "y": -0.757, "z": 0.586},
        ],
    }
    text = compute_structure_measurements(
        version_label="H2O V1",
        coordinates=coords,
        periodic_cell=None,
    )
    assert "Formula: H2O (H: 2, O: 1; 3 atoms total)" in text
    assert "Periodic cell: none (molecular / non-periodic)" in text
    # O-H distance: sqrt(0.757^2 + 0.586^2) ≈ 0.957 Å
    assert "H to O: min 0.957 Å" in text
    # H-H distance: 2 * 0.757 = 1.514 Å
    assert "H to H: min 1.514 Å" in text
    assert len(text.splitlines()) <= MAX_SECTION_LINES


def test_large_structure_size_cap():
    # Structure with 250 atoms
    atoms = [{"element": "C", "x": float(i), "y": 0.0, "z": 0.0} for i in range(250)]
    coords = {
        "coordinate_system": "CARTESIAN",
        "unit": "angstrom",
        "atoms": atoms,
    }
    text = compute_structure_measurements(
        version_label="Large V1",
        coordinates=coords,
        periodic_cell=None,
    )
    assert "Formula: C250 (C: 250; 250 atoms total)" in text
    assert "Note: Structure contains 250 atoms" in text
    assert len(text.splitlines()) <= MAX_SECTION_LINES
