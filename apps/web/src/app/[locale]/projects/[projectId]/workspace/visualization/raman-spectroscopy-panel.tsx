"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalculationResult, StructureVersionDetail, VibrationalAnalysis, VibrationalMode } from "@chemdft/schemas";
import { listStructures, listStructureVersions } from "@/lib/structure-workspace-api";
import { compactStructureTitle } from "@/lib/structure-workbench";
import { ARROW_SCALE_NOTE, DEFAULT_VISUAL_EXAGGERATION, modeDisplacementArrows, vibrationalFrameDetail, visualDisplacementAngstrom } from "@/lib/vibrational-mode";
import {
  DEFAULT_RAMAN_FWHM_CM1,
  DEFAULT_RAMAN_LASER_NM,
  DEFAULT_RAMAN_TEMPERATURE_K,
  MAX_RAMAN_FWHM_CM1,
  MIN_RAMAN_FWHM_CM1,
  RAMAN_LASER_PRESETS_NM,
  calculateDerivedRamanIntensities,
  deriveBroadenedRamanSpectrum,
  deriveRamanDisplayRange,
  type SpectrumStickRaman,
} from "@/lib/spectrum";
import { spectraViewerCaption } from "@/app/_components/viewer-toolbar";
import { ScientificVisualizationPanel } from "./scientific-visualization-panel";
import { NormalModeSummary, SegmentedToggle, SpectroscopyHeader } from "./spectroscopy-shell";
import { VibrationalSpectrumChart } from "./vibrational-spectrum-chart";

export interface RamanSpectroscopyPanelProps {
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

export function RamanSpectroscopyPanel({
  projectId,
  calculationId,
  resultId,
  result,
  active = true,
  structureName,
  initialSelectedMode,
  onModeSelected,
  onSwitchToAdvanced,
}: RamanSpectroscopyPanelProps) {
  const analysis: VibrationalAnalysis = "payload" in result ? (result.payload as VibrationalAnalysis) : result;
  const storageKey = `chemdft:raman:${projectId}:${resultId}`;

  const [source, setSource] = useState<StructureVersionDetail | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // Default to the mode with highest Raman activity if available
  const [selectedModeIndex, setSelectedModeIndex] = useState<number>(() => {
    if (typeof initialSelectedMode === "number" && initialSelectedMode >= 0 && initialSelectedMode < analysis.modes.length) {
      return initialSelectedMode;
    }
    let maxIdx = 0;
    let maxAct = -1;
    analysis.modes.forEach((mode, idx) => {
      const val = typeof mode.raman_activity === "object" && mode.raman_activity !== null && "value" in mode.raman_activity
        ? Number(mode.raman_activity.value)
        : Number(mode.raman_activity ?? 0);
      if (val > maxAct) {
        maxAct = val;
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

  // Display mode: Intrinsic Activity (primary) vs Derived Relative Intensity
  const [displayQuantity, setDisplayQuantity] = useState<"activity" | "intensity">("activity");
  const [laserWavelengthNm, setLaserWavelengthNm] = useState<number>(DEFAULT_RAMAN_LASER_NM);
  const [temperatureK, setTemperatureK] = useState<number>(DEFAULT_RAMAN_TEMPERATURE_K);
  const [fwhmCm1, setFwhmCm1] = useState<number>(DEFAULT_RAMAN_FWHM_CM1);

  // Visualization settings for 3D animation
  const [exaggeration, setExaggeration] = useState<number>(DEFAULT_VISUAL_EXAGGERATION); // display only
  const [showArrows, setShowArrows] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [phase, setPhase] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false); // Nothing autoplays on page load
  const [cameraKey, setCameraKey] = useState<number>(0);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  const handleSelectMode = useCallback((idx: number) => {
    setSelectedModeIndex(idx);
    onModeSelected?.(idx);
    setPhase(0);
    setPlaying(true);
  }, [onModeSelected]);

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
  const sticks: SpectrumStickRaman[] = useMemo(() => {
    return analysis.modes.map((mode, idx) => {
      const rawActivity = mode.raman_activity;
      const activityVal = typeof rawActivity === "object" && rawActivity !== null && "value" in rawActivity
        ? Number(rawActivity.value)
        : Number(rawActivity ?? 0);
      const depolVal = mode.depolarization_ratio !== undefined && mode.depolarization_ratio !== null
        ? Number(mode.depolarization_ratio)
        : null;

      return {
        modeIndex: mode.index ?? idx,
        frequencyCm1: mode.frequency_cm1,
        ramanActivity: Number.isFinite(activityVal) ? activityVal : 0,
        depolarizationRatio: depolVal,
        reducedMassAmu: typeof mode.reduced_mass_amu === "number" ? mode.reduced_mass_amu : null,
        imaginary: Boolean(mode.imaginary),
      };
    });
  }, [analysis.modes]);

  // Derived relative intensities for sticks
  const derivedIntensities = useMemo(() => {
    return calculateDerivedRamanIntensities(sticks, laserWavelengthNm, temperatureK);
  }, [sticks, laserWavelengthNm, temperatureK]);

  // Broadened Raman spectrum (ascending Raman shift, auto-expanding domain)
  const broadened = useMemo(() => {
    const range = deriveRamanDisplayRange(sticks);
    return deriveBroadenedRamanSpectrum(sticks, {
      fwhmCm1,
      laserWavelengthNm,
      temperatureK,
      wavenumberMin: range.wavenumberMin,
      wavenumberMax: range.wavenumberMax,
      stepCm1: 2.0,
    });
  }, [sticks, fwhmCm1, laserWavelengthNm, temperatureK]);

  const structPrefix = structureName || (source
    ? compactStructureTitle(source.structure.name, source.version.revision)
    : "Water V1");

  // Broadcast current view selection for AI Scientist context
  useEffect(() => {
    if (!active) return;
    const viewLabel = selectedMode
      ? `${structPrefix} → Raman → Mode ${selectedMode.index + 1} · ${selectedMode.frequency_cm1.toFixed(1)} cm⁻¹`
      : `${structPrefix} → Raman spectrum`;

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
          selectedModeActivity: typeof selectedMode?.raman_activity === "object" && selectedMode?.raman_activity !== null && "value" in selectedMode?.raman_activity
            ? selectedMode.raman_activity.value
            : selectedMode?.raman_activity,
          selectedModeDepolarization: selectedMode?.depolarization_ratio,
        },
      }),
    );
  }, [active, calculationId, projectId, resultId, selectedMode, selectedModeIndex, source, structPrefix]);

  const hasImaginary = analysis.modes.some((m) => m.imaginary);
  const isIntensity = displayQuantity === "intensity";

  const wMin = broadened.wavenumberMin;
  const wMax = broadened.wavenumberMax;

  // Chart inputs: sticks carry the displayed quantity; the curve is the
  // deterministic broadened profile normalised to its own maximum.
  const chartSticks = useMemo(
    () =>
      broadened.sticks.map((stick) => {
        const relative = derivedIntensities.get(stick.modeIndex) ?? 0;
        return {
          modeIndex: stick.modeIndex,
          frequencyCm1: stick.frequencyCm1,
          value: isIntensity ? relative * 100 : stick.ramanActivity,
          valueLabel: isIntensity ? `${(relative * 100).toFixed(1)}%` : stick.ramanActivity.toFixed(4),
          imaginary: stick.imaginary,
        };
      }),
    [broadened.sticks, derivedIntensities, isIntensity],
  );
  const chartCurve = useMemo(() => {
    // Curve relativeIntensity is already normalised to 0..1 by the broadening routine;
    // activity is raw and needs normalising against its own maximum.
    const maxActivity = Math.max(1e-6, broadened.maxActivity);
    return broadened.curve.map((pt) => ({
      x: pt.wavenumberCm1,
      y: isIntensity ? pt.relativeIntensity : pt.activity / maxActivity,
    }));
  }, [broadened.curve, broadened.maxActivity, isIntensity]);

  const activityOf = (mode: VibrationalMode | undefined): number | null => {
    if (!mode || mode.raman_activity === undefined || mode.raman_activity === null) return null;
    const raw = mode.raman_activity;
    return typeof raw === "object" && "value" in raw ? Number(raw.value) : Number(raw);
  };

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

  const selectedActivity = activityOf(selectedMode);
  const relativeHeader = `Relative intensity (${laserWavelengthNm} nm, ${temperatureK} K)`;

  return (
    <div className="vibrational-analysis raman-spectroscopy-view spectro-workspace" data-testid="raman-spectroscopy-panel">
      <SpectroscopyHeader
        testIdPrefix="raman"
        statusLabel=""
        title="Raman Spectroscopy"
        subtitle={`${analysis.method.toUpperCase()} / ${analysis.basis} · PySCF ${analysis.engine_version ?? "2.14.0"}`}
        summary={`${analysis.modes.length} vibrational modes`}
        warning={hasImaginary ? "Imaginary modes present" : undefined}
        onDetails={showDetails}
        onSwitchToAdvanced={onSwitchToAdvanced}
        viewToggle={
          <SegmentedToggle
            label="Raman display quantity"
            value={displayQuantity}
            onChange={setDisplayQuantity}
            options={[
              { value: "activity", label: "Activity (Å⁴/amu)", testId: "raman-view-activity-btn" },
              { value: "intensity", label: "Relative intensity", testId: "raman-view-intensity-btn" },
            ]}
          />
        }
      />

      {hasImaginary ? (
        <div className="vibrational-warning" role="alert">
          <strong>Scientific Warning:</strong> One or more modes have imaginary frequencies (indicated in orange). This structure is a saddle point or non-minimum on the potential energy surface.
        </div>
      ) : null}

      <section className="spectro-spectrum" aria-label="Raman spectrum">
        <div className="spectro-spectrum-head">
          <h3>Raman Spectrum</h3>
          <div className="spectro-spectrum-controls">
            {isIntensity ? (
              <>
                <label className="spectro-inline-field">
                  Laser
                  <select
                    value={laserWavelengthNm}
                    onChange={(e) => setLaserWavelengthNm(Number(e.target.value))}
                    data-testid="raman-laser-select"
                  >
                    {RAMAN_LASER_PRESETS_NM.map((wl: number) => (
                      <option key={wl} value={wl}>{wl} nm</option>
                    ))}
                  </select>
                </label>
                <label className="spectro-inline-field">
                  Temperature
                  <input
                    type="number"
                    value={temperatureK}
                    step="5"
                    min="1"
                    max="1000"
                    onChange={(e) => setTemperatureK(Number(e.target.value))}
                    data-testid="raman-temp-input"
                  />
                  K
                </label>
              </>
            ) : null}
            <details className="spectro-settings">
              <summary>Spectrum settings</summary>
              <div className="spectro-settings-body">
                <label title="Lorentzian line broadening full-width at half-maximum">
                  <span>Line width (FWHM)</span>
                  <input
                    aria-label="Line broadening FWHM"
                    type="range"
                    min={MIN_RAMAN_FWHM_CM1}
                    max={MAX_RAMAN_FWHM_CM1}
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
          {isIntensity
            ? "Relative intensity is a derived display quantity that depends on the laser wavelength and temperature; it does not change the calculated activities."
            : "Activity is the intrinsic calculated Raman property. Sticks are the calculated modes; the curve is a Lorentzian broadening for display."}
        </p>

        <VibrationalSpectrumChart
          sticks={chartSticks}
          curve={chartCurve}
          wMin={wMin}
          wMax={wMax}
          xLabel="Raman shift (cm⁻¹)"
          yLabel={isIntensity ? "Relative Raman intensity (%)" : "Raman activity (Å⁴/amu)"}
          selectedIndex={selectedModeIndex}
          onSelect={handleSelectMode}
          testIdPrefix="raman"
          ariaLabel="Calculated Raman Spectrum"
          description={`Calculated Raman spectrum plotting ${isIntensity ? "derived relative scattering intensity" : "intrinsic Raman activity in Å⁴/amu"} against Raman shift in inverse centimeters.`}
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
            testIdPrefix="raman"
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
              { label: "Raman activity", value: selectedActivity === null ? "—" : `${selectedActivity.toFixed(4)} Å⁴/amu`, accent: true },
              { label: "Depolarization (ρp)", value: selectedMode.depolarization_ratio !== undefined && selectedMode.depolarization_ratio !== null ? Number(selectedMode.depolarization_ratio).toFixed(4) : "—" },
              ...(isIntensity
                ? [{ label: `Relative intensity (${laserWavelengthNm} nm)`, value: `${((derivedIntensities.get(selectedModeIndex) ?? 0) * 100).toFixed(2)}%` }]
                : []),
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
              <th>Raman activity (Å⁴/amu)</th>
              <th>Depolarization (ρp)</th>
              <th>{relativeHeader}</th>
              <th>Animation</th>
            </tr>
          </thead>
          <tbody>
            {broadened.sticks.map((stick) => {
              const isSelected = stick.modeIndex === selectedModeIndex;
              const relative = derivedIntensities.get(stick.modeIndex);
              return (
                <tr
                  key={stick.modeIndex}
                  data-testid={`mode-row-${stick.modeIndex + 1}`}
                  aria-selected={isSelected}
                  onClick={() => handleSelectMode(stick.modeIndex)}
                >
                  <td>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleSelectMode(stick.modeIndex); }}
                      aria-current={isSelected ? "true" : undefined}
                    >
                      {isSelected ? "● " : ""}Mode {stick.modeIndex + 1}
                    </button>
                  </td>
                  <td>{stick.imaginary ? `−${Math.abs(stick.frequencyCm1).toFixed(1)}i` : stick.frequencyCm1.toFixed(1)}</td>
                  <td className="is-accent">{stick.ramanActivity.toFixed(4)}</td>
                  <td>{stick.depolarizationRatio !== null ? stick.depolarizationRatio.toFixed(4) : "—"}</td>
                  <td>{relative !== undefined ? `${(relative * 100).toFixed(2)}%` : "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="spectro-row-play"
                      aria-label={`Animate mode ${stick.modeIndex + 1}`}
                      onClick={(e) => { e.stopPropagation(); handleSelectMode(stick.modeIndex); }}
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

      {/* Provenance Details: engine, finite-field and QA values live here, not in the primary view */}
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
            <dt>Raman Method</dt>
            <dd>{analysis.raman_method ?? "placzek_static"}</dd>
          </div>
          <div>
            <dt>Polarizability Method</dt>
            <dd>{analysis.polarizability_method ?? "finite_electric_field"} (step: {analysis.electric_field_step_au ?? 0.0010} a.u.)</dd>
          </div>
          <div>
            <dt>Derivative Method</dt>
            <dd>{analysis.polarizability_derivative_method ?? "central_normal_coordinate_difference"} (step: {analysis.polarizability_derivative_step_angstrom_amu_half ?? 0.0100} Å·amu¹/²)</dd>
          </div>
          <div>
            <dt>Tensor Symmetrization</dt>
            <dd>{analysis.polarizability_tensor_symmetrization ? "true (residual QA passed)" : "false"}</dd>
          </div>
          <div>
            <dt>Antisymmetry Tolerance</dt>
            <dd>{analysis.polarizability_antisymmetry_tolerance ?? 0.0001} Å³</dd>
          </div>
          <div>
            <dt>Raman Activity Unit</dt>
            <dd>{analysis.raman_activity_unit ?? "Å⁴/amu"}</dd>
          </div>
          <div>
            <dt>Display Mode</dt>
            <dd>{isIntensity ? `Derived relative intensity (λ = ${laserWavelengthNm} nm, T = ${temperatureK} K)` : "Authoritative intrinsic Raman activity"}</dd>
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
