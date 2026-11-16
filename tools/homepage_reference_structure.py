"""Validate the homepage reference alpha-Cr2O3 CIF and generate the bundled structure data.

Source: Crystallography Open Database entry 9014036 (data from the American Mineralogist
Crystal Structure Database, AMCSD 0017803), Sawada, Mater. Res. Bull. 29, 239-245 (1994),
doi:10.1016/0025-5408(94)90019-1.

The CIF is parsed through ChemDFT's own pymatgen adapter (the path user uploads take) and
analysed with pymatgen. Nothing is invented: lattice, symmetry and coordinates come from the
CIF; the output is the conventional hexagonal cell plus a record of what was checked.

    uv run --project services/api python tools/homepage_reference_structure.py
"""

from __future__ import annotations

import json
from pathlib import Path

from chemdft_api.scientific.adapters.periodic.pymatgen_adapter import parse_cif
from pymatgen.analysis.local_env import CrystalNN
from pymatgen.core import Structure
from pymatgen.io.cif import CifParser
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

ROOT = Path(__file__).resolve().parents[1]
CIF = ROOT / "apps/web/src/app/_components/home/reference/cod-9014036-cr2o3.cif"
OUT = ROOT / "apps/web/src/app/_components/home/reference/cr2o3-reference.json"


def main() -> None:
    data = CIF.read_bytes()
    candidate = parse_cif(data)  # ChemDFT's validated structure path (raises on invalid input)
    structure: Structure = CifParser.from_str(data.decode(), check_cif=True).parse_structures(
        primitive=False
    )[0]
    analyzer = SpacegroupAnalyzer(structure, symprec=1e-3)
    lattice = structure.lattice
    sites = sorted(
        (
            {
                "element": site.specie.symbol,
                "fractional": [round(float(c) % 1.0, 6) % 1.0 for c in site.frac_coords],
            }
            for site in structure
        ),
        key=lambda s: (s["element"], s["fractional"][2], s["fractional"][1], s["fractional"][0]),
    )
    nn = CrystalNN()
    coordination = {}
    distances = []
    for index, site in enumerate(structure):
        info = nn.get_nn_info(structure, index)
        coordination.setdefault(site.specie.symbol, set()).add(len(info))
        if site.specie.symbol == "Cr":
            distances += [round(float(n["site"].distance(site)), 4) for n in info]
    report = {
        "formula": structure.composition.reduced_formula,
        "mineral": "Eskolaite",
        "space_group_symbol": analyzer.get_space_group_symbol(),
        "space_group_number": analyzer.get_space_group_number(),
        "crystal_system": analyzer.get_crystal_system(),
        "lattice": {
            "a": round(lattice.a, 4),
            "b": round(lattice.b, 4),
            "c": round(lattice.c, 4),
            "alpha": round(lattice.alpha, 4),
            "beta": round(lattice.beta, 4),
            "gamma": round(lattice.gamma, 4),
            "volume": round(lattice.volume, 3),
        },
        "sites_in_conventional_cell": len(sites),
        "composition": {k: int(v) for k, v in structure.composition.get_el_amt_dict().items()},
        "coordination_numbers": {k: sorted(v) for k, v in coordination.items()},
        "cr_o_distances_angstrom": sorted(set(distances)),
        "chemdft_candidate_atoms": len(candidate.coordinates.get("atoms", [])),
        "sites": sites,
    }
    OUT.write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "sites"}, indent=1))


if __name__ == "__main__":
    main()
