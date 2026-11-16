/**
 * Deterministic UV/Vis spectrum derivation and Gaussian broadening.
 *
 * Core invariant:
 * - Authoritative discrete excited-state sticks are calculated by PySCF TDDFT.
 * - The continuous broadened absorption curve is DERIVED, not an engine result.
 * - Broadening MUST occur strictly in ENERGY space (eV).
 * - Wavelength presentation is an exact reparameterization (lambda = hc / E).
 */

import {
  HARTREE_TO_EV,
  hartreeToEv,
} from "./scientific-format";

export { HARTREE_TO_EV, hartreeToEv };

/** Product of Planck constant and speed of light (hc) in eV * nm (CODATA exact). */
export const EV_NM_PRODUCT = 1239.8419843320025;

export function evToWavelengthNm(ev: number): number {
  if (ev <= 0) return 0;
  return EV_NM_PRODUCT / ev;
}

export function wavelengthNmToEv(nm: number): number {
  if (nm <= 0) return 0;
  return EV_NM_PRODUCT / nm;
}

export const DEFAULT_FWHM_EV = 0.30;
export const MIN_FWHM_EV = 0.05;
export const MAX_FWHM_EV = 1.0;
export const SPECTRUM_RENDERER_VERSION = "1.0.0";

export interface SpectrumStick {
  stateIndex: number;
  stateLabel: string;
  energyEv: number;
  energyHartree: number;
  wavelengthNm: number;
  oscillatorStrength: number;
  converged: boolean;
}

export interface SpectrumPoint {
  energyEv: number;
  wavelengthNm: number;
  intensity: number;
}

export interface BroadenedSpectrum {
  algorithm: "Gaussian";
  fwhmEv: number;
  energyMinEv: number;
  energyMaxEv: number;
  pointsCount: number;
  rendererVersion: string;
  energyCurve: SpectrumPoint[];
  wavelengthCurve: SpectrumPoint[];
  sticks: SpectrumStick[];
}

/**
 * Evaluates the Gaussian broadened intensity at a specific energy E:
 * I(E) = sum_i f_i * exp[ -4 ln(2) * ((E - E_i) / FWHM)^2 ]
 */
export function evaluateGaussianBroadening(
  energyEv: number,
  sticks: SpectrumStick[],
  fwhmEv: number
): number {
  if (fwhmEv <= 0 || sticks.length === 0) return 0;
  const factor = -4 * Math.LN2;
  let totalIntensity = 0;

  for (const stick of sticks) {
    if (!Number.isFinite(stick.energyEv) || !Number.isFinite(stick.oscillatorStrength)) {
      continue;
    }
    const diff = (energyEv - stick.energyEv) / fwhmEv;
    // Bound computation for numerical stability when diff is large
    if (Math.abs(diff) > 5) continue;
    const term = stick.oscillatorStrength * Math.exp(factor * diff * diff);
    totalIntensity += term;
  }

  return totalIntensity;
}

/**
 * Derives a deterministic broadened UV/Vis spectrum from immutable excited-state sticks.
 *
 * Broadening is performed strictly across a uniform grid in ENERGY space (eV).
 * Wavelength curve is derived by mapping each energy grid point to lambda = hc / E
 * and ordering by ascending wavelength for clean rendering.
 */
export function deriveBroadenedSpectrum(
  sticks: SpectrumStick[],
  options?: {
    fwhmEv?: number;
    numPoints?: number;
    paddingEv?: number;
  }
): BroadenedSpectrum {
  const fwhmEv = Math.min(
    MAX_FWHM_EV,
    Math.max(MIN_FWHM_EV, options?.fwhmEv ?? DEFAULT_FWHM_EV)
  );
  const numPoints = options?.numPoints ?? 600;
  const paddingEv = options?.paddingEv ?? Math.max(1.2, 4 * fwhmEv);

  if (sticks.length === 0) {
    return {
      algorithm: "Gaussian",
      fwhmEv,
      energyMinEv: 0,
      energyMaxEv: 0,
      pointsCount: 0,
      rendererVersion: SPECTRUM_RENDERER_VERSION,
      energyCurve: [],
      wavelengthCurve: [],
      sticks: [],
    };
  }

  const validSticks = sticks.filter(
    (s) => Number.isFinite(s.energyEv) && s.energyEv > 0 && Number.isFinite(s.oscillatorStrength)
  );

  const minE = Math.min(...validSticks.map((s) => s.energyEv));
  const maxE = Math.max(...validSticks.map((s) => s.energyEv));

  const energyMinEv = Math.max(0.1, minE - paddingEv);
  const energyMaxEv = maxE + paddingEv;
  const step = (energyMaxEv - energyMinEv) / (numPoints - 1);

  const energyCurve: SpectrumPoint[] = [];

  for (let i = 0; i < numPoints; i++) {
    const energy = energyMinEv + i * step;
    const intensity = evaluateGaussianBroadening(energy, validSticks, fwhmEv);
    const wavelength = evToWavelengthNm(energy);
    energyCurve.push({
      energyEv: energy,
      wavelengthNm: wavelength,
      intensity,
    });
  }

  // Wavelength curve: sorted by ascending wavelength (nm) for visualization
  // Each point corresponds directly to its energy-space broadened value
  const wavelengthCurve = [...energyCurve].sort(
    (a, b) => a.wavelengthNm - b.wavelengthNm
  );

  return {
    algorithm: "Gaussian",
    fwhmEv,
    energyMinEv,
    energyMaxEv,
    pointsCount: numPoints,
    rendererVersion: SPECTRUM_RENDERER_VERSION,
    energyCurve,
    wavelengthCurve,
    sticks: validSticks,
  };
}

/** Default FWHM for IR Lorentzian line broadening in cm^-1 (conventional spectroscopic line width). */
export const DEFAULT_IR_FWHM_CM1 = 15.0;
export const MIN_IR_FWHM_CM1 = 2.0;
export const MAX_IR_FWHM_CM1 = 100.0;
export const DEFAULT_IR_MIN_WAVENUMBER = 400.0;
export const DEFAULT_IR_MAX_WAVENUMBER = 4000.0;

export interface SpectrumStickIR {
  modeIndex: number;
  frequencyCm1: number;
  irIntensityKmPerMol: number;
  reducedMassAmu?: number | null | undefined;
  imaginary: boolean;
}

export interface SpectrumPointIR {
  wavenumberCm1: number;
  intensity: number;
  relativeIntensity: number;
}

export interface BroadenedSpectrumIR {
  algorithm: "Lorentzian";
  fwhmCm1: number;
  wavenumberMin: number;
  wavenumberMax: number;
  pointsCount: number;
  rendererVersion: string;
  curve: SpectrumPointIR[];
  sticks: SpectrumStickIR[];
  maxIntensity: number;
}

/**
 * Evaluates Lorentzian broadened IR intensity at wavenumber nu:
 * I(nu) = sum_k (A_k / pi) * [ (gamma / 2) / ((nu - nu_k)^2 + (gamma / 2)^2) ]
 * where gamma = FWHM in cm^-1 and A_k is integrated molar intensity in km/mol.
 */
export function evaluateLorentzianBroadening(
  wavenumberCm1: number,
  sticks: SpectrumStickIR[],
  fwhmCm1: number,
): number {
  if (fwhmCm1 <= 0 || sticks.length === 0) return 0;
  const halfGamma = fwhmCm1 / 2.0;
  const halfGammaSq = halfGamma * halfGamma;
  let totalIntensity = 0;

  for (const stick of sticks) {
    if (stick.imaginary || stick.frequencyCm1 <= 0 || !Number.isFinite(stick.frequencyCm1)) {
      continue;
    }
    if (!Number.isFinite(stick.irIntensityKmPerMol) || stick.irIntensityKmPerMol <= 0) {
      continue;
    }
    const diff = wavenumberCm1 - stick.frequencyCm1;
    if (Math.abs(diff) > 40 * fwhmCm1) continue;
    const term = (stick.irIntensityKmPerMol / Math.PI) * (halfGamma / (diff * diff + halfGammaSq));
    totalIntensity += term;
  }

  return totalIntensity;
}

/**
 * Automatically derives the visible wavenumber domain for an IR spectrum.
 *
 * Rules:
 * - Baseline conventional mid-IR view is 4000 -> 400 cm^-1.
 * - If any real positive normal modes have frequencies > 4000 cm^-1,
 *   the upper bound automatically expands above the highest mode with a margin,
 *   rounded up to a clean boundary (nearest 100 cm^-1).
 * - If any real positive normal modes have frequencies < 400 cm^-1,
 *   the lower bound automatically expands below the lowest mode with a margin,
 *   rounded down to a clean boundary (nearest 50 cm^-1, clamped to >= 0).
 * - Modes outside conventional 4000-400 cm^-1 must never be silently clipped.
 */
export function deriveIrDisplayRange(
  sticks: SpectrumStickIR[],
  options?: {
    baselineMin?: number | undefined;
    baselineMax?: number | undefined;
    marginCm1?: number | undefined;
  },
): { wavenumberMin: number; wavenumberMax: number } {
  const baselineMin = options?.baselineMin ?? DEFAULT_IR_MIN_WAVENUMBER;
  const baselineMax = options?.baselineMax ?? DEFAULT_IR_MAX_WAVENUMBER;
  const margin = options?.marginCm1 ?? 100.0;

  const validModes = sticks.filter(
    (s) => Number.isFinite(s.frequencyCm1) && s.frequencyCm1 > 0 && !s.imaginary,
  );

  if (validModes.length === 0) {
    return { wavenumberMin: baselineMin, wavenumberMax: baselineMax };
  }

  const minFreq = Math.min(...validModes.map((s) => s.frequencyCm1));
  const maxFreq = Math.max(...validModes.map((s) => s.frequencyCm1));

  let wavenumberMin = baselineMin;
  if (minFreq < baselineMin) {
    const rawMin = Math.max(0, minFreq - margin);
    wavenumberMin = Math.floor(rawMin / 50.0) * 50.0;
  }

  let wavenumberMax = baselineMax;
  if (maxFreq > baselineMax) {
    const rawMax = maxFreq + margin;
    wavenumberMax = Math.ceil(rawMax / 100.0) * 100.0;
  }

  return { wavenumberMin, wavenumberMax };
}

/**
 * Derives a deterministic broadened IR spectrum from discrete vibrational modes.
 *
 * Broadening is performed strictly across a uniform grid in wavenumber space (cm^-1).
 * Default axis orientation: 4000 -> 400 cm^-1 (inverted) following conventional IR display,
 * automatically expanding if real modes exceed the baseline window.
 */
export function deriveBroadenedIrSpectrum(
  sticks: SpectrumStickIR[],
  options?: {
    fwhmCm1?: number | undefined;
    wavenumberMin?: number | undefined;
    wavenumberMax?: number | undefined;
    stepCm1?: number | undefined;
    inverted?: boolean | undefined;
    autoExpandRange?: boolean | undefined;
  },
): BroadenedSpectrumIR {
  const fwhmCm1 = Math.min(
    MAX_IR_FWHM_CM1,
    Math.max(MIN_IR_FWHM_CM1, options?.fwhmCm1 ?? DEFAULT_IR_FWHM_CM1),
  );

  let minWn: number;
  let maxWn: number;

  if (
    options?.wavenumberMin !== undefined &&
    options?.wavenumberMax !== undefined &&
    options?.autoExpandRange !== true
  ) {
    minWn = options.wavenumberMin;
    maxWn = options.wavenumberMax;
  } else {
    const range = deriveIrDisplayRange(sticks, {
      baselineMin: options?.wavenumberMin,
      baselineMax: options?.wavenumberMax,
    });
    minWn = range.wavenumberMin;
    maxWn = range.wavenumberMax;
  }

  const step = options?.stepCm1 ?? 1.0;
  const inverted = options?.inverted ?? true;

  const validSticks = sticks.filter(
    (s) => Number.isFinite(s.frequencyCm1) && Number.isFinite(s.irIntensityKmPerMol),
  );

  const numPoints = Math.max(2, Math.floor((maxWn - minWn) / step) + 1);
  const rawCurve: Array<{ wavenumberCm1: number; intensity: number }> = [];

  let maxIntensity = 0;
  for (let i = 0; i < numPoints; i++) {
    const wn = minWn + i * step;
    const intensity = evaluateLorentzianBroadening(wn, validSticks, fwhmCm1);
    if (intensity > maxIntensity) {
      maxIntensity = intensity;
    }
    rawCurve.push({ wavenumberCm1: wn, intensity });
  }

  const safeMax = maxIntensity > 0 ? maxIntensity : 1.0;
  const points: SpectrumPointIR[] = rawCurve.map((pt) => ({
    wavenumberCm1: pt.wavenumberCm1,
    intensity: pt.intensity,
    relativeIntensity: pt.intensity / safeMax,
  }));

  const curve = inverted ? points.reverse() : points;

  return {
    algorithm: "Lorentzian",
    fwhmCm1,
    wavenumberMin: minWn,
    wavenumberMax: maxWn,
    pointsCount: numPoints,
    rendererVersion: SPECTRUM_RENDERER_VERSION,
    curve,
    sticks: validSticks,
    maxIntensity,
  };
}

export const DEFAULT_RAMAN_FWHM_CM1 = 15.0;
export const MIN_RAMAN_FWHM_CM1 = 2.0;
export const MAX_RAMAN_FWHM_CM1 = 50.0;
export const DEFAULT_RAMAN_MIN_WAVENUMBER = 0.0;
export const DEFAULT_RAMAN_MAX_WAVENUMBER = 4000.0;
export const DEFAULT_LASER_WAVELENGTH_NM = 532.0;
export const DEFAULT_RAMAN_LASER_NM = DEFAULT_LASER_WAVELENGTH_NM;
export const RAMAN_LASER_PRESETS_NM = [532, 633, 785] as const;
export const DEFAULT_RAMAN_TEMPERATURE_K = 298.15;
export const HC_OVER_KB = 1.438776877; // hc / k_B in cm * K

export interface SpectrumStickRaman {
  modeIndex: number;
  frequencyCm1: number;
  reducedMassAmu: number | null;
  ramanActivity: number; // Angstrom^4 / amu
  depolarizationRatio: number | null;
  imaginary: boolean;
}

export interface SpectrumPointRaman {
  wavenumberCm1: number;
  activity: number;
  relativeIntensity: number;
}

export interface BroadenedSpectrumRaman {
  algorithm: "Lorentzian";
  fwhmCm1: number;
  wavenumberMin: number;
  wavenumberMax: number;
  pointsCount: number;
  rendererVersion: string;
  curve: SpectrumPointRaman[];
  sticks: SpectrumStickRaman[];
  maxActivity: number;
  maxRelativeIntensity: number;
}

/**
 * Calculates deterministic Stokes Raman scattering factor:
 * factor = (nu_L - nu_k)^4 / [ nu_k * (1 - exp(-h*c*nu_k / (k_B*T))) ]
 *
 * Parameters:
 * - frequencyCm1: Raman shift nu_k (cm^-1)
 * - laserWavelengthNm: excitation wavelength lambda_L (nm)
 * - temperatureK: absolute temperature T (K)
 */
export function calculateStokesFactor(
  frequencyCm1: number,
  laserWavelengthNm: number = DEFAULT_LASER_WAVELENGTH_NM,
  temperatureK: number = DEFAULT_RAMAN_TEMPERATURE_K,
): number {
  if (frequencyCm1 <= 0 || !Number.isFinite(frequencyCm1)) return 0;
  if (laserWavelengthNm <= 0 || !Number.isFinite(laserWavelengthNm)) return 0;
  if (temperatureK <= 0 || !Number.isFinite(temperatureK)) return 0;

  const nuLaserCm1 = 1e7 / laserWavelengthNm;
  // If vibrational shift exceeds laser frequency, Stokes scattering is unphysical
  if (frequencyCm1 >= nuLaserCm1) return 0;

  const nuStokes = nuLaserCm1 - frequencyCm1;
  const nuStokes4 = nuStokes * nuStokes * nuStokes * nuStokes;

  const exponent = (HC_OVER_KB * frequencyCm1) / temperatureK;
  // Numerical guard for large or small exponent
  const boseFactor = exponent > 50 ? 1.0 : Math.max(1e-12, 1.0 - Math.exp(-exponent));

  return nuStokes4 / (frequencyCm1 * boseFactor);
}

/**
 * Calculates derived relative Raman intensities from intrinsic activities.
 * Normalized to peak maximum 1.0 (or arbitrary units).
 */
export function calculateDerivedRamanIntensities(
  sticks: SpectrumStickRaman[],
  laserWavelengthNm: number = DEFAULT_LASER_WAVELENGTH_NM,
  temperatureK: number = DEFAULT_RAMAN_TEMPERATURE_K,
): Map<number, number> {
  const intensities = new Map<number, number>();
  let maxRaw = 0;

  const rawValues = sticks.map((s) => {
    if (s.imaginary || s.frequencyCm1 <= 0 || !Number.isFinite(s.ramanActivity)) {
      return { modeIndex: s.modeIndex, intensity: 0 };
    }
    const factor = calculateStokesFactor(s.frequencyCm1, laserWavelengthNm, temperatureK);
    const raw = factor * s.ramanActivity;
    if (raw > maxRaw) maxRaw = raw;
    return { modeIndex: s.modeIndex, intensity: raw };
  });

  const safeMax = maxRaw > 0 ? maxRaw : 1.0;
  for (const item of rawValues) {
    intensities.set(item.modeIndex, item.intensity / safeMax);
  }

  return intensities;
}

/**
 * Derives the visible wavenumber domain for a Raman spectrum.
 *
 * Rules:
 * - Baseline domain is 0 -> 4000 cm^-1 (ascending).
 * - If any real positive normal modes have frequencies > 4000 cm^-1,
 *   auto-expand upper bound above highest mode with margin, rounded to clean boundary.
 * - Modes must never be silently clipped.
 */
export function deriveRamanDisplayRange(
  sticks: SpectrumStickRaman[],
  options?: {
    baselineMin?: number | undefined;
    baselineMax?: number | undefined;
    marginCm1?: number | undefined;
  },
): { wavenumberMin: number; wavenumberMax: number } {
  const baselineMin = options?.baselineMin ?? DEFAULT_RAMAN_MIN_WAVENUMBER;
  const baselineMax = options?.baselineMax ?? DEFAULT_RAMAN_MAX_WAVENUMBER;
  const margin = options?.marginCm1 ?? 100.0;

  const validModes = sticks.filter(
    (s) => Number.isFinite(s.frequencyCm1) && s.frequencyCm1 > 0 && !s.imaginary,
  );

  if (validModes.length === 0) {
    return { wavenumberMin: baselineMin, wavenumberMax: baselineMax };
  }

  const maxFreq = Math.max(...validModes.map((s) => s.frequencyCm1));
  let wavenumberMax = baselineMax;
  if (maxFreq > baselineMax) {
    const rawMax = maxFreq + margin;
    wavenumberMax = Math.ceil(rawMax / 100.0) * 100.0;
  }

  return { wavenumberMin: baselineMin, wavenumberMax };
}

/**
 * Derives a deterministic broadened Raman spectrum from discrete vibrational modes.
 *
 * Broadening is performed strictly across a uniform grid in ascending Raman shift (0 -> maxWn cm^-1).
 * Calculates both intrinsic activity curve and derived relative intensity curve.
 */
export function deriveBroadenedRamanSpectrum(
  sticks: SpectrumStickRaman[],
  options?: {
    fwhmCm1?: number | undefined;
    wavenumberMin?: number | undefined;
    wavenumberMax?: number | undefined;
    stepCm1?: number | undefined;
    laserWavelengthNm?: number | undefined;
    temperatureK?: number | undefined;
    autoExpandRange?: boolean | undefined;
  },
): BroadenedSpectrumRaman {
  const fwhmCm1 = Math.min(
    MAX_RAMAN_FWHM_CM1,
    Math.max(MIN_RAMAN_FWHM_CM1, options?.fwhmCm1 ?? DEFAULT_RAMAN_FWHM_CM1),
  );

  const laserWavelengthNm = options?.laserWavelengthNm ?? DEFAULT_LASER_WAVELENGTH_NM;
  const temperatureK = options?.temperatureK ?? DEFAULT_RAMAN_TEMPERATURE_K;

  let minWn: number;
  let maxWn: number;

  if (
    options?.wavenumberMin !== undefined &&
    options?.wavenumberMax !== undefined &&
    options?.autoExpandRange !== true
  ) {
    minWn = options.wavenumberMin;
    maxWn = options.wavenumberMax;
  } else {
    const range = deriveRamanDisplayRange(sticks, {
      baselineMin: options?.wavenumberMin,
      baselineMax: options?.wavenumberMax,
    });
    minWn = range.wavenumberMin;
    maxWn = range.wavenumberMax;
  }

  const step = options?.stepCm1 ?? 1.0;
  const validSticks = sticks.filter(
    (s) => Number.isFinite(s.frequencyCm1) && Number.isFinite(s.ramanActivity),
  );

  const derivedIntensities = calculateDerivedRamanIntensities(
    validSticks,
    laserWavelengthNm,
    temperatureK,
  );

  const halfGamma = fwhmCm1 / 2.0;
  const halfGammaSq = halfGamma * halfGamma;
  const numPoints = Math.max(2, Math.floor((maxWn - minWn) / step) + 1);

  const rawCurve: Array<{
    wavenumberCm1: number;
    activity: number;
    relativeIntensity: number;
  }> = [];

  let maxActivity = 0;
  let maxRelIntensity = 0;

  for (let i = 0; i < numPoints; i++) {
    const wn = minWn + i * step;
    let pointActivity = 0;
    let pointIntensity = 0;

    for (const stick of validSticks) {
      if (stick.imaginary || stick.frequencyCm1 <= 0) continue;
      const diff = wn - stick.frequencyCm1;
      if (Math.abs(diff) > 40 * fwhmCm1) continue;
      const lorentzFactor = (1.0 / Math.PI) * (halfGamma / (diff * diff + halfGammaSq));
      pointActivity += stick.ramanActivity * lorentzFactor;
      const relI = derivedIntensities.get(stick.modeIndex) ?? 0;
      pointIntensity += relI * lorentzFactor;
    }

    if (pointActivity > maxActivity) maxActivity = pointActivity;
    if (pointIntensity > maxRelIntensity) maxRelIntensity = pointIntensity;

    rawCurve.push({
      wavenumberCm1: wn,
      activity: pointActivity,
      relativeIntensity: pointIntensity,
    });
  }

  const safeRelMax = maxRelIntensity > 0 ? maxRelIntensity : 1.0;
  const curve: SpectrumPointRaman[] = rawCurve.map((pt) => ({
    wavenumberCm1: pt.wavenumberCm1,
    activity: pt.activity,
    relativeIntensity: pt.relativeIntensity / safeRelMax,
  }));

  return {
    algorithm: "Lorentzian",
    fwhmCm1,
    wavenumberMin: minWn,
    wavenumberMax: maxWn,
    pointsCount: numPoints,
    rendererVersion: SPECTRUM_RENDERER_VERSION,
    curve,
    sticks: validSticks,
    maxActivity,
    maxRelativeIntensity: maxRelIntensity,
  };
}
