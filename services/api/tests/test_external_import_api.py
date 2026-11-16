# ruff: noqa: E501
"""External Import API workflow: upload -> hash-bound preview (no scientific writes) -> confirmation -> transactional import.

Always-on tests use a fake runner returning a contract-valid synthetic preview (plumbing, authority, atomicity). Tests marked
`requires_corpus` run the same flow through the real isolated worker on real Gaussian/ORCA outputs.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from chemdft_api import external_import_actions as actions
from chemdft_api.contracts.external_import import IMPORTED_RESULT_TYPES, ImportedResultView
from chemdft_api.scientific_models import (
    CalculationResultRecord,
    ExternalImportConfirmationRecord,
    ExternalImportJobRecord,
    ExternalImportRecord,
    ImportedResultRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)
from external_import_support import fake_runner, fixture_bytes, requires_corpus, synthetic_report
from sqlalchemy import func, select

SYNTHETIC = b"synthetic external output placeholder\n" * 20


@pytest.fixture
def project(api):
    client, _, _ = api
    response = client.post("/v1/projects", json={"name": "Import project", "slug": "import-project"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def synthetic(monkeypatch):
    monkeypatch.setattr(actions, "run_import_worker", fake_runner(lambda data: synthetic_report(data)))


def upload(client, project_id, data=SYNTHETIC, name="water.log", key="import-key-0001"):
    return client.post(
        f"/v1/projects/{project_id}/external-imports",
        files={"upload": (name, data, "text/plain")},
        data={"idempotency_key": key},
    )


def counts(sessions) -> dict[str, int]:
    with sessions() as session:
        def n(model):
            return session.scalar(select(func.count()).select_from(model))

        return {
            "structures": n(StructureRecord),
            "versions": n(StructureVersionRecord),
            "imported_results": n(ImportedResultRecord),
            "jobs": n(ExternalImportJobRecord),
            "confirmations": n(ExternalImportConfirmationRecord),
            "calculation_results": n(CalculationResultRecord),
            "imports": n(ExternalImportRecord),
        }


# ------------------------------------------------------------------------------------------------ preview writes nothing scientific
def test_upload_creates_a_preview_and_no_scientific_records(api, project, synthetic):
    client, sessions, _ = api
    response = upload(client, project)
    assert response.status_code == 201, response.text
    view = response.json()
    assert view["state"] == "PREVIEW_READY" and view["preview"]["status"] == "READY"
    assert view["preview"]["program"]["label"] == "Gaussian 16 Rev C.01" and view["source"]["immutable"] is True
    assert view["source"]["media_class"] == "text/plain; chemdft=external-output"
    assert view["preview_sha256"] == synthetic_report(SYNTHETIC)["preview_sha256"]
    assert counts(sessions) == {"structures": 0, "versions": 0, "imported_results": 0, "jobs": 0, "confirmations": 0, "calculation_results": 0, "imports": 1}
    assert [r["result_type"] for r in view["preview"]["results"]]  # summary only; payloads are stored and hash-bound, not sent


def test_raw_source_is_stored_immutably_with_its_sha256(api, project, synthetic):
    client, sessions, settings = api
    view = upload(client, project).json()
    sha = hashlib.sha256(SYNTHETIC).hexdigest()
    assert view["source"]["sha256"] == sha and view["source"]["size_bytes"] == len(SYNTHETIC)
    with sessions() as session:
        artifact = session.get(ScientificArtifactRecord, view["source"]["raw_artifact_id"])
        assert artifact.kind == "CALCULATION_OUTPUT" and artifact.sha256 == sha
        assert (settings.object_root / artifact.storage_key).read_bytes() == SYNTHETIC
        artifact.sha256 = "0" * 64
        with pytest.raises(ValueError, match="append-only"):
            session.flush()


def test_filename_is_sanitized_and_never_used_for_detection(api, project, synthetic):
    client, _, _ = api
    view = upload(client, project, name="../../etc/passwd\x00 evil.orca.out").json()
    assert "/" not in view["source"]["original_name"] and "\x00" not in view["source"]["original_name"]
    assert view["preview"]["program"]["engine"] == "Gaussian"  # decided by the (fake) parse of the content, not the .orca.out name


def test_idempotent_upload_returns_the_same_import(api, project, synthetic):
    client, sessions, _ = api
    first = upload(client, project).json()
    second = upload(client, project).json()
    assert first["id"] == second["id"] and counts(sessions)["imports"] == 1


def test_size_limit_is_enforced(api, project, synthetic):
    client, _, settings = api
    settings.max_import_bytes = 64
    assert upload(client, project, data=b"x" * 500).status_code == 413


def test_worker_unavailable_is_a_clear_503(api, project, monkeypatch):
    client, _, settings = api
    settings.import_worker_python = Path("/nonexistent/python")
    response = upload(client, project)
    assert response.status_code == 503 and "import worker" in response.json()["detail"].lower()


# ------------------------------------------------------------------------------------------------ confirmation is hash-bound
def test_confirmation_requires_the_exact_preview_hash(api, project, synthetic):
    client, sessions, _ = api
    view = upload(client, project).json()
    wrong = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": "0" * 64, "idempotency_key": "confirm-key-0001"})
    assert wrong.status_code == 409 and "preview hash" in wrong.json()["detail"].lower()
    assert counts(sessions)["imported_results"] == 0 and counts(sessions)["structures"] == 0


def test_confirmation_imports_with_clear_authority_separation(api, project, synthetic):
    client, sessions, _ = api
    view = upload(client, project).json()
    response = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"})
    assert response.status_code == 200, response.text
    detail = response.json()
    assert detail["import_record"]["state"] == "IMPORTED" and detail["import_record"]["confirmation"]["preview_sha256"] == view["preview_sha256"]
    assert len(detail["jobs"]) == 1 and {r["result_type"] for r in detail["results"]} == {"chemdft.imported.structure", "chemdft.imported.energy", "chemdft.imported.vibrations", "chemdft.imported.thermochemistry"}
    for result in detail["results"]:
        assert (result["source_class"], result["authority"], result["producer_type"], result["verification_state"]) == ("IMPORTED", "IMPORTED", "VALIDATED_IMPORT_PIPELINE", "UNVERIFIED")
        assert result["payload"]["source_class"] == "IMPORTED" and result["producer_id"] == "chemdft.external-import.pipeline"
        ImportedResultView.model_validate(result)
    c = counts(sessions)
    assert c["calculation_results"] == 0  # imported values are never ChemDFT calculation results
    assert (c["structures"], c["versions"], c["jobs"], c["confirmations"], c["imported_results"]) == (1, 1, 1, 1, 4)
    with sessions() as session:
        version = session.scalars(select(StructureVersionRecord)).one()
        assert version.origin == "IMPORTED_CALCULATION"
        provenance = session.get(ProvenanceRecordRow, version.provenance_record_id)
        assert (provenance.source_class, provenance.detail, provenance.producer_identifier) == ("IMPORTED", "IMPORTED_ENGINE_RESULT", "chemdft.external-import.pipeline")
        for row in session.scalars(select(ImportedResultRecord)):
            assert row.result_type in IMPORTED_RESULT_TYPES and row.payload_sha256 and row.producer_attestation_id.endswith(view["preview_sha256"])
            prov = session.get(ProvenanceRecordRow, row.provenance_record_id)
            assert prov.subject_type == "imported.result" and prov.subject_id == row.id
            assert session.get(ImportedResultRecord, prov.subject_id).project_id == row.project_id
            assert (prov.source_class, prov.detail) == ("IMPORTED", "IMPORTED_ENGINE_RESULT") and prov.source_artifact_id == view["source"]["raw_artifact_id"]
        with pytest.raises(ValueError, match="append-only"):
            row = session.scalars(select(ImportedResultRecord)).first()
            row.authority = "AUTHORITATIVE"
            session.flush()


def test_imported_structure_is_a_normal_structure_version_with_imported_provenance(api, project, synthetic):
    client, _, _ = api
    view = upload(client, project).json()
    detail = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"}).json()
    job = detail["jobs"][0]
    version = client.get(f"/v1/projects/{project}/structures/{job['structure_id']}/versions/{job['structure_version_id']}").json()
    assert version["version"]["origin"] == "IMPORTED_CALCULATION" and len(version["version"]["coordinates"]["atoms"]) == 3
    assert version["provenance"]["source_class"] == "IMPORTED" and version["provenance"]["detail"] == "IMPORTED_ENGINE_RESULT"


def test_confirmation_is_idempotent_and_single_use(api, project, synthetic):
    client, sessions, _ = api
    view = upload(client, project).json()
    body = {"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"}
    first = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json=body).json()
    again = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json=body)
    assert again.status_code == 200 and again.json()["jobs"][0]["id"] == first["jobs"][0]["id"]
    assert [row["id"] for row in again.json()["results"]] == [row["id"] for row in first["results"]]
    other = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json=body | {"idempotency_key": "confirm-key-0002"})
    assert other.status_code == 409
    assert counts(sessions)["imported_results"] == 4 and counts(sessions)["structures"] == 1


def test_failed_import_publication_rolls_back_reserved_subjects(api, project, synthetic, monkeypatch):
    from chemdft_api.errors import ScientificValidationFailed

    client, sessions, _ = api
    view = upload(client, project).json()
    accept = actions.accept_imported_result

    def fail_after_flush(*args, **kwargs):
        record = accept(*args, **kwargs)
        session = args[0]
        assert session.get(ProvenanceRecordRow, record.provenance_record_id).subject_id == record.id
        raise ScientificValidationFailed("Injected failure after imported result flush")

    monkeypatch.setattr(actions, "accept_imported_result", fail_after_flush)
    response = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={
        "preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-rollback-0001",
    })
    assert response.status_code in {400, 422}, response.text
    state = counts(sessions)
    assert all(state[key] == 0 for key in ["structures", "versions", "jobs", "confirmations", "imported_results"])
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(ProvenanceRecordRow)) == 0


def test_source_file_changed_after_preview_is_rejected(api, project, synthetic):
    client, sessions, settings = api
    view = upload(client, project).json()
    with sessions() as session:
        raw = session.get(ScientificArtifactRecord, view["source"]["raw_artifact_id"])
        (settings.object_root / raw.storage_key).write_bytes(SYNTHETIC + b"tampered\n")
    response = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"})
    assert response.status_code == 409 and "sha-256" in response.json()["detail"].lower()
    assert counts(sessions)["imported_results"] == 0 and counts(sessions)["structures"] == 0


def test_preview_changed_after_creation_is_rejected(api, project, synthetic):
    client, sessions, settings = api
    view = upload(client, project).json()
    with sessions() as session:
        preview = session.get(ScientificArtifactRecord, view["preview_artifact_id"])
        path = settings.object_root / preview.storage_key
        document = json.loads(path.read_text())
        document["body"]["results"][1]["payload"]["scf_energy"]["raw_value"] -= 1.0  # silently alter an energy
        path.write_text(json.dumps(document))
    response = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"})
    assert response.status_code == 409
    assert counts(sessions)["imported_results"] == 0


def test_rejected_preview_cannot_be_imported_and_explains_why(api, project, monkeypatch):
    client, sessions, _ = api
    monkeypatch.setattr(actions, "run_import_worker", fake_runner(lambda data: synthetic_report(data, status="REJECTED")))
    view = upload(client, project).json()
    assert view["state"] == "REJECTED" and view["preview"]["items"][0]["state"] == "REJECTED"
    assert view["preview"]["diagnostics"][0]["code"] == "INCOMPLETE_OUTPUT" and view["preview"]["results"] == []
    response = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"})
    assert response.status_code == 409
    assert counts(sessions)["structures"] == 0


def test_worker_report_for_a_different_file_is_refused(api, project, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(actions, "run_import_worker", fake_runner(lambda data: synthetic_report(b"some other file")))
    view = upload(client, project).json()
    assert view["state"] == "REJECTED" and view["preview"]["diagnostics"][0]["code"] == "WORKER_OUTPUT_INVALID"


def test_invalid_worker_report_becomes_a_rejection(api, project, monkeypatch):
    client, _, _ = api
    def broken(data):
        report = synthetic_report(data)
        report["body"]["results"][0]["payload"]["atoms"][0]["x"] = "not-a-number"
        return report
    monkeypatch.setattr(actions, "run_import_worker", fake_runner(broken))
    view = upload(client, project).json()
    assert view["state"] == "REJECTED" and view["preview"]["diagnostics"][0]["code"] == "WORKER_OUTPUT_INVALID"


def test_list_detail_and_result_endpoints(api, project, synthetic):
    client, _, _ = api
    view = upload(client, project).json()
    listing = client.get(f"/v1/projects/{project}/external-imports").json()["imports"]
    assert listing[0]["state"] == "PREVIEW_READY" and listing[0]["job_type"] == "freq" and listing[0]["method"] == "B3LYP"
    detail = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"}).json()
    assert client.get(f"/v1/projects/{project}/external-imports").json()["imports"][0]["state"] == "IMPORTED"
    fetched = client.get(f"/v1/projects/{project}/external-imports/{view['id']}").json()
    assert fetched["jobs"][0]["method"]["status"] == "ESTABLISHED" and len(fetched["results"]) == 4
    one = client.get(f"/v1/projects/{project}/imported-results/{detail['results'][0]['id']}")
    assert one.status_code == 200 and one.json()["source_class"] == "IMPORTED"


# ------------------------------------------------------------------------------------------------ access control and isolation
def test_other_projects_cannot_see_or_confirm_an_import(api, project, synthetic):
    client, _, _ = api
    view = upload(client, project).json()
    other = client.post("/v1/projects", json={"name": "Other", "slug": "other-project"}).json()["id"]
    assert client.get(f"/v1/projects/{other}/external-imports/{view['id']}").status_code == 404
    confirm = client.post(f"/v1/projects/{other}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"})
    assert confirm.status_code == 404
    assert client.get(f"/v1/projects/{other}/external-imports").json()["imports"] == []


def test_viewers_cannot_upload_or_confirm(api, project, synthetic):
    client, sessions, _ = api
    view = upload(client, project).json()
    from chemdft_api.models import ProjectMember

    with sessions() as session:
        for member in session.scalars(select(ProjectMember).where(ProjectMember.project_id == project)):
            member.role = "viewer"
        session.commit()
    assert upload(client, project, key="import-key-0002").status_code == 403
    response = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"})
    assert response.status_code == 403
    assert client.get(f"/v1/projects/{project}/external-imports/{view['id']}").status_code == 200  # reading is allowed


def test_trusted_producer_is_required_for_publication(api, project, synthetic):
    from chemdft_api.errors import TrustedProducerRequired

    client, sessions, _ = api
    view = upload(client, project).json()
    with sessions() as session:
        record = session.get(ExternalImportRecord, view["id"])
        with pytest.raises(TrustedProducerRequired):
            actions.accept_imported_result(session, object(), project_id=project, import_record=record, job=None, entry={}, raw_artifact=None, preview_artifact=None)  # type: ignore[arg-type]


# ------------------------------------------------------------------------------------------------ real worker, real outputs
@requires_corpus
def test_real_gaussian_opt_freq_end_to_end(api, project):
    client, sessions, _ = api
    data = fixture_bytes("g16-ethane-opt-freq")
    view = upload(client, project, data=data, name="ethane.log").json()
    assert view["state"] == "PREVIEW_READY" and view["preview"]["job"]["job_type"] == "opt+freq" and view["preview"]["job"]["internal_steps"] == 2
    assert counts(sessions)["structures"] == 0  # the preview wrote no scientific record
    detail = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"}).json()
    types = {r["result_type"].rsplit(".", 1)[-1] for r in detail["results"]}
    assert {"structure", "energy", "optimization", "vibrations", "orbital-table", "thermochemistry"} == types
    energy = next(r for r in detail["results"] if r["result_type"].endswith("energy"))["payload"]["scf_energy"]
    assert energy["value"] == pytest.approx(-79.8565443694, abs=1e-9)
    assert counts(sessions)["calculation_results"] == 0


@requires_corpus
@pytest.mark.parametrize("fixture_id", ["g16-dvb-td", "orca6-dvb-td"])
def test_real_excitation_import_binds_each_published_result(api, project, fixture_id):
    client, sessions, _ = api
    view = upload(client, project, data=fixture_bytes(fixture_id), name="excited.out").json()
    assert view["state"] == "PREVIEW_READY"
    response = client.post(
        f"/v1/projects/{project}/external-imports/{view['id']}/confirm",
        json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"},
    )
    assert response.status_code == 200, response.text
    detail = response.json()
    assert any(result["result_type"] == "chemdft.imported.excitations" for result in detail["results"])
    with sessions() as session:
        for published in detail["results"]:
            result = session.get(ImportedResultRecord, published["id"])
            provenance = session.get(ProvenanceRecordRow, result.provenance_record_id)
            assert provenance.subject_type == "imported.result"
            assert provenance.subject_id == result.id
            assert result.project_id == provenance.project_id == project
            assert session.get(ImportedResultRecord, provenance.subject_id).id == result.id
    assert counts(sessions)["calculation_results"] == 0


@requires_corpus
def test_real_rejected_outputs_never_reach_the_confirmation_gate(api, project):
    client, sessions, _ = api
    for name, fixture in (("fail.out", "orca6-fe-scf-fail"), ("linked.log", "g16-acetone-linked"), ("trunc.out", "orca6-timed-out")):
        view = upload(client, project, data=fixture_bytes(fixture), name=name, key=f"import-{fixture}").json()
        assert view["state"] == "REJECTED" and view["preview"]["results"] == []
        assert client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"}).status_code == 409
    assert counts(sessions)["structures"] == 0 and counts(sessions)["imported_results"] == 0


@requires_corpus
def test_hostile_uploads_are_rejected_and_their_bytes_are_not_stored(api, project):
    client, sessions, _ = api
    import gzip

    for name, data in (("a.gz", gzip.compress(fixture_bytes("g16-water-hf-freq"))), ("nul.log", b"abc\x00def"), ("url.txt", b"https://127.0.0.1/x\n")):
        view = upload(client, project, data=data, name=name, key=f"import-{name}").json()
        assert view["state"] == "REJECTED" and view["source"]["raw_artifact_id"] is None
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(ScientificArtifactRecord).where(ScientificArtifactRecord.kind == "CALCULATION_OUTPUT")) == 0


@requires_corpus
def test_real_open_shell_import_preserves_spin(api, project):
    client, _, _ = api
    view = upload(client, project, data=fixture_bytes("orca6-o2anion-doublet"), name="o2.out").json()
    assert (view["preview"]["job"]["charge"], view["preview"]["job"]["multiplicity"]) == (-1, 2)
    detail = client.post(f"/v1/projects/{project}/external-imports/{view['id']}/confirm", json={"preview_sha256": view["preview_sha256"], "idempotency_key": "confirm-key-0001"}).json()
    orbitals = next(r for r in detail["results"] if r["result_type"].endswith("orbital-table"))["payload"]
    assert [c["label"] for c in orbitals["spin_channels"]] == ["alpha", "beta"]
    assert detail["jobs"][0]["multiplicity"] == 2 and detail["jobs"][0]["charge"] == -1
