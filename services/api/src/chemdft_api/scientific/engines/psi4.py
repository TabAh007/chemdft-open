# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Pinned native QCSchema energy adapter; worker flags alone never authorize results."""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

from .crest import _read, _terminate
from .interfaces import ExecutionResult
from .normalization import BOHR_PER_ANGSTROM
from .shutdown import crest_shutdown_scope, shutdown_signal

VERSION = "1.11"
ADAPTER_VERSION = "1.0.0"
MEMORY_BYTES = 1024**3
MAX_FILE = 16 * 1024**2
MAX_DIRECTORY = 512 * 1024**2
MAX_RETAINED = 64 * 1024**2
MAX_WALL = 180
PAIRS = frozenset(
    {
        ("hf", "sto-3g"),
        ("hf", "def2-svp"),
        ("b3lyp", "def2-svp"),
        ("pbe", "def2-svp"),
        ("mp2", "def2-svp"),
    }
)
PIN = json.loads(Path(__file__).with_name("psi4_environment.json").read_text())
BASES = json.loads(Path(__file__).with_name("psi4_basis.json").read_text())
REQUIRED = frozenset(
    {"input.json", "output.json", "invocation.json", "execution.json", "hashes.json"}
)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def environment_identity(executable):
    """Verify the complete sealed installed prefix, including its file/symlink inventory."""
    executable = Path(executable).absolute()
    prefix = executable.parent.parent
    require(executable.name == "psi4" and executable.parent.name == "bin", "Invalid Psi4 CLI path")
    inventory = set()
    for base, dirs, files in os.walk(prefix, followlinks=False):
        for name in dirs + files:
            path = Path(base) / name
            if path.is_file() or path.is_symlink():
                inventory.add(str(path.relative_to(prefix)))
    require(inventory == PIN["files"].keys(), "Pinned Psi4 runtime inventory differs")
    for name, expected in PIN["files"].items():
        path = prefix / name
        if "symlink" in expected:
            require(
                path.is_symlink() and os.readlink(path) == expected["symlink"],
                "Pinned Psi4 runtime symlink differs: " + name,
            )
            continue
        require(
            path.is_file() and not path.is_symlink(),
            "Pinned Psi4 runtime file differs: " + name,
        )
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        require(
            path.stat().st_size == expected["bytes"] and actual == expected["sha256"],
            "Pinned Psi4 runtime digest differs: " + name,
        )
    require(
        executable.read_text().splitlines()[0] == "#!" + str(prefix / "bin/python"),
        "Psi4 CLI interpreter differs from accepted prefix",
    )
    return {
        "engine": "psi4",
        "engine_version": VERSION,
        "package_build": PIN["package_build"],
        "package_sha256": PIN["package_sha256"],
        "prefix": str(prefix),
        "runtime_manifest_sha256": digest(encode(PIN)),
        "runtime_files_verified": len(PIN["files"]),
        "executable_sha256": PIN["files"]["bin/psi4"]["sha256"],
        "architecture": "arm64",
        "libraries": {
            "python": PIN["python"],
            "qcelemental": PIN["qcelemental"],
            "qcengine": PIN["qcengine"],
        },
    }


def policy(method):
    if method in {"b3lyp", "pbe"}:
        return {
            "reference": "rks",
            "scf_type": "pk",
            "puream": True,
            "guess": "core",
            "e_convergence": 1e-11,
            "d_convergence": 1e-9,
            "ints_tolerance": 1e-14,
            "maxiter": 150,
            "fail_on_maxiter": True,
            "dft_radial_points": 99,
            "dft_spherical_points": 590,
            "dft_radial_scheme": "treutler",
            "dft_nuclear_scheme": "treutler",
            "dft_pruning_scheme": "flat",
            "dft_density_tolerance": 1e-14,
            "dft_basis_tolerance": 1e-12,
        }
    result = {
        "reference": "rhf",
        "scf_type": "pk",
        "puream": True,
        "guess": "core",
        "e_convergence": 1e-10,
        "d_convergence": 1e-8,
        "ints_tolerance": 1e-12,
        "maxiter": 100,
        "fail_on_maxiter": True,
    }
    if method == "mp2":
        result.update(
            mp2_type="conv",
            freeze_core=False,
            e_convergence=1e-13,
            d_convergence=1e-11,
            ints_tolerance=1e-16,
            maxiter=150,
        )
    return result


def validate_specification(spec):
    method = spec.method.identifier.lower()
    basis = spec.basis.identifier.lower() if spec.basis else None
    require(
        spec.task_type.value == "ENERGY" and (method, basis) in PAIRS,
        "Psi4 supports only the five accepted ENERGY method/basis pairs",
    )
    require(spec.charge == 0 and spec.multiplicity == 1, "Psi4 requires a neutral singlet")
    require(
        not any(
            (
                spec.dispersion,
                spec.solvation,
                spec.constraints,
                spec.optimization,
                spec.conformer_search,
                spec.hessian,
                spec.tddft,
                spec.raman,
                spec.thermochemistry,
                spec.property_requests,
                spec.engine_extensions,
            )
        ),
        "Unsupported Psi4 options; arbitrary keywords/corrections are disabled",
    )
    kw = policy(method)
    require(
        spec.scf is not None
        and spec.scf.reference is not None
        and spec.scf.reference.lower() == kw["reference"],
        "Explicit accepted SCF reference required",
    )
    require(
        spec.scf.convergence_threshold in (None, kw["e_convergence"])
        and spec.scf.max_iterations in (None, kw["maxiter"]),
        "Unsupported Psi4 convergence preset",
    )
    require(spec.engine_preference.allowed_version in (None, VERSION), "Psi4 version must be 1.11")


def geometry(original):
    require(
        original["coordinate_system"] == "CARTESIAN" and original["unit"] in {"angstrom", "bohr"},
        "Psi4 requires Cartesian Angstrom or Bohr coordinates",
    )
    factor = BOHR_PER_ANGSTROM if original["unit"] == "angstrom" else 1.0
    symbols, values = [], []
    for i, atom in enumerate(original["atoms"]):
        require(
            atom["index"] == i
            and atom["element"] in {"H", "C", "O"}
            and atom["atomic_number"] == {"H": 1, "C": 6, "O": 8}[atom["element"]],
            "Psi4 supports stable H/C/O atom identities only",
        )
        xyz = [atom[k] for k in ("x", "y", "z")]
        require(
            all(
                isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
                for x in xyz
            ),
            "Invalid Psi4 molecular coordinates",
        )
        symbols.append(atom["element"])
        values.extend(round(float(x) * factor, 13) for x in xyz)
    require(
        0 < len(symbols) <= 100 and sum({"H": 1, "C": 6, "O": 8}[s] for s in symbols) % 2 == 0,
        "Psi4 requires a bounded neutral closed-shell electron count",
    )
    return symbols, values


def prepare_input(document, original):
    symbols, values = geometry(original)
    kw = policy(document["method"])
    return {
        "schema_name": "qcschema_atomic_input",
        "schema_version": 2,
        "molecule": {
            "schema_name": "qcschema_molecule",
            "schema_version": 3,
            "validated": False,
            "symbols": symbols,
            "geometry": values,
            "molecular_charge": 0,
            "molecular_multiplicity": 1,
            "fix_com": True,
            "fix_orientation": True,
            "fix_symmetry": "c1",
        },
        "specification": {
            "schema_name": "qcschema_atomic_specification",
            "driver": "energy",
            "model": {"method": document["method"], "basis": document["basis"]},
            "keywords": kw,
            "protocols": {"stdout": True, "native_files": "all", "wavefunction": "all"},
            "extras": {"chemdft_adapter": "psi4-energy-1.0.0"},
        },
    }


def enrich_input(document, original):
    document.update(engine="psi4", engine_version=VERSION, psi4_original_coordinates=original)
    document["psi4_input"] = prepare_input(document, original)
    document["psi4_geometry"] = {
        "normalization_decimals": 13,
        "bohr_per_angstrom": BOHR_PER_ANGSTROM,
        "conversion_identity": "qcelemental-0.51.2",
        "original_sha256": digest(encode(original)),
        "effective_sha256": digest(encode(document["psi4_input"]["molecule"])),
    }
    document["psi4_runtime_manifest_sha256"] = digest(encode(PIN))


def validate_input(document):
    require(
        document.get("engine") == "psi4"
        and document.get("engine_version") == VERSION
        and document.get("task") == "ENERGY"
        and document.get("charge") == 0
        and document.get("multiplicity") == 1
        and (document.get("method"), document.get("basis")) in PAIRS,
        "Invalid Psi4 engine/task/molecule/method",
    )
    require(
        not any(
            document.get(k)
            for k in (
                "dispersion",
                "solvation",
                "constraints",
                "optimization",
                "hessian",
                "tddft",
                "raman",
                "thermochemistry",
                "conformer_search",
                "property_requests",
            )
        ),
        "Unsupported Psi4 input options",
    )
    original = document["psi4_original_coordinates"]
    require(
        document["psi4_input"] == prepare_input(document, original),
        "Changed native Psi4 input/settings",
    )
    expected = dict(document)
    enrich_input(expected, original)
    require(
        all(
            document.get(k) == expected[k]
            for k in ("psi4_geometry", "psi4_runtime_manifest_sha256")
        ),
        "Changed Psi4 geometry/runtime association",
    )
    scf = document.get("scf") or {}
    kw = policy(document["method"])
    require(
        scf.get("reference", "").lower() == kw["reference"]
        and scf.get("convergence_threshold") in (None, kw["e_convergence"])
        and scf.get("max_iterations") in (None, kw["maxiter"]),
        "Unauthorized SCF settings",
    )
    return document["psi4_input"]


def command(executable, root):
    return [
        str(executable),
        "--qcschema",
        str(root / "input.json"),
        "--return-version",
        "2",
        "-o",
        str(root / "output.json"),
        "-n",
        "1",
        "--memory",
        "1GiB",
        "--scratch",
        str(root / "scratch"),
    ]


def number(x):
    require(
        isinstance(x, (float, int)) and not isinstance(x, bool) and math.isfinite(x),
        "Nonfinite or malformed native energy",
    )
    return float(x)


def consistent(values):
    values = [number(v) for v in values]
    require(
        max(values) - min(values) <= 8 * max(math.ulp(v) for v in values),
        "Inconsistent native energy fields",
    )
    return values[0]


def parse_evidence(raw, document):
    inp = validate_input(document)
    require(
        raw.keys() >= REQUIRED
        and all(isinstance(b, bytes) and len(b) <= MAX_FILE for b in raw.values()),
        "Incomplete or oversized Psi4 evidence",
    )
    hashes = json.loads(raw["hashes.json"])
    require(
        hashes == {n: digest(b) for n, b in raw.items() if n != "hashes.json"},
        "Psi4 artifact hashes/coverage differ",
    )
    require(raw["input.json"] == encode(inp), "Native input is not immutable authorized QCSchema")
    inv = json.loads(raw["invocation.json"])
    status = json.loads(raw["execution.json"])
    require(
        status.get("exit_code") == 0
        and status.get("termination_reason") is None
        and status.get("evidence_complete") is True
        and status.get("process_group_cleanup") is True
        and status.get("scratch_cleanup_complete") is True
        and status.get("omitted_files") == [],
        "Incomplete, failed, canceled or timed-out Psi4 execution",
    )
    require(
        inv["normalized_input_sha256"] == digest(encode(document))
        and inv["runtime_identity"]["runtime_manifest_sha256"] == digest(encode(PIN))
        and inv["native_input_sha256"] == digest(raw["input.json"]),
        "Native input/runtime association differs",
    )
    root = Path(inv["cwd"])
    require(
        root.is_absolute()
        and inv["argv"] == command(Path(inv["runtime_identity"]["prefix"]) / "bin/psi4", root),
        "Unauthorized native Psi4 arguments",
    )
    require(
        inv["environment"] == native_environment(Path(inv["argv"][0]), root)
        and inv["engine_memory_bytes"] == MEMORY_BYTES
        and 0 < inv["wall_seconds"] <= MAX_WALL
        and 0 < inv["file_limit_bytes"] <= MAX_FILE
        and 0 < inv["directory_limit_bytes"] <= MAX_DIRECTORY
        and status.get("hard_memory_limit") is False
        and status.get("hard_disk_quota") is False,
        "Unauthorized native environment/resource policy",
    )
    result = json.loads(raw["output.json"])
    require(
        result.get("schema_name") == "qcschema_atomic_result"
        and result.get("schema_version") == 2
        and result.get("success") is True
        and result.get("error") is None,
        "Native QCSchema scientific result failed or malformed",
    )
    method, basis = document["method"], document["basis"]
    dft = method in {"b3lyp", "pbe"}
    ref = "RKS" if dft else "RHF"
    kw = policy(method)
    require(
        result["provenance"]["creator"] == "Psi4"
        and result["provenance"]["version"] == VERSION
        and result["provenance"]["module"] == ("occ" if method == "mp2" else "scf"),
        "Native engine/module identity differs",
    )
    spec = result["input_data"]["specification"]
    require(
        spec["driver"] == "energy"
        and spec["model"] == inp["specification"]["model"]
        and spec["keywords"] == kw
        and spec.get("extras") == inp["specification"]["extras"],
        "Native method/basis/options differ",
    )
    require(
        result["input_data"]["schema_name"] == "qcschema_atomic_input"
        and result["input_data"]["schema_version"] == 2,
        "Malformed effective native input",
    )
    text = result["stdout"]
    require(
        isinstance(text, str)
        and text.count(ref + " Reference") == 1
        and "SCF Algorithm Type is PK." in text
        and "Basis Set: " + basis.upper() in text
        and "Spherical Harmonics?: true" in text
        and "Running in c1 symmetry." in text
        and re.search(r"Threads:\s+1\b", text)
        and "Memory:     1.0 GiB" in text,
        "Native reference/basis/integral/frame/resource evidence differs",
    )
    require(
        not re.search(r"Failed to converge|did not converge|SCFConvergenceError", text, re.I),
        "Native SCF failure evidence",
    )
    # A single supported energy call has exactly one SCF block. Scope convergence to it.
    blocks = re.findall(r"==> Iterations <==([\s\S]*?)==> Post-Iterations <==", text)
    require(
        len(blocks) == text.count("==> Iterations <==") == 1
        and blocks[-1].count("Energy and wave function converged.") == 1
        and text.count("Energy and wave function converged.") == 1,
        "Missing/ambiguous final SCF convergence block",
    )
    it = re.findall(
        r"@" + ref + r" iter\s+(\d+):\s+([-+\d.Ee]+)\s+([-+\d.Ee]+)\s+([-+\d.Ee]+)", blocks[-1]
    )
    props, qc = result["properties"], result["extras"]["qcvars"]
    require(
        it
        and type(props["scf_iterations"]) is int
        and [int(r[0]) for r in it] == list(range(1, len(it) + 1))
        and len(it) == props["scf_iterations"] == qc["SCF ITERATIONS"],
        "Inconsistent SCF iterations",
    )
    de, rms = abs(number(float(it[-1][2]))), abs(number(float(it[-1][3])))
    require(
        de <= kw["e_convergence"] and rms <= kw["d_convergence"], "Final SCF thresholds not met"
    )
    for label, value in [
        ("Energy", kw["e_convergence"]),
        ("Density", kw["d_convergence"]),
        ("Integral", kw["ints_tolerance"]),
    ]:
        m = re.search(label + r" threshold\s*=\s*([-+\d.Ee]+)", text)
        require(m and float(m[1]) == value, "Native convergence option differs")
    effective = result["input_data"]["molecule"]
    mol = result["molecule"]
    expected = inp["molecule"]
    for m in [effective, mol]:
        require(
            m["symbols"] == expected["symbols"]
            and m["molecular_charge"] == 0
            and m["molecular_multiplicity"] == 1
            and m["fix_com"] is True
            and m["fix_orientation"] is True
            and m["fix_symmetry"] == "c1"
            and len(m["geometry"]) == len(expected["geometry"]),
            "Native atom/frame/charge identity differs",
        )
        require(
            all(
                abs(number(a) - b) <= max(1e-14, 2 * math.ulp(b))
                for a, b in zip(m["geometry"], expected["geometry"], strict=True)
            ),
            "Native effective geometry differs",
        )
        require(
            "units" not in m and all(m.get("real", [True] * len(m["symbols"]))),
            "Invalid native geometry units/ghost atoms",
        )
    require(
        mol["geometry"] == effective["geometry"], "Returned/effective geometry association differs"
    )
    require("units" not in result and "units" not in props, "Noncanonical energy units")
    nocc = sum({"H": 1, "C": 6, "O": 8}[s] for s in expected["symbols"]) // 2
    nbf = sum(
        (1 if s == "H" else 5) if basis == "sto-3g" else (5 if s == "H" else 14)
        for s in expected["symbols"]
    )
    require(
        props["calcinfo_nalpha"] == props["calcinfo_nbeta"] == nocc
        and props["calcinfo_nbasis"] == props["calcinfo_nmo"] == nbf
        and props["calcinfo_natom"] == len(expected["symbols"])
        and result["wavefunction"]["restricted"] is True,
        "Native electron/orbital dimensions differ",
    )
    native_basis = result["wavefunction"]["basis"]
    require(
        len(native_basis["atom_map"]) == len(expected["symbols"]), "Native basis atom map differs"
    )
    for i, symbol in enumerate(expected["symbols"]):
        require(
            native_basis["center_data"][native_basis["atom_map"][i]] == BASES[basis][symbol],
            "Native primitive basis/ECP convention differs",
        )
    hf = consistent([props["scf_total_energy"], qc["SCF TOTAL ENERGY"]])
    total = consistent([result["return_result"], props["return_energy"], qc["CURRENT ENERGY"]])
    require(abs(float(it[-1][1]) - hf) <= 5.1e-15 + math.ulp(hf), "SCF log energy differs")
    require(
        not any("DISPERSION" in k and number(v) != 0 for k, v in qc.items())
        and not re.search(r"DFTD[34]|DFT-D[34]|Dispersion Correction", text, re.I),
        "Unauthorized dispersion",
    )
    parsed = {
        "total_energy_hartree": total,
        "hf_reference_hartree": hf,
        "scf_iterations": len(it),
        "final_delta_energy_hartree": de,
        "final_rms_commutator": rms,
        "effective_geometry_bohr": effective["geometry"],
        "returned_geometry_bohr": mol["geometry"],
        "returned_geometry_sha256": digest(encode(mol)),
        "method": method,
        "basis": basis,
    }
    if method == "mp2":
        for key, value in [
            ("MP2_TYPE", "CONV"),
            ("FREEZE_CORE", "0"),
            ("SCF_TYPE", "PK"),
            ("ORB_OPT", "FALSE"),
            ("SPIN_SCALE_TYPE", "NONE"),
            ("WFN_TYPE", "OMP2"),
        ]:
            require(
                re.search(r"^\s*" + key + r"\s*=>\s*" + value + r"\s*!", text, re.M),
                "Wrong resolved MP2 option: " + key,
            )
        require(
            "Module OCC Options:" in text
            and "Computing two-electron integrals...done" in text
            and "Stored in file 33." in text
            and "Computing MP2 energy using SCF MOs (Canonical MP2)" in text
            and not re.search(
                r"DF-MP2|DFMP2|DFOCC|Density Fitting|Cholesky Decomposition", text, re.I
            ),
            "Wrong native MP2 algorithm",
        )
        spaces = re.search(
            r"IRREP\s+FC\s+OCC\s+VIR\s+FV\s*=+\s+A\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", text
        )
        require(
            spaces and list(map(int, spaces.groups())) == [0, nocc, nbf - nocc, 0],
            "Wrong MP2 core/orbital spaces",
        )
        hf = consistent([hf, qc["HF TOTAL ENERGY"], qc["CURRENT REFERENCE ENERGY"]])
        corr = consistent(
            [
                props["mp2_correlation_energy"],
                qc["MP2 CORRELATION ENERGY"],
                qc["CURRENT CORRELATION ENERGY"],
            ]
        )
        consistent([total, props["mp2_total_energy"], qc["MP2 TOTAL ENERGY"]])
        ss = consistent(
            [props["mp2_same_spin_correlation_energy"], qc["MP2 SAME-SPIN CORRELATION ENERGY"]]
        )
        os_ = consistent(
            [
                props["mp2_opposite_spin_correlation_energy"],
                qc["MP2 OPPOSITE-SPIN CORRELATION ENERGY"],
            ]
        )
        budget = 8 * max(math.ulp(v) for v in [hf, corr, total])
        require(
            abs(hf + corr - total) <= budget
            and abs(ss + os_ - corr) <= budget
            and abs(number(props["mp2_doubles_energy"]) - ss - os_) <= budget
            and props["mp2_singles_energy"] == qc["MP2 SINGLES ENERGY"] == 0,
            "Inconsistent MP2 spin/energy decomposition",
        )
        for label, value in [
            ("SCF Energy", hf),
            ("MP2 Correlation Energy", ss + os_),
            ("MP2 Total Energy", total),
        ]:
            m = re.search(r"^\s*" + label + r" \(a.u.\)\s*:\s*([-+\d.Ee]+)", text, re.M)
            require(
                m and abs(float(m[1]) - value) <= 5.1e-15 + math.ulp(value),
                "Native printed MP2 energy differs",
            )
        parsed.update(
            mp2_correlation_hartree=corr,
            mp2_same_spin_hartree=ss,
            mp2_opposite_spin_hartree=os_,
            decomposition_delta_hartree=hf + corr - total,
        )
    elif dft:
        consistent([total, hf, qc["DFT TOTAL ENERGY"], qc["DFT FUNCTIONAL TOTAL ENERGY"]])
        require(
            qc["XC GRID RADIAL POINTS"] == 99
            and qc["XC GRID SPHERICAL POINTS"] == 590
            and qc["DFT VV10 ENERGY"] == 0
            and re.search(r"MP2 Hybrid\s*=\s*FALSE", text),
            "Incorrect DFT grid/correlation policy",
        )
        for label, value in [
            ("Radial Scheme", "TREUTLER"),
            ("Nuclear Scheme", "TREUTLER"),
            ("Pruning Scheme", "FLAT"),
        ]:
            require(
                re.search(re.escape(label) + r"\s*=\s*" + value, text),
                "Wrong native DFT grid scheme",
            )
        require(re.search(r"Version\s+7\.1\.2\b", text), "Native LibXC differs")
        threshold_block = re.search(
            r"=> LibXC Density Thresholds\s*<==([\s\S]*?)=> Molecular Quadrature", text
        )
        expected_components = (
            ["XC_HYB_GGA_XC_B3LYP"] if method == "b3lyp" else ["XC_GGA_X_PBE", "XC_GGA_C_PBE"]
        )
        require(threshold_block is not None, "Missing native LibXC density thresholds")
        thresholds = re.findall(r"(XC_[A-Z0-9_]+):\s*([-+\d.Ee]+)", threshold_block[1])
        require(
            sorted(name for name, _ in thresholds) == sorted(expected_components)
            and all(float(value) == kw["dft_density_tolerance"] for _, value in thresholds),
            "Wrong native LibXC components/density thresholds",
        )
        if method == "b3lyp":
            require("XC_HYB_GGA_XC_B3LYP:" in text and "VWN5_RPA" in text, "Wrong B3LYP variant")
            for coefficient, term in [
                ("0.0800", "Slater exchange"),
                ("0.7200", "Becke 88"),
                ("0.2000", "HF"),
                ("0.1900", "Vosko, Wilk & Nusair (VWN5_RPA)"),
                ("0.8100", "Lee, Yang & Parr"),
            ]:
                require(
                    re.search(re.escape(coefficient) + r"\s+" + re.escape(term), text),
                    "Wrong B3LYP functional component",
                )
        else:
            require(
                "XC_GGA_X_PBE:" in text
                and "XC_GGA_C_PBE:" in text
                and re.search(r"Exchange Hybrid\s*=\s*FALSE", text),
                "Wrong PBE functional components",
            )
        disp = re.findall(r"Empirical Dispersion Energy\s*=\s*([-+\d.Ee]+)", text)
        require(
            disp and all(float(x) == 0 for x in disp),
            "Missing/nonzero empirical dispersion evidence",
        )
        xc = consistent([props["scf_xc_energy"], qc["DFT XC ENERGY"]])
        decomposition = (
            sum(
                number(props[k])
                for k in [
                    "nuclear_repulsion_energy",
                    "scf_one_electron_energy",
                    "scf_two_electron_energy",
                ]
            )
            + xc
        )
        require(
            abs(decomposition - total) <= 16 * math.ulp(total),
            "DFT component decomposition differs",
        )
    else:
        consistent([total, hf, qc["HF TOTAL ENERGY"]])
    return parsed


def native_environment(executable, root):
    return {
        "PATH": str(executable.parent) + os.pathsep + os.defpath,
        "HOME": str(root),
        "TMPDIR": str(root / "tmp"),
        "PSI_SCRATCH": str(root / "scratch"),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "OMP_NUM_THREADS": "1",
        "OMP_THREAD_LIMIT": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "VECLIB_MAXIMUM_THREADS": "1",
        "LC_ALL": "C",
    }


def execute_native(
    document,
    executable,
    settings,
    *,
    calculation_id,
    execution_id,
    attempt_number,
    on_tick=None,
    workdir=None,
):
    inp = validate_input(document)
    identity = environment_identity(executable)
    executable = Path(executable).absolute()
    limit = min(MAX_FILE, settings.scientific_max_output_bytes)
    directory_limit = min(MAX_DIRECTORY, settings.compute_local_temporary_storage_bytes)
    timeout = min(MAX_WALL, settings.scientific_execution_timeout_seconds)

    def run(root):
        root.mkdir(parents=True, exist_ok=True)
        (root / "scratch").mkdir()
        (root / "tmp").mkdir()
        initial = encode(inp)
        (root / "input.json").write_bytes(initial)
        (root / "input.json").chmod(0o400)
        env = native_environment(executable, root)
        inv = {
            "argv": command(executable, root),
            "cwd": str(root),
            "environment": env,
            "calculation_id": calculation_id,
            "execution_id": execution_id,
            "attempt_number": attempt_number,
            "normalized_input_sha256": digest(encode(document)),
            "native_input_sha256": digest(initial),
            "runtime_identity": identity,
            "wall_seconds": timeout,
            "engine_memory_bytes": MEMORY_BYTES,
            "file_limit_bytes": limit,
            "directory_limit_bytes": directory_limit,
        }
        raw = {"input.json": initial, "invocation.json": encode(inv)}
        (root / "invocation.json").write_bytes(raw["invocation.json"])
        def observe_directory():
            size = 0
            violation = None
            for base, dirs, files in os.walk(root, followlinks=False):
                for name in dirs + files:
                    path = Path(base) / name
                    if path.is_symlink():
                        violation = "unsafe native symlink"
                    elif path.is_file():
                        with contextlib.suppress(FileNotFoundError):
                            n = path.stat().st_size
                            size += n
                            # Binary integral scratch is bounded by the directory budget.
                            # Only retained output/log files use the artifact-file budget.
                            if (path.parent == root or path.name.endswith(".qcschema_tmpout")) and (
                                n > limit
                            ):
                                violation = "output resource limit"
            if size > directory_limit:
                violation = "directory resource limit"
            return size, violation

        reason = None
        peak = peak_rss = 0
        start = time.monotonic()
        with (root / "stdout.txt").open("wb") as stdout, (root / "stderr.txt").open("wb") as stderr:
            proc = subprocess.Popen(
                inv["argv"], cwd=root, env=env, stdout=stdout, stderr=stderr, start_new_session=True
            )
            try:
                while proc.poll() is None:
                    size, resource_reason = observe_directory()
                    reason = resource_reason or reason
                    peak = max(peak, size)
                    # Observe this owned process group only; no RSS hard limit is asserted.
                    ps = subprocess.run(
                        ["/bin/ps", "-axo", "pgid=,rss="],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    rss = sum(
                        int(row[1])
                        for line in ps.stdout.splitlines()
                        if len(row := line.split()) == 2 and row[0] == str(proc.pid)
                    )
                    peak_rss = max(peak_rss, rss)
                    if time.monotonic() - start >= timeout:
                        reason = "wall timeout"
                    if on_tick:
                        try:
                            if on_tick() is False:
                                reason = "canceled or lease lost"
                        except Exception:
                            reason = "heartbeat callback failed"
                    if shutdown_signal() is not None:
                        reason = "worker shutdown"
                    if reason:
                        break
                    time.sleep(0.05)
            finally:
                _terminate(proc)
        final_size, resource_reason = observe_directory()
        peak = max(peak, final_size)
        reason = reason or resource_reason
        complete = reason is None and (root / "input.json").read_bytes() == initial
        if not complete and reason is None:
            reason = "input changed"
        omitted = []
        retained = sum(map(len, raw.values()))
        # Interrupted temporary stdout is retained only as a bounded diagnostic.
        candidates = [root / n for n in ["output.json", "stdout.txt", "stderr.txt"]]
        candidates.extend(sorted((root / "scratch").glob("*.qcschema_tmpout")))
        for path in candidates:
            if not path.exists():
                continue
            name = path.name if path.parent == root else "interrupted-native-stdout.txt"
            try:
                data = _read(path, limit)
                require(retained + len(data) <= MAX_RETAINED, "Psi4 retained artifact limit")
                raw[name] = data
                retained += len(data)
            except ValueError:
                complete = False
                omitted.append(name)
        status = {
            "exit_code": proc.returncode,
            "process_group_id": proc.pid,
            "termination_reason": reason,
            "evidence_complete": complete,
            "process_group_cleanup": True,
            "elapsed_seconds": time.monotonic() - start,
            "omitted_files": omitted,
            "peak_sampled_directory_bytes": peak,
            "peak_sampled_group_rss_kib": peak_rss,
            "hard_memory_limit": False,
            "hard_disk_quota": False,
            "scratch_files_before_cleanup": sorted(p.name for p in (root / "scratch").iterdir()),
        }
        # Only owned, non-symlink files, after owned process-group termination.
        for p in (root / "scratch").iterdir():
            if p.is_file() and not p.is_symlink():
                p.unlink()
        status["scratch_cleanup_complete"] = not list((root / "scratch").iterdir())
        raw["execution.json"] = encode(status)
        raw["hashes.json"] = encode({n: digest(b) for n, b in raw.items()})
        candidate = None
        try:
            parsed = parse_evidence(raw, document)
            candidate = {
                "schema": "chemdft.worker.energy",
                "task": "ENERGY",
                "engine": "psi4",
                "engine_version": VERSION,
                "adapter_version": ADAPTER_VERSION,
                "method": document["method"],
                "basis": document["basis"],
                "converged": True,
                "finite": True,
                **parsed,
                "environment": identity,
            }
        except (ValueError, KeyError, TypeError, IndexError) as error:
            raw["validation-error.txt"] = str(error).encode()
            raw["hashes.json"] = encode(
                {n: digest(b) for n, b in raw.items() if n != "hashes.json"}
            )
        for n, b in raw.items():
            (root / n).write_bytes(b) if n != "input.json" else None
        return ExecutionResult(
            proc.returncode, reason == "wall timeout", b"", b"", b"", candidate, raw
        )

    # The outer Gateway scope spans native cleanup AND terminal persistence.
    with crest_shutdown_scope():
        if workdir is not None:
            return run(Path(workdir).absolute())
        with tempfile.TemporaryDirectory(prefix="chemdft-psi4-") as tmp:
            return run(Path(tmp))
