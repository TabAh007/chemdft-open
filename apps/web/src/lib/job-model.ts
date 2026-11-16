import type { ComputeJobView } from "@chemdft/schemas";

import { describeSpecification, describeWorkload, jobPhase, providerLabel } from "./job-view";

/** Library state of the Jobs page: filtering, counting, search and the URL. Pure; nothing is fetched or computed here. */

export type JobFilter = "all" | "active" | "succeeded" | "failed" | "canceled";

export const JOB_FILTERS: readonly { key: JobFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Queued or running" },
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed or lost" },
  { key: "canceled", label: "Canceled" },
];

export const PAGE_SIZE = 100;

export type JobsQuery = { job: string | null; filter: JobFilter; provider: string | null; q: string };

export const EMPTY_QUERY: JobsQuery = { job: null, filter: "all", provider: null, q: "" };

const FILTER_KEYS = new Set<string>(JOB_FILTERS.map((entry) => entry.key));

export function parseJobsQuery(search: string): JobsQuery {
  const params = new URLSearchParams(search);
  const filter = params.get("state") ?? "all";
  return {
    job: params.get("job") || null,
    filter: FILTER_KEYS.has(filter) ? (filter as JobFilter) : "all",
    provider: params.get("provider") || null,
    q: params.get("q") ?? "",
  };
}

/** `""` for the default view, otherwise `?…` with only the non-default parts. */
export function serializeJobsQuery(query: JobsQuery): string {
  const params = new URLSearchParams();
  if (query.job) params.set("job", query.job);
  if (query.filter !== "all") params.set("state", query.filter);
  if (query.provider) params.set("provider", query.provider);
  if (query.q.trim()) params.set("q", query.q.trim());
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function matchesFilter(job: Pick<ComputeJobView, "state" | "latest_execution">, filter: JobFilter): boolean {
  const phase = jobPhase(job);
  if (filter === "all") return true;
  if (filter === "active") return phase.active;
  if (filter === "failed") return phase.key === "failed" || phase.key === "lost";
  return phase.key === filter;
}

export function filterCounts(jobs: readonly ComputeJobView[]): Record<JobFilter, number> {
  const counts: Record<JobFilter, number> = { all: jobs.length, active: 0, succeeded: 0, failed: 0, canceled: 0 };
  for (const job of jobs) {
    for (const entry of JOB_FILTERS) if (entry.key !== "all" && matchesFilter(job, entry.key)) counts[entry.key] += 1;
  }
  return counts;
}

export function providersIn(jobs: readonly ComputeJobView[]): string[] {
  return [...new Set(jobs.map((job) => job.provider))].sort();
}

/** Everything a researcher might type to find a job: structure, formula, task, engine, level of theory, ids, provider. */
export function searchText(job: ComputeJobView): string {
  const workload = describeWorkload(job.workload.workload_type);
  const structure = job.structure_summary;
  return [
    structure?.structure_name, structure?.formula_hill, workload.task, workload.engine,
    describeSpecification(job.specification_summary), providerLabel(job.provider), job.id, job.calculation_id,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function filterJobs(jobs: readonly ComputeJobView[], query: Pick<JobsQuery, "filter" | "provider" | "q">): ComputeJobView[] {
  const needle = query.q.trim().toLowerCase();
  return jobs.filter((job) => (
    matchesFilter(job, query.filter)
    && (!query.provider || job.provider === query.provider)
    && (!needle || searchText(job).includes(needle))
  ));
}

/** The job the inspector shows when the URL names none: the newest active job, else the newest job. */
export function defaultJobId(jobs: readonly ComputeJobView[]): string | null {
  return (jobs.find((job) => jobPhase(job).active) ?? jobs[0])?.id ?? null;
}
