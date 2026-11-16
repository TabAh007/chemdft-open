from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest
from chemdft_api.scientific.engines.xtb_optimization import (
    execute_native,
    parse_evidence,
    validate_input,
)
from result_provenance_checks import assert_published_result_binding

ROOT = Path(__file__).resolve().parents[3]
XTB = ROOT / ".chemdft/envs/xtb/bin/xtb"


def native_input(name="water", maximum=100):
    geometries = {
        "water": [("O", 8, [0.0, 0.0, 0.0]), ("H", 1, [0.0, 0.0, 1.2]), ("H", 1, [1.1, 0.0, -0.3])],
        "methane": [
            ("C", 6, [0.0, 0.0, 0.0]),
            *[
                ("H", 1, xyz)
                for xyz in [
                    [0.8, 0.8, 0.8],
                    [-0.8, -0.8, 0.8],
                    [-0.8, 0.8, -0.8],
                    [0.8, -0.8, -0.8],
                ]
            ],
        ],
        "ammonium": [
            ("N", 7, [0.0, 0.0, 0.0]),
            *[
                ("H", 1, xyz)
                for xyz in [
                    [0.65, 0.65, 0.65],
                    [-0.65, -0.65, 0.65],
                    [-0.65, 0.65, -0.65],
                    [0.65, -0.65, -0.65],
                ]
            ],
        ],
        "oh": [("O", 8, [0.0, 0.0, 0.0]), ("H", 1, [0.0, 0.0, 1.15])],
    }
    return {
        "task": "GEOMETRY_OPTIMIZATION",
        "method": "gfn2",
        "basis": None,
        "coordinate_unit": "angstrom",
        "engine_version": "6.7.1",
        "charge": 1 if name == "ammonium" else 0,
        "multiplicity": 2 if name == "oh" else 1,
        "optimization": {"optimizer": "xtb-ancopt", "xtb_level": "normal", "max_steps": maximum},
        "atoms": [
            {"index": i, "element": el, "atomic_number": z, "xyz_angstrom": xyz}
            for i, (el, z, xyz) in enumerate(geometries[name])
        ],
    }


@pytest.mark.parametrize("name", ["water", "methane", "ammonium", "oh"])
def test_native_real_molecular_optimization(tmp_path, name):
    document = native_input(name)
    result, raw = execute_native(document, XTB, tmp_path / name)
    assert result["converged"] is True
    assert result["optimization_iterations"] == len(result["steps"]) - 1
    assert result["steps"][-1]["evaluation_kind"] == "FINAL_SINGLE_POINT"
    assert result["steps"][-1]["timestamp"] is None
    assert result["final_coordinates_angstrom"] == result["steps"][-1]["coordinates_angstrom"]
    assert result["steps"][0]["coordinates_angstrom"] != result["final_coordinates_angstrom"]
    assert parse_evidence(raw, document, 0) == result


def test_native_maxcycle_one_never_publishes_convergence(tmp_path):
    result, raw = execute_native(native_input(maximum=1), XTB, tmp_path / "limited")
    assert b"FAILED TO CONVERGE GEOMETRY OPTIMIZATION IN 1 ITERATIONS" in raw["stdout.txt"]
    assert ".xtboptok" in raw  # This installed version writes it even when convergence fails.
    assert result["converged"] is False
    assert result["optimization_iterations"] == 1


def test_native_evidence_rejects_corruption_and_crashes(tmp_path):
    import json

    document = native_input()
    _, raw = execute_native(document, XTB, tmp_path / "evidence")
    variants = []
    missing = dict(raw)
    del missing["xtbopt.xyz"]
    variants.append(missing)
    missing_status = dict(raw)
    del missing_status["execution.json"]
    variants.append(missing_status)
    inconsistent_status = dict(raw)
    inconsistent_status["execution.json"] = json.dumps({
        "schema": "chemdft.xtb.execution", "exit_code": 37
    }).encode()
    variants.append(inconsistent_status)
    truncated = dict(raw)
    truncated["xtbopt.log"] = truncated["xtbopt.log"][:-40]
    variants.append(truncated)
    reordered = dict(raw)
    reordered["xtbopt.xyz"] = reordered["xtbopt.xyz"].replace(b"\nO ", b"\nH ", 1)
    variants.append(reordered)
    energy = dict(raw)
    energy["xtbopt.xyz"] = energy["xtbopt.xyz"].replace(b"energy: -", b"energy: -9", 1)
    variants.append(energy)
    contradiction = dict(raw)
    contradiction["NOT_CONVERGED"] = b""
    variants.append(contradiction)
    for changed in variants:
        with pytest.raises(ValueError):
            parse_evidence(changed, document, 0)
    with pytest.raises(ValueError, match="execution or SCC failed"):
        parse_evidence(raw, document, 139)


@pytest.mark.parametrize("case", ["nan", "order", "spin"])
def test_native_invalid_inputs(case):
    document = deepcopy(native_input())
    if case == "nan":
        document["atoms"][0]["xyz_angstrom"][0] = float("nan")
    if case == "order":
        document["atoms"][0]["index"] = 1
    if case == "spin":
        document["multiplicity"] = 2
    with pytest.raises(ValueError):
        validate_input(document)


def submit(api, name="water", maximum=100, version=None, project=None, key=None):
    from uuid import uuid4

    client, _, _ = api
    document = native_input(name, maximum)
    if project is None:
        project = client.post(
            "/v1/projects",
            json={"name": "Disposable native optimization", "slug": f"opt-{uuid4()}"},
        ).json()["id"]
    if version is None:
        xyz = (
            str(len(document["atoms"]))
            + "\nDisposable native input\n"
            + "\n".join(
                atom["element"] + " " + " ".join(map(str, atom["xyz_angstrom"]))
                for atom in document["atoms"]
            )
            + "\n"
        )
        imported = client.post(
            f"/v1/projects/{project}/structures/imports",
            files={"upload": ("input.xyz", xyz.encode(), "chemical/x-xyz")},
            data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
        )
        assert imported.status_code == 201, imported.text
        version = imported.json()["version"]
    request = {
        "structure_version": {
            "project_id": project,
            "entity_type": "structure.version",
            "entity_id": version["id"],
        },
        "specification": {
            "task_type": "GEOMETRY_OPTIMIZATION",
            "method": {
                "identifier": "gfn2",
                "display_name": "GFN2-xTB",
                "registry": "chemdft.method",
            },
            "basis": None,
            "charge": document["charge"],
            "multiplicity": document["multiplicity"],
            "engine_preference": {"engine": "xtb", "allowed_version": "6.7.1"},
            "optimization": document["optimization"],
        },
        "idempotency_key": key or str(uuid4()),
    }
    response = client.post(f"/v1/projects/{project}/calculations", json=request)
    assert response.status_code == 201, response.text
    return project, version, response.json(), request


def run_job(api):
    from chemdft_api.calculation_actions import process_next_compute_job
    from chemdft_api.context import Identity
    from chemdft_api.storage import LocalObjectStore

    _, sessions, settings = api
    with sessions() as session:
        return process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
        )


@pytest.mark.parametrize("name", ["water", "methane", "ammonium", "oh"])
def test_backend_native_publication_lineage_and_provenance(api, name):
    from chemdft_api.scientific_models import ScientificArtifactRecord

    client, sessions, settings = api
    project, original, queued, request = submit(api, name)
    detail = run_job(api)
    assert detail.calculation.state == "SUCCEEDED", detail
    assert detail.result.trusted_producer_id == "local.xtb.worker"
    assert_published_result_binding(sessions, detail.result.id, original["id"])
    payload = detail.result.payload
    assert payload.basis is None and payload.converged
    import json

    from chemdft_api.ai.context_builder import AIContextBuilder
    from chemdft_api.context import Identity

    with sessions() as session:
        context = AIContextBuilder(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            project,
        ).build_context()
        record = context.structured_context["project_context"].calculations[0]
        assert record["basis"] is None
        assert record["trajectory"]["optimization_iterations"] == payload.optimization_iterations
        assert record["trajectory"]["recorded_evaluations"] == payload.step_count
        assert record["trajectory"]["final_single_point_evaluations"] == 1
        for ref in detail.result.raw_artifacts:
            artifact = session.get(ScientificArtifactRecord, str(ref.artifact_id))
            if artifact.format_identifier in {
                "xtb.native.execution.json",
                "chemdft.worker.execution",
            }:
                evidence = json.loads((settings.object_root / artifact.storage_key).read_bytes())
                assert artifact.kind == "CALCULATION_OUTPUT"
                if artifact.format_identifier == "xtb.native.execution.json":
                    assert evidence["exit_code"] == 0
                else:
                    assert evidence["worker_exit_code"] == 0
                    assert evidence["calculation_id"] == str(detail.calculation.id)
    assert payload.optimization_iterations == len(detail.optimization_trajectory.steps) - 1
    versions = client.get(
        f"/v1/projects/{project}/structures/{original['structure_id']}/versions"
    ).json()
    assert len(versions) == 2
    assert versions[0]["version"]["coordinates"] == original["coordinates"]
    optimized = versions[1]["version"]
    assert optimized["parent_version_id"] == original["id"]
    assert optimized["origin"] == "OPTIMIZED"
    assert optimized["id"] == str(payload.final_structure_version_id)
    assert [atom["index"] for atom in optimized["coordinates"]["atoms"]] == list(
        range(len(native_input(name)["atoms"]))
    )
    with sessions() as session:
        xyz_art = next(
            session.get(ScientificArtifactRecord, str(ref.artifact_id))
            for ref in detail.result.raw_artifacts
            if session.get(ScientificArtifactRecord, str(ref.artifact_id)).format_identifier
            == "xtb.native.xtbopt.xyz"
        )
        from chemdft_api.scientific.engines.xtb_optimization import frames

        raw = (settings.object_root / xyz_art.storage_key).read_bytes()
        endpoint = frames(raw, native_input(name)["atoms"])[0]
        assert payload.final_energy.value == endpoint["energy_hartree"]
        assert [
            [a[axis] for axis in ["x", "y", "z"]] for a in optimized["coordinates"]["atoms"]
        ] == endpoint["coordinates_angstrom"]
    repeated = client.post(f"/v1/projects/{project}/calculations", json=request).json()
    assert repeated["calculation"]["id"] == queued["calculation"]["id"]
    assert run_job(api) is None


def test_backend_nonconvergence_retains_history_without_endpoint(api):
    import json

    from chemdft_api.scientific_models import ScientificArtifactRecord

    client, sessions, settings = api
    project, original, _, _ = submit(api, maximum=1)
    detail = run_job(api)
    assert detail.calculation.state == "FAILED"
    assert detail.attempt.failure_code == "NONCONVERGED"
    assert detail.result is None
    assert detail.optimization_trajectory.state == "NOT_CONVERGED"
    assert detail.optimization_trajectory.steps
    with sessions() as session:
        statuses = {}
        for ref in detail.attempt.raw_artifacts:
            artifact = session.get(ScientificArtifactRecord, str(ref.artifact_id))
            if artifact.format_identifier in {
                "xtb.native.execution.json", "chemdft.worker.execution"
            }:
                statuses[artifact.format_identifier] = json.loads(
                    (settings.object_root / artifact.storage_key).read_bytes()
                )
        assert statuses["xtb.native.execution.json"]["exit_code"] == 0
        assert statuses["chemdft.worker.execution"]["worker_exit_code"] == 3
    assert detail.optimization_trajectory.final_structure_version_id is None
    assert (
        len(
            client.get(
                f"/v1/projects/{project}/structures/{original['structure_id']}/versions"
            ).json()
        )
        == 1
    )


@pytest.mark.parametrize("failure", ["missing", "energy", "timeout", "crash", "cancel"])
def test_backend_failure_boundaries_publish_no_endpoint(api, monkeypatch, failure):
    from dataclasses import replace

    from chemdft_api.compute_gateway import LocalComputeProvider

    client, _, _ = api
    project, original, queued, _ = submit(api)
    execute = LocalComputeProvider.execute

    def controlled(self, **kwargs):
        result = execute(self, **kwargs)
        if failure == "timeout":
            return replace(result, timed_out=True, exit_code=-9)
        if failure == "crash":
            return replace(result, exit_code=139, result_document=None)
        if failure == "cancel":
            assert (
                client.post(
                    f"/v1/projects/{project}/calculations/{queued['calculation']['id']}/cancel"
                ).status_code
                == 200
            )
            return result
        raw = dict(result.native_artifacts)
        if failure == "missing":
            del raw["xtbopt.xyz"]
        if failure == "energy":
            raw["xtbopt.xyz"] = raw["xtbopt.xyz"].replace(b"energy: -", b"energy: -9", 1)
        return replace(result, native_artifacts=raw)

    monkeypatch.setattr(LocalComputeProvider, "execute", controlled)
    detail = run_job(api)
    assert detail.result is None
    assert detail.calculation.state == ("CANCELED" if failure == "cancel" else "FAILED")
    expected = {
        "timeout": "EXECUTION_TIMEOUT",
        "crash": "ENGINE_CRASHED",
        "cancel": "CANCELED",
    }.get(failure, "RESULT_VALIDATION_FAILED")
    assert detail.attempt.failure_code == expected
    assert (
        len(
            client.get(
                f"/v1/projects/{project}/structures/{original['structure_id']}/versions"
            ).json()
        )
        == 1
    )


def test_concurrent_native_completions_allocate_distinct_child_versions(api, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Event

    from chemdft_api.compute_gateway import LocalComputeProvider

    client, _, _ = api
    project, original, _, _ = submit(api)
    submit(api, project=project, version=original)
    started, barrier = Event(), Barrier(2)
    execute = LocalComputeProvider.execute

    def synchronized(self, **kwargs):
        started.set()
        result = execute(self, **kwargs)
        barrier.wait(timeout=60)
        return result

    monkeypatch.setattr(LocalComputeProvider, "execute", synchronized)
    with ThreadPoolExecutor(max_workers=2) as pool:
        one = pool.submit(run_job, api)
        assert started.wait(30)
        two = pool.submit(run_job, api)
        details = [one.result(90), two.result(90)]
    assert all(detail.calculation.state == "SUCCEEDED" for detail in details)
    assert len({detail.result.payload.final_structure_version_id for detail in details}) == 2
    versions = client.get(
        f"/v1/projects/{project}/structures/{original['structure_id']}/versions"
    ).json()
    assert [v["version"]["revision"] for v in versions] == [1, 2, 3]
    assert all(v["version"]["parent_version_id"] == original["id"] for v in versions[1:])


def test_stale_native_attempt_cannot_append_or_publish(api, monkeypatch):
    from datetime import timedelta

    from chemdft_api.compute_gateway import LocalComputeProvider
    from chemdft_api.models import utc_now
    from chemdft_api.scientific_models import ComputeLeaseRecord
    from sqlalchemy import select

    client, sessions, _ = api
    project, original, _, _ = submit(api)
    execute = LocalComputeProvider.execute

    def expired(self, **kwargs):
        callback = kwargs.pop("on_step")
        result = execute(self, on_step=None, **kwargs)
        with sessions() as other:
            lease = other.scalar(select(ComputeLeaseRecord))
            lease.heartbeat_deadline_at = utc_now() - timedelta(minutes=1)
            other.commit()
        assert callback(result.result_document["steps"][0]) is False
        return result

    monkeypatch.setattr(LocalComputeProvider, "execute", expired)
    detail = run_job(api)
    assert detail.calculation.state == "FAILED"
    assert detail.result is None
    assert not detail.optimization_trajectory.steps
    assert (
        len(
            client.get(
                f"/v1/projects/{project}/structures/{original['structure_id']}/versions"
            ).json()
        )
        == 1
    )


@pytest.mark.parametrize(
    "corruption",
    [
        "energy",
        "atom",
        "attempt",
        "input",
        "producer",
        "producer_id",
        "missing_xyz",
        "attestation",
        "final_frame",
        "iterations",
        "missing_xyz_record",
    ],
)
def test_native_firewall_rejects_unbound_publication_atomically(api, monkeypatch, corruption):
    from chemdft_api import calculation_actions
    from chemdft_api.scientific_models import (
        CalculationAttemptRecord,
        OptimizationTrajectoryRecord,
        StructureVersionRecord,
    )
    from sqlalchemy import select

    client, _, _ = api
    project, original, _, _ = submit(api)
    accept = calculation_actions.accept_authoritative_result

    def tampered(session, producer, submission):
        trajectory = session.scalar(select(OptimizationTrajectoryRecord))
        if corruption in {"producer_id", "attestation"}:
            from chemdft_api.trusted_producers import issue_trusted_producer_context

            producer = issue_trusted_producer_context(
                producer_id="local.pyscf.worker"
                if corruption == "producer_id"
                else producer.producer_id,
                producer_type=producer.producer_type,
                project_id=producer.project_id,
                attestation_id="wrong-execution"
                if corruption == "attestation"
                else producer.attestation_id,
            )
        if corruption == "missing_xyz":
            from chemdft_api.scientific_models import ScientificArtifactRecord

            submission = submission.model_copy(
                update={
                    "raw_artifacts": tuple(
                        ref
                        for ref in submission.raw_artifacts
                        if session.get(
                            ScientificArtifactRecord, str(ref.artifact_id)
                        ).format_identifier
                        != "xtb.native.xtbopt.xyz"
                    )
                }
            )
        if corruption == "missing_xyz_record":
            from chemdft_api.scientific_models import ScientificArtifactRecord

            get = session.get
            missing_id = next(
                str(ref.artifact_id) for ref in submission.raw_artifacts
                if get(ScientificArtifactRecord, str(ref.artifact_id)).format_identifier
                == "xtb.native.xtbopt.xyz"
            )
            def missing_lookup(model, identifier, *args, **kwargs):
                if model is ScientificArtifactRecord and identifier == missing_id:
                    return None
                return get(model, identifier, *args, **kwargs)
            monkeypatch.setattr(session, "get", missing_lookup)
        if corruption == "final_frame":
            trajectory.steps_json = [
                *trajectory.steps_json[:-1],
                {
                    **trajectory.steps_json[-1],
                    "evaluation_kind": "OPTIMIZER",
                },
            ]
        if corruption == "iterations":
            submission = submission.model_copy(
                update={
                    "payload": submission.payload.model_copy(
                        update={
                            "optimization_iterations": submission.payload.optimization_iterations
                            + 1
                        }
                    )
                }
            )
        if corruption == "energy":
            submission = submission.model_copy(
                update={
                    "payload": submission.payload.model_copy(
                        update={
                            "final_energy": submission.payload.final_energy.model_copy(
                                update={"value": -99.0}
                            )
                        }
                    )
                }
            )
        if corruption == "atom":
            version = session.get(StructureVersionRecord, trajectory.final_structure_version_id)
            document = deepcopy(version.representation_json)
            document["coordinates"]["atoms"][0]["element"] = "C"
            version.representation_json = document
        if corruption == "attempt":
            session.scalar(select(CalculationAttemptRecord)).engine_identity_json = {}
        if corruption == "input":
            trajectory.input_hash = "b" * 64
        if corruption == "producer":
            submission = submission.model_copy(
                update={
                    "producer_software": submission.producer_software.model_copy(
                        update={"name": "pyscf"}
                    )
                }
            )
        return accept(session, producer, submission)

    monkeypatch.setattr(calculation_actions, "accept_authoritative_result", tampered)
    # A genuine Firewall rejection is a handled terminal outcome (PF-8F): the calculation ends
    # FAILED/RESULT_VALIDATION_FAILED with nothing published, instead of leaking an exception
    # and leaving RUNNING state behind.
    detail = run_job(api)
    assert detail.calculation.state == "FAILED", corruption
    assert detail.attempt.failure_code == "RESULT_VALIDATION_FAILED"
    assert detail.result is None
    versions = client.get(
        f"/v1/projects/{project}/structures/{original['structure_id']}/versions"
    ).json()
    assert len(versions) == 1


@pytest.mark.parametrize("termination", ["timeout", "cancel"])
def test_runner_really_terminates_process_and_retains_native_diagnostics(tmp_path, termination):
    import sys
    import time

    from chemdft_api.scientific.engines.interfaces import LocalSubprocessRequest
    from chemdft_api.scientific.engines.runner import LocalSubprocessRunner

    script = tmp_path / "blocked_worker.py"
    script.write_text(
        "from pathlib import Path\nimport subprocess, sys, time\n"
        "Path('native').mkdir()\nPath('native/stderr.txt').write_text('Execution started')\n"
        "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
        "time.sleep(60)\n"
    )
    request = LocalSubprocessRequest(
        calculation_id="disposable-process-control",
        normalized_input=b"{}",
        interpreter=Path(sys.executable),
        worker_script=script,
        timeout_seconds=1 if termination == "timeout" else 10,
        max_output_bytes=1024,
        threads=1,
    )
    started = time.monotonic()
    result = LocalSubprocessRunner().execute(
        request, on_tick=lambda: False, tick_interval_seconds=5 if termination == "timeout" else 0.1
    )
    assert time.monotonic() - started < 4
    assert result.exit_code < 0
    assert result.timed_out == (termination == "timeout")
    assert result.result_document is None
    assert result.native_artifacts["stderr.txt"] == b"Execution started"


def test_runner_preserves_complete_native_samples_from_truncated_failed_execution(tmp_path):
    import json
    import sys

    from chemdft_api.scientific.engines.interfaces import LocalSubprocessRequest
    from chemdft_api.scientific.engines.optimization import validate_step
    from chemdft_api.scientific.engines.runner import LocalSubprocessRunner

    document = native_input()
    result, raw = execute_native(document, XTB, tmp_path / "actual-native-evidence")
    # Exercise a worker failure after genuine history has been written. A truncated
    # final frame is retained as raw evidence, but cannot create a published endpoint.
    script = tmp_path / "failed_worker.py"
    script.write_text(
        "from pathlib import Path\nimport sys\nPath('native').mkdir()\n"
        f"Path('native/xtbopt.log').write_bytes({raw['xtbopt.log'][:-30]!r})\n"
        "sys.exit(139)\n"
    )
    observed = []
    execution = LocalSubprocessRunner().execute(
        LocalSubprocessRequest(
            calculation_id="partial-native-history",
            normalized_input=json.dumps(document).encode(),
            interpreter=Path(sys.executable),
            worker_script=script,
            timeout_seconds=10,
            max_output_bytes=100_000,
            threads=1,
        ),
        on_step=lambda candidate: observed.append(
            validate_step(candidate, document["atoms"], len(observed), "xtb")
        ),
    )
    assert execution.exit_code == 139
    assert execution.result_document is None
    assert len(observed) == result["optimization_iterations"] - 1
    assert observed[0]["coordinates_angstrom"] == result["steps"][0]["coordinates_angstrom"]
    assert all(
        step["evaluation_kind"] == "OPTIMIZER" and step["timestamp"] is None for step in observed
    )
