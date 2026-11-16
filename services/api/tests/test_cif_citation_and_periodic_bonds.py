"""Tests for CIF bibliographic citation extraction, periodic bond count (72 hex / 24 rhombohedral), and also-cite registry."""

from __future__ import annotations

from pathlib import Path
import warnings

from pymatgen.analysis.local_env import CrystalNN
from pymatgen.core import Lattice, Structure
from pymatgen.io.cif import CifParser

from chemdft_api.citation_block import citation_block, third_party_citations
from chemdft_api.scientific.adapters.periodic.pymatgen_adapter import extract_cif_citation

ROOT = Path(__file__).resolve().parents[3]
COD_CR2O3_CIF = ROOT / "apps" / "web" / "src" / "app" / "_components" / "home" / "reference" / "cod-9014036-cr2o3.cif"


def test_cif_source_reference_extraction_sawada_cod() -> None:
    text = COD_CR2O3_CIF.read_text(encoding="utf-8")
    parser = CifParser.from_str(text)
    citation = extract_cif_citation(text, parser)

    assert citation is not None
    assert citation["authors"] == "Sawada, H."
    assert citation["journal"] == "Materials Research Bulletin"
    assert citation["year"] == "1994"
    assert citation["volume"] == "29"
    assert citation["page_first"] == "239"
    assert citation["cod_id"] == "9014036"
    assert citation["mineral_name"] == "Eskolaite"
    assert citation["doi"] == "10.1016/0025-5408(94)90019-1"
    assert "Sawada, H. (1994)" in citation["formatted"]
    assert "Materials Research Bulletin, 29, 239" in citation["formatted"]
    assert "COD 9014036" in citation["formatted"]
    assert "Eskolaite" in citation["formatted"]
    assert "10.1016/0025-5408(94)90019-1" in citation["formatted"]


def test_cif_source_reference_extraction_no_citations() -> None:
    minimal_cif = """
data_minimal
_cell_length_a 4.0
_cell_length_b 4.0
_cell_length_c 4.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 1'
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C 0.0 0.0 0.0
"""
    parser = CifParser.from_str(minimal_cif)
    citation = extract_cif_citation(minimal_cif, parser)
    assert citation is None


def test_cr2o3_periodic_bond_count_hex_and_rhombohedral() -> None:
    text = COD_CR2O3_CIF.read_text(encoding="utf-8")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        parser = CifParser.from_str(text)
        struct_hex = parser.parse_structures(primitive=False)[0]
        cnn = CrystalNN()
        bs_hex = cnn.get_bonded_structure(struct_hex)
        hex_bonds = bs_hex.graph.number_of_edges()

        # Hexagonal unit cell (30 atoms: 12 Cr, 18 O) must have exactly 72 bonds
        assert len(struct_hex) == 30
        assert hex_bonds == 72

        # Primitive rhombohedral cell (10 atoms: 4 Cr, 6 O) must have exactly 24 bonds
        struct_prim = struct_hex.get_primitive_structure()
        bs_prim = cnn.get_bonded_structure(struct_prim)
        prim_bonds = bs_prim.graph.number_of_edges()

        assert len(struct_prim) == 10
        assert prim_bonds == 24


def test_also_cite_only_lists_used_tools() -> None:
    block_empty = citation_block([], summary_only=True, tools_used=[])
    assert "also_cite" not in block_empty

    # Only tools in tools_used should appear
    block_used = citation_block([], summary_only=True, tools_used=["pymatgen", "pyscf"])
    assert "also_cite" in block_used
    tools = block_used["also_cite"]["tools"]
    tool_keys = [t["key"] for t in tools]

    assert "pymatgen" in tool_keys
    assert "pyscf" in tool_keys
    assert "xtb" not in tool_keys
    assert "crest" not in tool_keys
    assert "dftd4" not in tool_keys
    assert "geometric" not in tool_keys

    # Reminder sentence must match exact wording
    assert block_used["also_cite"]["reminder"] == "If you imported a structure from a paper or database, cite the original source."


def test_third_party_citations_registry_completeness() -> None:
    reg = third_party_citations()
    required = ["pymatgen", "rdkit", "pyscf", "xtb", "crest", "geometric", "dftd4", "three"]
    for req in required:
        assert req in reg, f"Missing required third party citation: {req}"
        entry = reg[req]
        assert entry.get("name")
        assert entry.get("apa")
        assert entry.get("bibtex")
        assert "version" in entry
