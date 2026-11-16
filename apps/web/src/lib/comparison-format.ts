import type { ScientificClaim, ScientificComparisonRow } from "@chemdft/schemas";

import { ALL, codeLabel, deltaText, numberText, uncertaintyText, valueText } from "./claim-format";

/**
 * Presentation rules for the Paper vs ChemDFT page. Like claim-format.ts this is formatting, filtering and layout
 * only: nothing here subtracts, converts, rounds, fits or reconciles. Every number shown, plotted or exported is the
 * number the server sent, as `String(n)`.
 */

export type ComparisonFilters = { q: string; relation: string; section: string; authority: string; review: string };
export type ComparisonView = "rows" | "agreement";

export const emptyComparisonFilters: ComparisonFilters = { q: "", relation: ALL, section: ALL, authority: ALL, review: ALL };

/** Relations that mean "these two sides cannot be set against each other"; the row says why, in the server's words. */
const BLOCKED_RELATIONS = new Set(["NOT_DIRECTLY_COMPARABLE", "SEMANTICS_DIFFER", "UNRESOLVED"]);

export const claimsOf = (row: ScientificComparisonRow): ScientificClaim[] => [...(row.source_claims ?? []), ...(row.project_claims ?? [])];

function claimContext(claim: ScientificClaim) {
  return { claimType: claim.claim_type, qualifier: claim.qualifier };
}

function rowText(row: ScientificComparisonRow): string[] {
  const claims = claimsOf(row);
  return [
    row.topic, row.section, row.quantity_key ?? "", row.relation, codeLabel("relation", row.relation), row.comparison_rule ?? "", row.unresolved_reason ?? "",
    ...claims.flatMap((claim) => [
      claim.subject, claim.predicate, claim.source_label, claim.qualifier ?? "", claim.source_authority, codeLabel("source_authority", claim.source_authority),
      claim.review_state, codeLabel("review_state", claim.review_state), valueText(claim.value, claim.unit, claimContext(claim)),
    ]),
  ];
}

const authoritiesOf = (row: ScientificComparisonRow) => new Set(claimsOf(row).map((claim) => claim.source_authority));
const reviewsOf = (row: ScientificComparisonRow) => new Set(claimsOf(row).map((claim) => claim.review_state));

export function rowMatches(row: ScientificComparisonRow, filters: ComparisonFilters): boolean {
  const term = filters.q.trim().toLowerCase();
  return (!term || rowText(row).some((text) => text.toLowerCase().includes(term)))
    && (filters.relation === ALL || row.relation === filters.relation)
    && (filters.section === ALL || row.section === filters.section)
    && (filters.authority === ALL || authoritiesOf(row).has(filters.authority))
    && (filters.review === ALL || reviewsOf(row).has(filters.review));
}

export type Facet = "relation" | "section" | "authority" | "review";

/** Counts over the rows matching every OTHER filter, so a count says what choosing that value would show. A row counts once per value it carries. */
export function comparisonFacetCounts(rows: ScientificComparisonRow[], filters: ComparisonFilters, facet: Facet): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!rowMatches(row, { ...filters, [facet]: ALL })) continue;
    const values = facet === "relation" ? [row.relation] : facet === "section" ? [row.section]
      : [...(facet === "authority" ? authoritiesOf(row) : reviewsOf(row))];
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function comparisonStateFromSearch(search: URLSearchParams): ComparisonFilters & { row: string | null; view: ComparisonView } {
  return {
    q: search.get("q") ?? "",
    relation: search.get("relation") ?? ALL,
    section: search.get("section") ?? ALL,
    authority: search.get("authority") ?? ALL,
    review: search.get("review") ?? ALL,
    row: search.get("row"),
    view: search.get("view") === "agreement" ? "agreement" : "rows",
  };
}

export function comparisonSearch(filters: ComparisonFilters, row: string | null, view: ComparisonView): string {
  const search = new URLSearchParams();
  if (view === "agreement") search.set("view", "agreement");
  if (row) search.set("row", row);
  if (filters.relation !== ALL) search.set("relation", filters.relation);
  if (filters.section !== ALL) search.set("section", filters.section);
  if (filters.authority !== ALL) search.set("authority", filters.authority);
  if (filters.review !== ALL) search.set("review", filters.review);
  if (filters.q.trim()) search.set("q", filters.q.trim());
  const text = search.toString();
  return text ? `?${text}` : "";
}

export type RowExplanation = { blocked: boolean; reason: string | null; rule: string | null };

/**
 * What the server said about this relation. `blocked` rows (not directly comparable, semantics differ, unresolved, or any row
 * carrying an `unresolved_reason`) show both texts prominently; other rows show the rule as a quiet line. Both are verbatim.
 */
export function explainRow(row: ScientificComparisonRow): RowExplanation {
  const reason = row.unresolved_reason ?? null;
  const rule = row.comparison_rule ?? null;
  return { blocked: BLOCKED_RELATIONS.has(row.relation) || reason !== null, reason, rule };
}

/** The heading of the why-note: an unresolved row says it is unresolved; rows the server marks as not comparable say that. */
export function whyHeading(row: ScientificComparisonRow): string {
  return row.relation === "NOT_DIRECTLY_COMPARABLE" || row.relation === "SEMANTICS_DIFFER"
    ? "Why this is not directly comparable" : "Why this is unresolved";
}

/** Server delta with every digit and the server's unit; null when the server sent none (the page then says nothing about a difference). */
export const rowDeltaText = (row: ScientificComparisonRow): string | null => deltaText(row.delta, row.delta_unit);

export type AgreementPoint = { rowId: string; topic: string; source: number; project: number; rule: string | null };
export type AgreementGroup = { unit: string; points: AgreementPoint[] };
export type AgreementExclusion = { rowId: string; topic: string; reason: string };
export type Agreement = { groups: AgreementGroup[]; excluded: AgreementExclusion[]; plotted: number; total: number };

type Plottable = { ok: true; unit: string; source: number; project: number } | { ok: false; reason: string };

function plottable(row: ScientificComparisonRow): Plottable {
  if (row.relation !== "SAME_QUANTITY") return { ok: false, reason: `The server marked this row "${codeLabel("relation", row.relation)}", not directly comparable by value.` };
  const source = row.source_claims ?? [], project = row.project_claims ?? [];
  if (source.length !== 1 || project.length !== 1) return { ok: false, reason: "The row does not hold exactly one paper claim and one ChemDFT claim." };
  const left = source[0]!, right = project[0]!;
  const a: unknown = left.value, b: unknown = right.value;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, reason: "A value is not a single finite number." };
  if (!left.unit || !right.unit) return { ok: false, reason: "A unit is not recorded." };
  if (left.unit !== right.unit) return { ok: false, reason: `The units differ (${left.unit} and ${right.unit}); no conversion is made.` };
  return { ok: true, unit: left.unit, source: a, project: b };
}

/**
 * Rows the server marked directly comparable (SAME_QUANTITY), one claim per side, finite numbers, the same recorded unit.
 * Points carry the server's numbers unchanged; the page never converts units or forms its own difference. Everything else is
 * listed as excluded with the reason, so a row that cannot be drawn is never silently dropped.
 */
export function agreementOf(rows: ScientificComparisonRow[]): Agreement {
  const groups = new Map<string, AgreementPoint[]>();
  const excluded: AgreementExclusion[] = [];
  let plotted = 0;
  for (const row of rows) {
    const result = plottable(row);
    if (!result.ok) { excluded.push({ rowId: row.id, topic: row.topic, reason: result.reason }); continue; }
    const points = groups.get(result.unit) ?? [];
    points.push({ rowId: row.id, topic: row.topic, source: result.source, project: result.project, rule: row.comparison_rule ?? null });
    groups.set(result.unit, points);
    plotted += 1;
  }
  return { groups: [...groups].map(([unit, points]) => ({ unit, points })), excluded, plotted, total: rows.length };
}

export const CSV_COLUMNS = [
  "row_id", "section", "topic", "quantity_key", "relation",
  "source_value", "source_unit", "source_qualifier", "source_uncertainty", "source_authority", "source_review_state",
  "source_page", "source_figure", "source_table", "source_document_id", "source_href",
  "chemdft_value", "chemdft_unit", "chemdft_qualifier", "chemdft_uncertainty", "chemdft_authority", "chemdft_review_state",
  "chemdft_record_type", "chemdft_record_id", "chemdft_href",
  "delta_source_minus_chemdft", "delta_unit", "comparison_rule", "unresolved_reason",
] as const;

type Cell = { text: string; numeric?: boolean };

const JOIN = " | ";
const text = (value: string | null | undefined): Cell => ({ text: value ?? "" });

const joinOf = (claims: readonly ScientificClaim[], pick: (claim: ScientificClaim) => string | null | undefined): Cell =>
  text(claims.map((claim) => pick(claim) ?? "").join(JOIN));

function claimCells(claims: readonly ScientificClaim[]): Cell[] {
  if (claims.length === 0) return Array.from({ length: 6 }, () => text(""));
  const single = claims.length === 1 ? claims[0]! : null;
  const value: Cell = single && typeof single.value === "number" ? { text: numberText(single.value), numeric: true }
    : text(claims.map((claim) => valueText(claim.value, null, claimContext(claim))).join(JOIN));
  return [
    value, joinOf(claims, (claim) => claim.unit), joinOf(claims, (claim) => claim.qualifier), joinOf(claims, (claim) => uncertaintyText(claim.uncertainty, claim.unit)),
    joinOf(claims, (claim) => claim.source_authority), joinOf(claims, (claim) => claim.review_state),
  ];
}

/**
 * Spreadsheet programs run text cells that begin with = + @ TAB or CR as formulas. Text cells that do are prefixed with one
 * single quote; number cells are written raw (String(n), so a negative number stays "-1.5"). The policy is in COMPARISON_REDESIGN.md.
 */
export function csvCell(cell: Cell): string {
  let value = cell.text;
  if (!cell.numeric && /^[=+@\t\r]/.test(value)) value = `'${value}`;
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** The visible rows exactly as the server sent them, one line per row (CRLF, RFC 4180). No value is computed. */
export function comparisonCsv(rows: ScientificComparisonRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const source = row.source_claims ?? [], project = row.project_claims ?? [];
    const cells: Cell[] = [
      text(row.id), text(row.section), text(row.topic), text(row.quantity_key), text(row.relation),
      ...claimCells(source),
      joinOf(source, (c) => (c.page == null ? null : String(c.page))), joinOf(source, (c) => c.figure), joinOf(source, (c) => c.table),
      joinOf(source, (c) => c.source_document_id), joinOf(source, (c) => c.source_href),
      ...claimCells(project),
      joinOf(project, (c) => c.source_record_type), joinOf(project, (c) => c.source_record_id), joinOf(project, (c) => c.source_href),
      row.delta == null ? text("") : { text: numberText(row.delta), numeric: true },
      text(row.delta_unit), text(row.comparison_rule), text(row.unresolved_reason),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
