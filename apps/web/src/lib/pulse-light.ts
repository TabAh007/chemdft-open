import { parseUtc } from "./timestamps";
import { formatAge } from "./job-view";

// Observed typical values, not guarantees. Shown as "usually about", never as a promise.
export const TYPICAL_START_SECONDS = 150; // ~2.5 minutes for compute machine startup
export const TYPICAL_RUN_SECONDS = 90; // ~1.5 minutes for typical calculation run
export const DEFAULT_STALE_SECONDS = 90; // 90 seconds without signal is considered stale
export const OVER_TYPICAL_MARGIN_MULTIPLIER = 2.0; // Stage exceeding typical time by clear margin

export type PulseStage = "queued" | "starting" | "running" | "finishing" | "succeeded" | "failed" | "canceled";
export type PulseColor = "amber" | "green" | "grey" | "red";

export interface PulseLightState {
  stage: PulseStage;
  word: string;
  detail: string;
  color: PulseColor;
  pulsing: boolean;
  canCancel: boolean;
  elapsedSeconds: number;
  ariaLabel: string;
}

export interface PulseLightInput {
  jobState?: string | null | undefined;
  provider?: string | null | undefined;
  workerStatus?: string | null | undefined;
  startedAt?: string | null | undefined;
  createdAt?: string | null | undefined;
  heartbeatAt?: string | null | undefined;
  heartbeatAgeSeconds?: number | null | undefined;
  heartbeatStatus?: "FRESH" | "STALE" | "NOT_REPORTED" | "NOT_APPLICABLE" | null | undefined;
  heartbeatStaleAfterSeconds?: number | null | undefined;
  nowMs?: number | undefined;
}

/**
 * Pure state-mapping function for the heartbeat pulse light.
 * Never guesses progress or fakes animations; builds only from persisted/reported signals.
 */
export function mapPulseLightState(input: PulseLightInput): PulseLightState {
  const nowMs = input.nowMs ?? Date.now();

  const startedMs = input.startedAt ? parseUtc(input.startedAt) : null;
  const createdMs = input.createdAt ? parseUtc(input.createdAt) : null;

  let elapsedSeconds = 0;
  if (startedMs !== null && nowMs >= startedMs) {
    elapsedSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  } else if (createdMs !== null && nowMs >= createdMs) {
    elapsedSeconds = Math.max(0, Math.floor((nowMs - createdMs) / 1000));
  }

  let heartbeatAge: number | null = null;
  if (typeof input.heartbeatAgeSeconds === "number") {
    heartbeatAge = input.heartbeatAgeSeconds;
  } else if (input.heartbeatAt) {
    const hbMs = parseUtc(input.heartbeatAt);
    if (hbMs !== null && nowMs >= hbMs) {
      heartbeatAge = Math.max(0, (nowMs - hbMs) / 1000);
    }
  }

  const staleThreshold = input.heartbeatStaleAfterSeconds ?? DEFAULT_STALE_SECONDS;
  const isStale = input.heartbeatStatus === "STALE" || (input.heartbeatStatus !== "FRESH" && heartbeatAge !== null && heartbeatAge >= staleThreshold);

  const state = (input.jobState ?? "").toUpperCase();

  // Terminal states
  if (state === "SUCCEEDED") {
    return {
      stage: "succeeded",
      word: "Succeeded",
      detail: "Calculation completed successfully.",
      color: "green",
      pulsing: false,
      canCancel: false,
      elapsedSeconds,
      ariaLabel: "Succeeded: Calculation completed successfully.",
    };
  }
  if (state === "FAILED") {
    return {
      stage: "failed",
      word: "Failed",
      detail: "Calculation failed.",
      color: "red",
      pulsing: false,
      canCancel: false,
      elapsedSeconds,
      ariaLabel: "Failed: Calculation failed.",
    };
  }
  if (state === "CANCELED") {
    return {
      stage: "canceled",
      word: "Canceled",
      detail: "Calculation was canceled.",
      color: "grey",
      pulsing: false,
      canCancel: false,
      elapsedSeconds,
      ariaLabel: "Canceled: Calculation was canceled.",
    };
  }
  if (state === "CANCEL_REQUESTED") {
    return {
      stage: "finishing",
      word: "Cancelling",
      detail: `Cancelling calculation · elapsed ${elapsedSeconds} s`,
      color: "amber",
      pulsing: false,
      canCancel: false,
      elapsedSeconds,
      ariaLabel: `Cancelling: Cancelling calculation · elapsed ${elapsedSeconds} s`,
    };
  }

  // Active RUNNING state
  if (state === "RUNNING") {
    if (isStale) {
      const staleSec = Math.round(heartbeatAge ?? elapsedSeconds ?? staleThreshold);
      const detail = `No signal for ${staleSec} s — this may be stuck`;
      return {
        stage: "running",
        word: "Stale",
        detail,
        color: "grey",
        pulsing: false,
        canCancel: true,
        elapsedSeconds,
        ariaLabel: `Stale: ${detail}`,
      };
    }

    if (elapsedSeconds > TYPICAL_RUN_SECONDS * OVER_TYPICAL_MARGIN_MULTIPLIER && input.heartbeatStatus !== "FRESH") {
      const measuredSec = Math.round(heartbeatAge ?? elapsedSeconds);
      const detail = `No signal for ${measuredSec} s — this may be stuck`;
      return {
        stage: "running",
        word: "Delayed",
        detail,
        color: "grey",
        pulsing: false,
        canCancel: true,
        elapsedSeconds,
        ariaLabel: `Delayed: ${detail}`,
      };
    }

    const hasHeartbeat = heartbeatAge !== null || input.heartbeatStatus === "FRESH";
    if (!hasHeartbeat) {
      const detail = "Running - waiting for first worker signal";
      return {
        stage: "running",
        word: "Running",
        detail,
        color: "grey",
        pulsing: false,
        canCancel: false,
        elapsedSeconds,
        ariaLabel: `Running: ${detail}`,
      };
    }

    const detail = heartbeatAge !== null
      ? `Running — worker checked in ${formatAge(heartbeatAge)}`
      : "Running — worker checked in";
    return {
      stage: "running",
      word: "Running",
      detail,
      color: "green",
      pulsing: true,
      canCancel: false,
      elapsedSeconds,
      ariaLabel: `Running: ${detail}`,
    };
  }

  // Active STARTING state (LEASED, or AWS queued / worker starting)
  const isAwsStarting = input.provider === "aws" || Boolean(input.workerStatus?.toLowerCase().includes("starting"));
  if (state === "LEASED" || ((state === "PENDING" || state === "READY") && isAwsStarting)) {
    if (elapsedSeconds > TYPICAL_START_SECONDS * OVER_TYPICAL_MARGIN_MULTIPLIER) {
      const elapsedMin = Math.round(elapsedSeconds / 60);
      const detail = `Starting the compute machine taking longer than usual (${elapsedMin} min) — this may be stuck`;
      return {
        stage: "starting",
        word: "Delayed",
        detail,
        color: "grey",
        pulsing: false,
        canCancel: true,
        elapsedSeconds,
        ariaLabel: `Delayed: ${detail}`,
      };
    }
    const detail = "Starting the compute machine — usually about 2.5 min";
    return {
      stage: "starting",
      word: "Starting",
      detail,
      color: "amber",
      pulsing: true,
      canCancel: false,
      elapsedSeconds,
      ariaLabel: `Starting: ${detail}`,
    };
  }

  // Active QUEUED state (PENDING / READY without AWS starting indicator)
  if (elapsedSeconds > TYPICAL_START_SECONDS * OVER_TYPICAL_MARGIN_MULTIPLIER) {
    const elapsedMin = Math.round(elapsedSeconds / 60);
    const detail = `Queued longer than usual (${elapsedMin} min) — this may be stuck`;
    return {
      stage: "queued",
      word: "Delayed",
      detail,
      color: "grey",
      pulsing: false,
      canCancel: true,
      elapsedSeconds,
      ariaLabel: `Delayed: ${detail}`,
    };
  }

  const detail = `Queued in compute queue · elapsed ${elapsedSeconds} s`;
  return {
    stage: "queued",
    word: "Queued",
    detail,
    color: "amber",
    pulsing: false,
    canCancel: false,
    elapsedSeconds,
    ariaLabel: `Queued: ${detail}`,
  };
}
