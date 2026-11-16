"""Offline preflight for the first real PySCF cases (AI-7). It never runs a calculation.

Static checks read only recorded bytes and the repository's own capability tables. The optional
worker check runs the existing capability probe, which imports the pinned PySCF in the isolated
worker interpreter and prints its version; nothing is computed. Each check is PASS, FAIL or
NOT RUN; a FAIL blocks the case.

    PYTHONPATH=services/api/src:tools .venv/bin/python -m scientific_execution.preflight \
        [--case A-h2-hf-sto3g] [--worker] [--json]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from collections import Counter
from math import dist

from .cases import (
    BASIS,
    ENGINE,
    EXECUTION_CASES,
    EXPECTED_ENGINE_VERSION,
    METHOD,
    ExecutionCase,
    execution_case,
)

# STO-3G contracted functions per element for the elements these cases use (H, C, O).
STO3G_FUNCTIONS = {"H": 1, "C": 5, "O": 5}
ATOMIC_NUMBER = {"H": 1, "C": 6, "O": 8}
# Budget the local worker will be held to (config.py defaults); the estimate below is far inside it.
ERI_BYTES_PER_ELEMENT = 8


def _check(name: str, ok: bool | None, detail: str) -> dict:
    return {
        "check": name,
        "status": "NOT RUN" if ok is None else "PASS" if ok else "FAIL",
        "detail": detail,
    }


def _parse(case: ExecutionCase):
    from chemdft_api.scientific.adapters.molecular.rdkit_adapter import parse_sdf, parse_xyz

    return (parse_xyz if case.format == "XYZ" else parse_sdf)(case.data())


def formula_of(elements) -> str:
    counts = Counter(elements)
    order = ["C", "H", *sorted(e for e in counts if e not in ("C", "H"))]
    if "C" not in counts:
        order = sorted(counts)
    return "".join(f"{e}{'' if counts[e] == 1 else counts[e]}" for e in order if e in counts)


def estimate(elements) -> dict:
    """A dependency-free size estimate for restricted HF/STO-3G (H, C, O only)."""
    nbf = sum(STO3G_FUNCTIONS[e] for e in elements)
    return {
        "basis_functions": nbf,
        "electrons": sum(ATOMIC_NUMBER[e] for e in elements),
        "in_core_eri_bytes": nbf**4 * ERI_BYTES_PER_ELEMENT,
    }


def preflight(case: ExecutionCase, settings=None, *, worker: bool = False) -> dict:
    from chemdft_api.config import Settings
    from chemdft_api.scientific.engines.registry import (
        CAPABILITIES,
        _probe_python,
        configured_path,
        validate_pyscf_elements,
    )

    settings = settings or Settings(_env_file=None)
    checks: list[dict] = []
    add = checks.append
    try:
        case.data()
        add(_check("input bytes match the recorded sha256", True, case.recorded_sha256))
    except (ValueError, OSError) as error:
        add(_check("input bytes match the recorded sha256", False, str(error)))
        return _report(case, checks, None)
    parsed = _parse(case)
    positions = [(a["element"], a["x"], a["y"], a["z"]) for a in parsed.atoms]
    elements = [row[0] for row in positions]
    add(
        _check(
            "geometry complete",
            len(positions) > 0 and all(len(r) == 4 for r in positions),
            f"{len(positions)} atoms, formula {formula_of(elements)}",
        )
    )
    add(
        _check(
            "charge and multiplicity declared by the source",
            (parsed.overall_charge, parsed.multiplicity) == (0, 1),
            f"charge {parsed.overall_charge}, multiplicity {parsed.multiplicity}",
        )
    )
    unsupported = sorted(set(elements) - set(ATOMIC_NUMBER))
    if unsupported:
        add(_check("elements supported by the estimate", False, ", ".join(unsupported)))
        return _report(case, checks, None)
    sizes = estimate(elements)
    unpaired = (sizes["electrons"] - parsed.overall_charge) % 2
    add(
        _check(
            "electron count fits the singlet",
            unpaired == 0 and parsed.multiplicity == 1,
            f"{sizes['electrons']} electrons, charge {parsed.overall_charge}, "
            f"multiplicity {parsed.multiplicity}",
        )
    )
    nearest = min(dist(a[1:], b[1:]) for i, a in enumerate(positions) for b in positions[i + 1 :])
    add(_check("no overlapping atoms", nearest > 0.3, f"closest pair {nearest:.4f} Angstrom"))
    capability = CAPABILITIES[ENGINE]
    add(
        _check(
            "engine, task, method and basis are supported",
            "ENERGY" in {t.value for t in capability.tasks}
            and METHOD in capability.methods
            and BASIS in capability.basis_sets,
            f"{ENGINE} ENERGY {METHOD}/{BASIS}",
        )
    )
    try:
        validate_pyscf_elements(BASIS, [ATOMIC_NUMBER[e] for e in elements])
        add(
            _check(
                "elements fit the basis without an ECP",
                True,
                f"{BASIS}, elements {sorted(set(elements))}",
            )
        )
    except Exception as error:  # the registry's own refusal
        add(_check("elements fit the basis without an ECP", False, str(error)))
    add(
        _check(
            "atom count within the execution limit",
            len(positions) <= settings.scientific_max_atoms,
            f"{len(positions)} of {settings.scientific_max_atoms}",
        )
    )
    memory = sizes["in_core_eri_bytes"]
    add(
        _check(
            "estimated memory within the local limit",
            memory * 4 < settings.compute_local_memory_bytes,
            f"in-core integrals ~{memory / 1024:.0f} KiB of "
            f"{settings.compute_local_memory_bytes // 2**20} MiB",
        )
    )
    free = shutil.disk_usage(os.getcwd()).free
    add(
        _check(
            "local disk has room for the scratch budget",
            free > 4 * settings.compute_local_temporary_storage_bytes,
            f"{free / 2**30:.1f} GiB free, scratch budget "
            f"{settings.compute_local_temporary_storage_bytes // 2**20} MiB",
        )
    )
    add(
        _check(
            "threads within the CPU count",
            settings.scientific_threads <= (os.cpu_count() or 1),
            f"{settings.scientific_threads} thread(s) of {os.cpu_count()} cores; "
            f"timeout {settings.scientific_execution_timeout_seconds} s",
        )
    )
    if worker:
        state, version, diagnostic = _probe_python(
            configured_path(settings.scientific_worker_python)
        )
        add(
            _check(
                "worker is AVAILABLE and pinned to the expected PySCF",
                state == "AVAILABLE" and version == EXPECTED_ENGINE_VERSION,
                f"{state}, PySCF {version}" + (f" ({diagnostic})" if diagnostic else ""),
            )
        )
    else:
        add(
            _check(
                "worker is AVAILABLE and pinned to the expected PySCF",
                None,
                "not probed (pass --worker)",
            )
        )
    return _report(case, checks, sizes)


def _report(case: ExecutionCase, checks: list[dict], sizes: dict | None) -> dict:
    failed = [c["check"] for c in checks if c["status"] == "FAIL"]
    return {
        "case": case.id,
        "label": case.label,
        "calculation": f"{ENGINE} ENERGY {METHOD}/{BASIS} charge 0 multiplicity 1",
        "geometry_basis": case.geometry_basis,
        "request": case.prompt,
        "estimate": sizes,
        "checks": checks,
        "executed": False,
        "verdict": "BLOCKED" if failed else "READY (not executed)",
        "failed": failed,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--case", choices=[c.id for c in EXECUTION_CASES])
    parser.add_argument(
        "--worker", action="store_true", help="probe the worker (imports PySCF, computes nothing)"
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    cases = [execution_case(args.case)] if args.case else list(EXECUTION_CASES)
    reports = [preflight(c, worker=args.worker) for c in cases]
    if args.json:
        print(json.dumps(reports, indent=2))
    else:
        for report in reports:
            print(f"{report['label']}: {report['verdict']}")
            for row in report["checks"]:
                print(f"  {row['status']:7} {row['check']}: {row['detail']}")
    return 0 if all(not r["failed"] for r in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
