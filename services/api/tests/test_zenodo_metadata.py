"""`.zenodo.json` is prepared metadata only: it must agree with CITATION.cff and never carry an invented DOI."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _cff(key: str) -> str:
    match = re.search(rf'^{key}:\s*"?([^"\n]+)"?\s*$', (ROOT / "CITATION.cff").read_text(), re.M)
    assert match, key
    return match.group(1)


def test_zenodo_metadata_matches_the_citation_file_and_carries_no_doi():
    meta = json.loads((ROOT / ".zenodo.json").read_text())
    assert meta["version"] == _cff("version")
    assert meta["publication_date"] == _cff("date-released")
    assert meta["license"] == _cff("license") == "Apache-2.0"
    assert meta["creators"][0]["orcid"] == "0009-0006-0198-5253"
    assert "orcid.org/0009-0006-0198-5253" in (ROOT / "CITATION.cff").read_text()
    assert not {"doi", "prereserve_doi"} & set(meta)
    assert all(r.get("scheme") != "doi" for r in meta.get("related_identifiers", []))


# ---------------------------------------------------------------------------------------------------------------------------
# Release 0.0.26: offline validation against the Zenodo metadata rules we know, and the "no invented DOI" guard.
# These are checks against a documented shape, NOT an upload. Whether Zenodo accepts every value is "to verify on Zenodo" (see
# docs/implementation/ZENODO_RELEASE_CHECKLIST.md): the relation names and the SPDX list below are written from our reading, not fetched.
# ---------------------------------------------------------------------------------------------------------------------------

DOI_SHAPE = re.compile(r"\b10\.\d{4,9}/[^\s\"'<>)\]}]+", re.I)
ORCID_SHAPE = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")
ZENODO_RELATIONS = {"isSupplementTo", "isSupplementedBy", "isDocumentedBy", "documents", "isDescribedBy", "describes", "cites", "isCitedBy", "isNewVersionOf", "isPreviousVersionOf", "isPartOf", "hasPart"}
SPDX_KNOWN = {"Apache-2.0", "MIT", "BSD-3-Clause", "GPL-3.0-or-later", "CC-BY-4.0"}


def _software() -> dict:
    return json.loads((ROOT / "services/api/src/chemdft_api/data/software_citation.json").read_text())


def test_zenodo_json_follows_the_metadata_rules_offline():
    meta = json.loads((ROOT / ".zenodo.json").read_text())
    assert meta["upload_type"] == "software"
    assert meta["title"] and meta["description"].strip()
    assert meta["version"] == _software()["version"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", meta["publication_date"])
    assert meta["keywords"] and all(isinstance(k, str) and k for k in meta["keywords"])
    assert meta["creators"]
    for creator in meta["creators"]:
        assert re.fullmatch(r"[^,]+, .+", creator["name"]), "creator name must be 'Family, Given'"
        assert ORCID_SHAPE.match(creator["orcid"])
    assert meta["related_identifiers"]
    for related in meta["related_identifiers"]:
        assert related["relation"] in ZENODO_RELATIONS and related["scheme"] == "url" and related["identifier"].startswith("https://")
    assert _software()["repository_code"] in {r["identifier"] for r in meta["related_identifiers"]}
    # The licence claim must match the licence map: Apache-2.0 only for the open group, and the description must say the rest is proprietary.
    assert meta["license"] in SPDX_KNOWN and meta["access_right"] == "open"
    reuse = (ROOT / "REUSE.toml").read_text()
    assert f'SPDX-License-Identifier = "{meta["license"]}"' in reuse
    assert "apache-2.0" in meta["description"].lower() and "not part of this record" in meta["description"]
    assert "held back" in meta["description"]


ALLOWED_DOIS = {
    "10.5281/zenodo.24082321",
    "10.5281/zenodo.24082322",
    "10.5281/zenodo.24122997",
    "10.5281/zenodo.24148448",
    "10.5281/zenodo.24183501",
    "10.5281/zenodo.24201081",
    "10.5281/zenodo.24204004",
    "10.5281/zenodo.24207715",
    "10.5281/zenodo.24209616",
    "10.5281/zenodo.24219804",
}


def test_a_doi_shaped_string_in_the_repository_metadata_must_be_the_one_set_constant():
    constant = _software()["doi"]
    # Exactly the owner-confirmed DOIs minted on Zenodo on 2026-11-09:
    # 10.5281/zenodo.24082321 (all-versions concept) and 10.5281/zenodo.24082322 (0.0.26 snapshot).
    # Any other DOI-shaped string still fails.
    allowed = {d.lower() for d in ALLOWED_DOIS}
    sources = [
        ROOT / "CITATION.cff",
        ROOT / ".zenodo.json",
        ROOT / "services/api/src/chemdft_api/data/software_citation.json",
        ROOT / "services/api/src/chemdft_api/citation_block.py",
        ROOT / "apps/web/src/lib/citation.ts",
        ROOT / "apps/web/src/lib/calculation-citation.ts",
    ]
    for path in sources:
        for found in DOI_SHAPE.findall(path.read_text(encoding="utf-8")):
            assert found.lower().rstrip(".,;") in allowed, f"{path.name} carries a DOI-shaped string that is not an allowed constant: {found}"
    cff = (ROOT / "CITATION.cff").read_text()
    if constant:
        assert re.search(rf'doi:\s*"?{re.escape(constant)}"?', cff)
        assert "10.5281/zenodo.24082322" in cff
    else:
        assert not re.search(r"^(doi|identifiers):", cff, re.M)
        zenodo = json.loads((ROOT / ".zenodo.json").read_text())
        assert not {"doi", "prereserve_doi"} & set(zenodo)


def test_the_software_metadata_file_agrees_with_citation_cff_and_zenodo_json():
    software, zenodo = _software(), json.loads((ROOT / ".zenodo.json").read_text())
    assert software["version"] == _cff("version") == zenodo["version"]
    assert software["date_released"] == _cff("date-released") == zenodo["publication_date"]
    assert software["license"] == _cff("license") == zenodo["license"]
    assert software["repository_code"] == _cff("repository-code")
    assert software["authors"][0]["orcid"].endswith(zenodo["creators"][0]["orcid"])
    # 0.0.36: one affiliation everywhere (chemdft.com), and the public website is the URL citations print.
    assert software["authors"][0]["affiliation"] == _cff("    affiliation") == zenodo["creators"][0]["affiliation"] == "chemdft.com"
    assert software["url"] == _cff("url") == "https://chemdft.com"


def test_0_0_40_version_doi_is_recorded_like_the_0_0_36_one():
    software = _software()
    assert software["snapshot_0_0_36_version_doi"] == "10.5281/zenodo.24122997"
    assert software["snapshot_0_0_40_version_doi"] == "10.5281/zenodo.24148448"
    assert software["doi"] == "10.5281/zenodo.24082321"  # concept DOI stays the citation DOI
    cff = (ROOT / "CITATION.cff").read_text()
    assert "10.5281/zenodo.24148448" in cff and "Version 0.0.40 open-core snapshot" in cff


def test_0_0_46_version_doi_is_recorded_as_a_source_snapshot_only():
    software = _software()
    assert software["snapshot_0_0_46_version_doi"] == "10.5281/zenodo.24183501"
    assert software["doi"] == "10.5281/zenodo.24082321"  # concept DOI stays the citation DOI
    cff = (ROOT / "CITATION.cff").read_text()
    assert "10.5281/zenodo.24183501" in cff and "Version 0.0.46 open-core snapshot" in cff


def test_0_0_50_version_doi_is_the_reserved_one_and_the_concept_doi_stays_the_citation_doi():
    software = _software()
    assert software["version"] == _cff("version")
    assert software["snapshot_0_0_50_version_doi"] == "10.5281/zenodo.24201081"
    assert software["doi"] == "10.5281/zenodo.24082321"  # "cite all versions"
    cff = (ROOT / "CITATION.cff").read_text()
    assert "10.5281/zenodo.24201081" in cff and "Version 0.0.50 open-core snapshot" in cff
    assert re.search(r'^doi:\s*10\.5281/zenodo\.24082321\s*$', cff, re.M)


def test_0_0_51_version_doi_is_recorded_and_not_the_0_0_50_one():
    software = _software()
    assert software["snapshot_0_0_51_version_doi"] == "10.5281/zenodo.24204004"
    assert software["snapshot_0_0_51_version_doi"] != software["snapshot_0_0_50_version_doi"]
    assert software["doi"] == "10.5281/zenodo.24082321"
    cff = (ROOT / "CITATION.cff").read_text()
    assert "10.5281/zenodo.24204004" in cff and "Version 0.0.51 open-core snapshot" in cff


def test_0_0_52_version_doi_is_recorded_and_not_the_0_0_51_one():
    software = _software()
    assert software["snapshot_0_0_52_version_doi"] == "10.5281/zenodo.24207715"
    assert software["snapshot_0_0_52_version_doi"] != software["snapshot_0_0_51_version_doi"]
    assert software["doi"] == "10.5281/zenodo.24082321"
    cff = (ROOT / "CITATION.cff").read_text()
    assert "10.5281/zenodo.24207715" in cff and "Version 0.0.52 open-core snapshot" in cff
    assert "TODO-DOI" not in cff


def test_0_0_53_version_doi_is_recorded_and_not_the_0_0_52_one():
    software = _software()
    assert software["snapshot_0_0_53_version_doi"] == "10.5281/zenodo.24209616"
    assert software["snapshot_0_0_53_version_doi"] != software["snapshot_0_0_52_version_doi"]
    assert software["doi"] == "10.5281/zenodo.24082321"
    cff = (ROOT / "CITATION.cff").read_text()
    assert "10.5281/zenodo.24209616" in cff and "Version 0.0.53 open-core snapshot" in cff


def test_0_0_57_version_doi_is_recorded_and_not_the_0_0_53_one():
    software = _software()
    assert software["snapshot_0_0_57_version_doi"] == "10.5281/zenodo.24219804"
    assert software["snapshot_0_0_57_version_doi"] != software["snapshot_0_0_53_version_doi"]
    assert software["doi"] == "10.5281/zenodo.24082321"
    cff = (ROOT / "CITATION.cff").read_text()
    assert "10.5281/zenodo.24219804" in cff and "Version 0.0.57 open-core snapshot" in cff

