/**
 * Presentation rules for scientific claims. Everything here is formatting only: a number is shown with every digit the
 * server sent (`String(n)` is the shortest string that round-trips the double, which is how the API serialises it);
 * nothing is rounded, converted, reconciled or interpreted. Unknown codes fall back to the raw server code.
 */

export const MAX_VALUE_FIELDS = 60;

const LABELS: Record<string, Record<string, string>> = {
  claim_type: {
    EXPERIMENTAL_CONDITION: "Experimental condition",
    COMPOSITION: "Composition",
    STRUCTURAL_PARAMETER: "Structure parameter",
    PEAK_POSITION: "Peak position",
    PARTICLE_SIZE: "Particle size",
    RANGE: "Range",
    DISTRIBUTION_SUMMARY: "Distribution summary",
    STRUCTURE_ASSERTION: "Structure assertion",
    NUMERIC_VALUE: "Numeric value",
    CALCULATION_RESULT: "Calculation result",
    USER_ENTERED_LITERATURE_VALUE: "User-entered literature",
  },
  source_authority: {
    EXTRACTED: "Extracted",
    DIGITIZED: "Digitized",
    RECONSTRUCTED: "Reconstructed",
    CALCULATED: "Calculated",
    EXPERIMENTAL: "Experimental",
    USER_UPLOADED: "User uploaded",
    USER_ENTERED: "User-entered",
    AI_HYPOTHESIS: "AI hypothesis",
    AI_RECONSTRUCTED: "AI reconstructed",
  },
  review_state: {
    DETECTED: "Detected",
    COMMITTED: "Committed",
    UNVERIFIED: "Unverified",
    VERIFIED: "Verified",
    DISPUTED: "Disputed",
  },
  semantic_status: {
    EXPLICIT: "Explicit",
    INACTIVE_SOURCE: "Inactive source",
  },
  relation: {
    SAME_QUANTITY: "Same quantity",
    NOT_DIRECTLY_COMPARABLE: "Not directly comparable",
    SEMANTICS_DIFFER: "Semantics differ",
    SOURCE_ONLY: "Source only",
    PROJECT_ONLY: "ChemDFT only",
    DERIVED_FROM: "Derived from",
    UNRESOLVED: "Unresolved",
    NEAREST_TO: "Nearest to",
  },
};

export type CodeKind = keyof typeof LABELS;

/** Friendly label for a server code; an unknown code is returned unchanged so nothing is hidden. */
export function codeLabel(kind: CodeKind, code: string): string {
  return LABELS[kind]?.[code] ?? code;
}

export function isKnownCode(kind: CodeKind, code: string): boolean {
  return Boolean(LABELS[kind]?.[code]);
}

/** Every digit the server sent. Non-finite values (never produced by the API) are shown as text, not hidden. */
export function numberText(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  return String(value);
}

export type LabelledField = { label: string; text: string };

export type ValueView =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "scalar"; text: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "list"; items: string[] }
  | { kind: "fields"; fields: LabelledField[]; omitted: number };

function leaf(value: unknown): string {
  if (typeof value === "number") return numberText(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "null";
  return String(value);
}

function flatten(value: unknown, path: string, out: LabelledField[]): void {
  if (Array.isArray(value)) {
    if (value.length === 0) { out.push({ label: path, text: "(empty list)" }); return; }
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) { out.push({ label: path, text: "(empty)" }); return; }
    for (const [key, child] of entries) flatten(child, path ? `${path}.${key}` : key, out);
    return;
  }
  out.push({ label: path, text: leaf(value) });
}

function fieldsView(value: object): ValueView {
  const all: LabelledField[] = [];
  flatten(value, "", all);
  return { kind: "fields", fields: all.slice(0, MAX_VALUE_FIELDS), omitted: Math.max(0, all.length - MAX_VALUE_FIELDS) };
}

/**
 * A two-number array is only called a range when the server says so (claim type RANGE or a qualifier containing
 * "range"); any other array is a list, never an invented range.
 */
export function valueView(value: unknown, context: { claimType?: string | undefined; qualifier?: string | null | undefined } = {}): ValueView {
  if (value === null || value === undefined) return { kind: "empty" };
  if (typeof value === "number") return { kind: "scalar", text: numberText(value) };
  if (typeof value === "string") return value === "" ? { kind: "empty" } : { kind: "text", text: value };
  if (typeof value === "boolean") return { kind: "text", text: leaf(value) };
  if (Array.isArray(value)) {
    const isRange = value.length === 2 && value.every((item) => typeof item === "number")
      && (context.claimType === "RANGE" || /range/i.test(context.qualifier ?? ""));
    if (isRange) return { kind: "range", from: numberText(value[0] as number), to: numberText(value[1] as number) };
    if (value.every((item) => item === null || typeof item !== "object")) return { kind: "list", items: value.map(leaf) };
    return fieldsView(value);
  }
  return fieldsView(value as object);
}

/** One-line text for a value: used for row titles, search and screen readers. Never rounds. */
export function valueText(value: unknown, unit?: string | null | undefined, context: { claimType?: string | undefined; qualifier?: string | null | undefined } = {}): string {
  const view = valueView(value, context);
  const suffix = unit ? ` ${unit}` : "";
  switch (view.kind) {
    case "empty": return "No value recorded";
    case "text": return view.text;
    case "scalar": return `${view.text}${suffix}`;
    case "range": return `${view.from} to ${view.to}${suffix}`;
    case "list": return `${view.items.join(", ")}${suffix}`;
    case "fields": return view.fields.map((field) => `${field.label}: ${field.text}`).join("; ") + (view.omitted ? `; +${view.omitted} more` : "");
  }
}

/**
 * Uncertainty exactly as recorded, any shape. A bare number is a field of the same stored quantity
 * (contracts/scientific.py `Quantity.uncertainty`), so it carries the claim's unit; the page does not call it
 * a standard deviation, an interval or a confidence level because the record does not say.
 */
export function uncertaintyView(uncertainty: unknown, unit?: string | null | undefined): ValueView | null {
  if (uncertainty === null || uncertainty === undefined) return null;
  const view = valueView(uncertainty);
  if (view.kind === "scalar" && unit) return { kind: "scalar", text: `${view.text} ${unit}` };
  return view.kind === "empty" ? null : view;
}

export function uncertaintyText(uncertainty: unknown, unit?: string | null | undefined): string | null {
  const view = uncertaintyView(uncertainty, unit);
  if (!view) return null;
  switch (view.kind) {
    case "empty": return null;
    case "text": return view.text;
    case "scalar": return view.text;
    case "range": return `${view.from} to ${view.to}`;
    case "list": return view.items.join(", ");
    case "fields": return view.fields.map((field) => `${field.label}: ${field.text}`).join("; ");
  }
}

/** Server-provided relation delta, every digit kept. */
export function deltaText(delta: number | null | undefined, unit?: string | null | undefined): string | null {
  if (delta === null || delta === undefined) return null;
  return `${numberText(delta)}${unit ? ` ${unit}` : ""}`;
}

export type ClaimFilters = { q: string; type: string; authority: string; review: string };
export const ALL = "all";

export const emptyFilters: ClaimFilters = { q: "", type: ALL, authority: ALL, review: ALL };

type Filterable = {
  subject: string; predicate: string; source_label: string; claim_type: string; source_authority: string;
  review_state: string; value?: unknown; unit?: string | null | undefined; qualifier?: string | null;
};

export function claimMatches(claim: Filterable, filters: ClaimFilters): boolean {
  const term = filters.q.trim().toLowerCase();
  const haystack = [
    claim.subject, claim.predicate, claim.source_label, claim.claim_type, claim.source_authority, claim.review_state,
    codeLabel("claim_type", claim.claim_type), codeLabel("source_authority", claim.source_authority), codeLabel("review_state", claim.review_state),
    valueText(claim.value, claim.unit, { claimType: claim.claim_type, qualifier: claim.qualifier }),
  ];
  return (!term || haystack.some((text) => text.toLowerCase().includes(term)))
    && (filters.type === ALL || claim.claim_type === filters.type)
    && (filters.authority === ALL || claim.source_authority === filters.authority)
    && (filters.review === ALL || claim.review_state === filters.review);
}

/** Counts of each facet value over the claims that match every OTHER filter, so a count says what choosing it would show. */
export function facetCounts(claims: Filterable[], filters: ClaimFilters, facet: "type" | "authority" | "review"): Map<string, number> {
  const key = { type: "claim_type", authority: "source_authority", review: "review_state" }[facet] as "claim_type" | "source_authority" | "review_state";
  const counts = new Map<string, number>();
  for (const claim of claims) {
    if (!claimMatches(claim, { ...filters, [facet]: ALL })) continue;
    counts.set(claim[key], (counts.get(claim[key]) ?? 0) + 1);
  }
  return counts;
}

export function filtersFromSearch(search: URLSearchParams): ClaimFilters & { claim: string | null } {
  return {
    q: search.get("q") ?? "",
    type: search.get("type") ?? ALL,
    authority: search.get("authority") ?? ALL,
    review: search.get("review") ?? ALL,
    claim: search.get("claim"),
  };
}

export function searchFromFilters(filters: ClaimFilters, claim: string | null): string {
  const search = new URLSearchParams();
  if (claim) search.set("claim", claim);
  if (filters.type !== ALL) search.set("type", filters.type);
  if (filters.authority !== ALL) search.set("authority", filters.authority);
  if (filters.review !== ALL) search.set("review", filters.review);
  if (filters.q.trim()) search.set("q", filters.q.trim());
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** The claim shown in the inspector: the one named in the URL if it is visible, otherwise none (never a silent substitute). */
export function visibleSelection<T extends { id: string }>(visible: T[], claimId: string | null): T | null {
  return claimId ? visible.find((claim) => claim.id === claimId) ?? null : null;
}
