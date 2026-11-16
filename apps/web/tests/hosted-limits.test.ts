import { describe, expect, it } from "vitest";
import { hostedLimit, pyscfEnergyTimeNote } from "../src/lib/hosted-limits";

describe("hosted limits shown before Run", () => {
  it("xTB optimization allows 44 atoms, PySCF only 12", () => {
    expect(hostedLimit({ task: "GEOMETRY_OPTIMIZATION", engine: "xtb", atomCount: 44, atomicNumbers: [6] }).refusal).toBeNull();
    expect(hostedLimit({ task: "GEOMETRY_OPTIMIZATION", engine: "xtb", atomCount: 51, atomicNumbers: [6] }).refusal).toContain("50 atoms");
    expect(hostedLimit({ task: "GEOMETRY_OPTIMIZATION", engine: "pyscf", atomCount: 39, atomicNumbers: [6] }).refusal).toContain("12 atoms");
  });
  it("orbitals and CREST are refused with a plain reason", () => {
    expect(hostedLimit({ task: "ORBITAL", engine: "pyscf", atomCount: 39, atomicNumbers: [6] }).refusal).toContain("12 atoms");
    expect(hostedLimit({ task: "CONFORMER_SEARCH", engine: "xtb", atomCount: 9, atomicNumbers: [1, 6, 7] }).refusal).toContain("nitrogen");
    expect(hostedLimit({ task: "CONFORMER_SEARCH", engine: "xtb", atomCount: 9, atomicNumbers: [1, 6, 8] }).refusal).toBeNull();
  });
  it("says large def2-SVP single points were not timed", () => {
    expect(pyscfEnergyTimeNote(44, "def2-svp")).toContain("about 12 minutes");
    expect(pyscfEnergyTimeNote(5, "def2-svp")).toBeNull();
  });
});

import { modeDisplacementArrows } from "../src/lib/vibrational-mode";
describe("displacement arrows", () => {
  it("scales the longest arrow to 1.2 and keeps directions", () => {
    const frame = { version: { coordinates: { atoms: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] } } } as never;
    const arrows = modeDisplacementArrows(frame, { displacement_vectors: [[0, 0, 2], [0, 1, 0]] });
    expect(arrows![0]!.vector).toEqual([0, 0, 1.2]);
    expect(arrows![1]!.vector[1]).toBeCloseTo(0.6);
    expect(modeDisplacementArrows(frame, { displacement_vectors: [[0, 0, 0]] })).toBeUndefined();
  });
});

describe("hosted PySCF periodic note (release 0.0.44)", () => {
  it("offers Gamma only for PySCF and points to Quantum ESPRESSO for bigger meshes", () => {
    const note = hostedLimit({ task: "PERIODIC_ENERGY", engine: "pyscf", atomCount: 10, atomicNumbers: [24], periodic: true }).note;
    expect(note).toContain("Gamma-only");
    expect(note).toContain("Quantum ESPRESSO");
    expect(note).not.toContain("2x2x2");
  });
});
