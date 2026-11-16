import type { AIRunView, CalculationDetail } from "@chemdft/schemas";
import { aiTimestamp, runProposalRejected, scientificCalculationEnergy } from "./ai-scientist-workflow";
import { selectedPublishedResult } from "./calculation-result-association";
import { describeScientificState } from "./scientific-state";
import { aiErrorLabel, basisLabel, engineLabel as engineName, methodLabel as methodName } from "./scientific-labels";
import { timestampDisplay } from "./timestamps";

/**
 * Runs-tab model built only from persisted records. AI planning runs and scientific calculation
 * jobs stay distinct; nothing here estimates progress or supplies method/engine defaults.
 */
export type RunTimelinePhase =
  | "AI_PLANNING"
  | "AWAITING_APPROVAL"
  | "PAUSED"
  | "WAITING_FOR_CALCULATION"
  | "PLANNING_COMPLETE"
  | "DRAFT"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "VALIDATED_RESULT"
  | "FAILED"
  | "CANCELED"
  | "LOADING";

export type RunFilter = "All" | "Active" | "Completed" | "Failed" | "Planning";

export const RUN_PHASE_LABEL: Record<RunTimelinePhase, string> = {
  AI_PLANNING: "AI planning",
  AWAITING_APPROVAL: "Awaiting approval",
  PAUSED: "Paused",
  WAITING_FOR_CALCULATION: "Waiting for calculation",
  PLANNING_COMPLETE: "Planning complete",
  DRAFT: "Draft",
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Completed",
  VALIDATED_RESULT: "Validated result",
  FAILED: "Failed",
  CANCELED: "Canceled",
  LOADING: "Loading record",
};

export interface RunTimelineItem {
  key: string;
  kind: "CALCULATION" | "AI_RUN";
  id: string;
  phase: RunTimelinePhase;
  title: string;
  /** Engine/method/basis only when recorded; otherwise null (never a default). */
  engine: string | null;
  method: string | null;
  timestamp: number | null;
  timestampLabel: string | null;
  /** Firewall-checked total energy text, e.g. "-1.116759 Eh". */
  energyText: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  calculationId: string | null;
  linkedCalculationId: string | null;
  aiRunId: string | null;
  model: string | null;
}

const ACTIVE_CALCULATION_STATES = new Set(["DRAFT", "VALIDATED", "AUTHORIZED", "QUEUED", "RUNNING"]);
const ACTIVE_JOB_STATES = new Set(["PENDING", "READY", "LEASED", "RUNNING", "CANCEL_REQUESTED"]);

/** True while a recorded calculation may still change state and is worth re-reading. */
export function calculationNeedsPolling(detail: CalculationDetail | undefined): boolean {
  if (!detail) return true;
  // A record without its calculation row cannot change state; polling it forever would only repeat the same read.
  if (!detail.calculation) return false;
  if (ACTIVE_CALCULATION_STATES.has(detail.calculation.state)) return true;
  return Boolean(detail.compute_job && ACTIVE_JOB_STATES.has(detail.compute_job.state));
}

/** Same fail-closed identity/authority checks as the energy gate, for any result type. */
export function authoritativeCalculationResult(detail: CalculationDetail, projectId: string, calculationId: string) {
  const result = detail.result;
  if (!result || detail.calculation.project_id !== projectId || result.project_id !== projectId ||
      !selectedPublishedResult(detail, calculationId, result.id) || detail.calculation.state !== "SUCCEEDED" ||
      detail.compute_job?.state !== "SUCCEEDED" || result.source_class !== "CALCULATED" ||
      !describeScientificState(result).currentlyAuthoritative) return null;
  return result;
}

function methodLabel(detail: CalculationDetail | undefined): string | null {
  const spec = detail?.specification;
  if (!spec || !("method" in spec) || !spec.method?.identifier) return null;
  return spec.basis?.identifier ? `${methodName(spec.method.identifier)} / ${basisLabel(spec.basis.identifier)}` : methodName(spec.method.identifier);
}

function engineLabel(detail: CalculationDetail | undefined): string | null {
  const producer = detail?.result?.producer_software;
  if (producer?.name) return producer.version ? `${engineName(producer.name)} ${producer.version}` : engineName(producer.name);
  const spec = detail?.specification;
  if (spec && "engine_preference" in spec && spec.engine_preference?.engine) return engineName(String(spec.engine_preference.engine));
  return null;
}

function stamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = aiTimestamp(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Same formatter as ScientificTimestamp (local time with its UTC offset), from the stored instant.
function formatStamp(value: number | null, verb: string): string | null {
  if (value === null) return null;
  const display = timestampDisplay(new Date(value).toISOString());
  return display ? `${verb} ${display.local}` : null;
}

function calculationItem(id: string, label: string | null, detail: CalculationDetail | undefined, projectId: string): RunTimelineItem {
  const base = {
    key: `calculation:${id}`, kind: "CALCULATION" as const, id, title: label || `Calculation ${id.slice(0, 8)}`,
    engine: engineLabel(detail), method: methodLabel(detail), calculationId: id, linkedCalculationId: null,
    aiRunId: null, model: null, energyText: null, resultSummary: null, errorMessage: null,
  };
  if (!detail) return { ...base, phase: "LOADING", timestamp: null, timestampLabel: null };
  const state = detail.calculation.state;
  const created = stamp(detail.calculation.created_at);
  const updated = stamp(detail.calculation.updated_at) ?? created;
  const failure = detail.attempt?.diagnostic ? String(detail.attempt.diagnostic) : detail.attempt?.failure_code ?? null;
  if (state === "SUCCEEDED") {
    const result = authoritativeCalculationResult(detail, projectId, id);
    const energy = scientificCalculationEnergy(detail, projectId, id);
    return {
      ...base,
      phase: result ? "VALIDATED_RESULT" : "COMPLETED",
      timestamp: created, timestampLabel: formatStamp(updated, "Completed"),
      energyText: energy ? `${energy.total_energy.value} ${energy.total_energy.unit.code}` : null,
      resultSummary: result
        ? energy ? null : `Validated ${result.result_type} result — no total energy for this result type`
        : detail.result ? "Result recorded but not currently authoritative — inspect provenance" : "No persisted result record",
    };
  }
  if (state === "FAILED") return { ...base, phase: "FAILED", timestamp: created, timestampLabel: formatStamp(updated, "Failed"), errorMessage: failure };
  if (state === "CANCELED") return { ...base, phase: "CANCELED", timestamp: created, timestampLabel: formatStamp(updated, "Canceled") };
  if (state === "RUNNING") return { ...base, phase: "RUNNING", timestamp: created, timestampLabel: formatStamp(created, "Created") };
  if (state === "QUEUED" || state === "AUTHORIZED") return { ...base, phase: "QUEUED", timestamp: created, timestampLabel: formatStamp(created, "Queued") };
  return { ...base, phase: "DRAFT", timestamp: created, timestampLabel: formatStamp(created, "Created") };
}

function aiRunPhase(run: AIRunView): RunTimelinePhase {
  switch (run.status) {
    case "WAITING_FOR_APPROVAL": return "AWAITING_APPROVAL";
    case "PAUSED": return "PAUSED";
    case "WAITING_FOR_CALCULATION": return "WAITING_FOR_CALCULATION";
    case "SUCCEEDED": return "PLANNING_COMPLETE";
    case "FAILED": return "FAILED";
    case "CANCELED": return "CANCELED";
    default: return "AI_PLANNING";
  }
}

function aiRunItem(run: AIRunView): RunTimelineItem {
  const phase = aiRunPhase(run);
  const created = stamp(run.created_at);
  const updated = stamp(run.updated_at) ?? created;
  return {
    key: `ai-run:${run.id}`, kind: "AI_RUN", id: run.id, phase,
    title: `AI Scientist run ${run.id.slice(0, 8)}`,
    engine: null, method: null, timestamp: created,
    timestampLabel: phase === "AI_PLANNING" || phase === "AWAITING_APPROVAL" || phase === "PAUSED" || phase === "WAITING_FOR_CALCULATION"
      ? formatStamp(created, "Started") : formatStamp(updated, RUN_PHASE_LABEL[phase]),
    energyText: null,
    resultSummary: phase === "PLANNING_COMPLETE"
      ? run.waiting_calculation_id ? "Planning complete — see the linked calculation record"
        : runProposalRejected(run) ? "Proposal rejected by you — nothing was submitted" : "Planning complete — no calculation submitted"
      : phase === "AWAITING_APPROVAL" ? "A proposed action is waiting for your decision in Chat" : null,
    errorMessage: phase === "FAILED" ? run.error_detail || (run.error_code ? `${aiErrorLabel(run.error_code)} (${run.error_code})` : null) : null,
    calculationId: null, linkedCalculationId: run.waiting_calculation_id ?? null, aiRunId: run.id,
    model: run.ai_model ?? null,
  };
}

/**
 * One item per calculation record and one per AI run. A calculation submitted by an AI run is
 * shown once, as a calculation; the run stays visible as the planning record that links to it.
 * Ordered newest first by persisted creation time; records not yet read sort last.
 */
export function buildRunTimeline(input: {
  projectId: string;
  catalogCalculations: Array<{ id: string; label?: string | null }>;
  calculationDetails: Record<string, CalculationDetail | undefined>;
  aiRuns: AIRunView[];
}): RunTimelineItem[] {
  const labels = new Map<string, string | null>();
  for (const entry of input.catalogCalculations) labels.set(entry.id, entry.label ?? null);
  const runs = new Map<string, AIRunView>();
  for (const run of input.aiRuns) if (run.project_id === input.projectId) runs.set(run.id, run);
  for (const run of runs.values()) if (run.waiting_calculation_id && !labels.has(run.waiting_calculation_id)) labels.set(run.waiting_calculation_id, null);
  const items: RunTimelineItem[] = [];
  for (const [id, label] of labels) {
    const detail = input.calculationDetails[id];
    if (detail && detail.calculation.project_id !== input.projectId) continue;
    items.push(calculationItem(id, label, detail, input.projectId));
  }
  for (const run of runs.values()) items.push(aiRunItem(run));
  return items.sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity) || a.key.localeCompare(b.key));
}

export function runMatchesFilter(item: RunTimelineItem, filter: RunFilter): boolean {
  switch (filter) {
    case "Active": return ["QUEUED", "RUNNING", "WAITING_FOR_CALCULATION", "AI_PLANNING", "AWAITING_APPROVAL", "PAUSED"].includes(item.phase);
    case "Completed": return item.phase === "COMPLETED" || item.phase === "VALIDATED_RESULT";
    case "Failed": return item.phase === "FAILED" || item.phase === "CANCELED";
    case "Planning": return item.kind === "AI_RUN";
    default: return true;
  }
}
