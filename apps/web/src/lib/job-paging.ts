import type { ComputeJobView } from "@chemdft/schemas";

import type { JobFilter, JobsQuery } from "./job-model";

/** Server paging for the Jobs library (0.0.18). Older servers ignore the parameters and send no `total`: the page then keeps filtering client-side. */

export const SERVER_PAGE = 200;

export type ServerJobsFilter = { phase: JobFilter; provider: string | null; q: string };

export function serverFilterOf(query: Pick<JobsQuery, "filter" | "provider" | "q">): ServerJobsFilter {
  return { phase: query.filter, provider: query.provider, q: query.q.trim() };
}

export function serverFilterKey(filter: ServerJobsFilter): string {
  return `${filter.phase}|${filter.provider ?? ""}|${filter.q}`;
}

/** Query string for the list route; only non-default parts are sent, so an old server sees the plain request plus harmless extras. */
export function jobsListSearch(params: { limit: number; offset: number } & ServerJobsFilter): string {
  const search = new URLSearchParams();
  search.set("limit", String(params.limit));
  if (params.offset > 0) search.set("offset", String(params.offset));
  if (params.phase !== "all") search.set("phase", params.phase);
  if (params.provider) search.set("provider", params.provider);
  if (params.q) search.set("q", params.q);
  return `?${search.toString()}`;
}

/** The server announces paging by sending a numeric `total`. */
export function supportsServerPaging<T extends { total?: number | null }>(response: T): response is T & { total: number } {
  return typeof response.total === "number";
}

/** Append a further page, dropping any job already held (a page can overlap after a refresh). Order is kept: the server's. */
export function appendJobs(held: readonly ComputeJobView[], incoming: readonly ComputeJobView[]): ComputeJobView[] {
  const seen = new Set(held.map((job) => job.id));
  return [...held, ...incoming.filter((job) => !seen.has(job.id))];
}

/** How many jobs a refresh asks for, so a poll keeps every page the researcher already loaded. */
export function refreshLimit(loaded: number): number {
  return Math.max(SERVER_PAGE, Math.ceil(loaded / SERVER_PAGE) * SERVER_PAGE);
}
