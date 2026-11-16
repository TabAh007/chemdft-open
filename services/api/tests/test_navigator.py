# ruff: noqa: RUF001  (Greek alpha is the scientific phase name)
"""PF-4 pure rules, real record projections, tenant isolation and route vocabulary."""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from chemdft_api.contracts.navigator import ActionId
from chemdft_api.navigator.catalog import CATALOG, GOALS
from chemdft_api.navigator.evaluate import evaluate
from chemdft_api.navigator.facts import (
    Capabilities,
    JobFacts,
    OptimizationFacts,
    ProjectFacts,
    ResultFacts,
    SpectrumFacts,
    StructureFacts,
)
from sqlalchemy import event

CAPS = Capabilities(
    frozenset(
        {"ENERGY", "ORBITAL", "GEOMETRY_OPTIMIZATION", "FREQUENCY", "TDDFT", "THERMOCHEMISTRY"}
    ),
    True,
)
MOLECULE = StructureFacts(
    "version",
    "structure",
    "Water",
    "MOLECULE",
    3,
    3,
    0,
    1,
    False,
    "IMPORTED",
    "a" * 64,
    True,
    "H2 O",
)


EMPTY = ProjectFacts("project")


def state(facts=EMPTY, *, write=True, goal=None, caps=CAPS):
    return evaluate(facts, caps, can_write=write, goal=goal)


def next_ids(s):
    return {a.action_id for a in s.next}


def have_ids(s):
    return {h.state_id for h in s.have}


def blockers(s, action):
    return {r.code for a in s.blocked if a.action_id == action for r in a.reasons}


def result(**changes):
    return replace(
        ResultFacts(
            "result",
            "calc",
            "version",
            "chemdft.energy",
            "ENERGY",
            "hf",
            "sto-3g",
            "pyscf",
            True,
            energy=True,
            provenance=True,
        ),
        **changes,
    )


def optimized():
    return ProjectFacts(
        "project",
        replace(MOLECULE, origin="OPTIMIZED"),
        (
            result(
                schema="chemdft.optimization",
                task="GEOMETRY_OPTIMIZATION",
                final_version_id="version",
                final_hash="a" * 64,
            ),
        ),
        optimizations=(OptimizationFacts("calc", "version", True, 0.0001),),
    )


def frequency(**changes):
    values = dict(
        id="frequency",
        calculation_id="freqcalc",
        schema="chemdft.vibrational-analysis",
        task="FREQUENCY",
        energy=False,
        hessian=True,
        ir=True,
        modes_valid=True,
        input_hash="a" * 64,
        charge=0,
        multiplicity=1,
    )
    values.update(changes)
    return result(**values)


def test_empty_and_goal_catalogue():
    s = state()
    assert s.version == 1 and not s.have
    assert "structure.import" in next_ids(s)
    assert "structure_missing" in blockers(s, "calculation.optimize")
    assert tuple(g.goal_id for g in s.goals) == GOALS
    assert s.context.next_ids == tuple(a.action_id for a in s.next)


def test_molecule_and_conservative_followons():
    s = state(ProjectFacts("project", MOLECULE))
    assert {"structure.molecule", "provenance.available"} <= have_ids(s)
    assert "calculation.optimize" in next_ids(s)
    assert "optimization_required" in blockers(s, "spectra.predict_ir")
    assert "crystal_required" in blockers(s, "structure.build_supercell")
    goal_state = state(ProjectFacts("project", MOLECULE), goal="thermochemistry")
    assert goal_state.next[0].action_id == "calculation.optimize"


@pytest.mark.parametrize(
    "changes,reason",
    [
        ({"charge": None}, "charge_required"),
        ({"multiplicity": None}, "multiplicity_required"),
        ({"dimensionality": 2}, "coordinates_3d_required"),
    ],
)
def test_missing_structure_configuration(changes, reason):
    assert reason in blockers(
        state(ProjectFacts("project", replace(MOLECULE, **changes))), "calculation.optimize"
    )


def test_origin_alone_is_not_convergence():
    assert "geometry.optimized" not in have_ids(
        state(ProjectFacts("project", replace(MOLECULE, origin="OPTIMIZED")))
    )


def test_valid_optimization_and_frequency():
    facts = optimized()
    facts = replace(facts, results=(*facts.results, frequency()))
    s = state(facts, goal="thermochemistry")
    assert s.facts_summary.valid_frequency
    assert "thermochemistry.calculate" in next_ids(s)
    assert "spectra.predict_ir" not in next_ids(s)
    assert "geometry.optimized" in have_ids(s)


@pytest.mark.parametrize(
    "changes,reason",
    [
        ({"imaginary": True}, "imaginary_frequencies"),
        ({"modes_valid": False}, "imaginary_frequencies"),
        ({"input_hash": "b" * 64}, "frequency_geometry_mismatch"),
        ({"method": "b3lyp"}, "matching_level_required"),
        ({"multiplicity": 3}, "closed_shell_required"),
    ],
)
def test_frequency_thermochemistry_blockers(changes, reason):
    f = optimized()
    f = replace(f, results=(*f.results, frequency(**changes)))
    assert reason in blockers(state(f, goal="thermochemistry"), "thermochemistry.calculate")
    assert not state(f).facts_summary.valid_frequency


@pytest.mark.parametrize("gradient", [None, float("nan"), 0.01])
def test_stationarity_not_assumed(gradient):
    f = optimized()
    f = replace(
        f,
        results=(*f.results, frequency()),
        optimizations=(replace(f.optimizations[0], gradient_rms=gradient),),
    )
    assert "stationarity_unproven" in blockers(state(f), "thermochemistry.calculate")


def test_energy_is_not_orbitals_or_optimized():
    s = state(ProjectFacts("project", MOLECULE, (result(),)))
    assert "energy.calculated" in have_ids(s)
    assert not {"orbitals.available", "geometry.optimized"} & have_ids(s)
    assert "calculation.single_point" not in next_ids(s)


def test_real_stored_water_acceptance():
    root = Path(__file__).resolve().parents[3]
    stored = json.loads(
        (root / "apps/web/src/app/_components/home/reference/water-run-record.json").read_text()
    )
    assert stored["result"]["converged"] and stored["task"] == "ORBITAL"
    f = ProjectFacts(
        "project",
        MOLECULE,
        (
            result(
                schema="chemdft.molecular-orbitals",
                task=stored["task"],
                method="hf",
                basis=stored["method"]["basis"],
                engine=stored["engine"]["name"],
                orbitals=stored["result"]["molecular_orbitals"] > 0,
                frontier=bool(stored["result"]["homo"] and stored["result"]["lumo"]),
                coefficients=bool(stored["provenance"]["coefficient_artifact_sha256"]),
            ),
        ),
    )
    s = state(f)
    assert {
        "energy.calculated",
        "orbitals.available",
        "frontier.available",
        "provenance.available",
    } <= have_ids(s)
    assert "geometry.optimized" not in have_ids(s)
    assert "electronic.inspect_orbitals" in next_ids(s)
    assert "calculation.orbitals" not in next_ids(state(f, goal="orbitals"))
    assert "frequency_required" in blockers(s, "thermochemistry.calculate")


def test_periodic_cr2o3_is_visualization_only():
    crystal = replace(
        MOLECULE,
        kind="PERIODIC",
        name="α-Cr₂O₃ · COD source",
        atom_count=30,
        lattice=True,
        composition="Cr12 O18",
    )
    s = state(ProjectFacts("project", crystal))
    assert {
        "structure.crystal",
        "structure.unit_cell",
        "structure.composition",
        "provenance.available",
    } <= have_ids(s)
    assert {
        "structure.inspect",
        "structure.inspect_unit_cell",
        "structure.build_supercell",
    } <= next_ids(s)
    assert "periodic_compute_unsupported" in blockers(s, "calculation.optimize")
    assert "notice.source_identity_unestablished" in s.notices
    assert not any("coordination" in a.action_id for a in (*s.next, *s.blocked))


@pytest.mark.parametrize("status", ["QUEUED", "RUNNING"])
def test_duplicate_running_jobs(status):
    f = ProjectFacts(
        "project", MOLECULE, jobs=(JobFacts("job", "version", "GEOMETRY_OPTIMIZATION", status),)
    )
    assert "job_in_progress" in blockers(state(f), "calculation.optimize")
    assert "job.in_progress" in have_ids(state(f))
    assert "jobs.review" in next_ids(state(f))


def test_a_queued_energy_job_blocks_a_second_energy_plan_for_the_same_version():
    """The approved K2.6 calculation was queued; a new energy plan for that version is refused."""
    f = ProjectFacts(
        "project", MOLECULE, jobs=(JobFacts("job", "version", "ENERGY", "QUEUED"),)
    )
    assert "job_in_progress" in blockers(state(f), "calculation.single_point")


def test_without_a_calculation_record_energy_planning_is_not_blocked():
    """Job facts come only from calculation records, which exist only after an approval is
    consumed. A pending or a rejected proposal leaves no record, so it can never block planning."""
    s = state(ProjectFacts("project", MOLECULE))
    assert "job.in_progress" not in have_ids(s)
    assert "job_in_progress" not in blockers(s, "calculation.single_point")
    assert "calculation.single_point" in next_ids(s)


def test_failed_job_has_recovery_and_not_results():
    s = state(
        ProjectFacts("project", MOLECULE, jobs=(JobFacts("job", "version", "ENERGY", "FAILED"),))
    )
    assert "jobs.review" in next_ids(s) and "job.failed" in have_ids(s)
    assert "energy.calculated" not in have_ids(s)


def test_experimental_matching_and_association():
    f = optimized()
    f = replace(
        f,
        results=(*f.results, frequency()),
        spectra=(SpectrumFacts("dataset", "RAMAN", "structure", False),),
    )
    assert "matching_spectrum_type_required" in blockers(
        state(f, goal="compare"), "spectra.compare"
    )
    f = replace(f, spectra=(SpectrumFacts("dataset", "IR", None, False),))
    assert "spectrum_association_required" in blockers(state(f), "spectra.compare")
    f = replace(f, spectra=(SpectrumFacts("dataset", "IR", "structure", True, True),))
    assert "spectra.compare" in next_ids(state(f))
    f = replace(f, comparisons=(("dataset", "frequency", "IR"),))
    assert "comparison.available" in have_ids(state(f))
    assert "spectra.compare" not in next_ids(state(f))


def test_viewer_sees_possibilities_but_no_mutation_targets():
    s = state(ProjectFacts("project", MOLECULE), write=False)
    assert "structure.inspect" in next_ids(s)
    assert "editor_required" in blockers(s, "calculation.optimize")
    assert all(a.required_capability == "read" for a in s.next)
    assert all(a.target is None for a in s.blocked)


def test_catalogue_closed_unique_and_every_goal_composes():
    from typing import get_args

    assert {d.id for d in CATALOG} == set(get_args(ActionId))
    for goal in GOALS:
        s = state(ProjectFacts("project", MOLECULE), goal=goal)
        ids = [a.action_id for a in (*s.next, *s.blocked)]
        assert len(ids) == len(set(ids))
        assert all(goal in a.goal_ids for a in (*s.next, *s.blocked))
    assert (
        state(ProjectFacts("project", MOLECULE)).model_dump()
        == state(ProjectFacts("project", MOLECULE)).model_dump()
    )


def test_no_worker_and_truncated_history():
    f = ProjectFacts("project", MOLECULE, history_complete=False)
    assert "worker_unavailable" in blockers(state(f, caps=Capabilities()), "calculation.optimize")
    assert "history_limit_reached" in blockers(state(f), "calculation.optimize")


def create(client, slug="navigator"):
    response = client.post("/v1/projects", json={"name": "Navigator test", "slug": slug})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def import_water(client, project_id):
    response = client.post(
        f"/v1/projects/{project_id}/structures/imports",
        files={
            "upload": (
                "water.xyz",
                b"3\nWater\nO 0 0 0\nH 0 0 .9572\nH .9266 0 -.24\n",
                "chemical/x-xyz",
            )
        },
        data={"file_format": "XYZ", "idempotency_key": str(uuid4()), "structure_name": "Water"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_extraction_empty_real_import_query_budget_and_no_ai(api, monkeypatch):
    client, sessions, _settings = api
    from chemdft_api.ai.service import AIScientistService
    from chemdft_api.navigator import service

    monkeypatch.setattr(service, "observe", lambda _settings: CAPS)
    monkeypatch.setattr(
        AIScientistService, "__init__", lambda *a, **k: pytest.fail("Navigator invoked AI")
    )
    project = create(client)
    assert client.get(f"/v1/projects/{project}/navigator").json()["have"] == []
    imported = import_water(client, project)
    statements = []

    def listener(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(sessions.kw["bind"], "before_cursor_execute", listener)
    try:
        response = client.get(f"/v1/projects/{project}/navigator")
    finally:
        event.remove(sessions.kw["bind"], "before_cursor_execute", listener)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["facts_summary"]["structure_version_id"] == imported["version"]["id"]
    assert payload["facts_summary"]["atom_count"] == 3
    assert len(statements) <= 11, statements  # identity lookup + membership + eight fact queries
    assert not any(
        "values_json" in statement or "text_json" in statement for statement in statements
    )
    # Provider configuration is irrelevant: neither AI service nor gateway was constructed.


def test_real_cr2o3_import(api, monkeypatch):
    client, _sessions, _settings = api
    from chemdft_api.navigator import service

    monkeypatch.setattr(service, "observe", lambda _s: CAPS)
    project = create(client)
    root = Path(__file__).resolve().parents[3]
    paths = list((root / "apps/web/src/app/_components/home/reference").glob("*.cif"))
    assert paths
    response = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={"upload": (paths[0].name, paths[0].read_bytes(), "chemical/x-cif")},
        data={
            "file_format": "CIF",
            "idempotency_key": str(uuid4()),
            "structure_name": "α-Cr₂O₃ · COD source",
        },
    )
    assert response.status_code == 201, response.text
    payload = client.get(f"/v1/projects/{project}/navigator").json()
    assert payload["facts_summary"]["structure_type"] == "crystal"
    assert "structure.unit_cell" in {h["state_id"] for h in payload["have"]}


def test_project_org_resource_substitution_and_unauthenticated(multiuser, monkeypatch):
    from chemdft_api.navigator import service

    monkeypatch.setattr(service, "observe", lambda _s: CAPS)
    alice, bob = multiuser.actor("alice"), multiuser.actor("bob")
    a, b = alice.create_project("alice"), bob.create_project("bob")
    assert alice.get(f"/v1/projects/{a['id']}/navigator").status_code == 200
    assert alice.get(f"/v1/projects/{b['id']}/navigator").status_code == 404
    assert (
        alice.get(
            f"/v1/projects/{b['id']}/navigator", headers={"X-Organization-ID": bob.organization_id}
        ).status_code
        == 404
    )
    imported = import_water(bob, b["id"])
    assert (
        alice.get(
            f"/v1/projects/{a['id']}/navigator?structure_version_id={imported['version']['id']}"
        ).status_code
        == 404
    )
    assert multiuser.client.get(f"/v1/projects/{a['id']}/navigator").status_code == 401
    assert alice.get(f"/v1/projects/{a['id']}/navigator?goal=unknown").status_code == 422


@pytest.mark.parametrize("role,write", [("viewer", False), ("editor", True), ("owner", True)])
def test_api_central_role_mapping(multiuser, monkeypatch, role, write):
    from chemdft_api import project_access
    from chemdft_api.models import ProjectMember
    from chemdft_api.navigator import service
    from sqlalchemy import select

    monkeypatch.setattr(service, "observe", lambda _s: CAPS)
    monkeypatch.setattr(project_access, "AUDIT_LOG", [])
    actor = multiuser.actor("alice")
    project = actor.create_project("roles")
    with multiuser.sessions() as session:
        member = session.scalar(
            select(ProjectMember).where(ProjectMember.project_id == project["id"])
        )
        member.role = role
        session.commit()
    payload = actor.get(f"/v1/projects/{project['id']}/navigator").json()
    assert payload["facts_summary"]["can_write"] is write
    assert (project_access.ProjectCapability.READ, role, True) in project_access.AUDIT_LOG
    assert (project_access.ProjectCapability.WRITE, role, write) in project_access.AUDIT_LOG


def test_service_grants_do_not_allow_project_aggregation(api):
    from chemdft_api.auth import require_identity
    from chemdft_api.context import ServiceIdentity
    from chemdft_api.main import app

    client, _sessions, _settings = api
    project = create(client)
    for service in ("compute-worker", "knowledge-worker", "investigation-worker", "billing"):
        app.dependency_overrides[require_identity] = lambda service=service: ServiceIdentity(
            user_id=str(uuid4()),
            organization_id=str(uuid4()),
            service=service,
            work_id=str(uuid4()),
            work_project_id=project,
        )
        assert client.get(f"/v1/projects/{project}/navigator").status_code == 403
    app.dependency_overrides.pop(require_identity)


def seed_projection_result(
    sessions,
    project_id,
    version_id,
    *,
    payload,
    task="ENERGY",
    state="SUCCEEDED",
    authority="AUTHORITATIVE",
    validation="VALIDATED",
):
    """Metadata-only DB fixture, not a scientific producer or an executable calculation."""
    from chemdft_api.scientific_models import (
        CalculationInputRecord,
        CalculationRecord,
        CalculationResultRecord,
        StructureVersionRecord,
    )

    with sessions() as session:
        version = session.get(StructureVersionRecord, version_id)
        calculation = CalculationRecord(
            project_id=project_id, state=state, created_by=version.created_by
        )
        session.add(calculation)
        session.flush()
        inp = CalculationInputRecord(
            project_id=project_id,
            calculation_id=calculation.id,
            structure_version_id=version_id,
            normalized_input_artifact_id=version.canonical_artifact_id,
            specification_json={
                "task_type": task,
                "method": {"identifier": "hf"},
                "basis": {"identifier": "sto-3g"},
                "engine_preference": {"engine": "pyscf"},
            },
        )
        session.add(inp)
        session.flush()
        record = CalculationResultRecord(
            project_id=project_id,
            calculation_id=calculation.id,
            calculation_input_id=inp.id,
            result_type=payload["payload_schema"],
            authority=authority,
            source_class="CALCULATED",
            verification_state="UNVERIFIED",
            validation_state=validation,
            trusted_producer_id="local.pyscf.worker",
            trusted_producer_type="SCIENTIFIC_ENGINE",
            producer_attestation_id="metadata-test",
            producer_software_json={},
            payload_json=payload,
            provenance_record_id=version.provenance_record_id,
            raw_artifacts_json=[],
            idempotency_key=str(uuid4()),
            created_at=datetime.now(UTC),
            request_id=str(uuid4()),
            correlation_id=str(uuid4()),
        )
        session.add(record)
        session.commit()
        return record.id, calculation.id


@pytest.mark.parametrize(
    "state_value,authority,validation,converged,expected",
    [
        ("SUCCEEDED", "AUTHORITATIVE", "VALIDATED", True, True),
        ("FAILED", "AUTHORITATIVE", "VALIDATED", True, False),
        ("RUNNING", "AUTHORITATIVE", "VALIDATED", True, False),
        ("SUCCEEDED", "CANDIDATE", "VALIDATED", True, False),
        ("SUCCEEDED", "AUTHORITATIVE", "REJECTED", True, False),
        ("SUCCEEDED", "AUTHORITATIVE", "VALIDATED", False, False),
    ],
)
def test_stored_result_authority_state_and_convergence(
    api, monkeypatch, state_value, authority, validation, converged, expected
):
    client, sessions, _settings = api
    from chemdft_api.navigator import service

    monkeypatch.setattr(service, "observe", lambda _s: CAPS)
    project = create(client)
    version = import_water(client, project)["version"]["id"]
    payload = {
        "payload_schema": "chemdft.energy",
        "converged": converged,
        "total_energy": {"value": -74.96292823099459},
        "method": "hf",
        "basis": "sto-3g",
    }
    seed_projection_result(
        sessions,
        project,
        version,
        payload=payload,
        state=state_value,
        authority=authority,
        validation=validation,
    )
    body = client.get(f"/v1/projects/{project}/navigator").json()
    ids = {h["state_id"] for h in body["have"]}
    assert ("energy.calculated" in ids) is expected
    assert "orbitals.available" not in ids
    assert "geometry.optimized" not in ids
    if state_value == "RUNNING":
        assert "job.in_progress" in ids
    if state_value == "FAILED":
        assert "job.failed" in ids


def test_stored_water_orbital_metadata_not_generic_energy(api, monkeypatch):
    client, sessions, _settings = api
    from chemdft_api.navigator import service

    monkeypatch.setattr(service, "observe", lambda _s: CAPS)
    project = create(client)
    version = import_water(client, project)["version"]["id"]
    root = Path(__file__).resolve().parents[3]
    stored = json.loads(
        (root / "apps/web/src/app/_components/home/reference/water-run-record.json").read_text()
    )
    payload = {
        "payload_schema": "chemdft.molecular-orbitals",
        "converged": stored["result"]["converged"],
        "total_energy_hartree": stored["result"]["total_energy_hartree"],
        "orbitals": [{}] * stored["result"]["molecular_orbitals"],
        "frontier_by_spin": [
            {
                "homo_index": stored["result"]["homo"]["index"],
                "lumo_index": stored["result"]["lumo"]["index"],
            }
        ],
        "method": "hf",
        "basis": "sto-3g",
        "engine": "pyscf",
    }
    record_id, _ = seed_projection_result(
        sessions, project, version, task="ORBITAL", payload=payload
    )
    body = client.get(f"/v1/projects/{project}/navigator").json()
    assert {"energy.calculated", "orbitals.available", "frontier.available"} <= {
        h["state_id"] for h in body["have"]
    }
    action = next(a for a in body["next"] if a["action_id"] == "electronic.inspect_orbitals")
    assert action["target"]["selection_id"] == record_id


def test_database_frequency_metadata_and_optimization_gate(api, monkeypatch):
    client, sessions, _settings = api
    from chemdft_api.navigator import service

    monkeypatch.setattr(service, "observe", lambda _s: CAPS)
    project = create(client)
    version = import_water(client, project)["version"]["id"]
    seed_projection_result(
        sessions,
        project,
        version,
        task="FREQUENCY",
        payload={
            "payload_schema": "chemdft.vibrational-analysis",
            "hessian_artifact": {"artifact_id": str(uuid4())},
            "intensity_unit": "km/mol",
            "raman_activity_unit": "angstrom^4/amu",
            "modes": [
                {"frequency_cm1": -100, "imaginary": True},
                {"frequency_cm1": 200, "imaginary": False},
                {"frequency_cm1": 300, "imaginary": False},
            ],
            "expected_vibrational_mode_count": 3,
            "input_structure_hash": "a" * 64,
            "charge": 0,
            "multiplicity": 1,
        },
    )
    body = client.get(f"/v1/projects/{project}/navigator?goal=thermochemistry").json()
    assert {"spectra.ir.calculated", "spectra.raman.calculated"} <= {
        h["state_id"] for h in body["have"]
    }
    codes = {
        r["code"]
        for a in body["blocked"]
        if a["action_id"] == "thermochemistry.calculate"
        for r in a["reasons"]
    }
    assert {"optimization_required", "imaginary_frequencies", "stationarity_unproven"} <= codes


@pytest.mark.parametrize("hash_matches", [True, False])
def test_stored_optimized_version_requires_trajectory_result_and_coordinate_hash(
    api, monkeypatch, hash_matches
):
    from chemdft_api.navigator import service
    from chemdft_api.scientific_models import (
        OptimizationTrajectoryRecord,
        ScientificArtifactRecord,
        StructureVersionRecord,
    )

    client, sessions, _settings = api
    monkeypatch.setattr(service, "observe", lambda _s: CAPS)
    project = create(client)
    version_id = import_water(client, project)["version"]["id"]
    with sessions() as session:
        version = session.get(StructureVersionRecord, version_id)
        coordinate_hash = session.get(
            ScientificArtifactRecord, version.canonical_artifact_id
        ).sha256
        values = {
            c.name: getattr(version, c.name) for c in StructureVersionRecord.__table__.columns
        }
        values.update(
            id=str(uuid4()),
            origin="OPTIMIZED",
            revision=version.revision + 1,
            parent_version_id=version.id,
            idempotency_key=str(uuid4()),
            created_at=datetime.now(UTC),
        )
        final_version = StructureVersionRecord(**values)
        session.add(final_version)
        session.commit()
        version_id = final_version.id
    _result_id, calculation_id = seed_projection_result(
        sessions,
        project,
        version_id,
        task="GEOMETRY_OPTIMIZATION",
        payload={
            "payload_schema": "chemdft.optimization",
            "converged": True,
            "method": "hf",
            "basis": "sto-3g",
            "final_structure_version_id": version_id,
            "final_structure_hash": coordinate_hash if hash_matches else "0" * 64,
        },
    )
    with sessions() as session:
        session.add(
            OptimizationTrajectoryRecord(
                project_id=project,
                calculation_id=calculation_id,
                input_structure_version_id=version_id,
                final_structure_version_id=version_id,
                atom_identities_json=[],
                input_hash=coordinate_hash,
                state="CONVERGED",
                steps_json=[{"gradient_rms_hartree_per_bohr": 0.0001}],
            )
        )
        session.commit()
    body = client.get(f"/v1/projects/{project}/navigator").json()
    assert body["facts_summary"]["optimized"] is hash_matches
    assert ("geometry.optimized" in {h["state_id"] for h in body["have"]}) is hash_matches
    assert ("calculation.optimize" in {a["action_id"] for a in body["next"]}) is not hash_matches


def test_no_provider_credentials_required(api, monkeypatch):
    client, _sessions, settings = api
    from chemdft_api.navigator import service

    monkeypatch.setattr(service, "observe", lambda _s: CAPS)
    monkeypatch.setattr(settings, "ai_provider", "fake")
    monkeypatch.setattr(settings, "ai_api_key", None)
    project = create(client)
    import_water(client, project)
    assert client.get(f"/v1/projects/{project}/navigator").status_code == 200


def test_confirmed_experimental_workflow_and_peak_lineage(api, monkeypatch):
    from spectra_support import import_spectrum, ir_text, peaks, requires_spectra_worker, upload

    if requires_spectra_worker.args[0]:
        pytest.skip("isolated spectra worker not installed")
    from chemdft_api.navigator import service

    client, sessions, _settings = api
    monkeypatch.setattr(service, "observe", lambda _s: CAPS)
    project = create(client)
    imported = import_water(client, project)
    pending = upload(client, project, ir_text(), key="nav-preview")
    assert pending.status_code == 201
    assert "experimental.ir" not in {
        h["state_id"] for h in client.get(f"/v1/projects/{project}/navigator").json()["have"]
    }
    raw = import_spectrum(
        client,
        project,
        ir_text(),
        key="nav-confirmed",
        association={
            "state": "ASSOCIATED_WITH_STRUCTURE",
            "structure_id": imported["structure"]["id"],
        },
    )
    seed_projection_result(
        sessions,
        project,
        imported["version"]["id"],
        task="FREQUENCY",
        payload={
            "payload_schema": "chemdft.vibrational-analysis",
            "intensity_unit": "km/mol",
            "modes": [{"frequency_cm1": 100, "imaginary": False}],
            "expected_vibrational_mode_count": 1,
        },
    )
    body = client.get(f"/v1/projects/{project}/navigator?goal=compare").json()
    codes = {
        r["code"]
        for a in body["blocked"]
        if a["action_id"] == "spectra.compare"
        for r in a["reasons"]
    }
    assert "experimental_peaks_required" in codes
    detected = peaks(client, project, raw["id"], {"prominence_sigma": 8})
    assert detected.status_code == 201, detected.text
    body = client.get(f"/v1/projects/{project}/navigator?goal=compare").json()
    assert "spectra.compare" in {a["action_id"] for a in body["next"]}
    assert "experimental.peaks.available" in {h["state_id"] for h in body["have"]}
    # Latest explicit removal overrides earlier association; existence alone is not validity.
    changed = client.put(
        f"/v1/projects/{project}/experimental/spectra/datasets/{raw['id']}/association",
        json={"state": "UNASSIGNED"},
    )
    assert changed.status_code == 200, changed.text
    body = client.get(f"/v1/projects/{project}/navigator?goal=compare").json()
    codes = {
        r["code"]
        for a in body["blocked"]
        if a["action_id"] == "spectra.compare"
        for r in a["reasons"]
    }
    assert "spectrum_association_required" in codes
