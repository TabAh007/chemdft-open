# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Pinned DFT-D4 4.2.0 CLI with explicit coefficients and retained native evidence."""

from __future__ import annotations

import contextlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import tomllib
from pathlib import Path

from ...contracts.dftd4 import Dftd4Parameters
from .interfaces import ExecutionResult
from .psi4 import _terminate, digest, encode
from .shutdown import shutdown_signal

NATIVE_ANGSTROM_TO_BOHR = 1.8897261246204404
VERSION = "4.2.0"
ADAPTER_VERSION = "1.0.0"
MAX_FILE = 2 * 1024 * 1024
MAX_DIRECTORY = 16 * 1024 * 1024
MAX_WALL = 60
MEMORY_BYTES = 512 * 1024 * 1024
PIN = {
    "bin/dftd4": "a8e38977f52ef41e80855508bd97426515489dd3b0e8abf752f0f8d514b1d3d9",
    "lib/libdftd4.4.dylib": "3a1e77bdc130d08998a9b09b01f09360bde6f52c7b0c2587ad0a54f509703187",
    "share/dftd4/parameters.toml": (
        "8254bfc673e763f7589b9be20506438b202a59ce795dc175d6ea9ba623e23e1f"
    ),
}
# Linux x86_64 (conda-forge linux-64 build of the same 4.2.0 sources; same table, same CLI).
# Pins were computed from the locked packages in infra/aws/ec2-pilot/d4-conda.lock, not yet from a
# built prefix: IMPLEMENTED_UNVERIFIED until a Linux image is built and compared.
LINUX_PLATFORM = "linux-x86_64"
LINUX_PIN = {
    "bin/dftd4": "b8fabf861d020ada45856c8bd70bf2bf4217628f89d54655ba72855737debf83",
    "lib/libdftd4.so.4.2.0": "5eaf8f6a243643fba2a9cb32ab18348ece9c23913a73a6f5cc15d3534f643e5f",
    "share/dftd4/parameters.toml": PIN["share/dftd4/parameters.toml"],
}
LINUX_PACKAGE = "conda-forge/linux-64::dftd4-4.2.0-gfortran_ha02e54d_1"
LINUX_PACKAGE_SHA256 = "7b0b80990e179206beb5fab16ddc5f36327a5d0d1875ad152e6e65ed2bd277cc"
RUNTIME_LIBRARIES = json.loads(Path(__file__).with_name("dftd4_runtime.json").read_text())
LINUX_RUNTIME_LIBRARIES = json.loads(
    Path(__file__).with_name("dftd4_runtime_linux.json").read_text()
)
TABLE_SHA256 = PIN["share/dftd4/parameters.toml"]
PARAMETERS = {
    "b3lyp": Dftd4Parameters(s6=1, s8=2.02929367, s9=1, a1=0.40868035, a2=4.53807137, alp=16),
    "pbe": Dftd4Parameters(s6=1, s8=0.95948085, s9=1, a1=0.38574991, a2=4.80688534, alp=16),
}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def variant_identity(functional, parameters):
    p = Dftd4Parameters.model_validate(parameters).model_dump(mode="json")
    # Identity follows scientific coefficients/model, not request keys, labels or packaging.
    return digest(
        encode(
            {
                "definition": "chemdft.d4-variant.v1",
                "functional": functional.lower(),
                "model": "d4",
                "damping": "rational-bj",
                "charge_model": "eeq",
                "three_body_model": "approx-atm",
                "parameters": p,
            }
        )
    )


def environment_identity(executable):
    executable = Path(executable).resolve(strict=True)
    prefix = executable.parent.parent
    linux = sys.platform.startswith("linux")
    pin = LINUX_PIN if linux else PIN
    libraries = LINUX_RUNTIME_LIBRARIES if linux else RUNTIME_LIBRARIES
    marker = ".so" if linux else ".dylib"
    for relative, sha in pin.items():
        require(
            digest((prefix / relative).read_bytes()) == sha,
            "D4 pinned executable/library/table differs: " + relative,
        )
    actual_libraries = {"lib/" + p.name for p in (prefix / "lib").iterdir() if marker in p.name}
    require(actual_libraries == set(libraries), "D4 dynamic library inventory differs")
    for relative, item in libraries.items():
        path = prefix / relative
        if "symlink" in item:
            require(
                path.is_symlink()
                and os.readlink(path) == item["symlink"]
                and path.resolve().is_relative_to(prefix),
                "D4 runtime symlink differs",
            )
        else:
            require(
                not path.is_symlink() and digest(path.read_bytes()) == item["sha256"],
                "D4 runtime library differs: " + relative,
            )
    table = tomllib.loads((prefix / "share/dftd4/parameters.toml").read_text())
    defaults = table["default"]["parameter"]["d4"]["bj-eeq-atm"]
    for functional, expected in PARAMETERS.items():
        values = defaults | table["parameter"][functional]["d4"]["bj-eeq-atm"]
        require(
            all(values[k] == getattr(expected, k) for k in ("s6", "s8", "s9", "a1", "a2", "alp")),
            "D4 exact parameter table differs",
        )
    if linux:
        return {
            "engine": "dftd4",
            "version": VERSION,
            "adapter_version": ADAPTER_VERSION,
            "platform": LINUX_PLATFORM,
            "prefix": str(prefix),
            "files": LINUX_PIN,
            "runtime_libraries": LINUX_RUNTIME_LIBRARIES,
            "package": LINUX_PACKAGE,
            "package_sha256": LINUX_PACKAGE_SHA256,
        }
    return {
        "engine": "dftd4",
        "version": VERSION,
        "adapter_version": ADAPTER_VERSION,
        "prefix": str(prefix),
        "files": PIN,
        "runtime_libraries": RUNTIME_LIBRARIES,
        "package": "conda-forge/osx-arm64::dftd4-4.2.0-gfortran_hc17bbfb_1",
        "package_sha256": "9414dabc05fa842a77edf9bc0233eaf26df701b421968d13dbf0619e0e7b147c",
    }


def validate_input(document):
    from ...contracts.dftd4 import DispersionCorrectionSpecification

    spec = DispersionCorrectionSpecification.model_validate(document["specification"])
    require(
        document["engine"] == "dftd4" and document["schema"] == "chemdft.dftd4.input.v1",
        "D4 input type differs",
    )
    require(
        spec.source.functional in PARAMETERS
        and spec.parameters == PARAMETERS[spec.source.functional],
        "D4 coefficients differ",
    )
    require(
        spec.variant_sha256 == variant_identity(spec.source.functional, spec.parameters),
        "D4 variant identity differs",
    )
    require(
        spec.parameter_table_sha256 == TABLE_SHA256 and spec.variant == "d4.bj-eeq-atm",
        "D4 table/variant differs",
    )
    require(spec.basis is not None and spec.dispersion is not None, "D4 method definitions missing")
    require(
        spec.charge == 0
        and spec.multiplicity == 1
        and spec.task_type == "ENERGY"
        and spec.engine_preference.engine == "dftd4"
        and spec.engine_preference.allowed_version == VERSION
        and spec.method.identifier == spec.source.functional
        and spec.basis.identifier == "def2-svp"
        and spec.dispersion.identifier == "d4"
        and spec.solvation is None
        and not spec.constraints
        and not spec.engine_extensions
        and not spec.property_requests
        and all(
            getattr(spec, k) is None
            for k in (
                "scf",
                "optimization",
                "conformer_search",
                "hessian",
                "tddft",
                "raman",
                "thermochemistry",
            )
        ),
        "D4 scope/settings differ",
    )
    require(
        document["structure_version_id"] == str(spec.source.structure_version_id),
        "D4 structure reference differs",
    )
    atoms = document["atoms"]
    require(
        0 < len(atoms) <= 128
        and all(
            a["element"] in ("H", "C", "O")
            and len(a["xyz_angstrom"]) == 3
            and all(type(x) in (float, int) and math.isfinite(x) for x in a["xyz_angstrom"])
            for a in atoms
        ),
        "D4 geometry outside scope",
    )
    require(
        digest(encode(atoms)) == spec.source.geometry_sha256,
        "D4 atom order/coordinate hash differs",
    )
    return spec


def xyz_bytes(document):
    validate_input(document)
    # .17g round-trips every stored float. The CLI XYZ reader converts Å to bohr.
    return (
        str(len(document["atoms"]))
        + "\nChemDFT D4; angstrom; charge=0\n"
        + "\n".join(
            a["element"] + " " + " ".join(format(x, ".17g") for x in a["xyz_angstrom"])
            for a in document["atoms"]
        )
        + "\n"
    ).encode()


def command(executable, functional, parameters):
    p = Dftd4Parameters.model_validate(parameters)
    return [
        str(executable),
        "--func",
        functional,
        "--param",
        *(format(getattr(p, k), ".17g") for k in ("s6", "s8", "a1", "a2")),
        "--model",
        "D4",
        "--qmodel",
        "EEQ",
        "--mbdscale",
        "1",
        "--charge",
        "0",
        "--zeta",
        "3",
        "2",
        "--wfactor",
        "6",
        "--json",
        "dftd4.json",
        "--noedisp",
        "input.xyz",
    ]


def native_environment(executable, root):
    return {
        "PATH": str(Path(executable).parent) + ":/usr/bin:/bin",
        "HOME": str(root),
        "TMPDIR": str(root),
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "LC_ALL": "C",
    }


def parse_evidence(raw, document):
    spec = validate_input(document)
    required = {
        "input.xyz",
        "invocation.json",
        "execution.json",
        "stdout.txt",
        "stderr.txt",
        "dftd4.json",
        "parameters.toml",
        "hashes.json",
    }
    require(
        set(raw) == required
        and all(isinstance(b, bytes) and len(b) <= MAX_FILE for b in raw.values()),
        "Incomplete D4 native evidence",
    )
    require(
        json.loads(raw["hashes.json"])
        == {n: digest(b) for n, b in raw.items() if n != "hashes.json"},
        "D4 evidence hashes differ",
    )
    require(digest(raw["parameters.toml"]) == TABLE_SHA256, "D4 retained parameter table differs")
    inv, status, output = (
        json.loads(raw[n]) for n in ("invocation.json", "execution.json", "dftd4.json")
    )
    require(
        raw["input.xyz"] == xyz_bytes(document)
        and inv["normalized_input_sha256"] == digest(encode(document)),
        "D4 native input differs",
    )
    require(
        inv["argv"]
        == command(
            Path(inv["runtime_identity"]["prefix"]) / "bin/dftd4",
            spec.source.functional,
            spec.parameters,
        ),
        "D4 invocation differs",
    )
    # Evidence from a Linux prefix is checked against the Linux pins; anything else against macOS.
    linux_evidence = inv["runtime_identity"].get("platform") == LINUX_PLATFORM
    require(
        inv["runtime_identity"]["files"] == (LINUX_PIN if linux_evidence else PIN)
        and inv["runtime_identity"]["version"] == VERSION
        and inv["exact_parameters"] == spec.parameters.model_dump(mode="json")
        and inv["parameter_table_sha256"] == TABLE_SHA256,
        "D4 exact parameter/runtime provenance differs",
    )
    require(
        inv["environment"] == native_environment(inv["argv"][0], inv["cwd"])
        and Path(inv["cwd"]).is_absolute()
        and 0 < inv["wall_seconds"] <= MAX_WALL
        and 0 < inv["directory_limit_bytes"] <= MAX_DIRECTORY,
        "D4 resource/environment policy differs",
    )
    require(
        status["exit_code"] == 0
        and status["termination_reason"] is None
        and status["evidence_complete"] is True
        and status["process_group_cleanup"] is True
        and status["files"] == ["dftd4.json", "input.xyz", "stderr.txt", "stdout.txt"],
        "D4 failed/interrupted/extra native files",
    )
    require(
        output.get("version") == VERSION
        and type(output.get("energy")) in (float, int)
        and math.isfinite(output["energy"]),
        "D4 native energy/version invalid",
    )
    stdout = raw["stdout.txt"].decode("utf-8", errors="strict")
    require(
        re.search(
            r"^Rational \(Becke-Johnson\) damping: "
            + re.escape(spec.source.functional)
            + r"-D4-ATM\s*$",
            stdout,
            re.M,
        )
        is not None,
        "D4 functional/damping/ATM output differs",
    )
    for key in ("s6", "s8", "s9", "a1", "a2", "alp"):
        match = re.search(r"^\s*" + key + r"\s+([-+0-9.Ee]+)\s*$", stdout, re.M)
        require(
            match and float(match[1]) == float(format(getattr(spec.parameters, key), ".4f")),
            "D4 rounded stdout consistency differs: " + key,
        )
    energy = re.search(r"Dispersion energy:\s*([-+0-9.Ee]+)\s+Eh", stdout)
    require(
        energy and math.isclose(float(energy[1]), output["energy"], rel_tol=0, abs_tol=1e-13),
        "D4 stdout/JSON energy differs",
    )
    return {"correction_energy_hartree": output["energy"], "environment": inv["runtime_identity"]}


def execute_native(
    document, executable, settings, *, calculation_id, execution_id, attempt_number, on_tick=None
):
    spec = validate_input(document)
    identity = environment_identity(executable)
    executable = Path(executable).resolve()
    timeout = min(MAX_WALL, settings.scientific_execution_timeout_seconds)
    budget = min(MAX_DIRECTORY, settings.compute_local_temporary_storage_bytes)
    with tempfile.TemporaryDirectory(prefix="chemdft-dftd4-") as directory:
        root = Path(directory)
        initial = xyz_bytes(document)
        (root / "input.xyz").write_bytes(initial)
        (root / "input.xyz").chmod(0o400)
        inv = {
            "argv": command(executable, spec.source.functional, spec.parameters),
            "cwd": str(root),
            "environment": native_environment(executable, root),
            "calculation_id": calculation_id,
            "execution_id": execution_id,
            "attempt_number": attempt_number,
            "normalized_input_sha256": digest(encode(document)),
            "runtime_identity": identity,
            "exact_parameters": spec.parameters.model_dump(mode="json"),
            "parameter_table_sha256": TABLE_SHA256,
            "wall_seconds": timeout,
            "directory_limit_bytes": budget,
        }
        reason = None
        start = time.monotonic()
        with (root / "stdout.txt").open("wb") as out, (root / "stderr.txt").open("wb") as err:
            proc = subprocess.Popen(
                inv["argv"],
                cwd=root,
                env=inv["environment"],
                stdout=out,
                stderr=err,
                start_new_session=True,
            )
            try:
                while proc.poll() is None:
                    files = list(root.iterdir())
                    if (
                        any(
                            p.is_symlink()
                            or (p.is_file() and p.stat().st_size > MAX_FILE)
                            or p.is_dir()
                            for p in files
                        )
                        or sum(p.stat().st_size for p in files) > budget
                    ):
                        reason = "resource limit or unsafe native file"
                    if time.monotonic() - start >= timeout:
                        reason = "wall timeout"
                    if shutdown_signal() is not None or (on_tick and on_tick() is False):
                        reason = "canceled or lease lost"
                    if reason:
                        break
                    time.sleep(0.05)
            finally:
                _terminate(proc)
        files = sorted(p.name for p in root.iterdir())
        complete = (
            reason is None
            and files == ["dftd4.json", "input.xyz", "stderr.txt", "stdout.txt"]
            and all(
                p.is_file() and not p.is_symlink() and p.stat().st_size <= MAX_FILE
                for p in root.iterdir()
            )
            and sum(p.stat().st_size for p in root.iterdir()) <= budget
            and (root / "input.xyz").read_bytes() == initial
        )
        raw = {
            "input.xyz": initial,
            "parameters.toml": (
                executable.parent.parent / "share/dftd4/parameters.toml"
            ).read_bytes(),
            "invocation.json": encode(inv),
            "execution.json": encode(
                {
                    "exit_code": proc.returncode,
                    "termination_reason": reason,
                    "evidence_complete": complete,
                    "process_group_cleanup": True,
                    "files": files,
                }
            ),
        }
        for name in ("stdout.txt", "stderr.txt", "dftd4.json"):
            p = root / name
            if (
                p.is_file()
                and not p.is_symlink()
                and p.stat().st_size <= min(MAX_FILE, settings.scientific_max_output_bytes)
            ):
                raw[name] = p.read_bytes()
        raw["hashes.json"] = encode({n: digest(b) for n, b in raw.items()})
        candidate = None
        with contextlib.suppress(ValueError, KeyError, TypeError):
            candidate = parse_evidence(raw, document)
        return ExecutionResult(
            proc.returncode,
            reason == "wall timeout",
            raw.get("stdout.txt", b""),
            raw.get("stderr.txt", b""),
            b"",
            candidate,
            raw,
        )
