"""RW-2 job diagnostics: executions, attempts, heartbeat freshness, logs, authorization."""

from __future__ import annotations

import io
from uuid import uuid4

import pytest
from chemdft_api.calculation_actions import _job_structure_summary
from chemdft_api.contracts.catalog import ComputeJobView
from chemdft_api.models import Project, utc_now
from chemdft_api.scientific_models import (
    CalculationAttemptRecord,
    CalculationInputRecord,
    ComputeJobRecord,
    ScientificArtifactRecord,
)
from chemdft_api.storage import LocalObjectStore
from test_compute_gateway import _crashed_result, _process_one, _queued_energy_job, _start_execution


def diagnostics(client, project, job):
    response = client.get(f"/v1/projects/{project}/compute/jobs/{job}/diagnostics")
    assert response.status_code == 200, response.text
    return response.json()


def store_log(
    sessions,
    settings,
    project,
    data: bytes,
    *,
    kind="ENGINE_LOG",
    media="text/plain",
    fmt="psi4.log",
):
    stored = LocalObjectStore(settings.object_root).put_raw(project, io.BytesIO(data), 50_000_000)
    with sessions() as session:
        user = session.get(Project, project).created_by
        record = ScientificArtifactRecord(
            project_id=project,
            kind=kind,
            media_type=media,
            format_identifier=fmt,
            format_version="1.0.0",
            size_bytes=stored.size_bytes,
            sha256=stored.sha256,
            storage_key=stored.key,
            created_by=user,
            extensions_json=[],
        )
        session.add(record)
        session.commit()
        return record.id, stored


def add_attempt(
    sessions, job_id, number, artifact_ids=(), state="FAILED", code="ENGINE_CRASHED", note="boom"
):
    with sessions() as session:
        job = session.get(ComputeJobRecord, job_id)
        session.add(
            CalculationAttemptRecord(
                project_id=job.project_id,
                calculation_id=job.calculation_id,
                attempt_number=number,
                state=state,
                worker_id=f"worker-{number}",
                started_at=utc_now(),
                finished_at=utc_now(),
                failure_code=code,
                diagnostic=note,
                raw_artifacts_json=[
                    {"project_id": job.project_id, "artifact_id": a, "sha256": "0" * 64}
                    for a in artifact_ids
                ],
            )
        )
        session.commit()


def test_queued_job_reports_no_progress_and_no_heartbeat(api, monkeypatch):
    client, _s, _t = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-queued")
    body = diagnostics(client, project["id"], detail["compute_job"]["id"])
    assert body["job_state"] in {"PENDING", "READY"}
    assert body["heartbeat_status"] == "NOT_REPORTED" and body["heartbeat_age_seconds"] is None
    assert body["executions"] == [] and body["attempts"] == [] and body["active_lease"] is None
    assert body["progress_reported"] is False and "percent" in body["progress_note"]
    assert not any("percent" in key or "progress_fraction" in key for key in body)
    assert body["logs_available"] is False


@pytest.mark.parametrize(("age", "status"), [(0, "FRESH"), (20, "FRESH"), (90, "STALE")])
def test_heartbeat_freshness_follows_the_lease_deadline_the_scheduler_uses(
    api, monkeypatch, age, status
):
    client, sessions, _t = api
    project, detail = _queued_energy_job(client, monkeypatch, f"diag-beat-{age}")
    job = detail["compute_job"]["id"]
    _start_execution(sessions, job, heartbeat_age_seconds=age)
    body = diagnostics(client, project["id"], job)
    assert body["job_state"] == "RUNNING" and body["heartbeat_status"] == status
    assert body["heartbeat_age_seconds"] == pytest.approx(age, abs=3)
    assert body["heartbeat_stale_after_seconds"] == 60
    assert (
        body["active_lease"]["owner"] == "worker-a"
        and body["executions"][0]["worker_id"] == "worker-a"
    )
    assert body["progress_reported"] is False  # elapsed time is not progress


def test_terminal_job_has_no_heartbeat_semantics(api, monkeypatch):
    client, sessions, _t = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-terminal")
    job = detail["compute_job"]["id"]
    with sessions() as session:
        session.get(ComputeJobRecord, job).state = "SUCCEEDED"
        session.commit()
    assert diagnostics(client, project["id"], job)["heartbeat_status"] == "NOT_APPLICABLE"


def test_failed_execution_surfaces_failure_code_and_diagnostic_from_persisted_records(
    api, monkeypatch
):
    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-failed")
    job = detail["compute_job"]["id"]

    class Crashing:
        def __init__(self, _settings):
            pass

        def execute(self, **_kwargs):
            return _crashed_result()

    monkeypatch.setattr("chemdft_api.calculation_actions.LocalComputeProvider", Crashing)
    _process_one(sessions, settings)
    body = diagnostics(client, project["id"], job)
    assert body["job_state"] == "FAILED" and body["heartbeat_status"] == "NOT_APPLICABLE"
    assert (
        body["attempts"]
        and body["attempts"][0]["failure_code"]
        and body["attempts"][0]["diagnostic"]
    )
    assert body["attempts"][0]["attempt_number"] == 1
    # the diagnostics are exactly what the compute job view already reports as the latest execution
    latest = client.get(f"/v1/projects/{project['id']}/compute/jobs").json()["jobs"][0][
        "latest_execution"
    ]
    final = body["executions"][-1]
    assert (final["state"], final["failure_code"], final["diagnostic"]) == (
        latest["state"],
        latest["failure_code"],
        latest["diagnostic"],
    )


def test_attempt_history_lists_every_attempt_with_its_artifacts(api, monkeypatch):
    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-history")
    job = detail["compute_job"]["id"]
    log_id, stored = store_log(sessions, settings, project["id"], b"SCF did not converge\n")
    raw_id, _ = store_log(
        sessions,
        settings,
        project["id"],
        b"\x00\x01",
        kind="CALCULATION_OUTPUT",
        media="application/octet-stream",
        fmt="engine.binary",
    )
    add_attempt(sessions, job, 1, [log_id, raw_id], note="first")
    add_attempt(sessions, job, 2, [], state="SUCCEEDED", code=None, note=None)
    body = diagnostics(client, project["id"], job)
    assert [a["attempt_number"] for a in body["attempts"]] == [1, 2]
    first = body["attempts"][0]
    assert {a["artifact_id"]: a["log_readable"] for a in first["artifacts"]} == {
        log_id: True,
        raw_id: False,
    }
    assert first["artifacts"][0]["sha256"] == stored.sha256 and body["logs_available"] is True


def test_log_is_a_bounded_sanitized_tail_with_verified_hash(api, monkeypatch):
    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-log")
    job = detail["compute_job"]["id"]
    head = b"HEAD-MARKER\n" + b"x" * (80 * 1024)
    tail = b"\x1b[31mERROR: SCF failed\x1b[0m\r\nlast line\x07\n"
    log_id, stored = store_log(sessions, settings, project["id"], head + tail)
    add_attempt(sessions, job, 1, [log_id])
    response = client.get(f"/v1/projects/{project['id']}/compute/jobs/{job}/logs/{log_id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (
        body["truncated"] is True
        and body["size_bytes"] == len(head + tail)
        and body["returned_bytes"] == 64 * 1024
    )
    assert "HEAD-MARKER" not in body["text"] and body["sha256"] == stored.sha256
    assert "ERROR: SCF failed" in body["text"] and "last line" in body["text"]
    assert "\x1b" not in body["text"] and "\x07" not in body["text"] and "\r" not in body["text"]
    small, _ = store_log(sessions, settings, project["id"], b"short log\n")
    add_attempt(sessions, job, 2, [small])
    whole = client.get(f"/v1/projects/{project['id']}/compute/jobs/{job}/logs/{small}").json()
    assert whole["truncated"] is False and whole["text"] == "short log"


def test_log_reads_cannot_reach_unrelated_artifacts_or_tampered_files(api, monkeypatch):
    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-guard")
    job = detail["compute_job"]["id"]
    attached, _ = store_log(sessions, settings, project["id"], b"attached\n")
    unattached, _ = store_log(sessions, settings, project["id"], b"not attached to any attempt\n")
    binary, _ = store_log(
        sessions,
        settings,
        project["id"],
        b"\x00",
        kind="CALCULATION_OUTPUT",
        media="application/octet-stream",
        fmt="engine.bin",
    )
    add_attempt(sessions, job, 1, [attached, binary])
    url = f"/v1/projects/{project['id']}/compute/jobs/{job}/logs/"
    assert (
        client.get(url + unattached).status_code == 404
    )  # only artifacts persisted by this job's attempts
    assert client.get(url + str(uuid4())).status_code == 404
    assert client.get(url + "../../etc/passwd").status_code == 404
    assert client.get(url + binary).status_code == 422  # download-only, never rendered as text
    with sessions() as session:
        key = session.get(ScientificArtifactRecord, attached).storage_key
    path = settings.object_root / key
    path.write_bytes(b"tampered\n")
    assert client.get(url + attached).status_code == 403  # hash mismatch is refused, not displayed


def test_diagnostics_do_not_cross_projects(api, monkeypatch):
    client, _s, _t = api
    _project, detail = _queued_energy_job(client, monkeypatch, "diag-owner")
    job = detail["compute_job"]["id"]
    other = client.post("/v1/projects", json={"name": "other", "slug": "diag-other"}).json()["id"]
    foreign = client.get(f"/v1/projects/{other}/compute/jobs/{job}/diagnostics")
    missing = client.get(f"/v1/projects/{other}/compute/jobs/{uuid4()}/diagnostics")
    assert foreign.status_code == missing.status_code == 404 and foreign.json() == missing.json()
    assert client.get(f"/v1/projects/{other}/compute/jobs/{job}/logs/{uuid4()}").status_code == 404
    assert client.get(f"/v1/projects/{uuid4()}/compute/jobs/{job}/diagnostics").status_code == 404


def test_job_list_reports_what_each_job_computes_from_the_immutable_input(api, monkeypatch):
    client, _s, _t = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-summary")
    jobs = client.get(f"/v1/projects/{project['id']}/compute/jobs").json()["jobs"]
    summary = jobs[0]["specification_summary"]
    assert summary["task_type"] == "ENERGY" and summary["method"] and summary["charge"] == 0
    assert summary["multiplicity"] == 1
    assert detail["compute_job"]["specification_summary"] == summary


def test_job_list_names_the_input_structure_version(api, monkeypatch):
    client, sessions, _t = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-structure")
    job = client.get(f"/v1/projects/{project['id']}/compute/jobs").json()["jobs"][0]
    summary = job["structure_summary"]
    assert summary["structure_name"] == "H2" and summary["formula_hill"] == "H2"
    assert summary["atom_count"] == 2 and summary["structure_revision"] == 1
    with sessions() as session:
        calc_input = session.get(CalculationInputRecord, job["calculation_input_id"])
        assert summary["structure_version_id"] == calc_input.structure_version_id
    assert detail["compute_job"]["structure_summary"] == summary


def test_structure_summary_is_absent_when_the_version_is_unknown(api, monkeypatch):
    client, sessions, _t = api
    project, _detail = _queued_energy_job(client, monkeypatch, "diag-structure-missing")
    with sessions() as session:
        assert _job_structure_summary(session, project["id"], str(uuid4()), {}) is None
        assert _job_structure_summary(session, project["id"], None, {}) is None


def test_structure_summary_does_not_cross_projects(api, monkeypatch):
    client, sessions, _t = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-structure-owner")
    other = client.post("/v1/projects", json={"name": "o", "slug": "diag-structure-other"}).json()
    assert client.get(f"/v1/projects/{other['id']}/compute/jobs").json()["jobs"] == []
    version_id = detail["compute_job"]["structure_summary"]["structure_version_id"]
    with sessions() as session:
        assert _job_structure_summary(session, other["id"], version_id, {}) is None
        assert _job_structure_summary(session, project["id"], version_id, {}) is not None


def test_job_payload_without_structure_summary_still_parses(api, monkeypatch):
    client, _s, _t = api
    project, _detail = _queued_energy_job(client, monkeypatch, "diag-structure-compat")
    payload = client.get(f"/v1/projects/{project['id']}/compute/jobs").json()["jobs"][0]
    del payload["structure_summary"]
    assert ComputeJobView.model_validate(payload).structure_summary is None


def test_hosted_qe_attempt_shows_the_real_engine_and_worker_not_local_pyscf(api, monkeypatch):
    """Release 0.0.45: a failed hosted Quantum ESPRESSO attempt recorded `local.pyscf` and no engine."""
    client, sessions, _settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-qe-labels")
    job_id = detail["compute_job"]["id"]
    with sessions() as session:
        job = session.get(ComputeJobRecord, job_id)
        job.provider = "aws"
        job.workload_json = {**job.workload_json, "workload_type": "chemdft.qe.periodic-energy.v1"}
        session.add(
            CalculationAttemptRecord(
                project_id=job.project_id, calculation_id=job.calculation_id, attempt_number=1, state="FAILED",
                worker_id="local.pyscf", engine_identity_json=None, started_at=utc_now(), finished_at=utc_now(),
                failure_code="ENGINE_CRASHED", diagnostic="engine crashed", raw_artifacts_json=[],
            )
        )
        session.commit()
    attempt = diagnostics(client, project["id"], job_id)["attempts"][0]
    assert attempt["engine_name"] == "qe"
    assert attempt["worker_id"] == "backend-compute (AWS host)"


def test_a_local_job_keeps_its_recorded_worker_and_engine(api, monkeypatch):
    client, sessions, _settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "diag-local-labels")
    job_id = detail["compute_job"]["id"]
    add_attempt(sessions, job_id, 1)
    attempt = diagnostics(client, project["id"], job_id)["attempts"][0]
    assert attempt["worker_id"] == "worker-1"
