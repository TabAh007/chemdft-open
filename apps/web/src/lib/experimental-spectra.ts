import type {
  CalculatedSourceView,
  ComparisonPair,
  ComparisonMetrics,
  PreviewDiagnostic,
  SpectrumComparisonView,
  SpectrumDatasetView,
  SpectrumPeak,
  SpectrumPreviewBody,
  SpectrumTechnique,
  Supplied,
  UnmatchedCalculated2,
  UnmatchedExperimental2,
} from "@chemdft/schemas";

/** Everything the experimental-spectra UI says about authority, units and matching lives here so it can be tested as text. */
export const TECHNIQUES: SpectrumTechnique[] = ["IR", "RAMAN", "UVVIS"];
export const TECHNIQUE_LABEL: Record<SpectrumTechnique, string> = { IR: "IR / FTIR", RAMAN: "Raman", UVVIS: "UV/Vis" };

export const X_UNIT_LABEL: Record<string, string> = { "cm^-1": "cm⁻¹", um: "µm", nm: "nm", eV: "eV" };
export const Y_UNIT_LABEL: Record<string, string> = {
  absorbance: "absorbance",
  percent: "percent (%)",
  fraction: "fraction (0–1)",
  counts: "counts",
  arbitrary: "arbitrary units",
  "cm^2/molecule": "cm²/molecule",
  "L/(mol*cm)": "L mol⁻¹ cm⁻¹",
  relative: "relative (normalized)",
};

export const X_UNITS_BY_TECHNIQUE: Record<SpectrumTechnique, string[]> = { IR: ["cm^-1", "um"], RAMAN: ["cm^-1"], UVVIS: ["nm", "eV", "cm^-1"] };
export const Y_OPTIONS_BY_TECHNIQUE: Record<SpectrumTechnique, Array<{ quantity: string; unit: string; label: string }>> = {
  IR: [
    { quantity: "ABSORBANCE", unit: "absorbance", label: "Absorbance" },
    { quantity: "TRANSMITTANCE", unit: "percent", label: "Transmittance, percent (%T)" },
    { quantity: "TRANSMITTANCE", unit: "fraction", label: "Transmittance, fraction (0–1)" },
  ],
  RAMAN: [
    { quantity: "INTENSITY", unit: "counts", label: "Intensity, counts" },
    { quantity: "INTENSITY", unit: "arbitrary", label: "Intensity, arbitrary units" },
  ],
  UVVIS: [
    { quantity: "ABSORBANCE", unit: "absorbance", label: "Absorbance" },
    { quantity: "TRANSMITTANCE", unit: "percent", label: "Transmittance, percent (%T)" },
    { quantity: "TRANSMITTANCE", unit: "fraction", label: "Transmittance, fraction (0–1)" },
    { quantity: "CROSS_SECTION", unit: "cm^2/molecule", label: "Absorption cross section, cm²/molecule" },
    { quantity: "MOLAR_ABSORPTIVITY", unit: "L/(mol*cm)", label: "Molar absorptivity ε, L mol⁻¹ cm⁻¹" },
  ],
};

export function xUnitText(unit: string | null | undefined): string {
  return unit ? (X_UNIT_LABEL[unit] ?? unit) : "unit not identified";
}
export function yUnitText(unit: string | null | undefined): string {
  return unit ? (Y_UNIT_LABEL[unit] ?? unit) : "unit not identified";
}

// ------------------------------------------------------------------------------------------------ unit evidence
export type EvidenceKind = "EXPLICIT_UNIT" | "USER_CONFIRMED" | "QUANTITY_NAME" | "HINT_ONLY" | "NONE";
export function evidenceLabel(evidence: EvidenceKind): string {
  switch (evidence) {
    case "EXPLICIT_UNIT": return "Unit written in the file";
    case "USER_CONFIRMED": return "Unit confirmed by you";
    case "QUANTITY_NAME": return "Quantity named; unit not written";
    case "HINT_ONLY": return "Suggested from the value range only";
    default: return "Not identified";
  }
}
/** Only these two can authorise an import. A suggestion never does. */
export function evidenceAccepted(evidence: EvidenceKind): boolean {
  return evidence === "EXPLICIT_UNIT" || evidence === "USER_CONFIRMED";
}
export function evidenceTone(evidence: EvidenceKind): "ok" | "warn" | "none" {
  return evidenceAccepted(evidence) ? "ok" : evidence === "NONE" ? "none" : "warn";
}

export const NEED_TEXT: Record<string, string> = {
  column_roles: "Choose which column is the x axis and which is the signal.",
  x_unit: "Confirm the x-axis unit. The file does not state it.",
  y_quantity_and_unit: "Confirm what the signal measures and its unit.",
  y_transmittance_scale: "Confirm whether transmittance is a percentage or a fraction.",
};
export function needText(need: string): string {
  return NEED_TEXT[need] ?? need;
}

export function diagnosticTone(d: PreviewDiagnostic): "error" | "warning" | "info" {
  return d.severity;
}

export function suppliedText(value: Supplied | null | undefined): { text: string; tone: "ok" | "none" | "user" } {
  if (!value || value.status === "NOT_SUPPLIED") return { text: "Not supplied", tone: "none" };
  const shown = value.value === null || value.value === undefined ? (value.as_written ?? "") : String(value.value);
  if (value.status === "USER_ENTERED") return { text: `${shown} (entered by you)`, tone: "user" };
  return { text: `${shown}${value.line ? ` (as reported, line ${value.line})` : " (as reported)"}`, tone: "ok" };
}

export const ACQUISITION_FIELDS: Array<{ key: string; label: string; techniques: SpectrumTechnique[] }> = [
  { key: "excitation_wavelength_nm", label: "Laser wavelength (nm)", techniques: ["RAMAN"] },
  { key: "integration_time_s", label: "Integration time (s)", techniques: ["RAMAN"] },
  { key: "accumulations", label: "Accumulations", techniques: ["RAMAN"] },
  { key: "polarization", label: "Polarization", techniques: ["RAMAN"] },
  { key: "sampling_mode", label: "Sampling mode", techniques: ["IR"] },
  { key: "resolution_cm1", label: "Resolution (cm⁻¹)", techniques: ["IR"] },
  { key: "path_length_cm", label: "Path length (cm)", techniques: ["IR", "UVVIS"] },
  { key: "concentration", label: "Concentration", techniques: ["UVVIS"] },
  { key: "solvent", label: "Solvent", techniques: ["UVVIS"] },
  { key: "bandwidth_nm", label: "Bandwidth (nm)", techniques: ["UVVIS"] },
  { key: "phase", label: "Sample phase", techniques: ["IR", "RAMAN", "UVVIS"] },
];

// ------------------------------------------------------------------------------------------------ datasets
export const OP_LABEL: Record<string, string> = {
  "baseline.arpls": "Baseline · arPLS",
  "baseline.snip": "Baseline · SNIP",
  "baseline.imodpoly": "Baseline · modified polynomial",
  "baseline.offset": "Baseline · constant offset",
  "smooth.savgol": "Smoothing · Savitzky–Golay",
  "normalize.max": "Normalization · maximum",
  "normalize.area": "Normalization · area",
  "resample.linear": "Resampling · linear",
  crop: "Crop",
  "convert.absorbance_from_transmittance": "Transmittance → absorbance",
  peaks: "Peak detection",
};
export function opLabel(op: string): string {
  return OP_LABEL[op] ?? op;
}

export function authorityText(dataset: Pick<SpectrumDatasetView, "authority">): { label: string; detail: string; tone: "raw" | "derived" | "peaks" } {
  if (dataset.authority === "RAW_MEASUREMENT") return { label: "RAW · EXPERIMENTAL", detail: "Measured data exactly as supplied. Never edited.", tone: "raw" };
  if (dataset.authority === "DERIVED_NOT_RAW") return { label: "DERIVED · NOT RAW", detail: "Output of a peak-detection algorithm with the parameters shown. Not a measurement.", tone: "peaks" };
  return { label: "DERIVED · TRANSFORM", detail: "A new version made from its parent by a recorded, deterministic transform. The parent is unchanged.", tone: "derived" };
}

export function datasetTitle(dataset: SpectrumDatasetView): string {
  return dataset.name;
}

export function isPeakSet(dataset: SpectrumDatasetView): boolean {
  return dataset.kind === "PEAKS";
}

export function descendants(datasets: SpectrumDatasetView[], rootId: string): SpectrumDatasetView[] {
  const byParent = new Map<string, SpectrumDatasetView[]>();
  for (const item of datasets) {
    if (!item.parent_dataset_id) continue;
    byParent.set(item.parent_dataset_id, [...(byParent.get(item.parent_dataset_id) ?? []), item]);
  }
  const out: SpectrumDatasetView[] = [];
  const walk = (id: string) => { for (const child of byParent.get(id) ?? []) { out.push(child); walk(child.id); } };
  walk(rootId);
  return out;
}

export function rootDatasets(datasets: SpectrumDatasetView[]): SpectrumDatasetView[] {
  return datasets.filter((item) => item.kind === "RAW");
}

export function peakSetsFor(datasets: SpectrumDatasetView[], datasetId: string): SpectrumDatasetView[] {
  return datasets.filter((item) => item.kind === "PEAKS" && item.parent_dataset_id === datasetId);
}

/** x range (low, high) regardless of storage order. */
export function xExtent(dataset: Pick<SpectrumDatasetView, "x_min" | "x_max">): [number, number] {
  return [dataset.x_min ?? 0, dataset.x_max ?? 1];
}

/** IR is conventionally drawn high → low wavenumber; Raman and UV/Vis are drawn low → high. */
export function conventionalInversion(technique: SpectrumTechnique, xUnit: string): boolean {
  return technique === "IR" && xUnit === "cm^-1";
}

// ------------------------------------------------------------------------------------------------ starting parameters (suggestions only)
export interface Suggestion { value: number; basis: string }

/** Pre-filled starting points from the spike (SNIP ≈ 2 × widest band, arPLS L ≈ 5 × widest band). They are never applied silently. */
export function suggestBaseline(dataset: Pick<SpectrumDatasetView, "x_min" | "x_max" | "point_count">, peaks: SpectrumPeak[] | null): { snip: Suggestion; arpls: Suggestion } {
  const [lo, hi] = [dataset.x_min ?? 0, dataset.x_max ?? 1];
  const span = Math.max(hi - lo, 1e-9);
  const widths = (peaks ?? []).map((p) => p.fwhm_x).filter((w) => w > 0);
  if (widths.length > 0) {
    const widest = Math.max(...widths);
    return {
      snip: { value: round3(2 * widest), basis: `2 × the widest detected band (${round3(widest)})` },
      arpls: { value: round3(5 * widest), basis: `5 × the widest detected band (${round3(widest)})` },
    };
  }
  return {
    snip: { value: round3(span / 20), basis: "5 % of the measured range (no peaks detected yet)" },
    arpls: { value: round3(span / 8), basis: "12.5 % of the measured range (no peaks detected yet)" },
  };
}

export function suggestSmoothing(dataset: Pick<SpectrumDatasetView, "x_min" | "x_max" | "point_count">, peaks: SpectrumPeak[] | null): Suggestion {
  const step = ((dataset.x_max ?? 1) - (dataset.x_min ?? 0)) / Math.max(dataset.point_count - 1, 1);
  const widths = (peaks ?? []).map((p) => p.fwhm_x).filter((w) => w > 0);
  if (widths.length > 0) {
    const narrowest = Math.min(...widths);
    const target = Math.max(5 * step, 0.4 * narrowest);
    return { value: round3(Math.min(target, 0.5 * narrowest) || 5 * step), basis: `at most half of the narrowest detected band (${round3(narrowest)})` };
  }
  return { value: round3(7 * step), basis: "7 points; peak widths are not known yet" };
}

function round3(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 2 : 3;
  return Number(value.toFixed(digits));
}

export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// ------------------------------------------------------------------------------------------------ comparison wording and linkage
export const NO_DISPLACEMENT_STATEMENT = "Experimental peaks do not contain displacement vectors. The animation shows the calculated normal mode only; the experimental peak is shown as a candidate match by position.";
export const CANDIDATE_ONLY_STATEMENT = "Pairs are candidate matches by position within the stated tolerance. They are not assignments.";
export const GATED_MAE_STATEMENT = "MAE, RMSE and bias are computed over matched pairs only and cannot exceed the tolerance. Read them together with coverage and the unmatched lists; a small number here does not mean the spectra agree.";

export type PairLike = ComparisonPair;

export function pairForCalculated(comparison: SpectrumComparisonView, calculatedIndex: number): ComparisonPair | null {
  return comparison.pairs.find((pair) => pair.calculated_index === calculatedIndex) ?? null;
}
export function pairForPeak(comparison: SpectrumComparisonView, peakIndex: number): ComparisonPair | null {
  return comparison.pairs.find((pair) => pair.experimental_peak_index === peakIndex) ?? null;
}
export function unmatchedCalculated(comparison: SpectrumComparisonView, calculatedIndex: number): UnmatchedCalculated2 | null {
  return comparison.unmatched_calculated.find((item) => item.calculated_index === calculatedIndex) ?? null;
}
export function unmatchedExperimental(comparison: SpectrumComparisonView, peakIndex: number): UnmatchedExperimental2 | null {
  return comparison.unmatched_experimental.find((item) => item.experimental_peak_index === peakIndex) ?? null;
}

const AXIS_UNIT: Record<string, string> = { "cm^-1": "cm⁻¹", eV: "eV", nm: "nm" };
export function axisUnitText(axis: string): string {
  return AXIS_UNIT[axis] ?? axis;
}
export function formatPosition(value: number, axis: string): string {
  const digits = axis === "eV" ? 3 : axis === "nm" ? 1 : 1;
  return `${value.toFixed(digits)} ${axisUnitText(axis)}`;
}
export function formatDelta(delta: number, axis: string): string {
  const digits = axis === "eV" ? 3 : 1;
  return `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(digits)} ${axisUnitText(axis)}`;
}

/** The sentence shown when a calculated mode is selected. It never says the experimental peak "is" that mode. */
export function modeLinkStatement(comparison: SpectrumComparisonView, calculatedIndex: number, modeLabel = "mode"): string {
  const pair = pairForCalculated(comparison, calculatedIndex);
  if (pair) {
    const scaled = comparison.scaling.mode === "USER_FACTOR" ? ` (${formatPosition(pair.calculated_position_source, comparison.axis)} × ${comparison.scaling.factor})` : "";
    const ambiguity = pair.status === "AMBIGUOUS_CANDIDATE" ? " Another candidate lies inside the tolerance, so this pairing is not unique." : "";
    return `Candidate match: calculated ${modeLabel} ${calculatedIndex + 1} at ${formatPosition(pair.calculated_position, comparison.axis)}${scaled} ↔ experimental peak at ${formatPosition(pair.experimental_position, comparison.axis)} (Δ ${formatDelta(pair.delta, comparison.axis)}, tolerance ±${pair.tolerance} ${axisUnitText(comparison.axis)}).${ambiguity}`;
  }
  const free = unmatchedCalculated(comparison, calculatedIndex);
  if (free) return `Calculated ${modeLabel} ${calculatedIndex + 1} at ${formatPosition(free.calculated_position, comparison.axis)} has no experimental peak within ±${comparison.tolerance} ${axisUnitText(comparison.axis)} (UNMATCHED_CALCULATED).`;
  return `Calculated ${modeLabel} ${calculatedIndex + 1} was not part of this comparison (outside the measured range, imaginary, or below the intensity threshold).`;
}

export function peakLinkStatement(comparison: SpectrumComparisonView, peakIndex: number): string {
  const pair = pairForPeak(comparison, peakIndex);
  if (pair) return `Candidate match: experimental peak at ${formatPosition(pair.experimental_position, comparison.axis)} ↔ calculated mode ${pair.calculated_index + 1} at ${formatPosition(pair.calculated_position, comparison.axis)} (Δ ${formatDelta(pair.delta, comparison.axis)}).`;
  const free = unmatchedExperimental(comparison, peakIndex);
  if (free) return `Experimental peak at ${formatPosition(free.experimental_position, comparison.axis)} has no calculated candidate within ±${comparison.tolerance} ${axisUnitText(comparison.axis)} (UNMATCHED_EXPERIMENTAL).`;
  return "This peak was not part of the comparison.";
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(0)} %`;
}

export function metricRows(comparison: SpectrumComparisonView): Array<{ id: string; label: string; value: string; hint?: string }> {
  const m: ComparisonMetrics = comparison.metrics;
  const unit = axisUnitText(m.delta_unit);
  const digits = m.delta_unit === "eV" ? 3 : 2;
  const num = (value: number | null) => (value === null ? "—" : `${value.toFixed(digits)} ${unit}`);
  const signed = (value: number | null) => (value === null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)} ${unit}`);
  return [
    { id: "coverage-exp", label: "Experimental peaks with a candidate", value: `${m.matched} of ${m.experimental_peaks} (${percent(m.matched_fraction_of_experimental_peaks)})` },
    { id: "coverage-calc", label: "Calculated items with a candidate", value: `${m.matched} of ${m.calculated_considered} considered (${percent(m.matched_fraction_of_calculated_considered)})`, hint: `${m.calculated_total} in the source; ${m.calculated_excluded.filter((e) => e.count > 0).map((e) => `${e.count} ${e.reason.replaceAll("_", " ")}`).join(", ") || "none excluded"}` },
    { id: "unmatched-calc", label: "Unmatched calculated", value: String(m.unmatched_calculated) },
    { id: "unmatched-exp", label: "Unmatched experimental", value: String(m.unmatched_experimental) },
    { id: "ambiguous", label: "Ambiguous candidates", value: String(m.ambiguous_pairs) },
    { id: "bias", label: "Signed bias (exp − calc)", value: signed(m.signed_bias), hint: "positive = experiment above calculation" },
    { id: "mae", label: "MAE (matched only)", value: num(m.mae), hint: `bounded by the tolerance (${m.mae_upper_bound_by_construction} ${unit})` },
    { id: "rmse", label: "RMSE (matched only)", value: num(m.rmse) },
    { id: "max", label: "Largest |Δ|", value: num(m.max_abs_delta) },
  ];
}

export function comparisonHeadline(comparison: SpectrumComparisonView): string {
  const m = comparison.metrics;
  const unit = axisUnitText(comparison.axis);
  return `${m.matched} of ${m.experimental_peaks} experimental peaks have a candidate within ±${comparison.tolerance} ${unit}; ${m.unmatched_experimental} experimental peaks and ${m.unmatched_calculated} calculated items have none.`;
}

export function scalingText(comparison: SpectrumComparisonView): string {
  return comparison.scaling.mode === "UNSCALED" ? "Unscaled" : `Scale factor ${comparison.scaling.factor} (entered by you)`;
}

/** Any UI string that claims an assignment would fail this check; negations ("not assignments") are allowed. */
export function claimsAssignment(text: string): boolean {
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/\bassign(?:ed|s|ment|ments|ing)?\b/g)) {
    const before = lower.slice(Math.max(0, match.index - 12), match.index);
    if (!/\b(not|no|never|nor|without)\s+(?:an?\s+)?$/.test(before) && !/\bnot\s+$/.test(before)) return true;
  }
  return false;
}

export function sourceTitle(source: CalculatedSourceView): string {
  return `${source.label}${source.kind === "IMPORTED_RESULT" ? " · IMPORTED" : " · CHEMDFT"}`;
}

export function phaseText(source: CalculatedSourceView): string {
  return source.phase === "GAS" ? "gas-phase calculation" : "phase of the external calculation not known";
}

export function previewNeeds(body: SpectrumPreviewBody): string[] {
  return body.needs.map(needText);
}

export function importButtonState(body: SpectrumPreviewBody | null): { enabled: boolean; reason: string } {
  if (!body) return { enabled: false, reason: "Choose a file first." };
  if (body.status === "REJECTED") return { enabled: false, reason: "This file cannot be imported; see the diagnostics." };
  if (body.status === "NEEDS_CONFIRMATION") return { enabled: false, reason: body.needs.map(needText).join(" ") };
  return { enabled: true, reason: "" };
}

// ------------------------------------------------------------------------------------------------ chart math
export function niceTicks(lo: number, hi: number, target = 6): number[] {
  if (!(hi > lo)) return [lo];
  const rough = (hi - lo) / Math.max(target, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual >= 5 ? 5 : residual >= 2 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) ticks.push(Number(t.toPrecision(12)));
  return ticks;
}

export interface Trace { id: string; label: string; x: number[]; y: number[]; style: "raw" | "baseline" | "corrected" | "processed" | "reference" }

export function extentOf(traces: Trace[]): { xMin: number; xMax: number; yMin: number; yMax: number } {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const trace of traces) {
    for (let i = 0; i < trace.x.length; i += 1) {
      const xv = trace.x[i]!, yv = trace.y[i]!;
      if (xv < xMin) xMin = xv;
      if (xv > xMax) xMax = xv;
      if (yv < yMin) yMin = yv;
      if (yv > yMax) yMax = yv;
    }
  }
  if (!Number.isFinite(xMin)) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  if (yMax === yMin) { yMax += 1; yMin -= 1; }
  const pad = (yMax - yMin) * 0.06;
  return { xMin, xMax, yMin: yMin - pad, yMax: yMax + pad };
}

/** Overlays compare shape only: each curve is divided by its own maximum. The chart states this whenever it is used. */
export function maxNormalized(values: number[]): number[] {
  const top = Math.max(...values.map((v) => Math.abs(v)), 0);
  return top > 0 ? values.map((v) => v / top) : values.slice();
}
