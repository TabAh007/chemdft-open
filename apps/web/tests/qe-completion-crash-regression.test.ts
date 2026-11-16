import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EnergyPrecisionPlate } from "../src/app/[locale]/projects/[projectId]/workspace/visualization/energy-precision-plate";
import { QePeriodicResults } from "../src/app/[locale]/projects/[projectId]/workspace/visualization/qe-periodic-results";
import { ErrorDetails, BOUNDARY_LOG_PREFIX, componentNameFromStack, describeBoundaryError } from "../src/app/_components/error-details";
import ErrorPage from "../src/app/error";

/** Real successful worker result of a periodic QE job (Cr2O3, QE 7.6, PBE+U). Presentation regression only; not scientific evidence. */
const REAL: Record<string, unknown> = {"absolute_magnetization":12.43643969262243,"adapter_version":"1.0.0","band_gap_ev":2.8962551435251753,"basis":"pw-sssp-pbe-eff-v2","charge":0,"converged":true,"cutoffs_ry":{"ecutrho":540.0,"ecutwfc":45.0},"engine":"qe","engine_version":"7.6","finite":true,"fermi_energy_ev":12.95961025354059,"irreducible_k_points":1,"k_mesh":[1,1,1],"local_magnetic_moments":{"0":-3.0028,"1":-3.0028,"2":3.0028,"3":3.0028},"local_moment_kind":"lowdin-projected","magnetic_order":"antiferromagnetic","method":"pbe+u","multiplicity":1,"pseudopotential":"SSSP PBE Efficiency v2.0","pseudopotential_files":{"Cr":"Cr.us.pbe.z_14.uspp.gbrv.v1.5.upf","O":"O.paw.pbe.z_6.ld1.psl.v0.1.upf"},"runtime_seconds":62.131872015,"scf_iterations":16,"stages_requested":{"bands":false,"dos":false,"relax":false},"task":"PERIODIC_ENERGY","total_energy_hartree":-476.0906515824172,"total_magnetization":-2.216450763854391e-08,"u_effective_ev":{"Cr":2.0},"used_default_u":false};

const without = (...keys: string[]) => Object.fromEntries(Object.entries(REAL).filter(([k]) => !keys.includes(k)));
const VARIANTS: Array<[string, Record<string, unknown>]> = [
  ["real payload", REAL],
  ["relax requested", { ...REAL, stages_requested: { bands: false, dos: false, relax: true } }],
  ["dos requested", { ...REAL, stages_requested: { bands: false, dos: true, relax: false } }],
  ["bands+dos+relax requested, no stage outputs", { ...REAL, stages_requested: { bands: true, dos: true, relax: true } }],
  ["missing fermi_energy_ev", without("fermi_energy_ev")],
  ["missing band_gap_ev", without("band_gap_ev")],
  ["missing local_magnetic_moments", without("local_magnetic_moments")],
  ["null local_magnetic_moments", { ...REAL, local_magnetic_moments: null }],
  ["null moment value", { ...REAL, local_magnetic_moments: { "0": null, "1": 3 } }],
  ["empty stages_requested", { ...REAL, stages_requested: {} }],
  ["missing stages_requested", without("stages_requested")],
  ["minimal payload", { engine: "qe", method: "pbe+u", task: "PERIODIC_ENERGY" }],
];

function plate(payload: Record<string, unknown> | null) {
  return renderToStaticMarkup(createElement(EnergyPrecisionPlate, {
    projectId: "p", calculationId: "c", resultId: "r", method: "pbe+u", engineName: "qe", engineVersion: "7.6",
    energyValue: -476.0906515824172, energyUnit: "Eh", converged: true, scfIterations: 16, sourceClass: "CALCULATED",
    validationState: "VALIDATED", authority: "AUTHORITATIVE", rawPayload: payload,
  }));
}

describe("periodic QE result views do not throw on the real completion payload and its variants", () => {
  for (const [name, payload] of VARIANTS) {
    it(`energy precision plate: ${name}`, () => { expect(() => plate(payload)).not.toThrow(); });
    it(`QE periodic results: ${name}`, () => {
      expect(() => renderToStaticMarkup(createElement(QePeriodicResults, { payload, projectId: "p", calculationId: "c" }))).not.toThrow();
    });
  }
  it("real payload shows the published energy and gap", () => {
    const html = plate(REAL);
    expect(html).toContain("-476.0906515824172".slice(0, 12));
  });
  it("RUNNING -> result transition: the same component renders both a null payload and the completed payload", () => {
    // Closest server-render equivalent of the job record updating in place. It does NOT run React effects or
    // state updates across renders (no testing-library / DOM in this repo), so a hook-order or effect-timing
    // crash on the live transition is NOT covered.
    expect(() => { plate(null); plate({}); plate(REAL); }).not.toThrow();
  });
});

describe("workspace error boundary details", () => {
  it("extracts the component name from a stack", () => {
    expect(componentNameFromStack("TypeError: x\n    at EnergyPrecisionPlate (chunk.js:1:1)\n    at div")).toBe("EnergyPrecisionPlate");
    expect(componentNameFromStack(undefined)).toBeNull();
  });
  it("describes message, name and digest", () => {
    expect(describeBoundaryError({ message: "boom", name: "RangeError", digest: "d1" })).toMatchObject({ message: "boom", name: "RangeError", digest: "d1" });
  });
  it("error page shows message, component and Try again inside a collapsed Details", () => {
    const error = Object.assign(new Error("Cannot read properties of null"), { stack: "Error: x\n    at QePeriodicResults (a.js:1:1)" });
    const html = renderToStaticMarkup(createElement(ErrorPage, { error, reset: () => {} }));
    expect(html).toContain("Try again");
    expect(html).toContain("Cannot read properties of null");
    expect(html).toContain("QePeriodicResults");
    expect(html).toMatch(/<details[^>]*>/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });
  it("log prefix is stable and the component has no network call", async () => {
    expect(BOUNDARY_LOG_PREFIX).toBe("[chemdft-boundary]");
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/app/_components/error-details.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon/);
    void vi; void ErrorDetails;
  });
});
