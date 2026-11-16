# ruff: noqa: E501  (parametrised format sets)
"""RW-2 scientific exports: format, numerical/unit fidelity, missing data, authorization."""

from __future__ import annotations

import csv
from uuid import uuid4

import numpy as np
import pytest
from chemdft_api.scientific_export import BOHR_IN_ANGSTROM, render_cube
from rw2_support import (
    EVIDENCE,
    create_project,
    dispute,
    import_structure,
    retract,
    seed_field_artifact,
    seed_result,
    supersede,
)


def _fixture(api, key="energy"):
    client, sessions, settings = api
    project = create_project(client)
    version = import_structure(client, project)
    calculation, result = seed_result(sessions, project, version, key)
    return client, sessions, settings, project, version, calculation, result


def _catalog(client, project, calculation):
    response = client.get(f"/v1/projects/{project}/calculations/{calculation}/exports")
    assert response.status_code == 200, response.text
    return {f["format"]: f for f in response.json()["formats"]}, response.json()


def _export(client, project, calculation, fmt, variant=None):
    params = {"format": fmt, **({"variant": variant} if variant else {})}
    return client.get(f"/v1/projects/{project}/calculations/{calculation}/export", params=params)


def _csv_rows(text):
    data = [line for line in text.splitlines() if not line.startswith("#")]
    return list(csv.reader(data))


# --------------------------------------------------------------------------------- catalog


@pytest.mark.parametrize(
    ("key", "available", "unavailable"),
    [
        ("energy", {"result-json", "report", "reproducibility-bundle"}, {"trajectory-xyz", "spectrum-csv", "cube"}),
        ("vib_raman", {"result-json", "spectrum-csv", "report", "reproducibility-bundle"}, {"trajectory-xyz", "cube"}),
        ("tddft", {"result-json", "spectrum-csv", "report", "reproducibility-bundle"}, {"trajectory-xyz", "cube"}),
        ("opt", {"result-json", "trajectory-xyz", "report", "reproducibility-bundle"}, {"spectrum-csv", "cube"}),
        ("mo", {"result-json", "report", "reproducibility-bundle"}, {"trajectory-xyz", "spectrum-csv", "cube"}),
    ],
)
def test_catalog_offers_only_formats_the_stored_evidence_supports(api, key, available, unavailable):
    client, _s, _t, project, _v, calculation, _r = _fixture(api, key)
    formats, body = _catalog(client, project, calculation)
    assert {f for f, o in formats.items() if o["available"]} == available
    for name in unavailable:
        assert formats[name]["unsupported_reason"], f"{name} must say why it is unavailable"
    assert body["evidence_use"] == "CURRENT"


def test_catalog_spectrum_variants_follow_stored_columns(api):
    client, sessions, _t = api
    project = create_project(client)
    version = import_structure(client, project)
    ir_calc, _ = seed_result(sessions, project, version, "vib_ir")
    raman_calc, _ = seed_result(sessions, project, version, "vib_raman")
    ir = _catalog(client, project, ir_calc)[0]["spectrum-csv"]
    raman = _catalog(client, project, raman_calc)[0]["spectrum-csv"]
    assert [v["key"] for v in ir["variants"]] == ["ir"]
    assert [v["key"] for v in raman["variants"]] == ["ir", "raman"]


def test_calculation_without_result_offers_nothing_and_says_so(api):
    client, sessions, _s = api
    project = create_project(client)
    version = import_structure(client, project)
    _calc, result = seed_result(sessions, project, version, "energy")
    from chemdft_api.scientific_models import CalculationRecord, CalculationResultRecord
    from sqlalchemy import delete

    with sessions() as session:
        record = session.get(CalculationResultRecord, result)
        calculation = record.calculation_id
        session.execute(delete(CalculationResultRecord).where(CalculationResultRecord.id == result))
        session.get(CalculationRecord, calculation).state = "RUNNING"
        session.commit()
    formats, body = _catalog(client, project, calculation)
    assert body["evidence_use"] == "NO_RESULT" and body["result_id"] is None
    # Only the evidence archive remains: it documents what exists (a provenance archive).
    assert {f for f, o in formats.items() if o["available"]} == {"reproducibility-bundle"}
    assert all(o["unsupported_reason"] for o in formats.values() if not o["available"])
    assert _export(client, project, calculation, "result-json").status_code == 422


# ----------------------------------------------------------------------------- result JSON


def test_result_json_preserves_values_units_identity_and_states(api):
    client, _s, _t, project, version, calculation, _result = _fixture(api, "energy")
    response = _export(client, project, calculation, "result-json")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert 'filename="result-' in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-chemdft-evidence-use"] == "CURRENT"
    document = response.json()
    stored = EVIDENCE["energy"]["payload"]
    assert document["schema"] == "chemdft.result-export.v2"
    assert document["result"]["payload"] == stored  # byte-for-byte scientific fidelity
    quantity = document["summary"]["quantities"][0]
    assert quantity["value"] == stored["total_energy"]["value"] and quantity["unit"] == "Eh"
    assert document["summary"]["structure"]["structure_version_id"] == version
    assert document["summary"]["structure"]["formula_hill"] == "H2O"
    state = document["scientific_state"]
    assert state["evidence_use"] == "CURRENT" and state["historical_evidence"] is False
    assert state["effective"]["authority"] == "AUTHORITATIVE"
    assert state["effective"]["verification_state"] == "UNVERIFIED"
    assert "not independently verified" in state["independent_verification"]["statement"].lower()
    assert document["provenance"]["record_id"] == document["result"]["provenance_record_id"]
    assert document["provenance"]["lineage"]["schema"] == "chemdft.result-lineage-export.v1"
    assert document["calculation"]["id"] == calculation


@pytest.mark.parametrize("change", ["supersede", "retract"])
def test_result_json_never_claims_current_authority_for_inactive_lineage(api, change):
    client, sessions, _t, project, _v, calculation, result = _fixture(api, "energy")
    {"supersede": supersede, "retract": retract}[change](sessions, result)
    response = _export(client, project, calculation, "result-json")
    assert response.status_code == 200
    assert response.headers["x-chemdft-evidence-use"] == "HISTORICAL_ONLY"
    assert response.headers["x-chemdft-effective-authority"] == "CANDIDATE"
    state = response.json()["scientific_state"]
    assert state["evidence_use"] == "HISTORICAL_ONLY" and state["historical_evidence"] is True
    assert state["effective"]["authority"] == "CANDIDATE"
    assert (
        state["effective"]["stored_authority"] == "AUTHORITATIVE"
    )  # history retained, not rewritten
    assert state["note"]
    # The recorded value is still present as history.
    assert response.json()["result"]["payload"] == EVIDENCE["energy"]["payload"]


# --------------------------------------------------------------------------- trajectory XYZ


def test_trajectory_xyz_is_the_stored_frames_in_order_with_original_atom_order(api):
    client, _s, _t, project, _v, calculation, _r = _fixture(api, "opt")
    response = _export(client, project, calculation, "trajectory-xyz")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("chemical/x-xyz")
    trajectory = EVIDENCE["opt"]["trajectory"]
    steps, atoms = trajectory["steps"], trajectory["atom_identities"]
    lines = response.text.splitlines()
    stride = len(atoms) + 2
    assert len(lines) == stride * len(steps)  # nothing added, nothing dropped
    for frame, step in enumerate(steps):
        block = lines[frame * stride : (frame + 1) * stride]
        assert int(block[0]) == len(atoms)
        assert f"frame={step['index']} " in block[1]
        assert f"energy_Eh={step['energy_hartree']!r}" in block[1]
        assert "length_unit=angstrom" in block[1] and "evidence_use=CURRENT" in block[1]
        for row, atom, xyz in zip(block[2:], atoms, step["coordinates_angstrom"], strict=True):
            symbol, *coords = row.split()
            assert symbol == atom["element"]
            assert np.allclose([float(c) for c in coords], xyz, atol=1e-9)


def test_trajectory_export_refuses_to_invent_frames(api):
    client, _s, _t, project, _v, calculation, _r = _fixture(api, "energy")
    response = _export(client, project, calculation, "trajectory-xyz")
    assert response.status_code == 422
    assert (
        "invent"
        in _catalog(client, project, calculation)[0]["trajectory-xyz"]["unsupported_reason"]
    )


# ----------------------------------------------------------------------------- spectra CSV


def test_ir_csv_is_the_stored_modes_with_units_and_context(api):
    client, _s, _t, project, _v, calculation, _r = _fixture(api, "vib_raman")
    response = _export(client, project, calculation, "spectrum-csv", "ir")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    header = [line for line in response.text.splitlines() if line.startswith("#")]
    text = "\n".join(header)
    assert "intensity_unit: km/mol" in text and "frequency_unit: cm^-1" in text
    assert "no broadening, no peak picking" in text
    assert (
        "evidence_use_at_export: CURRENT" in text and "independent_verification: UNVERIFIED" in text
    )
    rows = _csv_rows(response.text)
    assert rows[0] == ["mode_index", "frequency_cm-1", "ir_intensity_km_per_mol", "imaginary"]
    modes = EVIDENCE["vib_raman"]["payload"]["modes"]
    assert len(rows) - 1 == len(modes)
    for row, mode in zip(rows[1:], modes, strict=True):
        assert int(row[0]) == mode["index"]
        assert float(row[1]) == mode["frequency_cm1"]  # exact, not re-rounded
        assert float(row[2]) == mode["ir_intensity"]["value"]
        assert row[3] == str(mode["imaginary"]).lower()


def test_raman_csv_carries_activity_and_depolarization(api):
    client, _s, _t, project, _v, calculation, _r = _fixture(api, "vib_raman")
    rows = _csv_rows(_export(client, project, calculation, "spectrum-csv", "raman").text)
    assert rows[0][2] == "raman_activity_angstrom4_per_amu" and rows[0][4] == "depolarization_ratio"
    modes = EVIDENCE["vib_raman"]["payload"]["modes"]
    for row, mode in zip(rows[1:], modes, strict=True):
        assert float(row[2]) == mode["raman_activity"]["value"]
        ratio = mode["depolarization_ratio"]
        assert (row[4] == "") if ratio is None else float(row[4]) == ratio


def test_uvvis_csv_is_the_stored_excited_states(api):
    client, _s, _t, project, _v, calculation, _r = _fixture(api, "tddft")
    response = _export(client, project, calculation, "spectrum-csv", "uvvis")
    assert response.status_code == 200
    rows = _csv_rows(response.text)
    assert rows[0][:5] == [
        "state",
        "energy_Eh",
        "energy_eV",
        "wavelength_nm",
        "oscillator_strength",
    ]
    states = EVIDENCE["tddft"]["payload"]["excited_states"]
    assert len(rows) - 1 == len(states)  # no synthesized peaks or broadened curve
    for row, state in zip(rows[1:], states, strict=True):
        assert row[0] == state["state_label"]
        assert (
            float(row[3]) == state["wavelength_nm"]
            and float(row[4]) == state["oscillator_strength"]
        )


@pytest.mark.parametrize(
    ("key", "variant"), [("vib_ir", "raman"), ("energy", "ir"), ("tddft", "ir"), ("vib_ir", None)]
)
def test_spectrum_export_rejects_kinds_the_result_does_not_contain(api, key, variant):
    client, _s, _t, project, _v, calculation, _r = _fixture(api, key)
    response = _export(client, project, calculation, "spectrum-csv", variant)
    assert response.status_code == 422, response.text


# ------------------------------------------------------------------------------- Gaussian CUBE


def parse_cube(text: str):
    """Independent reader following the Gaussian CUBE specification (bohr, x slowest, z fastest)."""
    lines = text.splitlines()
    natoms, *origin = lines[2].split()
    natoms = int(natoms)
    axes = [lines[3 + i].split() for i in range(3)]
    dims = [int(a[0]) for a in axes]
    vectors = np.array([[float(x) for x in a[1:]] for a in axes])
    atoms = [lines[6 + i].split() for i in range(natoms)]
    values = np.array([float(v) for line in lines[6 + natoms :] for v in line.split()])
    return lines[:2], natoms, np.array(origin, dtype=float), dims, vectors, atoms, values


def test_render_cube_writes_axis_order_units_and_exact_float32_values():
    dims = (3, 2, 7)  # nz > 6 exercises the six-values-per-line wrap
    field = (
        np.arange(np.prod(dims), dtype="<f4").reshape(dims) * np.float32(0.123456789)
    ) - np.float32(1.5)
    atoms = [(8, (0.0, 0.0, 0.0)), (1, (0.0, 0.0, 0.9572))]
    text = render_cube(
        atoms=atoms,
        origin_angstrom=(-1.0, -2.0, -3.0),
        spacing_angstrom=0.12,
        dimensions=dims,
        values=[float(v) for v in field.reshape(-1)],
        comments=("title", "second"),
    )
    comments, natoms, origin, parsed_dims, vectors, parsed_atoms, values = parse_cube(text)
    assert comments == ["title", "second"] and natoms == 2 and parsed_dims == [3, 2, 7]
    assert np.allclose(origin, np.array([-1.0, -2.0, -3.0]) / BOHR_IN_ANGSTROM, atol=1e-7)
    assert np.allclose(vectors, np.eye(3) * 0.12 / BOHR_IN_ANGSTROM, atol=1e-7)
    assert [a[0] for a in parsed_atoms] == ["8", "1"] and float(parsed_atoms[1][1]) == 1.0
    assert np.allclose(
        [float(c) for c in parsed_atoms[1][2:]],
        np.array([0.0, 0.0, 0.9572]) / BOHR_IN_ANGSTROM,
        atol=1e-7,
    )
    assert np.array_equal(values.astype("<f4"), field.reshape(-1))  # lossless for float32 storage
    # each z-row ends a line: ceil(7/6)=2 lines per (ix, iy)
    assert len(text.splitlines()) == 6 + 2 + 3 * 2 * 2


def test_cube_export_of_a_stored_density_field(api):
    client, sessions, settings, project, version, calculation, result = _fixture(api, "mo")
    artifact, field = seed_field_artifact(sessions, settings, project, result, calculation, version)
    catalog = _catalog(client, project, calculation)[0]["cube"]
    assert catalog["available"] and [v["key"] for v in catalog["variants"]] == [artifact]
    assert (
        "Electron density" in catalog["variants"][0]["label"]
        and "e/a0^3" in catalog["variants"][0]["label"]
    )
    response = _export(client, project, calculation, "cube", artifact)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("chemical/x-cube")
    assert response.headers["content-disposition"].endswith('.cube"')
    comments, natoms, origin, dims, _vectors, atoms, values = parse_cube(response.text)
    assert "ELECTRON_DENSITY" in comments[0] and "e/bohr^3" in comments[0]
    assert natoms == 3 and dims == [5, 4, 6]
    assert np.allclose(origin, np.array([-1.5, -1.25, -1.0]) / BOHR_IN_ANGSTROM, atol=1e-7)
    assert [int(a[0]) for a in atoms] == [8, 1, 1]  # atomic identities and input order retained
    assert np.array_equal(values.astype("<f4"), field.reshape(-1))


def test_cube_export_does_not_fabricate_a_missing_grid(api):
    client, _s, _t, project, _v, calculation, _r = _fixture(api, "mo")
    cube = _catalog(client, project, calculation)[0]["cube"]
    assert not cube["available"] and "never computes a grid" in cube["unsupported_reason"]
    assert _export(client, project, calculation, "cube", str(uuid4())).status_code == 404
    assert _export(client, project, calculation, "cube").status_code == 422


def test_cube_rejects_a_grid_belonging_to_another_result_or_project(api):
    client, sessions, settings, project, _version, calculation, _result = _fixture(api, "mo")
    other_project = create_project(client, "other")
    other_version = import_structure(client, other_project)
    other_calc, other_result = seed_result(sessions, other_project, other_version, "mo")
    foreign, _ = seed_field_artifact(
        sessions, settings, other_project, other_result, other_calc, other_version
    )
    assert _export(client, project, calculation, "cube", foreign).status_code == 404
    # asking the other project's calculation through this project's URL must not work either
    assert _export(client, project, other_calc, "cube", foreign).status_code == 404


def test_tampered_stored_field_fails_integrity_instead_of_exporting(api):
    client, sessions, settings, project, version, calculation, result = _fixture(api, "mo")
    artifact, _ = seed_field_artifact(sessions, settings, project, result, calculation, version)
    from chemdft_api.scientific_models import ScientificArtifactRecord

    with sessions() as session:
        key = session.get(ScientificArtifactRecord, artifact).storage_key
    path = settings.object_root / key
    path.write_bytes(path.read_bytes()[:-3] + b"xyz")
    response = _export(client, project, calculation, "cube", artifact)
    assert response.status_code == 422 and "integrity" in response.text.lower()


# ------------------------------------------------------------ authorization / safety / compat


def test_unsupported_format_is_an_explicit_error_and_never_a_file(api):
    client, _s, _t, project, _v, calculation, _r = _fixture(api)
    response = _export(client, project, calculation, "pdf")
    assert response.status_code == 422 and "unsupported" in response.text.lower()
    assert "content-disposition" not in response.headers


def test_exports_do_not_cross_projects_and_do_not_confirm_foreign_ids(api):
    client, _s, _t, project, _v, calculation, _r = _fixture(api)
    other = create_project(client, "someone else")
    for url in (
        f"/v1/projects/{other}/calculations/{calculation}/exports",
        f"/v1/projects/{other}/calculations/{calculation}/export?format=result-json",
    ):
        assert client.get(url).status_code == 404
    missing = client.get(f"/v1/projects/{project}/calculations/{uuid4()}/export?format=result-json")
    foreign = client.get(
        f"/v1/projects/{other}/calculations/{calculation}/export?format=result-json"
    )
    assert missing.status_code == foreign.status_code == 404 and missing.json() == foreign.json()
    assert (
        client.get(f"/v1/projects/{uuid4()}/calculations/{calculation}/exports").status_code == 404
    )


def test_filenames_are_safe_for_any_stored_text():
    from chemdft_api.download_response import content_disposition, safe_filename

    for hostile in (
        "../../etc/passwd",
        'a"b;c.txt',
        "x\r\nSet-Cookie: z=1",
        "..",
        "",
        "ünï/çode\\name.cube",
    ):
        name = safe_filename(hostile)
        assert "/" not in name and "\\" not in name and "\r" not in name and "\n" not in name
        assert not name.startswith(".") and name
        assert '"' not in name and ";" not in name
        header = content_disposition(name)
        header.encode("ascii")
        assert "\n" not in header


def test_existing_downloads_still_work_with_the_shared_response(api):
    client, _s, _t, project, _v, _calculation, result = _fixture(api)
    lineage = client.get(f"/v1/projects/{project}/results/{result}/export")
    assert lineage.status_code == 200
    assert lineage.json()["schema"] == "chemdft.result-lineage-export.v1"
    assert (
        lineage.headers["content-disposition"]
        == f'attachment; filename="result-{result}-historical-lineage.json"'
    )
    assert lineage.headers["cache-control"] == "no-store"


# --- historical standing inside CUBE files (RW-2 repair)


def _cube_text(api, change=None):
    client, sessions, settings, project, version, calculation, result = _fixture(api, "mo")
    artifact, field = seed_field_artifact(sessions, settings, project, result, calculation, version)
    if change:
        change(sessions, result)
    response = _export(client, project, calculation, "cube", artifact)
    assert response.status_code == 200, response.text
    return response, field


def _marker(text: str) -> dict[str, str]:
    """Standing as an independent reader of the downloaded file sees it: comment lines only."""
    keys = {"EVIDENCE_USE", "AUTHORITY", "LINEAGE", "VERIFICATION"}
    pairs = (item.split("=", 1) for item in " ".join(text.splitlines()[:2]).split() if "=" in item)
    return {k: v for k, v in pairs if k in keys}


def test_active_cube_declares_current_evidence_in_header_and_file(api):
    response, _field = _cube_text(api)
    assert response.headers["x-chemdft-evidence-use"] == "CURRENT"
    assert response.headers["cache-control"] == "no-store"
    standing = _marker(response.text)
    assert standing == {
        "EVIDENCE_USE": "CURRENT",
        "AUTHORITY": "AUTHORITATIVE",
        "LINEAGE": "ACTIVE",
        "VERIFICATION": "UNVERIFIED",
    }
    assert "HISTORICAL_ONLY" not in response.text.splitlines()[0] + response.text.splitlines()[1]


@pytest.mark.parametrize(
    ("change", "lineage"),
    [(supersede, "SUPERSEDED"), (retract, "RETRACTED"), (dispute, "DISPUTED")],
)
def test_inactive_cube_is_marked_historical_in_the_file_itself(api, change, lineage):
    response, _field = _cube_text(api, change)
    assert response.headers["x-chemdft-evidence-use"] == "HISTORICAL_ONLY"
    standing = _marker(response.text)
    assert standing["EVIDENCE_USE"] == "HISTORICAL_ONLY"
    assert standing["LINEAGE"] == lineage
    assert standing["AUTHORITY"] == "CANDIDATE"  # never the stored AUTHORITATIVE
    assert (
        standing["VERIFICATION"] == "UNVERIFIED"
    )  # a lost lineage is not evidence about verification
    # Standing survives a download: re-read the saved text with no API, no headers.
    saved = response.content.decode()
    assert "EVIDENCE_USE=HISTORICAL_ONLY" in saved.splitlines()[0]


@pytest.mark.parametrize("change", [None, supersede, retract, dispute])
def test_standing_does_not_alter_grid_geometry_units_or_values(api, change):
    response, field = _cube_text(api, change)
    comments, natoms, origin, dims, vectors, atoms, values = parse_cube(response.text)
    # the cube format is unchanged: exactly two comment lines, then the natoms/origin record
    assert len(comments) == 2 and natoms == 3 and dims == [5, 4, 6]
    assert np.allclose(origin, np.array([-1.5, -1.25, -1.0]) / BOHR_IN_ANGSTROM, atol=1e-7)
    assert np.allclose(vectors, np.eye(3) * 0.12 / BOHR_IN_ANGSTROM, atol=1e-7)
    assert [int(a[0]) for a in atoms] == [8, 1, 1]
    assert np.array_equal(values.astype("<f4"), field.reshape(-1))
    assert "ELECTRON_DENSITY" in comments[0] and "e/bohr^3" in comments[0]
    assert len(comments[0]) < 400 and len(comments[1]) < 400


def test_missing_effective_state_fails_closed_in_the_cube_comment():
    from chemdft_api.scientific_export import evidence_standing_marker

    assert evidence_standing_marker(None) == (
        "EVIDENCE_USE=UNKNOWN AUTHORITY=UNKNOWN LINEAGE=UNKNOWN VERIFICATION=UNKNOWN"
    )


def test_export_without_effective_state_never_claims_current(api, monkeypatch):
    from chemdft_api import scientific_export

    client, sessions, settings, project, version, calculation, result = _fixture(api, "mo")
    artifact, _field = seed_field_artifact(
        sessions, settings, project, result, calculation, version
    )
    real = scientific_export.get_calculation

    def without_state(*args, **kwargs):
        detail = real(*args, **kwargs)
        stripped = detail.result.model_copy(update={"effective_state": None})
        return detail.model_copy(update={"result": stripped})

    monkeypatch.setattr(scientific_export, "get_calculation", without_state)
    response = _export(client, project, calculation, "cube", artifact)
    assert response.status_code == 200
    assert response.headers["x-chemdft-evidence-use"] == "UNKNOWN"
    standing = _marker(response.text)
    assert standing["EVIDENCE_USE"] == "UNKNOWN" and standing["VERIFICATION"] == "UNKNOWN"
    assert "CURRENT" not in response.text.splitlines()[0]


def test_standing_tokens_cannot_carry_free_text():
    from chemdft_api.scientific_export import _token

    assert _token("HISTORICAL_ONLY") == "HISTORICAL_ONLY"
    for hostile in ("verified by me", "A\nB", "lower", "X" * 40, ""):
        assert _token(hostile) == "UNKNOWN"


def test_cube_of_another_project_stays_unreachable(api):
    client, sessions, settings, project, version, calculation, result = _fixture(api, "mo")
    artifact, _ = seed_field_artifact(sessions, settings, project, result, calculation, version)
    other = create_project(client, "other owner")
    response = client.get(
        f"/v1/projects/{other}/calculations/{calculation}/export",
        params={"format": "cube", "variant": artifact},
    )
    assert response.status_code == 404 and "x-chemdft-evidence-use" not in response.headers
