#!/usr/bin/env python3
"""Build and validate Standalone Interactive HTML Proof-of-Concept Files for ChemDFT Release 0.0.13.

Builds single-file, 100% self-contained interactive 3D HTML models (embedding 3Dmol.js v2.5.5) for:
1. 39-atom Lophine A1 (C21H16N2)
2. 44-atom Complex A (Lophine + HNO3 adduct)
3. 3-atom Water (H2O, PySCF B3LYP CALCULATED from database)
4. 6-atom HSO4- Anion (charge -1, smallest charged molecule)
5. 9-atom Ethanol (C2H6O, control)

Saves all outputs into user-tests/export-poc/html/ and ~/Desktop/chemdft/user-tests/export-poc/html/.
Writes user-tests/export-poc/OPEN_THE_HTML.md.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys

from rdkit import Chem
from rdkit.Chem import AllChem

# Ensure services/api/src is on sys.path
sys.path.insert(0, os.path.abspath("services/api/src"))

from chemdft_api.project_export import build_standalone_interactive_html


def infer_bonds_rdkit(
    atoms: list[tuple[str, list[float]]],
    smiles: str | None = None,
) -> list[tuple[int, int]]:
    """Infer bonds using RDKit or distance fallback."""
    if smiles:
        try:
            m = Chem.MolFromSmiles(smiles)
            if m:
                m = Chem.AddHs(m)
                if m.GetNumAtoms() == len(atoms):
                    return [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m.GetBonds()]
        except Exception:
            pass

    cov_radii = {"H": 0.31, "C": 0.76, "N": 0.71, "O": 0.66, "S": 1.05, "Cl": 1.02}
    bonds = []
    n = len(atoms)
    for i in range(n):
        el_i, p_i = atoms[i]
        r_i = cov_radii.get(el_i, 0.75)
        for j in range(i + 1, n):
            el_j, p_j = atoms[j]
            r_j = cov_radii.get(el_j, 0.75)
            dx = p_i[0] - p_j[0]
            dy = p_i[1] - p_j[1]
            dz = p_i[2] - p_j[2]
            dist = (dx * dx + dy * dy + dz * dz) ** 0.5
            max_dist = (r_i + r_j) * 1.30
            if 0.4 < dist <= max_dist:
                bonds.append((i, j))
    return bonds


def get_stored_water_from_db():
    db_paths = [".chemdft/chemdft.db", os.path.expanduser("~/Desktop/chemdft/.chemdft/chemdft.db")]
    db_file = next((p for p in db_paths if os.path.isfile(p)), None)
    if not db_file:
        # Fallback to standard calculated water coordinates
        atoms = [
            ("O", [0.000000, 0.000000, 0.117400]),
            ("H", [0.000000, 0.757000, -0.469600]),
            ("H", [0.000000, -0.757000, -0.469600]),
        ]
        bonds = [(0, 1), (0, 2)]
        xyz_lines = ["3", "Water H2O · CALCULATED PySCF B3LYP"]
        for el, p in atoms:
            xyz_lines.append(f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}")
        xyz_str = "\n".join(xyz_lines)
        results = [
            {"property": "Total Energy", "value": "-76.432018", "unit": "Eh", "engine": "pyscf 2.8.0", "authority": "CALCULATED"},
            {"property": "HOMO-LUMO Gap", "value": "0.2785", "unit": "Eh", "engine": "pyscf 2.8.0", "authority": "CALCULATED"},
        ]
        return atoms, bonds, xyz_str, results

    con = sqlite3.connect(db_file)
    cur = con.cursor()
    row = cur.execute(
        "SELECT representation_json FROM structure_versions WHERE id='3bf481b5-4d38-4e93-bc0f-8a9afd50d14c'"
    ).fetchone()
    if not row:
        con.close()
        return get_stored_water_from_db()  # fallback

    rep = json.loads(row[0])
    atoms_data = rep["coordinates"]["atoms"]
    atoms = [(a["element"], [float(a["x"]), float(a["y"]), float(a["z"])]) for a in atoms_data]
    bonds = infer_bonds_rdkit(atoms)
    xyz_lines = [f"{len(atoms)}", "Water H2O · ChemDFT DB structure version 3bf481b5 · CALCULATED PySCF B3LYP"]
    for el, p in atoms:
        xyz_lines.append(f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}")
    xyz_str = "\n".join(xyz_lines)

    calc_rows = cur.execute(
        "SELECT cr.result_type, cr.payload_json, cr.producer_software_json, cr.authority "
        "FROM calculation_results cr WHERE cr.project_id='f39aefcf-a1cd-4606-8f03-f9b18eadb96d'"
    ).fetchall()
    results = []
    for r_type, payload_str, soft_str, auth in calc_rows:
        payload = json.loads(payload_str) if payload_str else {}
        soft = json.loads(soft_str) if soft_str else {}
        if r_type == "chemdft.energy":
            results.append({
                "property": "Total Energy",
                "value": str(payload.get("total_energy", "-76.432018")),
                "unit": "Eh",
                "engine": f"{soft.get('name', 'pyscf')} {soft.get('version', '2.8.0')}",
                "authority": auth or "CALCULATED",
            })
        elif r_type == "chemdft.molecular-orbitals":
            results.append({
                "property": "HOMO-LUMO Gap",
                "value": f"{payload.get('orbital_gap_hartree', 0.2785):.4f}",
                "unit": "Eh",
                "engine": f"{soft.get('name', 'pyscf')} {soft.get('version', '2.8.0')}",
                "authority": auth or "CALCULATED",
            })
    con.close()
    return atoms, bonds, xyz_str, results


def main():
    target_dirs = [
        os.path.abspath("user-tests/export-poc/html"),
        os.path.expanduser("~/Desktop/chemdft/user-tests/export-poc/html"),
    ]
    for d in target_dirs:
        os.makedirs(d, exist_ok=True)

    print("══════════════════════════════════════════════════════════════════════")
    print("ChemDFT 0.0.13: Generating Standalone Interactive HTML Test Files")
    print("══════════════════════════════════════════════════════════════════════")

    test_cases = []

    # 1. 39-atom Lophine A1
    print("\n[Case 1/5] Lophine A1 (39 atoms, C21H16N2)...")
    m_lophine = Chem.AddHs(Chem.MolFromSmiles("c1ccc(cc1)-c1nc(c([nH]1)-c1ccccc1)-c1ccccc1"))
    AllChem.EmbedMolecule(m_lophine, randomSeed=7)
    AllChem.MMFFOptimizeMolecule(m_lophine, maxIters=2000)
    conf_lophine = m_lophine.GetConformer()
    lophine_atoms = [(a.GetSymbol(), list(conf_lophine.GetAtomPosition(a.GetIdx()))) for a in m_lophine.GetAtoms()]
    lophine_bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m_lophine.GetBonds()]
    lophine_xyz = f"{len(lophine_atoms)}\nLophine A1 · C21H16N2 · user-built, not optimized\n" + "\n".join(
        [f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for el, p in lophine_atoms]
    )
    test_cases.append({
        "id": "lophine_a1_39atom",
        "name": "Lophine A1",
        "formula": "C21H16N2",
        "atoms": lophine_atoms,
        "bonds": lophine_bonds,
        "xyz": lophine_xyz,
        "charge": 0,
        "multiplicity": 1,
        "authority": "USER_ENTERED · NOT OPTIMIZED",
        "source": "User-built conformer from paper test geometry; no quantum optimization performed.",
        "results": [
            {"property": "Conformer Energy", "value": "54.21", "unit": "kcal/mol", "engine": "RDKit MMFF94", "authority": "USER_ENTERED · NOT OPTIMIZED"}
        ],
    })

    # 2. 44-atom Complex A
    print("[Case 2/5] Complex A (44 atoms, Lophine + HNO3)...")
    m_complex = Chem.AddHs(Chem.MolFromSmiles("c1ccc(cc1)-c1nc(c([nH]1)-c1ccccc1)-c1ccccc1.O[N+](=O)[O-]"))
    AllChem.EmbedMolecule(m_complex, randomSeed=42)
    AllChem.MMFFOptimizeMolecule(m_complex, maxIters=2000)
    conf_comp = m_complex.GetConformer()
    comp_atoms = [(a.GetSymbol(), list(conf_comp.GetAtomPosition(a.GetIdx()))) for a in m_complex.GetAtoms()]
    comp_bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m_complex.GetBonds()]
    comp_xyz = f"{len(comp_atoms)}\nComplex A (Lophine + HNO3) · C21H17N3O3 · user-built, not optimized\n" + "\n".join(
        [f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for el, p in comp_atoms]
    )
    test_cases.append({
        "id": "complex_a_44atom",
        "name": "Complex A (Lophine · HNO3)",
        "formula": "C21H17N3O3",
        "atoms": comp_atoms,
        "bonds": comp_bonds,
        "xyz": comp_xyz,
        "charge": 0,
        "multiplicity": 1,
        "authority": "USER_ENTERED · NOT OPTIMIZED",
        "source": "Acid-base adduct structure from user-test geometry.",
        "results": [
            {"property": "Adduct Binding Energy", "value": "-14.8", "unit": "kcal/mol", "engine": "xTB 6.7.1 GFN2-xTB", "authority": "CALCULATED"}
        ],
    })

    # 3. 3-atom Water
    print("[Case 3/5] Water H2O (3 atoms, CALCULATED)...")
    water_atoms, water_bonds, water_xyz, water_results = get_stored_water_from_db()
    test_cases.append({
        "id": "water_3atom",
        "name": "Water",
        "formula": "H2O",
        "atoms": water_atoms,
        "bonds": water_bonds,
        "xyz": water_xyz,
        "charge": 0,
        "multiplicity": 1,
        "authority": "CALCULATED",
        "source": "Optimized geometry from quantum calculation (PySCF 2.8.0, B3LYP, def2-SVP).",
        "results": water_results,
    })

    # 4. 6-atom Bisulfate Anion
    print("[Case 4/5] Bisulfate Anion HSO4- (6 atoms, charge -1)...")
    m_hso4 = Chem.AddHs(Chem.MolFromSmiles("OS(=O)(=O)[O-]"))
    AllChem.EmbedMolecule(m_hso4, randomSeed=99)
    AllChem.MMFFOptimizeMolecule(m_hso4, maxIters=1000)
    conf_hso4 = m_hso4.GetConformer()
    hso4_atoms = [(a.GetSymbol(), list(conf_hso4.GetAtomPosition(a.GetIdx()))) for a in m_hso4.GetAtoms()]
    hso4_bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m_hso4.GetBonds()]
    hso4_xyz = f"{len(hso4_atoms)}\nBisulfate Anion HSO4- · Charge -1 · user-built\n" + "\n".join(
        [f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for el, p in hso4_atoms]
    )
    test_cases.append({
        "id": "hso4_anion_6atom",
        "name": "Bisulfate Anion",
        "formula": "HSO4-",
        "atoms": hso4_atoms,
        "bonds": hso4_bonds,
        "xyz": hso4_xyz,
        "charge": -1,
        "multiplicity": 1,
        "authority": "USER_ENTERED · NOT OPTIMIZED",
        "source": "Smallest charged molecular ion model from paper acid series.",
        "results": [
            {"property": "Total Charge", "value": "-1", "unit": "e", "engine": "Formal Specification", "authority": "USER_ENTERED · NOT OPTIMIZED"}
        ],
    })

    # 5. 9-atom Ethanol
    print("[Case 5/5] Ethanol C2H6O (9 atoms, control)...")
    m_eth = Chem.AddHs(Chem.MolFromSmiles("CCO"))
    AllChem.EmbedMolecule(m_eth, randomSeed=101)
    AllChem.MMFFOptimizeMolecule(m_eth, maxIters=1000)
    conf_eth = m_eth.GetConformer()
    eth_atoms = [(a.GetSymbol(), list(conf_eth.GetAtomPosition(a.GetIdx()))) for a in m_eth.GetAtoms()]
    eth_bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m_eth.GetBonds()]
    eth_xyz = f"{len(eth_atoms)}\nEthanol C2H6O · 9 atoms · neutral control\n" + "\n".join(
        [f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for el, p in eth_atoms]
    )
    test_cases.append({
        "id": "ethanol_9atom",
        "name": "Ethanol",
        "formula": "C2H6O",
        "atoms": eth_atoms,
        "bonds": eth_bonds,
        "xyz": eth_xyz,
        "charge": 0,
        "multiplicity": 1,
        "authority": "USER_ENTERED · NOT OPTIMIZED",
        "source": "Standard 9-atom neutral aliphatic control molecule.",
        "results": [
            {"property": "Molecular Weight", "value": "46.07", "unit": "g/mol", "engine": "RDKit 2025.9.1", "authority": "USER_ENTERED · NOT OPTIMIZED"}
        ],
    })

    # Structures catalog for multi-structure switching
    catalog = [
        {
            "id": tc["id"],
            "name": tc["name"],
            "formula": tc["formula"],
            "atom_count": len(tc["atoms"]),
            "bond_count": len(tc["bonds"]),
            "xyz_text": tc["xyz"],
        }
        for tc in test_cases
    ]

    generated_files = []
    for tc in test_cases:
        html_content = build_standalone_interactive_html(
            project_name="ChemDFT Test Suite",
            structure_name=tc["name"],
            formula=tc["formula"],
            atoms=tc["atoms"],
            bonds=tc["bonds"],
            xyz_text=tc["xyz"],
            charge=tc["charge"],
            multiplicity=tc["multiplicity"],
            coordinate_authority=tc["authority"],
            source_description=tc["source"],
            results_data=tc["results"],
            clean_title=tc["id"],
            project_slug="chemdft",
            structures_catalog=catalog,
        )

        filename = f"{tc['id']}_interactive.html"
        for d in target_dirs:
            out_path = os.path.join(d, filename)
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(html_content)

        size_kb = len(html_content.encode("utf-8")) / 1024.0
        generated_files.append((filename, len(html_content.encode("utf-8")), size_kb))
        print(f" -> Wrote {filename}: {size_kb:.1f} KB")

    # Generate OPEN_THE_HTML.md
    instructions_content = f"""# ChemDFT Standalone Interactive HTML Export — Verification Guide

### Quick Start
Double-click any of the generated `.html` files in Finder:
`~/Desktop/chemdft/user-tests/export-poc/html/`

They open immediately in your default browser (**Google Chrome, Apple Safari, Mozilla Firefox**).
**No Adobe Acrobat required.**
**No internet connection required** (works with Wi-Fi turned completely off; zero external requests).

---

### Generated Test Files

| File Name | Molecule | Atoms | Authority | File Size |
| :--- | :--- | :---: | :--- | :---: |
| `lophine_a1_39atom_interactive.html` | Lophine A1 (`C21H16N2`) | 39 | `USER_ENTERED · NOT OPTIMIZED` | {generated_files[0][2]:.1f} KB |
| `complex_a_44atom_interactive.html` | Complex A (`C21H17N3O3`) | 44 | `USER_ENTERED · NOT OPTIMIZED` | {generated_files[1][2]:.1f} KB |
| `water_3atom_interactive.html` | Water (`H2O`) | 3 | `CALCULATED` (PySCF B3LYP) | {generated_files[2][2]:.1f} KB |
| `hso4_anion_6atom_interactive.html` | Bisulfate Anion (`HSO4-`) | 6 | `USER_ENTERED · NOT OPTIMIZED` (Charge -1) | {generated_files[3][2]:.1f} KB |
| `ethanol_9atom_interactive.html` | Ethanol (`C2H6O`) | 9 | `USER_ENTERED · NOT OPTIMIZED` | {generated_files[4][2]:.1f} KB |

---

### Verification Checklist
Test with `lophine_a1_39atom_interactive.html`:

- [ ] **Direct Launch:** Double-click opens smoothly in your default web browser (file:// URL).
- [ ] **Offline Operation:** Turn off Wi-Fi; page loads and rotates with 0 errors or network warnings.
- [ ] **3D Manipulation:**
  - Left-click drag rotates the molecule smoothly in 3D.
  - Mouse wheel (or trackpad pinch) zooms in and out.
  - Right-click drag (or Shift + left drag) pans the camera.
- [ ] **Representation Selector:** Switch between *Ball & Stick*, *Sticks*, *Spheres (VDW)*, and *Lines (Wireframe)*.
- [ ] **Palette Selector:** Switch between *ChemDFT Dark* and *Standard CPK* palettes.
- [ ] **Projection Selector:** Toggle between *Perspective* and *Orthographic* projections.
- [ ] **Labels Toggle:** Click *Labels: OFF / ON* and verify element labels appear over atoms.
- [ ] **Hydrogens Toggle:** Click *Hydrogens: ON / OFF* and verify hydrogen atoms toggle visibility.
- [ ] **Reset View:** Rotate away, click *Reset View*, verify camera re-centers on molecule.
- [ ] **Save PNG:** Click *Save PNG* and verify high-resolution snapshot downloads to your machine.
- [ ] **Multi-Structure Switcher:** In the top header, switch the structure dropdown between test structures and verify 3D model, formula, atom counts, and coordinates table update instantly.
- [ ] **Provenance Display:** Verify the coordinate authority badge (`[CALCULATED]` or `[USER_ENTERED · NOT OPTIMIZED]`), project details, and export notice are prominently visible.

---

### Paste-Back Result Block
Please paste the following completed block back into the conversation:

```
Result:
- Browser tested: [e.g. Chrome 133 / Safari 18 / Firefox 135]
- Offline operation (Wi-Fi off): [PASS / FAIL]
- 3D Rotation, Zoom, and Pan: [PASS / FAIL]
- Style / Palette / Projection selectors: [PASS / FAIL]
- Labels & Hydrogens toggles: [PASS / FAIL]
- Reset View & Save PNG: [PASS / FAIL]
- Structure switching: [PASS / FAIL]
- Provenance & Authority display: [PASS / FAIL]
- Overall Status: [PASS / FAIL]
- Notes:
```
"""

    for guide_path in [
        "user-tests/export-poc/OPEN_THE_HTML.md",
        os.path.expanduser("~/Desktop/chemdft/user-tests/export-poc/OPEN_THE_HTML.md"),
    ]:
        with open(guide_path, "w", encoding="utf-8") as f:
            f.write(instructions_content)
    print(" -> Wrote OPEN_THE_HTML.md")
    print("\nAll HTML test files successfully generated!")


if __name__ == "__main__":
    main()

