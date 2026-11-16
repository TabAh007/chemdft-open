"""AI-6 offline checks: proposal repair behaviour is counted, and unknowns stay unknown.

The real service runs on a disposable replica with scripted models (no provider, no engine);
the counters are read back through the existing AI-2 model performance view.
"""

import sys
from dataclasses import replace
from pathlib import Path

import pytest
from chemdft_api.ai.model_performance import model_performance
from test_nvidia_probe_flow import Script, call, mutated, needs_worker, other_basis, proposal

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import plan as probe_plan  # noqa: E402
from nvidia_probe.flow import ProductionFlow  # noqa: E402

PROMPT = probe_plan.load_fixture()["user_prompt"]  # names HF/STO-3G


@pytest.fixture
def flow():
    with ProductionFlow.build(probe_plan.load_fixture()) as built:
        yield built


def row_of(flow):
    replica = flow._replica
    with replica.sessions() as session:
        view = model_performance(session, replica.identity)
    (row,) = view.rows
    return row


@needs_worker
def test_a_proposal_accepted_on_the_first_attempt_is_counted_as_such(flow):
    flow.run(Script(call(proposal)), prompt=PROMPT)
    proposals = row_of(flow).proposals
    assert (proposals.validated_for_approval, proposals.rejected_by_validation) == (1, 0)
    assert (proposals.accepted_first_attempt, proposals.repairs_before_approval) == (1, 0)
    assert proposals.unrepaired_runs == 0 and proposals.rejections_by_reason == {}
    assert proposals.validity_rate == 1.0


@needs_worker
def test_a_repaired_proposal_counts_its_refusals_and_names_the_reason(flow):
    flow.run(Script(call(mutated(other_basis)), call(proposal)), prompt=PROMPT)
    proposals = row_of(flow).proposals
    assert (proposals.validated_for_approval, proposals.rejected_by_validation) == (1, 1)
    assert (proposals.accepted_first_attempt, proposals.repairs_before_approval) == (0, 1)
    assert proposals.unrepaired_runs == 0
    assert proposals.rejections_by_reason == {"REQUEST_MISMATCH": 1}
    assert proposals.validity_rate == 0.5


def test_a_run_that_never_reaches_approval_is_unrepaired_and_says_why(flow):
    flow.run(
        Script(call(mutated(other_basis)), repeat_last=True), max_model_calls=10, prompt=PROMPT
    )
    row = row_of(flow)
    assert (row.proposals.validated_for_approval, row.proposals.rejected_by_validation) == (0, 3)
    assert row.proposals.unrepaired_runs == 1 and row.proposals.rejections_by_reason == {
        "REQUEST_MISMATCH": 3
    }
    assert row.proposals.validity_rate == 0.0
    assert (row.run_outcomes.runs, row.run_outcomes.failed) == (1, 1)
    assert row.requests.dispatched == 3 and row.requests.succeeded == 3


def test_tokens_the_provider_did_not_report_stay_unknown_and_are_never_zero(flow):
    reply = call(mutated(other_basis))

    def without_usage(request):
        return replace(reply(request), usage=None)

    flow.run(Script(without_usage, repeat_last=True), max_model_calls=10, prompt=PROMPT)
    row = row_of(flow)
    assert row.tokens.input_tokens is None and row.tokens.output_tokens is None
    assert row.tokens.requests_reported == 0 and row.tokens.requests_unknown == 3
    assert row.requests.dispatched == 3
