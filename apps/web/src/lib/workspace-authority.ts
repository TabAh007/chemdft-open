import type { WorkspaceCatalogItem } from "@/app/_components/workspace-state-provider";

export function structureAuthorityCounts(items: WorkspaceCatalogItem[]) {
  const structures = items.filter((item) => item.section === "structures");
  return {
    committed: new Set(
      structures
        .filter((item) => item.selection.kind === "structureVersion")
        .map((item) => ("sourceId" in item.selection ? item.selection.sourceId : item.selection.id)),
    ).size,
    candidates: structures.filter((item) => item.selection.kind === "structureCandidate").length,
  };
}

/**
 * Display label for structures in the Explorer header:
 * Shows "Saved" instead of "Committed" and drops the candidate overlap line
 * to avoid text clipping in compact/medium views.
 */
export function structureAuthorityLabel(counts: ReturnType<typeof structureAuthorityCounts>): string {
  return `${counts.committed} saved`;
}

/**
 * Plain-language scientific tooltip preserving the exact docs/02 evidence vocabulary
 * for researchers while keeping UI labels uncluttered.
 */
export function structureAuthorityTooltip(counts: ReturnType<typeof structureAuthorityCounts>): string {
  const parts = [`${counts.committed} saved structure version${counts.committed === 1 ? "" : "s"} (committed Cartesian coordinates)`];
  if (counts.candidates > 0) {
    parts.push(`${counts.candidates} candidate${counts.candidates === 1 ? "" : "s"} awaiting review`);
  }
  return parts.join(" · ");
}

/**
 * Scientific evidence vocabulary mapping to plain-language tooltips.
 * Never alters backend data fields or authority codes.
 */
export function evidenceVocabularyTooltip(authority: string): string {
  switch (authority) {
    case "COMMITTED":
      return "Saved · validated structure version with committed Cartesian coordinates";
    case "CANDIDATE":
      return "Candidate · unreviewed proposal awaiting researcher review";
    case "IMPORTED":
      return "Imported from an external program; not calculated by ChemDFT";
    case "EXPERIMENTAL":
      return "Measured experimental data (or a version derived from it)";
    case "CALCULATED":
      return "Authoritative calculation result published through the Scientific Result Firewall";
    default:
      return authority;
  }
}
