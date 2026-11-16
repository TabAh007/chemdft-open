import type { EngineCapabilityView } from "@chemdft/schemas";

/**
 * Advisory element-coverage check from the backend's `max_atomic_number_by_basis` capability field.
 * The backend remains authoritative and rejects unsupported inputs before queueing; this only keeps
 * the setup form from offering a combination the capability response already says cannot run.
 * Absent metadata (older API, other engines) never blocks anything.
 */

export type BasisCoverage = { usable: boolean; limit: number | null; offending: number[] };

export function basisCoverage(
  capability: Pick<EngineCapabilityView, "max_atomic_number_by_basis"> | undefined,
  basis: string,
  atomicNumbers: readonly number[],
): BasisCoverage {
  const limit = capability?.max_atomic_number_by_basis?.[basis.toLowerCase()] ?? null;
  if (limit === null) return { usable: true, limit: null, offending: [] };
  const offending = [...new Set(atomicNumbers.filter((z) => z > limit))].sort((a, b) => a - b);
  return { usable: offending.length === 0, limit, offending };
}

export function coverageMessage(basis: string, coverage: BasisCoverage): string | null {
  if (coverage.usable || coverage.limit === null) return null;
  return `${basis.toUpperCase()} is supported only through atomic number ${coverage.limit}; this structure contains element${coverage.offending.length === 1 ? "" : "s"} with Z = ${coverage.offending.join(", ")}.`;
}

/** Elements covered by GTH-DZVP-MOLOPT-SR and GTH-PBE in PySCF: Z = 1–56, 72–86. */
export function periodicElementCoverage(atomicNumbers: readonly number[]): { usable: boolean; offending: number[] } {
  const offending = [...new Set(atomicNumbers.filter((z) => !((z >= 1 && z <= 56) || (z >= 72 && z <= 86))))].sort((a, b) => a - b);
  return { usable: offending.length === 0, offending };
}
