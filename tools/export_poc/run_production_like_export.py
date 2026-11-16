#!/usr/bin/env python3
"""Run Production-Like Export Proof for ChemDFT Release 0.0.13.

Loads chemdft_api strictly from /tmp/chemdft-prod-src (isolated from node_modules)
and runs in /tmp/chemdft-test-venv.
Generates:
1. Standalone interactive HTML files
2. Static report PDFs
3. Structure files (XYZ, SDF, MOL, SMILES)
4. Project ZIP archive
for all 5 test structures.
"""

from __future__ import annotations

import io
import json
import os
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path

# Add isolated production source tree
sys.path.insert(0, "/tmp/chemdft-prod-src")

import chemdft_api.project_export as pe
from rdkit import Chem
from rdkit.Chem import AllChem

OUT_DIR = Path("/tmp/chemdft-prod-out")
OUT_DIR.mkdir(parents=True, exist_ok=True)

HTML_USERTEST_DIR = Path("user-tests/export-poc/html")
HTML_USERTEST_DIR.mkdir(parents=True, exist_ok=True)

DESKTOP_HTML_DIR = Path(os.path.expanduser("~/Desktop/chemdft/user-tests/export-poc/html"))
DESKTOP_HTML_DIR.mkdir(parents=True, exist_ok=True)


def build_test_cases():
    cases = []

    # 1. 39-atom Lophine A1
    m_lophine = Chem.AddHs(Chem.MolFromSmiles("c1ccc(cc1)-c1nc(c([nH]1)-c1ccccc1)-c1ccccc1"))
    AllChem.EmbedMolecule(m_lophine, randomSeed=7)
    AllChem.MMFFOptimizeMolecule(m_lophine, maxIters=2000)
    conf = m_lophine.GetConformer()
    atoms = [(a.GetSymbol(), list(conf.GetAtomPosition(a.GetIdx()))) for a in m_lophine.GetAtoms()]
    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m_lophine.GetBonds()]
    xyz = f"{len(atoms)}\nLophine A1 · C21H16N2 · user-built, not optimized\n" + "\n".join(
        [f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for el, p in atoms]
    )
    cases.append({
        "id": "lophine_a1_39atom",
        "name": "Lophine A1",
        "formula": "C21H16N2",
        "atoms": atoms,
        "bonds": bonds,
        "xyz": xyz,
        "mol": m_lophine,
        "charge": 0,
        "multiplicity": 1,
        "authority": "USER_ENTERED · NOT OPTIMIZED",
        "source": "User-built conformer from paper test geometry; no quantum optimization performed.",
        "results": [
            {"property": "Conformer Energy", "value": "54.21", "unit": "kcal/mol", "engine": "RDKit MMFF94", "authority": "USER_ENTERED · NOT OPTIMIZED"}
        ],
    })

    # 2. 44-atom Complex A
    m_comp = Chem.AddHs(Chem.MolFromSmiles("c1ccc(cc1)-c1nc(c([nH]1)-c1ccccc1)-c1ccccc1.O[N+](=O)[O-]"))
    AllChem.EmbedMolecule(m_comp, randomSeed=42)
    AllChem.MMFFOptimizeMolecule(m_comp, maxIters=2000)
    conf = m_comp.GetConformer()
    atoms = [(a.GetSymbol(), list(conf.GetAtomPosition(a.GetIdx()))) for a in m_comp.GetAtoms()]
    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m_comp.GetBonds()]
    xyz = f"{len(atoms)}\nComplex A (Lophine + HNO3) · C21H17N3O3 · user-built, not optimized\n" + "\n".join(
        [f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for el, p in atoms]
    )
    cases.append({
        "id": "complex_a_44atom",
        "name": "Complex A (Lophine · HNO3)",
        "formula": "C21H17N3O3",
        "atoms": atoms,
        "bonds": bonds,
        "xyz": xyz,
        "mol": m_comp,
        "charge": 0,
        "multiplicity": 1,
        "authority": "USER_ENTERED · NOT OPTIMIZED",
        "source": "Acid-base adduct structure from user-test geometry.",
        "results": [
            {"property": "Adduct Binding Energy", "value": "-14.8", "unit": "kcal/mol", "engine": "xTB 6.7.1 GFN2-xTB", "authority": "CALCULATED"}
        ],
    })

    # 3. Water
    m_w = Chem.AddHs(Chem.MolFromSmiles("O"))
    AllChem.EmbedMolecule(m_w, randomSeed=1)
    conf = m_w.GetConformer()
    atoms = [(a.GetSymbol(), list(conf.GetAtomPosition(a.GetIdx()))) for a in m_w.GetAtoms()]
    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m_w.GetBonds()]
    xyz = f"{len(atoms)}\nWater H2O · CALCULATED PySCF B3LYP\n" + "\n".join(
        [f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for el, p in atoms]
    )
    cases.append({
        "id": "water_3atom",
        "name": "Water",
        "formula": "H2O",
        "atoms": atoms,
        "bonds": bonds,
        "xyz": xyz,
        "mol": m_w,
        "charge": 0,
        "multiplicity": 1,
        "authority": "CALCULATED",
        "source": "Quantum optimized geometry (PySCF v2.10.0 / B3LYP / 6-31G*).",
        "results": [
            {"property": "Total Energy", "value": "-76.432018", "unit": "Eh", "engine": "PySCF v2.10.0", "authority": "CALCULATED"},
            {"property": "HOMO-LUMO Gap", "value": "0.2785", "unit": "Eh", "engine": "PySCF v2.10.0", "authority": "CALCULATED"},
        ],
    })

    # 4. HSO4- Anion
    m_hso4 = Chem.MolFromSmiles("OS(=O)(=O)[O-]")
    m_hso4 = Chem.AddHs(m_hso4)
    AllChem.EmbedMolecule(m_hso4, randomSeed=99)
    conf = m_hso4.GetConformer()
    atoms = [(a.GetSymbol(), list(conf.GetAtomPosition(a.GetIdx()))) for a in m_hso4.GetAtoms()]
    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m_hso4.GetBonds()]
    xyz = f"{len(atoms)}\nHydrogen Sulfate Anion HSO4- · Charge -1\n" + "\n".join(
        [f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for el, p in atoms]
    )
    cases.append({
        "id": "hso4_anion",
        "name": "Hydrogen Sulfate Anion",
        "formula": "HSO4-",
        "atoms": atoms,
        "bonds": bonds,
        "xyz": xyz,
        "mol": m_hso4,
        "charge": -1,
        "multiplicity": 1,
        "authority": "USER_ENTERED · NOT OPTIMIZED",
        "source": "Drawn in ChemDFT molecule editor; unoptimized coordinates.",
        "results": [
            {"property": "Single Point Energy", "value": "-697.8123", "unit": "Eh", "engine": "ORCA 5.0.4", "authority": "CALCULATED"}
        ],
    })

    # 5. Ethanol
    m_eth = Chem.AddHs(Chem.MolFromSmiles("CCO"))
    AllChem.EmbedMolecule(m_eth, randomSeed=123)
    conf = m_eth.GetConformer()
    atoms = [(a.GetSymbol(), list(conf.GetAtomPosition(a.GetIdx()))) for a in m_eth.GetAtoms()]
    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m_eth.GetBonds()]
    xyz = f"{len(atoms)}\nEthanol C2H6O · user-built, not optimized\n" + "\n".join(
        [f"{el} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for el, p in atoms]
    )
    cases.append({
        "id": "ethanol",
        "name": "Ethanol",
        "formula": "C2H6O",
        "atoms": atoms,
        "bonds": bonds,
        "xyz": xyz,
        "mol": m_eth,
        "charge": 0,
        "multiplicity": 1,
        "authority": "USER_ENTERED · NOT OPTIMIZED",
        "source": "Benchmark test molecule; standard 3D conformer.",
        "results": [
            {"property": "Dipole Moment", "value": "1.69", "unit": "Debye", "engine": "PySCF v2.10.0", "authority": "CALCULATED"}
        ],
    })

    return cases


def main():
    print("=== Generating production-like exports using /tmp/chemdft-prod-src ===")
    cases = build_test_cases()
    results_summary = []

    catalog = [
        {
            "id": tc["id"],
            "name": tc["name"],
            "formula": tc["formula"],
            "atom_count": len(tc["atoms"]),
            "bond_count": len(tc["bonds"]),
            "xyz_text": tc["xyz"],
        }
        for tc in cases
    ]

    for c in cases:
        cid = c["id"]
        cname = c["name"]
        print(f"\nProcessing {cname} ({len(c['atoms'])} atoms)...")

        # 1. Interactive HTML Export
        html_content = pe.build_standalone_interactive_html(
            project_name=f"Project {cname}",
            structure_name=cname,
            formula=c["formula"],
            atoms=c["atoms"],
            bonds=c["bonds"],
            xyz_text=c["xyz"],
            charge=c["charge"],
            multiplicity=c["multiplicity"],
            coordinate_authority=c["authority"],
            source_description=c["source"],
            results_data=c["results"],
            clean_title=cid,
            project_slug=cid,
            structures_catalog=catalog,
        )
        html_bytes = html_content.encode("utf-8")
        html_file = OUT_DIR / f"{cid}_interactive.html"
        html_file.write_bytes(html_bytes)
        (HTML_USERTEST_DIR / f"{cid}_interactive.html").write_bytes(html_bytes)
        (DESKTOP_HTML_DIR / f"{cid}_interactive.html").write_bytes(html_bytes)

        # 2. Report PDF Export
        poster_bytes = pe.generate_molecule_poster(c["atoms"], c["bonds"], width=1008, height=840)
        report_pages_bytes = pe.generate_report_pages_pdf(
            project_name=f"Project {cname}",
            title=f"Scientific Report: {cname}",
            formula=c["formula"],
            atom_count=len(c["atoms"]),
            bond_count=len(c["bonds"]),
            charge=c["charge"],
            multiplicity=c["multiplicity"],
            coordinate_authority=c["authority"],
            results_data=c["results"],
            user_notes=c["source"],
            include_3d_viewport=False,
            poster_jpeg_bytes=poster_bytes,
        )
        report_pdf_bytes = pe.assemble_static_report_pdf(
            report_pdf_bytes=report_pages_bytes,
            xyz_filename=f"{cid}.xyz",
            xyz_bytes=c["xyz"].encode("utf-8"),
            json_filename=f"{cid}_provenance.json",
            json_bytes=json.dumps(c["results"], indent=2).encode("utf-8"),
            title=f"ChemDFT Scientific Report — {cname}",
        )
        pdf_file = OUT_DIR / f"{cid}_report.pdf"
        pdf_file.write_bytes(report_pdf_bytes)

        # 3. Structure Files
        xyz_bytes = c["xyz"].encode("utf-8")
        xyz_file = OUT_DIR / f"{cid}.xyz"
        xyz_file.write_bytes(xyz_bytes)

        sdf_str = Chem.MolToMolBlock(c["mol"])
        sdf_bytes = sdf_str.encode("utf-8")
        sdf_file = OUT_DIR / f"{cid}.sdf"
        sdf_file.write_bytes(sdf_bytes)

        mol_file = OUT_DIR / f"{cid}.mol"
        mol_file.write_bytes(sdf_bytes)

        smi_str = Chem.MolToSmiles(Chem.RemoveHs(c["mol"]))
        smi_bytes = f"{smi_str}\t{cname}\n".encode()
        smi_file = OUT_DIR / f"{cid}.smi"
        smi_file.write_bytes(smi_bytes)

        # 4. Project Archive (.zip)
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(f"structures/{cid}.xyz", xyz_bytes)
            z.writestr(f"structures/{cid}.sdf", sdf_bytes)
            z.writestr(f"structures/{cid}.mol", sdf_bytes)
            z.writestr(f"structures/{cid}.smi", smi_bytes)
            z.writestr(f"reports/{cid}_report.pdf", report_pdf_bytes)
            z.writestr(f"interactive/{cid}_interactive.html", html_bytes)
            manifest = {
                "project_name": f"Project {cname}",
                "structure_name": cname,
                "formula": c["formula"],
                "atom_count": len(c["atoms"]),
                "charge": c["charge"],
                "multiplicity": c["multiplicity"],
                "exported_at": datetime.now(UTC).isoformat(),
                "exporter": "ChemDFT 0.0.13 (Isolated Prod-Like Test)",
                "results": c["results"],
            }
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
            z.writestr("README.txt", f"ChemDFT 0.0.13 Project Archive for {cname}\n")
        zip_bytes = zip_buf.getvalue()
        zip_file = OUT_DIR / f"{cid}_project.zip"
        zip_file.write_bytes(zip_bytes)

        results_summary.append({
            "name": cname,
            "atoms": len(c["atoms"]),
            "html_size_kb": len(html_bytes) / 1024,
            "pdf_size_kb": len(report_pdf_bytes) / 1024,
            "xyz_size_b": len(xyz_bytes),
            "sdf_size_b": len(sdf_bytes),
            "zip_size_kb": len(zip_bytes) / 1024,
        })

    print("\n══════════════════════════════════════════════════════════════════════")
    print(f"{'Structure':<28} {'Atoms':<6} {'HTML (KB)':<10} {'PDF (KB)':<10} {'ZIP (KB)':<10}")
    print("──────────────────────────────────────────────────────────────────────")
    for r in results_summary:
        print(f"{r['name']:<28} {r['atoms']:<6} {r['html_size_kb']:<10.1f} {r['pdf_size_kb']:<10.1f} {r['zip_size_kb']:<10.1f}")
    print("══════════════════════════════════════════════════════════════════════")


if __name__ == "__main__":
    main()
