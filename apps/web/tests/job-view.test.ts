import { describe, expect, it } from "vitest";
import type { ComputeJobView } from "@chemdft/schemas";
import {
  anyJobActive, calculationWorkspacePath, describeWorkload, formatRuntime, jobFailure, plainFailure, jobPhase, jobRuntimeSeconds,
} from "../src/lib/job-view";
import { parseWorkspaceSelection } from "../src/lib/workspace-selection";

// Shapes follow a real GET /compute/jobs response for the accepted Psi4 HF/STO-3G job; values are presentation fixtures.
const execution = (over: Record<string, unknown> = {}) => ({
  id: "e1", state: "FINISHED", worker_id: "local.psi4.worker", started_at: "2026-10-11T05:54:44.576154",
  finished_at: "2026-10-11T05:54:55.870920", metering: { runtime_ms: 11250 }, failure_code: null, diagnostic: null, ...over,
});
const job = (state: string, over: Record<string, unknown> = {}, exec: Record<string, unknown> | null = {}): ComputeJobView => ({
  id: "c26b9011-ced0-4977-85ed-345f7b457d15", calculation_id: "a03745aa-840d-4854-8d6e-2d272a4474d3",
  workload: { workload_type: "chemdft.psi4.energy.v1" }, state, latest_execution: exec === null ? null : execution(exec), ...over,
}) as unknown as ComputeJobView;

describe("workload labels", () => {
  it.each([
    ["chemdft.psi4.energy.v1", "Psi4", "Single-point energy"],
    ["chemdft.pyscf.frequency.v1", "PySCF", "Vibrational frequencies"],
    ["chemdft.xtb.optimization.v1", "xTB", "Geometry optimization"],
    ["chemdft.crest.conformer-search.v1", "CREST", "Conformer search"],
    ["chemdft.dftd4.correction.v1", "DFT-D4", "D4 dispersion correction"],
  ])("%s", (type, engine, task) => {
    expect(describeWorkload(type)).toMatchObject({ engine, task, recognized: true });
  });
  it("never guesses an unknown workload", () => {
    expect(describeWorkload("chemdft.newengine.energy.v1")).toEqual({ engine: "Unrecognized engine", task: "chemdft.newengine.energy.v1", recognized: false });
  });
});

describe("job phase and runtime", () => {
  it("maps compute states without inventing progress", () => {
    expect(jobPhase(job("PENDING")).label).toBe("Queued");
    expect(jobPhase(job("RUNNING")).active).toBe(true);
    expect(jobPhase(job("CANCEL_REQUESTED")).label).toBe("Cancelling");
    expect(jobPhase(job("SUCCEEDED"))).toMatchObject({ label: "Succeeded", active: false, intent: "success" });
    expect(jobPhase(job("CANCELED")).active).toBe(false);
  });
  it("surfaces a lost execution as a failure while the job is not terminal", () => {
    const phase = jobPhase(job("RUNNING", {}, { state: "LOST" }));
    expect(phase).toMatchObject({ key: "lost", intent: "danger" });
  });
  it("uses metered runtime when finished and elapsed time while running", () => {
    expect(jobRuntimeSeconds(job("SUCCEEDED"), 0)).toBe(11.25);
    const running = job("RUNNING", {}, { metering: null, finished_at: null, started_at: "2026-10-11T05:54:44.000000" });
    const t0 = Date.parse("2026-10-11T05:54:44Z");
    expect(jobRuntimeSeconds(running, t0 + 30_000)).toBe(30);
    expect(jobRuntimeSeconds(job("PENDING", {}, null), 0)).toBeNull();
  });
  it("formats runtimes", () => {
    expect(formatRuntime(null)).toBe("—");
    expect(formatRuntime(11.25)).toBe("11 s");
    expect(formatRuntime(4.04)).toBe("4.0 s");
    expect(formatRuntime(125)).toBe("2 min 5 s");
  });
});

describe("failure reporting and polling", () => {
  it("reports only what the provider returned", () => {
    expect(jobFailure(job("SUCCEEDED"))).toBeNull();
    expect(jobFailure(job("FAILED", {}, { state: "FAILED", failure_code: "PROVIDER_TIMEOUT", diagnostic: "Runtime limit 180 s exceeded" })))
      .toBe("provider timeout — Runtime limit 180 s exceeded");
    expect(jobFailure(job("FAILED", {}, null))).toBe("No failure detail was reported by the compute provider.");
  });
  it("polls only while some job is active", () => {
    expect(anyJobActive([job("SUCCEEDED"), job("FAILED"), job("CANCELED")])).toBe(false);
    expect(anyJobActive([job("SUCCEEDED"), job("READY")])).toBe(true);
  });
});

describe("deep link to a calculation", () => {
  it("round-trips through the workspace selection parser", () => {
    const calc = "a03745aa-840d-4854-8d6e-2d272a4474d3";
    const project = "902b3f21-4105-41cf-8cda-f2ae7a177aff";
    const path = calculationWorkspacePath("en", project, calc);
    expect(path.startsWith(`/en/projects/${project}/workspace?`)).toBe(true);
    expect(parseWorkspaceSelection(path.split("?")[1]!, project)).toEqual({ kind: "calculation", id: calc, projectId: project });
  });
});

describe("release 0.0.45 labels and failure wording", () => {
  it("names Quantum ESPRESSO jobs instead of an unrecognized engine", () => {
    expect(describeWorkload("chemdft.qe.periodic-energy.v1")).toEqual({ engine: "Quantum ESPRESSO", task: "Quantum ESPRESSO periodic energy (PBE+U)", recognized: true });
    expect(describeWorkload("chemdft.pyscf.periodic-energy.v1")).toMatchObject({ engine: "PySCF", task: "Periodic energy", recognized: true });
  });
  it("explains a session that is too short", () => {
    expect(plainFailure("ENGINE_UNAVAILABLE", "AWS_SESSION_EXPIRING: not enough session time for this job")).toBe(
      "Not enough time is left in the AWS session for this job. Please run it again; a new session starts automatically.");
  });
  it("names the DOS step when the file size limit stopped it", () => {
    const text = plainFailure(null, "pw.x nscf (DOS mesh) stopped with exit code 153 ... mpirun noticed that process rank 1 ... exited on signal 25 (File size limit exceeded)");
    expect(text).toContain("The DOS step wrote a file larger than the per-file size limit");
  });
  it("explains a lost heartbeat", () => {
    expect(plainFailure("LEASE_EXPIRED", "Worker heartbeat deadline expired.")).toContain("heartbeat lost");
  });
  it("explains a QE result that does not match the engine log (0.0.46)", () => {
    expect(plainFailure("RESULT_VALIDATION_FAILED", "Quantum ESPRESSO candidate energy contradicts the retained native log.")).toBe(
      "The relaxed result could not be confirmed against the engine log; nothing was published. The raw engine log is available below.");
  });
  it("explains a hosted worker that fails to start within 30 s, and only then (0.0.46)", () => {
    const text = "worker_error:KeyError:\"LibXCFunctional: name 'U' not found.\"";
    expect(plainFailure("SUBMISSION_FAILED", text, 10)).toContain("hosted periodic PySCF worker failed to start");
    expect(plainFailure("SUBMISSION_FAILED", text, 600)).toBeNull();
    expect(plainFailure("SUBMISSION_FAILED", text)).toBeNull();
  });
  it("leaves unknown failures exactly as reported", () => {
    expect(plainFailure("RESULT_VALIDATION_FAILED", "something else")).toBeNull();
    const job = { state: "FAILED", latest_execution: { state: "FAILED", failure_code: "RESULT_VALIDATION_FAILED", diagnostic: "something else" } } as unknown as ComputeJobView;
    expect(jobFailure(job)).toBe("result validation failed — something else");
  });
});
