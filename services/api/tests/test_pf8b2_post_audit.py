"""Targeted audit regressions; all scientific values come from real workers."""

from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from chemdft_api.calculation_actions import process_next_compute_job
from chemdft_api.context import Identity
from chemdft_api.scientific.engines import runner
from chemdft_api.scientific.engines.xtb_optimization import execute_native, validate_input
from chemdft_api.storage import LocalObjectStore
from test_xtb_optimization import native_input

ROOT = Path(__file__).resolve().parents[3]
PYSCF = ROOT / "services/scientific-worker/.venv/bin/python"


def queue(
    api, *, engine="pyscf", task="GEOMETRY_OPTIMIZATION", xyz=None, project=None, source=None
):
    client, _, settings = api
    settings.scientific_worker_python = PYSCF
    if project is None:
        project = client.post(
            "/v1/projects", json={"name": "Disposable audit", "slug": f"audit-{uuid4()}"}
        ).json()["id"]
    if source is None:
        response = client.post(
            f"/v1/projects/{project}/structures/imports",
            files={
                "upload": ("input.xyz", xyz or b"2\nH2\nH 0 0 0\nH 0 0 1.2\n", "chemical/x-xyz")
            },
            data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
        )
        assert response.status_code == 201, response.text
        source = response.json()["version"]
    specification = {
        "task_type": task,
        "method": {
            "identifier": "gfn2" if engine == "xtb" else "hf",
            "display_name": engine,
            "registry": "chemdft.method",
        },
        "basis": None
        if engine == "xtb"
        else {"identifier": "sto-3g", "display_name": "STO-3G", "registry": "chemdft.basis"},
        "charge": 0,
        "multiplicity": 1,
        "engine_preference": {"engine": engine},
    }
    if task == "GEOMETRY_OPTIMIZATION":
        specification["optimization"] = (
            {"optimizer": "xtb-ancopt", "xtb_level": "normal", "max_steps": 100}
            if engine == "xtb"
            else {"optimizer": "geometric", "max_steps": 50}
        )
    response = client.post(
        f"/v1/projects/{project}/calculations",
        json={
            "structure_version": {
                "project_id": project,
                "entity_type": "structure.version",
                "entity_id": source["id"],
            },
            "specification": specification,
            "idempotency_key": str(uuid4()),
        },
    )
    return project, source, response


def process(api):
    _, sessions, settings = api
    with sessions() as session:
        return process_next_compute_job(
            session,
            Identity(user_id=settings.dev_user_id, organization_id=settings.dev_organization_id),
            LocalObjectStore(settings.object_root),
            settings,
        )


@pytest.mark.parametrize("engine", ["xtb", "pyscf"])
def test_coincident_optimization_rejected_before_job_allocation(api, engine):
    _, _, response = queue(api, engine=engine, xyz=b"2\nCoincident nuclei\nH 0 0 0\nH 0 0 0\n")
    assert response.status_code == 422
    # The geometry audit (PF-3) now rejects before the engine-level "coincident nuclei" check.
    assert "GEOMETRY_DEGENERATE" in response.text


def test_single_atom_is_valid_input_and_real_energy_still_executes(api, tmp_path):
    document = native_input()
    document["atoms"] = [
        {"index": 0, "element": "He", "atomic_number": 2, "xyz_angstrom": [0.0, 0.0, 0.0]}
    ]
    validate_input(document)  # No blanket two-atom gate.
    project, source, response = queue(
        api, engine="xtb", task="ENERGY", xyz=b"1\nHelium\nHe 0 0 0\n"
    )
    assert response.status_code == 201, response.text
    detail = process(api)
    assert detail.calculation.state == "SUCCEEDED", detail
    assert detail.result.payload.total_energy.unit.code == "Eh"
    # Native single-atom optimization has no optimizer history/convergence evidence;
    # do not fabricate an optimized result merely because ENERGY is legitimate.
    project, source, response = queue(api, engine="xtb", project=project, source=source)
    assert response.status_code == 201, response.text
    detail = process(api)
    assert detail.result is None
    assert detail.calculation.state == "FAILED"
    assert detail.attempt.raw_artifacts


def test_actual_native_exit_code_survives_failed_execution(tmp_path):
    executable = tmp_path / "exit37"
    executable.write_text("#!/bin/sh\nexit 37\n")
    executable.chmod(0o700)
    with pytest.raises(ValueError):
        execute_native(native_input(), executable, tmp_path / "native")
    evidence = json.loads((tmp_path / "native/execution.json").read_text())
    assert evidence == {"schema": "chemdft.xtb.execution", "exit_code": 37}


@pytest.mark.parametrize("corruption", ["producer_id", "producer_type", "provenance"])
def test_pyscf_optimization_requires_explicit_producer(api, monkeypatch, corruption):
    from chemdft_api import calculation_actions
    from chemdft_api.scientific_models import ProvenanceRecordRow
    from chemdft_api.trusted_producers import ProducerType, issue_trusted_producer_context

    client, _, _ = api
    project, source, response = queue(api)
    assert response.status_code == 201, response.text
    accept = calculation_actions.accept_authoritative_result

    def tampered(session, producer, submission):
        if corruption == "provenance":
            session.get(
                ProvenanceRecordRow, str(submission.provenance_record_id)
            ).producer_identifier = "other.worker"
        else:
            producer = issue_trusted_producer_context(
                producer_id="local.xtb.worker"
                if corruption == "producer_id"
                else producer.producer_id,
                producer_type=ProducerType.VALIDATED_IMPORT_PIPELINE
                if corruption == "producer_type"
                else producer.producer_type,
                project_id=producer.project_id,
                attestation_id=producer.attestation_id,
            )
        return accept(session, producer, submission)

    monkeypatch.setattr(calculation_actions, "accept_authoritative_result", tampered)
    # PF-8F: a rejected publication no longer raises; the calculation is finalized FAILED
    # with no authoritative result and no optimized StructureVersion.
    detail = process(api)
    assert detail.calculation.state == "FAILED"
    assert detail.result is None
    assert "producer" in (detail.attempt.diagnostic or "").lower()
    versions = client.get(
        f"/v1/projects/{project}/structures/{source['structure_id']}/versions"
    ).json()
    assert len(versions) == 1


@pytest.mark.parametrize("timing", ["running", "after_exit"])
def test_real_pyscf_cancellation_has_no_late_publication_or_orphans(
    api, tmp_path, monkeypatch, timing
):
    from chemdft_api.scientific_models import ComputeLeaseRecord
    from sqlalchemy import select

    client, sessions, _settings = api
    project, source, response = queue(api)
    assert response.status_code == 201, response.text
    target = response.json()["calculation"]["id"]
    _, _, other_response = queue(api, task="ENERGY", project=project, source=source)
    assert other_response.status_code == 201, other_response.text
    unrelated = subprocess.Popen(
        [str(PYSCF), "-c", "import time; time.sleep(60)"], start_new_session=True
    )
    children = []
    pid_file = tmp_path / "child.pid"
    script = tmp_path / "controlled_pyscf_worker.py"
    # Real PySCF/geomeTRIC evaluates the first frame. A test-only pause makes
    # cancellation while the native calculation is live deterministic.
    actual_worker = ROOT / "services/api/src/chemdft_api/scientific/engines/pyscf_worker.py"
    script.write_text(
        "import runpy, time, subprocess, sys\nfrom pathlib import Path\n"
        "from pyscf.geomopt import geometric_solver\noriginal=geometric_solver.kernel\n"
        "def controlled(*args, **kwargs):\n"
        ' callback=kwargs["callback"]\n'
        " def blocked(env):\n"
        '  child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"])\n'
        f"  Path({str(pid_file)!r}).write_text(str(child.pid))\n"
        "  callback(env)\n  time.sleep(60)\n"
        ' kwargs["callback"]=blocked\n return original(*args, **kwargs)\n'
        "geometric_solver.kernel=controlled\n"
        f'runpy.run_path({str(actual_worker)!r},run_name="__main__")\n'
    )
    actual_execute = runner.LocalSubprocessRunner.execute
    actual_popen = runner.subprocess.Popen

    def tracked_popen(argv, *args, **kwargs):
        proc = actual_popen(argv, *args, **kwargs)
        if str(script) in argv:
            children.append(proc)
        return proc

    monkeypatch.setattr(runner.subprocess, "Popen", tracked_popen)
    cancellation = []

    def execute(self, request, **kwargs):
        if request.calculation_id == target and timing == "running":
            request = replace(request, worker_script=script)
            callback = kwargs["on_step"]

            def cancel_after_real_frame(candidate):
                callback(candidate)
                assert children[0].poll() is None
                canceled = client.post(f"/v1/projects/{project}/calculations/{target}/cancel")
                assert canceled.status_code == 200, canceled.text
                assert canceled.json()["compute_job"]["state"] == "CANCEL_REQUESTED"
                cancellation.append(True)
                return False

            kwargs["on_step"] = cancel_after_real_frame
        result = actual_execute(self, request, **kwargs)
        if request.calculation_id == target and timing == "after_exit":
            assert result.exit_code == 0
            assert result.result_document["converged"] is True
            canceled = client.post(f"/v1/projects/{project}/calculations/{target}/cancel")
            assert canceled.status_code == 200, canceled.text
            cancellation.append(True)
        return result

    monkeypatch.setattr(runner.LocalSubprocessRunner, "execute", execute)
    try:
        detail = process(api)
        assert cancellation
        assert detail.calculation.state == "CANCELED", detail
        assert detail.result is None
        assert detail.optimization_trajectory.state == "CANCELED"
        assert detail.optimization_trajectory.final_structure_version_id is None
        assert unrelated.poll() is None
        assert all(child.poll() is not None for child in children)
        if timing == "running":
            native_child = int(pid_file.read_text())
            for _ in range(30):
                try:
                    os.kill(native_child, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.1)
            else:
                pytest.fail("The canceled PySCF process group left a child process alive")
        with sessions() as session:
            lease = session.scalar(
                select(ComputeLeaseRecord).where(
                    ComputeLeaseRecord.job_id == str(detail.compute_job.id)
                )
            )
            assert lease.state == "RELEASED"
        versions = client.get(
            f"/v1/projects/{project}/structures/{source['structure_id']}/versions"
        ).json()
        assert len(versions) == 1
        other = process(api)
        assert other.calculation.id.hex == other_response.json()["calculation"]["id"].replace(
            "-", ""
        )
        assert other.calculation.state == "SUCCEEDED"
        assert other.result.result_type == "chemdft.energy"
        assert unrelated.poll() is None
        final = client.get(f"/v1/projects/{project}/calculations/{target}").json()
        assert final["result"] is None and final["calculation"]["state"] == "CANCELED"
    finally:
        unrelated.terminate()
        unrelated.wait(timeout=5)
