"""Regression (release 0.0.45): a hosted AWS job longer than five minutes must keep its lease and authorization.

Live evidence 2026-11-12/13: QE relax (417 s on the host) was LOST twice at ~5 min through the site. The lease and the execution
authorization were issued with ``compute_lease_seconds`` (300 s); the publication gate ``lock_live_lease`` requires
``expires_at > now``, so any hosted result arriving after 300 s was dropped. These tests use a simulated clock (no AWS, no sleeping).
"""
from __future__ import annotations

from datetime import UTC, timedelta

import pytest
from chemdft_api import calculation_actions as actions
from chemdft_api.aws_compute import AWS_PROVIDER
from chemdft_api.scientific_models import (
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
)
from sqlalchemy import select
from test_compute_gateway import _crashed_result, _process_one, _queued_energy_job


def _aware(value):
    return value if value.tzinfo else value.replace(tzinfo=UTC)


class SimClock:
    def __init__(self) -> None:
        self.real = actions.utc_now
        self.offset = timedelta(0)

    def now(self):
        return self.real() + self.offset

    def advance(self, seconds: float) -> None:
        self.offset += timedelta(seconds=seconds)


def _make_hosted(sessions, monkeypatch, job_id: str, engine: str, task: str) -> None:
    """The stored calculation input is append-only, so the seeded energy job is switched to the AWS provider and the AWS
    limit lookup is pinned to the engine/task under test."""
    from chemdft_api import aws_compute

    monkeypatch.setattr(actions, "session_is_authorized", lambda *_a, **_k: True)  # an open, unexpired AWS session
    with sessions() as session:
        session.get(ComputeJobRecord, job_id).provider = AWS_PROVIDER
        session.commit()
    original = aws_compute.aws_runtime_limit_seconds
    monkeypatch.setattr(aws_compute, "aws_runtime_limit_seconds", lambda settings, _task, _engine=None: original(settings, task, engine))


@pytest.mark.parametrize(
    ("engine", "task"), [("qe", "PERIODIC_ENERGY"), ("pyscf", "PERIODIC_ENERGY")], ids=["qe", "pyscf-periodic"]
)
def test_a_600_second_hosted_run_keeps_lease_and_authorization_and_is_published(api, monkeypatch, engine, task):
    client, sessions, settings = api
    _, detail = _queued_energy_job(client, monkeypatch, f"hosted-ttl-{engine}")
    job_id = detail["compute_job"]["id"]
    _make_hosted(sessions, monkeypatch, job_id, engine, task)
    clock = SimClock()
    monkeypatch.setattr(actions, "utc_now", clock.now)
    observed: list[tuple[bool, bool, bool]] = []

    class HostRun600:
        def __init__(self, _settings) -> None:
            pass

        def execute(self, *, on_tick=None, **_kwargs):
            tick = max(1.0, settings.compute_heartbeat_seconds / 4)
            elapsed = 0.0
            while elapsed < 600:
                clock.advance(tick)
                elapsed += tick
                on_tick()
                with sessions() as session:
                    lease = session.scalar(select(ComputeLeaseRecord).where(ComputeLeaseRecord.job_id == job_id))
                    execution = session.get(ComputeExecutionRecord, lease.execution_id)
                    now = clock.now()
                    observed.append((
                        lease.state == "ACTIVE" and _aware(lease.expires_at) > now,
                        _aware(execution.authorization_expires_at) > now,
                        _aware(lease.heartbeat_deadline_at) > now,
                    ))
            return _crashed_result()

    monkeypatch.setattr(actions, "AwsEc2ComputeProvider", HostRun600)
    _process_one(sessions, settings)

    assert observed and all(all(row) for row in observed), "lease/authorization lapsed during the hosted run"
    with sessions() as session:
        execution = session.scalar(select(ComputeExecutionRecord).where(ComputeExecutionRecord.job_id == job_id))
        # The publication gate accepted the result: the execution is finished, not left RUNNING/LOST by the early return.
        assert execution.state not in {"RUNNING", "LOST"}, execution.state


def test_the_lease_follows_the_jobs_own_limit_and_local_jobs_keep_the_default(api, monkeypatch):
    _, _, settings = api
    from types import SimpleNamespace

    aws_job = SimpleNamespace(provider=AWS_PROVIDER)
    local_job = SimpleNamespace(provider="local")
    spec = {"task_type": "PERIODIC_ENERGY", "engine_preference": {"engine": "qe"}}
    ttl = actions._hosted_run_ttl_seconds(settings, aws_job, spec)
    assert ttl == settings.aws_qe_timeout_total_seconds + settings.aws_job_overhead_seconds + 60
    assert actions._hosted_run_ttl_seconds(settings, local_job, spec) == settings.compute_lease_seconds
    assert settings.compute_lease_seconds == 300  # not raised globally


def test_a_dead_hosted_worker_is_still_reclaimed_by_the_heartbeat_deadline(api, monkeypatch):
    client, sessions, settings = api
    _, detail = _queued_energy_job(client, monkeypatch, "hosted-dead-worker")
    job_id = detail["compute_job"]["id"]
    _make_hosted(sessions, monkeypatch, job_id, "qe", "PERIODIC_ENERGY")
    clock = SimClock()
    monkeypatch.setattr(actions, "utc_now", clock.now)
    reclaimed: list[int] = []

    class DiesSilently:
        def __init__(self, _settings) -> None:
            pass

        def execute(self, *, on_tick=None, **_kwargs):
            clock.advance(settings.compute_heartbeat_seconds + 5)  # no heartbeat for longer than the window
            with sessions() as other:
                reclaimed.append(actions.recover_expired_compute_leases(other))
            return _crashed_result()

    monkeypatch.setattr(actions, "AwsEc2ComputeProvider", DiesSilently)
    _process_one(sessions, settings)
    assert reclaimed == [1]


def test_a_periodic_job_waits_when_the_session_is_too_short_for_its_limit(api, monkeypatch):
    client, sessions, settings = api
    _, detail = _queued_energy_job(client, monkeypatch, "hosted-short-session")
    job_id = detail["compute_job"]["id"]
    with sessions() as session:
        job = session.get(ComputeJobRecord, job_id)
        job.provider = AWS_PROVIDER
        job.workload_json = {**job.workload_json, "workload_type": "chemdft.qe.periodic-energy.v1"}
        session.commit()
    monkeypatch.setattr(
        actions, "session_is_authorized", lambda _settings, now=None, cli=None, task="ENERGY": task != "PERIODIC_ENERGY"
    )
    assert _process_one(sessions, settings) is None
    with sessions() as session:
        assert session.get(ComputeJobRecord, job_id).state in {"READY", "PENDING"}
