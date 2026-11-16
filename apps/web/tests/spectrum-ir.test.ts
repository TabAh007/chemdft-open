import { describe, expect, it } from "vitest";
import {
  deriveBroadenedIrSpectrum,
  deriveIrDisplayRange,
  evaluateLorentzianBroadening,
  DEFAULT_IR_FWHM_CM1,
  type SpectrumStickIR,
} from "../src/lib/spectrum";

describe("IR Lorentzian Spectrum Broadening", () => {
  const waterSticks: SpectrumStickIR[] = [
    {
      modeIndex: 0,
      frequencyCm1: 1638.68,
      irIntensityKmPerMol: 55.49,
      reducedMassAmu: 1.0819,
      imaginary: false,
    },
    {
      modeIndex: 1,
      frequencyCm1: 3791.34,
      irIntensityKmPerMol: 4.944,
      reducedMassAmu: 1.0462,
      imaginary: false,
    },
    {
      modeIndex: 2,
      frequencyCm1: 3886.57,
      irIntensityKmPerMol: 26.912,
      reducedMassAmu: 1.0806,
      imaginary: false,
    },
  ];

  it("evaluates maximum intensity at Lorentzian center for an isolated band", () => {
    const singleStick: SpectrumStickIR[] = [
      {
        modeIndex: 0,
        frequencyCm1: 2000.0,
        irIntensityKmPerMol: 100.0,
        imaginary: false,
      },
    ];
    const centerIntensity = evaluateLorentzianBroadening(2000.0, singleStick, 15.0);
    const offsetLeft = evaluateLorentzianBroadening(1990.0, singleStick, 15.0);
    const offsetRight = evaluateLorentzianBroadening(2010.0, singleStick, 15.0);

    expect(centerIntensity).toBeGreaterThan(offsetLeft);
    expect(centerIntensity).toBeGreaterThan(offsetRight);
    // Symmetry around center
    expect(Math.abs(offsetLeft - offsetRight)).toBeLessThan(1e-10);
  });

  it("verifies FWHM interpretation: half-maximum occurs at nu_0 +/- FWHM/2", () => {
    const gamma = 20.0;
    const singleStick: SpectrumStickIR[] = [
      {
        modeIndex: 0,
        frequencyCm1: 2000.0,
        irIntensityKmPerMol: 100.0,
        imaginary: false,
      },
    ];
    const peak = evaluateLorentzianBroadening(2000.0, singleStick, gamma);
    const halfLeft = evaluateLorentzianBroadening(2000.0 - gamma / 2, singleStick, gamma);
    const halfRight = evaluateLorentzianBroadening(2000.0 + gamma / 2, singleStick, gamma);

    expect(halfLeft).toBeCloseTo(peak / 2.0, 4);
    expect(halfRight).toBeCloseTo(peak / 2.0, 4);
  });

  it("ignores imaginary / negative frequency modes in physical absorption", () => {
    const sticksWithImaginary: SpectrumStickIR[] = [
      {
        modeIndex: 0,
        frequencyCm1: -250.0,
        irIntensityKmPerMol: 40.0,
        imaginary: true,
      },
      {
        modeIndex: 1,
        frequencyCm1: 1600.0,
        irIntensityKmPerMol: 50.0,
        imaginary: false,
      },
    ];
    const spectrum = deriveBroadenedIrSpectrum(sticksWithImaginary);
    // Imaginary mode must not contribute intensity to the 400-4000 cm^-1 window
    const firstStick = sticksWithImaginary[0]!;
    const intensityAt400 = evaluateLorentzianBroadening(400.0, [firstStick], 15.0);
    expect(intensityAt400).toBe(0);
    expect(spectrum.sticks.length).toBe(2);
  });

  it("handles zero-intensity modes without division by zero or errors", () => {
    const sticksWithZero: SpectrumStickIR[] = [
      {
        modeIndex: 0,
        frequencyCm1: 1000.0,
        irIntensityKmPerMol: 0.0,
        imaginary: false,
      },
      {
        modeIndex: 1,
        frequencyCm1: 2000.0,
        irIntensityKmPerMol: 0.0,
        imaginary: false,
      },
    ];
    const spectrum = deriveBroadenedIrSpectrum(sticksWithZero);
    expect(spectrum.maxIntensity).toBe(0);
    for (const pt of spectrum.curve) {
      expect(pt.intensity).toBe(0);
      expect(pt.relativeIntensity).toBe(0);
    }
  });

  it("preserves underlying physical data under inverted axis orientation", () => {
    const spectrumInverted = deriveBroadenedIrSpectrum(waterSticks, { inverted: true });
    const spectrumNonInverted = deriveBroadenedIrSpectrum(waterSticks, { inverted: false });

    // Inverted curve starts at 4000 cm^-1 and ends at 400 cm^-1
    expect(spectrumInverted.curve[0]!.wavenumberCm1).toBe(4000.0);
    expect(spectrumInverted.curve[spectrumInverted.curve.length - 1]!.wavenumberCm1).toBe(400.0);

    // Non-inverted starts at 400 cm^-1 and ends at 4000 cm^-1
    expect(spectrumNonInverted.curve[0]!.wavenumberCm1).toBe(400.0);
    expect(spectrumNonInverted.curve[spectrumNonInverted.curve.length - 1]!.wavenumberCm1).toBe(4000.0);

    // Peak maximum intensity is identical regardless of display orientation
    expect(spectrumInverted.maxIntensity).toBeCloseTo(spectrumNonInverted.maxIntensity, 8);
    expect(spectrumInverted.sticks).toEqual(spectrumNonInverted.sticks);
  });

  it("is deterministically repeatable across multiple invocations", () => {
    const run1 = deriveBroadenedIrSpectrum(waterSticks, { fwhmCm1: DEFAULT_IR_FWHM_CM1 });
    const run2 = deriveBroadenedIrSpectrum(waterSticks, { fwhmCm1: DEFAULT_IR_FWHM_CM1 });

    expect(run1.maxIntensity).toBe(run2.maxIntensity);
    expect(run1.curve.length).toBe(run2.curve.length);
    for (let i = 0; i < run1.curve.length; i++) {
      expect(run1.curve[i]!.wavenumberCm1).toBe(run2.curve[i]!.wavenumberCm1);
      expect(run1.curve[i]!.intensity).toBe(run2.curve[i]!.intensity);
      expect(run1.curve[i]!.relativeIntensity).toBe(run2.curve[i]!.relativeIntensity);
    }
  });

  it("automatically expands upper range when a mode exceeds 4000 cm^-1 so Water Mode 3 at 4020.20 cm^-1 is never clipped", () => {
    // Authoritative persisted USER_SUPPLIED Water result
    const userSuppliedWaterSticks: SpectrumStickIR[] = [
      {
        modeIndex: 0,
        frequencyCm1: 1595.70,
        irIntensityKmPerMol: 59.031,
        reducedMassAmu: 1.083,
        imaginary: false,
      },
      {
        modeIndex: 1,
        frequencyCm1: 3913.62,
        irIntensityKmPerMol: 5.638,
        reducedMassAmu: 1.046,
        imaginary: false,
      },
      {
        modeIndex: 2,
        frequencyCm1: 4020.20,
        irIntensityKmPerMol: 32.410,
        reducedMassAmu: 1.082,
        imaginary: false,
      },
    ];

    const range = deriveIrDisplayRange(userSuppliedWaterSticks);
    // 4020.20 + 100 margin = 4120.20 -> rounded up to nearest 100 = 4200
    expect(range.wavenumberMax).toBe(4200);
    expect(range.wavenumberMin).toBe(400);

    const spectrum = deriveBroadenedIrSpectrum(userSuppliedWaterSticks);
    expect(spectrum.wavenumberMax).toBe(4200);
    expect(spectrum.wavenumberMin).toBe(400);
    // Mode 3 is within the visible domain [400, 4200]
    expect(userSuppliedWaterSticks[2]!.frequencyCm1).toBeLessThanOrEqual(spectrum.wavenumberMax);
    expect(userSuppliedWaterSticks[2]!.frequencyCm1).toBeGreaterThanOrEqual(spectrum.wavenumberMin);

    // Default inverted orientation starts at 4200 and ends at 400
    expect(spectrum.curve[0]!.wavenumberCm1).toBe(4200);
    expect(spectrum.curve[spectrum.curve.length - 1]!.wavenumberCm1).toBe(400);

    // High intensity near Mode 3 center at 4020 cm^-1
    const ptNearMode3 = spectrum.curve.find((pt) => Math.abs(pt.wavenumberCm1 - 4020) <= 0.5);
    expect(ptNearMode3).toBeDefined();
    expect(ptNearMode3!.intensity).toBeGreaterThan(0.5);
  });

  it("automatically expands lower range when a mode falls below 400 cm^-1", () => {
    const farIrSticks: SpectrumStickIR[] = [
      {
        modeIndex: 0,
        frequencyCm1: 215.0,
        irIntensityKmPerMol: 45.0,
        imaginary: false,
      },
      {
        modeIndex: 1,
        frequencyCm1: 1500.0,
        irIntensityKmPerMol: 30.0,
        imaginary: false,
      },
    ];

    const range = deriveIrDisplayRange(farIrSticks);
    // 215 - 100 margin = 115 -> rounded down to nearest 50 = 100
    expect(range.wavenumberMin).toBe(100);
    expect(range.wavenumberMax).toBe(4000);

    const spectrum = deriveBroadenedIrSpectrum(farIrSticks);
    expect(spectrum.wavenumberMin).toBe(100);
    expect(spectrum.wavenumberMax).toBe(4000);
    expect(farIrSticks[0]!.frequencyCm1).toBeGreaterThanOrEqual(spectrum.wavenumberMin);
  });

  it("preserves baseline 4000 -> 400 cm^-1 window when all modes lie within it", () => {
    const range = deriveIrDisplayRange(waterSticks);
    expect(range.wavenumberMin).toBe(400);
    expect(range.wavenumberMax).toBe(4000);

    const spectrum = deriveBroadenedIrSpectrum(waterSticks);
    expect(spectrum.wavenumberMin).toBe(400);
    expect(spectrum.wavenumberMax).toBe(4000);
  });
});

