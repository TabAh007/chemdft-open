"""The full analysis of one uploaded output: pre-check -> detect -> segment -> validate -> parse -> validate -> payloads -> report."""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import hashlib

from . import logscan
from .findings import Finding, has_rejection
from .payloads import Context, assemble
from .precheck import decode_text, precheck_bytes
from .report import finalize, new_body
from .semantic import (
    check_energy,
    check_excitations,
    check_spin,
    check_structure,
    check_thermo,
    check_vibrations,
    has,
)


def _job_summary(seg: logscan.Segment, engine: str, declared, term: tuple[str, str], conv: dict, facts, method, basis, n_jobs: int) -> dict:
    return {
        "job_count": n_jobs,
        "index": seg.index,
        "line_range": [seg.start_line, seg.end_line],
        "internal_steps": seg.internal_steps,
        "job_type": declared.label,
        "job_type_evidence": declared.evidence,
        "method": method.as_dict(),
        "basis": basis.as_dict(),
        "charge": facts.charge,
        "multiplicity": facts.multiplicity,
        "reference": facts.reference,
        "n_atoms": facts.natom,
        "orientation": facts.orientation,
        "solvent_model": facts.solvent_model,
        "termination": {"status": term[0], "evidence": term[1]},
        "convergence": conv,
    }


def analyze(raw: bytes) -> dict:
    source = {"sha256": hashlib.sha256(raw).hexdigest(), "size_bytes": len(raw)}
    body = new_body(source)
    findings: list[Finding] = []

    def done() -> dict:
        body["diagnostics"] = [f.as_dict() for f in findings]
        for f in findings:
            if f.severity == "reject":
                body["items"].append({"id": f"reject-{f.code}", "state": "REJECTED", "title": f.code.replace("_", " ").capitalize(), "detail": f.message, "result_type": None})
            elif f.severity == "warning":
                body["items"].append({"id": f"warn-{f.code}", "state": "WARNING", "title": f.code.replace("_", " ").capitalize(), "detail": f.message, "result_type": None})
        body["status"] = "REJECTED" if has_rejection(findings) else "READY"
        if body["status"] == "REJECTED":
            body["results"] = []
        return finalize(body)

    pre, stats = precheck_bytes(raw)
    findings += pre
    body["source"].update({k: v for k, v in stats.items() if k != "size_bytes"})
    if has_rejection(pre):
        return done()
    text = decode_text(raw)
    body["source"]["line_count"] = text.count("\n") + (0 if text.endswith("\n") else 1)

    info = logscan.sniff(text)
    body["program"] = {"engine": info.engine, "version": info.version, "label": info.label}
    if info.engine is None:
        findings.append(Finding("UNSUPPORTED_PROGRAM_OR_VERSION", "reject", "The file is not a recognised Gaussian 09/16 or ORCA 5.x/6.x output. (Psi4, NWChem and Q-Chem are not supported in V1.)"))
        return done()
    if not logscan.is_supported(info):
        findings.append(Finding("UNSUPPORTED_PROGRAM_OR_VERSION", "reject", f"{info.label} is not supported in V1 (Gaussian 09/16, ORCA 5.x, 6.0.x and 6.1.x)."))
        return done()
    engine = info.engine

    segments = logscan.segment_jobs(text, engine)
    n_jobs = len(segments)
    if engine == "ORCA":
        n_jobs = max(n_jobs, logscan.orca_declared_job_count(text))
    seg = segments[0]
    declared = logscan.declared_job(seg, engine)
    facts = logscan.raw_facts(seg, engine)
    term = logscan.termination(seg, engine)
    conv, conv_findings = logscan.convergence(seg, engine, declared)
    method, basis = logscan.method_and_basis(seg, engine, None, None, facts)
    body["jobs"] = []
    for s in segments:
        d, t = logscan.declared_job(s, engine), logscan.termination(s, engine)
        body["jobs"].append({"index": s.index, "line_range": [s.start_line, s.end_line], "internal_steps": s.internal_steps, "job_type": d.label, "termination": {"status": t[0], "evidence": t[1]}})
    if n_jobs > 1:
        findings.append(Finding("MULTIPLE_JOBS_NOT_SUPPORTED_V1", "reject", f"{n_jobs} independent jobs were detected in one file. External Import V1 accepts a single logical calculation; split the file or wait for multi-job import."))
        for j in body["jobs"]:
            if j["termination"]["status"] != "COMPLETED":
                findings.append(Finding("INCOMPLETE_OUTPUT" if j["termination"]["status"] == "INCOMPLETE" else "ERROR_TERMINATION", "reject", f"Job {j['index'] + 1}: {j['termination']['evidence']}", seg.start_line))
    if term[0] != "COMPLETED":
        findings.append(
            Finding("INCOMPLETE_OUTPUT" if term[0] == "INCOMPLETE" else "ERROR_TERMINATION", "reject", f"The calculation did not terminate normally ({term[1]}). Incomplete or failed outputs are never imported.")
        )
    findings += conv_findings
    if logscan.excited_state_optimization(seg, engine, declared):
        findings.append(Finding("EXCITED_STATE_OPTIMIZATION_NOT_SUPPORTED_V1", "reject", "A geometry optimization on an excited-state surface was detected; its geometry is not a ground-state structure."))
    body["job"] = _job_summary(seg, engine, declared, term, conv, facts, method, basis, n_jobs)
    if has_rejection(findings):
        return done()

    parsed = __import__("chemdft_import_worker.parse", fromlist=["parse_segment"]).parse_segment(seg.text, seg.start_line - 1)
    body["cclib"] = {"success_flag": parsed.success_flag if isinstance(parsed.success_flag, (bool, str)) else str(parsed.success_flag), "error_logs": parsed.error_logs[:3], "network_or_archive_attempts": parsed.blocked_attempts}
    if parsed.blocked_attempts:
        findings.append(Finding("NETWORK_OR_ARCHIVE_ACCESS_ATTEMPTED", "reject", "The parser attempted to use a network or archive reader; the import was refused."))
        return done()
    if parsed.error or parsed.data is None:
        findings.append(Finding("PARSE_FAILED", "reject", f"The parser could not read this output: {parsed.error}"))
        return done()
    if parsed.error_logs:
        findings.append(Finding("PARSER_REPORTED_INCOMPLETE_INPUT", "reject", f"The parser reported an unexpected end of file: {parsed.error_logs[0][-140:]}"))
        return done()
    data = parsed.data
    meta = getattr(data, "metadata", None) or {}
    method, basis = logscan.method_and_basis(seg, engine, meta.get("functional"), meta.get("basis_set"), facts)
    body["job"]["method"], body["job"]["basis"] = method.as_dict(), basis.as_dict()
    if meta.get("solvent_model"):
        body["job"]["solvent_model"] = f"{meta.get('solvent_model')} ({meta.get('solvent_name', 'unknown solvent')})"

    sem_info: dict = {}
    f_struct, struct_info = check_structure(data, facts)
    findings += f_struct
    sem_info.update(struct_info)
    if has_rejection(findings):
        return done()
    findings += check_spin(data, facts, sem_info)
    findings += check_energy(data, facts, sem_info)
    declared_td_missing = declared.td and not has(data, "etenergies")
    declared_freq_missing = declared.freq and not has(data, "vibfreqs")
    if declared_freq_missing:
        findings.append(Finding("JOB_TYPE_INCONSISTENT", "reject", "The log echo requests a frequency calculation but no vibrational frequencies were parsed."))
    if declared_td_missing:
        findings.append(Finding("JOB_TYPE_INCONSISTENT", "reject", "The log echo requests an excited-state calculation but no excitation energies were parsed."))
    if declared.opt:
        flag = __import__("chemdft_import_worker.semantic", fromlist=["optdone_flag"]).optdone_flag(data)
        if flag is False:
            findings.append(Finding("OPTIMIZATION_STATUS_CONFLICT", "reject", "The log marks the optimization converged but the parser reports it did not."))
    findings += check_vibrations(data, facts, sem_info, findings)
    findings += check_excitations(data)
    findings += check_thermo(data, sem_info)
    if facts.solvent_model or meta.get("solvent_model"):
        findings.append(Finding("IMPLICIT_SOLVENT_PRESENT", "warning", "An implicit solvent model was used; energies are not directly comparable with gas-phase values."))
    if has(data, "dispersionenergies"):
        findings.append(Finding("DISPERSION_CORRECTION_PRESENT", "info", "An empirical dispersion term is included in the reported energy (not added again)."))
    if parsed.success_flag is not True:
        findings.append(Finding("PARSER_SUCCESS_FLAG_NOT_TRUE", "info", f"The parser's own success flag is {parsed.success_flag!r}; ChemDFT's termination and convergence checks decide, not this flag."))
    if has_rejection(findings):
        return done()

    ctx = Context(
        program=engine,
        program_label=info.label or engine,
        facts=facts,
        declared=declared,
        convergence=conv,
        info=sem_info,
        locators=parsed.locators,
        method_label=f"{method.value} / {basis.value}" if method.status != "UNKNOWN" and basis.status != "UNKNOWN" else "UNKNOWN",
    )
    built = assemble(data, ctx)
    body["results"] = built.results
    body["items"] = built.items
    body["semantic"] = {k: (round(v, 12) if isinstance(v, float) else v) for k, v in sem_info.items() if isinstance(v, (int, float, bool, str))}
    return done()
