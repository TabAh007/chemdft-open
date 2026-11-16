"""The backend export release version must equal the newest entry of apps/web/src/content/releases.ts."""

from __future__ import annotations

import json
import re
from pathlib import Path

from chemdft_api.release_info import EXPORTER_NAME, RELEASE_VERSION

ROOT = Path(__file__).resolve().parents[3]
RELEASES_TS = ROOT / "apps" / "web" / "src" / "content" / "releases.ts"
SRC = Path(__file__).resolve().parents[1] / "src" / "chemdft_api"
SOFTWARE_CITATION_JSON = SRC / "data" / "software_citation.json"
CITATION_CFF = ROOT / "CITATION.cff"
ZENODO_JSON = ROOT / ".zenodo.json"
WEB_PACKAGE_JSON = ROOT / "apps" / "web" / "package.json"


def test_all_six_version_sources_agree() -> None:
    # 1. backend release_info.py
    v_backend = RELEASE_VERSION

    # 2. releases.ts newest entry
    m_releases = re.search(r'version:\s*"(\d+\.\d+\.\d+)"', RELEASES_TS.read_text(encoding="utf-8"))
    assert m_releases is not None
    v_releases = m_releases.group(1)

    # 3. software_citation.json
    data_citation = json.loads(SOFTWARE_CITATION_JSON.read_text(encoding="utf-8"))
    v_citation = data_citation.get("version")

    # 4. CITATION.cff
    m_cff = re.search(r'^version:\s*"?([^"\n]+)"?\s*$', CITATION_CFF.read_text(encoding="utf-8"), re.M)
    assert m_cff is not None
    v_cff = m_cff.group(1)

    # 5. .zenodo.json
    data_zenodo = json.loads(ZENODO_JSON.read_text(encoding="utf-8"))
    v_zenodo = data_zenodo.get("version")

    # 6. apps/web/package.json
    data_pkg = json.loads(WEB_PACKAGE_JSON.read_text(encoding="utf-8"))
    v_pkg = data_pkg.get("version")

    versions = {
        "release_info.py": v_backend,
        "releases.ts": v_releases,
        "software_citation.json": v_citation,
        "CITATION.cff": v_cff,
        ".zenodo.json": v_zenodo,
        "apps/web/package.json": v_pkg,
    }

    assert len(set(versions.values())) == 1, f"Version mismatch detected: {versions}"
    assert v_backend == "0.0.60"
    assert EXPORTER_NAME == f"ChemDFT {RELEASE_VERSION}"


def test_export_modules_have_no_hard_coded_old_versions() -> None:
    for name in ("project_export.py", "pdf_export.py"):
        text = (SRC / name).read_text(encoding="utf-8")
        assert not re.search(r"0\.0\.1[0-9]\b|0\.0\.2[0-3]\b", text), name
