# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Pinned native CREST execution and independent evidence-consistency parsing.

The executable, runtime and producer remain trusted. Hashes do not attest numerical truth.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import itertools
import json
import math
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

from ...contracts.scientific import ConformerSearchOptions
from .interfaces import ExecutionResult
from .shutdown import crest_shutdown_scope, shutdown_signal

VERSION = "3.0.2+pf8c-ewinfix-a1"
BINARY_SHA256 = "f54fe9a18c268c0c563fa6732d31018b5ba29fdd87670a2e4df7db62475edf97"
CALCULATOR = "embedded-tblite-0.3.0-fork"
FLOAT = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][-+]?\d+)?"
FACTOR = 627.50947428
ENERGY_TOL = 1.0001e-8
PRINTED_MIN_TOL = 5.0051e-6
REQUIRED = (
    "input.xyz",
    "stdout.txt",
    "stderr.txt",
    "invocation.json",
    "execution.json",
    "crest_conformers.xyz",
    "crest_rotamers.xyz",
    "crest_best.xyz",
    "crest.energies",
    "ensemble_energies.log",
)
LIMITATIONS = (
    "Native CREST members have UNVERIFIED local-minimum status; gradients are insufficient.",
    "Stochastic bounded sampling; neither exhaustive ensemble nor proven global minimum.",
    "Upstream #494 unresolved: outer-restart runs fail closed; matched VTIGHT minima are compared.",
    "No frequency, Hessian, local-minimum or thermochemistry eligibility is conferred.",
    "Trusted native worker evidence is independently reparsed, not independently recalculated.",
    "macOS ARM64 acceptance only; neutral singlet H/C/O inputs and validated iMTD-GC settings.",
    "Intermediate snapshots are sampled, not lossless restart history.",
)


LINUX_BINARY_ENV = "CHEMDFT_AWS_CREST_BINARY_SHA256"
LINUX_LIMITATION = (
    "Linux x86_64 build of the same patched source, built on the AWS worker host; its binary "
    "digest is recorded, not an upstream release. Stochastic iteration counts and member order "
    "may differ from the macOS acceptance (platform caveat, as for xTB); equality of members "
    "is not claimed."
)


def accepted_binary_digests():
    """macOS ARM64 digest, plus the Linux x86_64 digest only when a deployment names it."""
    accepted = {BINARY_SHA256}
    linux = os.environ.get(LINUX_BINARY_ENV, "")
    if re.fullmatch(r"[0-9a-f]{64}", linux):
        accepted.add(linux)
    return frozenset(accepted)


def limitations_for(executable_sha256):
    return LIMITATIONS if executable_sha256 == BINARY_SHA256 else (*LIMITATIONS, LINUX_LIMITATION)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(document):
    return json.dumps(document, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def number(s):
    x = float(s.replace("D", "E").replace("d", "e"))
    if not math.isfinite(x):
        raise ValueError("Non-finite native number")
    return x


def validate_input(document):
    if (
        document.get("engine") != "crest"
        or document.get("engine_version") != VERSION
        or document.get("engine_executable_sha256") not in accepted_binary_digests()
        or document.get("calculator") != CALCULATOR
    ):
        raise ValueError("Unverified CREST executable/calculator identity")
    if (
        document.get("task") != "CONFORMER_SEARCH"
        or document.get("method") != "gfn2"
        or document.get("basis") is not None
        or document.get("coordinate_unit") != "angstrom"
    ):
        raise ValueError("Unsupported CREST task, method, basis or units")
    if (
        type(document.get("charge")) is not int
        or document["charge"] != 0
        or document.get("multiplicity") != 1
    ):
        raise ValueError("Initial CREST acceptance supports neutral closed-shell singlets")
    options = ConformerSearchOptions.model_validate(document.get("conformer_search"))
    atoms = document.get("atoms", [])
    if not 1 <= len(atoms) <= 50:
        raise ValueError("CREST requires 1-50 atoms")
    for i, a in enumerate(atoms):
        if a["index"] != i or {"H": 1, "C": 6, "O": 8}.get(a["element"]) != a["atomic_number"]:
            raise ValueError("CREST supports ordered H/C/O atom identities only")
        xyz = a["xyz_angstrom"]
        if len(xyz) != 3 or not all(math.isfinite(float(x)) for x in xyz):
            raise ValueError("CREST coordinates must be finite triples")
        if any(math.dist(xyz, b["xyz_angstrom"]) < 1e-8 for b in atoms[:i]):
            raise ValueError("Coincident nuclei")
    if sum(a["atomic_number"] for a in atoms) % 2:
        raise ValueError("Invalid closed-shell electron parity")
    return options


def xyz_input(document):
    return (
        str(len(document["atoms"]))
        + "\nChemDFT immutable CREST input\n"
        + "\n".join(
            a["element"] + " " + " ".join(format(x, ".17g") for x in a["xyz_angstrom"])
            for a in document["atoms"]
        )
        + "\n"
    ).encode()


def command(executable, document):
    validate_input(document)
    return [
        str(executable),
        "input.xyz",
        "--newversion",
        "--v3",
        "--gfn2",
        "--chrg",
        str(document["charge"]),
        "--uhf",
        "0",
        "--optlev",
        "vtight",
        "--ewin",
        "6.0",
        "--rthr",
        "0.125",
        "--ethr",
        "0.05",
        "--bthr",
        "0.01",
        "-T",
        "2",
        "--nozs",
        "--keepdir",
    ]


def records(data, atoms, energy=True):
    lines = data.decode("utf-8").splitlines(keepends=True)
    result = []
    i = 0
    while i < len(lines):
        if not lines[i].strip():
            if any(line.strip() for line in lines[i:]):
                raise ValueError("Blank gap in native XYZ records")
            break
        if lines[i].strip() != str(len(atoms)) or i + len(atoms) + 2 > len(lines):
            raise ValueError("Incomplete XYZ or incorrect atom count")
        block = lines[i : i + len(atoms) + 2]
        coords = []
        if energy and not re.fullmatch(
            r"\s*" + FLOAT + r"(?:\s+" + FLOAT + r")?(?:\s+!)?\s*", block[1]
        ):
            raise ValueError("Invalid native XYZ energy record")
        value = number(block[1].split()[0]) if energy else None
        for line, a in zip(block[2:], atoms, strict=True):
            row = line.split()
            if len(row) != 4 or row[0] != a["element"]:
                raise ValueError("Native atom ordering/composition changed")
            coords.append([number(x) for x in row[1:]])
        if any(math.dist(x, y) < 1e-8 for j, x in enumerate(coords) for y in coords[:j]):
            raise ValueError("Degenerate native geometry")
        result.append(
            {
                "energy_hartree": value,
                "coordinates_angstrom": coords,
                "record_sha256": digest("".join(block).encode()),
            }
        )
        i += len(atoms) + 2
    if not result or len(result) > 10000:
        raise ValueError("Empty or oversized XYZ ensemble")
    return result


def effective_window(text, requested):
    windows = re.findall(r"sorting energy window \(EWIN\)\s*:\s*(" + FLOAT + ")", text)
    if not windows or any(abs(number(w) - requested) > 5e-5 for w in windows):
        raise ValueError("Missing, contradictory or incorrect final effective CREGEN EWIN")
    return number(windows[-1])


def parse_sorting(data, stdout, atoms, requested):
    """CREGEN-only regression helper; does not establish search completion."""
    effective_window(stdout, requested)
    parsed = records(data, atoms)
    if any(
        b["energy_hartree"] < a["energy_hartree"] - ENERGY_TOL
        for a, b in itertools.pairwise(parsed)
    ):
        raise ValueError("Native conformer energy ranking contradicts order")
    if any(
        (p["energy_hartree"] - parsed[0]["energy_hartree"]) * FACTOR > requested + 0.00051
        for p in parsed
    ):
        raise ValueError("Conformer outside effective energy window")
    return parsed


def intermediate_minima(text):
    protocol = "UNCLASSIFIED"
    minima = []
    for i, line in enumerate(text.splitlines(), 1):
        if "crude pre-optimization" in line:
            protocol = "CRUDE"
        elif "optimization with tight thresholds" in line:
            protocol = "TIGHT"
        elif "optimization with very tight thresholds" in line:
            protocol = "VTIGHT"
        elif "N E W   I T E R A T I O N  C Y C L E" in line:
            protocol = "UNCLASSIFIED"
        m = re.search(r"CREGEN> E lowest\s*:\s*(" + FLOAT + ")", line)
        if m:
            minima.append(
                {
                    "stdout_line": i,
                    "energy_hartree": number(m[1]),
                    "protocol": protocol,
                    "comparable_to_final": protocol == "VTIGHT",
                }
            )
    return minima


def _count(text, pattern):
    found = re.findall(pattern, text)
    if not found:
        raise ValueError("Missing native count: " + pattern)
    return int(found[-1])


def parse_evidence(raw, document):
    """Reparse actual native bytes; final-stage thresholds are scoped explicitly."""
    validate_input(document)
    if any(name not in raw for name in REQUIRED):
        raise ValueError("Incomplete CREST native evidence")
    inv = json.loads(raw["invocation.json"])
    status = json.loads(raw["execution.json"])
    if (
        status.get("exit_code") != 0
        or status.get("termination_reason")
        or status.get("evidence_complete") is not True
    ):
        raise ValueError("Native CREST did not complete with intact evidence")
    if (
        inv.get("normalized_input_sha256") != digest(encode(document))
        or inv.get("executable_sha256") != document["engine_executable_sha256"]
        or inv.get("calculator") != CALCULATOR
    ):
        raise ValueError("Native invocation differs from authorized input/calculator")
    argv = inv.get("argv", [])
    if not argv or argv != command(argv[0], document):
        raise ValueError("Unauthorized CREST command")
    if raw["input.xyz"] != xyz_input(document):
        raise ValueError("Immutable native XYZ input was changed")
    out = raw["stdout.txt"].decode("utf-8")
    if (
        "Version 3.0.2," not in out
        or "xTB calculation via tblite lib" not in out
        or "GFN2-xTB level" not in out
        or "--v3 : iMTD-GC" not in out
    ):
        raise ValueError("Native CREST method/calculator/version evidence missing")
    if not re.search(r"Molecular charge\s*:\s*0\s*$", out, re.M) or "--uhf 0" not in out:
        raise ValueError("Native charge/spin evidence differs")
    if (
        out.count("CREST terminated normally.") != 1
        or "Final Geometry Optimization" not in out
        or "Final Ensemble Information" not in out
        or "Wall Time Summary" not in out
    ):
        raise ValueError("Sorting completion is not full search completion")
    final = out.rsplit("Final Geometry Optimization", 1)[1]
    ensemble = final.rsplit("Final Ensemble Information", 1)[1]
    window = effective_window(ensemble, 6.0)
    for key, value in [
        ("RMSD threshold", 0.125),
        ("Bconst threshold", 0.01),
        ("population threshold", 0.05),
    ]:
        match = re.search(re.escape(key) + r"\s*:\s*(" + FLOAT + ")", ensemble)
        if not match or abs(number(match[1]) - value) > 5e-5:
            raise ValueError("Incorrect native duplicate/grouping criteria")
    optimized = re.findall(r"> (\d+) of (\d+) structures successfully optimized", final)
    if not optimized or optimized[-1][0] != optimized[-1][1]:
        raise ValueError("Incomplete final optimization")
    points = _count(ensemble, r"number of points on xyz files\s*:\s*(\d+)")
    reliable = _count(ensemble, r"number of reliable points\s*:\s*(\d+)")
    doubles = _count(ensemble, r"number of doubles removed by rot/RMSD\s*:\s*(\d+)")
    rotcount = _count(ensemble, r"total number unique points considered further\s*:\s*(\d+)")
    unique = _count(ensemble, r"number of unique conformers for further calc\s+(\d+)")
    removed = re.findall(r"number of removed by energy\s*:\s*(\d+)", ensemble)
    if (
        points != int(optimized[-1][0])
        or reliable != points
        or rotcount != reliable - doubles - (int(removed[-1]) if removed else 0)
    ):
        raise ValueError("Contradictory native count arithmetic")
    atoms = document["atoms"]
    if _count(ensemble, r"number of atoms\s*:\s*(\d+)") != len(atoms):
        raise ValueError("Native ensemble atom count contradicts input")
    criteria = re.search(
        r"E/G convergence criteria:\s*(" + FLOAT + r") Eh,\s*(" + FLOAT + r") Eh/a0", final
    )
    if (
        "optimization with very tight thresholds" not in final
        or not criteria
        or abs(number(criteria[1]) - 1e-7) > 1e-14
        or abs(number(criteria[2]) - 2e-4) > 1e-12
    ):
        raise ValueError("Incorrect final optimization protocol")
    confs = parse_sorting(raw["crest_conformers.xyz"], ensemble, atoms, 6.0)
    rots = records(raw["crest_rotamers.xyz"], atoms)
    best = records(raw["crest_best.xyz"], atoms)
    if unique != len(confs) or rotcount != len(rots) or len(best) != 1 or unique > 1000:
        raise ValueError("Native final ensemble counts disagree")

    def same(a, b):
        return (
            abs(a["energy_hartree"] - b["energy_hartree"]) <= ENERGY_TOL
            and a["coordinates_angstrom"] == b["coordinates_angstrom"]
        )

    if not same(best[0], confs[0]) or any(not any(same(c, r) for r in rots) for c in confs):
        raise ValueError("Conformer/best geometry absent from native rotamers")
    if len({tuple(tuple(x) for x in c["coordinates_angstrom"]) for c in confs}) != len(confs):
        raise ValueError("Exact duplicate final conformers contradict native grouping")
    table = re.findall(
        r"^\s+(\d+)\s+(" + FLOAT + r")\s+(" + FLOAT + r")\s+" + FLOAT + r"(?:\s|$)", ensemble, re.M
    )
    if len(table) != len(rots):
        raise ValueError("Incomplete final native ranking table")
    for rank, (row, rotamer) in enumerate(zip(table, rots, strict=True), 1):
        if (
            int(row[0]) != rank
            or abs(number(row[2]) - rotamer["energy_hartree"]) > PRINTED_MIN_TOL
            or abs(
                number(row[1]) - (rotamer["energy_hartree"] - confs[0]["energy_hartree"]) * FACTOR
            )
            > 0.0005 + ENERGY_TOL * FACTOR
        ):
            raise ValueError("Native stdout ranking/energy table contradicts XYZ ensemble")
    relative = []
    rows = raw["crest.energies"].decode().splitlines()
    rows = [row.split() for row in rows if row.strip()]
    if len(rows) != len(confs):
        raise ValueError("Incomplete relative energy table")
    for rank, (row, c) in enumerate(zip(rows, confs, strict=True), 1):
        if len(row) != 2 or row[0] != str(rank):
            raise ValueError("Incorrect native rank")
        rel = number(row[1])
        expected = (c["energy_hartree"] - confs[0]["energy_hartree"]) * FACTOR
        if abs(expected - rel) > 0.0005 + ENERGY_TOL * FACTOR or rel < 0:
            raise ValueError("Contradictory relative conformer energy")
        relative.append(rel)
    log = [row.split() for row in raw["ensemble_energies.log"].decode().splitlines() if row.strip()]
    if len(log) != points or any(len(row) != 3 for row in log):
        raise ValueError("Incomplete final optimization energies")
    values = [[number(x) for x in row] for row in log]
    if any(v[2] < 0 or v[2] > 0.0002 for v in values) or any(
        not any(abs(r["energy_hartree"] - v[0]) <= ENERGY_TOL for v in values) for r in rots
    ):
        raise ValueError("Final optimizer convergence/energy evidence disagrees")
    reference = re.search(r"reference state Etot\s*:\s*(" + FLOAT + ")", ensemble)
    if not reference or abs(number(reference[1]) - confs[0]["energy_hartree"]) > ENERGY_TOL:
        raise ValueError("Final native reference minimum disagrees")
    minima = intermediate_minima(out)
    if any(
        m["comparable_to_final"]
        and confs[0]["energy_hartree"] - m["energy_hartree"] > PRINTED_MIN_TOL
        for m in minima
    ):
        raise ValueError(
            "Issue #494: comparable lower-energy intermediate missing from final ensemble"
        )
    if "A new lower conformer was found!" in out:
        raise ValueError("Issue #494: outer-restart integrity is outside validated acceptance")
    return {
        "members": confs,
        "relative_kcal_mol": relative,
        "optimized_count": points,
        "duplicate_count": doubles,
        "rotamer_count": rotcount,
        "effective_ewin_kcal_mol": window,
        "restart_count": out.count("A new lower conformer was found!"),
        "intermediate_minima": minima,
    }


def _read(path, limit):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Unsafe or missing native file")
    with path.open("rb") as f:
        data = f.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Native evidence retention limit exceeded")
    return data


def _terminate(proc):
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGTERM)
    with contextlib.suppress(subprocess.TimeoutExpired):
        proc.wait(timeout=2)
    # Always clean remaining descendants even if the process leader exited first.
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGKILL)
    proc.wait(timeout=3)
    deadline = time.monotonic() + 3
    while True:
        try:
            os.killpg(proc.pid, 0)
        except ProcessLookupError:
            return
        if time.monotonic() >= deadline:
            raise ValueError("Owned CREST process group did not finish bounded cleanup")
        time.sleep(0.02)


def execute_native(document, executable, settings, *, calculation_id, on_tick=None, workdir=None):
    options = validate_input(document)
    executable = Path(executable).absolute()
    with executable.open("rb") as source:
        binary_digest = hashlib.file_digest(source, "sha256").hexdigest()
    if not executable.is_file() or binary_digest != document["engine_executable_sha256"]:
        raise ValueError("CREST executable digest is not the accepted build named by the input")

    def run(root):
        root.mkdir(parents=True, exist_ok=True)
        argv = command(executable, document)
        initial = xyz_input(document)
        (root / "input.xyz").write_bytes(initial)
        (root / "input.xyz").chmod(0o400)
        env = {
            "PATH": str(executable.parent) + os.pathsep + os.defpath,
            "HOME": str(root),
            "TMPDIR": str(root),
            "OMP_NUM_THREADS": "2",
            "OMP_THREAD_LIMIT": "2",
            "OMP_STACKSIZE": "128M",
            "OPENBLAS_NUM_THREADS": "1",
            "MKL_NUM_THREADS": "1",
            "VECLIB_MAXIMUM_THREADS": "1",
            "LC_ALL": "C",
        }
        inv = {
            "argv": argv,
            "environment": env,
            "normalized_input_sha256": digest(encode(document)),
            "executable_sha256": document["engine_executable_sha256"],
            "calculator": CALCULATOR,
            "calculation_id": calculation_id,
        }
        (root / "invocation.json").write_bytes(encode(inv))
        reason = None
        timed_out = False
        peak = 0
        snapshots = []
        seen = {}
        snapshot_bytes = 0
        started = time.monotonic()
        last_tick = started
        last_snapshot = 0
        with (root / "stdout.txt").open("wb") as out, (root / "stderr.txt").open("wb") as err:
            proc = subprocess.Popen(
                argv, cwd=root, env=env, stdout=out, stderr=err, start_new_session=True
            )
            try:
                while proc.poll() is None:
                    now = time.monotonic()
                    size = 0
                    for base, _dirs, files in os.walk(root, followlinks=False):
                        for n in files:
                            p = Path(base) / n
                            if p.is_symlink():
                                reason = "unsafe native symlink"
                                break
                            with contextlib.suppress(FileNotFoundError):
                                size += p.stat().st_size
                    peak = max(peak, size)
                    if size > settings.crest_max_scratch_bytes:
                        reason = "scratch resource limit"
                    if any(
                        (root / n).stat().st_size > settings.crest_max_output_bytes
                        for n in ("stdout.txt", "stderr.txt")
                    ):
                        reason = "live output resource limit"
                    if shutil.disk_usage(root).free < settings.crest_min_free_bytes:
                        reason = "free disk resource limit"
                    if now - started > min(
                        options.timeout_seconds, settings.crest_timeout_seconds, 3600
                    ):
                        reason = "wall timeout"
                        timed_out = True
                    if on_tick and now - last_tick >= 0.5:
                        last_tick = now
                        try:
                            if on_tick() is False:
                                reason = "canceled or lease lost"
                        except Exception:
                            reason = "heartbeat callback failed"
                    if now - last_snapshot >= 0.3:
                        last_snapshot = now
                        for p in sorted(root.glob("crest_rotamers_*.xyz")) + list(
                            root.glob(".history.xyz")
                        ):
                            if p.is_file() and not p.is_symlink():
                                try:
                                    data = _read(p, settings.crest_max_output_bytes)
                                except (ValueError, FileNotFoundError):
                                    if not p.exists():
                                        continue
                                    reason = "intermediate evidence retention limit"
                                    break
                                h = digest(data)
                                if seen.get(p.name) != h:
                                    seen[p.name] = h
                                    snapshot_bytes += len(data)
                                    if (
                                        snapshot_bytes
                                        > min(
                                            settings.crest_max_retained_bytes // 4, 16 * 1024 * 1024
                                        )
                                        or len(snapshots) >= 128
                                    ):
                                        reason = "intermediate evidence retention limit"
                                        break
                                    snapshots.append((p.name, now - started, h, data))
                    if shutdown_signal() is not None:
                        reason = f"worker shutdown: {signal.Signals(shutdown_signal()).name}"
                    if reason:
                        break
                    time.sleep(0.1)
            finally:
                _terminate(proc)
        if shutdown_signal() is not None:
            reason = f"worker shutdown: {signal.Signals(shutdown_signal()).name}"
        complete = reason is None
        raw = {}
        retained = 0
        omitted = []
        candidates = [p for p in sorted(root.iterdir()) if p.is_file() and not p.is_symlink()]
        # Retain scientific finals and logs before other bounded root diagnostics.
        candidates.sort(key=lambda p: (p.name not in REQUIRED, p.name))
        for p in candidates:
            try:
                if len(raw) >= 120:
                    raise ValueError("native artifact count limit")
                data = _read(p, settings.crest_max_output_bytes)
                if retained + len(data) > settings.crest_max_retained_bytes:
                    raise ValueError("aggregate retention limit")
                raw[p.name] = data
                retained += len(data)
            except ValueError:
                omitted.append(p.name)
                complete = False
        if snapshots:
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
                index = []
                for i, (name, elapsed, h, data) in enumerate(snapshots):
                    key = f"{i:04d}-{name}"
                    z.writestr(key, data)
                    index.append(
                        {"entry": key, "source": name, "elapsed_seconds": elapsed, "sha256": h}
                    )
                z.writestr("index.json", encode(index))
            snapshot_archive = archive.getvalue()
            if retained + len(snapshot_archive) > settings.crest_max_retained_bytes:
                complete = False
                omitted.append("intermediate-snapshots.zip")
            else:
                raw["intermediate-snapshots.zip"] = snapshot_archive
        status = {
            "exit_code": proc.returncode,
            "termination_reason": reason,
            "evidence_complete": complete,
            "omitted_files": omitted,
            "elapsed_seconds": time.monotonic() - started,
            "peak_sampled_scratch_bytes": peak,
            "hard_memory_limit": False,
            "process_group_cleanup": True,
        }
        raw["execution.json"] = encode(status)
        (root / "execution.json").write_bytes(raw["execution.json"])
        candidate = None
        if proc.returncode == 0 and complete and not reason:
            try:
                parsed = parse_evidence(raw, document)
                candidate = {
                    "schema": "chemdft.worker.conformer-ensemble",
                    "task": "CONFORMER_SEARCH",
                    "engine": "crest",
                    "engine_version": VERSION,
                    "adapter_version": "1.0.0",
                    "method": "gfn2",
                    "basis": None,
                    "charge": document["charge"],
                    "multiplicity": 1,
                    "search_completed": True,
                    "ensemble": parsed,
                    "environment": {
                        "engine": "crest",
                        "engine_version": VERSION,
                        "executable_sha256": document["engine_executable_sha256"],
                        "calculator": CALCULATOR,
                        "libraries": {"tblite": "0.3.0-fork"},
                        "architecture": os.uname().machine,
                    },
                }
            except (ValueError, KeyError, TypeError) as error:
                raw["validation-error.txt"] = str(error).encode()
        return ExecutionResult(
            exit_code=proc.returncode,
            timed_out=timed_out,
            stdout=b"",
            stderr=b"",
            engine_log=b"",
            result_document=candidate,
            native_artifacts=raw,
        )

    with crest_shutdown_scope():
        if workdir is not None:
            return run(Path(workdir))
        with tempfile.TemporaryDirectory(prefix="chemdft-crest-") as tmp:
            return run(Path(tmp))
