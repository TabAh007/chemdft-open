#!/usr/bin/env python3
"""Disposable application workflow check: submit -> queue -> worker -> provider -> Firewall -> result.

Starts a FRESH, isolated ChemDFT stack (new SQLite database migrated to head, new object root, API on a
free local port, one compute worker) under ``.chemdft/aws-live/<timestamp>/``, submits the reference H2
HF/STO-3G PySCF energy through the real HTTP API, waits for the worker, and writes a report. It never
touches the existing development database.

    --preference LOCAL   local provider only (no AWS); verifies the whole local workflow
    --preference CLOUD   AWS provider; REQUIRES an owner-approved open session (tools/aws_session.py open)
                         and the CHEMDFT_COMPUTE_AWS_ENABLED / CHEMDFT_AWS_* environment. Never starts EC2.

The scientific comparison is made only because the submitted input IS the reference input (H at
(0,0,-0.37) and (0,0,+0.37) Å, HF, STO-3G, charge 0, multiplicity 1, PySCF 2.14.0).
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / ".venv" / "bin" / "python"
REFERENCE_ENERGY = -1.1167593073964255
TOLERANCE = 1e-10
XYZ = b"2\nH2 0.74 angstrom\nH 0 0 -0.37\nH 0 0 0.37\n"
TERMINAL = {"SUCCEEDED", "FAILED", "CANCELED", "REJECTED"}


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preference", choices=("LOCAL", "CLOUD"), required=True)
    parser.add_argument("--timeout", type=int, default=420, help="seconds to wait for a result")
    args = parser.parse_args()
    if args.preference == "CLOUD" and os.environ.get("CHEMDFT_COMPUTE_AWS_ENABLED") != "true":
        raise SystemExit(
            "CLOUD needs CHEMDFT_COMPUTE_AWS_ENABLED=true and the CHEMDFT_AWS_* settings"
        )

    run_dir = ROOT / ".chemdft" / "aws-live" / datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True)
    port = free_port()
    env = {
        **os.environ,
        "CHEMDFT_ENV": "development",
        "CHEMDFT_DATABASE_URL": f"sqlite:///{run_dir / 'chemdft.db'}",
        "CHEMDFT_OBJECT_ROOT": str(run_dir / "objects"),
        "CHEMDFT_AUTO_CREATE_SCHEMA": "false",
        "CHEMDFT_DEV_IDENTITY_ENABLED": "true",
        "CHEMDFT_COMPUTE_WORKER_ID": "aws-live-check-worker",
        "CHEMDFT_COMPUTE_WORKER_POLL_SECONDS": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    subprocess.run(
        [str(PYTHON), "-B", "-m", "alembic", "upgrade", "head"],
        cwd=ROOT / "services/api", env=env, check=True, capture_output=True,
    )  # fmt: skip
    subprocess.run(
        [
            str(PYTHON), "-B", "-c",
            "from chemdft_api.auth import ensure_dev_identity; from chemdft_api.config import "
            "get_settings; from chemdft_api.database import SessionLocal; s=SessionLocal(); "
            "ensure_dev_identity(s,get_settings()); s.close()",
        ],
        cwd=ROOT, env=env, check=True, capture_output=True,
    )  # fmt: skip
    api = subprocess.Popen(
        [str(ROOT / ".venv/bin/uvicorn"), "chemdft_api.main:app", "--port", str(port)],
        cwd=ROOT, env=env, stdout=open(run_dir / "api.log", "wb"), stderr=subprocess.STDOUT,
    )  # fmt: skip
    worker = subprocess.Popen(
        [str(ROOT / ".venv/bin/chemdft-compute-worker")],
        cwd=ROOT, env=env, stdout=open(run_dir / "worker.log", "wb"), stderr=subprocess.STDOUT,
    )  # fmt: skip
    report: dict[str, object] = {"preference": args.preference, "run_dir": str(run_dir)}
    code = 1
    try:
        client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30)
        for _ in range(60):
            try:
                if client.get("/health").status_code < 500:
                    break
            except httpx.TransportError:
                time.sleep(0.5)
        project = client.post("/v1/projects", json={"name": "AWS live check", "slug": "aws-live"})
        project.raise_for_status()
        project_id = project.json()["id"]
        imported = client.post(
            f"/v1/projects/{project_id}/structures/imports",
            files={"upload": ("h2.xyz", XYZ, "chemical/x-xyz")},
            data={
                "file_format": "XYZ",
                "idempotency_key": "live-h2-import",
                "structure_name": "H2",
            },
        )
        imported.raise_for_status()
        version = imported.json()["version"]
        submitted_at = time.monotonic()
        created = client.post(
            f"/v1/projects/{project_id}/calculations",
            json={
                "structure_version": {
                    "project_id": project_id, "entity_type": "structure.version",
                    "entity_id": version["id"],
                },
                "specification": {
                    "task_type": "ENERGY",
                    "method": {"identifier": "hf", "display_name": "Hartree-Fock",
                               "registry": "chemdft.method"},
                    "basis": {"identifier": "sto-3g", "display_name": "STO-3G",
                              "registry": "chemdft.basis"},
                    "charge": 0, "multiplicity": 1,
                    "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
                },
                "provider_preference": args.preference,
                "idempotency_key": "live-h2-hf-sto3g",
            },
        )  # fmt: skip
        if created.status_code != 201:
            report["submit_refused"] = created.text[:500]
            raise SystemExit(f"submission refused: {created.text[:300]}")
        detail = created.json()
        report["submit_seconds"] = round(time.monotonic() - submitted_at, 3)
        report["initial_job"] = {
            "provider": detail["compute_job"]["provider"],
            "state": detail["compute_job"]["state"],
        }
        calculation_url = f"/v1/projects/{project_id}/calculations/{detail['calculation']['id']}"
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            detail = client.get(calculation_url).json()
            if detail["compute_job"]["state"] in TERMINAL:
                break
            time.sleep(2)
        report["final_state"] = detail["calculation"]["state"]
        report["job_state"] = detail["compute_job"]["state"]
        report["provider"] = detail["compute_job"]["provider"]
        execution = detail.get("compute_execution") or {}
        report["hardware_class"] = execution.get("hardware_class")
        result = detail.get("result")
        if detail["calculation"]["state"] == "SUCCEEDED" and result:
            energy = result["payload"]["total_energy"]["value"]
            report.update(
                source_class=result["source_class"], energy_hartree=energy,
                reference_hartree=REFERENCE_ENERGY, difference=energy - REFERENCE_ENERGY,
                matches_reference=abs(energy - REFERENCE_ENERGY) <= TOLERANCE,
                calculation_input_hash=detail.get("calculation_input_hash"),
            )  # fmt: skip
            log_id = detail["attempt"]["raw_artifacts"][1]["artifact_id"]
            log = client.get(f"{calculation_url}/artifacts/{log_id}").text
            report["log_has_scf_convergence"] = "converged SCF energy" in log
            report["log_has_aws_provenance"] = "CHEMDFT_AWS_PROVENANCE" in log
            with sqlite3.connect(run_dir / "chemdft.db") as db:
                row = db.execute(
                    "select provider, provider_execution_ref from compute_executions"
                ).fetchone()
            report["execution_record"] = {"provider": row[0], "provider_execution_ref": row[1]}
            code = 0 if report["matches_reference"] else 2
        else:
            report["diagnostic"] = (detail.get("calculation") or {}).get("failure_code")
    finally:
        for process in (worker, api):
            process.terminate()
        for process in (worker, api):
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
        (run_dir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True))
        print(json.dumps(report, indent=2, sort_keys=True))
    return code


if __name__ == "__main__":
    sys.exit(main())
