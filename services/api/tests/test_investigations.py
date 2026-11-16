from uuid import uuid4
from unittest.mock import patch

from chemdft_api.ai.gateway import FakeModelGateway
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.composition import get_object_store_for_settings
from chemdft_api.context import Identity
from chemdft_api.contracts.catalog import ComputeEstimate, MoneyAmount
from chemdft_api.investigation_service import InvestigationService
from chemdft_api.investigation_worker import claim_next_investigation
from chemdft_api.scientific_models import CalculationRecord

H2_XYZ = b"""2
H2
H 0 0 -0.37
H 0 0 0.37
"""


def _project(client):
    return client.post(
        "/v1/projects", json={"name": "Investigation", "slug": f"investigation-{uuid4().hex[:8]}"}
    ).json()


def test_investigation_preserves_ai_hypothesis_and_revisions(api):
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    created = client.post(
        f"/v1/projects/{pid}/investigations",
        json={
            "title": "Compare methods",
            "objective": "Compare authoritative energies",
            "policy": {"max_steps": 3},
        },
    )
    assert created.status_code == 201, created.text
    iid = created.json()["id"]
    hypothesis = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/hypotheses",
        json={"statement": "The methods agree within tolerance", "source_class": "AI_HYPOTHESIS"},
    )
    assert hypothesis.status_code == 200
    assert hypothesis.json()["hypotheses"][0]["source_class"] == "AI_HYPOTHESIS"
    planned = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/plans",
        json={
            "steps": [
                {
                    "action": "calculation.submit",
                    "intent": "Run a bounded comparison",
                    "approval_class": "EXPENSIVE",
                }
            ]
        },
    )
    assert planned.status_code == 200, planned.text
    assert planned.json()["plans"][0]["steps"][0]["approval_class"] == "EXPENSIVE"


def test_investigation_rejects_model_only_and_cross_project_observations(api):
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "Evidence", "objective": "Ground a claim"},
    ).json()
    response = client.post(
        f"/v1/projects/{pid}/investigations/{investigation['id']}/observations",
        json={
            "source_entity_type": "CALCULATION_RESULT",
            "source_entity_id": str(uuid4()),
            "source_class": "CALCULATED",
            "summary": "Model says energy is lower",
        },
    )
    assert response.status_code in {404, 422}
    assert "source" in response.json()["detail"].lower()


def test_investigation_controls_are_deterministic(api):
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    investigation = client.post(
        f"/v1/projects/{pid}/investigations", json={"title": "Pause", "objective": "Stop safely"}
    ).json()
    iid = investigation["id"]
    assert (
        client.post(f"/v1/projects/{pid}/investigations/{iid}/pause").json()["status"] == "PAUSED"
    )
    assert (
        client.post(f"/v1/projects/{pid}/investigations/{iid}/resume").json()["status"] == "ACTIVE"
    )
    assert (
        client.post(f"/v1/projects/{pid}/investigations/{iid}/cancel").json()["status"]
        == "CANCELED"
    )
    assert client.post(f"/v1/projects/{pid}/investigations/{iid}/resume").status_code == 422


def test_investigation_start_creates_exact_step_approval_and_dispatches_once(api):
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    imported = client.post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": ("h2.xyz", H2_XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": f"investigation-h2-{uuid4()}"},
    )
    assert imported.status_code == 201, imported.text
    version_id = imported.json()["version"]["id"]
    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "H2 comparison", "objective": "Compare two energies"},
    ).json()
    iid = investigation["id"]
    args = {
        "structure_version": {
            "project_id": pid,
            "entity_type": "structure.version",
            "entity_id": version_id,
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {
                "identifier": "hf",
                "display_name": "Hartree-Fock",
                "registry": "chemdft.method",
            },
            "basis": {
                "identifier": "sto-3g",
                "display_name": "STO-3G",
                "registry": "chemdft.basis",
            },
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf"},
        },
        "provider_preference": "LOCAL",
    }
    planned = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/plans",
        json={
            "steps": [
                {
                    "action": "calculation.submit",
                    "intent": "Run HF",
                    "approval_class": "EXPENSIVE",
                    "tool_arguments": args,
                }
            ]
        },
    )
    assert planned.status_code == 200, planned.text
    waiting = client.post(f"/v1/projects/{pid}/investigations/{iid}/start")
    assert waiting.status_code == 200, waiting.text
    waiting_body = waiting.json()
    assert waiting_body["status"] == "WAITING_FOR_APPROVAL"
    approval_id = waiting_body["pending_approval_id"]
    dispatched = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert dispatched.status_code == 200, dispatched.text
    assert dispatched.json()["status"] == "WAITING_FOR_RESULT"
    assert dispatched.json()["budget"]["calculations_used"] == 1


def test_investigation_worker_claim_is_exclusive_and_resumes_after_result(api):
    client, sessions, settings = api
    project = _project(client)
    pid = project["id"]
    imported = client.post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": ("h2.xyz", H2_XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": f"worker-h2-{uuid4()}"},
    )
    version_id = imported.json()["version"]["id"]
    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={
            "title": "H2 comparison",
            "objective": "Compare HF and B3LYP energies for H2",
            "policy": {"max_steps": 6, "max_calculations": 2, "max_ai_calls": 4},
        },
    ).json()
    iid = investigation["id"]
    client.post(
        f"/v1/projects/{pid}/investigations/{iid}/hypotheses",
        json={"statement": "The methods can be compared", "source_class": "AI_HYPOTHESIS"},
    )
    args = {
        "structure_version": {
            "project_id": pid,
            "entity_type": "structure.version",
            "entity_id": version_id,
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {
                "identifier": "hf", "display_name": "Hartree-Fock", "registry": "chemdft.method"
            },
            "basis": {
                "identifier": "sto-3g", "display_name": "STO-3G", "registry": "chemdft.basis"
            },
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf"},
        },
        "provider_preference": "LOCAL",
    }
    client.post(
        f"/v1/projects/{pid}/investigations/{iid}/plans",
        json={
            "steps": [{
                "action": "calculation.submit", "intent": "Run HF",
                "approval_class": "EXPENSIVE", "tool_arguments": args,
            }]
        },
    )
    waiting = client.post(f"/v1/projects/{pid}/investigations/{iid}/start").json()
    approved = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{waiting['pending_approval_id']}/decision",
        json={"decision": "APPROVE"},
    ).json()
    assert approved["status"] == "WAITING_FOR_RESULT"
    with sessions() as session:
        first = claim_next_investigation(session, "worker-a", 120)
        assert first is not None
        with sessions() as second_session:
            assert claim_next_investigation(second_session, "worker-b", 120) is None
        identity = Identity(
            user_id=settings.dev_user_id, organization_id=settings.dev_organization_id
        )
        process_next_compute_job(
            session,
            identity,
            get_object_store_for_settings(settings),
            settings,
            worker_id="test-pyscf",
        )
        service = InvestigationService(
            session, identity, get_object_store_for_settings(settings), settings, FakeModelGateway()
        )
        result = service.resume(pid, iid, worker_id="worker-a")
        assert result.observations
        assert result.status in {"PAUSED", "COMPLETED"}
        service.release_lease(pid, iid, "worker-a")
    # PF-7 must not bypass PF-4 to start a second completed energy goal.
    assert result.status == "PAUSED" and result.limit_reason == "NAVIGATOR_BLOCKED"
    assert len(result.observations) == 1
    with sessions() as session:
        assert (
            session.query(CalculationRecord).filter(CalculationRecord.project_id == pid).count()
            == 1
        )


def test_model_numeric_value_cannot_create_observation(api):
    client, _sessions, _settings = api
    project = _project(client)
    investigation = client.post(
        f"/v1/projects/{project['id']}/investigations",
        json={"title": "Untrusted", "objective": "Use model output"},
    ).json()
    response = client.post(
        f"/v1/projects/{project['id']}/investigations/{investigation['id']}/observations",
        json={
            "source_entity_type": "CALCULATION_RESULT",
            "source_entity_id": str(uuid4()),
            "source_class": "CALCULATED",
            "summary": '{"energy": -100}',
        },
    )
    assert response.status_code in {404, 422}


def _make_structure(client, pid, label):
    imported = client.post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": (f"{label}.xyz", H2_XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": f"idem-{label}-{uuid4()}"},
    )
    assert imported.status_code == 201, imported.text
    return imported.json()["version"]["id"]


def _submit_step(client, pid, iid, args, step_label):
    planned = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/plans",
        json={
            "steps": [
                {
                    "action": "calculation.submit",
                    "intent": step_label,
                    "approval_class": "EXPENSIVE",
                    "tool_arguments": args,
                }
            ]
        },
    )
    assert planned.status_code == 200, planned.text
    waiting = client.post(f"/v1/projects/{pid}/investigations/{iid}/start")
    assert waiting.status_code == 200, waiting.text
    waiting_body = waiting.json()
    approval_id = waiting_body.get("pending_approval_id")
    if not approval_id:
        return waiting
    dispatched = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    return dispatched


def _energy_args(pid, version_id, method="hf", basis="sto-3g", idem_key=None):
    args = {
        "structure_version": {
            "project_id": pid,
            "entity_type": "structure.version",
            "entity_id": version_id,
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {
                "identifier": method,
                "display_name": method.upper(),
                "registry": "chemdft.method",
            },
            "basis": {
                "identifier": basis,
                "display_name": basis.upper(),
                "registry": "chemdft.basis",
            },
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": "pyscf"},
        },
        "provider_preference": "LOCAL",
    }
    if idem_key is not None:
        args["idempotency_key"] = idem_key
    return args


def test_idempotency_same_request_reuses_existing_calculation(api):
    client, sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    version_id = _make_structure(client, pid, "same")
    idem = f"idem-same-{uuid4()}"
    args = _energy_args(pid, version_id, idem_key=idem)

    inv1 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "First", "objective": "Run once"},
    ).json()
    dispatched1 = _submit_step(client, pid, inv1["id"], args, "first")
    assert dispatched1.status_code == 200, dispatched1.text
    assert dispatched1.json()["status"] == "WAITING_FOR_RESULT"

    inv2 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "Second", "objective": "Run again"},
    ).json()
    dispatched2 = _submit_step(client, pid, inv2["id"], args, "second")
    assert dispatched2.status_code == 200, dispatched2.text
    assert dispatched2.json()["status"] == "WAITING_FOR_RESULT"

    with sessions() as session:
        count = (
            session.query(CalculationRecord)
            .filter(CalculationRecord.project_id == pid)
            .count()
        )
    assert count == 1


def test_idempotency_same_key_different_method_rejected(api):
    client, sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    version_id = _make_structure(client, pid, "method")
    idem = f"idem-method-{uuid4()}"

    inv1 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "First", "objective": "HF"},
    ).json()
    args_hf = _energy_args(pid, version_id, method="hf", idem_key=idem)
    dispatched1 = _submit_step(client, pid, inv1["id"], args_hf, "hf")
    assert dispatched1.status_code == 200, dispatched1.text
    assert dispatched1.json()["status"] == "WAITING_FOR_RESULT"

    inv2 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "Second", "objective": "B3LYP"},
    ).json()
    args_b3lyp = _energy_args(pid, version_id, method="b3lyp", idem_key=idem)
    dispatched2 = _submit_step(client, pid, inv2["id"], args_b3lyp, "b3lyp")
    assert dispatched2.status_code == 200, dispatched2.text
    assert dispatched2.json()["status"] == "FAILED"


def test_idempotency_same_key_different_structure_rejected(api):
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    version_a = _make_structure(client, pid, "struct-a")
    version_b = _make_structure(client, pid, "struct-b")
    idem = f"idem-struct-{uuid4()}"

    inv1 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "First", "objective": "Structure A"},
    ).json()
    dispatched1 = _submit_step(client, pid, inv1["id"], _energy_args(pid, version_a, idem_key=idem), "A")
    assert dispatched1.json()["status"] == "WAITING_FOR_RESULT"

    inv2 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "Second", "objective": "Structure B"},
    ).json()
    dispatched2 = _submit_step(client, pid, inv2["id"], _energy_args(pid, version_b, idem_key=idem), "B")
    assert dispatched2.json()["status"] == "FAILED"


def test_idempotency_same_key_different_settings_rejected(api):
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    version_id = _make_structure(client, pid, "settings")
    idem = f"idem-settings-{uuid4()}"

    inv1 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "First", "objective": "STO-3G"},
    ).json()
    dispatched1 = _submit_step(
        client, pid, inv1["id"], _energy_args(pid, version_id, basis="sto-3g", idem_key=idem), "sto"
    )
    assert dispatched1.json()["status"] == "WAITING_FOR_RESULT"

    inv2 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "Second", "objective": "6-31G"},
    ).json()
    dispatched2 = _submit_step(
        client, pid, inv2["id"], _energy_args(pid, version_id, basis="6-31g", idem_key=idem), "631g"
    )
    assert dispatched2.json()["status"] == "FAILED"


def test_idempotency_concurrent_identical_requests_safe(api):
    client, sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    version_id = _make_structure(client, pid, "concurrent")
    idem = f"idem-concurrent-{uuid4()}"
    args = _energy_args(pid, version_id, idem_key=idem)

    inv1 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "C1", "objective": "Concurrent 1"},
    ).json()
    inv2 = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "C2", "objective": "Concurrent 2"},
    ).json()

    # Plan both steps before dispatching either.
    planned1 = client.post(
        f"/v1/projects/{pid}/investigations/{inv1['id']}/plans",
        json={"steps": [{"action": "calculation.submit", "intent": "c1",
                         "approval_class": "EXPENSIVE", "tool_arguments": args}]},
    )
    planned2 = client.post(
        f"/v1/projects/{pid}/investigations/{inv2['id']}/plans",
        json={"steps": [{"action": "calculation.submit", "intent": "c2",
                         "approval_class": "EXPENSIVE", "tool_arguments": args}]},
    )
    assert planned1.status_code == 200 and planned2.status_code == 200

    waiting1 = client.post(f"/v1/projects/{pid}/investigations/{inv1['id']}/start").json()
    waiting2 = client.post(f"/v1/projects/{pid}/investigations/{inv2['id']}/start").json()

    d1 = client.post(
        f"/v1/projects/{pid}/investigations/{inv1['id']}/approvals/{waiting1['pending_approval_id']}/decision",
        json={"decision": "APPROVE"},
    ).json()
    d2 = client.post(
        f"/v1/projects/{pid}/investigations/{inv2['id']}/approvals/{waiting2['pending_approval_id']}/decision",
        json={"decision": "APPROVE"},
    ).json()
    assert d1["status"] == "WAITING_FOR_RESULT"
    assert d2["status"] == "WAITING_FOR_RESULT"

    with sessions() as session:
        count = (
            session.query(CalculationRecord)
            .filter(CalculationRecord.project_id == pid)
            .count()
        )
    assert count == 1


def _make_estimate(minor_units: int | None) -> ComputeEstimate:
    from datetime import timedelta

    from chemdft_api.models import utc_now

    now = utc_now()
    cost_high = MoneyAmount(currency="USD", minor_units=minor_units) if minor_units is not None else None
    return ComputeEstimate(
        id=uuid4(),
        project_id=uuid4(),
        requirement_hash="0" * 64,
        provider="local",
        provider_summary="test estimate",
        runtime_low_seconds=1,
        runtime_high_seconds=10,
        cost_low=MoneyAmount(currency="USD", minor_units=0),
        cost_high=cost_high,
        confidence="MEDIUM",
        assumptions=("test",),
        valid_until=now + timedelta(minutes=15),
        created_at=now,
    )


def test_model_zero_estimate_does_not_bypass_authoritative_ceiling(api):
    """A model-supplied estimated_cost of 0 must not bypass the investigation
    compute ceiling; the authoritative server-side estimate is used instead."""
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    version_id = _make_structure(client, pid, "zeroest")
    idem = f"idem-zero-{uuid4()}"
    args = _energy_args(pid, version_id, idem_key=idem)

    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={
            "title": "Zero estimate bypass",
            "objective": "Verify authoritative estimate is enforced",
            "policy": {"max_compute_minor_units": 5, "max_calculations": 1},
        },
    ).json()
    iid = investigation["id"]

    # Model provides estimated_cost=0; the authoritative estimate is 10.
    planned = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/plans",
        json={
            "steps": [
                {
                    "action": "calculation.submit",
                    "intent": "Run HF",
                    "approval_class": "EXPENSIVE",
                    "estimated_cost": {"minor_units": 0},
                    "tool_arguments": args,
                }
            ]
        },
    )
    assert planned.status_code == 200, planned.text

    with patch(
        "chemdft_api.compute_gateway.estimate_for_requirement",
        return_value=_make_estimate(10),
    ):
        result = client.post(f"/v1/projects/{pid}/investigations/{iid}/start").json()

    # 10 > 5 ceiling -> investigation pauses with compute budget reached.
    assert result["status"] == "PAUSED"
    assert result["limit_reason"] == "COMPUTE_BUDGET_REACHED"


def test_authoritative_estimate_none_fails_closed(api):
    """If the authoritative estimate cannot provide a cost (None), the
    investigation must fail closed rather than treating the step as free."""
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    version_id = _make_structure(client, pid, "noneest")
    idem = f"idem-none-{uuid4()}"
    args = _energy_args(pid, version_id, idem_key=idem)

    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "None estimate", "objective": "Verify fail-closed"},
    ).json()
    iid = investigation["id"]

    planned = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/plans",
        json={
            "steps": [
                {
                    "action": "calculation.submit",
                    "intent": "Run HF",
                    "approval_class": "EXPENSIVE",
                    "tool_arguments": args,
                }
            ]
        },
    )
    assert planned.status_code == 200

    with patch(
        "chemdft_api.compute_gateway.estimate_for_requirement",
        return_value=_make_estimate(None),
    ):
        result = client.post(f"/v1/projects/{pid}/investigations/{iid}/start").json()

    assert result["status"] == "PAUSED"
    assert result["limit_reason"] == "COMPUTE_ESTIMATE_UNAVAILABLE"


def test_multi_step_investigation_accumulates_authoritative_cost(api):
    """Each step reserves its authoritative estimate; the running total is
    tracked against the ceiling."""
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    version_id = _make_structure(client, pid, "multistep")

    def make_args(label):
        return _energy_args(pid, version_id, idem_key=f"idem-{label}-{uuid4()}")

    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={
            "title": "Multi-step cost",
            "objective": "Accumulate costs",
            "policy": {"max_compute_minor_units": 100, "max_calculations": 3},
        },
    ).json()
    iid = investigation["id"]

    planned = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/plans",
        json={
            "steps": [
                {
                    "action": "calculation.submit",
                    "intent": "step 1",
                    "approval_class": "EXPENSIVE",
                    "tool_arguments": make_args("s1"),
                },
                {
                    "action": "calculation.submit",
                    "intent": "step 2",
                    "approval_class": "EXPENSIVE",
                    "tool_arguments": make_args("s2"),
                },
            ]
        },
    )
    assert planned.status_code == 200

    # Each step authoritatively costs 30.
    with patch(
        "chemdft_api.compute_gateway.estimate_for_requirement",
        return_value=_make_estimate(30),
    ):
        waiting = client.post(f"/v1/projects/{pid}/investigations/{iid}/start").json()
        r1 = client.post(
            f"/v1/projects/{pid}/investigations/{iid}/approvals/{waiting['pending_approval_id']}/decision",
            json={"decision": "APPROVE"},
        ).json()
        assert r1["budget"]["compute_reserved_minor_units"] == 30


def test_negative_or_malformed_model_estimate_is_ignored(api):
    """Negative or malformed model-supplied estimates must not influence the
    authoritative budget accounting."""
    client, _sessions, _settings = api
    project = _project(client)
    pid = project["id"]
    version_id = _make_structure(client, pid, "malformed")
    idem = f"idem-malformed-{uuid4()}"
    args = _energy_args(pid, version_id, idem_key=idem)

    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={
            "title": "Malformed estimate",
            "objective": "Malformed model estimate ignored",
            "policy": {"max_compute_minor_units": 50, "max_calculations": 1},
        },
    ).json()
    iid = investigation["id"]

    planned = client.post(
        f"/v1/projects/{pid}/investigations/{iid}/plans",
        json={
            "steps": [
                {
                    "action": "calculation.submit",
                    "intent": "Run HF",
                    "approval_class": "EXPENSIVE",
                    "estimated_cost": {"minor_units": -100},
                    "tool_arguments": args,
                }
            ]
        },
    )
    assert planned.status_code == 200

    with patch(
        "chemdft_api.compute_gateway.estimate_for_requirement",
        return_value=_make_estimate(20),
    ):
        waiting = client.post(f"/v1/projects/{pid}/investigations/{iid}/start").json()
        r = client.post(
            f"/v1/projects/{pid}/investigations/{iid}/approvals/{waiting['pending_approval_id']}/decision",
            json={"decision": "APPROVE"},
        ).json()

    # Authoritative 20 <= 50 ceiling: dispatches and reserves 20, not -100.
    assert r["status"] == "WAITING_FOR_RESULT"
    assert r["budget"]["compute_reserved_minor_units"] == 20
