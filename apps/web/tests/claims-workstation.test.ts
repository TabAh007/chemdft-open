// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScientificClaim } from "@chemdft/schemas";

import { ClaimInspector } from "../src/app/_components/claims/claim-inspector";
import { ClaimValue } from "../src/app/_components/claims/claim-value";
import { valueView } from "../src/lib/claim-format";
import { listScientificClaims } from "../src/lib/phase7-api";

/** Structural fixtures only: arbitrary digit probes, not scientific results. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function claim(over: Record<string, unknown> = {}): ScientificClaim {
  return {
    id: id(1), project_id: id(900), claim_type: "NUMERIC_VALUE", subject: "Fixture", predicate: "probe", value: 0.123456789, unit: "Å",
    source_authority: "CALCULATED", source_record_type: "calculation_result", source_record_id: id(2), review_state: "UNVERIFIED",
    semantic_status: "EXPLICIT", source_label: "Calculation result · fixture", ...over,
  } as unknown as ScientificClaim;
}
const inspect = (selected: ScientificClaim | null, others: ScientificClaim[] = [], relations: never[] = []) =>
  renderToStaticMarkup(createElement(ClaimInspector, { claim: selected, claims: others, relations }));

describe("ClaimValue", () => {
  it("renders every digit of a scalar with its unit", () => {
    const html = renderToStaticMarkup(createElement(ClaimValue, { view: valueView(0.123456789), unit: "Å" }));
    expect(html).toContain("0.123456789");
    expect(html).toContain("Å");
  });
  it("renders an object as labelled fields, never raw JSON", () => {
    const html = renderToStaticMarkup(createElement(ClaimValue, { view: valueView({ a: 1e-10, b: { c: 0.123456789 } }) }));
    expect(html).toContain("1e-10");
    expect(html).toContain("b.c");
    expect(html).not.toContain("{");
  });
  it("says how many fields a compact row hides", () => {
    const html = renderToStaticMarkup(createElement(ClaimValue, { view: valueView({ a: 1, b: 2, c: 3, d: 4 }), compact: true }));
    expect(html).toContain("+2 more");
  });
});

describe("ClaimInspector", () => {
  it("shows qualifier verbatim and uncertainty labelled as recorded, without ±", () => {
    const html = inspect(claim({ qualifier: "Source table token scaled from OCR context; inspect source text.", uncertainty: 0.02 }));
    expect(html).toContain("Qualifier (as recorded)");
    expect(html).toContain("Source table token scaled from OCR context; inspect source text.");
    expect(html).toContain("Uncertainty (as recorded)");
    expect(html).toContain("0.02");
    expect(html).not.toContain("±");
  });
  it("shows an object uncertainty as labelled fields", () => {
    const html = inspect(claim({ uncertainty: { low: 1.25, high: 1.75 } }));
    expect(html).toContain("low");
    expect(html).toContain("1.75");
    expect(html).not.toContain("&quot;low&quot;");
  });
  it("omits qualifier and uncertainty sections when the record has none", () => {
    const html = inspect(claim());
    expect(html).not.toContain("Qualifier (as recorded)");
    expect(html).not.toContain("Uncertainty (as recorded)");
  });
  it("keeps the raw server code in a tooltip and data attribute next to the friendly label", () => {
    const html = inspect(claim({ source_authority: "USER_UPLOADED" }));
    expect(html).toContain("User uploaded");
    expect(html).toContain('data-code="USER_UPLOADED"');
    expect(html).toContain("Server code: USER_UPLOADED");
  });
  it("flags an inactive source with the server's reason and shows the effective state", () => {
    const html = inspect(claim({ semantic_status: "INACTIVE_SOURCE", effective_result_state: {
      stored_authority: "CALCULATED", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED",
      authority: "CALCULATED", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
      source_lineage_validity: "RETRACTED", eligible_for_derivation: false, inactive_result_ids: [], reason: "Source result retracted.",
    } }));
    expect(html).toContain("Inactive source: Source result retracted.");
    expect(html).toContain("Effective result state");
    expect(html).toContain("Not eligible");
  });
  it("shows ids as text and links only through the server's source_href", () => {
    const without = inspect(claim({ evidence_id: id(3), source_document_id: id(4) }));
    expect(without).toContain(id(3));
    expect(without).toContain(id(4));
    expect(without).not.toContain("<a ");
    const withLink = inspect(claim({ source_href: "/en/projects/x/workspace?selection=a" }));
    expect(withLink).toContain('href="/en/projects/x/workspace?selection=a"');
  });
  it("shows a server delta with every digit and no delta wording when there is none", () => {
    const left = claim({ id: id(1), predicate: "left" });
    const right = claim({ id: id(5), predicate: "right", value: 24.4565, unit: "degree" });
    const withDelta = renderToStaticMarkup(createElement(ClaimInspector, { claim: left, claims: [left, right], relations: [
      { left_claim_id: id(1), right_claim_id: id(5), relation: "SAME_QUANTITY", rationale: "Same quantity.", numeric_delta: 0.00004, delta_unit: "degree" },
    ] as never }));
    expect(withDelta).toContain("0.00004 degree");
    const without = renderToStaticMarkup(createElement(ClaimInspector, { claim: left, claims: [left, right], relations: [
      { left_claim_id: id(1), right_claim_id: id(5), relation: "NOT_DIRECTLY_COMPARABLE", rationale: "Distinct quantities.", numeric_delta: null, delta_unit: null },
    ] as never }));
    expect(without.toLowerCase()).not.toContain("delta");
    expect(without.toLowerCase()).not.toContain("difference");
  });
  it("asks for a selection instead of substituting a claim", () => {
    expect(inspect(null)).toContain("Select a claim");
  });
});

describe("the Claims page is read only", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads claims with a single GET and no body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ project_id: id(900), claims: [], relations: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await listScientificClaims(id(900), "en");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = ((fetchMock.mock.calls[0] as unknown[])[1] ?? {}) as { method?: string; body?: unknown };
    expect((init.method ?? "GET").toUpperCase()).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("the page sources contain no write request", () => {
    const dirs = [join(__dirname, "../src/app/_components/claims"), join(__dirname, "../src/app/[locale]/projects/[projectId]/claims")];
    const sources = dirs.flatMap((dir) => readdirSync(dir).filter((file) => /\.tsx?$/.test(file)).map((file) => readFileSync(join(dir, file), "utf8")));
    expect(sources.length).toBeGreaterThan(3);
    for (const source of sources) {
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
      expect(source).not.toMatch(/\b(sendBeacon|XMLHttpRequest|WebSocket|EventSource)\b/);
      expect(source).not.toMatch(/from ["']@\/lib\/(?!phase7-api|claim-format|overview-dock|ai-context)/);
    }
    const imports = sources.join("\n").match(/from "@\/lib\/phase7-api"/g) ?? [];
    expect(imports.length).toBe(1);
  });
});
