"""Engine-specific scanning of the log text itself (cclib-independent).

Source truth: everything here reads the OUTPUT file's own echo and markers. Companion input files and file names are never used.
The patterns were validated against 46 real Gaussian 09/16 and ORCA 5/6 outputs (spike fixture gate); patterns marked UNVERIFIED have
no real fixture and are covered only by constructed tests.
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .findings import Finding

# ------------------------------------------------------------------------------------------------ engine / version
GAUSSIAN_BANNER = re.compile(r"Gaussian (09|16):\s+(\S+)")
ORCA_VERSION = re.compile(r"Program Version (\S+)")
ORCA_ASCII_BANNER = re.compile(r"^\s+\*\s+O\s+R\s+C\s+A\s+\*\s*$", re.M)


@dataclass
class EngineInfo:
    engine: str | None
    version: str | None  # e.g. "16" / "6.1.0"
    label: str | None  # e.g. "Gaussian 16 Rev C.01" / "ORCA 6.1.0"


def sniff(text: str) -> EngineInfo:
    head = text[:300_000]
    if "Entering Gaussian System" in head:
        m = GAUSSIAN_BANNER.search(text)
        if m:
            rev = re.search(r"G\d\dRev(\S+)", m.group(2))
            return EngineInfo("Gaussian", m.group(1), f"Gaussian {m.group(1)}" + (f" Rev {rev.group(1)}" if rev else ""))
    if ORCA_ASCII_BANNER.search(head):
        m = ORCA_VERSION.search(head)
        if m:
            return EngineInfo("ORCA", m.group(1), f"ORCA {m.group(1)}")
    return EngineInfo(None, None, None)


def is_supported(info: EngineInfo) -> bool:
    if info.engine == "Gaussian":
        return info.version in ("09", "16")
    if info.engine == "ORCA":
        return bool(info.version and re.match(r"(5\.\d+|6\.[01](\.\d+)?)", info.version))
    return False


# ------------------------------------------------------------------------------------------------ segmentation
@dataclass
class Segment:
    index: int
    start_line: int  # 1-based, inclusive
    end_line: int
    text: str
    internal_steps: int = 1
    lines: list[str] = field(default_factory=list, repr=False)


def segment_jobs(text: str, engine: str) -> list[Segment]:
    """Split the file into independent jobs BEFORE cclib sees it (cclib silently merges multi-job files).

    Gaussian: one job per `Entering Link 1` block. A single route such as `Opt Freq` is ONE job with several internal job steps
    (`Link1: Proceeding to internal job step number N`), whereas `--Link1--` starts a new job.
    ORCA: one job per ASCII banner; compound-job markers are also counted (UNVERIFIED on real compound logs).
    """
    lines = text.split("\n")
    if engine == "Gaussian":
        entering = [i for i, ln in enumerate(lines) if "Entering Link 1" in ln]
        starts: list[int] = []
        for i in entering or [0]:
            j = i
            while j > 0 and i - j < 6 and not lines[j].startswith(" Initial command:"):
                j -= 1
            starts.append(j if lines[j].startswith(" Initial command:") else max(0, i - 3))
        starts = sorted(set(starts))
        starts[0] = 0
    else:
        banners = [text.count("\n", 0, m.start()) for m in ORCA_ASCII_BANNER.finditer(text)]
        starts = [0] + [max(0, b - 2) for b in banners[1:]]
    segments: list[Segment] = []
    for k, s in enumerate(starts):
        e = starts[k + 1] if k + 1 < len(starts) else len(lines)
        chunk = lines[s:e]
        body = "\n".join(chunk)
        steps = 1 + len(re.findall(r"Link1:\s+Proceeding to internal job step number", body)) if engine == "Gaussian" else 1
        segments.append(Segment(k, s + 1, e, body, steps, chunk))
    return segments


_ORCA_COMPOUND = (
    re.compile(r"JOB NUMBER\s+(\d+)\s+of\s+(\d+)", re.I),  # UNVERIFIED: ORCA multi-job headers
    re.compile(r"^\|\s*\d+>\s*\$new_job", re.I | re.M),
)


def orca_declared_job_count(text: str) -> int:
    count = 1
    for m in _ORCA_COMPOUND[0].finditer(text):
        count = max(count, int(m.group(2)))
    if _ORCA_COMPOUND[1].search(text):
        count = max(count, 2 + len(_ORCA_COMPOUND[1].findall(text)) - 1)
    return count


# ------------------------------------------------------------------------------------------------ termination
def termination(seg: Segment, engine: str) -> tuple[str, str]:
    t = seg.text
    if engine == "Gaussian":
        normal = len(re.findall(r"Normal termination of Gaussian", t))
        err = len(re.findall(r"Error termination", t))
        if err:
            return "ERROR_TERMINATION", f"{err} 'Error termination' line(s)"
        if normal >= seg.internal_steps:
            return "COMPLETED", f"{normal} 'Normal termination' for {seg.internal_steps} internal job step(s)"
        return "INCOMPLETE", f"{normal} 'Normal termination' but {seg.internal_steps} internal job step(s) started"
    if "ORCA finished by error termination" in t or "aborting the run" in t:
        return "ERROR_TERMINATION", "ORCA error termination"
    if "****ORCA TERMINATED NORMALLY****" in t:
        return "COMPLETED", "****ORCA TERMINATED NORMALLY****"
    return "INCOMPLETE", "no ORCA termination marker"


# ------------------------------------------------------------------------------------------------ declared job type (from the log echo)
def _gaussian_route(t: str) -> str:
    routes = re.findall(r"^ (#.*)$", t, re.M)
    return routes[0] if routes else ""


def _orca_echo(t: str) -> list[str]:
    return re.findall(r"^\|\s*\d+>\s*(.*)$", t, re.M)


@dataclass
class DeclaredJob:
    opt: bool
    freq: bool
    td: bool
    raman: bool
    ts: bool
    evidence: list[str]

    @property
    def label(self) -> str:
        parts = []
        if self.opt:
            parts.append("opt(ts)" if self.ts else "opt")
        if self.freq:
            parts.append("freq")
        if self.td:
            parts.append("td")
        if self.raman:
            parts.append("raman")
        return "+".join(parts) or "single point"


def declared_job(seg: Segment, engine: str) -> DeclaredJob:
    t = seg.text
    if engine == "Gaussian":
        route = _gaussian_route(t)
        low = route.lower()
        opt = bool(re.search(r"(?<![\w])opt(?![a-z])", low))
        ts = bool(re.search(r"(?<![\w])opt\s*[=(][^ ]*\bts\b|(?<![\w])opt\s*[=(]\(?[^ )]*ts", low)) and opt
        freq = bool(re.search(r"(?<![\w])(freq|anfreq)(?![a-z])", low))
        td = bool(re.search(r"(?<![\w])(td|tda|cis|eom)(?![a-z])", low))
        raman = freq and "raman" in low and "noraman" not in low
        return DeclaredJob(opt, freq, td, raman, ts, [route.strip()] if route else [])
    echo = _orca_echo(t)
    code = [ln.split("#")[0] for ln in echo]  # strip user comments
    bang = " ".join(ln for ln in code if ln.strip().startswith("!"))
    low = bang.lower()
    opt = bool(re.search(r"(?<![\w])(opt|optts|copt|zopt|gdiis-opt|geom)(?![a-z0-9])", low)) and "noopt" not in low
    ts = bool(re.search(r"(?<![\w])optts(?![a-z])", low))
    freq = bool(re.search(r"(?<![\w])(freq|numfreq|anfreq)(?![a-z])", low))
    block_text = "\n".join(code).lower()
    td = bool(re.search(r"^\s*%(tddft|cis|rocis)\b", block_text, re.M))
    raman = bool(re.search(r"^\s*%elprop|\braman\s+true|\bpolar\s+[12]", block_text, re.M)) and freq
    evidence = [bang.strip()] if bang.strip() else []
    if td:
        evidence.append("%tddft/%cis block present")
    return DeclaredJob(opt, freq, td, raman, ts, evidence)


def excited_state_optimization(seg: Segment, engine: str, declared: DeclaredJob) -> bool:
    """Optimising on an excited-state surface: the final geometry is NOT a ground-state structure and cclib's scfenergies stay ground-state."""
    if not (declared.opt and declared.td):
        return False
    if engine == "Gaussian":
        return True
    echo = "\n".join(ln.split("#")[0] for ln in _orca_echo(seg.text))
    return bool(re.search(r"(?im)^\s*iroot\s+\d+", echo))


# ------------------------------------------------------------------------------------------------ convergence
def convergence(seg: Segment, engine: str, declared: DeclaredJob) -> tuple[dict, list[Finding]]:
    t = seg.text
    findings: list[Finding] = []
    info: dict = {"scf": {"status": "UNKNOWN", "evidence": ""}, "optimization": {"requested": declared.opt, "status": "NOT_REQUESTED", "evidence": ""}}
    if engine == "Gaussian":
        if re.search(r"Convergence failure", t):
            info["scf"] = {"status": "NOT_CONVERGED", "evidence": "'Convergence failure -- run terminated.'"}
            findings.append(Finding("SCF_NOT_CONVERGED", "reject", "The SCF did not converge (Gaussian: Convergence failure)."))
        elif re.search(r"SCF Done", t):
            info["scf"] = {"status": "CONVERGED", "evidence": f"{len(re.findall('SCF Done', t))} 'SCF Done' record(s)"}
        else:
            findings.append(Finding("NO_SCF_ENERGY", "reject", "No 'SCF Done' record: no electronic energy was produced."))
        if declared.opt:
            if re.search(r"Number of steps exceeded", t):
                info["optimization"] = {"requested": True, "status": "NOT_CONVERGED", "evidence": "'Number of steps exceeded'"}
                findings.append(Finding("OPTIMIZATION_NOT_CONVERGED", "reject", "The geometry optimization did not converge (maximum number of steps exceeded)."))
            elif re.search(r"Optimization completed", t):
                info["optimization"] = {"requested": True, "status": "CONVERGED", "evidence": "'Optimization completed' + stationary point"}
            else:
                info["optimization"] = {"requested": True, "status": "NOT_CONVERGED", "evidence": "no 'Optimization completed'"}
                findings.append(Finding("OPTIMIZATION_NOT_CONVERGED", "reject", "No 'Optimization completed' record: the optimization did not finish."))
        return info, findings
    # ORCA
    if re.search(r"SCF NOT CONVERGED|IS NOT CONVERGED|Wavefunction not fully converged", t):
        info["scf"] = {"status": "NOT_CONVERGED", "evidence": "SCF NOT CONVERGED / wavefunction not fully converged"}
        findings.append(Finding("SCF_NOT_CONVERGED", "reject", "The SCF did not converge (ORCA)."))
    elif re.search(r"SCF CONVERGED AFTER", t):
        info["scf"] = {"status": "CONVERGED", "evidence": f"{len(re.findall('SCF CONVERGED AFTER', t))} 'SCF CONVERGED AFTER' record(s)"}
    else:
        findings.append(Finding("NO_SCF_ENERGY", "reject", "No 'SCF CONVERGED AFTER' record: no converged electronic energy was produced."))
    if declared.opt:
        if re.search(r"optimization did not converge", t):
            info["optimization"] = {"requested": True, "status": "NOT_CONVERGED", "evidence": "'The optimization did not converge'"}
            findings.append(Finding("OPTIMIZATION_NOT_CONVERGED", "reject", "The geometry optimization did not converge (ORCA reached the step limit). A normal-termination message does not imply convergence."))
        elif re.search(r"THE OPTIMIZATION HAS CONVERGED", t):
            info["optimization"] = {"requested": True, "status": "CONVERGED", "evidence": "'THE OPTIMIZATION HAS CONVERGED'"}
        else:
            info["optimization"] = {"requested": True, "status": "NOT_CONVERGED", "evidence": "no 'THE OPTIMIZATION HAS CONVERGED'"}
            findings.append(Finding("OPTIMIZATION_NOT_CONVERGED", "reject", "No 'THE OPTIMIZATION HAS CONVERGED' record."))
    return info, findings


# ------------------------------------------------------------------------------------------------ raw (cclib-independent) facts
@dataclass
class RawFacts:
    charge: int | None = None
    multiplicity: int | None = None
    natom: int | None = None
    printed_frequencies: list[float] = field(default_factory=list)  # harmonic table as printed (zero modes excluded for ORCA)
    reference: str = "unknown"  # restricted | unrestricted | restricted-open-shell | unknown
    orientation: str = "unknown"
    scf_energy_hartree: float | None = None
    solvent_model: str | None = None
    route_or_echo: str = ""
    n_frequency_blocks: int = 0


def raw_facts(seg: Segment, engine: str) -> RawFacts:
    t = seg.text
    f = RawFacts()
    if engine == "Gaussian":
        m = re.search(r"Charge =\s+(-?\d+)\s+Multiplicity =\s+(\d+)", t)
        if m:
            f.charge, f.multiplicity = int(m.group(1)), int(m.group(2))
        m = re.search(r"NAtoms=\s+(\d+)", t)
        f.natom = int(m.group(1)) if m else None
        harmonic = t.split("Harmonic frequencies", 1)
        if len(harmonic) == 2:
            table = re.split(r"- Thermochemistry -|Thermochemistry", harmonic[1], maxsplit=1)[0]  # anharmonic jobs repeat the table later
            for line in table.splitlines():
                if line.startswith(" Frequencies --"):
                    f.printed_frequencies += [float(x) for x in line.split("--")[1].split()]
            f.n_frequency_blocks = 1
        energies = re.findall(r"SCF Done:\s+E\((\w+)\)\s+=\s+(-?\d+\.\d+)", t)
        if energies:
            f.scf_energy_hartree = float(energies[-1][1])
            tag = energies[-1][0].upper()
            f.reference = "restricted-open-shell" if tag.startswith("RO") else "unrestricted" if tag.startswith("U") else "restricted" if tag.startswith("R") else "unknown"
        f.orientation = "standard orientation" if "Standard orientation:" in t else "input orientation" if "Input orientation:" in t else "unknown"
        scrf = re.search(r"(?i)scrf\s*=?\s*\(?([^ )]*)", _gaussian_route(t))
        f.solvent_model = scrf.group(0).strip() if scrf else None
        f.route_or_echo = _gaussian_route(t).strip()
        return f
    m = re.search(r"Total Charge\s+Charge\s+\.{3,}\s+(-?\d+)", t)
    f.charge = int(m.group(1)) if m else None
    m = re.search(r"Multiplicity\s+Mult\s+\.{3,}\s+(\d+)", t)
    f.multiplicity = int(m.group(1)) if m else None
    m = re.search(r"Number of atoms\s+\.{3,}\s+(\d+)", t)
    f.natom = int(m.group(1)) if m else None
    blocks = re.findall(r"VIBRATIONAL FREQUENCIES\n-+\n(.*?)\n\n\n", t, re.S)  # TS jobs print several; the LAST is final
    if blocks:
        printed = [float(x) for x in re.findall(r"^\s+\d+:\s+(-?\d+\.\d+)\s+cm\*\*-1", blocks[-1], re.M)]
        f.printed_frequencies = [x for x in printed if abs(x) > 1e-6]
        f.n_frequency_blocks = len(blocks)
    hf = re.search(r"Hartree-Fock type\s+HFTyp\s+\.{3,}\s+(\w+)", t)
    if hf:
        tag = hf.group(1).upper()
        f.reference = "unrestricted" if tag.startswith("U") else "restricted-open-shell" if tag.startswith("RO") else "restricted" if tag.startswith("R") else "unknown"
    # cclib scfenergies (ORCA) = SCF-block "Total Energy" + dispersion; NOT "FINAL SINGLE POINT ENERGY" (excited-state / correlated total)
    e = re.findall(r"TOTAL SCF ENERGY\n-+\n(?:.*\n)*?Total Energy\s+:\s+(-?\d+\.\d+) Eh", t)
    disp = re.findall(r"Dispersion correction\s+(-?\d+\.\d+)", t)
    if e:
        f.scf_energy_hartree = float(e[-1]) + (float(disp[-1]) if disp else 0.0)
    f.orientation = "input frame (ORCA does not reorient)"
    echo = _orca_echo(t)
    f.route_or_echo = " ".join(ln.strip() for ln in echo if ln.strip().startswith("!"))[:300]
    echo_text = "\n".join(echo)
    sm = re.search(r"(?i)\b(c?cpcm|smd|cosmo|alpb)\b", echo_text)
    f.solvent_model = sm.group(1) if sm else None
    return f


# ------------------------------------------------------------------------------------------------ method / basis (never guessed)
_ORCA_METHODS = {
    "hf", "b3lyp", "b3lyp/g", "pbe", "pbe0", "bp86", "blyp", "tpss", "tpssh", "m06", "m062x", "m06-2x", "m06l", "wb97x", "wb97x-d3", "wb97x-d3bj",
    "wb97x-v", "wb97m-v", "wb97m-d3bj", "cam-b3lyp", "b97-d3", "revpbe", "pw6b95", "b2plyp", "r2scan", "x3lyp", "b3pw91", "pbe0-d3", "bhandhlyp",
}
_ORCA_REFERENCE_TOKENS = {"rks", "uks", "roks", "rhf", "uhf", "rohf"}
_GAUSSIAN_REFERENCE = re.compile(r"^(?:ro|r|u)(?=(hf|b3lyp|pbe|bp86|blyp|tpss|m06|wb97|cam|b97|b2plyp|x3lyp|b3pw91|bhandhlyp|apfd|mn15|mpw))", re.I)


@dataclass
class ValueWithStatus:
    value: str
    status: str  # ESTABLISHED | REPORTED | UNKNOWN
    evidence: list[str]

    def as_dict(self) -> dict:
        return {"value": self.value, "status": self.status, "evidence": self.evidence}


def method_and_basis(seg: Segment, engine: str, cclib_functional: str | None, cclib_basis: str | None, facts: RawFacts) -> tuple[ValueWithStatus, ValueWithStatus]:
    """ESTABLISHED = two independent sources agree or the echo is unambiguous; otherwise UNKNOWN. Never a guess."""
    echo = facts.route_or_echo
    if engine == "Gaussian":
        tokens = [t for t in echo.split() if "/" in t and not t.startswith("#")]
        if len(tokens) == 1 and tokens[0].count("/") == 1:
            method_raw, basis_raw = tokens[0].split("/")
            method = _GAUSSIAN_REFERENCE.sub("", method_raw) or method_raw
            ev = [f"route: {echo}"]
            basis = ValueWithStatus(basis_raw, "UNKNOWN", ev)
            if basis_raw.lower() not in ("gen", "genecp", "chkbas", "extrabasis") and cclib_basis and cclib_basis.lower() == basis_raw.lower():
                basis = ValueWithStatus(basis_raw, "ESTABLISHED", [*ev, f"cclib basis_set: {cclib_basis}"])
            elif basis_raw.lower() not in ("gen", "genecp", "chkbas", "extrabasis"):
                basis = ValueWithStatus(basis_raw, "REPORTED", ev)
            meth = ValueWithStatus(method, "REPORTED", ev)
            if cclib_functional and cclib_functional.lower() == method.lower():
                meth = ValueWithStatus(method, "ESTABLISHED", [*ev, f"cclib functional: {cclib_functional}"])
            elif method.lower() == "hf":
                meth = ValueWithStatus("HF", "ESTABLISHED", ev)
            return meth, basis
        return ValueWithStatus("UNKNOWN", "UNKNOWN", [f"route: {echo}"] if echo else []), ValueWithStatus("UNKNOWN", "UNKNOWN", [f"route: {echo}"] if echo else [])
    # ORCA: tokens of the simple-input line(s)
    toks = [t for t in re.split(r"\s+", echo.replace("!", " ").strip()) if t]
    ev = [f"input echo: {echo}"] if echo else []
    cands = [t for t in toks if t.lower() in _ORCA_METHODS]
    refs = [t for t in toks if t.lower() in _ORCA_REFERENCE_TOKENS]
    if len(cands) == 1:
        meth = ValueWithStatus(cands[0].upper() if cands[0].lower() in ("hf", "b3lyp") else cands[0], "ESTABLISHED", ev)
    elif not cands and refs and any(r.lower() in ("rhf", "uhf", "rohf") for r in refs):
        meth = ValueWithStatus("HF", "ESTABLISHED", ev)
    else:
        meth = ValueWithStatus("UNKNOWN", "UNKNOWN", ev)
    basis = ValueWithStatus("UNKNOWN", "UNKNOWN", ev)
    if cclib_basis:
        match = [t for t in toks if t.lower() == cclib_basis.lower()]
        if match:
            basis = ValueWithStatus(cclib_basis, "ESTABLISHED", [*ev, f"cclib basis_set: {cclib_basis}"])
        elif ev:
            basis = ValueWithStatus(cclib_basis, "REPORTED", [f"cclib basis_set: {cclib_basis}"])
    return meth, basis
