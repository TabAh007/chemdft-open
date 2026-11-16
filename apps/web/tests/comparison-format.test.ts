import type { ScientificClaim, ScientificComparisonRow } from "@chemdft/schemas";
import { describe, expect, it } from "vitest";

import { ALL } from "../src/lib/claim-format";
import {
  agreementOf, comparisonCsv, comparisonFacetCounts, comparisonSearch, comparisonStateFromSearch, CSV_COLUMNS, csvCell, emptyComparisonFilters,
  explainRow, rowDeltaText, rowMatches,
} from "../src/lib/comparison-format";

/** Structural fixtures only: arbitrary digit probes, not scientific results. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function claim(n: number, over: Record<string, unknown> = {}): ScientificClaim {
  return {
    id: id(n), project_id: id(900), claim_type: "PEAK_POSITION", subject: "Fixture", predicate: "probe", quantity_key: "q", value: 1, unit: "degree",
    qualifier: null, uncertainty: null, source_authority: "EXTRACTED", source_record_type: "evidence_candidate", source_record_id: id(100 + n),
    source_document_id: id(800), page: 2, figure: null, table: null, evidence_id: null, provenance_hash: null, review_state: "DETECTED",
    semantic_status: "EXPLICIT", source_label: "Paper text", source_href: `/en/projects/p/workspace?selection=${n}`, ...over,
  } as unknown as ScientificClaim;
}
function row(n: number, over: Record<string, unknown> = {}): ScientificComparisonRow {
  return {
    id: id(1000 + n), section: "XRD", topic: `Topic ${n}`, quantity_key: "q", relation: "SAME_QUANTITY", source_claims: [claim(n)],
    project_claims: [claim(500 + n, { source_authority: "DIGITIZED", review_state: "COMMITTED" })], delta: null, delta_unit: null, comparison_rule: null,
    unresolved_reason: null, authority_summary: [], review_summary: [], ...over,
  } as unknown as ScientificComparisonRow;
}

describe("deltas are the server's number, every digit", () => {
  it.each([0.025500000000000966, 0.0255, 42.100000000000136, 42.1, 1e-10, -2e-10, -1.1167593073964255, 123456, 0.07654321100000001])("%s", (delta) => {
    expect(rowDeltaText(row(1, { delta, delta_unit: "degree" }))).toBe(`${String(delta)} degree`);
  });
  it("round-trips: the text parses back to the exact double the server sent", () => {
    for (const delta of [0.025500000000000966, 5e-324, 1.7976931348623157e308, -0.1 - 0.2]) {
      expect(Number(rowDeltaText(row(1, { delta, delta_unit: null }))!)).toBe(delta);
    }
  });
  it("says nothing about a difference when the server sent none", () => {
    expect(rowDeltaText(row(1))).toBeNull();
    expect(rowDeltaText(row(1, { delta: null, delta_unit: "degree" }))).toBeNull();
  });
  it("shows a zero difference", () => expect(rowDeltaText(row(1, { delta: 0, delta_unit: "nm" }))).toBe("0 nm"));
});

describe("explainRow", () => {
  it("is blocked for not-comparable relations and for any row with a reason, and keeps both texts verbatim", () => {
    expect(explainRow(row(1, { relation: "NOT_DIRECTLY_COMPARABLE", comparison_rule: "Rule  text." }))).toEqual({ blocked: true, reason: null, rule: "Rule  text." });
    expect(explainRow(row(1, { relation: "SEMANTICS_DIFFER" })).blocked).toBe(true);
    expect(explainRow(row(1, { relation: "UNRESOLVED", unresolved_reason: "No passage." }))).toEqual({ blocked: true, reason: "No passage.", rule: null });
    expect(explainRow(row(1, { relation: "SOURCE_ONLY", unresolved_reason: "Historical." })).blocked).toBe(true);
  });
  it("keeps the rule of a comparable row as a quiet note", () => {
    expect(explainRow(row(1, { comparison_rule: "Delta convention: source minus ChemDFT." }))).toEqual({ blocked: false, reason: null, rule: "Delta convention: source minus ChemDFT." });
  });
});

describe("agreementOf", () => {
  it("plots only same-quantity rows with one finite number per side and the same recorded unit, values unchanged", () => {
    const a = row(1, { source_claims: [claim(1, { value: 24.482 })], project_claims: [claim(2, { value: 24.4565 })] });
    const result = agreementOf([a]);
    expect(result.groups).toHaveLength(1);
    const point = result.groups[0]!.points[0]!;
    expect(Object.is(point.source, 24.482)).toBe(true);
    expect(Object.is(point.project, 24.4565)).toBe(true);
    expect(result.groups[0]!.unit).toBe("degree");
    expect(result.plotted).toBe(1);
  });
  it("makes one group per unit and never mixes units", () => {
    const result = agreementOf([
      row(1), row(2, { source_claims: [claim(2, { unit: "nm" })], project_claims: [claim(3, { unit: "nm" })] }), row(3),
    ]);
    expect(result.groups.map((g) => [g.unit, g.points.length])).toEqual([["degree", 2], ["nm", 1]]);
  });
  it.each([
    ["not directly comparable", { relation: "NOT_DIRECTLY_COMPARABLE" }, /not directly comparable by value/],
    ["semantics differ", { relation: "SEMANTICS_DIFFER" }, /not directly comparable by value/],
    ["unresolved", { relation: "UNRESOLVED" }, /not directly comparable by value/],
    ["source only", { relation: "SOURCE_ONLY", project_claims: [] }, /not directly comparable by value/],
    ["two claims on a side", { source_claims: [claim(1), claim(2)] }, /exactly one paper claim/],
    ["text value", { source_claims: [claim(1, { value: "Ar:H2 2:1" })] }, /single finite number/],
    ["range value", { source_claims: [claim(1, { value: [1, 2] })] }, /single finite number/],
    ["null value", { source_claims: [claim(1, { value: null })] }, /single finite number/],
    ["non-finite", { project_claims: [claim(2, { value: Number.POSITIVE_INFINITY })] }, /single finite number/],
    ["missing unit", { source_claims: [claim(1, { unit: null })] }, /unit is not recorded/],
    ["unit mismatch", { source_claims: [claim(1, { unit: "°C" })], project_claims: [claim(2, { unit: "K" })] }, /units differ.*no conversion/],
  ])("excludes a row: %s", (_name, over, reason) => {
    const result = agreementOf([row(1, over)]);
    expect(result.plotted).toBe(0);
    expect(result.groups).toEqual([]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]!.reason).toMatch(reason);
  });
  it("counts every visible row as plotted or excluded", () => {
    const rows = [row(1), row(2, { relation: "SOURCE_ONLY", project_claims: [] }), row(3)];
    const result = agreementOf(rows);
    expect(result.plotted + result.excluded.length).toBe(result.total);
  });
});

describe("filters, facet counts and URL state", () => {
  const rows = [
    row(1), row(2, { relation: "NOT_DIRECTLY_COMPARABLE", section: "Particle" }), row(3, { relation: "SOURCE_ONLY", project_claims: [], section: "Particle" }),
  ];
  it("matches by search text across topic, value, rule and reason", () => {
    expect(rows.filter((r) => rowMatches(r, { ...emptyComparisonFilters, q: "topic 2" }))).toHaveLength(1);
    expect(rowMatches(row(1, { comparison_rule: "Radius and diameter differ" }), { ...emptyComparisonFilters, q: "diameter" })).toBe(true);
    expect(rowMatches(row(1, { source_claims: [claim(1, { value: 0.123456789 })] }), { ...emptyComparisonFilters, q: "0.123456789" })).toBe(true);
    expect(rowMatches(row(1), { ...emptyComparisonFilters, q: "digitized" })).toBe(true);
  });
  it("filters by relation, section, authority and review", () => {
    expect(rows.filter((r) => rowMatches(r, { ...emptyComparisonFilters, relation: "SOURCE_ONLY" }))).toHaveLength(1);
    expect(rows.filter((r) => rowMatches(r, { ...emptyComparisonFilters, section: "Particle" }))).toHaveLength(2);
    expect(rows.filter((r) => rowMatches(r, { ...emptyComparisonFilters, authority: "DIGITIZED" }))).toHaveLength(2);
    expect(rows.filter((r) => rowMatches(r, { ...emptyComparisonFilters, review: "COMMITTED" }))).toHaveLength(2);
  });
  it("counts ignore only their own facet", () => {
    const filters = { ...emptyComparisonFilters, section: "Particle" };
    expect([...comparisonFacetCounts(rows, filters, "relation")]).toEqual([["NOT_DIRECTLY_COMPARABLE", 1], ["SOURCE_ONLY", 1]]);
    expect([...comparisonFacetCounts(rows, filters, "section")].sort()).toEqual([["Particle", 2], ["XRD", 1]]);
  });
  it("round-trips through the URL and defaults to the rows view", () => {
    const filters = { q: "peak 1", relation: "SAME_QUANTITY", section: "XRD", authority: "DIGITIZED", review: "COMMITTED" };
    const search = comparisonSearch(filters, id(7), "agreement");
    expect(comparisonStateFromSearch(new URLSearchParams(search))).toEqual({ ...filters, row: id(7), view: "agreement" });
    expect(comparisonSearch(emptyComparisonFilters, null, "rows")).toBe("");
    expect(comparisonStateFromSearch(new URLSearchParams("")).view).toBe("rows");
    expect(comparisonStateFromSearch(new URLSearchParams("view=bogus")).view).toBe("rows");
    expect(comparisonStateFromSearch(new URLSearchParams("")).relation).toBe(ALL);
  });
});

describe("CSV export", () => {
  const parse = (text: string) => text.trimEnd().split("\r\n");
  it("has one header and one line per visible row, columns in a fixed order", () => {
    const csv = comparisonCsv([row(1), row(2)]);
    const lines = parse(csv);
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("writes the server's numbers raw, every digit, including a negative delta", () => {
    const csv = comparisonCsv([row(1, {
      source_claims: [claim(1, { value: 24.482 })], project_claims: [claim(2, { value: -1.1167593073964255, unit: "Eh" })], delta: 0.025500000000000966, delta_unit: "degree",
    })]);
    expect(csv).toContain(",24.482,");
    expect(csv).toContain(",-1.1167593073964255,");
    expect(csv).toContain(",0.025500000000000966,degree,");
    expect(csv).not.toContain("'-1.1167593073964255");
  });
  it("quotes cells with commas, quotes and line breaks (RFC 4180)", () => {
    const csv = comparisonCsv([row(1, { topic: 'He said "hi", twice', comparison_rule: "line one\nline two" })]);
    expect(csv).toContain('"He said ""hi"", twice"');
    expect(csv).toContain('"line one\nline two"');
  });
  it.each(["=SUM(A1)", "+1+1", "@cmd", "\tTAB", "\rCR"])("prefixes a single quote to the text cell %j", (text) => {
    expect(csvCell({ text }).startsWith(`'${text.charAt(0)}`) || csvCell({ text }).startsWith(`"'${text.charAt(0)}`)).toBe(true);
  });
  it("leaves ordinary text, a leading minus in text and number cells alone", () => {
    expect(csvCell({ text: "-700.5 to -600.25" })).toBe("-700.5 to -600.25");
    expect(csvCell({ text: "-0.5", numeric: true })).toBe("-0.5");
    expect(csvCell({ text: "Ar:H2 2:1" })).toBe("Ar:H2 2:1");
  });
  it("guards a text claim value that starts with a formula character", () => {
    const csv = comparisonCsv([row(1, { source_claims: [claim(1, { value: "=cmd|' /C calc'!A0", unit: null })] })]);
    expect(csv).toContain(",'=cmd|' /C calc'!A0,");
  });
  it("joins several claims on one side and leaves an absent side empty", () => {
    const csv = comparisonCsv([row(1, { source_claims: [claim(1, { value: 1 }), claim(2, { value: 2 })], project_claims: [] })]);
    expect(csv).toContain(",1 | 2,degree | degree,");
    const fields = parse(csv)[1]!.split(",");
    expect(fields[CSV_COLUMNS.indexOf("chemdft_value")]).toBe("");
  });
  it("exports no row that is filtered out and computes nothing", () => {
    const rows = [row(1, { delta: null }), row(2, { delta: null })];
    const csv = comparisonCsv(rows.filter((r) => r.id === rows[0]!.id));
    expect(parse(csv)).toHaveLength(2);
    expect(parse(csv)[1]!.split(",")[CSV_COLUMNS.indexOf("delta_source_minus_chemdft")]).toBe("");
  });
});
