// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { hostedLimit } from "../src/lib/hosted-limits";
import { periodicElementCoverage } from "../src/lib/basis-element-limits";
import { EnergyPrecisionPlate } from "../src/app/[locale]/projects/[projectId]/workspace/visualization/energy-precision-plate";

describe("Periodic calculation setup & limits", () => {
  it("enforces 20-atom limit for hosted periodic DFT", () => {
    const under = hostedLimit({
      task: "PERIODIC_ENERGY",
      engine: "pyscf",
      atomCount: 10,
      atomicNumbers: [24, 24, 24, 24, 8, 8, 8, 8, 8, 8],
      periodic: true,
    });
    expect(under.limit).toBe(20);
    expect(under.refusal).toBeNull();
    expect(under.note).toContain("20 atoms in the unit cell");

    const over = hostedLimit({
      task: "PERIODIC_ENERGY",
      engine: "pyscf",
      atomCount: 24,
      atomicNumbers: Array(24).fill(24),
      periodic: true,
    });
    expect(over.refusal).toContain("Hosted periodic DFT is limited to 20 atoms");
  });

  it("checks element coverage against PySCF GTH/MOLOPT basis (Z = 1..56 and 72..86)", () => {
    // Cr2O3 (Cr: Z=24, O: Z=8)
    const valid = periodicElementCoverage([24, 8]);
    expect(valid.usable).toBe(true);
    expect(valid.offending).toEqual([]);

    // La (Z=57, lanthanides not in standard GTH-DZVP-MOLOPT-SR)
    const invalid = periodicElementCoverage([24, 8, 57]);
    expect(invalid.usable).toBe(false);
    expect(invalid.offending).toEqual([57]);
  });

  it("renders periodic electronic structure, band gap, k-mesh and local moments on EnergyPrecisionPlate", async () => {
    const rawPayload = {
      payload_schema: "chemdft.periodic-energy",
      task_type: "PERIODIC_ENERGY",
      converged: true,
      total_energy: { value: -443.595453, unit: { code: "Eh" } },
      band_gap: { value: 3.8489, unit: { code: "eV" } },
      k_mesh: [1, 1, 1],
      magnetic_order: "antiferromagnetic",
      u_effective_ev: { Cr: 3.7 },
      total_magnetization: 0.0,
      local_magnetic_moments: { "Cr(1)": 3.11, "Cr(2)": -3.11, "Cr(3)": 3.11, "Cr(4)": -3.11 },
      scf_iterations: 25,
      runtime_seconds: 120.5,
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(EnergyPrecisionPlate, {
          projectId: "proj-1",
          calculationId: "calc-1",
          resultId: "res-1",
          calculationState: "SUCCEEDED",
          method: "pbe+u",
          basis: "gth-dzvp-molopt-sr",
          engineName: "pyscf",
          engineVersion: "2.14.0",
          energyValue: -443.595453,
          energyUnit: "Eh",
          converged: true,
          scfIterations: 25,
          rawPayload,
        }),
      );
    });

    const plate = container.querySelector('[data-testid="periodic-electronic-plate"]');
    expect(plate).not.toBeNull();
    expect(container.querySelector('[data-testid="periodic-band-gap"]')?.textContent).toContain("3.8489 eV");
    expect(container.querySelector('[data-testid="periodic-k-mesh"]')?.textContent).toContain("1×1×1");
    expect(container.querySelector('[data-testid="periodic-total-magnetization"]')?.textContent).toContain("0.0000 μB");
    expect(container.querySelector('[data-testid="periodic-local-moments"]')?.textContent).toContain("Cr(1): +3.110 μB");
    expect(container.querySelector('[data-testid="periodic-local-moments"]')?.textContent).toContain("Cr(2): -3.110 μB");
    expect(container.querySelector('[data-testid="periodic-u-effective"]')?.textContent).toContain("Cr: U_eff = 3.7 eV");
    expect(container.querySelector('[data-testid="mp2-decomposition-plate"]')).toBeNull();
  });
});
