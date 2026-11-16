"""Quantum ESPRESSO periodic DFT (release 0.0.43): fast tests, no QE needed.

Covers the pw.x input writer against the owner-verified pw_k3.in, species/sign assignment, the SSSP element table and the
Hubbard-label rule, limits and the estimator, every parser against hand-made snippets in the QE 7.6 formats, and the
worker's stage ordering / scratch / timeout / error paths with test-only stub executables (tests/qe_stub.py).
Opt-in real-QE tests are in test_qe_periodic_real.py (skipped unless pw.x is installed)."""

from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from pathlib import Path

import pytest
from qe_stub import configure, install_stubs

from chemdft_api.scientific.qe_periodic import qe_inputs, qe_limits, qe_parsers, qe_pseudopotentials
from chemdft_api.scientific.qe_periodic import qe_periodic_worker as worker

FIXTURES = Path(__file__).parent / "fixtures" / "qe"
WORKER_SCRIPT = Path(worker.__file__)

A_ANG = 5.35946661
ALPHA = 55.10304110
BOHR = 0.529177210903


def rhombohedral_lattice() -> list[list[float]]:
    """QE ibrav=5 vectors (Angstrom) for the Cr2O3 primitive cell: the same cell as the owner-verified run."""
    c = math.cos(math.radians(ALPHA))
    tx, ty, tz = math.sqrt((1 - c) / 2), math.sqrt((1 - c) / 6), math.sqrt((1 + 2 * c) / 3)
    a = A_ANG
    return [[a * tx, -a * ty, a * tz], [0.0, 2 * a * ty, a * tz], [-a * tx, -a * ty, a * tz]]


CR_Z = [0.84749, 0.34749, 0.15251, 0.65251]
O_POS = [
    (0.44430, 0.05570, 0.75000), (0.05570, 0.75000, 0.44430), (0.55570, 0.94430, 0.25000),
    (0.25000, 0.55570, 0.94430), (0.94430, 0.25000, 0.55570), (0.75000, 0.44430, 0.05570),
]


def cr2o3_document(**periodic) -> dict:
    atoms = [{"index": i, "element": "Cr", "atomic_number": 24, "fractional": [z, z, z]} for i, z in enumerate(CR_Z)]
    atoms += [{"index": 4 + i, "element": "O", "atomic_number": 8, "fractional": list(p)} for i, p in enumerate(O_POS)]
    options = {"k_mesh": [3, 3, 3], "magnetic_order": "antiferromagnetic", "u_effective_ev": {"Cr": 3.7}}
    options.update(periodic)
    return {
        "task": "PERIODIC_ENERGY", "method": "pbe+u", "basis": "pw-sssp-pbe-eff-v2", "charge": 0, "multiplicity": 1,
        "periodic_cell": {"lattice_vectors": rhombohedral_lattice()}, "atoms": atoms, "periodic": options,
    }


def namelist_values(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for key, value in re.findall(r"([A-Za-z_]+(?:\(\d+\))?)\s*=\s*('[^']*'|[^,\s/]+)", text):
        values[key.lower()] = value.strip("'").lower().replace("d-", "e-")
    return values


def section(text: str, name: str) -> list[str]:
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(name))
    out = []
    for line in lines[start + 1 :]:
        if line and not line.startswith(" "):
            break
        out.append(line.strip())
    return out


def metric(vectors) -> list[float]:
    return [round(sum(a * b for a, b in zip(vectors[i], vectors[j], strict=True)), 6) for i in range(3) for j in range(i, 3)]


# ------------------------------------------------------------------------------------------------ input writer


def test_input_matches_the_owner_verified_pw_k3_semantically():
    model = qe_inputs.build_model(cr2o3_document())
    mine = qe_inputs.write_pw_input(
        model, calculation="scf", pseudo_dir="/p", outdir="./out", k_mesh=(3, 3, 3)
    )
    reference = (FIXTURES / "pw_k3_owner_verified.in").read_text()
    a, b = namelist_values(mine), namelist_values(reference)
    for key in (
        "calculation", "ecutwfc", "ecutrho", "nspin", "nbnd", "occupations", "smearing", "degauss", "nat", "ntyp",
        "starting_magnetization(1)", "starting_magnetization(2)", "starting_magnetization(3)", "conv_thr",
        "mixing_beta", "electron_maxstep", "tprnfor", "tstress",
    ):
        assert float(a[key]) == float(b[key]) if re.fullmatch(r"-?[\d.e+-]+", a[key]) else a[key] == b[key], key
    assert (a["ecutwfc"], a["ecutrho"]) == ("45.0", "540.0")
    assert section(mine, "ATOMIC_SPECIES") == [s.replace("   ", " ") for s in section(reference, "ATOMIC_SPECIES")] or [
        r.split()[0::2] for r in section(mine, "ATOMIC_SPECIES")
    ] == [r.split()[0::2] for r in section(reference, "ATOMIC_SPECIES")]
    mine_pos = [(r.split()[0], tuple(round(float(x), 5) for x in r.split()[1:])) for r in section(mine, "ATOMIC_POSITIONS")]
    ref_pos = [(r.split()[0], tuple(round(float(x), 5) for x in r.split()[1:])) for r in section(reference, "ATOMIC_POSITIONS")]
    assert mine_pos == ref_pos
    assert section(mine, "K_POINTS") == ["3 3 3 0 0 0"] == section(reference, "K_POINTS")
    assert section(mine, "HUBBARD") == section(reference, "HUBBARD") == ["U Cr1-3d 3.7", "U Cr2-3d 3.7"]
    assert "HUBBARD (ortho-atomic)" in mine
    # the owner's ibrav=5 + celldm(1), celldm(4) describe the same cell as our CELL_PARAMETERS (compare metric tensors)
    celldm1 = float(re.search(r"celldm\(1\)=([\d.]+)", reference).group(1))
    celldm4 = float(re.search(r"celldm\(4\)=([\d.]+)", reference).group(1))
    cell = [[float(x) for x in r.split()] for r in section(mine, "CELL_PARAMETERS")]
    a_len = celldm1 * BOHR
    expected = [round(a_len**2 * (1.0 if i == j else celldm4), 6) for i in range(3) for j in range(i, 3)]
    assert metric(cell) == pytest.approx(expected, abs=2e-4)
    assert "CELL_PARAMETERS angstrom" in mine and "ibrav=0" in mine
    assert "tstress=.false." in mine  # stress is never requested


def test_species_and_signs_follow_the_pyscf_rule():
    model = qe_inputs.build_model(cr2o3_document())
    assert [s.label for s in model.species] == ["Cr1", "Cr2", "O"]
    assert [s.starting_magnetization for s in model.species] == [0.5, -0.5, 0.0]
    # along the cell diagonal 0.15251 (+) 0.34749 (-) 0.65251 (+) 0.84749 (-): atom order of pw_k3.in is Cr2 Cr2 Cr1 Cr1
    assert [a["species"] for a in model.atoms[:4]] == ["Cr2", "Cr2", "Cr1", "Cr1"]
    assert model.sublattice_signs == {0: -1, 1: -1, 2: 1, 3: 1}
    by_height = sorted(range(4), key=lambda i: CR_Z[i])
    assert [model.sublattice_signs[i] for i in by_height] == [1, -1, 1, -1]
    assert model.nbnd == 60 and model.n_electrons == 92 and model.nspin == 2


def test_ferromagnetic_none_and_nonmagnetic_cases():
    fm = qe_inputs.build_model(cr2o3_document(magnetic_order="ferromagnetic"))
    assert [s.label for s in fm.species] == ["Cr", "O"] and fm.species[0].starting_magnetization == 0.5
    assert section(qe_inputs.write_pw_input(fm, calculation="scf", pseudo_dir="/p", outdir="o", k_mesh=(1, 1, 1)), "HUBBARD") == ["U Cr-3d 3.7"]
    none = qe_inputs.build_model(cr2o3_document(magnetic_order="none"))
    text = qe_inputs.write_pw_input(none, calculation="scf", pseudo_dir="/p", outdir="o", k_mesh=(1, 1, 1))
    assert none.nspin == 1 and "nspin=1" in text and "starting_magnetization" not in text
    mgo = {
        "task": "PERIODIC_ENERGY", "method": "pbe", "periodic_cell": {"lattice_vectors": [[0, 2.1, 2.1], [2.1, 0, 2.1], [2.1, 2.1, 0]]},
        "atoms": [{"element": "Mg", "fractional": [0, 0, 0]}, {"element": "O", "fractional": [0.5, 0.5, 0.5]}],
        "periodic": {"k_mesh": [2, 2, 2], "magnetic_order": "antiferromagnetic"},
    }
    model = qe_inputs.build_model(mgo)
    assert model.nspin == 1 and model.magnetic_order == "none" and model.sublattice_signs == {}


def test_default_u_table_and_note_match_the_pyscf_worker():
    from chemdft_api.scientific.engines import pyscf_periodic_worker

    assert qe_inputs.DEFAULT_U_EFF == pyscf_periodic_worker.DEFAULT_U_EFF
    document = cr2o3_document()
    document["periodic"].pop("u_effective_ev")
    model = qe_inputs.build_model(document)
    assert model.u_effective_ev == {"Cr": 3.7} and model.used_default_u is True
    explicit = qe_inputs.build_model(cr2o3_document(u_effective_ev={"Cr": 2.0}))
    assert explicit.used_default_u is False


def test_relax_nscf_and_bands_inputs():
    model = qe_inputs.build_model(cr2o3_document())
    relax = qe_inputs.write_pw_input(model, calculation="relax", pseudo_dir="/p", outdir="o", k_mesh=(2, 2, 2), relax_max_steps=30)
    values = namelist_values(relax)
    assert values["calculation"] == "relax" and values["tprnfor"] == ".true." and values["nstep"] == "30"
    assert float(values["forc_conv_thr"]) == 1e-3 and float(values["etot_conv_thr"]) == 1e-5
    assert "ion_dynamics='bfgs'" in relax and "tstress=.false." in relax
    assert "vc-relax" not in relax
    nscf = qe_inputs.write_pw_input(model, calculation="nscf", pseudo_dir="/p", outdir="o", k_mesh=(6, 6, 6))
    assert section(nscf, "K_POINTS") == ["6 6 6 0 0 0"] and "calculation='nscf'" in nscf
    path = [([0, 0, 0], 12), ([0.5, 0.5, 0.5], 12), ([0.5, 0.5, 0], 12), ([0, 0, 0], 12), ([0.5, 0, 0], 1)]
    bands = qe_inputs.write_pw_input(model, calculation="bands", pseudo_dir="/p", outdir="o", k_path=path)
    assert "K_POINTS crystal_b" in bands and section(bands, "K_POINTS")[0] == "5"
    assert "0.50000000 0.50000000 0.50000000 12" in bands
    with pytest.raises(qe_inputs.QeInputError):
        qe_inputs.write_pw_input(model, calculation="vc-relax", pseudo_dir="/p", outdir="o", k_mesh=(1, 1, 1))


def test_positions_override_for_post_relax_stages():
    model = qe_inputs.build_model(cr2o3_document())
    moved = [[0.1, 0.2, 0.3]] * len(model.atoms)
    text = qe_inputs.write_pw_input(model, calculation="nscf", pseudo_dir="/p", outdir="o", k_mesh=(2, 2, 2), positions=moved)
    assert "0.1000000000 0.2000000000 0.3000000000" in text


def test_dos_projwfc_and_bands_namelists_use_the_verified_settings():
    dos = qe_inputs.write_dos_input(outdir="o", fildos="d")
    assert "degauss=0.01" in dos and "DeltaE=0.02" in dos
    assert "DeltaE=0.05" in qe_inputs.write_projwfc_input(outdir="o", filpdos="p")
    assert "spin_component=2" in qe_inputs.write_bands_input(outdir="o", filband="b", spin_component=2)
    assert "spin_component" not in qe_inputs.write_bands_input(outdir="o", filband="b", spin_component=None)


# ------------------------------------------------------------------------------------------------ element table


def test_element_table_matches_the_sssp_tarball_facts():
    table = qe_pseudopotentials.SSSP_EFFICIENCY_V2
    assert len(table) + len(qe_pseudopotentials.UNOFFERED_ELEMENTS) == 95
    cr = qe_pseudopotentials.pseudo_for_element("Cr")
    o = qe_pseudopotentials.pseudo_for_element("O")
    assert cr["file"] == "Cr.us.pbe.z_14.uspp.gbrv.v1.5.upf" and (cr["ecutwfc_ry"], cr["ecutrho_ry"]) == (35.0, 175.0)
    assert o["file"] == "O.paw.pbe.z_6.ld1.psl.v0.1.upf" and (o["ecutwfc_ry"], o["ecutrho_ry"]) == (45.0, 540.0)
    assert cr["library"] == "gbrv" and o["library"] == "psl0"
    assert all(row[5] in qe_pseudopotentials.LIBRARY_BY_TAG for row in table.values())
    assert qe_pseudopotentials.PSEUDO_LIBRARY_NAME == "SSSP PBE Efficiency v2.0"
    assert qe_pseudopotentials.PSEUDO_LIBRARY_DOI == "10.24435/materialscloud:f3-ym"
    # the first-appearance order and the cutoffs for a Cr2O3 run
    model = qe_inputs.build_model(cr2o3_document())
    assert (model.ecutwfc_ry, model.ecutrho_ry) == (45.0, 540.0)


def test_hubbard_manifold_label_is_checked_against_the_upf_headers():
    for element in sorted(qe_pseudopotentials.HUBBARD_3D_ELEMENTS):
        assert qe_pseudopotentials.hubbard_label_available(element, "3D"), element
    assert not qe_pseudopotentials.hubbard_label_available("O", "3D")
    assert qe_pseudopotentials.SSSP_EFFICIENCY_V2["Cr"][6] == ("3D", "3P", "3S", "4S")


def test_unoffered_and_unknown_elements_and_plus_u_refusals(monkeypatch):
    for element in ("U", "Pa", "La"):
        doc = cr2o3_document()
        doc["atoms"][4]["element"] = element
        with pytest.raises(qe_inputs.QeInputError, match="not offered"):
            qe_inputs.build_model(doc)
    doc = cr2o3_document()
    doc["atoms"][4]["element"] = "Xx"
    with pytest.raises(qe_inputs.QeInputError, match="no pseudopotential"):
        qe_inputs.build_model(doc)
    with pytest.raises(qe_inputs.QeInputError, match="3d transition metals"):
        qe_inputs.build_model(cr2o3_document(u_effective_ev={"Cr": 3.7, "O": 2.0}))
    monkeypatch.setitem(
        qe_pseudopotentials.SSSP_EFFICIENCY_V2, "Cr",
        (*qe_pseudopotentials.SSSP_EFFICIENCY_V2["Cr"][:6], ("3S",), *qe_pseudopotentials.SSSP_EFFICIENCY_V2["Cr"][7:]),
    )
    with pytest.raises(qe_inputs.QeInputError, match="no 3D projector label"):
        qe_inputs.build_model(cr2o3_document())


def test_every_offered_element_has_a_known_original_library():
    keys = set(qe_pseudopotentials.LIBRARY_BY_TAG.values())
    assert keys == {"gbrv", "pslibrary-0", "pslibrary-1", "jth", "spms", "sg15", "pseudodojo", "tw14"}


# ------------------------------------------------------------------------------------------------ limits and estimator


def test_limits_and_refusals():
    limits = qe_limits.QeLimits()
    base = dict(atoms=10, ecutwfc_ry=45.0, scf_mesh=(3, 3, 3), relax=False, relax_max_steps=30, dos=False,
                dos_mesh=(6, 6, 6), bands=False, band_points=0)
    assert qe_limits.refusal(limits, **base) is None
    assert "20 atoms" in qe_limits.refusal(limits, **{**base, "atoms": 21})
    assert "Gamma, 2x2x2, 3x3x3 or 4x4x4" in qe_limits.refusal(limits, **{**base, "scf_mesh": (5, 5, 5)})
    assert "DOS k-point mesh" in qe_limits.refusal(limits, **{**base, "dos": True, "dos_mesh": (7, 7, 7)})
    assert "band path" in qe_limits.refusal(limits, **{**base, "bands": True, "band_points": 101})
    assert "ionic steps" in qe_limits.refusal(limits, **{**base, "relax": True, "relax_max_steps": 31})
    assert qe_limits.refusal(limits, **{**base, "bands": True, "band_points": 100}) is None


def test_memory_estimate_refuses_over_six_gb_and_reproduces_the_measured_bands_x():
    assert qe_limits.estimate_memory_mb(atoms=10, ecutwfc_ry=45, band_points=49, bands=True, dos=False) == pytest.approx(1100, abs=1)
    limits = qe_limits.QeLimits()
    msg = qe_limits.refusal(limits, atoms=20, ecutwfc_ry=80.0, scf_mesh=(1, 1, 1), relax=False, relax_max_steps=30,
                            dos=False, dos_mesh=(6, 6, 6), bands=True, band_points=100)
    assert msg and "memory" in msg


def test_time_estimate_reproduces_the_measured_10_atom_numbers():
    gamma = qe_limits.estimate_seconds(atoms=10, ecutwfc_ry=45, scf_mesh=(1, 1, 1), nspin=2, relax=False, dos=False,
                                       dos_mesh=(6, 6, 6), bands=False, band_points=0)
    k222 = qe_limits.estimate_seconds(atoms=10, ecutwfc_ry=45, scf_mesh=(2, 2, 2), nspin=2, relax=False, dos=False,
                                      dos_mesh=(6, 6, 6), bands=False, band_points=0)
    assert gamma["scf"] == pytest.approx(52, abs=3) and k222["scf"] == pytest.approx(62, abs=3)
    big = qe_limits.estimate_seconds(atoms=20, ecutwfc_ry=45, scf_mesh=(1, 1, 1), nspin=2, relax=False, dos=False,
                                     dos_mesh=(6, 6, 6), bands=False, band_points=0)
    assert big["scf"] == pytest.approx(gamma["scf"] * 8, rel=0.01)
    assert "Rough estimate" in qe_limits.ESTIMATE_LABEL


# ------------------------------------------------------------------------------------------------ parsers

XML_TEMPLATE = (
    "<qes:espresso xmlns:qes='urn:x'><output><total_energy><etot>{etot}</etot></total_energy><band_structure>"
    "<lsda>true</lsda><fermi_energy>{ef}</fermi_energy>{ks}</band_structure>"
    "<magnetization><lsda>true</lsda><total>0.0000</total><absolute>12.3842</absolute></magnetization></output></qes:espresso>"
)


def ks(eigs, occs):
    return (f"<ks_energies><k_point weight='1.0'>0 0 0</k_point><eigenvalues size='{len(eigs)}'>{' '.join(map(str, eigs))}"
            f"</eigenvalues><occupations size='{len(occs)}'>{' '.join(map(str, occs))}</occupations></ks_energies>")


def test_parse_xml_gap_fermi_magnetization():
    H = qe_parsers.HARTREE_EV
    xml = XML_TEMPLATE.format(etot=-475.9995944, ef=0.5, ks=ks([0.1, 0.4, 0.62, 0.9], [1, 1, 0, 0]) + ks([0.2, 0.45, 0.6, 1.0], [1, 0.9999, 0.0001, 0]))
    out = qe_parsers.parse_xml(xml)
    assert out["total_energy_hartree"] == -475.9995944
    assert out["band_gap_ev"] == pytest.approx((0.6 - 0.45) * H)  # lowest empty minus highest occupied over all k and spins
    assert out["fermi_energy_ev"] == pytest.approx(0.5 * H)
    assert out["total_magnetization"] == 0.0 and out["absolute_magnetization"] == 12.3842
    assert out["spin_polarized"] is True and out["k_points_in_file"] == 2


def test_parse_xml_rejects_garbage():
    with pytest.raises(qe_parsers.QeParseError):
        qe_parsers.parse_xml("<not-xml")
    with pytest.raises(qe_parsers.QeParseError):
        qe_parsers.parse_xml("<a><b/></a>")


SCF_OUT = """
     Program PWSCF v.7.6 starts on 12Nov2026
     number of k points=     6  Fermi-Dirac smearing, width (Ry)=  0.0100
!    total energy              =    -951.99918880 Ry
     convergence has been achieved in  14 iterations
     JOB DONE.
"""


def test_parse_scf_stdout_requires_the_convergence_line():
    ok = qe_parsers.parse_scf_stdout(SCF_OUT)
    assert ok == {"converged": True, "total_energy_ry": -951.9991888, "scf_iterations": 14, "irreducible_k_points": 6, "job_done": True}
    bad = qe_parsers.parse_scf_stdout(SCF_OUT.replace("convergence has been achieved in  14 iterations", "convergence NOT achieved after 200 iterations"))
    assert bad["converged"] is False


RELAX_OUT = """
!    total energy              =    -951.10000000 Ry
     Forces acting on atoms (cartesian axes, Ry/au):

     atom    1 type  1   force =     0.00000000    0.00000000    0.01100000
     atom    2 type  2   force =     0.00000000    0.00000000   -0.01100000

     Total force =     0.015556     Total SCF correction =     0.000015
!    total energy              =    -951.20000000 Ry
     Forces acting on atoms (cartesian axes, Ry/au):

     atom    1 type  1   force =     0.00000000    0.00000000    0.00040000
     atom    2 type  2   force =     0.00010000    0.00000000   -0.00090000

     Total force =     0.001000     Total SCF correction =     0.000001
     bfgs converged in   7 scf cycles and   6 bfgs steps
     End of BFGS Geometry Optimization

     Final energy   =    -951.20000000 Ry
Begin final coordinates

ATOMIC_POSITIONS (crystal)
Cr1           0.8479600000        0.8479600000        0.8479600000
O             0.4443000000        0.0557000000        0.7500000000
End final coordinates
     JOB DONE.
"""


def test_parse_relax_stdout():
    out = qe_parsers.parse_relax_stdout(RELAX_OUT)
    assert out["converged"] is True and out["bfgs_steps"] == 6 and out["scf_cycles"] == 7
    assert out["initial_energy_ry"] == -951.1 and out["final_energy_ry"] == -951.2
    assert out["max_force_ry_bohr"] == 0.0009 and out["total_force_ry_bohr"] == 0.001
    assert out["final_positions_crystal"][0] == ("Cr1", [0.84796, 0.84796, 0.84796]) and len(out["final_positions_crystal"]) == 2


def test_relax_that_hits_nstep_is_not_converged():
    text = RELAX_OUT.replace("     bfgs converged in   7 scf cycles and   6 bfgs steps\n", "     The maximum number of steps has been reached.\n")
    out = qe_parsers.parse_relax_stdout(text)
    assert out["converged"] is False and out["hit_step_limit"] is True


PROJWFC_OUT = """
     Lowdin Charges:

     Atom #   1: total charge =  12.9100, s =  2.0000, p =  5.9500, d =  4.9600,
     Atom #   2: total charge =  12.9100, s =  2.0000, p =  5.9500, d =  4.9600,
     Atom #   3: total charge =   6.2000, s =  1.8000, p =  4.4000,

     Spin up
     Atom #   1: total charge =   9.9500, s =  1.0000, p =  2.9800, d =  3.9700,
     Polarization:
     Atom #   1: polarization =   2.9970, s =   0.0010, p =   0.0190, d =   2.9770,
     Atom #   2: polarization =  -2.9970, s =  -0.0010, p =  -0.0190, d =  -2.9770,
     Atom #   3: polarization =   0.0010, s =   0.0000, p =   0.0010,
"""


def test_parse_projwfc_lowdin_polarization():
    out = qe_parsers.parse_projwfc_lowdin(PROJWFC_OUT)
    assert out[1]["polarization"] == 2.997 and out[1]["d"] == 2.977
    assert out[2]["polarization"] == -2.997 and out[3]["polarization"] == 0.001 and "d" not in out[3]


def test_parse_projwfc_with_polarization_on_the_charge_line():
    text = "     Atom #   1: total charge =  7.0, s = 1.0, p = 2.0, d = 4.0, polarization = -2.9970, s = 0.1, p = 0.2, d = -2.9770,\n"
    assert qe_parsers.parse_projwfc_lowdin(text)[1]["polarization"] == -2.997


DOS_FILE = """# E (eV)  dosup(E)  dosdw(E)  Int dos(E) EFermi =  12.798 eV
  -7.202  0.0000E+00  0.0000E+00  0.0000E+00
   5.000  0.1000E+00  0.2000E+00  0.5000E+00
  12.800  0.0000E+00  0.0000E+00  0.9000E+00
  14.500  0.3000E+00  0.4000E+00  0.9500E+00
"""


def test_parse_dos_and_pdos_payload():
    dos = qe_parsers.parse_dos_file(DOS_FILE)
    assert dos["fermi_ev"] == 12.798 and dos["spin"] is True and dos["up"][1] == 0.1 and dos["down"][3] == 0.4
    pdos_a = "# E (eV)  ldosup(E)  ldosdw(E)  pdos(E)\n 5.0 1.0 0.5 0.1\n 6.0 2.0 1.0 0.2\n"
    pdos_b = "# E (eV)  ldosup(E)  ldosdw(E)  pdos(E)\n 5.0 3.0 1.5 0.1\n 6.0 4.0 2.0 0.2\n"
    files = {"x.pdos_atm#1(Cr1)_wfc#1(d)": pdos_a, "x.pdos_atm#2(Cr2)_wfc#1(d)": pdos_b, "x.pdos_tot": "ignored"}
    payload = qe_parsers.build_dos_payload(dos, files, {"Cr1": "Cr", "Cr2": "Cr"})
    assert payload["reference"] == "fermi_level" and payload["fermi_ev"] == 12.798
    assert payload["energy_rel_fermi_ev"][1] == pytest.approx(5.0 - 12.798, abs=1e-4)
    assert len(payload["projected"]) == 1 and payload["projected"][0]["element"] == "Cr"
    assert payload["projected"][0]["up"] == [4.0, 6.0] and payload["projected"][0]["down"] == [2.0, 3.0]
    assert qe_parsers.parse_pdos_name("x.pdos_atm#3(O)_wfc#2(p)") == (3, "O", "p")
    assert qe_parsers.parse_pdos_name("x.pdos_tot") is None
    with pytest.raises(qe_parsers.QeParseError):
        qe_parsers.parse_dos_file("# E (eV) dos\n 1 2\n")


def test_parse_bands_files_and_gap_along_path():
    nbnd, nks = 3, 5
    rows = [f" &plot nbnd= {nbnd}, nks= {nks} /"]
    for k in range(nks):
        rows.append(f"   {0.1 * k:.6f}  0.000000  0.000000")
        rows.append("   " + " ".join(f"{e:.3f}" for e in (10.0 + 0.1 * k, 11.0, 15.0 - 0.1 * k)))
    parsed = qe_parsers.parse_bands_file("\n".join(rows) + "\n")
    assert parsed["nbnd"] == 3 and parsed["nks"] == 5
    gnu = "\n".join(f"{0.25 * k:.4f} {10.0 + 0.1 * k:.3f}" for k in range(nks)) + "\n\n" + "0 1\n"
    distances = qe_parsers.parse_bands_gnu_distances(gnu, nks)
    assert distances[-1] == 1.0
    payload = qe_parsers.build_bands_payload(parsed, None, distances, 12.0, ["G", "Z", "L"], [2, 2, 1])
    assert payload["vbm_ev"] == 11.0 and payload["cbm_ev"] == 14.6
    assert payload["gap_along_path_ev"] == pytest.approx(3.6)
    assert [n["index"] for n in payload["nodes"]] == [0, 2, 4]
    assert qe_parsers.node_indices([12, 12, 12, 12, 1]) == [0, 12, 24, 36, 48]
    with pytest.raises(qe_parsers.QeParseError):
        qe_parsers.parse_bands_file(" &plot nbnd= 3, nks= 9 /\n 0 0 0\n 1 2 3\n")


# ------------------------------------------------------------------------------------------------ worker orchestration


def run_worker(tmp_path, monkeypatch, document, mode="ok", limits=None):
    bin_dir = install_stubs(tmp_path / "bin")
    pseudo_dir = tmp_path / "pseudo"
    pseudo_dir.mkdir()
    for file in {r[0] for r in qe_pseudopotentials.SSSP_EFFICIENCY_V2.values() if r[0].startswith(("Cr.", "O."))}:
        (pseudo_dir / file).write_text("stub pseudopotential placeholder (test only)")
    log = tmp_path / "calls.log"
    configure(bin_dir, mode, log)
    monkeypatch.setenv("CHEMDFT_QE_BIN_DIR", str(bin_dir))
    monkeypatch.setenv("CHEMDFT_QE_PSEUDO_DIR", str(pseudo_dir))
    monkeypatch.setenv("CHEMDFT_QE_SCRATCH", str(tmp_path / "scratch"))
    if limits:
        document["qe_limits"] = limits
    (tmp_path / "input.json").write_text(json.dumps(document))
    code = worker.run(tmp_path / "input.json", tmp_path / "result.json", tmp_path / "engine.log")
    result = json.loads((tmp_path / "result.json").read_text()) if (tmp_path / "result.json").exists() else None
    calls = log.read_text().splitlines() if log.exists() else []
    return code, result, calls


PATH = {"labels": ["G", "Z", "F", "G", "L"], "points": [[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0.5, 0], [0, 0, 0], [0.5, 0, 0]],
        "weights": [12, 12, 12, 12, 1], "source": "test fixture"}


def test_scf_only_stage_order_and_result(tmp_path, monkeypatch):
    code, result, calls = run_worker(tmp_path, monkeypatch, cr2o3_document())
    assert code == 0 and result["converged"] is True and result["engine"] == "qe"
    programs = [c.split()[0] for c in calls if not c.startswith("mpirun")]
    assert programs == ["pw.x", "projwfc.x"]  # scf, then Lowdin moments; no dos / bands requested
    assert result["total_energy_hartree"] == -475.0 and result["engine_version"] == "7.6"
    assert result["band_gap_ev"] == pytest.approx(0.12 * qe_parsers.HARTREE_EV, abs=0.2) or result["band_gap_ev"] > 0
    assert result["local_magnetic_moments"] == {"0": 2.997, "1": -2.997, "2": 2.997, "3": -2.997}
    assert result["local_moment_kind"] == "lowdin-projected" and result["pseudopotential"] == "SSSP PBE Efficiency v2.0"
    assert result["irreducible_k_points"] == 4
    assert "tstress=.false." in (tmp_path / "scratch" / "scf.in").read_text()
    # mpirun is used with the verified flag and the vCPU count
    assert any("--use-hwthread-cpus -np 2" in c for c in calls if c.startswith("mpirun"))
    # wavefunctions are removed after the last stage
    assert not list((tmp_path / "scratch").rglob("wfc*"))
    log = (tmp_path / "engine.log").read_text()
    assert "!    total energy" in log and "=== pw.x scf ===" in log


def test_full_pipeline_order_scratch_and_payloads(tmp_path, monkeypatch):
    doc = cr2o3_document(relax=True, relax_max_steps=30, dos=True, dos_k_mesh=[6, 6, 6], bands=True, band_path=PATH)
    code, result, calls = run_worker(tmp_path, monkeypatch, doc)
    assert code == 0, result
    order = [c.split()[0] for c in calls if not c.startswith("mpirun")]
    # relax, then (release 0.0.46) a fixed-geometry scf at the relaxed positions, then Lowdin, DOS and bands
    assert order == ["pw.x", "pw.x", "projwfc.x", "pw.x", "dos.x", "projwfc.x", "pw.x", "bands.x", "bands.x"]
    inputs = [(tmp_path / "scratch" / n).read_text() for n in ("scf.in", "nscf.in", "bands.in")]
    final_scf = (tmp_path / "scratch" / "scf_final.in").read_text()
    assert "calculation='scf'" in final_scf and "0.8484900000" in final_scf
    assert "calculation='relax'" in inputs[0] and "calculation='nscf'" in inputs[1] and "calculation='bands'" in inputs[2]
    # nscf and bands start from the relaxed positions (+0.001 in the stub), not the originals
    assert "0.8484900000" in inputs[1] and "0.8484900000" in inputs[2]
    assert result["relaxation"]["converged"] is True and result["relaxation"]["ionic_steps"] == 6
    assert len(result["relaxation"]["final_positions"]) == 10
    assert result["dos"]["fermi_ev"] == 12.798 and result["dos"]["projected"]
    assert {p["element"] for p in result["dos"]["projected"]} == {"Cr", "O"}
    assert result["bands"]["nodes"][1]["index"] == 12 and result["bands"]["gap_along_path_ev"] is not None
    assert not list((tmp_path / "scratch").rglob("wfc*")) and not (tmp_path / "scratch" / "out_dos").exists()
    assert "stress" not in json.dumps(result).lower() and "pressure" not in json.dumps(result).lower()


def test_not_converged_scf_publishes_nothing(tmp_path, monkeypatch):
    code, result, _ = run_worker(tmp_path, monkeypatch, cr2o3_document(), mode="not-converged")
    assert code == 3 and result["converged"] is False and "did not reach convergence" in result["failure_reason"]
    assert "total_energy_hartree" not in result


def test_relax_that_does_not_converge_is_reported_and_not_published(tmp_path, monkeypatch):
    code, result, _ = run_worker(tmp_path, monkeypatch, cr2o3_document(relax=True), mode="relax-steps")
    assert code == 3 and result["converged"] is False and "ionic steps" in result["failure_reason"]
    assert "relaxation" not in result


def test_program_failure_and_timeout_paths(tmp_path, monkeypatch):
    code, result, _ = run_worker(tmp_path, monkeypatch, cr2o3_document(), mode="pw-fail")
    assert code == 3 and "exit code 1" in result["failure_reason"] and result["converged"] is False
    sub = tmp_path / "t"
    sub.mkdir()
    code, result, _ = run_worker(sub, monkeypatch, cr2o3_document(), mode="slow", limits={"timeout_scf_s": 2})
    assert code == 3 and "exceeded" in result["failure_reason"]


def test_refusals_before_anything_runs(tmp_path, monkeypatch):
    doc = cr2o3_document(k_mesh=[5, 5, 5])
    bin_dir = install_stubs(tmp_path / "bin")
    monkeypatch.setenv("CHEMDFT_QE_BIN_DIR", str(bin_dir))
    (tmp_path / "input.json").write_text(json.dumps(doc))
    with pytest.raises(ValueError, match="Gamma, 2x2x2"):
        worker.run(tmp_path / "input.json", tmp_path / "r.json", tmp_path / "l.log")


def test_worker_script_runs_standalone_and_reports_errors(tmp_path):
    (tmp_path / "input.json").write_text(json.dumps({"task": "ENERGY"}))
    done = subprocess.run(
        [sys.executable, str(WORKER_SCRIPT), "--input", str(tmp_path / "input.json"), "--result", str(tmp_path / "r.json"),
         "--log", str(tmp_path / "l.log")], capture_output=True, text=True, check=False)
    assert done.returncode == 2 and "worker_error:ValueError" in done.stderr


def test_condensed_log_keeps_energy_lines_only():
    text = "noise\n" * 5 + SCF_OUT
    kept = worker.condense(text, "pw.x scf")
    assert "!    total energy" in kept and "noise" not in kept


def test_stub_executables_are_not_reachable_from_product_code():
    src = Path(worker.__file__).parents[2]
    for path in src.rglob("*.py"):
        assert "qe_stub" not in path.read_text(), path


def test_relax_reports_the_final_geometry_not_the_first_ionic_step(tmp_path, monkeypatch):
    """Live job 1865196f: total_energy_hartree was the first "!" energy / 2. A relax result must carry the final energy."""
    code, result, calls = run_worker(tmp_path, monkeypatch, cr2o3_document(relax=True))
    assert code == 0, result
    first_step_hartree = -949.9999 * 0.5
    assert result["relaxation"]["initial_energy_hartree"] == pytest.approx(first_step_hartree)
    assert result["total_energy_hartree"] == -475.0  # from the fixed-geometry scf, not the relax xml (-474.99995)
    assert result["total_energy_hartree"] != pytest.approx(first_step_hartree, abs=1e-6)
    assert result["relaxation"]["final_energy_hartree"] == pytest.approx(-475.0000005)
    assert abs(result["relaxation"]["final_scf_minus_relax_hartree"]) < 1e-6
    assert result["scf_iterations"] == 12 and result["relaxation"]["total_force_ry_per_bohr"] == 0.0007
    # the published energy agrees with the log the backend re-reads (the strict 1e-7 Ha check stays as it is)
    from chemdft_api.calculation_actions import _require_qe_log_energy

    _require_qe_log_energy(result, (tmp_path / "engine.log").read_bytes())


def test_relax_whose_final_scf_disagrees_with_the_relax_log_is_not_published(tmp_path, monkeypatch):
    code, result, _ = run_worker(tmp_path, monkeypatch, cr2o3_document(relax=True), mode="scf-differs")
    assert code == 3 and result["converged"] is False
    assert "could not be confirmed against the engine log" in result["failure_reason"]
    assert "total_energy_hartree" not in result


def test_final_energy_agreement_limit_is_1e_6_hartree():
    assert qe_parsers.check_final_energy_agreement(-475.0, -475.0 + 9e-7) == pytest.approx(9e-7)
    with pytest.raises(qe_parsers.QeParseError, match="could not be confirmed"):
        qe_parsers.check_final_energy_agreement(-475.0, -475.0 + 2e-6)


# Numbers of live job 1865196f (Cr4O6, 2x2x2, AFM, U(Cr)=3.7) from its engine.log; the surrounding lines are SYNTHETIC
# (the real 14 KB log could not be fetched when this was written: AWS connector unavailable), so only the energies, the cycle
# counts and the last total force are real. Replace with the trimmed real log when it is available.
LIVE_1865196F_RELAX = """
!    total energy              =    -951.99924374 Ry
     Forces acting on atoms (cartesian axes, Ry/au):

     atom    1 type  1   force =     0.00000000    0.00000000    6.73700000
     atom    2 type  1   force =     0.00000000    0.00000000   -6.73700000

     Total force =     9.527000     Total SCF correction =     0.000400
!    total energy              =    -951.99934032 Ry
     Forces acting on atoms (cartesian axes, Ry/au):

     atom    1 type  1   force =     0.00000000    0.00000000    0.00500000
     atom    2 type  1   force =     0.00000000    0.00000000   -0.00500000

     Total force =     0.007071     Total SCF correction =     0.000100
!    total energy              =    -951.99937014 Ry
     Forces acting on atoms (cartesian axes, Ry/au):

     atom    1 type  1   force =     0.00000000    0.00000000    0.00100000
     atom    2 type  1   force =     0.00000000    0.00000000   -0.00100000

     Total force =     0.001414     Total SCF correction =     0.000010
!    total energy              =    -951.99937218 Ry
     Forces acting on atoms (cartesian axes, Ry/au):

     atom    1 type  1   force =     0.00000000    0.00000000    0.00077300
     atom    2 type  1   force =     0.00000000    0.00000000   -0.00077300

     Total force =     0.001093     Total SCF correction =     0.000010
     bfgs converged in   4 scf cycles and   3 bfgs steps
     End of BFGS Geometry Optimization

     Final energy   =    -951.9993721791 Ry
Begin final coordinates

ATOMIC_POSITIONS (crystal)
Cr            0.8479300000        0.8479300000        0.8479300000
O             0.4443000000        0.0557000000        0.7500000000
End final coordinates
     JOB DONE.
"""


def test_live_numbers_parser_and_backend_check_agree_on_the_final_energy():
    from chemdft_api.calculation_actions import _require_qe_log_energy

    out = qe_parsers.parse_relax_stdout(LIVE_1865196F_RELAX)
    assert out["final_energy_ry"] * 0.5 == pytest.approx(-475.99968609, abs=1e-8)
    assert out["initial_energy_ry"] * 0.5 == pytest.approx(-475.99962187, abs=1e-8)
    assert out["bfgs_steps"] == 3 and out["scf_cycles"] == 4
    assert out["total_force_ry_bohr"] == 0.001093 and out["max_force_ry_bohr"] == 0.000773  # the last ionic step only
    final_ha = out["final_energy_ry"] * 0.5
    _require_qe_log_energy({"total_energy_hartree": final_ha}, LIVE_1865196F_RELAX.encode())
    with pytest.raises(ValueError, match="contradicts"):  # the first-step energy is what was rejected live
        _require_qe_log_energy({"total_energy_hartree": out["initial_energy_ry"] * 0.5}, LIVE_1865196F_RELAX.encode())
    with pytest.raises(ValueError, match="contradicts"):  # a mismatch still raises: the 1e-7 Ha tolerance is unchanged
        _require_qe_log_energy({"total_energy_hartree": final_ha + 2e-7}, LIVE_1865196F_RELAX.encode())


def test_a_force_larger_than_the_printed_total_is_never_published_as_the_final_force():
    broken = LIVE_1865196F_RELAX.replace("0.00077300", "6.73700000").replace("-0.00077300", "-6.73700000")
    out = qe_parsers.parse_relax_stdout(broken)
    assert out["max_force_ry_bohr"] is None and out["max_force_consistent"] is False
    assert out["total_force_ry_bohr"] == 0.001093
