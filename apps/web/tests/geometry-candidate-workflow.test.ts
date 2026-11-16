import { describe, expect, it, vi } from "vitest";
import {
  acceptGeometryCandidate,
  exportStructureVersion,
  generateGeometryCandidate,
  getCalculationEligibility,
} from "../src/lib/structure-workspace-api";
import type {
  Atom,
  Bond,
  GeometryCandidateAcceptOutput,
  GeometryCandidateView,
  GeometryEligibility,
} from "@chemdft/schemas";

function createMockAtom(index: number, element: string, x: number, y: number, z: number): Atom {
  return {
    index,
    element,
    atomic_number: element === "C" ? 6 : 1,
    x,
    y,
    z,
  };
}

function createMockBond(atom_index_a: number, atom_index_b: number, order = 1): Bond {
  return {
    atom_index_a,
    atom_index_b,
    order,
  };
}

describe("2D-to-3D Geometry Candidate Frontend Contracts", () => {
  it.each(["Hexane", "Bakı – Hexane", "β-Ethanol", "Бензол"])(
    "preserves the exported filename for %s",
    async (name) => {
      const filename = `${name}.mol`;
      const disposition = name === "Hexane"
        ? `attachment; filename="${filename}"`
        : `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("M  END", { headers: { "content-disposition": disposition } }),
      );
      try {
        const exported = await exportStructureVersion({
          projectId: "project", structureId: "structure", versionId: "version", fileFormat: "MOL",
        });
        expect(exported.filename).toBe(filename);
        expect(await exported.blob.text()).toBe("M  END");
      } finally {
        fetchSpy.mockRestore();
      }
    },
  );

  it("generateGeometryCandidate sends drawing and parses candidate with 20 atoms", async () => {
    const mockAtoms = [
      createMockAtom(0, "C", 0.0, 0.0, 0.0),
      ...Array.from({ length: 19 }, (_, i) =>
        createMockAtom(i + 1, i + 1 < 6 ? "C" : "H", (i + 1) * 1.2, 0.1, 0.2),
      ),
    ] as [Atom, ...Atom[]];

    const mockBonds: Bond[] = Array.from({ length: 19 }, (_, i) =>
      createMockBond(i, i + 1, 1),
    );

    const fakeCandidate: GeometryCandidateView = {
      id: "cand-hex-1",
      project_id: "proj-1",
      state: "PENDING_ACCEPTANCE",
      candidate_artifact: {
        artifact_id: "art-1",
        project_id: "proj-1",
        sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      },
      manifest: {
        formula: "C6H14",
        canonical_smiles: "CCCCCC",
        generation_method: "rdkit.etkdg3.preview-conformer",
        generation_parameters: { random_seed: 42 },
        geometry_class: "GENERATED_CONFORMER_NOT_OPTIMIZED",
        source_atom_count: 6,
        explicit_hydrogen_count: 14,
        source_drawing: {
          artifact_id: "art-draw-1",
          project_id: "proj-1",
          sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
        source_graph_sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        atom_mapping: [],
        coordinate_representation: {
          kind: "MOLECULE",
          name: "n-Hexane",
          coordinates: {
            coordinate_system: "CARTESIAN",
            unit: "angstrom",
            atoms: mockAtoms,
            bonds: mockBonds,
          },
        },
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fakeCandidate), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await generateGeometryCandidate({
      projectId: "proj-1",
      payload: {
        mol_block: "FAKE_MOL_DATA",
        name: "n-Hexane",
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/chemdft/v1/projects/proj-1/geometry-candidates",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mol_block: "FAKE_MOL_DATA",
          name: "n-Hexane",
        }),
      }),
    );
    expect(result.manifest.formula).toBe("C6H14");
    expect(result.manifest.source_atom_count).toBe(6);
    expect(result.manifest.explicit_hydrogen_count).toBe(14);
    expect(result.manifest.coordinate_representation.coordinates.atoms).toHaveLength(20);
    expect(result.manifest.coordinate_representation.coordinates.bonds).toHaveLength(19);

    fetchSpy.mockRestore();
  });

  it("acceptGeometryCandidate submits checklist review and returns accepted StructureVersion", async () => {
    const mockAtoms = [
      createMockAtom(0, "C", 0.0, 0.0, 0.0),
      ...Array.from({ length: 19 }, (_, i) =>
        createMockAtom(i + 1, i + 1 < 6 ? "C" : "H", (i + 1) * 1.2, 0.1, 0.2),
      ),
    ] as [Atom, ...Atom[]];

    const mockBonds: Bond[] = Array.from({ length: 19 }, (_, i) =>
      createMockBond(i, i + 1, 1),
    );

    const fakeAcceptOutput: GeometryCandidateAcceptOutput = {
      structure: {
        id: "struct-1",
        project_id: "proj-1",
        name: "n-Hexane",
        kind: "MOLECULE",
        created_at: new Date().toISOString(),
        created_by: "user-1",
      },
      version: {
        id: "ver-1",
        structure_id: "struct-1",
        project_id: "proj-1",
        revision: 1,
        origin: "GENERATED",
        multiplicity: 1,
        overall_charge: 0,
        representation_artifacts: [
          {
            artifact_id: "art-1",
            project_id: "proj-1",
            sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          },
        ],
        created_at: new Date().toISOString(),
        created_by: "user-1",
        coordinates: {
          structure_version_id: "ver-1",
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          source: {
            entity_id: "cand-hex-1",
            entity_type: "geometry_candidate",
            project_id: "proj-1",
          },
          atoms: mockAtoms,
          bonds: mockBonds,
        },
      },
      candidate_id: "cand-hex-1",
      calculation_eligibility: {
        structure_version_id: "ver-1",
        eligible: true,
        code: "GEOMETRY_ACCEPTED_3D",
        detail: "Geometry candidate accepted with explicit hydrogens.",
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fakeAcceptOutput), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await acceptGeometryCandidate({
      projectId: "proj-1",
      candidateId: "cand-hex-1",
      payload: {
        candidate_sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        inspected_geometry: true,
        understands_not_optimized: true,
      },
    });

    expect(result.version.id).toBe("ver-1");
    expect(result.version.coordinates?.atoms).toHaveLength(20);
    expect(result.calculation_eligibility.eligible).toBe(true);
    expect(result.calculation_eligibility.code).toBe("GEOMETRY_ACCEPTED_3D");

    fetchSpy.mockRestore();
  });

  it("getCalculationEligibility returns ineligible for 2D structures", async () => {
    const fakeEligibility: GeometryEligibility = {
      structure_version_id: "ver-2d",
      eligible: false,
      code: "GEOMETRY_2D_REQUIRES_GENERATION",
      detail: "GEOMETRY_2D_REQUIRES_GENERATION: A 2D drawing requires Generate 3D, preview and explicit acceptance.",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fakeEligibility), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const eligibility = await getCalculationEligibility({
      projectId: "proj-1",
      structureId: "struct-1",
      versionId: "ver-2d",
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.code).toBe("GEOMETRY_2D_REQUIRES_GENERATION");
    expect(eligibility.detail).toContain("requires Generate 3D");

    fetchSpy.mockRestore();
  });

  it("generateGeometryCandidate sends parent_structure_version with entity_type 'structure.version'", async () => {
    const fakeCandidate: GeometryCandidateView = {
      id: "cand-edit-1",
      project_id: "proj-1",
      state: "PENDING_ACCEPTANCE",
      candidate_artifact: {
        artifact_id: "art-1",
        project_id: "proj-1",
        sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      },
      manifest: {
        formula: "C6H14",
        canonical_smiles: "CCCCCC",
        generation_method: "rdkit.etkdg3.preview-conformer",
        generation_parameters: { random_seed: 42 },
        geometry_class: "GENERATED_CONFORMER_NOT_OPTIMIZED",
        source_atom_count: 6,
        explicit_hydrogen_count: 14,
        source_drawing: {
          artifact_id: "art-draw-1",
          project_id: "proj-1",
          sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
        source_graph_sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        atom_mapping: [],
        coordinate_representation: {
          kind: "MOLECULE",
          name: "n-Hexane (Edited)",
          coordinates: {
            coordinate_system: "CARTESIAN",
            unit: "angstrom",
            atoms: [createMockAtom(0, "C", 0.0, 0.0, 0.0)],
            bonds: [],
          },
        },
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fakeCandidate), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const parentRef = {
      entity_id: "ver-parent-1",
      entity_type: "structure.version" as const,
      project_id: "proj-1",
    };

    await generateGeometryCandidate({
      projectId: "proj-1",
      payload: {
        mol_block: "FAKE_MOL_DATA",
        name: "Edited Structure",
        parent_structure_version: parentRef,
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/chemdft/v1/projects/proj-1/geometry-candidates",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mol_block: "FAKE_MOL_DATA",
          name: "Edited Structure",
          parent_structure_version: {
            entity_id: "ver-parent-1",
            entity_type: "structure.version",
            project_id: "proj-1",
          },
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it("handles heteroatom candidates for Ethanol (C2H6O) and Ethylamine (C2H7N)", async () => {
    // Ethanol candidate C2H6O: 2 C + 1 O + 6 H = 9 atoms
    const ethanolAtoms = [
      createMockAtom(0, "C", 0.0, 0.0, 0.0),
      createMockAtom(1, "C", 1.5, 0.0, 0.0),
      { index: 2, element: "O", atomic_number: 8, x: 2.0, y: 1.2, z: 0.0 },
      ...Array.from({ length: 6 }, (_, i) =>
        createMockAtom(i + 3, "H", (i + 1) * 0.5, 0.5, 0.5),
      ),
    ] as [Atom, ...Atom[]];

    const ethanolCandidate: GeometryCandidateView = {
      id: "cand-ethanol",
      project_id: "proj-1",
      state: "PENDING_ACCEPTANCE",
      candidate_artifact: {
        artifact_id: "art-eth",
        project_id: "proj-1",
        sha256: "eth1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      },
      manifest: {
        formula: "C2H6O",
        canonical_smiles: "CCO",
        generation_method: "rdkit.etkdg3.preview-conformer",
        generation_parameters: { random_seed: 42 },
        geometry_class: "GENERATED_CONFORMER_NOT_OPTIMIZED",
        source_atom_count: 3, // 2 C + 1 O
        explicit_hydrogen_count: 6,
        source_drawing: {
          artifact_id: "art-draw-eth",
          project_id: "proj-1",
          sha256: "draw1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
        source_graph_sha256: "draw1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        atom_mapping: [],
        coordinate_representation: {
          kind: "MOLECULE",
          name: "Ethanol",
          coordinates: {
            coordinate_system: "CARTESIAN",
            unit: "angstrom",
            atoms: ethanolAtoms,
            bonds: Array.from({ length: 8 }, (_, i) => createMockBond(i, i + 1, 1)),
          },
        },
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(ethanolCandidate), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await generateGeometryCandidate({
      projectId: "proj-1",
      payload: {
        mol_block: "ETHANOL_MOL",
        name: "Ethanol",
      },
    });

    expect(result.manifest.formula).toBe("C2H6O");
    expect(result.manifest.source_atom_count).toBe(3);
    expect(result.manifest.explicit_hydrogen_count).toBe(6);
    expect(result.manifest.coordinate_representation.coordinates.atoms).toHaveLength(9);
    const oxygen = result.manifest.coordinate_representation.coordinates.atoms.find(
      (a) => a.element === "O",
    );
    expect(oxygen).toBeDefined();
    expect(oxygen?.atomic_number).toBe(8);

    fetchSpy.mockRestore();
  });
});
