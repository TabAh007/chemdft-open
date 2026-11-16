// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScientificClaim, ScientificComparisonRow } from "@chemdft/schemas";

import { AgreementView, axisExtent, optionFor } from "../src/app/_components/comparison/agreement-chart";
import { ComparisonInspector } from "../src/app/_components/comparison/comparison-inspector";
import { ComparisonRowGroup, ComparisonTable } from "../src/app/_components/comparison/comparison-rows";
import { agreementOf, whyHeading } from "../src/lib/comparison-format";

/** Structural fixtures only: arbitrary digit probes, not scientific results. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function claim(n: number, over: Record<string, unknown> = {}): ScientificClaim {
  return {
    id: id(n), project_id: id(900), claim_type: "PEAK_POSITION", subject: "Fixture", predicate: `predicate ${n}`, quantity_key: "q", value: 24.482, unit: "degree",
    qualifier: null, uncertainty: null, source_authority: "EXTRACTED", source_record_type: "evidence_candidate", source_record_id: id(100 + n),
    source_document_id: id(800), page: 2, figure: null, table: null, evidence_id: null, provenance_hash: "b".repeat(64), review_state: "DETECTED",
    semantic_status: "EXPLICIT", source_label: "Paper text", source_href: `/en/projects/p/workspace?selection=${n}`, created_at: null, ...over,
  } as unknown as ScientificClaim;
}
function row(n: number, over: Record<string, unknown> = {}): ScientificComparisonRow {
  return {
    id: id(1000 + n), section: "XRD", topic: `Topic ${n}`, quantity_key: "q", relation: "SAME_QUANTITY", source_claims: [claim(n)],
    project_claims: [claim(500 + n, { source_authority: "DIGITIZED", review_state: "COMMITTED", value: 24.4565, source_record_type: "experimental_dataset" })],
    delta: 0.025500000000000966, delta_unit: "degree", comparison_rule: "Delta convention: source minus ChemDFT.", unresolved_reason: null,
    authority_summary: ["DIGITIZED", "EXTRACTED"], review_summary: ["COMMITTED", "DETECTED"], ...over,
  } as unknown as ScientificComparisonRow;
}
const group = (r: ScientificComparisonRow, selected = false) =>
  renderToStaticMarkup(createElement("table", null, createElement("tbody", null, createElement(ComparisonRowGroup, { row: r, selected, onSelect: () => undefined }))));

describe("ComparisonRowGroup", () => {
  it("shows both values and the server's difference with every digit, never rounded", () => {
    const html = group(row(1));
    expect(html).toContain("24.482");
    expect(html).toContain("24.4565");
    expect(html).toContain("0.025500000000000966 degree");
    expect(html).toContain("Source minus ChemDFT");
    expect(html).not.toContain("0.0255 degree");
  });
  it("keeps the selectors other specs rely on", () => {
    const html = group(row(1), true);
    expect(html).toContain('class="comparison-row ');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain(`data-row-id="${id(1001)}"`);
  });
  it("shows qualifier and uncertainty as recorded beside the value", () => {
    const html = group(row(1, { source_claims: [claim(1, { qualifier: "approximate, read from a table", uncertainty: 0.002 })] }));
    expect(html).toContain("approximate, read from a table");
    expect(html).toContain("Uncertainty (as recorded):");
    expect(html).toContain("0.002 degree");
  });
  it("puts the reason and rule of a blocked row inside the row, as a note", () => {
    const html = group(row(1, { relation: "NOT_DIRECTLY_COMPARABLE", delta: null, delta_unit: null, comparison_rule: "Radius and diameter differ.", unresolved_reason: "No passage." }));
    expect(html).toContain('role="note"');
    expect(html).toContain("Why this is not directly comparable");
    expect(html).toContain("Radius and diameter differ.");
    expect(html).toContain("No passage.");
    expect(html).not.toContain("Source minus ChemDFT");
    expect(html).toContain('data-code="NOT_DIRECTLY_COMPARABLE"');
  });
  it("links each side only through the server's href and says when there is none", () => {
    const html = group(row(1, { source_claims: [claim(1, { source_href: null })] }));
    expect(html).toContain("No link");
    expect(html).toContain('href="/en/projects/p/workspace?selection=501"');
    expect(html).not.toContain("selection=1\"");
  });
  it("renders a counterpart-less side as empty text, never an invented value", () => {
    const html = group(row(1, { relation: "SOURCE_ONLY", project_claims: [], delta: null, delta_unit: null }));
    expect(html).toContain("No ChemDFT counterpart");
  });
});

describe("ComparisonTable and ComparisonInspector", () => {
  it("renders a real table with section groups and one comparison-row per row", () => {
    const rows = [row(1), row(2, { section: "Thermal" })];
    const html = renderToStaticMarkup(createElement(ComparisonTable, { rows, sections: ["XRD", "Thermal"], selectedId: null, onSelect: () => undefined, loading: false, emptyText: null }));
    expect(html.match(/<tr class="comparison-row /g)).toHaveLength(2);
    expect(html).toContain("<table");
    expect(html).toContain("XRD");
    expect(html).toContain("Thermal");
  });
  it("inspector shows both sides, hash, rule and the convention, and never the word Delta", () => {
    const html = renderToStaticMarkup(createElement(ComparisonInspector, { row: row(1) }));
    expect(html).toContain('aria-label="Comparison row inspector"');
    expect(html).toContain("0.025500000000000966 degree");
    expect(html).toContain("Source minus ChemDFT");
    expect(html).toContain("b".repeat(64));
    expect(html).toContain("View source");
    expect(html).toContain("View dataset");
    expect(html).not.toMatch(/>Delta</);
  });
  it("inspector says so when nothing is selected, and warns about reconstructed structures", () => {
    expect(renderToStaticMarkup(createElement(ComparisonInspector, { row: null }))).toContain("Select a row");
    const html = renderToStaticMarkup(createElement(ComparisonInspector, { row: row(1, { section: "Structure", relation: "DERIVED_FROM", delta: null, delta_unit: null }) }));
    expect(html).toContain("The paper did not provide these full coordinates.");
  });
});

describe("AgreementView", () => {
  it("states what is plotted and lists the exact values and the excluded rows", () => {
    const rows = [row(1), row(2, { relation: "NOT_DIRECTLY_COMPARABLE" })];
    const html = renderToStaticMarkup(createElement(AgreementView, { agreement: agreementOf(rows), selectedId: null, onSelect: () => undefined }));
    expect(html).toContain("1 of 2 visible rows plotted");
    expect(html).toContain("24.482 degree");
    expect(html).toContain("24.4565 degree");
    expect(html).toContain("1 row not plotted");
    expect(html).toContain("nothing is converted, fitted or summarised");
  });
});

describe("Agreement axes", () => {
  type Axis = { min: number; max: number };
  type Series = { type: string; data: Array<number[] | { value: number[] }> };
  const option = (rows: ScientificComparisonRow[]) => {
    const group = agreementOf(rows).groups[0]!;
    return { group, option: optionFor(group, null) as { xAxis: Axis; yAxis: Axis; series: Series[] } };
  };
  const rows = [
    row(1, { source_claims: [claim(1, { value: 24.482 })], project_claims: [claim(2, { value: 24.4565 })] }),
    row(2, { source_claims: [claim(3, { value: 33.2 })], project_claims: [claim(4, { value: 33.123456789 })] }),
    row(3, { source_claims: [claim(5, { value: 10 })], project_claims: [claim(6, { value: 40 })] }),
  ];
  it("both axes use the identical min and max, covering every plotted value on either side", () => {
    const { group, option: o } = option(rows);
    expect(o.xAxis.min).toBe(o.yAxis.min);
    expect(o.xAxis.max).toBe(o.yAxis.max);
    for (const point of group.points) for (const value of [point.source, point.project]) {
      expect(value).toBeGreaterThanOrEqual(o.xAxis.min);
      expect(value).toBeLessThanOrEqual(o.xAxis.max);
    }
  });
  it("the y = x line runs corner to corner of the shared range", () => {
    const { option: o } = option(rows);
    const line = o.series.find((item) => item.type === "line")!;
    expect(line.data).toEqual([[o.xAxis.min, o.xAxis.min], [o.xAxis.max, o.xAxis.max]]);
  });
  it("the extent comes from the plotted values only, and one point still gets a range", () => {
    const { min, max } = axisExtent([10, 40, 24.4565]);
    expect(min).toBeLessThan(10);
    expect(max).toBeGreaterThan(40);
    const single = axisExtent([5, 5]);
    expect(single.min).toBeLessThan(5);
    expect(single.max).toBeGreaterThan(5);
    const zero = axisExtent([0, 0]);
    expect(zero.max).toBeGreaterThan(zero.min);
  });
  it("scatter points keep the server's numbers", () => {
    const { option: o } = option(rows);
    const scatter = o.series.find((item) => item.type === "scatter")!;
    expect((scatter.data[0] as { value: number[] }).value).toEqual([24.482, 24.4565]);
  });
});

describe("inspector order and why-note headings", () => {
  it("shows the relation first and ids and hashes last", () => {
    const html = renderToStaticMarkup(createElement(ComparisonInspector, { row: row(1) }));
    const at = (needle: string) => html.indexOf(needle);
    expect(at(">Relation<")).toBeGreaterThan(-1);
    expect(at(">Relation<")).toBeLessThan(at(">Paper<"));
    expect(at("Source minus ChemDFT")).toBeLessThan(at(">Paper<"));
    expect(at(">Paper<")).toBeLessThan(at(">ChemDFT<"));
    expect(at(">ChemDFT<")).toBeLessThan(at("Provenance hash"));
  });
  it("an unresolved row says it is unresolved; not-comparable rows keep their heading", () => {
    expect(whyHeading(row(1, { relation: "UNRESOLVED" }))).toBe("Why this is unresolved");
    expect(whyHeading(row(1, { relation: "NOT_DIRECTLY_COMPARABLE" }))).toBe("Why this is not directly comparable");
    expect(whyHeading(row(1, { relation: "SEMANTICS_DIFFER" }))).toBe("Why this is not directly comparable");
    expect(group(row(1, { relation: "UNRESOLVED", delta: null, delta_unit: null, unresolved_reason: "No passage." }))).toContain("Why this is unresolved");
  });
});

describe("source guards", () => {
  const dir = join(__dirname, "../src/app/_components/comparison");
  const files = [...readdirSync(dir).filter((name) => name.endsWith(".tsx")).map((name) => join(dir, name)), join(__dirname, "../src/lib/comparison-format.ts")];
  const sources = files.map((file) => [file, readFileSync(file, "utf8")] as const);
  it("no comparison source rounds or locale-formats a number", () => {
    for (const [file, source] of sources) {
      expect(source, file).not.toMatch(/toFixed|toPrecision|toLocaleString|Math\.round|Math\.floor|Math\.ceil|Intl\.NumberFormat/);
    }
  });
  it("the page is read only: one GET through the API helper and no other transport or write", () => {
    for (const [file, source] of sources) {
      expect(source, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|method:\s*["'](POST|PUT|PATCH|DELETE)/i);
    }
    const workstation = sources.find(([file]) => file.endsWith("comparison-workstation.tsx"))![1];
    expect(workstation.match(/getScientificComparison\(/g)).toHaveLength(1);
  });
  it("no comparison style sets text below 0.75rem or off the page's small type scale", () => {
    const css = readFileSync(join(dir, "comparison.module.css"), "utf8");
    const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)rem/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0.75);
    expect(new Set(sizes)).toEqual(new Set([0.75, 0.8125, 1, 1.625]));
  });
  it("the comparison code does no arithmetic on scientific values", () => {
    const lib = sources.find(([file]) => file.endsWith("comparison-format.ts"))![1];
    // Min/max are only axis extent in the chart (agreement-chart.tsx); the library never subtracts, converts or averages.
    expect(lib).not.toMatch(/\.value\s*[-+*/]\s|[-+*/]\s*\w+\.value|reduce\(|Math\.(min|max|abs|pow|sqrt)/);
  });
});
