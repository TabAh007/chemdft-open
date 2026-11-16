import { describe, expect, it } from "vitest";
import type { OverviewRow } from "@chemdft/schemas";
import {
  derivedEnergyUnits, emptyBreakdown, energyQuantityLabel, formatStoredValue, HARTREE_TO_EV, HARTREE_TO_KCAL_PER_MOL, jobsPointerText, jobsSummary,
  libraryMode, parseSection, resultDetailHref, rowPrimaryQuantity, unitLabel,
} from "../src/lib/results-model";

const row = (over: Record<string, unknown> = {}): OverviewRow => ({
  calculation_id: "calc-1", calculation_state: "SUCCEEDED", job_state: "SUCCEEDED", created_at: "2026-10-19T10:00:00", updated_at: "2026-10-19T10:05:00",
  evidence_use: "CURRENT", task: "ENERGY", result_id: "res-1", method: "hf", basis: "STO-3G", engine: "pyscf", engine_version: "2.14.0",
  charge: 0, multiplicity: 1, quantities: [{ key: "total_energy", kind: "ENERGY", label: "Total electronic energy", unit: "Eh", value: -1.1167593073964255 }],
  ...over,
}) as unknown as OverviewRow;

const counts = (over: Record<string, number> = {}) => ({ pending: 0, failed: 0, canceled: 0, no_result: 0, ...over });
const pageOf = (published: number, calculations: number, without = counts(), matching = published) => ({ total_published: published, total_matching: matching, total_calculations: calculations, without_result: without });

describe("library mode follows the server's exact count of ALL published results", () => {
  it("is loading until the first page exists", () => expect(libraryMode(null)).toBe("loading"));
  it("is empty with none, single with exactly one, multiple with more", () => {
    expect(libraryMode({ total_published: 0 })).toBe("empty");
    expect(libraryMode({ total_published: 1 })).toBe("single");
    expect(libraryMode({ total_published: 2 })).toBe("multiple");
    expect(libraryMode({ total_published: 5000 })).toBe("multiple");
  });
  it("is not changed by filtering: a filter that matches nothing or one row keeps the table", () => {
    expect(libraryMode(pageOf(40, 400, counts(), 0))).toBe("multiple");
    expect(libraryMode(pageOf(40, 400, counts(), 1))).toBe("multiple");
  });
});

describe("published results vs calculation records vs jobs", () => {
  it("counts published results, calculation records and calculations without a result separately", () => {
    const summary = jobsSummary(pageOf(2, 4, counts({ pending: 1, failed: 1 })));
    expect(summary).toMatchObject({ published: 2, matching: 2, calculations: 4, withoutResult: 2, pending: 1, failed: 1, canceled: 0, noResult: 0 });
  });
  it("takes every number from the server, whatever the page holds", () => {
    const summary = jobsSummary(pageOf(1200, 1500, counts({ failed: 250, canceled: 30, no_result: 20 }), 37));
    expect(summary).toMatchObject({ published: 1200, matching: 37, calculations: 1500, withoutResult: 300 });
  });
  it("words the empty state for each situation", () => {
    expect(emptyBreakdown(jobsSummary(pageOf(0, 0))).headline).toMatch(/No calculations/);
    expect(emptyBreakdown(jobsSummary(pageOf(0, 3, counts({ pending: 1, failed: 2 })))).headline).toMatch(/still in progress/);
    expect(emptyBreakdown(jobsSummary(pageOf(0, 1, counts({ failed: 1 })))).headline).toMatch(/The calculation failed/);
    expect(emptyBreakdown(jobsSummary(pageOf(0, 2, counts({ failed: 2 })))).headline).toMatch(/All 2 calculations failed/);
    expect(emptyBreakdown(jobsSummary(pageOf(0, 1, counts({ no_result: 1 })))).headline).toMatch(/without a published result/);
    expect(emptyBreakdown(jobsSummary(pageOf(0, 2, counts({ failed: 1, canceled: 1 })))).headline).toMatch(/No published results yet/);
  });
  it("words the Jobs pointer and stays silent when nothing needs it", () => {
    expect(jobsPointerText(jobsSummary(pageOf(1, 1)))).toBeNull();
    expect(jobsPointerText(jobsSummary(pageOf(1, 3, counts({ pending: 1, failed: 1 }))))).toBe("2 calculations have no published result (1 in progress, 1 failed).");
    expect(jobsPointerText(jobsSummary(pageOf(1, 2, counts({ failed: 1 }))))).toBe("1 calculation has no published result (1 failed).");
  });
  it("handles a missing page", () => expect(jobsSummary(null)).toMatchObject({ published: 0, calculations: 0, withoutResult: 0 }));
});

describe("primary quantity wording", () => {
  it("names a PySCF SCF total energy precisely and states that it includes nuclear repulsion", () => {
    const q = energyQuantityLabel({ engine: "pyscf", method: "hf" });
    expect(q.label).toBe("Hartree–Fock total energy");
    expect(q.note).toMatch(/includes nuclear repulsion and is not the electronic-only component/);
  });
  it("never repeats the ambiguous 'Total electronic energy' label", () => {
    const q = rowPrimaryQuantity(row())!;
    expect(q.label).not.toMatch(/electronic/i);
    expect(q.label).toBe("Hartree–Fock total energy");
    expect(energyQuantityLabel({ engine: "pyscf", method: "b3lyp" }).label).toBe("B3LYP total energy");
    expect(energyQuantityLabel({ engine: "psi4", method: "mp2" }).label).toBe("MP2 total energy");
  });
  it("labels xTB on its own scale", () => {
    const q = energyQuantityLabel({ engine: "xtb", method: "gfn2" });
    expect(q.label).toBe("GFN2-xTB total energy");
    expect(q.note).toMatch(/not comparable with ab initio/);
  });
  it("keeps the stored value, unit and non-energy labels untouched", () => {
    const q = rowPrimaryQuantity(row())!;
    expect(q.value).toBe(-1.1167593073964255);
    expect(q.valueText).toBe("-1.1167593074");
    expect(q.unit).toBe("Eh");
    const other = rowPrimaryQuantity(row({ quantities: [{ key: "gap", kind: "GAP", label: "HOMO–LUMO gap", unit: "eV", value: 1.2345678 }] }))!;
    expect(other.label).toBe("HOMO–LUMO gap");
    expect(other.unit).toBe("eV");
    expect(rowPrimaryQuantity(row({ quantities: [] }))).toBeNull();
  });
  it("normalizes only the spelling of the hartree unit", () => {
    expect(unitLabel("hartree")).toBe("Eh");
    expect(unitLabel("HARTREE")).toBe("Eh");
    expect(unitLabel("1")).toBe("");
    expect(unitLabel("kcal/mol")).toBe("kcal/mol");
  });
});

describe("derived unit conversions", () => {
  it("are deterministic and only offered for hartree", () => {
    const value = -1.1167593073964255;
    expect(derivedEnergyUnits(value, "Eh")).toEqual({ eV: (value * HARTREE_TO_EV).toFixed(4), kcalPerMol: (value * HARTREE_TO_KCAL_PER_MOL).toFixed(2) });
    expect(derivedEnergyUnits(value, "Eh")).toEqual({ eV: "-30.3886", kcalPerMol: "-700.78" });
    expect(derivedEnergyUnits(value, "eV")).toBeNull();
    expect(derivedEnergyUnits(Number.NaN, "Eh")).toBeNull();
  });
  it("uses the CODATA 2018 constants", () => {
    expect(HARTREE_TO_EV).toBeCloseTo(27.211386245988, 12);
    expect(HARTREE_TO_KCAL_PER_MOL).toBeCloseTo(627.5094740631, 9);
  });
  it("shows hartree at ten decimals and other units at ten significant digits", () => {
    expect(formatStoredValue(-1.1167593073964255, "Eh")).toBe("-1.1167593074");
    expect(formatStoredValue(1.5, "eV")).toBe("1.5");
    expect(formatStoredValue(Number.NaN, "Eh")).toBe("—");
  });
});

describe("links", () => {
  it("builds a Results-owned detail route and validates deep-link sections", () => {
    expect(resultDetailHref("en", "p1", "r1")).toBe("/en/projects/p1/results/r1");
    expect(resultDetailHref("en", "p1", "r1", "export")).toBe("/en/projects/p1/results/r1?section=export");
    expect(parseSection("provenance")).toBe("provenance");
    expect(parseSection("nonsense")).toBeNull();
    expect(parseSection(undefined)).toBeNull();
  });
});
