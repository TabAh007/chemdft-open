"""Offline tests for the retired tools/nvidia_usage_probe.py: dry run only, never a live request."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from chemdft_api.ai.token_policy import bound_from_bytes, payload_byte_parts

REPO = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "nvidia_usage_probe", REPO / "tools/nvidia_usage_probe.py"
)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

KEY = "synthetic-probe-key-0123456789"  # obviously fake; proves it never reaches an output


@pytest.fixture
def key_file(tmp_path):
    path = tmp_path / "nvidia.key"
    path.write_text(KEY + "\n")
    path.chmod(0o600)
    return path


def run(tmp_path, *extra, env=None, name="out"):
    with patch.dict(os.environ, env or {}, clear=False):
        return probe.main(["--out-dir", str(tmp_path / name), *extra])


# --------------------------------------------------------------------------- dry run
def test_dry_run_makes_no_request_reads_no_key_and_records_the_estimate(tmp_path):
    if not probe.DEFAULT_PAYLOAD.exists():
        pytest.skip("measurements/planning_call1.json fixture excluded from export")
    with patch("urllib.request.urlopen", side_effect=AssertionError("network used")) as opened:
        assert run(tmp_path) == 0
        opened.assert_not_called()
    plan = json.loads((tmp_path / "out/plan.json").read_text())
    assert (plan["mode"], plan["network_requests"]) == ("DRY_RUN", 0)
    assert (
        oct((tmp_path / "out").stat().st_mode & 0o777),
        oct((tmp_path / "out/plan.json").stat().st_mode & 0o777),
    ) == ("0o700", "0o600")
    assert (plan["provider"], plan["model"]) == ("nvidia", "nvidia/nemotron-3.5-lightning-30b-a3b")
    assert plan["estimate"]["basis"] == "BYTE_HEURISTIC_NOT_A_GUARANTEE"
    assert plan["comparison"]["provider_reported_prompt_tokens"] is None


def test_estimate_matches_the_policy_and_covers_the_locally_measured_count():
    if not probe.DEFAULT_PAYLOAD.exists():
        pytest.skip("measurements/planning_call1.json fixture excluded from export")
    messages, tools = probe.load_payload(probe.DEFAULT_PAYLOAD)
    static, dynamic = payload_byte_parts(messages, tools)
    expected = bound_from_bytes(static + dynamic, len(messages), len(tools), 2.0, dynamic).tokens
    estimate = probe.estimates(messages, tools, 2.0)
    assert estimate["estimated_input_tokens_by_floor"]["2.0"] == expected
    # 14,583 = published-tokenizer count of this exact payload (not hosted usage).
    assert expected >= 1.5 * 14_583


def test_output_directory_is_never_overwritten(tmp_path):
    (tmp_path / "out").mkdir()
    with pytest.raises(SystemExit, match="must not exist"):
        run(tmp_path)


@pytest.mark.parametrize("tokens", [0, 511, 2049])
def test_output_token_budget_is_bounded(tmp_path, tokens):
    with pytest.raises(SystemExit, match="512"):
        run(tmp_path, "--max-output-tokens", str(tokens))


def test_only_a_single_planning_request_payload_is_accepted(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text(
        json.dumps(
            {
                "messages": [
                    {"role": "system", "content": "s"},
                    {"role": "assistant", "content": "a"},
                ],
                "tools": [],
            }
        )
    )
    with pytest.raises(SystemExit, match="single planning request"):
        run(tmp_path, "--payload", str(bad))


# ------------------------------------------------------------------ retirement (fail closed)
LIVE_ATTEMPTS = (
    ("--send",),
    ("--send", "--key-file", "KEY"),
    ("--key-file", "KEY"),
)


@pytest.mark.parametrize("flags", LIVE_ATTEMPTS)
def test_every_live_form_is_refused_before_any_credential_read_output_or_socket(
    tmp_path, key_file, monkeypatch, flags
):
    """Even with the old authorization variable, a private key file and every flag, nothing runs."""
    import socket

    def forbidden(*_a, **_k):
        raise AssertionError("a retired live form touched a credential or the network")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setattr(probe, "load_payload", forbidden)  # no payload is read
    monkeypatch.setattr(probe, "write_private", forbidden)  # nothing is written
    args = [str(key_file) if a == "KEY" else a for a in flags]
    with pytest.raises(SystemExit, match=r"RETIRED.*tools/nvidia_probe"):
        run(tmp_path, *args, env={"CHEMDFT_AUTHORIZE_LIVE_NVIDIA_PROBE": "YES"})
    assert not (tmp_path / "out").exists()


def test_the_retired_tool_contains_no_provider_transport_or_credential_code():
    import ast

    tree = ast.parse((REPO / "tools/nvidia_usage_probe.py").read_text())
    tree.body = tree.body[1:]  # the explanatory docstring may name what was removed
    source = ast.unparse(tree)
    for forbidden in (
        "HttpOpenAIModelGateway",
        "open_response",
        "read_secret_file",
        "SecretStr",
        "urllib.request.urlopen =",
        "import urllib",
        "OneShotRecorder",
        "Settings(",
    ):
        assert forbidden not in source, forbidden
    assert not hasattr(probe, "OneShotRecorder") and not hasattr(probe, "AUTHORIZATION_ENV")
    assert "CHEMDFT_AUTHORIZE_LIVE_NVIDIA_PROBE" not in source


def test_the_retired_tool_still_refuses_when_run_as_a_script(tmp_path):
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            "-B",
            str(REPO / "tools/nvidia_usage_probe.py"),
            "--out-dir",
            str(tmp_path / "o"),
            "--send",
        ],
        capture_output=True,
        text=True,
        timeout=60,
        env={
            "PATH": os.environ["PATH"],
            "PYTHONPATH": str(REPO / "services/api/src"),
            "CHEMDFT_AUTHORIZE_LIVE_NVIDIA_PROBE": "YES",
        },
    )
    assert result.returncode != 0 and "RETIRED" in result.stderr + result.stdout
    assert not (tmp_path / "o").exists()
