# ruff: noqa: E501
"""REAL third-party spectra through the PRODUCTION import path (delimited text only; no JCAMP reader exists).

The files are not committed. They live in `.chemdft/experimental-fixtures` (see tests/experimental_spectra_fixtures_manifest.json for
sources, licences, hashes and what each file is expected to produce). A missing file skips its test; a present file whose SHA-256
differs from the manifest fails, so a silently changed fixture can never be mistaken for the one the expectations describe.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from spectra_support import peaks, requires_spectra_worker, resolve, transform, upload

pytestmark = requires_spectra_worker
REPO = Path(__file__).resolve().parents[3]
ROOT = REPO / ".chemdft/experimental-fixtures"
MANIFEST = json.loads(Path(__file__).with_name("experimental_spectra_fixtures_manifest.json").read_text())["fixtures"]
CONVERTER = REPO / "tools/convert_jcamp_affn_to_delimited.py"


def fixture_bytes(fixture_id: str) -> bytes:
    entry = MANIFEST[fixture_id]
    path = ROOT / entry["source_file"]
    if not path.is_file():
        pytest.skip(f"{fixture_id} is not present in .chemdft/experimental-fixtures (see the manifest for its source)")
    data = path.read_bytes()
    assert hashlib.sha256(data).hexdigest() == entry["source_sha256"], f"{fixture_id}: the file on disk is not the one the manifest describes"
    return data


@pytest.fixture
def project(api):
    client, _, _ = api
    return client.post("/v1/projects", json={"name": "Real spectra", "slug": "real-spectra"}).json()["id"]


def import_real(client, project_id, fixture_id, data: bytes, name: str):
    expected = MANIFEST[fixture_id]["import"]
    technique = MANIFEST[fixture_id]["technique"]
    first = upload(client, project_id, data, technique, name, f"real-{fixture_id}-upload").json()
    body = first["latest_preview"]["body"]
    assert body["needs"] == expected.get("needs_without_choices", []), body["diagnostics"]
    if expected["choices"]:
        assert first["latest_preview"]["status"] == "NEEDS_CONFIRMATION"
        first = resolve(client, project_id, first["id"], expected["choices"]).json()
    preview = first["latest_preview"]
    assert preview["status"] == "READY", preview["body"]["diagnostics"]
    response = client.post(f"/v1/projects/{project_id}/experimental/spectra/uploads/{first['id']}/confirm", json={"preview_sha256": preview["preview_sha256"], "idempotency_key": f"real-{fixture_id}-confirm"})
    assert response.status_code == 201, response.text
    return response.json(), preview["body"]


@pytest.mark.parametrize("fixture_id", ["opara-raman-acetone", "mainz-uv-acetone", "mainz-uv-acetone-vuv", "mainz-uv-formaldehyde"])
def test_real_files_need_confirmed_units_and_import(api, project, fixture_id):
    client, _, _ = api
    expected = MANIFEST[fixture_id]["import"]
    dataset, body = import_real(client, project, fixture_id, fixture_bytes(fixture_id), MANIFEST[fixture_id]["source_file"].rsplit("/", 1)[1])
    assert dataset["point_count"] == expected["points"] and dataset["x_min"] == pytest.approx(expected["x_min"]) and dataset["x_max"] == pytest.approx(expected["x_max"])
    assert dataset["x"]["unit_evidence"] == expected["units"]["x"] == dataset["y"]["unit_evidence"] == expected["units"]["y"] == "USER_CONFIRMED"
    assert dataset["x"]["definition"]["unit"]["code"] == expected["x_unit"] and dataset["y"]["definition"]["unit"]["code"] == expected["y_unit"]
    assert dataset["x_order"] == expected["direction"] and dataset["source"]["sha256"] == MANIFEST[fixture_id]["source_sha256"]
    for code in expected.get("diagnostics", []):
        assert code in [d["code"] for d in body["diagnostics"]]
    if "encoding" in expected:
        assert dataset["source"]["encoding"] == expected["encoding"]
    if expected.get("laser_wavelength") == "NOT_SUPPLIED":
        assert dataset["acquisition"]["excitation_wavelength_nm"]["status"] == "NOT_SUPPLIED"  # the file never states it, so it is never filled in


def test_real_nist_ir_through_the_production_path_with_a_hash_recorded_conversion(api, project, tmp_path):
    client, _, _ = api
    entry = MANIFEST["nist-ir-acetone-gas"]
    source = ROOT / entry["source_file"]
    if not source.is_file():
        pytest.skip("the NIST JCAMP-DX file is not present in .chemdft/experimental-fixtures")
    assert hashlib.sha256(source.read_bytes()).hexdigest() == entry["source_sha256"]
    out = tmp_path / "nist-ir-acetone-gas.tsv"
    subprocess.run([sys.executable, str(CONVERTER), str(source), str(out), "--lock", str(tmp_path / "lock.json")], check=True, capture_output=True)
    assert hashlib.sha256(out.read_bytes()).hexdigest() == entry["derived_sha256"]  # the conversion is deterministic and its output hash is recorded
    lock = json.loads((tmp_path / "lock.json").read_text())
    assert lock["source_sha256"] == entry["source_sha256"] and lock["output_sha256"] == entry["derived_sha256"] and lock["points"] == 880

    dataset, _ = import_real(client, project, "nist-ir-acetone-gas", out.read_bytes(), "nist-ir-acetone-gas.tsv")
    expected = entry["import"]
    assert dataset["x"]["unit_evidence"] == "EXPLICIT_UNIT" and dataset["y"]["unit_evidence"] == "EXPLICIT_UNIT"
    assert dataset["point_count"] == 880 and dataset["x_min"] == 450.0 and dataset["x_max"] == 3966.0
    assert dataset["x"]["definition"]["unit"]["code"] == expected["x_unit"] and dataset["y"]["quantity"] == "ABSORBANCE"
    assert dataset["acquisition"]["phase"]["status"] == "AS_REPORTED_IN_FILE" and dataset["acquisition"]["phase"]["value"] == "GAS"
    assert dataset["acquisition"]["resolution_cm1"]["status"] == "NOT_SUPPLIED"  # the JCAMP header gives the spacing, not the resolution, so none is claimed
    corrected = transform(client, project, dataset["id"], "baseline.snip", {"half_window_x": 150}).json()
    found = peaks(client, project, corrected["id"], {"prominence_sigma": 10}).json()
    positions = [p["x"] for p in found["peak_set"]["peaks"]]
    top = max(found["peak_set"]["peaks"], key=lambda p: p["prominence"])
    assert any(abs(x - 1738.9) < 5 for x in positions) and abs(top["x"] - 1738.9) < 5  # the carbonyl stretch dominates a real acetone IR spectrum


def test_real_raman_and_uv_peaks_sit_where_acetone_spectra_are_known_to_peak(api, project):
    client, _, _ = api
    raman, _ = import_real(client, project, "opara-raman-acetone", fixture_bytes("opara-raman-acetone"), "ace_h2o_ace_pure_1.txt")
    corrected = transform(client, project, raman["id"], "baseline.snip", {"half_window_x": 200}).json()
    found = peaks(client, project, corrected["id"], {"prominence_sigma": 20}).json()["peak_set"]["peaks"]
    for wanted in MANIFEST["opara-raman-acetone"]["expected_peak_near"]:
        assert any(abs(p["x"] - wanted) < 6 for p in found), f"no Raman peak near {wanted}"
    uv, _ = import_real(client, project, "mainz-uv-acetone", fixture_bytes("mainz-uv-acetone"), "acetone-uv.txt")
    uv_peaks = peaks(client, project, uv["id"], {"prominence_sigma": 10}).json()["peak_set"]["peaks"]
    assert any(abs(p["x"] - 274.0) <= 6 for p in uv_peaks)  # the n-pi* band of acetone
