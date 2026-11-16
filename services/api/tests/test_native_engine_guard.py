"""Ordinary pytest cannot start a native scientific engine; a launch needs full authorization.

Nested runs use a harmless fake `psi4` script that only appends a line to a marker file, so the
authorized path is proven without ever starting a real engine.
"""

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest
from live_ai_gate import (
    NATIVE_ENV,
    NATIVE_PHRASE,
    launches_native_engine,
    native_authorized,
)

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parents[2]


@pytest.mark.parametrize(
    "executable, argv, blocked",
    [
        ("/x/.chemdft/envs/psi4-1.11/bin/psi4", ["psi4", "input.json"], True),
        ("/opt/homebrew/bin/xtb", ["xtb", "mol.xyz"], True),
        ("/usr/local/bin/CREST", ["crest"], True),
        ("/x/.venv/bin/python", ["python", "/r/scientific/engines/pyscf_worker.py"], True),
        ("/x/.venv/bin/python", ["python", "/r/scientific/engines/xtb_worker.py", "--steps"], True),
        ("/x/.venv/bin/python", ["python", "-m", "chemdft_api.compute_worker"], True),
        (
            "/x/.venv/bin/python",
            ["python", "-c", "from chemdft_api.scientific.engines import crest"],
            True,
        ),
        ("/x/.venv/bin/python", ["python", "-B", "/x/.chemdft/envs/psi4/bin/psi4"], True),
        # the executable path alone (argv[0] renamed) is also recognised
        ("/x/.chemdft/envs/crest-3/bin/crest-wrapper", ["crest", "mol.xyz"], True),
        # capability probes (version/help only) are not calculations
        ("/x/.chemdft/envs/xtb/bin/xtb", ["/x/.chemdft/envs/xtb/bin/xtb", "--version"], False),
        ("/opt/homebrew/bin/crest", ["crest", "--version"], False),
        ("/x/.chemdft/envs/psi4/bin/psi4", ["psi4", "--help"], False),
        (
            "/opt/homebrew/bin/xtb",
            ["xtb", "--version", "mol.xyz"],
            True,
        ),  # extra argument: a launch
        # version probes, tools and ordinary processes are not engine launches
        ("/x/.venv/bin/python", ["python", "-c", "import pyscf; print(pyscf.__version__)"], False),
        ("/bin/echo", ["echo", "psi4"], False),
        ("/usr/bin/git", ["git", "status"], False),
        ("/x/.venv/bin/python", ["python", "-m", "pytest", "-q"], False),
    ],
)
def test_engine_launches_are_recognised_and_ordinary_processes_are_not(executable, argv, blocked):
    assert launches_native_engine(executable, argv) is blocked


def test_native_authorization_needs_marker_phrase_and_a_non_offline_environment():
    marker = "scientific_integration"
    assert native_authorized(marker, {NATIVE_ENV: NATIVE_PHRASE})
    assert native_authorized(f"benchmark or {marker}", {NATIVE_ENV: NATIVE_PHRASE})
    assert not native_authorized(None, {NATIVE_ENV: NATIVE_PHRASE})  # no marker selection
    assert not native_authorized(marker, {})  # no phrase
    assert not native_authorized(marker, {NATIVE_ENV: "yes"})  # wrong phrase
    assert not native_authorized(f"not {marker}", {NATIVE_ENV: NATIVE_PHRASE})
    assert not native_authorized(marker, {NATIVE_ENV: NATIVE_PHRASE, "CHEMDFT_E2E_OFFLINE": "1"})


PLUGIN = f"""
import sys
sys.path.insert(0, {str(TESTS)!r})
import pytest
import live_ai_gate


def pytest_configure(config):
    live_ai_gate.configure_native_guard(config)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    live_ai_gate.convert_blocked_report(item, outcome.get_result())


def pytest_collection_modifyitems(config, items):
    if live_ai_gate.native_authorized(config.option.markexpr):
        return
    for item in items:
        if item.get_closest_marker("scientific_integration"):
            item.add_marker(pytest.mark.skip(reason="gate"))
"""

CASES = """
import os, subprocess, sys
import pytest

FAKE, MARK = os.environ["FAKE_ENGINE"], os.environ["MARK_FILE"]


def test_unmarked_engine_binary():
    subprocess.run([FAKE], check=True)


@pytest.mark.scientific_integration
def test_marked_engine_binary():
    subprocess.run([FAKE], check=True)


def test_refusal_wrapped_like_an_asgi_task_group():
    try:
        subprocess.run([FAKE], check=True)
    except BaseException as error:  # surfaces as a failure with the refusal text, then teardown
        raise RuntimeError("unhandled errors in a TaskGroup: " + str(error)) from None


def test_worker_entry_point():
    code = "# compute_worker\\nopen(r'%s','a').write('worker')" % MARK
    subprocess.run([sys.executable, "-c", code])
"""


def nested(tmp_path, *args, extra_env=None):
    fake = tmp_path / "psi4"
    mark = tmp_path / "launched"
    fake.write_text(f"#!/bin/sh\necho ran >> {mark}\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    (tmp_path / "guard_plugin.py").write_text(PLUGIN)
    (tmp_path / "test_cases.py").write_text(CASES)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CHEMDFT", "PYTHONPATH"))}
    env.update(PYTHONPATH=str(tmp_path), FAKE_ENGINE=str(fake), MARK_FILE=str(mark))
    env.update(extra_env or {})
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            "-m",
            "pytest",
            "-p",
            "guard_plugin",
            "-p",
            "no:cacheprovider",
            "-W",
            "ignore",
            "-rs",
            "-q",
            "--rootdir",
            str(tmp_path),
            str(tmp_path / "test_cases.py"),
            *args,
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return result.stdout + result.stderr, mark.read_text() if mark.exists() else ""


def test_by_default_no_engine_binary_or_worker_is_ever_launched(tmp_path):
    output, launched = nested(tmp_path)
    assert launched == "", output  # the fake engine and the worker entry never ran
    assert "4 skipped" in output and "passed" not in output and "failed" not in output, output


def test_marker_selection_alone_is_not_authorization(tmp_path):
    output, launched = nested(tmp_path, "-m", "scientific_integration")
    assert launched == "" and "passed" not in output, output


def test_phrase_alone_does_not_unblock_unmarked_launches(tmp_path):
    output, launched = nested(tmp_path, extra_env={NATIVE_ENV: NATIVE_PHRASE})
    assert launched == "" and "passed" not in output, output


def test_offline_environment_overrides_every_authorization(tmp_path):
    output, launched = nested(
        tmp_path,
        "-m",
        "scientific_integration",
        extra_env={NATIVE_ENV: NATIVE_PHRASE, "CHEMDFT_E2E_OFFLINE": "1"},
    )
    assert launched == "" and "passed" not in output, output


def test_full_authorization_runs_only_the_selected_native_test(tmp_path):
    output, launched = nested(
        tmp_path, "-m", "scientific_integration", extra_env={NATIVE_ENV: NATIVE_PHRASE}
    )
    assert "1 passed" in output and "failed" not in output, output
    assert launched == "ran\n"  # exactly the one explicitly authorized fake launch


class _Item:
    def __init__(self, nodeid="tests/test_module.py::test_x"):
        self.nodeid, self.path, self.location = nodeid, Path(nodeid.split("::")[0]), ("f", 1, "x")


class _Report:
    def __init__(self, when, longrepr, failed=True):
        self.when, self.longrepr, self.failed, self.outcome = when, longrepr, failed, "initial"


def test_only_refusal_noise_is_converted_to_a_skip():
    from live_ai_gate import _guard, convert_blocked_report

    _guard["modules"].add("tests/test_module.py")
    try:
        direct = _Report("call", "RuntimeError: NATIVE_ENGINE_BLOCKED: wrapped")
        convert_blocked_report(_Item(), direct)
        assert direct.outcome == "skipped"
        unwind = _Report("setup", "concurrent.futures._base.CancelledError")
        convert_blocked_report(_Item(), unwind)
        assert unwind.outcome == "skipped"  # same module, fixture-unwind signature
        other_module = _Report("setup", "CancelledError")
        convert_blocked_report(_Item("tests/test_other.py::test_y"), other_module)
        assert other_module.outcome == "initial"  # the guard never fired there
        genuine = _Report("call", "AssertionError: assert 1 == 2")
        convert_blocked_report(_Item(), genuine)
        assert genuine.outcome == "initial"  # a real failure is never hidden
        _guard["tests"].add("tests/test_module.py::test_swallowed")
        swallowed = _Report("call", "AssertionError: assert FAILED == SUCCEEDED")
        convert_blocked_report(_Item("tests/test_module.py::test_swallowed"), swallowed)
        assert swallowed.outcome == "skipped"  # the refusal was recorded as job state, not raised
        passed = _Report("call", "", failed=False)
        convert_blocked_report(_Item(), passed)
        assert passed.outcome == "initial"
    finally:
        _guard["modules"].discard("tests/test_module.py")
        _guard["tests"].discard("tests/test_module.py::test_swallowed")


CHILD_SCRIPT = """
import subprocess, sys
try:
    subprocess.run([sys.argv[1]], check=True)
except RuntimeError as error:
    print("REFUSED", error)
"""


def test_nested_python_workers_inherit_the_refusal_through_sitecustomize(tmp_path):
    """The failing shape in the incident: a test starts a worker script that starts an engine."""
    fake = tmp_path / "xtb"
    marker = tmp_path / "launched"
    fake.write_text(f"#!/bin/sh\necho ran >> {marker}\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    script = tmp_path / "worker_like.py"  # an opaque path: nothing in argv names an engine
    script.write_text(CHILD_SCRIPT)
    base = {k: v for k, v in os.environ.items() if not k.startswith(("CHEMDFT", "PYTHONPATH"))}
    site = str(ROOT / "tools/e2e_offline")

    def run(**extra):
        env = {**base, "PYTHONPATH": site, **extra}
        return subprocess.run(
            [sys.executable, "-B", str(script), str(fake)],
            cwd=tmp_path,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )

    guarded = run(CHEMDFT_NATIVE_ENGINE_GUARD="1")
    assert "REFUSED NATIVE_ENGINE_BLOCKED" in guarded.stdout, guarded.stdout + guarded.stderr
    assert not marker.exists()  # the child never started the engine
    offline = run(CHEMDFT_E2E_OFFLINE="1")  # the offline E2E stack is covered the same way
    assert "REFUSED NATIVE_ENGINE_BLOCKED" in offline.stdout and not marker.exists()
    unguarded = run()  # no flag: the fake runs, proving the refusal above is the guard's doing
    assert unguarded.returncode == 0 and marker.read_text() == "ran\n"
