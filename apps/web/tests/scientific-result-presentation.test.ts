import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { CalculationDetail, JobDiagnostics, JobLogOutput, StructureVersionDetail } from "@chemdft/schemas";
import { buildScientificScene } from "@chemdft/scientific-scene";
import fixture from "./fixtures/as-c1-h2-scientific-log.json";
import { scientificLog } from "../src/lib/scientific-log";
import { boundScfEvidence, resultLogArtifact } from "../src/lib/scientific-result-presentation";
import { structureConnectivity } from "../src/lib/structure-connectivity";
import { parseUtc, timestampDisplay } from "../src/lib/timestamps";
import { ScientificLogView } from "../src/app/_components/scientific-log-view";
import { ScientificSummaryContent } from "../src/app/_components/calculation-scientific-summary";
import { GuidedViewer } from "../src/app/_components/guided/guided-viewer";

// Presentation fixtures derived from the accepted historical H2 experiment.
// They are not new scientific calculations or authoritative persistence writes.
function detail(): CalculationDetail {
  const ref = { artifact_id: "log", project_id: "p", sha256: fixture.source_native_log_sha256 };
  return {
    calculation: { id: "calc", project_id: "p", input_id: "input", state: "SUCCEEDED", created_at: "2026-10-14T14:50:08.000000" },
    calculation_input_hash: "0".repeat(64), specification: fixture.specification,
    compute_job: { id: "job", state: "SUCCEEDED" },
    compute_execution: { finished_at: "2026-10-14T14:50:11Z" },
    attempt: { id: "attempt", raw_artifacts: [ref] },
    result: { id: "result", project_id: "p", calculation_id: "calc", calculation_input_id: "input", result_type: "chemdft.energy",
      authority: "AUTHORITATIVE", source_class: "CALCULATED", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
      effective_state: { authority: "AUTHORITATIVE", validation_state: "VALIDATED", source_lineage_validity: "ACTIVE", eligible_for_derivation: true },
      producer_software: { name: "pyscf", version: "2.14.0" }, trusted_producer_id: "local.pyscf.worker", producer_attestation_id: "execution:fixture:attempt:1",
      provenance_record_id: "provenance", raw_artifacts: [ref],
      payload: { payload_schema: "chemdft.energy", task_type: "ENERGY", method: "hf", basis: "sto-3g", converged: true, scf_iterations: fixture.iterations,
        total_energy: { value: fixture.energy, unit: { code: "Eh", dimension: "ENERGY" } } },
    },
  } as unknown as CalculationDetail;
}
function input(): StructureVersionDetail {
  return {
    structure: { id: "s", project_id: "p", kind: "MOLECULE", name: "H2" },
    version: { id: "v", project_id: "p", structure_id: "s", revision: 1, origin: "IMPORTED", overall_charge: 0, multiplicity: 1,
      coordinates: { structure_version_id: "v", coordinate_system: "CARTESIAN", unit: "angstrom", source: { project_id: "p", entity_type: "structure.version", entity_id: "v" },
        atoms: fixture.input.atoms.map(atom => ({ index: atom.index, element: atom.element, atomic_number: atom.atomic_number, x: atom.xyz_angstrom[0], y: atom.xyz_angstrom[1], z: atom.xyz_angstrom[2] })), bonds: [] },
    },
  } as unknown as StructureVersionDetail;
}
function log(): JobLogOutput {
  return { artifact_id: "log", attempt_id: "attempt", kind: "ENGINE_LOG", media_type: "text/plain", sha256: fixture.source_native_log_sha256, text: fixture.text, truncated: false, size_bytes: 35787, returned_bytes: 35787 };
}
function diagnostics(): JobDiagnostics {
  return { project_id: "p", calculation_id: "calc", job_id: "job", attempts: [{ attempt_id: "attempt", artifacts: [{ artifact_id: "log", kind: "ENGINE_LOG", format_identifier: "pyscf.log", sha256: fixture.source_native_log_sha256, log_readable: true }] }] } as unknown as JobDiagnostics;
}

describe("scientific log presentation", () => {
  it("extracts real accepted SCF values and contracted basis count", () => {
    const parsed = scientificLog(fixture.text);
    expect(parsed).toMatchObject({ convergenceThreshold: fixture.threshold, nuclearRepulsion: fixture.nuclear_repulsion, electrons: fixture.electrons, basisFunctions: fixture.basis_functions, homo: fixture.frontier[0], lumo: fixture.frontier[1], convergenceRecords: 1 });
    expect(parsed.convergedEnergy).toBeCloseTo(fixture.energy, 12);
    expect(parsed.excerpt).toContain("cycle= 2");
    expect(parsed.excerpt).not.toContain("checkpoint");
  });
  it("skips the source echo and machine details without modifying the original text", () => {
    const original = `#INFO: **** input file is <local-path>/worker.py ****\nconverged SCF energy = 999\n${"python_source\n".repeat(730)}#INFO: ******************** input file end ********************\nSystem: uname_result(node='example-host.local')\nPySCF path <local-path>/env\n${fixture.text}`;
    const parsed = scientificLog(original);
    expect(parsed.convergedEnergy).toBeCloseTo(fixture.energy, 12);
    expect(parsed.excerpt).not.toMatch(/python_source|example-host|\/Users|999|checkpoint/);
    expect(original).toContain("python_source");
    const html = renderToStaticMarkup(createElement(ScientificLogView, { log: { ...log(), text: original }, onDownload: () => {} }));
    expect(html).toContain("Display-only excerpt");
    expect(html).toContain("Download original native log");
    expect(html).toContain(fixture.source_native_log_sha256);
    expect(html).not.toMatch(/python_source|example-host|\/Users/);
  });
  it("handles tails inside an echoed source block and fails closed on an incomplete block", () => {
    expect(scientificLog(`converged SCF energy = 999\n#INFO: ******************** input file end ********************\n${fixture.text}`).convergedEnergy).toBeCloseTo(fixture.energy, 12);
    expect(scientificLog("#INFO: **** input file is /tmp/worker.py ****\nconverged SCF energy = 999").convergedEnergy).toBeNull();
  });
  it("never fabricates omitted, malformed, nonfinite or spin-ambiguous fields", () => {
    const parsed = scientificLog("SCF conv_tol = NaN\nnumber of NR cGTOs = -1\nalpha HOMO = -1 LUMO = 1\nconverged SCF energy = Infinity\n");
    expect(parsed).toMatchObject({ convergenceThreshold: null, basisFunctions: null, homo: null, lumo: null, convergedEnergy: null, electrons: null });
    expect(scientificLog("").excerpt).toBe("");
  });
  it("labels an incomplete server tail and does not turn multiple SCF runs into one result", () => {
    const html = renderToStaticMarkup(createElement(ScientificLogView, { log: { ...log(), truncated: true }, onDownload: () => {} }));
    expect(html).toContain("server returned a log tail");
    expect(boundScfEvidence(detail(), { ...log(), text: `${fixture.text}\n${fixture.text}` })).toBeNull();
  });
});

describe("native evidence binding and summary", () => {
  it("shows stored input/results and separately labelled parsed quantities without mutating them", () => {
    const d = detail(), i = input(), l = log(); const before = JSON.stringify([d, i, l]);
    const html = renderToStaticMarkup(createElement(ScientificSummaryContent, { detail: d, input: i, log: l }));
    for (const value of [fixture.energy, fixture.threshold, fixture.nuclear_repulsion, ...fixture.frontier]) expect(html).toContain(String(value));
    for (const text of ["Charge", "Multiplicity", "STO-3G", "pyscf 2.14.0", "Converged", "SCF iterations", "Angstrom", "-0.37", "0.37", "UNVERIFIED", "local.pyscf.worker", "Display-only quantities", "UTC:"]) expect(html).toContain(text);
    expect(JSON.stringify([d, i, l])).toBe(before);
  });
  it("shows unavailable instead of defaults when native evidence or iteration count is absent", () => {
    const d = detail(); delete (d.result!.payload as unknown as Record<string, unknown>).scf_iterations;
    const html = renderToStaticMarkup(createElement(ScientificSummaryContent, { detail: d, log: null }));
    expect(html).toContain("SCF iterations</dt><dd>Unavailable");
    expect(html).toContain("HOMO energy (native log)</dt><dd>Unavailable");
    expect(html).toContain("SCF energy convergence threshold</dt><dd>Unavailable");
    expect(html).not.toContain(String(fixture.threshold));
    expect(html).toContain("exact hash-bound input could not be loaded");
  });
  it.each(["artifact", "hash", "attempt", "energy", "nonconverged", "foreign-project", "missing-authority"])("refuses %s evidence mismatch", field => {
    const d = detail(), l = log();
    if (field === "artifact") l.artifact_id = "foreign";
    if (field === "hash") l.sha256 = "1".repeat(64);
    if (field === "attempt") l.attempt_id = "other";
    if (field === "energy") l.text = fixture.text.replace(/converged SCF energy = [^\n]+/, "converged SCF energy = 100");
    if (field === "nonconverged") l.text = fixture.text.replace("converged SCF energy =", "SCF not converged. E =");
    if (field === "foreign-project") d.result!.project_id = "foreign";
    if (field === "missing-authority") delete d.result!.effective_state;
    expect(boundScfEvidence(d, l)).toBeNull();
  });
  it.each(["job", "project", "attempt", "hash", "engine"])("never selects a %s-mismatched log", field => {
    const d = detail(), diag = diagnostics();
    expect(resultLogArtifact(d, diag)?.artifact_id).toBe("log");
    if (field === "job") diag.job_id = "foreign";
    if (field === "project") diag.project_id = "foreign";
    if (field === "attempt") diag.attempts[0]!.attempt_id = "foreign";
    if (field === "hash") diag.attempts[0]!.artifacts![0]!.sha256 = "1".repeat(64);
    if (field === "engine") d.result!.producer_software.name = "psi4";
    expect(resultLogArtifact(d, diag)).toBeNull();
  });
  it("refuses inconsistent coordinate references", () => {
    const i = input(); i.version.coordinates!.structure_version_id = "other";
    const html = renderToStaticMarkup(createElement(ScientificSummaryContent, { detail: detail(), input: i, log: log() }));
    expect(html).toContain("exact hash-bound input could not be loaded");
    expect(html).not.toContain("Units: Angstrom");
  });
});

describe("structure connectivity reflects actual data", () => {
  it("renders inferred H–H from actual elements without water-specific wording or geometry mutation", () => {
    const data = input(), before = JSON.stringify(data);
    const scene = buildScientificScene(data);
    expect(structureConnectivity(scene)).toMatchObject({ status: "INFERRED", authoritativeCount: 0 });
    // React supplies children as the third createElement argument; this provider's
    // props type requires them in the second argument even for that overload.
    const providerProps = { locale: "en", timeZone: "UTC", messages: {} } as ComponentProps<typeof NextIntlClientProvider>;
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps, createElement(GuidedViewer, { detail: data })));
    expect(html).toContain("H–H connections");
    expect(html).not.toContain("O-H");
    expect(JSON.stringify(data)).toBe(before);
  });
  it("recognizes canonical connectivity and does not label it inferred", () => {
    const data = input(); data.version.coordinates!.bonds = [{ atom_index_a: 0, atom_index_b: 1, order: 1 }];
    expect(structureConnectivity(buildScientificScene(data))).toMatchObject({ status: "AUTHORITATIVE", authoritativeCount: 1 });
  });
  it("labels unsupported or absent display connectivity as unknown", () => {
    expect(structureConnectivity(null).status).toBe("UNKNOWN");
    const data = input(); data.version.coordinates!.atoms[1]!.z = 10;
    expect(structureConnectivity(buildScientificScene(data)).status).toBe("UNKNOWN");
  });
  it("derives other element pairs and preserves mixed recorded/inferred connectivity", () => {
    const scene = buildScientificScene(input());
    const other = { ...scene, atoms: [{ ...scene.atoms[0]!, element: "C", atomicNumber: 6 }, scene.atoms[1]!, { ...scene.atoms[1]!, index: 2, element: "O", atomicNumber: 8, position: [0, 0, -1.5] as const }], bonds: [{ id: "bond", atomIndexA: 0, atomIndexB: 1, order: 1, source: "canonical" as const }] };
    const result = structureConnectivity(other);
    expect(result.status).toBe("MIXED");
    expect(result.text).toContain("C–O");
  });
});

describe("timezone-aware presentation", () => {
  it("treats naive database timestamps as UTC and preserves explicit offsets", () => {
    const time = parseUtc("2026-10-14T14:50:11Z");
    expect(parseUtc("2026-10-14 14:50:11.000000")).toBe(time);
    expect(parseUtc("2026-10-14T18:50:11+04:00")).toBe(time);
    expect(parseUtc("2026-10-14T18:50:11+0400")).toBe(time);
  });
  it("distinguishes researcher display time from UTC and observes daylight saving", () => {
    const summer = timestampDisplay("2026-07-14T14:50:11Z", "America/New_York", "en-US")!;
    const winter = timestampDisplay("2026-01-14T14:50:11Z", "America/New_York", "en-US")!;
    expect(summer.local).toContain("10:50:11"); expect(summer.local).toContain("GMT-4");
    expect(winter.local).toContain("09:50:11"); expect(winter.local).toContain("GMT-5");
    expect(summer.utc).toBe("2026-07-14T14:50:11.000Z"); expect(summer.zone).toBe("America/New_York");
  });
  it("rejects invalid and missing timestamps without inventing dates", () => {
    expect(parseUtc("invalid")).toBeNull(); expect(timestampDisplay(null)).toBeNull();
  });
});
