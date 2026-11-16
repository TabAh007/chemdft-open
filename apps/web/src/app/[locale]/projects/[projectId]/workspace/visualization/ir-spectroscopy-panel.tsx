"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalculationResult, StructureVersionDetail, VibrationalAnalysis, VibrationalMode } from "@chemdft/schemas";
import { listStructures, listStructureVersions } from "@/lib/structure-workspace-api";
import { compactStructureTitle } from "@/lib/structure-workbench";
import { ARROW_SCALE_NOTE, DEFAULT_VISUAL_EXAGGERATION, modeDisplacementArrows, vibrationalFrameDetail, visualDisplacementAngstrom } from "@/lib/vibrational-mode";
import {
  DEFAULT_IR_FWHM_CM1,
  MAX_IR_FWHM_CM1,
  MIN_IR_FWHM_CM1,
  deriveBroadenedIrSpectrum,
  deriveIrDisplayRange,
  type SpectrumStickIR,
} from "@/lib/spectrum";
import { spectraViewerCaption } from "@/app/_components/viewer-toolbar";
import { ScientificVisualizationPanel } from "./scientific-visualization-panel";
import { NormalModeSummary, SpectroscopyHeader } from "./spectroscopy-shell";
import { VibrationalSpectrumChart } from "./vibrational-spectrum-chart";

export interface IrSpectroscopyPanelProps {
  projectId: string;
  calculationId?: string | undefined;
  resultId: string;
  result: CalculationResult | VibrationalAnalysis;
  active?: boolean | undefined;
  structureName?: string | undefined;
  initialSelectedMode?: number | null | undefined;
  onModeSelected?: ((modeIndex: number | null) => void) | undefined;
  onSwitchToAdvanced?: (() => void) | undefined;
}

export function IrSpectroscopyPanel({
  projectId,
  calculationId,
  resultId,
  result,
  active = true,
  structureName,
  initialSelectedMode,
  onModeSelected,
  onSwitchToAdvanced,
}: IrSpectroscopyPanelProps) {
  const analysis: VibrationalAnalysis = "payload" in result ? (result.payload as VibrationalAnalysis) : result;
  const storageKey = `chemdft:ir:${projectId}:${resultId}`;

  const [source, setSource] = useState<StructureVersionDetail | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // Canonical selected mode state (synchronized across spectrum, table, 3D viewer, and AI Scientist)
  const [selectedModeIndex, setSelectedModeIndex] = useState<number>(() => {
    if (typeof initialSelectedMode === "number" && initialSelectedMode >= 0 && initialSelectedMode < analysis.modes.length) {
      return initialSelectedMode;
    }
    // Default to the strongest IR active mode if available
    let maxIdx = 0;
    let maxInt = -1;
    analysis.modes.forEach((mode, idx) => {
      const val = typeof mode.ir_intensity === "object" && mode.ir_intensity !== null && "value" in mode.ir_intensity
        ? Number(mode.ir_intensity.value)
        : Number(mode.ir_intensity ?? 0);
      if (val > maxInt) {
        maxInt = val;
        maxIdx = idx;
      }
    });
    return maxIdx;
  });

  const [prevInitialMode, setPrevInitialMode] = useState(initialSelectedMode);
  if (initialSelectedMode !== prevInitialMode) {
    setPrevInitialMode(initialSelectedMode);
    if (typeof initialSelectedMode === "number" && initialSelectedMode >= 0 && initialSelectedMode < analysis.modes.length) {
      setSelectedModeIndex(initialSelectedMode);
    }
  }

  const [fwhmCm1, setFwhmCm1] = useState<number>(DEFAULT_IR_FWHM_CM1);
  const [axisInverted, setAxisInverted] = useState<boolean>(true); // Conventional 4000 -> 400 cm^-1
  const [exaggeration, setExaggeration] = useState<number>(DEFAULT_VISUAL_EXAGGERATION); // display only
  const [showArrows, setShowArrows] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [phase, setPhase] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false); // Nothing autoplays on page load; Play or selecting a mode starts the animation
  const [cameraKey, setCameraKey] = useState<number>(0);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  const handleSelectMode = useCallback((idx: number) => {
    setSelectedModeIndex(idx);
    onModeSelected?.(idx);
    setPhase(0);
    setPlaying(true);
  }, [onModeSelected]);

  // Synchronize active mode with parent listener on mount and mode changes
  useEffect(() => {
    onModeSelected?.(selectedModeIndex);
  }, [selectedModeIndex, onModeSelected]);

  // Load input StructureVersion
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const structures = await listStructures(projectId);
        const versions = await Promise.all(structures.map((item) => listStructureVersions(projectId, item.id)));
        const found = versions.flat().find((item) => item.version.id === analysis.input_structure_version_id);
        if (!found) throw new Error("The authoritative input StructureVersion is unavailable.");
        if (alive) setSource(found);
      } catch (err: unknown) {
        if (alive) setSourceError(err instanceof Error ? err.message : "Input structure could not be loaded.");
      }
    })();
    return () => { alive = false; };
  }, [analysis.input_structure_version_id, projectId]);

  // Animation frame loop
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setPhase((prev) => prev + 0.16 * speed);
    }, 1000 / 24);
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  const selectedMode: VibrationalMode | undefined = analysis.modes[selectedModeIndex];

  // 3D animation frame detail
  const frame = useMemo(() => {
    if (!source || !selectedMode) return null;
    return vibrationalFrameDetail(source, analysis, selectedModeIndex, phase, visualDisplacementAngstrom(exaggeration));
  }, [source, analysis, selectedModeIndex, phase, exaggeration, selectedMode]);

  // Equilibrium geometry (zero displacement) fixes the visual bond connectivity during animation
  const equilibriumFrame = useMemo(() => {
    if (!source) return null;
    return vibrationalFrameDetail(source, analysis, 0, 0, 0);
  }, [source, analysis]);

  // Authoritative discrete sticks from engine result
  const sticks: SpectrumStickIR[] = useMemo(() => {
    return analysis.modes.map((mode, idx) => {
      const rawIntensity = mode.ir_intensity;
      const intensityKmPerMol = typeof rawIntensity === "object" && rawIntensity !== null && "value" in rawIntensity
        ? Number(rawIntensity.value)
        : Number(rawIntensity ?? 0);
      return {
        modeIndex: mode.index ?? idx,
        frequencyCm1: mode.frequency_cm1,
        irIntensityKmPerMol: Number.isFinite(intensityKmPerMol) ? intensityKmPerMol : 0,
        reducedMassAmu: mode.reduced_mass_amu,
        imaginary: Boolean(mode.imaginary),
      };
    });
  }, [analysis.modes]);

  // Derived broadened Lorentzian curve (deterministic in wavenumber space, auto-expanding domain)
  const broadened = useMemo(() => {
    const range = deriveIrDisplayRange(sticks);
    return deriveBroadenedIrSpectrum(sticks, {
      fwhmCm1,
      inverted: axisInverted,
      wavenumberMin: range.wavenumberMin,
      wavenumberMax: range.wavenumberMax,
      stepCm1: 2.0,
    });
  }, [sticks, fwhmCm1, axisInverted]);

  const structPrefix = structureName || (source
    ? compactStructureTitle(source.structure.name, source.version.revision)
    : "Water V1");

  // Broadcast current view selection for AI Scientist context
  useEffect(() => {
    if (!active) return;
    const viewLabel = selectedMode
      ? `${structPrefix} → IR → Mode ${selectedMode.index + 1} · ${selectedMode.frequency_cm1.toFixed(1)} cm⁻¹`
      : `${structPrefix} → IR spectrum`;

    window.dispatchEvent(
      new CustomEvent("chemdft:workspace-selection", {
        detail: {
          projectId,
          calculationId: calculationId ?? "",
          resultId,
          structureName: source?.structure.name,
          structureVersionRevision: source?.version.revision,
          currentView: viewLabel,
          selectedModeIndex,
          selectedModeFrequency: selectedMode?.frequency_cm1,
          selectedModeIntensity: typeof selectedMode?.ir_intensity === "object" && selectedMode?.ir_intensity !== null && "value" in selectedMode?.ir_intensity
            ? selectedMode.ir_intensity.value
            : selectedMode?.ir_intensity,
        },
      }),
    );
  }, [active, calculationId, projectId, resultId, selectedMode, selectedModeIndex, source, structPrefix]);

  const hasImaginary = analysis.modes.some((m) => m.imaginary);

  const wMin = broadened.wavenumberMin;
  const wMax = broadened.wavenumberMax;

  const chartSticks = useMemo(
    () =>
      sticks.map((stick) => ({
        modeIndex: stick.modeIndex,
        frequencyCm1: stick.frequencyCm1,
        value: stick.irIntensityKmPerMol,
        valueLabel: `${stick.irIntensityKmPerMol.toFixed(2)} km/mol`,
        imaginary: stick.imaginary,
      })),
    [sticks],
  );
  const chartCurve = useMemo(() => {
    const maxCurve = Math.max(1e-6, broadened.maxIntensity);
    return broadened.curve.map((pt) => ({ x: pt.wavenumberCm1, y: pt.intensity / maxCurve }));
  }, [broadened.curve, broadened.maxIntensity]);

  const showDetails = useCallback(() => {
    setDetailsOpen(true);
    window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
  }, []);

  if (sourceError) {
    return (
      <section className="workspace-calculation-summary">
        <p role="alert">{sourceError}</p>
      </section>
    );
  }

  const intensityOf = (mode: VibrationalMode | undefined): number | null => {
    if (!mode || mode.ir_intensity === undefined || mode.ir_intensity === null) return null;
    const raw = mode.ir_intensity;
    return typeof raw === "object" && "value" in raw ? Number(raw.value) : Number(raw);
  };
  const selectedIntensity = intensityOf(selectedMode);

  return (
    <div className="vibrational-analysis ir-spectroscopy-view spectro-workspace" data-testid="ir-spectroscopy-panel">
      <SpectroscopyHeader
        testIdPrefix="ir"
        statusLabel=""
        title="IR Spectroscopy"
        subtitle={`${analysis.method.toUpperCase()} / ${analysis.basis} · PySCF ${analysis.engine_version ?? "2.14.0"}`}
        summary={`${analysis.modes.length} vibrational modes`}
        warning={hasImaginary ? "Imaginary modes present" : undefined}
        onDetails={showDetails}
        onSwitchToAdvanced={onSwitchToAdvanced}
      />

      {hasImaginary ? (
        <div className="vibrational-warning" role="alert">
          <strong>Scientific Warning:</strong> One or more modes have imaginary frequencies (indicated in orange). This structure is a saddle point or non-minimum on the potential energy surface.
        </div>
      ) : null}

      <section className="spectro-spectrum" aria-label="IR spectrum">
        <div className="spectro-spectrum-head">
          <h3>IR Spectrum</h3>
          <div className="spectro-spectrum-controls">
            <button
              type="button"
              className="spectro-link-btn"
              onClick={() => setAxisInverted((inv) => !inv)}
              title={`Toggle conventional inverted IR axis (${wMax} → ${wMin} cm⁻¹)`}
            >
              Axis: {axisInverted ? "high → low (conventional)" : "low → high"}
            </button>
            <details className="spectro-settings">
              <summary>Spectrum settings</summary>
              <div className="spectro-settings-body">
                <label title="Lorentzian line broadening full-width at half-maximum">
                  <span>Line width (FWHM)</span>
                  <input
                    aria-label="Line broadening FWHM"
                    type="range"
                    min={MIN_IR_FWHM_CM1}
                    max={MAX_IR_FWHM_CM1}
                    step="1"
                    value={fwhmCm1}
                    onChange={(e) => setFwhmCm1(Number(e.currentTarget.value))}
                  />
                  <output>{fwhmCm1.toFixed(0)} cm⁻¹</output>
                </label>
              </div>
            </details>
          </div>
        </div>
        <p className="spectro-caption">
          Sticks are the calculated integrated IR intensities (km/mol); the curve is a Lorentzian broadening for display.
        </p>

        <VibrationalSpectrumChart
          sticks={chartSticks}
          curve={chartCurve}
          wMin={wMin}
          wMax={wMax}
          inverted={axisInverted}
          xLabel="Wavenumber (cm⁻¹)"
          yLabel="IR intensity (km/mol)"
          selectedIndex={selectedModeIndex}
          onSelect={handleSelectMode}
          testIdPrefix="ir"
          ariaLabel="Calculated Infrared Spectrum"
          description="Calculated IR spectrum plotting integrated molar IR intensity in km/mol and Lorentzian broadened profile against wavenumber in inverse centimeters."
        />
      </section>

      <div className="spectro-primary">
        <div className="spectro-viewer">
          {frame ? (
            <ScientificVisualizationPanel
              key={cameraKey}
              arrows={showArrows ? modeDisplacementArrows(frame, selectedMode) : undefined}
              compact
              detail={frame}
              visualBondsReference={equilibriumFrame}
              selectedAtomIndex={null}
              measurementKind="none"
              measurementAtomIndices={[]}
              onSelectAtom={() => undefined}
              onMeasurementKindChange={() => undefined}
              onSceneReady={() => undefined}
              persistenceKey={`${storageKey}:3d`}
            />
          ) : (
            <div className="spectro-viewer-loading">Loading normal-mode 3D animation…</div>
          )}
          <div className="spectro-viewer-bar">
            <p className="viewer-caption-shared spectro-viewer-caption" data-testid="spectra-viewer-caption" style={{ flex: "1 1 100%", margin: 0 }}>{spectraViewerCaption(selectedModeIndex + 1)}</p>
            <label className="spectro-arrows" title={ARROW_SCALE_NOTE}>
            <input type="checkbox" aria-label="Show displacement arrows" checked={showArrows} onChange={(event) => setShowArrows(event.currentTarget.checked)} /> Displacement arrows{showArrows ? " (scaled for display)" : ""}
          </label>
            <div className="spectro-viewer-label" aria-live="off">
            <span className={`spectro-live-dot${playing ? " is-playing" : ""}`} aria-hidden="true" />
            Mode {selectedModeIndex + 1}
            {selectedMode ? ` · ${selectedMode.frequency_cm1.toFixed(1)} cm⁻¹` : ""}
            <span className="spectro-viewer-state">{playing ? "animating" : "paused"}</span>
          </div>
          </div>
        </div>

        {selectedMode ? (
          <NormalModeSummary
            testIdPrefix="ir"
            modeNumber={selectedModeIndex + 1}
            modeCount={analysis.modes.length}
            onPrev={() => handleSelectMode((selectedModeIndex - 1 + analysis.modes.length) % analysis.modes.length)}
            onNext={() => handleSelectMode((selectedModeIndex + 1) % analysis.modes.length)}
            onReset={() => { setPlaying(false); setPhase(0); setCameraKey((k) => k + 1); }}
            playing={playing}
            onTogglePlay={() => setPlaying((val) => !val)}
            exaggeration={exaggeration}
            onExaggeration={setExaggeration}
            speed={speed}
            onSpeed={setSpeed}
            rows={[
              { label: "Frequency", value: `${selectedMode.frequency_cm1.toFixed(1)} cm⁻¹` },
              { label: "IR intensity", value: selectedIntensity === null ? "—" : `${selectedIntensity.toFixed(2)} km/mol`, accent: true },
              { label: "Reduced mass", value: selectedMode.reduced_mass_amu ? `${selectedMode.reduced_mass_amu.toFixed(4)} amu` : "—" },
              { label: "Classification", value: selectedMode.imaginary ? <strong className="is-warn">Imaginary</strong> : "Harmonic real" },
            ]}
          />
        ) : null}
      </div>

      <section className="spectro-table-wrap" aria-label="Vibrational modes">
        <h3 className="spectro-table-title">Vibrational Modes ({analysis.modes.length})</h3>
        <table className="spectro-table">
          <thead>
            <tr>
              <th>Mode</th>
              <th>Frequency (cm⁻¹)</th>
              <th>IR intensity (km/mol)</th>
              <th>Reduced mass (amu)</th>
              <th>Animation</th>
            </tr>
          </thead>
          <tbody>
            {analysis.modes.map((mode, index) => {
              const isSelected = index === selectedModeIndex;
              const intensityVal = intensityOf(mode);
              return (
                <tr
                  key={mode.index}
                  data-testid={`mode-row-${mode.index + 1}`}
                  aria-selected={isSelected}
                  onClick={() => handleSelectMode(index)}
                >
                  <td>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleSelectMode(index); }}
                      aria-current={isSelected ? "true" : undefined}
                    >
                      {isSelected ? "● " : ""}Mode {mode.index + 1}
                    </button>
                  </td>
                  <td>{mode.imaginary ? `−${Math.abs(mode.frequency_cm1).toFixed(1)}i` : mode.frequency_cm1.toFixed(1)}</td>
                  <td className="is-accent">{intensityVal !== null && Number.isFinite(intensityVal) ? intensityVal.toFixed(2) : "—"}</td>
                  <td>{mode.reduced_mass_amu ? mode.reduced_mass_amu.toFixed(4) : "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="spectro-row-play"
                      aria-label={`Animate mode ${mode.index + 1}`}
                      onClick={(e) => { e.stopPropagation(); handleSelectMode(index); }}
                    >
                      ▶
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Provenance Details: engine and finite-difference settings live here, not in the primary view */}
      <details ref={detailsRef} open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
        <summary>Calculation & Spectroscopy Provenance</summary>
        <dl>
          <div>
            <dt>Quantum Engine</dt>
            <dd>PySCF {analysis.engine_version ?? "2.14.0"}</dd>
          </div>
          <div>
            <dt>Method / Basis</dt>
            <dd>{analysis.method.toUpperCase()} / {analysis.basis}</dd>
          </div>
          <div>
            <dt>Hessian Type</dt>
            <dd>{analysis.hessian_type ?? "analytic"}</dd>
          </div>
          <div>
            <dt>Dipole Derivative</dt>
            <dd>{analysis.dipole_derivative_method ?? "central_finite_difference"} (step: {analysis.finite_difference_step_bohr ?? 0.0100} bohr)</dd>
          </div>
          <div>
            <dt>Intensity Unit</dt>
            <dd>{analysis.intensity_unit ?? "km/mol"}</dd>
          </div>
          <div>
            <dt>Spectrum Broadening</dt>
            <dd>Derived visualization (Lorentzian, FWHM: {fwhmCm1.toFixed(1)} cm⁻¹)</dd>
          </div>
          <div>
            <dt>Input StructureVersion</dt>
            <dd>{analysis.input_structure_version_id}</dd>
          </div>
          <div>
            <dt>Immutable Result SHA-256</dt>
            <dd>{analysis.result_sha256}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
