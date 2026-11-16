// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GeometryEligibility, StructureVersionDetail } from "@chemdft/schemas";
import { useGeometryEligibility } from "../src/lib/use-geometry-eligibility";
import { CalculationPanel } from "../src/app/[locale]/projects/[projectId]/workspace/calculation-panel";
import { GuidedHost } from "./helpers/guided-host";
import { inputsKey, saveInputs } from "../src/lib/guided-draft";
import { ConformerSearchPanel } from "../src/app/_components/conformers/conformer-search-panel";

const api = vi.hoisted(() => ({ eligibility: vi.fn(), submit: vi.fn() }));
const caps = vi.hoisted(() => [
  { engine: "pyscf", availability: "AVAILABLE", supported_tasks: ["ENERGY"], supported_methods: ["hf"], supported_basis_sets: ["sto-3g"] },
  { engine: "xtb", availability: "AVAILABLE", supported_tasks: ["ENERGY"], supported_methods: ["gfn2"], supported_basis_sets: [] },
]);
vi.mock("@/lib/structure-workspace-api", () => ({
  getCalculationEligibility: api.eligibility,
  submitCalculation: api.submit,
  getCalculation: vi.fn(), cancelCalculation: vi.fn(), downloadCalculationArtifact: vi.fn(), listComputeJobs: vi.fn().mockResolvedValue({ jobs: [] }),
  listCalculationCapabilities: vi.fn().mockResolvedValue([
    { engine: "crest", version: "3.0.2+pf8c-ewinfix-a1", availability: "AVAILABLE", supported_tasks: ["CONFORMER_SEARCH"], supported_methods: ["gfn2"] },
  ]),
  listStructures: vi.fn().mockResolvedValue([]), listStructureVersions: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/use-calculation-capabilities", () => ({
  useCalculationCapabilities: () => ({
    capabilities: caps, loading: false, error: null, refresh: vi.fn().mockResolvedValue(caps),
  }),
}));
vi.mock("@chemdft/ui", () => ({
  AppIcon: () => null,
  StatusTag: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  ActionButton: ({ text, disabled, onClick, "data-testid": testId }: {
    text: string; disabled?: boolean; onClick?: () => void; "data-testid"?: string;
  }) => createElement("button", { disabled, onClick, "data-testid": testId }, text),
}));
vi.mock("@/app/_components/help/help-tip", () => ({ HelpTip: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/project-api", () => ({ getProject: vi.fn().mockResolvedValue({ id: "project-1", role: "owner" }) }));
vi.mock("../src/app/_components/guided/guided-viewer", () => ({ GuidedViewer: () => null }));
vi.mock("@/app/_components/workspace-state-provider", () => ({
  useWorkspaceState: () => ({ openSelection: vi.fn() }),
}));
vi.mock("../src/app/[locale]/projects/[projectId]/workspace/visualization/energy-precision-plate", () => ({ EnergyPrecisionPlate: () => null }));

const structure = {
  structure: { id: "structure-1", project_id: "project-1", name: "Water", kind: "MOLECULE" },
  version: {
    id: "version-1", structure_id: "structure-1", revision: 1, origin: "IMPORTED",
    overall_charge: 0, multiplicity: 1,
    coordinates: { coordinate_system: "CARTESIAN", unit: "angstrom", atoms: [
      { index: 0, atomic_number: 8, element: "O", x: 0, y: 0, z: 0.1173 },
      { index: 1, atomic_number: 1, element: "H", x: 0, y: 0.7572, z: -0.4692 },
      { index: 2, atomic_number: 1, element: "H", x: 0, y: -0.7572, z: -0.4692 },
    ] },
  },
} as unknown as StructureVersionDetail;

function decision(versionId = "version-1", eligible = true): GeometryEligibility {
  return { structure_version_id: versionId, eligible, code: eligible ? "GEOMETRY_VALID" : "GEOMETRY_2D_REQUIRES_GENERATION", detail: "Geometry check" };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
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

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

describe.each(["advanced", "guided", "conformer"] as const)("%s submission eligibility", (mode) => {
  const runLabel = mode === "advanced" ? "Run energy" : mode === "conformer" ? "Start conformer search" : "Submit calculation";
  const submit = vi.fn();
  async function mount() {
    if (mode === "guided") saveInputs(inputsKey("project-1", "version-1"), { charge: 0, multiplicity: 1, confirmed: true });
    await act(async () => {
      root.render(mode === "advanced"
        ? createElement(CalculationPanel, {
          projectId: "project-1", structureVersionId: "version-1", charge: 0, multiplicity: 1,
          structureOrigin: "IMPORTED", periodic: false, structure,
        })
        : mode === "guided" ? createElement(GuidedHost, {
          projectId: "project-1", detail: structure, task: "energy", onTask: vi.fn(), stage: "review", onStage: vi.fn(),
          existingResult: { available: true, onView: vi.fn() }, onHome: vi.fn(), onOpenEditor: vi.fn(), onOpenResult: vi.fn(),
        }) : createElement(ConformerSearchPanel, {
          projectId: "project-1", structure, onOpenResult: vi.fn(), onOpenCalculation: vi.fn(),
        }));
    });
    if (mode === "guided") {
      for (let tick = 0; tick < 3; tick++) await act(async () => { await Promise.resolve(); });
      await act(async () => { (container.querySelector('[data-testid="setup-confirm-checkbox"]') as HTMLInputElement).click(); });
    }
    if (mode === "conformer") {
      await act(async () => { (container.querySelector('.conformer-confirm input') as HTMLInputElement).click(); });
    }
  }
  it("blocks pending and failed checks, preserves saved-result access, retries explicitly", async () => {
    const first = deferred<GeometryEligibility>();
    const retry = deferred<GeometryEligibility>();
    api.eligibility.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    await mount();
    expect(button(runLabel).disabled).toBe(true);
    expect(container.textContent).toContain("Checking calculation eligibility");
    await act(async () => { first.reject(new Error("Eligibility service unavailable")); });
    expect(button(runLabel).disabled).toBe(true);
    expect(container.textContent).toContain("Eligibility service unavailable");
    await act(async () => { button(runLabel).click(); });
    expect(api.submit).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
    expect(api.eligibility).toHaveBeenCalledTimes(1);
    await act(async () => { button("Retry eligibility check").click(); });
    expect(api.eligibility).toHaveBeenCalledTimes(2);
    expect(button(runLabel).disabled).toBe(true);
    await act(async () => { retry.resolve(decision()); });
    expect(button(runLabel).disabled).toBe(false);
  });
  it("keeps an explicit ineligible response blocked", async () => {
    api.eligibility.mockResolvedValueOnce(decision("version-1", false));
    await mount();
    expect(button(runLabel).disabled).toBe(true);
    expect(container.textContent).toContain("Geometry check");
  });
});

function Harness({ versionId, initial }: { versionId: string; initial?: GeometryEligibility }) {
  const state = useGeometryEligibility("project-1", "structure-1", versionId, initial);
  return createElement("div", null,
    createElement("button", { disabled: !state.eligible, "data-testid": "submit" }, "Submit"),
    createElement("p", null, state.error ?? (state.loading ? "Loading" : "Checked")),
  );
}
it("ignores a late response from the previous selected version", async () => {
  const old = deferred<GeometryEligibility>();
  const current = deferred<GeometryEligibility>();
  api.eligibility.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await act(async () => { root.render(createElement(Harness, { versionId: "version-1" })); });
  await act(async () => { root.render(createElement(Harness, { versionId: "version-2" })); });
  await act(async () => { old.resolve(decision()); });
  expect(button("Submit").disabled).toBe(true);
  await act(async () => { current.resolve(decision("version-2")); });
  expect(button("Submit").disabled).toBe(false);
});
it("revokes a previous successful check immediately when the version changes", async () => {
  api.eligibility.mockResolvedValueOnce(decision()).mockReturnValueOnce(new Promise(() => {}));
  await act(async () => { root.render(createElement(Harness, { versionId: "version-1" })); });
  expect(button("Submit").disabled).toBe(false);
  await act(async () => { root.render(createElement(Harness, { versionId: "version-2" })); });
  expect(button("Submit").disabled).toBe(true);
  expect(container.textContent).toContain("Loading");
});
it("rejects an eligibility response for the wrong immutable version", async () => {
  api.eligibility.mockResolvedValueOnce(decision("wrong-version"));
  await act(async () => { root.render(createElement(Harness, { versionId: "version-1" })); });
  expect(button("Submit").disabled).toBe(true);
  expect(container.textContent).toContain("does not match");
});
it("does not reuse provided eligibility belonging to another version", async () => {
  api.eligibility.mockReturnValueOnce(new Promise(() => {}));
  await act(async () => { root.render(createElement(Harness, { versionId: "version-2", initial: decision() })); });
  expect(button("Submit").disabled).toBe(true);
  expect(api.eligibility).toHaveBeenCalledTimes(1);
});
