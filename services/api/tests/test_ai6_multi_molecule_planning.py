"""AI-6 offline checks: the planning workflow on H2, water and ethanol, case by case.

Each reference molecule is imported through the real import actions and the real AI Scientist
service runs its planning cases with a scripted model: a competent one that proposes exactly what
was asked, and a naive one that tries to substitute or to keep going. A proposal that is valid for
the request waits for the researcher; a request the server cannot meet ends as an explanation.
Nothing is approved, no engine runs and no result exists.
"""

import json
import sys
from pathlib import Path

import pytest
from test_nvidia_probe_flow import Script, call, context_of, needs_worker, text

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import plan as probe_plan  # noqa: E402
from nvidia_probe.flow import ProductionFlow  # noqa: E402
from nvidia_probe.molecules import PLANNING_CASES, reference_molecules  # noqa: E402

MOLECULES = reference_molecules()
PROPOSE = [c for c in PLANNING_CASES if c.kind == "PROPOSE"]
EXPLAIN = [c for c in PLANNING_CASES if c.kind != "PROPOSE"]


@pytest.fixture(scope="module")
def flow():
    with ProductionFlow.build(probe_plan.load_fixture()) as built:
        yield built


def proposing(expect):
    """What a competent model sends for the selected structure, built from the request context."""

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


def hf_sto3g_regardless():
    """A naive model that proposes HF/STO-3G whatever it was asked for."""
    return proposing(
        {
            "task": "ENERGY",
            "method": "hf",
            "basis": "sto-3g",
            "charge": 0,
            "multiplicity": 1,
            "engine": "pyscf",
        }
    )


def tool_message(request):
    return json.loads(request.messages[-1].content)


@needs_worker
@pytest.mark.parametrize("case", PROPOSE, ids=lambda c: c.id)
def test_a_competent_proposal_for_each_molecule_reaches_the_researcher_exactly_as_asked(flow, case):
    molecule = MOLECULES[case.molecule]
    gateway = Script(proposing(case.expect))
    verdict = flow.run(gateway, max_model_calls=2, prompt=case.prompt, molecule=molecule)
    assert verdict["run_status"] == "WAITING_FOR_APPROVAL" and verdict["repairs"] == 0
    assert verdict["side_effects"] == {"approvals_decided": 0, "calculations": 0, "compute_jobs": 0}
    approval = flow.last_detail.latest_run.pending_approval
    spec = approval.normalized_arguments["specification"]
    assert spec["method"]["identifier"] == case.expect["method"]
    assert spec["basis"]["identifier"] == case.expect["basis"]
    assert spec["engine_preference"]["engine"] == case.expect["engine"]
    assert (spec["charge"], spec["multiplicity"]) == (
        case.expect["charge"],
        case.expect["multiplicity"],
    )
    assert (
        approval.normalized_arguments["structure_version"]["entity_id"]
        == flow.last_project.version_id
    )
    outcomes = {i.parameter: i.outcome for i in approval.request_match}
    assert {
        outcomes[p] for p in ("task", "engine", "method", "basis", "charge", "multiplicity")
    } == {"MATCH"}
    assert approval.proposal_provenance.repair_attempts == 0


@needs_worker
@pytest.mark.parametrize("case", PROPOSE, ids=lambda c: c.id)
def test_a_naive_substitution_is_corrected_with_the_requested_values_for_every_molecule(flow, case):
    if (case.expect["method"], case.expect["basis"]) == ("hf", "sto-3g"):
        pytest.skip("the naive model's HF/STO-3G is already the request")
    molecule = MOLECULES[case.molecule]
    gateway = Script(hf_sto3g_regardless(), proposing(case.expect))
    verdict = flow.run(gateway, max_model_calls=3, prompt=case.prompt, molecule=molecule)
    assert verdict["repairs"] == 1 and verdict["run_status"] == "WAITING_FOR_APPROVAL"
    feedback = tool_message(gateway.requests[1])
    assert feedback["code"] == "REQUEST_MISMATCH"
    requested = {i["field"]: i["requested"] for i in feedback["issues"]}
    naive = {"specification.method.identifier": "hf", "specification.basis.identifier": "sto-3g"}
    wanted = {
        "specification.method.identifier": case.expect["method"],
        "specification.basis.identifier": case.expect["basis"],
    }
    # Exactly the fields where the naive proposal differs from the request are named, nothing else.
    assert requested == {field: wanted[field] for field in wanted if wanted[field] != naive[field]}
    approval = flow.last_detail.latest_run.pending_approval
    assert (
        approval.normalized_arguments["specification"]["method"]["identifier"]
        == case.expect["method"]
    )
    assert approval.proposal_provenance.repair_attempts == 1


@pytest.mark.parametrize("case", EXPLAIN, ids=lambda c: c.id)
def test_a_request_the_server_cannot_meet_ends_as_an_explanation_never_a_substitute(flow, case):
    molecule = MOLECULES[case.molecule]
    explanation = f"This cannot be run here as requested ({case.id})."
    gateway = Script(hf_sto3g_regardless(), text(explanation))
    verdict = flow.run(gateway, max_model_calls=3, prompt=case.prompt, molecule=molecule)
    feedback = tool_message(gateway.requests[1])
    assert feedback["code"] == "REQUEST_MISMATCH"
    assert "tell the researcher in plain text" in feedback["next_step"]
    assert any("Do not substitute" in issue["message"] for issue in feedback["issues"])
    assert verdict["approvals"] == [] and verdict["run_status"] == "SUCCEEDED"
    assert flow.last_detail.messages[-1].content == explanation
    assert verdict["side_effects"] == {"approvals_decided": 0, "calculations": 0, "compute_jobs": 0}


@pytest.mark.parametrize("case", EXPLAIN, ids=lambda c: c.id)
def test_a_model_that_keeps_substituting_ends_with_the_blocker_and_the_request_untouched(
    flow, case
):
    molecule = MOLECULES[case.molecule]
    gateway = Script(hf_sto3g_regardless(), repeat_last=True)
    verdict = flow.run(gateway, max_model_calls=10, prompt=case.prompt, molecule=molecule)
    assert verdict["run_error_code"] == "PROPOSAL_NOT_REPAIRED" and verdict["approvals"] == []
    run = flow.last_detail.latest_run
    assert run.blocker.code == "REQUEST_MISMATCH" and run.blocker.attempts == 3
    assert [m.content for m in flow.last_detail.messages if m.role == "user"][-1] == case.prompt
    assert verdict["side_effects"] == {"approvals_decided": 0, "calculations": 0, "compute_jobs": 0}


@needs_worker
def test_the_out_of_scope_task_is_reported_as_unavailable_in_this_planning_scope(flow):
    case = next(c for c in PLANNING_CASES if c.kind == "EXPLAIN_OUT_OF_SCOPE")
    gateway = Script(hf_sto3g_regardless(), text("Only single-point energies are available."))
    flow.run(gateway, max_model_calls=3, prompt=case.prompt, molecule=MOLECULES[case.molecule])
    feedback = tool_message(gateway.requests[1])
    task_issue = next(i for i in feedback["issues"] if i["field"] == "specification.task_type")
    assert task_issue["requested"] == "GEOMETRY_OPTIMIZATION" and task_issue["allowed"] == [
        "ENERGY"
    ]
    assert "cannot run here" in task_issue["message"]
