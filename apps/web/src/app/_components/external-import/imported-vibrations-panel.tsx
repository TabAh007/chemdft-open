"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ImportedVibrationsPayload, StructureVersionDetail } from "@chemdft/schemas";
import { ScientificVisualizationPanel } from "@/app/[locale]/projects/[projectId]/workspace/visualization/scientific-visualization-panel";
import { NormalModeSummary, SpectroscopyHeader } from "@/app/[locale]/projects/[projectId]/workspace/visualization/spectroscopy-shell";
import { VibrationalSpectrumChart } from "@/app/[locale]/projects/[projectId]/workspace/visualization/vibrational-spectrum-chart";
import {
  DEFAULT_IR_FWHM_CM1,
  DEFAULT_RAMAN_FWHM_CM1,
  MAX_IR_FWHM_CM1,
  MAX_RAMAN_FWHM_CM1,
  MIN_IR_FWHM_CM1,
  MIN_RAMAN_FWHM_CM1,
  deriveBroadenedIrSpectrum,
  deriveBroadenedRamanSpectrum,
  deriveIrDisplayRange,
  deriveRamanDisplayRange,
  type SpectrumStickIR,
  type SpectrumStickRaman,
} from "@/lib/spectrum";
import { DEFAULT_VISUAL_EXAGGERATION, visualDisplacementAngstrom } from "@/lib/vibrational-mode";
import { formatFrequency, importedSticks, importedVibrationFrame, sentence } from "@/lib/imported-results";

type Kind = "ir" | "raman";

/**
 * IR / Raman view of an IMPORTED vibrational analysis. It reuses the shared spectroscopy presentation
 * (header, mode summary, stick chart, 3D animation) but takes its values straight from the imported
 * payload: reported frequencies, IR intensities (km/mol) and Raman activities (Å⁴/amu). Nothing is
 * recomputed, and no depolarization ratio or laser-dependent intensity is synthesized.
 */
export function ImportedVibrationsPanel({
  kind,
  payload,
  sourceLabel,
  structureVersion,
  active,
  persistenceKey,
}: {
  kind: Kind;
  payload: ImportedVibrationsPayload;
  /** "Gaussian 16", "ORCA 6.1" … as reported by the output. */
  sourceLabel: string;
  structureVersion: StructureVersionDetail | null;
  active: boolean;
  persistenceKey: string;
}) {
  const sticks = useMemo(() => importedSticks(payload, kind), [payload, kind]);
  const [selected, setSelected] = useState<number>(() => {
    let best = sticks[0]?.modeIndex ?? 0;
    let bestValue = -Infinity;
    for (const stick of sticks) {
      if (!stick.imaginary && stick.value > bestValue) {
        bestValue = stick.value;
        best = stick.modeIndex;
      }
    }
    return best;
  });
  const [fwhm, setFwhm] = useState<number>(kind === "ir" ? DEFAULT_IR_FWHM_CM1 : DEFAULT_RAMAN_FWHM_CM1);
  const [inverted, setInverted] = useState<boolean>(kind === "ir");
  const [exaggeration, setExaggeration] = useState<number>(DEFAULT_VISUAL_EXAGGERATION);
  const [speed, setSpeed] = useState<number>(1);
  const [phase, setPhase] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(true);
  const [cameraKey, setCameraKey] = useState<number>(0);

  const selectMode = useCallback((index: number) => {
    setSelected(index);
    setPhase(0);
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setPhase((value) => value + 0.16 * speed), 1000 / 24);
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  const mode = payload.modes[selected];

  const frame = useMemo(() => {
    if (!structureVersion || !mode) return null;
    return importedVibrationFrame(structureVersion, payload, selected, phase, visualDisplacementAngstrom(exaggeration));
  }, [structureVersion, payload, selected, phase, exaggeration, mode]);
  const equilibrium = useMemo(
    () => (structureVersion ? importedVibrationFrame(structureVersion, payload, 0, 0, 0) : null),
    [structureVersion, payload],
  );

  const irSticks: SpectrumStickIR[] = useMemo(
    () => sticks.map((s) => ({ modeIndex: s.modeIndex, frequencyCm1: s.frequencyCm1, irIntensityKmPerMol: s.value, imaginary: s.imaginary })),
    [sticks],
  );
  const ramanSticks: SpectrumStickRaman[] = useMemo(
    () => sticks.map((s) => ({
      modeIndex: s.modeIndex,
      frequencyCm1: s.frequencyCm1,
      reducedMassAmu: payload.modes[s.modeIndex]?.reduced_mass_amu ?? null,
      ramanActivity: s.value,
      depolarizationRatio: null,
      imaginary: s.imaginary,
    })),
    [sticks, payload.modes],
  );

  const spectrum = useMemo(() => {
    if (kind === "ir") {
      const range = deriveIrDisplayRange(irSticks);
      const broadened = deriveBroadenedIrSpectrum(irSticks, { fwhmCm1: fwhm, inverted, wavenumberMin: range.wavenumberMin, wavenumberMax: range.wavenumberMax, stepCm1: 2 });
      const top = Math.max(1e-6, broadened.maxIntensity);
      return { wMin: broadened.wavenumberMin, wMax: broadened.wavenumberMax, curve: broadened.curve.map((pt) => ({ x: pt.wavenumberCm1, y: pt.intensity / top })) };
    }
    const range = deriveRamanDisplayRange(ramanSticks);
    const broadened = deriveBroadenedRamanSpectrum(ramanSticks, { fwhmCm1: fwhm, wavenumberMin: range.wavenumberMin, wavenumberMax: range.wavenumberMax, stepCm1: 2 });
    const top = Math.max(1e-6, broadened.maxActivity);
    return { wMin: broadened.wavenumberMin, wMax: broadened.wavenumberMax, curve: broadened.curve.map((pt) => ({ x: pt.wavenumberCm1, y: pt.activity / top })) };
  }, [kind, irSticks, ramanSticks, fwhm, inverted]);

  const unit = kind === "ir" ? "km/mol" : "Å⁴/amu";
  const quantity = kind === "ir" ? "IR intensity" : "Raman activity";
  const chartSticks = useMemo(
    () => sticks.map((s) => ({
      modeIndex: s.modeIndex,
      frequencyCm1: s.frequencyCm1,
      value: s.value,
      valueLabel: `${s.value.toFixed(2)} ${unit}`,
      imaginary: s.imaginary,
    })),
    [sticks, unit],
  );

  useEffect(() => {
    if (!active || !mode) return;
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", {
      detail: {
        currentView: `Imported (${sourceLabel}) → ${kind === "ir" ? "IR" : "Raman"} → Mode ${mode.index + 1} · ${mode.frequency_cm1.toFixed(1)} cm⁻¹`,
        selectedModeIndex: mode.index,
        selectedModeFrequency: mode.frequency_cm1,
      },
    }));
  }, [active, kind, mode, sourceLabel]);

  const hasImaginary = payload.imaginary_mode_count > 0;
  const selectedValue = mode ? (kind === "ir" ? mode.ir_intensity_km_mol : mode.raman_activity_a4_amu) : null;
  const testPrefix = `imported-${kind}`;

  return (
    <div className={`vibrational-analysis spectro-workspace imported-vibrations imported-${kind}`} data-testid={`${testPrefix}-panel`}>
      <SpectroscopyHeader
        testIdPrefix={testPrefix}
        title={kind === "ir" ? "Imported IR spectrum" : "Imported Raman spectrum"}
        subtitle={`Reported by ${sourceLabel} · ${payload.mode_count} vibrational modes${payload.linear ? " (linear molecule)" : ""}`}
        statusLabel={`Imported · ${sourceLabel}`}
        statusTone="warn"
        warning={hasImaginary ? `${payload.imaginary_mode_count} imaginary mode${payload.imaginary_mode_count === 1 ? "" : "s"}` : undefined}
      />

      {hasImaginary ? (
        <div className="vibrational-warning" role="alert" data-testid="imported-imaginary-warning">
          <strong>Scientific warning:</strong> the source program reports {payload.imaginary_mode_count} imaginary frequenc
          {payload.imaginary_mode_count === 1 ? "y" : "ies"} (shown with an “i”). The imported geometry is not a minimum on the surface it was computed on.
        </div>
      ) : null}

      <div className="spectro-primary">
        <div className="spectro-viewer">
          {frame ? (
            <ScientificVisualizationPanel
              key={cameraKey}
              compact
              detail={frame}
              visualBondsReference={equilibrium}
              selectedAtomIndex={null}
              measurementKind="none"
              measurementAtomIndices={[]}
              onSelectAtom={() => undefined}
              onMeasurementKindChange={() => undefined}
              onSceneReady={() => undefined}
              persistenceKey={`${persistenceKey}:3d`}
            />
          ) : (
            <div className="spectro-viewer-loading">{structureVersion ? "Normal-mode animation unavailable for this file." : "Loading normal-mode 3D animation…"}</div>
          )}
          <div className="spectro-viewer-label" aria-live="off">
            <span className={`spectro-live-dot${playing ? " is-playing" : ""}`} aria-hidden="true" />
            Mode {selected + 1}
            {mode ? ` · ${formatFrequency(mode.frequency_cm1, mode.imaginary)} cm⁻¹` : ""}
            <span className="spectro-viewer-state">{playing ? "animating" : "paused"}</span>
          </div>
        </div>

        {mode ? (
          <NormalModeSummary
            testIdPrefix={testPrefix}
            modeNumber={selected + 1}
            modeCount={payload.modes.length}
            onPrev={() => selectMode((selected - 1 + payload.modes.length) % payload.modes.length)}
            onNext={() => selectMode((selected + 1) % payload.modes.length)}
            onReset={() => { setPlaying(false); setPhase(0); setCameraKey((k) => k + 1); }}
            playing={playing}
            onTogglePlay={() => setPlaying((value) => !value)}
            exaggeration={exaggeration}
            onExaggeration={setExaggeration}
            speed={speed}
            onSpeed={setSpeed}
            rows={[
              { label: "Frequency", value: `${formatFrequency(mode.frequency_cm1, mode.imaginary)} cm⁻¹` },
              { label: quantity, value: selectedValue === null ? "Not reported" : `${selectedValue.toFixed(2)} ${unit}`, accent: true },
              ...(kind === "raman" ? [{ label: "Depolarization ratio", value: "Not reported" }] : []),
              { label: "Reduced mass", value: mode.reduced_mass_amu ? `${mode.reduced_mass_amu.toFixed(4)} amu` : "Not reported" },
              { label: "Classification", value: mode.imaginary ? <strong className="is-warn">Imaginary</strong> : "Real" },
            ]}
          />
        ) : null}
      </div>

      <section className="spectro-spectrum" aria-label={`Imported ${kind === "ir" ? "IR" : "Raman"} spectrum`}>
        <div className="spectro-spectrum-head">
          <h3>{kind === "ir" ? "IR spectrum" : "Raman spectrum"}</h3>
          <div className="spectro-spectrum-controls">
            {kind === "ir" ? (
              <button type="button" className="spectro-link-btn" onClick={() => setInverted((value) => !value)}>
                Axis: {inverted ? "high → low (conventional)" : "low → high"}
              </button>
            ) : null}
            <details className="spectro-settings">
              <summary>Spectrum settings</summary>
              <div className="spectro-settings-body">
                <label title="Lorentzian line broadening full-width at half-maximum (display only)">
                  <span>Line width (FWHM)</span>
                  <input
                    aria-label="Line broadening FWHM"
                    type="range"
                    min={kind === "ir" ? MIN_IR_FWHM_CM1 : MIN_RAMAN_FWHM_CM1}
                    max={kind === "ir" ? MAX_IR_FWHM_CM1 : MAX_RAMAN_FWHM_CM1}
                    step="1"
                    value={fwhm}
                    onChange={(event) => setFwhm(Number(event.currentTarget.value))}
                  />
                  <output>{fwhm.toFixed(0)} cm⁻¹</output>
                </label>
              </div>
            </details>
          </div>
        </div>
        <p className="spectro-caption" data-testid={`${testPrefix}-caption`}>
          Sticks are the {quantity} values reported by {sourceLabel} ({unit}); the curve is a Lorentzian broadening for display.
          {kind === "raman" ? " Raman values are source-reported activities, not laser-wavelength-dependent intensities; depolarization ratios are not reported." : ""}
        </p>
        <VibrationalSpectrumChart
          sticks={chartSticks}
          curve={spectrum.curve}
          wMin={spectrum.wMin}
          wMax={spectrum.wMax}
          inverted={kind === "ir" ? inverted : false}
          xLabel={kind === "ir" ? "Wavenumber (cm⁻¹)" : "Raman shift (cm⁻¹)"}
          yLabel={`${quantity} (${unit})`}
          selectedIndex={selected}
          onSelect={selectMode}
          testIdPrefix={testPrefix}
          ariaLabel={`Imported ${kind === "ir" ? "infrared" : "Raman"} spectrum`}
          description={`Imported ${quantity} in ${unit} against wavenumber in inverse centimeters, as reported by ${sourceLabel}.`}
        />
      </section>

      <section className="spectro-table-wrap" aria-label="Imported vibrational modes">
        <h3 className="spectro-table-title">Vibrational modes ({payload.modes.length}, original order)</h3>
        <table className="spectro-table" data-testid={`${testPrefix}-table`}>
          <thead>
            <tr>
              <th>Mode</th>
              <th>Frequency (cm⁻¹)</th>
              <th>IR intensity (km/mol)</th>
              {payload.has_raman_activities ? <th>Raman activity (Å⁴/amu)</th> : null}
              <th>Reduced mass (amu)</th>
            </tr>
          </thead>
          <tbody>
            {payload.modes.map((row) => (
              <tr key={row.index} data-testid={`imported-mode-row-${row.index + 1}`} aria-selected={row.index === selected} onClick={() => selectMode(row.index)}>
                <td>
                  <button type="button" onClick={(event) => { event.stopPropagation(); selectMode(row.index); }} aria-current={row.index === selected ? "true" : undefined}>
                    {row.index === selected ? "● " : ""}Mode {row.index + 1}
                  </button>
                </td>
                <td>{formatFrequency(row.frequency_cm1, row.imaginary)}</td>
                <td className={kind === "ir" ? "is-accent" : undefined}>{row.ir_intensity_km_mol === null ? "Not reported" : row.ir_intensity_km_mol.toFixed(2)}</td>
                {payload.has_raman_activities ? (
                  <td className={kind === "raman" ? "is-accent" : undefined}>{row.raman_activity_a4_amu === null ? "Not reported" : row.raman_activity_a4_amu.toFixed(2)}</td>
                ) : null}
                <td>{row.reduced_mass_amu ? row.reduced_mass_amu.toFixed(4) : "Not reported"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="spectro-caption">
          {sentence(payload.zero_modes)} Frequencies are shown exactly as reported; a negative value (shown with an “i”) is imaginary.
        </p>
      </section>
    </div>
  );
}
