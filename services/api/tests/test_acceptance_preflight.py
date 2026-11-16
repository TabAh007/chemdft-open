"""Offline acceptance guards: disposable SQL and non-scientific subprocesses only."""

import contextlib
import hashlib
import importlib.util
import json
import os
import signal
import sqlite3
import sys
import time
from pathlib import Path
from uuid import uuid4

import pytest
from chemdft_api.scientific.engines.interfaces import LocalSubprocessRequest
from chemdft_api.scientific.engines.runner import LocalSubprocessRunner
from chemdft_api.test_environment import TestEnvironmentError as StorageError


@pytest.fixture
def isolated_runner():
    path = Path(__file__).resolve().parents[3] / "tools/run_isolated_e2e.py"
    spec = importlib.util.spec_from_file_location("preflight_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_disposable_alembic_initialization_and_existing_database_refusal(isolated_runner, tmp_path):
    database = tmp_path / "data/test.db"
    database.parent.mkdir()
    env = {
        **isolated_runner.offline_environment(os.environ),
        "PYTHONDONTWRITEBYTECODE": "1",
        "CHEMDFT_TEST_MODE": "1",
        "CHEMDFT_ENVIRONMENT": "test",
        "CHEMDFT_TEST_WORKSPACE": str(tmp_path),
        "CHEMDFT_DATABASE_URL": f"sqlite:///{database}",
        "CHEMDFT_OBJECT_ROOT": str(tmp_path / "objects"),
        "CHEMDFT_AUTO_CREATE_SCHEMA": "false",
        "CHEMDFT_AUTH_MODE": "dev",
        "CHEMDFT_DEV_IDENTITY_ENABLED": "true",
        "CHEMDFT_DEV_USER_ID": str(uuid4()),
        "CHEMDFT_DEV_ORGANIZATION_ID": str(uuid4()),
        "CHEMDFT_AI_PROVIDER": "fake",
        "CHEMDFT_RUN_AI_INTEGRATION": "false",
    }
    isolated_runner.initialize_database(env, database)
    before = hashlib.sha256(database.read_bytes()).hexdigest()
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0030_beta_readiness"
        )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM users WHERE id=?", (env["CHEMDFT_DEV_USER_ID"],)
            ).fetchone()[0]
            == 1
        )
        columns = {row[1]: row for row in conn.execute("PRAGMA table_info(ai_model_invocations)")}
        assert columns["input_tokens"][3] == 0 and columns["usage_status"][3] == 1
    with pytest.raises(StorageError, match="TEST_DATABASE_EXISTS"):
        isolated_runner.initialize_database(env, database)
    assert hashlib.sha256(database.read_bytes()).hexdigest() == before


def test_web_copy_has_shared_dependencies_and_does_not_overwrite_sources(
    isolated_runner, monkeypatch, tmp_path
):
    original = tmp_path / "original"
    web = original / "apps/web"
    (web / "src").mkdir(parents=True)
    (web / "node_modules").mkdir()
    (original / "node_modules").mkdir()
    (web / ".next").mkdir()
    (web / ".next/cache").write_text("exclude cache")
    (web / ".env.local").write_text("exclude private configuration")
    (web / "src/component.tsx").write_text("supplied working source")
    (web / "next-env.d.ts").write_text("original generated declaration")
    (original / "tsconfig.base.json").write_text("{}")
    monkeypatch.setattr(isolated_runner, "ROOT", original)
    copy = isolated_runner.prepare_web_workspace(tmp_path / "disposable")
    (copy / "next-env.d.ts").write_text("Next may change its own disposable copy")
    assert (web / "next-env.d.ts").read_text() == "original generated declaration"
    assert (copy / "src/component.tsx").read_text() == "supplied working source"
    assert not (copy / ".env.local").exists() and not (copy / ".next").exists()
    assert (copy / "node_modules").is_symlink()
    assert isolated_runner.workspace_bytes(tmp_path / "disposable") < 1024


def _consent_database(tmp_path, *, status="PENDING", charge=0, tamper=False, jobs=0):
    database = tmp_path / "consent.db"
    args = {
        "structure_version": {
            "entity_type": "structure.version",
            "entity_id": "version",
            "project_id": "project",
        },
        "specification": {
            "task_type": "ENERGY",
            "charge": charge,
            "multiplicity": 1,
            "method": {"identifier": "hf"},
            "basis": {"identifier": "sto-3g"},
            "engine_preference": {"engine": "pyscf"},
        },
    }
    fingerprint = hashlib.sha256(
        json.dumps(args, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    ready = {
        "approval_id": "approval",
        "run_id": "run",
        "project_id": "project",
        "structure_version_id": "version",
        "action_fingerprint": fingerprint,
    }
    with sqlite3.connect(database) as conn:
        conn.executescript(
            "CREATE TABLE ai_approvals(id, status, project_id, run_id, actor_id, "
            "action_fingerprint, normalized_arguments_json);"
            "CREATE TABLE ai_runs(id, status, waiting_calculation_id);"
            "CREATE TABLE compute_jobs(project_id, calculation_id, state);"
        )
        conn.execute(
            "INSERT INTO ai_approvals VALUES (?,?,?,?,?,?,?)",
            (
                "approval",
                status,
                "project",
                "run",
                "researcher",
                "changed" if tamper else fingerprint,
                json.dumps(args),
            ),
        )
        conn.execute(
            "INSERT INTO ai_runs VALUES (?,?,?)", ("run", "WAITING_FOR_CALCULATION", "calc")
        )
        for index in range(jobs):
            conn.execute(
                "INSERT INTO compute_jobs VALUES (?,?,?)",
                ("project", "calc" if index == 0 else "extra", "READY"),
            )
    return database, ready


def test_compute_cannot_start_without_personal_approval(isolated_runner, tmp_path):
    database, ready = _consent_database(tmp_path)
    assert not isolated_runner.manual_worker_authorized(database, ready, "researcher")


def test_exact_approved_job_is_the_only_worker_authorization(isolated_runner, tmp_path):
    database, ready = _consent_database(tmp_path, status="APPROVED", jobs=1)
    before = database.read_bytes()
    assert isolated_runner.manual_worker_authorized(database, ready, "researcher")
    assert database.read_bytes() == before  # consent observer cannot mutate approval


@pytest.mark.parametrize("case", ["rejected", "charge", "fingerprint", "actor", "queue"])
def test_manual_consent_refuses_mismatches(isolated_runner, tmp_path, case):
    database, ready = _consent_database(
        tmp_path,
        status="REJECTED" if case == "rejected" else "APPROVED",
        charge=1 if case == "charge" else 0,
        tamper=case == "fingerprint",
        jobs=2 if case == "queue" else 1,
    )
    with pytest.raises(StorageError):
        isolated_runner.manual_worker_authorized(
            database, ready, "stranger" if case == "actor" else "researcher"
        )


def test_live_profile_requires_explicit_resource_acceptance_before_startup(
    isolated_runner, monkeypatch
):
    monkeypatch.setattr(sys, "argv", ["isolated_runner", "--suite", "as-c1-nvidia"])
    monkeypatch.setattr(
        isolated_runner.tempfile,
        "mkdtemp",
        lambda **kw: pytest.fail("created workspace before acceptance"),
    )
    with pytest.raises(StorageError, match="TEST_RESOURCE_ACCEPTANCE_REQUIRED"):
        isolated_runner.main()


def test_live_flow_has_no_automated_researcher_decision(isolated_runner):
    source = (
        isolated_runner.ROOT / "apps/web/tests/e2e/as-c1-nvidia-acceptance.spec.ts"
    ).read_text()
    assert 'getByTestId("ai-approve-button").click' not in source
    assert 'decision: "APPROVE"' not in source
    assert "manual-approval-ready.json" in source
    assert 'toBe("WAITING_FOR_APPROVAL")' in source
    assert 'toBe("disabled")' in source


def test_one_shot_worker_command_is_valid_without_running_it(isolated_runner):
    command = isolated_runner.manual_worker_command()
    compile(command[-1], "offline-worker-command", "exec")


@pytest.mark.parametrize("options", [["--", "--repeat-each=2"], ["--smoke"], ["--no-worker"]])
def test_live_profile_refuses_repetition_or_worker_overrides(isolated_runner, monkeypatch, options):
    monkeypatch.setattr(sys, "argv", ["runner", "--suite", "as-c1-nvidia", *options])
    with pytest.raises(StorageError, match="TEST_MANUAL_OPTIONS"):
        isolated_runner.main()


@pytest.mark.parametrize("wait", [False, True])
def test_scratch_watchdog_rejects_oversize_worker_output_even_after_fast_exit(tmp_path, wait):
    script = tmp_path / "non_scientific_worker.py"
    script.write_text(
        "from pathlib import Path\nimport sys, time\n"
        "Path('scratch.bin').write_bytes(b'x'*4096)\n"
        "print('diagnostic '*1000, flush=True)\n"
        "Path(sys.argv[sys.argv.index('--result')+1]).write_text('{\"ok\":true}')\n"
        + ("time.sleep(10)\n" if wait else "")
    )
    request = LocalSubprocessRequest(
        calculation_id="offline-process-guard",
        normalized_input=b"{}",
        interpreter=Path(sys.executable),
        worker_script=script,
        timeout_seconds=3,
        threads=1,
        max_output_bytes=64,
        max_scratch_bytes=128,
    )
    result = LocalSubprocessRunner().execute(request)
    assert result.exit_code != 0 and result.result_document is None
    assert result.failure_code == "SCRATCH_LIMIT_EXCEEDED"
    assert len(result.stdout) <= 64


def test_zero_scratch_allocation_prevents_dispatch(tmp_path, monkeypatch):
    from chemdft_api.scientific.engines import runner as subprocess_runner

    monkeypatch.setattr(
        subprocess_runner.subprocess, "Popen", lambda *a, **k: pytest.fail("worker started")
    )
    result = LocalSubprocessRunner().execute(
        LocalSubprocessRequest(
            calculation_id="zero",
            normalized_input=b"{}",
            interpreter=Path(sys.executable),
            worker_script=tmp_path / "unused.py",
            timeout_seconds=1,
            threads=1,
            max_output_bytes=64,
            max_scratch_bytes=0,
        )
    )
    assert result.failure_code == "SCRATCH_LIMIT_EXCEEDED"


def test_native_tempfiles_stay_in_job_scratch_without_inheriting_credentials(tmp_path, monkeypatch):
    monkeypatch.setenv("CHEMDFT_AI_API_KEY", "offline-redaction-test-marker")
    script = tmp_path / "environment_worker.py"
    script.write_text(
        "import json, os, sys, tempfile\nfrom pathlib import Path\n"
        "info={'scratch':str(Path.cwd()), 'temp':tempfile.gettempdir(), "
        "'pyscf_temp':os.environ['PYSCF_TMPDIR'], "
        "'key_present':'CHEMDFT_AI_API_KEY' in os.environ}\n"
        "Path(sys.argv[sys.argv.index('--result')+1]).write_text(json.dumps(info))\n"
    )
    result = LocalSubprocessRunner().execute(
        LocalSubprocessRequest(
            calculation_id="temp-environment",
            normalized_input=b"{}",
            interpreter=Path(sys.executable),
            worker_script=script,
            timeout_seconds=3,
            threads=1,
            max_output_bytes=1024,
            max_scratch_bytes=4096,
        )
    )
    assert result.exit_code == 0
    info = result.result_document
    assert info["scratch"] == info["temp"] == info["pyscf_temp"]
    assert info["key_present"] is False


def test_interrupted_runner_stops_its_non_scientific_child_group(tmp_path):
    pid_path = tmp_path / "child.pid"
    heartbeat = tmp_path / "child-heartbeat"
    child_code = (
        "import time\nfrom pathlib import Path\n"
        f"path=Path({str(heartbeat)!r})\n"
        "end=time.monotonic()+10\n"
        "while time.monotonic()<end:\n"
        " with path.open('a') as stream: stream.write('tick\\n')\n"
        " time.sleep(0.02)\n"
    )
    script = tmp_path / "interrupted_worker.py"
    script.write_text(
        "import json, subprocess, sys, time\nfrom pathlib import Path\n"
        f"child=subprocess.Popen([sys.executable,'-c',{child_code!r}])\n"
        f"Path({str(pid_path)!r}).write_text(str(child.pid))\n"
        f"while not Path({str(heartbeat)!r}).exists(): time.sleep(0.01)\n"
        "Path(sys.argv[sys.argv.index('--steps')+1]).write_text('{}\\n')\n"
        "time.sleep(10)\n"
    )
    request = LocalSubprocessRequest(
        calculation_id="interrupt-control",
        normalized_input=b"{}",
        interpreter=Path(sys.executable),
        worker_script=script,
        timeout_seconds=3,
        threads=1,
        max_output_bytes=1024,
        max_scratch_bytes=4096,
    )
    try:
        with pytest.raises(KeyboardInterrupt):
            LocalSubprocessRunner().execute(
                request, on_step=lambda _: (_ for _ in ()).throw(KeyboardInterrupt())
            )
        # Observe execution directly: sandboxed macOS cannot exec the privileged ps utility.
        # A dead/zombie child emits no ticks; an un-killed child keeps emitting every 20 ms.
        stopped = heartbeat.read_bytes()
        assert stopped
        time.sleep(0.25)
        assert heartbeat.read_bytes() == stopped
    finally:
        if pid_path.exists():
            with contextlib.suppress(ProcessLookupError):
                os.kill(int(pid_path.read_text()), signal.SIGKILL)
