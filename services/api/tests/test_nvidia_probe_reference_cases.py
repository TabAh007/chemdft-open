"""Flow authorization for the reference molecules: water and ethanol cases, offline only.

A flow authorization may name planning cases (tools/nvidia_probe/molecules.py). Each model then runs
each case on a fresh project holding that case's real molecule, sized from that case's own measured
request, judged against that case's expected parameters, and bound to the exact prompts and
structure files by a digest. These tests cover the schema, the binding, the sizing, the run order
and quota, the verdicts and the CLI, with fake gateways only: no key, no name resolution, no
socket.
"""

import json
import sys
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from chemdft_api.ai.gateway import ModelProviderUnavailableError
from test_nvidia_probe_flow import call, context_of, needs_worker, text
from test_nvidia_probe_flow_cli import STEP5, SUPER, cli, flow_dict, refusal, run_armed
from test_nvidia_probe_preflight import NOW

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import molecules  # noqa: E402
from nvidia_probe import plan as probe_plan  # noqa: E402
from nvidia_probe.authorization import (  # noqa: E402
    FIXTURE_ID,
    SCHEMA,
    AuthorizationError,
    parse_authorization,
)
from nvidia_probe.flow import (  # noqa: E402
    ProductionFlow,
    measure_first_request,
    measure_flow,
    plan_flow,
)
from nvidia_probe.molecules import (  # noqa: E402
    PLANNING_CASES,
    REFERENCE_FIXTURE_ID,
    case_by_id,
    reference_cases_digest,
)

WATER, ETHANOL = "h2o-pbe-def2svp", "ethanol-b3lyp-631g"
UNAVAILABLE = "ethanol-unavailable-pbe0"
PROMPTS = {case.prompt: case for case in PLANNING_CASES}
SENTINEL = "SENTINEL-PRIVATE-VALUE-3107"
EXAMPLE = ROOT / "tools/nvidia_probe/authorization.reference-cases.example.json"


def ref_dict(cases=(WATER, ETHANOL), now=NOW, per_flow=2, calls=6, **overrides):
    data = flow_dict(now=now, **overrides)
    data["fixture"] = REFERENCE_FIXTURE_ID
    data["flow"] = {
        **data["flow"],
        "max_model_calls_per_model": per_flow,
        "cases": list(cases),
        "cases_sha256": reference_cases_digest(cases),
    }
    data["max_total_calls"] = calls
    return data


def ref_authorize(**kwargs):
    return parse_authorization(json.dumps(ref_dict(**kwargs)).encode(), now=NOW)


def live_ref_dict(**kwargs):
    return ref_dict(now=datetime.now(UTC), **kwargs)


class CaseModel:
    """Answers each flow as a model would, chosen by the case whose prompt it is asked."""

    def __init__(self, behaviour):
        self.behaviour, self.sent = behaviour, []

    def generate(self, request):
        self.sent.append(request)
        prompt = next(m.content for m in request.messages if m.role == "user")
        step = self.behaviour(PROMPTS[prompt])
        if isinstance(step, Exception):
            raise step
        return replace(step(request), provider="nvidia", model_identifier=request.model_identifier)


def proposing(case):
    """A conforming model's proposal for exactly what the case asks."""
    expect = case.expect

    def shape(request):
        context = context_of(request)
        return {
            "structure_version": {
                "project_id": str(context.project_id),
                "entity_type": "structure.version",
                "entity_id": str(context.selection.selected_structure_version_id),
            },
            "specification": {
                "task_type": expect["task"],
                "method": {"identifier": expect["method"]},
                "basis": {"identifier": expect["basis"]},
                "charge": expect["charge"],
                "multiplicity": expect["multiplicity"],
                "engine_preference": {"engine": expect["engine"]},
            },
            "provider_preference": "AUTO",
        }

    return call(shape)


def hf_sto3g_regardless(_case):
    """A naive model that proposes HF/STO-3G whatever it was asked for."""
    naive = {"task": "ENERGY", "method": "hf", "basis": "sto-3g", "charge": 0, "multiplicity": 1}
    return proposing(replace(case_by_id("h2-hf-sto3g"), expect={**naive, "engine": "pyscf"}))


@pytest.fixture(scope="module")
def fixture():
    return probe_plan.load_fixture()


@pytest.fixture(scope="module")
def flow(fixture):
    with ProductionFlow.build(fixture) as built:
        yield built


# --- the binding: what was reviewed is what runs -------------------------------------------------


def test_the_digest_is_bound_to_prompts_expectations_molecules_and_order(monkeypatch):
    digest = reference_cases_digest([WATER, ETHANOL])
    assert len(digest) == 64 and digest == reference_cases_digest([WATER, ETHANOL])
    assert digest != reference_cases_digest([ETHANOL, WATER])  # the order is the run order
    assert digest != reference_cases_digest([WATER])
    cases = list(molecules.PLANNING_CASES)
    index = next(i for i, c in enumerate(cases) if c.id == WATER)
    for change in (
        {"prompt": cases[index].prompt + " Use a tight grid."},
        {"expect": {**cases[index].expect, "basis": "6-31g"}},
        {"kind": "EXPLAIN_UNAVAILABLE"},
    ):
        edited = [*cases[:index], replace(cases[index], **change), *cases[index + 1 :]]
        monkeypatch.setattr(molecules, "PLANNING_CASES", tuple(edited))
        assert reference_cases_digest([WATER, ETHANOL]) != digest, change
    monkeypatch.setattr(molecules, "PLANNING_CASES", tuple(cases))
    assert reference_cases_digest([WATER, ETHANOL]) == digest
    real = molecules.reference_molecules()
    tampered = {**real, "h2o": replace(real["h2o"], sha256="0" * 64)}
    monkeypatch.setattr(molecules, "reference_molecules", lambda: tampered)
    with pytest.raises(ValueError, match="REFERENCE_MOLECULE_HASH_MISMATCH"):
        reference_cases_digest([WATER])


def test_a_reference_authorization_names_its_cases_and_carries_their_digest():
    approved = ref_authorize()
    assert approved.flow.cases == (WATER, ETHANOL)
    assert approved.flow.cases_sha256 == reference_cases_digest([WATER, ETHANOL])
    assert approved.flow.max_model_calls_per_model == 2 and approved.max_total_calls == 6
    assert approved.models == (SUPER, STEP5) and approved.case_plan is None


def test_an_authorization_without_cases_is_still_the_supplied_h2_flow():
    approved = parse_authorization(json.dumps(flow_dict()).encode(), now=NOW)
    assert approved.flow.cases == () and approved.flow.cases_sha256 is None


@pytest.mark.parametrize(
    "mutate, code",
    [
        (
            lambda d: d.update(fixture=FIXTURE_ID),
            "FIXTURE_MISMATCH",
        ),  # cases need their own fixture
        (lambda d: (d["flow"].pop("cases"), d["flow"].pop("cases_sha256")), "FIXTURE_MISMATCH"),
        (lambda d: d["flow"].pop("cases_sha256"), "FLOW_INVALID"),  # both or neither
        (lambda d: d["flow"].pop("cases"), "FLOW_INVALID"),
        (lambda d: d["flow"].update(cases=["no-such-case"]), "CASES_INVALID"),
        (lambda d: d["flow"].update(cases=[WATER, WATER]), "CASES_INVALID"),
        (lambda d: d["flow"].update(cases=[]), "CASES_INVALID"),
        (lambda d: d["flow"].update(cases=WATER), "CASES_INVALID"),
        (lambda d: d["flow"].update(cases=[3]), "CASES_INVALID"),
        (lambda d: d["flow"].update(cases_sha256="0" * 64), "CASES_CHANGED"),
        (lambda d: d["flow"].update(cases=[ETHANOL, WATER]), "CASES_CHANGED"),  # reordered
        (lambda d: d["flow"].update(extra=1), "FLOW_INVALID"),
        (
            lambda d: d.update(max_total_calls=3, max_total_tokens=100_000),
            "FLOW_INVALID",
        ),  # < 4 flows
        (lambda d: d.update(max_total_calls=9), "FLOW_INVALID"),  # more than 4 flows x 2 per flow
    ],
)
def test_an_invalid_reference_authorization_is_refused(mutate, code):
    data = ref_dict()
    mutate(data)
    with pytest.raises(AuthorizationError) as refused:
        parse_authorization(json.dumps(data).encode(), now=NOW)
    assert refused.value.code == code


def test_cases_exist_only_in_the_flow_schema():
    probe_shaped = ref_dict()
    probe_shaped["schema"] = SCHEMA
    with pytest.raises(AuthorizationError) as refused:
        parse_authorization(json.dumps(probe_shaped).encode(), now=NOW)
    assert refused.value.code == "KEYS_MISMATCH"  # a probe file may not carry a flow block


def test_the_shipped_reference_example_is_refused_until_the_owner_completes_it():
    raw = EXAMPLE.read_bytes()
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
    assert approved.flow.cases == (WATER, ETHANOL) and approved.models == (SUPER, STEP5)
    assert json.loads(raw)["spend_control"]["acknowledged_no_cost_information"] is False


# --- sizing from each case's own request ----------------------------------------------------------


def test_each_case_is_measured_on_its_own_molecule_and_prompt(flow):
    sizes = {
        case_id: measure_first_request(flow, case_by_id(case_id)) for case_id in (WATER, ETHANOL)
    }
    assert sizes[WATER]["reserved_input_tokens"] != sizes[ETHANOL]["reserved_input_tokens"]
    for measured in sizes.values():
        assert measured["tools"] == ["calculation.submit", "structure.version.get"]
        assert measured["output_token_cap"] == 2_048
        assert 0 < measured["reserved_input_tokens"] < measured["conservative_input_bound"] < 32_768
    assert measure_flow(flow, ref_authorize()) == sizes
    h2 = measure_flow(flow, parse_authorization(json.dumps(flow_dict()).encode(), now=NOW))
    assert h2 == measure_first_request(flow) and "reserved_input_tokens" in h2


def test_a_cases_request_carries_its_prompt_and_its_molecule(fixture):
    seen = {}
    with ProductionFlow.build(fixture) as built:
        for case_id, atoms in ((WATER, 3), (ETHANOL, 9)):
            gateway = CaseModel(lambda _case: text("Done."))
            built.run(gateway, max_model_calls=1, case=case_by_id(case_id))
            request = gateway.sent[0]
            seen[case_id] = (
                next(m.content for m in request.messages if m.role == "user"),
                len(context_of(request).scientific_input.version.coordinates.atoms),
            )
            assert atoms == seen[case_id][1]
    assert seen[WATER][0] == case_by_id(WATER).prompt
    assert seen[ETHANOL][0] == case_by_id(ETHANOL).prompt


def test_the_reference_plan_covers_every_flow_and_plans_for_the_largest_requests(flow):
    approved = ref_authorize()
    measurement = measure_flow(flow, approved)
    plan = plan_flow(approved, measurement)
    assert plan["refusal"] is None and plan["planned_flows"] == 4 and plan["planned_requests"] == 6
    assert "service_request" not in plan and set(plan["service_requests"]) == {WATER, ETHANOL}
    assert plan["reference_cases"] == {
        "ids": [WATER, ETHANOL],
        "sha256": reference_cases_digest([WATER, ETHANOL]),
    }
    largest = max(m["reserved_input_tokens"] for m in measurement.values())
    assert plan["largest_planned_input_tokens"] == largest + (2_048 + 512)  # one repair deep
    assert plan["planned_worst_case_utilization"] <= 0.6 and plan["worst_case_usd"] == "UNKNOWN"


@pytest.mark.parametrize(
    "overrides, code",
    [
        (
            {"per_flow": 3},  # three requests per flow do not fit the margin at 6 calls
            "REFUSED_INSUFFICIENT_MARGIN",
        ),
        (
            {"max_input_tokens_per_request": 17_000, "max_total_tokens": 100_000},
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
def test_a_reference_plan_the_real_requests_cannot_honour_is_refused(flow, overrides, code):
    approved = ref_authorize(**overrides)
    refused = plan_flow(approved, measure_flow(flow, approved))["refusal"]
    assert refused is not None and refused[0] == code, overrides


# --- running the flows ---------------------------------------------------------------------------


def test_an_armed_reference_run_asks_every_model_every_case_in_the_authorized_order(tmp_path):
    inner = CaseModel(lambda _case: text(f"nothing to propose {SENTINEL}"))
    code, lines, report = run_armed(tmp_path, live_ref_dict(), inner)
    assert code == 0 and lines[-1].endswith("(stopped_by=None)")
    assert [(f["case"], f["model"]) for f in report["flows"]] == [
        (WATER, SUPER),
        (WATER, STEP5),
        (ETHANOL, SUPER),
        (ETHANOL, STEP5),
    ]
    assert [r.model_identifier for r in inner.sent] == [SUPER, STEP5, SUPER, STEP5]
    assert [next(m.content for m in r.messages if m.role == "user") for r in inner.sent] == [
        case_by_id(c).prompt for c in (WATER, WATER, ETHANOL, ETHANOL)
    ]
    assert [f["molecule"] for f in report["flows"]] == ["h2o", "h2o", "ethanol", "ethanol"]
    assert {f["case_kind"] for f in report["flows"]} == {"PROPOSE"}
    assert report["totals"]["requests_admitted"] == 4 and report["totals"]["retries"] == 0
    assert report["totals"]["flows_planned"] == report["totals"]["flows_run"] == 4
    assert report["service_request"] == {} and set(
        report["reference_cases"]["service_requests"]
    ) == {
        WATER,
        ETHANOL,
    }
    assert report["reference_cases"]["sha256"] == reference_cases_digest([WATER, ETHANOL])
    # model-card sampling still goes to the right model; nothing said or asked is kept
    assert dict(inner.sent[0].chat_template_kwargs) == {"enable_thinking": True, "low_effort": True}
    assert inner.sent[1].chat_template_kwargs is None and inner.sent[0].temperature == 1.0
    dumped = json.dumps(report)
    assert SENTINEL not in dumped
    for case in (case_by_id(WATER), case_by_id(ETHANOL)):
        assert case.prompt not in dumped


@needs_worker
def test_conforming_proposals_for_every_case_wait_for_approval_and_meet_their_expectation(tmp_path):
    inner = CaseModel(proposing)
    code, _, report = run_armed(tmp_path, live_ref_dict(), inner)
    assert code == 0 and report["stopped_by"] is None and len(inner.sent) == 4
    for flow_report in report["flows"]:
        assert flow_report["run_status"] == "WAITING_FOR_APPROVAL"
        assert flow_report["result"] == "PROPOSAL_VALID_FOR_PROMPT"
        assert flow_report["case_expectation_met"] is True and flow_report["repairs"] == 0
        assert flow_report["side_effects"] == {
            "approvals_decided": 0,
            "calculations": 0,
            "compute_jobs": 0,
        }
        (approval,) = flow_report["approvals"]
        assert approval["status"] == "PENDING" and approval["adherence_failure_codes"] == []
        outcomes = approval["request_check"]
        for parameter in ("task", "engine", "method", "basis", "charge", "multiplicity"):
            assert outcomes[parameter] == "MATCH", (flow_report["case"], parameter)


@needs_worker
def test_a_proposal_that_ignores_the_request_is_refused_and_does_not_reach_approval(tmp_path):
    inner = CaseModel(hf_sto3g_regardless)
    code, _, report = run_armed(tmp_path, live_ref_dict(), inner)
    assert code == 0
    for flow_report in report["flows"]:
        assert flow_report["approvals"] == [] and flow_report["result"] == "NO_PROPOSAL"
        assert flow_report["case_expectation_met"] is False
        refused = [s for s in flow_report["steps"] if s["tool"] == "calculation.submit"]
        assert refused and all(s["refusal"] == "REQUEST_MISMATCH" for s in refused)
        assert "specification.method.identifier" in refused[0]["refusal_fields"]
        assert flow_report["side_effects"]["compute_jobs"] == 0


@needs_worker
def test_each_flow_keeps_one_request_for_every_later_flow(tmp_path):
    # Five calls for four flows of at most two: the first stubborn flow may not take a third.
    data = live_ref_dict(calls=5, max_total_tokens=174_000)
    inner = CaseModel(hf_sto3g_regardless)
    code, _, report = run_armed(tmp_path, data, inner)
    assert code == 0 and report["stopped_by"] is None
    assert [len(f["gateway"]["requests"]) for f in report["flows"]] == [2, 1, 1, 1]
    assert report["totals"]["requests_admitted"] == 5 and len(inner.sent) == 5
    assert report["totals"]["flows_run"] == report["totals"]["flows_planned"] == 4


def test_a_payment_refusal_stops_the_whole_reference_run(tmp_path):
    inner = CaseModel(lambda _case: refusal(429))
    code, _, report = run_armed(tmp_path, live_ref_dict(), inner)
    assert code == 0 and report["stopped_by"] == "PROVIDER_REFUSED_HTTP_429"
    assert len(report["flows"]) == 1 and len(inner.sent) == 1
    assert report["totals"]["flows_run"] == 1 and report["totals"]["flows_planned"] == 4


def test_an_ordinary_provider_error_is_recorded_and_the_next_flow_still_runs(tmp_path):
    calls = []

    def behaviour(case):
        calls.append(case.id)
        return text("done") if len(calls) > 1 else ModelProviderUnavailableError("down")

    code, _, report = run_armed(tmp_path, live_ref_dict(), CaseModel(behaviour))
    assert code == 0 and report["stopped_by"] is None and len(report["flows"]) == 4
    assert report["flows"][0]["run_status"] == "FAILED"
    assert report["flows"][0]["run_error_code"] == "PROVIDER_UNAVAILABLE"
    # the later flows ran (plain text, no proposal), so each ends PROPOSAL_NOT_PRODUCED
    assert {f["run_status"] for f in report["flows"][1:]} == {"FAILED"}
    assert {f["run_error_code"] for f in report["flows"][1:]} == {"PROPOSAL_NOT_PRODUCED"}


def test_a_case_that_asks_for_the_unavailable_expects_no_proposal(tmp_path):
    data = live_ref_dict(cases=(UNAVAILABLE,), calls=2, per_flow=1, max_total_tokens=65_000)
    inner = CaseModel(lambda _case: text("PBE0 cannot be run here."))
    code, _, report = run_armed(tmp_path, data, inner)
    assert code == 0 and [f["case"] for f in report["flows"]] == [UNAVAILABLE, UNAVAILABLE]
    for flow_report in report["flows"]:
        assert flow_report["case_kind"] == "EXPLAIN_UNAVAILABLE"
        assert (
            flow_report["result"] == "NO_PROPOSAL" and flow_report["case_expectation_met"] is True
        )


@needs_worker
def test_a_proposal_for_an_unavailable_request_is_never_the_expected_outcome(tmp_path):
    # The server's own request check refuses it first; were one ever to reach approval, it is wrong.
    data = live_ref_dict(cases=(UNAVAILABLE,), calls=2, per_flow=1, max_total_tokens=65_000)
    code, _, report = run_armed(tmp_path, data, CaseModel(hf_sto3g_regardless))
    assert code == 0
    for flow_report in report["flows"]:
        assert flow_report["approvals"] == [] and flow_report["case_expectation_met"] is True
        assert flow_report["steps"][0]["refusal"] == "REQUEST_MISMATCH"


# --- the command line ----------------------------------------------------------------------------


def test_validate_only_prints_the_cases_and_each_requests_size_and_builds_no_gateway(tmp_path):
    code, lines, _ = cli(tmp_path, live_ref_dict())
    assert code == 0
    summary = json.loads("\n".join(lines))
    assert summary["mode"] == "FLOW_VALIDATE_ONLY_NO_NETWORK" and summary["never_approves"] is True
    assert summary["reference_cases"]["ids"] == [WATER, ETHANOL]
    assert summary["planned_flows"] == 4 and summary["planned_requests"] == 6
    assert set(summary["service_requests"]) == {WATER, ETHANOL} and "service_request" not in summary
    assert summary["planned_worst_case_utilization"] <= 0.6
    assert (summary["retries"], summary["fallback"]) == (0, "none")


def test_a_reference_run_is_refused_without_the_exact_arming(tmp_path):
    code, lines, _ = cli(tmp_path, live_ref_dict(), "--execute")
    assert code == 2 and lines == ["REFUSED_NOT_ARMED"]


def test_an_unfit_reference_plan_is_refused_with_its_reason_and_exit_code(tmp_path):
    code, lines, _ = cli(tmp_path, live_ref_dict(per_flow=3))
    assert code == 2 and lines[0].startswith("REFUSED_INSUFFICIENT_MARGIN")


def test_a_case_edited_after_review_refuses_the_authorization_before_anything_else(
    tmp_path, monkeypatch
):
    data = live_ref_dict()
    cases = list(molecules.PLANNING_CASES)
    index = next(i for i, c in enumerate(cases) if c.id == ETHANOL)
    cases[index] = replace(cases[index], prompt=cases[index].prompt + " Also report the dipole.")
    monkeypatch.setattr(molecules, "PLANNING_CASES", tuple(cases))
    code, lines, _ = cli(tmp_path, data)
    assert code == 2 and "CASES_CHANGED" in lines[0]
