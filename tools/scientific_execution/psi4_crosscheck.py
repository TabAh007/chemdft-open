"""Independent Psi4 cross-check of the three PySCF energies (AI-8). Native compute only when armed.

What it checks: the energies PySCF 2.14.0 reported for H2, water and ethanol (HF/STO-3G, charge 0,
multiplicity 1) against an independent code, Psi4 1.11, run through ChemDFT's accepted sealed Psi4
adapter on the SAME stored structures: each structure is imported through the real import actions
and normalized through the real calculation-input path for both engines, and the two normalized
atom lists must be identical before anything runs. The tolerance is a constant, not an option.

    prepare (default): builds and verifies everything, hashes the plan, runs nothing native.
    --execute: needs CHEMDFT_PSI4_CROSSCHECK_ARMED=EXECUTE-<first 16 hex of the plan sha256>.

The PySCF energies are read from the retained acceptance reports of the three real runs (their
sha256 is part of the plan); no reference value is typed in here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path
from uuid import uuid4

from .cases import EXECUTION_CASES, ExecutionCase

ROOT = Path(__file__).resolve().parents[2]
PSI4_EXECUTABLE = ROOT / ".chemdft/envs/psi4-1.11-py312-gate-a1-20261009/bin/psi4"
ARM_ENV = "CHEMDFT_PSI4_CROSSCHECK_ARMED"
TOLERANCE_HARTREE = 1e-6  # fixed by the owner on 2026-10-18; never loosened to obtain a pass
LIMITS = {
    "threads": 1,
    "engine_memory": "1GiB",
    "wall_seconds_per_case": 180,
    "scratch_directory_bytes": 512 * 1024**2,
    "max_cases": 3,
}
# The retained acceptance reports of the real PySCF runs (ignored output directories).
_REPORT = "output/playwright/{run}/output/ai-scientific-execution/{case}-acceptance.json"
PYSCF_REPORTS = {
    "A-h2-hf-sto3g": _REPORT.format(run="ai7-h2", case="A-h2-hf-sto3g"),
    "B-h2o-hf-sto3g": _REPORT.format(run="ai7-h2o", case="B-h2o-hf-sto3g"),
    "C-ethanol-hf-sto3g": _REPORT.format(run="ai7-ethanol", case="C-ethanol-hf-sto3g"),
}
BOHR_CODATA_2010 = 0.52917721092  # the value PySCF's default constants use
BOHR_CODATA_2014 = 0.52917721067  # the value behind Psi4's qcelemental 0.51.x conversion


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def pyscf_reference(case_id: str) -> dict:
    """The energy PySCF reported, read from its retained acceptance report; never typed in."""
    path = ROOT / PYSCF_REPORTS[case_id]
    raw = path.read_bytes()
    detail = json.loads(raw)["detail"]["result"]
    energy = detail["payload"]["total_energy"]
    assert energy["unit"]["code"] == "Eh" and detail["payload"]["converged"] is True
    assert detail["producer_software"]["name"] == "pyscf"
    return {
        "energy_hartree": energy["value"],
        "producer": f"pyscf {detail['producer_software']['version']}",
        "report": PYSCF_REPORTS[case_id],
        "report_sha256": hashlib.sha256(raw).hexdigest(),
    }


def nuclear_repulsion(atoms, angstrom_per_bohr: float) -> float:
    """Analytic nuclear repulsion in Hartree from Angstrom coordinates (an independent check)."""
    total = 0.0
    for i, a in enumerate(atoms):
        for b in atoms[i + 1 :]:
            r = math.dist(a["xyz_angstrom"], b["xyz_angstrom"]) / angstrom_per_bohr
            total += a["atomic_number"] * b["atomic_number"] / r
    return total


def compare(pyscf: float, psi4: float, tolerance: float = TOLERANCE_HARTREE) -> dict:
    difference = psi4 - pyscf
    return {
        "pyscf_hartree": pyscf,
        "psi4_hartree": psi4,
        "difference_hartree": difference,
        "tolerance_hartree": tolerance,
        "verdict": "AGREES" if abs(difference) <= tolerance else "DISCREPANCY",
    }


def build_documents(case: ExecutionCase, replica) -> dict:
    """The PySCF and Psi4 calculation inputs for the SAME imported structure version."""
    from chemdft_api.contracts.scientific import CalculationSpecification
    from chemdft_api.scientific.engines.normalization import normalized_calculation_input
    from chemdft_api.scientific.engines.registry import authoritative_basis, authoritative_method
    from chemdft_api.scientific_models import StructureVersionRecord

    class Source:
        file, media_type, format = case.filename, case.media_type, case.format
        structure_name = case.structure_name

        @staticmethod
        def data():
            return case.data()

    project = replica.new_project(Source)
    with replica.sessions() as session:
        version = session.get(StructureVersionRecord, project.version_id)
        documents = {}
        for engine in ("pyscf", "psi4"):
            specification = CalculationSpecification.model_validate(
                {
                    "task_type": "ENERGY",
                    "method": {"identifier": "hf", **authoritative_method("hf")},
                    "basis": {"identifier": "sto-3g", **authoritative_basis("sto-3g")},
                    "charge": 0,
                    "multiplicity": 1,
                    "engine_preference": {"engine": engine},
                    # Psi4's accepted route requires its restricted reference named explicitly; the
                    # PySCF runs used their defaults (scf None), which is also RHF for these cases.
                    **({"scf": {"reference": "rhf"}} if engine == "psi4" else {}),
                }
            )
            document, _payload, sha = normalized_calculation_input(
                version, specification, max_atoms=100, xyz_calculation_declaration=False
            )
            documents[engine] = {"document": document, "sha256": sha}
    return documents


def plan(replica) -> dict:
    """Everything an approval binds: cases, inputs, engine identity, limits, tolerance."""
    from chemdft_api.scientific.engines import psi4

    identity = psi4.environment_identity(PSI4_EXECUTABLE)  # hashes the sealed prefix; runs nothing
    cases = []
    for case in EXECUTION_CASES:
        documents = build_documents(case, replica)
        py, ps = documents["pyscf"]["document"], documents["psi4"]["document"]
        identical = py["atoms"] == ps["atoms"]
        cases.append(
            {
                "case": case.id,
                "structure_sha256": case.recorded_sha256,
                "geometry_basis": case.geometry_basis,
                "atoms": py["atoms"],
                "atoms_identical_for_both_engines": identical,
                "psi4_native_input_sha256": hashlib.sha256(canonical(ps["psi4_input"])).hexdigest(),
                "charge": ps["charge"],
                "multiplicity": ps["multiplicity"],
                "method": ps["method"],
                "basis": ps["basis"],
                "scf_policy": ps["psi4_input"]["specification"]["keywords"],
                "pyscf_reference": pyscf_reference(case.id),
                "nuclear_repulsion_analytic_hartree": {
                    "codata2010": nuclear_repulsion(py["atoms"], BOHR_CODATA_2010),
                    "codata2014": nuclear_repulsion(py["atoms"], BOHR_CODATA_2014),
                },
                "_document": ps,
            }
        )
    body = {
        "engine": identity,
        "limits": LIMITS,
        "tolerance_hartree": TOLERANCE_HARTREE,
        "cases": [{k: v for k, v in c.items() if k != "_document"} for c in cases],
    }
    sha = hashlib.sha256(canonical(body)).hexdigest()
    return {
        "plan": body,
        "plan_sha256": sha,
        "documents": {c["case"]: c["_document"] for c in cases},
    }


def arming_error(plan_sha256: str, environ) -> str | None:
    if environ.get("CHEMDFT_E2E_OFFLINE") == "1":
        return "REFUSED_OFFLINE_ENVIRONMENT"
    if environ.get(ARM_ENV) != f"EXECUTE-{plan_sha256[:16]}":
        return "REFUSED_NOT_ARMED"
    return None


def execute(built: dict, output: Path) -> dict:
    from chemdft_api.config import Settings
    from chemdft_api.scientific.engines import psi4

    settings = Settings(
        _env_file=None,
        psi4_executable=PSI4_EXECUTABLE,
        scientific_execution_timeout_seconds=LIMITS["wall_seconds_per_case"],
        scientific_threads=LIMITS["threads"],
    )
    output.mkdir(parents=True, exist_ok=False)
    rows = []
    for entry in built["plan"]["cases"]:
        case_id = entry["case"]
        workdir = output / case_id
        result = psi4.execute_native(
            built["documents"][case_id],
            PSI4_EXECUTABLE,
            settings,
            calculation_id=str(uuid4()),
            execution_id=str(uuid4()),
            attempt_number=1,
            workdir=workdir,
        )
        row = {
            "case": case_id,
            "exit_code": result.exit_code,
            "timed_out": result.timed_out,
            "artifacts": {
                name: hashlib.sha256(data).hexdigest()
                for name, data in sorted(result.native_artifacts.items())
            },
        }
        document = result.result_document
        if document is None:
            row["verdict"] = "NO_VALIDATED_RESULT"
            row["failure"] = (result.native_artifacts.get("validation-error.txt") or b"").decode()
        else:
            row["psi4_scf_iterations"] = document["scf_iterations"]
            row["psi4_returned_geometry_sha256"] = document["returned_geometry_sha256"]
            row.update(
                compare(
                    entry["pyscf_reference"]["energy_hartree"], document["total_energy_hartree"]
                )
            )
        rows.append(row)
    report = {
        "report_kind": "PSI4_CROSSCHECK",
        "plan_sha256": built["plan_sha256"],
        "independent_code": "psi4 1.11 (sealed prefix verified)",
        "cases": rows,
        "all_agree": all(r.get("verdict") == "AGREES" for r in rows),
    }
    (output / "report.json").write_text(json.dumps(report, indent=1) + "\n")
    return report


def main(argv=None, environ=os.environ) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    sys.path.insert(0, str(ROOT / "tools"))
    from nvidia_probe.replica import Replica

    replica = Replica.build()
    try:
        built = plan(replica)
        summary = {
            "mode": "PSI4_CROSSCHECK_EXECUTE" if args.execute else "PSI4_CROSSCHECK_PREPARE_ONLY",
            "plan_sha256": built["plan_sha256"],
            **built["plan"],
        }
        if not all(c["atoms_identical_for_both_engines"] for c in built["plan"]["cases"]):
            print("REFUSED: the two engines would not receive identical normalized atoms")
            return 2
        if not args.execute:
            print(json.dumps(summary, indent=1))
            return 0
        refusal = arming_error(built["plan_sha256"], environ)
        if refusal:
            print(refusal)
            return 2
        output = args.output or ROOT / ".chemdft/audits/ai8-psi4-crosscheck-20261018/run1"
        report = execute(built, output)
        print(json.dumps({k: report[k] for k in ("plan_sha256", "all_agree")}))
        return 0
    finally:
        replica.close()


if __name__ == "__main__":
    sys.exit(main())
