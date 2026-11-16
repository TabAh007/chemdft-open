# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Native xTB 6.7.1 ANCopt execution and evidence parsing (no scientific surrogates)."""

from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import re
import subprocess
from pathlib import Path

VERSION = "6.7.1"
ADAPTER_VERSION = "1.0.0"
NATIVE_FILES = (
    "input.xyz",
    "xcontrol.inp",
    "invocation.json",
    "execution.json",
    "stdout.txt",
    "stderr.txt",
    "xtbopt.xyz",
    "xtbopt.log",
    "xtbout.json",
    ".xtboptok",
    "NOT_CONVERGED",
)
NUMBER = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?"


def number(value: str) -> float:
    result = float(value.replace("D", "E").replace("d", "e"))
    if not math.isfinite(result):
        raise ValueError("Non-finite native optimization value")
    return result


def validate_optimization_geometry(atoms: list[dict]) -> None:
    """Reject absent/coincident nuclei; single atoms remain legitimate inputs."""
    if not atoms:
        raise ValueError("Optimization requires at least one atom")
    for index, atom in enumerate(atoms):
        point = atom["xyz_angstrom"]
        if len(point) != 3 or not all(math.isfinite(value) for value in point):
            raise ValueError("Optimization coordinates must be finite triples")
        for other in atoms[:index]:
            if math.dist(point, other["xyz_angstrom"]) < 1e-8:
                raise ValueError("Optimization input contains coincident nuclei")


def validate_input(document: dict) -> None:
    if document.get("task") != "GEOMETRY_OPTIMIZATION" or document.get("method") != "gfn2":
        raise ValueError("Native optimization requires GFN2 GEOMETRY_OPTIMIZATION")
    if document.get("basis") is not None or document.get("coordinate_unit") != "angstrom":
        raise ValueError(
            "Native optimization requires Cartesian angstrom input and no Gaussian basis"
        )
    atoms = document.get("atoms", [])
    validate_optimization_geometry(atoms)
    for index, atom in enumerate(atoms):
        if atom.get("index") != index or not re.fullmatch(r"[A-Z][a-z]?", atom["element"]):
            raise ValueError("Native atom ordering or identity is invalid")
        if len(atom["xyz_angstrom"]) != 3 or not all(
            math.isfinite(x) for x in atom["xyz_angstrom"]
        ):
            raise ValueError("Native coordinates must be finite triples")
    charge, multiplicity = document["charge"], document["multiplicity"]
    electrons = sum(atom["atomic_number"] for atom in atoms) - charge
    if not isinstance(charge, int) or not isinstance(multiplicity, int) or multiplicity < 1:
        raise ValueError("Invalid charge or multiplicity")
    if electrons <= 0 or multiplicity - 1 > electrons or (electrons - multiplicity + 1) % 2:
        raise ValueError("Impossible charge/spin parity")
    options = document["optimization"]
    if options["optimizer"] != "xtb-ancopt" or options.get("xtb_level") != "normal":
        raise ValueError("Only verified native ANCopt normal settings are supported")
    if not isinstance(options["max_steps"], int) or not 1 <= options["max_steps"] <= 500:
        raise ValueError("Invalid maximum optimization cycles")


def frames(raw: bytes, atoms: list[dict]) -> list[dict]:
    lines = raw.decode("utf-8", errors="strict").splitlines()
    result = []
    offset = 0
    while offset < len(lines):
        if not lines[offset].strip() and offset == len(lines) - 1:
            break
        if lines[offset].strip() != str(len(atoms)) or offset + len(atoms) + 2 > len(lines):
            raise ValueError("Missing, truncated or changed native XYZ atom count")
        header = lines[offset + 1]
        match = re.fullmatch(
            rf"\s*energy:\s*({NUMBER})\s+gnorm:\s*({NUMBER})\s+xtb:\s*(\S+)\s+\([^)]+\)\s*", header
        )
        if not match or match[3] != VERSION:
            raise ValueError("Malformed native XYZ energy/gradient/version header")
        coordinates = []
        for atom, line in zip(atoms, lines[offset + 2 : offset + 2 + len(atoms)], strict=True):
            fields = line.split()
            if len(fields) != 4 or fields[0] != atom["element"]:
                raise ValueError("Native output changed atom identity or ordering")
            coordinates.append([number(x) for x in fields[1:]])
        gradient = number(match[2])
        if gradient < 0:
            raise ValueError("Negative native gradient norm")
        result.append(
            {
                "coordinates_angstrom": coordinates,
                "energy_hartree": number(match[1]),
                "gradient_norm_hartree_per_bohr": gradient,
            }
        )
        offset += len(atoms) + 2
    if not result:
        raise ValueError("Native output contains no geometry evaluations")
    return result


def parse_evidence(raw: dict[str, bytes], document: dict, exit_code: int) -> dict:
    """Reparse immutable native bytes at both worker and server validation boundaries."""
    validate_input(document)
    required = (
        "input.xyz",
        "xcontrol.inp",
        "invocation.json",
        "execution.json",
        "stdout.txt",
        "stderr.txt",
        "xtbopt.xyz",
        "xtbopt.log",
        "xtbout.json",
    )
    if any(name not in raw for name in required):
        raise ValueError("Required native optimization output is missing")
    execution = json.loads(raw["execution.json"])
    if (
        execution.get("schema") != "chemdft.xtb.execution"
        or type(execution.get("exit_code")) is not int
        or execution["exit_code"] != exit_code
    ):
        raise ValueError("Native execution or SCC failed: exit-code evidence does not match")
    invocation = json.loads(raw["invocation.json"])
    args = [
        "input.xyz",
        "--gfn",
        "2",
        "--opt",
        "normal",
        "--chrg",
        str(document["charge"]),
        "--uhf",
        str(document["multiplicity"] - 1),
        "--input",
        "xcontrol.inp",
        "--json",
        "--norestart",
    ]
    if invocation.get("argv", [])[1:] != args or not re.fullmatch(
        r"[a-f0-9]{64}", invocation.get("executable_sha256", "")
    ):
        raise ValueError("Native invocation differs from authorized settings")
    if (
        document.get("engine_executable_sha256", invocation["executable_sha256"])
        != invocation["executable_sha256"]
    ):
        raise ValueError("Executed xTB binary differs from authorized engine digest")
    expected_control = (
        f"$opt\n engine=rf\n maxcycle={document['optimization']['max_steps']}\n$end\n"
    )
    if raw["xcontrol.inp"].decode() != expected_control or raw["input.xyz"] != input_xyz(document):
        raise ValueError("Native input differs from immutable calculation input")
    stdout = raw["stdout.txt"].decode("utf-8", errors="strict")
    stderr = raw["stderr.txt"].decode("utf-8", errors="strict")
    banner = re.search(r"\*\s+xtb version\s+(\S+)\s+\(([^)]+)\)", stdout)
    if not banner or banner[1] != VERSION or document.get("engine_version", VERSION) != VERSION:
        raise ValueError("Native xTB engine identity does not match pinned 6.7.1")
    success = re.findall(
        r"\*\*\* GEOMETRY OPTIMIZATION CONVERGED AFTER (\d+) ITERATIONS \*\*\*", stdout
    )
    failure = re.findall(
        r"\*\*\* FAILED TO CONVERGE GEOMETRY OPTIMIZATION IN (\d+) ITERATIONS \*\*\*", stdout
    )
    if len(success) + len(failure) != 1 or (success and "NOT_CONVERGED" in raw):
        raise ValueError("Missing or contradictory geometry convergence evidence")
    if exit_code != 0 or re.search(
        r"SCC (?:NOT|not) CONVERGED|SCC not converged|#ERROR!|abnormal termination", stdout + stderr
    ):
        raise ValueError("Native execution or SCC failed")
    final_section = stdout.split("Final Singlepoint")
    if len(final_section) != 2 or not re.search(
        r"convergence criteria satisfied after\s+\d+\s+iterations", final_section[-1]
    ):
        raise ValueError("Final single-point SCC convergence evidence is missing")
    energy_matches = re.findall(rf"\| TOTAL ENERGY\s+({NUMBER})\s+Eh\s+\|", final_section[-1])
    if len(energy_matches) != 1:
        raise ValueError("Unambiguous final native total energy is missing")
    final = frames(raw["xtbopt.xyz"], document["atoms"])
    history = frames(raw["xtbopt.log"], document["atoms"])
    if len(final) != 1 or abs(final[0]["energy_hartree"] - number(energy_matches[0])) > 1e-11:
        raise ValueError("Inconsistent final native energies")
    summary = json.loads(raw["xtbout.json"])
    if (
        summary.get("method") != "GFN2-xTB"
        or summary.get("xtb version") != f"{VERSION} ({banner[2]})"
        or summary.get("number of unpaired electrons") != document["multiplicity"] - 1
        or abs(number(str(summary["total energy"])) - final[0]["energy_hartree"]) > 6e-9
    ):
        raise ValueError("Native summary differs from final energy, method or spin")
    iterations = int((success or failure)[0])
    if not 1 <= iterations <= document["optimization"]["max_steps"] or len(history) != iterations:
        raise ValueError("Native iteration count differs from recorded optimizer samples")
    steps = []
    for index, sample in enumerate([*history, final[0]]):
        endpoint = index == len(history)
        steps.append(
            {
                **sample,
                "index": index,
                "engine_cycle": None if endpoint else index + 1,
                "timestamp": None,
                "gradient_rms_hartree_per_bohr": None,
                "evaluation_kind": "FINAL_SINGLE_POINT" if endpoint else "OPTIMIZER",
                "source_file": "xtbopt.xyz" if endpoint else "xtbopt.log",
                "source_frame_index": 0 if endpoint else index,
                "source_sha256": hashlib.sha256(
                    raw["xtbopt.xyz" if endpoint else "xtbopt.log"]
                ).hexdigest(),
            }
        )
    return {
        "schema": "chemdft.worker.optimization",
        "schema_version": "1.0.0",
        "task": "GEOMETRY_OPTIMIZATION",
        "engine": "xtb",
        "engine_version": VERSION,
        "optimizer": "xtb-ancopt",
        "optimizer_version": VERSION,
        "adapter_version": ADAPTER_VERSION,
        "method": "gfn2",
        "basis": None,
        "charge": document["charge"],
        "multiplicity": document["multiplicity"],
        "converged": bool(success),
        "optimization_iterations": iterations,
        "steps": steps,
        "final_coordinates_angstrom": final[0]["coordinates_angstrom"],
        "evidence_sha256": {
            name: hashlib.sha256(value).hexdigest() for name, value in sorted(raw.items())
        },
        "geometry_convergence_message": (
            success and f"GEOMETRY OPTIMIZATION CONVERGED AFTER {iterations} ITERATIONS"
        )
        or f"FAILED TO CONVERGE GEOMETRY OPTIMIZATION IN {iterations} ITERATIONS",
        "environment": invocation["environment"],
    }


def input_xyz(document: dict) -> bytes:
    rows = [str(len(document["atoms"])), "Immutable ChemDFT optimization input"]
    rows += [
        atom["element"] + " " + " ".join(format(x, ".17g") for x in atom["xyz_angstrom"])
        for atom in document["atoms"]
    ]
    return ("\n".join(rows) + "\n").encode()


def execute_native(
    document: dict, executable: Path, directory: Path
) -> tuple[dict, dict[str, bytes]]:
    validate_input(document)
    executable = executable.resolve(strict=True)
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "input.xyz").write_bytes(input_xyz(document))
    (directory / "xcontrol.inp").write_text(
        f"$opt\n engine=rf\n maxcycle={document['optimization']['max_steps']}\n$end\n"
    )
    argv = [
        str(executable),
        "input.xyz",
        "--gfn",
        "2",
        "--opt",
        "normal",
        "--chrg",
        str(document["charge"]),
        "--uhf",
        str(document["multiplicity"] - 1),
        "--input",
        "xcontrol.inp",
        "--json",
        "--norestart",
    ]
    env = {
        "PATH": os.defpath,
        "OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1"),
        "MKL_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1"),
        "OPENBLAS_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1"),
        "OMP_STACKSIZE": "1G",
    }
    environment = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "architecture": platform.machine(),
        "libraries": {"xtb": VERSION},
        "thread_settings": {"OMP_NUM_THREADS": env["OMP_NUM_THREADS"]},
        "build": {"executable_sha256": hashlib.sha256(executable.read_bytes()).hexdigest()},
        "optimizer": "xtb-ancopt",
        "optimizer_level": "normal",
    }
    (directory / "invocation.json").write_text(
        json.dumps(
            {
                "argv": argv,
                "executable_sha256": environment["build"]["executable_sha256"],
                "environment": environment,
            },
            sort_keys=True,
        )
    )
    with (directory / "stdout.txt").open("wb") as out, (directory / "stderr.txt").open("wb") as err:
        completed = subprocess.run(
            argv, cwd=directory, env=env, stdout=out, stderr=err, check=False
        )
    (directory / "execution.json").write_text(
        json.dumps({"schema": "chemdft.xtb.execution", "exit_code": completed.returncode})
    )
    raw = {
        name: (directory / name).read_bytes()
        for name in NATIVE_FILES
        if (directory / name).is_file()
    }
    return parse_evidence(raw, document, completed.returncode), raw
