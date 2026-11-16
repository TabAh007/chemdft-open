"""Offline transport faults only; never contacts a model or scientific engine."""

import http.client
import json
import socket
import ssl
import urllib.error
from unittest.mock import patch

import pytest
from chemdft_api.ai.gateway import (
    HttpOpenAIModelGateway,
    ModelGatewayError,
    ModelMessage,
    ModelNetworkError,
    ModelRequest,
    ModelTimeoutError,
)
from chemdft_api.ai.http_transport import TransportDiagnostic, TransportFailure, _HTTPSConnection
from chemdft_api.config import Settings
from pydantic import SecretStr


def gateway():
    return HttpOpenAIModelGateway(
        Settings(
            _env_file=None,
            ai_provider="nvidia",
            ai_api_key=SecretStr("OFFLINE-DIAGNOSTIC-SECRET"),
            ai_timeout_seconds=60,
        )
    )


def model_request():
    return ModelRequest(
        system_prompt="Offline fixture",
        messages=(ModelMessage("user", "Offline"),),
        max_attempts=1,
        max_tokens=2048,
    )


@pytest.mark.parametrize("status", [400, 401, 402, 403, 404, 422, 429, 500, 503])
def test_http_status_and_eligibility_are_preserved_without_body_headers_or_retry(status):
    error = urllib.error.HTTPError(
        "https://offline.invalid",
        status,
        "PRIVATE BODY",
        {"Authorization": "OFFLINE-DIAGNOSTIC-SECRET", "X-Research": "private research"},
        None,
    )
    with (
        patch("chemdft_api.ai.gateway.open_response", side_effect=error) as opened,
        patch("time.sleep") as sleep,
        pytest.raises(ModelGatewayError) as exc,
    ):
        gateway().generate(model_request())
    assert opened.call_count == 1
    sleep.assert_not_called()
    d = exc.value.transport.as_dict()
    assert d["http_status"] == status and d["phase"] == "RESPONSE_HEADERS"
    assert d["retry_eligible"] == (status == 429 or status >= 500)
    assert exc.value.usage is None and exc.value.reported_usage is None
    assert "PRIVATE" not in json.dumps(d) and "SECRET" not in json.dumps(d)
    assert "private research" not in str(exc.value)


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (TimeoutError("private"), "CONNECTION_TIMEOUT"),
        (socket.gaierror("private"), "DNS_ERROR"),
        (ssl.SSLError("private"), "TLS_ERROR"),
        (ConnectionRefusedError("private"), "NETWORK_ERROR"),
    ],
)
def test_connection_phase_is_measured_at_actual_connection_boundary(error, kind):
    connection = _HTTPSConnection("offline.invalid", timeout=60)
    with (
        patch.object(http.client.HTTPSConnection, "connect", side_effect=error),
        pytest.raises(TransportFailure) as exc,
    ):
        connection.connect()
    assert exc.value.kind == kind and exc.value.phase == "CONNECT"
    assert "private" not in str(exc.value)


def test_header_read_timeout_is_not_mislabelled_connection_timeout():
    connection = _HTTPSConnection("offline.invalid", timeout=60)
    with (
        patch.object(
            http.client.HTTPSConnection, "getresponse", side_effect=TimeoutError("private")
        ),
        pytest.raises(TransportFailure) as exc,
    ):
        connection.getresponse()
    assert (exc.value.kind, exc.value.phase) == ("READ_TIMEOUT", "RESPONSE_HEADERS")


class Response:
    status = 200

    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, *args):
        if isinstance(self.value, Exception):
            raise self.value
        return self.value


@pytest.mark.parametrize(
    ("body", "kind", "phase"),
    [
        (TimeoutError("private"), "READ_TIMEOUT", "RESPONSE_BODY"),
        (b'{"broken"', "MALFORMED_OUTPUT", "PARSE_RESPONSE"),
        (b"null", "MALFORMED_OUTPUT", "PARSE_RESPONSE"),
        (b'{"choices":[{"message":null}]}', "MALFORMED_OUTPUT", "PARSE_RESPONSE"),
        (
            b'{"choices":[{"message":{"tool_calls":[{"function":{"name":[]}}]}}]}',
            "MALFORMED_OUTPUT",
            "PARSE_RESPONSE",
        ),
    ],
)
def test_headers_body_and_parse_failures_keep_observed_status_and_no_unknown_usage_invented(
    body, kind, phase
):
    with (
        patch("chemdft_api.ai.gateway.open_response", return_value=Response(body)),
        pytest.raises(ModelGatewayError) as exc,
    ):
        gateway().generate(model_request())
    assert exc.value.transport.kind == kind and exc.value.transport.phase == phase
    assert exc.value.transport.http_status == 200
    assert exc.value.usage is None and exc.value.reported_usage is None


@pytest.mark.parametrize(
    ("kind", "error"), [("DNS_ERROR", ModelNetworkError), ("CONNECTION_TIMEOUT", ModelTimeoutError)]
)
def test_gateway_carries_exact_tracked_error(kind, error):
    with (
        patch(
            "chemdft_api.ai.gateway.open_response", side_effect=TransportFailure(kind, "CONNECT")
        ),
        pytest.raises(error) as exc,
    ):
        gateway().generate(model_request())
    assert exc.value.transport.kind == kind and exc.value.transport.phase == "CONNECT"


def test_uncertain_diagnostics_survive_receipt_settlement_without_invented_usage(request):
    from chemdft_api.ai.budgets import AIRunBudget
    from test_ai_input_reservation import Recorder, _invocations, _ledger_rows

    fixture = request.getfixturevalue("env")
    run_id = fixture.make_run()
    diagnostic = TransportDiagnostic(
        phase="RESPONSE_BODY",
        kind="READ_TIMEOUT",
        elapsed_ms=60009,
        timeout_seconds=60,
        http_status=200,
        headers_ms=29,
    )
    recorder = Recorder([ModelTimeoutError("fixed safe message", transport=diagnostic)])
    fixture.execute(run_id, recorder)
    run = fixture.run_row(run_id)
    assert run.status == "FAILED" and run.error_code == "PROVIDER_READ_TIMEOUT"
    receipt = _invocations(fixture, run_id)[0]
    assert receipt.status == "FAILED_UNCERTAIN" and receipt.usage_status == "UNKNOWN"
    assert receipt.input_tokens is None and receipt.output_tokens is None
    assert receipt.latency_ms == 60009
    assert receipt.reservation_json["transport"] == diagnostic.as_dict()
    assert len(_ledger_rows(fixture, run_id)) == 1
    budget = AIRunBudget.from_dict(run.budget_json)
    assert budget.model_calls_used == 1
    assert budget.input_tokens_used == recorder.requests[0].reserved_input_tokens
    assert not budget.model_call_in_flight


def test_late_transport_after_uncertain_recovery_is_retained_without_another_charge(request):
    from chemdft_api.ai.gateway import ModelResponse
    from chemdft_api.ai.usage_accounting import finish_invocation
    from test_ai_input_reservation import Recorder, _invocations, _ledger_rows

    fixture = request.getfixturevalue("env")
    run_id = fixture.make_run()
    fixture.execute(run_id, Recorder([ModelTimeoutError("no transport known at recovery")]))
    receipt = _invocations(fixture, run_id)[0]
    budget = dict(fixture.run_row(run_id).budget_json)
    assert receipt.status == "FAILED_UNCERTAIN" and "transport" not in receipt.reservation_json
    diagnostic = TransportDiagnostic("RESPONSE_BODY", "READ_TIMEOUT", 60009, 60, 200, 29)
    with fixture.sessions() as db:
        for _ in range(2):
            _row, accounting_changed, late_usage = finish_invocation(
                db,
                fixture.identity,
                fixture.settings,
                receipt.id,
                ModelResponse(content=None, transport=diagnostic),
                status="FAILED_UNCERTAIN",
            )
            assert not accounting_changed and not late_usage
    updated = _invocations(fixture, run_id)[0]
    assert updated.reservation_json["transport"] == diagnostic.as_dict()
    assert updated.accounting_version == receipt.accounting_version + 1
    assert updated.input_tokens is None and updated.output_tokens is None
    assert len(_ledger_rows(fixture, run_id)) == 1
    assert fixture.run_row(run_id).budget_json == budget


# Disposable SQLite fixture; never loads a production URL or provider key.
from test_ai_execution_durability import env  # noqa: F401,E402


def test_real_transport_refuses_redirect_without_forwarding_another_request():
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from threading import Thread
    from urllib.request import Request

    from chemdft_api.ai.http_transport import open_response

    seen = []

    class Redirect(BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append(self.path)
            self.send_response(307)
            self.send_header("Location", "/must-not-contact")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Redirect)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        with pytest.raises(urllib.error.HTTPError) as exc:
            open_response(
                Request(f"http://127.0.0.1:{server.server_port}/planning", data=b"offline-only"),
                timeout=2,
            )
        assert exc.value.code == 307 and seen == ["/planning"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
