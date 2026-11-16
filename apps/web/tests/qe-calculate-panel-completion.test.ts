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


// Regression: a real Quantum ESPRESSO periodic result has no `method` or `basis` key. The Calculate panel's summary row
// called energy.method.toUpperCase() the moment the job turned SUCCEEDED and crashed the whole workspace.
const qePayload = {
  payload_schema: "chemdft.periodic-energy", total_energy: { value: -476.0906515824172, unit: { code: "Eh" } },
  converged: true, scf_iterations: 16, parser_version: "1", validator_version: "1", engine: "qe",
  u_effective_ev: { Cr: 2.0 }, fermi_energy_ev: 12.95961025354059,
};
function succeeded(payload: Record<string, unknown>) {
  return {
    calculation: { id: "calc-1", state: "SUCCEEDED" },
    specification: { engine_preference: { engine: "qe" }, task_type: "PERIODIC_ENERGY", method: { identifier: "pbe+u" }, basis: { identifier: "sssp-pbe-efficiency-v2.0" } },
    compute_job: { id: "fd04736d-0000", state: "SUCCEEDED", provider: "aws", attempt_count: 1, estimate: null, worker_status: null },
    calculation_input_hash: "28e7d9a7fb8ff2b6",
    result: { id: "result-1", validation_state: "VALIDATED", result_type: "chemdft.periodic-energy", source_class: "CALCULATED",
      producer_software: { name: "Quantum ESPRESSO", version: "7.6" }, provenance_record_id: "prov-1", payload },
    attempt: null, optimization_trajectory: null,
  };
}
async function submitDetail(value: unknown) {
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
describe("completed QE periodic result in the Calculate panel", () => {
  it("renders a payload that has no method or basis", async () => {
    await submitDetail(succeeded(qePayload));
    expect(container.textContent).toContain("-476.0906515824 Eh");
    expect(container.textContent).toContain("Method / basis");
  });
  it("still renders when method and basis are explicitly null", async () => {
    await submitDetail(succeeded({ ...qePayload, method: null, basis: null }));
    expect(container.textContent).toContain("-476.0906515824 Eh");
  });
});
