# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
# Periodic DFT isolated scientific worker (PySCF PBC single-point energy and electronic structure).
from __future__ import annotations

import argparse
import json
import math
import os
import platform
import sys
import time
from pathlib import Path

DEFAULT_U_EFF = {
    "V": 3.25,
    "Cr": 3.7,
    "Mn": 3.9,
    "Fe": 5.3,
    "Co": 3.32,
    "Ni": 6.2,
}


def run(
    input_path: Path,
    result_path: Path,
    log_path: Path,
    steps_path: Path | None = None,
) -> int:
    del steps_path
    start_time = time.monotonic()

    import numpy
    import scipy
    from pyscf import __version__ as pyscf_version
    from pyscf import lib
    from pyscf.pbc import dft, gto, scf

    # Ensure scratch directory is respected
    scratch_dir = os.environ.get("PYSCF_TMPDIR") or os.environ.get("TMPDIR")
    if scratch_dir:
        lib.param.TMPDIR = scratch_dir

    document = json.loads(input_path.read_text())
    task = document.get("task", "")
    if task != "PERIODIC_ENERGY":
        raise ValueError(
            f"Task '{task}' unsupported by periodic worker (expected PERIODIC_ENERGY)."
        )

    periodic_cell = document.get("periodic_cell")
    if not periodic_cell:
        raise ValueError("Periodic calculation input requires valid periodic_cell.")
    raw_lattice = (
        periodic_cell.get("lattice_vectors")
        or periodic_cell.get("lattice_vectors_angstrom")
    )
    if not raw_lattice:
        raise ValueError("Periodic calculation input requires valid periodic_cell lattice_vectors.")

    lattice_vectors = numpy.array(raw_lattice, dtype=float)
    atoms_data = document.get("atoms", [])
    if not atoms_data:
        raise ValueError("Calculation requires at least one atom in the periodic unit cell.")

    atom_list = []
    for item in atoms_data:
        if isinstance(item, dict):
            el = str(item.get("element") or item.get("symbol"))
            xyz = tuple(item.get("xyz_angstrom") or item.get("coords") or [0.0, 0.0, 0.0])
            atom_list.append((el, xyz))
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            atom_list.append((str(item[0]), tuple(item[1])))
        else:
            raise ValueError(f"Unrecognized atom format in periodic input: {item}")
    cell = gto.Cell()
    cell.a = lattice_vectors
    cell.atom = atom_list
    cell.basis = document.get("basis") or "gth-dzvp-molopt-sr"
    cell.pseudo = document.get("pseudopotential") or "gth-pbe"
    cell.spin = 0

    periodic_opts = document.get("periodic") or {}
    cell.exp_to_discard = float(periodic_opts.get("exp_to_discard", 0.1))
    cell.max_memory = int(document.get("max_memory_mb", 5500))
    cell.verbose = 4
    cell.output = str(log_path)
    cell.build()

    k_mesh = periodic_opts.get("k_mesh", [1, 1, 1])
    if isinstance(k_mesh, (list, tuple)) and len(k_mesh) == 3:
        k_mesh_list = [int(k) for k in k_mesh]
    else:
        k_mesh_list = [1, 1, 1]
    kpts = cell.make_kpts(k_mesh_list)

    method = str(document.get("method", "pbe")).lower()
    is_plus_u = method == "pbe+u" or bool(periodic_opts.get("u_effective_ev"))

    # Resolve +U values
    u_eff_map: dict[str, float] = {}
    if is_plus_u:
        specified_u = periodic_opts.get("u_effective_ev") or {}
        for el, u_val in specified_u.items():
            u_eff_map[str(el)] = float(u_val)
        # If method is pbe+u and no explicit map was provided, check for transition metals present
        if not u_eff_map:
            for el, _xyz in atom_list:
                if el in DEFAULT_U_EFF and el not in u_eff_map:
                    u_eff_map[el] = DEFAULT_U_EFF[el]

    magnetic_order = str(periodic_opts.get("magnetic_order", "none")).lower()
    if magnetic_order not in ("none", "ferromagnetic", "antiferromagnetic"):
        magnetic_order = "none"

    # Engine initialization
    if is_plus_u and u_eff_map:
        from pyscf.pbc.dft import kukspu

        u_idx = [f"{el} 3d" for el in sorted(u_eff_map.keys())]
        u_val = [u_eff_map[el] for el in sorted(u_eff_map.keys())]
        mf = kukspu.KUKSpU(cell, kpts, U_idx=u_idx, U_val=u_val).density_fit()
    elif magnetic_order in ("ferromagnetic", "antiferromagnetic"):
        mf = dft.KUKS(cell, kpts).density_fit()
    else:
        mf = dft.KRKS(cell, kpts).density_fit()

    mf.xc = "pbe"
    max_cycle = int(periodic_opts.get("max_cycle", 80))
    conv_tol = float(periodic_opts.get("convergence_threshold", 1e-6))
    mf.max_cycle = max_cycle
    mf.conv_tol = conv_tol

    smearing_sigma = float(periodic_opts.get("smearing_sigma_ha", 0.005))
    smearing_method = str(periodic_opts.get("smearing_method", "fermi")).lower()
    mf = scf.addons.smearing_(mf, sigma=smearing_sigma, method=smearing_method)

    # Initial guess & symmetry breaking
    transition_metals = ("V", "Cr", "Mn", "Fe", "Co", "Ni")
    mag_indices = [i for i, (el, _xyz) in enumerate(atom_list) if el in transition_metals]

    if magnetic_order in ("antiferromagnetic", "ferromagnetic") and mag_indices:
        axis = lattice_vectors.sum(0)
        axis_norm = numpy.linalg.norm(axis)
        axis = axis / axis_norm if axis_norm > 1e-8 else numpy.array([0.0, 0.0, 1.0])

        coords = numpy.array([xyz for _el, xyz in atom_list])
        order = sorted(mag_indices, key=lambda idx: float(coords[idx] @ axis))

        if magnetic_order == "antiferromagnetic":
            sign = {idx: (1 if k % 2 == 0 else -1) for k, idx in enumerate(order)}
        else:
            sign = {idx: 1 for idx in order}

        dm = mf.get_init_guess(key="minao")
        for idx, sg in sign.items():
            el = atom_list[idx][0]
            ao_indices = cell.search_ao_label(f"{idx} {el} 3d")
            if len(ao_indices) == 0:
                continue
            dn = 1 if sg > 0 else 0
            up = 1 - dn
            for k in range(dm.shape[1]):
                blk = dm[dn, k][numpy.ix_(ao_indices, ao_indices)].copy()
                dm[up, k][numpy.ix_(ao_indices, ao_indices)] += blk
                dm[dn, k][numpy.ix_(ao_indices, ao_indices)] = 0
        energy = float(mf.kernel(dm0=dm))
    else:
        energy = float(mf.kernel())

    runtime_seconds = float(time.monotonic() - start_time)
    converged = bool(mf.converged)
    finite = math.isfinite(energy)

    band_gap_ev: float | None = None
    moments: dict[str, float] = {}
    total_magnetization: float | None = None

    if converged and finite:
        try:
            mo_e = numpy.array(mf.mo_energy)
            occ = numpy.array(mf.mo_occ)
            occupied = mo_e[occ > 0.5]
            unoccupied = mo_e[occ <= 0.5]
            if len(occupied) > 0 and len(unoccupied) > 0:
                vbm = float(occupied.max())
                cbm = float(unoccupied.min())
                band_gap_ev = float((cbm - vbm) * 27.211386245988)
        except Exception:
            band_gap_ev = None

        if hasattr(mf, "make_rdm1") and magnetic_order in ("antiferromagnetic", "ferromagnetic"):
            try:
                dmf = mf.make_rdm1()
                s = mf.get_ovlp()
                pop = [numpy.einsum("kij,kji->i", dmf[x], s).real / len(kpts) for x in (0, 1)]
                spin_diff = pop[0] - pop[1]
                for idx in mag_indices:
                    sl = cell.aoslice_by_atom()[idx]
                    moments[str(idx)] = float(spin_diff[sl[2]:sl[3]].sum())
                total_magnetization = float(spin_diff.sum())
            except Exception:
                moments = {}
                total_magnetization = None
        else:
            moments = {}
            total_magnetization = 0.0

    result = {
        "schema": "chemdft.worker.periodic-energy",
        "schema_version": "1.0.0",
        "engine": "pyscf",
        "engine_version": pyscf_version,
        "adapter_version": "1.0.0",
        "task": "PERIODIC_ENERGY",
        "method": method,
        "basis": cell.basis,
        "pseudopotential": cell.pseudo,
        "charge": int(document.get("charge", 0)),
        "multiplicity": int(document.get("multiplicity", 1)),
        "spin": int(cell.spin),
        "k_mesh": k_mesh_list,
        "magnetic_order": magnetic_order,
        "u_effective_ev": u_eff_map,
        "converged": converged,
        "total_energy_hartree": energy,
        "finite": finite,
        "scf_iterations": getattr(mf, "cycles", None),
        "band_gap_ev": band_gap_ev,
        "local_magnetic_moments": moments,
        "total_magnetization": total_magnetization,
        "runtime_seconds": runtime_seconds,
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "libraries": {
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
            },
            "thread_settings": {
                "OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1"),
            },
        },
    }

    result_path.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if converged and finite else 3


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    parser.add_argument("--log", required=True, type=Path)
    parser.add_argument("--steps", type=Path)
    args = parser.parse_args()
    try:
        return run(args.input, args.result, args.log, args.steps)
    except Exception as error:
        print(f"worker_error:{type(error).__name__}:{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
