import { describe, expect, it } from "vitest";
import type { Bond, StructureVersionDetail } from "@chemdft/schemas";

import {
  BOHR_TO_ANGSTROM,
  buildCandidatePreviewScene,
  buildScientificScene,
  displayAtomsForSupercell,
  measureScene,
} from "../src";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  structure: "00000000-0000-4000-8000-000000000002",
  version: "00000000-0000-4000-8000-000000000003",
  artifact: "00000000-0000-4000-8000-000000000004",
  actor: "00000000-0000-4000-8000-000000000005",
};

describe("ScientificScene builder", () => {
  it("derives molecule atoms and bonds from immutable StructureVersion data", () => {
    const scene = buildScientificScene(moleculeDetail());

    expect(scene.structureVersion.structureVersionId).toBe(ids.version);
    expect(scene.kind).toBe("MOLECULE");
    expect(scene.atoms.map((atom) => atom.index)).toEqual([0, 1, 2, 3]);
    expect(scene.bonds).toHaveLength(3);
    expect(scene.bonds[0]).toMatchObject({ atomIndexA: 0, atomIndexB: 1, order: 1, source: "canonical" });
    expect(scene.derivation.transforms).toEqual(["identity"]);
  });

  it("does not fabricate molecular bonds when canonical connectivity is empty", () => {
    const detail = moleculeDetail({ bonds: [] });
    const scene = buildScientificScene(detail);

    expect(scene.bonds).toEqual([]);
  });

  it("converts Bohr coordinates to Ångström for display without rewriting source positions", () => {
    const detail = moleculeDetail({ unit: "bohr" });
    const scene = buildScientificScene(detail);

    expect(scene.atoms[1]?.sourcePosition).toEqual([1, 0, 0]);
    expect(scene.atoms[1]?.position[0]).toBeCloseTo(BOHR_TO_ANGSTROM, 12);
    expect(scene.derivation.transforms).toContain("bohr-to-angstrom");
  });

  it("uses actual non-orthogonal lattice vectors for fractional periodic coordinates", () => {
    const scene = buildScientificScene(crystalDetail());

    expect(scene.kind).toBe("PERIODIC");
    expect(scene.cell?.latticeVectors[1]).toEqual([1, 3, 0]);
    expect(scene.atoms[0]?.sourcePosition).toEqual([0.5, 0.5, 0.5]);
    expect(scene.atoms[0]?.position).toEqual([1.5, 1.5, 2]);
    expect(scene.atoms[0]?.occupancy).toBe(0.5);
    expect(scene.derivation.transforms).toEqual(["fractional-to-cartesian-from-lattice-vectors"]);
    expect(scene.derivation.periodicMeasurementConvention).toBe("display-cartesian-no-minimum-image");
  });

  it("keeps crystal supercell replication visual-only", () => {
    const scene = buildScientificScene(crystalDetail());
    const replicated = displayAtomsForSupercell(scene, { nx: 2, ny: 1, nz: 1 });

    expect(scene.atoms).toHaveLength(2);
    expect(replicated).toHaveLength(4);
    expect(replicated.map((atom) => atom.sourceAtomIndex)).toEqual([0, 1, 0, 1]);
    expect(replicated[2]?.position).toEqual([3.5, 1.5, 2]);
  });
});

describe("candidate preview boundary", () => {
  it("keeps generated conformers separate from authoritative scenes", () => {
    const preview = buildCandidatePreviewScene({
      candidateId: ids.structure,
      representationId: ids.version,
      representationRevision: 2,
      representation: {
        kind: "MOLECULE",
        coordinates: {
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          atoms: [
            { index: 0, element: "O", atomic_number: 8, x: 0, y: 0, z: 0 },
            { index: 1, element: "H", atomic_number: 1, x: 0.75, y: 0, z: 0.5 },
          ],
          bonds: [{ atom_index_a: 0, atom_index_b: 1, order: 1 }],
        },
      },
    });

    expect(preview.warning).toBe("UNVERIFIED_GENERATED_PREVIEW");
    expect(preview.renderable.atoms).toHaveLength(2);
    expect(preview.renderable.bonds).toHaveLength(1);
    expect("structureVersion" in preview).toBe(false);
    // A preview can supply geometry to renderers, but is not itself an authoritative scene.
    // @ts-expect-error PreviewScene intentionally has no immutable version identity.
    const authoritative: import("../src").ScientificScene = preview;
    expect(authoritative).toBeDefined();
  });
});

describe("ScientificScene measurements", () => {
  it("measures distance, angle, and dihedral from scene coordinates", () => {
    const scene = buildScientificScene(moleculeDetail());

    expect(measureScene(scene, "distance", [0, 1]).value).toBeCloseTo(1, 12);
    expect(measureScene(scene, "angle", [1, 0, 2]).value).toBeCloseTo(90, 12);
    expect(Math.abs(measureScene(scene, "dihedral", [1, 0, 2, 3]).value)).toBeCloseTo(90, 12);
  });

  it("reports periodic display-coordinate measurement convention explicitly", () => {
    const scene = buildScientificScene(crystalDetail());
    const measurement = measureScene(scene, "distance", [0, 1]);

    expect(measurement.convention).toBe("display-cartesian-no-minimum-image");
    expect(measurement.value).toBeCloseTo(Math.sqrt(1.5 ** 2 + 1.5 ** 2 + 2 ** 2), 12);
  });
});

function moleculeDetail(
  options: {
    bonds?: Bond[];
    unit?: "angstrom" | "bohr";
  } = {},
): StructureVersionDetail {
  return {
    structure: {
      id: ids.structure,
      project_id: ids.project,
      name: "Measurement molecule",
      kind: "MOLECULE",
      created_by: ids.actor,
      created_at: "2026-09-13T00:00:00Z",
    },
    version: {
      id: ids.version,
      project_id: ids.project,
      structure_id: ids.structure,
      revision: 1,
      origin: "IMPORTED",
      parent_version_id: null,
      representation_artifacts: [{ project_id: ids.project, artifact_id: ids.artifact, sha256: "a".repeat(64) }],
      coordinates: {
        structure_version_id: ids.version,
        coordinate_system: "CARTESIAN",
        unit: options.unit ?? "angstrom",
        dimensionality: 3,
        atom_ordering: "AS_LISTED",
        source: { project_id: ids.project, artifact_id: ids.artifact, sha256: "a".repeat(64) },
        atoms: [
          { index: 0, atomic_number: 6, element: "C", x: 0, y: 0, z: 0, occupancy: null },
          { index: 1, atomic_number: 1, element: "H", x: 1, y: 0, z: 0, occupancy: null },
          { index: 2, atomic_number: 1, element: "H", x: 0, y: 1, z: 0, occupancy: null },
          { index: 3, atomic_number: 1, element: "H", x: 0, y: 1, z: 1, occupancy: null },
        ],
        bonds: options.bonds ?? [
          { atom_index_a: 0, atom_index_b: 1, order: 1 },
          { atom_index_a: 0, atom_index_b: 2, order: 1 },
          { atom_index_a: 2, atom_index_b: 3, order: 1 },
        ],
      },
      periodic_cell: null,
      diagnostics: [],
      overall_charge: 0,
      multiplicity: 1,
      created_by: ids.actor,
      created_at: "2026-09-13T00:00:00Z",
    },
    diagnostics: [],
    provenance: null,
  };
}

function crystalDetail(): StructureVersionDetail {
  const base = moleculeDetail();
  const coordinates = base.version.coordinates;
  if (!coordinates) throw new Error("Test fixture requires coordinates.");
  return {
    ...base,
    structure: {
      ...base.structure,
      name: "Triclinic-like crystal",
      kind: "PERIODIC",
    },
    version: {
      ...base.version,
      coordinates: {
        ...coordinates,
        coordinate_system: "FRACTIONAL",
        atoms: [
          { index: 0, atomic_number: 14, element: "Si", x: 0.5, y: 0.5, z: 0.5, occupancy: 0.5 },
          { index: 1, atomic_number: 8, element: "O", x: 0, y: 0, z: 0, occupancy: 1 },
        ],
        bonds: [],
      },
      periodic_cell: {
        unit: "angstrom",
        a: 2,
        b: Math.sqrt(10),
        c: 4,
        alpha: 90,
        beta: 90,
        gamma: 71.565,
        lattice_vectors: [[2, 0, 0], [1, 3, 0], [0, 0, 4]],
        periodic_dimensions: [true, true, true],
      },
      diagnostics: [
        { severity: "WARNING", code: "PARTIAL_OCCUPANCY", message: "Partial occupancy retained", atom_index: 0 },
      ],
    },
    diagnostics: [
      { severity: "WARNING", code: "PARTIAL_OCCUPANCY", message: "Partial occupancy retained", atom_index: 0 },
    ],
  };
}
