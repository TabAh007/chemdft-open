"""Harness-only safety checks; no provider endpoint or scientific executable is contacted."""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


def runner():
    spec = importlib.util.spec_from_file_location(
        "offline_runner", ROOT / "tools/run_isolated_e2e.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_offline_children_cannot_inherit_provider_credentials_or_hosted_markers():
    env = runner().offline_environment(
        {
            "PATH": os.environ["PATH"],
            "HOME": "/unused-test-home",
            "CHEMDFT_AI_API_KEY": "PRIVATE-TEST-ONLY",
            "OPENAI_API_KEY": "PRIVATE-TEST-ONLY",
            "AWS_ACCESS_KEY_ID": "PRIVATE-TEST-ONLY",
            "VERCEL": "1",
            "NODE_OPTIONS": "untrusted-options",
            "CHEMDFT_AI_PROVIDER": "nvidia",
        }
    )
    assert (
        not {"CHEMDFT_AI_API_KEY", "OPENAI_API_KEY", "AWS_ACCESS_KEY_ID", "VERCEL", "NODE_OPTIONS"}
        & env.keys()
    )
    assert env["CHEMDFT_AI_PROVIDER"] == "fake"
    assert env["CHEMDFT_RUN_AI_INTEGRATION"] == "false"
    assert env["CHEMDFT_E2E_WORKER_MODE"] == "disabled"


def test_python_child_denies_dns_and_ignores_repository_dotenv(tmp_path):
    (tmp_path / ".env").write_text(
        "CHEMDFT_AI_PROVIDER=nvidia\nCHEMDFT_AI_API_KEY=PRIVATE-TEST-ONLY\n"
    )
    env = runner().offline_environment(os.environ)
    env["CHEMDFT_TEST_WORKSPACE"] = str(tmp_path)
    script = """
import json, socket
from chemdft_api.config import Settings
settings = Settings()
assert settings.ai_provider == 'fake' and settings.ai_api_key is None
try:
    socket.getaddrinfo('offline.invalid', 443)
except RuntimeError as error:
    assert 'OUTBOUND_NETWORK_BLOCKED' in str(error)
else:
    raise AssertionError('External resolver was reached')
print(json.dumps({'provider': settings.ai_provider, 'key_absent': settings.ai_api_key is None}))
"""
    output = subprocess.check_output(
        [sys.executable, "-B", "-c", script], env=env, cwd=tmp_path, text=True
    )
    assert json.loads(output) == {"provider": "fake", "key_absent": True}
    assert "socket.getaddrinfo" in (tmp_path / "blocked-network.jsonl").read_text()


def test_minimal_installed_worker_prefix_keeps_guard_without_api_dependencies(tmp_path):
    python = ROOT / "services/scientific-worker/.venv/bin/python"
    if not python.is_file():
        pytest.skip("Isolated scientific prefix not installed; no probe was attempted")
    env = runner().offline_environment(os.environ)
    env["CHEMDFT_TEST_WORKSPACE"] = str(tmp_path)
    # A plain interpreter/DNS-denial check only; no engine import or calculation.
    script = """
import socket
try:
    socket.getaddrinfo('offline.invalid', 443)
except RuntimeError as error:
    assert 'OUTBOUND_NETWORK_BLOCKED' in str(error)
    print('MINIMAL_PREFIX_GUARDED')
else:
    raise AssertionError('External resolver reached')
"""
    assert (
        subprocess.check_output(
            [str(python), "-B", "-c", script], env=env, cwd=tmp_path, text=True
        ).strip()
        == "MINIMAL_PREFIX_GUARDED"
    )


@pytest.mark.skipif(sys.platform != "darwin", reason="Current OS sandbox backend is macOS")
def test_os_guard_denies_native_node_socket_before_any_external_connection():
    sandbox, node = shutil.which("sandbox-exec"), shutil.which("node")
    assert sandbox and node
    script = """
const socket = require('node:net').connect({host: '192.0.2.1', port: 443});
socket.on('error', error => {
  if (error.code !== 'EPERM') process.exitCode = 1;
  console.log(error.code);
});
socket.on('connect', () => { socket.destroy(); process.exitCode = 2; });
setTimeout(() => { socket.destroy(); process.exitCode = 3; }, 1000).unref();
"""
    output = subprocess.check_output(
        [sandbox, "-f", str(ROOT / "tools/e2e_offline/loopback-only.sb"), node, "-e", script],
        text=True,
        timeout=5,
    )
    assert output.strip() == "EPERM"


def test_offline_mode_refuses_live_scientific_suite_before_workspace_creation():
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            str(ROOT / "tools/run_isolated_e2e.py"),
            "--offline",
            "--suite",
            "as-c1-nvidia",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "TEST_OFFLINE_SUITE_REQUIRED" in result.stderr
