// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CalculationComparisonOutput, OverviewRow, ResultSummary } from "@chemdft/schemas";

/**
 * The Compare workstation with the network replaced by controllable stand-ins. The numbers are structural placeholders
 * (never imported by production code): they prove selection, URL, stale-response, permission and no-fabrication
 * behaviour, not any science. The real stored evidence is exercised by the Playwright specs.
 */
const api = vi.hoisted(() => ({
  list: vi.fn(), compare: vi.fn(), role: vi.fn(), savedList: vi.fn(), savedOpen: vi.fn(), savedCreate: vi.fn(), savedArchive: vi.fn(), download: vi.fn(), report: vi.fn(), save: vi.fn(), getResult: vi.fn(),
}));
vi.mock("@/lib/workflows-api", () => ({
  listPublishedResults: api.list, listSavedComparisons: api.savedList, openSavedComparison: api.savedOpen, createSavedComparison: api.savedCreate,
  archiveSavedComparison: api.savedArchive, downloadReport: api.report,
}));
vi.mock("@/lib/analysis-api", () => ({ compareCalculations: api.compare, downloadComparison: api.download }));
vi.mock("@/lib/structure-workspace-api", () => ({ getResult: api.getResult, listStructureVersions: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/project-api", () => ({ getProject: () => api.role() }));
vi.mock("@/lib/download", () => ({ saveBlob: api.save }));
vi.mock("@/lib/overview-dock", () => ({ useOverviewDock: () => {} }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@chemdft/ui", () => ({
  // Popover content is always rendered here so a test can use it without driving Blueprint's overlay.
  AppPopover: ({ content, children }: { content: ReactNode; children: ReactNode }) => createElement("div", null, children, content),
  AppIcon: () => null,
}));
vi.mock("@/app/_components/workspace-state-provider", () => ({ useWorkspaceState: () => ({ workspaceMode: "guided" }) }));
vi.mock("../src/app/_components/workspace-state-provider", () => ({ useWorkspaceState: () => ({ workspaceMode: "guided" }) }));
vi.mock("../src/app/_components/scientific-timestamp", () => ({ ScientificTimestamp: ({ value }: { value: string }) => createElement("span", null, value) }));

const nav = vi.hoisted(() => ({ pathname: "/en/projects/p/compare" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { CompareDockNotice } from "../src/app/_components/compare/compare-dock-notice";
import { AiContextProvider, useAiPageContext, usePublishedAiContext, type AiPageContext } from "../src/lib/ai-context";
import { CompareWorkstation } from "../src/app/_components/compare/compare-workstation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function row(n: number, extra: Partial<OverviewRow> = {}): OverviewRow {
  const level = { method: "hf", basis: "sto-3g" };
  return {
    calculation_id: id(n + 100), calculation_state: "SUCCEEDED", task: "ENERGY", engine: "pyscf", engine_version: "2", method: level.method, basis: level.basis, charge: 0, multiplicity: 1,
    structure_id: id(n + 300), structure_name: "water", structure_version_id: id(n + 200), structure_revision: 1, formula_hill: "H2O", atom_count: 3, created_at: "2026-01-01T00:00:00Z",
    updated_at: `2026-01-${String(10 + n).padStart(2, "0")}T00:00:00Z`, result_id: id(n), result_type: "chemdft.energy",
    quantities: [{ key: "total_energy", label: "Total energy", value: -n - 0.5, unit: "Eh", kind: "total_energy" }], evidence_use: "CURRENT",
    effective_state: { authority: "AUTHORITATIVE", validation_state: "VALIDATED", source_lineage_validity: "ACTIVE", verification_state: "UNVERIFIED" },
    visualizations: [], exports: [], saved_comparison_ids: [], ...extra,
  } as unknown as OverviewRow;
}
const ROWS = Array.from({ length: 10 }, (_, i) => row(i + 1));

function summaryOf(r: OverviewRow): ResultSummary {
  return { result_id: r.result_id, calculation_id: r.calculation_id, result_type: r.result_type, task: r.task, engine: r.engine, engine_version: r.engine_version, method: r.method, basis: r.basis, charge: 0, multiplicity: 1,
    structure: { structure_version_id: r.structure_version_id, formula_hill: "H2O", atom_count: 3, element_sequence: ["O", "H", "H"], geometry_role: "INPUT" }, quantities: r.quantities, created_at: r.created_at,
    evidence_use: r.evidence_use } as unknown as ResultSummary;
}
/** A stand-in for the server's evaluator: same-level pairs are comparable with a delta the stand-in provides; different levels are blocked. */
function comparisonFor(ids: string[]): CalculationComparisonOutput {
  const rows = ids.map((rid) => ROWS.find((r) => r.result_id === rid)!);
  const reference = rows[0]!;
  const pairs = rows.slice(1).map((other) => {
    const blocked = other.method !== reference.method || other.basis !== reference.basis;
    return {
      reference_result_id: reference.result_id, other_result_id: other.result_id, label: blocked ? "NOT_SCIENTIFICALLY_COMPARABLE" : "DIRECTLY_COMPARABLE",
      rules: [{ rule_id: "R5_LEVEL", outcome: blocked ? "FAIL" : "PASS", detail: blocked ? "Different level of theory." : "Same level of theory." }],
      limitations: [], blockers: [], geometry: { relation: "IDENTICAL_STRUCTURE_VERSION" },
      deltas: blocked ? [] : [{ quantity_kind: "total_energy", label: "Total energy", reference_value: reference.quantities![0]!.value, other_value: other.quantities![0]!.value, unit: "Eh", delta: 4242, delta_kcal_per_mol: 1, delta_kj_per_mol: 2, assumptions: [] }],
      evidence_standing: "CURRENT",
    };
  });
  const overall = pairs.some((p) => p.label === "NOT_SCIENTIFICALLY_COMPARABLE") ? "NOT_SCIENTIFICALLY_COMPARABLE" : "DIRECTLY_COMPARABLE";
  return { project_id: id(999), reference_result_id: reference.result_id, results: rows.map(summaryOf), pairs, overall, conversion_factors: {}, notice: "Agreement is not independent verification.", delta_convention: "other minus reference" } as unknown as CalculationComparisonOutput;
}
const page = (rows: OverviewRow[], extra: Record<string, unknown> = {}) => ({
  project_id: id(999), generated_at: "x", rows, total_published: ROWS.length, total_matching: rows.length, total_calculations: ROWS.length, without_result: { pending: 0, failed: 0, canceled: 0, no_result: 0 },
  facets: { tasks: ["ENERGY"], engines: ["pyscf"] }, saved_comparisons: { availability: "AVAILABLE", comparisons: [], project_id: id(999) }, limit: 100, sort: "updated", direction: "desc", next_cursor: null, ...extra,
});

let container: HTMLDivElement;
let root: Root;
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const byId = (testId: string) => container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
const allById = (testId: string) => [...container.querySelectorAll(`[data-testid="${testId}"]`)] as HTMLElement[];
const rowEl = (n: number) => container.querySelector(`[data-result-id="${id(n)}"][data-testid="compare-candidate"]`) as HTMLElement;
const checkbox = (n: number) => rowEl(n).querySelector("input[type=checkbox]") as HTMLInputElement;
async function tick(n: number) { await act(async () => { checkbox(n).click(); }); await act(async () => { await new Promise((r) => setTimeout(r, 200)); }); await flush(); }
const search = () => decodeURIComponent(window.location.search);

async function mount(url = "/en/projects/p/compare") {
  window.history.replaceState(null, "", url);
  await act(async () => { root.render(createElement(CompareWorkstation, { projectId: "p", locale: "en" })); });
  await flush(10);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(api)) fn.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.role.mockResolvedValue({ id: "p", role: "owner" });
  api.list.mockImplementation(async (_p: string, q: { resultIds?: string[] }) => page(q.resultIds ? ROWS.filter((r) => q.resultIds!.includes(r.result_id!)) : ROWS));
  api.compare.mockImplementation(async (_p: string, ids: string[]) => comparisonFor(ids));
  api.savedList.mockResolvedValue({ availability: "AVAILABLE", comparisons: [], project_id: id(999) });
  api.getResult.mockResolvedValue({ payload: {} });
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("states", () => {
  it("starts empty: tells the researcher to select, shows no table and offers nothing to compare", async () => {
    await mount();
    expect(byId("compare-empty")?.textContent).toContain("Select a result to begin comparing.");
    expect(byId("compare-empty")?.textContent).toContain("two to 8 published results");
    expect(byId("compare-deltas")).toBeNull();
    expect(byId("compare-output")).toBeNull();
    expect(allById("compare-candidate")).toHaveLength(10);
  });

  it("one selected result is the reference and asks for another; nothing is compared", async () => {
    await mount();
    await tick(3);
    expect(byId("compare-need-more")).not.toBeNull();
    expect(byId("compare-selected-card")?.getAttribute("data-reference")).toBe("true");
    expect(api.compare).not.toHaveBeenCalled();
    expect(search()).toBe(`?result=${id(3)}`);
  });

  it("the second selection updates the visible comparison at once (cards immediately, verdict when the server answers)", async () => {
    await mount();
    await tick(1);
    await act(async () => { checkbox(2).click(); });
    expect(allById("compare-selected-card")).toHaveLength(2); // before any network answer
    expect(byId("compare-checking")).not.toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); }); await flush();
    expect(byId("compare-overall")?.textContent).toContain("Directly comparable");
    expect(byId("compare-output")?.getAttribute("data-overall")).toBe("DIRECTLY_COMPARABLE");
    expect(byId("compare-delta")?.textContent).toContain("4242"); // the server's delta, passed through
    expect(search()).toBe(`?result=${id(1)}&result=${id(2)}`);
  });
});

describe("selection rules", () => {
  it("refuses a ninth result and says why; removing frees a place", async () => {
    await mount();
    for (let n = 1; n <= 8; n++) await act(async () => { checkbox(n).click(); });
    await flush();
    expect(byId("compare-selected-count")?.textContent).toContain("8 of 8");
    expect(checkbox(9).disabled).toBe(true);
    expect(byId("compare-limit")?.textContent).toContain("maximum of 8");
    await act(async () => { (allById("compare-remove")[7] as HTMLButtonElement).click(); }); await flush();
    expect(checkbox(9).disabled).toBe(false);
  });

  it("changing the reference reorders the ids, updates the URL and asks the server for the new reference", async () => {
    await mount();
    await tick(1); await tick(2); await tick(3);
    api.compare.mockClear();
    await act(async () => { (allById("compare-make-reference")[1] as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); }); await flush();
    expect(search()).toBe(`?result=${id(3)}&result=${id(1)}&result=${id(2)}`);
    expect(api.compare).toHaveBeenLastCalledWith("p", [id(3), id(1), id(2)], expect.anything());
    expect(allById("compare-selected-card")[0]?.getAttribute("data-result-id")).toBe(id(3));
    expect(allById("compare-selected-card")[0]?.getAttribute("data-reference")).toBe("true");
  });

  it("clear empties the selection and the URL in one action", async () => {
    await mount();
    await tick(1); await tick(2);
    await act(async () => { byId("compare-reset")!.click(); }); await flush();
    expect(byId("compare-empty")).not.toBeNull();
    expect(window.location.search).toBe("");
  });

  it("sorting and filtering never clear the selection", async () => {
    await mount();
    await tick(1); await tick(2);
    const select = byId("compare-sort") as HTMLSelectElement;
    await act(async () => { select.value = "task:asc"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
    const chip = byId("compare-type-ENERGY")!;
    await act(async () => { chip.click(); }); await flush();
    expect(allById("compare-selected-card")).toHaveLength(2);
    expect(search()).toBe(`?result=${id(1)}&result=${id(2)}`);
  });
});

describe("races: a stale answer never replaces a newer selection", () => {
  it("shows only the comparison for the current ids", async () => {
    const gates: Record<string, (value: CalculationComparisonOutput) => void> = {};
    api.compare.mockImplementation((_p: string, ids: string[], signal?: AbortSignal) => new Promise((resolve, reject) => {
      gates[ids.join(",")] = resolve;
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    await mount();
    await tick(1);
    await act(async () => { checkbox(2).click(); }); await act(async () => { await new Promise((r) => setTimeout(r, 200)); }); // first request in flight
    await act(async () => { checkbox(3).click(); }); await act(async () => { await new Promise((r) => setTimeout(r, 200)); }); // selection changed; second request in flight
    const first = [id(1), id(2)].join(","), second = [id(1), id(2), id(3)].join(",");
    expect(Object.keys(gates)).toEqual([first, second]);
    await act(async () => { gates[first]!(comparisonFor([id(1), id(2)])); }); await flush();
    expect(byId("compare-overall")).toBeNull(); // the older answer is ignored
    await act(async () => { gates[second]!(comparisonFor([id(1), id(2), id(3)])); }); await flush();
    expect(byId("compare-overall")).not.toBeNull();
    expect(allById("compare-delta")).toHaveLength(2); // two others against the reference
  });
});

describe("scientific honesty", () => {
  it("an incompatible pairing shows no difference, no plot data and says what to change", async () => {
    const original = ROWS[1]!;
    ROWS[1] = row(2, { method: "b3lyp", basis: "def2-svp" });
    try {
      await mount();
      await tick(1); await tick(2);
      expect(byId("compare-overall")?.textContent).toContain("Not scientifically comparable");
      expect(byId("compare-remedy")?.textContent).toContain("No numerical difference is shown.");
      expect(allById("compare-delta")).toHaveLength(0);
      expect(byId("compare-delta-blocked")).not.toBeNull();
      expect(byId("compare-deltas")?.textContent).not.toContain("4242");
    } finally { ROWS[1] = original; }
  });
});

describe("deep links, availability and saved comparisons", () => {
  it("restores a shared link without discarding valid selections when one id is not available", async () => {
    await mount(`/en/projects/p/compare?result=${id(1)}&result=${id(2)}&result=${id(777)}`);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); }); await flush();
    expect(allById("compare-selected-card").map((c) => c.getAttribute("data-result-id"))).toEqual([id(1), id(2)]);
    expect(byId("compare-unavailable")?.textContent).toContain("1 selected result is not available");
    expect(byId("compare-overall")).not.toBeNull(); // the valid pair is still compared
    expect(api.compare).toHaveBeenLastCalledWith("p", [id(1), id(2)], expect.anything());
    // Saving is not offered while an unavailable id is selected.
    expect((byId("compare-save-open") as HTMLButtonElement).disabled).toBe(true);
  });

  it("loads results by id when a link names ones beyond the first library page", async () => {
    api.list.mockImplementation(async (_p: string, q: { resultIds?: string[] }) => q.resultIds ? page(ROWS.filter((r) => q.resultIds!.includes(r.result_id!))) : page(ROWS.slice(0, 2), { total_matching: 10, next_cursor: "more" }));
    await mount(`/en/projects/p/compare?result=${id(9)}&result=${id(10)}`);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); }); await flush();
    expect(api.list).toHaveBeenCalledWith("p", expect.objectContaining({ resultIds: [id(9), id(10)] }));
    expect(allById("compare-selected-card")).toHaveLength(2);
  });

  it("opens a saved comparison with its exact members and reference, revalidated by the server", async () => {
    api.savedOpen.mockResolvedValue({
      saved: { id: "s1", name: "Water series", result_ids: [id(4), id(2)], project_id: id(999) }, status: "CURRENT", notice: "n", revalidated_at: "2026-01-01T00:00:00Z", comparison: comparisonFor([id(4), id(2)]),
      revalidation: [{ result_id: id(4), status: "UNCHANGED", detail: "same", saved: { evidence_use: "CURRENT" }, current_evidence_use: "CURRENT" }, { result_id: id(2), status: "UNCHANGED", detail: "same", saved: { evidence_use: "CURRENT" }, current_evidence_use: "CURRENT" }], snapshot: {},
    });
    await mount("/en/projects/p/compare?saved=s1");
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); }); await flush();
    expect(api.savedOpen).toHaveBeenCalledWith("p", "s1");
    expect(allById("compare-selected-card").map((c) => c.getAttribute("data-result-id"))).toEqual([id(4), id(2)]);
    expect(byId("revalidation")?.getAttribute("data-status")).toBe("CURRENT");
    // Editing the selection leaves `?saved=` and says so.
    await act(async () => { (allById("compare-remove")[1] as HTMLButtonElement).click(); }); await flush();
    expect(window.location.search).toBe(`?result=${id(4)}`);
    expect(byId("revalidation")?.textContent).toContain("selection has been changed");
  });

  it("saves exactly the selected ids in reference order", async () => {
    api.savedCreate.mockResolvedValue({ id: "s2", name: "Pair", result_ids: [id(2), id(1)] });
    await mount();
    await tick(2); await tick(1);
    const name = byId("compare-save-name") as HTMLInputElement;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(name, "Pair"); name.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { (byId("compare-save-form") as HTMLFormElement).requestSubmit(); }); await flush();
    expect(api.savedCreate).toHaveBeenCalledWith({ projectId: "p", name: "Pair", note: "", resultIds: [id(2), id(1)] });
  });
});

describe("identity, counts and the A–H navigator", () => {
  it("shows stored temperature and pressure for thermochemistry rows, says when they are not recorded, and gives every row a short id", async () => {
    const hot = row(21, { task: "THERMOCHEMISTRY", result_type: "chemdft.thermochemistry", conditions: { temperature_k: 100, pressure_pa: 101325 } } as never);
    const bare = row(22, { task: "THERMOCHEMISTRY", result_type: "chemdft.thermochemistry" });
    api.list.mockImplementation(async () => page([...ROWS.slice(0, 2), hot, bare]));
    await mount();
    expect(rowEl(21).querySelector("[data-testid=compare-row-conditions]")?.textContent).toBe("T 100 K · p 1 atm");
    expect(rowEl(22).querySelector("[data-testid=compare-row-conditions]")?.textContent).toBe("conditions not recorded");
    expect(rowEl(1).querySelector("[data-testid=compare-row-conditions]")).toBeNull(); // not a thermochemistry result
    expect(rowEl(21).querySelector("[data-testid=compare-row-identity]")?.textContent).toContain(`#${id(21).slice(0, 8)}`);
    expect(rowEl(21).querySelector("[data-testid=compare-row-identity]")?.textContent).toContain("2026-01-");
  });

  it("counts what is loaded separately from what matches, so 1,215 results are never claimed to be loaded", async () => {
    api.list.mockImplementation(async () => page(ROWS.slice(0, 3), { total_published: 1215, total_matching: 1215, next_cursor: "more" }));
    await mount();
    expect(byId("compare-loaded")?.textContent).toBe("3 loaded of 1,215 published");
    expect(byId("compare-loaded")?.getAttribute("title")).toContain("3 of 1,215 matching results are loaded");
    expect(byId("compare-more")?.textContent).toBe("Show more (1,212 not loaded yet)");
  });

  it("shows all eight slots, marks the reference, and brings a chosen result forward", async () => {
    await mount();
    await tick(1); await tick(2);
    expect(byId("compare-nav-count")?.textContent).toBe("2 of 8 selected");
    expect(allById("compare-nav-slot").map((b) => b.textContent)).toEqual(["A", "B"]);
    expect(byId("compare-strip-next")).toBeNull(); // two cards share the width: no pager
    await tick(3); await tick(4);
    expect(allById("compare-nav-slot").map((b) => b.textContent)).toEqual(["A", "B", "C", "D"]);
    expect(allById("compare-nav-slot")[0]?.getAttribute("data-reference")).toBe("true");
    expect(allById("compare-nav-slot")[0]?.getAttribute("aria-label")).toContain("reference");
    expect(byId("compare-strip-prev")).not.toBeNull();
    expect(byId("compare-strip-next")).not.toBeNull();
    await act(async () => { allById("compare-nav-slot")[3]!.click(); });
    expect(allById("compare-selected-card")[3]?.getAttribute("data-active")).toBe("true");
    expect(allById("compare-nav-slot")[3]?.getAttribute("aria-current")).toBe("true");
    // the reference and the URL are untouched by navigating
    expect(allById("compare-selected-card")[0]?.getAttribute("data-reference")).toBe("true");
    expect(search()).toBe(`?result=${id(1)}&result=${id(2)}&result=${id(3)}&result=${id(4)}`);
  });

  it("eight selected results fill every slot and say so", async () => {
    await mount();
    for (let n = 1; n <= 8; n++) await act(async () => { checkbox(n).click(); });
    await flush();
    expect(allById("compare-nav-slot")).toHaveLength(8);
    expect(byId("compare-nav-count")?.textContent).toBe("8 of 8 selected");
    expect(byId("compare-navigator")?.getAttribute("aria-label")).toBe("Selected results: 8 of 8");
  });
});

describe("quantity-level status", () => {
  it("an incompatible pairing says Incompatible and names the rule, with the reason behind it for assistive technology", async () => {
    const original = ROWS[1]!;
    ROWS[1] = row(2, { method: "b3lyp", basis: "def2-svp" });
    try {
      await mount();
      await tick(1); await tick(2);
      const chip = byId("compare-delta-blocked")!;
      expect(chip.textContent).toContain("Incompatible");
      expect(chip.textContent).toContain("level of theory");
      expect(chip.getAttribute("title")).toContain("No difference exists");
      expect(byId("compare-key-legend")?.textContent).toContain("Unavailable");
    } finally { ROWS[1] = original; }
  });
  it("an authorized difference carries its own status", async () => {
    await mount();
    await tick(1); await tick(2);
    expect(byId("compare-delta")?.textContent).toContain("Authorized");
  });
});

describe("AI Scientist dock notice", () => {
  const Publisher = ({ context }: { context: AiPageContext | null }) => { useAiPageContext("p", context); return null; };
  const compared: AiPageContext = { page: "compare", label: "Calculation comparison", resultIds: [id(1), id(2)], letters: ["A", "B"], referenceLabel: "Energy · hf / sto-3g", readOnly: true };
  it("states the comparison context from the shared AI context, shows the context once without repeating the status chips, and shows only on the Compare page", async () => {
    await act(async () => { root.render(createElement(AiContextProvider, null, createElement(CompareDockNotice, { projectId: "p" }))); });
    expect(byId("compare-dock-notice")?.textContent).toContain("No results are selected for comparison.");
    await act(async () => { root.render(createElement(AiContextProvider, null, createElement(Publisher, { context: compared }), createElement(CompareDockNotice, { projectId: "p" }))); });
    expect(byId("compare-dock-context")?.textContent).toBe("Comparing 2 results (A, B); reference: Energy · hf / sto-3g.");
    expect(byId("compare-dock-notice")?.textContent).not.toContain("Named, not grounded");
    expect(byId("compare-dock-notice")?.textContent).toContain("Nothing is sent unless you ask.");
    // The explanation is collapsed by default: the open note was 144 px tall and squeezed the conversation at 1280x720.
    // The short read-only message stays visible; only the long paragraph is inside the disclosure.
    expect(byId("compare-dock-readonly")).toBeNull();
    expect(byId("compare-dock-notice")?.textContent).not.toContain("Read-only");
    const more = byId("compare-dock-notice")?.querySelector("details");
    expect(more).not.toBeNull();
    expect(more?.open).toBe(false);
    expect(more?.querySelector("summary")?.textContent).toBe("What the assistant knows");
    nav.pathname = "/en/projects/p/results";
    try {
      await act(async () => { root.render(createElement(AiContextProvider, null, createElement(Publisher, { context: compared }), createElement(CompareDockNotice, { projectId: "p" }))); });
      expect(byId("compare-dock-notice")).toBeNull();
    } finally { nav.pathname = "/en/projects/p/compare"; }
  });
  it("the workstation publishes the compared results to the shared context and clears it on unmount", async () => {
    const seen: Array<AiPageContext | null> = [];
    const Probe = () => { seen.push(usePublishedAiContext("p")); return null; };
    window.history.replaceState(null, "", "/en/projects/p/compare");
    await act(async () => { root.render(createElement(AiContextProvider, null, createElement(CompareWorkstation, { projectId: "p", locale: "en" }), createElement(Probe))); });
    await flush(10);
    await tick(1); await tick(2);
    const last = seen.at(-1);
    expect(last).toMatchObject({ page: "compare", letters: ["A", "B"], readOnly: true });
    expect(last?.page === "compare" ? last.resultIds.length : 0).toBe(2);
    expect(last?.page === "compare" ? last.referenceLabel : "").toContain("Single-point energy");
    await act(async () => { root.render(createElement(AiContextProvider, null, createElement(Probe))); });
    expect(seen.at(-1)).toBeNull();
  });
});

describe("permissions", () => {
  it("a read-only member can inspect, compare and export but is offered no save or archive", async () => {
    api.role.mockResolvedValue({ id: "p", role: "viewer" });
    api.savedList.mockResolvedValue({ availability: "AVAILABLE", comparisons: [{ id: "s1", name: "Shared", result_ids: [id(1), id(2)], archived: false }], project_id: id(999) });
    await mount();
    await tick(1); await tick(2);
    expect(byId("compare-save-open")).toBeNull();
    expect(byId("compare-export")).not.toBeNull();
    expect(byId("saved-menu")).not.toBeNull();
    expect(container.querySelector("[aria-label^='Archive saved comparison']")).toBeNull();
  });
});

describe("exports", () => {
  it("exports exactly the selected results in the existing formats", async () => {
    api.download.mockResolvedValue({ blob: new Blob(["x"]), filename: "comparison.csv" });
    api.report.mockResolvedValue({ blob: new Blob(["x"]), filename: "report.html" });
    await mount();
    await tick(1); await tick(2);
    await act(async () => { byId("compare-export-csv")!.click(); }); await flush();
    expect(api.download).toHaveBeenCalledWith({ projectId: "p", resultIds: [id(1), id(2)], format: "csv" });
    await act(async () => { byId("compare-report-html")!.click(); }); await flush();
    expect(api.report).toHaveBeenCalledWith({ projectId: "p", format: "html", resultIds: [id(1), id(2)] });
    expect(byId("compare-feedback")?.textContent).toBe("Saved report.html.");
  });
});
