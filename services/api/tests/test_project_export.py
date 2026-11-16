import io
import json
import zipfile

import pikepdf
import pytest
from rw2_support import seed_result
from test_geometry_workflow import accept, drawing, generate
from test_structure_workspace import _create_project, _import, XYZ_WATER


def test_smiles_structure_export(api):
    client, _, _ = api
    project = _create_project(client, "SMILES Export Test")["id"]
    response = generate(client, project, name="Water", mol_block=drawing("O"))
    assert response.status_code == 201, response.text
    accepted = accept(client, project, response.json()).json()
    structure = accepted["structure"]["id"]
    version = accepted["version"]["id"]

    url = f"/v1/projects/{project}/structures/{structure}/versions/{version}/export?file_format=SMILES"
    res = client.get(url)
    assert res.status_code == 200, res.text
    assert "chemical/x-daylight-smiles" in res.headers["content-type"]
    assert "O" in res.text.strip()


def test_export_capabilities_endpoint(api):
    client, _, _ = api
    res = client.get("/v1/export/capabilities")
    assert res.status_code == 200, res.text
    data = res.json()
    assert "export_3d_pdf_available" in data
    assert "export_report_pdf_available" in data
    assert data["export_report_pdf_available"] is True
    assert data["export_html_available"] is True
    assert data["export_archive_available"] is True


def test_project_exports_suite(api, monkeypatch):
    client, _, _ = api
    project = _create_project(client, "Export Suite Test")["id"]
    response = generate(client, project, name="Ethanol")
    assert response.status_code == 201, response.text
    accepted = accept(client, project, response.json()).json()
    version_id = accepted["version"]["id"]

    # 1. 3D PDF Capability Guard (when disabled / absent from PATH)
    monkeypatch.delenv("CHEMDFT_ENABLE_LOCAL_ASYMPTOTE_DEV", raising=False)
    monkeypatch.delenv("CHEMDFT_ASYMPTOTE_BIN", raising=False)
    cap_res = client.get("/v1/export/capabilities")
    assert cap_res.status_code == 200
    if not cap_res.json()["export_3d_pdf_available"]:
        pdf_3d_guard = client.get(f"/v1/projects/{project}/export/3d-pdf")
        assert pdf_3d_guard.status_code == 501
        assert pdf_3d_guard.json()["detail"]["error"] == "3d_pdf_not_available"

    # 1b. 3D PDF Export (with local dev toolchain enabled if present)
    from chemdft_api.pdf_export import check_3d_pdf_capability
    monkeypatch.setenv("CHEMDFT_ENABLE_LOCAL_ASYMPTOTE_DEV", "1")
    available, _ = check_3d_pdf_capability()
    if available:
        pdf_3d_res = client.get(f"/v1/projects/{project}/export/3d-pdf")
        assert pdf_3d_res.status_code == 200, pdf_3d_res.text
        assert pdf_3d_res.headers["content-type"] == "application/pdf"
        assert "attachment;" in pdf_3d_res.headers["content-disposition"]
        with pikepdf.open(io.BytesIO(pdf_3d_res.content)) as p:
            assert len(p.pages) >= 2
            # Verify 3D annotation on page 2
            page2 = p.pages[1]
            assert "/Annots" in page2
            annot = page2.Annots[0]
            assert annot.Subtype == pikepdf.Name("/3D")
            assert "/3DD" in annot
            # Verify attachments
            assert len(p.attachments) >= 2

        specific_res = client.get(f"/v1/projects/{project}/export/3d-pdf?structure_version_id={version_id}")
        assert specific_res.status_code == 200

    # 2. Static Report PDF Export
    report_res = client.get(f"/v1/projects/{project}/export/report-pdf")
    assert report_res.status_code == 200, report_res.text
    assert report_res.headers["content-type"] == "application/pdf"
    with pikepdf.open(io.BytesIO(report_res.content)) as p:
        assert len(p.pages) >= 2
        assert len(p.attachments) >= 2

    # 3. Interactive HTML Export
    html_res = client.get(f"/v1/projects/{project}/export/html")
    assert html_res.status_code == 200, html_res.text
    assert "text/html" in html_res.headers["content-type"]
    html_text = html_res.text
    assert len(html_text) > 500_000, f"HTML export should embed real 3Dmol (>500KB), got {len(html_text)} bytes"
    assert "3Dmol-min.js.LICENSE.txt" in html_text
    assert 'exports["3Dmol"]' in html_text
    assert "createViewer" in html_text
    assert "/* 3Dmol.js not found" not in html_text
    assert "Ethanol" in html_text
    assert "Cartesian Coordinates" in html_text
    assert "USER_ENTERED · NOT OPTIMIZED" in html_text
    assert 'class="logo logo-light"' in html_text and "0.0.13" not in html_text

    # 4. Project Archive Zip Export
    archive_res = client.get(f"/v1/projects/{project}/export/archive")
    assert archive_res.status_code == 200, archive_res.text
    assert archive_res.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(archive_res.content)) as z:
        namelist = z.namelist()
        assert "manifest.json" in namelist
        assert "README.txt" in namelist
        assert "brand/chemdft-logo.svg" in namelist
        assert any(n.startswith("structures/") and n.endswith(".xyz") for n in namelist)
        assert any(n.startswith("structures/") and n.endswith(".smi") for n in namelist)


def test_3dmol_asset_integrity_and_missing_asset_guard(monkeypatch, tmp_path):
    from pathlib import Path
    import chemdft_api.project_export as pe

    # Real asset passes check
    real_js = pe._load_3dmol_js()
    assert len(real_js) > 500_000
    assert "3Dmol-min.js.LICENSE.txt" in real_js
    assert 'exports["3Dmol"]' in real_js

    # Missing asset raises FileNotFoundError
    nonexistent = tmp_path / "nonexistent-3Dmol-min.js"
    monkeypatch.setattr(pe, "THREEDMOL_ASSET_PATH", nonexistent)
    with pytest.raises(FileNotFoundError, match="Required asset 3Dmol-min.js not found"):
        pe._load_3dmol_js()

    # Corrupted asset raises ValueError checksum mismatch
    corrupted = tmp_path / "corrupted-3Dmol-min.js"
    corrupted.write_text("corrupted content", encoding="utf-8")
    monkeypatch.setattr(pe, "THREEDMOL_ASSET_PATH", corrupted)
    with pytest.raises(ValueError, match="integrity check failed"):
        pe._load_3dmol_js()


def test_project_archive_and_reports_with_calculations_and_optimization(api):
    from datetime import UTC, datetime
    from uuid import uuid4
    from chemdft_api.scientific_models import StructureVersionRecord

    client, sessions, _ = api
    project = _create_project(client, "Archive Calc & Opt Test")["id"]
    res = _import(client, project, "water.xyz", XYZ_WATER, "XYZ")
    assert res.status_code == 201
    version_id = res.json()["version"]["id"]

    # Append an OPTIMIZED structure version
    with sessions() as session:
        version = session.get(StructureVersionRecord, version_id)
        values = {c.name: getattr(version, c.name) for c in StructureVersionRecord.__table__.columns}
        values.update(
            id=str(uuid4()),
            origin="OPTIMIZED",
            revision=version.revision + 1,
            parent_version_id=version.id,
            idempotency_key=str(uuid4()),
            created_at=datetime.now(UTC),
        )
        final_version = StructureVersionRecord(**values)
        session.add(final_version)
        session.commit()
        final_version_id = final_version.id

    # Seed calculation with optimization result on the final version
    calc_id, result_id = seed_result(sessions, project, final_version_id, "opt")

    # 1. HTML export: verify CALCULATED authority and results
    html_res = client.get(f"/v1/projects/{project}/export/html")
    assert html_res.status_code == 200, html_res.text
    html_text = html_res.text
    assert "CALCULATED" in html_text
    assert "Optimized geometry from quantum calculation" in html_text
    assert "Optimized Energy" in html_text
    assert "No calculation results recorded for this structure" not in html_text
    assert "10.5281/zenodo.24082321" in html_text

    # 2. Report PDF export: verify valid PDF
    report_res = client.get(f"/v1/projects/{project}/export/report-pdf")
    assert report_res.status_code == 200, report_res.text
    with pikepdf.open(io.BytesIO(report_res.content)) as p:
        assert len(p.pages) >= 1

    # 3. Archive export: verify 200 and archive contents
    archive_res = client.get(f"/v1/projects/{project}/export/archive")
    assert archive_res.status_code == 200, archive_res.text
    assert archive_res.headers["content-type"] == "application/zip"

    with zipfile.ZipFile(io.BytesIO(archive_res.content)) as z:
        namelist = z.namelist()
        assert "manifest.json" in namelist
        assert "README.txt" in namelist
        assert "citations/calculations.bib" in namelist
        assert "citations/calculations.txt" in namelist
        assert "citations/CITE.txt" in namelist

        cite_content = z.read("citations/CITE.txt").decode("utf-8")
        assert "ChemDFT Software Citation" in cite_content
        assert "Methods paragraph:" in cite_content

        manifest = json.loads(z.read("manifest.json").decode("utf-8"))
        assert "notes" in manifest
        assert isinstance(manifest["notes"], list)

        # Calculations in manifest
        calc_entries = [f for f in manifest["files"] if f["path"].startswith("calculations/")]
        assert len(calc_entries) > 0
        calc_json = json.loads(z.read(calc_entries[0]["path"]).decode("utf-8"))
        assert calc_json["engine"] is not None
        assert calc_json["status"] == "SUCCEEDED"

        # README mentions software DOI
        readme = z.read("README.txt").decode("utf-8")
        assert "10.5281/zenodo.24082321" in readme


def test_project_archive_export_fail_soft(api, monkeypatch):
    client, _, _ = api
    project = _create_project(client, "Archive Fail Soft Test")["id"]
    res = _import(client, project, "water.xyz", XYZ_WATER, "XYZ")
    assert res.status_code == 201

    import chemdft_api.project_export as pe
    real_export_sdf = pe.export_sdf

    def failing_sdf(*args, **kwargs):
        raise RuntimeError("simulated SDF export failure")

    monkeypatch.setattr(pe, "export_sdf", failing_sdf)

    archive_res = client.get(f"/v1/projects/{project}/export/archive")
    assert archive_res.status_code == 200, archive_res.text

    with zipfile.ZipFile(io.BytesIO(archive_res.content)) as z:
        manifest = json.loads(z.read("manifest.json").decode("utf-8"))
        assert any("SDF export omitted" in note for note in manifest["notes"])

