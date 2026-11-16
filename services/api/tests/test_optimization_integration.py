from __future__ import annotations

from pathlib import Path

from chemdft_api.ai.context_builder import AIContextBuilder
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.context import Identity
from chemdft_api.storage import LocalObjectStore
from result_provenance_checks import assert_published_result_binding


def test_real_h2_optimization_persists_trajectory_and_publishes_version(api) -> None:
    client, sessions, settings = api
    settings.scientific_worker_python = (
        Path(__file__).resolve().parents[3] / "services/scientific-worker/.venv/bin/python"
    )
    project = client.post(
        "/v1/projects", json={"name": "Optimization", "slug": "optimization"}
    ).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={"upload": ("h2.xyz", b"2\nH2\nH 0 0 0\nH 0 0 1.2\n", "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": "opt-h2-import", "structure_name": "H2"},
    )
    assert imported.status_code == 201, imported.text
    source = imported.json()["version"]
    response = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": source["id"],
            },
            "specification": {
                "task_type": "GEOMETRY_OPTIMIZATION",
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
                "optimization": {"optimizer": "geometric", "max_steps": 12},
            },
            "idempotency_key": "opt-h2-real-1",
        },
    )
    assert response.status_code == 201, response.text
    queued = response.json()
    assert queued["calculation"]["state"] == "QUEUED"
    assert queued["optimization_trajectory"]["steps"] == []
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
        )
    detail = client.get(
        f"/v1/projects/{project['id']}/calculations/{queued['calculation']['id']}"
    ).json()
    assert detail["calculation"]["state"] == "SUCCEEDED", detail
    trajectory = detail["optimization_trajectory"]
    assert_published_result_binding(sessions, detail["result"]["id"], source["id"])
    assert trajectory["state"] == "CONVERGED"
    assert len(trajectory["steps"]) > 1
    assert trajectory["artifact_sha256"] == detail["result"]["payload"]["trajectory_sha256"]
    assert detail["result"]["producer_software"]["name"] == "pyscf"
    assert detail["result"]["source_class"] == "CALCULATED"
    versions = client.get(
        f"/v1/projects/{project['id']}/structures/{source['structure_id']}/versions"
    ).json()
    assert len(versions) == 2
    assert versions[0]["version"]["coordinates"] == source["coordinates"]
    optimized = versions[1]["version"]
    assert optimized["origin"] == "OPTIMIZED"
    assert optimized["parent_version_id"] == source["id"]
    assert [
        [atom[axis] for axis in ("x", "y", "z")] for atom in optimized["coordinates"]["atoms"]
    ] == trajectory["steps"][-1]["coordinates_angstrom"]
    with sessions() as session:
        context = AIContextBuilder(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            project["id"],
        ).build_context()
        graph = context.structured_context["project_context"]
        assert len(graph.structures) == 1
        structure = graph.structures[0]
        assert [version["revision"] for version in structure["versions"]] == [1, 2]
        assert structure["versions"][1]["parent_version_id"] == source["id"]
        assert structure["versions"][1]["source_class"] == "CALCULATED"
        assert graph.calculations[0]["method"] == "hf"
        assert graph.calculations[0]["trajectory"]["step_count"] == len(trajectory["steps"])
        assert graph.calculations[0]["trajectory"]["final_structure_version_id"] == optimized["id"]
        assert graph.documents == ()
        assert graph.datasets == ()


def test_real_max_step_nonconvergence_retains_steps_without_final_version(api) -> None:
    client, sessions, settings = api
    settings.scientific_worker_python = (
        Path(__file__).resolve().parents[3] / "services/scientific-worker/.venv/bin/python"
    )
    project = client.post(
        "/v1/projects", json={"name": "Limited optimization", "slug": "limited-optimization"}
    ).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={"upload": ("h2.xyz", b"2\nH2\nH 0 0 0\nH 0 0 1.2\n", "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": "limited-opt-import"},
    )
    assert imported.status_code == 201, imported.text
    source = imported.json()["version"]
    response = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": source["id"],
            },
            "specification": {
                "task_type": "GEOMETRY_OPTIMIZATION",
                "method": {"identifier": "hf", "display_name": "HF", "registry": "chemdft.method"},
                "basis": {
                    "identifier": "sto-3g",
                    "display_name": "STO-3G",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
                "optimization": {"max_steps": 1},
            },
            "idempotency_key": "limited-opt-run-1",
        },
    )
    assert response.status_code == 201, response.text
    with sessions() as session:
        process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
        )
    detail = client.get(
        f"/v1/projects/{project['id']}/calculations/{response.json()['calculation']['id']}"
    ).json()
    assert detail["calculation"]["state"] == "FAILED"
    assert detail["optimization_trajectory"]["state"] == "NOT_CONVERGED"
    assert detail["optimization_trajectory"]["steps"]
    assert detail["optimization_trajectory"]["artifact_sha256"]
    assert detail["optimization_trajectory"]["final_structure_version_id"] is None
    assert detail["result"] is None
    versions = client.get(
        f"/v1/projects/{project['id']}/structures/{source['structure_id']}/versions"
    ).json()
    assert len(versions) == 1


def test_queued_optimization_cancellation_publishes_no_final_version(api) -> None:
    client, _sessions, settings = api
    settings.scientific_worker_python = (
        Path(__file__).resolve().parents[3] / "services/scientific-worker/.venv/bin/python"
    )
    project = client.post(
        "/v1/projects", json={"name": "Canceled optimization", "slug": "canceled-optimization"}
    ).json()
    imported = client.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={"upload": ("h2.xyz", b"2\nH2\nH 0 0 0\nH 0 0 1.2\n", "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": "cancel-opt-import"},
    )
    source = imported.json()["version"]
    response = client.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"],
                "entity_type": "structure.version",
                "entity_id": source["id"],
            },
            "specification": {
                "task_type": "GEOMETRY_OPTIMIZATION",
                "method": {"identifier": "hf", "display_name": "HF", "registry": "chemdft.method"},
                "basis": {
                    "identifier": "sto-3g",
                    "display_name": "STO-3G",
                    "registry": "chemdft.basis",
                },
                "charge": 0,
                "multiplicity": 1,
                "engine_preference": {"engine": "pyscf"},
                "optimization": {},
            },
            "idempotency_key": "cancel-opt-run-1",
        },
    )
    assert response.status_code == 201, response.text
    canceled = client.post(
        f"/v1/projects/{project['id']}/calculations/{response.json()['calculation']['id']}/cancel"
    )
    assert canceled.status_code == 200, canceled.text
    detail = canceled.json()
    assert detail["calculation"]["state"] == "CANCELED"
    assert detail["optimization_trajectory"]["state"] == "CANCELED"
    assert detail["optimization_trajectory"]["final_structure_version_id"] is None
    assert detail["result"] is None
    versions = client.get(
        f"/v1/projects/{project['id']}/structures/{source['structure_id']}/versions"
    ).json()
    assert len(versions) == 1
