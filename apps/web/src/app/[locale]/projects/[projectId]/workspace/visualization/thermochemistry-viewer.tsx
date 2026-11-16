"use client";

import { STATIC_VIEWER_CAPTION, spectraViewerCaption } from "@/app/_components/viewer-toolbar";
import { useEffect, useMemo, useState } from "react";
import type { StructureVersionDetail, VibrationalAnalysis } from "@chemdft/schemas";
import { vibrationalFrameDetail, visualDisplacementAngstrom } from "@/lib/vibrational-mode";
import { ScientificVisualizationPanel } from "./scientific-visualization-panel";

/**
 * Large canonical Three.js viewer for the optimized structure used by the thermochemistry
 * calculation. Nothing is coloured by a thermodynamic quantity (none is spatially localised).
 * Selecting a vibrational mode animates the persisted normal-mode displacement of the source
 * frequency result with the display-only "visual exaggeration" scale.
 */
export function ThermochemistryViewer({
  source,
  analysis,
  selectedModeIndex,
  playing,
  exaggeration,
  speed,
  caption,
  persistenceKey,
}: {
  source: StructureVersionDetail | null;
  analysis: VibrationalAnalysis | null;
  selectedModeIndex: number | null;
  playing: boolean;
  exaggeration: number;
  speed: number;
  caption: string;
  persistenceKey: string;
}) {
  // Phase restarts at 0 whenever the selected mode changes (state keyed by mode, no effect reset).
  const [phaseState, setPhaseState] = useState<{ mode: number | null; phase: number }>({ mode: null, phase: 0 });
  const phase = phaseState.mode === selectedModeIndex ? phaseState.phase : 0;
  const animating = playing && selectedModeIndex !== null && analysis !== null;

  useEffect(() => {
    if (!animating) return;
    const timer = window.setInterval(
      () =>
        setPhaseState((previous) => ({
          mode: selectedModeIndex,
          phase: (previous.mode === selectedModeIndex ? previous.phase : 0) + 0.16 * speed,
        })),
      1000 / 24,
    );
    return () => window.clearInterval(timer);
  }, [animating, speed, selectedModeIndex]);

  const equilibriumFrame = useMemo(() => {
    if (!source || !analysis) return null;
    return vibrationalFrameDetail(source, analysis, 0, 0, 0);
  }, [source, analysis]);

  const frame = useMemo(() => {
    if (!source) return null;
    if (selectedModeIndex === null || !analysis) return source;
    return (
      vibrationalFrameDetail(source, analysis, selectedModeIndex, phase, visualDisplacementAngstrom(exaggeration)) ??
      source
    );
  }, [source, analysis, selectedModeIndex, phase, exaggeration]);

  const mode = selectedModeIndex !== null ? analysis?.modes[selectedModeIndex] : undefined;

  return (
    <div className="spectro-viewer" data-testid="thermo-viewer">
      {frame ? (
        <ScientificVisualizationPanel
          compact
          detail={frame}
          visualBondsReference={equilibriumFrame ?? source}
          selectedAtomIndex={null}
          measurementKind="none"
          measurementAtomIndices={[]}
          onSelectAtom={() => undefined}
          onMeasurementKindChange={() => undefined}
          onSceneReady={() => undefined}
          persistenceKey={persistenceKey}
        />
      ) : (
        <div className="spectro-viewer-loading">Loading optimized structure…</div>
      )}
      <div className="spectro-viewer-label" aria-live="off" data-testid="thermo-viewer-label">
        {mode && selectedModeIndex !== null ? (
          <>
            <span className={`spectro-live-dot${animating ? " is-playing" : ""}`} aria-hidden="true" />
            Mode {selectedModeIndex + 1} · {mode.frequency_cm1.toFixed(1)} cm⁻¹
            <span className="spectro-viewer-state">{animating ? "animating" : "paused"}</span>
          </>
        ) : (
          caption
        )}
      </div>
      <p className="viewer-caption-shared" data-testid="thermo-viewer-caption" style={{ margin: "0 8px 6px" }}>
        {mode && selectedModeIndex !== null ? spectraViewerCaption(selectedModeIndex + 1) : STATIC_VIEWER_CAPTION}
      </p>
    </div>
  );
}
