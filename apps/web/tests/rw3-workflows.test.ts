import { describe, expect, it } from "vitest";
import type { OverviewRow, ReusePlan } from "@chemdft/schemas";

import {
  compareHref, EMPTY_FILTERS, filterRows, headline, savedComparisonHref, selectedResultIds, sortRows, standingOf, standingText, verificationText,
} from "../src/lib/overview-view";
import { reuseSubmission } from "../src/lib/workflows-api";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, over: Partial<OverviewRow> = {}): OverviewRow => ({
  calculation_id: uuid(n), calculation_state: "SUCCEEDED", task: "ENERGY", engine: "pyscf", engine_version: "2.14.0",
  method: "b3lyp", basis: "def2-svp", dispersion: null, solvation: null, charge: 0, multiplicity: 1,
  structure_name: "water", formula_hill: "H2O", atom_count: 3, created_at: "2026-10-12T10:00:00", updated_at: `2026-10-12T10:0${n}:00`,
  result_id: uuid(100 + n), result_type: "chemdft.energy", quantities: [{ key: "total_energy", label: "Total electronic energy", value: -76 - n / 100, unit: "Eh", kind: "total_electronic_energy" }],
  effective_state: {
    stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED",
    authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
    source_lineage_validity: "ACTIVE", eligible_for_derivation: true, inactive_result_ids: [],
  },
  evidence_use: "CURRENT", visualizations: [], exports: ["result-json"], saved_comparison_ids: [], ...over,
}) as unknown as OverviewRow;

describe("standing is fail-closed", () => {
  it("only CURRENT is current; unknown and historical never read as current", () => {
    expect(standingOf(row(1))).toBe("current");
    expect(standingOf(row(1, { evidence_use: "HISTORICAL_ONLY" }))).toBe("historical");
    expect(standingOf(row(1, { evidence_use: "UNKNOWN" }))).toBe("historical");
    expect(standingOf(row(1, { evidence_use: "NO_RESULT", result_id: null }))).toBe("none");
    expect(standingText(row(1, { evidence_use: "UNKNOWN" }))).toBe("Standing unknown");
  });
  it("labels historical evidence with its lineage and never says verified for unverified", () => {
    const old = row(1, { evidence_use: "HISTORICAL_ONLY", effective_state: { ...row(1).effective_state!, source_lineage_validity: "SUPERSEDED", eligible_for_derivation: false } });
    expect(standingText(old)).toBe("Historical · superseded");
    expect(verificationText(old)).toBe("Not independently verified");
    expect(verificationText({ effective_state: null })).toBe("—");
  });
});

describe("filtering and sorting", () => {
  const rows = [
    row(1), row(2, { task: "FREQUENCY", engine: "xtb", method: "gfn2", basis: null, formula_hill: "CH4", structure_name: "methane" }),
    row(3, { evidence_use: "HISTORICAL_ONLY" }), row(4, { evidence_use: "NO_RESULT", result_id: null, quantities: [], calculation_state: "FAILED" }),
  ];
  it("filters by task, engine, standing, state and free text", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, task: "FREQUENCY" }).map((r) => r.calculation_id)).toEqual([uuid(2)]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, engine: "xtb" })).toHaveLength(1);
    expect(filterRows(rows, { ...EMPTY_FILTERS, standing: "historical" }).map((r) => r.calculation_id)).toEqual([uuid(3)]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, standing: "none" })).toHaveLength(1);
    expect(filterRows(rows, { ...EMPTY_FILTERS, state: "FAILED" }).map((r) => r.calculation_id)).toEqual([uuid(4)]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, text: "METHANE" })).toHaveLength(1);
    expect(filterRows(rows, { ...EMPTY_FILTERS, text: "gfn2" })).toHaveLength(1);
    expect(filterRows(rows, { ...EMPTY_FILTERS, text: "nothing-matches" })).toEqual([]);
  });
  it("sorts deterministically and puts rows without a value last in both directions", () => {
    expect(sortRows(rows, "energy", "asc").map((r) => r.calculation_id)).toEqual([uuid(3), uuid(2), uuid(1), uuid(4)]);
    expect(sortRows(rows, "energy", "desc").map((r) => r.calculation_id).at(-1)).toBe(uuid(4));
    expect(sortRows(rows, "updated", "desc")[0]!.calculation_id).toBe(uuid(4));
    expect(sortRows(rows, "formula", "asc")[0]!.formula_hill).toBe("CH4");
    expect(rows.map((r) => r.calculation_id)).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]); // input is not mutated
  });
});

describe("navigation and selection", () => {
  it("builds comparison links that the compare page reads back", () => {
    const href = compareHref("en", "p1", [uuid(101), uuid(102)]);
    expect(href).toBe(`/en/projects/p1/compare?result=${uuid(101)}&result=${uuid(102)}`);
    expect(savedComparisonHref("en", "p1", "abc")).toBe("/en/projects/p1/compare?saved=abc");
  });
  it("selection keeps tick order and drops calculations that have no result", () => {
    const rows = [row(1), row(2), row(4, { result_id: null })];
    expect(selectedResultIds(rows, [uuid(2), uuid(4), uuid(1)])).toEqual([uuid(102), uuid(101)]);
  });
  it("shows the first stored quantity with its unit and nothing invented", () => {
    expect(headline(row(1))).toEqual({ text: "-76.010000 Eh", label: "Total electronic energy", full: "-76.01 Eh" });
    expect(headline(row(4, { quantities: [] }))).toBeNull();
  });
});

describe("calculation reuse submission", () => {
  const plan = (over: Partial<ReusePlan> = {}): ReusePlan => ({
    project_id: uuid(9), source_calculation_id: uuid(1), source_state: "SUCCEEDED", can_reuse: true, checks: [],
    structure_version_id: uuid(7), specification: { task_type: "ENERGY", charge: 0, multiplicity: 1 }, notice: "n", ...over,
  }) as unknown as ReusePlan;
  it("submits the stored specification against the same structure version with the given fresh key", () => {
    const payload = reuseSubmission("p1", plan(), "reuse-key-1");
    expect(payload).toMatchObject({
      structure_version: { project_id: "p1", entity_type: "structure.version", entity_id: uuid(7) },
      specification: { task_type: "ENERGY", charge: 0, multiplicity: 1 }, idempotency_key: "reuse-key-1",
    });
  });
  it("refuses to build a submission from a blocked plan", () => {
    expect(() => reuseSubmission("p1", plan({ can_reuse: false, specification: null }), "k")).toThrow(/cannot be reused/);
    expect(() => reuseSubmission("p1", plan({ structure_version_id: null }), "k")).toThrow(/cannot be reused/);
  });
});
