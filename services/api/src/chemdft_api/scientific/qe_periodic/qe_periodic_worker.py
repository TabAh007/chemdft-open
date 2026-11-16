# Proprietary to ChemDFT. All rights reserved.
"""Quantum ESPRESSO periodic DFT worker (plane waves, SSSP PBE Efficiency v2.0).

Quantum ESPRESSO is GPL-2.0-or-later. It is ONLY ever started here as separate programs (pw.x, projwfc.x, dos.x, bands.x:
files in, files out); no QE library is linked, no QE or pseudopotential file is shipped with ChemDFT. The pseudopotential
files are fetched at image build time and keep their own licences.

Stages (each optional stage reuses the converged SCF/relax state, exactly as the owner's verified pipeline does):
  scf | relax -> projwfc (Lowdin local moments) -> [copy; nscf -> dos.x -> projwfc PDOS] -> [copy; bands -> bands.x per spin]
Runs as one isolated subprocess like pyscf_periodic_worker.py: --input / --result / --log, exit 0 only if converged.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import fields
from pathlib import Path

try:
    from . import qe_inputs as inputs
    from . import qe_limits as limits_module
    from . import qe_parsers as parsers
except ImportError:  # run as a script by the isolated worker
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import qe_inputs as inputs  # type: ignore[no-redef]
    import qe_limits as limits_module  # type: ignore[no-redef]
    import qe_parsers as parsers  # type: ignore[no-redef]

SCHEMA = "chemdft.worker.periodic-energy"
LOG_KEEP = re.compile(
    r"(^!|total energy|convergence has been achieved|Final energy|bfgs converged|Total force|number of k points|"
    r"Program PWSCF|Program PROJWFC|JOB DONE|Begin final|End final|End of BFGS|ATOMIC_POSITIONS|"
    r"maximum number of steps|convergence NOT achieved|Sym\. Ops|Hubbard|ortho-atomic|polarization|Atom #)"
)


class StageError(RuntimeError):
    """A stage failed; the message is plain language and is shown to the researcher."""


class StageTimeout(StageError):
    pass


def _limits_from(document: dict) -> limits_module.QeLimits:
    raw = document.get("qe_limits") or {}
    names = {f.name for f in fields(limits_module.QeLimits)}
    return limits_module.QeLimits(**{k: v for k, v in raw.items() if k in names})


def _kill_group(proc: subprocess.Popen) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGKILL)


class Runner:
    def __init__(
        self, scratch: Path, log_path: Path, bin_dir: Path | None, limits: limits_module.QeLimits
    ) -> None:
        self.scratch = scratch
        self.log_path = log_path
        self.bin_dir = bin_dir
        self.limits = limits
        self.started = time.monotonic()
        count = os.cpu_count() or 1
        with contextlib.suppress(AttributeError, OSError):
            count = len(os.sched_getaffinity(0))
        self.vcpus = max(1, min(count, limits.vcpus))
        self.env = {
            "PATH": os.pathsep.join(
                ([str(bin_dir)] if bin_dir else []) + ["/usr/local/bin", "/usr/bin", "/bin"]
            ),
            "OMP_NUM_THREADS": "1",
            "OPENBLAS_NUM_THREADS": "1",
            "HOME": str(scratch),
            "TMPDIR": str(scratch),
            "LC_ALL": "C",
            # Containers without CAP_SYS_PTRACE: tell Open MPI not to try cross-memory attach.
            "OMPI_MCA_btl_vader_single_copy_mechanism": "none",
            "OMPI_MCA_rmaps_base_oversubscribe": "1",
        }

    def exe(self, name: str) -> str:
        if self.bin_dir and (self.bin_dir / name).is_file():
            return str(self.bin_dir / name)
        found = shutil.which(name, path=self.env["PATH"])
        if not found:
            raise StageError(
                f"Quantum ESPRESSO program '{name}' was not found on this compute image."
            )
        return found

    def remaining(self) -> float:
        return self.limits.timeout_total_s - (time.monotonic() - self.started)

    def run(
        self,
        label: str,
        argv: list[str],
        stdout: Path,
        stage_timeout: int,
        *,
        stdin: Path | None = None,
    ) -> None:
        budget = min(float(stage_timeout), self.remaining())
        if budget <= 1:
            raise StageTimeout(
                f"The whole-job time cap of {self.limits.timeout_total_s // 60} min was reached before {label}."
            )
        with stdout.open("wb") as out, stdin.open("rb") if stdin else open(os.devnull, "rb") as inp:
            proc = subprocess.Popen(
                argv,
                stdin=inp,
                stdout=out,
                stderr=subprocess.STDOUT,
                cwd=self.scratch,
                env=self.env,
                start_new_session=True,
            )
            try:
                proc.wait(timeout=budget)
            except subprocess.TimeoutExpired:
                _kill_group(proc)
                proc.wait(timeout=10)
                raise StageTimeout(
                    f"{label} exceeded its {int(budget // 60)} min limit and was stopped."
                ) from None
            finally:
                if proc.poll() is None:
                    _kill_group(proc)
        if proc.returncode != 0:
            tail = stdout.read_text(errors="replace")[-600:].strip().replace("\n", " | ")
            raise StageError(f"{label} stopped with exit code {proc.returncode}: {tail}")

    def mpi(self, program: str, input_file: Path, stdout: Path, label: str, timeout: int) -> None:
        argv = [
            self.exe("mpirun"),
            "--use-hwthread-cpus",
            "-np",
            str(self.vcpus),
            self.exe(program),
            "-in",
            str(input_file),
        ]
        self.run(label, argv, stdout, timeout)

    def serial(
        self, program: str, input_file: Path, stdout: Path, label: str, timeout: int
    ) -> None:
        self.run(label, [self.exe(program), "-in", str(input_file)], stdout, timeout)

    def log(self, text: str) -> None:
        with self.log_path.open("a", encoding="utf-8") as stream:
            stream.write(text.rstrip("\n") + "\n")


def condense(text: str, label: str) -> str:
    kept = [line for line in text.splitlines() if LOG_KEEP.search(line)]
    lines = text.splitlines()
    forces = [i for i, line in enumerate(lines) if "Forces acting on atoms" in line]
    if forces:
        block = lines[forces[-1] : forces[-1] + 400]
        kept += [
            line
            for line in block
            if re.match(r"^\s*(atom\s+\d+\s+type|Forces acting|Total force)", line)
        ]
    return f"=== {label} ===\n" + "\n".join(kept) + "\n"


def delete_wavefunctions(*roots: Path) -> int:
    removed = 0
    for root in roots:
        if not root.exists():
            continue
        for path in list(root.rglob("*")):
            name = path.name
            if path.is_file() and (
                name.startswith("wfc") or ".wfc" in name or name.endswith(".wfc")
            ):
                with contextlib.suppress(OSError):
                    path.unlink()
                    removed += 1
    return removed


def _read(path: Path) -> str:
    if not path.is_file():
        raise StageError(f"Expected output {path.name} was not written.")
    return path.read_text(errors="replace")


def _engine_version(pw_out: str) -> str | None:
    match = re.search(r"Program PWSCF\s+v\.?\s*([0-9][0-9.A-Za-z]*)", pw_out)
    return match.group(1) if match else None


def run(input_path: Path, result_path: Path, log_path: Path, steps_path: Path | None = None) -> int:
    del steps_path
    started = time.monotonic()
    document = json.loads(input_path.read_text())
    if document.get("task") != "PERIODIC_ENERGY":
        raise ValueError("The Quantum ESPRESSO worker only runs PERIODIC_ENERGY.")
    model = inputs.build_model(document)
    options = document.get("periodic") or {}
    limits = _limits_from(document)
    scf_mesh = tuple(int(k) for k in options.get("k_mesh", (1, 1, 1)))
    want_relax = bool(options.get("relax"))
    want_dos = bool(options.get("dos"))
    want_bands = bool(options.get("bands"))
    dos_mesh = tuple(int(k) for k in options.get("dos_k_mesh", (6, 6, 6)))
    path = options.get("band_path") or {}
    path_points = [
        (p, w) for p, w in zip(path.get("points", []), path.get("weights", []), strict=False)
    ]
    band_points = sum(int(w) for _p, w in path_points[:-1]) + 1 if path_points else 0
    relax_steps = int(options.get("relax_max_steps", limits.relax_max_steps))
    reason = limits_module.refusal(
        limits,
        atoms=len(model.atoms),
        ecutwfc_ry=model.ecutwfc_ry,
        scf_mesh=scf_mesh,
        relax=want_relax,
        relax_max_steps=relax_steps,
        dos=want_dos,
        dos_mesh=dos_mesh,
        bands=want_bands,
        band_points=band_points,
        nspin=model.nspin,
    )
    if reason:
        raise ValueError(reason)

    pseudo_dir = os.environ.get("CHEMDFT_QE_PSEUDO_DIR") or str(
        document.get("qe_runtime", {}).get("pseudo_dir", "")
    )
    bin_value = os.environ.get("CHEMDFT_QE_BIN_DIR") or str(
        document.get("qe_runtime", {}).get("bin_dir", "")
    )
    bin_dir = Path(bin_value) if bin_value else None
    if not pseudo_dir or not Path(pseudo_dir).is_dir():
        raise StageError(
            "The SSSP pseudopotential directory is not available on this compute image."
        )
    for element, file in model.pseudo_files.items():
        if not (Path(pseudo_dir) / file).is_file():
            raise StageError(
                f"Pseudopotential file for {element} ({file}) is missing from the library directory."
            )

    scratch_root = os.environ.get("CHEMDFT_QE_SCRATCH")
    scratch = (
        Path(scratch_root)
        if scratch_root
        else Path(tempfile.mkdtemp(prefix="qe-", dir=os.environ.get("TMPDIR") or None))
    )
    scratch.mkdir(parents=True, exist_ok=True)
    out_scf, out_dos, out_bands = scratch / "out_scf", scratch / "out_dos", scratch / "out_bands"
    runner = Runner(scratch, log_path, bin_dir, limits)
    log_path.write_text("", encoding="utf-8")
    result: dict = {
        "schema": SCHEMA,
        "schema_version": "1.0.0",
        "engine": "qe",
        "adapter_version": "1.0.0",
        "task": "PERIODIC_ENERGY",
        "method": str(document.get("method", "pbe")).lower(),
        "basis": document.get("basis"),
        "pseudopotential": "SSSP PBE Efficiency v2.0",
        "charge": int(document.get("charge", 0) or 0),
        "multiplicity": int(document.get("multiplicity", 1) or 1),
        "k_mesh": list(scf_mesh),
        "magnetic_order": model.magnetic_order,
        "u_effective_ev": model.u_effective_ev,
        "used_default_u": model.used_default_u,
        "converged": False,
        "finite": False,
        "pseudopotential_files": model.pseudo_files,
        "pseudopotential_libraries": model.libraries,
        "cutoffs_ry": {"ecutwfc": model.ecutwfc_ry, "ecutrho": model.ecutrho_ry},
        "local_moment_kind": "lowdin-projected",
        "stages_requested": {"relax": want_relax, "dos": want_dos, "bands": want_bands},
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "mpi_processes": runner.vcpus,
            "thread_settings": {"OMP_NUM_THREADS": "1"},
        },
    }
    positions: list[list[float]] | None = None
    species_to_element = {s.label: s.element for s in model.species}
    try:
        # ---- stage 1: scf or relax
        calculation = "relax" if want_relax else "scf"
        (scratch / "scf.in").write_text(
            inputs.write_pw_input(
                model,
                calculation=calculation,
                pseudo_dir=pseudo_dir,
                outdir=str(out_scf),
                k_mesh=scf_mesh,
                relax_max_steps=relax_steps,
            )
        )
        pw_out = scratch / "pw_scf.out"
        stage_timeout = limits.timeout_relax_s if want_relax else limits.timeout_scf_s
        try:
            runner.mpi("pw.x", scratch / "scf.in", pw_out, f"pw.x {calculation}", stage_timeout)
        finally:
            if pw_out.exists():
                runner.log(condense(pw_out.read_text(errors="replace"), f"pw.x {calculation}"))
        text = _read(pw_out)
        scf = parsers.parse_scf_stdout(text)
        result["engine_version"] = _engine_version(text) or "unknown"
        if want_relax:
            relax = parsers.parse_relax_stdout(text)
            if not relax["converged"]:
                result["failure_reason"] = (
                    "The relaxation did not converge within "
                    f"{relax_steps} ionic steps; nothing is published as a relaxed structure."
                    if relax["hit_step_limit"]
                    else "The relaxation did not converge (BFGS did not report convergence)."
                )
                _write(result_path, result)
                return 3
            if len(relax["final_positions_crystal"]) != len(model.atoms):
                raise StageError("The final atomic positions of the relaxation could not be read.")
            positions = [pos for _label, pos in relax["final_positions_crystal"]]
            result["relaxation"] = {
                "converged": True,
                "ionic_steps": relax["bfgs_steps"],
                "scf_cycles": relax["scf_cycles"],
                "initial_energy_hartree": relax["initial_energy_ry"] * 0.5,
                "final_energy_hartree": relax["final_energy_ry"] * 0.5,
                "max_force_ry_per_bohr": relax["max_force_ry_bohr"],
                "total_force_ry_per_bohr": relax["total_force_ry_bohr"],
                "force_threshold_ry_per_bohr": inputs.RELAX_FORC_CONV_THR,
                "energy_threshold_ry": inputs.RELAX_ETOT_CONV_THR,
                "max_steps": relax_steps,
                "final_positions": [
                    {
                        "index": i,
                        "element": a["element"],
                        "species": a["species"],
                        "fractional": positions[i],
                    }
                    for i, a in enumerate(model.atoms)
                ],
            }
            scf["converged"] = scf["converged"] or bool(relax["converged"])
        if not scf["converged"]:
            result["failure_reason"] = (
                "The SCF cycle did not reach convergence (QE did not print 'convergence has been achieved')."
            )
            _write(result_path, result)
            return 3
        if want_relax:
            # Release 0.0.46: every scalar of a relaxation must describe the FINAL geometry. The relax run's
            # data-file-schema.xml gave the first ionic step's energy (live job 1865196f: -475.9996218696 Ha = first "!" / 2,
            # while the log's final energy was -475.99968609 Ha), so it is not trusted. One fixed-geometry scf at the relaxed
            # positions (same settings, fresh outdir) supplies energy, gap, Fermi level, magnetization, k-points and the
            # state projwfc/DOS/bands continue from, and it is cross-checked against the relax log's final energy.
            relax_final_ha = relax["final_energy_ry"] * 0.5
            shutil.rmtree(out_scf, ignore_errors=True)
            (scratch / "scf_final.in").write_text(
                inputs.write_pw_input(
                    model,
                    calculation="scf",
                    pseudo_dir=pseudo_dir,
                    outdir=str(out_scf),
                    k_mesh=scf_mesh,
                    positions=positions,
                )
            )
            final_out = scratch / "pw_scf_final.out"
            try:
                runner.mpi(
                    "pw.x",
                    scratch / "scf_final.in",
                    final_out,
                    "pw.x scf (relaxed geometry)",
                    limits.timeout_scf_s,
                )
            finally:
                if final_out.exists():
                    runner.log(
                        condense(final_out.read_text(errors="replace"), "pw.x scf (relaxed geometry)")
                    )
            scf = parsers.parse_scf_stdout(_read(final_out))
            if not scf["converged"] or scf["total_energy_ry"] is None:
                raise StageError(
                    "The fixed-geometry scf at the relaxed structure did not converge; nothing is published."
                )
            check = parsers.check_final_energy_agreement(
                relax_final_ha, scf["total_energy_ry"] * 0.5
            )
            result["relaxation"]["final_scf_energy_hartree"] = scf["total_energy_ry"] * 0.5
            result["relaxation"]["final_scf_minus_relax_hartree"] = check
        xml = parsers.parse_xml(_read(out_scf / f"{inputs.PREFIX}.save" / "data-file-schema.xml"))
        energy = xml["total_energy_hartree"]
        # the xml of the final scf must agree with that scf's own printed energy
        if want_relax and abs(energy - scf["total_energy_ry"] * 0.5) > 1e-7:
            raise StageError(
                "The saved result of the relaxed-geometry scf does not match its own log; nothing is published."
            )
        result.update(
            {
                "converged": True,
                "finite": energy == energy and abs(energy) != float("inf"),
                "total_energy_hartree": energy,
                "scf_iterations": scf["scf_iterations"],
                "irreducible_k_points": scf["irreducible_k_points"],
                "band_gap_ev": xml["band_gap_ev"],
                "fermi_energy_ev": xml["fermi_energy_ev"],
                "total_magnetization": xml["total_magnetization"],
                "absolute_magnetization": xml["absolute_magnetization"],
            }
        )
        # ---- stage 2: Lowdin local moments (projwfc.x on the converged state); skipped when nothing is magnetic
        moments: dict[str, float] = {}
        if model.sublattice_signs:
            (scratch / "projwfc_scf.in").write_text(
                inputs.write_projwfc_input(outdir=str(out_scf), filpdos=str(scratch / "scf_pdos"))
            )
            pj = scratch / "projwfc_scf.out"
            runner.mpi(
                "projwfc.x",
                scratch / "projwfc_scf.in",
                pj,
                "projwfc.x (Lowdin moments)",
                limits.timeout_nscf_dos_s,
            )
            lowdin = parsers.parse_projwfc_lowdin(_read(pj))
            for index in model.sublattice_signs:
                entry = lowdin.get(index + 1)
                if entry is None or "polarization" not in entry:
                    raise StageError(
                        "projwfc.x did not report a Lowdin polarization for every magnetic atom."
                    )
                moments[str(index)] = entry["polarization"]
            runner.log(condense(pj.read_text(errors="replace"), "projwfc.x Lowdin"))
        result["local_magnetic_moments"] = moments
        if not model.sublattice_signs:
            result["total_magnetization"] = (
                result["total_magnetization"] if model.nspin == 2 else 0.0
            )
        delete_wavefunctions(out_scf)

        # ---- stage 3: DOS and projected DOS
        if want_dos:
            shutil.copytree(out_scf, out_dos)
            (scratch / "nscf.in").write_text(
                inputs.write_pw_input(
                    model,
                    calculation="nscf",
                    pseudo_dir=pseudo_dir,
                    outdir=str(out_dos),
                    k_mesh=dos_mesh,
                    positions=positions,
                )
            )
            nscf_out = scratch / "pw_nscf.out"
            try:
                runner.mpi(
                    "pw.x",
                    scratch / "nscf.in",
                    nscf_out,
                    "pw.x nscf (DOS mesh)",
                    limits.timeout_nscf_dos_s,
                )
            finally:
                if nscf_out.exists():
                    runner.log(condense(nscf_out.read_text(errors="replace"), "pw.x nscf"))
            nscf_xml = parsers.parse_xml(
                _read(out_dos / f"{inputs.PREFIX}.save" / "data-file-schema.xml")
            )
            (scratch / "dos.in").write_text(
                inputs.write_dos_input(outdir=str(out_dos), fildos=str(scratch / "chemdft.dos"))
            )
            runner.serial(
                "dos.x", scratch / "dos.in", scratch / "dos.out", "dos.x", limits.timeout_nscf_dos_s
            )
            (scratch / "projwfc_dos.in").write_text(
                inputs.write_projwfc_input(outdir=str(out_dos), filpdos=str(scratch / "nscf_pdos"))
            )
            runner.mpi(
                "projwfc.x",
                scratch / "projwfc_dos.in",
                scratch / "projwfc_dos.out",
                "projwfc.x (PDOS)",
                limits.timeout_nscf_dos_s,
            )
            dos = parsers.parse_dos_file(_read(scratch / "chemdft.dos"))
            pdos_files = {
                p.name: p.read_text(errors="replace") for p in scratch.glob("nscf_pdos.pdos_atm#*")
            }
            payload = parsers.build_dos_payload(dos, pdos_files, species_to_element)
            payload.update(
                {
                    "k_mesh": list(dos_mesh),
                    "gap_from_eigenvalues_ev": nscf_xml["band_gap_ev"],
                    "irreducible_k_points": parsers.parse_scf_stdout(_read(nscf_out))[
                        "irreducible_k_points"
                    ],
                    "gap_note": "Gap from the eigenvalues of this k-mesh, never read from the broadened DOS curve.",
                }
            )
            result["dos"] = payload
            delete_wavefunctions(out_dos)
            shutil.rmtree(out_dos, ignore_errors=True)

        # ---- stage 4: band structure along the k-path
        if want_bands:
            shutil.copytree(out_scf, out_bands)
            (scratch / "bands.in").write_text(
                inputs.write_pw_input(
                    model,
                    calculation="bands",
                    pseudo_dir=pseudo_dir,
                    outdir=str(out_bands),
                    k_path=path_points,
                    positions=positions,
                )
            )
            b_out = scratch / "pw_bands.out"
            try:
                runner.mpi(
                    "pw.x", scratch / "bands.in", b_out, "pw.x bands", limits.timeout_bands_s
                )
            finally:
                if b_out.exists():
                    runner.log(condense(b_out.read_text(errors="replace"), "pw.x bands"))
            spin_files = {}
            for spin_component, name in (
                ((1, "up"), (2, "dn")) if model.nspin == 2 else ((None, "up"),)
            ):
                filband = scratch / f"bands_{name}.dat"
                (scratch / f"bandsx_{name}.in").write_text(
                    inputs.write_bands_input(
                        outdir=str(out_bands), filband=str(filband), spin_component=spin_component
                    )
                )
                runner.serial(
                    "bands.x",
                    scratch / f"bandsx_{name}.in",
                    scratch / f"bandsx_{name}.out",
                    f"bands.x ({name})",
                    limits.timeout_bands_s,
                )
                spin_files[name] = parsers.parse_bands_file(_read(filband))
            first = spin_files["up"]
            distances = parsers.parse_bands_gnu_distances(
                _read(scratch / "bands_up.dat.gnu"), first["nks"]
            )
            result["bands"] = parsers.build_bands_payload(
                first,
                spin_files.get("dn"),
                distances,
                float(result["fermi_energy_ev"]),
                path.get("labels", []),
                path.get("weights", []),
            )
            result["bands"].update(
                {
                    "path_source": path.get("source"),
                    "gap_note": "Gap along the chosen path only; it is not the global gap of the crystal.",
                }
            )
            delete_wavefunctions(out_bands)
            shutil.rmtree(out_bands, ignore_errors=True)
    except (StageError, parsers.QeParseError) as error:
        result["failure_reason"] = str(error)
        result["converged"] = False
        runner.log(f"STAGE FAILURE: {error}")
        result["runtime_seconds"] = time.monotonic() - started
        _write(result_path, result)
        return 3
    finally:
        delete_wavefunctions(out_scf, out_dos, out_bands)
    result["runtime_seconds"] = time.monotonic() - started
    _write(result_path, result)
    return 0


def _write(path: Path, result: dict) -> None:
    path.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    parser.add_argument("--log", required=True, type=Path)
    parser.add_argument("--steps", type=Path)
    args = parser.parse_args()
    try:
        return run(args.input, args.result, args.log, args.steps)
    except Exception as error:  # the message reaches the researcher through stderr
        print(f"worker_error:{type(error).__name__}:{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
