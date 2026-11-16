import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalculationDetail } from "@chemdft/schemas";
import { buildGuidedSubmission } from "../src/lib/guided-calculation";
import { selectedPublishedResult } from "../src/lib/calculation-result-association";
import { EnergyPrecisionPlate } from "../src/app/[locale]/projects/[projectId]/workspace/visualization/energy-precision-plate";

vi.mock("@chemdft/ui", () => ({ AppIcon: () => null, StatusTag: ({ children }: { children: string }) => children }));
const config = { engine: "pyscf", method: "b3lyp", basis: "sto-3g", charge: 0, multiplicity: 1, convergence: 2e-8, taskType: "ENERGY" as const };
describe("actual Guided submission builder", () => {
  it("preserves backend method identifiers, immutable input and the displayed SCF threshold", () => {
    for (const method of ["hf", "b3lyp", "pbe"]) {
      const request = buildGuidedSubmission("project", "version", { ...config, method });
      expect(request.structure_version.entity_id).toBe("version");
      expect(request.specification.method.identifier).toBe(method);
      expect(request.specification.scf?.convergence_threshold).toBe(2e-8);
    }
  });
  it("uses xTB without user basis or an unsupported SCF override", () => {
    const request = buildGuidedSubmission("project", "version", { ...config, engine: "xtb", method: "gfn2", basis: null });
    expect(request.specification.basis).toBeNull();
    expect(request.specification.scf).toBeUndefined();
    expect(request.specification.engine_preference.engine).toBe("xtb");
  });
  it("rejects unsupported xTB tasks and invalid convergence", () => {
    expect(() => buildGuidedSubmission("p", "v", { ...config, engine: "xtb", taskType: "FREQUENCY" })).toThrow(/does not support/i);
    expect(() => buildGuidedSubmission("p", "v", { ...config, convergence: NaN })).toThrow(/positive/);
  });
});
describe("native optimization submission", () => {
  it("preserves registry settings and rejects incomplete native settings", () => {
    const options = { optimizer: "xtb-ancopt" as const, xtb_level: "normal" as const, max_steps: 27 };
    const request = buildGuidedSubmission("p", "immutable-v", { ...config, engine: "xtb", method: "gfn2", basis: null, taskType: "GEOMETRY_OPTIMIZATION", allowedVersion: "6.7.1", optimizationOptions: options });
    expect(request.specification.optimization).toEqual(options);
    expect(request.specification.engine_preference).toEqual({engine: "xtb", allowed_version: "6.7.1"});
    expect(request.specification.basis).toBeNull();
    expect(request.specification.scf).toBeUndefined();
    expect(() => buildGuidedSubmission("p", "v", { ...config, engine: "xtb", taskType: "GEOMETRY_OPTIMIZATION" })).toThrow(/ANCopt/);
  });
});
describe("selected published result boundary", () => {
  const detail = { calculation: { id: "calc", input_id: "input" }, result: { id: "result", calculation_id: "calc", calculation_input_id: "input" } } as CalculationDetail;
  it("accepts only the requested calculation/result and matching immutable input", () => {
    expect(selectedPublishedResult(detail, "calc", "result")).toBe(true);
    expect(selectedPublishedResult(detail, "other", "result")).toBe(false);
    expect(selectedPublishedResult(detail, "calc", "other")).toBe(false);
    expect(selectedPublishedResult({ ...detail, result: { ...detail.result!, calculation_input_id: "other" } }, "calc", "result")).toBe(false);
  });
});
describe("actual Energy Precision Plate rendering", () => {
  it("labels total energy and derived conversions and exposes result identity", () => {
    const html = renderToStaticMarkup(createElement(EnergyPrecisionPlate, { projectId: "p", calculationId: "c", resultId: "r", structureVersionId: "v", engineName: "xtb", method: "gfn2", energyValue: -1, energyUnit: "Eh", validationState: "VALIDATED" }));
    expect(html).toContain("Total Energy (E_tot)");
    expect(html).not.toContain("Total Electronic Energy");
    expect(html).toContain("Derived conversions:");
    expect(html).toContain('data-result-id="r"');
    expect(html).toContain('data-structure-version-id="v"');
    expect(html).toContain("Convergence not reported");
  });
  it("does not convert an unknown native unit as though it were Hartree", () => {
    const html = renderToStaticMarkup(createElement(EnergyPrecisionPlate, { projectId: "p", energyValue: -1, energyUnit: "eV" }));
    expect(html).not.toContain("Derived conversions:");
  });
});
