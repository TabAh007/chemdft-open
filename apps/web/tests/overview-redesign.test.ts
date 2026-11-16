import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { NavigatorAction, NavigatorState } from "@chemdft/schemas";
import type { WorkspaceCatalogItem } from "../src/app/_components/workspace-state-provider";
import { navigatorMessage } from "../src/lib/navigator-messages";
import {
  actionVerb,
  blockedBreakdown,
  crystalFormulas,
  formulaFromCounts,
  groupWorkflows,
  planContinue,
  reconcileCaption,
  projectStatus,
  readinessRows,
  restrictionSummary,
  resultListRows,
  workflowGroup,
  WORKFLOW_GROUP_LABEL,
  blockedKinds,
  haveTone,
  overviewCounts,
  readiness,
  reasonKind,
  recentActivity,
  selectionHref,
  splitActions,
} from "../src/lib/overview-model";
import { bondBasis, structureAuthority } from "../src/lib/overview-structure";
import { validSelection } from "../src/lib/workspace-selection";

const root = resolve(import.meta.dirname, "../../..");
const schema = JSON.parse(readFileSync(resolve(root, "packages/schemas/generated/chemdft-contracts.schema.json"), "utf8"));
const actionIds = schema.$defs.NavigatorAction.properties.action_id.enum as string[];
const reasonCodes = schema.$defs.NavigatorReason.properties.code.enum as string[];

const P = "e11d9ea8-f66d-4a48-a872-859d4cb1d0ef";
const id = (n: number) => `e11d9ea8-f66d-4a48-a872-${String(n).padStart(12, "0")}`;

function item(overrides: Partial<WorkspaceCatalogItem> & Pick<WorkspaceCatalogItem, "selection" | "section">): WorkspaceCatalogItem {
  return { label: "item", ...overrides };
}
function action(actionId: string, reasons: string[] = []): NavigatorAction {
  return {
    action_id: actionId as NavigatorAction["action_id"], category: "structure", title_key: `action.${actionId}.title`, description_key: `action.${actionId}.description`,
    required_capability: "read", minimum_role_key: "role.viewer", required_facts: [], conflicting_facts: [], resulting_fact: "x", goal_ids: [],
    reasons: reasons.map((code) => ({ code: code as never, message_key: `reason.${code}` })),
  };
}

describe("Overview presentation model: server contract coverage", () => {
  it("classifies every server reason code (an unclassified code would hide how a restriction arises)", () => {
    for (const code of reasonCodes) expect(reasonKind(code), code).not.toBe("other");
    expect(reasonKind("a_code_the_server_adds_later")).toBe("other");
  });

  it("has a specific button verb for every server action and keeps full server titles for every action", () => {
    for (const actionId of actionIds) {
      expect(actionVerb(actionId), actionId).not.toBe("Open");
      expect(navigatorMessage("en", `action.${actionId}.title`)).not.toBe(`action.${actionId}.title`);
    }
    expect(actionVerb("action.from.the.future")).toBe("Open");
  });

  it("separates infrastructure capability from scientific prerequisites and project records", () => {
    expect(reasonKind("worker_unavailable")).toBe("capability");
    expect(reasonKind("optimizer_unavailable")).toBe("capability");
    expect(reasonKind("periodic_compute_unsupported")).toBe("method");
    expect(reasonKind("frequency_required")).toBe("scientific");
    expect(reasonKind("optimization_required")).toBe("scientific");
    expect(reasonKind("structure_missing")).toBe("project");
    expect(reasonKind("editor_required")).toBe("access");
  });

  it("orders and de-duplicates restriction kinds per blocked action, preserving every reason", () => {
    const blocked = action("spectra.predict_uv_vis", ["optimization_required", "worker_unavailable", "frequency_required"]);
    expect(blockedKinds(blocked)).toEqual(["capability", "scientific"]);
    expect(blocked.reasons).toHaveLength(3);
    const breakdown = blockedBreakdown([blocked, action("structure.inspect", ["structure_missing"]), action("calculation.optimize", ["worker_unavailable"])]);
    expect(breakdown.map((entry) => [entry.kind, entry.count])).toEqual([["capability", 2], ["scientific", 1], ["project", 1]]);
  });
});

describe("Overview counts come only from recorded catalogue items and never merge sources", () => {
  const catalog: WorkspaceCatalogItem[] = [
    item({ selection: { kind: "structureVersion", id: id(1), projectId: P, sourceId: id(2) }, section: "structures", authority: "COMMITTED" }),
    item({ selection: { kind: "structureCandidate", id: id(3), projectId: P }, section: "structures", authority: "CANDIDATE" }),
    item({ selection: { kind: "candidateRepresentation", id: id(4), projectId: P, sourceId: id(3) }, section: "structures", authority: "CANDIDATE" }),
    item({ selection: { kind: "geometryCandidate", id: id(5), projectId: P }, section: "structures", authority: "COMMITTED" }),
    item({ selection: { kind: "calculation", id: id(6), projectId: P }, section: "calculations" }),
    item({ selection: { kind: "externalImport", id: id(7), projectId: P }, section: "calculations", authority: "IMPORTED" }),
    item({ selection: { kind: "externalImport", id: id(8), projectId: P }, section: "files" }),
    item({ selection: { kind: "calculationResult", id: id(9), projectId: P, sourceId: id(6) }, section: "results", authority: "AUTHORITATIVE" }),
    item({ selection: { kind: "optimizationTrajectory", id: id(10), projectId: P, sourceId: id(6) }, section: "results", authority: "AUTHORITATIVE" }),
    item({ selection: { kind: "importedResult", id: id(11), projectId: P, sourceId: id(7) }, section: "results", authority: "IMPORTED" }),
    item({ selection: { kind: "document", id: id(12), projectId: P }, section: "files" }),
    item({ selection: { kind: "file", id: id(13), projectId: P }, section: "files" }),
    item({ selection: { kind: "experimentalDataset", id: id(14), projectId: P }, section: "experimentalData" }),
    item({ selection: { kind: "experimentalSpectrum", id: id(15), projectId: P }, section: "experimentalData", authority: "EXPERIMENTAL" }),
    item({ selection: { kind: "experimentalSpectrum", id: id(16), projectId: P }, section: "experimentalData", authority: "EXPERIMENTAL", parentKey: `experimentalSpectrum:${id(15)}` }),
  ];

  it("counts committed structure versions and keeps unreviewed candidates apart", () => {
    expect(overviewCounts(catalog).structures).toEqual({ committed: 1, candidates: 1 });
  });

  it("keeps submitted calculations, imported calculations, published results and imported results separate", () => {
    const counts = overviewCounts(catalog);
    expect(counts.calculations).toEqual({ submitted: 1, imported: 1 });
    expect(counts.results).toEqual({ published: 1, imported: 1 });
  });

  it("counts user-supplied evidence without counting derived spectra, files, or import previews as measurements", () => {
    expect(overviewCounts(catalog).evidence).toEqual({ documents: 1, datasets: 1, spectra: 1 });
  });

  it("reports zero, not an invented number, for an empty catalogue", () => {
    expect(overviewCounts([])).toEqual({
      structures: { committed: 0, candidates: 0 }, calculations: { submitted: 0, imported: 0 },
      results: { published: 0, imported: 0 }, evidence: { documents: 0, datasets: 0, spectra: 0 },
    });
  });
});

describe("Overview Navigator presentation", () => {
  const base = { goal: null, goals: [], next: [], blocked: [] } as Pick<NavigatorState, "goal" | "goals" | "next" | "blocked">;

  it("describes availability, not executability", () => {
    expect(readiness({ ...base, next: [action("structure.inspect")] })).toMatchObject({ tone: "available", available: 1, text: "1 action available" });
    expect(readiness({ ...base, next: [action("structure.inspect"), action("jobs.review")] }).text).toBe("2 actions available");
    expect(readiness({ ...base, blocked: [action("calculation.optimize", ["worker_unavailable"])] })).toMatchObject({ tone: "blocked", text: "No actions available", blocked: 1 });
  });

  it("marks a goal recorded only when the server says it is satisfied", () => {
    const goals = [{ goal_id: "energy", title_key: "goal.energy", satisfied: true }] as NavigatorState["goals"];
    expect(readiness({ ...base, goal: "energy", goals, next: [action("jobs.review")] }).tone).toBe("recorded");
    expect(readiness({ ...base, goal: "energy", goals: [{ ...goals[0]!, satisfied: false }], next: [action("jobs.review")] }).tone).toBe("available");
  });

  it("keeps server order, recommends the first action with a real destination, and never links an action without one", () => {
    const next = [action("structure.inspect"), action("calculation.single_point"), action("jobs.review")];
    const split = splitActions(next, (candidate) => (candidate.action_id === "structure.inspect" ? null : `/go/${candidate.action_id}`));
    expect(split.recommended?.action.action_id).toBe("calculation.single_point");
    expect(split.others.map((entry) => entry.action.action_id)).toEqual(["jobs.review"]);
    expect(split.unlinked.map((entry) => entry.action_id)).toEqual(["structure.inspect"]);
    expect(splitActions(next, () => null).recommended).toBeNull();
  });

  it("shows failed and in-progress work as such, never as a confirmed prerequisite", () => {
    expect(haveTone("job.failed")).toBe("attention");
    expect(haveTone("job.in_progress")).toBe("pending");
    expect(haveTone("candidate.review_required")).toBe("pending");
    expect(haveTone("structure.molecule")).toBe("confirmed");
  });
});

describe("Overview activity and structure identity", () => {
  it("lists only persisted history events, newest first, limited", () => {
    const history = (n: number, at: string, linked?: boolean) => item({
      selection: { kind: "historyEvent", id: id(100 + n), projectId: P }, section: "history", label: `event ${n}`, occurredAt: at,
      ...(linked ? { linkedSelection: { kind: "calculation" as const, id: id(6), projectId: P } } : {}),
    });
    const catalog = [history(1, "2026-10-18T10:00:00"), history(2, "2026-10-18T12:00:00", true), history(3, "2026-10-18T11:00:00"), item({ selection: { kind: "calculation", id: id(6), projectId: P }, section: "calculations" })];
    const entries = recentActivity(catalog, 2);
    expect(entries.map((entry) => entry.label)).toEqual(["event 2", "event 3"]);
    expect(entries[0]!.selection).toEqual({ kind: "calculation", id: id(6), projectId: P });
    expect(recentActivity([], 5)).toEqual([]);
  });

  it("builds links the workspace itself accepts", () => {
    const selection = { kind: "structureVersion" as const, id: id(1), projectId: P, sourceId: id(2) };
    const url = new URL(selectionHref("en", P, selection), "https://chemdft.test");
    expect(url.pathname).toBe(`/en/projects/${P}/workspace`);
    expect(url.searchParams.get("selection")).toBe(`structureVersion:${id(1)}`);
    expect(url.searchParams.get("source")).toBe(id(2));
    expect(validSelection({ kind: "structureVersion", id: url.searchParams.get("selection")!.split(":")[1], projectId: P, sourceId: url.searchParams.get("source") }, P)).toBe(true);
  });

  it("uses the workspace's authority wording and never upgrades an unreviewed structure", () => {
    expect(structureAuthority({ provenance: { origin: "IMPORTED", source_class: "USER_SUPPLIED", verification_state: "UNVERIFIED" }, version: { origin: "IMPORTED" } } as never)).toEqual({ source: "USER_SUPPLIED", verification: "NOT REVIEWED" });
    expect(structureAuthority({ provenance: null, version: { origin: "OPTIMIZED" } } as never)).toEqual({ source: "OPTIMIZED", verification: "NOT REVIEWED" });
  });
});

describe("Overview is a read-only surface", () => {
  const dir = resolve(root, "apps/web/src/app/_components/overview");
  const sources = readdirSync(dir).filter((name) => name.endsWith(".tsx")).map((name) => readFileSync(resolve(dir, name), "utf8"));
  const libs = ["overview-model.ts", "overview-structure.ts", "use-overview-navigator.ts"].map((name) => readFileSync(resolve(root, "apps/web/src/lib", name), "utf8"));

  it("never submits calculations, calls AI providers or mutates records", () => {
    for (const source of [...sources, ...libs]) {
      expect(source).not.toMatch(/submitCalculation|createProject|importStructure|ai-scientist-api|method:\s*["'](POST|PUT|PATCH|DELETE)/);
    }
  });

  it("uses the ChemDFT UI wrapper, not Blueprint directly", () => {
    for (const source of sources) expect(source).not.toMatch(/@blueprintjs\//);
  });

  it("keeps the server Navigator inputs: goal, structure scope and the same refresh triggers", () => {
    const hook = libs[2]!;
    expect(hook).toContain("getNavigator(projectId, { goal: goal || undefined, structureVersionId");
    expect(hook).toContain('"chemdft:workspace-items-changed"');
    expect(hook).toContain("running_jobs");
  });
});

describe("Workflow groups preserve every server action", () => {
  it("places every server action id in a named group (none falls into 'other')", () => {
    for (const actionId of actionIds) expect(workflowGroup(actionId), actionId).not.toBe("other");
    expect(workflowGroup("calculation.optimize")).toBe("structure");
    expect(workflowGroup("spectra.compare")).toBe("analysis");
    expect(workflowGroup("evidence.import_document")).toBe("evidence");
    expect(Object.keys(WORKFLOW_GROUP_LABEL)).toContain("other");
  });

  it("keeps server order, never drops or duplicates an action, and leaves the recommended one to its own bar", () => {
    const next = ["structure.inspect", "calculation.single_point", "spectra.upload_experimental", "structure.edit"].map((id) => action(id));
    const blocked = [action("calculation.optimize", ["worker_unavailable"]), action("spectra.predict_ir", ["optimization_required"])];
    const groups = groupWorkflows(next.map((entry) => ({ action: entry, href: `/go/${entry.action_id}` })), blocked, "structure.inspect");
    const ids = groups.flatMap((group) => [...group.available.map((entry) => entry.action.action_id), ...group.blocked.map((entry) => entry.action_id)]);
    expect(ids.sort()).toEqual(["calculation.optimize", "calculation.single_point", "spectra.predict_ir", "spectra.upload_experimental", "structure.edit"].sort());
    expect(groups.find((group) => group.id === "structure")!.available.map((entry) => entry.action.action_id)).toEqual(["structure.edit"]);
    expect(groups.find((group) => group.id === "structure")!.blocked.map((entry) => entry.action_id)).toEqual(["calculation.optimize"]);
    expect(groups.map((group) => group.id)).toEqual(["structure", "electronic", "spectroscopy"]);
  });
});

describe("Scientific status shows only what changes the next move", () => {
  const stateWith = (over: Partial<NavigatorState>): NavigatorState => ({ goal: null, goals: [], next: [], blocked: [], have: [], notices: [], context: {} as never, project_id: P, facts_summary: {}, ...over } as NavigatorState);
  const counts = (over: Partial<ReturnType<typeof overviewCounts>> = {}) => ({ ...overviewCounts([]), ...over });
  const withStructure = { structure_version_id: "v", charge: 0, multiplicity: 1 } as never;
  const provenance = [{ state_id: "provenance.available", label_key: "x", detail: null }];

  it("an empty project reports a missing structure and nothing as recorded", () => {
    const rows = readinessRows({ state: stateWith({}), counts: counts() });
    expect(rows).toEqual([{ id: "structure", label: "Structure", value: "None saved", tone: "missing" }]);
  });

  it("does not repeat counts or structure facts that the summary strip and structure panel already show", () => {
    const rows = readinessRows({ state: stateWith({ facts_summary: withStructure, have: provenance }), counts: counts({ calculations: { submitted: 2, imported: 0 }, results: { published: 1, imported: 0 } }) });
    expect(rows.map((row) => row.id)).toEqual(["prerequisites"]);
    expect(rows[0]).toMatchObject({ tone: "ok" });
  });

  it("flags missing charge, multiplicity or provenance instead of calling the structure ready", () => {
    const rows = readinessRows({ state: stateWith({ facts_summary: { structure_version_id: "v" } as never }), counts: counts() });
    expect(rows.find((row) => row.id === "prerequisites")).toMatchObject({ tone: "attention", value: "charge and multiplicity and source provenance not recorded" });
  });

  it("raises candidates awaiting review as a separate review requirement", () => {
    const rows = readinessRows({ state: stateWith({ facts_summary: withStructure, have: provenance }), counts: counts({ structures: { committed: 1, candidates: 2 } }) });
    expect(rows.find((row) => row.id === "candidates")).toMatchObject({ tone: "attention", value: "2 structure candidates awaiting review" });
    expect(readinessRows({ state: null, counts: null })).toEqual([]);
  });
});

describe("Restrictions are kept apart by kind", () => {
  it("summarises each kind in one line and lists the affected workflows without merging kinds", () => {
    const blocked = [
      action("calculation.optimize", ["worker_unavailable", "optimizer_unavailable"]),
      action("spectra.predict_ir", ["optimization_required", "worker_unavailable"]),
      action("structure.inspect_unit_cell", ["crystal_required"]),
      action("structure.build_supercell", ["periodic_compute_unsupported"]),
      action("structure.edit", ["editor_required"]),
      action("evidence.inspect_provenance", ["provenance_required"]),
    ];
    const restrictions = restrictionSummary(blocked);
    expect(restrictions.map((entry) => [entry.kind, entry.count])).toEqual([["capability", 2], ["method", 1], ["scientific", 2], ["project", 1], ["access", 1]]);
    expect(restrictions[0]!.sentence).toBe("2 workflows unavailable with the current worker");
    expect(restrictions[1]!.sentence).toBe("1 workflow use a method that is not supported");
    expect(restrictions[0]!.actions.map((entry) => entry.action_id)).toEqual(["calculation.optimize", "spectra.predict_ir"]);
    expect(restrictionSummary([])).toEqual([]);
  });
});

describe("Project status is derived from recorded counts and never merges failures with results", () => {
  it("reports no structure, structure-only, and separate published/failed/running counts", () => {
    expect(projectStatus({ hasStructure: false, failed: 0, running: 0, published: 0, ready: true })).toEqual({ tone: "missing", text: "No saved structure" });
    expect(projectStatus({ hasStructure: true, failed: 0, running: 0, published: 0, ready: true })).toEqual({ tone: "info", text: "Structure saved · no calculations" });
    expect(projectStatus({ hasStructure: true, failed: 1, running: 0, published: 1, ready: true })).toEqual({ tone: "attention", text: "1 result published · 1 calculation failed" });
    expect(projectStatus({ hasStructure: true, failed: 0, running: 2, published: 3, ready: true })).toEqual({ tone: "ok", text: "3 results published · 2 calculations running" });
  });
  it("says nothing until the records have loaded", () => {
    expect(projectStatus({ hasStructure: true, failed: 0, running: 0, published: 0, ready: false })).toBeNull();
  });
});

describe("Results list rows keep every calculation separate", () => {
  const row = (over: Record<string, unknown>) => ({ calculation_id: "c", calculation_state: "SUCCEEDED", created_at: "2026-10-18T10:00:00", updated_at: "2026-10-18T10:00:00", evidence_use: "CURRENT", task: "ENERGY", ...over }) as never;
  it("a failed calculation never inherits or removes another calculation's published result", () => {
    const rows = resultListRows([
      row({ calculation_id: "ok", result_id: "r", updated_at: "2026-10-18T10:24:00", quantities: [{ label: "Total energy", value: -74.9629, unit: "hartree" }], method: "HF", basis: "STO-3G", engine: "pyscf", structure_name: "Water", structure_revision: 1, structure_version_id: "v", structure_id: "s" }),
      row({ calculation_id: "bad", calculation_state: "FAILED", job_state: "FAILED", evidence_use: "NO_RESULT", updated_at: "2026-10-18T10:31:00", failure: "boom" }),
    ]);
    expect(rows.map((entry) => [entry.calculationId, entry.kind])).toEqual([["bad", "failed"], ["ok", "result"]]);
    expect(rows.find((entry) => entry.calculationId === "ok")).toMatchObject({ resultId: "r", failure: null, structureId: "s", structureVersionId: "v" });
    expect(rows.find((entry) => entry.calculationId === "bad")).toMatchObject({ resultId: null, failure: "boom", headline: null });
  });
  it("limits the list and treats a row with neither result nor failure as pending", () => {
    const many = Array.from({ length: 9 }, (_, index) => row({ calculation_id: `c${index}`, calculation_state: "QUEUED", evidence_use: "NO_RESULT", updated_at: `2026-10-18T10:0${index}:00` }));
    const rows = resultListRows(many, 4);
    expect(rows).toHaveLength(4);
    expect(rows.every((entry) => entry.kind === "pending")).toBe(true);
  });
});

describe("Structure showcase wording", () => {
  it("states whether drawn bonds are stored or display-only inference", () => {
    expect(bondBasis({ kind: "molecule", canonicalBonds: [[0, 1]] }).kind).toBe("stored");
    expect(bondBasis({ kind: "molecule", canonicalBonds: [], inferredBonds: { pairs: [[0, 1]], label: "x" } }).kind).toBe("inferred");
    expect(bondBasis({ kind: "molecule", canonicalBonds: [] }).kind).toBe("none");
    expect(bondBasis({ kind: "periodic", canonicalBonds: [] }).text).toContain("unit cell");
    expect(bondBasis(null).kind).toBe("none");
  });
});

describe("Overview AI Scientist dock handling", () => {
  const dock = readFileSync(resolve(root, "apps/web/src/lib/overview-dock.ts"), "utf8");
  it("uses the Workspace's own event, shell class and stored preference keys", () => {
    for (const token of ['"chemdft:toggle-dock"', '"chemdft:dock-state"', '"dock-collapsed"', "guided-ai-dock", "chemdft:panels:"]) expect(dock).toContain(token);
  });
  it("only shows or hides the panel", () => {
    expect(dock).not.toMatch(/fetch\(|submitCalculation|ai-scientist-api/);
  });
});

describe("Continue your research: one recommendation, a short list, everything else under Browse", () => {
  const ids = ["structure.inspect", "structure.edit", "calculation.single_point", "evidence.inspect_provenance", "spectra.upload_experimental", "structure.import", "structure.draw", "evidence.import_document"];
  const next = ids.map((id) => action(id));
  const href = (candidate: NavigatorAction) => `/go/${candidate.action_id}`;

  it("never repeats an action between the recommendation, the structure card and the list", () => {
    const plan = planContinue(next, href);
    expect(plan.recommendedId).toBe("structure.inspect");
    expect(plan.onStructureCard).toEqual(["structure.edit"]);
    const listed = plan.listed.map((entry) => entry.action.action_id);
    expect(listed).toEqual(["calculation.single_point", "evidence.inspect_provenance", "spectra.upload_experimental", "structure.import"]);
    expect(new Set([plan.recommendedId, ...plan.onStructureCard, ...listed]).size).toBe(1 + plan.onStructureCard.length + listed.length);
  });

  it("accounts for every available action exactly once, so the counts reconcile", () => {
    const plan = planContinue(next, href);
    expect(plan.total).toBe(8);
    expect(plan.hidden).toBe(2);
    expect(1 + plan.onStructureCard.length + plan.listed.length + plan.hidden).toBe(plan.total);
    expect(reconcileCaption(plan)).toBe("8 available: 1 recommended, 1 on the structure card, 4 listed here, 2 more under Browse all workflows");
  });

  it("leaves actions without a destination out of the list (they stay in Browse as non-links)", () => {
    const plan = planContinue(next, (candidate) => (candidate.action_id === "calculation.single_point" ? null : href(candidate)));
    expect(plan.listed.map((entry) => entry.action.action_id)).not.toContain("calculation.single_point");
  });

  it("handles an empty or recommendation-only project", () => {
    expect(reconcileCaption(planContinue([], href))).toBe("No workflows are available with the current prerequisites.");
    const only = planContinue([action("structure.import")], href);
    expect(only.recommendedId).toBe("structure.import");
    expect(reconcileCaption(only)).toBe("1 available: 1 recommended");
  });

  it("does not offer Edit structure when the server does not (viewer access)", () => {
    const plan = planContinue(["jobs.review", "structure.inspect", "evidence.inspect_provenance"].map((id) => action(id)), href);
    expect(plan.recommendedId).toBe("jobs.review");
    expect(plan.onStructureCard).toEqual(["structure.inspect"]);
    expect(plan.onStructureCard).not.toContain("structure.edit");
  });
});

describe("Formulas distinguish a crystal's reduced formula from its stored cell composition", () => {
  it("orders by Hill rules and reduces by the common divisor", () => {
    expect(formulaFromCounts(new Map([["O", 3], ["Cr", 2]]))).toBe("Cr2O3");
    expect(formulaFromCounts(new Map([["H", 6], ["C", 6]]))).toBe("C6H6");
    const cr2o3 = [...Array(12).fill("Cr"), ...Array(18).fill("O")];
    expect(crystalFormulas(cr2o3)).toEqual({ cell: "Cr12O18", reduced: "Cr2O3", atoms: 30 });
  });
  it("reports no separate reduced formula when the cell is already one formula unit", () => {
    expect(crystalFormulas(["Cr", "Cr", "O", "O", "O"])).toEqual({ cell: "Cr2O3", reduced: null, atoms: 5 });
    expect(crystalFormulas(["Na", "Cl"])).toEqual({ cell: "ClNa", reduced: null, atoms: 2 });
  });
});
