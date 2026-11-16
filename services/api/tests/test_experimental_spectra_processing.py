# ruff: noqa: E501
"""Append-only processing: every transform creates a NEW dataset with a full record; raw data and parents never change."""
from __future__ import annotations

from uuid import UUID

import pytest
from chemdft_api.contracts.experimental_spectra import SpectrumDatasetKind
from chemdft_api.errors import CrossProjectReference, TrustedProducerRequired
from chemdft_api.experimental_spectrum_actions import accept_spectrum_dataset
from chemdft_api.scientific_models import (
    ExperimentalDatasetRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    SpectrumOperationRecord,
)
from chemdft_api.trusted_producers import ProducerType, issue_trusted_producer_context
from spectra_support import (
    import_spectrum,
    ir_text,
    peaks,
    requires_spectra_worker,
    transform,
    upload,
)
from sqlalchemy import func, select

pytestmark = requires_spectra_worker
BASE = "/v1/projects/{project}/experimental/spectra"


@pytest.fixture
def project(api):
    client, _, _ = api
    response = client.post("/v1/projects", json={"name": "Spectra processing", "slug": "spectra-processing"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def raw(api, project):
    client, _, _ = api
    return import_spectrum(client, project, ir_text(noise=0.002))


def get(client, project, dataset_id):
    return client.get(f"/v1/projects/{project}/experimental/spectra/datasets/{dataset_id}").json()


def arrays(client, project, dataset_id):
    return client.get(f"/v1/projects/{project}/experimental/spectra/datasets/{dataset_id}/arrays").json()


def spectrum_rows(sessions) -> int:
    with sessions() as session:
        return session.scalar(select(func.count()).select_from(ExperimentalDatasetRecord).where(ExperimentalDatasetRecord.spectrum_json.is_not(None)))


def test_baseline_creates_a_new_dataset_and_leaves_raw_untouched(api, project, raw):
    client, sessions, _ = api
    raw_before = arrays(client, project, raw["id"])
    response = transform(client, project, raw["id"], "baseline.arpls", {"stiffness_length_x": 400})
    assert response.status_code == 201, response.text
    derived = response.json()
    assert derived["kind"] == "TRANSFORM" and derived["state"] == "DERIVED" and derived["source_class"] == "EXPERIMENTAL"
    assert derived["authority"] == "DETERMINISTIC_TRANSFORM" and derived["parent_dataset_id"] == raw["id"] and derived["lineage"] == [raw["id"]]
    assert derived["id"] != raw["id"] and derived["experiment_id"] == raw["experiment_id"]
    record = derived["transform"]
    assert record["op"] == "baseline.arpls" and record["library"] == "pybaselines" and record["library_version"] == "1.2.1"
    assert {p["key"]: p["value"] for p in record["parameters"]}["stiffness_length_x"] == 400.0
    resolved = {p["key"]: p["value"] for p in record["resolved"]}
    assert resolved["lam"] == pytest.approx((400 / 4.0) ** 4) and resolved["converged"] is True
    assert record["input"]["artifact_sha256"] == raw["arrays_sha256"] and record["output"]["artifact_sha256"] == derived["arrays_sha256"]
    assert record["authority"] == "DETERMINISTIC_TRANSFORM" and record["environment"] and record["aux"][0]["name"] == "baseline"
    assert derived["baseline_curve"] is not None and len(derived["processing"]) == 1 and derived["processing"][0]["op"] == "baseline.arpls"
    # raw: same arrays, same hash, now listed as having a child
    assert arrays(client, project, raw["id"]) == raw_before
    refreshed = get(client, project, raw["id"])
    assert refreshed["arrays_sha256"] == raw["arrays_sha256"] and refreshed["children"] == [derived["id"]] and refreshed["processing"] == []
    # raw / baseline / corrected are three separate curves
    curves = arrays(client, project, derived["id"])
    assert len(curves["baseline"]) == len(curves["y"]) == 901 and curves["baseline_x"] == curves["x"]
    corrected_peak = max(curves["y"])
    assert corrected_peak < max(raw_before["y"]) and corrected_peak == pytest.approx(0.9, abs=0.1)
    with sessions() as session:
        provenance = session.get(ProvenanceRecordRow, derived["provenance_record_id"])
        assert (provenance.source_class, provenance.detail) == ("EXPERIMENTAL", "DETERMINISTIC_TRANSFORM")
        assert provenance.operation == "chemdft.experimental-spectrum.baseline.arpls"
        inputs = session.scalars(select(ProvenanceInputRow).where(ProvenanceInputRow.provenance_record_id == provenance.id)).all()
        assert [(i.input_type, i.input_id) for i in inputs] == [("ENTITY", raw["id"])]
        params = {p["key"]: p["value"] for p in provenance.parameters_json}
        assert params["library_version"] == "1.2.1" and params["record_sha256"] == record["record_sha256"] and params["param.stiffness_length_x"] == "400.0"
        assert session.get(ExperimentalDatasetRecord, derived["id"]).input_dataset_ids_json == [raw["id"]]
        assert session.get(ProvenanceRecordRow, raw["provenance_record_id"]).detail == "DIRECT_ACQUISITION"


def test_a_chain_of_transforms_keeps_a_hash_linked_history(api, project, raw):
    client, _, _ = api
    first = transform(client, project, raw["id"], "baseline.snip", {"half_window_x": 80}).json()
    second = transform(client, project, first["id"], "smooth.savgol", {"window_x": 12, "polyorder": 2}).json()
    third = transform(client, project, second["id"], "normalize.max", {"target": 1}).json()
    assert third["lineage"] == [raw["id"], first["id"], second["id"]] and [s["op"] for s in third["processing"]] == ["baseline.snip", "smooth.savgol", "normalize.max"]
    assert second["transform"]["input"]["artifact_sha256"] == first["arrays_sha256"]
    assert third["transform"]["input"]["artifact_sha256"] == second["arrays_sha256"]
    assert [s["output_artifact_sha256"] for s in third["processing"]] == [first["arrays_sha256"], second["arrays_sha256"], third["arrays_sha256"]]
    assert get(client, project, first["id"])["children"] == [second["id"]] and third["state"] == "NORMALIZED" and third["representation"] == "RELATIVE"
    assert third["y"]["definition"]["unit"]["code"] == "relative" and "Normalized" in third["y"]["definition"]["label"]
    assert max(arrays(client, project, third["id"])["y"]) == pytest.approx(1.0)
    assert get(client, project, raw["id"])["representation"] == "ABSOLUTE"  # normalised data never replaces or relabels the raw measurement


def test_transforms_are_deterministic_and_idempotent(api, project, raw):
    client, sessions, _ = api
    a = transform(client, project, raw["id"], "smooth.savgol", {"window_x": 20}, key="smooth-key-aaaa").json()
    again = transform(client, project, raw["id"], "smooth.savgol", {"window_x": 20}, key="smooth-key-aaaa")
    assert again.status_code == 201 and again.json()["id"] == a["id"]
    assert spectrum_rows(sessions) == 2
    b = transform(client, project, raw["id"], "smooth.savgol", {"window_x": 20}, key="smooth-key-bbbb").json()
    assert b["id"] != a["id"] and b["arrays_sha256"] == a["arrays_sha256"] and b["transform"]["record_sha256"] == a["transform"]["record_sha256"]
    conflict = transform(client, project, raw["id"], "smooth.savgol", {"window_x": 28}, key="smooth-key-aaaa")
    assert conflict.status_code == 409
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(SpectrumOperationRecord)) == 2


@pytest.mark.parametrize(
    ("op", "parameters", "code"),
    [
        ("baseline.arpls", {}, "PARAMETER_MISSING"),
        ("baseline.arpls", {"stiffness_length_x": 4.0}, "PARAMETER_INVALID"),
        ("baseline.snip", {"half_window_x": 1e7}, "PARAMETER_INVALID"),
        ("smooth.savgol", {"window_points": 10}, "PARAMETER_INVALID"),
        ("smooth.savgol", {"window_points": 3, "polyorder": 3}, "PARAMETER_INVALID"),
        ("smooth.savgol", {"window_x": 20, "window_points": 5}, "PARAMETER_INVALID"),
        ("normalize.max", {"target": 7}, "PARAMETER_INVALID"),
        ("crop", {"x_min": 1000, "x_max": 1010}, "TOO_FEW_POINTS_AFTER_TRANSFORM"),
        ("convert.absorbance_from_transmittance", {}, "PARAMETER_INVALID"),
    ],
)
def test_invalid_requests_create_nothing(api, project, raw, op, parameters, code):
    client, sessions, _ = api
    response = transform(client, project, raw["id"], op, parameters)
    assert response.status_code == 422, response.text
    assert code in response.json()["detail"]
    assert spectrum_rows(sessions) == 1


def test_unknown_operation_and_unknown_parameter_are_rejected_by_the_contract(api, project, raw):
    client, _, _ = api
    body = {"op": "baseline.magic", "parameters": {}, "idempotency_key": "contract-key-0001"}
    assert client.post(f"/v1/projects/{project}/experimental/spectra/datasets/{raw['id']}/transforms", json=body).status_code == 422
    body = {"op": "baseline.arpls", "parameters": {"lam": 1e8}, "idempotency_key": "contract-key-0002"}
    assert client.post(f"/v1/projects/{project}/experimental/spectra/datasets/{raw['id']}/transforms", json=body).status_code == 422  # raw lam is not an accepted input


def test_smoothing_warns_when_the_window_is_large_relative_to_peak_widths(api, project):
    client, _, _ = api
    raw = import_spectrum(client, project, ir_text(step=1.0, noise=0.001), key="fine-0001")
    gentle = transform(client, project, raw["id"], "smooth.savgol", {"window_x": 6}).json()
    heavy = transform(client, project, raw["id"], "smooth.savgol", {"window_x": 60}).json()
    assert "WINDOW_LARGE_VS_PEAK_WIDTH" not in [w["code"] for w in gentle["transform"]["warnings"]]
    warning = next(w for w in heavy["transform"]["warnings"] if w["code"] == "WINDOW_LARGE_VS_PEAK_WIDTH")
    assert "height loss" in warning["message"]
    assert {p["key"] for p in heavy["transform"]["resolved"]} >= {"advisory.simulated_height_loss", "advisory.narrowest_peak_fwhm_x"}
    assert {p["key"]: p["value"] for p in heavy["transform"]["parameters"]}["mode"] == "interp"


def test_transmittance_to_absorbance_is_explicit_and_guarded(api, project):
    client, _, _ = api
    lines = ["Wavenumber (cm-1),%T"] + [f"{400 + 4 * i:.1f},{100 * 10 ** (-0.02 - 0.5 / (1 + ((400 + 4 * i - 1700) / 15) ** 2)):.5f}" for i in range(400)]
    raw = import_spectrum(client, project, ("\n".join(lines) + "\n").encode(), key="transmittance-01")
    assert raw["y"]["quantity"] == "TRANSMITTANCE" and raw["y"]["definition"]["unit"]["code"] == "percent"
    absorbance = transform(client, project, raw["id"], "convert.absorbance_from_transmittance").json()
    assert absorbance["y"]["quantity"] == "ABSORBANCE" and absorbance["y"]["definition"]["unit"]["code"] == "absorbance"
    assert "EXPLICIT_CONVERSION" in [w["code"] for w in absorbance["transform"]["warnings"]]
    assert get(client, project, raw["id"])["y"]["quantity"] == "TRANSMITTANCE"
    zero_lines = list(lines)
    zero_lines[200] = "1196.0,0.0"
    zero = import_spectrum(client, project, ("\n".join(zero_lines) + "\n").encode(), key="transmittance-02")
    refused = transform(client, project, zero["id"], "convert.absorbance_from_transmittance")
    assert refused.status_code == 422 and "TRANSMITTANCE_NOT_POSITIVE" in refused.json()["detail"]


def test_crop_and_resample_update_the_range(api, project, raw):
    client, _, _ = api
    cropped = transform(client, project, raw["id"], "crop", {"x_min": 1000, "x_max": 3000}).json()
    assert cropped["x_min"] == 1000.0 and cropped["x_max"] == 3000.0 and cropped["point_count"] == 501
    resampled = transform(client, project, raw["id"], "resample.linear", {"step": 8}).json()
    assert resampled["point_count"] == 451 and "NOT_REVERSIBLE" in [w["code"] for w in resampled["transform"]["warnings"]]


def test_descending_raw_yields_ascending_derived(api, project):
    client, _, _ = api
    raw = import_spectrum(client, project, ir_text(descending=True), key="descending-01")
    derived = transform(client, project, raw["id"], "baseline.snip", {"half_window_x": 80}).json()
    assert raw["x_order"] == "DESCENDING" and derived["x_order"] == "ASCENDING" and derived["transform"]["input_was_descending"] is True
    xs = arrays(client, project, derived["id"])["x"]
    assert xs == sorted(xs)


def test_peak_set_is_derived_not_raw_with_full_provenance(api, project, raw):
    client, sessions, _ = api
    corrected = transform(client, project, raw["id"], "baseline.snip", {"half_window_x": 80}).json()
    response = peaks(client, project, corrected["id"], {"prominence_sigma": 8})
    assert response.status_code == 201, response.text
    peak_set = response.json()
    assert peak_set["kind"] == "PEAKS" and peak_set["authority"] == "DERIVED_NOT_RAW" and peak_set["state"] == "DERIVED"
    assert peak_set["parent_dataset_id"] == corrected["id"] and peak_set["lineage"] == [raw["id"], corrected["id"]] and peak_set["arrays"] is None
    detail = peak_set["peak_set"]
    assert detail["library"] == "scipy" and detail["authority"] == "DERIVED_NOT_RAW" and detail["input"]["artifact_sha256"] == corrected["arrays_sha256"]
    params = {p["key"]: p["value"] for p in detail["parameters"]}
    assert params["prominence_sigma"] == 8.0 and params["polarity"] == "maxima" and params["prominence"] > 0
    found = sorted(round(p["x"]) for p in detail["peaks"])
    assert any(abs(x - 1716) <= 4 for x in found) and any(abs(x - 1220) <= 6 for x in found) and any(abs(x - 2960) <= 8 for x in found)
    assert detail["peak_count"] == len(detail["peaks"]) and all(p["fwhm_x"] > 0 for p in detail["peaks"])
    with sessions() as session:
        row = session.get(ExperimentalDatasetRecord, peak_set["id"])
        assert row.point_count == detail["peak_count"] and len(row.values_json) == detail["peak_count"] and all(isinstance(v, float) for p in row.values_json for v in p.values())
        provenance = session.get(ProvenanceRecordRow, peak_set["provenance_record_id"])
        assert provenance.detail == "DETERMINISTIC_TRANSFORM" and {p["key"]: p["value"] for p in provenance.parameters_json}["authority"] == "DERIVED_NOT_RAW"
    assert peaks(client, project, corrected["id"], {"prominence_sigma": 8}, key="peaks-other-key1").json()["peak_set"]["record_sha256"] == detail["record_sha256"]
    assert client.get(f"/v1/projects/{project}/experimental/spectra/datasets/{peak_set['id']}/arrays").status_code == 409
    assert transform(client, project, peak_set["id"], "smooth.savgol", {"window_x": 20}).status_code == 409
    assert peaks(client, project, peak_set["id"], {"prominence": 0.1}).status_code == 409


def test_peak_parameters_are_validated_by_the_worker(api, project, raw):
    client, sessions, _ = api
    assert peaks(client, project, raw["id"], {}).status_code == 422
    assert peaks(client, project, raw["id"], {"prominence": 0.1, "prominence_sigma": 5}).status_code == 422
    assert peaks(client, project, raw["id"], {"prominence": 0.1, "polarity": "sideways"}).status_code == 422
    assert spectrum_rows(sessions) == 1


def test_a_worker_returning_the_wrong_arrays_creates_nothing(api, project, raw, monkeypatch):
    from chemdft_api import experimental_spectrum_processing as processing
    from chemdft_api.experimental_spectrum_runner import RunnerOutcome, run_spectra_worker

    client, sessions, _ = api

    def lying(*args, **kwargs):
        outcome = run_spectra_worker(*args, **kwargs)
        return RunnerOutcome(outcome.document, (outcome.arrays or b"")[::-1], outcome.aux)

    monkeypatch.setattr(processing, "run_spectra_worker", lying)
    response = transform(client, project, raw["id"], "smooth.savgol", {"window_x": 20})
    assert response.status_code == 422 and "WORKER_OUTPUT_INVALID" in response.json()["detail"]
    assert spectrum_rows(sessions) == 1


def test_a_worker_that_processed_different_input_creates_nothing(api, project, raw, monkeypatch):
    from chemdft_api import experimental_spectrum_processing as processing
    from chemdft_api.experimental_spectrum_runner import RunnerOutcome, run_spectra_worker

    client, sessions, _ = api

    def other_input(command, request, settings, *, arrays_in=None, **kwargs):
        shifted = bytearray(arrays_in or b"")
        shifted[-1] ^= 0x01
        return run_spectra_worker(command, request, settings, arrays_in=bytes(shifted), **kwargs)

    monkeypatch.setattr(processing, "run_spectra_worker", other_input)
    response = transform(client, project, raw["id"], "smooth.savgol", {"window_x": 20})
    assert response.status_code == 422 and "different input" in response.json()["detail"]
    assert spectrum_rows(sessions) == 1
    del RunnerOutcome


def test_stored_arrays_that_no_longer_match_their_hash_block_processing(api, project, raw):
    from chemdft_api.scientific_models import ScientificArtifactRecord

    client, sessions, settings = api
    with sessions() as session:
        key = session.get(ScientificArtifactRecord, session.get(ExperimentalDatasetRecord, raw["id"]).artifact_id).storage_key
    path = settings.object_root / key
    data = bytearray(path.read_bytes())
    data[-1] ^= 0x01
    path.write_bytes(bytes(data))
    assert transform(client, project, raw["id"], "smooth.savgol", {"window_x": 20}).status_code == 409
    assert client.get(f"/v1/projects/{project}/experimental/spectra/datasets/{raw['id']}/arrays").status_code == 409


def test_producer_gate_only_accepts_the_right_issued_producer(api, project):
    pid = UUID(project)
    transform_producer = issue_trusted_producer_context(producer_id="t", producer_type=ProducerType.VALIDATED_DETERMINISTIC_TRANSFORM, project_id=pid, attestation_id="a")
    import_producer = issue_trusted_producer_context(producer_id="i", producer_type=ProducerType.VALIDATED_IMPORT_PIPELINE, project_id=pid, attestation_id="a")
    worker_producer = issue_trusted_producer_context(producer_id="w", producer_type=ProducerType.SCIENTIFIC_WORKER, project_id=pid, attestation_id="a")
    accept_spectrum_dataset(import_producer, project_id=project, kind=SpectrumDatasetKind.RAW)
    accept_spectrum_dataset(transform_producer, project_id=project, kind=SpectrumDatasetKind.TRANSFORM)
    accept_spectrum_dataset(transform_producer, project_id=project, kind=SpectrumDatasetKind.PEAKS)
    for producer, kind in ((transform_producer, SpectrumDatasetKind.RAW), (import_producer, SpectrumDatasetKind.TRANSFORM), (worker_producer, SpectrumDatasetKind.RAW), (worker_producer, SpectrumDatasetKind.TRANSFORM)):
        with pytest.raises(TrustedProducerRequired):
            accept_spectrum_dataset(producer, project_id=project, kind=kind)
    with pytest.raises(CrossProjectReference):
        accept_spectrum_dataset(import_producer, project_id="00000000-0000-4000-8000-0000000000aa", kind=SpectrumDatasetKind.RAW)
    with pytest.raises(TrustedProducerRequired):
        accept_spectrum_dataset(object(), project_id=project, kind=SpectrumDatasetKind.RAW)  # type: ignore[arg-type]


def test_processing_requires_edit_access_and_the_right_project(api, project, raw):
    client, _, _ = api
    other = client.post("/v1/projects", json={"name": "Other", "slug": "other-processing"}).json()["id"]
    assert transform(client, other, raw["id"], "smooth.savgol", {"window_x": 20}).status_code == 404
    assert peaks(client, other, raw["id"], {"prominence": 0.1}).status_code == 404
    assert upload(client, other, ir_text(), key="other-project-01").status_code == 201
