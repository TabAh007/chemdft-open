import type { ComputeJobView, JobDiagnostics } from "@chemdft/schemas";
import type { Locale } from "@chemdft/i18n";
import { projectPath } from "./routes";
import { selectionKey } from "./workspace-selection";
import { parseUtc, formatTimestamp } from "./timestamps";
import { formatMinorUnits, type MinorUnitMoney } from "./money";
export { parseUtc, formatTimestamp } from "./timestamps";

/** Researcher-facing presentation of a compute job. Only fields the API reports are used. */

export const ENGINE_LABEL: Record<string, string> = { pyscf: "PySCF", psi4: "Psi4", xtb: "xTB", crest: "CREST", dftd4: "DFT-D4", qe: "Quantum ESPRESSO" };
const TASK_LABEL: Record<string, string> = {
  energy: "Single-point energy",
  optimization: "Geometry optimization",
  frequency: "Vibrational frequencies",
  tddft: "TDDFT excited states",
  orbital: "Molecular orbitals",
  thermochemistry: "Thermochemistry",
  "conformer-search": "Conformer search",
  correction: "D4 dispersion correction",
  "periodic-energy": "Periodic energy",
};

export function describeWorkload(workloadType: string): { engine: string; task: string; recognized: boolean } {
  const match = /^chemdft\.([a-z0-9]+)\.([a-z0-9-]+)\.v\d+$/.exec(workloadType);
  const engine = match?.[1];
  const task = match?.[2];
  if (engine === "qe" && task === "periodic-energy") {
    // Release 0.0.45: the title names the engine and the level of theory; it is never "Unrecognized engine".
    return { engine: ENGINE_LABEL.qe!, task: "Quantum ESPRESSO periodic energy (PBE+U)", recognized: true };
  }
  if (engine && task && ENGINE_LABEL[engine] && TASK_LABEL[task]) {
    return { engine: ENGINE_LABEL[engine], task: TASK_LABEL[task], recognized: true };
  }
  return { engine: "Unrecognized engine", task: workloadType, recognized: false };
}

export type JobPhase = {
  key: "queued" | "leased" | "running" | "cancelling" | "succeeded" | "failed" | "canceled" | "lost";
  label: string;
  intent: "none" | "primary" | "success" | "warning" | "danger";
  active: boolean;
};

export function jobPhase(job: Pick<ComputeJobView, "state" | "latest_execution">): JobPhase {
  const executionState = job.latest_execution?.state;
  if (executionState === "LOST" && !["SUCCEEDED", "CANCELED"].includes(job.state)) {
    return { key: "lost", label: "Execution lost", intent: "danger", active: !["FAILED"].includes(job.state) };
  }
  switch (job.state) {
    case "PENDING":
    case "READY": return { key: "queued", label: "Queued", intent: "none", active: true };
    case "LEASED": return { key: "leased", label: "Starting", intent: "primary", active: true };
    case "RUNNING": return { key: "running", label: "Running", intent: "primary", active: true };
    case "CANCEL_REQUESTED": return { key: "cancelling", label: "Cancelling", intent: "warning", active: true };
    case "SUCCEEDED": return { key: "succeeded", label: "Succeeded", intent: "success", active: false };
    case "FAILED": return { key: "failed", label: "Failed", intent: "danger", active: false };
    case "CANCELED": return { key: "canceled", label: "Canceled", intent: "warning", active: false };
    default: return { key: "failed", label: String(job.state), intent: "warning", active: false };
  }
}

/** Wall-clock runtime: metered when finished, otherwise elapsed since the execution started. */
export function jobRuntimeSeconds(job: Pick<ComputeJobView, "latest_execution">, nowMs: number): number | null {
  const execution = job.latest_execution;
  if (!execution) return null;
  const metered = execution.metering?.runtime_ms;
  if (typeof metered === "number" && metered >= 0) return metered / 1000;
  if (execution.started_at) {
    const start = parseUtc(execution.started_at);
    const end = execution.finished_at ? parseUtc(execution.finished_at) : nowMs;
    if (start !== null && end !== null && end >= start) return (end - start) / 1000;
  }
  return null;
}

export function formatRuntime(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes < 60 ? `${minutes} min ${rest} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * Plain-language wording for the three known hosted-run failures (release 0.0.45). The raw code and engine text stay in the
 * attempt record and in the downloadable engine log; this only explains them. Unknown failures are shown as reported.
 */
export function plainFailure(
  code: string | null | undefined,
  diagnostic: string | null | undefined,
  runtimeSeconds?: number | null,
): string | null {
  const text = diagnostic ?? "";
  // Release 0.0.46: the Quantum ESPRESSO result check against the engine log rejected the candidate.
  if (/Quantum ESPRESSO candidate energy contradicts the retained native log/i.test(text)) {
    return "The relaxed result could not be confirmed against the engine log; nothing was published. The raw engine log is available below.";
  }
  // Release 0.0.46: a hosted worker that dies within seconds with worker_error never started real work.
  if (/worker_error:/i.test(text) && runtimeSeconds != null && runtimeSeconds < 30) {
    const engine = /pyscf|libxc|periodic/i.test(text) ? "hosted periodic PySCF worker" : "hosted worker";
    return `The ${engine} failed to start, so nothing was published. The technical message is kept in the job diagnostic.`;
  }
  if (/AWS_SESSION_EXPIRING|not enough session time/i.test(text) || code === "AWS_SESSION_EXPIRING") {
    return "Not enough time is left in the AWS session for this job. Please run it again; a new session starts automatically.";
  }
  if (/File size limit exceeded|signal 25\b/i.test(text)) {
    const stage = /^(?:.*?)(pw\.x|dos\.x|projwfc\.x)\s+([a-z]+)(?:\s*\(([^)]*)\))?/i.exec(text);
    const step = stage?.[3]?.match(/DOS/i) ? "DOS step" : stage?.[2]?.toLowerCase() === "bands" ? "band-structure step" : stage?.[2] ? `${stage[2]} step` : "calculation";
    return `The ${step} wrote a file larger than the per-file size limit, so the run was stopped and nothing was published. The raw engine log is available below.`;
  }
  if (/heartbeat deadline expired|heartbeat lost/i.test(text) || code === "LEASE_EXPIRED") {
    return "The compute worker stopped reporting progress (heartbeat lost), so this run was marked lost and nothing was published. The raw engine log, if any, is available below.";
  }
  return null;
}

/** Failure explanation; the three known hosted failures are in plain language, everything else exactly as reported. null when the job did not fail. */
export function jobFailure(job: Pick<ComputeJobView, "state" | "latest_execution">): string | null {
  const phase = jobPhase(job);
  if (phase.key !== "failed" && phase.key !== "lost") return null;
  const execution = job.latest_execution;
  const runtime = execution?.metering?.runtime_ms;
  const plain = plainFailure(execution?.failure_code, execution?.diagnostic, typeof runtime === "number" ? runtime / 1000 : null);
  if (plain) return plain;
  const code = execution?.failure_code ? execution.failure_code.toLowerCase().replaceAll("_", " ") : null;
  const parts = [code, execution?.diagnostic].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" — ") : "No failure detail was reported by the compute provider.";
}

export function calculationWorkspacePath(locale: Locale, projectId: string, calculationId: string): string {
  const query = new URLSearchParams({ selection: selectionKey({ kind: "calculation", id: calculationId, projectId }) });
  return `${projectPath(locale, projectId, "workspace")}?${query.toString()}`;
}

/** Link to the structure version a job computed, in the workspace. */
export function structureWorkspacePath(locale: Locale, projectId: string, structureId: string, versionId: string): string {
  const query = new URLSearchParams({ selection: selectionKey({ kind: "structureVersion", id: versionId, projectId, sourceId: structureId }) });
  return `${projectPath(locale, projectId, "workspace")}?${query.toString()}`;
}

/** Deep link to the published result itself (its scientific viewer), not to the calculation record. */
export function resultWorkspacePath(locale: Locale, projectId: string, calculationId: string, resultId: string): string {
  const query = new URLSearchParams({
    selection: selectionKey({ kind: "calculationResult", id: resultId, projectId, sourceId: calculationId }),
    source: calculationId,
  });
  return `${projectPath(locale, projectId, "workspace")}?${query.toString()}`;
}

/** Stops polling once every job is terminal; callers still refresh on demand. */
export function anyJobActive(jobs: readonly Pick<ComputeJobView, "state" | "latest_execution">[]): boolean {
  return jobs.some((job) => jobPhase(job).active);
}

// ---------------------------------------------------------------------------------------------
// RW-2: diagnostics presentation. Everything below formats persisted records; nothing is inferred.
// ---------------------------------------------------------------------------------------------

/** The API serializes database timestamps without a zone designator; they are UTC. */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 90) return `${Math.round(seconds)} s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  return `${(seconds / 3600).toFixed(1)} h ago`;
}

type DiagnosticsHeartbeat = Pick<JobDiagnostics, "heartbeat_status" | "heartbeat_age_seconds" | "heartbeat_stale_after_seconds">;

export function heartbeatBadge(diagnostics: DiagnosticsHeartbeat): { label: string; intent: "success" | "warning" | "none" } | null {
  switch (diagnostics.heartbeat_status) {
    case "FRESH":
      return { label: `Worker heartbeat ${formatAge(diagnostics.heartbeat_age_seconds)}`, intent: "success" };
    case "STALE":
      return {
        label: `Heartbeat overdue — last ${formatAge(diagnostics.heartbeat_age_seconds)} (expected every ${Math.round(diagnostics.heartbeat_stale_after_seconds)} s)`,
        intent: "warning",
      };
    case "NOT_REPORTED":
      return { label: "No worker heartbeat recorded yet", intent: "none" };
    default:
      return null;
  }
}

export function describeSpecification(summary: ComputeJobView["specification_summary"] | undefined): string {
  if (!summary) return "Specification unavailable";
  const level = [summary.method, summary.basis].filter(Boolean).join(" / ");
  const electronic = summary.charge !== null && summary.charge !== undefined && summary.multiplicity
    ? ` · charge ${summary.charge >= 0 ? "+" : ""}${summary.charge}, multiplicity ${summary.multiplicity}`
    : "";
  return `${level || "method not recorded"}${electronic}`;
}

export function jobTimes(job: Pick<ComputeJobView, "state" | "latest_execution" | "created_at" | "updated_at">): {
  submitted: string; started: string; completed: string;
} {
  const execution = job.latest_execution;
  const terminal = !jobPhase(job as Pick<ComputeJobView, "state" | "latest_execution">).active;
  return {
    submitted: formatTimestamp(job.created_at),
    started: formatTimestamp(execution?.started_at),
    // A terminal job without a recorded finish shows the last update, flagged as such, never a guess.
    completed: terminal ? formatTimestamp(execution?.finished_at ?? job.updated_at) : "—",
  };
}

/** Stored UTC instant, second precision, for the line under a local time (`—` when absent). */
export function formatUtcSeconds(value: string | null | undefined): string {
  const time = parseUtc(value);
  return time === null ? "—" : `${new Date(time).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function artifactAvailability(diagnostics: Pick<JobDiagnostics, "attempts">): {
  total: number; logs: number; text: string;
} {
  const artifacts = diagnostics.attempts.flatMap((attempt) => attempt.artifacts ?? []);
  const logs = artifacts.filter((artifact) => artifact.log_readable).length;
  return {
    total: artifacts.length,
    logs,
    text: artifacts.length === 0
      ? "No native artifacts have been stored for this job yet."
      : `${artifacts.length} native artifact${artifacts.length === 1 ? "" : "s"} stored (${logs} readable as text).`,
  };
}

/** One cadence for the job list, the queue strip and the open job's diagnostics. */
export const JOB_POLL_MS = 3000;

/** Polling cadence: fast only while a job could still change; stop for terminal jobs. */
export function diagnosticsPollInterval(jobState: string, visible: boolean): number | null {
  if (!visible) return null;
  return ["PENDING", "READY", "LEASED", "RUNNING", "CANCEL_REQUESTED"].includes(jobState) ? JOB_POLL_MS : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

// ---------------------------------------------------------------------------------------------
// Jobs workstation: provider, estimate and reservation wording. Every figure is the server's;
// nothing is converted, summed or extrapolated here.
// ---------------------------------------------------------------------------------------------

const PROVIDER_LABEL: Record<string, string> = { local: "Local", aws: "AWS", modal: "Modal" };

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

type Money = MinorUnitMoney;

/** Integer-only money text (see `lib/money.ts`); no float division. */
export function formatMoney(money: Money): string {
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: money.currency });
  } catch {
    return `${money.minor_units} ${money.currency} (minor units)`; // unknown currency code: the wording this page always used
  }
  return formatMinorUnits(money);
}

function formatRange<T>(low: T | null | undefined, high: T | null | undefined, format: (value: T) => string, none: string): string {
  const hasLow = low !== null && low !== undefined;
  const hasHigh = high !== null && high !== undefined;
  if (hasLow && hasHigh) return format(low) === format(high) ? format(low) : `${format(low)} to ${format(high)}`;
  if (hasHigh) return `up to ${format(high)}`;
  if (hasLow) return `at least ${format(low)}`;
  return none;
}

export type EstimateView = {
  runtime: string;
  cost: string;
  confidence: string;
  validUntil: string;
  providerSummary: string;
  assumptions: readonly string[];
};

/** `null` when the job has no estimate record: the page then says "No estimate recorded". */
export function describeEstimate(estimate: ComputeJobView["estimate"] | undefined): EstimateView | null {
  if (!estimate) return null;
  return {
    runtime: formatRange(estimate.runtime_low_seconds, estimate.runtime_high_seconds, (value) => formatRuntime(value), "not provided"),
    cost: formatRange(estimate.cost_low, estimate.cost_high, formatMoney, "not provided"),
    confidence: estimate.confidence.toLowerCase(),
    validUntil: estimate.valid_until,
    providerSummary: estimate.provider_summary,
    assumptions: estimate.assumptions ?? [],
  };
}

const RESERVATION_STATE: Record<string, string> = {
  RESERVED: "Reserved",
  RELEASED: "Released",
  DENIED: "Denied",
};

export function describeReservation(reservation: ComputeJobView["reservation"] | undefined): {
  state: string; authorizedMax: string; actualCost: string;
} | null {
  if (!reservation) return null;
  return {
    state: RESERVATION_STATE[reservation.state] ?? reservation.state,
    authorizedMax: formatMoney(reservation.authorized_max),
    actualCost: reservation.actual_cost ? formatMoney(reservation.actual_cost) : "not reconciled yet",
  };
}

/** Cost the provider itself reported for the latest execution; never an estimate. */
export function providerCostText(job: Pick<ComputeJobView, "latest_execution">): string {
  const metering = job.latest_execution?.metering;
  if (metering?.provider_cost_status === "AVAILABLE" && metering.provider_cost) return formatMoney(metering.provider_cost);
  return "not reported by the provider";
}

/** Compact local time for list rows; the full UTC form stays available through `formatTimestamp`. */
export function formatShortTime(value: string | null | undefined): string {
  const time = parseUtc(value);
  if (time === null) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(time);
}
