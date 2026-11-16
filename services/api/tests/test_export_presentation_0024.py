"""Release 0.0.24: logo and layout in the exports (presentation only; no API needed)."""

from __future__ import annotations

import io
import re
import shutil
import subprocess
import tempfile
import zipfile  # noqa: F401
from pathlib import Path

import pikepdf
import pytest

from chemdft_api import pdf_export as pdf
from chemdft_api.project_export import build_standalone_interactive_html
from chemdft_api.release_info import RELEASE_VERSION

ATOMS = [("N", [0.0, 0.0, 0.0]), ("O", [1.21, 0.0, 0.0]), ("O", [-0.6, 1.05, 0.0]), ("H", [-1.5, -1.05, 0.3])]
BONDS = [(0, 1), (0, 2), (0, 3)]
XYZ = "4\nhno3\n" + "\n".join(f"{e} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for e, p in ATOMS)
USER = "USER_ENTERED · NOT OPTIMIZED"
RESULT = {"property": "Total Energy", "value": "-1.5", "unit": "Eh", "engine": "Xtb 6.7.1", "authority": "CALCULATED"}


def _html(results: list[dict] | None = None, authority: str = USER, **kw) -> str:
    return build_standalone_interactive_html(
        "Proj & <b>x</b>", "hno3", "HNO3", ATOMS, BONDS, XYZ, 0, 1, authority, results_data=results, **kw
    )


def _pdf_text(data: bytes) -> str:
    if not shutil.which("pdftotext"):
        pytest.skip("pdftotext not installed")
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "x.pdf"
        path.write_bytes(data)
        return subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, check=True).stdout


def _report(include_3d: bool, results: list[dict] | None = None, authority: str = USER) -> bytes:
    poster = pdf.generate_molecule_poster(ATOMS, BONDS, 1008, 840, overlays=False)
    return pdf.generate_report_pages_pdf(
        "Proj", "hno3 (V1)", "HNO3", 4, 3, 0, 1, authority, results or [], user_notes="Structure: hno3",
        include_3d_viewport=include_3d, poster_jpeg_bytes=poster,
    )


def test_html_has_inline_logo_favicon_and_release_and_is_offline() -> None:
    html = _html()
    assert 'class="logo logo-light"' in html and 'class="logo logo-dark"' in html
    assert 'rel="icon"' in html and "data:image/svg+xml;base64," in html
    assert "0.0.13" not in html
    assert f"Release {RELEASE_VERSION}" in html and f"ChemDFT {RELEASE_VERSION}" in html
    # Offline: no loaded resource points at the network (the vendored library text itself may mention URLs).
    head_and_body = html.split("<script>")[0]
    assert not re.findall(r'(?:src|href)=["\']https?://', head_and_body)
    assert not re.findall(r"<link[^>]+(?:stylesheet|preload)[^>]*>", head_and_body)
    assert "@import" not in head_and_body and "url(http" not in head_and_body
    assert "prefers-color-scheme: dark" in html and "@media print" in html and ":focus-visible" in html


def test_html_authority_chip_once_without_brackets_and_text_is_escaped() -> None:
    html = _html()
    chip = re.search(r'id="struct-authority-badge">([^<]*)<', html)
    assert chip and chip.group(1) == USER
    assert "[USER_ENTERED" not in html and "[CALCULATED" not in html
    assert "Proj &amp; &lt;b&gt;x&lt;/b&gt;" in html
    assert "No calculation results recorded for this structure." in html


def test_html_result_rows_use_their_own_status_and_keep_controls() -> None:
    html = _html([RESULT])
    assert "chip chip-calc'>CALCULATED<" in html and "Total Energy" in html
    for testid in ("control-repr-select", "control-palette-select", "control-proj-select", "control-btn-labels",
                   "control-btn-hydrogens", "control-btn-reset", "control-btn-save-png", "html-export-webgl-fallback"):
        assert testid in html
    assert "btn-copy-xyz" in html and "btn-dl-xyz" in html and "2D molecular structure diagram" in html


@pytest.mark.parametrize("include_3d", [False, True])
def test_report_pdf_logo_pages_footer_and_status_once(include_3d: bool) -> None:
    data = _report(include_3d)
    with pikepdf.open(io.BytesIO(data)) as p:
        n = len(p.pages)
        assert 2 <= n <= 4
        images = [name for page in p.pages for name in page.Resources.get("/XObject", {})]
        assert images, "logo image missing"
    text = _pdf_text(data)
    assert f"Page 1 of {n}" in text and f"Page {n} of {n}" in text
    assert f"Release {RELEASE_VERSION}" in text and "0.0.13" not in text
    assert "[USER_ENTERED" not in text
    # once in the status chip and once in the identity cell; never doubled within one line/cell
    assert text.count(USER) == 2
    assert all(line.count("USER_ENTERED") <= 1 for line in text.splitlines())
    assert "No calculation results recorded for this structure." in text


def test_report_pdf_shows_stored_result_status_not_invented_validation() -> None:
    text = _pdf_text(_report(False, [RESULT], "CALCULATED"))
    assert "CALCULATED" in text and "VALIDATED" not in text and "-1.5" in text


def test_pdf_assembly_metadata_attachments_and_viewport_page() -> None:
    layout: dict = {}
    poster = pdf.generate_molecule_poster(ATOMS, BONDS, 1008, 840, overlays=False)
    base = pdf.generate_report_pages_pdf(
        "Proj", "hno3 (V1)", "HNO3", 4, 3, 0, 1, USER, [], include_3d_viewport=True,
        poster_jpeg_bytes=poster, layout_out=layout,
    )
    out = pdf.assemble_3d_pdf(
        base, b"PRC", pdf.generate_molecule_poster(ATOMS, BONDS), "a.xyz", XYZ.encode(), "a.json", b"{}",
        title="ChemDFT 3D Model — hno3", viewport_page_index=layout["page_index"], viewport_rect=layout["rect"],
    )
    static = pdf.assemble_static_report_pdf(base, "a.xyz", XYZ.encode(), "a.json", b"{}", title="Report")
    for data in (out, static):
        with pikepdf.open(io.BytesIO(data)) as p:
            assert set(p.attachments.keys()) == {"a.xyz", "a.json"}
            assert str(p.docinfo.Author) == f"ChemDFT {RELEASE_VERSION}"
            assert str(p.docinfo.Title)
    with pikepdf.open(io.BytesIO(out)) as p:
        annot = p.pages[layout["page_index"]].Annots[0]
        assert annot.Subtype == pikepdf.Name("/3D")


FORBIDDEN_FIXED_CLAIMS = (
    "PASS", "hallucination", "local verified", "verified in Adobe", "Immutable inputs, hash checked",
)


def test_no_export_contains_a_hard_coded_pass_or_verified_claim() -> None:
    """Release 0.0.25 (Part D): the report has no fixed verdict; statuses come from the stored data only."""
    from pathlib import Path

    for include_3d in (False, True):
        for results, authority in (([], USER), ([RESULT], "CALCULATED")):
            text = _pdf_text(_report(include_3d, results, authority))
            for claim in FORBIDDEN_FIXED_CLAIMS:
                assert claim not in text, (claim, include_3d, authority)
            assert "Scientific result firewall" in text
            assert "does not add a separate pass or fail verdict" in text.replace("\n", " ").replace("  ", " ") or "pass or fail" in text
    source = (Path(pdf.__file__)).read_text(encoding="utf-8")
    for claim in FORBIDDEN_FIXED_CLAIMS:
        assert claim not in source.replace("pass or fail verdict", ""), claim
    html = _html([RESULT], "CALCULATED")
    assert "hallucination" not in html and "zero AI" not in html
