import type { CalculationComparisonOutput, CalculationPairComparison, ResultSummary } from "@chemdft/schemas";

/** Presentation rules for the multi-calculation comparison. All scientific judgement is made server-side. */

export type ComparabilityLabel = CalculationPairComparison["label"];
export type Intent = "success" | "primary" | "warning" | "danger" | "none";

export const MIN_SELECTION = 2;
export const MAX_SELECTION = 8;

const LABELS: Record<ComparabilityLabel, { text: string; intent: Intent; blurb: string }> = {
  DIRECTLY_COMPARABLE: {
    text: "Directly comparable",
    intent: "success",
    blurb: "Same molecule, charge, multiplicity, level of theory, engine and geometry.",
  },
  COMPARABLE_WITH_LIMITATIONS: {
    text: "Comparable with limitations",
    intent: "warning",
    blurb: "A difference can be formed, but the limitations below qualify what it means.",
  },
  NOT_SCIENTIFICALLY_COMPARABLE: {
    text: "Not scientifically comparable",
    intent: "danger",
    blurb: "No difference is formed: the calculations do not share a meaningful reference.",
  },
};

export function comparabilityLabel(label: ComparabilityLabel): { text: string; intent: Intent; blurb: string } {
  return LABELS[label];
}

/** Toggle a result in an ordered selection; the first selected result is the reference. */
export function toggleSelection(selection: readonly string[], resultId: string): string[] {
  if (selection.includes(resultId)) return selection.filter((id) => id !== resultId);
  return selection.length >= MAX_SELECTION ? [...selection] : [...selection, resultId];
}

export function canCompare(selection: readonly string[]): boolean {
  return selection.length >= MIN_SELECTION && selection.length <= MAX_SELECTION;
}

/** Parse `?result=a&result=b`; invalid, duplicate and surplus ids are dropped, never guessed. */
export function selectionFromSearch(search: URLSearchParams): string[] {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const seen: string[] = [];
  for (const id of search.getAll("result")) if (uuid.test(id) && !seen.includes(id)) seen.push(id);
  return seen.slice(0, MAX_SELECTION);
}

export function selectionToSearch(selection: readonly string[]): string {
  const query = new URLSearchParams();
  for (const id of selection) query.append("result", id);
  return query.toString();
}

const TASK_LABEL: Record<string, string> = {
  ENERGY: "Single-point energy",
  GEOMETRY_OPTIMIZATION: "Geometry optimization",
  FREQUENCY: "Vibrational frequencies",
  ORBITAL: "Molecular orbitals",
  TDDFT: "TDDFT excited states",
  THERMOCHEMISTRY: "Thermochemistry",
  CONFORMER_SEARCH: "Conformer search",
};

export function describeSummary(summary: ResultSummary): { title: string; level: string; engine: string } {
  const level = [summary.method, summary.basis].filter(Boolean).join(" / ") || "level of theory not recorded";
  const dispersion = summary.dispersion ? ` + ${summary.dispersion}` : "";
  return {
    title: TASK_LABEL[summary.task] ?? summary.task,
    level: `${level}${dispersion}`,
    engine: [summary.engine, summary.engine_version].filter(Boolean).join(" ") || "engine not recorded",
  };
}

/** Significant-figure formatting that never rounds a stored value silently: full precision stays in the exports. */
export function formatNumber(value: number, digits = 8): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-4) return value.toExponential(digits - 1);
  return value.toFixed(Math.max(0, digits - 1 - Math.floor(Math.log10(abs))));
}

export function evidenceStandingText(pair: Pick<CalculationPairComparison, "evidence_standing">): string {
  return pair.evidence_standing === "CURRENT"
    ? "Both results are currently authoritative evidence."
    : "Historical context only — at least one result is no longer current evidence.";
}

export function summarizeOverall(output: Pick<CalculationComparisonOutput, "overall" | "pairs">): string {
  const counts = { DIRECTLY_COMPARABLE: 0, COMPARABLE_WITH_LIMITATIONS: 0, NOT_SCIENTIFICALLY_COMPARABLE: 0 };
  for (const pair of output.pairs) counts[pair.label] += 1;
  return (Object.entries(counts) as [ComparabilityLabel, number][])
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${LABELS[label].text.toLowerCase()}`)
    .join(" · ");
}
