# ruff: noqa: E501
"""ChemDFT Project-Level Export Services (3D PDF, report PDF, interactive HTML, archive).

Provides endpoints and business logic for:
- 3D PDF with live interactive PRC geometry, poster AP, and embedded provenance
- Static report PDF for universal viewing in standard PDF readers
- Standalone interactive HTML export with embedded 3Dmol.js viewer (offline, 0 CDN)
- Project ZIP archive with structure files, calculations, and signed evidence manifest
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from datetime import UTC, datetime
from html import escape as html_escape
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .branding import favicon_data_uri, inline_svg, logo_svg_bytes
from .citation_block import (
    calculation_apa,
    calculation_bibtex,
    citation_block,
    citation_block_text,
    detect_project_tools,
    methods_paragraph,
    project_calculation_facts,
    software_apa,
    software_bibtex,
    software_metadata,
    version_precision_note,
)
from .context import Identity
from .errors import ScientificReferenceNotFound
from .pdf_export import (
    assemble_3d_pdf,
    assemble_static_report_pdf,
    compile_asy_to_prc,
    generate_asy_script,
    generate_molecule_poster,
    generate_report_pages_pdf,
    get_element_rgb,
    infer_bonds_rdkit,
)
from .release_info import EXPORTER_NAME, RELEASE_VERSION
from .scientific.adapters.molecular.rdkit_adapter import (
    export_mol,
    export_sdf,
    export_smiles,
    export_xyz,
)
from .scientific.structures import CanonicalStructureCandidate, StructureKind, StructureSourceFormat
from .scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ProvenanceRecordRow,
    StructureRecord,
    StructureVersionRecord,
)

THREEDMOL_ASSET_PATH = Path(__file__).resolve().parent / "assets" / "3Dmol-min.js"
THREEDMOL_SHA256 = "f7cc78921ae72e7623e89cdd111434f58c2efddd2ffda1cd212644b406fb8016"


def _json_for_script(value: Any) -> str:
    """JSON that is safe inside an inline <script> block."""
    return json.dumps(value, ensure_ascii=False).replace("</", "<\\/").replace("<!--", "<\\!--")


def _load_3dmol_js() -> str:
    """Loads packaged minified 3Dmol.js asset and verifies its SHA-256 integrity."""
    if not THREEDMOL_ASSET_PATH.is_file():
        raise FileNotFoundError(
            f"Required asset 3Dmol-min.js not found at {THREEDMOL_ASSET_PATH}. "
            "The packaged viewer asset is mandatory for interactive HTML export."
        )

    content_bytes = THREEDMOL_ASSET_PATH.read_bytes()
    digest = hashlib.sha256(content_bytes).hexdigest()
    if digest != THREEDMOL_SHA256:
        raise ValueError(
            f"3Dmol-min.js integrity check failed (expected sha256={THREEDMOL_SHA256}, got {digest})."
        )

    return content_bytes.decode("utf-8")


def get_project_active_structure(
    session: Session,
    project_id: str,
    structure_version_id: str | None = None,
) -> tuple[StructureRecord, StructureVersionRecord]:
    """Retrieves target structure version or latest committed version in project."""
    if structure_version_id:
        version = session.get(StructureVersionRecord, structure_version_id)
        if version is None or version.project_id != project_id:
            raise ScientificReferenceNotFound("Structure version does not exist in this project.")
        structure = session.get(StructureRecord, version.structure_id)
        if structure is None:
            raise ScientificReferenceNotFound("Structure does not exist.")
        return structure, version

    latest_version = session.scalar(
        select(StructureVersionRecord)
        .where(StructureVersionRecord.project_id == project_id)
        .order_by(StructureVersionRecord.created_at.desc())
        .limit(1)
    )
    if latest_version is None:
        raise ScientificReferenceNotFound("No structures recorded in this project.")
    structure = session.get(StructureRecord, latest_version.structure_id)
    if structure is None:
        raise ScientificReferenceNotFound("Structure not found.")
    return structure, latest_version


def _extract_numeric_quantity(raw: Any) -> float | None:
    if isinstance(raw, dict):
        val = raw.get("value")
        return float(val) if isinstance(val, (int, float)) and not isinstance(val, bool) else None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return float(raw)
    return None


def get_project_results_data(
    session: Session,
    project_id: str,
) -> list[dict[str, Any]]:
    """Retrieves and formats completed calculation results into presentation records."""
    calc_rows = session.scalars(
        select(CalculationResultRecord)
        .where(CalculationResultRecord.project_id == project_id)
        .order_by(CalculationResultRecord.created_at.asc())
    ).all()

    formatted_results: list[dict[str, Any]] = []
    for r in calc_rows:
        payload = r.payload_json or {}
        software = r.producer_software_json or {}
        engine_str = f"{software.get('name', 'engine').capitalize()} {software.get('version', '')}".strip()
        auth = str(r.authority)
        r_type = r.result_type

        if r_type == "chemdft.energy":
            total_e = _extract_numeric_quantity(payload.get("total_energy"))
            if total_e is not None:
                formatted_results.append({
                    "property": "Total Energy",
                    "value": f"{total_e:.8f}",
                    "unit": "Eh",
                    "engine": engine_str,
                    "authority": auth,
                })
            dipole = _extract_numeric_quantity(payload.get("dipole_moment"))
            if dipole is not None:
                formatted_results.append({
                    "property": "Dipole Moment",
                    "value": f"{dipole:.4f}",
                    "unit": "Debye",
                    "engine": engine_str,
                    "authority": auth,
                })
        elif r_type in ("chemdft.optimization", "chemdft.geometry-optimization"):
            final_e = _extract_numeric_quantity(payload.get("final_energy"))
            if final_e is not None:
                formatted_results.append({
                    "property": "Optimized Energy",
                    "value": f"{final_e:.8f}",
                    "unit": "Eh",
                    "engine": engine_str,
                    "authority": auth,
                })
            steps = payload.get("step_count") or payload.get("optimization_steps") or payload.get("optimization_iterations")
            if steps is not None:
                formatted_results.append({
                    "property": "Optimization Steps",
                    "value": str(steps),
                    "unit": "steps",
                    "engine": engine_str,
                    "authority": auth,
                })
        elif r_type == "chemdft.vibrational-analysis":
            zpve = _extract_numeric_quantity(payload.get("zpve")) or _extract_numeric_quantity(payload.get("zero_point_energy"))
            if zpve is not None:
                formatted_results.append({
                    "property": "Zero-Point Energy (ZPVE)",
                    "value": f"{zpve:.4f}",
                    "unit": "kcal/mol",
                    "engine": engine_str,
                    "authority": auth,
                })
            gibbs = _extract_numeric_quantity(payload.get("gibbs_free_energy"))
            if gibbs is not None:
                formatted_results.append({
                    "property": "Gibbs Free Energy (G)",
                    "value": f"{gibbs:.8f}",
                    "unit": "Eh",
                    "engine": engine_str,
                    "authority": auth,
                })
        elif r_type == "chemdft.thermochemistry":
            thermo = payload.get("thermodynamics") or {}
            gibbs = _extract_numeric_quantity(thermo.get("gibbs_free_energy_hartree"))
            if gibbs is not None:
                formatted_results.append({
                    "property": "Gibbs Free Energy (G)",
                    "value": f"{gibbs:.8f}",
                    "unit": "Eh",
                    "engine": engine_str,
                    "authority": auth,
                })
            enthalpy = _extract_numeric_quantity(thermo.get("enthalpy_hartree"))
            if enthalpy is not None:
                formatted_results.append({
                    "property": "Enthalpy (H)",
                    "value": f"{enthalpy:.8f}",
                    "unit": "Eh",
                    "engine": engine_str,
                    "authority": auth,
                })
        elif r_type == "chemdft.tddft":
            ex = _extract_numeric_quantity(payload.get("first_excitation_ev"))
            if ex is None and payload.get("excited_states"):
                first = payload["excited_states"][0]
                ex = _extract_numeric_quantity(first.get("energy_ev"))
            if ex is not None:
                formatted_results.append({
                    "property": "S1 Excitation Energy",
                    "value": f"{ex:.3f}",
                    "unit": "eV",
                    "engine": engine_str,
                    "authority": auth,
                })
    return formatted_results


def _extract_structure_geometry(
    version: StructureVersionRecord,
) -> tuple[list[tuple[str, list[float]]], list[tuple[int, int]], str]:
    """Extracts atoms, bonds, and formatted XYZ string from StructureVersionRecord."""
    rep = version.representation_json or {}
    coords = rep.get("coordinates", {})
    atoms_data = coords.get("atoms", [])
    cell_data = version.periodic_cell_json or rep.get("periodic_cell") or rep.get("cell")
    is_fractional = coords.get("coordinate_system") == "FRACTIONAL"

    if is_fractional and cell_data and cell_data.get("lattice_vectors"):
        matrix = cell_data["lattice_vectors"]
        atoms: list[tuple[str, list[float]]] = []
        for a in atoms_data:
            fx, fy, fz = float(a["x"]), float(a["y"]), float(a["z"])
            cx = fx * matrix[0][0] + fy * matrix[1][0] + fz * matrix[2][0]
            cy = fx * matrix[0][1] + fy * matrix[1][1] + fz * matrix[2][1]
            cz = fx * matrix[0][2] + fy * matrix[1][2] + fz * matrix[2][2]
            atoms.append((a["element"], [cx, cy, cz]))
    else:
        atoms = [
            (a["element"], [float(a["x"]), float(a["y"]), float(a["z"])])
            for a in atoms_data
        ]

    # Bonds
    bonds_data = rep.get("bonds", [])
    if bonds_data:
        bonds = [(int(b["source"]), int(b["target"])) for b in bonds_data]
    elif cell_data and cell_data.get("lattice_vectors"):
        try:
            import warnings

            from pymatgen.analysis.local_env import CrystalNN
            from pymatgen.core import Lattice, Structure

            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                lattice = Lattice(cell_data["lattice_vectors"])
                struct = Structure(
                    lattice,
                    [el for el, _ in atoms],
                    [p for _, p in atoms],
                    coords_are_cartesian=True,
                )
                cnn = CrystalNN()
                bs = cnn.get_bonded_structure(struct)
                bonds = [(int(u), int(v)) for u, v, _ in bs.graph.edges]
        except Exception:
            bonds = []
    else:
        bonds = infer_bonds_rdkit(atoms, charge=version.overall_charge)

    # XYZ text
    xyz_lines = [
        f"{len(atoms)}",
        f"ChemDFT Structure {version.structure_id} v{version.revision} · Charge: {version.overall_charge} Mult: {version.multiplicity}",
    ]
    for el, p in atoms:
        xyz_lines.append(f"{el:<2} {p[0]:12.6f} {p[1]:12.6f} {p[2]:12.6f}")
    xyz_text = "\n".join(xyz_lines) + "\n"

    return atoms, bonds, xyz_text


def _extract_crystal_metadata(
    version: StructureVersionRecord,
) -> dict[str, Any] | None:
    """Extracts crystal unit cell metadata, volume, and space group from StructureVersionRecord."""
    rep = version.representation_json or {}
    cell = version.periodic_cell_json or rep.get("periodic_cell") or rep.get("cell")
    if not cell or not cell.get("lattice_vectors"):
        return None

    a = float(cell.get("a", 0.0))
    b = float(cell.get("b", 0.0))
    c = float(cell.get("c", 0.0))
    alpha = float(cell.get("alpha", 0.0))
    beta = float(cell.get("beta", 0.0))
    gamma = float(cell.get("gamma", 0.0))
    matrix = cell.get("lattice_vectors")

    volume = 0.0
    space_group = rep.get("space_group")
    try:
        import warnings

        from pymatgen.core import Lattice, Structure

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            lat = Lattice(matrix)
            volume = float(lat.volume)
            if not space_group:
                coords = rep.get("coordinates", {})
                atoms_data = coords.get("atoms", [])
                if atoms_data:
                    is_frac = coords.get("coordinate_system") == "FRACTIONAL"
                    st = Structure(
                        lat,
                        [a_d["element"] for a_d in atoms_data],
                        [[float(a_d["x"]), float(a_d["y"]), float(a_d["z"])] for a_d in atoms_data],
                        coords_are_cartesian=not is_frac,
                    )
                    sg_info = st.get_space_group_info()
                    if sg_info and len(sg_info) >= 2:
                        space_group = f"{sg_info[0]} (#{sg_info[1]})"
    except Exception:
        pass

    return {
        "a": round(a, 4),
        "b": round(b, 4),
        "c": round(c, 4),
        "alpha": round(alpha, 2),
        "beta": round(beta, 2),
        "gamma": round(gamma, 2),
        "volume": round(volume, 2),
        "space_group": space_group,
        "lattice_vectors": matrix,
    }


def _extract_source_reference(
    session: Session,
    version: StructureVersionRecord,
) -> str | None:
    """Extracts the bibliographic or user-entered source reference for the structure."""
    rep = version.representation_json or {}
    if rep.get("source_reference"):
        return str(rep["source_reference"])
    if rep.get("cif_source_reference") and isinstance(rep["cif_source_reference"], dict):
        return rep["cif_source_reference"].get("formatted")
    if version.provenance_record_id:
        prov = session.get(ProvenanceRecordRow, version.provenance_record_id)
        if prov and prov.parameters_json:
            for p in prov.parameters_json:
                if isinstance(p, dict) and p.get("key") == "source_reference" and p.get("value"):
                    return str(p["value"])
    return None


def _compute_gross_formula(atoms: list[tuple[str, list[float]]]) -> str:
    """Computes Hill system molecular formula from atom list."""
    counts: dict[str, int] = {}
    for el, _ in atoms:
        sym = el.capitalize()
        counts[sym] = counts.get(sym, 0) + 1

    parts = []
    if "C" in counts:
        parts.append(f"C{counts.pop('C') if counts['C'] > 1 else ''}")
        if "H" in counts:
            parts.append(f"H{counts.pop('H') if counts['H'] > 1 else ''}")
    for sym in sorted(counts.keys()):
        cnt = counts[sym]
        parts.append(f"{sym}{cnt if cnt > 1 else ''}")
    return "".join(parts)


def export_project_3d_pdf(
    session: Session,
    identity: Identity,
    project_id: str,
    structure_version_id: str | None = None,
) -> tuple[str, str, bytes]:
    """Generates an ISO 32000-1 3D PDF with rotatable PRC model and provenance attachments."""
    project, _member = authorize_project_access(session, identity, project_id)
    structure, version = get_project_active_structure(session, project_id, structure_version_id)
    atoms, bonds, xyz_text = _extract_structure_geometry(version)
    results = get_project_results_data(session, project_id)

    crystal_data = _extract_crystal_metadata(version)
    source_reference = _extract_source_reference(session, version)

    # Authority determination
    origin_str = str(getattr(version, "origin", "")).upper()
    if origin_str in ("OPTIMIZED", "CALCULATION", "IMPORTED_CALCULATION"):
        auth_label = "CALCULATED"
        source_desc = "Optimized geometry from quantum calculation."
    elif crystal_data:
        auth_label = "USER_ENTERED · NOT OPTIMIZED"
        source_desc = "Imported crystal structure; periodic coordinates and unit cell from source file."
    else:
        auth_label = "USER_ENTERED · NOT OPTIMIZED"
        source_desc = "User-built or imported coordinates; no geometry optimization has been run."

    formula = _compute_gross_formula(atoms)
    title = f"{structure.name} (V{version.revision})"

    # Asymptote PRC
    asy_code = generate_asy_script(atoms, bonds, style="ball_and_stick")
    prc_bytes = compile_asy_to_prc(asy_code)

    # 2D Poster Image
    poster_bytes = generate_molecule_poster(atoms, bonds, width=1008, height=840)
    poster_clean_bytes = generate_molecule_poster(atoms, bonds, width=1008, height=840, overlays=False)

    # Manifest JSON for attachment
    manifest_dict = {
        "project_id": project.id,
        "project_name": project.name,
        "structure_id": structure.id,
        "structure_name": structure.name,
        "version_id": version.id,
        "revision": version.revision,
        "formula": formula,
        "atom_count": len(atoms),
        "bond_count": len(bonds),
        "charge": version.overall_charge,
        "multiplicity": version.multiplicity,
        "coordinate_authority": auth_label,
        "source_description": source_desc,
        "calculated_results": results,
        "exported_at": datetime.now(UTC).isoformat(),
        "exporter": EXPORTER_NAME,
        **({"crystal": crystal_data} if crystal_data else {}),
        **({"source_reference": source_reference} if source_reference else {}),
    }
    manifest_bytes = json.dumps(manifest_dict, indent=2).encode("utf-8")

    # Multi-page ReportLab layout
    layout: dict[str, Any] = {}
    report_pdf_bytes = generate_report_pages_pdf(
        project_name=project.name,
        title=title,
        formula=formula,
        atom_count=len(atoms),
        bond_count=len(bonds),
        charge=version.overall_charge,
        multiplicity=version.multiplicity,
        coordinate_authority=auth_label,
        results_data=results,
        user_notes=f"Structure: {structure.name}\nSource: {source_desc}",
        include_3d_viewport=True,
        poster_jpeg_bytes=poster_clean_bytes,
        layout_out=layout,
        doc_title=f"ChemDFT 3D Model — {structure.name}",
        citation=citation_block(
            project_calculation_facts(session, project_id),
            summary_only=True,
            tools_used=detect_project_tools(session, project_id),
        ),
        crystal_data=crystal_data,
        source_reference=source_reference,
    )

    slug = project.slug or "chemdft"
    clean_title = structure.name.replace(" ", "_").lower()
    xyz_filename = f"{clean_title}_v{version.revision}.xyz"
    json_filename = f"{clean_title}_v{version.revision}_provenance.json"

    # Assemble 3D PDF
    pdf_bytes = assemble_3d_pdf(
        report_pdf_bytes=report_pdf_bytes,
        prc_bytes=prc_bytes,
        poster_jpeg_bytes=poster_bytes,
        xyz_filename=xyz_filename,
        xyz_bytes=xyz_text.encode("utf-8"),
        json_filename=json_filename,
        json_bytes=manifest_bytes,
        title=f"ChemDFT 3D Model — {structure.name}",
        viewport_page_index=layout.get("page_index", 1),
        viewport_rect=layout.get("rect"),
    )

    filename = f"{slug}_{clean_title}_3d.pdf"
    return filename, "application/pdf", pdf_bytes


def export_project_report_pdf(
    session: Session,
    identity: Identity,
    project_id: str,
    structure_version_id: str | None = None,
) -> tuple[str, str, bytes]:
    """Generates a static report PDF universally readable across all standard PDF viewers."""
    project, _member = authorize_project_access(session, identity, project_id)
    structure, version = get_project_active_structure(session, project_id, structure_version_id)
    atoms, bonds, xyz_text = _extract_structure_geometry(version)
    results = get_project_results_data(session, project_id)

    crystal_data = _extract_crystal_metadata(version)
    source_reference = _extract_source_reference(session, version)

    origin_str = str(getattr(version, "origin", "")).upper()
    if origin_str in ("OPTIMIZED", "CALCULATION", "IMPORTED_CALCULATION"):
        auth_label = "CALCULATED"
        source_desc = "Optimized geometry from quantum calculation."
    elif crystal_data:
        auth_label = "USER_ENTERED · NOT OPTIMIZED"
        source_desc = "Imported crystal structure; periodic coordinates and unit cell from source file."
    else:
        auth_label = "USER_ENTERED · NOT OPTIMIZED"
        source_desc = "User-built or imported coordinates; no geometry optimization has been run."

    formula = _compute_gross_formula(atoms)
    title = f"{structure.name} (V{version.revision})"

    poster_bytes = generate_molecule_poster(atoms, bonds, width=1008, height=840, overlays=False)

    manifest_dict = {
        "project_id": project.id,
        "project_name": project.name,
        "structure_id": structure.id,
        "structure_name": structure.name,
        "version_id": version.id,
        "revision": version.revision,
        "formula": formula,
        "atom_count": len(atoms),
        "bond_count": len(bonds),
        "charge": version.overall_charge,
        "multiplicity": version.multiplicity,
        "coordinate_authority": auth_label,
        "source_description": source_desc,
        "calculated_results": results,
        "exported_at": datetime.now(UTC).isoformat(),
        "exporter": EXPORTER_NAME,
        **({"crystal": crystal_data} if crystal_data else {}),
        **({"source_reference": source_reference} if source_reference else {}),
    }
    manifest_bytes = json.dumps(manifest_dict, indent=2).encode("utf-8")

    report_pdf_bytes = generate_report_pages_pdf(
        project_name=project.name,
        title=title,
        formula=formula,
        atom_count=len(atoms),
        bond_count=len(bonds),
        charge=version.overall_charge,
        multiplicity=version.multiplicity,
        coordinate_authority=auth_label,
        results_data=results,
        user_notes=f"Structure: {structure.name}\nSource: {source_desc}",
        include_3d_viewport=False,
        poster_jpeg_bytes=poster_bytes,
        doc_title=f"ChemDFT Scientific Report — {structure.name}",
        citation=citation_block(
            project_calculation_facts(session, project_id),
            summary_only=True,
            tools_used=detect_project_tools(session, project_id),
        ),
        crystal_data=crystal_data,
        source_reference=source_reference,
    )

    slug = project.slug or "chemdft"
    clean_title = structure.name.replace(" ", "_").lower()
    xyz_filename = f"{clean_title}_v{version.revision}.xyz"
    json_filename = f"{clean_title}_v{version.revision}_provenance.json"

    pdf_bytes = assemble_static_report_pdf(
        report_pdf_bytes=report_pdf_bytes,
        xyz_filename=xyz_filename,
        xyz_bytes=xyz_text.encode("utf-8"),
        json_filename=json_filename,
        json_bytes=manifest_bytes,
        title=f"ChemDFT Scientific Report — {structure.name}",
    )

    filename = f"{slug}_{clean_title}_report.pdf"
    return filename, "application/pdf", pdf_bytes


def _generate_fallback_svg(
    atoms: list[tuple[str, list[float]]],
    bonds: list[tuple[int, int]],
    width: int = 560,
    height: int = 420,
) -> str:
    """Generates an embedded 2D vector fallback SVG from Cartesian coordinates when WebGL is unavailable."""
    if not atoms:
        return (
            f'<svg width="100%" height="100%" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Structure fallback">'
            f'<rect width="{width}" height="{height}" fill="#101a24" rx="2"/>'
            f'<text x="{width/2:.1f}" y="{height/2:.1f}" font-family="ui-monospace, monospace" font-size="13" fill="#a7b4c1" text-anchor="middle">No atom coordinates available</text>'
            f'</svg>'
        )

    xs = [p[0] for _, p in atoms]
    ys = [p[1] for _, p in atoms]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    dx = max(max_x - min_x, 1.2)
    dy = max(max_y - min_y, 1.2)

    padding = 45.0
    usable_w = width - 2 * padding
    usable_h = height - 2 * padding
    scale = min(usable_w / dx, usable_h / dy)

    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0

    svg_parts = [
        f'<svg width="100%" height="100%" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="2D molecular structure diagram">',
        f'<rect width="{width}" height="{height}" fill="#101a24" rx="2"/>',
    ]

    # Bonds
    for i, j in bonds:
        if i >= len(atoms) or j >= len(atoms):
            continue
        x1 = width / 2.0 + (atoms[i][1][0] - cx) * scale
        y1 = height / 2.0 - (atoms[i][1][1] - cy) * scale
        x2 = width / 2.0 + (atoms[j][1][0] - cx) * scale
        y2 = height / 2.0 - (atoms[j][1][1] - cy) * scale
        svg_parts.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#2a3947" stroke-width="3" stroke-linecap="round"/>'
        )

    # Atoms
    for el, p in atoms:
        ax = width / 2.0 + (p[0] - cx) * scale
        ay = height / 2.0 - (p[1] - cy) * scale
        r, g, b = get_element_rgb(el)
        hex_col = f"#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}"
        rad = 14 if el != "H" else 9
        svg_parts.append(
            f'<circle cx="{ax:.1f}" cy="{ay:.1f}" r="{rad}" fill="{hex_col}" stroke="#101a24" stroke-width="1.5"/>'
        )
        luminance = r * 0.299 + g * 0.587 + b * 0.114
        text_fill = "#101a24" if luminance > 0.5 else "#ffffff"
        font_sz = 11 if el != "H" else 8
        svg_parts.append(
            f'<text x="{ax:.1f}" y="{ay + font_sz*0.35:.1f}" font-family="ui-monospace, monospace" font-size="{font_sz}" font-weight="bold" fill="{text_fill}" text-anchor="middle">{el}</text>'
        )

    svg_parts.append("</svg>")
    return "".join(svg_parts)


def build_standalone_interactive_html(
    project_name: str,
    structure_name: str,
    formula: str,
    atoms: list[tuple[str, list[float]]],
    bonds: list[tuple[int, int]],
    xyz_text: str,
    charge: int = 0,
    multiplicity: int = 1,
    coordinate_authority: str = "USER_ENTERED · NOT OPTIMIZED",
    source_description: str = "User-built or imported molecular coordinates; no geometry optimization has been run.",
    results_data: list[dict[str, Any]] | None = None,
    clean_title: str | None = None,
    project_slug: str = "chemdft",
    revision: int = 1,
    structures_catalog: list[dict[str, Any]] | None = None,
    citation: dict[str, Any] | None = None,
    crystal_data: dict[str, Any] | None = None,
    source_reference: str | None = None,
) -> str:
    """Builds a single-file, 100% self-contained interactive 3D HTML export (presentation only)."""
    esc = html_escape
    threedmol_js = _load_3dmol_js()
    fallback_svg = _generate_fallback_svg(atoms, bonds)
    title_slug = clean_title or structure_name.replace(" ", "_").lower()

    def chip_class(authority: str) -> str:
        return "chip chip-calc" if authority.upper().startswith("CALCULATED") else "chip chip-user"

    results = results_data or []
    if results:
        rows_html = "".join(
            "<tr>"
            f"<th scope='row'>{esc(str(r['property']))}</th>"
            f"<td class='num'><code>{esc(str(r['value']))}</code></td>"
            f"<td>{esc(str(r['unit']))}</td>"
            f"<td>{esc(str(r['engine']))}</td>"
            f"<td><span class='{chip_class(str(r['authority']))}'>{esc(str(r['authority']))}</span></td>"
            "</tr>"
            for r in results
        )
    else:
        rows_html = (
            "<tr><td colspan='5' class='empty'>"
            "No calculation results recorded for this structure. Coordinates are unoptimized."
            "</td></tr>"
        )

    cite_html = ""
    if citation is not None:
        parts = []
        for item in citation["calculations"]:
            parts.append(
                f"<p class='cite-label'>Calculation {esc(item['calculation_id'])} (APA)</p><pre class='cite-text'>{esc(item['apa'])}</pre>"
                f"<p class='cite-label'>Calculation {esc(item['calculation_id'])} (BibTeX)</p><pre class='cite-text'>{esc(item['bibtex'])}</pre>"
            )
        parts.append(
            f"<p class='cite-label'>ChemDFT software (APA)</p><pre class='cite-text'>{esc(citation['software']['apa'])}</pre>"
            f"<p class='cite-label'>ChemDFT software (BibTeX)</p><pre class='cite-text'>{esc(citation['software']['bibtex'])}</pre>"
        )
        if citation.get("also_cite") and citation["also_cite"].get("tools"):
            parts.append("<h3 style='margin-top:1.25rem;font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.08em;'>Also cite</h3>")
            for t in citation["also_cite"]["tools"]:
                t_name = f"{t['name']} ({t.get('version', '')})" if t.get("version") else t["name"]
                parts.append(
                    f"<p class='cite-label'>{esc(t_name)} (APA)</p><pre class='cite-text'>{esc(t['apa'])}</pre>"
                    f"<p class='cite-label'>{esc(t_name)} (BibTeX)</p><pre class='cite-text'>{esc(t['bibtex'])}</pre>"
                )
            if citation["also_cite"].get("reminder"):
                parts.append(f"<p class='sub' style='margin-top:0.5rem;'><em>{esc(citation['also_cite']['reminder'])}</em></p>")
        parts.extend(f"<p class='sub'>{esc(note)}</p>" for note in citation["notes"])
        cite_html = (
            '<section class="card" aria-labelledby="h-cite" id="how-to-cite"><h2 id="h-cite">How to cite</h2>'
            + "".join(parts)
            + "</section>"
        )

    catalog = structures_catalog or []
    has_multiple = len(catalog) > 1
    struct_options_html = "".join(
        f'<option value="{esc(str(s.get("id", i)))}"{" selected" if s.get("name") == structure_name else ""}>'
        f'{esc(str(s.get("name", f"Structure {i + 1}")))}</option>'
        for i, s in enumerate(catalog)
    ) if has_multiple else ""
    selector_html = (
        '<div class="selector-bar"><div class="tool-group"><label for="struct-select" class="tool-label">Structure</label>'
        '<select id="struct-select" class="tool-select" onchange="handleSelectStructure(this.value)">'
        f"{struct_options_html}</select></div></div>"
    ) if has_multiple else ""

    catalog_json = _json_for_script(catalog) if has_multiple else "[]"
    xyz_clean = xyz_text.strip()
    xyz_json = _json_for_script(xyz_clean)
    now_str = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    logo_light = inline_svg("logo-horizontal-light.svg", "logo logo-light")
    logo_dark = inline_svg("logo-horizontal-dark.svg", "logo logo-dark")
    viewer_mark = inline_svg("mark-dark.svg", "viewer-mark").replace("<svg ", "<svg aria-hidden=\"true\" ", 1)
    favicon = favicon_data_uri()
    name_e = esc(structure_name)
    project_e = esc(project_name)
    authority_e = esc(coordinate_authority)
    source_e = esc(source_description)

    if crystal_data:
        facts_html = (
            f"<div><dt>Project</dt><dd>{project_e}</dd></div>"
            f"<div><dt>Formula</dt><dd class='mono' id='struct-formula'>{esc(formula)}</dd></div>"
            f"<div><dt>Atoms</dt><dd class='mono' id='struct-atom-count'>{len(atoms)}</dd></div>"
            f"<div><dt>Inferred bonds</dt><dd class='mono' id='struct-bond-count'>{len(bonds)}</dd></div>"
            f"<div><dt>Cell lengths</dt><dd class='mono'>{crystal_data['a']}, {crystal_data['b']}, {crystal_data['c']} Å</dd></div>"
            f"<div><dt>Cell angles</dt><dd class='mono'>{crystal_data['alpha']}°, {crystal_data['beta']}°, {crystal_data['gamma']}°</dd></div>"
            f"<div><dt>Volume</dt><dd class='mono'>{crystal_data['volume']} Å³</dd></div>"
            f"<div><dt>Space group</dt><dd class='mono'>{esc(str(crystal_data.get('space_group') or '—'))}</dd></div>"
        )
    else:
        facts_html = (
            f"<div><dt>Project</dt><dd>{project_e}</dd></div>"
            f"<div><dt>Formula</dt><dd class='mono' id='struct-formula'>{esc(formula)}</dd></div>"
            f"<div><dt>Atoms</dt><dd class='mono' id='struct-atom-count'>{len(atoms)}</dd></div>"
            f"<div><dt>Bonds</dt><dd class='mono' id='struct-bond-count'>{len(bonds)}</dd></div>"
            f"<div><dt>Charge</dt><dd class='mono'>{charge}</dd></div>"
            f"<div><dt>Multiplicity</dt><dd class='mono'>{multiplicity}</dd></div>"
        )

    if source_reference:
        source_ref_html = f"<dt>Source reference found in file</dt><dd>{esc(source_reference)}</dd>"
    elif crystal_data:
        source_ref_html = "<dt>Source reference</dt><dd><em>No source reference in the file — add one</em></dd>"
    else:
        source_ref_html = ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>{name_e} — ChemDFT Interactive 3D Model</title>
  <link rel="icon" type="image/svg+xml" href="{favicon}">
  <style>
    :root {{
      --font-ui: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-data: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      --canvas: #f7f9fb; --surface: #ffffff; --panel: #f1f4f7;
      --ink: #18212b; --ink-muted: #52606d;
      --line: #d6dde4; --line-strong: #b8c2cc;
      --accent: #1565a7; --accent-soft: #e4f0f8; --focus: #2d7fc1;
      --user-bg: #fdf3dc; --user-ink: #7a4b00; --user-line: #a96700;
      --calc-bg: #e3f3ea; --calc-ink: #14603a; --calc-line: #238551;
      --viewer-bg: #101a24; --viewer-line: #2a3947; --viewer-ink: #e6edf3; --viewer-muted: #a7b4c1;
      --viewer-btn-hover: #1d2b39; --viewer-accent: #7fb5e6;
      --radius: 4px;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --canvas: #0d141b; --surface: #141e28; --panel: #1a2631;
        --ink: #e6edf3; --ink-muted: #a7b4c1;
        --line: #2a3947; --line-strong: #3d5266;
        --accent: #7fb5e6; --accent-soft: #1b3042; --focus: #7fb5e6;
        --user-bg: #3a2a08; --user-ink: #f2c970; --user-line: #a96700;
        --calc-bg: #11301f; --calc-ink: #86d9a8; --calc-line: #238551;
      }}
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    html {{ color-scheme: light dark; }}
    body {{
      font-family: var(--font-ui); background: var(--canvas); color: var(--ink);
      line-height: 1.5; min-height: 100vh; display: flex; flex-direction: column;
      font-size: 14px; -webkit-font-smoothing: antialiased;
    }}
    :focus-visible {{ outline: 2px solid var(--focus); outline-offset: 2px; }}
    .logo {{ display: block; height: 46px; width: auto; }}
    .logo-dark {{ display: none; }}
    @media (prefers-color-scheme: dark) {{ .logo-light {{ display: none; }} .logo-dark {{ display: block; }} }}
    .site-header {{
      background: var(--surface); border-bottom: 1px solid var(--line);
      padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    }}
    .logo-link {{ display: block; }}
    .brand-line {{ display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--ink-muted); flex-wrap: wrap; }}
    .brand-line .sep {{ color: var(--line-strong); }}
    .page {{ width: 100%; max-width: 1440px; margin: 0 auto; padding: 24px; flex: 1; display: flex; flex-direction: column; gap: 20px; }}
    .title-block {{ display: flex; flex-direction: column; gap: 10px; }}
    .title-row {{ display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }}
    h1 {{ font-size: 24px; line-height: 1.2; font-weight: 650; letter-spacing: -0.015em; overflow-wrap: anywhere; }}
    .chip {{
      display: inline-block; font-family: var(--font-data); font-size: 11px; font-weight: 650; letter-spacing: 0.04em;
      text-transform: uppercase; padding: 2px 8px; border-radius: 2px; border: 1px solid; line-height: 1.5;
    }}
    .chip-user {{ background: var(--user-bg); color: var(--user-ink); border-color: var(--user-line); }}
    .chip-calc {{ background: var(--calc-bg); color: var(--calc-ink); border-color: var(--calc-line); }}
    .facts {{ display: flex; flex-wrap: wrap; gap: 6px 28px; }}
    .facts div {{ display: flex; flex-direction: column; min-width: 0; }}
    .facts dt {{ font-size: 11px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }}
    .facts dd {{ font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }}
    .facts dd.mono {{ font-family: var(--font-data); font-variant-numeric: tabular-nums; }}
    .layout {{ display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 20px; align-items: start; }}
    @media (max-width: 1000px) {{ .layout {{ grid-template-columns: minmax(0, 1fr); }} .page {{ padding: 16px; }} .site-header {{ padding: 10px 16px; }} }}
    .viewer-card {{ background: var(--viewer-bg); border: 1px solid var(--viewer-line); border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column; }}
    .viewer-stage {{ position: relative; }}
    #gviewer {{ width: 100%; height: clamp(360px, 64vh, 740px); position: relative; background: var(--viewer-bg); }}
    .viewer-mark {{ position: absolute; left: 12px; bottom: 12px; width: 28px; height: auto; opacity: 0.85; pointer-events: none; z-index: 5; }}
    .print-snapshot {{ display: none; width: 100%; height: auto; }}
    .webgl-fallback {{ display: none; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 360px; background: var(--viewer-bg); color: var(--viewer-ink); padding: 20px; }}
    .fallback-banner {{ background: rgba(169, 103, 0, 0.18); border: 1px solid #a96700; color: #f0c98a; border-radius: 2px; padding: 10px 16px; margin-bottom: 16px; font-size: 12px; text-align: center; max-width: 520px; line-height: 1.5; }}
    .fallback-svg-container {{ max-width: 560px; width: 100%; }}
    .viewer-toolbar {{ border-top: 1px solid var(--viewer-line); padding: 10px 12px; display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: end; }}
    .tool-group {{ display: flex; flex-direction: column; gap: 3px; }}
    .tool-label {{ font-size: 10px; font-weight: 650; color: var(--viewer-muted); text-transform: uppercase; letter-spacing: 0.08em; }}
    .viewer-toolbar .spacer {{ flex: 1 1 0; }}
    select.tool-select, button.tool-btn {{
      min-height: 34px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 500; border-radius: 2px;
      border: 1px solid var(--viewer-line); background: var(--viewer-bg); color: var(--viewer-ink); cursor: pointer;
      display: inline-flex; align-items: center; white-space: nowrap;
    }}
    button.tool-btn:hover, select.tool-select:hover {{ background: var(--viewer-btn-hover); border-color: #4a627a; }}
    .viewer-card :focus-visible {{ outline-color: var(--viewer-accent); }}
    button.tool-btn[aria-pressed="true"] {{ background: #1565a7; border-color: #3d86c6; color: #ffffff; }}
    .side-panel {{ display: flex; flex-direction: column; gap: 16px; min-width: 0; }}
    .selector-bar .tool-label {{ color: var(--ink-muted); }}
    .selector-bar select.tool-select {{ background: var(--surface); color: var(--ink); border-color: var(--line-strong); }}
    .selector-bar select.tool-select:hover {{ background: var(--panel); }}
    .notice-box {{ background: var(--accent-soft); border-left: 3px solid var(--accent); border-radius: 2px; padding: 10px 14px; font-size: 13px; }}
    .card {{ background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }}
    .card h2 {{ font-size: 12px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; }}
    .card .sub {{ font-size: 12px; color: var(--ink-muted); margin-top: -6px; }}
    .table-scroll {{ overflow-x: auto; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ padding: 8px 8px 8px 0; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }}
    thead th {{ color: var(--ink-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }}
    tbody th {{ font-weight: 600; }}
    td .chip {{ font-size: 10px; letter-spacing: 0.02em; padding: 1px 5px; white-space: nowrap; }}
    td.num {{ font-variant-numeric: tabular-nums; }}
    td.empty {{ color: var(--ink-muted); padding: 14px 0; font-size: 13px; }}
    code {{ font-family: var(--font-data); font-size: 12px; }}
    pre.cite-text {{ margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 2px; padding: 10px 12px; font-family: var(--font-data); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); user-select: all; }}
    .cite-label {{ margin: 4px 0 0; font-size: 12px; font-weight: 600; color: var(--ink-muted); }}
    pre.xyz-box {{ background: var(--panel); border: 1px solid var(--line); border-radius: 2px; padding: 10px 12px; font-family: var(--font-data); font-size: 12px; max-height: 220px; overflow: auto; white-space: pre; color: var(--ink); font-variant-numeric: tabular-nums; }}
    .btn-row {{ display: flex; gap: 8px; flex-wrap: wrap; }}
    button.card-btn {{ min-height: 34px; padding: 0 14px; font: inherit; font-size: 13px; font-weight: 500; border-radius: 2px; border: 1px solid var(--line-strong); background: var(--panel); color: var(--ink); cursor: pointer; }}
    button.card-btn:hover {{ background: var(--accent-soft); border-color: var(--accent); }}
    .prov {{ display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; font-size: 13px; }}
    .prov dt {{ color: var(--ink-muted); }}
    .prov dd {{ overflow-wrap: anywhere; }}
    .site-footer {{ border-top: 1px solid var(--line); padding: 14px 24px; font-size: 12px; color: var(--ink-muted); display: flex; justify-content: space-between; gap: 8px 24px; flex-wrap: wrap; }}
    @media (max-width: 600px) {{ h1 {{ font-size: 20px; }} .viewer-toolbar .spacer {{ display: none; }} .site-footer {{ padding: 14px 16px; }} }}
    @media print {{
      :root {{ --canvas: #fff; --surface: #fff; --panel: #f4f6f8; --ink: #000; --ink-muted: #333; --line: #bbb; --accent: #1565a7; }}
      body {{ background: #fff; font-size: 11px; }}
      .logo-light {{ display: block !important; }} .logo-dark {{ display: none !important; }}
      .viewer-toolbar, .selector-bar, .btn-row, #gviewer, .viewer-mark {{ display: none !important; }}
      .print-snapshot {{ display: block; background: var(--viewer-bg); }}
      .layout {{ grid-template-columns: minmax(0, 1fr); }}
      .page {{ padding: 8px 0; max-width: none; }}
      .card, .viewer-card {{ break-inside: avoid; }}
      pre.xyz-box {{ max-height: none; overflow: visible; }}
      * {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    }}
  </style>
</head>
<body>
  <header class="site-header">
    <a href="#main" class="logo-link" aria-label="ChemDFT">{logo_light}{logo_dark}</a>
    <p class="brand-line"><span>Release {RELEASE_VERSION}</span><span class="sep" aria-hidden="true">·</span><span>Standalone export</span><span class="sep" aria-hidden="true">·</span><span>Offline single file</span></p>
  </header>

  <main class="page" id="main">
    <section class="title-block" aria-label="Structure summary">
      <div class="title-row">
        <h1 id="struct-display-name">{name_e}</h1>
        <span class="{chip_class(coordinate_authority)}" id="struct-authority-badge">{authority_e}</span>
      </div>
      <dl class="facts">
        {facts_html}
      </dl>
    </section>

    <div class="layout">
      <section class="viewer-card" aria-label="3D structure viewer">
        <div class="viewer-stage">
          <div id="gviewer" data-testid="html-export-3d-viewport" role="img" aria-label="Interactive 3D model of {name_e}"></div>
          {viewer_mark}
          <img class="print-snapshot" id="print-snapshot" alt="Snapshot of the 3D model">
          <div id="webgl-fallback" class="webgl-fallback" data-testid="html-export-webgl-fallback">
            <div class="fallback-banner"><strong>WebGL Not Available:</strong> WebGL is disabled or unsupported in this browser environment. Displaying 2D vector fallback representation.</div>
            <div class="fallback-svg-container" id="fallback-svg-holder">{fallback_svg}</div>
          </div>
        </div>
        <div class="viewer-toolbar" role="toolbar" aria-label="3D viewer controls">
          <div class="tool-group">
            <label for="repr-select" class="tool-label">Style</label>
            <select id="repr-select" class="tool-select" onchange="setStyle(this.value)" data-testid="control-repr-select">
              <option value="ball_and_stick">Ball & Stick</option>
              <option value="stick">Sticks</option>
              <option value="sphere">Spheres (VDW)</option>
              <option value="line">Lines (Wireframe)</option>
            </select>
          </div>
          <div class="tool-group">
            <label for="palette-select" class="tool-label">Palette</label>
            <select id="palette-select" class="tool-select" onchange="setPalette(this.value)" data-testid="control-palette-select">
              <option value="chemdft">ChemDFT Dark</option>
              <option value="cpk">Standard CPK</option>
            </select>
          </div>
          <div class="tool-group">
            <label for="proj-select" class="tool-label">Projection</label>
            <select id="proj-select" class="tool-select" onchange="setProjection(this.value)" data-testid="control-proj-select">
              <option value="perspective">Perspective</option>
              <option value="orthographic">Orthographic</option>
            </select>
          </div>
          <div class="tool-group"><span class="tool-label" aria-hidden="true">Atom labels</span>
            <button type="button" class="tool-btn" id="btn-labels" onclick="toggleLabels()" aria-pressed="false" data-testid="control-btn-labels">Labels: OFF</button>
          </div>
          <div class="tool-group"><span class="tool-label" aria-hidden="true">Hydrogens</span>
            <button type="button" class="tool-btn" id="btn-hydrogens" onclick="toggleHydrogens()" aria-pressed="true" data-testid="control-btn-hydrogens">Hydrogens: ON</button>
          </div>
          <div class="spacer"></div>
          <div class="tool-group"><span class="tool-label" aria-hidden="true">View</span>
            <button type="button" class="tool-btn" id="btn-reset" onclick="resetView()" data-testid="control-btn-reset">Reset View</button>
          </div>
          <div class="tool-group"><span class="tool-label" aria-hidden="true">Image</span>
            <button type="button" class="tool-btn" id="btn-save-png" onclick="saveSnapshot()" data-testid="control-btn-save-png">Save PNG</button>
          </div>
        </div>
      </section>

      <div class="side-panel">
        {selector_html}
        <div class="notice-box"><strong>Export notice:</strong> Exported from ChemDFT; values keep the status they have in the project.</div>

        <section class="card" aria-labelledby="h-props">
          <h2 id="h-props">Calculated Properties</h2>
          <div class="table-scroll">
            <table>
              <thead><tr><th scope="col">Property</th><th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Engine</th><th scope="col">Status</th></tr></thead>
              <tbody id="properties-tbody">{rows_html}</tbody>
            </table>
          </div>
        </section>

        <section class="card" aria-labelledby="h-xyz">
          <h2 id="h-xyz">Coordinates</h2>
          <p class="sub">Cartesian Coordinates (XYZ)</p>
          <pre class="xyz-box" id="xyz-pre" tabindex="0" aria-label="XYZ coordinates">{esc(xyz_clean)}</pre>
          <div class="btn-row">
            <button type="button" class="card-btn" onclick="copyXYZ()" id="btn-copy-xyz">Copy XYZ</button>
            <button type="button" class="card-btn" onclick="downloadXYZ()" id="btn-dl-xyz">Download .xyz</button>
          </div>
        </section>

        <section class="card" aria-labelledby="h-prov">
          <h2 id="h-prov">Evidence &amp; Provenance</h2>
          <dl class="prov">
            <dt>Coordinate authority</dt><dd>{authority_e}</dd>
            <dt>Source</dt><dd>{source_e}</dd>
            {source_ref_html}
            <dt>Export date</dt><dd>{now_str}</dd>
            <dt>Exported by</dt><dd>{EXPORTER_NAME}</dd>
          </dl>
        </section>
        {cite_html}
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <div>3D viewer powered by <strong>3Dmol.js v2.5.5</strong> (BSD-3-Clause).</div>
    <div>No external network requests · self-contained offline file.</div>
  </footer>

  <script>
    // Embedded 3Dmol.js Library (BSD-3-Clause)
    {threedmol_js}
  </script>

  <script>
    let rawXyzData = {xyz_json};
    let viewer = null;
    let currentStyle = "ball_and_stick";
    let currentPalette = "chemdft";
    let isOrthographic = false;
    let showLabels = false;
    let showHydrogens = true;
    let atomLabels = [];
    const catalogData = {catalog_json};

    const CHEMDFT_COLORS = {{
      H: 0xffffff, B: 0xffb5b5, C: 0x909090, N: 0x3050f8, O: 0xff0d0d,
      F: 0x90e050, P: 0xff8000, S: 0xffff30, Cl: 0x1ff01f, Na: 0xab5cf2,
      Mg: 0x8aff00, Al: 0xbfa6a6, Si: 0xf0c8a0, K: 0x8f40d4, Ca: 0x3dff00,
      Fe: 0xe06633, Cu: 0xc88033, Zn: 0x7d80b0, Br: 0xa62929, I: 0x940094
    }};

    function isWebGLSupported() {{
      try {{
        const canvas = document.createElement("canvas");
        return !!(window.WebGLRenderingContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
      }} catch (e) {{
        return false;
      }}
    }}

    function showFallback() {{
      const viewerElem = document.getElementById("gviewer");
      const fallbackElem = document.getElementById("webgl-fallback");
      const mark = document.querySelector(".viewer-mark");
      if (viewerElem) viewerElem.style.display = "none";
      if (mark) mark.style.display = "none";
      if (fallbackElem) fallbackElem.style.display = "flex";
    }}

    window.addEventListener("DOMContentLoaded", () => {{
      const viewerElem = document.getElementById("gviewer");
      if (!isWebGLSupported()) {{ showFallback(); return; }}
      try {{
        viewer = $3Dmol.createViewer(viewerElem, {{ backgroundColor: 0x101a24 }});
        loadMoleculeModel(rawXyzData);
      }} catch (err) {{
        console.warn("Failed to initialize 3Dmol WebGL viewer, falling back to 2D view:", err);
        showFallback();
      }}
    }});

    window.addEventListener("beforeprint", () => {{
      if (!viewer) return;
      try {{ document.getElementById("print-snapshot").src = viewer.pngURI(); }} catch (e) {{}}
    }});

    function loadMoleculeModel(xyzContent) {{
      if (!viewer) return;
      viewer.clear();
      atomLabels = [];
      viewer.addModel(xyzContent, "xyz");
      applyRenderStyles();
      viewer.zoomTo();
      viewer.render();
    }}

    function applyRenderStyles() {{
      if (!viewer) return;
      const styleObj = {{}};
      const colorSpec = currentPalette === "chemdft" ? {{ colorscheme: {{ map: CHEMDFT_COLORS }} }} : {{}};
      if (currentStyle === "ball_and_stick") {{
        styleObj.stick = Object.assign({{ radius: 0.14 }}, colorSpec);
        styleObj.sphere = Object.assign({{ scale: 0.28 }}, colorSpec);
      }} else if (currentStyle === "stick") {{
        styleObj.stick = Object.assign({{ radius: 0.22 }}, colorSpec);
      }} else if (currentStyle === "sphere") {{
        styleObj.sphere = Object.assign({{ scale: 0.85 }}, colorSpec);
      }} else if (currentStyle === "line") {{
        styleObj.line = Object.assign({{ linewidth: 2.0 }}, colorSpec);
      }}
      viewer.setStyle({{}}, styleObj);
      if (!showHydrogens) {{
        viewer.setStyle({{ elem: "H" }}, {{ hidden: true, stick: {{ hidden: true }}, sphere: {{ hidden: true }}, line: {{ hidden: true }} }});
      }}
      clearLabels();
      if (showLabels) {{
        const atoms = viewer.getModel().selectedAtoms(showHydrogens ? {{}} : {{ elem: {{ $ne: "H" }} }});
        atoms.forEach((a, idx) => {{
          const lbl = viewer.addLabel(a.elem + (idx + 1), {{
            position: {{ x: a.x, y: a.y, z: a.z }},
            backgroundColor: 0x101a24, backgroundOpacity: 0.8, fontColor: 0xffffff, fontSize: 11, font: "monospace"
          }});
          atomLabels.push(lbl);
        }});
      }}
      viewer.render();
    }}

    function clearLabels() {{
      if (!viewer) return;
      atomLabels.forEach(l => viewer.removeLabel(l));
      atomLabels = [];
    }}

    function setStyle(val) {{ currentStyle = val; applyRenderStyles(); }}
    function setPalette(val) {{ currentPalette = val; applyRenderStyles(); }}

    function setProjection(val) {{
      isOrthographic = (val === "orthographic");
      if (viewer) {{ viewer.setCameraParameters({{ orthographic: isOrthographic }}); viewer.render(); }}
    }}

    function toggleLabels() {{
      showLabels = !showLabels;
      const btn = document.getElementById("btn-labels");
      if (btn) {{
        btn.textContent = showLabels ? "Labels: ON" : "Labels: OFF";
        btn.setAttribute("aria-pressed", showLabels ? "true" : "false");
      }}
      applyRenderStyles();
    }}

    function toggleHydrogens() {{
      showHydrogens = !showHydrogens;
      const btn = document.getElementById("btn-hydrogens");
      if (btn) {{
        btn.textContent = showHydrogens ? "Hydrogens: ON" : "Hydrogens: OFF";
        btn.setAttribute("aria-pressed", showHydrogens ? "true" : "false");
      }}
      applyRenderStyles();
    }}

    function resetView() {{ if (viewer) {{ viewer.zoomTo(); viewer.render(); }} }}

    function saveSnapshot() {{
      if (!viewer) return;
      const dataUrl = viewer.pngURI();
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "{title_slug}_snapshot.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }}

    function copyXYZ() {{
      navigator.clipboard.writeText(rawXyzData).then(() => {{
        const btn = document.getElementById("btn-copy-xyz");
        if (btn) {{
          const orig = btn.textContent;
          btn.textContent = "Copied!";
          setTimeout(() => btn.textContent = orig, 2000);
        }}
      }});
    }}

    function downloadXYZ() {{
      const blob = new Blob([rawXyzData], {{ type: "chemical/x-xyz" }});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "{title_slug}_v{revision}.xyz";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }}

    function handleSelectStructure(id) {{
      const item = catalogData.find(s => String(s.id) === String(id));
      if (!item) return;
      rawXyzData = item.xyz_text;
      document.getElementById("struct-display-name").textContent = item.name;
      document.getElementById("struct-formula").textContent = item.formula;
      document.getElementById("struct-atom-count").textContent = item.atom_count;
      document.getElementById("struct-bond-count").textContent = item.bond_count;
      document.getElementById("xyz-pre").textContent = item.xyz_text.trim();
      loadMoleculeModel(item.xyz_text);
    }}
  </script>
</body>
</html>"""


def export_project_interactive_html(
    session: Session,
    identity: Identity,
    project_id: str,
    structure_version_id: str | None = None,
) -> tuple[str, str, bytes]:
    """Generates a standalone, self-contained interactive HTML page with embedded 3Dmol.js (0 CDN requests)."""
    project, _member = authorize_project_access(session, identity, project_id)
    structure, version = get_project_active_structure(session, project_id, structure_version_id)
    atoms, bonds, xyz_text = _extract_structure_geometry(version)
    results = get_project_results_data(session, project_id)

    crystal_data = _extract_crystal_metadata(version)
    source_reference = _extract_source_reference(session, version)

    origin_str = str(getattr(version, "origin", "")).upper()
    if origin_str in ("OPTIMIZED", "CALCULATION", "IMPORTED_CALCULATION"):
        auth_label = "CALCULATED"
        source_desc = "Optimized geometry from quantum calculation."
    elif crystal_data:
        auth_label = "USER_ENTERED · NOT OPTIMIZED"
        source_desc = "Imported crystal structure; periodic coordinates and unit cell from source file."
    else:
        auth_label = "USER_ENTERED · NOT OPTIMIZED"
        source_desc = "User-built or imported coordinates; no geometry optimization has been run."

    formula = _compute_gross_formula(atoms)
    slug = project.slug or "chemdft"
    clean_title = structure.name.replace(" ", "_").lower()

    # Query other structures in the project for catalog
    versions = session.scalars(
        select(StructureVersionRecord)
        .where(StructureVersionRecord.project_id == project.id)
        .order_by(StructureVersionRecord.created_at.desc())
    ).all()
    structures_catalog: list[dict[str, Any]] = []
    seen_structures = set()
    for v in versions:
        if v.structure_id in seen_structures:
            continue
        seen_structures.add(v.structure_id)
        s = session.get(StructureRecord, v.structure_id)
        s_name = s.name if s else f"Structure {v.structure_id[:8]}"
        s_atoms, s_bonds, s_xyz = _extract_structure_geometry(v)
        structures_catalog.append({
            "id": v.structure_id,
            "name": s_name,
            "formula": _compute_gross_formula(s_atoms),
            "atom_count": len(s_atoms),
            "bond_count": len(s_bonds),
            "xyz_text": s_xyz,
        })

    html = build_standalone_interactive_html(
        project_name=project.name,
        structure_name=structure.name,
        formula=formula,
        atoms=atoms,
        bonds=bonds,
        xyz_text=xyz_text,
        charge=version.overall_charge,
        multiplicity=version.multiplicity,
        coordinate_authority=auth_label,
        source_description=source_desc,
        results_data=results,
        clean_title=clean_title,
        project_slug=slug,
        revision=version.revision,
        structures_catalog=structures_catalog,
        citation=citation_block(
            project_calculation_facts(session, project_id),
            summary_only=True,
            tools_used=detect_project_tools(session, project_id),
        ),
        crystal_data=crystal_data,
        source_reference=source_reference,
    )

    filename = f"{slug}_{clean_title}_interactive.html"
    return filename, "text/html; charset=utf-8", html.encode("utf-8")



def export_project_archive_zip(
    session: Session,
    identity: Identity,
    project_id: str,
) -> tuple[str, str, bytes]:
    """Builds a complete, reproducible project archive zip with structures, calculations, and manifest."""
    project, _member = authorize_project_access(session, identity, project_id)

    # 1. Fetch all structures and their versions
    structures = session.scalars(
        select(StructureRecord).where(StructureRecord.project_id == project.id)
    ).all()

    # 2. Fetch all calculations and results
    calculations = session.scalars(
        select(CalculationRecord).where(CalculationRecord.project_id == project.id)
    ).all()

    calc_inputs = session.scalars(
        select(CalculationInputRecord).where(CalculationInputRecord.project_id == project.id)
    ).all()
    calc_input_map = {c_in.calculation_id: c_in for c_in in calc_inputs}

    calc_results = session.scalars(
        select(CalculationResultRecord).where(CalculationResultRecord.project_id == project.id)
    ).all()

    buf = io.BytesIO()
    manifest_files: list[dict[str, Any]] = []
    manifest_notes: list[str] = []

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add structures
        for s in structures:
            versions = session.scalars(
                select(StructureVersionRecord)
                .where(StructureVersionRecord.structure_id == s.id)
                .order_by(StructureVersionRecord.revision.asc())
            ).all()

            for v in versions:
                clean_name = re.sub(r"[^a-zA-Z0-9_-]", "_", s.name).strip("_").lower() or f"structure_{s.id[:8]}"
                candidate = CanonicalStructureCandidate(
                    name=s.name,
                    kind=StructureKind(s.kind),
                    coordinates=v.representation_json["coordinates"],
                    overall_charge=v.overall_charge,
                    multiplicity=v.multiplicity,
                    source_format=StructureSourceFormat.SDF,
                    parser_name="chemdft",
                    parser_version="1.0.0",
                    adapter_name="chemdft.export",
                    adapter_version="1.0.0",
                )

                # XYZ
                try:
                    xyz_bytes = export_xyz(candidate)
                    xyz_path = f"structures/{clean_name}_v{v.revision}.xyz"
                    zf.writestr(xyz_path, xyz_bytes)
                    manifest_files.append({
                        "path": xyz_path,
                        "format": "XYZ",
                        "sha256": hashlib.sha256(xyz_bytes).hexdigest(),
                        "size_bytes": len(xyz_bytes),
                        "structure_id": s.id,
                        "version_id": v.id,
                        "revision": v.revision,
                        "atom_count": v.atom_count,
                    })
                except Exception as e:
                    manifest_notes.append(f"Structure '{s.name}' v{v.revision}: XYZ export omitted ({type(e).__name__}: {e})")

                # SDF
                try:
                    sdf_bytes = export_sdf(candidate)
                    sdf_path = f"structures/{clean_name}_v{v.revision}.sdf"
                    zf.writestr(sdf_path, sdf_bytes)
                    manifest_files.append({
                        "path": sdf_path,
                        "format": "SDF",
                        "sha256": hashlib.sha256(sdf_bytes).hexdigest(),
                        "size_bytes": len(sdf_bytes),
                        "structure_id": s.id,
                        "version_id": v.id,
                        "revision": v.revision,
                    })
                except Exception as e:
                    manifest_notes.append(f"Structure '{s.name}' v{v.revision}: SDF export omitted ({type(e).__name__}: {e})")

                # MOL
                try:
                    mol_bytes = export_mol(candidate)
                    mol_path = f"structures/{clean_name}_v{v.revision}.mol"
                    zf.writestr(mol_path, mol_bytes)
                    manifest_files.append({
                        "path": mol_path,
                        "format": "MOL",
                        "sha256": hashlib.sha256(mol_bytes).hexdigest(),
                        "size_bytes": len(mol_bytes),
                        "structure_id": s.id,
                        "version_id": v.id,
                        "revision": v.revision,
                    })
                except Exception as e:
                    manifest_notes.append(f"Structure '{s.name}' v{v.revision}: MOL export omitted ({type(e).__name__}: {e})")

                # SMILES
                try:
                    smi_bytes = export_smiles(candidate)
                    smi_path = f"structures/{clean_name}_v{v.revision}.smi"
                    zf.writestr(smi_path, smi_bytes)
                    manifest_files.append({
                        "path": smi_path,
                        "format": "SMILES",
                        "sha256": hashlib.sha256(smi_bytes).hexdigest(),
                        "size_bytes": len(smi_bytes),
                        "structure_id": s.id,
                        "version_id": v.id,
                        "revision": v.revision,
                    })
                except Exception as e:
                    manifest_notes.append(f"Structure '{s.name}' v{v.revision}: SMILES export omitted ({type(e).__name__}: {e})")

        # Add calculations and results
        for c in calculations:
            matching_results = [r for r in calc_results if r.calculation_id == c.id]
            engine_name = None
            for r in matching_results:
                software = r.producer_software_json or {}
                if software.get("name"):
                    engine_name = str(software["name"])
                    break
            if not engine_name:
                c_in = calc_input_map.get(c.id)
                if c_in and c_in.specification_json:
                    pref = c_in.specification_json.get("engine_preference") or {}
                    engine_name = pref.get("engine")

            calc_dict = {
                "calculation_id": c.id,
                "project_id": c.project_id,
                "engine": engine_name,
                "status": c.state,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "completed_at": (
                    c.updated_at.isoformat()
                    if c.updated_at and c.state in ("SUCCEEDED", "FAILED", "CANCELED")
                    else None
                ),
            }
            calc_dict["results"] = [
                {
                    "id": r.id,
                    "result_type": r.result_type,
                    "authority": str(r.authority),
                    "verification_state": str(r.verification_state),
                    "payload": r.payload_json,
                    "producer_software": r.producer_software_json,
                }
                for r in matching_results
            ]
            c_json_bytes = json.dumps(calc_dict, indent=2).encode("utf-8")
            c_path = f"calculations/calc_{c.id[:8]}.json"
            zf.writestr(c_path, c_json_bytes)
            manifest_files.append({
                "path": c_path,
                "format": "JSON",
                "sha256": hashlib.sha256(c_json_bytes).hexdigest(),
                "size_bytes": len(c_json_bytes),
                "calculation_id": c.id,
            })

        # Citations directory in archive
        facts = project_calculation_facts(session, project_id)
        software_meta = software_metadata()
        v_note = version_precision_note(meta=software_meta)

        cite_lines = [
            "========================================================================",
            f"ChemDFT Software Citation (Version {software_meta['version']})",
            "========================================================================",
            "",
            "APA:",
            software_apa(software_meta),
            "",
            "BibTeX:",
            software_bibtex(software_meta),
            "",
        ]
        if v_note:
            cite_lines.extend([f"Note: {v_note}", ""])

        if facts:
            cite_lines.extend([
                "========================================================================",
                "Calculation Citations & Methods",
                "========================================================================",
                "",
            ])
            for i, f in enumerate(facts, 1):
                cite_lines.extend([
                    f"--- Calculation {i}: {f.calculation_id} ---",
                    "APA:",
                    calculation_apa(f),
                    "",
                    "Methods paragraph:",
                    methods_paragraph(f),
                    "",
                ])
        else:
            cite_lines.extend([
                "========================================================================",
                "No calculations were recorded in this project snapshot.",
                "========================================================================",
                "",
            ])

        cite_text = "\n".join(cite_lines) + "\n"
        cite_bytes = cite_text.encode("utf-8")
        zf.writestr("citations/CITE.txt", cite_bytes)
        manifest_files.append({
            "path": "citations/CITE.txt",
            "format": "TXT",
            "sha256": hashlib.sha256(cite_bytes).hexdigest(),
            "size_bytes": len(cite_bytes),
        })

        if facts:
            calc_bib_text = "\n\n".join(calculation_bibtex(f) for f in facts) + "\n"
            calc_bib_bytes = calc_bib_text.encode("utf-8")
            zf.writestr("citations/calculations.bib", calc_bib_bytes)
            manifest_files.append({
                "path": "citations/calculations.bib",
                "format": "BIBTEX",
                "sha256": hashlib.sha256(calc_bib_bytes).hexdigest(),
                "size_bytes": len(calc_bib_bytes),
            })

            calc_txt_text = "\n\n".join(calculation_apa(f) for f in facts) + "\n"
            calc_txt_bytes = calc_txt_text.encode("utf-8")
            zf.writestr("citations/calculations.txt", calc_txt_bytes)
            manifest_files.append({
                "path": "citations/calculations.txt",
                "format": "TXT",
                "sha256": hashlib.sha256(calc_txt_bytes).hexdigest(),
                "size_bytes": len(calc_txt_bytes),
            })

        # Brand logo (owner's proprietary artwork; shipped for identification of the archive source only;
        # absent in the public export, where the archive simply omits it)
        logo_bytes = logo_svg_bytes()
        if logo_bytes is not None:
            zf.writestr("brand/chemdft-logo.svg", logo_bytes)
            manifest_files.append({
                "path": "brand/chemdft-logo.svg",
                "format": "SVG",
                "sha256": hashlib.sha256(logo_bytes).hexdigest(),
                "size_bytes": len(logo_bytes),
            })

        # Manifest
        manifest = {
            "schema": "chemdft.project-archive.v1",
            "project_id": project.id,
            "project_name": project.name,
            "slug": project.slug,
            "exported_at": datetime.now(UTC).isoformat(),
            "generator": EXPORTER_NAME,
            "file_count": len(manifest_files),
            "files": manifest_files,
            "notes": manifest_notes,
        }
        manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
        zf.writestr("manifest.json", manifest_bytes)

        # README
        readme_text = f"""ChemDFT Project Archive — {project.name}
========================================================================
Project ID:    {project.id}
Exported At:   {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S UTC')}
Generated By:  ChemDFT Release {RELEASE_VERSION}

Archive Contents:
- manifest.json: Cryptographic SHA256 integrity manifest and metadata.
- structures/:   Chemical coordinate representations (XYZ, SDF, MOL, SMILES).
                 Each file retains its evidence authority label.
- calculations/: Stored calculation outputs, parameters, and engine provenance.
- citations/:    Calculation and software citations (CITE.txt, calculations.bib, calculations.txt).
- brand/:        ChemDFT logo (identifies the source of this archive; not scientific data).

Scientific Integrity Notice:
All data in this archive derives strictly from recorded, validated ChemDFT
evidence. No missing points, frequencies, or values have been fabricated.
Coordinates without converged geometry optimization are labelled
as 'USER_ENTERED · NOT OPTIMIZED'.
========================================================================

{citation_block_text(citation_block(facts, tools_used=detect_project_tools(session, project_id)))}
"""
        zf.writestr("README.txt", readme_text.encode("utf-8"))

    slug = project.slug or "chemdft"
    filename = f"{slug}_archive.zip"
    return filename, "application/zip", buf.getvalue()
