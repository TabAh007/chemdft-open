"""Workload-specific lease sweeps; these tests use disposable database records."""

from datetime import timedelta

import pytest
from chemdft_api import calculation_actions as actions
from chemdft_api.models import utc_now
from chemdft_api.scientific_models import (
    CalculationResultRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
)
from sqlalchemy import func, select
from test_compute_gateway import (
    _crashed_result,
    _process_one,
    _queued_energy_job,
    _start_execution,
)

WORKLOADS = {
    "pyscf": "chemdft.pyscf.energy.v1",
    "xtb": "chemdft.xtb.energy.v1",
    "crest": "chemdft.crest.conformer-search.v1",
    "psi4": "chemdft.psi4.energy.v1",
}


@pytest.mark.parametrize("engine", WORKLOADS)
@pytest.mark.parametrize("lost", [False, True])
def test_heartbeat_preserves_existing_policy_and_never_revives_lost_lease(
    api, monkeypatch, engine, lost
):
    from chemdft_api.compute_gateway import lease_token_hash

    client, sessions, settings = api
    _, detail = _queued_energy_job(client, monkeypatch, f"beat-expiry-{engine}-{int(lost)}")
    job_id = detail["compute_job"]["id"]
    _start_execution(sessions, job_id, heartbeat_age_seconds=0)
    with sessions() as session:
        job = session.get(ComputeJobRecord, job_id)
        job.workload_json = {**job.workload_json, "workload_type": WORKLOADS[engine]}
        lease = session.scalar(select(ComputeLeaseRecord))
        lease.lease_token_hash = lease_token_hash("known-token")
        lease.expires_at = utc_now() - timedelta(seconds=1)
        if lost:
            lease.state = "EXPIRED"
        session.commit()
        assert actions.heartbeat_compute_execution(
            session, execution_id=lease.execution_id, owner=lease.owner,
            lease_token="known-token", settings=settings,
        ) is (not lost and engine in {"pyscf", "xtb"})
        session.refresh(lease)
        assert lease.state == ("EXPIRED" if lost else "ACTIVE")


@pytest.mark.parametrize("engine", WORKLOADS)
@pytest.mark.parametrize("sweep", ["recover", "cancel-sweep"])
@pytest.mark.parametrize("deadline", ["absolute", "heartbeat", "both"])
def test_workload_specific_expiry(api, monkeypatch, engine, sweep, deadline):
    client, sessions, _settings = api
    _, detail = _queued_energy_job(client, monkeypatch, f"lease-{engine}-{sweep}-{deadline}")
    job_id = detail["compute_job"]["id"]
    _start_execution(sessions, job_id, heartbeat_age_seconds=0)
    with sessions() as session:
        job = session.get(ComputeJobRecord, job_id)
        job.workload_json = {**job.workload_json, "workload_type": WORKLOADS[engine]}
        lease = session.scalar(select(ComputeLeaseRecord))
        execution = session.get(ComputeExecutionRecord, lease.execution_id)
        if deadline in {"absolute", "both"}:
            lease.expires_at = utc_now() - timedelta(seconds=1)
        if deadline in {"heartbeat", "both"}:
            lease.heartbeat_deadline_at = utc_now() - timedelta(seconds=1)
        session.commit()
        expired = deadline != "absolute" or engine == "psi4"
        if sweep == "recover":
            requeued = actions.recover_expired_compute_leases(session)
            assert requeued == int(expired and engine in {"pyscf", "xtb"})
            session.refresh(job)
            assert job.state == (
                "READY" if expired and engine in {"pyscf", "xtb"}
                else "FAILED" if expired else "RUNNING"
            )
            assert actions.recover_expired_compute_leases(session) == 0
        else:
            actions._expire_stale_leases(session, utc_now(), job_id=job_id)
            session.commit()
        session.refresh(lease)
        session.refresh(execution)
        assert lease.state == ("EXPIRED" if expired else "ACTIVE")
        assert execution.state == ("LOST" if expired else "RUNNING")
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        assert session.scalar(select(func.count()).select_from(ComputeExecutionRecord)) == 1
    if not expired:
        # A competing worker sweeps before claiming; it must leave the live job alone.
        assert _process_one(sessions, _settings) is None


@pytest.mark.parametrize("engine", ["pyscf", "xtb"])
def test_long_running_worker_fresh_heartbeat_survives_absolute_expiry(api, monkeypatch, engine):
    client, sessions, settings = api
    _, detail = _queued_energy_job(client, monkeypatch, f"long-expiry-{engine}")
    job_id = detail["compute_job"]["id"]
    with sessions() as session:
        job = session.get(ComputeJobRecord, job_id)
        job.workload_json = {**job.workload_json, "workload_type": WORKLOADS[engine]}
        session.commit()

    class LongRunningProvider:
        def __init__(self, _settings):
            pass

        def execute(self, *, on_tick, **_kwargs):
            for _ in range(4):
                with sessions() as session:
                    lease = session.scalar(select(ComputeLeaseRecord))
                    lease.expires_at = utc_now() - timedelta(minutes=10)
                    session.commit()
                assert on_tick() is not False
                with sessions() as competitor:
                    assert actions.recover_expired_compute_leases(competitor) == 0
                    assert competitor.get(ComputeJobRecord, job_id).state == "RUNNING"
                assert _process_one(sessions, settings) is None
            return _crashed_result()

    monkeypatch.setattr(actions, "LocalComputeProvider", LongRunningProvider)
    _process_one(sessions, settings)
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(ComputeExecutionRecord)) == 1
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
