"""The homepage reference alpha-Cr2O3 (COD 9014036) validates through ChemDFT's own CIF path.

This guards the bundled web data (`reference/cr2o3-reference.json` in the homepage components):
it must be exactly what the CIF parses to, with the expected phase, symmetry and coordination.
It does not touch any API behaviour.
"""

from __future__ import annotations

import json
from pathlib import Path

from chemdft_api.scientific.adapters.periodic.pymatgen_adapter import parse_cif
from pymatgen.core import Structure
from pymatgen.io.cif import CifParser
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

REFERENCE = Path(__file__).resolve().parents[3] / "apps/web/src/app/_components/home/reference"
CIF = (REFERENCE / "cod-9014036-cr2o3.cif").read_bytes()
BUNDLED = json.loads((REFERENCE / "cr2o3-reference.json").read_text())


def _structure() -> Structure:
    return CifParser.from_str(CIF.decode(), check_cif=True).parse_structures(primitive=False)[0]


def test_the_cif_validates_through_the_existing_structure_path() -> None:
    candidate = parse_cif(CIF)
    assert len(candidate.coordinates["atoms"]) == 30
    structure = _structure()
    assert structure.composition.reduced_formula == "Cr2O3"
    assert structure.composition.get_el_amt_dict() == {"Cr": 12.0, "O": 18.0}
    analyzer = SpacegroupAnalyzer(structure, symprec=1e-3)
    assert (analyzer.get_space_group_symbol(), analyzer.get_space_group_number()) == ("R-3c", 167)
    assert analyzer.get_crystal_system() == "trigonal"


def test_the_bundled_web_data_is_exactly_the_cif() -> None:
    structure = _structure()
    lattice = structure.lattice
    assert BUNDLED["lattice"] == {
        "a": round(lattice.a, 4),
        "b": round(lattice.b, 4),
        "c": round(lattice.c, 4),
        "alpha": round(lattice.alpha, 4),
        "beta": round(lattice.beta, 4),
        "gamma": round(lattice.gamma, 4),
        "volume": round(lattice.volume, 3),
    }
    expected = sorted(
        (site.specie.symbol, tuple(round(float(c) % 1.0, 6) % 1.0 for c in site.frac_coords))
        for site in structure
    )
    bundled = sorted((s["element"], tuple(s["fractional"])) for s in BUNDLED["sites"])
    assert bundled == expected
