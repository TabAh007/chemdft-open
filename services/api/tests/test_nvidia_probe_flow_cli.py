"""Production-flow authorization mode: schema, planning from the real request, and the CLI.

No test reads a real credential, resolves a name or opens a socket: the model behind every flow is a
fake gateway that answers as NVIDIA would, and the one real-gateway construction is checked with a
throwaway key file and the audit hook switched off. Flows that reach the approval step need the
PySCF worker's version probe and skip without the ignored worker environment.
"""

import hashlib
import json
import sys
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from chemdft_api.ai.gateway import (
    ModelAuthenticationError,
    ModelGatewayError,
    ModelProviderUnavailableError,
    ModelResponse,
    ModelUsage,
)
from chemdft_api.ai.http_transport import TransportDiagnostic
from test_nvidia_probe_flow import call, mutated, needs_worker, no_engine, proposal, text
from test_nvidia_probe_preflight import NOW

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import plan as probe_plan  # noqa: E402
from nvidia_probe import runner  # noqa: E402
from nvidia_probe.authorization import (  # noqa: E402
    FIXTURE_ID,
    FLOW_SCHEMA,
    HARD_MAX_CALLS,
    HARD_MAX_TOTAL_TOKENS,
    SCHEMA,
    AuthorizationError,
    parse_authorization,
)
from nvidia_probe.flow import ProductionFlow, measure_first_request, plan_flow  # noqa: E402

SUPER = "nvidia/nemotron-3-super-120b-a12b"
STEP5 = "stepfun-ai/step-5-preview"
SENTINEL = "SENTINEL-PRIVATE-VALUE-8842"


def flow_dict(now=NOW, **overrides):
    data = {
        "schema": FLOW_SCHEMA,
        "authorized_by": "Test Owner",
        "authorized_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=2)).isoformat(),
        "endpoint": "https://integrate.api.nvidia.com/v1",
        "models": [SUPER, STEP5],
        "flow": {
            "planning_profile": "PYSCF_ENERGY_PROPOSAL",
            "max_model_calls_per_model": 3,
            "input_token_basis": "SERVICE_RESERVATION",
            "read_timeout_seconds": 120,
        },
        "max_total_calls": 6,
        "max_input_tokens_per_request": 32_768,
        "max_output_tokens_per_request": 2_048,
        "max_total_tokens": 208_000,
        "max_wall_clock_seconds": 900,
        "per_call_wall_clock_seconds": 150,
        "spend_control": {"kind": "TOKEN_CEILING_ONLY", "acknowledged_no_cost_information": True},
        "no_retries": True,
        "no_fallback": True,
        "no_scientific_compute": True,
        "no_production_data": True,
        "fixture": FIXTURE_ID,
        "sampling": "MODEL_CARD_PROFILE",
    }
    data.update(overrides)
    return data


def flow_authorize(**overrides):
    return parse_authorization(json.dumps(flow_dict(**overrides)).encode(), now=NOW)


# --- the schema --------------------------------------------------------------------------------


def test_the_shipped_flow_example_is_refused_until_the_owner_completes_it():
    raw = (ROOT / "tools/nvidia_probe/authorization.flow.example.json").read_bytes()
    with pytest.raises(AuthorizationError) as refused:
        parse_authorization(raw, now=NOW)
    assert refused.value.code == "AUTHORIZER_MISSING"
    completed = json.loads(raw)
    completed.update(
        authorized_by="Test Owner",
        authorized_at=NOW.isoformat(),
        expires_at=(NOW + timedelta(hours=2)).isoformat(),
    )
    completed["spend_control"]["acknowledged_no_cost_information"] = True
    approved = parse_authorization(json.dumps(completed).encode(), now=NOW)
    assert approved.flow is not None and approved.models == (SUPER, STEP5)


def test_a_flow_authorization_carries_its_flow_limits_and_no_case_plan():
    approved = flow_authorize()
    assert approved.flow.max_model_calls_per_model == 3
    assert approved.flow.read_timeout_seconds == 120
    assert approved.flow.input_token_basis == "SERVICE_RESERVATION"
    assert approved.flow.planning_profile == "PYSCF_ENERGY_PROPOSAL"
    assert approved.case_plan is None and approved.sampling == "MODEL_CARD_PROFILE"
    assert len(approved.sha256) == 64


@pytest.mark.parametrize(
    "overrides, code",
    [
        ({"flow": {"max_model_calls_per_model": 3}}, "FLOW_INVALID"),
        (
            {"flow": {**flow_dict()["flow"], "extra": 1}},
            "FLOW_INVALID",
        ),
        ({"flow": {**flow_dict()["flow"], "planning_profile": "GENERAL"}}, "FLOW_INVALID"),
        (
            {"flow": {**flow_dict()["flow"], "input_token_basis": "CONSERVATIVE_FLOOR"}},
            "FLOW_INVALID",
        ),
        ({"flow": {**flow_dict()["flow"], "max_model_calls_per_model": 0}}, "LIMIT_INVALID"),
        ({"flow": {**flow_dict()["flow"], "max_model_calls_per_model": 5}}, "LIMIT_INVALID"),
        ({"flow": {**flow_dict()["flow"], "read_timeout_seconds": 10}}, "LIMIT_INVALID"),
        ({"flow": {**flow_dict()["flow"], "read_timeout_seconds": 151}}, "LIMIT_INVALID"),
        ({"flow": {**flow_dict()["flow"], "read_timeout_seconds": "120"}}, "LIMIT_INVALID"),
        ({"max_total_calls": 1, "max_total_tokens": 30_000}, "FLOW_INVALID"),  # fewer than models
        ({"max_total_calls": 7}, "FLOW_INVALID"),  # more than models x per-model calls
        ({"case_plan": {SUPER: ["PROPOSAL"], STEP5: ["PROPOSAL"]}}, "KEYS_MISMATCH"),
        ({"sampling": "temperature=0.7"}, "SAMPLING_NOT_ACCEPTED"),
        ({"max_total_calls": HARD_MAX_CALLS + 1}, "LIMIT_INVALID"),
        ({"max_total_tokens": HARD_MAX_TOTAL_TOKENS + 1}, "LIMIT_INVALID"),
        ({"max_total_tokens": 300_000}, "LIMIT_INVALID"),
        ({"max_total_tokens": 220_000}, "TOKEN_CEILING_LOOSE"),  # above calls x per-request caps
        ({"models": ["moonshotai/kimi-k3", STEP5]}, "MODEL_NOT_AVAILABLE"),
        ({"models": [SUPER, "unknown/model"]}, "MODEL_NOT_REGISTERED"),
        ({"no_retries": False}, "SAFEGUARD_NOT_ACCEPTED"),
        ({"endpoint": "https://api.openai.com/v1"}, "ENDPOINT_NOT_ALLOWED"),
        ({"max_output_tokens_per_request": 64}, "LIMIT_INVALID"),  # below the Nemotron minimum
        ({"per_call_wall_clock_seconds": 100}, "LIMIT_INVALID"),  # below the 120 s read timeout
    ],
)
def test_an_invalid_flow_authorization_is_refused(overrides, code):
    with pytest.raises(AuthorizationError) as refused:
        flow_authorize(**overrides)
    assert refused.value.code == code, overrides


def test_a_flow_authorization_without_its_flow_block_is_refused():
    data = flow_dict()
    del data["flow"]
    with pytest.raises(AuthorizationError) as refused:
        parse_authorization(json.dumps(data).encode(), now=NOW)
    assert refused.value.code == "KEYS_MISMATCH"


def test_probe_and_flow_authorizations_are_not_interchangeable():
    probe_shaped = flow_dict(schema=SCHEMA)
    with pytest.raises(AuthorizationError) as refused:
        parse_authorization(json.dumps(probe_shaped).encode(), now=NOW)
    assert refused.value.code == "KEYS_MISMATCH"  # a probe file may not carry a flow block
    probe = flow_dict(schema=SCHEMA)
    del probe["flow"]
    probe["sampling"] = "PRODUCTION_DEFAULT"
    with pytest.raises(AuthorizationError) as refused:
        parse_authorization(json.dumps(probe).encode(), now=NOW)
    assert refused.value.code == "SAMPLING_NOT_ACCEPTED"  # production defaults are flow-only
    other = flow_dict(schema="chemdft.something-else.v1")
    with pytest.raises(AuthorizationError) as refused:
        parse_authorization(json.dumps(other).encode(), now=NOW)
    assert refused.value.code == "SCHEMA_MISMATCH"


def test_production_default_sampling_needs_no_profile_but_card_sampling_does(monkeypatch):
    from chemdft_api.ai import model_catalog

    monkeypatch.delitem(model_catalog.SAMPLING_PROFILES, SUPER)
    with pytest.raises(AuthorizationError) as refused:
        flow_authorize()
    assert refused.value.code == "MODEL_HAS_NO_SAMPLING_PROFILE"
    approved = flow_authorize(sampling="PRODUCTION_DEFAULT")
    assert approved.sampling == "PRODUCTION_DEFAULT"


# --- sizing the plan from the real request -----------------------------------------------------


@pytest.fixture(scope="module")
def fixture():
    return probe_plan.load_fixture()


@pytest.fixture(scope="module")
def flow(fixture):
    with ProductionFlow.build(fixture) as built:
        yield built


@pytest.fixture(scope="module")
def measurement(flow):
    return measure_first_request(flow)


def test_the_real_requests_size_is_measured_without_asking_any_model(measurement):
    assert measurement["tools"] == ["calculation.submit", "structure.version.get"]
    assert measurement["output_token_cap"] == 2_048
    assert measurement["input_bytes_per_token_floor"] == 2.0
    reserved = measurement["reserved_input_tokens"]
    conservative = measurement["conservative_input_bound"]
    assert 0 < reserved < conservative < 32_768
    ratio = conservative / reserved  # the 1.0-bytes-per-token bound is about twice the 2.0 one
    assert 1.8 <= ratio <= 2.2


def test_the_shipped_sizing_fits_the_real_request_with_the_planning_margin(measurement):
    plan = plan_flow(flow_authorize(), measurement)
    assert plan["refusal"] is None and plan["planned_requests"] == 6
    growth = 2_048 + 512
    assert plan["largest_planned_input_tokens"] == measurement["reserved_input_tokens"] + 2 * growth
    assert plan["planned_worst_case_tokens"] <= runner.MAX_PLANNED_UTILIZATION * 208_000
    assert plan["planned_worst_case_utilization"] <= 0.6
    assert plan["worst_case_usd"] == "UNKNOWN"


@pytest.mark.parametrize(
    "overrides, code",
    [
        (
            {"max_total_tokens": 150_000, "max_input_tokens_per_request": 32_768},
            "REFUSED_INSUFFICIENT_MARGIN",
        ),
        (
            {"max_input_tokens_per_request": 18_000, "max_total_tokens": 100_000},
            "REFUSED_INPUT_CAP",
        ),
        (
            {"max_output_tokens_per_request": 1_024, "max_total_tokens": 150_000},
            "REFUSED_OUTPUT_CAP",
        ),
        (
            {"max_wall_clock_seconds": 600, "per_call_wall_clock_seconds": 150},
            "REFUSED_WALL_CLOCK",
        ),
    ],
)
def test_a_plan_the_real_request_cannot_honour_is_refused_before_anything_runs(
    measurement, overrides, code
):
    refused = plan_flow(flow_authorize(**overrides), measurement)["refusal"]
    assert refused is not None and refused[0] == code, overrides


# --- the command line --------------------------------------------------------------------------


class Nvidia:
    """Stands in for the real gateway: answers as NVIDIA would, under the model it was asked for."""

    def __init__(self, *steps, repeat_last=False):
        self.steps, self.repeat_last, self.sent = list(steps), repeat_last, []

    def generate(self, request):
        self.sent.append(request)
        step = self.steps[0] if self.repeat_last and len(self.steps) == 1 else self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        response = step(request)
        return replace(response, provider="nvidia", model_identifier=request.model_identifier)


def live_flow_dict(**overrides):
    now = datetime.now(UTC)
    return flow_dict(now=now, **overrides)


def cli(tmp_path, data, *flags, gateway=None, environ=None):
    path = tmp_path / "flow-authorization.json"
    path.write_text(json.dumps(data))
    lines: list[str] = []

    def factory():
        if gateway is None:
            raise AssertionError("no gateway may be built in this mode")
        return gateway

    code = runner.main(
        ["--authorization", str(path), *flags],
        gateway_factory=factory,
        environ=environ if environ is not None else {},
        out=lines.append,
    )
    return code, lines, path


def armed(path):
    return {runner.ARM_ENV: "EXECUTE-" + hashlib.sha256(path.read_bytes()).hexdigest()[:16]}


def run_armed(tmp_path, data, gateway):
    path = tmp_path / "flow-authorization.json"
    path.write_text(json.dumps(data))
    output = tmp_path / "out"
    lines: list[str] = []
    code = runner.main(
        ["--authorization", str(path), "--execute", "--output", str(output)],
        gateway_factory=lambda: gateway,
        environ=armed(path),
        out=lines.append,
    )
    report = (
        json.loads((output / "report.json").read_text())
        if (output / "report.json").exists()
        else None
    )
    return code, lines, report


def test_validate_only_prints_the_plan_and_never_builds_a_gateway(tmp_path):
    code, lines, _ = cli(tmp_path, live_flow_dict())
    assert code == 0
    summary = json.loads("\n".join(lines))
    assert summary["mode"] == "FLOW_VALIDATE_ONLY_NO_NETWORK"
    assert summary["models"] == [SUPER, STEP5] and summary["sampling"] == "MODEL_CARD_PROFILE"
    assert summary["max_model_calls_per_model"] == 3 and summary["read_timeout_seconds"] == 120
    assert summary["planned_requests"] == 6 and summary["never_approves"] is True
    assert summary["planned_worst_case_utilization"] <= 0.6
    assert (summary["retries"], summary["fallback"]) == (0, "none")
    assert summary["service_request"]["output_token_cap"] == 2_048


def test_an_unfit_plan_is_refused_with_its_reason_and_exit_code(tmp_path):
    code, lines, _ = cli(tmp_path, live_flow_dict(max_total_tokens=150_000))
    assert code == 2 and lines[0].startswith("REFUSED_INSUFFICIENT_MARGIN")


def test_execute_needs_the_exact_arming_and_never_inside_the_offline_environment(tmp_path):
    data = live_flow_dict()
    code, lines, path = cli(tmp_path, data, "--execute")
    assert code == 2 and lines == ["REFUSED_NOT_ARMED"]
    code, lines, _ = cli(
        tmp_path, data, "--execute", environ={runner.ARM_ENV: "EXECUTE-" + "0" * 16}
    )
    assert code == 2 and lines == ["REFUSED_NOT_ARMED"]
    code, lines, _ = cli(
        tmp_path, data, "--execute", environ={**armed(path), "CHEMDFT_E2E_OFFLINE": "1"}
    )
    assert code == 2 and lines == ["REFUSED_OFFLINE_ENVIRONMENT"]
    edited = {**data, "authorized_by": "Someone Else"}  # editing the file invalidates its arming
    code, lines, _ = cli(tmp_path, edited, "--execute", environ=armed(path))
    assert code == 2 and lines == ["REFUSED_NOT_ARMED"]


def test_an_armed_run_asks_each_model_once_through_the_real_service(tmp_path):
    inner = Nvidia(text(f"final words {SENTINEL}"), repeat_last=True)
    code, lines, report = run_armed(tmp_path, live_flow_dict(), inner)
    assert code == 0 and lines[-1].endswith("(stopped_by=None)")
    assert report["report_kind"] == "PRODUCTION_FLOW_PROBE" and report["stopped_by"] is None
    assert [f["model"] for f in report["flows"]] == [SUPER, STEP5]
    assert {f["result"] for f in report["flows"]} == {"NO_PROPOSAL"}
    assert report["totals"]["requests_admitted"] == 2 and report["totals"]["retries"] == 0
    first, second = inner.sent
    assert (first.model_identifier, second.model_identifier) == (SUPER, STEP5)
    assert (first.temperature, first.top_p) == (1.0, 0.95)  # the model-card profile
    assert dict(first.chat_template_kwargs) == {"enable_thinking": True, "low_effort": True}
    assert second.chat_template_kwargs is None and first.max_attempts == second.max_attempts == 1
    assert {t.name for t in first.tools} == {"calculation.submit", "structure.version.get"}
    record = report["flows"][0]["gateway"]["requests"][0]
    assert (
        record["outcome"] == "SUCCEEDED"
        and record["input_token_bound"] == first.reserved_input_tokens
    )
    assert report["flows"][0]["gateway"]["input_token_basis"] == "SERVICE_RESERVATION"
    assert SENTINEL not in json.dumps(report)


def test_production_default_sampling_sends_the_services_own_request_unchanged(tmp_path):
    inner = Nvidia(text(), repeat_last=True)
    code, _, report = run_armed(tmp_path, live_flow_dict(sampling="PRODUCTION_DEFAULT"), inner)
    assert code == 0
    for sent in inner.sent:
        assert (sent.temperature, sent.top_p, sent.chat_template_kwargs) == (0.0, None, None)
    assert (
        report["flows"][0]["gateway"]["requests"][0]["sampling"]["source"] == "PRODUCTION_DEFAULT"
    )


def test_one_ledger_binds_every_model_of_the_run(tmp_path):
    data = live_flow_dict(
        flow={**flow_dict()["flow"], "max_model_calls_per_model": 2},
        max_total_calls=3,
        max_total_tokens=104_000,
    )
    inner = Nvidia(call(mutated(no_engine)), repeat_last=True)
    code, _, report = run_armed(tmp_path, data, inner)
    assert code == 0 and len(inner.sent) == 3  # two for the first model, one for the second
    assert [f["model"] for f in report["flows"]] == [SUPER, STEP5]
    assert report["stopped_by"] == "CALL_CEILING" and report["totals"]["requests_admitted"] == 3
    outcomes = [r["outcome"] for r in report["flows"][1]["gateway"]["requests"]]
    assert outcomes == ["SUCCEEDED", "NOT_SENT_BUDGET_STOP"]
    assert report["totals"]["service_repairs"] >= 3 and report["totals"]["retries"] == 0


def refusal(status):
    return ModelGatewayError(
        "refused",
        transport=TransportDiagnostic(
            phase="RESPONSE_HEADERS",
            kind="HTTP_ERROR",
            elapsed_ms=30,
            timeout_seconds=60,
            http_status=status,
        ),
    )


@pytest.mark.parametrize(
    "error, stopped",
    [
        (refusal(429), "PROVIDER_REFUSED_HTTP_429"),
        (refusal(402), "PROVIDER_REFUSED_HTTP_402"),
        (ModelAuthenticationError("bad key"), "AUTHENTICATION_FAILED"),
    ],
)
def test_a_payment_rate_limit_or_credential_refusal_stops_the_whole_run(tmp_path, error, stopped):
    inner = Nvidia(error, text(), repeat_last=False)
    code, _, report = run_armed(tmp_path, live_flow_dict(), inner)
    assert code == 0 and report["stopped_by"] == stopped
    assert len(report["flows"]) == 1 and len(inner.sent) == 1  # the second model is never asked
    assert report["flows"][0]["run_status"] == "FAILED"


def test_an_ordinary_provider_error_is_recorded_and_the_next_model_still_runs(tmp_path):
    inner = Nvidia(ModelProviderUnavailableError("down"), text())
    code, _, report = run_armed(tmp_path, live_flow_dict(), inner)
    assert code == 0 and report["stopped_by"] is None and len(inner.sent) == 2
    assert [f["run_status"] for f in report["flows"]] == ["FAILED", "FAILED"]
    assert report["flows"][1]["run_error_code"] == "PROPOSAL_NOT_PRODUCED"  # it ran; plain text is no proposal
    assert report["flows"][0]["run_error_code"] == "PROVIDER_UNAVAILABLE"


def test_a_reply_from_another_model_stops_the_whole_run(tmp_path):
    class Foreign:
        def __init__(self):
            self.sent = []

        def generate(self, request):
            self.sent.append(request)
            return ModelResponse(
                content="x",
                usage=ModelUsage(5, 5, 4),
                model_identifier="private/other-model",
                provider="nvidia",
            )

    foreign = Foreign()
    code, _, report = run_armed(tmp_path, live_flow_dict(), foreign)
    assert code == 0 and report["stopped_by"] == "MODEL_IDENTITY_MISMATCH"
    assert len(report["flows"]) == 1 and len(foreign.sent) == 1


@needs_worker
def test_conforming_proposals_for_every_model_wait_for_approval_and_nothing_runs(tmp_path):
    inner = Nvidia(call(proposal), repeat_last=True)
    code, _, report = run_armed(tmp_path, live_flow_dict(), inner)
    assert code == 0 and report["stopped_by"] is None
    for flow_report in report["flows"]:
        assert flow_report["run_status"] == "WAITING_FOR_APPROVAL"
        assert flow_report["result"] == "PROPOSAL_VALID_FOR_PROMPT"
        assert flow_report["first_attempt_accepted"] is True
        assert flow_report["side_effects"] == {
            "approvals_decided": 0,
            "calculations": 0,
            "compute_jobs": 0,
        }
    assert report["totals"]["requests_admitted"] == 2


def test_the_flow_path_asks_for_a_gateway_with_the_authorized_read_timeout(tmp_path, monkeypatch):
    seen = []

    def spy(auth, environ, gateway_factory, timeout_seconds):
        seen.append(timeout_seconds)
        return Nvidia(text(), repeat_last=True)

    monkeypatch.setattr(runner, "_build_gateway", spy)
    data = live_flow_dict(flow={**flow_dict()["flow"], "read_timeout_seconds": 90})
    code, _, report = run_armed(tmp_path, data, None)
    assert code == 0 and seen == [90] and report["stopped_by"] is None


def test_the_probe_path_keeps_its_fixed_read_timeout(tmp_path, monkeypatch, fixture):
    from test_nvidia_probe_preflight import ScriptedGateway, write_authorization

    seen = []

    def spy(auth, environ, gateway_factory, timeout_seconds):
        seen.append(timeout_seconds)
        return ScriptedGateway(fixture)

    monkeypatch.setattr(runner, "_build_gateway", spy)
    path = write_authorization(tmp_path, max_total_calls=3, max_total_tokens=14_000)
    code = runner.main(
        ["--authorization", str(path), "--execute", "--output", str(tmp_path / "out")],
        environ=armed(path),
        out=lambda line: None,
    )
    assert code == 0 and seen == [60]


def test_flow_execute_without_a_private_key_file_is_refused_before_any_network(
    tmp_path, monkeypatch
):
    path = tmp_path / "flow-authorization.json"
    path.write_text(json.dumps(live_flow_dict()))
    key = tmp_path / "key"
    key.write_text(SENTINEL)
    key.chmod(0o644)  # group/world readable
    monkeypatch.setattr(runner, "install_host_allowlist", lambda *a, **k: pytest.fail("installed"))
    for key_file in (key, tmp_path / "missing"):
        lines: list[str] = []
        environ = {**armed(path), runner.KEY_FILE_ENV: str(key_file)}
        code = runner.main(
            ["--authorization", str(path), "--execute", "--output", str(tmp_path / "out")],
            environ=environ,
            out=lines.append,
        )
        assert code == 2 and lines[0].startswith("REFUSED:") and SENTINEL not in " ".join(lines)
    assert not (tmp_path / "out").exists()


def test_the_real_gateway_is_built_with_the_authorizations_read_timeout(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "install_host_allowlist", lambda *args, **kwargs: None)
    key = tmp_path / "key"
    key.write_text("not-a-real-key\n")
    key.chmod(0o600)
    auth = flow_authorize()
    gateway = runner._build_gateway(
        auth, {runner.KEY_FILE_ENV: str(key)}, None, auth.flow.read_timeout_seconds
    )
    assert type(gateway).__name__ == "HttpOpenAIModelGateway"
    assert gateway._timeout == 120
    probe = runner._build_gateway(auth, {runner.KEY_FILE_ENV: str(key)}, None, 60)
    assert probe._timeout == 60  # probe mode keeps its fixed read timeout
    key.chmod(0o644)
    with pytest.raises(AuthorizationError) as refused:
        runner._build_gateway(auth, {runner.KEY_FILE_ENV: str(key)}, None, 60)
    assert refused.value.code == "KEY_FILE_NOT_PRIVATE"
