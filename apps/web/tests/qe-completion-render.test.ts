import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useParams: () => ({ locale: "en" }), useRouter: () => ({ push: vi.fn() }) }));

import { EnergyPrecisionPlate } from "../src/app/[locale]/projects/[projectId]/workspace/visualization/energy-precision-plate";

const qeScf = {
  payload_schema: "chemdft.periodic-energy",
  engine: "qe",
  task_type: "PERIODIC_ENERGY",
  cutoffs_ry: { ecutwfc: 45, ecutrho: 540 },
  u_effective_ev: { Cr: 2.0 },
  local_magnetic_moments: { "0": -3.0028, "1": -3.0028, "2": 3.0028, "3": 3.0028 },
  total_magnetization: 0,
  absolute_magnetization: 12.0,
  fermi_energy_ev: 12.95961,
  band_gap_ev: 0.0,
  k_mesh: [1, 1, 1],
};

function render(props: Record<string, unknown>) {
  return renderToString(
    createElement(EnergyPrecisionPlate, { projectId: "p", calculationId: "c", energyValue: -476.0906515824172, energyUnit: "Eh", method: "pbe+u", engineName: "qe", compact: true, ...props } as never),
  );
}

describe("QE periodic result renders when a job completes", () => {
  it("renders the stored Cr2O3 payload", () => {
    const html = render({ rawPayload: qeScf, scfIterations: 16, converged: true });
    expect(html).toContain("Quantum ESPRESSO");
  });
  it("does not throw on a completion payload with missing or null optional parts", () => {
    for (const rawPayload of [
      { ...qeScf, local_magnetic_moments: null, u_effective_ev: null, cutoffs_ry: null, k_mesh: null, relaxation: null, dos: null, bands: null },
      { ...qeScf, local_magnetic_moments: { "0": null }, fermi_energy_ev: null },
      { payload_schema: "chemdft.periodic-energy", engine: "qe" },
    ]) {
      expect(() => render({ rawPayload })).not.toThrow();
    }
  });
});
