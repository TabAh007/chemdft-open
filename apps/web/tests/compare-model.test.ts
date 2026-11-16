import { describe, expect, it } from "vitest";
import type { CalculationComparisonOutput, CalculationPairComparison, OverviewRow, ResultSummary } from "@chemdft/schemas";
import {
  conditionsText, formatCount, libraryTally, quantityStatus, ruleNames, selectionLetters, storedAtText,
  aggregateRules, buildDifferenceTable, comparisonTitle, deltaPlot, failedRules, frequencyRows, itemFromRow, locationSearch, makeReference, MAX_SELECTION,
  parseLocation, plottableDeltaKinds, remedyFor, sameSelection, selectionAnnouncement, signed, STATUS, thermoConditionsOf, thermoPoints, toggleResult,
  vibrationalModesOf,
} from "../src/lib/compare-model";

/**
 * Structural fixtures for the presentation rules only. The numbers below are arbitrary placeholders that exist to
 * prove the browser passes the server's values and verdicts through unchanged; they assert nothing scientific and
 * are never imported by production code (see results-fixture-isolation.test.ts).
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function summary(n: number, extra: Partial<ResultSummary> = {}): ResultSummary {
  return {
    result_id: id(n), calculation_id: id(n + 100), result_type: "chemdft.energy", task: "ENERGY", engine: "pyscf", engine_version: "1", method: "hf", basis: "sto-3g", charge: 0, multiplicity: 1,
    structure: { structure_version_id: id(n + 200), formula_hill: "H2O", atom_count: 3, element_sequence: ["O", "H", "H"], geometry_role: "INPUT" },
    quantities: [{ key: "total_energy", label: "Total energy", value: -1 * n, unit: "Eh", kind: "total_energy" }], created_at: "2026-01-01T00:00:00Z", evidence_use: "CURRENT",
    ...extra,
  } as ResultSummary;
}

function pair(reference: number, other: number, label: CalculationPairComparison["label"], extra: Partial<CalculationPairComparison> = {}): CalculationPairComparison {
  const rules = label === "NOT_SCIENTIFICALLY_COMPARABLE"
    ? [{ rule_id: "R5_LEVEL", outcome: "FAIL" as const, detail: "Different level of theory: method (hf vs b3lyp)." }, { rule_id: "R2_MOLECULE", outcome: "PASS" as const, detail: "Same molecular formula (H2O)." }]
    : label === "COMPARABLE_WITH_LIMITATIONS"
      ? [{ rule_id: "R6_ENGINE", outcome: "LIMITATION" as const, detail: "Different engines." }, { rule_id: "R2_MOLECULE", outcome: "PASS" as const, detail: "Same molecular formula (H2O)." }]
      : [{ rule_id: "R2_MOLECULE", outcome: "PASS" as const, detail: "Same molecular formula (H2O)." }];
  return {
    reference_result_id: id(reference), other_result_id: id(other), label, rules, limitations: [], blockers: [], geometry: { relation: "IDENTICAL_STRUCTURE_VERSION" },
    deltas: label === "NOT_SCIENTIFICALLY_COMPARABLE" ? [] : [{ quantity_kind: "total_energy", label: "Total energy", reference_value: -1, other_value: -2, unit: "Eh", delta: -1, delta_kcal_per_mol: -627.5, delta_kj_per_mol: -2625.5, assumptions: [] }],
    evidence_standing: "CURRENT", ...extra,
  } as CalculationPairComparison;
}

function output(results: ResultSummary[], pairs: CalculationPairComparison[], overall: CalculationComparisonOutput["overall"]): CalculationComparisonOutput {
  return { project_id: id(999), reference_result_id: results[0]!.result_id, results, pairs, overall, conversion_factors: { "kJ/mol per Eh": 2625.5, "kcal/mol per Eh": 627.5 }, notice: "n", delta_convention: "other minus reference", agreement_is_not_verification: true } as CalculationComparisonOutput;
}

describe("selection: the ordered ids are the comparison and the first is the reference", () => {
  it("toggles in and out, keeping order", () => {
    expect(toggleResult([], "a").next).toEqual(["a"]);
    expect(toggleResult(["a"], "b").next).toEqual(["a", "b"]);
    expect(toggleResult(["a", "b", "c"], "b").next).toEqual(["a", "c"]);
  });
  it("refuses a ninth result without changing the selection", () => {
    const eight = Array.from({ length: MAX_SELECTION }, (_, i) => `r${i}`);
    const result = toggleResult(eight, "r8");
    expect(result.next).toEqual(eight);
    expect(result.changed).toBe(false);
    expect(result.atLimit).toBe(true);
    expect(toggleResult(eight, "r3").next).toHaveLength(7); // removing is always allowed
  });
  it("changes the reference by moving one id to the front, keeping everyone else's relative order", () => {
    expect(makeReference(["a", "b", "c", "d"], "c")).toEqual(["c", "a", "b", "d"]);
    expect(makeReference(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(makeReference(["a", "b"], "zzz")).toEqual(["a", "b"]);
  });
  it("compares selections by content and order", () => {
    expect(sameSelection(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameSelection(["a", "b"], ["b", "a"])).toBe(false);
  });
});

describe("the URL carries the selection (and only valid ids)", () => {
  it("round-trips repeated result parameters in order", () => {
    const ids = [id(2), id(1), id(3)];
    expect(parseLocation(locationSearch(ids)).ids).toEqual(ids);
    expect(locationSearch([])).toBe("");
  });
  it("drops malformed, duplicate and surplus ids and never guesses", () => {
    const many = Array.from({ length: 12 }, (_, i) => `result=${id(i + 1)}`).join("&");
    expect(parseLocation(`result=nope&result=${id(1)}&result=${id(1)}&${many}`).ids).toHaveLength(MAX_SELECTION);
    expect(parseLocation("result=nope").ids).toEqual([]);
  });
  it("reads a saved comparison and lets it replace the ids", () => {
    expect(parseLocation("saved=abc")).toEqual({ ids: [], savedId: "abc" });
    expect(locationSearch([id(1)], "abc")).toBe("?saved=abc");
    expect(parseLocation("saved=").savedId).toBeNull();
  });
});

describe("rows become result items without altering a stored value", () => {
  const row = {
    calculation_id: id(1), calculation_state: "SUCCEEDED", task: "THERMOCHEMISTRY", engine: "pyscf", engine_version: "2.14.0", method: "b3lyp", basis: "def2-svp", charge: 0, multiplicity: 1,
    structure_id: id(5), structure_name: "water", structure_version_id: id(6), structure_revision: 2, formula_hill: "H2O", created_at: "x", updated_at: "2026-01-01T00:00:00Z", result_id: id(7),
    result_type: "chemdft.thermochemistry", quantities: [{ key: "k", label: "Enthalpy", value: -76.3358234417, unit: "Eh", kind: "enthalpy" }], evidence_use: "HISTORICAL_ONLY",
    effective_state: { authority: "HISTORICAL", validation_state: "VALIDATED", source_lineage_validity: "SUPERSEDED", verification_state: "UNVERIFIED" },
  } as unknown as OverviewRow;
  it("keeps the stored quantity, version and historical standing exactly as recorded", () => {
    const item = itemFromRow(row);
    expect(item.structureText).toBe("water · V2");
    expect(item.structureRevision).toBe("V2");
    expect(item.quantities[0]!.value).toBe(-76.3358234417);
    expect(item.primary).toMatchObject({ label: "Enthalpy", text: "-76.3358234417", unit: "Eh" });
    expect(item.standing).toBe("historical");
    expect(item.standingText).toContain("Historical");
    expect(item.verification).toBe("Not independently verified");
  });
});

describe("compatibility is the server's verdict, shown with words and an icon", () => {
  it("gives every verdict its own text and icon (never colour alone)", () => {
    const icons = new Set(Object.values(STATUS).map((s) => s.icon));
    expect(icons.size).toBe(3);
    for (const status of Object.values(STATUS)) expect(status.text.length).toBeGreaterThan(5);
  });
  it("aggregates each rule's worst outcome across pairings, in the server's wording", () => {
    const out = output([summary(1), summary(2), summary(3)], [pair(1, 2, "COMPARABLE_WITH_LIMITATIONS"), pair(1, 3, "NOT_SCIENTIFICALLY_COMPARABLE")], "NOT_SCIENTIFICALLY_COMPARABLE");
    const rules = aggregateRules(out);
    expect(rules.find((r) => r.ruleId === "R5_LEVEL")?.outcome).toBe("FAIL");
    expect(rules.find((r) => r.ruleId === "R6_ENGINE")?.outcome).toBe("LIMITATION");
    expect(rules.find((r) => r.ruleId === "R2_MOLECULE")?.outcome).toBe("PASS");
    expect(rules.find((r) => r.ruleId === "R2_MOLECULE")?.details).toHaveLength(2);
    expect(failedRules(rules).map((r) => r.ruleId)).toEqual(["R5_LEVEL"]);
    expect(remedyFor("R5_LEVEL")).toMatch(/same method, basis/);
  });
});

describe("the difference table never subtracts anything itself", () => {
  it("passes the server's delta through and shows blocked, unit-mismatched and withheld cells as such", () => {
    const reference = summary(1, { quantities: [
      { key: "e", label: "Total energy", value: -1, unit: "Eh", kind: "total_energy" },
      { key: "f", label: "Lowest frequency", value: 1600, unit: "cm^-1", kind: "freq" },
      { key: "h", label: "Enthalpy", value: -0.5, unit: "Eh", kind: "enthalpy" },
    ] as never });
    const ok = summary(2, { quantities: [
      { key: "e", label: "Total energy", value: -2, unit: "Eh", kind: "total_energy" },
      { key: "f", label: "Lowest frequency", value: 0.01, unit: "Eh", kind: "freq" },
      { key: "h", label: "Enthalpy", value: -0.6, unit: "Eh", kind: "enthalpy" },
    ] as never });
    const blocked = summary(3, { quantities: [{ key: "e", label: "Total energy", value: -9, unit: "Eh", kind: "total_energy" }] as never });
    const p2 = pair(1, 2, "COMPARABLE_WITH_LIMITATIONS", { rules: [{ rule_id: "R8_THERMO", outcome: "LIMITATION", detail: "differ" }] as never });
    const p3 = pair(1, 3, "NOT_SCIENTIFICALLY_COMPARABLE");
    const table = buildDifferenceTable(output([reference, ok, blocked], [p2, p3], "NOT_SCIENTIFICALLY_COMPARABLE"));
    const energy = table.rows.find((r) => r.kind === "total_energy")!;
    expect(energy.cells.get(id(1))).toMatchObject({ state: "reference", value: -1 });
    expect(energy.cells.get(id(2))).toMatchObject({ state: "delta", delta: -1, kcal: -627.5, kj: -2625.5, limited: true }); // the server's -1, not (-2) - (-1) computed here
    expect(energy.cells.get(id(3))).toMatchObject({ state: "blocked", value: -9 });
    expect(table.rows.find((r) => r.kind === "freq")!.cells.get(id(2))).toMatchObject({ state: "unit-mismatch", unit: "Eh", referenceUnit: "cm^-1" });
    const withheld = table.rows.find((r) => r.kind === "enthalpy")!.cells.get(id(2));
    expect(withheld).toMatchObject({ state: "withheld" });
    expect((withheld as { reason: string }).reason).toMatch(/Temperature or pressure differ/);
    expect(table.onlyInOne).toEqual([]);
  });
  it("does not invent a delta when the server withheld it and lists quantities held by only one result", () => {
    const a = summary(1, { quantities: [{ key: "x", label: "Only here", value: 1, unit: "Eh", kind: "only" }, { key: "e", label: "Total energy", value: -1, unit: "Eh", kind: "total_energy" }] as never });
    const b = summary(2);
    const p = pair(1, 2, "DIRECTLY_COMPARABLE", { deltas: [] });
    const table = buildDifferenceTable(output([a, b], [p], "DIRECTLY_COMPARABLE"));
    expect(table.onlyInOne).toEqual(["Only here"]);
    expect(table.rows[0]!.cells.get(id(2))).toMatchObject({ state: "withheld" });
  });
  it("formats signed numbers without changing them", () => {
    expect(signed(0.5)).toBe("+0.50000000");
    expect(signed(-0.5).startsWith("-")).toBe(true);
  });
});

describe("plots exist only where the returned data supports them", () => {
  const both = output([summary(1), summary(2), summary(3)], [pair(1, 2, "COMPARABLE_WITH_LIMITATIONS"), pair(1, 3, "NOT_SCIENTIFICALLY_COMPARABLE")], "NOT_SCIENTIFICALLY_COMPARABLE");
  it("draws the server's own deltas and counts (not draws) the incompatible pairing", () => {
    expect(plottableDeltaKinds(both)).toEqual([{ kind: "total_energy", label: "Total energy", energy: true }]);
    const kcal = deltaPlot(both, "total_energy", "kcal")!;
    expect(kcal.unit).toBe("kcal/mol");
    expect(kcal.bars).toEqual([{ resultId: id(2), value: -627.5, limited: true }]);
    expect(kcal.hiddenIncomparable).toBe(1);
    expect(deltaPlot(both, "total_energy", "native")!.bars[0]!.value).toBe(-1);
    expect(deltaPlot(both, "missing", "native")).toBeNull();
  });
  it("draws nothing when every pairing is incompatible", () => {
    const none = output([summary(1), summary(2)], [pair(1, 2, "NOT_SCIENTIFICALLY_COMPARABLE")], "NOT_SCIENTIFICALLY_COMPARABLE");
    expect(plottableDeltaKinds(none)).toEqual([]);
  });
  it("reads stored conditions and modes defensively and never defaults a missing value", () => {
    expect(thermoConditionsOf({ conditions: { temperature_k: 298.15, pressure_pa: 101325 } })).toEqual({ temperatureK: 298.15, pressurePa: 101325 });
    expect(thermoConditionsOf({ conditions: { temperature_k: 298.15 } })).toBeNull();
    expect(thermoConditionsOf(null)).toBeNull();
    expect(vibrationalModesOf({ modes: [{ frequency_cm1: 1600, imaginary: false }, { frequency_cm1: 100, imaginary: true }] })).toEqual({ realFrequenciesCm1: [1600], imaginaryCount: 1 });
    expect(vibrationalModesOf({ modes: [] })).toBeNull();
    expect(vibrationalModesOf({})).toBeNull();
  });
  it("plots stored thermal values at their own conditions only for two or more compatible results with one unit", () => {
    const th = (n: number, h: number, unit = "Eh") => summary(n, { result_type: "chemdft.thermochemistry", quantities: [{ key: "h", label: "Enthalpy", value: h, unit, kind: "enthalpy" }] as never });
    const out = output([th(1, -1), th(2, -2), th(3, -3)], [pair(1, 2, "COMPARABLE_WITH_LIMITATIONS"), pair(1, 3, "NOT_SCIENTIFICALLY_COMPARABLE")], "NOT_SCIENTIFICALLY_COMPARABLE");
    const conditions = new Map([[id(1), { temperatureK: 100, pressurePa: 101325 }], [id(2), { temperatureK: 300, pressurePa: 101325 }], [id(3), { temperatureK: 500, pressurePa: 101325 }]]);
    const points = thermoPoints(out, conditions, "enthalpy");
    expect(points.map((p) => [p.resultId, p.temperatureK, p.value])).toEqual([[id(1), 100, -1], [id(2), 300, -2]]); // the incompatible result is left out
    expect(thermoPoints(out, new Map([[id(1), conditions.get(id(1))!]]), "enthalpy")).toEqual([]); // one point is not a plot
    const mixed = output([th(1, -1), th(2, -2, "kJ/mol")], [pair(1, 2, "COMPARABLE_WITH_LIMITATIONS")], "COMPARABLE_WITH_LIMITATIONS");
    expect(thermoPoints(mixed, conditions, "enthalpy")).toEqual([]); // different units never share an axis
  });
  it("needs two compatible results with stored real modes to overlay frequencies", () => {
    const out = output([summary(1), summary(2), summary(3)], [pair(1, 2, "DIRECTLY_COMPARABLE"), pair(1, 3, "NOT_SCIENTIFICALLY_COMPARABLE")], "NOT_SCIENTIFICALLY_COMPARABLE");
    const modes = new Map([[id(1), { realFrequenciesCm1: [1600], imaginaryCount: 0 }], [id(2), { realFrequenciesCm1: [1590], imaginaryCount: 1 }], [id(3), { realFrequenciesCm1: [10], imaginaryCount: 0 }]]);
    expect(frequencyRows(out, modes).map((r) => r.resultId)).toEqual([id(1), id(2)]);
    expect(frequencyRows(out, new Map([[id(1), modes.get(id(1))!]]))).toEqual([]);
  });
});

describe("wording", () => {
  it("names a shared result type and otherwise says the types are mixed", () => {
    expect(comparisonTitle([{ taskText: "Energy" }, { taskText: "Energy" }])).toBe("Energy");
    expect(comparisonTitle([{ taskText: "Energy" }, { taskText: "Thermochemistry" }])).toBe("Mixed result types");
  });
  it("announces what was selected and who is the reference", () => {
    expect(selectionAnnouncement(0, null)).toBe("No results selected.");
    expect(selectionAnnouncement(1, "Energy")).toContain("Select another result");
    expect(selectionAnnouncement(3, "Energy")).toBe("3 results selected. Energy is the reference.");
  });
});


describe("library identity and counts", () => {
  const thermo = (extra: Partial<OverviewRow> = {}) => ({
    calculation_id: id(1), calculation_state: "SUCCEEDED", task: "THERMOCHEMISTRY", engine: "pyscf", engine_version: "2.14.0", method: "b3lyp", basis: "def2-svp", charge: 0, multiplicity: 1,
    structure_name: "water", structure_revision: 2, formula_hill: "H2O", created_at: "x", updated_at: "2026-10-05T16:26:55.724713", result_id: id(7), result_type: "chemdft.thermochemistry",
    quantities: [{ key: "k", label: "Enthalpy", value: -1, unit: "Eh", kind: "enthalpy" }], evidence_use: "CURRENT", ...extra,
  }) as unknown as OverviewRow;
  it("shows stored temperature and pressure and never implies conditions that are not recorded", () => {
    expect(itemFromRow(thermo({ conditions: { temperature_k: 100, pressure_pa: 101325 } } as never)).conditions).toEqual({ temperatureK: 100, pressurePa: 101325 });
    expect(conditionsText({ temperatureK: 298.15, pressurePa: 101325 })).toBe("T 298.15 K · p 1 atm");
    expect(conditionsText({ temperatureK: 100, pressurePa: 202650 })).toBe("T 100 K · p 2 atm");
    expect(itemFromRow(thermo()).conditions).toBeNull();
    expect(conditionsText(null)).toBeNull();
  });
  it("tells apart results with identical values by a short id and the stored time (UTC, never guessed)", () => {
    expect(itemFromRow(thermo()).shortId).toBe(id(7).slice(0, 8));
    expect(storedAtText("2026-10-05T16:26:55.724713")).toBe("2026-10-05 16:26 UTC");
    expect(storedAtText("2026-10-05T16:26:55Z")).toBe("2026-10-05 16:26 UTC");
    expect(storedAtText("not a date")).toBeNull();
  });
  it("words the library count from the server's exact counts without implying everything is loaded", () => {
    expect(formatCount(1215)).toBe("1,215");
    const partial = libraryTally(100, 1215, 1215, false);
    expect(partial.text).toBe("100 loaded of 1,215 published");
    expect(partial.title).toContain("100 of 1,215 matching results are loaded");
    expect(libraryTally(100, 340, 1215, true).text).toBe("100 loaded of 340 matching");
    expect(libraryTally(100, 340, 1215, true).title).toContain("1,215 results are published");
    expect(libraryTally(15, 15, 15, false).text).toBe("15 results");
    expect(libraryTally(3, 3, 15, true).text).toBe("3 results match · 15 published");
    expect(libraryTally(1, 1, 1, false).text).toBe("1 result");
  });
  it("names the selection slots A to H", () => {
    expect(selectionLetters(3)).toEqual(["A", "B", "C"]);
    expect(selectionLetters(8).at(-1)).toBe("H");
  });
});

describe("quantity-level status: what the server authorized, and why not", () => {
  const limited = pair(1, 2, "COMPARABLE_WITH_LIMITATIONS");
  const blocked = pair(1, 3, "NOT_SCIENTIFICALLY_COMPARABLE");
  it("distinguishes authorized, limited, incompatible, not formed, unit mismatch and unavailable", () => {
    expect(quantityStatus({ state: "delta", value: 1, unit: "Eh", delta: 1, kcal: 1, kj: 1, limited: false }, undefined)).toMatchObject({ key: "authorized", intent: "success" });
    expect(quantityStatus({ state: "delta", value: 1, unit: "Eh", delta: 1, kcal: 1, kj: 1, limited: true }, limited)).toMatchObject({ key: "limited", label: "With limitations", reason: "engine", intent: "warning" });
    expect(quantityStatus({ state: "blocked", value: 1, unit: "Eh" }, blocked)).toMatchObject({ key: "incompatible", reason: "level of theory", intent: "danger" });
    expect(quantityStatus({ state: "withheld", value: 1, unit: "Eh", reason: "Temperature or pressure differ: no thermal difference is formed." }, limited)).toMatchObject({ key: "withheld", reason: "conditions differ" });
    expect(quantityStatus({ state: "unit-mismatch", value: 1, unit: "Eh", referenceUnit: "cm^-1" }, limited)).toMatchObject({ key: "units", reason: "different units" });
    expect(quantityStatus({ state: "unavailable" }, limited)).toMatchObject({ key: "unavailable", reason: "not stored" });
    expect(ruleNames(blocked, "FAIL")).toEqual(["level of theory"]);
  });
  it("every status has an icon, a label and a sentence behind it for assistive technology", () => {
    for (const cell of [{ state: "reference", value: 1, unit: "Eh" }, { state: "unavailable" }] as const) {
      const status = quantityStatus(cell, undefined);
      expect(status.icon).toBeTruthy(); expect(status.label).toBeTruthy(); expect(status.explanation.length).toBeGreaterThan(10);
    }
  });
  it("identical displayed thermal values never turn a withheld difference into a formed one", () => {
    // The server withheld enthalpy (conditions differ); both stored values happen to be equal. The table still says "not formed".
    const equal = { quantities: [{ key: "h", label: "Enthalpy", value: -76.1, unit: "Eh", kind: "enthalpy" }] as never };
    const out = output([summary(1, equal), summary(2, equal)], [pair(1, 2, "COMPARABLE_WITH_LIMITATIONS", { deltas: [], rules: [{ rule_id: "R8_THERMO", outcome: "LIMITATION", detail: "differ" }] as never })], "COMPARABLE_WITH_LIMITATIONS");
    const cell = buildDifferenceTable(out).rows[0]!.cells.get(id(2))!;
    expect(cell.state).toBe("withheld");
  });
});
