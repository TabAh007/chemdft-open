// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CalculationDetail, JobDiagnostics, JobLogOutput, OverviewRow, StructureVersionDetail } from "@chemdft/schemas";
import fixture from "./fixtures/as-c1-h2-scientific-log.json";

const api = vi.hoisted(() => ({
  role: vi.fn(), getResult: vi.fn(), getCalculation: vi.fn(), input: vi.fn(), diagnostics: vi.fn(), log: vi.fn(), download: vi.fn(), list: vi.fn(), save: vi.fn(),
}));
vi.mock("@/lib/structure-workspace-api", () => ({
  getResult: api.getResult, getCalculation: api.getCalculation, downloadCalculationArtifact: api.download,
  getResultProvenance: vi.fn(), resultLineageExportUrl: () => "#", listStructures: vi.fn(), listStructureVersions: vi.fn(),
}));
vi.mock("@/lib/calculation-result-association", () => ({ calculationInputStructure: api.input, selectedPublishedResult: () => true }));
vi.mock("@/lib/analysis-api", () => ({ getJobDiagnostics: api.diagnostics, getJobLog: api.log, getExportCatalog: vi.fn().mockResolvedValue({ formats: [] }), downloadCalculationExport: vi.fn() }));
vi.mock("@/lib/workflows-api", () => ({ listPublishedResults: api.list, downloadReport: vi.fn() }));
vi.mock("@/lib/download", () => ({ saveBlob: api.save }));
vi.mock("@chemdft/ui", () => ({ AppPopover: ({ content, children }: { content: ReactNode; children: ReactNode }) => createElement("div", null, children, content), AppIcon: () => null, StatusTag: ({ children }: { children: ReactNode }) => createElement("span", null, children), ActionButton: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/lib/project-api", () => ({ getProject: () => api.role() }));
vi.mock("@/lib/overview-dock", () => ({ useOverviewDock: () => {} }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/app/_components/workspace-state-provider", () => ({ useWorkspaceState: () => ({ workspaceMode: "guided" }) }));
vi.mock("../src/app/_components/workspace-state-provider", () => ({ useWorkspaceState: () => ({ workspaceMode: "guided" }) }));
vi.mock("../src/app/_components/results/inspector-viewer", () => ({ InputGeometryCard: () => createElement("div", { "data-testid": "input-geometry" }), ResultViewer: () => null }));
vi.mock("../src/app/_components/export-panel", () => ({ ExportPanel: () => createElement("div", { "data-testid": "export-panel" }, "export") }));
vi.mock("../src/app/_components/provenance-inspector", () => ({ ProvenanceInspector: () => createElement("div", { "data-testid": "provenance-inspector" }, "prov") }));
vi.mock("../src/app/_components/reuse-dialog", () => ({ ReuseDialog: () => null }));
vi.mock("../src/app/_components/projects/structure-thumbnail", () => ({ FormulaText: ({ formula }: { formula: string }) => createElement("span", null, formula), StructureThumb: () => null }));

import { ResultInspector } from "../src/app/_components/results/result-inspector";
import { ResultsLibrary } from "../src/app/_components/results/results-library";
import { RESULTS_PAGE_SIZE as PAGE_SIZE_LIMIT } from "../src/lib/use-published-results";

const LOG_SHA = fixture.source_native_log_sha256;
const ref = { artifact_id: "log", project_id: "p", sha256: LOG_SHA };
function detail(): CalculationDetail {
  return {
    calculation: { id: "calc", project_id: "p", input_id: "input", state: "SUCCEEDED", created_at: "2026-10-14T14:50:08.000000" },
    calculation_input_hash: "0".repeat(64), specification: fixture.specification,
    compute_job: { id: "job", state: "SUCCEEDED" }, compute_execution: { finished_at: "2026-10-14T14:50:11Z" }, attempt: { id: "attempt", raw_artifacts: [ref] },
    result: { id: "result", project_id: "p", calculation_id: "calc", calculation_input_id: "input", result_type: "chemdft.energy", authority: "AUTHORITATIVE", source_class: "CALCULATED",
      validation_state: "VALIDATED", verification_state: "UNVERIFIED", created_at: "2026-10-14T14:50:12Z",
      effective_state: { authority: "AUTHORITATIVE", validation_state: "VALIDATED", source_lineage_validity: "ACTIVE", eligible_for_derivation: true, stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED", verification_state: "UNVERIFIED" },
      producer_software: { name: "pyscf", version: "2.14.0" }, trusted_producer_id: "local.pyscf.worker", trusted_producer_type: "WORKER", producer_attestation_id: "att-1", provenance_record_id: "prov-1", raw_artifacts: [ref],
      payload: { payload_schema: "chemdft.energy", task_type: "ENERGY", method: "hf", basis: "sto-3g", converged: true, scf_iterations: fixture.iterations, total_energy: { value: fixture.energy, unit: { code: "Eh", dimension: "ENERGY" } } } },
  } as unknown as CalculationDetail;
}
function inputStructure(): StructureVersionDetail {
  return { structure: { id: "s", project_id: "p", kind: "MOLECULE", name: "H2" }, version: { id: "v", project_id: "p", structure_id: "s", revision: 1, origin: "IMPORTED", overall_charge: 0, multiplicity: 1,
    coordinates: { structure_version_id: "v", coordinate_system: "CARTESIAN", unit: "angstrom", source: { project_id: "p", entity_type: "structure.version", entity_id: "v" },
      atoms: fixture.input.atoms.map((a) => ({ index: a.index, element: a.element, atomic_number: a.atomic_number, x: a.xyz_angstrom[0], y: a.xyz_angstrom[1], z: a.xyz_angstrom[2] })), bonds: [] } } } as unknown as StructureVersionDetail;
}
const log = (): JobLogOutput => ({ artifact_id: "log", attempt_id: "attempt", kind: "ENGINE_LOG", media_type: "text/plain", sha256: LOG_SHA, text: fixture.text, truncated: false, size_bytes: 1, returned_bytes: 1 });
const diagnostics = (): JobDiagnostics => ({ project_id: "p", calculation_id: "calc", job_id: "job", attempts: [{ attempt_id: "attempt", artifacts: [{ artifact_id: "log", kind: "ENGINE_LOG", format_identifier: "pyscf.log", sha256: LOG_SHA, log_readable: true }] }] } as unknown as JobDiagnostics);

let container: HTMLDivElement;
let root: Root;
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve(); }); };
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const textOf = () => container.textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(api)) fn.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.role.mockResolvedValue({ id: "p", role: "owner" });
  api.getResult.mockImplementation(async () => detail().result);
  api.getCalculation.mockImplementation(async () => detail());
  api.input.mockImplementation(async () => inputStructure());
  api.diagnostics.mockImplementation(async () => diagnostics());
  api.log.mockImplementation(async () => log());
  api.download.mockResolvedValue({ blob: new Blob(["x"]), filename: "native.log" });
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

async function mountInspector(initialSection?: "evidence" | "export") {
  await act(async () => { root.render(createElement(ResultInspector, { projectId: "p", resultId: "result", locale: "en", initialSection: initialSection ?? null })); });
  await flush();
}

describe("ResultInspector", () => {
  it("shows the stored energy once, prominently, with its unit and convergence", async () => {
    await mountInspector();
    expect(byId("primary-value")!.textContent).toBe(fixture.energy.toFixed(10));
    expect(byId("primary-unit")!.textContent).toBe("Eh");
    expect(byId("primary-convergence")!.textContent).toContain("2 iterations");
    expect((textOf().match(new RegExp(fixture.energy.toFixed(10).replace(".", "\\."), "g")) ?? []).length).toBe(1);
    expect(textOf()).not.toContain("Total electronic energy");
    expect(byId("primary-note")!.textContent).toContain("includes nuclear repulsion");
  });
  it("keeps authority, validation, verification and standing as four separate facts", async () => {
    await mountInspector();
    const axes = [...container.querySelectorAll("[data-testid=authority-panel] [data-axis]")].map((el) => `${el.getAttribute("data-axis")}:${el.textContent}`);
    expect(axes).toHaveLength(4);
    expect(axes[0]).toContain("Authoritative");
    expect(axes[1]).toContain("Validated");
    expect(axes[2]).toContain("Not independently verified");
    expect(axes[3]).toContain("Current");
  });
  it("starts with every evidence section collapsed and reads nothing until one is opened", async () => {
    await mountInspector();
    expect(container.querySelectorAll("[data-testid^=section-toggle-][aria-expanded=true]")).toHaveLength(0);
    expect(api.diagnostics).not.toHaveBeenCalled();
    expect(byId("native-quantities")).toBeNull();
  });
  it("opens native evidence on demand: six evidence-derived quantities, classification, unchanged original download", async () => {
    await mountInspector();
    await act(async () => { byId("section-toggle-evidence")!.click(); });
    await flush();
    const native = byId("native-quantities")!.textContent!;
    for (const value of [fixture.threshold, fixture.nuclear_repulsion, fixture.electrons, fixture.basis_functions, ...fixture.frontier]) expect(native).toContain(String(value));
    expect(byId("evidence-classification")!.textContent).toContain("Evidence-derived, display only");
    expect(textOf()).toContain(LOG_SHA);
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Download original native log")!.click(); });
    await flush();
    expect(api.download).toHaveBeenCalledWith({ projectId: "p", calculationId: "calc", artifactId: "log" });
    expect(api.save).toHaveBeenCalledTimes(1);
  });
  it("refuses a native log that is not bound to this result's artifact", async () => {
    api.log.mockImplementation(async () => ({ ...log(), sha256: "1".repeat(64) }));
    await mountInspector();
    await act(async () => { byId("section-toggle-evidence")!.click(); });
    await flush();
    expect(byId("evidence-unverified")).not.toBeNull();
    expect(byId("native-quantities")).toBeNull();
  });
  it("states a missing optional log plainly and leaves the result unchanged", async () => {
    api.diagnostics.mockImplementation(async () => ({ ...diagnostics(), attempts: [{ attempt_id: "attempt", artifacts: [] }] }));
    await mountInspector();
    await act(async () => { byId("section-toggle-evidence")!.click(); });
    await flush();
    expect(byId("evidence-none")).not.toBeNull();
    expect(byId("primary-value")!.textContent).toBe(fixture.energy.toFixed(10));
  });
  it("lists artifacts with their SHA-256 and labels the immutable input", async () => {
    const d = detail(); d.calculation_input_hash = LOG_SHA; api.getCalculation.mockImplementation(async () => d);
    await mountInspector();
    await act(async () => { byId("section-toggle-artifacts")!.click(); });
    expect(byId("artifacts-table")!.textContent).toContain("Immutable calculation input");
    expect(byId("artifacts-table")!.textContent).toContain(LOG_SHA.slice(0, 8));
  });
  it("opens the requested section from a deep link", async () => {
    await mountInspector("export");
    expect(byId("section-toggle-export")!.getAttribute("aria-expanded")).toBe("true");
    expect(byId("export-panel")).not.toBeNull();
  });
  it("hides coordinates it cannot verify and says why", async () => {
    api.input.mockRejectedValue(new Error("The calculation input hash does not match its artifact."));
    await mountInspector();
    await act(async () => { byId("section-toggle-coordinates")!.click(); });
    expect(byId("coordinates-unavailable")!.textContent).toContain("does not match its artifact");
    expect(byId("primary-value")).not.toBeNull();
  });
  it("shows a permission failure without any scientific value", async () => {
    api.getResult.mockRejectedValue(new Error("Project access denied for this result."));
    await mountInspector();
    expect(byId("result-error")!.getAttribute("data-kind")).toBe("forbidden");
    expect(byId("primary-readout")).toBeNull();
  });
  it("shows not-found and mismatched records as errors, never as a result", async () => {
    api.getResult.mockRejectedValue(new Error("Result not found."));
    await mountInspector();
    expect(byId("result-error")!.getAttribute("data-kind")).toBe("missing");
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    api.getResult.mockImplementation(async () => ({ ...detail().result, project_id: "other" }));
    await mountInspector();
    expect(byId("result-error")!.getAttribute("data-kind")).toBe("mismatch");
  });
  it("never writes: only read APIs were called", async () => {
    await mountInspector();
    expect(api.save).not.toHaveBeenCalled();
    expect(api.download).not.toHaveBeenCalled();
  });
});

function overviewRow(over: Record<string, unknown> = {}): OverviewRow {
  return { calculation_id: "calc", calculation_state: "SUCCEEDED", job_state: "SUCCEEDED", created_at: "2026-10-19T10:00:00", updated_at: "2026-10-19T10:05:00", evidence_use: "CURRENT",
    task: "ENERGY", result_id: "result", method: "hf", basis: "STO-3G", engine: "pyscf", engine_version: "2.14.0", charge: 0, multiplicity: 1, structure_name: "H2", structure_revision: 1, formula_hill: "H2",
    quantities: [{ key: "e", kind: "ENERGY", label: "Total electronic energy", unit: "Eh", value: fixture.energy }], effective_state: { authority: "AUTHORITATIVE", validation_state: "VALIDATED", source_lineage_validity: "ACTIVE", eligible_for_derivation: true, stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED", verification_state: "UNVERIFIED" },
    ...over } as unknown as OverviewRow;
}
const PAGE = PAGE_SIZE_LIMIT;
type Call = { limit?: number; cursor?: string | null; task?: string | null; engine?: string | null; standing?: string | null; text?: string | null; sort?: string; direction?: string };
/** A fake server with the real contract: exact counts over everything, filters, stable order, keyset-style cursor. */
function serverOf(all: OverviewRow[]) {
  const outcome = (row: OverviewRow) => (row.result_id ? "published" : row.calculation_state === "FAILED" ? "failed" : row.calculation_state === "CANCELED" ? "canceled" : ["DRAFT", "VALIDATED", "AUTHORIZED", "QUEUED", "RUNNING"].includes(row.calculation_state) ? "pending" : "no_result");
  return async (_project: string, query: Call = {}) => {
    const published = all.filter((r) => r.result_id).sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : String(a.result_id).localeCompare(String(b.result_id))));
    const matching = published.filter((r) =>
      (!query.task || r.task === query.task) && (!query.engine || r.engine === query.engine) &&
      (!query.standing || (r.evidence_use === "CURRENT") === (query.standing === "current")) &&
      (!query.text || JSON.stringify(r).toLowerCase().includes(query.text.toLowerCase())));
    const start = query.cursor ? Number(query.cursor.replace("c:", "")) : 0;
    const limit = query.limit ?? 50;
    const rows = matching.slice(start, start + limit);
    const counts = { pending: 0, failed: 0, canceled: 0, no_result: 0 };
    for (const row of all) { const o = outcome(row); if (o !== "published") counts[o as keyof typeof counts] += 1; }
    return {
      project_id: "p", generated_at: "2026-10-19T12:00:00", rows, total_published: published.length, total_matching: matching.length, total_calculations: all.length,
      without_result: counts, facets: { tasks: [...new Set(published.map((r) => r.task))], engines: [...new Set(published.map((r) => r.engine))] },
      saved_comparisons: { availability: "AVAILABLE", comparisons: [], project_id: "p" }, limit, sort: query.sort ?? "updated", direction: query.direction ?? "desc",
      next_cursor: start + limit < matching.length ? `c:${start + limit}` : null,
    };
  };
}
async function mountLibrary(rows: OverviewRow[]) {
  api.list.mockImplementation(serverOf(rows));
  await act(async () => { root.render(createElement(ResultsLibrary, { projectId: "p", locale: "en" })); });
  await flush();
}

describe("ResultsLibrary", () => {
  it("shows one published result as a featured summary with a single Inspect action and no table controls", async () => {
    await mountLibrary([overviewRow()]);
    expect(container.querySelector("[data-mode=single]")).not.toBeNull();
    expect(byId("featured-result")).not.toBeNull();
    expect(container.querySelectorAll("[data-testid=results-open]")).toHaveLength(1);
    expect(byId("results-open")!.getAttribute("href")).toBe("/en/projects/p/results/result");
    expect(container.querySelector("[role=search], [data-testid=results-table], [data-testid=results-report]")).toBeNull();
    expect(byId("primary-value")!.textContent).toBe(fixture.energy.toFixed(10));
    expect(textOf()).not.toContain("Total electronic energy");
    expect(byId("primary-convergence")!.textContent).toContain("SCF converged");
  });
  it("shows a table with filters and selection limits for several results", async () => {
    const rows = [1, 2, 3].map((n) => overviewRow({ calculation_id: `c${n}`, result_id: `r${n}`, updated_at: `2026-10-19T10:0${n}:00` }));
    await mountLibrary(rows);
    expect(container.querySelector("[data-mode=multiple]")).not.toBeNull();
    expect(byId("results-table")).not.toBeNull();
    expect(container.querySelectorAll("[data-testid=results-row]")).toHaveLength(3);
    expect(container.querySelector("[data-testid=results-compare], [data-testid=results-report]")).toBeNull();
    await act(async () => { (container.querySelectorAll("[data-testid=results-select]")[0] as HTMLInputElement).click(); (container.querySelectorAll("[data-testid=results-select]")[1] as HTMLInputElement).click(); });
    expect(byId("results-compare")!.getAttribute("href")).toContain("/compare?result=");
  });
  it("keeps compare unavailable below the minimum and caps the selection at the existing maximum", async () => {
    const rows = Array.from({ length: 10 }, (_, n) => overviewRow({ calculation_id: `c${n}`, result_id: `r${n}`, updated_at: `2026-10-19T10:${String(10 + n)}:00` }));
    await mountLibrary(rows);
    const boxes = () => [...container.querySelectorAll("[data-testid=results-select]")] as HTMLInputElement[];
    await act(async () => { boxes()[0]!.click(); });
    expect(byId("results-compare-hint")).not.toBeNull();
    for (let i = 1; i < 8; i++) await act(async () => { boxes()[i]!.click(); });
    expect(boxes()[8]!.disabled).toBe(true);
    expect(byId("results-compare")!.textContent).toContain("Compare 8 results");
  });
  it("distinguishes no calculations, pending, failed and finished-without-result", async () => {
    await mountLibrary([]);
    expect(byId("results-empty")!.getAttribute("data-situation")).toBe("none");
    await act(async () => { root.unmount(); }); root = createRoot(container);
    await mountLibrary([overviewRow({ result_id: undefined, calculation_state: "RUNNING", job_state: "RUNNING", evidence_use: "NO_RESULT", quantities: [] })]);
    expect(byId("results-empty")!.getAttribute("data-situation")).toBe("pending");
    await act(async () => { root.unmount(); }); root = createRoot(container);
    await mountLibrary([overviewRow({ result_id: undefined, calculation_state: "FAILED", job_state: "FAILED", evidence_use: "NO_RESULT", quantities: [], failure: "SCF diverged" })]);
    expect(byId("results-empty")!.getAttribute("data-situation")).toBe("failed");
    expect(textOf()).not.toContain("SCF diverged"); // the recorded failure reason belongs to Jobs
    await act(async () => { root.unmount(); }); root = createRoot(container);
    await mountLibrary([overviewRow({ result_id: undefined, evidence_use: "NO_RESULT", quantities: [] })]);
    expect(byId("results-empty")!.getAttribute("data-situation")).toBe("no-result");
  });
  it("shows a load failure with a retry rather than an empty page", async () => {
    api.list.mockRejectedValue(new Error("Project access denied."));
    await act(async () => { root.render(createElement(ResultsLibrary, { projectId: "p", locale: "en" })); });
    await flush();
    expect(byId("results-error")!.textContent).toContain("Project access denied.");
    expect(byId("results-empty")).toBeNull();
  });
});

describe("ResultsLibrary is result-centric", () => {
  const failed = () => overviewRow({ calculation_id: "cf", result_id: undefined, calculation_state: "FAILED", job_state: "FAILED", evidence_use: "NO_RESULT", quantities: [], failure: "SCF diverged (test)" });
  const queued = () => overviewRow({ calculation_id: "cq", result_id: undefined, calculation_state: "QUEUED", job_state: "READY", evidence_use: "NO_RESULT", quantities: [] });
  const two = () => [1, 2].map((n) => overviewRow({ calculation_id: `c${n}`, result_id: `r${n}`, updated_at: `2026-10-19T10:0${n}:00` }));

  it("lists only published results; failed and queued calculations never become rows or standing labels", async () => {
    await mountLibrary([...two(), failed(), queued()]);
    expect(container.querySelectorAll("[data-testid=results-row]")).toHaveLength(2);
    expect(byId("results-table")!.textContent).not.toMatch(/SCF diverged|FAILED|failed|queued|succeeded/i);
    expect(container.querySelectorAll("[data-result-id='']")).toHaveLength(0);
  });
  it("keeps published results, calculation records and calculations without a result apart, with one pointer to Jobs", async () => {
    await mountLibrary([...two(), failed(), queued()]);
    expect(byId("results-total")!.textContent).toBe("2 published results");
    expect(byId("results-calculation-count")!.textContent).toContain("4 calculation records");
    expect(byId("jobs-pointer")!.textContent).toContain("2 calculations have no published result (1 in progress, 1 failed).");
    expect(byId("jobs-pointer-link")!.getAttribute("href")).toBe("/en/projects/p/jobs");
  });
  it("needs no pointer when every calculation produced a published result", async () => {
    await mountLibrary(two());
    expect(byId("jobs-pointer")).toBeNull();
  });
  it("a succeeded calculation without a published result creates no result row", async () => {
    await mountLibrary([overviewRow({ calculation_id: "cs", result_id: undefined, evidence_use: "NO_RESULT", quantities: [] })]);
    expect(byId("results-empty")!.getAttribute("data-situation")).toBe("no-result");
    expect(container.querySelector("[data-testid=results-row], [data-testid=featured-result]")).toBeNull();
    expect(byId("jobs-pointer")!.textContent).toContain("finished without a published result");
  });
  it("a published result stays visible with its recorded historical standing", async () => {
    const historical = overviewRow({ calculation_id: "ch", result_id: "rh", evidence_use: "HISTORICAL_ONLY", effective_state: { authority: "AUTHORITATIVE", validation_state: "VALIDATED", source_lineage_validity: "SUPERSEDED", eligible_for_derivation: false, stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED", verification_state: "UNVERIFIED" } });
    await mountLibrary([...two(), historical]);
    const row = container.querySelector("[data-result-id=rh]") as HTMLElement;
    expect(row.getAttribute("data-standing")).toBe("historical");
    expect(row.textContent).toContain("Historical");
  });
  it("offers no execution-state filter and no 'no result' standing option", async () => {
    await mountLibrary(two());
    expect(byId("results-state")).toBeNull();
    expect([...(byId("results-standing") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["all", "current", "historical"]);
  });
  it("shows one visible Inspect action per row and puts the rest in a menu with only applicable actions", async () => {
    await mountLibrary([overviewRow({ calculation_id: "c1", result_id: "r1", job_id: "j1" } as never), overviewRow({ calculation_id: "c2", result_id: "r2" })]);
    const rows = [...container.querySelectorAll("[data-testid=results-row]")] as HTMLElement[];
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.querySelectorAll("[data-testid=results-open]")).toHaveLength(1);
    const withJob = container.querySelector("[data-result-id=r1]")!;
    const noJob = container.querySelector("[data-result-id=r2]")!;
    const items = (row: Element) => [...row.querySelectorAll("[role=menuitem]")].map((i) => i.textContent);
    expect(items(withJob)).toEqual(["Compare…", "Export & reports", "Provenance & evidence", "View job", "Reuse settings"]);
    expect(items(noJob)).not.toContain("View job");
  });
  it("links Export and Provenance to the inspector section and Compare to Compare", async () => {
    await mountLibrary(two());
    const row = container.querySelector("[data-result-id=r1]")!;
    expect(row.querySelector("[data-action=export]")!.getAttribute("href")).toBe("/en/projects/p/results/r1?section=export");
    expect(row.querySelector("[data-action=provenance]")!.getAttribute("href")).toBe("/en/projects/p/results/r1?section=provenance");
    expect(row.querySelector("[data-action=compare]")!.getAttribute("href")).toBe("/en/projects/p/compare?result=r1");
  });
  it("read-only roles get no Reuse settings anywhere, but keep Inspect, Compare and Export", async () => {
    api.role.mockResolvedValue({ id: "p", role: "viewer" });
    await mountLibrary(two());
    expect(container.querySelector("[data-action=reuse]")).toBeNull();
    expect(container.querySelector("[data-action=compare]")).not.toBeNull();
    expect(container.querySelectorAll("[data-testid=results-open]")).toHaveLength(2);
    await act(async () => { root.unmount(); }); root = createRoot(container);
    await mountLibrary([overviewRow()]);
    expect(byId("results-reuse")).toBeNull();
    expect(byId("featured-compare")).not.toBeNull();
  });
  it("does not offer Reuse settings until the role is known", async () => {
    api.role.mockReturnValue(new Promise(() => {}));
    await mountLibrary(two());
    expect(container.querySelector("[data-action=reuse]")).toBeNull();
  });
});

describe("ResultsLibrary reads published results page by page from the server", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => overviewRow({
    calculation_id: `c${String(i).padStart(3, "0")}`, result_id: `r${String(i).padStart(3, "0")}`,
    updated_at: `2026-10-${String(10 + Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00`,
    ...(i % 2 ? { engine: "xtb", task: "GEOMETRY_OPTIMIZATION" } : {}),
  }));
  const textInput = async (value: string) => {
    const input = byId("results-search") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };

  it("asks for the first page only and shows the exact counts the server reports", async () => {
    await mountLibrary(many(250));
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list.mock.calls[0]![1]).toMatchObject({ limit: PAGE, sort: "updated", direction: "desc" });
    expect(container.querySelectorAll("[data-testid=results-row]")).toHaveLength(PAGE);
    expect(byId("results-total")!.textContent).toBe("250 published results");
    expect(byId("results-count")!.textContent).toBe("100 of 250 shown");
  });
  it("loads the next page with the server's cursor and never repeats or drops a row", async () => {
    await mountLibrary(many(250));
    await act(async () => { byId("results-more")!.click(); });
    await flush();
    expect(api.list.mock.calls[1]![1]).toMatchObject({ cursor: "c:100", limit: PAGE });
    const ids = [...container.querySelectorAll("[data-testid=results-row]")].map((r) => r.getAttribute("data-result-id"));
    expect(ids).toHaveLength(200);
    expect(new Set(ids).size).toBe(200);
    expect(byId("results-more")!.textContent).toContain("50 remaining");
    await act(async () => { byId("results-more")!.click(); });
    await flush();
    expect(container.querySelectorAll("[data-testid=results-row]")).toHaveLength(250);
    expect(byId("results-more")).toBeNull();
  });
  it("shows results that are older than any window: they are rows like any other", async () => {
    const oldest = overviewRow({ calculation_id: "c-old", result_id: "r-old", updated_at: "2020-01-01T00:00:00" });
    const newerUnpublished = Array.from({ length: 400 }, (_, i) => overviewRow({ calculation_id: `f${i}`, result_id: undefined, calculation_state: "FAILED", job_state: "FAILED", evidence_use: "NO_RESULT", quantities: [], updated_at: "2026-10-18T00:00:00" }));
    await mountLibrary([oldest, overviewRow({ calculation_id: "c2", result_id: "r2" }), ...newerUnpublished]);
    expect(container.querySelector("[data-result-id=r-old]")).not.toBeNull();
    expect(byId("results-total")!.textContent).toBe("2 published results");
    expect(byId("results-calculation-count")!.textContent).toContain("402 calculation records");
    expect(byId("jobs-pointer")!.textContent).toContain("400 calculations have no published result (400 failed)");
  });
  it("sends filters and sort to the server and starts again from the first page", async () => {
    await mountLibrary(many(250));
    await act(async () => { const select = byId("results-engine") as HTMLSelectElement; select.value = "xtb"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(api.list.mock.calls.at(-1)![1]).toMatchObject({ engine: "xtb", limit: PAGE });
    expect(api.list.mock.calls.at(-1)![1]).not.toHaveProperty("cursor");
    expect(byId("results-count")!.textContent).toBe("100 of 125 shown");
    await act(async () => { const select = byId("results-standing") as HTMLSelectElement; select.value = "historical"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(api.list.mock.calls.at(-1)![1]).toMatchObject({ engine: "xtb", standing: "historical" });
    expect(byId("results-count")!.textContent).toBe("0 of 0 shown");
    expect(container.textContent).toContain("No published result matches these filters.");
    expect(container.querySelector("[data-mode=multiple]")).not.toBeNull();
  });
  it("sends the search text after typing stops, and clearing filters returns to everything", async () => {
    vi.useFakeTimers();
    try {
      await mountLibrary(many(30));
      const calls = api.list.mock.calls.length;
      await textInput("r007");
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(api.list.mock.calls.length).toBe(calls);
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await flush();
      expect(api.list.mock.calls.at(-1)![1]).toMatchObject({ text: "r007" });
      expect(container.querySelectorAll("[data-testid=results-row]")).toHaveLength(1);
      await act(async () => { byId("results-clear")!.click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      await flush();
      expect(container.querySelectorAll("[data-testid=results-row]")).toHaveLength(30);
    } finally { vi.useRealTimers(); }
  });
  it("sorts through the server: a header click requests that ordering", async () => {
    await mountLibrary(many(30));
    await act(async () => { byId("results-sort-energy")!.click(); });
    await flush();
    expect(api.list.mock.calls.at(-1)![1]).toMatchObject({ sort: "energy", direction: "asc" });
    await act(async () => { byId("results-sort-energy")!.click(); });
    await flush();
    expect(api.list.mock.calls.at(-1)![1]).toMatchObject({ sort: "energy", direction: "desc" });
  });
  it("keeps the selection across pages and applies the existing 2–8 limit by result id", async () => {
    await mountLibrary(many(250));
    const boxes = () => [...container.querySelectorAll("[data-testid=results-select]")] as HTMLInputElement[];
    for (let i = 0; i < 4; i++) await act(async () => { boxes()[i]!.click(); });
    await act(async () => { byId("results-more")!.click(); });
    await flush();
    expect(byId("results-actions")!.textContent).toContain("4 selected");
    for (let i = 100; i < 104; i++) await act(async () => { boxes()[i]!.click(); });
    expect(byId("results-compare")!.textContent).toContain("Compare 8 results");
    expect(boxes()[110]!.disabled).toBe(true);
    expect(byId("results-compare")!.getAttribute("href")).toContain("result=r");
  });
  it("shows an error from a later page without discarding the rows already loaded", async () => {
    await mountLibrary(many(250));
    api.list.mockRejectedValueOnce(new Error("network lost"));
    await act(async () => { byId("results-more")!.click(); });
    await flush();
    expect(container.querySelectorAll("[data-testid=results-row]")).toHaveLength(100);
    expect(byId("results-error")!.textContent).toContain("network lost");
  });
  it("the mode and the counts do not change while a new query is loading", async () => {
    await mountLibrary(many(250));
    let release!: (value: unknown) => void;
    api.list.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => { const select = byId("results-task") as HTMLSelectElement; select.value = "ENERGY"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelector("[data-mode=multiple]")).not.toBeNull();
    expect(byId("results-total")!.textContent).toBe("250 published results");
    expect(byId("results-count")!.textContent).toBe("Updating…");
    await act(async () => { release(await serverOf(many(250))("p", { task: "ENERGY", limit: PAGE })); });
    await flush();
    expect(byId("results-count")!.textContent).toBe("100 of 125 shown");
  });
});

describe("native evidence viewer", () => {
  async function openEvidence() {
    await mountInspector();
    await act(async () => { byId("section-toggle-evidence")!.click(); });
    await flush();
  }
  it("says it shows an excerpt, offers present sections, and keeps the original hash and download", async () => {
    await openEvidence();
    expect(byId("log-scope-note")!.textContent).toContain("Search and copy apply to this excerpt only");
    expect([...container.querySelectorAll("[data-testid=log-sections] button")].map((b) => b.textContent)).toEqual(["SCF initialization", "Iteration output", "Convergence & final energy", "Native input summary"]);
    expect(byId("log-original")!.textContent).toContain(LOG_SHA);
    expect(textOf()).toContain("Python source, local paths and machine identifiers");
  });
  it("searches only the displayed excerpt and highlights matches", async () => {
    await openEvidence();
    const input = byId("log-search") as HTMLInputElement;
    const setValue = async (value: string) => { await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); };
    await setValue("converged");
    expect(byId("log-match-count")!.textContent).toMatch(/^1 of \d+$/);
    expect(container.querySelectorAll("[data-testid=log-text] mark").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[data-testid=log-text] mark[data-active]")).toHaveLength(1);
    await setValue("python");
    expect(byId("log-match-count")!.textContent).toBe("No matches");
  });
  it("copies the displayed excerpt, not the original log, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await openEvidence();
    await act(async () => { byId("log-copy")!.click(); });
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain("converged SCF energy = ");
    expect(copied.length).toBeLessThan(fixture.text.length);
    expect(byId("log-copy-status")!.textContent).toContain("not the original log");
  });
  it("never alters or re-hashes the original: download still requests the same artifact", async () => {
    await openEvidence();
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Download original native log")!.click(); });
    await flush();
    expect(api.download).toHaveBeenCalledWith({ projectId: "p", calculationId: "calc", artifactId: "log" });
    expect(api.log.mock.results.length).toBeGreaterThan(0);
  });
});

describe("inspector access", () => {
  it("hides Reuse settings from read-only roles but keeps Export and Compare", async () => {
    api.role.mockResolvedValue({ id: "p", role: "viewer" });
    await mountInspector();
    expect(byId("inspector-reuse")).toBeNull();
    expect(byId("inspector-export")).not.toBeNull();
    expect(byId("inspector-compare")).not.toBeNull();
  });
  it("offers Reuse settings to an editor", async () => {
    await mountInspector();
    expect(byId("inspector-reuse")).not.toBeNull();
  });
});
