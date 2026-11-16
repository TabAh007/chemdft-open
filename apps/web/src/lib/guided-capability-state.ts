import type { EngineCapabilityView } from "@chemdft/schemas";

/**
 * Why an engine can or cannot be chosen for a Guided calculation. Decided only from the capability
 * contract the API returns (`/calculations/capabilities`) and the project role; nothing is hardcoded
 * about which engines "should" exist.
 */
export type EngineChoiceKind =
  | "selectable" | "missing-inputs" | "worker-unavailable" | "unsupported-method"
  | "unknown" | "expired" | "no-permission";

export type EngineChoice = { kind: EngineChoiceKind; label: string; reason: string | null; selectable: boolean };

export const CAPABILITIES_EXPIRED_PREFIX = "Engine capabilities expired";

const LABEL: Record<EngineChoiceKind, string> = {
  selectable: "Available",
  "missing-inputs": "Needs inputs",
  "worker-unavailable": "Worker unavailable",
  "unsupported-method": "Not supported here",
  unknown: "Checking availability",
  expired: "Availability expired",
  "no-permission": "No permission",
};

function choice(kind: EngineChoiceKind, reason: string | null): EngineChoice {
  return { kind, label: LABEL[kind], reason, selectable: kind === "selectable" || kind === "missing-inputs" };
}

/** PySCF optimisation needs geomeTRIC, which the hosted compute image does not include (licence field-of-use clause). */
export const HOSTED_GEOMETRIC_MESSAGE = "PySCF geometry optimisation is not available in the hosted version (it needs geomeTRIC, which is not included). Use xTB optimisation, or run ChemDFT yourself; see Self-hosting.";

export function classifyEngineChoice(input: {
  engine: string;
  task: string;
  capabilities: readonly EngineCapabilityView[];
  capabilityError: string | null;
  loading: boolean;
  canExecute: boolean;
  /** Structure-specific scientific restriction (e.g. Psi4 element scope); null when none. */
  restriction?: string | null;
  /** Required inputs the researcher has not yet supplied or confirmed. */
  missingInputs?: readonly string[];
}): EngineChoice {
  if (!input.canExecute) return choice("no-permission", "Your project role can prepare a calculation but not submit one.");
  if (input.capabilityError) {
    return input.capabilityError.startsWith(CAPABILITIES_EXPIRED_PREFIX)
      ? choice("expired", "Engine availability is checked again automatically before submission.")
      : choice("unknown", input.capabilityError);
  }
  if (input.loading && input.capabilities.length === 0) return choice("unknown", "Reading engine availability…");
  const capability = input.capabilities.find((item) => item.engine === input.engine);
  if (!capability) {
    return input.capabilities.length === 0
      ? choice("unknown", "The API reported no engine capabilities.")
      : choice("worker-unavailable", "No worker reported this engine.");
  }
  if (capability.availability !== "AVAILABLE") {
    return choice("worker-unavailable", capability.diagnostic ?? `Reported ${capability.availability.toLowerCase()} by the worker.`);
  }
  if (!capability.supported_tasks.includes(input.task as never)) {
    if (input.engine === "pyscf" && input.task === "GEOMETRY_OPTIMIZATION") return choice("unsupported-method", HOSTED_GEOMETRIC_MESSAGE);
    return choice("unsupported-method", `${capability.engine} does not report support for this task.`);
  }
  if (input.restriction) return choice("unsupported-method", input.restriction);
  if (input.missingInputs && input.missingInputs.length > 0) return choice("missing-inputs", `Needs: ${input.missingInputs.join(", ")}.`);
  return choice("selectable", null);
}

/** Method/basis facts for the selected engine, from the capability contract only. */
export function methodSupported(capability: EngineCapabilityView | undefined, method: string, basis: string | null, needsBasis: boolean): string | null {
  if (!capability) return "Engine capability is not available.";
  if (!capability.supported_methods.includes(method)) return `${method.toUpperCase()} is not reported as supported by ${capability.engine}.`;
  if (needsBasis && (!basis || !capability.supported_basis_sets.includes(basis))) return `Basis set ${basis ? basis.toUpperCase() : "(none)"} is not reported as supported by ${capability.engine}.`;
  return null;
}

/** Mirrors the server's ProjectCapability.WRITE mapping (owner, editor); the server remains the authority. */
export function roleCanExecute(role: string | null | undefined): boolean {
  return role !== null && role !== undefined && ["owner", "editor"].includes(role.toLowerCase());
}
