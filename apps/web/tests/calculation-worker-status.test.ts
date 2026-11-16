// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GeometryEligibility, StructureVersionDetail } from "@chemdft/schemas";
import { CalculationPanel } from "../src/app/[locale]/projects/[projectId]/workspace/calculation-panel";

const api = vi.hoisted(() => ({ eligibility: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/structure-workspace-api", () => ({
  getCalculationEligibility: api.eligibility,
  submitCalculation: api.submit,
  getCalculation: vi.fn(), cancelCalculation: vi.fn(), downloadCalculationArtifact: vi.fn(),
  listCalculationCapabilities: vi.fn().mockResolvedValue([
    { engine: "crest", version: "3.0.2+pf8c-ewinfix-a1", availability: "AVAILABLE", supported_tasks: ["CONFORMER_SEARCH"], supported_methods: ["gfn2"] },
  ]),
  listStructures: vi.fn().mockResolvedValue([]), listStructureVersions: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/use-calculation-capabilities", () => ({
  useCalculationCapabilities: () => ({
    capabilities: [
      { engine: "pyscf", availability: "AVAILABLE", supported_tasks: ["ENERGY"], supported_methods: ["hf"], supported_basis_sets: ["sto-3g"] },
      { engine: "xtb", availability: "AVAILABLE", supported_tasks: ["ENERGY"], supported_methods: ["gfn2"], supported_basis_sets: [] },
    ], loading: false, error: null, refresh: vi.fn(),
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


function decision(): GeometryEligibility {
  return { structure_version_id: "version-1", eligible: true, code: "GEOMETRY_VALID", detail: "Geometry check" };
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

function detail(state: string, workerStatus: string | null) {
  return {
    calculation: { id: "calc-1", state },
    specification: { engine_preference: { engine: "pyscf" }, task_type: "ENERGY", method: { identifier: "hf" }, basis: { identifier: "sto-3g" } },
    compute_job: { id: "cdbaeaa2-0000", state: state === "QUEUED" ? "READY" : "SUCCEEDED", provider: "aws", attempt_count: 0, estimate: null, worker_status: workerStatus },
    calculation_input_hash: "f50eab1b32f7ed7d0000000000000000",
    result: null, attempt: null, optimization_trajectory: null,
  };
}
async function submitWith(value: unknown) {
  api.eligibility.mockResolvedValue(decision());
  api.submit.mockResolvedValue(value);
  await act(async () => {
    root.render(createElement(CalculationPanel, {
      projectId: "project-1", structureVersionId: "version-1", charge: 0, multiplicity: 1,
      structureOrigin: "IMPORTED", periodic: false, structure,
    }));
  });
  const run = [...container.querySelectorAll("button")].find((b) => b.textContent === "Run energy") as HTMLButtonElement;
  await act(async () => { run.click(); });
}

describe("on-demand worker status", () => {
  it("shows why a waiting AWS calculation has not started", async () => {
    await submitWith(detail("QUEUED", "The AWS worker is starting for your calculation; it stays queued until it is ready."));
    const row = container.querySelector('[data-testid="calculation-worker-status"]');
    expect(row?.getAttribute("role")).toBe("status");
    expect(row?.textContent).toContain("The AWS worker is starting for your calculation");
  });
  it("shows nothing when there is no worker status or the calculation is finished", async () => {
    await submitWith(detail("QUEUED", null));
    expect(container.querySelector('[data-testid="calculation-worker-status"]')).toBeNull();
  });
  it("hides a stale status once the calculation is terminal", async () => {
    await submitWith(detail("SUCCEEDED", "leftover text"));
    expect(container.querySelector('[data-testid="calculation-worker-status"]')).toBeNull();
  });
});
