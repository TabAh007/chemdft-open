import { describe, expect, it } from "vitest";
import { selectionKey, validSelection } from "../src/lib/workspace-selection";
import {
  deduplicateWorkspaceTabs,
  emptyWorkspaceState,
  openWorkspaceTab,
} from "../src/lib/workspace-tabs";
import {
  calculateDerivedRamanIntensities,
  calculateStokesFactor,
  deriveBroadenedRamanSpectrum,
  deriveRamanDisplayRange,
  type SpectrumStickRaman,
} from "../src/lib/spectrum";

const projectIdA = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const projectIdB = "e22aefcf-b2cd-4707-8f04-f9b18eadb96e";
const calcId = "a11d9ea8-f66d-4a48-a872-859d4cb1d0f1";
const irResultId = "b22d9ea8-f66d-4a48-a872-859d4cb1d0f2";
const ramanResultId = "c33d9ea8-f66d-4a48-a872-859d4cb1d0f3";
const uvvisResultId = "d44d9ea8-f66d-4a48-a872-859d4cb1d0f4";

const ramanSelection = {
  kind: "calculationResult" as const,
  id: ramanResultId,
  projectId: projectIdA,
  sourceId: calcId,
};

const irSelection = {
  kind: "calculationResult" as const,
  id: irResultId,
  projectId: projectIdA,
  sourceId: calcId,
};

const uvvisSelection = {
  kind: "calculationResult" as const,
  id: uvvisResultId,
  projectId: projectIdA,
  sourceId: calcId,
};

const waterRamanSticks: SpectrumStickRaman[] = [
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

describe("Raman spectroscopy frontend and workflow integrity", () => {
  it("deduplicates Raman spectrum tabs and maintains clean separation from IR and UV/Vis", () => {
    let state = openWorkspaceTab(emptyWorkspaceState(), {
      selection: ramanSelection,
      label: "Raman spectrum · 3 modes",
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.activeKey).toBe(selectionKey(ramanSelection));

    // Re-opening identical Raman result reuses tab and updates label if desired
    state = openWorkspaceTab(state, {
      selection: ramanSelection,
      label: "Raman spectrum · B3LYP/def2-SVP",
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.label).toBe("Raman spectrum · B3LYP/def2-SVP");

    // IR and UV/Vis results remain separate tabs
    state = openWorkspaceTab(state, {
      selection: irSelection,
      label: "IR spectrum",
    });
    state = openWorkspaceTab(state, {
      selection: uvvisSelection,
      label: "UV/Vis spectrum",
    });
    expect(state.tabs).toHaveLength(3);
    expect(state.activeKey).toBe(selectionKey(uvvisSelection));

    // Deduplication across all three spectroscopy types
    const deduped = deduplicateWorkspaceTabs([
      { selection: ramanSelection, label: "Raman 1" },
      { selection: irSelection, label: "IR 1" },
      { selection: uvvisSelection, label: "UV/Vis 1" },
      { selection: ramanSelection, label: "Raman duplicate" },
    ]);
    expect(deduped).toHaveLength(3);
    expect(deduped.map((t) => t.selection.id)).toEqual([ramanResultId, irResultId, uvvisResultId]);
  });

  it("enforces cross-project isolation between different projects", () => {
    expect(validSelection(ramanSelection, projectIdA)).toBe(true);
    expect(validSelection(ramanSelection, projectIdB)).toBe(false);

    const ramanProjectB = {
      kind: "calculationResult" as const,
      id: ramanResultId,
      projectId: projectIdB,
      sourceId: "e22d9ea8-f66d-4a48-a872-859d4cb1d0f2",
    };
    expect(validSelection(ramanProjectB, projectIdB)).toBe(true);
    expect(validSelection(ramanProjectB, projectIdA)).toBe(false);
  });

  it("auto-expands Raman shift domain to include high-frequency modes without clipping", () => {
    const range = deriveRamanDisplayRange(waterRamanSticks);
    expect(range.wavenumberMin).toBe(0);
    // Water Mode 3 is at 4020.20 cm^-1, so the plot must auto-expand past 4000
    expect(range.wavenumberMax).toBeGreaterThanOrEqual(4100);
    expect(range.wavenumberMax).toBeLessThanOrEqual(4300);
    expect(waterRamanSticks[2]!.frequencyCm1).toBeLessThan(range.wavenumberMax);
  });

  it("produces deterministic ascending Raman spectrum with intrinsic activity", () => {
    const spectrum = deriveBroadenedRamanSpectrum(waterRamanSticks, {
      fwhmCm1: 15.0,
      stepCm1: 2.0,
    });
    expect(spectrum.algorithm).toBe("Lorentzian");
    expect(spectrum.fwhmCm1).toBe(15.0);
    expect(spectrum.curve.length).toBeGreaterThan(100);

    // Verify ascending order: first point is 0 cm^-1, last is >= 4100 cm^-1
    expect(spectrum.curve[0]!.wavenumberCm1).toBe(0);
    expect(spectrum.curve[spectrum.curve.length - 1]!.wavenumberCm1).toBeGreaterThanOrEqual(4100);

    // Find peak centers near 1595.7, 3913.6, and 4020.2
    const peak1 = spectrum.curve.find((p) => Math.abs(p.wavenumberCm1 - 1595.70) <= 2.0);
    const peak2 = spectrum.curve.find((p) => Math.abs(p.wavenumberCm1 - 3913.62) <= 2.0);
    const peak3 = spectrum.curve.find((p) => Math.abs(p.wavenumberCm1 - 4020.20) <= 2.0);

    expect(peak1).toBeDefined();
    expect(peak2).toBeDefined();
    expect(peak3).toBeDefined();

    // Mode 2 is strongest in Raman
    expect(peak2!.activity).toBeGreaterThan(peak1!.activity);
    expect(peak2!.activity).toBeGreaterThan(peak3!.activity);
  });

  it("changing laser wavelength changes derived relative intensities without mutating authoritative activities", () => {
    const intensities532 = calculateDerivedRamanIntensities(waterRamanSticks, 532.0, 298.15);
    const intensities785 = calculateDerivedRamanIntensities(waterRamanSticks, 785.0, 298.15);

    // Authoritative activities in sticks remain bitwise identical
    expect(waterRamanSticks[0]!.ramanActivity).toBe(6.3840);
    expect(waterRamanSticks[1]!.ramanActivity).toBe(74.4214);
    expect(waterRamanSticks[2]!.ramanActivity).toBe(34.7163);

    // Both derived sets normalize strongest peak (Mode 2) to 1.0 (100%)
    expect(intensities532.get(1)).toBeCloseTo(1.0, 4);
    expect(intensities785.get(1)).toBeCloseTo(1.0, 4);

    // Stokes factor (nu_L - nu_k)^4 ratio differs between 532 nm and 785 nm
    // so relative ratios between low-frequency Mode 1 and high-frequency Mode 2 change deterministically
    const ratio532 = (intensities532.get(0) ?? 0) / (intensities532.get(1) ?? 1);
    const ratio785 = (intensities785.get(0) ?? 0) / (intensities785.get(1) ?? 1);
    expect(ratio532).not.toEqual(ratio785);
    expect(Number.isFinite(ratio532)).toBe(true);
    expect(Number.isFinite(ratio785)).toBe(true);
  });

  it("handles unphysical Stokes frequencies safely when mode exceeds laser frequency", () => {
    // Laser at 5000 nm -> nu_L = 2000 cm^-1
    // High-frequency mode at 3913.62 cm^-1 exceeds 2000 cm^-1
    const factorUnphysical = calculateStokesFactor(3913.62, 5000.0, 298.15);
    expect(factorUnphysical).toBe(0);

    const normalFactor = calculateStokesFactor(1595.70, 532.0, 298.15);
    expect(normalFactor).toBeGreaterThan(0);
  });
});
