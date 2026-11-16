"""Adversarial acceptance repairs, on disposable copies of accepted source evidence."""

from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
import test_dftd4_integration as baseline
from chemdft_api.scientific.engines.dftd4 import digest, encode
from chemdft_api.scientific.engines.interfaces import ExecutionResult
from chemdft_api.scientific_models import (
    CalculationAttemptRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    ComputeJobRecord,
    ComputeReservationRecord,
    ProvenanceRecordRow,
)
from sqlalchemy import select
from test_dftd4_integration import run, submit

evidence_api = baseline.evidence_api

native = pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_DFTD4_NATIVE") != "1", reason="isolated native opt-in required"
)


def append_status(api, state):
    with api[1]() as session:
        source = session.get(CalculationResultRecord, api[3]["b3lyp"][1])
        p = session.get(ProvenanceRecordRow, source.provenance_record_id)
        values = {c.name: getattr(p, c.name) for c in ProvenanceRecordRow.__table__.columns}
        values.update(
            id=str(uuid4()),
            verification_state=state,
            supersedes_id=p.id,
            operation="chemdft.scientific-status",
        )
        session.add(ProvenanceRecordRow(**values))
        session.commit()


def retry(api, detail, failed_id=None, project=None):
    calc = detail["calculation"]
    return api[0].post(
        f"/v1/projects/{project or calc['project_id']}/dispersion-corrections/{calc['id']}/retry",
        json={"failed_attempt_id": failed_id or detail["attempt"]["id"]},
    )


def failed_execution(api, monkeypatch, execution=None, exception=None):
    from chemdft_api.compute_gateway import LocalComputeProvider

    def fail(*args, **kwargs):
        if exception:
            raise exception
        return execution or ExecutionResult(
            -9,
            False,
            b"partial native stdout",
            b"killed",
            b"",
            None,
            {"input.xyz": b"partial diagnostic input", "stdout.txt": b"partial stdout"},
        )

    queued = submit(api)
    assert queued.status_code == 201, queued.text
    with monkeypatch.context() as patch:
        patch.setattr(LocalComputeProvider, "execute", fail)
        detail = run(api, queued.json()).model_dump(mode="json")
    assert detail["calculation"]["state"] == "FAILED", detail
    return detail


@native
@pytest.mark.parametrize("state", ["RETRACTED", "SUPERSEDED", "DISPUTED"])
def test_current_state_covers_all_consumers_and_preserves_history(evidence_api, state):
    from chemdft_api.effective_result_state import effective_result_state

    api = evidence_api
    queued = submit(api)
    published = run(api, queued.json()).model_dump(mode="json")
    client, sessions, _, sources = api
    pid, rid = published["calculation"]["project_id"], published["result"]["id"]
    result_url = f"/v1/projects/{pid}/results/{rid}"
    before = client.get(result_url).json()
    assert before["effective_state"]["eligible_for_derivation"] is True
    assert before["verification_state"] == "UNVERIFIED"
    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={
            "title": "Current evidence",
            "objective": "Use only current scientific evidence",
        },
    ).json()
    inv_url = f"/v1/projects/{pid}/investigations/{investigation['id']}"
    observation = {
        "source_entity_type": "CALCULATION_RESULT",
        "source_entity_id": rid,
        "source_class": "CALCULATED",
        "summary": "Native D4 combined energy",
    }
    added = client.post(inv_url + "/observations", json=observation)
    assert added.status_code == 200, added.text
    claims_url = f"/v1/projects/{pid}/scientific-claims"
    claims_before = client.get(claims_url).json()["claims"]
    d4_before = [c for c in claims_before if c["source_record_id"] == rid]
    assert d4_before and all(c["review_state"] == "UNVERIFIED" for c in d4_before)
    with sessions() as session:
        original = session.get(CalculationResultRecord, rid)
        original_source = session.get(CalculationResultRecord, sources["b3lyp"][1])
        frozen = encode(
            {
                c.name: getattr(original, c.name)
                for c in CalculationResultRecord.__table__.columns
                if c.name != "created_at"
            }
        )
        source_frozen = encode(original_source.payload_json)
        # Warm an identity map in a session that survives the append in another session.
        assert effective_result_state(session, original).eligible_for_derivation
        append_status(api, state)
        assert effective_result_state(session, original).source_lineage_validity == state
    after = client.get(result_url)
    assert after.status_code == 200, after.text
    body = after.json()
    assert body["authority"] == "CANDIDATE"
    assert body["verification_state"] == "UNVERIFIED"
    assert body["payload"] == before["payload"]
    assert body["effective_state"]["stored_authority"] == "AUTHORITATIVE"
    assert body["effective_state"]["source_lineage_validity"] == state
    assert after.headers["cache-control"] == "no-store"
    detail = client.get(f"/v1/projects/{pid}/calculations/{published['calculation']['id']}").json()
    assert detail["result"]["effective_state"] == body["effective_state"]
    listed = client.get(f"/v1/projects/{pid}/results").json()
    assert next(r for r in listed if r["id"] == rid)["effective_state"] == body["effective_state"]
    claims = client.get(claims_url).json()["claims"]
    projected = [c for c in claims if c["source_record_id"] == rid]
    assert projected and all(c["semantic_status"] == "INACTIVE_SOURCE" for c in projected)
    assert all(c["review_state"] == "UNVERIFIED" for c in projected)
    assert all(c["effective_result_state"]["source_lineage_validity"] == state for c in projected)
    comparison = client.get(f"/v1/projects/{pid}/scientific-comparison")
    assert comparison.status_code == 200, comparison.text
    # All consumers retain the current-state metadata rather than reauthorizing old claims.
    assert "INACTIVE_SOURCE" in comparison.text or "Historical result" in comparison.text
    historical = client.get(inv_url).json()
    assert historical["current_evidence_valid"] is False
    assert historical["observations"][0]["current"] is False
    assert historical["status"] == "PAUSED"
    assert historical["stored_status"] == investigation["status"]
    assert client.post(inv_url + "/resume").status_code == 422
    assert client.post(inv_url + "/observations", json=observation).status_code == 422
    other_inv = client.post(
        f"/v1/projects/{pid}/investigations",
        json={
            "title": "New evidence",
            "objective": "Reject inactive source",
        },
    ).json()
    assert (
        client.post(
            f"/v1/projects/{pid}/investigations/{other_inv['id']}/observations", json=observation
        ).status_code
        == 422
    )
    for suffix in ("/export", "/provenance"):
        export = client.get(result_url + suffix)
        assert export.status_code == 200, export.text
        assert export.json()["result"]["payload"] == before["payload"]
        assert export.json()["result"]["effective_state"]["source_lineage_validity"] == state
        assert len(export.json()["lineage_results"]) == 2
        assert any(p["verification_state"] == state for p in export.json()["provenance_records"])
    artifact = published["result"]["raw_artifacts"][0]
    downloaded = client.get(
        f"/v1/projects/{pid}/calculations/{published['calculation']['id']}"
        f"/artifacts/{artifact['artifact_id']}"
    )
    assert downloaded.status_code == 200, downloaded.text
    assert downloaded.headers["x-chemdft-evidence-use"] == "HISTORICAL_ONLY"
    assert digest(downloaded.content) == artifact["sha256"]
    with sessions() as session:
        original = session.get(CalculationResultRecord, rid)
        assert (
            encode(
                {
                    c.name: getattr(original, c.name)
                    for c in CalculationResultRecord.__table__.columns
                    if c.name != "created_at"
                }
            )
            == frozen
        )
        assert (
            encode(session.get(CalculationResultRecord, sources["b3lyp"][1]).payload_json)
            == source_frozen
        )
    other = client.post("/v1/projects", json={"name": "Other", "slug": str(uuid4())}).json()["id"]
    assert client.get(f"/v1/projects/{other}/results/{rid}").status_code == 404
    assert client.get(f"/v1/projects/{other}/results/{rid}/export").status_code == 404
    # Saved AI citations and bounded product context cannot reauthorize old results.
    from chemdft_api.ai.product_context import ProductContextBuilder
    from chemdft_api.ai.service import AIScientistService
    from chemdft_api.context import Identity
    from chemdft_api.contracts.ai import AICitation
    from chemdft_api.contracts.ai_foundation import ProductSelection
    from chemdft_api.storage import LocalObjectStore

    settings = api[2]
    with sessions() as session:
        identity = Identity(
            user_id=settings.dev_user_id, organization_id=settings.dev_organization_id
        )
        service = AIScientistService(
            session, identity, LocalObjectStore(settings.object_root), settings
        )
        context = ProductContextBuilder(session, identity, settings, service._registry).build(
            pid, ProductSelection(selected_result_id=rid)
        )
        resource = next(r for r in context.resources if str(r.entity_id) == rid)
        assert resource.authority == "CANDIDATE" and not resource.authoritative_calculation
        assert resource.scalar_summary["source_lineage_validity"] == state
        for record_type, entity in (
            ("calculation_result", rid),
            ("calculation", published["calculation"]["id"]),
            (None, rid),
        ):
            citation = AICitation(
                citation_type="CALCULATION",
                entity_id=entity,
                source_record_type=record_type,
                label="Historical evidence",
                reference_text="Preserved",
            )
            assert not service._saved_citation_is_available(pid, citation, {})


@native
def test_retry_preserves_failed_attempt_and_is_concurrent_idempotent(evidence_api, monkeypatch):
    api = evidence_api
    failed = failed_execution(api, monkeypatch)
    assert failed["attempt"]["failure_code"] == "ENGINE_CRASHED"
    calc_id = failed["calculation"]["id"]
    with api[1]() as session:
        attempt = session.get(CalculationAttemptRecord, failed["attempt"]["id"])
        frozen_attempt = {
            c.name: getattr(attempt, c.name) for c in CalculationAttemptRecord.__table__.columns
        }
        job = session.scalar(
            select(ComputeJobRecord).where(ComputeJobRecord.calculation_id == calc_id)
        )
        old_job, old_reservation = job.id, job.reservation_id
        assert session.get(ComputeReservationRecord, old_reservation).state == "RELEASED"
    # Ordinary submission retains its original idempotent meaning.
    assert submit(api).json()["calculation"]["state"] == "FAILED"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: retry(api, failed), range(2)))
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    assert {r.json()["calculation"]["id"] for r in responses} == {calc_id}
    assert all(r.json()["calculation"]["state"] == "QUEUED" for r in responses)
    # A repeated recovery token while running cannot create another job or attempt.
    from chemdft_api.compute_gateway import LocalComputeProvider

    real_execute = LocalComputeProvider.execute

    def running_duplicate(*args, **kwargs):
        replay = retry(api, failed)
        assert replay.status_code == 200, replay.text
        assert replay.json()["calculation"]["state"] == "RUNNING"
        return real_execute(*args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(LocalComputeProvider, "execute", running_duplicate)
        success = run(api, responses[0].json()).model_dump(mode="json")
    assert success["calculation"]["state"] == "SUCCEEDED", success
    assert success["attempt"]["id"] != failed["attempt"]["id"]
    assert success["attempt"]["attempt_number"] == 2
    assert success["result"]["verification_state"] == "UNVERIFIED"
    assert retry(api, failed).json()["result"]["id"] == success["result"]["id"]
    with api[1]() as session:
        attempt = session.get(CalculationAttemptRecord, failed["attempt"]["id"])
        assert {
            c.name: getattr(attempt, c.name) for c in CalculationAttemptRecord.__table__.columns
        } == frozen_attempt
        assert session.query(CalculationRecord).filter_by(id=calc_id).count() == 1
        assert session.query(ComputeJobRecord).filter_by(calculation_id=calc_id).count() == 1
        assert session.query(CalculationResultRecord).filter_by(calculation_id=calc_id).count() == 1
        assert (
            session.query(CalculationAttemptRecord).filter_by(calculation_id=calc_id).count() == 2
        )
        assert session.query(ComputeExecutionRecord).filter_by(calculation_id=calc_id).count() == 2
        job = session.get(ComputeJobRecord, old_job)
        assert job.state == "SUCCEEDED" and job.retry_count == 1
        assert job.reservation_id != old_reservation
        assert session.get(ComputeReservationRecord, old_reservation).state == "RELEASED"
        from chemdft_api.scientific_models import AuditEventRecord

        events = session.scalars(
            select(AuditEventRecord).where(
                AuditEventRecord.event_name == "calculation.dftd4.retry.authorized",
                AuditEventRecord.project_id == failed["calculation"]["project_id"],
            )
        ).all()
        assert len(events) == 1
        assert any(
            item["value"] == failed["attempt"]["id"] for item in events[0].safe_metadata_json
        )
    from chemdft_api.storage import LocalObjectStore

    store = LocalObjectStore(api[2].object_root)
    from chemdft_api.scientific_models import ScientificArtifactRecord

    with api[1]() as session:
        for ref in failed["attempt"]["raw_artifacts"]:
            row = session.get(ScientificArtifactRecord, ref["artifact_id"])
            assert digest(store.get_bytes(row.storage_key, 8_000_000)) == ref["sha256"]


@pytest.mark.parametrize(
    "failure,eligible",
    [
        (ExecutionResult(None, True, b"", b"timeout", b"", None), True),
        (OSError("temporary process unavailable"), True),
        (ValueError("immutable input or native pin mismatch"), False),
        (ExecutionResult(1, False, b"invalid model", b"", b"", None), False),
        (ExecutionResult(0, False, b"bad native evidence", b"", b"", None), False),
    ],
)
def test_retry_eligibility_is_explicit(evidence_api, monkeypatch, failure, eligible):
    failed = failed_execution(
        evidence_api,
        monkeypatch,
        execution=failure if isinstance(failure, ExecutionResult) else None,
        exception=failure if isinstance(failure, Exception) else None,
    )
    response = retry(evidence_api, failed)
    assert response.status_code == (200 if eligible else 409), response.text
    if not eligible:
        assert response.json()["detail"]["code"] == "DFTD4_RETRY_INELIGIBLE"


def test_retry_rejects_inactive_source_and_cross_project(evidence_api, monkeypatch):
    failed = failed_execution(evidence_api, monkeypatch)
    other = (
        evidence_api[0]
        .post("/v1/projects", json={"name": "Other", "slug": str(uuid4())})
        .json()["id"]
    )
    assert retry(evidence_api, failed, project=other).status_code == 404
    append_status(evidence_api, "RETRACTED")
    response = retry(evidence_api, failed)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]
    assert submit(evidence_api).status_code == 422


def test_retry_rejects_canceled_and_stale_tokens(evidence_api, monkeypatch):
    failed = failed_execution(evidence_api, monkeypatch)
    assert retry(evidence_api, failed, failed_id=str(uuid4())).status_code == 409
    with evidence_api[1]() as session:
        session.get(CalculationRecord, failed["calculation"]["id"]).state = "CANCELED"
        session.commit()
    assert retry(evidence_api, failed).status_code == 409


@native
@pytest.mark.parametrize("mismatch_type", [ValueError, TypeError, KeyError])
def test_historical_replay_and_runtime_conflicts_are_structured(
    evidence_api, monkeypatch, mismatch_type
):
    import chemdft_api.dftd4_actions as actions

    api = evidence_api
    queued = submit(api)
    success = run(api, queued.json()).model_dump(mode="json")

    def mismatch(*args):
        raise mismatch_type("native runtime/table pin mismatch")

    monkeypatch.setattr(actions, "environment_identity", mismatch)
    # Historical replay does not reinterpret immutable execution evidence.
    replay = submit(api)
    assert replay.status_code == 201, replay.text
    assert replay.json()["result"]["payload"] == success["result"]["payload"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: submit(api, "pbe"), range(2)))
    assert [r.status_code for r in responses] == [503, 503], [r.text for r in responses]
    assert all(r.json()["detail"]["code"] == "DFTD4_RUNTIME_UNAVAILABLE" for r in responses)


def test_retry_native_identity_change_fails_closed(evidence_api, monkeypatch):
    import chemdft_api.dftd4_actions as actions

    failed = failed_execution(evidence_api, monkeypatch)
    original = actions.environment_identity

    def changed(*args):
        identity = original(*args)
        return {**identity, "rebuild": "different runtime"}

    monkeypatch.setattr(actions, "environment_identity", changed)
    response = retry(evidence_api, failed)
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "DFTD4_RUNTIME_CONFLICT"
    with evidence_api[1]() as session:
        assert session.get(CalculationRecord, failed["calculation"]["id"]).state == "FAILED"


def test_effective_coefficient_change_is_not_a_binary_rebuild(evidence_api, monkeypatch):
    import chemdft_api.dftd4_actions as actions

    key = str(uuid4())
    first = submit(evidence_api, idempotency_key=key)
    assert first.status_code == 201, first.text
    changed = {
        **actions.PARAMETERS,
        "b3lyp": actions.PARAMETERS["b3lyp"].model_copy(update={"s8": 2.1}),
    }
    monkeypatch.setattr(actions, "PARAMETERS", changed)
    response = submit(evidence_api, idempotency_key=key)
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "DFTD4_VARIANT_CONFLICT"
    # An unsupported effective vector also cannot enter the queue with a fresh key.
    fresh = submit(evidence_api)
    assert fresh.status_code == 503, fresh.text
    with evidence_api[1]() as session:
        assert (
            session.query(ComputeJobRecord)
            .filter(
                ComputeJobRecord.workload_json["workload_type"].as_string()
                == "chemdft.dftd4.correction.v1"
            )
            .count()
            == 1
        )


def test_parameter_table_pin_change_has_structured_error(evidence_api, monkeypatch):
    import chemdft_api.scientific.engines.dftd4 as native_d4

    monkeypatch.setattr(native_d4, "TABLE_SHA256", "0" * 64)
    monkeypatch.setitem(native_d4.PIN, "share/dftd4/parameters.toml", "0" * 64)
    response = submit(evidence_api)
    assert response.status_code == 503, response.text
    assert response.json()["detail"]["code"] == "DFTD4_RUNTIME_UNAVAILABLE"


@native
def test_lost_worker_can_recover_with_new_attempt(evidence_api):
    from test_dftd4_integration import test_lost_worker_restart_preserves_source_variant_identity

    test_lost_worker_restart_preserves_source_variant_identity(evidence_api)
    queued = submit(evidence_api).json()
    assert queued["calculation"]["state"] == "FAILED"
    assert queued["attempt"]["failure_code"] == "ENGINE_CRASHED"
    recovered = retry(evidence_api, queued)
    assert recovered.status_code == 200, recovered.text
    succeeded = run(evidence_api, recovered.json())
    assert succeeded.calculation.state == "SUCCEEDED"
    assert succeeded.attempt.attempt_number == 2
    assert str(succeeded.calculation.id) == queued["calculation"]["id"]
    with evidence_api[1]() as session:
        rows = session.scalars(
            select(ComputeExecutionRecord).where(
                ComputeExecutionRecord.calculation_id == str(succeeded.calculation.id),
            )
        ).all()
        assert {r.state for r in rows} == {"LOST", "FINISHED"}


def test_legacy_d4_payload_round_trips_without_changing_hash():
    from pathlib import Path

    from chemdft_api.contracts.results import CalculationResult

    root = Path(__file__).resolve().parents[3]
    historical = json.loads(
        (
            root / "output/pf8e-trusted-integration-20261011/b3lyp/calculation-detail.json"
        ).read_text()
    )["result"]
    parsed = CalculationResult.model_validate(historical)
    assert parsed.payload.payload_schema_version == "1.0.0"
    assert parsed.payload.angstrom_to_bohr == 1.8897261254578281
    assert digest(encode(parsed.payload.model_dump(mode="json"))) == digest(
        encode(historical["payload"])
    )


@native
def test_small_carbon_positive_uses_real_psi4_source(evidence_api):
    from pathlib import Path

    from test_psi4_integration import CLI, specification

    api = evidence_api
    api[2].psi4_executable = CLI
    pid = api[3]["b3lyp"][0]
    root = Path(__file__).resolve().parents[3]
    xyz = (root / ".chemdft/pf8e-foundation-20261011/scratch/ethane.xyz").read_bytes()
    imported = api[0].post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": ("ethane.xyz", xyz, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
    )
    assert imported.status_code == 201, imported.text
    version = imported.json()["version"]["id"]
    queued = api[0].post(
        f"/v1/projects/{pid}/calculations",
        json={
            "structure_version": {
                "project_id": pid,
                "entity_type": "structure.version",
                "entity_id": version,
            },
            "specification": specification("b3lyp").model_dump(mode="json"),
            "provider_preference": "LOCAL",
            "idempotency_key": str(uuid4()),
        },
    )
    assert queued.status_code == 201, queued.text
    source = run(api, queued.json()).model_dump(mode="json")
    assert source["calculation"]["state"] == "SUCCEEDED", source
    correction = api[0].post(
        f"/v1/projects/{pid}/dispersion-corrections",
        json={
            "source_result_id": source["result"]["id"],
            "idempotency_key": str(uuid4()),
        },
    )
    assert correction.status_code == 201, correction.text
    result = run(api, correction.json()).model_dump(mode="json")
    assert result["calculation"]["state"] == "SUCCEEDED", result
    payload = result["result"]["payload"]
    references = json.loads(
        (root / ".chemdft/pf8e-gate-a4-20261011/numerical-results.json").read_text()
    )
    reference = next(r for r in references if r["molecule"] == "ethane" and r["method"] == "b3lyp")
    # A focused float64 component check, fixed before execution, tighter than Gate A4.
    assert abs(payload["d4_correction_energy"]["value"] - reference["s9"]["1"]["tad_Eh"]) < 1e-9
    assert payload["source"]["result_id"] == source["result"]["id"]
    assert payload["source"]["structure_version_id"] == version
    assert result["result"]["verification_state"] == "UNVERIFIED"
    assert payload["payload_schema_version"] == "1.1.0"
    assert payload["native_angstrom_to_bohr"] == 1.8897261246204404
    assert "angstrom_to_bohr" not in payload
    target = os.environ.get("CHEMDFT_DFTD4_REPAIR_OUTPUT")
    if target:
        out = Path(target) / "ethane"
        out.mkdir(parents=True, exist_ok=True)
        (out / "source-detail.json").write_bytes(encode(source))
        (out / "correction-detail.json").write_bytes(encode(result))
        (out / "component-comparison.json").write_bytes(encode(reference))
        from chemdft_api.scientific_models import ScientificArtifactRecord
        from chemdft_api.storage import LocalObjectStore

        store = LocalObjectStore(api[2].object_root)
        with api[1]() as session:
            for label, detail in (("psi4", source), ("d4", result)):
                artifacts = out / label
                artifacts.mkdir(exist_ok=True)
                for ref in detail["result"]["raw_artifacts"]:
                    row = session.get(ScientificArtifactRecord, ref["artifact_id"])
                    (artifacts / (row.format_identifier + ".evidence")).write_bytes(
                        store.get_bytes(row.storage_key, api[2].scientific_max_output_bytes)
                    )


# --- Final acceptance polish: N1 (retry runtime errors) and N2 (terminal investigation status) ---

_WATCHED_TABLES = (
    "calculations",
    "calculation_inputs",
    "calculation_attempts",
    "calculation_results",
    "compute_jobs",
    "compute_executions",
    "compute_leases",
    "compute_estimates",
    "compute_reservations",
    "provenance_records",
    "scientific_artifacts",
    "audit_events",
)


def _scientific_snapshot(api):
    """Digest of every row of every table a retry could mutate (not the project serializer)."""
    from sqlalchemy import text

    with api[1]() as session:
        existing = {
            row[0]
            for row in session.execute(text("select name from sqlite_master where type='table'"))
        }
        return {
            table: digest(
                encode(
                    [
                        [str(value) for value in row]
                        for row in session.execute(text(f"select * from {table} order by 1"))
                    ]
                )
            )
            for table in _WATCHED_TABLES
            if table in existing
        }


def test_retry_runtime_unavailable_is_503_without_state_change(evidence_api, monkeypatch, tmp_path):
    import chemdft_api.dftd4_actions as actions

    api = evidence_api
    failed = failed_execution(api, monkeypatch)
    configured = api[2].dftd4_executable
    before = _scientific_snapshot(api)
    try:
        # A. Executable unset: unavailable, never a runtime conflict or a raw exception.
        api[2].dftd4_executable = None
        unset = retry(api, failed)
        assert unset.status_code == 503, unset.text
        detail = unset.json()["detail"]
        assert detail["code"] == "DFTD4_RUNTIME_UNAVAILABLE"
        assert "not configured" in detail["message"]
        assert "NoneType" not in unset.text and "TypeError" not in unset.text
        assert _scientific_snapshot(api) == before
        # B. Executable path missing: structured unavailable response without a stack message.
        api[2].dftd4_executable = tmp_path / "missing" / "bin" / "dftd4"
        missing = retry(api, failed)
        assert missing.status_code == 503, missing.text
        assert missing.json()["detail"]["code"] == "DFTD4_RUNTIME_UNAVAILABLE"
        assert "Errno" not in missing.text and "Traceback" not in missing.text
        assert _scientific_snapshot(api) == before
    finally:
        api[2].dftd4_executable = configured

    # C. Genuine mismatches remain conflicts (409), including an installed runtime that
    # verifies but is not the frozen execution environment.
    def pin_mismatch(*args):
        raise ValueError("D4 pinned executable/library/table differs: bin/dftd4")

    with monkeypatch.context() as patch:
        patch.setattr(actions, "environment_identity", pin_mismatch)
        conflict = retry(api, failed)
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["detail"]["code"] == "DFTD4_RUNTIME_CONFLICT"
        assert "pinned executable" in conflict.json()["detail"]["message"]
    for raw in (TypeError("raw internal detail"), KeyError("raw_key")):
        with monkeypatch.context() as patch:

            def raising(*args, _raw=raw):
                raise _raw

            patch.setattr(actions, "environment_identity", raising)
            masked = retry(api, failed)
            assert masked.status_code == 409, masked.text
            assert masked.json()["detail"]["code"] == "DFTD4_RUNTIME_CONFLICT"
            assert "raw" not in masked.text
    with monkeypatch.context() as patch:
        patch.setattr(actions, "environment_identity", lambda *a: {"engine": "dftd4", "other": 1})
        differs = retry(api, failed)
        assert differs.status_code == 409, differs.text
        assert differs.json()["detail"]["code"] == "DFTD4_RUNTIME_CONFLICT"
    assert _scientific_snapshot(api) == before

    # D. A valid retry is unchanged, and uses one new execution/attempt on the same job.
    valid = retry(api, failed)
    assert valid.status_code == 200, valid.text
    assert valid.json()["calculation"]["state"] == "QUEUED"
    assert valid.json()["calculation"]["id"] == failed["calculation"]["id"]


@native
def test_retry_after_success_ignores_runtime_configuration(evidence_api):
    api = evidence_api
    success = run(api, submit(api).json()).model_dump(mode="json")
    assert success["calculation"]["state"] == "SUCCEEDED"
    configured = api[2].dftd4_executable
    before = _scientific_snapshot(api)
    try:
        api[2].dftd4_executable = None
        # E. Existing authoritative result is returned; nothing is created or executed.
        replay = retry(api, success)
        assert replay.status_code == 200, replay.text
        assert replay.json()["result"]["id"] == success["result"]["id"]
        assert submit(api).json()["result"]["id"] == success["result"]["id"]
    finally:
        api[2].dftd4_executable = configured
    # F. Neither request wrote scientific, scheduling or audit state.
    assert _scientific_snapshot(api) == before


def _investigation_with_d4_evidence(api):
    client = api[0]
    published = run(api, submit(api).json()).model_dump(mode="json")
    pid, rid = published["calculation"]["project_id"], published["result"]["id"]
    investigation = client.post(
        f"/v1/projects/{pid}/investigations",
        json={"title": "Terminal status", "objective": "Preserve terminal states"},
    ).json()
    url = f"/v1/projects/{pid}/investigations/{investigation['id']}"
    added = client.post(
        url + "/observations",
        json={
            "source_entity_type": "CALCULATION_RESULT",
            "source_entity_id": rid,
            "source_class": "CALCULATED",
            "summary": "Native D4 combined energy",
        },
    )
    assert added.status_code == 200, added.text
    return client, url, investigation["id"]


@pytest.mark.parametrize("terminal", ["CANCELED", "COMPLETED", "FAILED"])
def test_terminal_investigation_status_survives_inactive_evidence(evidence_api, terminal):
    from chemdft_api.investigation_models import InvestigationRecord
    from sqlalchemy import update

    api = evidence_api
    client, url, investigation_id = _investigation_with_d4_evidence(api)
    if terminal == "CANCELED":
        assert client.post(url + "/cancel").status_code == 200
    else:
        with api[1]() as session:
            session.execute(
                update(InvestigationRecord)
                .where(InvestigationRecord.id == investigation_id)
                .values(status=terminal, limit_reason=f"original-{terminal.lower()}-reason")
            )
            session.commit()
    before = client.get(url).json()
    assert before["status"] == terminal and before["current_evidence_valid"] is True
    append_status(api, "RETRACTED")
    after = client.get(url).json()
    assert after["status"] == terminal and after["stored_status"] == terminal
    # Evidence-invalid diagnostics stay visible, and the original limit reason is not replaced.
    assert after["current_evidence_valid"] is False
    assert len(after["inactive_observation_ids"]) == 1
    assert after["observations"][0]["current"] is False
    assert after["observations"][0]["effective_result_state"]["source_lineage_validity"] == (
        "RETRACTED"
    )
    assert after["limit_reason"] == before["limit_reason"]
    # Terminal and inactive: no continuation or new derivation is possible.
    assert client.post(url + "/resume").status_code in {409, 422}
    assert client.post(url + "/start").status_code in {409, 422}
    with api[1]() as session:
        assert session.get(InvestigationRecord, investigation_id).status == terminal


def test_nonterminal_investigation_with_inactive_evidence_stays_guarded(evidence_api):
    api = evidence_api
    client, url, _investigation_id = _investigation_with_d4_evidence(api)
    stored = client.get(url).json()["status"]
    assert stored not in {"CANCELED", "COMPLETED", "FAILED"}
    append_status(api, "RETRACTED")
    guarded = client.get(url).json()
    assert guarded["status"] == "PAUSED" and guarded["stored_status"] == stored
    assert guarded["limit_reason"] == "INACTIVE_SCIENTIFIC_EVIDENCE"
    assert guarded["current_evidence_valid"] is False
    assert client.post(url + "/start").status_code == 422
    assert client.post(url + "/resume").status_code == 422


def test_project_reads_are_never_cacheable_after_source_invalidation(evidence_api):
    """Safe-method project reads are no-store, so no cache can outlive a source retraction."""
    api = evidence_api
    client = api[0]
    published = run(api, submit(api).json()).model_dump(mode="json")
    pid, rid = published["calculation"]["project_id"], published["result"]["id"]
    cid = published["calculation"]["id"]
    reads = [
        f"/v1/projects/{pid}/results/{rid}",
        f"/v1/projects/{pid}/results",
        f"/v1/projects/{pid}/results/{rid}/export",
        f"/v1/projects/{pid}/calculations/{cid}",
        f"/v1/projects/{pid}/scientific-claims",
        f"/v1/projects/{pid}/scientific-comparison",
        f"/v1/projects/{pid}/investigations",
    ]
    for state in (None, "RETRACTED"):
        if state:
            append_status(api, state)
        for url in reads:
            response = client.get(url)
            assert response.status_code == 200, (url, response.text)
            assert response.headers["cache-control"] == "no-store", url
    # A route-specific policy is respected rather than overwritten.
    artifact = published["result"]["raw_artifacts"][0]["artifact_id"]
    download = client.get(f"/v1/projects/{pid}/calculations/{cid}/artifacts/{artifact}")
    assert download.headers["cache-control"] == "no-store"
    assert client.get(f"/v1/projects/{pid}/results/{rid}").json()["authority"] == "CANDIDATE"
