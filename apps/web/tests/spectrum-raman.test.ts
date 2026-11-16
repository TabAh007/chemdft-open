import { describe, expect, it } from "vitest";
import {
  deriveBroadenedRamanSpectrum,
  deriveRamanDisplayRange,
  calculateStokesFactor,
  calculateDerivedRamanIntensities,
  DEFAULT_RAMAN_FWHM_CM1,
  DEFAULT_LASER_WAVELENGTH_NM,
  DEFAULT_RAMAN_TEMPERATURE_K,
  type SpectrumStickRaman,
} from "../src/lib/spectrum";

describe("Raman Lorentzian Spectrum Broadening & Relative Intensity", () => {
  it("defines physically standard default optical parameters", () => {
    expect(DEFAULT_RAMAN_FWHM_CM1).toBe(15.0);
    expect(DEFAULT_LASER_WAVELENGTH_NM).toBe(532.0);
    expect(DEFAULT_RAMAN_TEMPERATURE_K).toBe(298.15);
  });

  // Pinned Water acceptance sticks on exact StructureVersion
  const waterSticks: SpectrumStickRaman[] = [
    {
      modeIndex: 0,
      frequencyCm1: 1595.70,
      ramanActivity: 6.3840,
      depolarizationRatio: 0.5248,
      reducedMassAmu: 1.0826,
      imaginary: false,
    },
    {
      modeIndex: 1,
      frequencyCm1: 3913.62,
      ramanActivity: 74.4214,
      depolarizationRatio: 0.1669,
      reducedMassAmu: 1.0455,
      imaginary: false,
    },
    {
      modeIndex: 2,
      frequencyCm1: 4020.20,
      ramanActivity: 34.7163,
      depolarizationRatio: 0.7500,
      reducedMassAmu: 1.0821,
      imaginary: false,
    },
  ];

  it("generates an ascending Raman shift axis (0 -> maxWn)", () => {
    const spec = deriveBroadenedRamanSpectrum(waterSticks);
    expect(spec.curve.length).toBeGreaterThan(100);
    // Wavenumber must be monotonically increasing
    for (let i = 1; i < spec.curve.length; i++) {
      expect(spec.curve[i]!.wavenumberCm1).toBeGreaterThan(spec.curve[i - 1]!.wavenumberCm1);
    }
    expect(spec.wavenumberMin).toBe(0.0);
    expect(spec.curve[0]!.wavenumberCm1).toBe(0.0);
  });

  it("auto-expands upper bound above 4000 cm^-1 so Water Mode 3 (4020.20 cm^-1) is visible", () => {
    const range = deriveRamanDisplayRange(waterSticks);
    expect(range.wavenumberMin).toBe(0.0);
    // 4020.2 + 100 margin = 4120.2 -> rounded to nearest 100 is 4200
    expect(range.wavenumberMax).toBeGreaterThanOrEqual(4200.0);

    const spec = deriveBroadenedRamanSpectrum(waterSticks);
    expect(spec.wavenumberMax).toBe(range.wavenumberMax);
    expect(spec.curve[spec.curve.length - 1]!.wavenumberCm1).toBe(range.wavenumberMax);
  });

  it("centers Lorentzian peak at exact vibrational frequency", () => {
    const single: SpectrumStickRaman[] = [
      {
        modeIndex: 0,
        frequencyCm1: 1000.0,
        ramanActivity: 50.0,
        depolarizationRatio: 0.2,
        reducedMassAmu: 1.0,
        imaginary: false,
      },
    ];
    const spec = deriveBroadenedRamanSpectrum(single, {
      wavenumberMin: 900,
      wavenumberMax: 1100,
      stepCm1: 0.5,
      fwhmCm1: 15.0,
    });

    const maxPoint = spec.curve.reduce((prev, curr) => (curr.activity > prev.activity ? curr : prev));
    expect(maxPoint.wavenumberCm1).toBe(1000.0);
  });

  it("respects FWHM setting for peak width", () => {
    const single: SpectrumStickRaman[] = [
      {
        modeIndex: 0,
        frequencyCm1: 1000.0,
        ramanActivity: 50.0,
        depolarizationRatio: 0.2,
        reducedMassAmu: 1.0,
        imaginary: false,
      },
    ];
    const spec10 = deriveBroadenedRamanSpectrum(single, { fwhmCm1: 10.0, stepCm1: 0.5 });
    const spec20 = deriveBroadenedRamanSpectrum(single, { fwhmCm1: 20.0, stepCm1: 0.5 });

    // Narrower FWHM yields higher peak maximum under normalized Lorentzian
    expect(spec10.maxActivity).toBeGreaterThan(spec20.maxActivity);
  });

  it("evaluates both intrinsic activity and derived relative intensity curves", () => {
    const spec = deriveBroadenedRamanSpectrum(waterSticks);
    expect(spec.maxActivity).toBeGreaterThan(0);
    expect(spec.maxRelativeIntensity).toBeGreaterThan(0);

    for (const pt of spec.curve) {
      expect(pt.activity).toBeGreaterThanOrEqual(0);
      expect(pt.relativeIntensity).toBeGreaterThanOrEqual(0);
      expect(pt.relativeIntensity).toBeLessThanOrEqual(1.0001);
    }
  });

  it("changes relative intensity deterministically with laser excitation wavelength without changing intrinsic activity", () => {
    const spec532 = deriveBroadenedRamanSpectrum(waterSticks, { laserWavelengthNm: 532.0 });
    const spec785 = deriveBroadenedRamanSpectrum(waterSticks, { laserWavelengthNm: 785.0 });

    // Intrinsic activity must remain identical across lasers!
    expect(spec532.maxActivity).toBe(spec785.maxActivity);
    for (let i = 0; i < spec532.curve.length; i++) {
      expect(spec532.curve[i]!.activity).toBe(spec785.curve[i]!.activity);
    }

    // Derived relative intensity ratios differ between 532 nm and 785 nm
    const i532 = calculateDerivedRamanIntensities(waterSticks, 532.0);
    const i785 = calculateDerivedRamanIntensities(waterSticks, 785.0);

    // Both should have mode 1 as normalized max or relative values
    expect(i532.get(0)).toBeDefined();
    expect(i785.get(0)).toBeDefined();
    expect(i532.get(0)).not.toEqual(i785.get(0));
  });

  it("changes relative intensity deterministically with temperature without changing intrinsic activity", () => {
    const specRoom = deriveBroadenedRamanSpectrum(waterSticks, { temperatureK: 298.15 });
    const specHot = deriveBroadenedRamanSpectrum(waterSticks, { temperatureK: 500.0 });

    // Intrinsic activity remains strictly unchanged
    expect(specRoom.maxActivity).toBe(specHot.maxActivity);

    const iRoom = calculateDerivedRamanIntensities(waterSticks, 532.0, 298.15);
    const iHot = calculateDerivedRamanIntensities(waterSticks, 532.0, 500.0);
    expect(iRoom.get(0)).not.toEqual(iHot.get(0));
  });

  it("handles unphysical Stokes conditions safely when frequency exceeds laser frequency", () => {
    // 1000 nm laser has nu_laser = 10000 cm^-1
    // A mode at 15000 cm^-1 would be anti-Stokes or unphysical for Stokes
    const unphysicalFactor = calculateStokesFactor(15000.0, 1000.0);
    expect(unphysicalFactor).toBe(0);

    const negFactor = calculateStokesFactor(-100.0, 532.0);
    expect(negFactor).toBe(0);
  });

  it("guarantees deterministic repeatability across multiple evaluations", () => {
    const run1 = deriveBroadenedRamanSpectrum(waterSticks);
    const run2 = deriveBroadenedRamanSpectrum(waterSticks);

    expect(run1.maxActivity).toBe(run2.maxActivity);
    expect(run1.curve.length).toBe(run2.curve.length);
    for (let i = 0; i < run1.curve.length; i++) {
      expect(run1.curve[i]!.activity).toBe(run2.curve[i]!.activity);
      expect(run1.curve[i]!.relativeIntensity).toBe(run2.curve[i]!.relativeIntensity);
    }
  });
});
