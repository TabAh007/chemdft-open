import { describe, expect, it } from "vitest";
import type { OptimizationStep, StructureVersionDetail } from "@chemdft/schemas";
import { optimizationSeparationWarnings, optimizationSeries, sceneForOptimizationStep } from "../src/lib/optimization-trajectory";

const source = {
  structure: { id: "00000000-0000-4000-8000-000000000001", kind: "MOLECULE" },
  version: {
    id: "00000000-0000-4000-8000-000000000002", revision: 1,
    coordinates: {
      coordinate_system: "CARTESIAN", unit: "angstrom",
      atoms: [
        { index: 0, element: "H", atomic_number: 1, x: 0, y: 0, z: 0 },
        { index: 1, element: "H", atomic_number: 1, x: 0, y: 0, z: 1.2 },
      ],
      bonds: [{ atom_index_a: 0, atom_index_b: 1, order: 1 }],
    },
    diagnostics: [],
  },
  diagnostics: [],
} as unknown as StructureVersionDetail;

const steps = [
  { index: 0, engine_cycle: 1, coordinates_angstrom: [[0, 0, 0], [0, 0, 1.2]],
    energy_hartree: -1.005, gradient_norm_hartree_per_bohr: 0.16,
    gradient_rms_hartree_per_bohr: 0.06, timestamp: "2026-01-01T00:00:00Z" },
  { index: 1, engine_cycle: 2, coordinates_angstrom: [[0, 0, 0.2], [0, 0, 1.0]],
    energy_hartree: -1.11, gradient_norm_hartree_per_bohr: 0.01,
    gradient_rms_hartree_per_bohr: 0.004, timestamp: "2026-01-01T00:00:01Z" },
] as OptimizationStep[];

describe("persisted optimization trajectory rendering", () => {
  it("renders only exact selected engine coordinates and preserves the input", () => {
    const first = sceneForOptimizationStep(source, steps[0]!);
    const second = sceneForOptimizationStep(source, steps[1]!);
    expect(first?.atoms.map((atom) => atom.position)).toEqual([[0, 0, 0], [0, 0, 1.2]]);
    expect(second?.atoms.map((atom) => atom.position)).toEqual([[0, 0, 0.2], [0, 0, 1.0]]);
    expect(second?.bonds).toHaveLength(1);
    expect(source.version.coordinates?.atoms[1]?.z).toBe(1.2);
  });

  it("rejects malformed frames and plots one point per persisted evaluation", () => {
    expect(sceneForOptimizationStep(source, { ...steps[0]!, coordinates_angstrom: [[0, 0, 0]] })).toBeNull();
    expect(sceneForOptimizationStep(source, { ...steps[0]!, coordinates_angstrom: [[0, 0, Number.NaN], [0, 0, 1.2]] })).toBeNull();
    expect(optimizationSeries(steps)).toEqual({
      energy: [[1, -1.005], [2, -1.11]], gradient: [[1, 0.16], [2, 0.01]],
    });
  });

  it("warns on measured separation without rejecting dissociation or assigning bond orders", () => {
    const endpoint = { ...steps[1]!, coordinates_angstrom: [[0, 0, 0], [0, 0, 4]] } as OptimizationStep;
    expect(optimizationSeparationWarnings(source, endpoint)).toEqual([
      expect.stringContaining("1.200 Å to 4.000 Å"),
    ]);
    expect(optimizationSeparationWarnings(source, steps[1]!)).toEqual([]);
    expect(sceneForOptimizationStep(source, endpoint)?.atoms[1]?.position).toEqual([0, 0, 4]);
    expect(source.version.coordinates?.bonds?.[0]?.order).toBe(1);
    const xyz = structuredClone(source);
    xyz.version.coordinates!.bonds = [];
    expect(optimizationSeparationWarnings(xyz, endpoint)).toHaveLength(1);
  });

  it("normalizes bohr before comparing separation and leaves undeclared polyatomic connectivity unassessed", () => {
    const bohr = structuredClone(source);
    bohr.version.coordinates!.unit = "bohr";
    bohr.version.coordinates!.atoms[1]!.z = 1.2 * 1.8897261254578281;
    const endpoint = { ...steps[1]!, coordinates_angstrom: [[0, 0, 0], [0, 0, 4]] } as OptimizationStep;
    expect(optimizationSeparationWarnings(bohr, endpoint)[0]).toContain("1.200 Å");
    const polyatomic = structuredClone(source);
    polyatomic.version.coordinates!.atoms.push({ ...polyatomic.version.coordinates!.atoms[1]!, index: 2 });
    polyatomic.version.coordinates!.bonds = [];
    const three = { ...endpoint, coordinates_angstrom: [[0, 0, 0], [0, 0, 4], [0, 0, 8]] } as OptimizationStep;
    expect(optimizationSeparationWarnings(polyatomic, three)).toEqual([]);
  });

  it("warns about a long H-H endpoint even when an already separated input did not change", () => {
    const separated = structuredClone(source);
    separated.version.coordinates!.atoms[1]!.z = 5;
    separated.version.coordinates!.bonds = [];
    const endpoint = { ...steps[1]!, coordinates_angstrom: [[0, 0, 0], [0, 0, 5]] } as OptimizationStep;
    expect(optimizationSeparationWarnings(separated, endpoint)).toEqual([
      expect.stringContaining("H–H separation is 5.000 Å"),
    ]);
  });
});
