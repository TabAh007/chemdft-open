import { describe, expect, it } from "vitest";
import {
  mapPulseLightState,
  TYPICAL_START_SECONDS,
  TYPICAL_RUN_SECONDS,
  DEFAULT_STALE_SECONDS,
} from "../src/lib/pulse-light";

describe("Pulse Light state mapping", () => {
  const baseTime = 1_700_000_000_000; // Fixed timestamp in ms

  it("typical durations are constants in one place", () => {
    expect(TYPICAL_START_SECONDS).toBe(150);
    expect(TYPICAL_RUN_SECONDS).toBe(90);
    expect(DEFAULT_STALE_SECONDS).toBe(90);
  });

  it("queued: maps PENDING/READY state without machine startup to queued stage", () => {
    const state = mapPulseLightState({
      jobState: "READY",
      provider: "local",
      createdAt: new Date(baseTime - 15_000).toISOString(),
      nowMs: baseTime,
    });

    expect(state.stage).toBe("queued");
    expect(state.word).toBe("Queued");
    expect(state.color).toBe("amber");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(false);
    expect(state.detail).toContain("Queued in compute queue · elapsed 15 s");
    expect(state.ariaLabel).toBe(`Queued: ${state.detail}`);
  });

  it("starting: maps AWS queued or LEASED to starting stage with amber slow pulse", () => {
    const stateLeased = mapPulseLightState({
      jobState: "LEASED",
      provider: "aws",
      startedAt: new Date(baseTime - 45_000).toISOString(),
      nowMs: baseTime,
    });

    expect(stateLeased.stage).toBe("starting");
    expect(stateLeased.word).toBe("Starting");
    expect(stateLeased.color).toBe("amber");
    expect(stateLeased.pulsing).toBe(true);
    expect(stateLeased.canCancel).toBe(false);
    expect(stateLeased.detail).toBe("Starting the compute machine — usually about 2.5 min");
    expect(stateLeased.ariaLabel).toBe("Starting: Starting the compute machine — usually about 2.5 min");

    const stateAwsQueued = mapPulseLightState({
      jobState: "PENDING",
      provider: "aws",
      createdAt: new Date(baseTime - 30_000).toISOString(),
      nowMs: baseTime,
    });
    expect(stateAwsQueued.stage).toBe("starting");
    expect(stateAwsQueued.word).toBe("Starting");
    expect(stateAwsQueued.color).toBe("amber");
    expect(stateAwsQueued.pulsing).toBe(true);
  });

  it("running+fresh: maps RUNNING with recent heartbeat to green pulse", () => {
    const state = mapPulseLightState({
      jobState: "RUNNING",
      provider: "aws",
      startedAt: new Date(baseTime - 60_000).toISOString(),
      heartbeatAt: new Date(baseTime - 4_000).toISOString(),
      heartbeatStatus: "FRESH",
      nowMs: baseTime,
    });

    expect(state.stage).toBe("running");
    expect(state.word).toBe("Running");
    expect(state.color).toBe("green");
    expect(state.pulsing).toBe(true);
    expect(state.canCancel).toBe(false);
    expect(state.detail).toBe("Running — worker checked in 4 s ago");
    expect(state.ariaLabel).toBe("Running: Running — worker checked in 4 s ago");
  });

  it("running+stale: stops pulsing, switches to grey dot and indicates stale signal with cancel action", () => {
    const state = mapPulseLightState({
      jobState: "RUNNING",
      provider: "aws",
      startedAt: new Date(baseTime - 120_000).toISOString(),
      heartbeatAgeSeconds: 90,
      heartbeatStatus: "STALE",
      nowMs: baseTime,
    });

    expect(state.stage).toBe("running");
    expect(state.word).toBe("Stale");
    expect(state.color).toBe("grey");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(true);
    expect(state.detail).toBe("No signal for 90 s — this may be stuck");
    expect(state.ariaLabel).toBe("Stale: No signal for 90 s — this may be stuck");
  });

  it("finishing: maps CANCEL_REQUESTED to finishing with amber static light", () => {
    const state = mapPulseLightState({
      jobState: "CANCEL_REQUESTED",
      startedAt: new Date(baseTime - 50_000).toISOString(),
      nowMs: baseTime,
    });

    expect(state.stage).toBe("finishing");
    expect(state.word).toBe("Cancelling");
    expect(state.color).toBe("amber");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(false);
    expect(state.detail).toContain("Cancelling calculation · elapsed 50 s");
  });

  it("over-typical: starting exceeding typical duration switches to grey dot and warns it may be stuck", () => {
    const state = mapPulseLightState({
      jobState: "LEASED",
      provider: "aws",
      startedAt: new Date(baseTime - 360_000).toISOString(), // 6 minutes > 2 * 2.5 min
      nowMs: baseTime,
    });

    expect(state.stage).toBe("starting");
    expect(state.word).toBe("Delayed");
    expect(state.color).toBe("grey");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(true);
    expect(state.detail).toContain("Starting the compute machine taking longer than usual (6 min) — this may be stuck");
  });

  it("over-typical: running exceeding typical duration without fresh heartbeat warns it may be stuck with measured seconds", () => {
    const state = mapPulseLightState({
      jobState: "RUNNING",
      provider: "aws",
      startedAt: new Date(baseTime - 240_000).toISOString(), // 4 minutes > 2 * 1.5 min
      heartbeatAgeSeconds: null,
      heartbeatStatus: "NOT_REPORTED",
      nowMs: baseTime,
    });

    expect(state.stage).toBe("running");
    expect(state.word).toBe("Delayed");
    expect(state.color).toBe("grey");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(true);
    expect(state.detail).toBe("No signal for 240 s — this may be stuck");
  });

  it("running with no heartbeat yet: shows neutral waiting for first worker signal without green checked-in claim", () => {
    const state = mapPulseLightState({
      jobState: "RUNNING",
      provider: "aws",
      startedAt: new Date(baseTime - 20_000).toISOString(),
      heartbeatStatus: "NOT_REPORTED",
      heartbeatAgeSeconds: null,
      nowMs: baseTime,
    });

    expect(state.stage).toBe("running");
    expect(state.word).toBe("Running");
    expect(state.color).toBe("grey"); // neutral grey, NOT green
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(false);
    expect(state.detail).toBe("Running - waiting for first worker signal");
    expect(state.ariaLabel).toBe("Running: Running - waiting for first worker signal");
  });

  it("heartbeat_stale_after_seconds: uses custom stale threshold from payload and prints real measured number", () => {
    const state = mapPulseLightState({
      jobState: "RUNNING",
      provider: "aws",
      startedAt: new Date(baseTime - 60_000).toISOString(),
      heartbeatAgeSeconds: 50,
      heartbeatStaleAfterSeconds: 45, // Custom threshold: 50s > 45s => stale
      nowMs: baseTime,
    });

    expect(state.stage).toBe("running");
    expect(state.word).toBe("Stale");
    expect(state.color).toBe("grey");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(true);
    expect(state.detail).toBe("No signal for 50 s — this may be stuck");
  });

  it("heartbeat_status STALE from payload: triggers stale and prints measured seconds (105 s)", () => {
    const state = mapPulseLightState({
      jobState: "RUNNING",
      provider: "aws",
      startedAt: new Date(baseTime - 120_000).toISOString(),
      heartbeatAgeSeconds: 105,
      heartbeatStatus: "STALE",
      heartbeatStaleAfterSeconds: 60,
      nowMs: baseTime,
    });

    expect(state.stage).toBe("running");
    expect(state.word).toBe("Stale");
    expect(state.color).toBe("grey");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(true);
    expect(state.detail).toBe("No signal for 105 s — this may be stuck");
  });

  it("failed: maps FAILED to red static dot without cancel", () => {
    const state = mapPulseLightState({
      jobState: "FAILED",
      nowMs: baseTime,
    });

    expect(state.stage).toBe("failed");
    expect(state.word).toBe("Failed");
    expect(state.color).toBe("red");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(false);
    expect(state.detail).toBe("Calculation failed.");
  });

  it("cancelled: maps CANCELED to grey static dot without cancel", () => {
    const state = mapPulseLightState({
      jobState: "CANCELED",
      nowMs: baseTime,
    });

    expect(state.stage).toBe("canceled");
    expect(state.word).toBe("Canceled");
    expect(state.color).toBe("grey");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(false);
    expect(state.detail).toBe("Calculation was canceled.");
  });

  it("succeeded: maps SUCCEEDED to green static dot without cancel", () => {
    const state = mapPulseLightState({
      jobState: "SUCCEEDED",
      nowMs: baseTime,
    });

    expect(state.stage).toBe("succeeded");
    expect(state.word).toBe("Succeeded");
    expect(state.color).toBe("green");
    expect(state.pulsing).toBe(false);
    expect(state.canCancel).toBe(false);
    expect(state.detail).toBe("Calculation completed successfully.");
  });
});
