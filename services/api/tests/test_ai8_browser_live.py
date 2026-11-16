"""AI-8 offline checks for the budget gateway that guards the live browser acceptance.

A fake inner gateway answers as NVIDIA would. No test reads a credential, resolves a name or opens
a socket, and the launcher is only exercised on its refusal paths (it never reaches the server).
"""

import json
import sys
import threading
from pathlib import Path

import pytest
from chemdft_api.ai.gateway import (
    ModelAuthenticationError,
    ModelGatewayError,
    ModelRateLimitError,
    ModelRequestNotSentError,
)
from chemdft_api.ai.http_transport import TransportDiagnostic
from test_nvidia_probe_flow import Inner, pinned_request
from test_nvidia_probe_flow_cli import SENTINEL, STEP5, SUPER, flow_authorize, flow_dict
from test_nvidia_probe_preflight import NOW

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import browser_live  # noqa: E402
from nvidia_probe.authorization import FLOW_SCHEMA  # noqa: E402
from nvidia_probe.browser_live import BrowserBudgetGateway  # noqa: E402
from nvidia_probe.runner import ARM_ENV  # noqa: E402


def gateway(inner=None, **overrides):
    inner = inner or Inner()
    return inner, BrowserBudgetGateway(inner, flow_authorize(**overrides))


def request(model=SUPER, **extra):
    from dataclasses import replace

    return replace(pinned_request(**extra), model_identifier=model)


def test_an_authorized_request_is_sent_unchanged_and_keeps_its_real_identity():
    inner, budgeted = gateway()
    asked = request(temperature=1.0, top_p=0.95, chat_template_kwargs=(("enable_thinking", True),))
    answer = budgeted.generate(asked)
    sent = inner.sent[0]
    assert sent.model_identifier == SUPER and sent.max_attempts == 1  # one attempt, no retries
    assert (sent.temperature, sent.top_p) == (1.0, 0.95)  # exactly what the service built
    assert dict(sent.chat_template_kwargs) == {"enable_thinking": True}
    assert (answer.provider, answer.model_identifier) == (
        "nvidia",
        SUPER,
    )  # real, not the replica's
    (record,) = budgeted.summary()["requests"]
    assert record["outcome"] == "SUCCEEDED" and record["model"] == SUPER
    assert record["input_tokens"] == 120 and record["tool_calls"] == ["calculation.submit"]
    assert SENTINEL not in json.dumps(budgeted.summary())


def test_a_model_that_is_not_authorized_is_never_sent_and_stops_everything_after_it():
    inner, budgeted = gateway()
    with pytest.raises(ModelRequestNotSentError):
        budgeted.generate(request("nvidia/nemotron-3.5-lightning-30b-a3b"))
    assert inner.sent == []
    with pytest.raises(ModelRequestNotSentError):  # even an authorized model: fail closed
        budgeted.generate(request(SUPER))
    assert inner.sent == [] and budgeted.stopped_by == "MODEL_NOT_AUTHORIZED"
    reasons = [r["reason"] for r in budgeted.summary()["requests"]]
    assert reasons == ["MODEL_NOT_AUTHORIZED", "AFTER_STOP_MODEL_NOT_AUTHORIZED"]


def test_the_call_ceiling_binds_the_whole_session_across_models():
    inner, budgeted = gateway(
        max_total_calls=2,
        max_total_tokens=60_000,
        flow={**flow_dict()["flow"], "max_model_calls_per_model": 1},
    )
    budgeted.generate(request(SUPER))
    inner.model = STEP5
    budgeted.generate(request(STEP5))
    with pytest.raises(ModelRequestNotSentError):
        budgeted.generate(request(SUPER))
    assert len(inner.sent) == 2 and budgeted.stopped_by == "CALL_CEILING"
    assert budgeted.summary()["calls_admitted"] == 2


def test_a_response_from_another_model_is_refused_and_stops_the_session():
    _inner, budgeted = gateway(Inner(model=STEP5))
    with pytest.raises(ModelGatewayError):
        budgeted.generate(request(SUPER))
    assert budgeted.stopped_by == "MODEL_IDENTITY_MISMATCH"
    with pytest.raises(ModelRequestNotSentError):
        budgeted.generate(request(SUPER))


@pytest.mark.parametrize("status", [402, 429])
def test_a_provider_refusal_of_the_free_allowance_stops_the_session(status):
    error = ModelRateLimitError(
        "limited",
        transport=TransportDiagnostic(
            phase="RESPONSE_STATUS",
            kind="HTTP_STATUS",
            elapsed_ms=5,
            timeout_seconds=30,
            http_status=status,
        ),
    )
    inner, budgeted = gateway(Inner(error))
    with pytest.raises(ModelGatewayError):
        budgeted.generate(request())
    assert budgeted.stopped_by == f"PROVIDER_REFUSED_HTTP_{status}"
    with pytest.raises(ModelRequestNotSentError):
        budgeted.generate(request())
    assert len(inner.sent) == 1  # no retry


def test_an_authentication_failure_stops_the_session():
    _inner, budgeted = gateway(Inner(ModelAuthenticationError("denied")))
    with pytest.raises(ModelAuthenticationError):
        budgeted.generate(request())
    assert budgeted.stopped_by == "AUTHENTICATION_FAILED"


def test_concurrent_requests_are_serialized_so_the_ceiling_cannot_be_raced():
    inner, budgeted = gateway(
        max_total_calls=6, flow={**flow_dict()["flow"], "max_model_calls_per_model": 3}
    )
    outcomes = []

    def go():
        try:
            budgeted.generate(request())
            outcomes.append("sent")
        except ModelGatewayError:
            outcomes.append("refused")

    threads = [threading.Thread(target=go) for _ in range(10)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert outcomes.count("sent") == 6 and len(inner.sent) == 6
    assert budgeted.summary()["calls_admitted"] == 6


def test_the_report_is_written_after_every_request_and_holds_no_content(tmp_path):
    report = tmp_path / "live.json"
    inner = Inner()
    budgeted = BrowserBudgetGateway(inner, flow_authorize(), report_path=report)
    budgeted.generate(request())
    saved = json.loads(report.read_text())
    assert saved["kind"] == "BROWSER_LIVE_BUDGET_REPORT" and saved["calls_admitted"] == 1
    assert saved["retries"] == 0 and saved["fallback"] == "none"
    assert saved["authorization_sha256"] == flow_authorize().sha256
    assert SENTINEL not in report.read_text() and "reply" not in report.read_text()


# -- the launcher's refusals ----------------------------------------------------------------------


def launch(tmp_path, *, armed=True, mode=0o600, schema=FLOW_SCHEMA, extra=None):
    data = flow_dict(now=NOW)
    data["schema"] = schema
    authorization = tmp_path / "authorization.json"
    authorization.write_text(json.dumps(data))
    key = tmp_path / "key"
    key.write_text("throwaway")
    key.chmod(mode)
    approved = flow_authorize()
    environ = {
        browser_live.AUTHORIZATION_ENV: str(authorization),
        browser_live.KEY_FILE_ENV: str(key),
        browser_live.REPORT_ENV: str(tmp_path / "report.json"),
        "CHEMDFT_E2E_API_PORT": "0",
        **(extra or {}),
    }
    if armed:
        environ[ARM_ENV] = f"EXECUTE-{approved.sha256[:16]}"
    return environ, authorization


def run_main(monkeypatch, environ):
    # The authorization above is dated NOW; the loader checks the real clock, so pin it.
    from nvidia_probe import authorization as module

    real = module.parse_authorization
    monkeypatch.setattr(
        browser_live,
        "load_authorization",
        lambda path: real(path.read_bytes(), now=NOW),
    )
    monkeypatch.setattr(browser_live, "install_host_allowlist", lambda host: pytest.fail("armed"))
    return browser_live.main(["--serve"], environ)


def test_the_launcher_refuses_without_the_arming_variable(tmp_path, monkeypatch, capsys):
    environ, _ = launch(tmp_path, armed=False)
    assert run_main(monkeypatch, environ) == 2
    assert "REFUSED_NOT_ARMED" in capsys.readouterr().out


def test_the_launcher_refuses_an_offline_sandbox_and_a_group_readable_key(
    tmp_path, monkeypatch, capsys
):
    environ, _ = launch(tmp_path, extra={"CHEMDFT_E2E_OFFLINE": "1"})
    assert run_main(monkeypatch, environ) == 2
    assert "REFUSED_OFFLINE_ENVIRONMENT" in capsys.readouterr().out
    environ, _ = launch(tmp_path, mode=0o640)
    assert run_main(monkeypatch, environ) == 2
    assert "KEY_FILE_NOT_PRIVATE" in capsys.readouterr().out


def test_the_launcher_refuses_a_non_flow_authorization_and_a_missing_file(
    tmp_path, monkeypatch, capsys
):
    environ, _ = launch(tmp_path, schema="chemdft.nvidia-probe-authorization.v1")
    assert run_main(monkeypatch, environ) == 2
    environ[browser_live.AUTHORIZATION_ENV] = str(tmp_path / "missing.json")
    assert run_main(monkeypatch, environ) == 2
    assert "REFUSED" in capsys.readouterr().out


def test_validate_prints_the_limits_without_arming_or_a_key(tmp_path, monkeypatch, capsys):
    environ, _ = launch(tmp_path, armed=False)
    del environ[browser_live.KEY_FILE_ENV]  # no key is needed to read the plan
    monkeypatch.setattr(
        browser_live,
        "load_authorization",
        lambda path: __import__("nvidia_probe.authorization", fromlist=["x"]).parse_authorization(
            path.read_bytes(), now=NOW
        ),
    )
    assert browser_live.main(["--validate"], environ) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["mode"] == "LIVE_BROWSER_VALIDATE_ONLY_NO_NETWORK"
    assert plan["models"] == [SUPER, STEP5] and plan["never_approves"] is True
    assert plan["retries"] == 0 and plan["fallback"] == "none"
    assert plan["max_total_calls"] == 6 and plan["max_total_tokens"] == 208_000


def test_check_needs_the_arming_variable_and_a_private_key_but_starts_nothing(
    tmp_path, monkeypatch, capsys
):
    environ, _ = launch(tmp_path)
    monkeypatch.setattr(
        browser_live,
        "load_authorization",
        lambda path: __import__("nvidia_probe.authorization", fromlist=["x"]).parse_authorization(
            path.read_bytes(), now=NOW
        ),
    )
    assert browser_live.main(["--check"], environ) == 0
    assert json.loads(capsys.readouterr().out)["mode"] == "LIVE_BROWSER_ARMED_CHECK"
    assert browser_live.main(["--bogus"], environ) == 2


def test_one_budget_serves_several_provider_clients_and_labels_the_authorized_provider():
    first, second = Inner(), Inner()
    budgeted = BrowserBudgetGateway(None, flow_authorize())
    a, b = budgeted.bind(first), budgeted.bind(second)
    a.generate(request(SUPER))
    second.model = STEP5
    b.generate(request(STEP5))
    assert len(first.sent) == 1 and len(second.sent) == 1
    assert budgeted.summary()["calls_admitted"] == 2  # one ledger, not one per client
