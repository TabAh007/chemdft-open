"""PF-8F: a Result Firewall rejection of a PySCF optimization must end consistently FAILED.

Real native geomeTRIC optimizations (H2/HF/STO-3G, a few seconds) in disposable storage only.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from chemdft_api import calculation_actions as actions
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.context import Identity
from chemdft_api.models import utc_now
from chemdft_api.scientific_models import (
    AuditEventRecord,
    CalculationAttemptRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
    ComputeReservationRecord,
    OptimizationTrajectoryRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from chemdft_api.storage import LocalObjectStore
from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parents[3]


def queue_optimization(api):
    client, _, settings = api
    settings.scientific_worker_python = ROOT / "services/scientific-worker/.venv/bin/python"
    project = client.post(
        "/v1/projects", json={"name": "PF-8F optimization", "slug": f"opt-{uuid4()}"}
    ).json()["id"]
    imported = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={"upload": ("h2.xyz", b"2\nH2\nH 0 0 0\nH 0 0 1.2\n", "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": str(uuid4()), "structure_name": "H2"},
    )
    assert imported.status_code == 201, imported.text
    source = imported.json()["version"]
    queued = client.post(
        f"/v1/projects/{project}/calculations",
        json={
            "structure_version": {
                "project_id": project,
                "entity_type": "structure.version",
                "entity_id": source["id"],
            },
            "specification": {
                "task_type": "GEOMETRY_OPTIMIZATION",
                "method": {"identifier": "hf", "display_name": "hf", "registry": "chemdft.method"},
                "basis": {
                    "identifier": "sto-3g",
                    "display_name": "STO-3G",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
                "optimization": {"optimizer": "geometric", "max_steps": 12},
            },
            "idempotency_key": str(uuid4()),
        },
    )
    assert queued.status_code == 201, queued.text
    return project, source, queued.json()["calculation"]["id"]


def work(api):
    _, sessions, settings = api
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
        )


def detail(api, project, calculation):
    return api[0].get(f"/v1/projects/{project}/calculations/{calculation}").json()


def version_count(api, project, source):
    return len(
        api[0].get(f"/v1/projects/{project}/structures/{source['structure_id']}/versions").json()
    )


def test_valid_optimization_still_publishes_atomically(api):
    project, source, calculation = queue_optimization(api)
    work(api)
    body = detail(api, project, calculation)
    assert body["calculation"]["state"] == "SUCCEEDED", body
    assert body["optimization_trajectory"]["state"] == "CONVERGED"
    assert body["result"]["authority"] == "AUTHORITATIVE"
    assert version_count(api, project, source) == 2
    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 1
        job = session.scalar(select(ComputeJobRecord))
        assert job.state == "SUCCEEDED"
        assert session.get(ComputeReservationRecord, job.reservation_id).state == "RELEASED"


def test_firewall_rejected_optimization_ends_failed_without_half_published_state(api, monkeypatch):
    project, source, calculation = queue_optimization(api)
    with api[1]() as session:
        canonical_kind = session.get(
            ScientificArtifactRecord,
            session.get(StructureVersionRecord, source["id"]).canonical_artifact_id,
        ).kind
        canonical_before = session.scalar(
            select(func.count())
            .select_from(ScientificArtifactRecord)
            .where(ScientificArtifactRecord.kind == canonical_kind)
        )
    real = actions.accept_authoritative_result

    def tampered(session, producer, submission, **kwargs):
        # Real publisher, genuinely failing its trajectory-integrity check.
        payload = submission.payload.model_copy(update={"trajectory_sha256": "0" * 64})
        return real(session, producer, submission.model_copy(update={"payload": payload}), **kwargs)

    monkeypatch.setattr(actions, "accept_authoritative_result", tampered)
    work(api)  # must not raise: a scientific rejection is a handled terminal outcome
    monkeypatch.setattr(actions, "accept_authoritative_result", real)

    body = detail(api, project, calculation)
    assert body["calculation"]["state"] == "FAILED", body["calculation"]
    assert body["attempt"]["state"] == "FAILED"
    assert body["attempt"]["failure_code"] == "RESULT_VALIDATION_FAILED"
    assert "Trajectory artifact does not match" in body["attempt"]["diagnostic"]
    assert body["result"] is None
    assert body["optimization_trajectory"]["state"] == "FAILED"
    assert body["optimization_trajectory"]["final_structure_version_id"] is None
    assert version_count(api, project, source) == 1

    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        # No authoritative provenance for rejected output, and no orphaned lineage edges.
        operations = set(session.scalars(select(ProvenanceRecordRow.operation)))
        assert not operations & {"chemdft.calculation.optimization", "chemdft.structure.optimized"}
        provenance_ids = set(session.scalars(select(ProvenanceRecordRow.id)))
        assert all(
            edge.provenance_record_id in provenance_ids
            for edge in session.scalars(select(ProvenanceInputRow))
        )
        # The proposed optimized structure's canonical artifact was not published.
        assert (
            session.scalar(
                select(func.count())
                .select_from(ScientificArtifactRecord)
                .where(ScientificArtifactRecord.kind == canonical_kind)
            )
            == canonical_before
        )
        created = [
            e
            for e in session.scalars(select(AuditEventRecord))
            if e.event_name == "structure.version.created"
        ]
        assert (
            all(
                str(source["id"]) in str(e.targets_json) or "import" in str(e.targets_json).lower()
                for e in created
            )
            or len(created) <= 1
        )
        # Consistent terminal scheduling state; nothing waits for lease expiry.
        calc = session.get(CalculationRecord, calculation)
        job = session.scalar(select(ComputeJobRecord))
        execution = session.scalar(select(ComputeExecutionRecord))
        attempts = session.scalars(select(CalculationAttemptRecord)).all()
        assert calc.state == "FAILED" and job.state == "FAILED" and execution.state == "FAILED"
        assert len(attempts) == 1 and attempts[0].state == "FAILED"
        assert execution.calculation_attempt_id == attempts[0].id
        reservation = session.get(ComputeReservationRecord, job.reservation_id)
        assert reservation.state == "RELEASED"
        assert reservation.actual_cost_json == {"currency": "USD", "minor_units": 0}
        assert all(lease.state != "ACTIVE" for lease in session.scalars(select(ComputeLeaseRecord)))
        # The Firewall rejection audit is retained.
        rejected = [
            e
            for e in session.scalars(select(AuditEventRecord))
            if e.event_name == "scientific_result.rejected"
        ]
        assert len(rejected) == 1 and rejected[0].outcome == "REJECTED"
        # Native diagnostics survive on the failed attempt and are the authorized download set.
        references = attempts[0].raw_artifacts_json
        formats = set()
        for ref in references:
            row = session.get(ScientificArtifactRecord, ref["artifact_id"])
            assert row is not None and row.sha256 == ref["sha256"]
            formats.add(row.format_identifier)
        assert "chemdft.optimization_trajectory" in formats
        assert "chemdft.environment_manifest" in formats
        trajectory = session.scalar(select(OptimizationTrajectoryRecord))
        assert trajectory.artifact_id in {ref["artifact_id"] for ref in references}
    client = api[0]
    for ref in references:
        download = client.get(
            f"/v1/projects/{project}/calculations/{calculation}/artifacts/{ref['artifact_id']}"
        )
        assert download.status_code == 200, download.text
        import hashlib

        assert hashlib.sha256(download.content).hexdigest() == ref["sha256"]
    # A project the caller does not own cannot reach them.
    other = client.post("/v1/projects", json={"name": "Other", "slug": f"other-{uuid4()}"}).json()[
        "id"
    ]
    assert (
        client.get(
            f"/v1/projects/{other}/calculations/{calculation}/artifacts/{references[0]['artifact_id']}"
        ).status_code
        == 404
    )


def test_unexpected_publication_errors_are_not_swallowed_as_scientific_rejection(api, monkeypatch):
    queue_optimization(api)

    def broken(*args, **kwargs):
        raise RuntimeError("storage backend exploded")

    monkeypatch.setattr(actions, "accept_authoritative_result", broken)
    with pytest.raises(RuntimeError, match="exploded"):
        work(api)
    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0


def test_stale_worker_cannot_publish_or_overwrite_recovered_optimization(api, monkeypatch):
    from chemdft_api.calculation_actions import recover_expired_compute_leases
    from chemdft_api.compute_gateway import LocalComputeProvider

    project, source, calculation = queue_optimization(api)
    real = LocalComputeProvider.execute

    def lose_lease_then_finish(self, **kwargs):
        result = real(self, **kwargs)  # the native run completes...
        with api[1]() as session:  # ...but the lease lapsed and recovery already finalized FAILED
            for lease in session.scalars(select(ComputeLeaseRecord)):
                lease.expires_at = lease.heartbeat_deadline_at = utc_now() - timedelta(minutes=5)
            session.commit()
        with api[1]() as session:
            recover_expired_compute_leases(session)
        return result

    monkeypatch.setattr(LocalComputeProvider, "execute", lose_lease_then_finish)
    work(api)
    body = detail(api, project, calculation)
    assert body["calculation"]["state"] == "FAILED", body["calculation"]
    assert body["result"] is None and version_count(api, project, source) == 1
    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        assert session.scalar(select(func.count()).select_from(CalculationAttemptRecord)) == 1
        job = session.scalar(select(ComputeJobRecord))
        assert job.state == "FAILED"
        assert session.get(ComputeReservationRecord, job.reservation_id).state == "RELEASED"
        assert all(lease.state != "ACTIVE" for lease in session.scalars(select(ComputeLeaseRecord)))


def test_lease_lost_between_evidence_commit_and_publication_is_fenced(api, monkeypatch):
    """The window opened by retaining evidence early: a recovered calculation is not overwritten."""
    from chemdft_api.calculation_actions import recover_expired_compute_leases

    project, source, calculation = queue_optimization(api)
    real = actions._execution_still_owned

    def lose_lease_first(session, job, execution):
        with api[1]() as other:
            for lease in other.scalars(select(ComputeLeaseRecord)):
                lease.expires_at = lease.heartbeat_deadline_at = utc_now() - timedelta(minutes=5)
            other.commit()
        with api[1]() as other:
            recover_expired_compute_leases(other)
        return real(session, job, execution)

    monkeypatch.setattr(actions, "_execution_still_owned", lose_lease_first)
    work(api)
    body = detail(api, project, calculation)
    assert body["calculation"]["state"] == "FAILED" and body["result"] is None
    assert version_count(api, project, source) == 1
    with api[1]() as session:
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        assert session.scalar(select(func.count()).select_from(CalculationAttemptRecord)) == 1
        assert all(lease.state != "ACTIVE" for lease in session.scalars(select(ComputeLeaseRecord)))


def test_cancel_requested_before_publication_finalizes_canceled_without_result(api, monkeypatch):
    project, source, calculation = queue_optimization(api)
    real = actions._execution_still_owned

    def cancel_first(session, job, execution):
        with api[1]() as other:
            row = other.scalar(select(ComputeJobRecord))
            row.state = "CANCEL_REQUESTED"
            other.commit()
        return real(session, job, execution)

    monkeypatch.setattr(actions, "_execution_still_owned", cancel_first)
    work(api)
    body = detail(api, project, calculation)
    assert body["calculation"]["state"] == "CANCELED" and body["result"] is None
    assert body["optimization_trajectory"]["state"] == "CANCELED"
    assert version_count(api, project, source) == 1
    with api[1]() as session:
        job = session.scalar(select(ComputeJobRecord))
        assert job.state == "CANCELED"
        assert session.get(ComputeReservationRecord, job.reservation_id).state == "RELEASED"
        assert all(lease.state != "ACTIVE" for lease in session.scalars(select(ComputeLeaseRecord)))
        assert {e.state for e in session.scalars(select(ComputeExecutionRecord))} == {"CANCELED"}
