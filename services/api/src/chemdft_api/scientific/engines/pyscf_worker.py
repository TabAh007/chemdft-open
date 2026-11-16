# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import argparse
import json
import math
import os
import platform
import sys
from datetime import UTC, datetime
from pathlib import Path


def run(input_path: Path, result_path: Path, log_path: Path, steps_path: Path | None = None) -> int:
    document = json.loads(input_path.read_text())
    if document["task"] == "PERIODIC_ENERGY":
        # Release 0.0.46: a crystal must never be run as a molecule (it was, when the host script
        # dispatched periodic jobs here). Periodic energies belong to pyscf_periodic_worker.py.
        raise ValueError(
            "This is the molecular PySCF worker and it cannot run a periodic crystal calculation; "
            "the periodic worker (pyscf_periodic_worker.py) must be used."
        )
    import numpy
    import scipy
    from pyscf import __version__ as pyscf_version
    from pyscf import dft, gto, scf

    if document["task"] == "THERMOCHEMISTRY":
        from thermo_worker import run_thermochemistry

        return run_thermochemistry(document, result_path, log_path)
    atom = [(item["element"], item["xyz_angstrom"]) for item in document["atoms"]]
    spin = int(document["multiplicity"]) - 1
    molecule = gto.M(
        atom=atom,
        unit="Angstrom",
        charge=int(document["charge"]),
        spin=spin,
        basis=document["basis"],
        output=str(log_path),
        verbose=4,
    )
    method = document["method"]
    if method == "hf":
        calculation = scf.RHF(molecule) if spin == 0 else scf.UHF(molecule)
    else:
        calculation = dft.RKS(molecule) if spin == 0 else dft.UKS(molecule)
        calculation.xc = method
    scf_options = document.get("scf") or {}
    if scf_options.get("max_iterations") is not None:
        calculation.max_cycle = int(scf_options["max_iterations"])
    if scf_options.get("convergence_threshold") is not None:
        calculation.conv_tol = float(scf_options["convergence_threshold"])
    if document["task"] == "VOLUMETRIC_FIELD":
        from electronic_fields import evaluate_field

        result = evaluate_field(molecule, document)
        result_path.write_text(
            json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False)
        )
        return 0
    if document["task"] == "TDDFT":
        from pyscf import tdscf

        if spin != 0:
            raise ValueError("TDDFT excited-state MVP supports closed-shell singlets only")
        scf_energy = float(calculation.kernel())
        if not calculation.converged or not math.isfinite(scf_energy):
            raise RuntimeError("Ground-state SCF did not converge before TDDFT")

        tddft_opts = document.get("tddft") or {}
        nstates = int(tddft_opts.get("nstates") or 10)
        td = tdscf.TDDFT(calculation)
        td.nstates = nstates
        if tddft_opts.get("conv_tol") is not None:
            td.conv_tol = float(tddft_opts["conv_tol"])
        td.kernel()

        nocc = int(numpy.count_nonzero(calculation.mo_occ > 0))
        nvir = int(len(calculation.mo_occ) - nocc)
        td_converged = [bool(c) for c in td.converged]
        all_converged = bool(calculation.converged and all(td_converged))

        states = []
        xy_amplitudes = []
        oscillator_strengths = td.oscillator_strength(gauge="length")
        transition_dipoles = td.transition_dipole()

        for idx, (energy_val, f_val, dip_val, (x_mat, y_mat)) in enumerate(
            zip(td.e, oscillator_strengths, transition_dipoles, td.xy, strict=True)
        ):
            x_arr = numpy.asarray(x_mat, dtype=float)
            y_arr = numpy.asarray(y_mat, dtype=float)
            xy_amplitudes.append({"x": x_arr.tolist(), "y": y_arr.tolist()})

            dominant = []
            abs_x = numpy.abs(x_arr)
            indices = numpy.argsort(-abs_x, axis=None)
            for flat_idx in indices[:8]:
                occ_i, vir_a = numpy.unravel_index(flat_idx, abs_x.shape)
                mag = float(abs_x[occ_i, vir_a])
                if mag < 0.05 and dominant:
                    continue
                dominant.append(
                    {
                        "occupied_mo_index": int(occ_i),
                        "virtual_mo_index": int(nocc + vir_a),
                        "occupied_label": f"MO {occ_i + 1}",
                        "virtual_label": f"MO {nocc + vir_a + 1}",
                        "x": float(x_arr[occ_i, vir_a]),
                        "y": float(y_arr[occ_i, vir_a]),
                        "magnitude": mag,
                    }
                )

            eh = float(energy_val)
            ev = eh * 27.211386245988
            nm = 1239.8419843320025 / ev
            states.append(
                {
                    "index": idx,
                    "state_label": f"S{idx + 1}",
                    "energy_hartree": eh,
                    "energy_ev": ev,
                    "wavelength_nm": nm,
                    "oscillator_strength": float(f_val),
                    "oscillator_strength_gauge": "length",
                    "transition_dipole": [float(v) for v in dip_val],
                    "converged": bool(td_converged[idx]),
                    "dominant_transitions": dominant,
                }
            )

        homo_energy = float(calculation.mo_energy[nocc - 1])
        lumo_energy = float(calculation.mo_energy[nocc])
        result = {
            "schema": "chemdft.worker.tddft",
            "schema_version": "1.0.0",
            "task": "TDDFT",
            "engine": "pyscf",
            "engine_version": pyscf_version,
            "adapter_version": "1.0.0",
            "method": method,
            "basis": document["basis"],
            "charge": int(document["charge"]),
            "multiplicity": int(document["multiplicity"]),
            "converged": all_converged,
            "finite": math.isfinite(scf_energy) and all(s["energy_hartree"] > 0 for s in states),
            "total_scf_energy_hartree": scf_energy,
            "scf_iterations": getattr(calculation, "cycles", None),
            "nocc": nocc,
            "nvir": nvir,
            "homo_energy_hartree": homo_energy,
            "lumo_energy_hartree": lumo_energy,
            "excited_states": states,
            "xy_amplitudes": xy_amplitudes,
            "environment": {
                "python": platform.python_version(),
                "platform": platform.platform(),
                "architecture": platform.machine(),
                "libraries": {"numpy": numpy.__version__, "scipy": scipy.__version__},
                "thread_settings": {"OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1")},
            },
        }
        result_path.write_text(
            json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False)
        )
        return 0 if all_converged and result["finite"] else 3
    if document["task"] == "MO_GRID":
        grid = document["grid"]
        shape = tuple(int(value) for value in grid["dimensions"])
        if len(shape) != 3 or any(value < 2 or value > 96 for value in shape):
            raise ValueError("MO grid dimensions are outside supported bounds")
        if math.prod(shape) > 100_000:
            raise ValueError("MO grid exceeds the point limit")
        origin = numpy.asarray(grid["origin_angstrom"], dtype=float)
        spacing = float(grid["spacing_angstrom"])
        coefficients = numpy.asarray(document["mo_coefficients"], dtype=float)
        orbital_index = int(document["orbital_index"])
        if (
            origin.shape != (3,)
            or not numpy.isfinite(origin).all()
            or not math.isfinite(spacing)
            or spacing <= 0
            or coefficients.ndim != 2
            or coefficients.shape[0] != molecule.nao_nr()
            or orbital_index < 0
            or orbital_index >= coefficients.shape[1]
        ):
            raise ValueError("MO grid request has invalid coordinates or coefficients")
        axes = [
            origin[index] + numpy.arange(shape[index], dtype=float) * spacing for index in range(3)
        ]
        coordinates_angstrom = numpy.stack(numpy.meshgrid(*axes, indexing="ij"), axis=-1).reshape(
            -1, 3
        )
        field = numpy.empty(len(coordinates_angstrom), dtype=numpy.float32)
        coefficient = coefficients[:, orbital_index]
        for start in range(0, len(coordinates_angstrom), 4096):
            stop = min(start + 4096, len(coordinates_angstrom))
            ao = molecule.eval_gto("GTOval", coordinates_angstrom[start:stop] * 1.8897261254578281)
            field[start:stop] = ao @ coefficient
        if not numpy.isfinite(field).all():
            raise ValueError("PySCF produced non-finite molecular-orbital amplitudes")
        result = {
            "schema": "chemdft.worker.molecular-orbital-grid",
            "schema_version": "1.0.0",
            "task": "MO_GRID",
            "engine": "pyscf",
            "engine_version": pyscf_version,
            "grid_generator_version": "1.0.0",
            "orbital_index": orbital_index,
            "spin_channel": document["spin_channel"],
            "dimensions": list(shape),
            "origin_angstrom": origin.tolist(),
            "spacing_angstrom": spacing,
            "field_values": field.tolist(),
            "finite": True,
        }
        result_path.write_text(
            json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False)
        )
        return 0
    if document["task"] == "GEOMETRY_OPTIMIZATION":
        try:
            import geometric
            from pyscf.geomopt import geometric_solver
        except ImportError as exc:  # geomeTRIC is an optional extra, never a default dependency
            raise RuntimeError(
                "Geometry optimisation needs geomeTRIC, which ChemDFT does not install by default: "
                "its licence forbids use in AI-training datasets. Install the 'optimization' extra "
                "(uv sync --project services/scientific-worker --extra optimization) to enable it."
            ) from exc

        if steps_path is None:
            raise ValueError("Optimization requires a step output path")
        options = document["optimization"]
        params = {
            key: value
            for key, value in options.items()
            if key.startswith("convergence_") and value is not None
        }
        steps = []

        def record_step(envs):
            if not envs["g_scanner"].converged:
                raise RuntimeError("Electronic structure did not converge at optimizer evaluation")
            gradient = numpy.asarray(envs["gradients"], dtype=float)
            coords = numpy.asarray(envs["coords"], dtype=float).reshape(-1, 3)
            energy_value = float(envs["energy"])
            if (
                not numpy.isfinite(coords).all()
                or not numpy.isfinite(gradient).all()
                or not math.isfinite(energy_value)
            ):
                raise ValueError("Non-finite optimizer output")
            step = {
                "index": len(steps),
                "coordinates_angstrom": (coords * 0.52917721092).tolist(),
                "energy_hartree": energy_value,
                "gradient_norm_hartree_per_bohr": float(numpy.linalg.norm(gradient)),
                "gradient_rms_hartree_per_bohr": float(numpy.sqrt(numpy.mean(gradient**2))),
                "timestamp": datetime.now(UTC).isoformat(),
                "engine_cycle": int(envs["self"].cycle),
            }
            with steps_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(step, sort_keys=True, separators=(",", ":")) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            steps.append(step)

        converged, final_molecule = geometric_solver.kernel(
            calculation, callback=record_step, maxsteps=options["max_steps"], **params
        )
        result = {
            "schema": "chemdft.worker.optimization",
            "schema_version": "1.0.0",
            "task": "GEOMETRY_OPTIMIZATION",
            "engine": "pyscf",
            "engine_version": pyscf_version,
            "optimizer": "geometric",
            "optimizer_version": geometric.__version__,
            "adapter_version": "1.0.0",
            "method": method,
            "basis": document["basis"],
            "charge": document["charge"],
            "multiplicity": document["multiplicity"],
            "converged": bool(converged),
            "steps": steps,
            "final_coordinates_angstrom": final_molecule.atom_coords(unit="Angstrom").tolist(),
            "environment": {
                "python": platform.python_version(),
                "platform": platform.platform(),
                "architecture": platform.machine(),
                "libraries": {
                    "numpy": numpy.__version__,
                    "scipy": scipy.__version__,
                    "geometric": geometric.__version__,
                },
                "thread_settings": {"OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1")},
            },
        }
        result_path.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")))
        return 0 if converged else 3

    if document["task"] == "FREQUENCY":
        import numpy
        from pyscf.hessian import thermo

        if spin != 0 or document.get("hessian", {}).get("strategy") != "ANALYTIC":
            raise ValueError("Only closed-shell analytic PySCF Hessians are supported")
        energy = float(calculation.kernel())
        if not calculation.converged or not math.isfinite(energy):
            raise RuntimeError("SCF did not converge to a finite energy before Hessian")
        dm0 = calculation.make_rdm1()
        dipole_0 = [float(x) for x in calculation.dip_moment(unit="Debye", verbose=0)]

        hessian = numpy.asarray(calculation.Hessian().kernel(), dtype=float)
        analysis = thermo.harmonic_analysis(
            molecule, hessian, exclude_trans=True, exclude_rot=True, imaginary_freq=False
        )
        frequencies = numpy.asarray(analysis["freq_wavenumber"], dtype=float)
        modes = numpy.asarray(analysis["norm_mode"], dtype=float)
        masses = numpy.asarray(analysis["reduced_mass"], dtype=float)

        # Central finite-difference dipole differentiation
        # Validated parameters: delta = 0.0100 bohr
        # IUPAC prefactor = 42.2561 (km/mol) / ((Debye/Angstrom)^2 / amu)
        bohr_to_angstrom = 0.529177210903
        iupac_ir_prefactor = 42.2561
        delta_bohr = 0.0100

        natoms = molecule.natm
        coords_bohr = molecule.atom_coords()
        dmu_dr_bohr = numpy.zeros((natoms, 3, 3), dtype=float)

        for atom_idx in range(natoms):
            for axis_idx in range(3):
                # +delta displacement
                coords_plus = coords_bohr.copy()
                coords_plus[atom_idx, axis_idx] += delta_bohr
                mol_plus = molecule.copy()
                mol_plus.set_geom_(coords_plus, unit="Bohr")
                calc_plus = calculation.__class__(mol_plus)
                if hasattr(calculation, "xc"):
                    calc_plus.xc = calculation.xc
                calc_plus.kernel(dm0=dm0)
                if not calc_plus.converged:
                    raise RuntimeError(
                        f"Displaced SCF (+delta atom {atom_idx} axis {axis_idx}) failed to converge"
                    )
                mu_plus = calc_plus.dip_moment(unit="Debye", verbose=0)

                # -delta displacement
                coords_minus = coords_bohr.copy()
                coords_minus[atom_idx, axis_idx] -= delta_bohr
                mol_minus = molecule.copy()
                mol_minus.set_geom_(coords_minus, unit="Bohr")
                calc_minus = calculation.__class__(mol_minus)
                if hasattr(calculation, "xc"):
                    calc_minus.xc = calculation.xc
                calc_minus.kernel(dm0=dm0)
                if not calc_minus.converged:
                    raise RuntimeError(
                        f"Displaced SCF (-delta atom {atom_idx} axis {axis_idx}) failed to converge"
                    )
                mu_minus = calc_minus.dip_moment(unit="Debye", verbose=0)

                dmu_dr_bohr[atom_idx, axis_idx, :] = (mu_plus - mu_minus) / (2.0 * delta_bohr)

        # Convert Cartesian derivatives from Debye/bohr to Debye/Angstrom
        dmu_dr_ang = dmu_dr_bohr / bohr_to_angstrom

        # Project onto un-mass-weighted normal modes L_k (in amu^-1/2)
        ir_intensities = []
        for k in range(len(frequencies)):
            lk = modes[k]
            dmu_dq = numpy.zeros(3, dtype=float)
            for beta in range(3):
                dmu_dq[beta] = numpy.sum(lk * dmu_dr_ang[:, :, beta])
            intensity = float(iupac_ir_prefactor * numpy.sum(dmu_dq**2))
            ir_intensities.append(intensity)

        # Finite-field Raman activity calculation if requested
        raman_activities = None
        depolarization_ratios = None
        max_overall_antisym = None
        alpha_0_sym = None
        dalpha_dqs = []
        if document.get("raman") is not None:
            raman_opts = document["raman"]
            e0_au = float(raman_opts.get("electric_field_step_au", 0.0010))
            delta_q = float(
                raman_opts.get("polarizability_derivative_step_angstrom_amu_half", 0.0100)
            )
            antisym_tol = float(raman_opts.get("antisymmetry_tolerance", 1e-4))
            symmetrize = bool(raman_opts.get("symmetrize_polarizability", True))

            def compute_polarizability(geom_angstrom, dm_guess):
                m = molecule.copy()
                m.set_geom_(geom_angstrom, unit="Angstrom")
                calc = calculation.__class__(m)
                if hasattr(calculation, "xc"):
                    calc.xc = calculation.xc
                calc.kernel(dm0=dm_guess)
                if not calc.converged:
                    raise RuntimeError("SCF failed during polarizability calculation")
                dm_cur = calc.make_rdm1()
                r_ints = m.intor("int1e_r")
                hcore_base = calc.get_hcore()

                alpha_au = numpy.zeros((3, 3), dtype=float)
                for axis_j in range(3):
                    # +E0
                    cp = calculation.__class__(m)
                    if hasattr(calculation, "xc"):
                        cp.xc = calculation.xc
                    cp.get_hcore = lambda mol=None, j=axis_j: hcore_base + e0_au * r_ints[j]
                    cp.kernel(dm0=dm_cur)
                    if not cp.converged:
                        raise RuntimeError(
                            f"Field-perturbed SCF (+E0 axis {axis_j}) failed to converge"
                        )
                    mu_p = cp.dip_moment(unit="AU", verbose=0)

                    # -E0
                    cm = calculation.__class__(m)
                    if hasattr(calculation, "xc"):
                        cm.xc = calculation.xc
                    cm.get_hcore = lambda mol=None, j=axis_j: hcore_base - e0_au * r_ints[j]
                    cm.kernel(dm0=dm_cur)
                    if not cm.converged:
                        raise RuntimeError(
                            f"Field-perturbed SCF (-E0 axis {axis_j}) failed to converge"
                        )
                    mu_m = cm.dip_moment(unit="AU", verbose=0)

                    alpha_au[:, axis_j] = (mu_p - mu_m) / (2.0 * e0_au)

                alpha_ang = alpha_au * (bohr_to_angstrom**3)
                antisym = alpha_ang - alpha_ang.T
                max_asym = float(numpy.max(numpy.abs(antisym)))
                if max_asym > antisym_tol:
                    raise RuntimeError(
                        f"Polarizability tensor antisymmetry ({max_asym:.3e} A^3)"
                        f" exceeds tolerance ({antisym_tol:.3e} A^3)"
                    )
                alpha_ret = 0.5 * (alpha_ang + alpha_ang.T) if symmetrize else alpha_ang
                return alpha_ret, max_asym, dm_cur

            eq_coords = numpy.array(
                [item["xyz_angstrom"] for item in document["atoms"]], dtype=float
            )
            alpha_0_sym, max_overall_antisym, _ = compute_polarizability(eq_coords, dm0)

            raman_activities = []
            depolarization_ratios = []
            alpha_bar_prime_sq_list: list[float] = []
            gamma_prime_sq_list: list[float] = []
            for k in range(len(frequencies)):
                if frequencies[k] < 0:
                    raman_activities.append(0.0)
                    depolarization_ratios.append(0.75)
                    alpha_bar_prime_sq_list.append(0.0)
                    gamma_prime_sq_list.append(0.0)
                    dalpha_dqs.append(numpy.zeros((3, 3), dtype=float))
                    continue
                lk = modes[k]  # shape (natoms, 3) in amu^-1/2
                coords_p = eq_coords + delta_q * lk
                coords_m = eq_coords - delta_q * lk

                alpha_p, asym_p, _ = compute_polarizability(coords_p, dm0)
                alpha_m, asym_m, _ = compute_polarizability(coords_m, dm0)
                max_overall_antisym = max(max_overall_antisym, asym_p, asym_m)

                dalpha_dq = (alpha_p - alpha_m) / (2.0 * delta_q)
                dalpha_dqs.append(dalpha_dq)

                alpha_bar_prime = float(numpy.trace(dalpha_dq) / 3.0)
                gamma_prime_sq = float(
                    0.5
                    * (
                        (dalpha_dq[0, 0] - dalpha_dq[1, 1]) ** 2
                        + (dalpha_dq[1, 1] - dalpha_dq[2, 2]) ** 2
                        + (dalpha_dq[2, 2] - dalpha_dq[0, 0]) ** 2
                        + 6.0
                        * (
                            dalpha_dq[0, 1] ** 2
                            + dalpha_dq[1, 2] ** 2
                            + dalpha_dq[2, 0] ** 2
                        )
                    )
                )
                activity = float(45.0 * (alpha_bar_prime**2) + 7.0 * gamma_prime_sq)
                denom = 45.0 * (alpha_bar_prime**2) + 4.0 * gamma_prime_sq
                depol = float(3.0 * gamma_prime_sq / denom) if denom > 1e-15 else 0.75
                # Validate physical bounds with a tiny floating-point tolerance.
                # The Placzek formula guarantees rho_p in [0, 0.75] algebraically.
                # Values outside [-EPSILON, 0.75+EPSILON] are a computation error
                # and MUST hard-fail, not be silently clipped.
                _DEPOL_EPSILON = 1e-9
                if not (-_DEPOL_EPSILON <= depol <= 0.75 + _DEPOL_EPSILON):
                    raise RuntimeError(
                        f"Depolarization ratio {depol:.6f} is outside physical range "
                        f"[0, 0.75] by more than floating-point tolerance ({_DEPOL_EPSILON}). "
                        "This indicates a computation error in the Placzek formula."
                    )
                # Normalize floating-point boundary noise only (no material clamping)
                depol = max(0.0, min(0.75, depol))
                raman_activities.append(activity)
                depolarization_ratios.append(depol)
                alpha_bar_prime_sq_list.append(float(alpha_bar_prime**2))
                gamma_prime_sq_list.append(float(gamma_prime_sq))

        ir_intensities_arr = numpy.asarray(ir_intensities, dtype=float)
        finite = (
            numpy.isfinite(hessian).all()
            and numpy.isfinite(frequencies).all()
            and numpy.isfinite(modes).all()
            and numpy.isfinite(masses).all()
            and numpy.isfinite(ir_intensities_arr).all()
            and bool((ir_intensities_arr >= 0).all())
        )
        if raman_activities is not None:
            raman_activities_arr = numpy.asarray(raman_activities, dtype=float)
            depol_ratios_arr = numpy.asarray(depolarization_ratios, dtype=float)
            finite = (
                finite
                and numpy.isfinite(raman_activities_arr).all()
                and bool((raman_activities_arr >= 0).all())
                and numpy.isfinite(depol_ratios_arr).all()
                and bool((depol_ratios_arr >= 0).all())
                and bool((depol_ratios_arr <= 0.751).all())
            )
        result = {
            "schema": "chemdft.worker.vibrational-analysis",
            "schema_version": "1.0.0",
            "task": "FREQUENCY",
            "engine": "pyscf",
            "engine_version": pyscf_version,
            "adapter_version": "1.0.0",
            "parser_version": "1.0.0",
            "method": method,
            "basis": document["basis"],
            "charge": document["charge"],
            "multiplicity": document["multiplicity"],
            "converged": bool(calculation.converged),
            "finite": bool(finite),
            "total_energy_hartree": energy,
            "dipole_moment_debye": dipole_0,
            "dipole_derivative_method": "central_finite_difference",
            "finite_difference_step_bohr": delta_bohr,
            "intensity_unit": "km/mol",
            "equilibrium_coordinates_angstrom": [
                item["xyz_angstrom"] for item in document["atoms"]
            ],
            "hessian_hartree_per_bohr2": hessian.tolist(),
            "frequencies_cm1": frequencies.tolist(),
            "normal_modes_amu_minus_half": modes.tolist(),
            "reduced_masses_amu": masses.tolist(),
            "ir_intensities_km_mol": ir_intensities,
            "raman_activities_angstrom4_per_amu": raman_activities,
            "depolarization_ratios": depolarization_ratios,
            "alpha_bar_prime_sq": (
                alpha_bar_prime_sq_list if raman_activities is not None else None
            ),
            "gamma_prime_sq": (
                gamma_prime_sq_list if raman_activities is not None else None
            ),
            "max_abs_antisymmetry": max_overall_antisym,

            "equilibrium_polarizability_angstrom3": (
                alpha_0_sym.tolist() if alpha_0_sym is not None else None
            ),
            "polarizability_derivatives_angstrom2_per_amu_half": (
                [d.tolist() for d in dalpha_dqs] if dalpha_dqs else None
            ),
            "raman_method": "placzek_static" if raman_activities is not None else None,
            "polarizability_method": (
                "finite_electric_field" if raman_activities is not None else None
            ),
            "electric_field_step_au": (
                document.get("raman", {}).get("electric_field_step_au", 0.0010)
                if raman_activities is not None
                else None
            ),
            "polarizability_derivative_step_angstrom_amu_half": (
                document.get("raman", {}).get(
                    "polarizability_derivative_step_angstrom_amu_half", 0.0100
                )
                if raman_activities is not None
                else None
            ),
            "polarizability_unit": "angstrom^3" if raman_activities is not None else None,
            "raman_activity_unit": "angstrom^4/amu" if raman_activities is not None else None,
            "polarizability_tensor_symmetrization": (
                document.get("raman", {}).get("symmetrize_polarizability", True)
                if raman_activities is not None
                else None
            ),
            "polarizability_antisymmetry_tolerance": (
                document.get("raman", {}).get("antisymmetry_tolerance", 1e-4)
                if raman_activities is not None
                else None
            ),
            "mode_count": int(frequencies.size),
            "frequency_error_count": int(analysis["freq_error"]),
            "mode_ordering": "ascending_eigenvalue",
            "vector_convention": "pyscf_thermo_norm_mode",
            "environment": {
                "python": platform.python_version(),
                "platform": platform.platform(),
                "architecture": platform.machine(),
                "libraries": {"numpy": numpy.__version__, "scipy": scipy.__version__},
                "thread_settings": {"OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1")},
            },
        }
        result_path.write_text(
            json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False)
        )
        return 0 if finite and calculation.converged else 3

    energy = float(calculation.kernel())
    if document["task"] == "ORBITAL":
        restricted = spin == 0
        coefficient_sets = [calculation.mo_coeff] if restricted else list(calculation.mo_coeff)
        energy_sets = [calculation.mo_energy] if restricted else list(calculation.mo_energy)
        occupation_sets = [calculation.mo_occ] if restricted else list(calculation.mo_occ)
        channels = ["restricted"] if restricted else ["alpha", "beta"]
        orbital_channels = []
        coefficient_channels = {}
        for channel, coefficients, orbital_energies, occupations in zip(
            channels, coefficient_sets, energy_sets, occupation_sets, strict=True
        ):
            coefficients = numpy.asarray(coefficients, dtype=float)
            orbital_energies = numpy.asarray(orbital_energies, dtype=float)
            occupations = numpy.asarray(occupations, dtype=float)
            if (
                coefficients.ndim != 2
                or orbital_energies.ndim != 1
                or occupations.ndim != 1
                or coefficients.shape[1] != orbital_energies.size
                or orbital_energies.size != occupations.size
                or not numpy.isfinite(coefficients).all()
                or not numpy.isfinite(orbital_energies).all()
                or not numpy.isfinite(occupations).all()
            ):
                raise ValueError("PySCF returned malformed molecular-orbital arrays")
            coefficient_channels[channel] = coefficients.tolist()
            orbital_channels.append(
                {
                    "spin_channel": channel,
                    "coefficients": coefficient_channels[channel],
                    "energies_hartree": orbital_energies.tolist(),
                    "occupations": occupations.tolist(),
                }
            )
        electron_count = int(molecule.nelectron)
        alpha_electrons = int((electron_count + spin) // 2)
        beta_electrons = int((electron_count - spin) // 2)
        result = {
            "schema": "chemdft.worker.molecular-orbitals",
            "schema_version": "1.0.0",
            "task": "ORBITAL",
            "engine": "pyscf",
            "engine_version": pyscf_version,
            "adapter_version": "1.0.0",
            "method": method,
            "basis": document["basis"],
            "charge": int(document["charge"]),
            "multiplicity": int(document["multiplicity"]),
            "converged": bool(calculation.converged),
            "total_energy_hartree": energy,
            "electron_count": electron_count,
            "alpha_electron_count": alpha_electrons,
            "beta_electron_count": beta_electrons,
            "basis_function_count": int(molecule.nao_nr()),
            "molecular_orbital_count": int(
                sum(len(item["energies_hartree"]) for item in orbital_channels)
            ),
            "orbital_channels": orbital_channels,
            "scf_iterations": getattr(calculation, "cycles", None),
            "finite": math.isfinite(energy),
            "environment": {
                "python": platform.python_version(),
                "platform": platform.platform(),
                "architecture": platform.machine(),
                "libraries": {"numpy": numpy.__version__, "scipy": scipy.__version__},
                "thread_settings": {"OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1")},
            },
        }
        result_path.write_text(
            json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False)
        )
        return 0 if result["converged"] and result["finite"] else 3
    result = {
        "schema": "chemdft.worker.energy",
        "schema_version": "1.0.0",
        "engine": "pyscf",
        "engine_version": pyscf_version,
        "adapter_version": "1.0.0",
        "task": "ENERGY",
        "method": method,
        "basis": document["basis"],
        "charge": document["charge"],
        "multiplicity": document["multiplicity"],
        "spin": spin,
        "converged": bool(calculation.converged),
        "total_energy_hartree": energy,
        "finite": math.isfinite(energy),
        "scf_iterations": getattr(calculation, "cycles", None),
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "libraries": {
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
            },
            "thread_settings": {
                "OMP_NUM_THREADS": __import__("os").environ.get("OMP_NUM_THREADS", "1")
            },
        },
    }
    result_path.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result["converged"] and result["finite"] else 3


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
