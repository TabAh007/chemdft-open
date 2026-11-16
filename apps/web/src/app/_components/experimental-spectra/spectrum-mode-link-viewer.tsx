"use client";

import { useEffect, useMemo, useState } from "react";
import type { CalculatedSourceView, ImportedVibrationsPayload, SpectrumComparisonView, StructureVersionDetail, VibrationalAnalysis } from "@chemdft/schemas";
import { ScientificVisualizationPanel } from "@/app/[locale]/projects/[projectId]/workspace/visualization/scientific-visualization-panel";
import { NormalModeSummary } from "@/app/[locale]/projects/[projectId]/workspace/visualization/spectroscopy-shell";
import { getImportedResult } from "@/lib/external-import-api";
import { importedVibrationFrame } from "@/lib/imported-results";
import { getCalculation, getStructureVersion } from "@/lib/structure-workspace-api";
import { DEFAULT_VISUAL_EXAGGERATION, vibrationalFrameDetail, visualDisplacementAngstrom } from "@/lib/vibrational-mode";
import { NO_DISPLACEMENT_STATEMENT, formatPosition, modeLinkStatement, pairForCalculated } from "@/lib/experimental-spectra";

type ModeSource =
  | { kind: "imported"; payload: ImportedVibrationsPayload }
  | { kind: "calculated"; analysis: VibrationalAnalysis };

/**
 * Animates the CALCULATED normal mode of the comparison's source and names the experimental peak that is its candidate match.
 * The experimental side never moves: a measured peak has no displacement vectors, and the panel says so.
 */
export function SpectrumModeLinkViewer({
  projectId,
  source,
  comparison,
  selectedIndex,
  onSelectIndex,
  persistenceKey,
}: {
  projectId: string;
  source: CalculatedSourceView;
  comparison: SpectrumComparisonView;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  persistenceKey: string;
}) {
  const [structure, setStructure] = useState<StructureVersionDetail | null>(null);
  const [modes, setModes] = useState<ModeSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exaggeration, setExaggeration] = useState(DEFAULT_VISUAL_EXAGGERATION);
  const [speed, setSpeed] = useState(1);
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [cameraKey, setCameraKey] = useState(0);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => { if (alive) { setStructure(null); setModes(null); setError(null); } });
    async function load() {
      if (!source.structure_id || !source.structure_version_id) throw new Error("This calculated source has no stored structure to animate.");
      const [version, payload] = await Promise.all([
        getStructureVersion({ projectId, structureId: source.structure_id, versionId: source.structure_version_id }),
        source.kind === "IMPORTED_RESULT"
          ? getImportedResult({ projectId, resultId: source.id }).then((view) => ({ kind: "imported", payload: view.payload as ImportedVibrationsPayload }) as ModeSource)
          : getCalculation({ projectId, calculationId: source.calculation_id ?? "" }).then((detail) => {
              if (!detail.result || detail.result.id !== source.id) throw new Error("The calculated vibrational result is no longer available.");
              return { kind: "calculated", analysis: detail.result.payload as VibrationalAnalysis } as ModeSource;
            }),
      ]);
      return { version, payload };
    }
    load().then((loaded) => { if (alive) { setStructure(loaded.version); setModes(loaded.payload); } })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : "The normal-mode animation could not be loaded."); });
    return () => { alive = false; };
  }, [projectId, source.id, source.kind, source.structure_id, source.structure_version_id, source.calculation_id]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setPhase((value) => value + 0.16 * speed), 1000 / 24);
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  const amplitude = visualDisplacementAngstrom(exaggeration);
  const frame = useMemo(() => {
    if (!structure || !modes) return null;
    return modes.kind === "imported"
      ? importedVibrationFrame(structure, modes.payload, selectedIndex, phase, amplitude)
      : vibrationalFrameDetail(structure, modes.analysis, selectedIndex, phase, amplitude);
  }, [structure, modes, selectedIndex, phase, amplitude]);
  const equilibrium = useMemo(() => {
    if (!structure || !modes) return null;
    return modes.kind === "imported"
      ? importedVibrationFrame(structure, modes.payload, 0, 0, 0)
      : vibrationalFrameDetail(structure, modes.analysis, 0, 0, 0);
  }, [structure, modes]);

  const modeCount = modes ? (modes.kind === "imported" ? modes.payload.modes.length : modes.analysis.modes.length) : 0;
  const frequency = modes
    ? modes.kind === "imported" ? modes.payload.modes[selectedIndex]?.frequency_cm1 : modes.analysis.modes[selectedIndex]?.frequency_cm1
    : undefined;
  const pair = pairForCalculated(comparison, selectedIndex);

  useEffect(() => {
    if (frequency === undefined) return;
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", {
      detail: {
        currentView: `Experimental spectrum comparison → calculated mode ${selectedIndex + 1} · ${frequency.toFixed(1)} cm⁻¹${pair ? ` ↔ candidate experimental peak ${pair.experimental_position.toFixed(1)}` : " (no candidate peak)"}`,
        selectedModeIndex: selectedIndex,
        selectedModeFrequency: frequency,
      },
    }));
  }, [selectedIndex, frequency, pair]);

  if (error) return <p className="workspace-canvas-error" role="alert" data-testid="spectrum-mode-error">{error}</p>;

  return (
    <section className="xspec-mode-link" aria-label="Calculated normal mode" data-testid="spectrum-mode-link">
      <header className="xspec-mode-link-head">
        <h3>Calculated normal mode</h3>
        <span className="xspec-badge" data-tone={source.kind === "IMPORTED_RESULT" ? "imported" : "calculated"}>{source.kind === "IMPORTED_RESULT" ? "IMPORTED" : "CALCULATED BY CHEMDFT"}</span>
      </header>
      <p className="xspec-statement" data-testid="spectrum-no-displacement-statement">{NO_DISPLACEMENT_STATEMENT}</p>
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
              persistenceKey={`${persistenceKey}:mode-link:3d`}
            />
          ) : <div className="spectro-viewer-loading">{structure && modes ? "Normal-mode animation unavailable for this source." : "Loading normal-mode 3D animation…"}</div>}
          <div className="spectro-viewer-label" aria-live="off" data-testid="spectrum-mode-label">
            <span className={`spectro-live-dot${playing ? " is-playing" : ""}`} aria-hidden="true" />
            Calculated mode {selectedIndex + 1}{frequency !== undefined ? ` · ${frequency.toFixed(1)} cm⁻¹` : ""}
            <span className="spectro-viewer-state">{playing ? "animating" : "paused"}</span>
          </div>
        </div>
        {modeCount > 0 && frequency !== undefined ? (
          <NormalModeSummary
            testIdPrefix="spectrum-mode"
            modeNumber={selectedIndex + 1}
            modeCount={modeCount}
            onPrev={() => onSelectIndex((selectedIndex - 1 + modeCount) % modeCount)}
            onNext={() => onSelectIndex((selectedIndex + 1) % modeCount)}
            onReset={() => { setPlaying(false); setPhase(0); setCameraKey((key) => key + 1); }}
            playing={playing}
            onTogglePlay={() => setPlaying((value) => !value)}
            exaggeration={exaggeration}
            onExaggeration={setExaggeration}
            speed={speed}
            onSpeed={setSpeed}
            rows={[
              { label: "Calculated frequency", value: `${frequency.toFixed(1)} cm⁻¹` },
              { label: "Compared position", value: pair ? formatPosition(pair.calculated_position, comparison.axis) : "not compared" },
              { label: "Candidate experimental peak", value: pair ? <strong data-testid="spectrum-mode-candidate">{formatPosition(pair.experimental_position, comparison.axis)}</strong> : "none within tolerance", accent: true },
            ]}
          />
        ) : null}
      </div>
      <p className="xspec-statement" data-testid="spectrum-mode-statement" role="status">{modeLinkStatement(comparison, selectedIndex)}</p>
    </section>
  );
}
