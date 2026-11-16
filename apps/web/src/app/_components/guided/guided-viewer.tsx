"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  buildScientificScene, DEFAULT_VISUALIZATION_STATE, inferVisualBonds, measureScene,
  type MeasurementKind, type VisualizationState,
} from "@chemdft/scientific-scene";
import type { StructureVersionDetail } from "@chemdft/schemas";
import { AppIcon } from "@chemdft/ui";
import { structureConnectivity } from "@/lib/structure-connectivity";
import { atomColor, elementName } from "@/lib/visualization/renderer-utils";
import { ViewerToolbar } from "@/app/_components/viewer-toolbar";
import styles from "./guided-workspace.module.css";

const StructureViewport = dynamic(
  () => import("../../[locale]/projects/[projectId]/workspace/visualization/structure-viewport"),
  {
    ssr: false,
    loading: () => (
      <div className="viewport-fallback" role="status">
        <span className="guided-spinner" aria-hidden="true" />
        <p>Loading 3D Scientific View…</p>
      </div>
    ),
  },
);

/**
 * The persistent molecular view of the Guided workspace. It stays mounted while the researcher moves between
 * Structure, Configure and Review & Submit, so atom selection, measurements and the camera survive. Only the
 * committed coordinates are drawn; bonds are the stored ones, and when none are stored the note below says the
 * drawn bonds are inferred for display only.
 */
export function GuidedViewer({ detail }: { detail: StructureVersionDetail }) {
  const [representation, setRepresentation] = useState<VisualizationState["representation"]>("ball-stick");
  const [labels, setLabels] = useState<VisualizationState["labels"]>("none");
  const state = useMemo<VisualizationState>(() => ({ ...DEFAULT_VISUALIZATION_STATE, representation, labels }), [representation, labels]);
  const [selectedAtomIndex, setSelectedAtomIndex] = useState<number | null>(null);
  const [measurementKind, setMeasurementKind] = useState<MeasurementKind | "none">("none");
  const [measurementAtomIndices, setMeasurementAtomIndices] = useState<number[]>([]);
  const [fitToken, setFitToken] = useState(0);

  const sceneResult = useMemo(() => {
    try { return { scene: buildScientificScene(detail), error: null }; }
    catch (error) { return { scene: null, error: error instanceof Error ? error.message : "Structure coordinates unavailable." }; }
  }, [detail]);
  const scene = sceneResult.scene;
  const connectivity = useMemo(() => structureConnectivity(scene), [scene]);
  const visualBonds = useMemo(() => (scene ? inferVisualBonds(scene) : []), [scene]);
  const elements = useMemo(() => (scene ? Array.from(new Set(scene.atoms.map((a) => a.element))).map((el) => ({ element: el, name: elementName(el), color: atomColor(el, state) })) : []), [scene, state]);

  const measurement = useMemo(() => {
    const required = measurementKind === "distance" ? 2 : measurementKind === "angle" ? 3 : 4;
    if (!scene || measurementKind === "none" || measurementAtomIndices.length !== required) return null;
    return measureScene(scene, measurementKind, measurementAtomIndices);
  }, [scene, measurementKind, measurementAtomIndices]);

  function selectAtom(index: number) {
    setSelectedAtomIndex(index);
    if (measurementKind !== "none") {
      const count = measurementKind === "distance" ? 2 : measurementKind === "angle" ? 3 : 4;
      setMeasurementAtomIndices((old) => [...old.filter((i) => i !== index), index].slice(-count));
    }
  }
  function toggleMeasure(kind: "distance" | "angle") {
    setMeasurementKind((prev) => (prev === kind ? "none" : kind));
    setMeasurementAtomIndices([]);
  }
  const selected = selectedAtomIndex !== null ? scene?.atoms[selectedAtomIndex] : undefined;

  return (
    <section className={styles.viewerPanel} aria-label="Molecular view" data-testid="guided-viewer">
      <div className={styles.toolbar}>
        <ul className={styles.legend} aria-label="Elements shown">
          {elements.map((el) => (
            <li key={el.element}><i aria-hidden="true" style={{ backgroundColor: el.color }} /><strong>{el.element}</strong> {el.name}</li>
          ))}
        </ul>
      </div>
      <ViewerToolbar
        testIdPrefix="guided"
        style={representation}
        styleOptions={[{ value: "ball-stick", label: "Ball and stick" }, { value: "space-fill", label: "Space filling" }]}
        styleButtons={[
          { value: "ball-stick", label: "Ball and stick", testId: "guided-style-ball-stick", title: "Ball and stick view" },
          { value: "space-fill", label: "Space filling", testId: "guided-style-space-fill", title: "Space-filling van der Waals view" },
        ]}
        onStyleChange={(value) => setRepresentation(value as VisualizationState["representation"])}
        onReset={() => setFitToken((n) => n + 1)}
        resetTestId="guided-reset-view-btn"
        resetTitle="Center and fit the molecule in view"
        labels={{
          value: labels,
          options: [
            { value: "none", label: "None" },
            { value: "element", label: "Element" },
            { value: "index", label: "Atom index" },
          ],
          onChange: (val) => setLabels(val as VisualizationState["labels"]),
        }}
        structureFacts={{
          formula: detail.structure.name,
          atoms: scene?.atoms.length ?? 0,
          charge: detail.version.overall_charge,
          multiplicity: detail.version.multiplicity,
          source: detail.version.origin,
        }}
        measure={{ active: measurementKind === "distance" || measurementKind === "angle" ? measurementKind : "none", onChange: (kind) => { if (kind === "none") { setMeasurementKind("none"); setMeasurementAtomIndices([]); } else toggleMeasure(kind); } }}
        measureTestIds={{ distance: "guided-measure-distance-btn", angle: "guided-measure-angle-btn" }}
      />
      <div className={styles.canvas}>
        {scene ? (
          <StructureViewport
            scene={scene} state={state} representation={representation} visualBonds={visualBonds} fitToken={fitToken}
            selectedAtomIndex={selectedAtomIndex} measurementAtomIndices={measurementAtomIndices} onSelectAtom={selectAtom}
          />
        ) : (
          <div className="viewport-fallback"><AppIcon icon="warning-sign" /><p>{sceneResult.error ?? "Failed to construct scientific scene."}</p></div>
        )}
      </div>
      {measurement ? (
        <div className={styles.measure} data-testid="guided-measurement-banner">
          <AppIcon icon="flows" />
          <span><strong>{measurement.kind.toUpperCase()}:</strong> {measurement.value.toFixed(3)} {measurement.unit === "angstrom" ? "Å" : "°"}</span>
          <button type="button" className={styles.secondary} onClick={() => setMeasurementAtomIndices([])}>Clear</button>
        </div>
      ) : measurementKind !== "none" ? (
        <div className={styles.measure}><AppIcon icon="info-sign" /><span>Click {measurementKind === "distance" ? "2 atoms" : "3 atoms"} to measure the {measurementKind}.</span></div>
      ) : null}
      <div className={styles.viewerNote}>
        {selected ? <span data-testid="guided-selected-atom"><strong>{selected.element}</strong> atom {selectedAtomIndex! + 1} selected</span> : <span>Drag to rotate · scroll to zoom · click an atom to select</span>}
        <span data-testid="structure-connectivity" data-connectivity={connectivity.status}>{connectivity.text}</span>
      </div>
    </section>
  );
}
