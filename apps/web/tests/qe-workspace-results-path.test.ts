// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GeometryEligibility, StructureVersionDetail } from "@chemdft/schemas";
import { citationFacts } from "../src/lib/calculation-citation";
import { EnergyPrecisionPlate } from "../src/app/[locale]/projects/[projectId]/workspace/visualization/energy-precision-plate";
import { CalculationPanel } from "../src/app/[locale]/projects/[projectId]/workspace/calculation-panel";

const api = vi.hoisted(() => ({ eligibility: vi.fn(), submit: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/structure-workspace-api", () => ({
  getCalculationEligibility: api.eligibility,
  submitCalculation: api.submit,
  getCalculation: api.get, cancelCalculation: vi.fn(), downloadCalculationArtifact: vi.fn(),
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



/** Real worker payload of a QE 7.6 Cr2O3 PBE+U job (presentation regression only; not scientific evidence). It has NO `method`-less schema fields the old code assumed. */
const REAL: Record<string, unknown> = {"absolute_magnetization":12.43643969262243,"band_gap_ev":2.8962551435251753,"converged":true,"engine":"qe","fermi_energy_ev":12.95961025354059,"local_magnetic_moments":{"0":-3.0028,"1":-3.0028,"2":3.0028,"3":3.0028},"scf_iterations":16,"total_energy_hartree":-476.0906515824172,"u_effective_ev":{"Cr":2.0},
  payload_schema: "chemdft.periodic-energy", total_energy: { value: -476.0906515824172, unit: { code: "Eh" } }, parser_version: "1", validator_version: "1" };
function detail(state: string, payload: Record<string, unknown> | null) {
  return {
    calculation: { id: "calc-1", state },
    specification: { engine_preference: { engine: "qe" }, task_type: "PERIODIC_ENERGY", method: { identifier: "pbe+u" }, basis: { identifier: "sssp-pbe-efficiency-v2.0" }, periodic: { k_mesh: [1, 1, 1], u_effective_ev: { Cr: 2.0 } } },
    compute_job: { id: "fd04736d-0000", state, provider: "aws", attempt_count: 1, estimate: null, worker_status: null },
    calculation_input_hash: "28e7d9a7fb8ff2b6",
    result: payload ? { id: "result-1", validation_state: "VALIDATED", result_type: "chemdft.periodic-energy", source_class: "CALCULATED", created_at: "2026-11-14T10:00:00Z",
      producer_software: { name: "Quantum ESPRESSO", version: "7.6" }, provenance_record_id: "prov-1", payload } : null,
    attempt: null, optimization_trajectory: null,
  };
}
describe("workspace results path with a real QE periodic payload", () => {
  it("RUNNING -> SUCCEEDED transition mounts Calculate panel + real plate + QE results without throwing", async () => {
    vi.useFakeTimers();
    try {
      api.eligibility.mockResolvedValue(decision());
      api.submit.mockResolvedValue(detail("RUNNING", null));
      api.get.mockResolvedValue(detail("SUCCEEDED", REAL));
      await act(async () => { root.render(createElement(CalculationPanel, { projectId: "project-1", structureVersionId: "version-1", charge: 0, multiplicity: 1, structureOrigin: "IMPORTED", periodic: false, structure })); });
      const run = [...container.querySelectorAll("button")].find((b) => b.textContent === "Run energy") as HTMLButtonElement;
      await act(async () => { run.click(); });
      expect(container.textContent).not.toContain("-476.0906515824");
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(api.get).toHaveBeenCalled();
      expect(container.textContent).toContain("-476.0906515824 Eh");
      expect(container.querySelector('[data-testid="qe-fermi"]')).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("EnergyPrecisionPlate tolerates null method, basis and engine name (QE payload fields passed through)", async () => {
    await act(async () => { root.render(createElement(EnergyPrecisionPlate, {
      projectId: "p", calculationId: "c", resultId: "r", method: null as unknown as string, basis: null, engineName: null as unknown as string,
      energyValue: -476.09, energyUnit: "Eh", rawPayload: REAL, sourceClass: "CALCULATED", validationState: "VALIDATED" })); });
    expect(container.textContent).toContain("-476.09");
  });
  it("citation/inspector facts build from the QE payload", () => {
    const facts = citationFacts(detail("SUCCEEDED", REAL) as never);
    expect(facts.periodic).not.toBeNull();
  });
});
