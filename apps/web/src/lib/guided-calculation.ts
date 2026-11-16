import type { CalculationSubmitInput, OptimizationOptions } from "@chemdft/schemas";
import { buildPsi4SubmissionPayload } from "./psi4-calculation";

export type CalculationConfig = {
  engine: string;
  allowedVersion?: string | undefined;
  optimizationOptions?: OptimizationOptions | undefined;
  method: string;
  basis: string | null;
  charge: number;
  multiplicity: number;
  convergence: number;
  taskType?: "ENERGY" | "GEOMETRY_OPTIMIZATION" | "TDDFT" | "FREQUENCY";
  tddftOptions?: {
    nstates: number;
    spin: "singlet";
    gauge: "length";
    conv_tol: number;
  } | undefined;
  ramanOptions?: {
    enabled: boolean;
    strategy: "PLACZEK_STATIC";
    polarizability_strategy: "FINITE_ELECTRIC_FIELD";
    electric_field_step_au: number;
    derivative_step_angstrom_amu_half: number;
    symmetrize_polarizability: boolean;
    antisymmetry_tolerance: number;
  } | undefined;
};

export function buildGuidedSubmission(projectId: string, versionId: string, config: CalculationConfig): CalculationSubmitInput {
  if (config.charge == null || !Number.isInteger(config.charge)) {
    throw new Error("A valid integer charge is required to build a calculation submission.");
  }
  const task = config.taskType ?? "ENERGY";
  const isXtb = config.engine === "xtb";
  const isPsi4 = config.engine === "psi4";

  if (isPsi4) {
    if (task !== "ENERGY") throw new Error("Psi4 supports single-point ENERGY calculations only.");
    if (config.charge !== 0 || config.multiplicity !== 1) {
      throw new Error("Psi4 Gate C scope is restricted to neutral closed-shell singlets (charge 0, multiplicity 1).");
    }
    if (!config.basis) throw new Error("A supported basis set is required for Psi4 calculations.");
    return buildPsi4SubmissionPayload({
      projectId,
      versionId,
      method: config.method,
      basis: config.basis,
      allowedVersion: config.allowedVersion ?? "1.11",
      idempotencyKey: `guided-${crypto.randomUUID()}`,
    });
  }

  if (isXtb && task !== "ENERGY" && task !== "GEOMETRY_OPTIMIZATION") throw new Error("xTB does not support this task.");
  if (isXtb && task === "GEOMETRY_OPTIMIZATION" && (config.optimizationOptions?.optimizer !== "xtb-ancopt" || config.optimizationOptions.xtb_level !== "normal")) throw new Error("Native optimization requires registry-supported ANCopt settings.");
  if (!Number.isFinite(config.convergence) || config.convergence <= 0) throw new Error("Convergence threshold must be a positive number.");
  return {
    structure_version: { project_id: projectId, entity_type: "structure.version", entity_id: versionId },
    specification: {
      task_type: task,
      method: { identifier: config.method, display_name: config.method === "gfn2" ? "GFN2-xTB" : config.method.toUpperCase(), registry: "chemdft.method" },
      basis: isXtb ? null : { identifier: config.basis!, display_name: config.basis!.toUpperCase(), registry: "chemdft.basis" },
      charge: config.charge, multiplicity: config.multiplicity,
      engine_preference: { engine: isXtb ? "xtb" : "pyscf", ...(config.allowedVersion ? { allowed_version: config.allowedVersion } : {}) },
      ...(!isXtb ? { scf: { convergence_threshold: config.convergence } } : {}),
      ...(task === "GEOMETRY_OPTIMIZATION" ? { optimization: config.optimizationOptions ?? { optimizer: "geometric", max_steps: 100 } } : {}),
      ...(task === "FREQUENCY" ? { hessian: { strategy: "ANALYTIC", exclude_translation_rotation: true, coordinate_unit: "angstrom", hessian_unit: "Eh/bohr^2", frequency_unit: "cm^-1" }, ...(config.ramanOptions ? { raman: config.ramanOptions } : {}) } : {}),
      ...(task === "TDDFT" && config.tddftOptions ? { tddft: config.tddftOptions } : {}),
    },
    provider_preference: "AUTO", idempotency_key: `guided-${crypto.randomUUID()}`,
  };
}
