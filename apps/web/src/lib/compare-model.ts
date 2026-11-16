import type { CalculationComparisonOutput, CalculationPairComparison, OverviewRow, ResultSummary, SummaryQuantity } from "@chemdft/schemas";
import { MAX_SELECTION, MIN_SELECTION, selectionFromSearch, formatNumber, type ComparabilityLabel } from "./comparison-view";
import { levelOfTheory, standingOf, standingText, taskLabel, verificationText } from "./overview-view";
import { formatDisplayValue } from "./quantity-format";
import { unitLabel } from "./results-model";

/**
 * Presentation and selection rules for the Compare workstation. Every scientific judgement (comparability, rule
 * outcomes, deltas, unit conversions) is the server's: this module only orders, groups and words what the server
 * returned, and decides which plots the returned data can honestly support. It never subtracts two stored values.
 */

export { MAX_SELECTION, MIN_SELECTION };

// ---------------------------------------------------------------------------------------------------------------
// Selection (the first id is the reference) and the URL it lives in
// ---------------------------------------------------------------------------------------------------------------

export type SelectionResult = { next: string[]; changed: boolean; atLimit: boolean };

/** Toggle a result. A ninth result is refused (reported as `atLimit`), never silently replacing another. */
export function toggleResult(selection: readonly string[], resultId: string): SelectionResult {
  if (selection.includes(resultId)) return { next: selection.filter((id) => id !== resultId), changed: true, atLimit: false };
  if (selection.length >= MAX_SELECTION) return { next: [...selection], changed: false, atLimit: true };
  return { next: [...selection, resultId], changed: true, atLimit: false };
}

/** Move one result to the front (the reference); everyone else keeps their relative order. */
export function makeReference(selection: readonly string[], resultId: string): string[] {
  if (!selection.includes(resultId)) return [...selection];
  return [resultId, ...selection.filter((id) => id !== resultId)];
}

export type ParsedLocation = { ids: string[]; savedId: string | null };

/** `?result=a&result=b` (repeated, first = reference) or `?saved=id`. Invalid, duplicate and surplus ids are dropped. */
export function parseLocation(search: string | URLSearchParams): ParsedLocation {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const saved = params.get("saved");
  return { ids: selectionFromSearch(params), savedId: saved && saved.trim() !== "" ? saved : null };
}

export function locationSearch(ids: readonly string[], savedId?: string | null): string {
  if (savedId) return `?saved=${encodeURIComponent(savedId)}`;
  const query = new URLSearchParams();
  for (const id of ids) query.append("result", id);
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const sameSelection = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

// ---------------------------------------------------------------------------------------------------------------
// One selected result, as the workstation shows it (always from a stored, published result row)
// ---------------------------------------------------------------------------------------------------------------

export type Standing = "current" | "historical" | "none";

export type CompareItem = {
  resultId: string;
  calculationId: string;
  resultType: string;
  task: string;
  taskText: string;
  structureId: string | null;
  structureVersionId: string | null;
  structureText: string;
  structureName: string | null;
  structureRevision: string | null;
  formula: string | null;
  level: string;
  method: string | null;
  basis: string | null;
  engine: string;
  charge: number | null;
  multiplicity: number | null;
  electronic: string;
  quantities: readonly SummaryQuantity[];
  /** Stored thermochemical conditions (thermochemistry only; null whenever the record does not hold both). */
  conditions: ThermoConditions | null;
  /** First eight characters of the result id: tells apart results that show identical values. */
  shortId: string;
  primary: { label: string; text: string; unit: string } | null;
  standing: Standing;
  standingText: string;
  verification: string;
  authority: string | null;
  validation: string | null;
  updatedAt: string;
};

/** Normalise a published-result row; the row's own stored values are used unchanged. */
export function itemFromRow(row: OverviewRow): CompareItem {
  const quantity = row.quantities?.[0] ?? null;
  const structure = row.structure_name
    ? [row.structure_name, row.structure_revision ? `V${row.structure_revision}` : null].filter(Boolean).join(" · ")
    : row.formula_hill ?? "structure not recorded";
  return {
    resultId: row.result_id ?? "",
    calculationId: row.calculation_id,
    resultType: row.result_type ?? "",
    task: row.task,
    taskText: taskLabel(row.task),
    structureId: row.structure_id ?? null,
    structureVersionId: row.structure_version_id ?? null,
    structureText: structure,
    structureName: row.structure_name ?? null,
    structureRevision: row.structure_revision ? `V${row.structure_revision}` : null,
    formula: row.formula_hill ?? null,
    level: levelOfTheory(row),
    method: row.method ?? null,
    basis: row.basis ?? null,
    engine: [row.engine, row.engine_version].filter(Boolean).join(" ") || "engine not recorded",
    charge: row.charge ?? null,
    multiplicity: row.multiplicity ?? null,
    electronic: `charge ${row.charge ?? "?"} · multiplicity ${row.multiplicity ?? "?"}`,
    quantities: row.quantities ?? [],
    conditions: row.conditions ? { temperatureK: row.conditions.temperature_k, pressurePa: row.conditions.pressure_pa } : null,
    shortId: (row.result_id ?? "").slice(0, 8),
    primary: quantity ? { label: quantity.label, text: formatDisplayValue(quantity.value, quantity.unit), unit: unitLabel(quantity.unit) } : null,
    standing: standingOf(row),
    standingText: standingText(row),
    verification: verificationText(row),
    authority: row.effective_state?.authority ?? null,
    validation: row.effective_state?.validation_state ?? null,
    updatedAt: row.updated_at,
  };
}

/** A short alphabetical-free label for a result: "Energy · B3LYP / def2-svp". */
export function shortLabel(item: Pick<CompareItem, "taskText" | "level">): string {
  return `${item.taskText} · ${item.level}`;
}

/** Position badge: "Reference" for the first, otherwise "B", "C", … (the reference is "A"). */
export function positionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

// ---------------------------------------------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------------------------------------------

export type Outcome = "PASS" | "LIMITATION" | "FAIL";
const OUTCOME_RANK: Record<Outcome, number> = { PASS: 0, LIMITATION: 1, FAIL: 2 };

export const RULE_LABEL: Record<string, string> = {
  R1_STATE: "Scientific standing",
  R2_MOLECULE: "Molecule",
  R3_CHARGE: "Charge",
  R4_MULTIPLICITY: "Multiplicity",
  R5_LEVEL: "Level of theory",
  R6_ENGINE: "Engine",
  R7_GEOMETRY: "Geometry",
  R8_THERMO: "Thermochemical conditions",
};

export const RULE_HELP: Record<string, string> = {
  R1_STATE: "Only currently authoritative results count as current evidence; historical results are context.",
  R2_MOLECULE: "Total energies are only subtracted for the same molecular formula and atom count.",
  R3_CHARGE: "Different charges are different electronic systems.",
  R4_MULTIPLICITY: "Different spin states are different electronic states.",
  R5_LEVEL: "Absolute energies at different methods, bases, dispersion or solvation treatments share no common zero.",
  R6_ENGINE: "Another engine or version agrees only to implementation tolerance; agreement is not verification.",
  R7_GEOMETRY: "A difference at different geometries includes relaxation or conformer effects.",
  R8_THERMO: "Thermal quantities depend on temperature and pressure; they are only subtracted at the same conditions.",
};

export function ruleLabel(ruleId: string): string {
  return RULE_LABEL[ruleId] ?? ruleId;
}

export type RuleSummary = {
  ruleId: string;
  label: string;
  outcome: Outcome;
  /** Every non-reference result whose pairing shares this worst outcome, with the server's wording. */
  details: { otherResultId: string; outcome: Outcome; detail: string }[];
};

/** The worst outcome of each rule across all pairings against the reference, in rule order. */
export function aggregateRules(output: Pick<CalculationComparisonOutput, "pairs">): RuleSummary[] {
  const byRule = new Map<string, RuleSummary>();
  if (!output?.pairs || !Array.isArray(output.pairs)) return [];
  for (const pair of output.pairs) {
    for (const rule of pair.rules) {
      const entry = byRule.get(rule.rule_id) ?? { ruleId: rule.rule_id, label: ruleLabel(rule.rule_id), outcome: "PASS" as Outcome, details: [] };
      if (OUTCOME_RANK[rule.outcome] > OUTCOME_RANK[entry.outcome]) entry.outcome = rule.outcome;
      entry.details.push({ otherResultId: pair.other_result_id, outcome: rule.outcome, detail: rule.detail });
      byRule.set(rule.rule_id, entry);
    }
  }
  return [...byRule.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

export type StatusPresentation = { text: string; short: string; icon: "tick-circle" | "warning-sign" | "cross-circle"; intent: "success" | "warning" | "danger"; blurb: string };

/** Words and icon for a server label. Colour is never the only signal: every status has text and a distinct icon. */
export const STATUS: Record<ComparabilityLabel, StatusPresentation> = {
  DIRECTLY_COMPARABLE: {
    text: "Directly comparable", short: "Comparable", icon: "tick-circle", intent: "success",
    blurb: "Same molecule, charge, multiplicity, level of theory, engine and geometry.",
  },
  COMPARABLE_WITH_LIMITATIONS: {
    text: "Comparable with limitations", short: "With limitations", icon: "warning-sign", intent: "warning",
    blurb: "A difference can be formed, but the limitations qualify what it means.",
  },
  NOT_SCIENTIFICALLY_COMPARABLE: {
    text: "Not scientifically comparable", short: "Not comparable", icon: "cross-circle", intent: "danger",
    blurb: "No difference is formed: the results do not share a meaningful reference.",
  },
};

/** What a researcher would need to change, derived only from the failed rules' own identities. */
export function remedyFor(ruleId: string): string {
  switch (ruleId) {
    case "R2_MOLECULE": return "Choose results for the same molecular formula.";
    case "R3_CHARGE": return "Choose results with the same recorded charge.";
    case "R4_MULTIPLICITY": return "Choose results with the same recorded multiplicity.";
    case "R5_LEVEL": return "Choose results with the same method, basis, dispersion and solvation, or compare them only qualitatively.";
    default: return "Review the rule detail.";
  }
}

export function failedRules(rules: readonly RuleSummary[]): RuleSummary[] {
  return rules.filter((rule) => rule.outcome === "FAIL");
}

/** `quantities` is optional in the generated type; an absent list is an empty one. */
export const qs = (summary: Pick<ResultSummary, "quantities">): readonly SummaryQuantity[] => summary.quantities ?? [];

export function pairFor(output: Pick<CalculationComparisonOutput, "pairs">, resultId: string): CalculationPairComparison | undefined {
  return output.pairs.find((pair) => pair.other_result_id === resultId);
}

export function summaryById(output: Pick<CalculationComparisonOutput, "results">, resultId: string): ResultSummary | undefined {
  return output.results.find((result) => result.result_id === resultId);
}

// ---------------------------------------------------------------------------------------------------------------
// Difference table: one row per stored quantity kind that at least two selected results share
// ---------------------------------------------------------------------------------------------------------------

export type DifferenceCell =
  | { state: "reference"; value: number; unit: string }
  | { state: "delta"; value: number; unit: string; delta: number; kcal: number | null; kj: number | null; limited: boolean }
  /** The pair is incompatible: the stored value is shown, no difference exists. */
  | { state: "blocked"; value: number; unit: string }
  /** A comparable pair whose server withheld this difference (for example thermal quantities at other conditions). */
  | { state: "withheld"; value: number; unit: string; reason: string }
  | { state: "unit-mismatch"; value: number; unit: string; referenceUnit: string }
  | { state: "unavailable" };

export type DifferenceRow = {
  kind: string;
  label: string;
  unit: string;
  /** Keyed by result id: the reference's own value plus each other result's cell. */
  cells: Map<string, DifferenceCell>;
  /** True when the reference does not store this quantity: nothing is measured against it. */
  referenceMissing: boolean;
};

export type DifferenceTable = { rows: DifferenceRow[]; onlyInOne: string[] };

const THERMAL_KINDS = new Set(["zero_point_energy", "enthalpy", "gibbs_free_energy"]);

export function buildDifferenceTable(output: CalculationComparisonOutput): DifferenceTable {
  const reference = summaryById(output, output.reference_result_id) ?? output.results[0];
  if (!reference) return { rows: [], onlyInOne: [] };
  const holders = new Map<string, { label: string; unit: string; ids: Set<string> }>();
  for (const result of output.results) {
    for (const quantity of qs(result)) {
      const entry = holders.get(quantity.kind) ?? { label: quantity.label, unit: quantity.unit, ids: new Set<string>() };
      entry.ids.add(result.result_id);
      holders.set(quantity.kind, entry);
    }
  }
  const rows: DifferenceRow[] = [];
  const onlyInOne: string[] = [];
  for (const [kind, holder] of holders) {
    if (holder.ids.size < 2) { onlyInOne.push(holder.label); continue; }
    const referenceQuantity = qs(reference).find((q) => q.kind === kind);
    const cells = new Map<string, DifferenceCell>();
    for (const result of output.results) {
      const quantity = qs(result).find((q) => q.kind === kind);
      if (!quantity) { cells.set(result.result_id, { state: "unavailable" }); continue; }
      if (result.result_id === reference.result_id) { cells.set(result.result_id, { state: "reference", value: quantity.value, unit: quantity.unit }); continue; }
      const pair = pairFor(output, result.result_id);
      if (!referenceQuantity || !pair) { cells.set(result.result_id, { state: "unavailable" }); continue; }
      if (pair.label === "NOT_SCIENTIFICALLY_COMPARABLE") { cells.set(result.result_id, { state: "blocked", value: quantity.value, unit: quantity.unit }); continue; }
      if (quantity.unit !== referenceQuantity.unit) {
        cells.set(result.result_id, { state: "unit-mismatch", value: quantity.value, unit: quantity.unit, referenceUnit: referenceQuantity.unit });
        continue;
      }
      const delta = pair.deltas.find((d) => d.quantity_kind === kind);
      if (delta && delta.delta != null) {
        cells.set(result.result_id, {
          state: "delta", value: quantity.value, unit: quantity.unit, delta: delta.delta,
          kcal: delta.delta_kcal_per_mol ?? null, kj: delta.delta_kj_per_mol ?? null, limited: pair.label === "COMPARABLE_WITH_LIMITATIONS",
        });
      } else {
        const thermo = THERMAL_KINDS.has(kind) && pair.rules.some((rule) => rule.rule_id === "R8_THERMO");
        cells.set(result.result_id, {
          state: "withheld", value: quantity.value, unit: quantity.unit,
          reason: thermo ? "Temperature or pressure differ: no thermal difference is formed." : "The server formed no difference for this quantity.",
        });
      }
    }
    rows.push({ kind, label: holder.label, unit: holder.unit, cells, referenceMissing: !referenceQuantity });
  }
  return { rows, onlyInOne };
}

/** "+1.23e-3" style signed number with the existing precision rules. */
export function signed(value: number, digits = 8): string {
  const text = formatNumber(value, digits);
  return value > 0 && !text.startsWith("+") ? `+${text}` : text;
}

// ---------------------------------------------------------------------------------------------------------------
// Plots: only what the returned data can honestly support
// ---------------------------------------------------------------------------------------------------------------

export type DeltaUnit = "native" | "kcal" | "kj";

export type DeltaBar = { resultId: string; value: number; limited: boolean };
export type DeltaPlot = { kind: string; label: string; unit: string; nativeUnit: string; bars: DeltaBar[]; hiddenIncomparable: number };

/**
 * The deltas the server formed for one quantity kind, other minus reference. Only pairings that carry a delta appear;
 * a blocked pairing contributes nothing (and is counted so the plot can say so). The values are the server's own
 * deltas and conversions; nothing is subtracted here. Null when no pairing has a delta for the kind.
 */
export function deltaPlot(output: CalculationComparisonOutput, kind: string, unit: DeltaUnit): DeltaPlot | null {
  const bars: DeltaBar[] = [];
  let label = kind, nativeUnit = "";
  for (const pair of output.pairs) {
    const delta = pair.deltas.find((d) => d.quantity_kind === kind);
    if (!delta || delta.delta == null) continue;
    label = delta.label; nativeUnit = delta.unit;
    const value = unit === "native" ? delta.delta : unit === "kcal" ? delta.delta_kcal_per_mol : delta.delta_kj_per_mol;
    if (value == null) continue;
    bars.push({ resultId: pair.other_result_id, value, limited: pair.label === "COMPARABLE_WITH_LIMITATIONS" });
  }
  if (bars.length === 0) return null;
  const hiddenIncomparable = output.pairs.filter((pair) => pair.label === "NOT_SCIENTIFICALLY_COMPARABLE").length;
  return { kind, label, unit: unit === "native" ? nativeUnit : unit === "kcal" ? "kcal/mol" : "kJ/mol", nativeUnit, bars, hiddenIncomparable };
}

/** Quantity kinds for which at least one pairing carries a server-formed delta. */
export function plottableDeltaKinds(output: CalculationComparisonOutput): { kind: string; label: string; energy: boolean }[] {
  const seen = new Map<string, { kind: string; label: string; energy: boolean }>();
  for (const pair of output.pairs) {
    for (const delta of pair.deltas) {
      if (delta.delta == null || seen.has(delta.quantity_kind)) continue;
      seen.set(delta.quantity_kind, { kind: delta.quantity_kind, label: delta.label, energy: delta.delta_kcal_per_mol != null });
    }
  }
  return [...seen.values()];
}

// Stored thermochemical conditions and vibrational modes (read from the stored result payload, never computed) -----

export type ThermoConditions = { temperatureK: number; pressurePa: number };

export function thermoConditionsOf(payload: unknown): ThermoConditions | null {
  const conditions = (payload as { conditions?: { temperature_k?: unknown; pressure_pa?: unknown } } | null)?.conditions;
  const t = conditions?.temperature_k, p = conditions?.pressure_pa;
  return typeof t === "number" && Number.isFinite(t) && typeof p === "number" && Number.isFinite(p) ? { temperatureK: t, pressurePa: p } : null;
}

export type StoredModes = { realFrequenciesCm1: number[]; imaginaryCount: number };

export function vibrationalModesOf(payload: unknown): StoredModes | null {
  const modes = (payload as { modes?: unknown } | null)?.modes;
  if (!Array.isArray(modes)) return null;
  const real: number[] = [];
  let imaginary = 0;
  for (const mode of modes) {
    const record = mode as { frequency_cm1?: unknown; imaginary?: unknown };
    if (record.imaginary === true) { imaginary += 1; continue; }
    if (typeof record.frequency_cm1 === "number" && Number.isFinite(record.frequency_cm1)) real.push(record.frequency_cm1);
  }
  return real.length || imaginary ? { realFrequenciesCm1: real, imaginaryCount: imaginary } : null;
}

export const THERMO_PLOT_KINDS = [
  { kind: "zero_point_energy", label: "Zero-point energy" },
  { kind: "enthalpy", label: "Enthalpy" },
  { kind: "gibbs_free_energy", label: "Gibbs free energy" },
] as const;

export type ThermoPoint = { resultId: string; temperatureK: number; pressurePa: number; value: number; unit: string };

/**
 * Stored thermal values at the conditions each result was computed at. The points are not joined and no value is
 * interpolated or evaluated at another temperature: each point is one stored result. Results that are incompatible
 * with the reference are left out. A kind needs at least two points to be worth plotting.
 */
export function thermoPoints(
  output: CalculationComparisonOutput, conditions: ReadonlyMap<string, ThermoConditions>, kind: string,
): ThermoPoint[] {
  const points: ThermoPoint[] = [];
  for (const result of output.results) {
    const condition = conditions.get(result.result_id);
    if (!condition) continue;
    if (result.result_id !== output.reference_result_id && pairFor(output, result.result_id)?.label === "NOT_SCIENTIFICALLY_COMPARABLE") continue;
    const quantity = qs(result).find((q) => q.kind === kind);
    if (!quantity) continue;
    points.push({ resultId: result.result_id, temperatureK: condition.temperatureK, pressurePa: condition.pressurePa, value: quantity.value, unit: quantity.unit });
  }
  return points.length >= 2 && new Set(points.map((p) => p.unit)).size === 1 ? points : [];
}

export type FrequencyRow = { resultId: string; frequencies: number[]; imaginaryCount: number };

/** Stored real mode positions per result (reference first); incompatible pairings are left out. At least two rows. */
export function frequencyRows(output: CalculationComparisonOutput, modes: ReadonlyMap<string, StoredModes>): FrequencyRow[] {
  const rows: FrequencyRow[] = [];
  for (const result of output.results) {
    const stored = modes.get(result.result_id);
    if (!stored || stored.realFrequenciesCm1.length === 0) continue;
    if (result.result_id !== output.reference_result_id && pairFor(output, result.result_id)?.label === "NOT_SCIENTIFICALLY_COMPARABLE") continue;
    rows.push({ resultId: result.result_id, frequencies: stored.realFrequenciesCm1, imaginaryCount: stored.imaginaryCount });
  }
  return rows.length >= 2 ? rows : [];
}

/** Result types whose stored payload the plots still read (thermochemical conditions now arrive with the result row). */
export const PAYLOAD_TYPES = ["chemdft.vibrational-analysis"] as const;
export const needsPayload = (resultType: string): boolean => (PAYLOAD_TYPES as readonly string[]).includes(resultType);

// ---------------------------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------------------------

/** Heading of the analysis: the shared task when every selected result has one, otherwise a neutral word. */
export function comparisonTitle(items: readonly Pick<CompareItem, "taskText">[]): string {
  const tasks = [...new Set(items.map((item) => item.taskText))];
  return tasks.length === 1 && tasks[0] ? tasks[0] : "Mixed result types";
}

/** The sentence a screen reader hears after a selection change. */
export function selectionAnnouncement(count: number, referenceLabel: string | null): string {
  if (count === 0) return "No results selected.";
  if (count === 1) return `1 result selected. ${referenceLabel ?? "It"} is the reference. Select another result to compare.`;
  return `${count} results selected. ${referenceLabel ?? "The first result"} is the reference.`;
}


// ---------------------------------------------------------------------------------------------------------------
// Library identity, counts, navigation and quantity-level status
// ---------------------------------------------------------------------------------------------------------------

const countFormat = new Intl.NumberFormat("en-US");
export const formatCount = (value: number): string => countFormat.format(value);

/** "T 100 K · p 1 atm" from stored conditions; null when they are not recorded (never implied). */
export function conditionsText(conditions: ThermoConditions | null): string | null {
  if (!conditions) return null;
  const atm = Number((conditions.pressurePa / 101325).toPrecision(4));
  return `T ${Number(conditions.temperatureK.toFixed(2))} K · p ${atm} atm`;
}

/** "2026-10-05 16:26 UTC" from a stored ISO timestamp (UTC unless the stored value says otherwise); null when unparseable. */
export function storedAtText(iso: string): string | null {
  const date = new Date(/(?:Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

/**
 * The library's count line, from the server's exact counts. "Loaded" is what this page of the browser holds; "match"
 * is the server's count for the current filters; "published" is every result of the project.
 */
export function libraryTally(loaded: number, matching: number, published: number, filtered: boolean): { text: string; title: string } {
  const loadedAll = loaded >= matching;
  const text = loadedAll
    ? `${formatCount(matching)} result${matching === 1 ? "" : "s"}${filtered ? " match" : ""}${filtered ? ` · ${formatCount(published)} published` : ""}`
    : `${formatCount(loaded)} loaded of ${formatCount(matching)} ${filtered ? "matching" : "published"}`;
  const title = loadedAll
    ? `All ${formatCount(matching)} matching results are loaded in this browser.`
    : `${formatCount(loaded)} of ${formatCount(matching)} matching results are loaded; use Show more for the rest.${filtered ? ` ${formatCount(published)} results are published in this project.` : ""}`;
  return { text, title };
}

/** Letters A, B, C … for a selection (the reference is A). */
export const selectionLetters = (count: number): string[] => Array.from({ length: count }, (_, i) => positionLetter(i));

export type QuantityStatus = {
  key: "authorized" | "limited" | "incompatible" | "withheld" | "units" | "unavailable" | "reference";
  label: string;
  /** One short reason for the quantity; the long server wording stays in the Rules tab. */
  reason: string | null;
  /** The sentence behind the label, for a tooltip and assistive technology. */
  explanation: string;
  intent: "success" | "warning" | "danger" | "none";
  icon: "tick-circle" | "warning-sign" | "cross-circle" | "minus" | "disable";
};

/** Concise names of the rules that failed or limited one pairing, from the server's rule identities. */
export function ruleNames(pair: CalculationPairComparison, outcome: Outcome): string[] {
  return pair.rules.filter((rule) => rule.outcome === outcome).map((rule) => ruleLabel(rule.rule_id).toLowerCase());
}

/** Status of one quantity cell: what the server authorized, why not, in a few words. Nothing here is computed. */
export function quantityStatus(cell: DifferenceCell, pair: CalculationPairComparison | undefined): QuantityStatus {
  switch (cell.state) {
    case "reference": return { key: "reference", label: "Reference", reason: null, explanation: "This is the reference value; differences are measured against it.", intent: "none", icon: "minus" };
    case "delta": {
      if (!cell.limited) return { key: "authorized", label: "Authorized", reason: null, explanation: "The platform formed this difference; every comparability rule passed.", intent: "success", icon: "tick-circle" };
      const limits = pair ? ruleNames(pair, "LIMITATION") : [];
      return { key: "limited", label: "With limitations", reason: limits.join(", ") || null, explanation: `The platform formed this difference, qualified by: ${limits.join(", ") || "stated limitations"}. See the Rules tab.`, intent: "warning", icon: "warning-sign" };
    }
    case "blocked": {
      const failed = pair ? ruleNames(pair, "FAIL") : [];
      return { key: "incompatible", label: "Incompatible", reason: failed.join(", ") || null, explanation: `No difference exists: the pairing fails ${failed.join(", ") || "a comparability rule"}. The stored value is shown unchanged.`, intent: "danger", icon: "cross-circle" };
    }
    case "withheld": {
      const thermal = cell.reason.includes("Temperature or pressure");
      return { key: "withheld", label: "Not formed", reason: thermal ? "conditions differ" : "no platform difference", explanation: thermal ? "The pairing is comparable, but temperature or pressure differ, so the platform forms no thermal difference." : "The pairing is comparable, but the platform formed no difference for this quantity.", intent: "warning", icon: "disable" };
    }
    case "unit-mismatch":
      return { key: "units", label: "Not subtracted", reason: "different units", explanation: "The two stored values have different units, so no difference is formed.", intent: "danger", icon: "cross-circle" };
    default:
      return { key: "unavailable", label: "Unavailable", reason: "not stored", explanation: "This result does not store this quantity.", intent: "none", icon: "minus" };
  }
}
