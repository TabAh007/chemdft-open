from __future__ import annotations

import json
import sys
import textwrap
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from chemdft_api.calculation_actions import (
    process_next_compute_job,
    recover_expired_compute_leases,
)
from chemdft_api.composition import get_object_store_for_settings
from chemdft_api.compute_gateway import LocalComputeProvider
from chemdft_api.config import Settings
from chemdft_api.context import Identity
from chemdft_api.contracts.base import EntityReference
from chemdft_api.contracts.catalog import (
    ComputeRequirement,
    ExecutionRequest,
    IsolationClass,
    MoneyAmount,
    ReproducibilityClass,
    WorkloadReference,
)
from chemdft_api.models import utc_now
from chemdft_api.scientific.engines.interfaces import ExecutionResult, LocalSubprocessRequest
from chemdft_api.scientific.engines.runner import LocalSubprocessRunner
from chemdft_api.scientific_models import (
    CalculationAttemptRecord,
    CalculationRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
)
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import OperationalError


def _energy_spec() -> dict[str, object]:
    return {
        "task_type": "ENERGY",
        "method": {
            "identifier": "hf",
            "display_name": "Hartree-Fock",
            "registry": "chemdft.method",
        },
        "basis": {
            "identifier": "sto-3g",
            "display_name": "STO-3G",
            "registry": "chemdft.basis",
        },
        "charge": 0,
        "multiplicity": 1,
        "engine_preference": {"engine": "pyscf"},
    }


def _import_h2(client, project_id: str) -> dict[str, object]:
    response = client.post(
        f"/v1/projects/{project_id}/structures/imports",
        files={
            "upload": (
                "h2.xyz",
                b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n",
                "chemical/x-xyz",
            )
        },
        data={
            "file_format": "XYZ",
            "idempotency_key": f"h2-import-{uuid4()}",
            "structure_name": "H2",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["version"]


def test_compute_contracts_are_provider_neutral_and_money_is_exact() -> None:
    requirement = ComputeRequirement(
        cpu_count=1,
        memory_bytes=536_870_912,
        runtime_limit_seconds=60,
        isolation_class=IsolationClass.LOCAL_DEVELOPMENT,
        reproducibility_class=ReproducibilityClass.LOCAL_PINNED_ENVIRONMENT,
    )
    request = ExecutionRequest(
        calculation_id=uuid4(),
        calculation_input_id=uuid4(),
        workload=WorkloadReference(
            workload_type="chemdft.pyscf.energy.v1",
            workload_version="1.0.0",
        ),
        requirement=requirement,
        requirement_hash="a" * 64,
        reservation_id=uuid4(),
        correlation_id=uuid4(),
        idempotency_key="compute-request-1",
    )
    payload = request.model_dump(mode="json")
    assert "modal" not in payload
    assert "worker_script" not in payload
    assert "interpreter" not in payload
    with pytest.raises(ValidationError):
        MoneyAmount(currency="USD", minor_units=-1)
    with pytest.raises(ValidationError):
        ExecutionRequest.model_validate({**payload, "modal_function_name": "run"})


def test_calculation_submit_creates_async_compute_job_and_cancel(api, monkeypatch) -> None:
    monkeypatch.setattr(
        "chemdft_api.calculation_actions.validate_capability",
        lambda _specification, _settings: None,
    )
    client, _sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "Compute queue", "slug": "compute-queue"}
    ).json()
    version = _import_h2(client, project["id"])
    response = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": _energy_spec(),
            "idempotency_key": "async-submit-1",
        },
    )
    assert response.status_code == 201, response.text
    detail = response.json()
    assert detail["calculation"]["state"] == "QUEUED"
    assert detail["result"] is None
    assert detail["compute_job"]["state"] == "READY"
    assert detail["compute_job"]["provider"] == "local"
    assert detail["compute_job"]["estimate"]["cost_high"]["minor_units"] == 0
    assert "storage_key" not in str(detail)

    jobs = client.get(f"/v1/projects/{project['id']}/compute/jobs").json()["jobs"]
    assert [job["id"] for job in jobs] == [detail["compute_job"]["id"]]

    canceled = client.post(
        f"/v1/projects/{project['id']}/calculations/{detail['calculation']['id']}/cancel"
    ).json()
    assert canceled["calculation"]["state"] == "CANCELED"
    assert canceled["compute_job"]["state"] == "CANCELED"


def test_expired_lease_recovery_returns_running_job_to_ready(api, monkeypatch) -> None:
    monkeypatch.setattr(
        "chemdft_api.calculation_actions.validate_capability",
        lambda _specification, _settings: None,
    )
    client, sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "Lease recovery", "slug": "lease-recovery"}
    ).json()
    version = _import_h2(client, project["id"])
    detail = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": EntityReference(
                project_id=UUID(project["id"]),
                entity_type="structure.version",
                entity_id=UUID(version["id"]),
            ).model_dump(mode="json"),
            "specification": _energy_spec(),
            "idempotency_key": "lease-recovery-1",
        },
    ).json()
    with sessions() as session:
        job = session.scalar(
            select(ComputeJobRecord).where(ComputeJobRecord.id == detail["compute_job"]["id"])
        )
        assert job is not None
        job.state = "RUNNING"
        execution = ComputeExecutionRecord(
            project_id=job.project_id,
            job_id=job.id,
            calculation_id=job.calculation_id,
            provider=job.provider,
            provider_execution_ref=None,
            state="RUNNING",
            authorization_hash="b" * 64,
            authorization_expires_at=utc_now() + timedelta(minutes=5),
            started_at=utc_now(),
            heartbeat_at=utc_now() - timedelta(minutes=10),
        )
        session.add(execution)
        session.flush()
        session.add(
            ComputeLeaseRecord(
                project_id=job.project_id,
                job_id=job.id,
                execution_id=execution.id,
                owner="lost-worker",
                lease_token_hash="c" * 64,
                expires_at=utc_now() - timedelta(minutes=5),
                heartbeat_deadline_at=utc_now() - timedelta(minutes=5),
                heartbeat_at=utc_now() - timedelta(minutes=10),
                state="ACTIVE",
            )
        )
        session.commit()
        assert recover_expired_compute_leases(session) == 1
        session.refresh(job)
        session.refresh(execution)
        assert job.state == "READY"
        assert execution.state == "LOST"
        assert execution.failure_code == "LEASE_EXPIRED"


def _queued_energy_job(client, monkeypatch, slug: str) -> tuple[dict, dict]:
    monkeypatch.setattr(
        "chemdft_api.calculation_actions.validate_capability",
        lambda _specification, _settings: None,
    )
    project = client.post("/v1/projects", json={"name": slug, "slug": slug}).json()
    version = _import_h2(client, project["id"])
    detail = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": EntityReference(
                project_id=UUID(project["id"]),
                entity_type="structure.version",
                entity_id=UUID(version["id"]),
            ).model_dump(mode="json"),
            "specification": _energy_spec(),
            "idempotency_key": f"{slug}-1",
        },
    ).json()
    return project, detail


def _start_execution(sessions, job_id: str, *, heartbeat_age_seconds: float) -> None:
    """Run the job under a worker lease last heartbeated that long ago (deadline: 60 s)."""
    with sessions() as session:
        job = session.get(ComputeJobRecord, job_id)
        calculation = session.get(CalculationRecord, job.calculation_id)
        job.state = "RUNNING"
        calculation.state = "RUNNING"
        beat = utc_now() - timedelta(seconds=heartbeat_age_seconds)
        execution = ComputeExecutionRecord(
            project_id=job.project_id,
            job_id=job.id,
            calculation_id=job.calculation_id,
            provider=job.provider,
            provider_execution_ref=None,
            state="RUNNING",
            worker_id="worker-a",
            authorization_hash="b" * 64,
            authorization_expires_at=utc_now() + timedelta(minutes=5),
            started_at=beat,
            heartbeat_at=beat,
        )
        session.add(execution)
        session.flush()
        session.add(
            ComputeLeaseRecord(
                project_id=job.project_id,
                job_id=job.id,
                execution_id=execution.id,
                owner="worker-a",
                lease_token_hash=uuid4().hex + uuid4().hex,
                expires_at=beat + timedelta(minutes=5),
                heartbeat_deadline_at=beat + timedelta(seconds=60),
                heartbeat_at=beat,
                state="ACTIVE",
            )
        )
        session.commit()


def _cancel(client, project: dict, detail: dict) -> dict:
    response = client.post(
        f"/v1/projects/{project['id']}/calculations/{detail['calculation']['id']}/cancel"
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_cancel_with_a_lapsed_lease_is_finalized_immediately(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "cancel-lapsed")
    job_id = detail["compute_job"]["id"]
    _start_execution(sessions, job_id, heartbeat_age_seconds=600)

    canceled = _cancel(client, project, detail)

    assert canceled["calculation"]["state"] == "CANCELED"
    assert canceled["compute_job"]["state"] == "CANCELED"
    assert canceled["result"] is None
    with sessions() as session:
        job = session.get(ComputeJobRecord, job_id)
        execution = session.scalar(
            select(ComputeExecutionRecord).where(ComputeExecutionRecord.job_id == job_id)
        )
        lease = session.scalar(
            select(ComputeLeaseRecord).where(ComputeLeaseRecord.job_id == job_id)
        )
        attempts = session.scalars(
            select(CalculationAttemptRecord).where(
                CalculationAttemptRecord.calculation_id == job.calculation_id
            )
        ).all()
    assert (execution.state, execution.failure_code) == ("LOST", "LEASE_EXPIRED")
    assert lease.state == "EXPIRED"
    assert [(a.state, a.failure_code) for a in attempts] == [("CANCELED", "CANCELED")]
    assert attempts[0].raw_artifacts_json == []


def test_cancel_of_a_requeued_running_calculation_is_finalized_immediately(
    api, monkeypatch
) -> None:
    """After a lost lease the job went back to READY while the calculation still reads RUNNING."""
    client, sessions, _settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "cancel-requeued")
    job_id = detail["compute_job"]["id"]
    _start_execution(sessions, job_id, heartbeat_age_seconds=600)
    with sessions() as session:
        assert recover_expired_compute_leases(session) == 1
        assert session.get(ComputeJobRecord, job_id).state == "READY"

    canceled = _cancel(client, project, detail)

    assert canceled["calculation"]["state"] == "CANCELED"
    assert canceled["compute_job"]["state"] == "CANCELED"
    # nothing may pick the canceled job up again
    with sessions() as session:
        assert (
            process_next_compute_job(
                session,
                Identity(
                    user_id=_settings.dev_user_id, organization_id=_settings.dev_organization_id
                ),
                get_object_store_for_settings(_settings),
                _settings,
            )
            is None
        )


def test_cancel_with_a_live_lease_waits_for_the_worker(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "cancel-live")
    job_id = detail["compute_job"]["id"]
    _start_execution(sessions, job_id, heartbeat_age_seconds=5)

    requested = _cancel(client, project, detail)

    assert requested["compute_job"]["state"] == "CANCEL_REQUESTED"
    assert requested["calculation"]["state"] == "RUNNING"
    with sessions() as session:
        lease = session.scalar(
            select(ComputeLeaseRecord).where(ComputeLeaseRecord.job_id == job_id)
        )
        assert lease.state == "ACTIVE"
        assert recover_expired_compute_leases(session) == 0
        assert session.get(ComputeJobRecord, job_id).state == "CANCEL_REQUESTED"


def test_sweep_finalizes_a_cancel_stranded_without_an_execution(api, monkeypatch) -> None:
    """A CANCEL_REQUESTED job whose worker is gone must not stay requested forever."""
    client, sessions, _settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "cancel-stranded")
    job_id = detail["compute_job"]["id"]
    _start_execution(sessions, job_id, heartbeat_age_seconds=5)
    requested = _cancel(client, project, detail)
    assert requested["compute_job"]["state"] == "CANCEL_REQUESTED"
    with sessions() as session:  # the worker dies; its heartbeat lapses
        lease = session.scalar(
            select(ComputeLeaseRecord).where(ComputeLeaseRecord.job_id == job_id)
        )
        lease.heartbeat_deadline_at = utc_now() - timedelta(minutes=1)
        session.commit()

    with sessions() as session:
        assert recover_expired_compute_leases(session) == 0  # canceled, not requeued
        job = session.get(ComputeJobRecord, job_id)
        calculation = session.get(CalculationRecord, job.calculation_id)
        assert (job.state, calculation.state) == ("CANCELED", "CANCELED")
        assert recover_expired_compute_leases(session) == 0  # idempotent

    # an already-stranded job (leases expired earlier, nothing active) is finalized too
    project2, detail2 = _queued_energy_job(client, monkeypatch, "cancel-stranded-2")
    job2_id = detail2["compute_job"]["id"]
    _start_execution(sessions, job2_id, heartbeat_age_seconds=600)
    with sessions() as session:
        session.get(ComputeJobRecord, job2_id).state = "CANCEL_REQUESTED"
        session.commit()
        recover_expired_compute_leases(session)
        assert session.get(ComputeJobRecord, job2_id).state == "CANCELED"
    assert _cancel(client, project2, detail2)["calculation"]["state"] == "CANCELED"


def test_a_worker_that_finishes_after_the_cancel_was_finalized_publishes_nothing(
    api, monkeypatch
) -> None:
    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "cancel-late-finish")
    job_id = detail["compute_job"]["id"]

    class FinalizingProvider:
        def __init__(self, _settings) -> None:
            pass

        def execute(self, **_kwargs) -> ExecutionResult:
            # While the subprocess runs, the lease lapses and the user's cancel is finalized.
            with sessions() as other:
                lease = other.scalar(
                    select(ComputeLeaseRecord).where(ComputeLeaseRecord.job_id == job_id)
                )
                lease.heartbeat_deadline_at = utc_now() - timedelta(minutes=1)
                other.commit()
            _cancel(client, project, detail)
            return ExecutionResult(
                exit_code=0,
                timed_out=False,
                stdout=b"",
                stderr=b"",
                engine_log=b"",
                result_document={},
            )

    monkeypatch.setattr("chemdft_api.calculation_actions.LocalComputeProvider", FinalizingProvider)
    identity = Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id)
    with sessions() as session:
        finished = process_next_compute_job(
            session, identity, get_object_store_for_settings(settings), settings
        )

    assert finished is not None
    assert finished.calculation.state == "CANCELED"
    assert finished.result is None
    with sessions() as session:
        assert session.get(ComputeJobRecord, job_id).state == "CANCELED"
        calculation = session.scalar(select(CalculationRecord))
        assert calculation.state == "CANCELED"
        attempts = session.scalars(select(CalculationAttemptRecord)).all()
        assert [a.state for a in attempts] == ["CANCELED"]


# --- worker lease heartbeat while the subprocess runs ---------------------------------------------


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _age_lease(sessions, job_id: str, *, seconds: float) -> None:
    """Let `seconds` of wall-clock time pass since the worker last heartbeated."""
    age = timedelta(seconds=seconds)
    with sessions() as session:
        lease = session.scalar(
            select(ComputeLeaseRecord).where(ComputeLeaseRecord.job_id == job_id)
        )
        execution = session.get(ComputeExecutionRecord, lease.execution_id)
        lease.heartbeat_at = _as_utc(lease.heartbeat_at) - age
        lease.heartbeat_deadline_at = _as_utc(lease.heartbeat_deadline_at) - age
        execution.heartbeat_at = _as_utc(execution.heartbeat_at) - age
        session.commit()


def _lease_view(sessions, job_id: str) -> dict[str, object]:
    with sessions() as session:
        lease = session.scalar(
            select(ComputeLeaseRecord).where(ComputeLeaseRecord.job_id == job_id)
        )
        execution = session.get(ComputeExecutionRecord, lease.execution_id)
        return {
            "lease": lease.state,
            "execution": execution.state,
            "job": session.get(ComputeJobRecord, job_id).state,
            "heartbeat_at": _as_utc(lease.heartbeat_at),
            "deadline_at": _as_utc(lease.heartbeat_deadline_at),
            "execution_heartbeat_at": _as_utc(execution.heartbeat_at),
        }


def _crashed_result() -> ExecutionResult:
    return ExecutionResult(
        exit_code=1,
        timed_out=False,
        stdout=b"",
        stderr=b"",
        engine_log=b"",
        result_document=None,
    )


def _process_one(sessions, settings):
    identity = Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id)
    with sessions() as session:
        return process_next_compute_job(
            session, identity, get_object_store_for_settings(settings), settings
        )


def test_a_long_running_job_keeps_its_lease_alive_and_is_not_requeued(api, monkeypatch) -> None:
    """Without heartbeats a 60 s lease lapses mid-run and another worker's sweep requeues it."""
    client, sessions, settings = api
    _project, detail = _queued_energy_job(client, monkeypatch, "lease-heartbeat")
    job_id = detail["compute_job"]["id"]
    observed: list[tuple[dict[str, object], int]] = []

    class LongRunningProvider:
        def __init__(self, _settings) -> None:
            pass

        def execute(self, *, on_tick=None, **_kwargs) -> ExecutionResult:
            assert on_tick is not None
            for _ in range(4):  # four simulated minutes in 55 s strides, one tick per stride
                _age_lease(sessions, job_id, seconds=55)
                on_tick()
                with sessions() as other:  # another worker starting up sweeps expired leases
                    requeued = recover_expired_compute_leases(other)
                observed.append((_lease_view(sessions, job_id), requeued))
            return _crashed_result()

    monkeypatch.setattr("chemdft_api.calculation_actions.LocalComputeProvider", LongRunningProvider)
    _process_one(sessions, settings)

    assert len(observed) == 4
    for view, requeued in observed:
        assert requeued == 0
        assert (view["lease"], view["execution"], view["job"]) == ("ACTIVE", "RUNNING", "RUNNING")
        now = utc_now()
        # each tick opens a fresh heartbeat window on the lease and on the execution
        assert view["heartbeat_at"] > now - timedelta(seconds=10)
        assert view["execution_heartbeat_at"] > now - timedelta(seconds=10)
        assert view["deadline_at"] > now + timedelta(seconds=45)
    with sessions() as session:
        executions = session.scalars(
            select(ComputeExecutionRecord).where(ComputeExecutionRecord.job_id == job_id)
        ).all()
    assert len(executions) == 1  # no duplicate execution was started


def test_cancel_of_a_long_running_job_waits_for_its_worker(api, monkeypatch) -> None:
    """A healthy worker beating its lease keeps its job live, so cancel does not finalize it."""
    client, sessions, settings = api
    project, detail = _queued_energy_job(client, monkeypatch, "cancel-heartbeat")
    job_id = detail["compute_job"]["id"]
    requested: list[dict] = []

    class LongRunningProvider:
        def __init__(self, _settings) -> None:
            pass

        def execute(self, *, on_tick=None, **_kwargs) -> ExecutionResult:
            _age_lease(sessions, job_id, seconds=55)
            on_tick()
            # 110 s in: only the first beat kept the lease alive
            _age_lease(sessions, job_id, seconds=55)
            on_tick()
            _age_lease(sessions, job_id, seconds=55)
            requested.append(_cancel(client, project, detail))
            return _crashed_result()

    monkeypatch.setattr("chemdft_api.calculation_actions.LocalComputeProvider", LongRunningProvider)
    _process_one(sessions, settings)

    (response,) = requested
    assert response["compute_job"]["state"] == "CANCEL_REQUESTED"
    assert response["calculation"]["state"] == "RUNNING"


def test_a_heartbeat_does_not_revive_a_lease_another_worker_already_expired(
    api, monkeypatch
) -> None:
    client, sessions, settings = api
    _project, detail = _queued_energy_job(client, monkeypatch, "lease-not-revived")
    job_id = detail["compute_job"]["id"]
    observed: list[tuple[int, dict[str, object]]] = []

    class StalledProvider:
        def __init__(self, _settings) -> None:
            pass

        def execute(self, *, on_tick=None, **_kwargs) -> ExecutionResult:
            _age_lease(sessions, job_id, seconds=600)  # the worker stalled; the sweep took over
            with sessions() as other:
                requeued = recover_expired_compute_leases(other)
            on_tick()  # the stalled worker wakes up and beats late
            observed.append((requeued, _lease_view(sessions, job_id)))
            return _crashed_result()

    monkeypatch.setattr("chemdft_api.calculation_actions.LocalComputeProvider", StalledProvider)
    _process_one(sessions, settings)

    ((requeued, view),) = observed
    assert requeued == 1
    assert (view["lease"], view["execution"], view["job"]) == ("EXPIRED", "LOST", "READY")


def test_a_failing_heartbeat_never_disturbs_the_run(api, monkeypatch) -> None:
    client, sessions, settings = api
    _queued_energy_job(client, monkeypatch, "heartbeat-failure")
    ticks: list[int] = []

    def locked(*_args, **_kwargs):
        raise OperationalError("UPDATE compute_leases", {}, Exception("database is locked"))

    class TickingProvider:
        def __init__(self, _settings) -> None:
            pass

        def execute(self, *, on_tick=None, **_kwargs) -> ExecutionResult:
            on_tick()  # must not raise
            ticks.append(1)
            return _crashed_result()

    monkeypatch.setattr("chemdft_api.calculation_actions.heartbeat_compute_execution", locked)
    monkeypatch.setattr("chemdft_api.calculation_actions.LocalComputeProvider", TickingProvider)
    finished = _process_one(sessions, settings)

    assert ticks == [1]
    assert finished is not None  # the session survived the failed beat and the job was finished
    assert finished.calculation.state == "FAILED"


def test_local_provider_ticks_several_times_per_heartbeat_window(monkeypatch) -> None:
    seen: dict[str, object] = {}

    class RecordingRunner:
        def execute(self, _request, **kwargs) -> ExecutionResult:
            seen.update(kwargs)
            return _crashed_result()

    monkeypatch.setattr("chemdft_api.compute_gateway.LocalSubprocessRunner", RecordingRunner)
    for heartbeat_seconds in (5, 60, 3600):
        settings = Settings(compute_heartbeat_seconds=heartbeat_seconds)

        def tick() -> None:
            pass

        LocalComputeProvider(settings).execute(
            calculation_id="c", normalized_input=b"{}", engine="pyscf", on_tick=tick
        )

        assert seen["on_tick"] is tick
        assert 1.0 <= seen["tick_interval_seconds"] <= heartbeat_seconds / 3


def _sleepy_worker(tmp_path: Path, seconds: float) -> LocalSubprocessRequest:
    script = tmp_path / "sleepy_worker.py"
    script.write_text(
        textwrap.dedent(
            f"""
            import json, sys, time
            result = sys.argv[sys.argv.index("--result") + 1]
            time.sleep({seconds})
            open(result, "w").write(json.dumps({{"ok": True}}))
            """
        )
    )
    return LocalSubprocessRequest(
        calculation_id="sleepy",
        normalized_input=b"{}",
        interpreter=Path(sys.executable),
        worker_script=script,
        timeout_seconds=60,
        max_output_bytes=1024,
        threads=1,
    )


def test_runner_ticks_at_the_interval_and_survives_a_failing_tick(tmp_path) -> None:
    request = _sleepy_worker(tmp_path, 1.5)
    ticks: list[float] = []

    def tick() -> None:
        ticks.append(len(ticks))
        if len(ticks) == 1:
            raise RuntimeError("heartbeat failed")

    result = LocalSubprocessRunner().execute(request, on_tick=tick, tick_interval_seconds=0.3)

    assert len(ticks) >= 2  # kept ticking after the failing first call
    assert len(ticks) <= 6  # rate-limited, not once per 0.2 s poll
    assert (result.exit_code, result.timed_out) == (0, False)
    assert result.result_document == json.loads('{"ok": true}')

    quiet: list[int] = []
    LocalSubprocessRunner().execute(
        _sleepy_worker(tmp_path, 0.6), on_tick=lambda: quiet.append(1), tick_interval_seconds=30
    )
    assert quiet == []  # no tick before the first interval has elapsed
