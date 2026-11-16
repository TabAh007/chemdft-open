import { describe, expect, it } from "vitest";
import {
  deriveBroadenedSpectrum,
  evaluateGaussianBroadening,
  evToWavelengthNm,
  wavelengthNmToEv,
  DEFAULT_FWHM_EV,
  EV_NM_PRODUCT,
  HARTREE_TO_EV,
  type SpectrumStick,
} from "../src/lib/spectrum";

describe("Spectrum broadening and unit conversions", () => {
  const mockSticks: SpectrumStick[] = [
    {
      stateIndex: 0,
      stateLabel: "S1",
      energyEv: 7.0,
      energyHartree: 7.0 / HARTREE_TO_EV,
      wavelengthNm: EV_NM_PRODUCT / 7.0,
      oscillatorStrength: 0.05,
      converged: true,
    },
    {
      stateIndex: 1,
      stateLabel: "S2",
      energyEv: 9.0,
      energyHartree: 9.0 / HARTREE_TO_EV,
      wavelengthNm: EV_NM_PRODUCT / 9.0,
      oscillatorStrength: 0.15,
      converged: true,
    },
  ];

  it("converts energy and wavelength consistently via hc product", () => {
    const ev = 7.14;
    const nm = evToWavelengthNm(ev);
    expect(nm).toBeCloseTo(173.647, 2);

    const backToEv = wavelengthNmToEv(nm);
    expect(backToEv).toBeCloseTo(ev, 6);
  });

  it("evaluates maximum intensity at peak position E = E_i for an isolated state", () => {
    const singleStick: SpectrumStick[] = [
      {
        stateIndex: 0,
        stateLabel: "S1",
        energyEv: 8.0,
        energyHartree: 8.0 / HARTREE_TO_EV,
        wavelengthNm: EV_NM_PRODUCT / 8.0,
        oscillatorStrength: 0.20,
        converged: true,
      },
    ];

    const fwhm = 0.30;
    const peakIntensity = evaluateGaussianBroadening(8.0, singleStick, fwhm);
    expect(peakIntensity).toBeCloseTo(0.20, 8);

    // Slightly off-peak must be strictly lower
    const slightlyBelow = evaluateGaussianBroadening(7.9, singleStick, fwhm);
    const slightlyAbove = evaluateGaussianBroadening(8.1, singleStick, fwhm);
    expect(slightlyBelow).toBeLessThan(peakIntensity);
    expect(slightlyAbove).toBeLessThan(peakIntensity);
    expect(slightlyBelow).toBeCloseTo(slightlyAbove, 8); // Symmetric
  });

  it("evaluates to exactly half maximum at E = E_i +/- FWHM / 2", () => {
    const singleStick: SpectrumStick[] = [
      {
        stateIndex: 0,
        stateLabel: "S1",
        energyEv: 7.5,
        energyHartree: 7.5 / HARTREE_TO_EV,
        wavelengthNm: EV_NM_PRODUCT / 7.5,
        oscillatorStrength: 0.10,
        converged: true,
      },
    ];

    const fwhm = 0.40;
    const halfWidth = fwhm / 2; // 0.20 eV

    const atHalfMinus = evaluateGaussianBroadening(7.5 - halfWidth, singleStick, fwhm);
    const atHalfPlus = evaluateGaussianBroadening(7.5 + halfWidth, singleStick, fwhm);

    expect(atHalfMinus).toBeCloseTo(0.05, 6);
    expect(atHalfPlus).toBeCloseTo(0.05, 6);
  });

  it("changing FWHM alters only the derived continuous curve, leaving sticks immutable", () => {
    const sticksCopy = JSON.parse(JSON.stringify(mockSticks));

    const specDefault = deriveBroadenedSpectrum(mockSticks, { fwhmEv: DEFAULT_FWHM_EV });
    const specNarrow = deriveBroadenedSpectrum(mockSticks, { fwhmEv: 0.10 });
    const specBroad = deriveBroadenedSpectrum(mockSticks, { fwhmEv: 0.60 });

    // Sticks must not be mutated
    expect(mockSticks).toEqual(sticksCopy);
    expect(specDefault.sticks).toEqual(mockSticks);
    expect(specNarrow.sticks).toEqual(mockSticks);
    expect(specBroad.sticks).toEqual(mockSticks);

    // Peak positions in energy grid
    expect(specDefault.energyCurve.length).toBeGreaterThan(0);
    expect(specNarrow.energyCurve.length).toBeGreaterThan(0);

    // Intensity at 7.3 eV (0.3 eV away from 7.0 eV peak):
    // with narrow broadening (FWHM 0.1) it's ~0, with broad broadening (FWHM 0.6, so diff = half-width) it is exactly 0.5 * 0.05 = 0.025
    const intensityNarrowAtTail = evaluateGaussianBroadening(7.3, mockSticks, 0.10);
    const intensityBroadAtTail = evaluateGaussianBroadening(7.3, mockSticks, 0.60);
    expect(intensityNarrowAtTail).toBeLessThan(0.0001);
    expect(intensityBroadAtTail).toBeGreaterThan(0.02);
  });

  it("preserves correct state ordering and wavelength inversion", () => {
    const spec = deriveBroadenedSpectrum(mockSticks);

    // Higher energy (9.0 eV) corresponds to shorter wavelength (137.76 nm)
    // Lower energy (7.0 eV) corresponds to longer wavelength (177.12 nm)
    const s1 = spec.sticks.find((s) => s.stateLabel === "S1")!;
    const s2 = spec.sticks.find((s) => s.stateLabel === "S2")!;

    expect(s1.energyEv).toBeLessThan(s2.energyEv);
    expect(s1.wavelengthNm).toBeGreaterThan(s2.wavelengthNm);

    // Wavelength curve is sorted ascending in wavelength (nm)
    for (let i = 1; i < spec.wavelengthCurve.length; i++) {
      expect(spec.wavelengthCurve[i]!.wavelengthNm).toBeGreaterThanOrEqual(
        spec.wavelengthCurve[i - 1]!.wavelengthNm
      );
    }
  });
});
