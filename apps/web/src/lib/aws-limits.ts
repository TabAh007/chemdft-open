/**
 * Per-task wall-clock limits of the hosted AWS compute route (mirrors services/api config.py:
 * scientific_execution_timeout_seconds, aws_optimization_timeout_seconds, aws_frequency_timeout_seconds,
 * aws_tddft_timeout_seconds, aws_xtb_optimization_timeout_seconds) and the wall-clocks MEASURED on the hosted
 * worker for water-sized molecules. Tasks that were never measured there say so instead of guessing.
 * The worker itself takes about 2-3 minutes to start when it is stopped (measured 2026-11-02).
 */
export type HostedTimingKey = "energy" | "optimization" | "xtb-optimization" | "ir" | "raman" | "tddft" | "thermochemistry" | "orbitals" | "conformer";

const LIMIT_SECONDS: Record<string, number> = { energy: 1800, optimization: 600, "xtb-optimization": 900, ir: 600, tddft: 600 };
const MEASURED_SECONDS: Record<string, number> = { energy: 28, optimization: 35, ir: 39, tddft: 28 };

export function hostedTimingKey(task: string, isXtb: boolean): string {
  return task === "optimization" && isXtb ? "xtb-optimization" : task;
}

/** One plain sentence for the Review stage, or null when the hosted route does not run this task. */
export function expectedHostedDuration(task: string, isXtb: boolean): string | null {
  const key = hostedTimingKey(task, isXtb);
  const limit = LIMIT_SECONDS[key];
  if (limit === undefined) return null;
  const measured = MEASURED_SECONDS[key];
  const minutes = limit >= 60 ? `${Math.round(limit / 60)} min` : `${limit} s`;
  return measured === undefined
    ? `Not yet timed on the hosted worker; it is stopped after ${minutes}.`
    : `About ${measured} s for a water-sized molecule once the worker is running (the worker takes 2-3 minutes to start); stopped after ${minutes}.`;
}
