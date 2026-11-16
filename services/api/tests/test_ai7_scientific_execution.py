"""AI-7 offline checks: the three first real cases are ready for authorized execution.

Nothing here runs a calculation. The cases and the preflight are checked against recorded bytes and
the repository's own capability tables; each case's request goes through the real AI Scientist
service with a scripted model and stops at human approval; a rejection and a tampered proposal are
shown to create no calculation or job. The PySCF worker is only asked for its version, as the
existing capability probe does.
"""

import ast
import sys
from pathlib import Path

import pytest
from chemdft_api.ai.providers import AIFoundationError
from chemdft_api.ai.service import AIScientistService
from chemdft_api.ai_models import AIApprovalRecord
from chemdft_api.contracts.ai import ApprovalDecisionInput
from chemdft_api.errors import ScientificReferenceNotFound
from chemdft_api.scientific_models import CalculationRecord, ComputeJobRecord
from sqlalchemy import func, select, update
from test_ai6_multi_molecule_planning import proposing
from test_nvidia_probe_flow import Script, needs_worker

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe import plan as probe_plan  # noqa: E402
from nvidia_probe.flow import ProductionFlow  # noqa: E402
from scientific_execution import preflight as preflight_module  # noqa: E402
from scientific_execution.cases import (  # noqa: E402
    EXECUTION_CASES,
    H2_REFERENCE_ENERGY_EH,
    compare_to_reference,
    execution_case,
)
from scientific_execution.preflight import estimate, formula_of, preflight  # noqa: E402

CASE_IDS = [case.id for case in EXECUTION_CASES]
HF_STO3G = {"task": "ENERGY", "engine": "pyscf", "method": "hf", "basis": "sto-3g"}


class Molecule:
    """What ProductionFlow.run needs from a molecule, built from an execution case."""

    def __init__(self, case):
        self._case = case
        self.file, self.media_type = case.filename, case.media_type
        self.format, self.structure_name = case.format, case.structure_name

    def data(self):
        return self._case.data()


@pytest.fixture(scope="module")
def flow():
    with ProductionFlow.build(probe_plan.load_fixture()) as built:
        yield built


def counts(flow):
    with flow._replica.sessions() as session:
        return (
            session.scalar(select(func.count()).select_from(CalculationRecord)),
            session.scalar(select(func.count()).select_from(ComputeJobRecord)),
        )


def propose(flow, case):
    gateway = Script(proposing({**case.expect}))
    verdict = flow.run(gateway, max_model_calls=2, prompt=case.prompt, molecule=Molecule(case))
    return gateway, verdict


# -- the cases and the preflight ------------------------------------------------------------------


def test_there_are_exactly_three_cases_all_restricted_hf_sto3g_neutral_singlets():
    assert CASE_IDS == ["A-h2-hf-sto3g", "B-h2o-hf-sto3g", "C-ethanol-hf-sto3g"]
    for case in EXECUTION_CASES:
        assert case.expect == {**HF_STO3G, "charge": 0, "multiplicity": 1}
        assert "PySCF" in case.prompt and "STO-3G" in case.prompt and "Hartree-Fock" in case.prompt
        assert case.geometry_basis and case.recorded_sha256


def test_each_case_names_the_geometry_it_will_use_and_refuses_changed_bytes(monkeypatch):
    a = execution_case("A-h2-hf-sto3g")
    assert b"H 0 0 -0.37" in a.data() and b"H 0 0 0.37" in a.data()
    assert b"0.37072" not in a.data()  # the NIST-length H2 is a different geometry
    assert "PubChem CID 962" in execution_case("B-h2o-hf-sto3g").geometry_basis
    assert "PubChem CID 702" in execution_case("C-ethanol-hf-sto3g").geometry_basis
    monkeypatch.setattr("scientific_execution.cases._source_bytes", lambda case: b"changed")
    with pytest.raises(ValueError, match="EXECUTION_CASE_HASH_MISMATCH"):
        a.data()


@pytest.mark.parametrize("case_id", CASE_IDS)
def test_the_static_preflight_passes_without_touching_any_engine(case_id):
    report = preflight(execution_case(case_id))
    assert report["verdict"] == "READY (not executed)" and report["executed"] is False
    statuses = {row["check"]: row["status"] for row in report["checks"]}
    assert set(statuses.values()) == {"PASS", "NOT RUN"}
    assert [name for name, status in statuses.items() if status == "NOT RUN"] == [
        "worker is AVAILABLE and pinned to the expected PySCF"
    ]


@needs_worker
@pytest.mark.parametrize("case_id", CASE_IDS)
def test_the_worker_check_confirms_the_pinned_pyscf_version_by_import_only(case_id):
    report = preflight(execution_case(case_id), worker=True)
    row = next(r for r in report["checks"] if r["check"].startswith("worker is AVAILABLE"))
    assert row["status"] == "PASS" and "PySCF 2.14.0" in row["detail"]


def test_the_preflight_fails_closed_on_a_bad_input_or_a_limit(monkeypatch):
    case = execution_case("C-ethanol-hf-sto3g")
    monkeypatch.setattr("scientific_execution.cases._source_bytes", lambda c: b"not a structure")
    report = preflight(case)
    assert report["verdict"] == "BLOCKED" and report["failed"] == [
        "input bytes match the recorded sha256"
    ]
    monkeypatch.undo()
    from chemdft_api.config import Settings

    tight = Settings(_env_file=None, scientific_max_atoms=5)
    assert "atom count within the execution limit" in preflight(case, tight)["failed"]


def test_the_size_estimate_is_dependency_free_and_matches_the_known_formulas():
    assert estimate(["H", "H"])["basis_functions"] == 2
    assert estimate(["O", "H", "H"]) == {
        "basis_functions": 7,
        "electrons": 10,
        "in_core_eri_bytes": 7**4 * 8,
    }
    assert estimate(["C", "C", "O", *["H"] * 6])["basis_functions"] == 21
    assert formula_of(["C", "C", "O", *["H"] * 6]) == "C2H6O"
    assert formula_of(["O", "H", "H"]) == "H2O"


def test_neither_module_can_start_a_calculation():
    """The cases and the preflight import no engine and start no process."""
    for module in (preflight_module, sys.modules["scientific_execution.cases"]):
        tree = ast.parse(Path(module.__file__).read_text())
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported |= {alias.name.split(".")[0] for alias in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        assert not imported & {"pyscf", "subprocess", "socket", "requests", "httpx", "openai"}
    source = Path(preflight_module.__file__).read_text()
    assert "Popen" not in source and "os.system" not in source


# -- the comparison reference ---------------------------------------------------------------------

SUPPLIED = [("H", 0.0, 0.0, -0.37), ("H", 0.0, 0.0, 0.37)]
SETTINGS = {
    "charge": 0,
    "multiplicity": 1,
    "engine": "pyscf",
    "engine_version": "2.14.0",
    "method": "hf",
    "basis": "sto-3g",
}


def test_the_h2_reference_is_compared_only_when_everything_agrees():
    case = execution_case("A-h2-hf-sto3g")
    same = compare_to_reference(
        case, positions=SUPPLIED, energy_eh=H2_REFERENCE_ENERGY_EH, **SETTINGS
    )
    assert same["verdict"] == "AGREES" and same["difference_eh"] == 0
    off = compare_to_reference(
        case, positions=SUPPLIED, energy_eh=H2_REFERENCE_ENERGY_EH + 1e-6, **SETTINGS
    )
    assert off["verdict"] == "DIFFERS"  # a real difference is reported, not hidden
    nist = [("H", 0.0, 0.0, -0.37072), ("H", 0.0, 0.0, 0.37072)]
    result = compare_to_reference(case, positions=nist, energy_eh=-1.1, **SETTINGS)
    assert result["verdict"] == "NOT_COMPARABLE" and "geometry" in result["reasons"][0]
    for field, value in (("basis", "6-31g"), ("method", "b3lyp"), ("engine_version", "2.15.0")):
        other = compare_to_reference(
            case, positions=SUPPLIED, energy_eh=-1.1, **{**SETTINGS, field: value}
        )
        assert other["verdict"] == "NOT_COMPARABLE" and field.split("_")[0] in other["reasons"][0]


@pytest.mark.parametrize("case_id", ["B-h2o-hf-sto3g", "C-ethanol-hf-sto3g"])
def test_water_and_ethanol_have_no_reference_energy_to_compare_with(case_id):
    result = compare_to_reference(
        execution_case(case_id), positions=SUPPLIED, energy_eh=-1.0, **SETTINGS
    )
    assert result["verdict"] == "NO_REFERENCE"


def test_no_scientific_value_is_ever_an_input_to_production_code():
    source = Path(__import__("chemdft_api").__file__).parent
    for path in source.rglob("*.py"):
        assert "1.1167593073964255" not in path.read_text(), path


# -- proposals, approval and rejection ------------------------------------------------------------


@needs_worker
@pytest.mark.parametrize("case_id", CASE_IDS)
def test_each_case_reaches_human_approval_with_everything_the_screen_shows(flow, case_id):
    case = execution_case(case_id)
    _gateway, verdict = propose(flow, case)
    assert verdict["run_status"] == "WAITING_FOR_APPROVAL" and verdict["repairs"] == 0
    assert verdict["side_effects"] == {"approvals_decided": 0, "calculations": 0, "compute_jobs": 0}
    approval = flow.last_detail.latest_run.pending_approval
    assert approval.status == "PENDING" and approval.tool_name
    arguments = approval.normalized_arguments
    spec = arguments["specification"]
    assert arguments["structure_version"]["entity_id"] == flow.last_project.version_id
    assert arguments["structure_version"]["project_id"] == flow.last_project.project_id
    assert (spec["task_type"], spec["engine_preference"]["engine"]) == ("ENERGY", "pyscf")
    assert (spec["method"]["identifier"], spec["basis"]["identifier"]) == ("hf", "sto-3g")
    assert (spec["charge"], spec["multiplicity"]) == (0, 1)
    outcomes = {item.parameter: item.outcome for item in approval.request_match}
    assert {
        outcomes[p] for p in ("task", "engine", "method", "basis", "charge", "multiplicity")
    } == {"MATCH"}
    assert approval.proposal_provenance.provider and approval.proposal_provenance.model
    assert approval.scientific_summary and approval.action_fingerprint


@needs_worker
@pytest.mark.parametrize("case_id", CASE_IDS)
def test_rejecting_a_case_creates_no_calculation_and_no_job(flow, case_id):
    case = execution_case(case_id)
    gateway, _verdict = propose(flow, case)
    before = counts(flow)
    approval = flow.last_detail.latest_run.pending_approval
    with flow._replica.sessions() as session:
        service = AIScientistService(
            session, flow._replica.identity, flow._replica.store, flow._replica.settings, gateway
        )
        service.decide_approval(
            flow.last_project.project_id,
            str(approval.id),
            ApprovalDecisionInput(decision="REJECT", decision_notes="AI-7 offline rejection check"),
        )
        record = session.get(AIApprovalRecord, str(approval.id))
        assert record.status == "REJECTED"
    assert counts(flow) == before
    with flow._replica.sessions() as session:
        service = AIScientistService(
            session, flow._replica.identity, flow._replica.store, flow._replica.settings, gateway
        )
        with pytest.raises(AIFoundationError) as stale:
            service.decide_approval(
                flow.last_project.project_id,
                str(approval.id),
                ApprovalDecisionInput(decision="APPROVE"),
            )
        assert stale.value.code == "APPROVAL_STALE"  # a decided proposal cannot be approved later
    assert counts(flow) == before


@needs_worker
def test_a_proposal_changed_after_validation_is_refused_and_creates_nothing(flow):
    case = execution_case("B-h2o-hf-sto3g")
    gateway, _verdict = propose(flow, case)
    before = counts(flow)
    approval = flow.last_detail.latest_run.pending_approval
    with flow._replica.sessions() as session:
        record = session.get(AIApprovalRecord, str(approval.id))
        changed = dict(record.normalized_arguments_json)
        changed["specification"] = {**changed["specification"], "basis": {"identifier": "def2-svp"}}
        record.normalized_arguments_json = changed
        with pytest.raises(ValueError, match="immutable"):  # the ORM already refuses an edit
            session.commit()
        session.rollback()
        # ...and a change made behind the ORM's back is still caught by the fingerprint.
        session.execute(
            update(AIApprovalRecord)
            .where(AIApprovalRecord.id == str(approval.id))
            .values(normalized_arguments_json=changed)
        )
        session.commit()
        service = AIScientistService(
            session, flow._replica.identity, flow._replica.store, flow._replica.settings, gateway
        )
        with pytest.raises(AIFoundationError) as tampered:
            service.decide_approval(
                flow.last_project.project_id,
                str(approval.id),
                ApprovalDecisionInput(decision="APPROVE"),
            )
        assert tampered.value.code == "APPROVAL_TAMPERED"
    assert counts(flow) == before


@needs_worker
def test_another_project_cannot_decide_the_approval(flow):
    gateway, _verdict = propose(flow, execution_case("A-h2-hf-sto3g"))
    approval = flow.last_detail.latest_run.pending_approval
    other = flow._replica.new_project()
    with flow._replica.sessions() as session:
        service = AIScientistService(
            session, flow._replica.identity, flow._replica.store, flow._replica.settings, gateway
        )
        with pytest.raises(ScientificReferenceNotFound):
            service.decide_approval(
                other.project_id, str(approval.id), ApprovalDecisionInput(decision="REJECT")
            )
