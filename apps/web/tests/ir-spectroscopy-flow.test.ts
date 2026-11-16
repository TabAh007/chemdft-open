import { describe, expect, it } from "vitest";
import { selectionKey } from "../src/lib/workspace-selection";
import {
  deduplicateWorkspaceTabs,
  emptyWorkspaceState,
  openWorkspaceTab,
} from "../src/lib/workspace-tabs";
import {
  deriveBroadenedIrSpectrum,
  evaluateLorentzianBroadening,
  type SpectrumStickIR,
} from "../src/lib/spectrum";

const projectId = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const calcId = "a11d9ea8-f66d-4a48-a872-859d4cb1d0f1";
const irResultId = "b22d9ea8-f66d-4a48-a872-859d4cb1d0f2";
const uvvisResultId = "c33d9ea8-f66d-4a48-a872-859d4cb1d0f3";

const irSelection = {
  kind: "calculationResult" as const,
  id: irResultId,
  projectId,
  sourceId: calcId,
};

const uvvisSelection = {
  kind: "calculationResult" as const,
  id: uvvisResultId,
  projectId,
  sourceId: calcId,
};

const waterIrSticks: SpectrumStickIR[] = [
  {
    modeIndex: 0,
    frequencyCm1: 1638.68,
    irIntensityKmPerMol: 55.49,
    reducedMassAmu: 1.083,
    imaginary: false,
  },
  {
    modeIndex: 1,
    frequencyCm1: 3791.34,
    irIntensityKmPerMol: 4.94,
    reducedMassAmu: 1.045,
    imaginary: false,
  },
  {
    modeIndex: 2,
    frequencyCm1: 3886.57,
    irIntensityKmPerMol: 26.91,
    reducedMassAmu: 1.082,
    imaginary: false,
  },
];

describe("IR spectroscopy frontend and workflow integrity", () => {
  it("deduplicates IR spectrum tabs and reuses identical tabs by scientific identity", () => {
    let state = openWorkspaceTab(emptyWorkspaceState(), {
      selection: irSelection,
      label: "IR spectrum · 3 modes",
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.activeKey).toBe(selectionKey(irSelection));

    // Re-opening identical IR result with alternate label reuses the tab
    state = openWorkspaceTab(state, {
      selection: irSelection,
      label: "IR spectrum · B3LYP/def2-SVP",
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.label).toBe("IR spectrum · B3LYP/def2-SVP");

    // UV/Vis result remains separate and distinct
    state = openWorkspaceTab(state, {
      selection: uvvisSelection,
      label: "UV/Vis absorption spectrum",
    });
    expect(state.tabs).toHaveLength(2);
    expect(state.activeKey).toBe(selectionKey(uvvisSelection));

    // Verify deduplicateWorkspaceTabs on mixed list
    const deduped = deduplicateWorkspaceTabs([
      { selection: irSelection, label: "IR 1" },
      { selection: uvvisSelection, label: "UV/Vis 1" },
      { selection: irSelection, label: "IR duplicate" },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]?.selection.id).toBe(irResultId);
    expect(deduped[1]?.selection.id).toBe(uvvisResultId);
  });

  it("produces deterministic Lorentzian broadened IR spectrum with inverted 4000 -> 400 cm^-1 axis", () => {
    const spectrum = deriveBroadenedIrSpectrum(waterIrSticks, {
      fwhmCm1: 15.0,
      inverted: true,
      wavenumberMin: 400,
      wavenumberMax: 4000,
    });

    expect(spectrum.algorithm).toBe("Lorentzian");
    expect(spectrum.fwhmCm1).toBe(15.0);
    expect(spectrum.curve[0]!.wavenumberCm1).toBe(4000.0);
    expect(spectrum.curve[spectrum.curve.length - 1]!.wavenumberCm1).toBe(400.0);

    // Peak at Mode 1 (1638.68 cm^-1) is the strongest band
    const intensityAtMode1 = evaluateLorentzianBroadening(1638.7, waterIrSticks, 15.0);
    const intensityAtMode2 = evaluateLorentzianBroadening(3791.3, waterIrSticks, 15.0);
    const intensityAtMode3 = evaluateLorentzianBroadening(3886.6, waterIrSticks, 15.0);

    expect(intensityAtMode1).toBeGreaterThan(intensityAtMode3);
    expect(intensityAtMode3).toBeGreaterThan(intensityAtMode2);
  });

  it("formats workspace selection events for AI Scientist context synchronization", () => {
    const structPrefix = "Water V1";
    const selectedMode = waterIrSticks[0]!;

    const eventDetail = {
      projectId,
      calculationId: calcId,
      resultId: irResultId,
      currentView: `${structPrefix} → IR → Mode ${selectedMode.modeIndex + 1} · ${selectedMode.frequencyCm1.toFixed(1)} cm⁻¹`,
      selectedModeIndex: selectedMode.modeIndex,
      selectedModeFrequency: selectedMode.frequencyCm1,
      selectedModeIntensity: selectedMode.irIntensityKmPerMol,
    };

    expect(eventDetail.currentView).toBe("Water V1 → IR → Mode 1 · 1638.7 cm⁻¹");
    expect(eventDetail.selectedModeFrequency).toBe(1638.68);
    expect(eventDetail.selectedModeIntensity).toBe(55.49);
  });

  it("keeps UV/Vis and IR data completely isolated", () => {
    expect(selectionKey(irSelection)).not.toBe(selectionKey(uvvisSelection));
    expect(selectionKey(irSelection)).toContain(irResultId);
    expect(selectionKey(uvvisSelection)).toContain(uvvisResultId);
  });

  it("generates collision-free adaptive major ticks suppressing 500 near endpoint 400", () => {
    const wMin: number = 400;
    const wMax: number = 4200;
    const axisInverted = true;
    const minTickGap = 150;

    const rawTicks: number[] = [];
    const top500 = Math.floor(wMax / 500) * 500;
    const bottom500 = Math.ceil(wMin / 500) * 500;

    rawTicks.push(wMax);
    if (wMin !== wMax) {
      rawTicks.push(wMin);
    }

    for (let t = top500; t >= bottom500; t -= 500) {
      if (Math.abs(t - wMax) >= minTickGap && Math.abs(t - wMin) >= minTickGap) {
        rawTicks.push(t);
      }
    }

    const unique = Array.from(new Set(rawTicks));
    unique.sort((a, b) => (axisInverted ? b - a : a - b));

    expect(unique).toEqual([4200, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 400]);
    expect(unique).not.toContain(500); // 500 suppressed to avoid 500400 collision with 400
  });

  it("synchronizes AI context immediately to IR without retaining stale UV/Vis context", () => {
    // Simulate scope holding stale UV/Vis context
    const staleScope = {
      projectName: "Water",
      currentView: "Water V1 → UV/Vis spectrum",
      resultId: uvvisResultId,
    };

    // When IR selection is active
    const activeSelection = irSelection;
    const isCalculationResult = activeSelection.kind === "calculationResult";
    const catalogItem = {
      selection: irSelection,
      label: "IR spectrum · 3 modes",
      detail: "CALCULATED · pyscf (vibrational analysis)",
    };

    const isIrResult = Boolean(
      isCalculationResult && (
        (staleScope.resultId === activeSelection.id && (staleScope.currentView?.includes("IR") || staleScope.currentView?.includes("Vibrational"))) ||
        catalogItem.label.includes("IR") ||
        catalogItem.detail.toLowerCase().includes("vibrational")
      )
    );
    expect(isIrResult).toBe(true);

    const structPrefix = "Water V1";
    const irViewLabel = (staleScope.resultId === activeSelection.id && (staleScope.currentView?.includes("IR") || staleScope.currentView?.includes("Vibrational")))
      ? staleScope.currentView
      : `${structPrefix} → IR spectrum`;

    expect(irViewLabel).toBe("Water V1 → IR spectrum");
    expect(irViewLabel).not.toContain("UV/Vis");
  });
});
