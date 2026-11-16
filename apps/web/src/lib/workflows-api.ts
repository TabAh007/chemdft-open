import type {
  CalculationDetail,
  CalculationSubmitInput,
  PublishedResultsPage,
  QueueStatus,
  ResearchOverview,
  ReusePlan,
  SavedComparisonListOutput,
  SavedComparisonOpenOutput,
  SavedComparisonSummary,
} from "@chemdft/schemas";

import { type Attachment, readAttachment } from "./download";
import { apiError, apiJson, apiUrl, readJson, submitCalculation } from "./structure-workspace-api";

export type ReportFormat = "html" | "markdown" | "json";

export function getResearchOverview(projectId: string): Promise<ResearchOverview> {
  return apiJson<ResearchOverview>(`/v1/projects/${projectId}/research-overview`);
}

export type PublishedResultsQuery = {
  limit?: number;
  cursor?: string | null;
  task?: string | null;
  engine?: string | null;
  standing?: "current" | "historical" | null;
  text?: string | null;
  sort?: "updated" | "task" | "engine" | "formula" | "energy";
  direction?: "asc" | "desc";
  /** Restrict the page to these published results of the project (the server returns the ones that exist here). */
  resultIds?: readonly string[];
};

/** One page of the project's published results, filtered, sorted and counted by the server. */
export function listPublishedResults(projectId: string, query: PublishedResultsQuery = {}): Promise<PublishedResultsPage> {
  const params = new URLSearchParams();
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.task) params.set("task", query.task);
  if (query.engine) params.set("engine", query.engine);
  if (query.standing) params.set("standing", query.standing);
  if (query.text?.trim()) params.set("q", query.text.trim());
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  for (const id of query.resultIds ?? []) params.append("result_id", id);
  const suffix = params.toString();
  return apiJson<PublishedResultsPage>(`/v1/projects/${projectId}/published-results${suffix ? `?${suffix}` : ""}`);
}

export function listSavedComparisons(projectId: string): Promise<SavedComparisonListOutput> {
  return apiJson<SavedComparisonListOutput>(`/v1/projects/${projectId}/saved-comparisons`);
}

export async function createSavedComparison(params: {
  projectId: string;
  name: string;
  note?: string | undefined;
  resultIds: readonly string[];
}): Promise<SavedComparisonSummary> {
  const response = await fetch(apiUrl(`/v1/projects/${params.projectId}/saved-comparisons`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: params.name, note: params.note || null, result_ids: params.resultIds }),
  });
  return readJson<SavedComparisonSummary>(response);
}

/** Opening revalidates authorization, source identity and scientific state on the server. */
export function openSavedComparison(projectId: string, savedId: string): Promise<SavedComparisonOpenOutput> {
  return apiJson<SavedComparisonOpenOutput>(`/v1/projects/${projectId}/saved-comparisons/${encodeURIComponent(savedId)}`);
}

export async function archiveSavedComparison(projectId: string, savedId: string): Promise<SavedComparisonSummary> {
  const response = await fetch(
    apiUrl(`/v1/projects/${projectId}/saved-comparisons/${encodeURIComponent(savedId)}/archive`),
    { method: "POST" },
  );
  return readJson<SavedComparisonSummary>(response);
}

export async function downloadReport(params: {
  projectId: string;
  format: ReportFormat;
  resultIds?: readonly string[] | undefined;
  savedComparisonId?: string | undefined;
}): Promise<Attachment> {
  const query = new URLSearchParams({ format: params.format });
  for (const id of params.resultIds ?? []) query.append("result_id", id);
  if (params.savedComparisonId) query.set("saved_comparison_id", params.savedComparisonId);
  const response = await fetch(apiUrl(`/v1/projects/${params.projectId}/scientific-report?${query.toString()}`), { cache: "no-store" });
  return readAttachment(response, `chemdft-report.${params.format === "markdown" ? "md" : params.format}`, apiError);
}

export function getReusePlan(projectId: string, calculationId: string): Promise<ReusePlan> {
  return apiJson<ReusePlan>(`/v1/projects/${projectId}/calculations/${calculationId}/reuse-plan`);
}

/**
 * Creates a NEW calculation from a reuse plan through the ordinary submission route with a fresh
 * idempotency key; the source calculation is never touched.
 */
export function submitReuse(projectId: string, plan: ReusePlan): Promise<CalculationDetail> {
  const payload = reuseSubmission(projectId, plan, `reuse-${crypto.randomUUID()}`);
  return submitCalculation(projectId, payload);
}

export function reuseSubmission(projectId: string, plan: ReusePlan, idempotencyKey: string): CalculationSubmitInput {
  if (!plan.can_reuse || !plan.specification || !plan.structure_version_id) {
    throw new Error("This calculation's settings cannot be reused; resolve the failed checks first.");
  }
  return {
    structure_version: { project_id: projectId, entity_type: "structure.version", entity_id: plan.structure_version_id },
    specification: plan.specification as unknown as CalculationSubmitInput["specification"],
    provider_preference: "AUTO",
    idempotency_key: idempotencyKey,
  };
}

export function getQueueStatus(projectId: string): Promise<QueueStatus> {
  return apiJson<QueueStatus>(`/v1/projects/${projectId}/compute/queue-status`);
}
