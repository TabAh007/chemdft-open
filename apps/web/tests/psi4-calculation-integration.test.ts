import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StructureVersionDetail } from "@chemdft/schemas";
import {
  buildPsi4SubmissionPayload,
  getPsi4SupportedBases,
  getPsi4SupportedMethods,
  isPsi4PairSupported,
  validatePsi4Structure,
} from "../src/lib/psi4-calculation";
import { buildGuidedSubmission } from "../src/lib/guided-calculation";
import { EnergyPrecisionPlate } from "../src/app/[locale]/projects/[projectId]/workspace/visualization/energy-precision-plate";

vi.mock("@chemdft/ui", () => ({
  AppIcon: () => null,
  StatusTag: ({ children }: { children: string }) => children,
}));

function createTestStructure(overrides: Record<string, unknown> = {}): StructureVersionDetail {
  return {
    structure: {
      id: "struct-water",
      project_id: "proj-1",
      name: "Water",
      kind: "MOLECULE",
      created_by: "user-1",
      created_at: "2026-10-10T00:00:00Z",
    },
    version: {
      id: "ver-water-1",
      structure_id: "struct-water",
      revision: 1,
      name: "Water V1",
      atom_count: 3,
      has_authoritative_bonds: false,
      coordinate_system: "CARTESIAN",
      origin: "IMPORTED",
      overall_charge: 0,
      multiplicity: 1,
      coordinates: {
        structure_version_id: "ver-water-1",
        coordinate_system: "CARTESIAN",
        unit: "angstrom",
        source: "SOURCE_RETAINED",
        atoms: [
          { index: 0, atomic_number: 8, element: "O", x: 0.0, y: 0.0, z: 0.1173 },
          { index: 1, atomic_number: 1, element: "H", x: 0.0, y: 0.7572, z: -0.4692 },
          { index: 2, atomic_number: 1, element: "H", x: 0.0, y: -0.7572, z: -0.4692 },
        ],
      },
      created_by: "user-1",
      created_at: "2026-10-10T00:00:00Z",
      representation_artifacts: [{ artifact_id: "art-1", sha256: "abc", project_id: "proj-1" }],
    },
    ...overrides,
  } as unknown as StructureVersionDetail;
}

describe("Psi4 molecular scope validation (validatePsi4Structure)", () => {
  it("accepts neutral, closed-shell singlet water (H2O) with H and O atoms", () => {
    const water = createTestStructure();
    const result = validatePsi4Structure(water, false);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("accepts neutral, closed-shell singlet methane (CH4) with C and H atoms", () => {
    const methane = createTestStructure({
      version: {
        ...createTestStructure().version,
        id: "ver-methane-1",
        atom_count: 5,
        name: "Methane V1",
        coordinates: {
          structure_version_id: "ver-methane-1",
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          source: "SOURCE_RETAINED",
          atoms: [
            { index: 0, atomic_number: 6, element: "C", x: 0.0, y: 0.0, z: 0.0 },
            { index: 1, atomic_number: 1, element: "H", x: 0.6276, y: 0.6276, z: 0.6276 },
            { index: 2, atomic_number: 1, element: "H", x: -0.6276, y: -0.6276, z: 0.6276 },
            { index: 3, atomic_number: 1, element: "H", x: -0.6276, y: 0.6276, z: -0.6276 },
            { index: 4, atomic_number: 1, element: "H", x: 0.6276, y: -0.6276, z: -0.6276 },
          ],
        },
      },
    });
    const result = validatePsi4Structure(methane, false);
    expect(result.valid).toBe(true);
  });

  it("rejects periodic systems", () => {
    const water = createTestStructure();
    const result = validatePsi4Structure(water, true);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("periodic");
  });

  it("rejects non-zero charge", () => {
    const hydronium = createTestStructure({
      version: {
        ...createTestStructure().version,
        overall_charge: 1,
      },
    });
    const result = validatePsi4Structure(hydronium, false);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("neutral molecules");
  });

  it("rejects non-singlet multiplicity", () => {
    const tripletO2 = createTestStructure({
      version: {
        ...createTestStructure().version,
        multiplicity: 3,
      },
    });
    const result = validatePsi4Structure(tripletO2, false);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("closed-shell singlets");
  });

  it("rejects unsupported elements outside H, C, O (e.g. Nitrogen)", () => {
    const ammonia = createTestStructure({
      version: {
        ...createTestStructure().version,
        coordinates: {
          structure_version_id: "ver-water-1",
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          source: "SOURCE_RETAINED",
          atoms: [
            { index: 0, atomic_number: 7, element: "N", x: 0.0, y: 0.0, z: 0.0 },
            { index: 1, atomic_number: 1, element: "H", x: 0.0, y: 0.94, z: 0.38 },
            { index: 2, atomic_number: 1, element: "H", x: 0.81, y: -0.47, z: 0.38 },
            { index: 3, atomic_number: 1, element: "H", x: -0.81, y: -0.47, z: 0.38 },
          ],
        },
      },
    });
    const result = validatePsi4Structure(ammonia, false);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("H, C, and O only");
  });

  it("rejects odd electron count (radical)", () => {
    // OH radical: 8 + 1 = 9 electrons
    const ohRadical = createTestStructure({
      version: {
        ...createTestStructure().version,
        atom_count: 2,
        coordinates: {
          structure_version_id: "ver-water-1",
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          source: "SOURCE_RETAINED",
          atoms: [
            { index: 0, atomic_number: 8, element: "O", x: 0.0, y: 0.0, z: 0.0 },
            { index: 1, atomic_number: 1, element: "H", x: 0.0, y: 0.0, z: 0.97 },
          ],
        },
      },
    });
    const result = validatePsi4Structure(ohRadical, false);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("even electron count");
  });

  it("rejects empty structures or structures exceeding 100 atoms", () => {
    const empty = createTestStructure({
      version: {
        ...createTestStructure().version,
        atom_count: 0,
        coordinates: {
          structure_version_id: "ver-empty",
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          source: "SOURCE_RETAINED",
          atoms: [],
        },
      },
    });
    expect(validatePsi4Structure(empty, false).valid).toBe(false);

    const huge = createTestStructure({
      version: {
        ...createTestStructure().version,
        atom_count: 101,
        coordinates: {
          structure_version_id: "ver-huge",
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          source: "SOURCE_RETAINED",
          atoms: Array.from({ length: 101 }, () => ({ atomic_number: 1, element: "H", x: 0, y: 0, z: 0 })),
        },
      },
    });
    expect(validatePsi4Structure(huge, false).valid).toBe(false);
  });

  it("rejects non-finite coordinates", () => {
    const nanCoord = createTestStructure({
      version: {
        ...createTestStructure().version,
        coordinates: {
          structure_version_id: "ver-nan",
          coordinate_system: "CARTESIAN",
          unit: "angstrom",
          source: "SOURCE_RETAINED",
          atoms: [
            { index: 0, atomic_number: 8, element: "O", x: NaN, y: 0, z: 0 },
            { index: 1, atomic_number: 1, element: "H", x: 0, y: 1, z: 0 },
            { index: 2, atomic_number: 1, element: "H", x: 0, y: -1, z: 0 },
          ],
        },
      },
    });
    expect(validatePsi4Structure(nanCoord, false).valid).toBe(false);
  });
});

describe("Psi4 supported method/basis pairing", () => {
  it("accepts all 5 authorized Gate C method/basis pairs", () => {
    expect(isPsi4PairSupported("hf", "sto-3g")).toBe(true);
    expect(isPsi4PairSupported("hf", "def2-svp")).toBe(true);
    expect(isPsi4PairSupported("b3lyp", "def2-svp")).toBe(true);
    expect(isPsi4PairSupported("pbe", "def2-svp")).toBe(true);
    expect(isPsi4PairSupported("mp2", "def2-svp")).toBe(true);
  });

  it("rejects unauthorized method/basis combinations", () => {
    expect(isPsi4PairSupported("b3lyp", "sto-3g")).toBe(false);
    expect(isPsi4PairSupported("pbe", "sto-3g")).toBe(false);
    expect(isPsi4PairSupported("mp2", "sto-3g")).toBe(false);
    expect(isPsi4PairSupported("hf", "def2-tzvp")).toBe(false);
    expect(isPsi4PairSupported("ccsd", "def2-svp")).toBe(false);
    expect(isPsi4PairSupported("gfn2", "def2-svp")).toBe(false);
  });

  it("fails closed when capability is unavailable, misconfigured, or missing pairs", () => {
    const unavailableCap = {
      engine: "psi4",
      version: null,
      availability: "UNAVAILABLE" as const,
      supported_tasks: [],
      supported_methods: [],
      supported_basis_sets: [],
      supported_method_basis_pairs: [],
    };
    expect(isPsi4PairSupported("hf", "sto-3g", unavailableCap)).toBe(false);
    expect(getPsi4SupportedMethods(unavailableCap)).toEqual([]);
    expect(getPsi4SupportedBases("hf", unavailableCap)).toEqual([]);

    const misconfiguredCap = {
      engine: "psi4",
      version: "1.11",
      availability: "MISCONFIGURED" as const,
      supported_tasks: ["ENERGY"],
      supported_methods: ["hf"],
      supported_basis_sets: ["sto-3g"],
      supported_method_basis_pairs: [{ method: "hf", basis: "sto-3g" }],
    };
    expect(isPsi4PairSupported("hf", "sto-3g", misconfiguredCap)).toBe(false);

    const availableCap = {
      engine: "psi4",
      version: "1.11",
      availability: "AVAILABLE" as const,
      supported_tasks: ["ENERGY"],
      supported_methods: ["hf", "b3lyp"],
      supported_basis_sets: ["sto-3g", "def2-svp"],
      supported_method_basis_pairs: [
        { method: "hf", basis: "sto-3g" },
        { method: "b3lyp", basis: "def2-svp" },
      ],
    };
    expect(isPsi4PairSupported("hf", "sto-3g", availableCap)).toBe(true);
    expect(isPsi4PairSupported("b3lyp", "def2-svp", availableCap)).toBe(true);
    expect(isPsi4PairSupported("hf", "def2-svp", availableCap)).toBe(false); // not in this capability's pairs
  });

  it("provides correct cascading options for method and basis", () => {
    expect(getPsi4SupportedMethods()).toEqual(["hf", "b3lyp", "pbe", "mp2"]);
    expect(getPsi4SupportedBases("hf")).toEqual(["sto-3g", "def2-svp"]);
    expect(getPsi4SupportedBases("b3lyp")).toEqual(["def2-svp"]);
    expect(getPsi4SupportedBases("pbe")).toEqual(["def2-svp"]);
    expect(getPsi4SupportedBases("mp2")).toEqual(["def2-svp"]);
    expect(getPsi4SupportedBases("unknown")).toEqual([]);
  });
});

describe("Psi4 submission payload generation (buildPsi4SubmissionPayload)", () => {
  it("builds exact compliant payload for HF / STO-3G (RHF reference)", () => {
    const payload = buildPsi4SubmissionPayload({
      projectId: "proj-123",
      versionId: "ver-456",
      method: "hf",
      basis: "sto-3g",
      allowedVersion: "1.11",
    });

    expect(payload.structure_version.entity_id).toBe("ver-456");
    expect(payload.specification.task_type).toBe("ENERGY");
    expect(payload.specification.method.identifier).toBe("hf");
    expect(payload.specification.basis?.identifier).toBe("sto-3g");
    expect(payload.specification.charge).toBe(0);
    expect(payload.specification.multiplicity).toBe(1);
    expect(payload.specification.engine_preference.engine).toBe("psi4");
    expect(payload.specification.engine_preference.allowed_version).toBe("1.11");
    expect(payload.specification.scf?.reference).toBe("rhf");
    // SCF convergence override must NOT be present
    expect(payload.specification.scf?.convergence_threshold).toBeUndefined();
  });

  it("builds exact compliant payload for B3LYP / def2-SVP (RKS reference)", () => {
    const payload = buildPsi4SubmissionPayload({
      projectId: "proj-123",
      versionId: "ver-456",
      method: "b3lyp",
      basis: "def2-svp",
    });

    expect(payload.specification.method.identifier).toBe("b3lyp");
    expect(payload.specification.basis?.identifier).toBe("def2-svp");
    expect(payload.specification.scf?.reference).toBe("rks");
    expect(payload.specification.scf?.convergence_threshold).toBeUndefined();
  });

  it("builds exact compliant payload for Conventional MP2 / def2-SVP (RHF reference)", () => {
    const payload = buildPsi4SubmissionPayload({
      projectId: "proj-123",
      versionId: "ver-456",
      method: "mp2",
      basis: "def2-svp",
    });

    expect(payload.specification.method.identifier).toBe("mp2");
    expect(payload.specification.basis?.identifier).toBe("def2-svp");
    expect(payload.specification.scf?.reference).toBe("rhf");
    expect(payload.specification.scf?.convergence_threshold).toBeUndefined();
  });

  it("rejects unauthorized method/basis combinations", () => {
    expect(() =>
      buildPsi4SubmissionPayload({
        projectId: "p",
        versionId: "v",
        method: "b3lyp",
        basis: "sto-3g",
      }),
    ).toThrow(/Unsupported Psi4 method\/basis/);
  });
});

describe("Guided submission builder with Psi4 (buildGuidedSubmission)", () => {
  it("routes Psi4 through buildPsi4SubmissionPayload without PySCF convergence options", () => {
    const submission = buildGuidedSubmission("proj-abc", "ver-def", {
      engine: "psi4",
      method: "b3lyp",
      basis: "def2-svp",
      charge: 0,
      multiplicity: 1,
      convergence: 1e-9, // should be omitted for Psi4
      taskType: "ENERGY",
      allowedVersion: "1.11",
    });

    expect(submission.specification.engine_preference.engine).toBe("psi4");
    expect(submission.specification.method.identifier).toBe("b3lyp");
    expect(submission.specification.scf?.reference).toBe("rks");
    expect(submission.specification.scf?.convergence_threshold).toBeUndefined();
  });

  it("rejects non-ENERGY tasks for Psi4 in Guided mode", () => {
    expect(() =>
      buildGuidedSubmission("proj-abc", "ver-def", {
        engine: "psi4",
        method: "hf",
        basis: "sto-3g",
        charge: 0,
        multiplicity: 1,
        convergence: 1e-8,
        taskType: "GEOMETRY_OPTIMIZATION",
      }),
    ).toThrow(/Psi4 supports single-point ENERGY/);
  });

  it("rejects non-neutral or non-singlet setups for Psi4 in Guided mode", () => {
    expect(() =>
      buildGuidedSubmission("proj-abc", "ver-def", {
        engine: "psi4",
        method: "hf",
        basis: "sto-3g",
        charge: 1,
        multiplicity: 1,
        convergence: 1e-8,
        taskType: "ENERGY",
      }),
    ).toThrow(/neutral closed-shell singlets/);
  });
});

describe("Energy Precision Plate rendering for Psi4 (EnergyPrecisionPlate)", () => {
  it("renders HF result with accurate method class and precision", () => {
    const html = renderToStaticMarkup(
      createElement(EnergyPrecisionPlate, {
        projectId: "proj-1",
        calculationId: "calc-1",
        resultId: "res-1",
        structureVersionId: "ver-1",
        engineName: "psi4",
        engineVersion: "1.11",
        method: "hf",
        basis: "sto-3g",
        energyValue: -74.965901192,
        energyUnit: "Eh",
        converged: true,
        scfIterations: 7,
        validationState: "VALIDATED",
      }),
    );

    expect(html).toContain("HF");
    expect(html).toContain("Ab initio electronic structure (DFT / Hartree–Fock)");
    expect(html).toContain("psi4 1.11");
    expect(html).toContain("-74.9659011920");
    expect(html).toContain("Self-Consistent Field Converged");
    expect(html).toContain("7 iterations");
  });

  it("renders MP2 result with 'Conventional MP2' label and decomposition plate when present", () => {
    const html = renderToStaticMarkup(
      createElement(EnergyPrecisionPlate, {
        projectId: "proj-1",
        calculationId: "calc-mp2",
        resultId: "res-mp2",
        structureVersionId: "ver-1",
        engineName: "psi4",
        engineVersion: "1.11",
        method: "mp2",
        basis: "def2-svp",
        energyValue: -76.225574384,
        energyUnit: "Eh",
        converged: true,
        validationState: "VALIDATED",
        rawPayload: {
          hf_reference_hartree: -76.064510001,
          mp2_correlation_hartree: -0.161064383,
        },
      }),
    );

    expect(html).toContain("Conventional MP2");
    expect(html).toContain("Conventional MP2 / Post-Hartree–Fock");
    expect(html).toContain("Conventional MP2 Energy Decomposition");
    expect(html).toContain("-76.0645100010 Eh"); // E_ref
    expect(html).toContain("-0.1610643830 Eh"); // E_corr
    expect(html).toContain("-76.2255743840 Eh"); // E_tot
  });

  it("does not fabricate MP2 decomposition when fields are omitted from raw payload", () => {
    const html = renderToStaticMarkup(
      createElement(EnergyPrecisionPlate, {
        projectId: "proj-1",
        calculationId: "calc-mp2",
        resultId: "res-mp2",
        structureVersionId: "ver-1",
        engineName: "psi4",
        method: "mp2",
        basis: "def2-svp",
        energyValue: -76.225574384,
        energyUnit: "Eh",
        rawPayload: null, // missing decomposition
      }),
    );

    expect(html).toContain("Conventional MP2");
    expect(html).not.toContain("Conventional MP2 Energy Decomposition");
    expect(html).not.toContain("HF Reference Energy");
  });
});


describe("strict immutable atom identities", () => {
  for (const change of [
    { element: "N", atomic_number: 8 }, { element: "H", atomic_number: 8 },
    { element: "O", atomic_number: 7 }, { index: undefined }, { index: 2 },
  ]) it(`rejects inconsistent atom metadata ${JSON.stringify(change)}`, () => {
    const structure = createTestStructure();
    Object.assign(structure.version.coordinates!.atoms[0]!, change);
    expect(validatePsi4Structure(structure).valid).toBe(false);
  });
  it("rejects a coordinate record associated with a different version", () => {
    const structure = createTestStructure(); structure.version.coordinates!.structure_version_id = "other";
    expect(validatePsi4Structure(structure).valid).toBe(false);
  });
  it("rejects periodic input without a caller hint", () => {
    const structure = createTestStructure(); structure.structure.kind = "PERIODIC";
    expect(validatePsi4Structure(structure).valid).toBe(false);
  });
});

describe("accepted payload matrix and missing scientific fields", () => {
  for (const [method, basis, reference] of [
    ["hf", "sto-3g", "rhf"], ["hf", "def2-svp", "rhf"], ["b3lyp", "def2-svp", "rks"],
    ["pbe", "def2-svp", "rks"], ["mp2", "def2-svp", "rhf"],
  ] as const) it(`uses the same exact ${method}/${basis} contract in both modes`, () => {
    const guided = buildGuidedSubmission("p", "v", { engine: "psi4", method, basis, charge: 0, multiplicity: 1, convergence: 1e-9 });
    const advanced = buildPsi4SubmissionPayload({ projectId: "p", versionId: "v", method, basis });
    expect(guided.specification).toEqual(advanced.specification);
    expect(advanced.specification.scf).toEqual({ reference });
    expect(advanced.structure_version.entity_id).toBe("v");
  });
  it("does not substitute unspecified aliases or render nonfinite MP2 components", () => {
    const html = renderToStaticMarkup(createElement(EnergyPrecisionPlate, {
      projectId: "p", engineName: "psi4", method: "mp2", energyValue: -76, energyUnit: "Eh",
      rawPayload: { reference_energy: -75, scf_energy: -75, correlation_energy: -1, hf_reference_hartree: NaN },
    }));
    expect(html).not.toContain("MP2 Energy Decomposition");
    expect(html).not.toContain("NaN");
  });
  it("shows only a provided spin component and never derives the missing reference or correlation", () => {
    const html = renderToStaticMarkup(createElement(EnergyPrecisionPlate, {
      projectId: "p", engineName: "psi4", method: "mp2", energyValue: -76, energyUnit: "Eh",
      rawPayload: { mp2_same_spin_hartree: -0.05 },
    }));
    expect(html).toContain("-0.0500000000 Eh");
    expect(html).not.toContain("HF Reference Energy"); expect(html).not.toContain("MP2 Correlation Energy (E_corr)");
  });
  it("never applies Hartree conversions to an unrecognized native unit", () => {
    const html = renderToStaticMarkup(createElement(EnergyPrecisionPlate, {
      projectId: "p", engineName: "psi4", method: "mp2", energyValue: -76, energyUnit: "kJ/mol",
      rawPayload: { hf_reference_hartree: -75 },
    }));
    expect(html).not.toContain("Derived conversions:"); expect(html).not.toContain("MP2 Energy Decomposition");
  });
});
