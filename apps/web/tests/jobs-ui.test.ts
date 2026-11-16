// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComputeJobView, JobDiagnostics } from "@chemdft/schemas";

const api = vi.hoisted(() => ({ diagnostics: vi.fn(), log: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/analysis-api", () => ({ getJobDiagnostics: api.diagnostics, getJobLog: api.log }));
vi.mock("@/lib/structure-workspace-api", () => ({ downloadCalculationArtifact: api.download }));
vi.mock("@/lib/download", () => ({ saveBlob: vi.fn() }));
vi.mock("@chemdft/ui", () => ({ AppIcon: () => null, StatusTag: ({ children }: { children: ReactNode }) => createElement("span", { className: "tag" }, children) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("../src/app/_components/scientific-log-view", () => ({ ScientificLogView: () => null }));

import { JobInspector } from "../src/app/_components/jobs/job-inspector";
import { JobsLibrary, type LibraryProps } from "../src/app/_components/jobs/jobs-library";
import { QueueStrip } from "../src/app/_components/jobs/queue-strip";

let n = 0;
const money = (minor_units: number) => ({ currency: "USD", minor_units });
const job = (state: string, over: Record<string, unknown> = {}): ComputeJobView => ({
  id: `job-id-${++n}`, calculation_id: `calc-${n}`, workload: { workload_type: "chemdft.pyscf.energy.v1" }, provider: "local", state, attempt_count: 0,
  created_at: "2026-10-11T05:54:44", updated_at: "2026-10-11T05:55:44", latest_execution: null, estimate: null, reservation: null, worker_status: null,
  specification_summary: { task_type: "ENERGY", method: "hf", basis: "sto-3g", charge: 0, multiplicity: 1 },
  structure_summary: { structure_id: "s1", structure_name: "Ethanol", structure_version_id: "v1", structure_revision: 2, formula_hill: "C2H6O", atom_count: 9 },
  ...over,
}) as unknown as ComputeJobView;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.diagnostics.mockResolvedValue({
    job_id: "j", job_state: "SUCCEEDED", executions: [], attempts: [], heartbeat_status: "NOT_APPLICABLE", heartbeat_age_seconds: null,
    heartbeat_stale_after_seconds: 60, progress_reported: false, progress_note: "No trustworthy percent-complete.", logs_available: false,
  } as unknown as JobDiagnostics);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const text = () => container.textContent ?? "";
const byId = (id: string) => container.querySelectorAll(`[data-testid="${id}"]`);

function libraryProps(over: Partial<LibraryProps> & { jobs: ComputeJobView[] | null }): LibraryProps {
  const jobs = over.jobs;
  return {
    shown: jobs ?? [], limit: 100, selectedId: null, now: Date.parse("2026-10-11T06:00:00Z"), filter: "all", provider: null, providers: [], q: "",
    loadError: false, onFilter: vi.fn(), onProvider: vi.fn(), onSearch: vi.fn(), onSelect: vi.fn(), onMore: vi.fn(), ...over,
  };
}
async function mountLibrary(props: LibraryProps) { await act(async () => { root.render(createElement(JobsLibrary, props)); }); }
async function mountInspector(selected: ComputeJobView, extra: Partial<Parameters<typeof JobInspector>[0]> = {}) {
  await act(async () => {
    root.render(createElement(JobInspector, { projectId: "p", locale: "en", job: selected, now: Date.parse("2026-10-11T06:00:00Z"), canWrite: true, cancelling: false, onCancel: vi.fn(), onReuse: vi.fn(), ...extra }));
  });
  await flush();
}

describe("JobsLibrary", () => {
  it("says it is loading, and that loading failed, without showing a table", async () => {
    await mountLibrary(libraryProps({ jobs: null }));
    expect(text()).toContain("Loading compute jobs…");
    await mountLibrary(libraryProps({ jobs: null, loadError: true }));
    expect(text()).toContain("Jobs could not be loaded.");
    expect(byId("job-row")).toHaveLength(0);
  });
  it("tells an empty project from an empty filter", async () => {
    await mountLibrary(libraryProps({ jobs: [] }));
    expect(text()).toContain("No compute jobs yet.");
    await mountLibrary(libraryProps({ jobs: [job("RUNNING")], shown: [] }));
    expect(text()).toContain("No jobs match these filters.");
  });
  it("shows state counts on the chips, structure, formula, provider and a never-invented runtime", async () => {
    const jobs = [job("RUNNING", { provider: "aws" }), job("FAILED", { latest_execution: { state: "FAILED", failure_code: "ENGINE_FAILED", diagnostic: "SCF did not converge" } }), job("READY")];
    await mountLibrary(libraryProps({ jobs, providers: ["aws", "local"] }));
    const chip = (key: string) => container.querySelector(`[data-testid="jobs-filter-chip"][data-filter="${key}"]`)!.textContent;
    expect(chip("all")).toContain("3");
    expect(chip("active")).toContain("2");
    expect(chip("failed")).toContain("1");
    expect(text()).toContain("Ethanol");
    expect(text()).toContain("C2H6O");
    expect(byId("job-row-failure")[0]!.textContent).toBe("engine failed — SCF did not converge");
    expect(Array.from(byId("job-row-provider")).map((el) => el.textContent)).toEqual(["AWS", "Local", "Local"]);
    expect(text()).toContain("not started");
    expect(text()).not.toMatch(/\d+\s?%/);
  });
  it("offers a provider filter only when there is more than one provider", async () => {
    await mountLibrary(libraryProps({ jobs: [job("READY")], providers: ["local"] }));
    expect(byId("jobs-provider-filter")).toHaveLength(0);
    await mountLibrary(libraryProps({ jobs: [job("READY")], providers: ["aws", "local"] }));
    expect(byId("jobs-provider-filter")).toHaveLength(1);
  });
  it("renders one page and offers the rest", async () => {
    const jobs = Array.from({ length: 130 }, () => job("SUCCEEDED"));
    const onMore = vi.fn();
    await mountLibrary(libraryProps({ jobs, limit: 100, onMore }));
    expect(byId("job-row")).toHaveLength(100);
    expect(byId("jobs-more")[0]!.textContent).toContain("30 of 30");
    await act(async () => { (byId("jobs-more")[0] as HTMLButtonElement).click(); });
    expect(onMore).toHaveBeenCalled();
  });
  it("selects a job from the keyboard-reachable row button and marks the current one", async () => {
    const jobs = [job("READY"), job("SUCCEEDED")];
    const onSelect = vi.fn();
    await mountLibrary(libraryProps({ jobs, selectedId: jobs[1]!.id, onSelect }));
    expect(byId("job-select")[1]!.getAttribute("aria-current")).toBe("true");
    expect(byId("job-select")[0]!.getAttribute("aria-current")).toBeNull();
    await act(async () => { (byId("job-select")[0] as HTMLButtonElement).click(); });
    expect(onSelect).toHaveBeenCalledWith(jobs[0]!.id);
  });
});

describe("JobInspector", () => {
  it("shows the waiting reason, provider, and a labelled estimate and reservation as the server reported them", async () => {
    await mountInspector(job("READY", {
      provider: "aws", worker_status: "The AWS worker is starting.",
      estimate: { runtime_low_seconds: 20, runtime_high_seconds: 150, cost_low: money(8), cost_high: money(22), confidence: "MEDIUM", provider_summary: "EC2", assumptions: ["Default grid"], valid_until: "2026-10-11T07:00:00" },
      reservation: { state: "RESERVED", authorized_max: money(100), actual_cost: null },
    }));
    expect(byId("job-worker-status")[0]!.textContent).toBe("The AWS worker is starting.");
    expect(byId("job-provider")[0]!.textContent).toBe("AWS");
    const estimate = byId("job-estimate")[0]!.textContent!;
    expect(estimate).toContain("Estimated runtime20 s to 2 min 30 s");
    expect(estimate).toContain("Estimated cost$0.08 to $0.22");
    expect(estimate).toContain("Estimate confidencemedium");
    expect(byId("job-reservation")[0]!.textContent).toContain("Authorized maximum$1.00");
    expect(byId("job-reservation")[0]!.textContent).toContain("Actual costnot reconciled yet");
    expect(text()).toContain("not charges");
    expect(text()).not.toMatch(/\d+\s?%/);
  });
  it("says so when no estimate or reservation was recorded and no worker status exists", async () => {
    await mountInspector(job("PENDING"));
    expect(byId("job-estimate-none")[0]!.textContent).toBe("No estimate recorded for this job.");
    expect(text()).toContain("No reservation recorded for this job.");
    expect(byId("job-worker-status")).toHaveLength(0);
    expect(text()).toContain("no worker has taken this job yet");
  });
  it("names the structure and links to it; a job without structure says so", async () => {
    await mountInspector(job("SUCCEEDED"));
    expect(byId("job-inspector")[0]!.textContent).toContain("Ethanol");
    expect(byId("job-inspector")[0]!.textContent).toContain("version 2");
    expect(byId("job-open-structure")[0]!.getAttribute("href")).toContain("workspace?selection=");
    expect(byId("job-open")[0]!.textContent).toBe("Open result");
    await mountInspector(job("PENDING", { structure_summary: null }));
    expect(text()).toContain("Structure not recorded");
    expect(byId("job-open-structure")).toHaveLength(0);
    expect(byId("job-open")[0]!.textContent).toBe("Open calculation");
  });
  it("offers Cancel and Reuse only to a writer, and Cancel only while the job can still be cancelled", async () => {
    const onCancel = vi.fn();
    await mountInspector(job("RUNNING"), { onCancel });
    await act(async () => { (byId("job-cancel")[0] as HTMLButtonElement).click(); });
    expect(onCancel).toHaveBeenCalled();
    expect(byId("job-reuse")).toHaveLength(1);
    await mountInspector(job("CANCEL_REQUESTED"));
    expect(byId("job-cancel")).toHaveLength(0);
    await mountInspector(job("SUCCEEDED"));
    expect(byId("job-cancel")).toHaveLength(0);
    await mountInspector(job("RUNNING"), { canWrite: false });
    expect(byId("job-cancel")).toHaveLength(0);
    expect(byId("job-reuse")).toHaveLength(0);
    expect(byId("job-open")).toHaveLength(1);
    await mountInspector(job("RUNNING"), { canWrite: null });
    expect(byId("job-cancel")).toHaveLength(0);
  });
  it("shows the recorded failure and a lost execution, and the diagnostics note about progress", async () => {
    await mountInspector(job("FAILED", { latest_execution: { state: "FAILED", failure_code: "PROVIDER_TIMEOUT", diagnostic: "Runtime limit 180 s exceeded", metering: null } }));
    expect(byId("job-failure")[0]!.textContent).toBe("provider timeout — Runtime limit 180 s exceeded");
    expect(byId("job-progress-note")[0]!.textContent).toContain("percent-complete");
    await mountInspector(job("RUNNING", { latest_execution: { state: "LOST", metering: null } }));
    expect(text()).toContain("Execution lost");
  });
  it("shows provider cost only when the provider reported it", async () => {
    const reservation = { state: "RELEASED", authorized_max: money(100), actual_cost: money(11) };
    await mountInspector(job("SUCCEEDED", { reservation, latest_execution: { state: "FINISHED", metering: { provider_cost: money(11), provider_cost_status: "AVAILABLE" } } }));
    expect(byId("job-reservation")[0]!.textContent).toContain("Cost reported by provider$0.11");
    await mountInspector(job("SUCCEEDED", { reservation, latest_execution: { state: "FINISHED", metering: { provider_cost: null, provider_cost_status: "UNKNOWN" } } }));
    expect(byId("job-reservation")[0]!.textContent).toContain("Cost reported by providernot reported by the provider");
  });
});

describe("QueueStrip", () => {
  it("keeps the queue counts and the honest caveats in the DOM", async () => {
    const queue = {
      counts: { queued: 2, leased: 0, running: 1, cancel_requested: 0, succeeded: 3, failed: 1, canceled: 0 }, oldest_queued_at: "2026-10-11T05:54:44",
      active: [{ job_id: "abcdef1234567890", calculation_id: "c", job_state: "RUNNING", worker_id: "w1", heartbeat_age_seconds: 400, heartbeat_status: "STALE" }],
      notice: "ChemDFT cannot observe a worker process.",
    };
    const onSelectJob = vi.fn();
    await act(async () => { root.render(createElement(QueueStrip, { queue: queue as never, onSelectJob })); });
    expect(byId("queue-queued")[0]!.textContent).toBe("2");
    expect(byId("queue-running")[0]!.textContent).toBe("1");
    expect(text()).toContain("cannot observe a worker");
    expect(text()).toContain("No percent-complete is shown");
    expect(byId("queue-active")[0]!.textContent).toContain("heartbeat overdue");
    await act(async () => { (byId("queue-active")[0]!.querySelector("button") as HTMLButtonElement).click(); });
    expect(onSelectJob).toHaveBeenCalledWith("abcdef1234567890");
  });
});

describe("Jobs code stays read-only and honest", () => {
  const dir = join(__dirname, "..", "src", "app", "_components", "jobs");
  const files = readdirSync(dir).filter((name) => /\.(tsx|ts)$/.test(name)).map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
  it("reads the source it is checking", () => expect(files.length).toBeGreaterThanOrEqual(5));
  it("makes no direct network write and generates nothing", () => {
    for (const { name, text: source } of files) {
      expect(source, name).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
      expect(source, name).not.toMatch(/\bfetch\(/);
      expect(source, name).not.toMatch(/Math\.random|faker|crypto\.randomUUID/);
    }
  });
  it("never computes a progress figure, ETA or cost", () => {
    for (const { name, text: source } of files) {
      expect(source, name).not.toMatch(/\bprogress(?:Percent|Fraction)|\beta\b|\* 100\b|toFixed\(\d\)\s*\+\s*["']%/i);
    }
  });
});
