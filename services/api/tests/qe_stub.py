"""TEST-ONLY stand-ins for the Quantum ESPRESSO programs.

They write canned files in the formats of real QE 7.6 (taken from the owner's AWS run) so the worker's stage ordering,
scratch handling, timeouts and error paths can be tested without QE. Nothing here is importable from product code and
no value written here is ever shown in the product: the numbers are arbitrary placeholders for parser/orchestration tests.
"""

from __future__ import annotations

import stat
import sys
from pathlib import Path

H = 27.211386245988

STUB_SOURCE = r'''#!{python}
import os, re, sys, time
from pathlib import Path

prog = Path(sys.argv[0]).name
args = sys.argv[1:]
import json
config = json.loads((Path(os.path.abspath(sys.argv[0])).parent / "config.json").read_text())
mode = config.get("mode", "ok")
log = config.get("log")
if log:
    with open(log, "a") as f:
        f.write(prog + " " + " ".join(args) + "\n")

if prog == "mpirun":
    i = 0
    while i < len(args) and args[i] != "-in" and not args[i].endswith(("pw.x", "projwfc.x")):
        i += 2 if args[i] == "-np" else 1
    os.execv(os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), os.path.basename(args[i])), args[i:])

infile = args[args.index("-in") + 1]
text = Path(infile).read_text()

def val(key, default=None):
    m = re.search(key + r"\s*=\s*'?([^',\n ]+)", text)
    return m.group(1) if m else default

def write_xml(outdir, gap_up=0.12, nspin2=True, etot=-475.0):
    save = Path(outdir) / "chemdft.save"
    save.mkdir(parents=True, exist_ok=True)
    vb, cb = -0.05, -0.05 + gap_up  # Hartree
    xml = (
        f"<qes:espresso xmlns:qes='x'><output><total_energy><etot>{etot}</etot></total_energy>"
        "<band_structure><lsda>true</lsda><nbnd_up>2</nbnd_up><nbnd_dw>2</nbnd_dw><fermi_energy>0.0</fermi_energy>"
        "<ks_energies><k_point weight='1'>0 0 0</k_point><eigenvalues size='4'>"
        + f"{vb - 0.1} {vb} {cb} {cb + 0.1}" + "</eigenvalues><occupations size='4'>1 1 0 0</occupations></ks_energies>"
        "<ks_energies><k_point weight='1'>0.5 0 0</k_point><eigenvalues size='4'>"
        + f"{vb - 0.2} {vb - 0.01} {cb + 0.01} {cb + 0.2}" + "</eigenvalues><occupations size='4'>1 1 0 0</occupations></ks_energies>"
        "</band_structure><magnetization><lsda>true</lsda><total>0.0</total><absolute>12.38</absolute></magnetization>"
        "</output></qes:espresso>"
    )
    (save / "data-file-schema.xml").write_text(xml)
    (save / "wfc1.dat").write_bytes(b"\0" * 2048)
    (save / "charge-density.dat").write_bytes(b"\0" * 64)

if prog == "pw.x":
    calc = val("calculation")
    outdir = val("outdir")
    if mode == "pw-fail":
        print("Error in routine fake (1): stub failure")
        sys.exit(1)
    if mode == "slow" and calc == "scf":
        time.sleep(60)
    out = ["     Program PWSCF v.7.6 starts on  1Jan2026", "     number of k points=     4"]
    if calc in ("scf", "relax"):
        if mode == "not-converged":
            out += ["     convergence NOT achieved after 200 iterations: stopping"]
        else:
            energy_ry = -950.01 if (mode == "scf-differs" and calc == "scf") else -950.0
            if calc == "relax":  # first ionic step: the energy the saved xml wrongly kept in live job 1865196f
                out += ["!    total energy              =    -949.99990000 Ry"]
            out += [f"!    total energy              =    {energy_ry:.8f} Ry",
                    "     convergence has been achieved in  12 iterations"]
        if calc == "relax":
            out += ["     Forces acting on atoms (cartesian axes, Ry/au):", "",
                    "     atom    1 type  1   force =     0.00000000    0.00000000   -0.00040000",
                    "     atom    2 type  2   force =     0.00000000    0.00000000    0.00030000", "",
                    "     Total force =     0.000700     Total SCF correction =     0.000001"]
            if mode == "relax-steps":
                out += ["     The maximum number of steps has been reached."]
            else:
                out += ["     bfgs converged in   7 scf cycles and   6 bfgs steps",
                        "     End of BFGS Geometry Optimization",
                        "     Final energy   =    -950.00000100 Ry",
                        "Begin final coordinates", "ATOMIC_POSITIONS (crystal)"]
                block = text.split("ATOMIC_POSITIONS crystal")[1].split("CELL_PARAMETERS")[0].strip().splitlines()
                for row in block:
                    label, x, y, z = row.split()
                    out.append(f"{label} {float(x) + 0.001:.10f} {float(y) + 0.001:.10f} {float(z) + 0.001:.10f}")
                out += ["End final coordinates"]
    out += ["     JOB DONE."]
    print("\n".join(out))
    if calc == "relax":
        write_xml(outdir, etot=-474.99995)  # first-step energy, as the real saved xml held after the relaxation
    elif calc in ("scf", "nscf"):
        write_xml(outdir, etot=-475.005 if (mode == "scf-differs" and calc == "scf") else -475.0)
    if calc == "bands":
        pass
    sys.exit(0)

if prog == "projwfc.x":
    outdir = val("outdir")
    filpdos = val("filpdos")
    print("     Program PROJWFC v.7.6 starts")
    for n in range(1, 11):
        print(f"     Atom #{n:4d}: total charge =  12.1, s =  2.0, p =  6.0, d =  4.1,")
    print("     Polarization:")
    for n in range(1, 11):
        pol = (2.997 if n % 2 else -2.997) if n <= 4 else 0.0
        print(f"     Atom #{n:4d}: polarization = {pol:8.4f}, s =  0.0100, p =  0.0090, d = {pol:8.4f},")
    if "_pdos" in (filpdos or "") and "nscf" in filpdos:
        e = [-1.0 + 0.05 * i for i in range(60)]
        for n, (lab, l) in enumerate((("Cr1", "d"), ("Cr2", "d"), ("O", "p")), start=1):
            lines = ["# E (eV)  ldosup(E)  ldosdw(E)  pdosup(E)  pdosdw(E)"]
            lines += [f"{x:.3f} {0.5:.3f} {0.25:.3f} {0.1:.3f} {0.05:.3f}" for x in e]
            Path(f"{filpdos}.pdos_atm#{n}({lab})_wfc#1({l})").write_text("\n".join(lines) + "\n")
    sys.exit(0)

if prog == "dos.x":
    fildos = val("fildos")
    e = [10.0 + 0.02 * i for i in range(300)]
    lines = ["# E (eV)  dosup(E)  dosdw(E)  Int dos(E) EFermi =  12.798 eV"]
    lines += [f"{x:.3f} 0.100 0.200 0.5" for x in e]
    Path(fildos).write_text("\n".join(lines) + "\n")
    sys.exit(0)

if prog == "bands.x":
    filband = val("filband")
    nbnd, nks = 2, 49
    lines = [f" &plot nbnd= {nbnd}, nks= {nks} /"]
    for k in range(nks):
        lines.append(f"   {0.01 * k:.6f} 0.000000 0.000000")
        lines.append("   " + " ".join(f"{(-1.0 if b == 0 else 1.0) + 0.01 * k:.3f}" for b in range(nbnd)))
    Path(filband).write_text("\n".join(lines) + "\n")
    gnu = []
    for b in range(nbnd):
        gnu += [f"{0.02 * k:.6f} {(-1.0 if b == 0 else 1.0) + 0.01 * k:.3f}" for k in range(nks)] + [""]
    Path(filband + ".gnu").write_text("\n".join(gnu) + "\n")
    sys.exit(0)
'''


def configure(directory: Path, mode: str = "ok", log: Path | None = None) -> None:
    import json

    (directory / "config.json").write_text(json.dumps({"mode": mode, "log": str(log) if log else None}))


def install_stubs(directory: Path) -> Path:
    """Write executable stubs for mpirun, pw.x, projwfc.x, dos.x and bands.x into ``directory``."""
    directory.mkdir(parents=True, exist_ok=True)
    source = STUB_SOURCE.replace("{python}", sys.executable)
    for name in ("mpirun", "pw.x", "projwfc.x", "dos.x", "bands.x"):
        path = directory / name
        path.write_text(source)
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return directory
