# Proprietary to ChemDFT. All rights reserved.
"""Pure-Python writers for the Quantum ESPRESSO inputs of the periodic worker (no QE needed to import or test).

The pw.x input mirrors the one that was run and verified by the owner on AWS (QE 7.6, alpha-Cr2O3, AFM, PBE+U):
ibrav=0, ATOMIC_POSITIONS crystal, one species label per magnetic sublattice, Fermi-Dirac smearing 0.01 Ry,
conv_thr 1e-8, HUBBARD (ortho-atomic) with one Dudarev U_eff line per species label.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

try:
    from .qe_pseudopotentials import (
        HUBBARD_3D_ELEMENTS,
        hubbard_label_available,
        pseudo_for_element,
        unsupported_element_message,
    )
except ImportError:  # run as a script by the isolated worker
    from qe_pseudopotentials import (  # type: ignore[no-redef]
        HUBBARD_3D_ELEMENTS,
        hubbard_label_available,
        pseudo_for_element,
        unsupported_element_message,
    )

# Same transition metals and same default U table as the PySCF periodic worker (0.0.41/0.0.42).
MAGNETIC_ELEMENTS = ("V", "Cr", "Mn", "Fe", "Co", "Ni")
DEFAULT_U_EFF = {"V": 3.25, "Cr": 3.7, "Mn": 3.9, "Fe": 5.3, "Co": 3.32, "Ni": 6.2}
STARTING_MAGNETIZATION = 0.5
SMEARING_DEGAUSS_RY = 0.01  # = 0.005 Ha, the same smearing width as the PySCF worker
CONV_THR_RY = 1.0e-8
MIXING_BETA = 0.3
ELECTRON_MAXSTEP = 200
BANDS_FRACTION = 0.65
RELAX_FORC_CONV_THR = 1.0e-3  # Ry/bohr
RELAX_ETOT_CONV_THR = 1.0e-5  # Ry
DOS_DEGAUSS_RY = 0.01
DOS_DELTA_E_EV = 0.02
PDOS_DELTA_E_EV = 0.05
PREFIX = "chemdft"


class QeInputError(ValueError):
    """The structure or options cannot be turned into a supported Quantum ESPRESSO run."""


@dataclass(frozen=True)
class Species:
    label: str
    element: str
    mass: float
    pseudo_file: str
    starting_magnetization: float
    hubbard_u_ev: float | None


@dataclass
class QeModel:
    """Everything the writers need, derived once from the normalized input."""

    lattice_angstrom: list[list[float]]
    atoms: list[dict]  # {"element": str, "fractional": [x, y, z], "species": label}
    species: list[Species]
    nspin: int
    nbnd: int
    n_electrons: int
    ecutwfc_ry: float
    ecutrho_ry: float
    magnetic_order: str
    u_effective_ev: dict[str, float]
    used_default_u: bool
    pseudo_files: dict[str, str] = field(default_factory=dict)  # element -> file
    libraries: dict[str, str] = field(default_factory=dict)  # element -> library tag
    sublattice_signs: dict[int, int] = field(default_factory=dict)  # atom index -> +1/-1


def _fortran_float(value: float) -> str:
    return (
        f"{value:.1e}".replace("e-0", "d-")
        .replace("e+0", "d+")
        .replace("e-", "d-")
        .replace("e+", "d+")
    )


def resolve_hubbard(
    elements: Sequence[str], requested: dict[str, float] | None, plus_u: bool
) -> tuple[dict[str, float], bool]:
    """U_eff map (eV) per element, mirroring the PySCF worker: explicit values, else defaults for the metals present."""
    if not plus_u:
        return {}, False
    values: dict[str, float] = {}
    used_default = False
    for element, value in (requested or {}).items():
        values[str(element)] = float(value)
    if not values:
        for element in elements:
            if element in DEFAULT_U_EFF and element not in values:
                values[element] = DEFAULT_U_EFF[element]
                used_default = True
    else:
        used_default = any(
            el in DEFAULT_U_EFF and abs(v - DEFAULT_U_EFF[el]) < 1e-4 for el, v in values.items()
        )
    return values, used_default


def sublattice_signs(
    lattice: Sequence[Sequence[float]], atoms: Sequence[dict], magnetic_order: str
) -> dict[int, int]:
    """Same sign rule as the PySCF worker: sort the magnetic atoms along the cell diagonal, alternate + - + -."""
    indices = [i for i, atom in enumerate(atoms) if atom["element"] in MAGNETIC_ELEMENTS]
    if magnetic_order not in ("antiferromagnetic", "ferromagnetic") or not indices:
        return {}
    if magnetic_order == "ferromagnetic":
        return {i: 1 for i in indices}
    axis = [sum(lattice[row][col] for row in range(3)) for col in range(3)]
    norm = math.sqrt(sum(c * c for c in axis))
    axis = [c / norm for c in axis] if norm > 1e-8 else [0.0, 0.0, 1.0]

    def height(index: int) -> float:
        frac = atoms[index]["fractional"]
        cart = [sum(frac[row] * lattice[row][col] for row in range(3)) for col in range(3)]
        return sum(cart[c] * axis[c] for c in range(3))

    ordered = sorted(indices, key=height)
    return {idx: (1 if k % 2 == 0 else -1) for k, idx in enumerate(ordered)}


def build_model(document: dict) -> QeModel:
    """Normalized calculation input (periodic) -> QeModel. Raises QeInputError with a plain-language message."""
    cell = document.get("periodic_cell") or {}
    lattice = cell.get("lattice_vectors") or cell.get("lattice_vectors_angstrom")
    if not lattice or len(lattice) != 3:
        raise QeInputError("Quantum ESPRESSO periodic input requires the three lattice vectors.")
    raw_atoms = document.get("atoms") or []
    if not raw_atoms:
        raise QeInputError("The periodic cell has no atoms.")
    atoms: list[dict] = []
    for item in raw_atoms:
        element = str(item.get("element") or item.get("symbol"))
        frac = item.get("fractional")
        if frac is None or len(frac) != 3:
            raise QeInputError("Quantum ESPRESSO periodic input requires fractional coordinates.")
        atoms.append({"element": element, "fractional": [float(c) for c in frac]})
    options = document.get("periodic") or {}
    method = str(document.get("method", "pbe")).lower()
    plus_u = method == "pbe+u" or bool(options.get("u_effective_ev"))
    magnetic_order = str(options.get("magnetic_order", "none")).lower()
    if magnetic_order not in ("none", "ferromagnetic", "antiferromagnetic"):
        magnetic_order = "none"
    present: list[str] = []
    for atom in atoms:
        if atom["element"] not in present:
            present.append(atom["element"])
    pseudos = {}
    for element in present:
        entry = pseudo_for_element(element)
        if entry is None:
            raise QeInputError(unsupported_element_message(element))
        pseudos[element] = entry
    u_map, used_default = resolve_hubbard(present, options.get("u_effective_ev"), plus_u)
    for element, value in u_map.items():
        if element not in present:
            raise QeInputError(f"A U value was given for {element}, which is not in the structure.")
        if element not in HUBBARD_3D_ELEMENTS:
            raise QeInputError(f"+U is offered on 3d transition metals only; {element} is not one.")
        if not hubbard_label_available(element, "3D"):
            row = pseudos[element]
            raise QeInputError(
                f"The pseudopotential for {element} ({row['file']}) has no 3D projector label, "
                f"so +U on {element} is not available with {pseudos[element]['library']}."
            )
        if not 0.0 <= value <= 15.0:
            raise QeInputError(f"U for {element} must be between 0 and 15 eV.")
    signs = sublattice_signs(lattice, atoms, magnetic_order)
    if magnetic_order != "none" and not signs:
        magnetic_order = (
            "none"  # nothing magnetic is present: run non-spin-polarised, say so in the result
        )
    nspin = 2 if magnetic_order != "none" else 1
    # Species labels: plain symbol, or Sym1 (up) / Sym2 (down) for the AFM sublattices of magnetic elements.
    species: list[Species] = []
    seen: dict[str, Species] = {}

    def species_for(index: int, element: str) -> str:
        sign = signs.get(index)
        if sign is None:
            label, mag = element, 0.0
        elif magnetic_order == "antiferromagnetic":
            label, mag = (
                (f"{element}1", STARTING_MAGNETIZATION)
                if sign > 0
                else (f"{element}2", -STARTING_MAGNETIZATION)
            )
        else:
            label, mag = element, STARTING_MAGNETIZATION
        if label not in seen:
            row = pseudos[element]
            spec = Species(label, element, row["mass"], row["file"], mag, u_map.get(element))
            seen[label] = spec
            species.append(spec)
        return label

    for index, atom in enumerate(atoms):
        atom["species"] = species_for(index, atom["element"])
    # Stable order: by first appearance of the element, then the up sublattice before the down one.
    order = {el: i for i, el in enumerate(present)}
    species.sort(key=lambda s: (order[s.element], s.label))
    n_electrons = sum(int(pseudos[a["element"]]["z_valence"]) for a in atoms)
    charge = int(document.get("charge", 0) or 0)
    n_electrons -= charge
    if n_electrons <= 0:
        raise QeInputError("The cell has no valence electrons.")
    nbnd = math.ceil(BANDS_FRACTION * n_electrons)
    return QeModel(
        lattice_angstrom=[[float(c) for c in row] for row in lattice],
        atoms=atoms,
        species=species,
        nspin=nspin,
        nbnd=nbnd,
        n_electrons=n_electrons,
        ecutwfc_ry=max(pseudos[e]["ecutwfc_ry"] for e in present),
        ecutrho_ry=max(pseudos[e]["ecutrho_ry"] for e in present),
        magnetic_order=magnetic_order,
        u_effective_ev=u_map,
        used_default_u=used_default,
        pseudo_files={e: pseudos[e]["file"] for e in present},
        libraries={e: pseudos[e]["library"] for e in present},
        sublattice_signs=signs,
    )


def _positions(model: QeModel, positions: Sequence[Sequence[float]] | None) -> list[str]:
    lines = ["ATOMIC_POSITIONS crystal"]
    for index, atom in enumerate(model.atoms):
        frac = positions[index] if positions is not None else atom["fractional"]
        lines.append(f" {atom['species']} {frac[0]:.10f} {frac[1]:.10f} {frac[2]:.10f}")
    return lines


def write_pw_input(
    model: QeModel,
    *,
    calculation: str,
    pseudo_dir: str,
    outdir: str,
    k_mesh: Sequence[int] | None = None,
    k_path: Sequence[tuple[Sequence[float], int]] | None = None,
    positions: Sequence[Sequence[float]] | None = None,
    relax_max_steps: int = 30,
    prefix: str = PREFIX,
) -> str:
    """pw.x input. calculation is scf, relax, nscf or bands."""
    if calculation not in ("scf", "relax", "nscf", "bands"):
        raise QeInputError(f"Unsupported pw.x calculation '{calculation}'.")
    if calculation == "bands":
        if not k_path:
            raise QeInputError("A band calculation needs a k-point path.")
    elif not k_mesh or len(k_mesh) != 3:
        raise QeInputError("A k-point mesh is required.")
    relax = calculation == "relax"
    control = [
        f"calculation='{calculation}'",
        f"prefix='{prefix}'",
        f"outdir='{outdir}'",
        f"pseudo_dir='{pseudo_dir}'",
        "verbosity='high'",
        f"tprnfor={'.true.' if relax else '.false.'}",
        "tstress=.false.",  # the printed stress is not reliable at SSSP efficiency cutoffs: never requested
    ]
    if relax:
        control += [
            f"nstep={int(relax_max_steps)}",
            f"forc_conv_thr={_fortran_float(RELAX_FORC_CONV_THR)}",
            f"etot_conv_thr={_fortran_float(RELAX_ETOT_CONV_THR)}",
        ]
    system = [
        "ibrav=0",
        f"nat={len(model.atoms)}",
        f"ntyp={len(model.species)}",
        f"ecutwfc={model.ecutwfc_ry:.1f}",
        f"ecutrho={model.ecutrho_ry:.1f}",
        f"nspin={model.nspin}",
        f"nbnd={model.nbnd}",
        "occupations='smearing'",
        "smearing='fd'",
        f"degauss={SMEARING_DEGAUSS_RY}",
    ]
    if model.nspin == 2:
        for number, spec in enumerate(model.species, start=1):
            system.append(f"starting_magnetization({number})={spec.starting_magnetization}")
    out = ["&CONTROL", " " + ", ".join(control), "/", "&SYSTEM", " " + ", ".join(system), "/"]
    out += [
        "&ELECTRONS",
        f" conv_thr={_fortran_float(CONV_THR_RY)}, mixing_beta={MIXING_BETA}, electron_maxstep={ELECTRON_MAXSTEP}",
        "/",
    ]
    if relax:
        out += ["&IONS", " ion_dynamics='bfgs'", "/"]
    out.append("ATOMIC_SPECIES")
    for spec in model.species:
        out.append(f" {spec.label} {spec.mass:.4f} {spec.pseudo_file}")
    out += _positions(model, positions)
    out.append("CELL_PARAMETERS angstrom")
    for row in model.lattice_angstrom:
        out.append(f" {row[0]:.10f} {row[1]:.10f} {row[2]:.10f}")
    if calculation == "bands":
        out.append("K_POINTS crystal_b")
        out.append(f" {len(k_path)}")  # type: ignore[arg-type]
        for point, weight in k_path:  # type: ignore[union-attr]
            out.append(f" {point[0]:.8f} {point[1]:.8f} {point[2]:.8f} {int(weight)}")
    else:
        out.append("K_POINTS automatic")
        out.append(f" {int(k_mesh[0])} {int(k_mesh[1])} {int(k_mesh[2])} 0 0 0")  # type: ignore[index]
    hubbard = [s for s in model.species if s.hubbard_u_ev is not None]
    if hubbard:
        out.append("HUBBARD (ortho-atomic)")
        for spec in hubbard:
            out.append(f" U {spec.label}-3d {spec.hubbard_u_ev:g}")
    return "\n".join(out) + "\n"


def write_projwfc_input(
    *, outdir: str, filpdos: str, prefix: str = PREFIX, delta_e_ev: float = PDOS_DELTA_E_EV
) -> str:
    return (
        "&PROJWFC\n"
        f" prefix='{prefix}', outdir='{outdir}', filpdos='{filpdos}', degauss={DOS_DEGAUSS_RY}, DeltaE={delta_e_ev}\n"
        "/\n"
    )


def write_dos_input(*, outdir: str, fildos: str, prefix: str = PREFIX) -> str:
    return (
        "&DOS\n"
        f" prefix='{prefix}', outdir='{outdir}', fildos='{fildos}', degauss={DOS_DEGAUSS_RY}, DeltaE={DOS_DELTA_E_EV}\n"
        "/\n"
    )


def write_bands_input(
    *, outdir: str, filband: str, spin_component: int | None, prefix: str = PREFIX
) -> str:
    spin = f", spin_component={int(spin_component)}" if spin_component else ""
    return f"&BANDS\n prefix='{prefix}', outdir='{outdir}', filband='{filband}'{spin}\n/\n"
