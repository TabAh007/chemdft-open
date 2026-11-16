# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Lightweight PySCF thermochemistry worker task (no SCF, no optimization, no Hessian).

Consumes validated persisted data (geometry, harmonic frequencies, E0) and calls
``pyscf.hessian.thermo.thermo`` with a stand-in model object. Runs inside the isolated PySCF
worker interpreter; imported by ``pyscf_worker`` which owns the process entry point.
"""

from __future__ import annotations

import json
import math
import os
import platform
import types
from pathlib import Path

PYSCF_VERSION = "2.14.0"
THERMO_ADAPTER_VERSION = "1.0.0"
LOW_FREQUENCY_WARNING_CM1 = 100.0
TEMPERATURE_RANGE_K = (50.0, 2000.0)
PRESSURE_RANGE_PA = (1.0e2, 1.0e8)


def _pair(value):
    return {"value": float(value[0]), "unit": str(value[1])}


def run_thermochemistry(document: dict, result_path: Path, log_path: Path) -> int:
    import numpy
    import scipy
    import symmetry_number
    from pyscf import __version__ as pyscf_version
    from pyscf import gto
    from pyscf.data import nist
    from pyscf.hessian import thermo

    if pyscf_version != PYSCF_VERSION:
        raise RuntimeError(
            f"Thermochemistry is validated for PySCF {PYSCF_VERSION}, not {pyscf_version}"
        )
    options = document["thermochemistry"]
    temperature = float(options["temperature_k"])
    pressure = float(options["pressure_pa"])
    if not (
        math.isfinite(temperature)
        and TEMPERATURE_RANGE_K[0] <= temperature <= TEMPERATURE_RANGE_K[1]
    ):
        raise ValueError("Temperature is outside the validated range")
    if not (math.isfinite(pressure) and PRESSURE_RANGE_PA[0] <= pressure <= PRESSURE_RANGE_PA[1]):
        raise ValueError("Pressure is outside the validated range")
    if int(document["multiplicity"]) != 1:
        raise ValueError("Thermochemistry V1 supports closed-shell singlets only")
    frequencies_cm1 = [float(value) for value in options["frequencies_cm1"]]
    if not frequencies_cm1 or any(
        (not math.isfinite(value)) or value <= 0 for value in frequencies_cm1
    ):
        raise ValueError("Thermochemistry requires finite positive harmonic frequencies")
    electronic_energy = float(options["electronic_energy_hartree"])
    if not math.isfinite(electronic_energy):
        raise ValueError("Electronic energy must be finite")

    elements = [item["element"] for item in document["atoms"]]
    coordinates = [item["xyz_angstrom"] for item in document["atoms"]]
    molecule = gto.M(
        atom=list(zip(elements, coordinates, strict=True)),
        unit="Angstrom",
        charge=int(document["charge"]),
        spin=0,
        basis=document["basis"],
        verbose=0,
    )

    # Symmetry number: ChemDFT's tolerance-aware routine (PySCF's point-group lookup is
    # too sensitive to optimizer-level coordinate noise); explicit override must be recorded.
    override = options.get("symmetry_number_override")
    if override is not None:
        sigma = int(override)
        symmetry = {
            "rotational_symmetry_number": sigma,
            "source": "user-override",
            "method": "recorded-user-override",
            "algorithm": symmetry_number.ALGORITHM,
            "algorithm_version": symmetry_number.ALGORITHM_VERSION,
            "tolerance_angstrom": symmetry_number.DEFAULT_TOLERANCE_ANGSTROM,
            "stability_tolerances_angstrom": [],
            "override_reason": str(options["symmetry_override_reason"]),
        }
    else:
        detected = symmetry_number.rotational_symmetry_number(elements, coordinates)
        sigma = detected.sigma
        symmetry = {
            "rotational_symmetry_number": sigma,
            "source": "chemdft-proper-rotation-count",
            "method": detected.method,
            "algorithm": detected.algorithm,
            "algorithm_version": detected.algorithm_version,
            "tolerance_angstrom": detected.tolerance_angstrom,
            "stability_tolerances_angstrom": list(detected.stability_checked_tolerances_angstrom),
            "override_reason": None,
        }
    try:
        pyscf_sigma = int(thermo.rotational_symmetry_number(molecule))
    except Exception:  # PySCF's own lookup may fail on unnamed groups; informational only
        pyscf_sigma = None
    symmetry["pyscf_point_group_sigma"] = pyscf_sigma
    symmetry["pyscf_cross_check_agrees"] = None if pyscf_sigma is None else pyscf_sigma == sigma

    au2hz = (nist.HARTREE2J / (nist.ATOMIC_MASS * nist.BOHR_SI**2)) ** 0.5 / (2 * numpy.pi)
    freq_au = numpy.asarray(frequencies_cm1) * 1e2 * nist.LIGHT_SPEED_SI / au2hz

    model = types.SimpleNamespace(mol=molecule, e_tot=electronic_energy)
    original_sigma = thermo.rotational_symmetry_number
    thermo.rotational_symmetry_number = lambda _mol: sigma  # scoped to this call only
    try:
        raw = thermo.thermo(model, freq_au, temperature, pressure)
    finally:
        thermo.rotational_symmetry_number = original_sigma

    rot_const = numpy.asarray(raw["rot_const"][0], dtype=float)
    rotor_type = thermo._get_rotor_type(rot_const)
    if rotor_type == "ATOM":
        raise ValueError("Thermochemistry from a frequency result requires a molecule")
    if int(raw["sym_number"][0]) != sigma:
        raise RuntimeError("Symmetry number override did not reach the thermochemistry kernel")

    # Exact harmonic-oscillator decomposition, identical formulas to PySCF's vibrational part.
    kb, h = nist.BOLTZMANN, nist.PLANCK
    r_eh = kb * nist.AVOGADRO / (nist.HARTREE2J * nist.AVOGADRO)
    vib_temperature = freq_au * au2hz * h / kb
    reduced = vib_temperature / max(1e-14, temperature)
    e = numpy.exp(-reduced)
    modes = []
    for index in range(len(freq_au)):
        zpe_i = r_eh * 0.5 * vib_temperature[index]
        thermal_i = r_eh * temperature * (reduced[index] * e[index] / (1 - e[index]))
        entropy_i = r_eh * (reduced[index] * e[index] / (1 - e[index]) - numpy.log(1 - e[index]))
        cv_i = r_eh * (e[index] * reduced[index] ** 2 / (1 - e[index]) ** 2)
        modes.append(
            {
                "index": index,
                "frequency_cm1": frequencies_cm1[index],
                "vibrational_temperature_k": float(vib_temperature[index]),
                "zpe_hartree": float(zpe_i),
                "thermal_energy_hartree": float(thermal_i),
                "entropy_hartree_per_k": float(entropy_i),
                "cv_hartree_per_k": float(cv_i),
            }
        )

    result = {
        "schema": "chemdft.worker.thermochemistry",
        "schema_version": "1.0.0",
        "task": "THERMOCHEMISTRY",
        "engine": "pyscf",
        "engine_version": pyscf_version,
        "thermo_api": "pyscf.hessian.thermo.thermo",
        "adapter_version": THERMO_ADAPTER_VERSION,
        "parser_version": "1.0.0",
        "method": document["method"],
        "basis": document["basis"],
        "charge": int(document["charge"]),
        "multiplicity": int(document["multiplicity"]),
        "temperature_k": temperature,
        "pressure_pa": pressure,
        "converged": True,
        "finite": True,
        "atom_identities": elements,
        "equilibrium_coordinates_angstrom": coordinates,
        "rotor_type": "LINEAR" if rotor_type == "LINEAR" else "NONLINEAR",
        "rotational_constants_ghz": [float(value) for value in rot_const],
        "total_mass_amu": float(numpy.sum(molecule.atom_mass_list(isotope_avg=True))),
        "symmetry": symmetry,
        "raw": {
            key: (
                {"value": [float(x) for x in value[0]], "unit": str(value[1])}
                if hasattr(value[0], "__len__")
                else _pair(value)
            )
            for key, value in raw.items()
        },
        "vibrational_modes": modes,
        "frequencies_cm1": frequencies_cm1,
        "constants": {
            "source": "pyscf.data.nist",
            "boltzmann_j_per_k": float(nist.BOLTZMANN),
            "planck_j_s": float(nist.PLANCK),
            "avogadro_per_mol": float(nist.AVOGADRO),
            "hartree_j": float(nist.HARTREE2J),
            "atomic_mass_kg": float(nist.ATOMIC_MASS),
            "bohr_m": float(nist.BOHR_SI),
            "speed_of_light_m_per_s": float(nist.LIGHT_SPEED_SI),
            "thermochemical_calorie_j": 4.184,
        },
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "libraries": {
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
                "pyscf": pyscf_version,
            },
            "thread_settings": {"OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1")},
        },
    }
    Path(log_path).write_text(
        "ChemDFT thermochemistry: no SCF, optimization or Hessian was evaluated.\n"
        f"T={temperature} K P={pressure} Pa sigma={sigma} ({symmetry['source']})\n"
    )
    Path(result_path).write_text(
        json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False)
    )
    return 0
