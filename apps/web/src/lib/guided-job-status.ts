import type { CalculationDetail } from "@chemdft/schemas";
import { formatRuntime, formatTimestamp, jobFailure, jobPhase, jobRuntimeSeconds, parseUtc } from "./job-view";

/**
 * The single researcher-facing presentation of a submitted calculation in Guided mode.
 *
 * ChemDFT keeps two state machines: the calculation lifecycle (DRAFT … SUCCEEDED) and the compute job
 * (PENDING, READY, LEASED, RUNNING …). Every word shown here is derived from those persisted records by
 * this one function; nothing is inferred, no progress, queue position or ETA is invented, and the
 * capability catalogue is never consulted (an accepted job is not rewritten by engine availability).
 */

export type GuidedJobKey =
  | "submitted" | "awaiting-authorization" | "authorized" | "queued" | "starting" | "running"
  | "cancelling" | "finalizing" | "succeeded" | "failed" | "canceled" | "lost";

export type GuidedJobView = {
  key: GuidedJobKey;
  label: string;
  /** One sentence saying what this state means in ChemDFT terms. */
  meaning: string;
  intent: "none" | "primary" | "success" | "warning" | "danger";
  active: boolean;
  terminal: boolean;
  calculationId: string;
  jobId: string | null;
  calculationState: string;
  jobState: string | null;
  executionState: string | null;
  /** Newest timestamp found in the persisted records, never the browser clock. */
  lastRecordedUpdate: { iso: string; text: string } | null;
  /** Seconds since the execution started (or its metered runtime); null until an execution exists. */
  runtimeSeconds: number | null;
  runtimeText: string;
  /** Present only while waiting for a worker: when the job was created. */
  waitingSince: string | null;
  workerStatus: string | null;
  failure: string | null;
  resultId: string | null;
  /** The calculation record and the compute job disagree; the text says which one is displayed. */
  discrepancy: string | null;
  cancel: { offered: boolean; reason: string };
  /** Always null: the API reports no percentage, queue position or ETA. */
  progress: null;
};

const TERMINAL_CALCULATION = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);
const TERMINAL_JOB = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

export const READY_EXPLANATION =
  "READY is a compute-job state: the job is queued and eligible for a worker to claim. It does not mean running, and it does not mean finished.";

function newest(values: Array<string | null | undefined>): { iso: string; text: string } | null {
  let best: { ms: number; iso: string } | null = null;
  for (const value of values) {
    if (!value) continue;
    const ms = parseUtc(value);
    if (ms !== null && (best === null || ms > best.ms)) best = { ms, iso: value };
  }
  return best ? { iso: best.iso, text: formatTimestamp(best.iso) } : null;
}

export function presentGuidedJob(detail: CalculationDetail, options: { nowMs: number; canWrite: boolean }): GuidedJobView {
  const { calculation } = detail;
  const job = detail.compute_job ?? null;
  const execution = job?.latest_execution ?? detail.compute_execution ?? null;
  const calcTerminal = TERMINAL_CALCULATION.has(calculation.state);
  const jobTerminal = job ? TERMINAL_JOB.has(job.state) : false;

  let key: GuidedJobKey;
  let label: string;
  let meaning: string;
  let intent: GuidedJobView["intent"] = "primary";
  let discrepancy: string | null = null;

  if (calcTerminal) {
    key = calculation.state === "SUCCEEDED" ? "succeeded" : calculation.state === "FAILED" ? "failed" : "canceled";
    label = key === "succeeded" ? "Succeeded" : key === "failed" ? "Failed" : "Canceled";
    intent = key === "succeeded" ? "success" : key === "failed" ? "danger" : "warning";
    meaning = key === "succeeded"
      ? "The calculation finished and its result was recorded. Inspect it in Results."
      : key === "failed"
      ? "The calculation ended without a publishable result. No result was substituted."
      : "The calculation was canceled. No result was substituted.";
    if (job && !jobTerminal) {
      discrepancy = `The calculation record says ${calculation.state} while the compute job still says ${job.state}; the calculation record is displayed.`;
    }
  } else if (!job) {
    const stages: Record<string, { key: GuidedJobKey; label: string; meaning: string }> = {
      DRAFT: { key: "submitted", label: "Submitted", meaning: "The calculation record exists. It has not been validated or queued yet." },
      VALIDATED: { key: "awaiting-authorization", label: "Awaiting authorization", meaning: "The input was validated. It is waiting for authorization before it can be queued." },
      AUTHORIZED: { key: "authorized", label: "Authorized, not yet queued", meaning: "Authorized. No compute job has been recorded for it yet." },
      QUEUED: { key: "queued", label: "Queued", meaning: "The calculation is queued, but no compute job record is attached to it yet." },
      RUNNING: { key: "running", label: "Running", meaning: "The calculation record says it is running, but no compute job record is attached to it." },
    };
    const picked = stages[calculation.state] ?? { key: "submitted" as const, label: calculation.state, meaning: "State reported by the calculation record." };
    ({ key, label, meaning } = picked);
    if (key === "running") discrepancy = "No compute job record is attached, so worker activity cannot be confirmed.";
  } else if (jobTerminal) {
    // The job finished before the calculation record was finalized.
    key = "finalizing";
    label = "Finalizing";
    meaning = `The compute job reports ${job.state}; the calculation record has not been finalized yet.`;
    intent = "primary";
  } else {
    const phase = jobPhase(job);
    key = phase.key === "queued" ? "queued" : phase.key === "leased" ? "starting" : phase.key === "running" ? "running" : phase.key === "cancelling" ? "cancelling" : "lost";
    label = phase.label;
    intent = phase.intent === "none" ? "none" : phase.intent;
    meaning = key === "queued"
      ? (job.state === "READY" ? READY_EXPLANATION : "PENDING: the compute job is recorded but has not been released to the queue yet.")
      : key === "starting" ? "A worker has claimed the job and is starting the engine."
      : key === "running" ? "A worker is executing the engine. ChemDFT receives no progress percentage from it."
      : key === "cancelling" ? "Cancellation was requested; the provider is reconciling the job."
      : "The worker execution was lost. The platform has not yet recorded an outcome.";
    if (calculation.state === "RUNNING" && key === "queued") {
      discrepancy = "The calculation record says RUNNING while the compute job says " + job.state + "; the compute job state is displayed.";
    } else if (calculation.state === "QUEUED" && key === "running") {
      discrepancy = "The calculation record still says QUEUED while the compute job says RUNNING; the compute job state is displayed.";
    }
  }

  const terminal = key === "succeeded" || key === "failed" || key === "canceled";
  const runtime = execution ? jobRuntimeSeconds({ latest_execution: execution }, options.nowMs) : null;
  const active = !terminal;

  let cancel: GuidedJobView["cancel"];
  if (terminal) cancel = { offered: false, reason: "The job has already ended." };
  else if (key === "cancelling") cancel = { offered: false, reason: "Cancellation has already been requested." };
  else if (!options.canWrite) cancel = { offered: false, reason: "Your role cannot cancel calculations in this project." };
  else cancel = { offered: true, reason: "Stops this job. Draft settings are not affected." };

  return {
    key, label, meaning, intent, active, terminal,
    calculationId: calculation.id,
    jobId: job?.id ?? null,
    calculationState: calculation.state,
    jobState: job?.state ?? null,
    executionState: execution?.state ?? null,
    lastRecordedUpdate: newest([
      calculation.updated_at, job?.updated_at, execution?.heartbeat_at, execution?.finished_at, execution?.started_at,
    ]),
    runtimeSeconds: runtime,
    runtimeText: formatRuntime(runtime),
    waitingSince: key === "queued" && job ? formatTimestamp(job.created_at) : null,
    workerStatus: job?.worker_status ?? null,
    failure: job && (key === "failed" || key === "lost") ? jobFailure(job) : (key === "failed" ? (detail.attempt?.diagnostic ?? "No failure detail was reported.") : null),
    resultId: detail.result?.id ?? null,
    discrepancy,
    cancel,
    progress: null,
  };
}

/** Polling cadence for a displayed job; null = stop (terminal, or the page is hidden). */
export function guidedJobPollMs(view: Pick<GuidedJobView, "terminal"> | null, visible: boolean, failures: number): number | null {
  if (!visible || (view && view.terminal)) return null;
  const base = 3000;
  return Math.min(30_000, base * 2 ** Math.min(failures, 4));
}
