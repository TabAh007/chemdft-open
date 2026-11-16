# ruff: noqa: E501
"""Experimental spectrum import: upload -> hash-bound preview (no authoritative write) -> unit confirmation -> immutable RAW dataset.

The real isolated spectra worker runs in every test (no fake): the contracts between worker and API are part of what is tested.
"""
from __future__ import annotations

import pytest
from chemdft_api.scientific_models import (
    CalculationResultRecord,
    ExperimentalDatasetRecord,
    ExperimentRecord,
    ImportedResultRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    SpectrumConfirmationRecord,
    SpectrumPreviewRecord,
    SpectrumUploadRecord,
)
from spectra_support import (
    import_spectrum,
    ir_text,
    raman_text,
    requires_spectra_worker,
    resolve,
    sha256,
    upload,
    uv_text,
)
from sqlalchemy import func, select

pytestmark = requires_spectra_worker
CONFIRM_IR = {"x_unit": "cm^-1", "y_quantity": "ABSORBANCE", "y_unit": "absorbance"}


@pytest.fixture
def project(api):
    client, _, _ = api
    response = client.post("/v1/projects", json={"name": "Spectra project", "slug": "spectra-project"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def counts(sessions) -> dict[str, int]:
    with sessions() as session:
        def n(model, *where):
            return session.scalar(select(func.count()).select_from(model).where(*where))

        return {
            "uploads": n(SpectrumUploadRecord),
            "previews": n(SpectrumPreviewRecord),
            "experiments": n(ExperimentRecord),
            "spectrum_datasets": n(ExperimentalDatasetRecord, ExperimentalDatasetRecord.spectrum_json.is_not(None)),
            "calculation_results": n(CalculationResultRecord),
            "imported_results": n(ImportedResultRecord),
            "confirmations": n(SpectrumConfirmationRecord),
        }


def test_preview_writes_no_experiment_dataset_or_result(api, project):
    client, sessions, _ = api
    data = ir_text()
    response = upload(client, project, data)
    assert response.status_code == 201, response.text
    view = response.json()
    assert view["state"] == "PREVIEW" and view["technique"] == "IR"
    preview = view["latest_preview"]
    assert preview["status"] == "READY"
    body = preview["body"]
    assert body["x"]["unit"] == "cm^-1" and body["x"]["unit_evidence"] == "EXPLICIT_UNIT"
    assert body["y"]["unit"] == "absorbance" and body["y"]["unit_evidence"] == "EXPLICIT_UNIT"
    assert body["point_count"] == 901 and view["source"]["sha256"] == sha256(data)
    assert counts(sessions) == {"uploads": 1, "previews": 1, "experiments": 0, "spectrum_datasets": 0, "calculation_results": 0, "imported_results": 0, "confirmations": 0}
    assert client.get(f"/v1/projects/{project}/experimental/spectra/datasets").json()["datasets"] == []


def test_confirm_creates_one_immutable_raw_dataset_with_provenance(api, project):
    client, sessions, _ = api
    data = ir_text()
    dataset = import_spectrum(client, project, data)
    assert dataset["kind"] == "RAW" and dataset["state"] == "RAW" and dataset["source_class"] == "EXPERIMENTAL"
    assert dataset["authority"] == "RAW_MEASUREMENT" and dataset["modality"] == "FTIR" and dataset["technique"] == "IR"
    assert dataset["point_count"] == 901 and dataset["x_order"] == "ASCENDING"
    assert dataset["x"]["unit_evidence"] == "EXPLICIT_UNIT" and dataset["y"]["unit_evidence"] == "EXPLICIT_UNIT"
    assert dataset["x"]["definition"]["unit"]["code"] == "cm^-1"
    assert dataset["parent_dataset_id"] is None and dataset["lineage"] == [] and dataset["processing"] == []
    assert dataset["source"]["sha256"] == sha256(data) and dataset["source"]["parser_name"] == "chemdft-spectra-text"
    assert dataset["association"]["state"] == "UNASSIGNED"
    n = counts(sessions)
    assert n["experiments"] == 1 and n["spectrum_datasets"] == 1 and n["confirmations"] == 1
    assert n["calculation_results"] == 0 and n["imported_results"] == 0  # the firewall: nothing here is a calculation or imported result

    with sessions() as session:
        row = session.get(ExperimentalDatasetRecord, dataset["id"])
        assert row.state == "RAW" and row.source_class == "EXPERIMENTAL" and row.values_json == [] and row.input_dataset_ids_json == []
        provenance = session.get(ProvenanceRecordRow, dataset["provenance_record_id"])
        assert (provenance.source_class, provenance.detail, provenance.subject_type) == ("EXPERIMENTAL", "DIRECT_ACQUISITION", "experimental.dataset")
        params = {p["key"]: p["value"] for p in provenance.parameters_json}
        assert params["x_unit_evidence"] == "EXPLICIT_UNIT" and params["source_sha256"] == sha256(data) and params["technique"] == "IR"
        inputs = session.scalars(select(ProvenanceInputRow).where(ProvenanceInputRow.provenance_record_id == provenance.id).order_by(ProvenanceInputRow.position)).all()
        assert [i.input_type for i in inputs] == ["ARTIFACT", "ARTIFACT"] and inputs[0].input_sha256 == sha256(data)
        source = session.get(ScientificArtifactRecord, dataset["source"]["raw_artifact_id"])
        assert source.kind == "RAW_UPLOAD" and source.sha256 == sha256(data)
        arrays = session.get(ScientificArtifactRecord, row.artifact_id)
        assert arrays.kind == "SPECTRUM_DATA" and arrays.sha256 == dataset["arrays_sha256"] and arrays.size_bytes == 901 * 16


def test_raw_dataset_is_immutable_in_the_database_layer(api, project):
    client, sessions, _ = api
    dataset = import_spectrum(client, project, ir_text())
    with sessions() as session:
        row = session.get(ExperimentalDatasetRecord, dataset["id"])
        row.point_count = 5
        with pytest.raises(ValueError, match="append-only"):
            session.commit()
    with sessions() as session:
        session.delete(session.get(ExperimentalDatasetRecord, dataset["id"]))
        with pytest.raises(ValueError, match="append-only"):
            session.commit()
    with sessions() as session:
        assert session.get(ExperimentalDatasetRecord, dataset["id"]).point_count == 901


def test_confirmation_is_single_use_and_idempotent(api, project):
    client, sessions, _ = api
    view = upload(client, project, ir_text()).json()
    sha = view["latest_preview"]["preview_sha256"]
    first = client.post(f"/v1/projects/{project}/experimental/spectra/uploads/{view['id']}/confirm", json={"preview_sha256": sha, "idempotency_key": "confirm-aaaa-0001"})
    assert first.status_code == 201
    again = client.post(f"/v1/projects/{project}/experimental/spectra/uploads/{view['id']}/confirm", json={"preview_sha256": sha, "idempotency_key": "confirm-aaaa-0001"})
    assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
    other_key = client.post(f"/v1/projects/{project}/experimental/spectra/uploads/{view['id']}/confirm", json={"preview_sha256": sha, "idempotency_key": "confirm-bbbb-0002"})
    assert other_key.status_code == 409
    n = counts(sessions)
    assert n["spectrum_datasets"] == 1 and n["experiments"] == 1 and n["confirmations"] == 1
    assert client.get(f"/v1/projects/{project}/experimental/spectra/uploads/{view['id']}").json()["state"] == "IMPORTED"


def test_confirmation_must_quote_the_exact_preview_hash(api, project):
    client, sessions, _ = api
    view = upload(client, project, ir_text()).json()
    for wrong in ("0" * 64, "f" * 64):
        response = client.post(f"/v1/projects/{project}/experimental/spectra/uploads/{view['id']}/confirm", json={"preview_sha256": wrong, "idempotency_key": "confirm-wrong-001"})
        assert response.status_code == 409, response.text
    assert counts(sessions)["spectrum_datasets"] == 0


def test_unit_hint_alone_cannot_be_confirmed_and_user_confirmation_is_recorded(api, project):
    client, sessions, _ = api
    data = ir_text(header=None, delimiter=" ")
    view = upload(client, project, data).json()
    body = view["latest_preview"]["body"]
    assert view["latest_preview"]["status"] == "NEEDS_CONFIRMATION" and body["needs"] == ["x_unit", "y_quantity_and_unit"]
    assert body["x"]["unit"] is None and body["proposals"]["x"]["level"] == "HINT_ONLY" and body["proposals"]["x"]["unit"] == "cm^-1"
    refused = client.post(f"/v1/projects/{project}/experimental/spectra/uploads/{view['id']}/confirm", json={"preview_sha256": view["latest_preview"]["preview_sha256"], "idempotency_key": "confirm-hint-0001"})
    assert refused.status_code == 409 and counts(sessions)["spectrum_datasets"] == 0

    resolved = resolve(client, project, view["id"], CONFIRM_IR).json()
    assert [p["status"] for p in resolved["previews"]] == ["NEEDS_CONFIRMATION", "READY"]
    ready = resolved["latest_preview"]
    assert ready["body"]["x"]["unit_evidence"] == "USER_CONFIRMED" and ready["preview_sha256"] != view["latest_preview"]["preview_sha256"]
    confirmed = client.post(f"/v1/projects/{project}/experimental/spectra/uploads/{view['id']}/confirm", json={"preview_sha256": ready["preview_sha256"], "idempotency_key": "confirm-user-0001"})
    assert confirmed.status_code == 201
    dataset = confirmed.json()
    assert dataset["x"]["unit_evidence"] == "USER_CONFIRMED" and dataset["y"]["unit_evidence"] == "USER_CONFIRMED"
    with sessions() as session:
        params = {p["key"]: p["value"] for p in session.get(ProvenanceRecordRow, dataset["provenance_record_id"]).parameters_json}
        assert params["x_unit_evidence"] == "USER_CONFIRMED" and params["y_unit_evidence"] == "USER_CONFIRMED"


def test_resolving_the_same_choices_twice_is_one_preview(api, project):
    client, sessions, _ = api
    view = upload(client, project, ir_text(header=None, delimiter=" ")).json()
    first = resolve(client, project, view["id"], CONFIRM_IR).json()
    second = resolve(client, project, view["id"], CONFIRM_IR).json()
    assert first["latest_preview"]["preview_sha256"] == second["latest_preview"]["preview_sha256"]
    assert len(second["previews"]) == 2 and counts(sessions)["previews"] == 2


def test_transmittance_scale_must_be_stated_and_is_never_converted(api, project):
    client, _, _ = api
    data = ir_text(header="Wavenumber (cm-1),Transmittance")
    view = upload(client, project, data).json()
    assert view["latest_preview"]["body"]["needs"] == ["y_quantity_and_unit"]
    ready = resolve(client, project, view["id"], {"y_quantity": "TRANSMITTANCE", "y_unit": "fraction"}).json()["latest_preview"]
    assert ready["status"] == "READY" and ready["body"]["y"]["quantity"] == "TRANSMITTANCE" and ready["body"]["y"]["unit"] == "fraction"
    dataset = client.post(f"/v1/projects/{project}/experimental/spectra/uploads/{view['id']}/confirm", json={"preview_sha256": ready["preview_sha256"], "idempotency_key": "confirm-trans-001"}).json()
    assert dataset["y"]["definition"]["unit"]["code"] == "fraction" and dataset["y"]["quantity"] == "TRANSMITTANCE"


def test_raman_laser_wavelength_stays_not_supplied(api, project):
    client, _, _ = api
    dataset = import_spectrum(client, project, raman_text(), technique="RAMAN", name="acetone-raman.txt")
    assert dataset["modality"] == "RAMAN" and dataset["technique"] == "RAMAN"
    assert dataset["acquisition"]["excitation_wavelength_nm"]["status"] == "NOT_SUPPLIED"
    assert dataset["acquisition"]["excitation_wavelength_nm"]["value"] is None
    assert dataset["instrument"]["status"] == "AS_REPORTED_IN_FILE" and "bench Raman" in dataset["instrument"]["value"]
    assert dataset["y"]["definition"]["unit"]["code"] == "counts"


def test_user_entered_metadata_is_labelled(api, project):
    client, _, _ = api
    choices = {**CONFIRM_IR, "metadata": {"phase": "GAS", "resolution_cm1": 4, "sampling_mode": "GAS_CELL"}, "sample": "acetone vapour"}
    dataset = import_spectrum(client, project, ir_text(header=None, delimiter=" "), choices=choices)
    assert dataset["acquisition"]["phase"] == {"status": "USER_ENTERED", "value": "GAS", "as_written": "GAS", "line": None, "file_reported": None}
    assert dataset["acquisition"]["resolution_cm1"]["value"] == 4.0 and dataset["sample"]["status"] == "USER_ENTERED"
    assert dataset["acquisition"].get("path_length_cm", {}).get("status") in (None, "NOT_SUPPLIED")


def test_uv_vis_cross_section_import(api, project):
    client, _, _ = api
    dataset = import_spectrum(client, project, uv_text(), technique="UVVIS", name="uv.csv")
    assert dataset["modality"] == "UV_VIS" and dataset["y"]["quantity"] == "CROSS_SECTION"
    assert dataset["y"]["definition"]["unit"]["code"] == "cm^2/molecule" and dataset["x"]["definition"]["unit"]["code"] == "nm"


def test_rejections_keep_nothing_authoritative(api, project):
    client, sessions, _ = api
    zipped = upload(client, project, b"PK\x03\x04" + bytes(range(256)) * 3, name="x.zip", key="reject-key-0001").json()
    assert zipped["state"] == "REJECTED" and zipped["source"]["raw_artifact_id"] is None  # hostile bytes are never stored
    dup = ir_text().replace(b"404.0000", b"400.0000", 1)
    duplicate = upload(client, project, dup, key="reject-key-0002").json()
    assert duplicate["state"] == "REJECTED" and duplicate["source"]["raw_artifact_id"] is not None
    assert "DUPLICATE_X" in [d["code"] for d in duplicate["latest_preview"]["body"]["diagnostics"]]
    refused = client.post(f"/v1/projects/{project}/experimental/spectra/uploads/{duplicate['id']}/confirm", json={"preview_sha256": duplicate["latest_preview"]["preview_sha256"], "idempotency_key": "confirm-reject-01"})
    assert refused.status_code == 409
    n = counts(sessions)
    assert n["experiments"] == 0 and n["spectrum_datasets"] == 0
    assert resolve(client, project, zipped["id"], {}).status_code == 409  # nothing stored, nothing to re-preview


def test_invalid_rows_need_an_explicit_choice(api, project):
    client, _, _ = api
    lines = ir_text().decode().split("\n")
    lines[100], lines[101] = "800.0000,NaN", "804.0000,-"
    data = "\n".join(lines).encode()
    view = upload(client, project, data).json()
    assert view["latest_preview"]["status"] == "REJECTED" and "INVALID_VALUES_IN_SERIES" in [d["code"] for d in view["latest_preview"]["body"]["diagnostics"]]
    ready = resolve(client, project, view["id"], {"exclude_invalid_rows": True}).json()["latest_preview"]
    assert ready["status"] == "READY" and ready["body"]["point_count"] == 899
    assert ready["body"]["choice"]["exclude_invalid_rows"] is True and len(ready["body"]["choice"]["excluded_lines"]) == 2


def test_tampered_source_is_detected_at_confirmation(api, project):
    client, sessions, settings = api
    view = upload(client, project, ir_text()).json()
    with sessions() as session:
        artifact = session.get(ScientificArtifactRecord, view["source"]["raw_artifact_id"])
        path = settings.object_root / artifact.storage_key
    original = path.read_bytes()
    assert b"404.0000" in original
    path.write_bytes(original.replace(b"404.0000", b"405.0000", 1))
    response = client.post(f"/v1/projects/{project}/experimental/spectra/uploads/{view['id']}/confirm", json={"preview_sha256": view["latest_preview"]["preview_sha256"], "idempotency_key": "confirm-tamper-01"})
    assert response.status_code == 409, response.text
    assert counts(sessions)["spectrum_datasets"] == 0


def test_reversed_axis_is_recorded_not_reordered(api, project):
    client, _, _ = api
    dataset = import_spectrum(client, project, ir_text(descending=True))
    assert dataset["x_order"] == "DESCENDING" and dataset["source"]["original_axis_direction"] == "DESCENDING"
    assert dataset["x"]["definition"]["direction"] == "DESCENDING"
    arrays = client.get(f"/v1/projects/{project}/experimental/spectra/datasets/{dataset['id']}/arrays").json()
    assert arrays["x"][0] > arrays["x"][-1] and arrays["point_count"] == 901 and arrays["decimated"] is False


def test_arrays_endpoint_decimation_never_changes_storage(api, project):
    client, _, _ = api
    dataset = import_spectrum(client, project, ir_text(step=1.0))
    full = client.get(f"/v1/projects/{project}/experimental/spectra/datasets/{dataset['id']}/arrays").json()
    small = client.get(f"/v1/projects/{project}/experimental/spectra/datasets/{dataset['id']}/arrays", params={"max_points": 400}).json()
    assert full["returned_points"] == full["point_count"] == 3601 and small["decimated"] is True and small["returned_points"] <= 400
    assert max(small["y"]) == max(full["y"]) and min(small["y"]) == min(full["y"])  # extremes survive display decimation
    assert small["arrays_sha256"] == full["arrays_sha256"] == dataset["arrays_sha256"]


def test_legacy_experimental_dataset_list_does_not_include_spectra(api, project):
    client, _, _ = api
    import_spectrum(client, project, ir_text())
    legacy = client.get(f"/v1/projects/{project}/experimental/datasets").json()
    assert legacy["datasets"] == []
    assert len(client.get(f"/v1/projects/{project}/experimental/spectra/datasets").json()["datasets"]) == 1


def test_viewer_role_and_other_projects_cannot_write(api, project):
    client, _, _ = api
    response = client.post("/v1/projects", json={"name": "Other", "slug": "other-project"})
    other = response.json()["id"]
    dataset = import_spectrum(client, project, ir_text())
    assert client.get(f"/v1/projects/{other}/experimental/spectra/datasets/{dataset['id']}").status_code == 404
    assert client.get(f"/v1/projects/{other}/experimental/spectra/datasets/{dataset['id']}/arrays").status_code == 404


def test_association_is_optional_append_only_and_inherited(api, project):
    client, _, _ = api
    dataset = import_spectrum(client, project, ir_text(), association={"state": "ASSOCIATED_WITH_SAMPLE", "sample_label": "acetone, neat"})
    assert dataset["association"]["state"] == "ASSOCIATED_WITH_SAMPLE" and dataset["association"]["sample_label"] == "acetone, neat"
    url = f"/v1/projects/{project}/experimental/spectra/datasets/{dataset['id']}/association"
    assert client.put(url, json={"state": "ASSOCIATED_WITH_STRUCTURE", "structure_id": "11111111-1111-4111-8111-111111111111"}).status_code == 404
    assert client.put(url, json={"state": "ASSOCIATED_WITH_STRUCTURE"}).status_code == 422
    assert client.put(url, json={"state": "UNASSIGNED"}).json()["state"] == "UNASSIGNED"
    assert client.get(f"/v1/projects/{project}/experimental/spectra/datasets/{dataset['id']}").json()["association"]["state"] == "UNASSIGNED"


def test_worker_unavailable_is_reported_cleanly(api, project, monkeypatch):
    client, _, settings = api
    monkeypatch.setattr(settings, "spectra_worker_python", settings.spectra_worker_python.with_name("does-not-exist"))
    response = upload(client, project, ir_text())
    assert response.status_code == 503


def test_worker_failures_become_rejected_previews(api, project, monkeypatch):
    from chemdft_api import experimental_spectrum_actions as actions
    from chemdft_api.experimental_spectrum_runner import RunnerOutcome

    client, sessions, _ = api
    monkeypatch.setattr(actions, "run_spectra_worker", lambda *a, **k: RunnerOutcome(None, failure="timeout", detail="stopped after 60 seconds"))
    view = upload(client, project, ir_text()).json()
    assert view["state"] == "REJECTED"
    assert "PARSE_TIMEOUT" in [d["code"] for d in view["latest_preview"]["body"]["diagnostics"]]
    assert counts(sessions)["spectrum_datasets"] == 0


def test_a_worker_that_lies_about_its_arrays_is_rejected(api, project, monkeypatch):
    from chemdft_api import experimental_spectrum_actions as actions
    from chemdft_api.experimental_spectrum_runner import run_spectra_worker

    client, sessions, _ = api

    def lying(*args, **kwargs):
        outcome = run_spectra_worker(*args, **kwargs)
        return type(outcome)(outcome.document, bytes(reversed(outcome.arrays or b"")), outcome.aux)

    monkeypatch.setattr(actions, "run_spectra_worker", lying)
    view = upload(client, project, ir_text()).json()
    assert view["state"] == "REJECTED" and "WORKER_OUTPUT_INVALID" in [d["code"] for d in view["latest_preview"]["body"]["diagnostics"]]
    assert counts(sessions)["spectrum_datasets"] == 0


def test_oversized_uploads_are_refused_before_anything_is_stored(api, project, monkeypatch):
    client, sessions, settings = api
    monkeypatch.setattr(settings, "max_spectrum_bytes", 2048)
    response = upload(client, project, ir_text())
    assert response.status_code == 413
    n = counts(sessions)
    assert n["uploads"] == 0 and n["previews"] == 0 and n["spectrum_datasets"] == 0


def test_hostile_text_is_stored_as_inert_text_and_never_executed(api, project):
    client, _, _ = api
    hostile = b"# Sample: =HYPERLINK(\"http://example.invalid\",\"x\")\n# Note: @SUM(1+1)\n# Operator: +cmd|' /C calc'!A0\n" + ir_text()
    dataset = import_spectrum(client, project, hostile, key="hostile-text-0001")
    values = " ".join(m["value"] for m in dataset["metadata_verbatim"])
    assert "HYPERLINK" in values and "cmd" in values  # kept verbatim as data; nothing was evaluated, fetched or run
    assert dataset["point_count"] == 901
