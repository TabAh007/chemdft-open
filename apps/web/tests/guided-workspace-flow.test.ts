// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CalculationDetail, StructureVersionDetail } from "@chemdft/schemas";
import { GuidedHost } from "./helpers/guided-host";
import { inputsKey, saveInputs } from "../src/lib/guided-draft";

const api = vi.hoisted(() => ({ eligibility: vi.fn(), submit: vi.fn(), get: vi.fn(), cancel: vi.fn(), list: vi.fn(), role: vi.fn(), refresh: vi.fn() }));
const caps = vi.hoisted(() => [
  { engine: "pyscf", version: "2.14.0", availability: "AVAILABLE", supported_tasks: ["ENERGY"], supported_methods: ["hf"], supported_basis_sets: ["sto-3g"] },
  { engine: "xtb", version: "6.7.1", availability: "AVAILABLE", supported_tasks: ["ENERGY"], supported_methods: ["gfn2"], supported_basis_sets: [] },
]);
vi.mock("@/lib/structure-workspace-api", () => ({
  getCalculationEligibility: api.eligibility, submitCalculation: api.submit, getCalculation: api.get, cancelCalculation: api.cancel, listComputeJobs: api.list,
  listCalculationCapabilities: vi.fn(),
}));
vi.mock("@/lib/use-calculation-capabilities", () => ({
  useCalculationCapabilities: () => ({ capabilities: caps, loading: false, error: null, refresh: api.refresh }),
}));
vi.mock("@chemdft/ui", () => ({ AppIcon: () => null }));
vi.mock("@/app/_components/help/help-tip", () => ({ HelpTip: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/project-api", () => ({ getProject: () => api.role() }));
vi.mock("../src/app/_components/guided/guided-viewer", () => ({ GuidedViewer: (): ReactNode => null }));

const structure = {
  structure: { id: "structure-1", project_id: "project-1", name: "H2", kind: "MOLECULE" },
  version: {
    id: "version-1", structure_id: "structure-1", revision: 1, origin: "IMPORTED", overall_charge: 0, multiplicity: 1,
    coordinates: { coordinate_system: "CARTESIAN", unit: "angstrom", atoms: [
      { index: 0, atomic_number: 1, element: "H", x: 0, y: 0, z: 0 }, { index: 1, atomic_number: 1, element: "H", x: 0, y: 0, z: 0.74 },
    ] },
  },
} as unknown as StructureVersionDetail;

const water = {
  structure: { id: "structure-1", project_id: "project-1", name: "Water", kind: "MOLECULE" },
  version: {
    id: "version-1", structure_id: "structure-1", revision: 1, origin: "IMPORTED", overall_charge: 0, multiplicity: 1,
    coordinates: { coordinate_system: "CARTESIAN", unit: "angstrom", atoms: [
      { index: 0, atomic_number: 8, element: "O", x: 0, y: 0, z: 0 }, { index: 1, atomic_number: 1, element: "H", x: 0, y: 0, z: 0.96 },
      { index: 2, atomic_number: 1, element: "H", x: 0.93, y: 0, z: -0.24 },
    ] },
  },
} as unknown as StructureVersionDetail;

const accepted = (state = "QUEUED", job = "READY") => ({
  calculation: { id: "calc-1", state, updated_at: "2026-10-18T10:00:05" },
  calculation_input_hash: "c".repeat(64), specification: {},
  compute_job: { id: "job-1", state: job, created_at: "2026-10-18T10:00:01", updated_at: "2026-10-18T10:00:02", latest_execution: null },
}) as unknown as CalculationDetail;

let container: HTMLDivElement;
let root: Root;
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve(); }); };
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function mount(stage: "structure" | "configure" | "review" = "review", role = "owner", detail: StructureVersionDetail = structure) {
  api.role.mockResolvedValue({ id: "project-1", role });
  await act(async () => {
    root.render(createElement(GuidedHost, {
      projectId: "project-1", detail, task: "energy", onTask: vi.fn(), stage, onStage: vi.fn(),
      onHome: vi.fn(), onOpenEditor: vi.fn(), onOpenResult: vi.fn(),
    }));
  });
  await flush(6);
}
async function acknowledge() { await act(async () => { byId("setup-confirm-checkbox")!.click(); }); }

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(api)) fn.mockReset();
  api.eligibility.mockResolvedValue({ structure_version_id: "version-1", eligible: true, code: "GEOMETRY_VALID", detail: "ok" });
  api.list.mockResolvedValue({ jobs: [] });
  api.refresh.mockResolvedValue(caps);
  api.get.mockResolvedValue(accepted());
  sessionStorage.clear();
  saveInputs(inputsKey("project-1", "version-1"), { charge: 0, multiplicity: 1, confirmed: true });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("Review & Submit", () => {
  it("shows the exact configuration and enables the single primary action only after explicit confirmation", async () => {
    await mount();
    const run = byId("run-calculation-btn") as HTMLButtonElement;
    expect(byId("review-configuration")!.textContent).toContain("GFN2-xTB");
    expect(byId("review-configuration")!.textContent).toContain("version-1");
    expect(run.disabled).toBe(true);
    await acknowledge();
    expect(run.disabled).toBe(false);
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("withdraws the acknowledgement when the reviewed configuration changes", async () => {
    await mount();
    await acknowledge();
    expect((byId("setup-confirm-checkbox") as HTMLInputElement).checked).toBe(true);
    expect((byId("run-calculation-btn") as HTMLButtonElement).disabled).toBe(false);
    // The researcher goes back and chooses a different calculation: the earlier confirmation covered another configuration.
    await act(async () => {
      root.render(createElement(GuidedHost, {
        projectId: "project-1", detail: structure, task: "optimization", onTask: vi.fn(), stage: "review", onStage: vi.fn(),
        onHome: vi.fn(), onOpenEditor: vi.fn(), onOpenResult: vi.fn(),
      }));
    });
    await flush(6);
    expect((byId("setup-confirm-checkbox") as HTMLInputElement).checked).toBe(false);
    expect((byId("run-calculation-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("submits once even when the button is clicked repeatedly, then replaces the form with the job status", async () => {
    const pending = (() => { let resolve!: (v: CalculationDetail) => void; const promise = new Promise<CalculationDetail>((r) => { resolve = r; }); return { promise, resolve }; })();
    api.submit.mockReturnValue(pending.promise);
    await mount();
    await acknowledge();
    const run = byId("run-calculation-btn") as HTMLButtonElement;
    await act(async () => { run.click(); run.click(); run.click(); });
    await flush();
    expect(api.submit).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(accepted()); });
    await flush(6);
    expect(byId("guided-job-panel")).not.toBeNull();
    expect(byId("run-calculation-btn")).toBeNull();
    expect(byId("guided-job-state")!.textContent).toBe("Queued");
    expect(byId("guided-job-facts")!.textContent).toContain("READY");
    expect(byId("guided-primary-view-jobs")).not.toBeNull();
    expect(sessionStorage.getItem("chemdft:guided-submission:project-1:version-1")).toBe("calc-1");
  });

  it("shows a plain sentence for a coded submit error and keeps the raw code under Details", async () => {
    api.submit.mockRejectedValueOnce(new Error("ELECTRONIC_STATE_PARITY_INVALID: Electron count and multiplicity have an impossible parity relationship"));
    await mount();
    await acknowledge();
    await act(async () => { (byId("run-calculation-btn") as HTMLButtonElement).click(); });
    await flush();
    const box = byId("submit-error")!;
    expect(box.querySelector("span")!.textContent).toMatch(/cannot exist for these atoms/);
    expect(box.querySelector("span")!.textContent).not.toContain("ELECTRONIC_STATE_PARITY_INVALID");
    expect(byId("submit-error-details")!.textContent).toContain("ELECTRONIC_STATE_PARITY_INVALID");
  });

  it("reuses the idempotency key when the same configuration is re-sent after a failure", async () => {
    api.submit.mockRejectedValueOnce(new Error("network lost")).mockResolvedValueOnce(accepted());
    await mount();
    await acknowledge();
    await act(async () => { (byId("run-calculation-btn") as HTMLButtonElement).click(); });
    await flush();
    expect(byId("submit-error")!.textContent).toContain("network lost");
    await act(async () => { (byId("run-calculation-btn") as HTMLButtonElement).click(); });
    await flush(6);
    expect(api.submit).toHaveBeenCalledTimes(2);
    expect(api.submit.mock.calls[0]![1].idempotency_key).toBe(api.submit.mock.calls[1]![1].idempotency_key);
  });

  it("re-reads engine availability before submitting and refuses when it can no longer be read", async () => {
    await mount();
    await acknowledge();
    api.refresh.mockRejectedValueOnce(new Error("HTTP 502"));
    await act(async () => { (byId("run-calculation-btn") as HTMLButtonElement).click(); });
    await flush();
    expect(api.submit).not.toHaveBeenCalled();
    expect(byId("submit-error")!.textContent).toContain("nothing was submitted");
  });

  it("refuses when the fresh capabilities say the engine is gone", async () => {
    await mount();
    await acknowledge();
    api.refresh.mockResolvedValueOnce([{ ...caps[1], availability: "UNAVAILABLE", diagnostic: "worker offline" }]);
    await act(async () => { (byId("run-calculation-btn") as HTMLButtonElement).click(); });
    await flush();
    expect(api.submit).not.toHaveBeenCalled();
    expect(byId("submit-error")!.textContent).toContain("worker offline");
  });

  it("does not let a viewer submit", async () => {
    await mount("review", "viewer");
    await acknowledge();
    const run = byId("run-calculation-btn") as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(container.textContent).toContain("Your project role cannot submit calculations");
  });

  it("requires the researcher to confirm charge and multiplicity before submitting", async () => {
    saveInputs(inputsKey("project-1", "version-1"), { charge: 0, multiplicity: 1, confirmed: false });
    await mount();
    await acknowledge();
    expect((byId("run-calculation-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("Confirm charge and multiplicity");
  });
});

describe("in-flight job after a reload", () => {
  it("restores the recorded job state and offers cancellation only while it is meaningful", async () => {
    sessionStorage.setItem("chemdft:guided-submission:project-1:version-1", "calc-1");
    api.get.mockResolvedValue(accepted("RUNNING", "RUNNING"));
    await mount("review");
    expect(byId("guided-job-state")!.textContent).toBe("Running");
    expect(byId("guided-cancel-job")).not.toBeNull();
    expect(byId("run-calculation-btn")).toBeNull();
  });

  it("hides cancellation from a viewer and explains why", async () => {
    sessionStorage.setItem("chemdft:guided-submission:project-1:version-1", "calc-1");
    api.get.mockResolvedValue(accepted());
    await mount("review", "viewer");
    expect(byId("guided-cancel-job")).toBeNull();
    expect(byId("guided-job-cancel-note")!.textContent).toMatch(/role cannot cancel/);
  });

  it("cancelling asks first and only then calls the API", async () => {
    sessionStorage.setItem("chemdft:guided-submission:project-1:version-1", "calc-1");
    api.get.mockResolvedValue(accepted());
    api.cancel.mockImplementation(async () => { api.get.mockResolvedValue(accepted("CANCELED", "CANCELED")); return accepted("CANCELED", "CANCELED"); });
    await mount("review");
    await act(async () => { byId("guided-cancel-job")!.click(); });
    expect(api.cancel).not.toHaveBeenCalled();
    expect(byId("guided-job-cancel-confirm")!.textContent).toContain("draft settings are not affected");
    await act(async () => { byId("guided-job-cancel-yes")!.click(); });
    await flush(6);
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(byId("guided-job-state")!.textContent).toBe("Canceled");
  });

  it("shows a terminal failure with the recorded reason and no re-run button until the researcher edits", async () => {
    sessionStorage.setItem("chemdft:guided-submission:project-1:version-1", "calc-1");
    const failed = accepted("FAILED", "FAILED");
    (failed.compute_job as unknown as { latest_execution: unknown }).latest_execution = { state: "FAILED", failure_code: "ENGINE_CRASHED", diagnostic: "SCF diverged" };
    api.get.mockResolvedValue(failed);
    await mount("review");
    expect(byId("guided-job-failure")!.textContent).toContain("SCF diverged");
    expect(byId("guided-primary-edit-configuration")).not.toBeNull();
    expect(byId("run-calculation-btn")).toBeNull();
  });
});

describe("Structure stage", () => {
  it("does not treat an imported structure as reviewed or its electronic state as confirmed", async () => {
    saveInputs(inputsKey("project-1", "version-1"), { charge: 0, multiplicity: 1, confirmed: false });
    await mount("structure");
    expect(byId("structure-review-state")!.textContent).toBe("Not reviewed");
    expect(byId("inputs-unconfirmed")).not.toBeNull();
    expect(byId("guided-primary-confirm-inputs")!.textContent).toBe("Confirm charge & multiplicity");
  });

  it("treats an empty charge as not entered (never silently 0) and blocks confirmation", async () => {
    saveInputs(inputsKey("project-1", "version-1"), { charge: 0, multiplicity: 1, confirmed: false });
    await mount("structure");
    const chargeInput = container.querySelector("#gw-charge") as HTMLInputElement;
    expect(chargeInput.value).toBe("0");

    const setCharge = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(chargeInput, value);
        chargeInput.dispatchEvent(new Event("input", { bubbles: true }));
        chargeInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await flush(4);
    };

    // Clear the charge input to simulate emptying it
    await setCharge("");

    expect(chargeInput.value).toBe("");
    expect(byId("inputs-unconfirmed")).not.toBeNull();
    expect(byId("charge-empty-hint")!.textContent).toContain("Enter the overall electric charge");
    const confirmBtn = byId("guided-primary-confirm-inputs") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    expect(container.querySelector("#gw-primary-reason")!.textContent).toBe("Enter a total charge first.");

    // Enter 0 explicitly: restores 0 and allows confirmation
    await setCharge("0");

    expect(chargeInput.value).toBe("0");
    expect(byId("charge-empty-hint")).toBeNull();
    expect(confirmBtn.disabled).toBe(false);
  });

  it("with null charge no config/submit path produces charge 0", async () => {
    saveInputs(inputsKey("project-1", "version-1"), { charge: null, multiplicity: 1, confirmed: false });
    await mount("review", "owner", water);
    const runBtn = byId("run-calculation-btn") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    await act(async () => { runBtn.click(); });
    expect(api.submit).not.toHaveBeenCalled();
  });
});

describe("Impossible electronic state (F8)", () => {
  const stored = (charge: number, multiplicity: number, confirmed = true) =>
    saveInputs(inputsKey("project-1", "version-1"), { charge, multiplicity, confirmed });

  it("blocks confirmation on the Structure stage and names the structure by its formula", async () => {
    stored(1, 1, false);
    await mount("structure", "owner", water);
    const alert = byId("electronic-state-impossible")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("H2O with total charge +1 has 9 electrons");
    expect(alert.textContent).toContain("Use multiplicity 2, 4, 6, 8");
    expect((byId("guided-primary-confirm-inputs") as HTMLButtonElement).disabled).toBe(true);
    expect(byId("electronic-state-no-impossibility")).toBeNull();
    expect(container.textContent).not.toMatch(/\bvalid\b/i);
  });

  it("does not let an earlier confirmation survive: Review fails the check and Run stays disabled", async () => {
    stored(1, 1, true);
    await mount("review", "owner", water);
    const row = byId("review-checks")!.querySelector('li[data-ok="false"]')!;
    expect(row.textContent).toContain("Electronic state is impossible");
    expect(byId("review-checks")!.textContent).not.toContain("confirmed");
    await acknowledge();
    expect((byId("run-calculation-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("says only that no impossibility was found once the state fits, and then allows Run", async () => {
    stored(1, 2, true);
    await mount("review", "owner", water);
    expect(byId("electronic-state-impossible")).toBeNull();
    await acknowledge();
    expect((byId("run-calculation-btn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the no-impossibility note on the Structure stage for a fitting state", async () => {
    stored(0, 1, false);
    await mount("structure", "owner", water);
    expect(byId("electronic-state-no-impossibility")!.textContent).toContain("10 electrons: no impossibility found");
  });
});
