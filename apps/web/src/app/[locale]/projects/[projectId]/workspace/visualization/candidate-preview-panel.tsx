"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_VISUALIZATION_STATE,
  inferVisualBonds,
  type PreviewScene,
  type VisualizationState,
} from "@chemdft/scientific-scene";
import { StatusTag } from "@chemdft/ui";

const StructureViewport = dynamic(() => import("./structure-viewport").then((m) => m.StructureViewport), {
  ssr: false,
  loading: () => <div className="viewport-fallback">Loading candidate preview…</div>,
});

export function CandidatePreviewPanel({
  scene,
  title = "Unverified reconstruction",
  subtitle = "PreviewScene · candidate coordinates · no StructureVersion",
  warningText = "UNVERIFIED RECONSTRUCTION — User supplied coordinates for review. They are not DFT optimized, experimentally measured, or a committed structure.",
  statusTagText = "Preview",
}: {
  scene: PreviewScene;
  title?: string;
  subtitle?: string;
  warningText?: string;
  statusTagText?: string;
}) {
  const storageKey = `chemdft:candidate-preview:${scene.candidateId}:${scene.representationId}`;
  const [state, setState] = useState<VisualizationState>(() => {
    if (typeof window === "undefined") return DEFAULT_VISUALIZATION_STATE;
    try {
      const saved = window.localStorage.getItem(`${storageKey}:state`);
      return saved ? { ...DEFAULT_VISUALIZATION_STATE, ...JSON.parse(saved) } as VisualizationState : DEFAULT_VISUALIZATION_STATE;
    } catch { return DEFAULT_VISUALIZATION_STATE; }
  });
  const [selectedAtom, setSelectedAtom] = useState<number | null>(null);
  const [measureAtoms, setMeasureAtoms] = useState<number[]>([]);
  const visualBonds = useMemo(() => inferVisualBonds(scene.renderable), [scene.renderable]);

  useEffect(() => {
    try { window.localStorage.setItem(`${storageKey}:state`, JSON.stringify(state)); } catch { /* Visualization preferences are optional. */ }
  }, [state, storageKey]);

  return (
    <section className="candidate-preview" aria-label="Unverified candidate preview">
      <div className="candidate-preview-heading">
        <div><strong>{title} · R{scene.representationRevision}</strong><span>{subtitle}</span></div>
        <StatusTag intent="warning">{statusTagText}</StatusTag>
      </div>
      <div className="candidate-preview-warning" role="note">
        {warningText}
      </div>
      <div className="candidate-preview-toolbar" aria-label="Preview rendering controls">
        <label>Style <select aria-label="Preview representation" value={state.representation} onChange={(event) => { const representation = event.currentTarget.value as VisualizationState["representation"]; setState((current) => ({ ...current, representation })); }}><option value="ball-stick">Ball &amp; stick</option><option value="sticks">Sticks</option><option value="wireframe">Wireframe</option><option value="space-fill">Space fill</option></select></label>
        <label>Atom labels <select aria-label="Atom labels" value={state.labels} onChange={(event) => { const labels = event.currentTarget.value as VisualizationState["labels"]; setState((current) => ({ ...current, labels })); }}><option value="none">Off</option><option value="element">Element</option><option value="index">Index</option></select></label>
        <label><input type="checkbox" checked={state.measurement !== null} onChange={(event) => { const checked = event.currentTarget.checked; setState((current) => ({ ...current, measurement: checked ? { kind: "distance", atomIndices: [] } : null })); setMeasureAtoms([]); }} /> Measure distance by selecting two atoms</label>
      </div>
      <div className="candidate-preview-viewport" data-testid="candidate-preview-canvas">
        <StructureViewport
          scene={scene.renderable}
          visualBonds={visualBonds}
          representation={state.representation}
          labels={state.labels}
          selectedAtomIndex={selectedAtom}
          measurementAtomIndices={measureAtoms}
          onSelectAtom={(atomIndex) => {
            setSelectedAtom(atomIndex);
            if (state.measurement) {
              const next = [...measureAtoms, atomIndex].slice(-2);
              setMeasureAtoms(next);
              setState((visual) => ({ ...visual, measurement: { kind: "distance", atomIndices: next } }));
            }
          }}
          cameraStorageKey={`${storageKey}:camera`}
        />
      </div>
      <p className="workspace-muted">Drag to rotate · scroll or pinch to zoom. These coordinates belong to candidate {scene.candidateId.slice(0, 8)}.</p>
      {state.measurement && measureAtoms.length === 2 ? <p className="workspace-muted">Selected atoms {measureAtoms[0]! + 1} and {measureAtoms[1]! + 1}; the viewport shows the measured distance.</p> : null}
    </section>
  );
}
