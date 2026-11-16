"""Focused Gate B.1 checks; native outputs are disposable and never rewrite Gate B."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import replace
from pathlib import Path

import pytest
from chemdft_api import calculation_actions as actions
from chemdft_api.compute_gateway import LocalComputeProvider
from chemdft_api.contracts.conformers import ConformerEnsembleManifest
from chemdft_api.errors import UploadTooLarge
from chemdft_api.scientific.engines.crest import command, xyz_input
from chemdft_api.scientific_models import (
    CalculationResultRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeLeaseRecord,
    ComputeReservationRecord,
    ScientificArtifactRecord,
)
from sqlalchemy import func, select
from test_crest_integration import CREST, ROOT, native_input, submit
from test_xtb_optimization import run_job


@pytest.fixture(scope="module", autouse=True)
def sealed_evidence_is_read_only():
    snapshots = {}
    for root in (
        Path("/private/tmp/chemdft-pf8c-gate-a-3kazxwpy"),
        Path("/private/tmp/chemdft-pf8c-gate-a1-dk6614q5"),
        ROOT / ".chemdft/pf8c-gate-b",
    ):
        manifest = root / "evidence-manifest.json"
        if not manifest.is_file():
            continue
        snapshots[manifest] = hashlib.sha256(manifest.read_bytes()).hexdigest()
        for record in json.loads(manifest.read_text()):
            path = root / record["path"]
            if "sha256" in record:
                snapshots[path] = hashlib.sha256(path.read_bytes()).hexdigest()
                assert snapshots[path] == record["sha256"]
    yield
    for path, digest in snapshots.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, path


def wait_for(check, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError("Timed out waiting for owned test process/state")


def processes():
    text = subprocess.check_output(["ps", "-axo", "pid=,ppid=,pgid=,stat=,command="], text=True)
    return [line.strip().split(None, 4) for line in text.splitlines() if line.strip()]


def active_group(pgid):
    return [r for r in processes() if int(r[2]) == pgid and not r[3].startswith("Z")]


def assert_settled(api, calculation_id, failure_code):
    with api[1]() as session:
        execution = session.scalar(
            select(ComputeExecutionRecord).where(
                ComputeExecutionRecord.calculation_id == calculation_id
            )
        )
        job = session.get(ComputeJobRecord, execution.job_id)
        assert execution.state == job.state == "FAILED"
        assert execution.failure_code == failure_code
        assert session.scalar(select(func.count()).select_from(CalculationResultRecord)) == 0
        assert not session.scalars(
            select(ComputeLeaseRecord).where(ComputeLeaseRecord.state == "ACTIVE")
        ).all()
        assert session.get(ComputeReservationRecord, job.reservation_id).state == "RELEASED"
        return execution


@pytest.mark.scientific_integration  # starts the real CREST worker: opt-in only
@pytest.mark.parametrize("signum", [signal.SIGTERM, signal.SIGINT, signal.SIGHUP])
def test_real_worker_signal_cleans_owned_native_and_preserves_unrelated(api, tmp_path, signum):
    _client, _sessions, settings = api
    _project, _version, queued, _ = submit(api, name="butane")
    unrelated_root = tmp_path / "unrelated-native"
    unrelated_root.mkdir()
    document = native_input("butane")
    (unrelated_root / "input.xyz").write_bytes(xyz_input(document))
    unrelated_env = {
        **os.environ,
        "OMP_NUM_THREADS": "2",
        "OMP_THREAD_LIMIT": "2",
        "OPENBLAS_NUM_THREADS": "1",
        "VECLIB_MAXIMUM_THREADS": "1",
    }
    unrelated = subprocess.Popen(
        command(CREST, document),
        cwd=unrelated_root,
        env=unrelated_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    env = {
        **os.environ,
        "CHEMDFT_DATABASE_URL": settings.database_url,
        "CHEMDFT_OBJECT_ROOT": str(settings.object_root),
        "CHEMDFT_TEST_WORKSPACE": str(settings.object_root.parent),
        "CHEMDFT_AUTO_CREATE_SCHEMA": "true",
        "CHEMDFT_COMPUTE_WORKER_ONCE": "1",
        "CHEMDFT_CREST_LOCK_PATH": str(tmp_path / "owned-native.lock"),
    }
    with (tmp_path / "worker.log").open("wb") as log:
        worker = subprocess.Popen(
            [sys.executable, "-m", "chemdft_api.compute_worker"],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
        owned = None
        try:
            owned = wait_for(
                lambda: next(
                    (
                        int(r[0])
                        for r in processes()
                        if int(r[1]) == worker.pid and str(CREST) in r[4]
                    ),
                    None,
                )
            )
            pgid = os.getpgid(owned)
            assert pgid == owned and pgid != unrelated.pid
            worker.send_signal(signum)
            assert worker.wait(timeout=12) == 128 + signum
            assert not active_group(pgid)
            assert unrelated.poll() is None
            execution = assert_settled(api, queued["calculation"]["id"], "WORKER_LOST")
            assert execution.worker_id == execution.lease_owner == "local.crest.worker"
            with api[1]() as session:
                artifact = next(
                    session.get(ScientificArtifactRecord, r["artifact_id"])
                    for r in execution.raw_artifacts_json
                    if session.get(ScientificArtifactRecord, r["artifact_id"]).format_identifier
                    == "crest.native.execution.json"
                )
                status = json.loads((settings.object_root / artifact.storage_key).read_bytes())
                assert status["termination_reason"] == f"worker shutdown: {signum.name}"
                assert status["process_group_cleanup"] is True
            # The worker's lock becomes available only after its bounded cleanup/persistence.
            with (tmp_path / "owned-native.lock").open("a+b") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            if worker.poll() is None:
                worker.kill()
                worker.wait(timeout=5)
            if owned is not None and active_group(owned):
                os.killpg(owned, signal.SIGKILL)
            if unrelated.poll() is None:
                os.killpg(unrelated.pid, signal.SIGKILL)
            unrelated.wait(timeout=5)


@pytest.mark.scientific_integration  # drives the real CREST binary through a worker: opt-in only
def test_shutdown_escalation_keeps_lock_until_owned_descendants_exit(api, tmp_path):
    """A controlled process tree forces escalation; no scientific results are fabricated."""
    _, _, settings = api
    _, _, queued, _ = submit(api, name="butane")
    identities = tmp_path / "owned-pids.json"
    helper = tmp_path / "process_tree.py"
    helper.write_text(
        "import subprocess,signal,time,os,json,sys\n"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
        "native=subprocess.Popen(sys.argv[2:])\n"
        "child=subprocess.Popen([sys.executable,'-c',"
        "'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)'])\n"
        "open(sys.argv[1],'w').write(json.dumps({'pgid':os.getpid(),"
        "'native':native.pid,'child':child.pid}))\n"
        "time.sleep(60)\n"
    )
    script = tmp_path / "worker.py"
    script.write_text(
        "import subprocess,sys\n"
        "from chemdft_api.scientific.engines import crest\n"
        "real_popen=subprocess.Popen\n"
        "def owned_tree(argv,**kwargs):\n"
        f" if argv[0]=={str(CREST)!r}:\n"
        f"  argv=[sys.executable,{str(helper)!r},{str(identities)!r},*argv]\n"
        " return real_popen(argv,**kwargs)\n"
        "crest.subprocess.Popen=owned_tree\n"
        "from chemdft_api.compute_worker import run\n"
        "run()\n"
    )
    lock_path = tmp_path / "owned-native.lock"
    env = {
        **os.environ,
        "CHEMDFT_DATABASE_URL": settings.database_url,
        "CHEMDFT_OBJECT_ROOT": str(settings.object_root),
        "CHEMDFT_TEST_WORKSPACE": str(settings.object_root.parent),
        "CHEMDFT_AUTO_CREATE_SCHEMA": "true",
        "CHEMDFT_COMPUTE_WORKER_ONCE": "1",
        "CHEMDFT_CREST_LOCK_PATH": str(lock_path),
    }
    with (tmp_path / "worker.log").open("wb") as log:
        worker = subprocess.Popen(
            [sys.executable, str(script)],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=log,
        )
        pids = None
        try:
            wait_for(identities.is_file)
            pids = json.loads(identities.read_text())
            assert os.getpgid(pids["native"]) == os.getpgid(pids["child"]) == pids["pgid"]
            worker.send_signal(signal.SIGTERM)
            time.sleep(0.3)
            assert worker.poll() is None
            with lock_path.open("a+b") as lock, pytest.raises(BlockingIOError):
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with api[1]() as session:
                assert session.scalar(select(ComputeLeaseRecord)).state == "ACTIVE"
            assert worker.wait(timeout=12) == 128 + signal.SIGTERM
            assert not active_group(pids["pgid"])
            assert_settled(api, queued["calculation"]["id"], "WORKER_LOST")
        finally:
            if worker.poll() is None:
                worker.kill()
                worker.wait(timeout=5)
            if pids and active_group(pids["pgid"]):
                os.killpg(pids["pgid"], signal.SIGKILL)


def queue_energy(api, project, version):
    request = {
        "structure_version": {
            "project_id": project,
            "entity_type": "structure.version",
            "entity_id": version["id"],
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {
                "identifier": "gfn2",
                "display_name": "GFN2-xTB",
                "registry": "chemdft.method",
            },
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "xtb", "allowed_version": "6.7.1"},
        },
        "idempotency_key": "b1-eligible-xtb",
    }
    response = api[0].post(f"/v1/projects/{project}/calculations", json=request)
    assert response.status_code == 201, response.text
    return response.json()


def test_busy_crest_slot_does_not_starve_other_engine(api, tmp_path):
    project, version, crest_job, _ = submit(api)
    xtb_job = queue_energy(api, project, version)
    settings = api[2]
    settings.crest_lock_path = tmp_path / "crest.lock"
    with settings.crest_lock_path.open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        detail = run_job(api)
    assert str(detail.calculation.id) == xtb_job["calculation"]["id"]
    assert detail.calculation.state == "SUCCEEDED"
    assert detail.compute_execution.worker_id != "local.crest.worker"
    with api[1]() as session:
        assert session.get(ComputeJobRecord, crest_job["compute_job"]["id"]).state == "READY"
    assert run_job(api).calculation.state == "SUCCEEDED"


@pytest.mark.parametrize("selected", ["crest", "xtb"])
def test_selected_job_identity_survives_queue_reordering(api, monkeypatch, selected):
    project, version, crest_job, _ = submit(api)
    xtb_job = queue_energy(api, project, version)
    target = crest_job if selected == "crest" else xtb_job
    other = xtb_job if selected == "crest" else crest_job
    with api[1]() as session:
        session.get(ComputeJobRecord, target["compute_job"]["id"]).priority = 100
        session.commit()
    claim = actions._process_next_compute_job

    def reorder(session, *args, job_id, **kwargs):
        assert job_id == target["compute_job"]["id"]
        session.get(ComputeJobRecord, other["compute_job"]["id"]).priority = 200
        session.commit()
        return claim(session, *args, job_id=job_id, **kwargs)

    monkeypatch.setattr(actions, "_process_next_compute_job", reorder)
    detail = run_job(api)
    assert str(detail.calculation.id) == target["calculation"]["id"]
    assert detail.calculation.state == "SUCCEEDED"
    assert (detail.compute_execution.worker_id == "local.crest.worker") == (selected == "crest")
    with api[1]() as session:
        assert session.get(ComputeJobRecord, other["compute_job"]["id"]).state == "READY"


@pytest.mark.parametrize("oversized", ["native", "log", "worker_json", "manifest", "environment"])
def test_oversized_publication_fails_and_settles_atomically(api, monkeypatch, oversized):
    _, _, queued, _ = submit(api)
    original = LocalComputeProvider.execute

    def output(self, **kwargs):
        result = original(self, **kwargs)
        if oversized == "native":
            return replace(
                result,
                native_artifacts={
                    **result.native_artifacts,
                    "oversized.bin": b"x" * (api[2].crest_max_output_bytes + 1),
                },
            )
        if oversized == "log":
            return replace(result, engine_log=b"x" * (api[2].scientific_max_output_bytes + 1))
        if oversized == "worker_json":
            return replace(
                result,
                result_document={
                    **result.result_document,
                    "oversized": "x" * (api[2].scientific_max_output_bytes + 1),
                },
            )
        return result

    monkeypatch.setattr(LocalComputeProvider, "execute", output)
    store = actions._store_artifact

    def reject_metadata(*args, **kwargs):
        if kwargs["format_identifier"] == {
            "manifest": "chemdft.conformer-ensemble-manifest",
            "environment": "chemdft.environment_manifest",
        }.get(oversized):
            raise UploadTooLarge("Injected configured metadata size boundary")
        return store(*args, **kwargs)

    monkeypatch.setattr(actions, "_store_artifact", reject_metadata)
    detail = run_job(api)
    assert detail.result is None
    assert detail.attempt.failure_code == "RESOURCE_LIMIT_EXCEEDED"
    assert detail.attempt.raw_artifacts
    execution = assert_settled(api, queued["calculation"]["id"], "ARTIFACT_TRANSFER_FAILED")
    assert execution.raw_artifacts_json
    with api[1]() as session:
        assert not session.scalars(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.format_identifier == "chemdft.conformer-ensemble-manifest"
            )
        ).all()
        assert all(
            session.get(ScientificArtifactRecord, r["artifact_id"]).size_bytes
            <= api[2].crest_max_output_bytes
            for r in execution.raw_artifacts_json
        )


def test_member_qualification_preserves_native_science_and_legacy_records():
    saved = json.loads(
        (
            ROOT / ".chemdft/pf8c-gate-b/native-acceptance/butane-three-member-run/manifest.json"
        ).read_text()
    )
    manifest = ConformerEnsembleManifest.model_validate(saved)
    assert len(manifest.members) == 3
    for old, member in zip(saved["members"], manifest.members, strict=True):
        assert member.minimum_status == "UNVERIFIED"
        assert member.geometry_convergence == "NATIVE_GRADIENT_CONVERGED"
        assert member.native_electronic_energy.value == old["native_electronic_energy"]["value"]
        assert member.native_rank == old["native_rank"]
        with pytest.raises(ValueError):
            type(member).model_validate({**member.model_dump(), "minimum_status": "VERIFIED"})


def test_crest_private_dispatch_cannot_bypass_resource_lock(api):
    from chemdft_api.context import Identity
    from chemdft_api.storage import LocalObjectStore

    _, _, queued, _ = submit(api)
    settings = api[2]
    with api[1]() as session, pytest.raises(RuntimeError, match="resource lock"):
        actions._process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
            job_id=queued["compute_job"]["id"],
            worker_id="misrouted-worker",
        )


@pytest.mark.parametrize("stage", ["after_native", "after_firewall"])
def test_shutdown_before_publication_never_accepts_late_result(api, monkeypatch, stage):
    _, _, queued, _ = submit(api)
    previous = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    if stage == "after_native":
        execute = LocalComputeProvider.execute

        def interrupt(self, **kwargs):
            result = execute(self, **kwargs)
            os.kill(os.getpid(), signal.SIGTERM)
            return result

        monkeypatch.setattr(LocalComputeProvider, "execute", interrupt)
    else:
        accept = actions.accept_authoritative_result

        def interrupt(*args, **kwargs):
            result = accept(*args, **kwargs)
            os.kill(os.getpid(), signal.SIGTERM)
            return result

        monkeypatch.setattr(actions, "accept_authoritative_result", interrupt)
    with pytest.raises(SystemExit) as exit_info:
        run_job(api)
    assert exit_info.value.code == 128 + signal.SIGTERM
    assert_settled(api, queued["calculation"]["id"], "WORKER_LOST")
    assert {s: signal.getsignal(s) for s in previous} == previous
    with api[1]() as session:
        assert not session.scalars(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.format_identifier == "chemdft.conformer-ensemble-manifest"
            )
        ).all()


def test_selected_job_claim_lost_does_not_dispatch_different_job(api, monkeypatch):
    project, version, selected, _ = submit(api)
    other = queue_energy(api, project, version)
    claim = actions._process_next_compute_job

    def competing_claim(session, *args, job_id, **kwargs):
        assert job_id == selected["compute_job"]["id"]
        session.get(ComputeJobRecord, job_id).state = "RUNNING"
        session.commit()
        return claim(session, *args, job_id=job_id, **kwargs)

    monkeypatch.setattr(actions, "_process_next_compute_job", competing_claim)
    assert run_job(api) is None
    with api[1]() as session:
        assert session.get(ComputeJobRecord, other["compute_job"]["id"]).state == "READY"
        assert not session.scalars(select(ComputeExecutionRecord)).all()
