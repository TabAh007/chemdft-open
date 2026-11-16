import { describe, expect, it } from "vitest";

import {
  ALL, claimMatches, codeLabel, deltaText, emptyFilters, facetCounts, filtersFromSearch, MAX_VALUE_FIELDS, numberText,
  searchFromFilters, uncertaintyText, valueText, valueView, visibleSelection,
} from "../src/lib/claim-format";

/** Presentation rules only. The numbers are arbitrary digit-preservation probes, not scientific results. */

describe("numberText keeps every digit the server sent", () => {
  it.each([
    [0.123456789, "0.123456789"],
    [24.4565, "24.4565"],
    [-1.1167593073964255, "-1.1167593073964255"],
    [12000.5, "12000.5"],
    [123456, "123456"],
    [1234567.891, "1234567.891"],
    [1e-10, "1e-10"],
    [1.2345678901234568e-10, "1.2345678901234568e-10"],
    [0.0255, "0.0255"],
    [100, "100"],
    [1482.3, "1482.3"],
    [-0.000012345678, "-0.000012345678"],
    [0, "0"],
  ])("%s", (input, expected) => {
    expect(numberText(input)).toBe(expected);
  });

  it("round-trips: parsing the shown text gives the identical double", () => {
    for (const n of [0.1, 0.123456789, 24.4565, -1.1167593073964255, 1e-10, 5e-324, 1.7976931348623157e308, 12000.5]) {
      expect(Number(numberText(n))).toBe(n);
    }
  });

  it("documents the contract limit: a JSON number cannot carry trailing zeros, so 1.50 arrives as 1.5", () => {
    expect(numberText(JSON.parse("1.50") as number)).toBe("1.5");
    // A string value is shown exactly as recorded, including trailing zeros.
    expect(valueText("1.50")).toBe("1.50");
  });

  it("never hides non-finite values", () => {
    expect(numberText(Number.NaN)).toBe("NaN");
    expect(numberText(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("valueView / valueText", () => {
  it("scalars carry the server unit and nothing else", () => {
    expect(valueText(24.4565, "degree")).toBe("24.4565 degree");
    expect(valueText(0.123456789, "Å")).toBe("0.123456789 Å");
    expect(valueView(1e-10)).toEqual({ kind: "scalar", text: "1e-10" });
  });

  it("is a range only when the server says so", () => {
    expect(valueView([1.5, 2.25], { claimType: "RANGE" })).toEqual({ kind: "range", from: "1.5", to: "2.25" });
    expect(valueView([700, 800], { claimType: "EXPERIMENTAL_CONDITION", qualifier: "reported range" })).toEqual({ kind: "range", from: "700", to: "800" });
    expect(valueText([-1.123456789, -0.5], "eV", { claimType: "RANGE" })).toBe("-1.123456789 to -0.5 eV");
    // Same shape, no server range signal: a list, never an invented range.
    expect(valueView([1, 2], { claimType: "NUMERIC_VALUE" })).toEqual({ kind: "list", items: ["1", "2"] });
    expect(valueText([0.123456789, 2], null, { claimType: "NUMERIC_VALUE" })).toBe("0.123456789, 2");
  });

  it("objects become labelled fields with full digits, never raw JSON", () => {
    const view = valueView({ a: 0.123456789, nested: { b: 1e-10, c: [1.5, "x"] }, flag: true, none: null });
    expect(view).toEqual({
      kind: "fields", omitted: 0,
      fields: [
        { label: "a", text: "0.123456789" },
        { label: "nested.b", text: "1e-10" },
        { label: "nested.c[0]", text: "1.5" },
        { label: "nested.c[1]", text: "x" },
        { label: "flag", text: "true" },
        { label: "none", text: "null" },
      ],
    });
    expect(valueText({ a: 1 })).not.toContain("{");
  });

  it("caps very large objects but says how many fields were omitted", () => {
    const big = Object.fromEntries(Array.from({ length: MAX_VALUE_FIELDS + 5 }, (_, index) => [`k${index}`, index]));
    const view = valueView(big);
    expect(view.kind === "fields" && view.fields).toHaveLength(MAX_VALUE_FIELDS);
    expect(view.kind === "fields" && view.omitted).toBe(5);
    expect(valueText(big)).toContain("+5 more");
  });

  it("strings are verbatim; missing values are stated", () => {
    expect(valueText("Ar:H2 20:1")).toBe("Ar:H2 20:1");
    expect(valueView(null)).toEqual({ kind: "empty" });
    expect(valueText(undefined)).toBe("No value recorded");
  });
});

describe("uncertainty is shown as recorded, in any shape", () => {
  it("absent stays absent", () => {
    expect(uncertaintyText(null, "Å")).toBeNull();
    expect(uncertaintyText(undefined)).toBeNull();
  });
  it("a bare number keeps every digit and the quantity's unit, with no ± or meaning attached", () => {
    expect(uncertaintyText(0.02, "Å")).toBe("0.02 Å");
    expect(uncertaintyText(0.123456789)).toBe("0.123456789");
    expect(uncertaintyText(0.02, "Å")).not.toContain("±");
  });
  it("objects are labelled fields, not JSON", () => {
    expect(uncertaintyText({ low: 1.25, high: 1.75, kind: "interval" })).toBe("low: 1.25; high: 1.75; kind: interval");
  });
});

describe("server deltas", () => {
  it("keeps every digit and the server unit", () => {
    expect(deltaText(0.0255, "degree")).toBe("0.0255 degree");
    expect(deltaText(0.00004, "degree")).toBe("0.00004 degree");
    expect(deltaText(null, "degree")).toBeNull();
  });
});

describe("labels fall back to the raw server code", () => {
  it("maps known codes and keeps unknown ones", () => {
    expect(codeLabel("source_authority", "USER_UPLOADED")).toBe("User uploaded");
    expect(codeLabel("claim_type", "CALCULATION_RESULT")).toBe("Calculation result");
    expect(codeLabel("claim_type", "NUMERIC_VALUE")).toBe("Numeric value");
    expect(codeLabel("review_state", "SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

const claims = [
  { id: "1", subject: "XRD", predicate: "2θ peak position", source_label: "Paper", claim_type: "PEAK_POSITION", source_authority: "EXTRACTED", review_state: "DETECTED", value: 24.4565, unit: "degree" },
  { id: "2", subject: "XRD pattern", predicate: "2θ digitized peak 1", source_label: "Dataset", claim_type: "PEAK_POSITION", source_authority: "DIGITIZED", review_state: "COMMITTED", value: 24.4, unit: "degree" },
  { id: "3", subject: "H2", predicate: "total_energy", source_label: "Calc", claim_type: "CALCULATION_RESULT", source_authority: "CALCULATED", review_state: "UNVERIFIED", value: -1.1167593073964255, unit: "Eh" },
];

describe("filters, counts and URL state", () => {
  it("search matches the full-precision digits and the friendly label", () => {
    expect(claims.filter((c) => claimMatches(c, { ...emptyFilters, q: "24.4565" })).map((c) => c.id)).toEqual(["1"]);
    expect(claims.filter((c) => claimMatches(c, { ...emptyFilters, q: "-1.1167593073964255" })).map((c) => c.id)).toEqual(["3"]);
    expect(claims.filter((c) => claimMatches(c, { ...emptyFilters, q: "digitized" })).map((c) => c.id)).toEqual(["2"]);
  });

  it("facet counts ignore only their own facet", () => {
    const filters = { ...emptyFilters, authority: "EXTRACTED" };
    expect(Object.fromEntries(facetCounts(claims, filters, "type"))).toEqual({ PEAK_POSITION: 1 });
    expect(Object.fromEntries(facetCounts(claims, filters, "authority"))).toEqual({ EXTRACTED: 1, DIGITIZED: 1, CALCULATED: 1 });
  });

  it("round-trips through the URL and leaves defaults out", () => {
    expect(searchFromFilters(emptyFilters, null)).toBe("");
    const text = searchFromFilters({ q: " peak ", type: "PEAK_POSITION", authority: ALL, review: "DETECTED" }, "abc");
    expect(filtersFromSearch(new URLSearchParams(text))).toEqual({ q: "peak", type: "PEAK_POSITION", authority: ALL, review: "DETECTED", claim: "abc" });
  });

  it("never substitutes a different claim when the chosen one is filtered out", () => {
    expect(visibleSelection(claims, "2")?.id).toBe("2");
    expect(visibleSelection([claims[0]!], "2")).toBeNull();
    expect(visibleSelection(claims, null)).toBeNull();
  });
});
