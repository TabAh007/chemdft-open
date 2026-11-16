import type {
  CalculationSubmitInput,
  EngineCapabilityView,
  StructureVersionDetail,
} from "@chemdft/schemas";

/**
 * Pinned and accepted Psi4 Gate C method/basis pairs for single-point ENERGY.
 */
export const PSI4_SUPPORTED_PAIRS = [
  { method: "hf", basis: "sto-3g", reference: "rhf", methodDisplay: "Hartree–Fock", basisDisplay: "STO-3G" },
  { method: "hf", basis: "def2-svp", reference: "rhf", methodDisplay: "Hartree–Fock", basisDisplay: "def2-SVP" },
  { method: "b3lyp", basis: "def2-svp", reference: "rks", methodDisplay: "B3LYP", basisDisplay: "def2-SVP" },
  { method: "pbe", basis: "def2-svp", reference: "rks", methodDisplay: "PBE", basisDisplay: "def2-SVP" },
  { method: "mp2", basis: "def2-svp", reference: "rhf", methodDisplay: "Conventional MP2", basisDisplay: "def2-SVP" },
] as const;

export type Psi4Method = "hf" | "b3lyp" | "pbe" | "mp2";
export type Psi4Basis = "sto-3g" | "def2-svp";

export function getPsi4MethodDisplayName(method: string): string {
  const norm = method.toLowerCase();
  switch (norm) {
    case "hf":
      return "Hartree–Fock";
    case "b3lyp":
      return "B3LYP";
    case "pbe":
      return "PBE";
    case "mp2":
      return "Conventional MP2";
    default:
      return method.toUpperCase();
  }
}

export function getPsi4BasisDisplayName(basis: string): string {
  const norm = basis.toLowerCase();
  switch (norm) {
    case "sto-3g":
      return "STO-3G";
    case "def2-svp":
      return "def2-SVP";
    default:
      return basis.toUpperCase();
  }
}

export function getPsi4ScfReference(method: string): "rhf" | "rks" {
  const norm = method.toLowerCase();
  if (norm === "b3lyp" || norm === "pbe") {
    return "rks";
  }
  return "rhf";
}

/**
 * Validates whether a StructureVersion meets all Psi4 Gate C molecular restrictions:
 * - Nonperiodic molecular structure
 * - Finite Cartesian coordinates in Angstrom or Bohr
 * - Stable atom indexing
 * - Elements H, C, O only
 * - 1 to 100 atoms
 * - Neutral overall charge (0)
 * - Closed-shell singlet (multiplicity 1)
 * - Even total electron count
 */
export function validatePsi4Structure(
  structure: StructureVersionDetail,
  periodic?: boolean,
): { valid: boolean; reason?: string } {
  if (periodic || structure.structure.kind === "PERIODIC") {
    return { valid: false, reason: "Psi4 does not support periodic crystal structures." };
  }

  const charge = structure.version.overall_charge ?? 0;
  if (charge !== 0) {
    return { valid: false, reason: `Psi4 supports neutral molecules only (overall charge must be 0, got ${charge}).` };
  }

  const multiplicity = structure.version.multiplicity ?? 1;
  if (multiplicity !== 1) {
    return { valid: false, reason: `Psi4 supports closed-shell singlets only (multiplicity must be 1, got ${multiplicity}).` };
  }

  const coords = structure.version.coordinates;
  const atoms = coords?.atoms;
  if (!coords) {
    return { valid: false, reason: "Structure has no coordinates. Committed 3D Cartesian coordinates are required." };
  }
  if (coords.structure_version_id !== structure.version.id) {
    return { valid: false, reason: "Coordinates do not belong to the selected StructureVersion." };
  }

  if (coords && coords.coordinate_system !== "CARTESIAN") {
    return { valid: false, reason: "Psi4 requires Cartesian coordinates." };
  }

  if (coords && coords.unit !== "angstrom" && coords.unit !== "bohr") {
    return { valid: false, reason: `Psi4 requires Cartesian coordinates in Angstrom or Bohr (got ${coords.unit}).` };
  }

  if (!atoms || atoms.length === 0) {
    return { valid: false, reason: "Structure has no atoms." };
  }

  if (atoms.length > 100) {
    return { valid: false, reason: `Structure has ${atoms.length} atoms; Psi4 supports at most 100 atoms.` };
  }

  let totalElectrons = 0;
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    if (!atom) {
      return { valid: false, reason: `Missing atom data at index ${i}.` };
    }
    if (atom.index !== i) {
      return { valid: false, reason: `Unstable atom index order at position ${i} (got index ${atom.index}).` };
    }

    const elem = atom.element;
    const z = { H: 1, C: 6, O: 8 }[elem as "H" | "C" | "O"];
    if (!z || atom.atomic_number !== z) {
      return { valid: false, reason: `Element '${elem}' and atomic number '${atom.atomic_number}' must agree. Psi4 Gate C accepts H, C, and O only.` };
    }
    totalElectrons += z;

    if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y) || !Number.isFinite(atom.z)) {
      return { valid: false, reason: `Non-finite coordinate detected on atom ${i} (${elem}).` };
    }
  }

  if (totalElectrons % 2 !== 0) {
    return {
      valid: false,
      reason: `Odd electron count (${totalElectrons} electrons); Psi4 closed-shell singlet requires an even electron count.`,
    };
  }

  return { valid: true };
}

/**
 * Checks whether Psi4 is available according to the backend capability view.
 * Fails closed if metadata is missing, unavailable, or lacks supported pairs.
 */
export function isPsi4Available(capability?: EngineCapabilityView | null): boolean {
  if (!capability) return false;
  return (
    capability.engine === "psi4" &&
    capability.availability === "AVAILABLE" &&
    Array.isArray(capability.supported_tasks) &&
    capability.supported_tasks.includes("ENERGY") &&
    Array.isArray(capability.supported_method_basis_pairs) &&
    capability.supported_method_basis_pairs.length > 0
  );
}

/**
 * Returns the list of supported Psi4 methods from capability metadata or fallback to accepted pairs.
 */
export function getPsi4SupportedMethods(capability?: EngineCapabilityView | null): string[] {
  if (capability !== undefined) {
    if (!isPsi4Available(capability)) return [];
    const pairs = capability?.supported_method_basis_pairs ?? [];
    return Array.from(new Set(pairs.map((p) => p.method.toLowerCase())));
  }
  return Array.from(new Set(PSI4_SUPPORTED_PAIRS.map((p) => p.method)));
}

/**
 * Returns the list of supported Psi4 basis sets for a given method from capability metadata.
 */
export function getPsi4SupportedBases(method: string, capability?: EngineCapabilityView | null): string[] {
  if (capability !== undefined) {
    if (!isPsi4Available(capability)) return [];
    const pairs = capability?.supported_method_basis_pairs ?? [];
    return pairs
      .filter((p) => p.method.toLowerCase() === method.toLowerCase())
      .map((p) => p.basis.toLowerCase());
  }
  return PSI4_SUPPORTED_PAIRS
    .filter((p) => p.method.toLowerCase() === method.toLowerCase())
    .map((p) => p.basis);
}

/**
 * Checks whether a specific (method, basis) pair is accepted for Psi4.
 */
export function isPsi4PairSupported(
  method: string,
  basis: string | null | undefined,
  capability?: EngineCapabilityView | null,
): boolean {
  if (!basis) return false;
  const m = method.toLowerCase();
  const b = basis.toLowerCase();

  // If live capability is provided, verify against it and fail closed if unavailable
  if (capability !== undefined) {
    if (!isPsi4Available(capability)) return false;
    const pairs = capability?.supported_method_basis_pairs ?? [];
    return pairs.some((p) => p.method.toLowerCase() === m && p.basis.toLowerCase() === b);
  }

  // Baseline verification against accepted pairs contract
  return PSI4_SUPPORTED_PAIRS.some((p) => p.method === m && p.basis === b);
}

/**
 * Builds a typed calculation submission payload for Psi4 single-point ENERGY.
 */
export function buildPsi4SubmissionPayload(params: {
  projectId: string;
  versionId: string;
  method: string;
  basis: string;
  allowedVersion?: string | null;
  idempotencyKey?: string;
}): CalculationSubmitInput {
  const { projectId, versionId, method, basis, allowedVersion, idempotencyKey } = params;
  const normMethod = method.toLowerCase();
  const normBasis = basis.toLowerCase();

  const isSupported = PSI4_SUPPORTED_PAIRS.some(
    (p) => p.method === normMethod && p.basis === normBasis,
  );
  if (!isSupported) {
    throw new Error(
      `Unsupported Psi4 method/basis combination '${method} / ${basis}'. Only accepted Gate C pairs are supported.`,
    );
  }

  const reference = getPsi4ScfReference(normMethod);

  return {
    structure_version: {
      project_id: projectId,
      entity_type: "structure.version",
      entity_id: versionId,
    },
    specification: {
      task_type: "ENERGY",
      method: {
        identifier: normMethod,
        display_name: getPsi4MethodDisplayName(normMethod),
        registry: "chemdft.method",
      },
      basis: {
        identifier: normBasis,
        display_name: getPsi4BasisDisplayName(normBasis),
        registry: "chemdft.basis",
      },
      charge: 0,
      multiplicity: 1,
      scf: {
        reference,
      },
      engine_preference: {
        engine: "psi4",
        allowed_version: allowedVersion ?? "1.11",
      },
    },
    provider_preference: "AUTO",
    idempotency_key: idempotencyKey ?? `psi4-${crypto.randomUUID()}`,
  };
}
