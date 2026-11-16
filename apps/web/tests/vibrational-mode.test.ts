import { describe, expect, it } from "vitest";
import type { StructureVersionDetail, VibrationalAnalysis } from "@chemdft/schemas";
import { vibrationalFrameDetail } from "../src/lib/vibrational-mode";

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

const analysis = {
  input_structure_version_id: source.version.id,
  atom_identities: ["H", "H"],
  equilibrium_coordinates_angstrom: [[0, 0, 0], [0, 0, 1.2]],
  modes: [{ index: 0, frequency_cm1: 0, imaginary: false,
    displacement_vectors: [[0, 0, 0.5], [0, 0, -0.25]] }],
} as unknown as VibrationalAnalysis;

describe("vibrational visualization frames", () => {
  it("animates from the saved engine vector with rendering-only amplitude", () => {
    const frame = vibrationalFrameDetail(source, analysis, 0, Math.PI / 2, 1);
    expect(frame?.version.coordinates?.atoms.map((atom) => atom.z)).toEqual([1, 0.7]);
    expect(source.version.coordinates?.atoms.map((atom) => atom.z)).toEqual([0, 1.2]);
    const zeroAmplitude = vibrationalFrameDetail(source, analysis, 0, Math.PI / 2, 0);
    expect(zeroAmplitude?.version.coordinates?.atoms.map((atom) => atom.z)).toEqual([0, 1.2]);
  });

  it("rejects invalid mode indices, non-finite phase, and mismatched atom identities", () => {
    expect(vibrationalFrameDetail(source, analysis, 1, 0, 1)).toBeNull();
    expect(vibrationalFrameDetail(source, analysis, 0, Number.NaN, 1)).toBeNull();
    expect(vibrationalFrameDetail(source, { ...analysis, atom_identities: ["O", "H"] }, 0, 1, 1)).toBeNull();
  });
});
