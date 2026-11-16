# Proprietary to ChemDFT. All rights reserved.
"""Parsers for the files Quantum ESPRESSO 7.6 writes (data-file-schema.xml, pw.x / projwfc.x stdout, dos.x, PDOS and
bands.x files). They only read; every number comes from the engine's own files. Formats follow the real QE 7.6 output the
owner ran on AWS (qe-feasibility/parse_output.py)."""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from collections.abc import Iterable, Sequence

HARTREE_EV = 27.211386245988
RYDBERG_HARTREE = 0.5


class QeParseError(ValueError):
    """A QE output file is missing something a converged, publishable result must contain."""


def _local(tag: str) -> str:
    return tag.split("}")[-1]


def _find(root: ET.Element, name: str) -> ET.Element | None:
    for element in root.iter():
        if _local(element.tag) == name:
            return element
    return None


def _floats(text: str | None) -> list[float]:
    return [float(x) for x in (text or "").split()]


# ------------------------------------------------------------------------------------------------ pw.x xml


def parse_xml(xml_text: str) -> dict:
    """data-file-schema.xml -> energies (Hartree), eigenvalue gap (eV), Fermi level (eV), magnetization (muB)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as error:
        raise QeParseError(f"data-file-schema.xml is not valid XML: {error}") from error
    band = _find(root, "band_structure")
    etot = _find(root, "etot")
    if band is None or etot is None:
        raise QeParseError("data-file-schema.xml has no band_structure or total energy.")
    result: dict = {"total_energy_hartree": float(etot.text or "nan")}
    magnetization = _find(root, "magnetization")
    if magnetization is not None:
        total = _find(magnetization, "total")
        absolute = _find(magnetization, "absolute")
        result["total_magnetization"] = (
            float(total.text) if total is not None and total.text else None
        )
        result["absolute_magnetization"] = (
            float(absolute.text) if absolute is not None and absolute.text else None
        )
    else:
        result["total_magnetization"] = None
        result["absolute_magnetization"] = None
    fermi = _find(band, "fermi_energy")
    result["fermi_energy_ev"] = (
        float(fermi.text) * HARTREE_EV if fermi is not None and fermi.text else None
    )
    lsda = _find(band, "lsda")
    result["spin_polarized"] = bool(
        lsda is not None and (lsda.text or "").strip().lower() == "true"
    )
    highest_occupied = -math.inf
    lowest_empty = math.inf
    nks = 0
    for ks in band.iter():
        if _local(ks.tag) != "ks_energies":
            continue
        nks += 1
        eigenvalues = _floats(getattr(_find(ks, "eigenvalues"), "text", None))
        occupations = _floats(getattr(_find(ks, "occupations"), "text", None))
        if len(eigenvalues) != len(occupations) or not eigenvalues:
            raise QeParseError("data-file-schema.xml eigenvalues and occupations do not match.")
        for energy, occupation in zip(eigenvalues, occupations, strict=True):
            if occupation > 0.5:
                highest_occupied = max(highest_occupied, energy)
            else:
                lowest_empty = min(lowest_empty, energy)
    result["k_points_in_file"] = nks
    if math.isfinite(highest_occupied) and math.isfinite(lowest_empty):
        result["band_gap_ev"] = (lowest_empty - highest_occupied) * HARTREE_EV
        result["vbm_ev"] = highest_occupied * HARTREE_EV
        result["cbm_ev"] = lowest_empty * HARTREE_EV
    else:
        result["band_gap_ev"] = None
        result["vbm_ev"] = None
        result["cbm_ev"] = None
    return result


# ------------------------------------------------------------------------------------------------ pw.x stdout

_TOTAL_ENERGY = re.compile(r"^!\s+total energy\s+=\s+(-?\d+\.\d+)\s+Ry", re.M)
_ITERATIONS = re.compile(r"convergence has been achieved in\s+(\d+) iterations")
_NK = re.compile(r"number of k points=\s+(\d+)")


def parse_scf_stdout(text: str) -> dict:
    energies = [float(x) for x in _TOTAL_ENERGY.findall(text)]
    iterations = _ITERATIONS.findall(text)
    nk = _NK.search(text)
    return {
        "converged": "convergence has been achieved" in text and bool(energies),
        "total_energy_ry": energies[-1] if energies else None,
        "scf_iterations": int(iterations[-1]) if iterations else None,
        "irreducible_k_points": int(nk.group(1)) if nk else None,
        "job_done": "JOB DONE." in text,
    }


_ATOM_FORCE = re.compile(
    r"^\s*atom\s+(\d+)\s+type\s+\d+\s+force\s+=\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s*$"
)
_TOTAL_FORCE = re.compile(r"Total force\s+=\s+(\d+\.\d+)")


def _last_force_block(lines: Sequence[str]) -> list[tuple[float, float, float]]:
    starts = [i for i, line in enumerate(lines) if "Forces acting on atoms" in line]
    if not starts:
        return []
    forces: list[tuple[float, float, float]] = []
    for line in lines[starts[-1] + 1 :]:
        match = _ATOM_FORCE.match(line)
        if match:
            forces.append((float(match.group(2)), float(match.group(3)), float(match.group(4))))
        elif forces and not line.strip():
            break
    return forces


FINAL_ENERGY_TOLERANCE_HA = 1e-6


def check_final_energy_agreement(relax_final_ha: float, final_scf_ha: float) -> float:
    """Relax log "Final energy" vs the energy of the fixed-geometry scf at the relaxed positions (Hartree)."""
    difference = final_scf_ha - relax_final_ha
    if not math.isfinite(difference) or abs(difference) > FINAL_ENERGY_TOLERANCE_HA:
        raise QeParseError(
            "The relaxed result could not be confirmed against the engine log: the relaxation's final energy and the "
            f"energy of the scf at the relaxed geometry differ by {difference:.3e} Ha (limit {FINAL_ENERGY_TOLERANCE_HA:.0e} Ha)."
        )
    return difference


def parse_relax_stdout(text: str, species_labels: Sequence[str] | None = None) -> dict:
    """pw.x calculation='relax' stdout. A relaxation counts as converged only if BFGS says so."""
    lines = text.splitlines()
    energies = [float(x) for x in _TOTAL_ENERGY.findall(text)]
    bfgs = re.search(r"bfgs converged in\s+(\d+) scf cycles and\s+(\d+) bfgs steps", text)
    final = re.findall(r"Final energy\s+=\s+(-?\d+\.\d+)\s+Ry", text)
    totals = [float(x) for x in _TOTAL_FORCE.findall(text)]
    forces = _last_force_block(lines)
    max_force = max((abs(c) for atom in forces for c in atom), default=None)
    # Release 0.0.46: a Cartesian component can never exceed the total force printed for the same step. Live job
    # 1865196f reported max_force 6.737 against a final total force of 0.001093; a value that contradicts the log's own total
    # is not published as the final force (None = "n/a"), and the total force of the last ionic step stays available.
    max_force_consistent = True
    if max_force is not None and totals and max_force > totals[-1] * 1.001 + 1e-9:
        max_force, max_force_consistent = None, False
    positions: list[tuple[str, list[float]]] = []
    end = text.rfind("End of BFGS Geometry Optimization")
    if end >= 0:
        block = text[end:].splitlines()
        reading = False
        for line in block:
            if line.strip().startswith("ATOMIC_POSITIONS"):
                if "crystal" not in line:
                    raise QeParseError("Final atomic positions are not in crystal coordinates.")
                reading = True
                continue
            if reading:
                parts = line.split()
                if len(parts) >= 4:
                    try:
                        positions.append(
                            (parts[0], [float(parts[1]), float(parts[2]), float(parts[3])])
                        )
                        continue
                    except ValueError:
                        pass
                if line.strip() == "" or "End final coordinates" in line:
                    break
    steps_reached = "maximum number of steps has been reached" in text
    return {
        "converged": bool(bfgs) and bool(final) and not steps_reached,
        "scf_cycles": int(bfgs.group(1)) if bfgs else len(energies),
        "bfgs_steps": int(bfgs.group(2)) if bfgs else None,
        "initial_energy_ry": energies[0] if energies else None,
        "final_energy_ry": float(final[-1]) if final else (energies[-1] if energies else None),
        "last_scf_energy_ry": energies[-1] if energies else None,
        "total_force_ry_bohr": totals[-1] if totals else None,
        "max_force_ry_bohr": max_force,
        "max_force_consistent": max_force_consistent,
        "final_positions_crystal": positions,
        "hit_step_limit": steps_reached,
        "job_done": "JOB DONE." in text,
    }


# ------------------------------------------------------------------------------------------------ projwfc.x stdout

_ATOM_HEAD = re.compile(r"Atom #\s*(\d+):")
_POLARIZATION = re.compile(r"polarization\s*=\s*(-?\d+\.\d+)")
_ORBITAL_PART = re.compile(r"\b([spdf])\s*=\s*(-?\d+\.\d+)")


def parse_projwfc_lowdin(text: str) -> dict[int, dict]:
    """Lowdin spin polarization (muB) per atom, 1-based atom number -> {polarization, s, p, d, f}."""
    result: dict[int, dict] = {}
    current: int | None = None
    for line in text.splitlines():
        head = _ATOM_HEAD.search(line)
        if head:
            current = int(head.group(1))
        pol = _POLARIZATION.search(line)
        if pol and current is not None:
            entry = result.setdefault(current, {})
            entry["polarization"] = float(pol.group(1))
            tail = line[pol.end() :]
            for letter, value in _ORBITAL_PART.findall(tail):
                entry[letter] = float(value)
    return result


# ------------------------------------------------------------------------------------------------ dos.x and PDOS files


def _data_rows(text: str) -> list[list[float]]:
    rows = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        rows.append([float(x) for x in stripped.split()])
    return rows


def parse_dos_file(text: str) -> dict:
    """dos.x output: '# E (eV) dosup(E) dosdw(E) Int dos(E) EFermi = 12.798 eV' (spin) or '# E (eV) dos(E) Int dos(E) ...'."""
    first = text.splitlines()[0] if text.strip() else ""
    fermi = re.search(r"EFermi\s*=\s*(-?\d+\.\d+)\s*eV", first)
    if not fermi:
        raise QeParseError("dos file header has no Fermi energy.")
    rows = _data_rows(text)
    if not rows:
        raise QeParseError("dos file has no data.")
    spin = "dosup" in first
    energy = [r[0] for r in rows]
    if spin:
        return {
            "fermi_ev": float(fermi.group(1)),
            "spin": True,
            "energy_ev": energy,
            "up": [r[1] for r in rows],
            "down": [r[2] for r in rows],
        }
    return {
        "fermi_ev": float(fermi.group(1)),
        "spin": False,
        "energy_ev": energy,
        "up": [r[1] for r in rows],
        "down": None,
    }


_PDOS_NAME = re.compile(r"\.pdos_atm#(\d+)\(([A-Za-z0-9_]+)\)_wfc#(\d+)\(([spdf])\)$")


def parse_pdos_name(name: str) -> tuple[int, str, str] | None:
    """-> (1-based atom number, species label, orbital letter) or None for pdos_tot / other files."""
    match = _PDOS_NAME.search(name)
    if not match:
        return None
    return int(match.group(1)), match.group(2), match.group(4)


def parse_pdos_atom_file(text: str, spin: bool) -> dict:
    """Atom-orbital PDOS: columns E, ldosup, ldosdw, then per-m pairs (spin) or E, ldos, per-m (no spin)."""
    rows = _data_rows(text)
    if not rows:
        raise QeParseError("PDOS file has no data.")
    return {
        "energy_ev": [r[0] for r in rows],
        "up": [r[1] for r in rows],
        "down": [r[2] for r in rows] if spin else None,
    }


def _round(values: Iterable[float], digits: int = 5) -> list[float]:
    return [round(v, digits) for v in values]


def build_dos_payload(
    dos: dict,
    pdos_files: dict[str, str],
    species_to_element: dict[str, str],
    *,
    window_ev: tuple[float, float] = (-20.0, 10.0),
) -> dict:
    """Total DOS + PDOS summed per element and orbital letter, energies relative to the Fermi level, clipped to a window.

    pdos_files maps a PDOS file name to its text. The total comes from dos.x; nothing is derived from the curves."""
    fermi = dos["fermi_ev"]
    spin = dos["spin"]
    keep = [i for i, e in enumerate(dos["energy_ev"]) if window_ev[0] <= e - fermi <= window_ev[1]]
    payload: dict = {
        "reference": "fermi_level",
        "fermi_ev": round(fermi, 5),
        "spin_polarized": spin,
        "energy_rel_fermi_ev": _round(dos["energy_ev"][i] - fermi for i in keep),
        "total_up": _round(dos["up"][i] for i in keep),
        "total_down": _round(dos["down"][i] for i in keep) if spin and dos["down"] else None,
        "projected": [],
    }
    grouped: dict[tuple[str, str], dict] = {}
    energy_axis: list[float] | None = None
    keep_p: list[int] = []
    for name in sorted(pdos_files):
        info = parse_pdos_name(name)
        if info is None:
            continue
        _atom, label, letter = info
        element = species_to_element.get(label) or re.sub(r"\d+$", "", label)
        parsed = parse_pdos_atom_file(pdos_files[name], spin)
        if energy_axis is None:
            energy_axis = parsed["energy_ev"]
            keep_p = [
                i for i, e in enumerate(energy_axis) if window_ev[0] <= e - fermi <= window_ev[1]
            ]
        group = grouped.setdefault(
            (element, letter), {"up": [0.0] * len(energy_axis), "down": [0.0] * len(energy_axis)}
        )
        if len(parsed["up"]) != len(energy_axis):
            raise QeParseError("PDOS files do not share one energy grid.")
        for i in range(len(energy_axis)):
            group["up"][i] += parsed["up"][i]
            if spin and parsed["down"] is not None:
                group["down"][i] += parsed["down"][i]
    if energy_axis is not None:
        payload["projected_energy_rel_fermi_ev"] = _round(energy_axis[i] - fermi for i in keep_p)
        for (element, letter), group in sorted(grouped.items()):
            payload["projected"].append(
                {
                    "element": element,
                    "orbital": letter,
                    "up": _round(group["up"][i] for i in keep_p),
                    "down": _round(group["down"][i] for i in keep_p) if spin else None,
                }
            )
    return payload


# ------------------------------------------------------------------------------------------------ bands.x files


def parse_bands_file(text: str) -> dict:
    """bands.x '<filband>': first line ' &plot nbnd= 60, nks= 49 /', then per k three coordinates + eigenvalues (eV)."""
    lines = text.splitlines()
    head = re.search(r"nbnd=\s*(\d+),\s*nks=\s*(\d+)", lines[0] if lines else "")
    if not head:
        raise QeParseError("bands file has no nbnd/nks header.")
    nbnd, nks = int(head.group(1)), int(head.group(2))
    tokens = [float(x) for line in lines[1:] for x in line.split()]
    per_k = 3 + nbnd
    if len(tokens) != nks * per_k:
        raise QeParseError("bands file length does not match its header.")
    energies = []
    for k in range(nks):
        block = tokens[k * per_k : (k + 1) * per_k]
        energies.append(block[3:])
    return {"nbnd": nbnd, "nks": nks, "energies_ev": energies}


def parse_bands_gnu_distances(text: str, nks: int) -> list[float]:
    """First band block of '<filband>.gnu' gives the k-path distance for every k-point."""
    distances: list[float] = []
    for line in text.splitlines():
        if not line.strip():
            if distances:
                break
            continue
        distances.append(float(line.split()[0]))
    if len(distances) != nks:
        raise QeParseError("bands .gnu file does not list one distance per k-point.")
    return distances


def node_indices(weights: Sequence[int]) -> list[int]:
    """Indices (0-based) of the path's high-symmetry points among the generated k-points (crystal_b weights)."""
    indices, position = [], 0
    for weight in weights:
        indices.append(position)
        position += int(weight)
    return indices


def build_bands_payload(
    up: dict,
    down: dict | None,
    distances: list[float],
    fermi_ev: float,
    labels: Sequence[str],
    weights: Sequence[int],
) -> dict:
    """Bands relative to the SCF Fermi level; VBM/CBM along the chosen path only (not the global gap)."""
    spins = {"up": up, "down": down} if down is not None else {"up": up}
    nodes = node_indices(weights)
    if len(nodes) != len(labels):
        raise QeParseError("Band-path labels and weights do not match.")
    vbm = -math.inf
    cbm = math.inf
    out_bands: dict[str, list[list[float]]] = {}
    for name, data in spins.items():
        by_band: list[list[float]] = [[] for _ in range(data["nbnd"])]
        for k in range(data["nks"]):
            for band in range(data["nbnd"]):
                energy = data["energies_ev"][k][band]
                by_band[band].append(round(energy - fermi_ev, 5))
                if energy <= fermi_ev:
                    vbm = max(vbm, energy)
                else:
                    cbm = min(cbm, energy)
        out_bands[name] = by_band
    gap = (cbm - vbm) if math.isfinite(vbm) and math.isfinite(cbm) else None
    return {
        "reference": "fermi_level",
        "fermi_ev": round(fermi_ev, 5),
        "k_distance": _round(distances),
        "nodes": [
            {"index": i, "label": label, "distance": round(distances[i], 5)}
            for i, label in zip(nodes, labels, strict=True)
        ],
        "bands_up": out_bands["up"],
        "bands_down": out_bands.get("down"),
        "vbm_ev": None if not math.isfinite(vbm) else round(vbm, 5),
        "cbm_ev": None if not math.isfinite(cbm) else round(cbm, 5),
        "gap_along_path_ev": None if gap is None else round(gap, 5),
    }
