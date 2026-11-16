import type { AIRunEventView, AIRunView, CalculationDetail, ResearcherGateView } from "@chemdft/schemas";
import type { WorkspaceSelection } from "./workspace-selection";
import { describeScientificState } from "./scientific-state";
import { selectedPublishedResult } from "./calculation-result-association";

export const SCIENTIFIC_EVENT_LABELS: Record<string, string> = {
  "document.figures_extracted": "PDF figures extracted",
  "candidate.diagram_recognized": "Molecular recognition proposal saved · unverified",
  "candidate.graph_validated": "Molecular graph validation recorded · not scientific verification",
  "researcher_gate.requested": "Researcher verification required",
  "researcher_gate.cleared": "Backend verified researcher promotion",
  "approval.approved": "Human approved exact calculation parameters",
  "calculation.queued": "Approved calculation queued",
  "calculation.result_available": "Validated engine result retrieved",
  "calculation.failed": "Calculation or result retrieval failed",
  "calculation.canceled": "Calculation canceled",
};

/** Never merge events belonging to another run or project. Sequence is the durable identity. */
export function mergeRunEvents(previous: AIRunEventView[], incoming: AIRunEventView[], projectId: string, runId: string) {
  const rows = new Map<number, AIRunEventView>();
  for (const event of [...previous, ...incoming]) {
    if (event.run_id === runId && event.project_id === projectId && Number.isInteger(event.sequence) && event.sequence > 0) rows.set(event.sequence, event);
  }
  return [...rows.values()].sort((a, b) => a.sequence - b.sequence);
}

/** Stop at the first gap so reconnects replay missing context rather than skipping it. */
export function contiguousEventSequence(events: AIRunEventView[]) {
  let cursor = 0;
  for (const event of events) { if (event.sequence !== cursor + 1) break; cursor = event.sequence; }
  return cursor;
}

export function researcherGateSelection(projectId: string, gate: ResearcherGateView): WorkspaceSelection {
  return { kind: "candidateRepresentation", projectId, id: gate.expected_representation_id, sourceId: gate.candidate_id };
}

/** The researcher rejected this run's proposal (persisted APPROVAL_REQUEST step), so nothing was submitted. */
export function runProposalRejected(run: AIRunView): boolean {
  return (run.steps ?? []).some((step) => step.step_type === "APPROVAL_REQUEST" && step.status === "REJECTED");
}

export function scientificWorkflowPhase(run: AIRunView, calculation?: CalculationDetail | null): string {
  if (run.status === "CANCELED") return "Canceled";
  if (run.status === "FAILED") return "Failed";
  if (run.status === "PAUSED") return run.pending_researcher_gate ? "Researcher verification required · waiting for structure approval" : "Run paused";
  if (run.status === "WAITING_FOR_APPROVAL") return run.pending_approval?.tool_name === "calculation.submit" ? "Calculation approval required" : run.pending_approval?.tool_name === "structure.edit.propose" ? "Structure edit approval required" : "Action approval required";
  if (run.status === "WAITING_FOR_CALCULATION" && calculation) return calculationPhase(calculation);
  if (run.status === "WAITING_FOR_CALCULATION") return "Calculation submitted · retrieving execution status";
  if (run.status === "SUCCEEDED" && runProposalRejected(run) && !run.waiting_calculation_id) return "Proposal rejected · nothing submitted";
  if (run.status === "SUCCEEDED") return "Completed";
  const tool = [...(run.steps ?? [])].reverse().find(step => step.status === "RUNNING")?.tool_name;
  const phases: Record<string, string> = {
    "knowledge.search": "Evidence retrieval", "document.get": "Evidence retrieval", "document.evidence.list": "Evidence retrieval",
    "document.figures.extract": "PDF figure extraction",
    "structure_candidate.recognize": "Molecular recognition",
    "structure_candidate.validate_graph": "Molecular validation",
    "structure_candidate.request_review": "Requesting researcher review",
    "navigator.get": "Calculation planning", "calculation.submit": "Submitting approved calculation",
    "structure.edit.propose": "Proposing structure edit",
  };
  return (tool && phases[tool]) || (run.status === "PLANNING" ? "Planning" : "Workflow executing");
}

export function calculationPhase(detail: CalculationDetail) {
  const state = detail.calculation.state;
  if (["QUEUED", "PENDING", "CREATED"].includes(state)) return "Calculation queued";
  if (["RUNNING", "EXECUTING"].includes(state)) return "Calculation running";
  if (["COMPLETED", "SUCCEEDED"].includes(state)) return "Calculation completed";
  if (state === "FAILED") return "Calculation failed";
  if (["CANCELED", "CANCELLED"].includes(state)) return "Calculation canceled";
  return `Calculation: ${state}`;
}

/** Label for coordinates, derived only from the accepted version's recorded provenance. */
export function coordinateOriginLabel(origin: string | null | undefined): string {
  if (!origin) return "Coordinate origin unavailable";
  if (origin === "GENERATED_CONFORMER") return "GENERATED CONFORMER — NOT QM OPTIMIZED";
  return `Coordinate origin: ${origin} (researcher-declared; not verified by ChemDFT)`;
}

export function scientificResultProvenance(detail: CalculationDetail) {
  return detail.result ? `Result available · persisted engine record ${detail.result.id} · ${describeScientificState(detail.result).headline}` : "No persisted engine result available";
}

/** Fail closed on identity, current scientific authority and the published payload schema. */
export function scientificCalculationEnergy(detail: CalculationDetail, projectId: string, calculationId: string) {
  const result = detail.result;
  const spec = detail.specification;
  if (!result || detail.calculation.project_id !== projectId || result.project_id !== projectId ||
      !selectedPublishedResult(detail, calculationId, result.id) || detail.calculation.state !== "SUCCEEDED" ||
      detail.compute_job?.state !== "SUCCEEDED" || !describeScientificState(result).currentlyAuthoritative ||
      result.source_class !== "CALCULATED" || result.result_type !== "chemdft.energy" ||
      !("engine_preference" in spec) || spec.task_type !== "ENERGY" ||
      result.producer_software.name !== spec.engine_preference.engine || !result.producer_software.version) return null;
  const payload = result.payload;
  if (payload.payload_schema !== "chemdft.energy" || !("total_energy" in payload) ||
      payload.converged !== true || !Number.isFinite(payload.total_energy.value) ||
      payload.total_energy.unit.code !== "Eh" || payload.total_energy.unit.dimension !== "ENERGY" ||
      payload.method !== spec.method.identifier.toLowerCase() ||
      payload.basis !== (spec.basis?.identifier.toLowerCase() ?? null)) return null;
  return payload;
}

/** Backend SQLite datetimes are UTC, including ISO strings without an offset. */
export function aiTimestamp(value: string): number {
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return Date.parse(zoned ? value : `${value}Z`);
}
