// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CalculationDetail } from "@chemdft/schemas";
import { useGuidedJob } from "../src/lib/use-guided-job";
import { rememberSubmission } from "../src/lib/guided-draft";

const api = vi.hoisted(() => ({ get: vi.fn(), cancel: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/structure-workspace-api", () => ({
  getCalculation: api.get, cancelCalculation: api.cancel, listComputeJobs: api.list,
}));
vi.mock("../src/lib/structure-workspace-api", () => ({
  getCalculation: api.get, cancelCalculation: api.cancel, listComputeJobs: api.list,
}));

function record(calc: string, job: string | null, extra: Record<string, unknown> = {}): CalculationDetail {
  return {
    calculation: { id: "calc-1", state: calc, updated_at: "2026-10-18T10:00:05" },
    calculation_input_hash: "b".repeat(64), specification: {},
    compute_job: job ? { id: "job-1", state: job, created_at: "2026-10-18T10:00:01", updated_at: "2026-10-18T10:00:09", latest_execution: null } : null,
    ...extra,
  } as unknown as CalculationDetail;
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
const seen: { current: ReturnType<typeof useGuidedJob> | null } = { current: null };
const latest = new Proxy({} as ReturnType<typeof useGuidedJob>, { get: (_target, key) => (seen.current as unknown as Record<string | symbol, unknown>)[key] });
function Probe({ canWrite = true }: { canWrite?: boolean }) {
  const job = useGuidedJob({ projectId: "p1", versionId: "v1", canWrite });
  useEffect(() => { seen.current = job; });
  return createElement("p", null, job.view ? `${job.view.key}|${job.connection}` : `none|${job.connection}`);
}
async function flush(times = 4) { for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve(); }); }

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.clearAllMocks();
  api.get.mockReset(); api.cancel.mockReset(); api.list.mockReset();
  api.list.mockResolvedValue({ jobs: [] });
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useGuidedJob", () => {
  it("restores the recorded state of a remembered job after a reload", async () => {
    rememberSubmission("p1", "v1", "calc-1");
    api.get.mockResolvedValue(record("QUEUED", "READY"));
    await act(async () => { root.render(createElement(Probe)); });
    await flush();
    expect(api.get).toHaveBeenCalledWith({ projectId: "p1", calculationId: "calc-1" });
    expect(container.textContent).toBe("queued|live");
    expect(latest.view).toMatchObject({ calculationState: "QUEUED", jobState: "READY" });
  });

  it("finds the newest active job in the project when nothing was remembered", async () => {
    api.list.mockResolvedValue({ jobs: [
      { calculation_id: "old", state: "SUCCEEDED", created_at: "2026-10-17T00:00:00", latest_execution: null },
      { calculation_id: "calc-1", state: "RUNNING", created_at: "2026-10-18T00:00:00", latest_execution: null },
    ] });
    api.get.mockResolvedValue(record("RUNNING", "RUNNING", { }));
    await act(async () => { root.render(createElement(Probe)); });
    await flush(6);
    expect(api.get).toHaveBeenCalledWith({ projectId: "p1", calculationId: "calc-1" });
    expect(latest.view?.key).toBe("running");
  });

  it("keeps the last confirmed record, flags it stale, and recovers when the network returns", async () => {
    rememberSubmission("p1", "v1", "calc-1");
    api.get.mockResolvedValueOnce(record("QUEUED", "READY"));
    await act(async () => { root.render(createElement(Probe)); });
    await flush();
    api.get.mockRejectedValueOnce(new Error("Failed to fetch"));
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    await flush();
    expect(container.textContent).toBe("queued|stale");
    expect(latest.error).toBe("Failed to fetch");
    api.get.mockResolvedValueOnce(record("RUNNING", "RUNNING"));
    await act(async () => { await vi.advanceTimersByTimeAsync(6200); });
    await flush();
    expect(container.textContent).toBe("running|live");
    expect(latest.error).toBeNull();
  });

  it("ignores a response that arrives after a newer one", async () => {
    rememberSubmission("p1", "v1", "calc-1");
    const slow = deferred<CalculationDetail>();
    api.get.mockReturnValueOnce(slow.promise);
    await act(async () => { root.render(createElement(Probe)); });
    await flush();
    api.get.mockResolvedValueOnce(record("SUCCEEDED", "SUCCEEDED"));
    await act(async () => { latest.refetch(); });
    await flush();
    expect(latest.view?.key).toBe("succeeded");
    await act(async () => { slow.resolve(record("QUEUED", "READY")); });
    await flush();
    expect(latest.view?.key).toBe("succeeded");
  });

  it("stops polling once the record is terminal", async () => {
    rememberSubmission("p1", "v1", "calc-1");
    api.get.mockResolvedValue(record("FAILED", "FAILED"));
    await act(async () => { root.render(createElement(Probe)); });
    await flush();
    const calls = api.get.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.get.mock.calls.length).toBe(calls);
    expect(latest.terminal).toBe(true);
  });

  it("tells the rest of the workspace when the state changes, but not on every poll", async () => {
    const heard = vi.fn();
    window.addEventListener("chemdft:workspace-items-changed", heard);
    rememberSubmission("p1", "v1", "calc-1");
    api.get.mockResolvedValue(record("QUEUED", "READY"));
    await act(async () => { root.render(createElement(Probe)); });
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    await flush();
    expect(heard).not.toHaveBeenCalled();
    api.get.mockResolvedValue(record("RUNNING", "RUNNING"));
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    await flush();
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("chemdft:workspace-items-changed", heard);
  });

  it("dismissing a finished job forgets the pointer but never calls the API", async () => {
    rememberSubmission("p1", "v1", "calc-1");
    api.get.mockResolvedValue(record("CANCELED", "CANCELED"));
    await act(async () => { root.render(createElement(Probe)); });
    await flush();
    await act(async () => { latest.dismiss(); });
    expect(latest.view).toBeNull();
    expect(sessionStorage.getItem("chemdft:guided-submission:p1:v1")).toBeNull();
    expect(api.cancel).not.toHaveBeenCalled();
  });
});
