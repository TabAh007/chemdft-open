import { describe, expect, it } from "vitest";
import type { CalculationDetail, EngineCapabilityView } from "@chemdft/schemas";
import { guidedStages, structureStageDone, type StageFacts } from "../src/lib/guided-stages";
import { guidedJobPollMs, presentGuidedJob, READY_EXPLANATION } from "../src/lib/guided-job-status";
import { classifyEngineChoice, methodSupported, roleCanExecute } from "../src/lib/guided-capability-state";
import { draftKey, inputsKey, loadDraft, loadInputs, parseChargeInput, saveDraft, saveInputs, type GuidedDraft } from "../src/lib/guided-draft";
import { buildGuidedSubmission, type CalculationConfig } from "../src/lib/guided-calculation";
import { ENGINE_INFO, methodDescription } from "../src/lib/guided-engine-info";

// ---------------------------------------------------------------------------------------------------------------
// Stage model: Structure → Configure → Review & Submit
// ---------------------------------------------------------------------------------------------------------------
const facts = (over: Partial<StageFacts> = {}): StageFacts => ({
  current: "structure", hasStructure: true, geometryEligible: true, geometryReason: null, inputsConfirmed: true,
  configIssues: [], canExecute: true, acknowledged: true, job: null, ...over,
});

describe("guided stages", () => {
  it("has exactly three stages", () => {
    expect(guidedStages(facts()).steps.map((s) => s.label)).toEqual(["Structure", "Configure", "Review & Submit"]);
  });

  it("never completes the Structure stage because a structure merely exists", () => {
    expect(structureStageDone({ hasStructure: true, geometryEligible: true, inputsConfirmed: false })).toBe(false);
    expect(structureStageDone({ hasStructure: true, geometryEligible: null, inputsConfirmed: true })).toBe(false);
    expect(structureStageDone({ hasStructure: true, geometryEligible: true, inputsConfirmed: true })).toBe(true);
    expect(structureStageDone({ hasStructure: true, geometryEligible: true, inputsConfirmed: true, chargeEntered: false })).toBe(false);
    const { steps } = guidedStages(facts({ current: "configure", inputsConfirmed: false }));
    expect(steps.find((s) => s.id === "structure")!.state).toBe("available");
  });

  it("treats an empty charge as not entered and blocks confirmation", () => {
    const unconfirmed = guidedStages(facts({ inputsConfirmed: false, chargeEntered: false }));
    expect(unconfirmed.primary).toMatchObject({
      kind: "confirm-inputs",
      disabledReason: "Enter a total charge first.",
    });
    const configure = guidedStages(facts({ current: "configure", chargeEntered: false, inputsConfirmed: false }));
    expect(configure.primary.disabledReason).toBe("Enter a total charge on the Structure stage.");
    const review = guidedStages(facts({ current: "review", chargeEntered: false, inputsConfirmed: false }));
    expect(review.primary.disabledReason).toBe("Enter a total charge on the Structure stage.");
  });

  it("offers exactly one primary action per state", () => {
    expect(guidedStages(facts({ inputsConfirmed: false })).primary).toMatchObject({ kind: "confirm-inputs", disabledReason: null });
    expect(guidedStages(facts()).primary).toMatchObject({ kind: "to-configure" });
    expect(guidedStages(facts({ geometryEligible: false, geometryReason: "Raw 2D drawing." })).primary).toMatchObject({ kind: "fix-geometry" });
    expect(guidedStages(facts({ geometryEligible: null })).primary).toMatchObject({ kind: "wait", disabledReason: "Checking calculation eligibility…" });
    expect(guidedStages(facts({ current: "configure", configIssues: ["xTB: worker unavailable"] })).primary).toMatchObject({ kind: "to-review", disabledReason: "xTB: worker unavailable" });
    expect(guidedStages(facts({ current: "review" })).primary).toMatchObject({ kind: "submit", disabledReason: null });
  });

  it("explains what blocks submission, in the order a researcher can act on it", () => {
    const review = (over: Partial<StageFacts>) => guidedStages(facts({ current: "review", ...over })).primary.disabledReason;
    expect(review({ canExecute: false })).toMatch(/role/);
    expect(review({ inputsConfirmed: false })).toMatch(/Confirm charge and multiplicity/);
    expect(review({ geometryEligible: false, geometryReason: "No 3D." })).toBe("No 3D.");
    expect(review({ configIssues: ["Basis not supported"] })).toBe("Basis not supported");
    expect(review({ acknowledged: false })).toMatch(/confirmation above/);
  });

  it("replaces the submit action with job actions once a job exists", () => {
    const job = (key: string, terminal: boolean, resultId: string | null = null) => ({ key, terminal, resultId });
    const primary = (j: ReturnType<typeof job>) => guidedStages(facts({ current: "review", job: j })).primary;
    expect(primary(job("queued", false)).kind).toBe("view-jobs");
    expect(primary(job("running", false)).kind).toBe("view-jobs");
    expect(primary(job("succeeded", true, "r1")).kind).toBe("open-result");
    expect(primary(job("failed", true)).kind).toBe("edit-configuration");
    expect(primary(job("canceled", true)).kind).toBe("edit-configuration");
  });

  it("blocks later stages only when there is no structure", () => {
    const { steps } = guidedStages(facts({ hasStructure: false }));
    expect(steps.map((s) => s.state)).toEqual(["current", "blocked", "blocked"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Job status presenter
// ---------------------------------------------------------------------------------------------------------------
type Over = { calc?: string; job?: string | null; execution?: Record<string, unknown> | null; result?: boolean; jobExtra?: Record<string, unknown> };
function detail(over: Over = {}): CalculationDetail {
  const execution = over.execution === undefined ? null : over.execution;
  return {
    calculation: { id: "calc-1", project_id: "p", input_id: "i", state: over.calc ?? "QUEUED", created_at: "2026-10-18T10:00:00", updated_at: "2026-10-18T10:00:05", created_by: "u" },
    calculation_input_hash: "a".repeat(64),
    specification: { method: { identifier: "hf", display_name: "HF" }, charge: 0, multiplicity: 1, task_type: "ENERGY", engine_preference: { engine: "pyscf" } },
    compute_job: over.job === null ? null : {
      id: "job-1", state: over.job ?? "READY", created_at: "2026-10-18T10:00:01", updated_at: "2026-10-18T10:00:09", latest_execution: execution, ...over.jobExtra,
    },
    result: over.result ? { id: "res-1" } : null,
  } as unknown as CalculationDetail;
}
const NOW = Date.parse("2026-10-18T10:05:00Z");
const present = (over: Over, canWrite = true) => presentGuidedJob(detail(over), { nowMs: NOW, canWrite });

describe("guided job status", () => {
  it("explains what READY means and never calls it running", () => {
    const view = present({ calc: "QUEUED", job: "READY" });
    expect(view).toMatchObject({ key: "queued", label: "Queued", active: true, terminal: false, calculationState: "QUEUED", jobState: "READY" });
    expect(view.meaning).toBe(READY_EXPLANATION);
    expect(view.meaning).toMatch(/does not mean running/);
  });

  it("distinguishes each lifecycle state from the persisted records", () => {
    expect(present({ calc: "DRAFT", job: null }).key).toBe("submitted");
    expect(present({ calc: "VALIDATED", job: null }).key).toBe("awaiting-authorization");
    expect(present({ calc: "AUTHORIZED", job: null }).key).toBe("authorized");
    expect(present({ calc: "QUEUED", job: "PENDING" }).key).toBe("queued");
    expect(present({ calc: "RUNNING", job: "LEASED" }).key).toBe("starting");
    expect(present({ calc: "RUNNING", job: "RUNNING", execution: { state: "RUNNING", started_at: "2026-10-18T10:04:00Z" } }).key).toBe("running");
    expect(present({ calc: "RUNNING", job: "CANCEL_REQUESTED" }).key).toBe("cancelling");
    expect(present({ calc: "SUCCEEDED", job: "SUCCEEDED", result: true })).toMatchObject({ key: "succeeded", terminal: true, resultId: "res-1" });
    expect(present({ calc: "FAILED", job: "FAILED", execution: { state: "FAILED", failure_code: "ENGINE_CRASHED", diagnostic: "SCF diverged" } })).toMatchObject({ key: "failed", terminal: true });
    expect(present({ calc: "CANCELED", job: "CANCELED" })).toMatchObject({ key: "canceled", terminal: true });
    expect(present({ calc: "RUNNING", job: "RUNNING", execution: { state: "LOST" } }).key).toBe("lost");
  });

  it("reports the failure exactly as recorded", () => {
    const view = present({ calc: "FAILED", job: "FAILED", execution: { state: "FAILED", failure_code: "ENGINE_CRASHED", diagnostic: "SCF diverged" } });
    expect(view.failure).toBe("engine crashed — SCF diverged");
  });

  it("flags disagreeing records instead of picking one silently", () => {
    const view = present({ calc: "RUNNING", job: "READY" });
    expect(view.key).toBe("queued");
    expect(view.discrepancy).toMatch(/calculation record says RUNNING.*READY/);
    expect(present({ calc: "FAILED", job: "RUNNING" }).discrepancy).toMatch(/still says RUNNING/);
    expect(present({ calc: "QUEUED", job: "READY" }).discrepancy).toBeNull();
  });

  it("shows a finished job whose calculation record is not finalized as finalizing", () => {
    expect(present({ calc: "RUNNING", job: "SUCCEEDED" })).toMatchObject({ key: "finalizing", active: true });
  });

  it("invents no progress, queue position or ETA", () => {
    const view = present({ calc: "RUNNING", job: "RUNNING", execution: { state: "RUNNING", started_at: "2026-10-18T10:04:00Z" } });
    expect(view.progress).toBeNull();
    expect(Object.keys(view)).not.toContain("eta");
    expect(Object.keys(view)).not.toContain("queuePosition");
  });

  it("derives elapsed time only from a recorded execution start", () => {
    expect(present({ calc: "QUEUED", job: "READY" }).runtimeSeconds).toBeNull();
    const view = present({ calc: "RUNNING", job: "RUNNING", execution: { state: "RUNNING", started_at: "2026-10-18T10:04:00Z" } });
    expect(view.runtimeSeconds).toBe(60);
    expect(view.runtimeText).toBe("1 min 0 s");
  });

  it("reports the newest recorded update, not the browser clock", () => {
    const view = present({ calc: "RUNNING", job: "RUNNING", execution: { state: "RUNNING", started_at: "2026-10-18T10:04:00Z", heartbeat_at: "2026-10-18T10:04:30Z" } });
    expect(view.lastRecordedUpdate?.iso).toBe("2026-10-18T10:04:30Z");
  });

  it("offers cancellation only when it is meaningful and permitted", () => {
    expect(present({ calc: "QUEUED", job: "READY" }).cancel.offered).toBe(true);
    expect(present({ calc: "QUEUED", job: "READY" }, false)).toMatchObject({ cancel: { offered: false } });
    expect(present({ calc: "QUEUED", job: "READY" }, false).cancel.reason).toMatch(/role/);
    expect(present({ calc: "RUNNING", job: "CANCEL_REQUESTED" }).cancel.offered).toBe(false);
    for (const calc of ["SUCCEEDED", "FAILED", "CANCELED"]) expect(present({ calc, job: calc }).cancel.offered).toBe(false);
  });

  it("polls fast while active, backs off on failures, and stops when terminal or hidden", () => {
    const active = present({ calc: "QUEUED", job: "READY" });
    const done = present({ calc: "SUCCEEDED", job: "SUCCEEDED" });
    expect(guidedJobPollMs(active, true, 0)).toBe(3000);
    expect(guidedJobPollMs(active, true, 2)).toBe(12000);
    expect(guidedJobPollMs(active, true, 9)).toBe(30000);
    expect(guidedJobPollMs(active, false, 0)).toBeNull();
    expect(guidedJobPollMs(done, true, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Capability states
// ---------------------------------------------------------------------------------------------------------------
const cap = (over: Partial<EngineCapabilityView> = {}): EngineCapabilityView => ({
  engine: "pyscf", availability: "AVAILABLE", supported_tasks: ["ENERGY"], supported_methods: ["hf", "b3lyp"], supported_basis_sets: ["sto-3g"], ...over,
}) as EngineCapabilityView;
const base = { engine: "pyscf", task: "ENERGY", capabilities: [cap()], capabilityError: null, loading: false, canExecute: true };

describe("engine choice classification", () => {
  it("is selectable when the contract says so", () => {
    expect(classifyEngineChoice(base)).toMatchObject({ kind: "selectable", selectable: true });
  });
  it("separates the seven reasons an engine cannot simply be used", () => {
    expect(classifyEngineChoice({ ...base, missingInputs: ["charge confirmation"] })).toMatchObject({ kind: "missing-inputs", selectable: true });
    expect(classifyEngineChoice({ ...base, capabilities: [cap({ availability: "UNAVAILABLE", diagnostic: "no worker" })] })).toMatchObject({ kind: "worker-unavailable", reason: "no worker", selectable: false });
    expect(classifyEngineChoice({ ...base, capabilities: [] })).toMatchObject({ kind: "unknown" });
    expect(classifyEngineChoice({ ...base, capabilities: [cap({ engine: "xtb" })] })).toMatchObject({ kind: "worker-unavailable" });
    expect(classifyEngineChoice({ ...base, task: "TDDFT" })).toMatchObject({ kind: "unsupported-method" });
    expect(classifyEngineChoice({ ...base, restriction: "Psi4 supports neutral molecules only." })).toMatchObject({ kind: "unsupported-method", reason: "Psi4 supports neutral molecules only." });
    expect(classifyEngineChoice({ ...base, capabilityError: "Engine capabilities expired. Refresh availability before submitting." })).toMatchObject({ kind: "expired", selectable: false });
    expect(classifyEngineChoice({ ...base, capabilityError: "HTTP 502" })).toMatchObject({ kind: "unknown", reason: "HTTP 502" });
    expect(classifyEngineChoice({ ...base, loading: true, capabilities: [] })).toMatchObject({ kind: "unknown" });
    expect(classifyEngineChoice({ ...base, canExecute: false })).toMatchObject({ kind: "no-permission", selectable: false });
  });
  it("checks method and basis only against the reported lists", () => {
    expect(methodSupported(cap(), "hf", "sto-3g", true)).toBeNull();
    expect(methodSupported(cap(), "mp2", "sto-3g", true)).toMatch(/MP2/);
    expect(methodSupported(cap(), "hf", "cc-pvdz", true)).toMatch(/CC-PVDZ/);
    expect(methodSupported(undefined, "hf", null, false)).toMatch(/not available/);
  });
  it("mirrors the server role mapping", () => {
    expect(roleCanExecute("owner")).toBe(true);
    expect(roleCanExecute("EDITOR")).toBe(true);
    expect(roleCanExecute("viewer")).toBe(false);
    expect(roleCanExecute(null)).toBe(false);
  });
});

describe("engine descriptions", () => {
  it("state the real scope of each engine", () => {
    expect(ENGINE_INFO.xtb!.summary).toMatch(/semi-empirical/);
    expect(ENGINE_INFO.xtb!.caveat).toMatch(/ab initio/);
    expect(ENGINE_INFO.psi4!.caveat).toMatch(/H, C and O/);
    expect(ENGINE_INFO.pyscf!.summary).toMatch(/Hartree–Fock and density-functional/);
    expect(methodDescription("mp2")).toMatch(/electron correlation/);
    expect(methodDescription("unknown-functional")).toMatch(/as reported by the engine/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Draft persistence
// ---------------------------------------------------------------------------------------------------------------
function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}
describe("guided draft", () => {
  const draft: GuidedDraft = { engine: "pyscf", method: "hf", basis: "sto-3g", convergence: "1e-9", maxSteps: 100, nstates: 10 };
  it("round-trips the task draft and keys it by project, version and task", () => {
    const storage = memoryStorage();
    const key = draftKey("p", "v", "energy");
    expect(key).not.toBe(draftKey("p", "v", "optimization"));
    saveDraft(key, draft, storage);
    expect(loadDraft(key, storage)).toEqual(draft);
  });
  it("keeps charge/multiplicity confirmation once per structure version", () => {
    const storage = memoryStorage();
    const key = inputsKey("p", "v");
    saveInputs(key, { charge: 0, multiplicity: 1, confirmed: true }, storage);
    expect(loadInputs(key, storage)).toEqual({ charge: 0, multiplicity: 1, confirmed: true });
    expect(loadInputs(inputsKey("p", "other"), storage)).toBeNull();
  });
  it("ignores malformed or missing stored values and never throws", () => {
    const storage = memoryStorage();
    storage.setItem("bad", "{not json");
    storage.setItem("shape", JSON.stringify({ engine: "magic" }));
    expect(loadDraft("bad", storage)).toBeNull();
    expect(loadDraft("shape", storage)).toBeNull();
    expect(loadInputs("shape", storage)).toBeNull();
    expect(loadDraft("absent", storage)).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadDraft("x", throwing)).toBeNull();
    expect(() => saveDraft("x", draft, throwing)).not.toThrow();
  });
  it("parses empty or whitespace charge as not entered (null), never silently 0", () => {
    expect(parseChargeInput("")).toBeNull();
    expect(parseChargeInput("   ")).toBeNull();
    expect(parseChargeInput("0")).toBe(0);
    expect(parseChargeInput("-1")).toBe(-1);
    expect(parseChargeInput("+2")).toBe(2);
    expect(parseChargeInput("abc")).toBeNull();
  });
  it("refuses to load an unentered charge that claims to be confirmed", () => {
    const storage = memoryStorage();
    const key = inputsKey("p", "v");
    storage.setItem(key, JSON.stringify({ charge: null, multiplicity: 1, confirmed: true }));
    expect(loadInputs(key, storage)).toBeNull();
    storage.setItem(key, JSON.stringify({ charge: null, multiplicity: 1, confirmed: false }));
    expect(loadInputs(key, storage)).toEqual({ charge: null, multiplicity: 1, confirmed: false });
  });

  it("with null charge no config/submit path produces charge 0", () => {
    const validConfig: CalculationConfig = {
      engine: "pyscf",
      method: "hf",
      basis: "sto-3g",
      charge: 0,
      multiplicity: 1,
      convergence: 1e-9,
      taskType: "ENERGY",
    };
    // Explicit 0 produces charge 0
    const explicitZero = buildGuidedSubmission("p", "v", validConfig);
    expect(explicitZero.specification.charge).toBe(0);

    // Null or undefined charge throws and NEVER produces charge 0
    expect(() => buildGuidedSubmission("p", "v", { ...validConfig, charge: null as unknown as number })).toThrow(
      /valid integer charge/i,
    );
    expect(() => buildGuidedSubmission("p", "v", { ...validConfig, charge: undefined as unknown as number })).toThrow(
      /valid integer charge/i,
    );
  });
});
