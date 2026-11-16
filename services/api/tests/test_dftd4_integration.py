"""Restricted D4 acceptance on disposable copies of accepted PF-8D evidence."""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from chemdft_api.config import Settings, get_settings
from chemdft_api.database import get_session
from chemdft_api.main import app
from chemdft_api.scientific.engines.dftd4 import PARAMETERS, digest, encode, variant_identity
from chemdft_api.scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ComputeJobRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
)
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def evidence_api(tmp_path):
    source_db = ROOT / "output/playwright/pf8d-c1/acceptance.db"
    if not source_db.exists():
        pytest.skip("Accepted PF-8D source evidence is required for native integration")
    database = tmp_path / "test.db"
    with (
        sqlite3.connect(f"file:{source_db}?mode=ro", uri=True) as source,
        sqlite3.connect(database) as target,
    ):
        source.backup(target)
    shutil.copytree(source_db.parent / "objects", tmp_path / "objects")
    engine = create_engine(
        f"sqlite:///{database}", connect_args={"check_same_thread": False, "timeout": 15}
    )
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with sessions() as session:
        sources = session.scalars(
            select(CalculationResultRecord).where(
                CalculationResultRecord.result_type == "chemdft.energy",
                CalculationResultRecord.trusted_producer_id == "local.psi4.worker",
            )
        ).all()
        sources = {
            r.payload_json["method"]: (r.project_id, r.id)
            for r in sources
            if r.payload_json.get("method") in ("b3lyp", "pbe")
            and r.payload_json.get("basis") == "def2-svp"
        }
        project_id, result_id = sources["b3lyp"]
        result = session.get(CalculationResultRecord, result_id)
        calc = session.get(CalculationRecord, result.calculation_id)
        organization = session.execute(
            __import__("sqlalchemy").text("select organization_id from projects where id=:id"),
            {"id": project_id},
        ).scalar_one()
        user_id = calc.created_by
    settings = Settings(
        database_url=f"sqlite:///{database}",
        object_root=tmp_path / "objects",
        auto_create_schema=False,
        dev_identity_enabled=True,
        auth_mode="dev",
        dev_user_id=user_id,
        dev_organization_id=organization,
        dftd4_executable=ROOT / ".chemdft/envs/dftd4-4.2.0-pf8e/bin/dftd4",
        ai_provider="fake",
        run_ai_integration=False,
    )

    def session_override():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = session_override
    with TestClient(app) as client:
        yield client, sessions, settings, sources
    app.dependency_overrides.clear()
    engine.dispose()


def submit(api, method="b3lyp", **extra):
    client, _, _, sources = api
    project, source = sources[method]
    response = client.post(
        f"/v1/projects/{project}/dispersion-corrections",
        json={"source_result_id": source, "idempotency_key": str(uuid4()), **extra},
    )
    return response


def run(api, queued, *, machine_identity=False):
    from chemdft_api.calculation_actions import _process_next_compute_job
    from chemdft_api.context import Identity
    from chemdft_api.storage import LocalObjectStore

    _client, sessions, settings, _ = api
    with sessions() as session:
        identity = Identity(
            user_id=settings.dev_user_id, organization_id=settings.dev_organization_id
        )
        if machine_identity:
            from chemdft_api.service_principals import (
                SERVICE_COMPUTE_WORKER,
                ensure_service_principals,
                service_identity,
            )

            ensure_service_principals(session)
            identity = service_identity(SERVICE_COMPUTE_WORKER)
        job = session.scalar(
            select(ComputeJobRecord).where(
                ComputeJobRecord.calculation_id == queued["calculation"]["id"]
            )
        )
        return _process_next_compute_job(
            session, identity, LocalObjectStore(settings.object_root), settings, job_id=job.id
        )


def test_source_variant_identity_is_scientific_and_stable():
    original = variant_identity("b3lyp", PARAMETERS["b3lyp"])
    assert original == variant_identity("B3LYP", PARAMETERS["b3lyp"].model_dump(mode="json"))
    changed = PARAMETERS["b3lyp"].model_copy(update={"s9": 0})
    assert original != variant_identity("b3lyp", changed)
    assert original != variant_identity("pbe", PARAMETERS["pbe"])


def test_source_and_duplicate_submission(evidence_api):
    first = submit(evidence_api)
    assert first.status_code == 201, first.text
    second = submit(evidence_api)
    assert second.status_code == 201, second.text
    assert first.json()["calculation"]["id"] == second.json()["calculation"]["id"]
    assert first.json()["specification"]["parameters"]["s8"] == 2.02929367


def test_concurrent_duplicate_submission(evidence_api):
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: submit(evidence_api), range(2)))
    assert [r.status_code for r in responses] == [201, 201], [r.text for r in responses]
    assert len({r.json()["calculation"]["id"] for r in responses}) == 1


def test_source_bohr_conversion_and_d4_xyz_round_trip(evidence_api):
    from chemdft_api.contracts.scientific import CalculationSpecification
    from chemdft_api.scientific.engines.dftd4 import xyz_bytes
    from chemdft_api.scientific.engines.normalization import (
        BOHR_PER_ANGSTROM,
        normalized_calculation_input,
    )
    from chemdft_api.scientific_models import StructureVersionRecord

    with evidence_api[1]() as session:
        source = session.get(CalculationResultRecord, evidence_api[3]["b3lyp"][1])
        inp = session.get(CalculationInputRecord, source.calculation_input_id)
        original = session.get(StructureVersionRecord, inp.structure_version_id)
        values = {
            c.name: getattr(original, c.name) for c in StructureVersionRecord.__table__.columns
        }
        # Unpersisted copy: the accepted source and its stored coordinates stay untouched.
        version = StructureVersionRecord(**values)
        spec = CalculationSpecification.model_validate(inp.specification_json)
        angstrom, _, _ = normalized_calculation_input(version, spec, max_atoms=128)
        representation = json.loads(json.dumps(version.representation_json))
        representation["coordinates"]["unit"] = "bohr"
        for atom in representation["coordinates"]["atoms"]:
            for axis in ("x", "y", "z"):
                atom[axis] *= BOHR_PER_ANGSTROM
        version.representation_json = representation
        version.coordinate_unit = "bohr"
        converted, _, _ = normalized_calculation_input(version, spec, max_atoms=128)
    queued = submit(evidence_api)
    assert queued.status_code == 201, queued.text
    from chemdft_api.storage import LocalObjectStore

    with evidence_api[1]() as session:
        inp = session.scalar(
            select(CalculationInputRecord).where(
                CalculationInputRecord.calculation_id == queued.json()["calculation"]["id"]
            )
        )
        artifact = session.get(ScientificArtifactRecord, inp.normalized_input_artifact_id)
        d4_document = json.loads(
            LocalObjectStore(evidence_api[2].object_root).get_bytes(
                artifact.storage_key, evidence_api[2].scientific_max_output_bytes
            )
        )
    d4_document["atoms"] = converted["atoms"]
    d4_document["specification"]["source"]["geometry_sha256"] = digest(encode(converted["atoms"]))
    rows = xyz_bytes(d4_document).decode().splitlines()[2:]
    for expected, atom, row in zip(angstrom["atoms"], converted["atoms"], rows, strict=True):
        assert atom["xyz_angstrom"] == pytest.approx(expected["xyz_angstrom"], rel=0, abs=1e-15)
        assert row.split()[0] == atom["element"]
        assert [float(x) for x in row.split()[1:]] == atom["xyz_angstrom"]


def test_lost_worker_restart_preserves_source_variant_identity(evidence_api):
    from datetime import timedelta

    from chemdft_api.calculation_actions import recover_expired_compute_leases
    from chemdft_api.models import utc_now
    from chemdft_api.scientific_models import ComputeExecutionRecord, ComputeLeaseRecord

    first = submit(evidence_api)
    assert first.status_code == 201, first.text
    calculation_id = first.json()["calculation"]["id"]
    with evidence_api[1]() as session:
        calc = session.get(CalculationRecord, calculation_id)
        job = session.scalar(
            select(ComputeJobRecord).where(ComputeJobRecord.calculation_id == calc.id)
        )
        calc.state = job.state = "RUNNING"
        execution = ComputeExecutionRecord(
            project_id=job.project_id,
            job_id=job.id,
            calculation_id=calc.id,
            provider="local",
            state="RUNNING",
            worker_id="local.dftd4.worker",
            lease_owner="local.dftd4.worker",
            authorization_hash="b" * 64,
            authorization_expires_at=utc_now() - timedelta(minutes=1),
            started_at=utc_now() - timedelta(minutes=10),
            heartbeat_at=utc_now() - timedelta(minutes=10),
        )
        session.add(execution)
        session.flush()
        session.add(
            ComputeLeaseRecord(
                project_id=job.project_id,
                job_id=job.id,
                execution_id=execution.id,
                owner="local.dftd4.worker",
                lease_token_hash="c" * 64,
                state="ACTIVE",
                expires_at=utc_now() - timedelta(minutes=5),
                heartbeat_deadline_at=utc_now() - timedelta(minutes=5),
                heartbeat_at=utc_now() - timedelta(minutes=10),
            )
        )
        session.commit()
    # A new worker session recovers the persisted lease after a simulated process loss.
    with evidence_api[1]() as session:
        assert recover_expired_compute_leases(session) == 0
        assert session.get(CalculationRecord, calculation_id).state == "FAILED"
    retry = submit(evidence_api)
    assert retry.status_code == 201, retry.text
    assert retry.json()["calculation"]["id"] == calculation_id
    assert retry.json()["result"] is None
    with evidence_api[1]() as session:
        assert session.query(ComputeJobRecord).filter_by(calculation_id=calculation_id).count() == 1


@pytest.mark.parametrize("state", ["RETRACTED", "SUPERSEDED", "INVALIDATED"])
def test_inactive_source_rejected(evidence_api, state):
    _, sessions, _, sources = evidence_api
    with sessions() as session:
        source = session.get(CalculationResultRecord, sources["b3lyp"][1])
        values = (
            {"validation_state": "DISPUTED"}
            if state == "INVALIDATED"
            else {"verification_state": state}
        )
        session.execute(
            update(CalculationResultRecord)
            .where(CalculationResultRecord.id == source.id)
            .values(**values)
        )
        session.commit()
    response = submit(evidence_api)
    assert response.status_code == 422, response.text


@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_DFTD4_NATIVE") != "1", reason="explicit isolated D4 native opt-in"
)
@pytest.mark.parametrize("method", ["b3lyp", "pbe"])
def test_positive_native_publication(evidence_api, method):
    response = submit(evidence_api, method)
    assert response.status_code == 201, response.text
    detail = run(evidence_api, response.json(), machine_identity=True)
    assert detail.calculation.state == "SUCCEEDED", detail.model_dump(mode="json")
    assert detail.result.validation_state == "VALIDATED"
    assert detail.result.verification_state == "UNVERIFIED"
    expected = {"b3lyp": -0.00030950271513664697, "pbe": -0.00019530371933493287}[method]
    payload = detail.result.payload
    assert payload.d4_correction_energy.value == pytest.approx(expected, rel=0, abs=1e-12)
    assert payload.corrected_total_energy.value == pytest.approx(
        payload.uncorrected_dft_energy.value + expected, rel=0, abs=1e-10
    )
    _, sessions, _, _ = evidence_api
    with sessions() as session:
        edges = session.scalars(
            select(ProvenanceInputRow).where(
                ProvenanceInputRow.provenance_record_id == str(detail.result.provenance_record_id)
            )
        ).all()
        assert len(edges) == 1 and edges[0].input_id == str(payload.source.result_id)
    reference_bytes = (ROOT / ".chemdft/pf8e-gate-a4-20261011/numerical-results.json").read_bytes()
    assert (
        digest(reference_bytes)
        == "0053eac96f95b76e621c7fca52cf96f5c5eedec4f1c43809b0fdf791e69b5b1b"
    )
    reference = next(
        row
        for row in json.loads(reference_bytes)
        if row["method"] == method and row["molecule"] == "persisted-psi4-water"
    )
    from chemdft_api.storage import LocalObjectStore

    settings = evidence_api[2]
    with sessions() as session:
        artifact = session.get(
            ScientificArtifactRecord,
            next(
                str(ref.artifact_id)
                for ref in detail.result.raw_artifacts
                if ref.sha256 == detail.calculation_input_hash
            ),
        )
        input_bytes = LocalObjectStore(settings.object_root).get_bytes(
            artifact.storage_key, settings.scientific_max_output_bytes
        )
    document = json.loads(input_bytes)
    assert [a["xyz_angstrom"] for a in document["atoms"]] == reference["coordinates_angstrom"]
    assert [a["atomic_number"] for a in document["atoms"]] == reference["atomic_numbers"]
    tad = reference["s9"]["1"]["tad_Eh"]
    assert abs(payload.d4_correction_energy.value - tad) <= 1e-9
    comparison = {
        "reference_sha256": digest(reference_bytes),
        "reference_category": "accepted Gate A4 tad-dftd4 0.8.0",
        "native_correction_Eh": payload.d4_correction_energy.value,
        "independent_correction_Eh": tad,
        "absolute_difference_Eh": abs(payload.d4_correction_energy.value - tad),
        "tolerance_Eh": 1e-9,
        "same_source_plus_independent_correction_Eh": payload.uncorrected_dft_energy.value + tad,
        "independently_verified_combined_energy": False,
    }
    if directory := os.environ.get("CHEMDFT_DFTD4_REVIEW_OUTPUT"):
        output = Path(directory) / method
        output.mkdir(parents=True, exist_ok=True)
        (output / "calculation-detail.json").write_text(
            json.dumps(detail.model_dump(mode="json"), indent=2) + "\n"
        )
        (output / "independent-comparison.json").write_text(json.dumps(comparison, indent=2) + "\n")
        with sessions() as session:
            provenance = session.get(ProvenanceRecordRow, str(detail.result.provenance_record_id))
            (output / "provenance.json").write_text(
                json.dumps(
                    {
                        c.name: str(getattr(provenance, c.name))
                        if c.name == "created_at"
                        else getattr(provenance, c.name)
                        for c in ProvenanceRecordRow.__table__.columns
                    },
                    indent=2,
                )
                + "\n"
            )
            for ref in detail.result.raw_artifacts:
                artifact = session.get(ScientificArtifactRecord, str(ref.artifact_id))
                evidence = LocalObjectStore(settings.object_root).get_bytes(
                    artifact.storage_key, settings.scientific_max_output_bytes
                )
                assert digest(evidence) == ref.sha256
                (output / (artifact.format_identifier + ".evidence")).write_bytes(evidence)
    retry = submit(evidence_api, method)
    assert retry.status_code == 201 and retry.json()["result"]["id"] == str(detail.result.id)


def test_request_key_cannot_bind_another_source(evidence_api):
    key = str(uuid4())
    first = submit(evidence_api, idempotency_key=key)
    assert first.status_code == 201, first.text
    other = submit(evidence_api, "pbe", idempotency_key=key)
    assert other.status_code == 409


@pytest.mark.parametrize(
    "damage", ["method", "unit", "charge", "payload", "provenance", "canonical", "native"]
)
def test_invalid_source_evidence_fails_before_queue(evidence_api, damage):
    _, sessions, settings, sources = evidence_api
    with sessions() as session:
        source = session.get(CalculationResultRecord, sources["b3lyp"][1])
        inp = session.get(CalculationInputRecord, source.calculation_input_id)
        if damage in ("method", "charge"):
            spec = dict(inp.specification_json)
            if damage == "method":
                spec["method"] = {**spec["method"], "identifier": "hf"}
            else:
                spec["charge"] = 1
            session.execute(
                update(CalculationInputRecord)
                .where(CalculationInputRecord.id == inp.id)
                .values(specification_json=spec)
            )
        elif damage in ("payload", "unit"):
            payload = json.loads(json.dumps(source.payload_json))
            if damage == "payload":
                payload["total_energy"]["value"] += 0.01
            else:
                payload["total_energy"]["unit"]["code"] = "eV"
            session.execute(
                update(CalculationResultRecord)
                .where(CalculationResultRecord.id == source.id)
                .values(payload_json=payload)
            )
        elif damage == "provenance":
            session.execute(
                update(ProvenanceRecordRow)
                .where(ProvenanceRecordRow.id == source.provenance_record_id)
                .values(subject_id=str(uuid4()))
            )
        else:
            if damage == "canonical":
                from chemdft_api.scientific_models import StructureVersionRecord

                artifact_id = session.get(
                    StructureVersionRecord, inp.structure_version_id
                ).canonical_artifact_id
            else:
                artifact_id = next(
                    ref["artifact_id"]
                    for ref in source.raw_artifacts_json
                    if session.get(ScientificArtifactRecord, ref["artifact_id"]).format_identifier
                    == "psi4.native.output.json"
                )
            artifact = session.get(ScientificArtifactRecord, artifact_id)
            (settings.object_root / artifact.storage_key).write_bytes(b"tampered")
        session.commit()
        before = session.query(CalculationRecord).count()
    response = submit(evidence_api)
    assert response.status_code == 422, response.text
    with sessions() as session:
        assert session.query(CalculationRecord).count() == before


@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_DFTD4_NATIVE") != "1", reason="explicit isolated D4 native opt-in"
)
@pytest.mark.parametrize(
    "damage",
    [
        "native-bytes",
        "exact-parameters",
        "argv",
        "atom-order",
        "extra-charge-file",
        "exit-status",
        "payload",
        "source",
        "edge",
        "lease",
        "authorization",
        "cancel",
        "reservation",
        "superseded",
        "generic-energy",
    ],
)
def test_firewall_rejects_tamper_and_rolls_back(evidence_api, monkeypatch, damage):
    from datetime import timedelta

    from chemdft_api import calculation_actions as actions
    from chemdft_api.contracts.results import EnergyResult
    from chemdft_api.models import utc_now
    from chemdft_api.scientific_models import (
        ComputeExecutionRecord,
        ComputeLeaseRecord,
        ComputeReservationRecord,
    )

    original = actions.accept_authoritative_result
    entered = []

    def intercept(session, producer, submission, **kwargs):
        session.flush()
        entered.append(True)
        if damage in (
            "native-bytes",
            "exact-parameters",
            "argv",
            "atom-order",
            "extra-charge-file",
            "exit-status",
        ):
            records = {
                session.get(
                    ScientificArtifactRecord, str(ref.artifact_id)
                ).format_identifier.removeprefix("dftd4.native."): session.get(
                    ScientificArtifactRecord, str(ref.artifact_id)
                )
                for ref in submission.raw_artifacts
                if session.get(
                    ScientificArtifactRecord, str(ref.artifact_id)
                ).format_identifier.startswith("dftd4.native.")
            }
            root = evidence_api[2].object_root
            raw = {name: (root / r.storage_key).read_bytes() for name, r in records.items()}
            if damage == "native-bytes":
                (root / records["dftd4.json"].storage_key).write_bytes(b"changed")
            else:
                name = (
                    "input.xyz"
                    if damage == "atom-order"
                    else "execution.json"
                    if damage in ("extra-charge-file", "exit-status")
                    else "invocation.json"
                )
                if damage == "atom-order":
                    lines = raw[name].decode().splitlines()
                    lines[2:] = reversed(lines[2:])
                    raw[name] = ("\n".join(lines) + "\n").encode()
                else:
                    item = json.loads(raw[name])
                    if damage == "exact-parameters":
                        item["exact_parameters"]["s8"] += 1e-8  # invisible in rounded stdout
                    elif damage == "argv":
                        item["argv"][item["argv"].index("--mbdscale") + 1] = "0"
                    elif damage == "extra-charge-file":
                        item["files"].append(".CHRG")
                    else:
                        item["exit_code"] = 1
                    raw[name] = encode(item)
                raw["hashes.json"] = encode(
                    {n: digest(b) for n, b in raw.items() if n != "hashes.json"}
                )
                for n in (name, "hashes.json"):
                    (root / records[n].storage_key).write_bytes(raw[n])
                    session.execute(
                        update(ScientificArtifactRecord)
                        .where(ScientificArtifactRecord.id == records[n].id)
                        .values(sha256=digest(raw[n]), size_bytes=len(raw[n]))
                    )
                # Coherently update all artifact references so validation reaches the native parser.
                refs = tuple(
                    ref.model_copy(
                        update={
                            "sha256": digest(
                                raw[
                                    next(
                                        n
                                        for n, r in records.items()
                                        if r.id == str(ref.artifact_id)
                                    )
                                ]
                            )
                        }
                    )
                    if str(ref.artifact_id) in {records[name].id, records["hashes.json"].id}
                    else ref
                    for ref in submission.raw_artifacts
                )
                submission = submission.model_copy(update={"raw_artifacts": refs})
                session.expire_all()
                attempt = session.get(
                    __import__(
                        "chemdft_api.scientific_models", fromlist=["CalculationAttemptRecord"]
                    ).CalculationAttemptRecord,
                    session.scalar(
                        select(ComputeExecutionRecord).where(
                            ComputeExecutionRecord.calculation_id == str(submission.calculation_id)
                        )
                    ).calculation_attempt_id,
                )
                session.execute(
                    update(type(attempt))
                    .where(type(attempt).id == attempt.id)
                    .values(raw_artifacts_json=[ref.model_dump(mode="json") for ref in refs])
                )
                session.expire_all()
        elif damage == "payload":
            payload = submission.payload.model_copy(
                update={
                    "d4_correction_energy": submission.payload.d4_correction_energy.model_copy(
                        update={"value": -0.1}
                    )
                }
            )
            submission = submission.model_copy(update={"payload": payload})
        elif damage == "source":
            source = session.get(CalculationResultRecord, str(submission.payload.source.result_id))
            session.execute(
                update(CalculationResultRecord)
                .where(CalculationResultRecord.id == source.id)
                .values(verification_state="RETRACTED")
            )
            session.expire_all()
        elif damage == "edge":
            session.query(ProvenanceInputRow).filter_by(
                provenance_record_id=str(submission.provenance_record_id)
            ).delete(synchronize_session=False)
        elif damage == "generic-energy":
            submission = submission.model_copy(
                update={
                    "result_type": "chemdft.energy",
                    "payload": EnergyResult(
                        total_energy=submission.payload.corrected_total_energy,
                        method="b3lyp",
                        basis="def2-svp",
                        parser_version="1.0.0",
                        validator_version="1.0.0",
                    ),
                }
            )
        else:
            execution = session.scalar(
                select(ComputeExecutionRecord).where(
                    ComputeExecutionRecord.calculation_id == str(submission.calculation_id)
                )
            )
            if damage == "lease":
                session.execute(
                    update(ComputeLeaseRecord)
                    .where(ComputeLeaseRecord.execution_id == execution.id)
                    .values(expires_at=utc_now() - timedelta(seconds=1))
                )
            elif damage == "authorization":
                execution.authorization_expires_at = utc_now() - timedelta(seconds=1)
            elif damage == "cancel":
                session.execute(
                    update(ComputeJobRecord)
                    .where(ComputeJobRecord.id == execution.job_id)
                    .values(state="CANCEL_REQUESTED")
                )
            elif damage == "reservation":
                job = session.get(ComputeJobRecord, execution.job_id)
                session.get(ComputeReservationRecord, job.reservation_id).state = "RELEASED"
            elif damage == "superseded":
                values = {
                    c.name: getattr(execution, c.name)
                    for c in ComputeExecutionRecord.__table__.columns
                }
                values.update(id=str(uuid4()), started_at=utc_now(), calculation_attempt_id=None)
                session.add(ComputeExecutionRecord(**values))
            session.flush()
            session.expire_all()
        return original(session, producer, submission, **kwargs)

    monkeypatch.setattr(actions, "accept_authoritative_result", intercept)
    response = submit(evidence_api)
    assert response.status_code == 201, response.text
    detail = run(evidence_api, response.json())
    assert entered, "tamper must reach the actual Firewall"
    assert detail.result is None and detail.calculation.state in ("FAILED", "CANCELED"), (
        detail.model_dump(mode="json")
    )
    assert "Only a succeeded" not in (detail.attempt.diagnostic or ""), detail.attempt.diagnostic
    with evidence_api[1]() as session:
        assert (
            session.scalar(
                select(CalculationResultRecord).where(
                    CalculationResultRecord.calculation_id == str(detail.calculation.id)
                )
            )
            is None
        )
        assert (
            session.scalar(
                select(ProvenanceRecordRow).where(
                    ProvenanceRecordRow.producer_identifier == "local.dftd4.worker"
                )
            )
            is None
        )


@pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_DFTD4_NATIVE") != "1", reason="explicit isolated D4 native opt-in"
)
@pytest.mark.parametrize("state", ["RETRACTED", "SUPERSEDED", "DISPUTED"])
def test_append_only_source_status_propagates_without_rewriting_results(evidence_api, state):
    from chemdft_api.models import new_id

    response = submit(evidence_api)
    assert response.status_code == 201, response.text
    detail = run(evidence_api, response.json())
    assert detail.result is not None
    client, sessions, _, _ = evidence_api
    with sessions() as session:
        source = session.get(CalculationResultRecord, str(detail.result.payload.source.result_id))
        p = session.get(ProvenanceRecordRow, source.provenance_record_id)
        # The real append-only supersession mechanism leaves original evidence intact.
        values = {c.name: getattr(p, c.name) for c in ProvenanceRecordRow.__table__.columns}
        values.update(
            id=new_id(),
            verification_state=state,
            supersedes_id=p.id,
            operation="chemdft.scientific-status",
            parameters_json=[{"name": "reason", "value": "isolated regression"}],
        )
        session.add(ProvenanceRecordRow(**values))
        session.commit()
    read = client.get(
        f"/v1/projects/{detail.calculation.project_id}/calculations/{detail.calculation.id}"
    )
    assert read.status_code == 200, read.text
    assert read.json()["result"]["authority"] == "CANDIDATE"
    assert read.json()["result"]["validation_state"] != "VALIDATED"
    assert read.json()["result"]["verification_state"] == "UNVERIFIED"
    assert read.json()["result"]["effective_state"]["source_lineage_validity"] == state
    with sessions() as session:
        original = session.get(CalculationResultRecord, str(detail.result.id))
        assert original.authority == "AUTHORITATIVE" and original.validation_state == "VALIDATED"
        assert session.query(ProvenanceRecordRow).filter_by(supersedes_id=p.id).count() == 1
    rejected = submit(evidence_api)
    assert rejected.status_code == 422
