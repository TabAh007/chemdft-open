"""Release 0.0.26: the citation block in the exports, the shared parity record and the DOI rule."""

from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import pikepdf
import pytest
from test_geometry_workflow import accept, generate
from test_structure_workspace import _create_project

from chemdft_api import pdf_export as pdf
from chemdft_api.citation_block import (
    NO_DOI_NOTE,
    SOFTWARE_NO_DOI_NOTE,
    ZENODO_SNAPSHOT_NOTE,
    CalculationFacts,
    calculation_apa,
    calculation_bibtex,
    citation_block,
    citation_block_text,
    software_apa,
    software_bibtex,
    software_metadata,
    version_precision_note,
)
from chemdft_api.project_export import build_standalone_interactive_html
from chemdft_api.release_info import RELEASE_VERSION

ROOT = Path(__file__).resolve().parents[3]
PARITY = json.loads((ROOT / "services/api/tests/fixtures/contracts/citation_parity.json").read_text(encoding="utf-8"))
ID = "11111111-2222-4333-8444-555555555555"
FACTS = CalculationFacts.from_dict(PARITY["calculations"][0]["facts"])
ATOMS = [("N", [0.0, 0.0, 0.0]), ("O", [1.21, 0.0, 0.0]), ("O", [-0.6, 1.05, 0.0]), ("H", [-1.5, -1.05, 0.3])]
BONDS = [(0, 1), (0, 2), (0, 3)]
XYZ = "4\nhno3\n" + "\n".join(f"{e} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for e, p in ATOMS)


@pytest.mark.parametrize("case", PARITY["calculations"], ids=lambda c: c["name"])
def test_calculation_citation_equals_the_web_panel_text(case):
    facts = CalculationFacts.from_dict(case["facts"])
    assert calculation_apa(facts) == case["apa"]
    assert calculation_bibtex(facts) == case["bibtex"]


@pytest.mark.parametrize("case", PARITY["software"], ids=lambda c: c["name"])
def test_software_citation_equals_the_web_panel_text(case):
    assert software_apa(case["meta"]) == case["apa"]
    assert software_bibtex(case["meta"]) == case["bibtex"]


def test_software_metadata_is_the_release_and_carries_real_doi():
    meta = software_metadata()
    assert meta["version"] == RELEASE_VERSION
    assert meta["doi"] == "10.5281/zenodo.24082321"
    assert "https://doi.org/10.5281/zenodo.24082321" in software_apa()
    assert "doi = {10.5281/zenodo.24082321}" in software_bibtex()


def test_software_citation_prints_the_website_and_never_github_in_any_format():
    """The code repository is private (0.0.36): every citation format prints the public website URL instead."""
    meta = software_metadata()
    assert meta["url"] == "https://chemdft.com"
    block = citation_block([FACTS])
    texts = [software_apa(), software_bibtex(), citation_block_text(block), *(item["apa"] + item["bibtex"] for item in block["calculations"])]
    for text in texts:
        assert "https://chemdft.com" in text
        assert "github.com" not in text
    assert meta["repository_code"] not in software_apa() + software_bibtex()


def test_a_set_doi_appears_in_the_software_citation_and_the_calculation_references_it():
    meta = {**software_metadata(), "doi": "10.5281/zenodo.24082321"}
    assert "https://doi.org/10.5281/zenodo.24082321" in software_apa(meta)
    assert "doi = {10.5281/zenodo.24082321}" in software_bibtex(meta)
    block = citation_block([FACTS], meta)
    assert block["notes"] == [NO_DOI_NOTE, ZENODO_SNAPSHOT_NOTE]
    assert SOFTWARE_NO_DOI_NOTE not in block["notes"]


def test_the_no_doi_notes_stay_outside_the_citation_text():
    block = citation_block([FACTS])
    assert block["notes"] == [NO_DOI_NOTE, ZENODO_SNAPSHOT_NOTE]
    for item in block["calculations"]:
        assert "No DOI" not in item["apa"] + item["bibtex"]
    assert "No DOI" not in block["software"]["apa"] + block["software"]["bibtex"]


def test_html_export_contains_the_citation_block_readably():
    block = citation_block([FACTS])
    html = build_standalone_interactive_html("P", "hno3", "HNO3", ATOMS, BONDS, XYZ, 0, 1, "USER_ENTERED · NOT OPTIMIZED", citation=block)
    assert 'id="how-to-cite"' in html and "How to cite" in html
    assert block["software"]["apa"] in html
    assert calculation_apa(FACTS) in html
    assert "@software{chemdft," in html and "@misc{chemdft_calculation_111111112222," in html
    assert "10.5281/zenodo.24082321" in html
    assert "pre.cite-text" in html and "pre-wrap" in html  # long lines wrap instead of running off the page
    plain = build_standalone_interactive_html("P", "hno3", "HNO3", ATOMS, BONDS, XYZ, 0, 1, "USER_ENTERED · NOT OPTIMIZED")
    assert "How to cite" not in plain  # no block unless the exporter supplies one


def _pdf_text(data: bytes) -> str:
    if not shutil.which("pdftotext"):
        pytest.skip("pdftotext not installed")
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "x.pdf"
        path.write_bytes(data)
        return subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, check=True).stdout


def _report_pdf(block: dict | None) -> bytes:
    poster = pdf.generate_molecule_poster(ATOMS, BONDS, 1008, 840, overlays=False)
    return pdf.generate_report_pages_pdf("Proj", "hno3 (V1)", "HNO3", 4, 3, 0, 1, "USER_ENTERED", [], user_notes="n", include_3d_viewport=False, poster_jpeg_bytes=poster, citation=block)


def test_report_pdf_contains_the_citation_block():
    data = _report_pdf(citation_block([FACTS]))
    with pikepdf.open(io.BytesIO(data)) as p:
        assert len(p.pages) >= 2
    text = " ".join(_pdf_text(data).split())
    assert "HOW TO CITE" in text
    for needle in ("@software{chemdft,", "Ahmadli, Tabriz", f"calculation {ID}", "Computer software", "single-point energy at HF/STO-3G", "No DOI yet and no public link", "10.5281/zenodo.24082321"):
        assert needle in text, needle
    assert "HOW TO CITE" not in _pdf_text(_report_pdf(None))


def test_archive_readme_and_exports_carry_the_block(api):
    client, _, _ = api
    project = _create_project(client, "Cite export test")["id"]
    accepted = accept(client, project, generate(client, project, name="Ethanol").json()).json()
    assert accepted["version"]["id"]
    archive = client.get(f"/v1/projects/{project}/export/archive")
    assert archive.status_code == 200, archive.text
    readme = zipfile.ZipFile(io.BytesIO(archive.content)).read("README.txt").decode("utf-8")
    assert "How to cite" in readme and software_apa() in readme and "@software{chemdft," in readme
    assert "10.5281/zenodo.24082321" in readme
    assert "snapshot of the open-core parts" in readme
    html = client.get(f"/v1/projects/{project}/export/html")
    assert html.status_code == 200 and software_apa() in html.text.replace("&amp;", "&").replace("&#x27;", "'")
    report = client.get(f"/v1/projects/{project}/export/report-pdf")
    assert report.status_code == 200
    assert "HOW TO CITE" in " ".join(_pdf_text(report.content).split())


def test_citation_block_text_lists_calculations_then_software():
    text = citation_block_text(citation_block([FACTS]))
    assert text.index(calculation_apa(FACTS)) < text.index(software_apa())


def test_version_precision_note_names_newest_archived_version():
    assert version_precision_note("0.0.57") is None
    assert version_precision_note("0.0.53") is None
    note58 = version_precision_note("0.0.58")
    assert note58 is not None
    assert "Version 0.0.58 has no archived Zenodo version DOI yet" in note58
    assert "10.5281/zenodo.24082321" in note58
    assert "newest archived version: 0.0.57" in note58
    note59 = version_precision_note("0.0.59")
    assert note59 is not None
    assert "Version 0.0.59 has no archived Zenodo version DOI yet" in note59
    assert "10.5281/zenodo.24082321" in note59
    assert "newest archived version: 0.0.57" in note59
