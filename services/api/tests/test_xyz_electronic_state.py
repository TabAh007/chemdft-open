"""XYZ declarations, legacy compatibility and immutable scientific authority."""

import hashlib
import json
from copy import deepcopy
from uuid import uuid4

import pytest
from chemdft_api.contracts.audit import SafeAuditField
from chemdft_api.database import Base
from chemdft_api.scientific.adapters.molecular.rdkit_adapter import parse_xyz
from chemdft_api.scientific_models import (
    AuditEventRecord,
    CalculationInputRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureVersionRecord,
)
from sqlalchemy import func, select, update
from test_geometry_workflow import accept, drawing, generate
from test_structure_workspace import _create_project
from test_xtb_optimization import native_input


def xyz(name, declaration=None):
    if name == "hexane":
        from chemdft_api.scientific.molecular_geometry import generate_conformer
        from rdkit import Chem

        generated = generate_conformer(Chem.MolFromSmiles("CCCCCC"), "n-Hexane")
        atoms = [
            {"element": a.element, "xyz_angstrom": [a.x, a.y, a.z]}
            for a in generated.coordinates.coordinates.atoms
        ]
    else:
        atoms = native_input(name)["atoms"]
    comment = name + (" | chemdft:" + declaration if declaration is not None else "")
    return (
        str(len(atoms))
        + "\n"
        + comment
        + "\n"
        + "\n".join(a["element"] + " " + " ".join(map(str, a["xyz_angstrom"])) for a in atoms)
        + "\n"
    ).encode()


def imported(api, name, declaration=None, **form):
    client, _, _ = api
    project = _create_project(client, "XYZ state regression")["id"]
    response = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={"upload": ("input.xyz", xyz(name, declaration), "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": str(uuid4()), **form},
    )
    assert response.status_code == 201, response.text
    return project, response.json()["version"]


def command(project, version, charge, multiplicity, engine="xtb"):
    return {
        "structure_version": {
            "project_id": project,
            "entity_type": "structure.version",
            "entity_id": version["id"],
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {
                "identifier": "gfn2" if engine == "xtb" else "hf",
                "display_name": "Regression",
                "registry": "chemdft.method",
            },
            "basis": None
            if engine == "xtb"
            else {
                "identifier": "sto-3g",
                "display_name": "STO-3G",
                "registry": "chemdft.basis",
            },
            "charge": charge,
            "multiplicity": multiplicity,
            "engine_preference": {"engine": engine},
        },
        "idempotency_key": str(uuid4()),
    }


def counts(session):
    return {
        t.name: session.scalar(select(func.count()).select_from(t))
        for t in Base.metadata.sorted_tables
    }


@pytest.mark.parametrize(
    ("name", "charge", "multiplicity"),
    [
        ("hexane", 0, 1),
        ("ammonium", 1, 1),
        ("oh", 0, 2),
    ],
)
def test_explicit_xyz_preserves_user_declared_state_and_provenance(api, name, charge, multiplicity):
    client, sessions, settings = api
    project, version = imported(
        api,
        name,
        f"charge={charge};multiplicity={multiplicity}",
        structure_name="Declared molecule",
    )
    assert (version["overall_charge"], version["multiplicity"]) == (charge, multiplicity)
    with sessions() as session:
        record = session.get(StructureVersionRecord, version["id"])
        provenance = session.get(ProvenanceRecordRow, record.provenance_record_id)
        parameters = {p["key"]: p["value"] for p in provenance.parameters_json}
        assert parameters["electronic_state_authority"] == "USER_DECLARED_XYZ"
        assert (parameters["declared_charge"], parameters["declared_multiplicity"]) == (
            charge,
            multiplicity,
        )
        assert provenance.producer_kind == "USER" and provenance.verification_state == "UNVERIFIED"
        canonical = session.get(ScientificArtifactRecord, record.canonical_artifact_id)
        source = session.get(ScientificArtifactRecord, record.source_artifact_id)
        document = json.loads((settings.object_root / canonical.storage_key).read_bytes())
        assert (document["overall_charge"], document["multiplicity"]) == (charge, multiplicity)
        assert source.id == provenance.source_artifact_id == canonical.source_relation_id
        assert document["name"] == "Declared molecule"
    submitted = client.post(
        f"/v1/projects/{project}/calculations",
        json=command(project, version, charge, multiplicity),
    )
    assert submitted.status_code == 201, submitted.text


@pytest.mark.parametrize(
    ("name", "declared", "requested", "code"),
    [
        ("hexane", "charge=0;multiplicity=1", (2, 1), "CALCULATION_CHARGE_MISMATCH"),
        ("ammonium", "charge=+1;multiplicity=1", (0, 2), "CALCULATION_CHARGE_MISMATCH"),
        ("oh", "charge=0;multiplicity=2", (0, 4), "CALCULATION_MULTIPLICITY_MISMATCH"),
    ],
)
def test_annotated_xyz_cannot_override_authority_before_queue(
    api, monkeypatch, name, declared, requested, code
):
    client, sessions, _ = api
    project, version = imported(api, name, declared)
    monkeypatch.setattr(
        "chemdft_api.calculation_actions.validate_capability",
        lambda *a: pytest.fail("Mismatch reached capability/queue gate"),
    )
    with sessions() as session:
        before = counts(session)
    response = client.post(
        f"/v1/projects/{project}/calculations", json=command(project, version, *requested)
    )
    assert response.status_code == 422 and response.json()["detail"]["code"] == code
    with sessions() as session:
        assert counts(session) == before


def test_submit_rejects_impossible_parity_before_queue(api, monkeypatch):
    """F8: water with charge +1 and multiplicity 1 has 9 electrons; a hand-built request must be refused."""
    client, sessions, _ = api
    project, version = imported(api, "water")
    monkeypatch.setattr(
        "chemdft_api.calculation_actions.validate_capability",
        lambda *a: pytest.fail("Impossible electronic state reached capability/queue gate"),
    )
    with sessions() as session:
        before = counts(session)
    response = client.post(
        f"/v1/projects/{project}/calculations", json=command(project, version, 1, 1)
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "ELECTRONIC_STATE_PARITY_INVALID"
    with sessions() as session:
        assert counts(session) == before


def test_shared_electronic_state_cases_match_the_server_rule():
    """The web client mirrors this rule; both sides read the same cases so they cannot drift."""
    from pathlib import Path

    from chemdft_api.errors import StructureElectronicStateMismatch
    from chemdft_api.scientific.engines.normalization import validate_electronic_state_composition

    path = Path(__file__).resolve().parents[3] / "apps/web/tests/fixtures/electronic-state-cases.json"
    cases = json.loads(path.read_text())["cases"]
    assert cases
    for case in cases:
        atoms = [{"atomic_number": z} for z in case["z"]]
        if case["ok"]:
            validate_electronic_state_composition(atoms, case["charge"], case["multiplicity"])
        else:
            with pytest.raises(StructureElectronicStateMismatch):
                validate_electronic_state_composition(atoms, case["charge"], case["multiplicity"])


@pytest.mark.parametrize(
    ("name", "charge", "multiplicity"),
    [
        ("hexane", 0, 1),
        ("ammonium", 1, 1),
        ("oh", 0, 2),
    ],
)
def test_legacy_xyz_uses_explicit_calculation_declaration_without_rewriting(
    api,
    monkeypatch,
    name,
    charge,
    multiplicity,
):
    from chemdft_api import scientific_actions

    client, sessions, settings = api
    original = scientific_actions._provenance_for_structure_version

    def historical_import(*args, **kwargs):
        # Construct an old-format record at insertion, without changing append-only records.
        kwargs["parameters"] = [
            p
            for p in kwargs["parameters"]
            if p["key"]
            in {
                "format",
                "parser",
                "parser_version",
                "adapter",
                "adapter_version",
            }
        ]
        return original(*args, **kwargs)

    with monkeypatch.context() as legacy:
        legacy.setattr(scientific_actions, "_provenance_for_structure_version", historical_import)
        project, version = imported(api, name)
    assert (version["overall_charge"], version["multiplicity"]) == (0, 1)
    with sessions() as session:
        record = session.get(StructureVersionRecord, version["id"])
        provenance = session.get(ProvenanceRecordRow, record.provenance_record_id)
        original_provenance = deepcopy(provenance.parameters_json)
        original_representation = deepcopy(record.representation_json)
        artifact = session.get(ScientificArtifactRecord, record.canonical_artifact_id)
        original_bytes = (settings.object_root / artifact.storage_key).read_bytes()
    request = command(project, version, charge, multiplicity)
    submitted = client.post(f"/v1/projects/{project}/calculations", json=request)
    assert submitted.status_code == 201, submitted.text
    calculation_id = submitted.json()["calculation"]["id"]
    with sessions() as session:
        record = session.get(StructureVersionRecord, version["id"])
        assert (record.overall_charge, record.multiplicity) == (0, 1)
        assert record.representation_json == original_representation
        assert session.get(ProvenanceRecordRow, record.provenance_record_id).parameters_json == (
            original_provenance
        )
        assert (settings.object_root / artifact.storage_key).read_bytes() == original_bytes
        state = session.scalar(
            select(CalculationInputRecord).where(
                CalculationInputRecord.calculation_id == calculation_id,
            )
        )
        assert (state.specification_json["charge"], state.specification_json["multiplicity"]) == (
            charge,
            multiplicity,
        )
        audit = session.scalar(
            select(AuditEventRecord).where(
                AuditEventRecord.project_id == project,
                AuditEventRecord.event_name == "calculation.created",
            )
        )
        fields = {p["key"]: p["value"] for p in audit.safe_metadata_json}
        for field in audit.safe_metadata_json:
            SafeAuditField.model_validate(field)
        assert fields["electronic_state.authority"] == "CALCULATION_USER_DECLARED"
        assert fields["electronic_state.declared_by"] == settings.dev_user_id
        assert fields["electronic_state.charge"] == str(charge)
        assert fields["electronic_state.multiplicity"] == str(multiplicity)
        normalized = session.get(ScientificArtifactRecord, state.normalized_input_artifact_id)
        assert fields["electronic_state.normalized_input_sha256"] == normalized.sha256
        assert hashlib.sha256(
            (settings.object_root / normalized.storage_key).read_bytes()
        ).hexdigest() == (normalized.sha256)
    replay = client.post(f"/v1/projects/{project}/calculations", json=request)
    assert replay.json()["calculation"]["id"] == calculation_id


@pytest.mark.parametrize(
    "declaration",
    [
        "charge=0.5;multiplicity=1",
        "charge=true;multiplicity=1",
        "charge=1;multiplicity=0",
        "charge=1;multiplicity=-1",
        "charge=1",
        "multiplicity=1",
        "charge=1;multiplicity=1;extra=1",
        "charge=9999999999999999999999;multiplicity=1",
    ],
)
def test_malformed_xyz_declarations_return_structured_422(api, declaration):
    client, _, _ = api
    project = _create_project(client, "Invalid declaration")["id"]
    response = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={"upload": ("input.xyz", xyz("ammonium", declaration), "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "XYZ_ELECTRONIC_STATE_INVALID"


@pytest.mark.parametrize(
    ("name", "declaration"),
    [
        ("ammonium", "charge=0;multiplicity=1"),
        ("oh", "charge=0;multiplicity=1"),
        ("oh", "charge=10;multiplicity=2"),
        ("oh", "charge=0;multiplicity=12"),
    ],
)
def test_xyz_declaration_electron_composition_rejected(api, name, declaration):
    client, _, _ = api
    project = _create_project(client, "Invalid parity")["id"]
    response = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={"upload": ("input.xyz", xyz(name, declaration), "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "ELECTRONIC_STATE_PARITY_INVALID"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("charge", True),
        ("charge", 1.0),
        ("charge", "1"),
        ("multiplicity", True),
        ("multiplicity", 1.5),
        ("multiplicity", "1"),
        ("multiplicity", 0),
        ("charge", None),
        ("multiplicity", None),
    ],
)
def test_calculation_declarations_are_explicit_strict_integers(api, field, value):
    client, sessions, _ = api
    project, version = imported(api, "ammonium")
    request = command(project, version, 1, 1)
    if value is None:
        del request["specification"][field]
    else:
        request["specification"][field] = value
    with sessions() as session:
        before = counts(session)
    response = client.post(f"/v1/projects/{project}/calculations", json=request)
    assert response.status_code == 422, response.text
    assert isinstance(response.json()["detail"], list)
    with sessions() as session:
        assert counts(session) == before


@pytest.mark.parametrize(
    "damage", ["subject", "source_reference_project", "source_bytes", "authority", "state"]
)
def test_xyz_compatibility_rejects_corrupt_provenance(api, damage):
    client, sessions, settings = api
    project, version = imported(api, "ammonium")
    with sessions() as session:
        record = session.get(StructureVersionRecord, version["id"])
        provenance = session.get(ProvenanceRecordRow, record.provenance_record_id)
        source = session.get(ScientificArtifactRecord, record.source_artifact_id)
        # Adversarial corruption is confined to disposable test databases. Normal ORM writes
        # remain append-only; direct SQL deliberately simulates a damaged persistent store.
        if damage == "subject":
            session.execute(
                update(ProvenanceRecordRow)
                .where(ProvenanceRecordRow.id == provenance.id)
                .values(subject_id=str(uuid4()))
            )
        elif damage == "source_reference_project":
            other = _create_project(client, "Other XYZ project")["id"]
            representation = deepcopy(record.representation_json)
            representation["source_artifact"]["project_id"] = other
            session.execute(
                update(StructureVersionRecord)
                .where(StructureVersionRecord.id == record.id)
                .values(representation_json=representation)
            )
        elif damage == "source_bytes":
            (settings.object_root / source.storage_key).write_bytes(b"tampered")
        elif damage == "authority":
            parameters = [
                {**p, "value": "USER_DECLARED_XYZ"}
                if p["key"] == "electronic_state_authority"
                else p
                for p in provenance.parameters_json
            ]
            session.execute(
                update(ProvenanceRecordRow)
                .where(ProvenanceRecordRow.id == provenance.id)
                .values(parameters_json=parameters)
            )
        else:
            session.execute(
                update(StructureVersionRecord)
                .where(StructureVersionRecord.id == record.id)
                .values(overall_charge=1)
            )
        session.commit()
        before = counts(session)
    response = client.post(
        f"/v1/projects/{project}/calculations", json=command(project, version, 1, 1)
    )
    assert response.status_code == 422, response.text
    with sessions() as session:
        assert counts(session) == before


def test_cross_project_xyz_reference_remains_rejected(api):
    client, _, _ = api
    project, version = imported(api, "ammonium")
    other = _create_project(client, "Other submission project")["id"]
    response = client.post(
        f"/v1/projects/{other}/calculations", json=command(project, version, 1, 1)
    )
    assert response.status_code == 403, response.text


def test_generated_authority_cannot_use_xyz_compatibility(api):
    client, _, _ = api
    project = _create_project(client, "Generated authoritative state")["id"]
    candidate = generate(client, project, mol_block=drawing("CCCCCC")).json()
    version = accept(client, project, candidate).json()["version"]
    response = client.post(
        f"/v1/projects/{project}/calculations", json=command(project, version, 2, 1)
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "CALCULATION_CHARGE_MISMATCH"


def test_legacy_xyz_still_obeys_psi4_engine_scope(api):
    client, _, _ = api
    project, version = imported(api, "ammonium")
    response = client.post(
        f"/v1/projects/{project}/calculations", json=command(project, version, 1, 1, engine="psi4")
    )
    assert response.status_code == 422
    assert "neutral singlet" in response.text


def test_neutral_xyz_psi4_still_queues(api, monkeypatch):
    client, _, _ = api
    project, version = imported(api, "water")
    monkeypatch.setattr("chemdft_api.calculation_actions.validate_capability", lambda *a: None)
    response = client.post(
        f"/v1/projects/{project}/calculations", json=command(project, version, 0, 1, engine="psi4")
    )
    assert response.status_code == 201, response.text
    assert response.json()["result"] is None


def test_unannotated_xyz_placeholder_is_not_a_declaration():
    candidate = parse_xyz(xyz("oh"))
    assert not candidate.electronic_state_declared
    assert (candidate.overall_charge, candidate.multiplicity) == (0, 1)


@pytest.mark.scientific_integration
def test_native_annotated_ammonium_xyz_publication(api, tmp_path):
    from result_provenance_checks import assert_published_result_binding
    from test_xtb_optimization import run_job, submit

    client, sessions, settings = api
    project, version = imported(api, "ammonium", "charge=+1;multiplicity=1")
    _, _, queued, request = submit(api, "ammonium", version=version, project=project)
    detail = run_job(api)
    assert detail.calculation.state == "SUCCEEDED", detail
    assert detail.result.trusted_producer_id == "local.xtb.worker"
    assert_published_result_binding(sessions, detail.result.id, version["id"])
    with sessions() as session:
        record = session.get(StructureVersionRecord, version["id"])
        assert (record.overall_charge, record.multiplicity) == (1, 1)
        state = session.scalar(
            select(CalculationInputRecord).where(
                CalculationInputRecord.calculation_id == str(detail.calculation.id),
            )
        )
        assert (state.specification_json["charge"], state.specification_json["multiplicity"]) == (
            1,
            1,
        )
        normalized = session.get(ScientificArtifactRecord, state.normalized_input_artifact_id)
        document = json.loads((settings.object_root / normalized.storage_key).read_bytes())
        assert (document["charge"], document["multiplicity"]) == (1, 1)
        raw = {}
        for ref in detail.result.raw_artifacts:
            artifact = session.get(ScientificArtifactRecord, str(ref.artifact_id))
            if artifact.format_identifier.startswith("xtb.native."):
                raw[artifact.format_identifier.removeprefix("xtb.native.")] = (
                    settings.object_root / artifact.storage_key
                ).read_bytes()
        invocation = json.loads(raw["invocation.json"])
        argv = invocation["argv"]
        assert argv[argv.index("--chrg") + 1] == "1"
        assert argv[argv.index("--uhf") + 1] == "0"
        assert json.loads(raw["execution.json"])["exit_code"] == 0
        from chemdft_api.scientific.engines.xtb_optimization import parse_evidence

        parsed = parse_evidence(raw, document, 0)
        assert parsed["converged"]
        assert parsed["steps"][-1]["energy_hartree"] == detail.result.payload.final_energy.value
        persisted = client.get(
            f"/v1/projects/{project}/calculations/{detail.calculation.id}"
        ).json()
        assert persisted["result"]["id"] == str(detail.result.id)
        result_provenance = session.get(
            ProvenanceRecordRow, str(detail.result.provenance_record_id)
        )
        evidence = {
            "project_id": project,
            "structure_version_id": version["id"],
            "calculation_id": str(detail.calculation.id),
            "result_id": str(detail.result.id),
            "provenance_id": result_provenance.id,
            "charge": document["charge"],
            "multiplicity": document["multiplicity"],
            "energy_hartree": detail.result.payload.final_energy.value,
            "input_sha256": normalized.sha256,
            "native_executable_sha256": invocation["executable_sha256"],
            "native_argv": argv,
            "native_exit_code": 0,
            "converged": True,
            "authority": "USER_DECLARED_XYZ",
            "trusted_producer": "local.xtb.worker",
            "database": settings.database_url,
        }
        (tmp_path / "native-verification.json").write_text(json.dumps(evidence, indent=2) + "\n")
        print(json.dumps(evidence))
    replay = client.post(f"/v1/projects/{project}/calculations", json=request)
    assert replay.json()["calculation"]["id"] == queued["calculation"]["id"]
