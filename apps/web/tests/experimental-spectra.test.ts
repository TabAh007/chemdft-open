import { describe, expect, it } from "vitest";
import type { SpectrumComparisonView, SpectrumDatasetView, SpectrumPreviewBody } from "@chemdft/schemas";
import {
  CANDIDATE_ONLY_STATEMENT,
  GATED_MAE_STATEMENT,
  NO_DISPLACEMENT_STATEMENT,
  OP_LABEL,
  authorityText,
  claimsAssignment,
  comparisonHeadline,
  conventionalInversion,
  descendants,
  evidenceAccepted,
  evidenceLabel,
  extentOf,
  formatDelta,
  importButtonState,
  maxNormalized,
  metricRows,
  modeLinkStatement,
  needText,
  niceTicks,
  parseNumber,
  peakLinkStatement,
  peakSetsFor,
  scalingText,
  suggestBaseline,
  suggestSmoothing,
  suppliedText,
  Y_OPTIONS_BY_TECHNIQUE,
} from "../src/lib/experimental-spectra";

const comparison = {
  axis: "cm^-1",
  tolerance: 30,
  scaling: { mode: "UNSCALED", factor: null, source: "no scaling applied" },
  pairs: [
    { calculated_index: 0, calculated_position_source: 1600, calculated_position: 1600, calculated_oscillator_strength: null, experimental_peak_index: 2, experimental_position: 1596.2, delta: -3.8, tolerance: 30, candidates_for_calculated: 1, candidates_for_experimental: 1, margin_to_next_experimental_peak: 3, status: "CANDIDATE_MATCH", relative_intensity_calculated: 1, relative_intensity_experimental: 0.8 },
    { calculated_index: 1, calculated_position_source: 3700, calculated_position: 3700, calculated_oscillator_strength: null, experimental_peak_index: 3, experimental_position: 3712, delta: 12, tolerance: 30, candidates_for_calculated: 2, candidates_for_experimental: 1, margin_to_next_experimental_peak: 0.2, status: "AMBIGUOUS_CANDIDATE", relative_intensity_calculated: 0.4, relative_intensity_experimental: 0.5 },
  ],
  unmatched_calculated: [{ calculated_index: 2, calculated_position_source: 3800, calculated_position: 3800, calculated_oscillator_strength: null, relative_intensity_calculated: 0.2, status: "UNMATCHED_CALCULATED" }],
  unmatched_experimental: [{ experimental_peak_index: 5, experimental_position: 2960, prominence: 0.2, relative_intensity_experimental: 0.3, status: "UNMATCHED_EXPERIMENTAL" }],
  metrics: {
    calculated_considered: 3, calculated_total: 4, calculated_excluded: [{ reason: "outside_experimental_window", count: 1 }, { reason: "imaginary_or_nonpositive", count: 0 }],
    experimental_peaks: 4, matched: 2, ambiguous_pairs: 1, matched_fraction_of_experimental_peaks: 0.5, matched_fraction_of_calculated_considered: 2 / 3,
    unmatched_calculated: 1, unmatched_experimental: 2, signed_bias: 4.1, mae: 7.9, rmse: 8.6, max_abs_delta: 12, median_delta: 4.1, delta_unit: "cm^-1",
    delta_definition: "experimental position minus calculated (scaled) position", mae_upper_bound_by_construction: 30, mae_note: GATED_MAE_STATEMENT, tolerance_sensitivity: [],
  },
} as unknown as SpectrumComparisonView;

describe("unit evidence is never inferred", () => {
  it("accepts only a unit written in the file or confirmed by the user", () => {
    expect(evidenceAccepted("EXPLICIT_UNIT")).toBe(true);
    expect(evidenceAccepted("USER_CONFIRMED")).toBe(true);
    expect(evidenceAccepted("HINT_ONLY")).toBe(false);
    expect(evidenceAccepted("QUANTITY_NAME")).toBe(false);
    expect(evidenceAccepted("NONE")).toBe(false);
    expect(evidenceLabel("HINT_ONLY")).toMatch(/suggested/i);
  });

  it("blocks the import button until every unit is confirmed and the file is valid", () => {
    const ready = { status: "READY", needs: [] } as unknown as SpectrumPreviewBody;
    const needs = { status: "NEEDS_CONFIRMATION", needs: ["x_unit", "y_quantity_and_unit"] } as unknown as SpectrumPreviewBody;
    const rejected = { status: "REJECTED", needs: [] } as unknown as SpectrumPreviewBody;
    expect(importButtonState(null).enabled).toBe(false);
    expect(importButtonState(ready).enabled).toBe(true);
    expect(importButtonState(needs)).toMatchObject({ enabled: false });
    expect(importButtonState(needs).reason).toContain("x-axis unit");
    expect(importButtonState(rejected).enabled).toBe(false);
    expect(needText("y_transmittance_scale")).toMatch(/percentage or a fraction/);
  });

  it("offers only the units a technique supports", () => {
    expect(Y_OPTIONS_BY_TECHNIQUE.RAMAN.map((o) => o.quantity)).toEqual(["INTENSITY", "INTENSITY"]);
    expect(Y_OPTIONS_BY_TECHNIQUE.IR.some((o) => o.quantity === "CROSS_SECTION")).toBe(false);
    expect(Y_OPTIONS_BY_TECHNIQUE.UVVIS.some((o) => o.quantity === "MOLAR_ABSORPTIVITY")).toBe(true);
  });

  it("states a missing laser wavelength as not supplied rather than inventing one", () => {
    expect(suppliedText({ status: "NOT_SUPPLIED", value: null, as_written: null, line: null, file_reported: null })).toEqual({ text: "Not supplied", tone: "none" });
    expect(suppliedText(undefined).text).toBe("Not supplied");
    expect(suppliedText({ status: "AS_REPORTED_IN_FILE", value: 785, as_written: "Laser: 785 nm", line: 3, file_reported: null }).text).toBe("785 (as reported, line 3)");
    expect(suppliedText({ status: "USER_ENTERED", value: "GAS", as_written: "GAS", line: null, file_reported: null }).text).toContain("entered by you");
  });
});

describe("authority wording", () => {
  it("labels raw, derived and peak sets differently", () => {
    expect(authorityText({ authority: "RAW_MEASUREMENT" }).label).toBe("RAW · EXPERIMENTAL");
    expect(authorityText({ authority: "DETERMINISTIC_TRANSFORM" }).label).toBe("DERIVED · TRANSFORM");
    expect(authorityText({ authority: "DERIVED_NOT_RAW" }).label).toBe("DERIVED · NOT RAW");
    expect(authorityText({ authority: "DERIVED_NOT_RAW" }).detail).toMatch(/not a measurement/i);
  });

  it("names every operation the API can create", () => {
    for (const op of ["baseline.arpls", "baseline.snip", "baseline.imodpoly", "baseline.offset", "smooth.savgol", "normalize.max", "normalize.area", "resample.linear", "crop", "convert.absorbance_from_transmittance", "peaks"]) {
      expect(OP_LABEL[op]).toBeTruthy();
    }
  });

  it("walks a lineage without mixing branches", () => {
    const make = (id: string, parent: string | null, kind: string) => ({ id, parent_dataset_id: parent, kind }) as unknown as SpectrumDatasetView;
    const all = [make("raw", null, "RAW"), make("base", "raw", "TRANSFORM"), make("smooth", "base", "TRANSFORM"), make("peaks", "smooth", "PEAKS"), make("other", "raw", "TRANSFORM")];
    expect(descendants(all, "base").map((d) => d.id)).toEqual(["smooth", "peaks"]);
    expect(peakSetsFor(all, "smooth").map((d) => d.id)).toEqual(["peaks"]);
    expect(peakSetsFor(all, "raw")).toEqual([]);
  });

  it("draws IR high to low and everything else low to high", () => {
    expect(conventionalInversion("IR", "cm^-1")).toBe(true);
    expect(conventionalInversion("RAMAN", "cm^-1")).toBe(false);
    expect(conventionalInversion("UVVIS", "nm")).toBe(false);
  });
});

describe("starting parameters are suggestions derived from the data", () => {
  const dataset = { x_min: 400, x_max: 4000, point_count: 901 };
  it("uses 2x / 5x the widest band when peaks are known", () => {
    const peaks = [{ fwhm_x: 18 }, { fwhm_x: 40 }, { fwhm_x: 24 }] as never;
    const s = suggestBaseline(dataset, peaks);
    expect(s.snip.value).toBe(80);
    expect(s.arpls.value).toBe(200);
    expect(s.snip.basis).toContain("widest");
  });
  it("falls back to fractions of the range and says so", () => {
    const s = suggestBaseline(dataset, null);
    expect(s.snip.value).toBe(180);
    expect(s.snip.basis).toContain("no peaks");
  });
  it("keeps the smoothing window below half of the narrowest band", () => {
    const s = suggestSmoothing(dataset, [{ fwhm_x: 18 }, { fwhm_x: 40 }] as never);
    expect(s.value).toBeLessThanOrEqual(9);
    expect(s.basis).toContain("narrowest");
    expect(suggestSmoothing(dataset, null).value).toBeCloseTo(28, 0);
  });
  it("parses numbers strictly", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber(" 2e3 ")).toBe(2000);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("1 2")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("comparison wording never claims an assignment", () => {
  it("detects an assignment claim and allows negations", () => {
    expect(claimsAssignment("C=O stretch assigned to the 1715 band")).toBe(true);
    expect(claimsAssignment("This is the assignment of the peak")).toBe(true);
    expect(claimsAssignment(CANDIDATE_ONLY_STATEMENT)).toBe(false);
    expect(claimsAssignment("These are not assignments.")).toBe(false);
    expect(claimsAssignment("no assignment is made")).toBe(false);
  });

  it("produces only candidate language for every pair state", () => {
    const strings = [
      NO_DISPLACEMENT_STATEMENT,
      CANDIDATE_ONLY_STATEMENT,
      GATED_MAE_STATEMENT,
      comparisonHeadline(comparison),
      scalingText(comparison),
      modeLinkStatement(comparison, 0),
      modeLinkStatement(comparison, 1),
      modeLinkStatement(comparison, 2),
      modeLinkStatement(comparison, 9),
      peakLinkStatement(comparison, 2),
      peakLinkStatement(comparison, 5),
      peakLinkStatement(comparison, 8),
      ...metricRows(comparison).flatMap((row) => [row.label, row.value, row.hint ?? ""]),
    ];
    for (const text of strings) expect(claimsAssignment(text), text).toBe(false);
  });

  it("links a mode to its candidate peak and flags ambiguity and gaps", () => {
    expect(modeLinkStatement(comparison, 0)).toContain("Candidate match: calculated mode 1");
    expect(modeLinkStatement(comparison, 0)).toContain("1596.2 cm⁻¹");
    expect(modeLinkStatement(comparison, 1)).toContain("not unique");
    expect(modeLinkStatement(comparison, 2)).toContain("UNMATCHED_CALCULATED");
    expect(modeLinkStatement(comparison, 9)).toContain("not part of this comparison");
    expect(peakLinkStatement(comparison, 5)).toContain("UNMATCHED_EXPERIMENTAL");
  });

  it("reports coverage next to the gated errors and warns that they alone mislead", () => {
    const rows = Object.fromEntries(metricRows(comparison).map((row) => [row.id, row]));
    expect(rows["coverage-exp"]!.value).toBe("2 of 4 (50 %)");
    expect(rows["coverage-calc"]!.hint).toContain("1 outside experimental window");
    expect(rows["mae"]!.hint).toContain("bounded by the tolerance");
    expect(rows["bias"]!.value).toBe("+4.10 cm⁻¹");
    expect(GATED_MAE_STATEMENT).toMatch(/matched pairs only/);
    expect(comparisonHeadline(comparison)).toContain("2 of 4 experimental peaks");
  });

  it("shows a user scale factor as entered by the user", () => {
    const scaled = { ...comparison, scaling: { mode: "USER_FACTOR", factor: 0.96, source: "x" } } as unknown as SpectrumComparisonView;
    expect(scalingText(scaled)).toBe("Scale factor 0.96 (entered by you)");
    expect(modeLinkStatement(scaled, 0)).toContain("× 0.96");
    expect(formatDelta(-3.84, "cm^-1")).toBe("−3.8 cm⁻¹");
    expect(formatDelta(0.0123, "eV")).toBe("+0.012 eV");
  });

  it("states that experimental peaks carry no displacement vectors", () => {
    expect(NO_DISPLACEMENT_STATEMENT.startsWith("Experimental peaks do not contain displacement vectors")).toBe(true);
  });
});

describe("chart math", () => {
  it("builds nice ticks inside the range", () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(400, 4000, 6).every((t) => t >= 400 && t <= 4000)).toBe(true);
  });
  it("pads the y extent and survives a flat trace", () => {
    const e = extentOf([{ id: "a", label: "a", x: [0, 1, 2], y: [1, 3, 2], style: "raw" }]);
    expect(e.xMin).toBe(0);
    expect(e.yMin).toBeLessThan(1);
    expect(e.yMax).toBeGreaterThan(3);
    const flat = extentOf([{ id: "a", label: "a", x: [0, 1], y: [2, 2], style: "raw" }]);
    expect(flat.yMax).toBeGreaterThan(flat.yMin);
  });
  it("normalizes each overlay curve by its own maximum", () => {
    expect(maxNormalized([0, 5, 10])).toEqual([0, 0.5, 1]);
    expect(maxNormalized([0, 0])).toEqual([0, 0]);
  });
});
