import type {
  CalculationComparisonOutput,
  CalculationExportCatalog,
  ComparisonCandidateListOutput,
  JobDiagnostics,
  JobLogOutput,
} from "@chemdft/schemas";

import { type Attachment, readAttachment } from "./download";
import { apiError, apiJson, apiUrl, readJson } from "./structure-workspace-api";

export type ExportFormatKey = CalculationExportCatalog["formats"][number]["format"];

export function getExportCatalog(projectId: string, calculationId: string): Promise<CalculationExportCatalog> {
  return apiJson<CalculationExportCatalog>(`/v1/projects/${projectId}/calculations/${calculationId}/exports`);
}

export async function downloadCalculationExport(params: {
  projectId: string;
  calculationId: string;
  format: ExportFormatKey;
  variant?: string | undefined;
}): Promise<Attachment> {
  const query = new URLSearchParams({ format: params.format });
  if (params.variant) query.set("variant", params.variant);
  const response = await fetch(
    apiUrl(`/v1/projects/${params.projectId}/calculations/${params.calculationId}/export?${query.toString()}`),
    { cache: "no-store" },
  );
  return readAttachment(response, `chemdft-${params.format}`, apiError);
}

function resultQuery(resultIds: readonly string[], extra: Record<string, string> = {}): string {
  const query = new URLSearchParams();
  for (const id of resultIds) query.append("result_id", id);
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return query.toString();
}

export function listComparisonCandidates(projectId: string): Promise<ComparisonCandidateListOutput> {
  return apiJson<ComparisonCandidateListOutput>(`/v1/projects/${projectId}/calculation-comparison/candidates`);
}

/** `signal` lets the Compare workstation abandon a request the researcher's next selection has made stale. */
export async function compareCalculations(projectId: string, resultIds: readonly string[], signal?: AbortSignal): Promise<CalculationComparisonOutput> {
  if (!signal) return apiJson<CalculationComparisonOutput>(`/v1/projects/${projectId}/calculation-comparison?${resultQuery(resultIds)}`);
  const response = await fetch(apiUrl(`/v1/projects/${projectId}/calculation-comparison?${resultQuery(resultIds)}`), { cache: "no-store", signal });
  return readJson<CalculationComparisonOutput>(response);
}

export async function downloadComparison(params: {
  projectId: string;
  resultIds: readonly string[];
  format: "csv" | "json";
}): Promise<Attachment> {
  const response = await fetch(
    apiUrl(`/v1/projects/${params.projectId}/calculation-comparison/export?${resultQuery(params.resultIds, { format: params.format })}`),
    { cache: "no-store" },
  );
  return readAttachment(response, `calculation-comparison.${params.format}`, apiError);
}

export function getJobDiagnostics(projectId: string, jobId: string): Promise<JobDiagnostics> {
  return apiJson<JobDiagnostics>(`/v1/projects/${projectId}/compute/jobs/${jobId}/diagnostics`);
}

export function getJobLog(projectId: string, jobId: string, artifactId: string): Promise<JobLogOutput> {
  return apiJson<JobLogOutput>(`/v1/projects/${projectId}/compute/jobs/${jobId}/logs/${artifactId}`);
}
