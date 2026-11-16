/**
 * "Save relaxed structure as a new version" (release 0.0.45). Offered only for a converged Quantum ESPRESSO relaxation whose
 * result stores the final positions; the server builds the version from the stored result document and nothing here
 * computes or edits a coordinate.
 */
export const RELAXED_VERSION_NOTE = "cell fixed; positions relaxed with Quantum ESPRESSO 7.6 PBE+U";

export function canSaveRelaxedStructure(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload || payload.engine !== "qe") return false;
  const relaxation = payload.relaxation as { converged?: unknown; final_positions?: unknown } | null | undefined;
  return Boolean(relaxation) && relaxation?.converged === true && Array.isArray(relaxation?.final_positions) && relaxation.final_positions.length > 0;
}

export function savedVersionSummary(version: { revision: number; origin: string }): string {
  return `Saved as version V${version.revision} (${version.origin.toLowerCase()} from this calculation, authority CALCULATED). Version V${version.revision - 1} is unchanged.`;
}
