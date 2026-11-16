import type { NavigatorAction, NavigatorState, OverviewRow } from "@chemdft/schemas";
import { resultContextModel, standingText } from "./overview-view";
import type { WorkspaceCatalogItem } from "@/app/_components/workspace-state-provider";
import type { WorkspaceSelection } from "./workspace-selection";

/**
 * Presentation rules for the project Overview. Nothing here decides what is scientifically possible: eligibility,
 * prerequisites and their reasons come from the server Navigator and are only grouped and labelled for scanning.
 * Counts are tallies of authenticated, persisted records already listed in the project catalogue; a record that is
 * not in the catalogue is never counted, and imported values are never merged into calculated ones.
 */

/* ------------------------------------------------------------------ counts */

export type OverviewCounts = {
  /** Immutable committed StructureVersions, and unreviewed candidates (never counted as structures). */
  structures: { committed: number; candidates: number };
  /** Calculations submitted through ChemDFT, and externally imported calculation records (kept separate). */
  calculations: { submitted: number; imported: number };
  /** Published ChemDFT results, and imported results (source-class IMPORTED, not ChemDFT engine results). */
  results: { published: number; imported: number };
  /** User-supplied evidence: source documents, experimental datasets and raw experimental spectra. */
  evidence: { documents: number; datasets: number; spectra: number };
};

const count = (items: readonly WorkspaceCatalogItem[], test: (item: WorkspaceCatalogItem) => boolean) => items.filter(test).length;

export function overviewCounts(catalog: readonly WorkspaceCatalogItem[]): OverviewCounts {
  return {
    structures: {
      committed: count(catalog, (item) => item.selection.kind === "structureVersion"),
      candidates: count(catalog, (item) => item.authority === "CANDIDATE" && (item.selection.kind === "structureCandidate" || item.selection.kind === "geometryCandidate")),
    },
    calculations: {
      submitted: count(catalog, (item) => item.selection.kind === "calculation"),
      imported: count(catalog, (item) => item.selection.kind === "externalImport" && item.section === "calculations"),
    },
    results: {
      published: count(catalog, (item) => item.selection.kind === "calculationResult"),
      imported: count(catalog, (item) => item.selection.kind === "importedResult"),
    },
    evidence: {
      documents: count(catalog, (item) => item.selection.kind === "document"),
      datasets: count(catalog, (item) => item.selection.kind === "experimentalDataset"),
      // Derived versions and peak sets are not new measurements.
      spectra: count(catalog, (item) => item.selection.kind === "experimentalSpectrum" && !item.parentKey),
    },
  };
}

export function plural(value: number, one: string, many = `${one}s`): string {
  return `${value} ${value === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ Navigator: goal readiness */

export type Readiness = {
  tone: "available" | "blocked" | "recorded";
  available: number;
  blocked: number;
  /** Short, literal status; availability is never presented as proof that a worker can execute the task. */
  text: string;
};

export function readiness(state: Pick<NavigatorState, "goal" | "goals" | "next" | "blocked">): Readiness {
  const available = state.next.length;
  const blocked = state.blocked.length;
  const satisfied = state.goal ? state.goals.find((goal) => goal.goal_id === state.goal)?.satisfied === true : false;
  if (satisfied) return { tone: "recorded", available, blocked, text: "Goal recorded" };
  if (available === 0) return { tone: "blocked", available, blocked, text: "No actions available" };
  return { tone: "available", available, blocked, text: plural(available, "action") + " available" };
}

/* ------------------------------------------------------------------ Navigator: actions */

/** Short, specific verbs for the action button. A presentation label only; the destination is `navigatorHref`. */
const ACTION_VERB: Record<string, string> = {
  "structure.draw": "Draw molecule",
  "structure.import": "Import structure",
  "structure.inspect": "Inspect structure",
  "structure.edit": "Edit structure",
  "structure.inspect_unit_cell": "View unit cell",
  "structure.build_supercell": "View supercell",
  "calculation.single_point": "Configure calculation",
  "calculation.optimize": "Configure optimization",
  "calculation.orbitals": "Configure orbitals",
  "spectra.predict_ir": "Configure IR",
  "spectra.predict_raman": "Configure Raman",
  "spectra.predict_uv_vis": "Configure UV/Vis",
  "spectra.upload_experimental": "Import spectrum",
  "spectra.inspect_experimental": "Review spectrum",
  "spectra.process_experimental": "Process data",
  "spectra.compare": "Compare spectra",
  "spectra.inspect_computed": "Inspect spectrum",
  "electronic.inspect_orbitals": "Inspect orbitals",
  "electronic.inspect_homo_lumo": "Inspect HOMO / LUMO",
  "electronic.inspect_density": "View density",
  "electronic.inspect_esp": "View potential",
  "thermochemistry.calculate": "Configure thermochemistry",
  "thermochemistry.inspect": "Inspect result",
  "evidence.import_document": "Import document",
  "evidence.import_calculation": "Import calculation",
  "evidence.inspect_provenance": "Inspect provenance",
  "jobs.review": "Review jobs",
};

export function actionVerb(actionId: string): string {
  return ACTION_VERB[actionId] ?? "Open";
}

export type ResolvedAction = { action: NavigatorAction; href: string };

/**
 * Server order is authoritative: the recommended action is the first available action that has a real destination.
 * Actions without a valid destination are never rendered as links.
 */
export function splitActions(next: readonly NavigatorAction[], hrefFor: (action: NavigatorAction) => string | null): {
  recommended: ResolvedAction | null;
  others: ResolvedAction[];
  unlinked: NavigatorAction[];
} {
  const resolved: ResolvedAction[] = [];
  const unlinked: NavigatorAction[] = [];
  for (const action of next) {
    const href = hrefFor(action);
    if (href) resolved.push({ action, href });
    else unlinked.push(action);
  }
  return { recommended: resolved[0] ?? null, others: resolved.slice(1), unlinked };
}

/* ------------------------------------------------------------------ Navigator: blocked reasons */

export type ReasonKind = "project" | "scientific" | "capability" | "method" | "access" | "other";

const REASON_KIND: Record<string, ReasonKind> = {
  // A record the project does not hold yet.
  structure_missing: "project", coordinates_3d_required: "project", charge_required: "project", multiplicity_required: "project",
  provenance_required: "project", job_required: "project", job_in_progress: "project", history_limit_reached: "project",
  experimental_spectrum_required: "project", experimental_peaks_required: "project", spectrum_association_required: "project",
  // A scientific condition: a prior validated result, or a property of the structure.
  molecule_required: "scientific", lattice_required: "scientific", crystal_required: "scientific",
  optimization_required: "scientific", frequency_required: "scientific", imaginary_frequencies: "scientific",
  stationarity_unproven: "scientific", frequency_geometry_mismatch: "scientific", closed_shell_required: "scientific",
  matching_level_required: "scientific", orbitals_required: "scientific", computed_spectrum_required: "scientific",
  matching_spectrum_type_required: "scientific", thermochemistry_required: "scientific",
  // The hosted scientific worker or engine adapters, not the project.
  worker_unavailable: "capability", optimizer_unavailable: "capability",
  // A computational method the engine adapters do not implement (not a worker outage, not a missing record).
  periodic_compute_unsupported: "method",
  // Who may act.
  editor_required: "access", template_sealed: "access",
};

export const REASON_KIND_LABEL: Record<ReasonKind, string> = {
  project: "Project record",
  scientific: "Scientific prerequisite",
  capability: "Worker capability",
  method: "Unsupported method",
  access: "Access",
  other: "Prerequisite",
};

/** Unknown codes stay visible under a neutral label rather than being mapped to a guess. */
export function reasonKind(code: string): ReasonKind {
  return REASON_KIND[code] ?? "other";
}

const KIND_ORDER: ReasonKind[] = ["capability", "method", "scientific", "project", "access", "other"];

export function blockedKinds(action: Pick<NavigatorAction, "reasons">): ReasonKind[] {
  const kinds = new Set((action.reasons ?? []).map((reason) => reasonKind(reason.code)));
  return KIND_ORDER.filter((kind) => kinds.has(kind));
}

/** How many unavailable actions are held back by each kind of restriction (an action can appear under several). */
export function blockedBreakdown(blocked: readonly Pick<NavigatorAction, "reasons">[]): Array<{ kind: ReasonKind; label: string; count: number }> {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: REASON_KIND_LABEL[kind],
    count: blocked.filter((action) => blockedKinds(action).includes(kind)).length,
  })).filter((entry) => entry.count > 0);
}

/* ------------------------------------------------------------------ Navigator: recorded prerequisites */

export type HaveTone = "confirmed" | "attention" | "pending";

export function haveTone(stateId: string): HaveTone {
  if (stateId === "job.failed") return "attention";
  if (stateId === "candidate.review_required" || stateId === "job.in_progress") return "pending";
  return "confirmed";
}

/* ------------------------------------------------------------------ recent activity */

export type ActivityEntry = { key: string; label: string; detail: string | null; occurredAt: string; selection: WorkspaceSelection | null };

/** Authenticated persisted events only (the project history already listed by the workspace). Newest first. */
export function recentActivity(catalog: readonly WorkspaceCatalogItem[], limit = 5): ActivityEntry[] {
  return catalog
    .filter((item) => item.section === "history" && item.occurredAt)
    .sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))
    .slice(0, limit)
    .map((item) => ({
      key: `${item.selection.kind}:${item.selection.id}`,
      label: item.label,
      detail: item.detail ?? null,
      occurredAt: item.occurredAt ?? "",
      selection: item.linkedSelection ?? null,
    }));
}

/** Same selection parameters the workspace writes itself (`workspaceSelectionUrl`). */
export function selectionHref(locale: string, projectId: string, selection: WorkspaceSelection): string {
  const params = new URLSearchParams({ selection: `${selection.kind}:${selection.id}` });
  if ("sourceId" in selection) params.set("source", selection.sourceId);
  return `/${encodeURIComponent(locale)}/projects/${encodeURIComponent(projectId)}/workspace?${params}`;
}

/* ------------------------------------------------------------------ workflow groups */

export type WorkflowGroupId = "structure" | "electronic" | "spectroscopy" | "evidence" | "analysis" | "other";

export const WORKFLOW_GROUP_LABEL: Record<WorkflowGroupId, string> = {
  structure: "Structure and geometry",
  electronic: "Electronic structure and energy",
  spectroscopy: "Spectroscopy",
  evidence: "Scientific evidence",
  analysis: "Analysis and comparison",
  other: "Other workflows",
};

const GROUP_ORDER: WorkflowGroupId[] = ["structure", "electronic", "spectroscopy", "evidence", "analysis", "other"];

/** Presentation grouping by the server's stable action id. It never decides availability. */
export function workflowGroup(actionId: string): WorkflowGroupId {
  if (actionId.startsWith("structure.") || actionId === "calculation.optimize") return "structure";
  if (actionId.startsWith("calculation.") || actionId.startsWith("electronic.") || actionId.startsWith("thermochemistry.")) return "electronic";
  if (actionId === "spectra.compare" || actionId === "jobs.review") return "analysis";
  if (actionId.startsWith("spectra.")) return "spectroscopy";
  if (actionId.startsWith("evidence.")) return "evidence";
  return "other";
}

export type WorkflowGroup = {
  id: WorkflowGroupId;
  label: string;
  available: Array<{ action: NavigatorAction; href: string | null }>;
  blocked: NavigatorAction[];
};

/** Server order is kept inside each group; the recommended action is shown in its own bar and left out here. */
export function groupWorkflows(
  entries: ReadonlyArray<{ action: NavigatorAction; href: string | null }>,
  blocked: readonly NavigatorAction[],
  recommendedId: string | null,
): WorkflowGroup[] {
  const groups = new Map<WorkflowGroupId, WorkflowGroup>();
  const group = (id: WorkflowGroupId): WorkflowGroup => {
    let existing = groups.get(id);
    if (!existing) { existing = { id, label: WORKFLOW_GROUP_LABEL[id], available: [], blocked: [] }; groups.set(id, existing); }
    return existing;
  };
  for (const entry of entries) if (entry.action.action_id !== recommendedId) group(workflowGroup(entry.action.action_id)).available.push(entry);
  for (const action of blocked) group(workflowGroup(action.action_id)).blocked.push(action);
  return GROUP_ORDER.flatMap((id) => (groups.has(id) ? [groups.get(id)!] : []));
}

/* ------------------------------------------------------------------ scientific readiness */

export type ReadinessTone = "ok" | "missing" | "info" | "attention" | "failed";
export type ReadinessRow = { id: string; label: string; value: string; tone: ReadinessTone };

export type ReadinessInput = {
  state: Pick<NavigatorState, "goal" | "have" | "blocked" | "facts_summary"> | null;
  /** Catalogue tallies; null until the project catalogue has loaded (rows that need it are then omitted, not guessed). */
  counts: OverviewCounts | null;
};

/**
 * Only what changes the researcher's next move and is not already shown elsewhere: counts live in the summary strip,
 * formula / charge / multiplicity / version / provenance / review state in the structure panel, calculations in
 * Results & provenance.
 * A prerequisite row appears as "ok" only when every recorded fact it covers is present.
 */
export function readinessRows(input: ReadinessInput): ReadinessRow[] {
  const { state, counts } = input;
  if (!state) return [];
  const facts = state.facts_summary;
  const rows: ReadinessRow[] = [];
  if (!facts.structure_version_id) {
    rows.push({ id: "structure", label: "Structure", value: "None saved", tone: "missing" });
  } else {
    const missing = [
      facts.charge == null || facts.multiplicity == null ? "charge and multiplicity" : null,
      state.have.some((item) => item.state_id === "provenance.available") ? null : "source provenance",
    ].filter((item): item is string => item !== null);
    rows.push(missing.length
      ? { id: "prerequisites", label: "Structure prerequisites", value: `${missing.join(" and ")} not recorded`, tone: "attention" }
      : { id: "prerequisites", label: "Structure prerequisites", value: "Charge, multiplicity and provenance recorded", tone: "ok" });
  }
  if (counts?.structures.candidates) rows.push({ id: "candidates", label: "Review required", value: `${plural(counts.structures.candidates, "structure candidate")} awaiting review`, tone: "attention" });
  return rows;
}

export type Restriction = { kind: ReasonKind; label: string; count: number; sentence: string; actions: NavigatorAction[] };

const RESTRICTION_SENTENCE: Record<ReasonKind, (count: number) => string> = {
  capability: (n) => `${plural(n, "workflow")} unavailable with the current worker`,
  method: (n) => `${plural(n, "workflow")} use a method that is not supported`,
  scientific: (n) => `${plural(n, "workflow")} need a scientific prerequisite`,
  project: (n) => `${plural(n, "workflow")} need records the project does not hold yet`,
  access: (n) => `${plural(n, "workflow")} need different access`,
  other: (n) => `${plural(n, "workflow")} have other prerequisites`,
};

/** One concise line per kind of restriction; an action blocked for several reasons is listed under each kind. */
export function restrictionSummary(blocked: readonly NavigatorAction[]): Restriction[] {
  return KIND_ORDER.flatMap((kind) => {
    const actions = blocked.filter((action) => blockedKinds(action).includes(kind));
    return actions.length ? [{ kind, label: REASON_KIND_LABEL[kind], count: actions.length, sentence: RESTRICTION_SENTENCE[kind](actions.length), actions }] : [];
  });
}

export type ProjectStatus = { tone: "missing" | "info" | "ok" | "attention"; text: string };

/** A one-line scientific status derived from recorded counts only; failed and published records are reported separately. */
export function projectStatus(input: { hasStructure: boolean; failed: number; running: number; published: number; ready: boolean }): ProjectStatus | null {
  if (!input.ready) return null;
  if (!input.hasStructure) return { tone: "missing", text: "No saved structure" };
  const parts = [
    input.published ? `${plural(input.published, "result")} published` : null,
    input.failed ? `${plural(input.failed, "calculation")} failed` : null,
    input.running ? `${plural(input.running, "calculation")} running` : null,
  ].filter((part): part is string => part !== null);
  if (!parts.length) return { tone: "info", text: "Structure saved · no calculations" };
  return { tone: input.failed ? "attention" : "ok", text: parts.join(" · ") };
}

/* ------------------------------------------------------------------ results and provenance */

export type ResultListRow = {
  key: string;
  kind: "result" | "failed" | "pending";
  task: string;
  headline: { text: string; label: string } | null;
  engine: string;
  level: string;
  structure: string | null;
  standing: string;
  verification: string;
  state: string;
  failure: string | null;
  calculationId: string;
  resultId: string | null;
  structureVersionId: string | null;
  structureId: string | null;
  updatedAt: string;
};

/**
 * Newest calculation records from the server's research overview, with the server's own standing and verification
 * wording. A failed calculation is its own row: it never changes the standing of another calculation's result.
 */
export function resultListRows(rows: readonly OverviewRow[], limit = 4): ResultListRow[] {
  return [...rows]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.calculation_id.localeCompare(b.calculation_id))
    .slice(0, limit)
    .map((row) => {
      const model = resultContextModel(row);
      const failed = row.calculation_state === "FAILED" || row.job_state === "FAILED";
      return {
        key: row.calculation_id,
        kind: row.result_id ? "result" as const : failed ? "failed" as const : "pending" as const,
        task: model.task,
        headline: model.quantity,
        engine: model.engine,
        level: model.level,
        structure: model.structure,
        standing: standingText(row),
        verification: model.verification,
        state: model.state,
        failure: model.failure,
        calculationId: row.calculation_id,
        resultId: row.result_id ?? null,
        structureVersionId: row.structure_version_id ?? null,
        structureId: row.structure_id ?? null,
        updatedAt: row.updated_at,
      };
    });
}

/* ------------------------------------------------------------------ continue your research */

/** Actions the structure card already offers (when they are available and not the recommendation). */
export const STRUCTURE_CARD_ACTIONS = ["structure.inspect", "structure.edit"] as const;

export const CONTINUE_LIMIT = 4;

export type ContinuePlan = {
  recommendedId: string | null;
  /** Available actions with a real destination, listed under "Continue your research" (server order, at most CONTINUE_LIMIT). */
  listed: ResolvedAction[];
  /** Actions shown on the structure card instead of the list (Inspect / Edit structure). */
  onStructureCard: string[];
  /** Available actions that appear only under "Browse all workflows". */
  hidden: number;
  /** Every available action the server returned for the current goal (recommended included). */
  total: number;
};

/**
 * One prioritised recommendation, a handful of contextual next steps, and everything else behind "Browse all
 * workflows". Server order and eligibility are untouched; this only decides where an available action is shown, so
 * that no action is repeated between the recommendation, the structure card and the list.
 */
export function planContinue(next: readonly NavigatorAction[], hrefFor: (action: NavigatorAction) => string | null): ContinuePlan {
  const split = splitActions(next, hrefFor);
  const recommendedId = split.recommended?.action.action_id ?? null;
  const onStructureCard = split.others.map((entry) => entry.action.action_id).filter((id) => (STRUCTURE_CARD_ACTIONS as readonly string[]).includes(id));
  const candidates = split.others.filter((entry) => !(STRUCTURE_CARD_ACTIONS as readonly string[]).includes(entry.action.action_id));
  const listed = candidates.slice(0, CONTINUE_LIMIT);
  const placed = (recommendedId ? 1 : 0) + onStructureCard.length + listed.length;
  return { recommendedId, listed, onStructureCard, hidden: Math.max(0, next.length - placed), total: next.length };
}

/** "5 available: 1 recommended, 1 on the structure card, 3 listed here" — every available action accounted for once. */
export function reconcileCaption(plan: ContinuePlan): string {
  if (plan.total === 0) return "No workflows are available with the current prerequisites.";
  const parts = [
    plan.recommendedId ? "1 recommended" : null,
    plan.onStructureCard.length ? `${plan.onStructureCard.length} on the structure card` : null,
    plan.listed.length ? `${plan.listed.length} listed here` : null,
    plan.hidden ? `${plan.hidden} more under Browse all workflows` : null,
  ].filter((part): part is string => part !== null);
  return `${plan.total} available: ${parts.join(", ")}`;
}

/* ------------------------------------------------------------------ formulas for molecules and crystals */

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function elementCounts(elements: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);
  return counts;
}

/** Hill ordering (C, then H, then alphabetical; alphabetical when there is no carbon). */
export function formulaFromCounts(counts: ReadonlyMap<string, number>): string {
  const order = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const ranked = counts.has("C") ? ["C", ...(counts.has("H") ? ["H"] : []), ...order.filter((e) => e !== "C" && e !== "H")] : order;
  return ranked.map((element) => `${element}${counts.get(element)! > 1 ? counts.get(element) : ""}`).join("");
}

/**
 * For a periodic structure: the composition of the stored cell and, when it is a whole multiple of a smaller formula
 * unit, the reduced formula. Both are arithmetic on the stored sites; nothing is looked up or assumed.
 */
export function crystalFormulas(elements: readonly string[]): { cell: string; reduced: string | null; atoms: number } {
  const counts = elementCounts(elements);
  const divisor = [...counts.values()].reduce((a, b) => gcd(a, b), 0);
  const cell = formulaFromCounts(counts);
  if (divisor <= 1) return { cell, reduced: null, atoms: elements.length };
  const reduced = formulaFromCounts(new Map([...counts].map(([element, n]) => [element, n / divisor])));
  return { cell, reduced, atoms: elements.length };
}
