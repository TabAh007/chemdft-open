"""AI-6 offline checks: strict request matching, structured repair feedback and the real blocker.

The real AI Scientist service runs on a disposable replica (tools/nvidia_probe/flow.py) with a
scripted gateway standing in for the model; nothing here contacts a provider or runs an engine.
Flows that reach the approval step ask the PySCF worker only for its version (as every
approval-flow test does) and skip where the ignored worker environment is absent.
"""

import json
import sys
from pathlib import Path

import pytest
from test_nvidia_probe_flow import (
    SENTINEL,
    Script,
    call,
    context_of,
    mutated,
    needs_worker,
    no_basis,
    other_basis,
    proposal,
    text,
    wrong_version,
)

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import plan as probe_plan  # noqa: E402
from nvidia_probe.flow import ProductionFlow  # noqa: E402

HF_STO3G = probe_plan.load_fixture()["user_prompt"]
PBE0_PROMPT = (
    "Calculate the PBE0/def2-SVP single-point energy for H2 with charge 0 and multiplicity 1."
)
OPEN_PROMPT = "Calculate the single-point energy for H2."


@pytest.fixture(scope="module")
def flow():
    with ProductionFlow.build(probe_plan.load_fixture()) as built:
        yield built


def tool_message(request):
    message = request.messages[-1]
    assert message.role == "tool"
    return json.loads(message.content)


def refusal_steps(verdict):
    return [s for s in verdict["steps"] if s["tool"] == "calculation.submit" and s["refusal"]]


def multiplicity_three(arguments):
    arguments["specification"]["multiplicity"] = 3


def schema_breaker(arguments):
    arguments["specification"]["charge"] = f"{SENTINEL}-charge"
    arguments["specification"]["invented_option"] = SENTINEL


def test_a_substituted_basis_is_refused_with_the_requested_value_before_any_engine_check(flow):
    gateway = Script(call(mutated(other_basis)), repeat_last=True)
    verdict = flow.run(gateway, max_model_calls=1, prompt=HF_STO3G)
    (step,) = refusal_steps(verdict)
    assert step["refusal"] == "REQUEST_MISMATCH"
    assert step["refusal_fields"] == ["specification.basis.identifier"]
    assert verdict["approvals"] == [] and verdict["side_effects"]["compute_jobs"] == 0


def test_the_model_receives_what_was_asked_what_it_proposed_and_what_to_do(flow):
    gateway = Script(call(mutated(other_basis)), text("done"))
    flow.run(gateway, max_model_calls=3, prompt=HF_STO3G)
    feedback = tool_message(gateway.requests[1])
    assert feedback["error"] == "The proposal does not match what the researcher asked for."
    assert feedback["code"] == "REQUEST_MISMATCH"
    (issue,) = feedback["issues"]
    assert (issue["field"], issue["requested"], issue["proposed"]) == (
        "specification.basis.identifier",
        "sto-3g",
        "6-31g",
    )
    assert "Use the requested value" in issue["message"]
    assert "Correct only the listed fields" in feedback["next_step"]


@needs_worker
def test_a_refused_proposal_is_repaired_and_the_approval_records_the_match(flow):
    gateway = Script(call(mutated(other_basis)), call(proposal))
    verdict = flow.run(gateway, max_model_calls=3, prompt=HF_STO3G)
    assert verdict["run_status"] == "WAITING_FOR_APPROVAL"
    assert verdict["repairs"] == 1 and verdict["first_attempt_accepted"] is False
    approval = flow.last_detail.latest_run.pending_approval
    assert approval.proposal_provenance.repair_attempts == 1
    assert approval.proposal_provenance.sampling.source == "SERVER_DEFAULT"
    outcomes = {item.parameter: item.outcome for item in approval.request_match}
    assert outcomes == {
        "task": "MATCH",
        "engine": "NOT_SPECIFIED",
        "method": "MATCH",
        "basis": "MATCH",
        "charge": "MATCH",
        "multiplicity": "MATCH",
    }


@needs_worker
def test_parameters_the_request_does_not_name_are_reported_as_not_specified(flow):
    verdict = flow.run(Script(call(mutated(other_basis))), max_model_calls=2, prompt=OPEN_PROMPT)
    assert verdict["run_status"] == "WAITING_FOR_APPROVAL" and verdict["repairs"] == 0
    approval = flow.last_detail.latest_run.pending_approval
    outcomes = {item.parameter: item.outcome for item in approval.request_match}
    assert outcomes["task"] == "MATCH"
    assert {outcomes[p] for p in ("engine", "method", "basis", "charge", "multiplicity")} == {
        "NOT_SPECIFIED"
    }
    assert all(
        item.requested is None for item in approval.request_match if item.parameter != "task"
    )


def test_a_proposal_that_never_matches_ends_the_run_with_the_actual_blocker(flow):
    gateway = Script(call(mutated(other_basis)), repeat_last=True)
    verdict = flow.run(gateway, max_model_calls=10, prompt=HF_STO3G)
    assert len(gateway.requests) == 3  # one proposal and two repairs, then the bound
    assert (
        verdict["run_status"] == "FAILED" and verdict["run_error_code"] == "PROPOSAL_NOT_REPAIRED"
    )
    assert len(refusal_steps(verdict)) == 3 and verdict["approvals"] == []
    assert verdict["side_effects"] == {"approvals_decided": 0, "calculations": 0, "compute_jobs": 0}
    run = flow.last_detail.latest_run
    assert (
        run.error_code == "PROPOSAL_NOT_REPAIRED"
        and "No valid proposal after 3 attempts" in run.error_detail
    )
    blocker = run.blocker
    assert (blocker.code, blocker.attempts) == ("REQUEST_MISMATCH", 3)
    (issue,) = blocker.issues
    assert (issue.field, issue.requested, issue.proposed) == (
        "specification.basis.identifier",
        "sto-3g",
        "6-31g",
    )
    explained = [m for m in flow.last_detail.messages if m.role == "assistant"]
    assert explained and "Nothing was submitted or computed" in explained[-1].content
    assert "Last blocker: The proposal does not match" in explained[-1].content


def test_the_blocker_changes_no_requirement_the_researcher_stated(flow):
    gateway = Script(call(mutated(other_basis)), repeat_last=True)
    flow.run(gateway, max_model_calls=10, prompt=HF_STO3G)
    user = [m for m in flow.last_detail.messages if m.role == "user"]
    assert user[-1].content == HF_STO3G  # the request is kept exactly as written
    assert all("6-31g" not in m.content.lower() for m in user)


def test_a_request_the_server_cannot_run_is_explained_not_substituted(flow):
    gateway = Script(
        call(
            lambda request: {
                **proposal(request),
                "specification": {
                    **proposal(request)["specification"],
                    "method": {
                        "identifier": "pbe",
                        "display_name": "PBE",
                        "registry": "chemdft.method",
                    },
                    "basis": {
                        "identifier": "def2-svp",
                        "display_name": "def2-SVP",
                        "registry": "chemdft.basis",
                    },
                },
            }
        ),
        text("PBE0 is not available in ChemDFT here; HF, B3LYP and PBE are."),
    )
    verdict = flow.run(gateway, max_model_calls=3, prompt=PBE0_PROMPT)
    feedback = tool_message(gateway.requests[1])
    (issue,) = feedback["issues"]
    assert issue["requested"] == "pbe0" and issue["field"] == "specification.method.identifier"
    assert issue["allowed"] == ["b3lyp", "hf", "pbe"]
    assert "Do not substitute another method" in issue["message"]
    assert "tell the researcher in plain text" in feedback["next_step"]
    # The model explained, so the run ends as an answer: nothing was proposed, approved or computed.
    assert verdict["run_status"] == "SUCCEEDED" and verdict["approvals"] == []
    assert flow.last_detail.messages[-1].content.startswith("PBE0 is not available")


def test_a_state_that_disagrees_with_the_structure_is_refused_first_by_its_own_validator(flow):
    """The structure's declared state outranks any wording; the matcher is the gate after it."""
    prompt = "Calculate the HF/STO-3G energy of the singlet H2 with charge 0."
    gateway = Script(call(mutated(multiplicity_three)), text("ok"))
    verdict = flow.run(gateway, max_model_calls=2, prompt=prompt)
    (step,) = refusal_steps(verdict)
    assert step["refusal"] == "ELECTRONIC_STATE"
    feedback = tool_message(gateway.requests[1])
    assert feedback["code"] == "ELECTRONIC_STATE" and feedback["issues"][0]["field"] == (
        "specification.charge"
    )
    assert "Structure electronic state mismatch" in feedback["error"]


def test_a_wrong_structure_version_is_answered_with_the_selected_one(flow):
    gateway = Script(call(mutated(wrong_version)), text("ok"))
    verdict = flow.run(gateway, max_model_calls=2, prompt=HF_STO3G)
    selected = str(context_of(gateway.requests[0]).selection.selected_structure_version_id)
    feedback = tool_message(gateway.requests[1])
    assert feedback["code"] == "STRUCTURE_VERSION"
    (issue,) = feedback["issues"]
    assert issue["field"] == "structure_version.entity_id" and issue["allowed"] == [selected]
    assert refusal_steps(verdict)[0]["refusal"] == "STRUCTURE_VERSION"


def test_schema_feedback_names_fields_and_problems_but_never_echoes_values(flow):
    gateway = Script(call(mutated(schema_breaker)), text("ok"))
    verdict = flow.run(gateway, max_model_calls=2, prompt=HF_STO3G)
    feedback = tool_message(gateway.requests[1])
    assert feedback["error"] == "Tool arguments failed schema validation."
    assert feedback["code"] == "ARGUMENT_SCHEMA" and feedback["issues"]
    assert {issue["code"] for issue in feedback["issues"]} <= {
        "REQUIRED", "NOT_ALLOWED", "INVALID_CHOICE", "WRONG_TYPE", "INVALID_VALUE", "INVALID",
        "TOO_SHORT", "TOO_LONG", "OUT_OF_RANGE",
    }  # fmt: skip
    wire = (
        json.dumps(feedback)
        + json.dumps(verdict)
        + json.dumps([m.content for m in flow.last_detail.messages])
    )
    assert SENTINEL not in wire.replace(HF_STO3G, "")  # nothing the model typed is repeated


@needs_worker
def test_a_missing_basis_is_explained_from_the_engine_tables_when_the_request_names_none(flow):
    gateway = Script(call(mutated(no_basis)), call(proposal))
    verdict = flow.run(gateway, max_model_calls=3, prompt=OPEN_PROMPT)
    (step,) = refusal_steps(verdict)
    assert step["refusal"] == "ENGINE_CAPABILITY"
    feedback = tool_message(gateway.requests[1])
    (issue,) = feedback["issues"]
    assert issue["field"] == "specification.basis"
    assert issue["allowed"] == ["6-31g", "def2-svp", "def2-svpd", "sto-3g"]
    assert verdict["run_status"] == "WAITING_FOR_APPROVAL" and verdict["repairs"] == 1
