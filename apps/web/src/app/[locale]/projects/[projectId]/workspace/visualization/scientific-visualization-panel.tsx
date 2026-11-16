"use client";

import { HelpTip } from "@/app/_components/help/help-tip";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildScientificScene,
  DEFAULT_VISUALIZATION_STATE,
  formatMeasurement,
  inferVisualBonds,
  measureScene,
  type MeasurementKind,
  type MeasurementResult,
  type ScientificScene,
  type VisualizationState,
} from "@chemdft/scientific-scene";
import type { StructureVersionDetail } from "@chemdft/schemas";
import { ActionButton, AppIcon, AppPopover } from "@chemdft/ui";

import { exportViewportPng } from "@/lib/visualization/renderer-utils";

const StructureViewport = dynamic(() => import("./structure-viewport"), {
  ssr: false,
  loading: () => <div className="viewport-fallback">Loading Scientific View…</div>,
});

export type ViewerStructureFacts = {
  formula?: string | null;
  atoms?: number | string | null;
  charge?: number | string | null;
  multiplicity?: number | string | null;
  source?: string | null;
};

type VisualizationPanelProps = {
  active?: boolean;
  detail: StructureVersionDetail;
  selectedAtomIndex: number | null;
  measurementKind: MeasurementKind | "none";
  measurementAtomIndices: readonly number[];
  onSelectAtom: (atomIndex: number) => void;
  onMeasurementKindChange: (kind: MeasurementKind | "none") => void;
  onSceneReady: (scene: ScientificScene | null) => void;
  persistenceKey?: string;
  /** Dense single-row toolbar, no heading/status chrome (Guided spectroscopy viewer). */
  compact?: boolean;
  /** Geometry used to perceive visual bonds (e.g. equilibrium during a vibration animation). */
  visualBondsReference?: StructureVersionDetail | null;
  /** Display-only vectors (angstrom), for example vibrational displacements. */
  arrows?: readonly { origin: readonly [number, number, number]; vector: readonly [number, number, number] }[] | undefined;
  /** Whether to show camera export button. False by default since Release 0.0.14 unifies export into the page toolbar. */
  showExport?: boolean;
  /** Authoritative structure facts (formula, atoms, charge, multiplicity, source). */
  structureFacts?: ViewerStructureFacts | undefined;
};

export function ScientificVisualizationPanel({
  active = true,
  detail,
  selectedAtomIndex,
  measurementKind,
  measurementAtomIndices,
  onSelectAtom,
  onMeasurementKindChange,
  onSceneReady,
  persistenceKey,
  compact = false,
  visualBondsReference = null,
  arrows,
  showExport = false,
  structureFacts,
}: VisualizationPanelProps) {
  const [fitRevision, setFitRevision] = useState(0);
  useEffect(() => {
    const fit = () => {
      if (active) setFitRevision((value) => value + 1);
    };
    window.addEventListener("chemdft:fit-active-structure", fit);
    return () => window.removeEventListener("chemdft:fit-active-structure", fit);
  }, [active]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<VisualizationState>(DEFAULT_VISUALIZATION_STATE);
  const restoredStateKey = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const sceneResult = useMemo(() => {
    try {
      return { scene: buildScientificScene(detail), error: null };
    } catch (error) {
      return {
        scene: null,
        error: error instanceof Error ? `SCENE_BUILD_FAILED: ${error.message}` : "SCENE_BUILD_FAILED",
      };
    }
  }, [detail]);

  const scene = sceneResult.scene;
  const [visualBondsEnabled, setVisualBondsEnabled] = useState(true);

  const referenceScene = useMemo(() => {
    if (!visualBondsReference) return null;
    try {
      return buildScientificScene(visualBondsReference);
    } catch {
      return null;
    }
  }, [visualBondsReference]);
  // Perceive bonds from the reference (equilibrium) geometry when given, so exaggerated
  // animation frames never drop a bond merely by crossing the inference distance cutoff.
  const perceivedBonds = useMemo(
    () => (scene ? inferVisualBonds(referenceScene && referenceScene.atoms.length === scene.atoms.length ? referenceScene : scene) : []),
    [scene, referenceScene],
  );
  const visualBonds = useMemo(() => (visualBondsEnabled ? perceivedBonds : []), [visualBondsEnabled, perceivedBonds]);
  const hasCell = scene?.kind === "PERIODIC" && Boolean(scene.cell);
  const rendererState = hasCell ? state : { ...state, unitCellVisible: false };

  const measurement = useMemo(() => {
    if (!scene || measurementKind === "none") return null;
    const required = measurementKind === "distance" ? 2 : measurementKind === "angle" ? 3 : 4;
    if (measurementAtomIndices.length !== required) return null;
    return measureScene(scene, measurementKind, measurementAtomIndices);
  }, [measurementAtomIndices, measurementKind, scene]);

  useEffect(() => {
    onSceneReady(scene);
  }, [onSceneReady, scene]);

  useEffect(() => {
    if (!persistenceKey || restoredStateKey.current === persistenceKey) return;
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(persistenceKey) ?? "null") as (Partial<VisualizationState> & { visualBondsEnabled?: boolean }) | null;
        if (saved) {
          setState({
            ...DEFAULT_VISUALIZATION_STATE,
            ...saved,
            camera: { ...DEFAULT_VISUALIZATION_STATE.camera, ...saved.camera },
          });
          if (typeof saved.visualBondsEnabled === "boolean") {
            setVisualBondsEnabled(saved.visualBondsEnabled);
          }
        }
      } catch {
        /* Invalid display preferences are ignored. */
      }
      restoredStateKey.current = persistenceKey;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [persistenceKey]);

  useEffect(() => {
    if (!persistenceKey || restoredStateKey.current !== persistenceKey) return;
    window.localStorage.setItem(persistenceKey, JSON.stringify({ ...state, visualBondsEnabled }));
  }, [persistenceKey, state, visualBondsEnabled]);

  // Release 0.0.40: the "Crystal" group collapses into "More controls" only when wrapping would push the canvas
  // below 50% of the window height. Hysteresis: it re-expands only when the canvas would still reach 50%.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [crystalCollapsed, setCrystalCollapsed] = useState(false);
  const expandedToolbarH = useRef(0);
  useEffect(() => {
    const host = viewportRef.current;
    const bar = toolbarRef.current;
    if (!host || !bar) return;
    const evaluate = () => {
      const canvasH = host.getBoundingClientRect().height;
      const barH = bar.getBoundingClientRect().height;
      const need = window.innerHeight * 0.5;
      if (!crystalCollapsed) {
        expandedToolbarH.current = barH;
        if (canvasH > 0 && canvasH < need) setCrystalCollapsed(true);
      } else {
        const extra = Math.max(0, expandedToolbarH.current - barH);
        if (canvasH - extra >= need) setCrystalCollapsed(false);
      }
    };
    evaluate();
    const observer = new ResizeObserver(evaluate);
    observer.observe(host);
    observer.observe(bar);
    window.addEventListener("resize", evaluate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", evaluate);
    };
  }, [crystalCollapsed, hasCell, scene]);

  if (!scene) {
    return (
      <section className="structure-pane visualization-pane" aria-label="Scientific visualization">
        <div className="viewport-fallback">{sceneResult.error}</div>
      </section>
    );
  }

  function updateState(next: Partial<VisualizationState>) {
    setState((previous) => ({ ...previous, ...next }));
  }

  function selectAtom(atomIndex: number) {
    onSelectAtom(atomIndex);
    setState((previous) => ({ ...previous, selection: { type: "atom", atomIndex } }));
  }

  function exportPng() {
    const host = viewportRef.current;
    if (!host) return;
    const ok = exportViewportPng(host, `chemdft-v${detail.version.revision}-${state.representation}.png`);
    setMessage(
      ok
        ? "PNG viewport image exported from current visualization state."
        : "EXPORT_FAILED: No WebGL canvas is available to export."
    );
  }


  const periodic = hasCell && scene.kind === "PERIODIC";
  const crystalControls = (
    <>
      {hasCell ? (
        <label
            className="checkbox-control"
            title="Unit cell defined for this StructureVersion"
          >
            <input
              type="checkbox"
              checked={state.unitCellVisible}
              onChange={(event) => updateState({ unitCellVisible: event.currentTarget.checked })}
            />
            Unit cell
          </label>
      ) : null}
      {periodic ? (
        <>
          <HelpTip topic="crystal.supercell" />
          <label>
            Supercell
            <select
              aria-label="Supercell"
              value={`${state.supercell.nx}x${state.supercell.ny}x${state.supercell.nz}`}
              onChange={(event) => updateState({ supercell: parseSupercell(event.currentTarget.value) })}
            >
              <option value="1x1x1">1×1×1</option>
              <option value="2x1x1">2×1×1</option>
              <option value="2x2x1">2×2×1</option>
              <option value="2x2x2">2×2×2</option>
            </select>
          </label>
          <label>
            <span className="viz-label-text">Cell contents</span>
            <select
              aria-label="Cell contents"
              value={state.cellContents ?? "coordination"}
              onChange={(event) => updateState({ cellContents: event.currentTarget.value as "coordination" | "cell" })}
            >
              <option value="coordination">Complete coordination</option>
              <option value="cell">Atoms in cell</option>
            </select>
          </label>
          <label className="checkbox-control" title="Display coordination polyhedra around metal centers">
            <input
              type="checkbox"
              checked={state.polyhedraVisible ?? false}
              onChange={(event) => updateState({ polyhedraVisible: event.currentTarget.checked })}
            />
            Polyhedra
          </label>
          <label className="checkbox-control" title="Display element legend overlay">
            <input
              type="checkbox"
              checked={state.legendVisible ?? true}
              onChange={(event) => updateState({ legendVisible: event.currentTarget.checked })}
            />
            Legend
          </label>
                <label>
                  <span className="viz-label-text">Visual bonds</span>
                  <select
                    aria-label="Visual bonds"
                    value={visualBondsEnabled ? "auto" : "off"}
                    title="Display only; inferred from distances, not passed to calculations or structure exports."
                    onChange={(event) => setVisualBondsEnabled(event.currentTarget.value === "auto")}
                  >
                    <option value="auto">Auto</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                <label className="viz-quiet-label viz-self-evident" title="View preset">
                  <span className="viz-label-text">View</span>
                  <select
                    aria-label="View preset"
                    value={state.presetView ?? "oblique"}
                    onChange={(event) =>
                      updateState({ presetView: event.currentTarget.value as VisualizationState["presetView"] })
                    }
                  >
                    <option value="oblique">Oblique</option>
                    <option value="front">Front (1)</option>
                    <option value="back">Back (2)</option>
                    <option value="left">Left (3)</option>
                    <option value="right">Right (4)</option>
                    <option value="top">Top (5)</option>
                    <option value="bottom">Bottom (6)</option>
                    <option value="isometric">Isometric (7)</option>
                    <option value="along-a">Along a</option>
                    <option value="along-b">Along b</option>
                    <option value="along-c">Along c</option>
                    <option value="along-a-star">Along a*</option>
                  </select>
                </label>
        </>
      ) : null}
    </>
  );

  return (
    <section className="structure-pane visualization-pane" aria-label="Scientific visualization">
      <div ref={toolbarRef} className={`visualization-toolbar${compact ? " visualization-toolbar--compact" : ""}`} role="toolbar" aria-label="Scientific visualization controls">
        {structureFacts ? (
          <div className="viewer-inline-facts" data-testid="viewer-structure-facts">
            {structureFacts.formula ? <span className="viewer-fact"><span className="fact-label">Formula</span> <strong>{structureFacts.formula}</strong></span> : null}
            {structureFacts.atoms != null ? <span className="viewer-fact"><span className="fact-label">Atoms</span> <strong>{structureFacts.atoms}</strong></span> : null}
            {structureFacts.charge != null ? <span className="viewer-fact"><span className="fact-label">Charge</span> <strong>{structureFacts.charge}</strong></span> : null}
            {structureFacts.multiplicity != null ? <span className="viewer-fact"><span className="fact-label">Multiplicity</span> <strong>{structureFacts.multiplicity}</strong></span> : null}
            {structureFacts.source ? <span className="viewer-fact"><span className="fact-label">Source</span> <strong>{structureFacts.source}</strong></span> : null}
          </div>
        ) : null}
        <div className="viz-group" role="group" aria-label="Look" data-testid="viz-group-look">
          <span className="viz-group-caption" aria-hidden="true">Look</span>
        <ActionButton
          small
          minimal
          icon="zoom-to-fit"
          text="Fit"
          onClick={() => setFitRevision((v) => v + 1)}
          title="Center and fit molecule in view"
        />
        <label className="viz-quiet-label viz-self-evident" title="Representation">
          <span className="viz-label-text">Representation</span>
          <select aria-label="Representation"
            value={state.representation}
            onChange={(event) =>
              updateState({ representation: event.currentTarget.value as VisualizationState["representation"] })
            }
          >
            <option value="ball-stick">Ball and stick</option>
            <option value="sticks">Sticks</option>
            <option value="wireframe">Wireframe</option>
            <option value="space-fill">Space-fill</option>
          </select>
        </label>
        <label className="viz-quiet-label viz-self-evident" title="Projection">
          <span className="viz-label-text">Projection</span>
          <select
            aria-label="Projection"
            value={state.camera.projection}
            onChange={(event) =>
              updateState({
                camera: {
                  ...state.camera,
                  projection: event.currentTarget.value as VisualizationState["camera"]["projection"],
                },
              })
            }
          >
            <option value="perspective">Perspective</option>
            <option value="orthographic">Orthographic</option>
          </select>
        </label>
                <label>
                  <span className="viz-label-text">Labels</span>
                  <select aria-label="Labels"
                    value={state.labels}
                    onChange={(event) => updateState({ labels: event.currentTarget.value as VisualizationState["labels"] })}
                  >
                    <option value="none">None</option>
                    <option value="element">Element</option>
                    <option value="index">Atom index</option>
                  </select>
                </label>
                <label className="viz-quiet-label viz-self-evident" title="Palette">
                  <span className="viz-label-text">Palette</span>
                  <select
                    aria-label="Palette"
                    value={state.colorScheme}
                    onChange={(event) =>
                      updateState({ colorScheme: event.currentTarget.value as VisualizationState["colorScheme"] })
                    }
                  >
                    <option value="conventional">Conventional</option>
                    <option value="colorblind">Colorblind</option>
                    <option value="monochrome">Monochrome</option>
                  </select>
                </label>
                <label className="viz-quiet-label">
                  <span className="viz-label-text">Atom size</span>
                  <select
                    aria-label="Atom size"
                    value={String(state.atomScale ?? 1)}
                    onChange={(event) => updateState({ atomScale: Number(event.currentTarget.value) })}
                  >
                    <option value="0.5">0.5×</option>
                    <option value="0.75">0.75×</option>
                    <option value="1">1×</option>
                    <option value="1.25">1.25×</option>
                    <option value="1.5">1.5×</option>
                    <option value="2">2×</option>
                  </select>
                </label>
                <label className="viz-quiet-label">
                  <span className="viz-label-text">Label size</span>
                  <select
                    aria-label="Label size"
                    value={String(state.labelScale ?? 1)}
                    onChange={(event) => updateState({ labelScale: Number(event.currentTarget.value) })}
                  >
                    <option value="0.75">0.75×</option>
                    <option value="1">1×</option>
                    <option value="1.25">1.25×</option>
                    <option value="1.5">1.5×</option>
                    <option value="2">2×</option>
                  </select>
                </label>
                <label>
                  <span className="viz-label-text">Measure</span>
                  <select
                    aria-label="Measure"
                    value={measurementKind}
                    onChange={(event) => onMeasurementKindChange(event.currentTarget.value as MeasurementKind | "none")}
                  >
                    <option value="none">Off</option>
                    <option value="distance">Distance</option>
                    <option value="angle">Angle</option>
                    <option value="dihedral">Dihedral</option>
                  </select>
                </label>
          {!periodic ? (
            <>
                <label>
                  <span className="viz-label-text">Visual bonds</span>
                  <select
                    aria-label="Visual bonds"
                    value={visualBondsEnabled ? "auto" : "off"}
                    title="Display only; inferred from distances, not passed to calculations or structure exports."
                    onChange={(event) => setVisualBondsEnabled(event.currentTarget.value === "auto")}
                  >
                    <option value="auto">Auto</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                <label className="viz-quiet-label">
                  <span className="viz-label-text">View</span>
                  <select
                    aria-label="View preset"
                    value={state.presetView ?? "oblique"}
                    onChange={(event) =>
                      updateState({ presetView: event.currentTarget.value as VisualizationState["presetView"] })
                    }
                  >
                    <option value="oblique">Oblique</option>
                    <option value="front">Front (1)</option>
                    <option value="back">Back (2)</option>
                    <option value="left">Left (3)</option>
                    <option value="right">Right (4)</option>
                    <option value="top">Top (5)</option>
                    <option value="bottom">Bottom (6)</option>
                    <option value="isometric">Isometric (7)</option>
                    <option value="along-a">Along a</option>
                    <option value="along-b">Along b</option>
                    <option value="along-c">Along c</option>
                    <option value="along-a-star">Along a*</option>
                  </select>
                </label>
            </>
          ) : null}
          {showExport ? <ActionButton small minimal icon="camera" text="Export" onClick={exportPng} title="Export PNG image" /> : null}
        </div>
        {hasCell ? (
          crystalCollapsed ? (
            <AppPopover
              placement="bottom-end"
              content={<div className="viz-crystal-popover" role="group" aria-label="Crystal">{crystalControls}</div>}
            >
              <button type="button" className="bp6-button bp6-minimal bp6-small viz-more-controls-btn" aria-label="More controls" data-testid="viz-more-controls-btn">
                <span>More controls ▾</span>
              </button>
            </AppPopover>
          ) : (
            <div className="viz-group" role="group" aria-label="Crystal" data-testid="viz-group-crystal">
              <span className="viz-group-caption" aria-hidden="true">Crystal</span>
              {crystalControls}
            </div>
          )
        ) : null}
      </div>

      <div ref={viewportRef} className="scientific-viewport" data-renderer-mode="canonical">
        <StructureViewport
          key={fitRevision}
          scene={scene}
          state={rendererState}
          visualBonds={visualBonds}
          arrows={arrows}
          fitToken={fitRevision}
          selectedAtomIndex={selectedAtomIndex}
          measurementAtomIndices={measurementAtomIndices}
          onSelectAtom={selectAtom}
          onStateChange={updateState}
          cameraStorageKey={persistenceKey ? `${persistenceKey}:camera` : undefined}
        />
      </div>

      {compact && measurementKind === "none" ? null : <VisualizationStatus
        scene={scene}
        visualBondsCount={visualBonds.length}
        selectedAtomIndex={selectedAtomIndex}
        measurementKind={measurementKind}
        measurementAtomIndices={measurementAtomIndices}
        measurement={measurement}
      />}
      {message ? (
        <div className="visualization-message">
          <AppIcon icon="info-sign" /> {message}
        </div>
      ) : null}
    </section>
  );
}

function VisualizationStatus({
  scene,
  visualBondsCount,
  selectedAtomIndex,
  measurementKind,
  measurementAtomIndices,
  measurement,
}: {
  scene: ScientificScene;
  visualBondsCount: number;
  selectedAtomIndex: number | null;
  measurementKind: MeasurementKind | "none";
  measurementAtomIndices: readonly number[];
  measurement: MeasurementResult | null;
}) {
  return (
    <div className="visualization-status" aria-label="Visualization status">
      <span>{scene.atoms.length} atoms</span>
      <span>{scene.bonds.length} authoritative bonds</span>
      {visualBondsCount > 0 ? <span>{visualBondsCount} inferred visual bonds</span> : null}
      <span>Display unit: Å</span>
      <span>Selected atom: {selectedAtomIndex ?? "none"}</span>
      <span>
        Measurement:{" "}
        {measurement
          ? `${measurementKind} ${scene.atoms.length ? measurementAtomIndices.map((i) => `${scene.atoms[i]?.element ?? "?"}${i + 1}`).join("–") : ""}: ${formatMeasurement(measurement)} (${measurement.convention})`
          : measurementKind === "none"
            ? "off"
            : `${measurementKind}; select ${requiredAtoms(measurementKind) - measurementAtomIndices.length} more atom(s)`}
      </span>
    </div>
  );
}

function parseSupercell(value: string): VisualizationState["supercell"] {
  const [nx = "1", ny = "1", nz = "1"] = value.split("x");
  return { nx: Number(nx), ny: Number(ny), nz: Number(nz) };
}

function requiredAtoms(kind: MeasurementKind | "none"): number {
  if (kind === "distance") return 2;
  if (kind === "angle") return 3;
  if (kind === "dihedral") return 4;
  return 0;
}
