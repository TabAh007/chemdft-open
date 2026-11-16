"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { hasWebGl } from "@/lib/visualization/webgl";

import {
  DEFAULT_VISUALIZATION_STATE,
  displayAtomsAndBondsForCrystal,
  presetCameraDirection,
  trackballRotate,
  turntableRotate,
  type Quaternion4,
  type RenderableSceneData,
  type ScientificSceneBond,
  type Vec3,
  type ViewPreset,
  type VisualBond,
  type VisualizationState,
} from "@chemdft/scientific-scene";
import {
  computeContentBounds,
  drawCreditLine,
  insertPng300DpiToDataUrl,
} from "@/lib/visualization/snapshot-processor";

import {
  atomColor,
  atomRadius,
  bondRadius,
  calculateCanonicalCameraDistance,
  calculateSnapshotDimensions,
  calculateTwoColorBondSegments,
  cellLineSegments,
  computeSceneAndCellVisualBounds,
  elementName,
  sceneDisplayAtoms,
  shouldRenderBonds,
  stableBondOffset,
  type DisplayAtom,
} from "@/lib/visualization/renderer-utils";

export type StructureViewportProps = {
  scene: RenderableSceneData;
  state?: VisualizationState | undefined;
  representation?: VisualizationState["representation"] | undefined;
  labels?: VisualizationState["labels"] | undefined;
  visualBonds?: readonly VisualBond[] | undefined;
  fitToken?: number | undefined;
  selectedAtomIndex?: number | null | undefined;
  measurementAtomIndices?: readonly number[] | undefined;
  onSelectAtom?: ((atomIndex: number) => void) | undefined;
  onStateChange?: ((partial: Partial<VisualizationState>) => void) | undefined;
  cameraStorageKey?: string | undefined;
  onHoverAtom?: ((index: number | null) => void) | undefined;
  /** Display-only arrows (angstrom): origin and vector per atom, e.g. vibrational displacement. */
  arrows?: readonly DisplayArrow[] | undefined;
};

export type DisplayArrow = { origin: readonly [number, number, number]; vector: readonly [number, number, number] };

type Props = {
  scene: RenderableSceneData;
  state: VisualizationState;
  selectedAtomIndex: number | null;
  measurementAtomIndices: readonly number[];
  onSelectAtom: (atomIndex: number) => void;
  onStateChange?: ((partial: Partial<VisualizationState>) => void) | undefined;
  cameraStorageKey?: string | undefined;
  visualBonds?: readonly VisualBond[] | undefined;
  fitToken?: number | undefined;
  onHoverAtom?: ((index: number | null) => void) | undefined;
  arrows?: readonly DisplayArrow[] | undefined;
};

export type HoveredAtomInfo = {
  element: string;
  name: string;
  index: number;
  x: number;
  y: number;
};

export function StructureViewport(props: StructureViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<StructureRuntime | null>(null);

  const resolvedState: VisualizationState = useMemo(() => {
    const base = props.state ?? DEFAULT_VISUALIZATION_STATE;
    return {
      ...base,
      ...(props.representation ? { representation: props.representation } : {}),
      ...(props.labels ? { labels: props.labels } : {}),
    };
  }, [props.state, props.representation, props.labels]);

  const resolvedProps: Props = useMemo(() => ({
    scene: props.scene,
    state: resolvedState,
    visualBonds: props.visualBonds,
    arrows: props.arrows,
    fitToken: props.fitToken,
    selectedAtomIndex: props.selectedAtomIndex ?? null,
    measurementAtomIndices: props.measurementAtomIndices ?? [],
    onSelectAtom: props.onSelectAtom ?? (() => undefined),
    onStateChange: props.onStateChange,
    cameraStorageKey: props.cameraStorageKey,
    onHoverAtom: props.onHoverAtom,
  }), [props.scene, resolvedState, props.visualBonds, props.arrows, props.fitToken, props.selectedAtomIndex, props.measurementAtomIndices, props.onSelectAtom, props.onStateChange, props.cameraStorageKey, props.onHoverAtom]);

  const latestPropsRef = useRef(resolvedProps);
  const [retry, setRetry] = useState(0);
  const [hoveredAtom, setHoveredAtom] = useState<HoveredAtomInfo | null>(null);
  const [error, setError] = useState<string | null>(() => (
    typeof document !== "undefined" && !hasWebGl()
      ? "WEBGL_UNAVAILABLE: Browser WebGL is unavailable. Exact coordinates remain available in Inspector."
      : null
  ));

  const legendElements = useMemo(() => {
    const set = new Set<string>();
    for (const a of props.scene.atoms) set.add(a.element);
    return Array.from(set);
  }, [props.scene.atoms]);

  const showLegend = resolvedState.legendVisible ?? (props.scene.kind === "PERIODIC");

  useEffect(() => {
    latestPropsRef.current = resolvedProps;
  }, [resolvedProps]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || error) return;
    if (!hasWebGl()) {
      queueMicrotask(() => setError("WebGL is unavailable. Exact coordinates remain in Inspector."));
      return;
    }
    try {
      const runtime = createRuntime(
        host,
        () => latestPropsRef.current,
        (message) => {
          runtimeRef.current?.dispose();
          runtimeRef.current = null;
          setError(message);
        },
        (hover) => {
          setHoveredAtom(hover);
          latestPropsRef.current.onHoverAtom?.(hover ? hover.index : null);
        },
      );
      runtimeRef.current = runtime;
      runtime.renderScene(resolvedProps);
      return () => {
        runtime.dispose();
        runtimeRef.current = null;
      };
    } catch {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
      queueMicrotask(() =>
        setError("RENDERER_INITIALIZATION_FAILED: Scientific View could not initialize. Open Inspector for exact coordinates, or retry.")
      );
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);

  useEffect(() => {
    try {
      runtimeRef.current?.renderScene(resolvedProps);
    } catch {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
      queueMicrotask(() => setError("Renderer unavailable. Inspect exact coordinates or retry."));
    }
  }, [resolvedProps]);

  const { onSelectAtom } = props;
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __chemdft_select_atom?: (index: number) => void }).__chemdft_select_atom = (index: number) => {
        onSelectAtom?.(index);
      };
      (window as unknown as { __chemdft_hover_atom?: (info: HoveredAtomInfo | null) => void }).__chemdft_hover_atom = (info: HoveredAtomInfo | null) => {
        setHoveredAtom(info);
      };
    }
    return () => {
      if (typeof window !== "undefined") {
        delete (window as unknown as { __chemdft_select_atom?: (index: number) => void }).__chemdft_select_atom;
        delete (window as unknown as { __chemdft_hover_atom?: (info: HoveredAtomInfo | null) => void }).__chemdft_hover_atom;
      }
    };
  }, [onSelectAtom]);

  if (error) {
    return (
      <div className="viewport-fallback" role="alert">
        {error}
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRetry((v) => v + 1);
          }}
        >
          Retry renderer
        </button>
      </div>
    );
  }

  const handlePresetClick = (preset: ViewPreset, event?: React.MouseEvent) => {
    (event?.currentTarget as HTMLElement)?.focus({ preventScroll: true });
    runtimeRef.current?.applyPreset(preset, true);
    props.onStateChange?.({ presetView: preset });
  };

  const handleToggleProjection = (event?: React.MouseEvent) => {
    (event?.currentTarget as HTMLElement)?.focus({ preventScroll: true });
    const next = resolvedState.camera.projection === "orthographic" ? "perspective" : "orthographic";
    props.onStateChange?.({
      camera: { ...resolvedState.camera, projection: next },
    });
  };

  const handleToggleKeepC = (event?: React.MouseEvent) => {
    (event?.currentTarget as HTMLElement)?.focus({ preventScroll: true });
    const next = !resolvedState.keepCVertical;
    props.onStateChange?.({ keepCVertical: next });
  };

  const handleFitClick = (event?: React.MouseEvent) => {
    (event?.currentTarget as HTMLElement)?.focus({ preventScroll: true });
    runtimeRef.current?.fitCamera();
    window.dispatchEvent(new Event("chemdft:fit-active-structure"));
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "3px 6px",
    fontSize: "11px",
    lineHeight: "13px",
    fontWeight: 500,
    borderRadius: "4px",
    border: "1px solid",
    borderColor: active ? "#2563eb" : "rgba(0, 0, 0, 0.15)",
    background: active ? "#2563eb" : "#ffffff",
    color: active ? "#ffffff" : "#1f2937",
    cursor: "pointer",
    transition: "background 150ms, color 150ms",
  });

  return (
    <div
      ref={hostRef}
      className="scientific-canvas structure-canvas"
      role="group"
      aria-label="Scientific View molecule viewport"
      style={{ position: "relative" }}
    >
      <div
        className="structure-view-bar"
        role="toolbar"
        aria-label="Camera view presets"
        title="Cartesian frame (z up): Front looks from -y, Back from +y, Left from -x, Right from +x, Top from +z, Bottom from -z."
        style={{
          position: "absolute",
          top: "10px",
          left: "10px",
          zIndex: 10,
          background: "rgba(255, 255, 255, 0.92)",
          border: "1px solid rgba(0, 0, 0, 0.12)",
          borderRadius: "6px",
          padding: "3px 6px",
          display: "flex",
          gap: "4px",
          alignItems: "center",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
          fontSize: "11px",
        }}
      >
        <button
          type="button"
          onClick={(e) => handlePresetClick("front", e)}
          style={btnStyle(resolvedState.presetView === "front")}
          title="Front view (1) — looking from -y"
          data-testid="view-bar-front"
        >
          Front
        </button>
        <button
          type="button"
          onClick={(e) => handlePresetClick("back", e)}
          style={btnStyle(resolvedState.presetView === "back")}
          title="Back view (2) — looking from +y"
          data-testid="view-bar-back"
        >
          Back
        </button>
        <button
          type="button"
          onClick={(e) => handlePresetClick("left", e)}
          style={btnStyle(resolvedState.presetView === "left")}
          title="Left view (3) — looking from -x"
          data-testid="view-bar-left"
        >
          Left
        </button>
        <button
          type="button"
          onClick={(e) => handlePresetClick("right", e)}
          style={btnStyle(resolvedState.presetView === "right")}
          title="Right view (4) — looking from +x"
          data-testid="view-bar-right"
        >
          Right
        </button>
        <button
          type="button"
          onClick={(e) => handlePresetClick("top", e)}
          style={btnStyle(resolvedState.presetView === "top")}
          title="Top view (5) — looking from +z"
          data-testid="view-bar-top"
        >
          Top
        </button>
        <button
          type="button"
          onClick={(e) => handlePresetClick("bottom", e)}
          style={btnStyle(resolvedState.presetView === "bottom")}
          title="Bottom view (6) — looking from -z"
          data-testid="view-bar-bottom"
        >
          Bottom
        </button>
        <button
          type="button"
          onClick={(e) => handlePresetClick("isometric", e)}
          style={btnStyle(resolvedState.presetView === "isometric")}
          title="Isometric view (7)"
          data-testid="view-bar-isometric"
        >
          Iso
        </button>
        {props.scene.cell ? (
          <>
            <span style={{ color: "rgba(0,0,0,0.2)" }}>|</span>
            <button
              type="button"
              onClick={(e) => handlePresetClick("along-a", e)}
              style={btnStyle(resolvedState.presetView === "along-a")}
              title="Along lattice vector a"
              data-testid="view-bar-along-a"
            >
              a
            </button>
            <button
              type="button"
              onClick={(e) => handlePresetClick("along-b", e)}
              style={btnStyle(resolvedState.presetView === "along-b")}
              title="Along lattice vector b"
              data-testid="view-bar-along-b"
            >
              b
            </button>
            <button
              type="button"
              onClick={(e) => handlePresetClick("along-c", e)}
              style={btnStyle(resolvedState.presetView === "along-c")}
              title="Along lattice vector c"
              data-testid="view-bar-along-c"
            >
              c
            </button>
            <button
              type="button"
              onClick={(e) => handlePresetClick("along-a-star", e)}
              style={btnStyle(resolvedState.presetView === "along-a-star")}
              title="Along reciprocal vector a*"
              data-testid="view-bar-along-a-star"
            >
              a*
            </button>
          </>
        ) : null}
        <span style={{ color: "rgba(0,0,0,0.2)" }}>|</span>
        <button
          type="button"
          onClick={(e) => handleToggleProjection(e)}
          style={btnStyle(false)}
          title="Toggle Perspective / Orthographic projection"
          data-testid="view-bar-projection"
        >
          {resolvedState.camera.projection === "orthographic" ? "Ortho" : "Persp"}
        </button>
        <button
          type="button"
          onClick={(e) => handleToggleKeepC(e)}
          style={btnStyle(Boolean(resolvedState.keepCVertical))}
          title="Keep c vertical (turntable mode)"
          data-testid="view-bar-keep-c"
        >
          Turntable
        </button>
        <button
          type="button"
          onClick={(e) => handleFitClick(e)}
          style={btnStyle(false)}
          title="Center and fit molecule in view"
          data-testid="view-bar-fit"
        >
          Fit
        </button>
      </div>
      {hoveredAtom ? (
        <div
          className="structure-hover-tooltip"
          role="tooltip"
          style={{
            position: "absolute",
            left: `${hoveredAtom.x}px`,
            top: `${hoveredAtom.y - 14}px`,
            transform: "translate(-50%, -100%)",
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          <strong>{hoveredAtom.name} ({hoveredAtom.element})</strong> · Atom {hoveredAtom.index + 1}
        </div>
      ) : null}
      {showLegend && legendElements.length > 0 ? (
        <div
          className="structure-legend-overlay"
          role="region"
          aria-label="Element legend"
          data-testid="structure-element-legend"
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            background: "rgba(255, 255, 255, 0.92)",
            border: "1px solid rgba(0, 0, 0, 0.12)",
            borderRadius: "6px",
            padding: "6px 10px",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
            pointerEvents: "none",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            fontSize: "12px",
            fontWeight: 500,
          }}
        >
          {legendElements.map((el) => (
            <div key={el} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  backgroundColor: atomColor(el, resolvedState),
                  border: "1px solid rgba(0, 0, 0, 0.2)",
                }}
              />
              <span>{elementName(el)} ({el})</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default StructureViewport;

type StructureRuntime = {
  renderScene: (props: Props) => void;
  applyPreset: (preset: ViewPreset, animated?: boolean) => void;
  toggleProjection: () => void;
  fitCamera: () => void;
  dispose: () => void;
};

function createRuntime(
  host: HTMLDivElement,
  getProps: () => Props,
  onError: (message: string) => void,
  onHover: (hover: HoveredAtomInfo | null) => void,
): StructureRuntime {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  host.append(renderer.domElement);
  const onContextLost = (event: Event) => {
    event.preventDefault();
    onError("WebGL context lost. Exact coordinates remain in Inspector. Retry the renderer.");
  };
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);

  const scene = new THREE.Scene();
  const perspectiveCamera = new THREE.PerspectiveCamera(35, 1, 0.01, 5000);
  const orthographicCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 5000);
  perspectiveCamera.position.set(0, 0, 14);
  orthographicCamera.position.set(0, 0, 14);
  const controls = new OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>(perspectiveCamera, renderer.domElement);
  controls.enabled = false;
  const group = new THREE.Group();
  scene.add(group);
  installLighting(renderer, scene, perspectiveCamera, orthographicCamera);

  let lastResizeWidth = 0;
  let lastResizeHeight = 0;
  const resizeObserver = new ResizeObserver(() => {
    if (disposed) return;
    if (!initialized && host.clientWidth > 0 && host.clientHeight > 0) {
      renderScene(getProps());
      return;
    }
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0 || (width === lastResizeWidth && height === lastResizeHeight)) return;
    lastResizeWidth = width;
    lastResizeHeight = height;
    resize();
    if (!hasUserInteracted) {
      fitCamera();
    }
  });
  resizeObserver.observe(host);

  let currentCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspectiveCamera;
  let initialized = false,
    disposed = false;
  let latestFitToken: number | undefined = -1,
    orthoSpan = 2;
  let previousProjection = "perspective";
  let previousRepresentation = getProps().state.representation;
  let previousPresetView = getProps().state.presetView;
  let hasUserInteracted = false;
  let animationFrame = 0;
  let atomInstanceMaps = new Map<THREE.InstancedMesh, readonly number[]>();

  const triadScene = new THREE.Scene();
  const triadCamera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 10);
  triadCamera.position.set(0, 0, 4);
  const triadGroup = new THREE.Group();
  triadScene.add(triadGroup);
  const triadA = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1.0, 0xd9534f, 0.25, 0.15);
  const triadB = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 1.0, 0x5cb85c, 0.25, 0.15);
  const triadC = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1.0, 0x0275d8, 0.25, 0.15);
  triadGroup.add(triadA, triadB, triadC);
  const tipA = createAxisLabelSprite("a", "#d9534f", 0.7); tipA.position.set(1.2, 0, 0);
  const tipB = createAxisLabelSprite("b", "#5cb85c", 0.7); tipB.position.set(0, 1.2, 0);
  const tipC = createAxisLabelSprite("c", "#0275d8", 0.7); tipC.position.set(0, 0, 1.2);
  triadGroup.add(tipA, tipB, tipC);

  let transitionAnimation: number | null = null;
  function animateCameraTo(targetPos: THREE.Vector3, targetQuat: THREE.Quaternion, targetPivot: THREE.Vector3, durationMs = 250) {
    if (transitionAnimation) cancelAnimationFrame(transitionAnimation);
    const startPos = currentCamera.position.clone();
    const startQuat = currentCamera.quaternion.clone();
    const startPivot = controls.target.clone();
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      currentCamera.position.lerpVectors(startPos, targetPos, ease);
      currentCamera.quaternion.slerpQuaternions(startQuat, targetQuat, ease);
      controls.target.lerpVectors(startPivot, targetPivot, ease);
      currentCamera.updateMatrixWorld();
      render();

      if (t < 1) {
        transitionAnimation = requestAnimationFrame(step);
      } else {
        transitionAnimation = null;
      }
    }
    transitionAnimation = requestAnimationFrame(step);
  }

  function applyViewPreset(preset: ViewPreset, animated = true) {
    const currentProps = getProps();
    const cell = currentProps.scene.cell;
    const p = presetCameraDirection(preset, cell);
    const direction = new THREE.Vector3(...p.direction).normalize();
    const cameraUp = new THREE.Vector3(...p.up).normalize();

    const dist = currentCamera.position.distanceTo(controls.target);
    const targetPos = controls.target.clone().add(direction.clone().multiplyScalar(dist));

    const m = new THREE.Matrix4();
    m.lookAt(targetPos, controls.target, cameraUp);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    if (!animated) {
      currentCamera.position.copy(targetPos);
      currentCamera.quaternion.copy(targetQuat);
      currentCamera.up.copy(cameraUp);
      currentCamera.lookAt(controls.target);
      currentCamera.updateMatrixWorld();
      render();
    } else {
      animateCameraTo(targetPos, targetQuat, controls.target, 250);
    }
  }

  function toggleProjection() {
    const currentProps = getProps();
    const nextProj = currentProps.state.camera.projection === "orthographic" ? "perspective" : "orthographic";
    currentProps.onStateChange?.({
      camera: { ...currentProps.state.camera, projection: nextProj },
    });
  }

  let pointerDown: { x: number; y: number } | null = null;
  let isDragging = false;
  let dragButton = 0;
  let dragShift = false;
  let lastX = 0;
  let lastY = 0;

  renderer.domElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    pointerDown = { x: event.clientX, y: event.clientY };
    isDragging = true;
    dragButton = event.button;
    dragShift = event.shiftKey;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
    hasUserInteracted = true;
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!isDragging) {
      handlePointerMove(event);
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    if (dragButton === 0 && !dragShift) {
      // Trackball arcball rotation: object follows cursor
      const dist = currentCamera.position.distanceTo(controls.target);
      const curCamQ = currentCamera.quaternion;
      const viewQ = curCamQ.clone().invert();
      const qIn: Quaternion4 = [viewQ.x, viewQ.y, viewQ.z, viewQ.w];
      const qOut = getProps().state.keepCVertical
        ? turntableRotate(dx, -dy, qIn, 0.005)
        : trackballRotate(dx, -dy, qIn, { sensitivity: 0.005 });
      const newCamQ = new THREE.Quaternion(qOut[0], qOut[1], qOut[2], qOut[3]).invert();
      currentCamera.quaternion.copy(newCamQ);
      const offset = new THREE.Vector3(0, 0, dist).applyQuaternion(newCamQ);
      currentCamera.position.copy(controls.target).add(offset);
      currentCamera.updateMatrixWorld();
      render();
    } else if (dragButton === 2 || (dragButton === 0 && dragShift)) {
      // Pan: right drag or Shift + left drag
      const width = host.clientWidth || 800;
      const height = host.clientHeight || 600;
      const aspect = width / height;
      let panX = 0;
      let panY = 0;
      if (currentCamera instanceof THREE.PerspectiveCamera) {
        const vDist = currentCamera.position.distanceTo(controls.target);
        const fovRad = THREE.MathUtils.degToRad(currentCamera.fov);
        const vHeight = 2 * vDist * Math.tan(fovRad * 0.5);
        panX = -(dx / width) * vHeight * aspect;
        panY = (dy / height) * vHeight;
      } else {
        panX = -(dx / width) * (orthoSpan * 2 * aspect);
        panY = (dy / height) * (orthoSpan * 2);
      }
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(currentCamera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(currentCamera.quaternion);
      const panVec = right.multiplyScalar(panX).add(up.multiplyScalar(panY));
      controls.target.add(panVec);
      currentCamera.position.add(panVec);
      currentCamera.updateMatrixWorld();
      render();
    }
  });

  const stopDrag = (event: PointerEvent) => {
    if (isDragging) {
      isDragging = false;
      try {
        renderer.domElement.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
  };
  renderer.domElement.addEventListener("pointerup", stopDrag);
  renderer.domElement.addEventListener("pointercancel", stopDrag);

  renderer.domElement.addEventListener("wheel", (event) => {
    event.preventDefault();
    hasUserInteracted = true;
    const zoomFactor = event.deltaY < 0 ? 0.92 : 1.08;
    if (currentCamera instanceof THREE.PerspectiveCamera) {
      const dist = currentCamera.position.distanceTo(controls.target);
      const newDist = Math.max(0.1, Math.min(2000, dist * zoomFactor));
      const dir = currentCamera.position.clone().sub(controls.target).normalize();
      currentCamera.position.copy(controls.target).add(dir.multiplyScalar(newDist));
    } else if (currentCamera instanceof THREE.OrthographicCamera) {
      orthoSpan = Math.max(0.01, Math.min(2000, orthoSpan * zoomFactor));
      resize();
    }
    render();
  }, { passive: false });

  renderer.domElement.addEventListener("click", (event) => {
    if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = rect.height - (event.clientY - rect.top);
    // Triad viewport: bottom-left 12px to 84px from left and bottom
    if (clickX >= 12 && clickX <= 84 && clickY >= 12 && clickY <= 84) {
      const u = ((clickX - 12) / 72) * 2 - 1;
      const v = ((clickY - 12) / 72) * 2 - 1;
      const ptA = tipA.position.clone().project(triadCamera);
      const ptB = tipB.position.clone().project(triadCamera);
      const ptC = tipC.position.clone().project(triadCamera);
      const distA = Math.hypot(u - ptA.x, v - ptA.y);
      const distB = Math.hypot(u - ptB.x, v - ptB.y);
      const distC = Math.hypot(u - ptC.x, v - ptC.y);
      const minDist = Math.min(distA, distB, distC);
      if (minDist === distA) applyViewPreset("along-a", true);
      else if (minDist === distB) applyViewPreset("along-b", true);
      else applyViewPreset("along-c", true);
      return;
    }
    selectFromClick(event);
  });

  renderer.domElement.addEventListener("dblclick", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, currentCamera);
    const intersections = raycaster.intersectObjects(Array.from(atomInstanceMaps.keys()));
    const hit = intersections[0];
    if (hit && hit.instanceId != null) {
      const map = atomInstanceMaps.get(hit.object as THREE.InstancedMesh);
      const atomIndex = map?.[hit.instanceId];
      if (atomIndex != null) {
        const sceneAtoms = getProps().scene.atoms;
        const atom = sceneAtoms.find((a) => a.index === atomIndex);
        if (atom) {
          const newTarget = new THREE.Vector3(atom.position[0], atom.position[1], atom.position[2]);
          const shift = newTarget.clone().sub(controls.target);
          controls.target.copy(newTarget);
          currentCamera.position.add(shift);
          render();
          return;
        }
      }
    }
    fitCamera();
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }
    const keyMap: Record<string, ViewPreset> = {
      "1": "front",
      "2": "back",
      "3": "left",
      "4": "right",
      "5": "top",
      "6": "bottom",
      "7": "isometric",
    };
    const preset = keyMap[event.key];
    if (preset) {
      event.preventDefault();
      applyViewPreset(preset, true);
      getProps().onStateChange?.({ presetView: preset });
    }
  }
  window.addEventListener("keydown", handleKeyDown);

  renderer.domElement.addEventListener("pointerleave", () => {
    onHover(null);
  });

  function handlePointerMove(event: MouseEvent) {
    if (disposed || atomInstanceMaps.size === 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, currentCamera);
    const intersections = raycaster.intersectObjects(Array.from(atomInstanceMaps.keys()));
    const hit = intersections[0];
    if (!hit || hit.instanceId == null) {
      onHover(null);
      return;
    }
    const map = atomInstanceMaps.get(hit.object as THREE.InstancedMesh);
    const atomIndex = map?.[hit.instanceId];
    if (atomIndex != null) {
      const sceneAtoms = getProps().scene.atoms;
      const atom = sceneAtoms.find((a) => a.index === atomIndex);
      if (atom) {
        const atomPos3D = new THREE.Vector3(atom.position[0], atom.position[1], atom.position[2]);
        atomPos3D.project(currentCamera);
        const screenX = ((atomPos3D.x + 1) * 0.5) * rect.width;
        const screenY = ((-atomPos3D.y + 1) * 0.5) * rect.height;
        onHover({
          element: atom.element,
          name: elementName(atom.element),
          index: atom.index,
          x: screenX,
          y: screenY,
        });
        return;
      }
    }
    onHover(null);
  }

  function renderScene(props: Props): void {
    if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return;
    disposeGroup(group);
    group.clear();
    scene.background = studioBackground(props.state.background);
    currentCamera = props.state.camera.projection === "orthographic" ? orthographicCamera : perspectiveCamera;
    if (initialized && previousProjection !== props.state.camera.projection) {
      const previousCamera = controls.object;
      currentCamera.position.copy(previousCamera.position);
      currentCamera.quaternion.copy(previousCamera.quaternion);
      orthoSpan = currentCamera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(35 / 2));
      currentCamera.zoom = 1;
    }
    previousProjection = props.state.camera.projection;
    controls.object = currentCamera;

    const visualBonds = props.visualBonds ?? [];
    const bondGroup = new THREE.Group();
    bondGroup.name = "bonds";
    group.add(bondGroup);

    const polyhedraGroup = new THREE.Group();
    polyhedraGroup.name = "polyhedra";
    group.add(polyhedraGroup);

    const cellGroup = new THREE.Group();
    cellGroup.name = "cell";
    group.add(cellGroup);

    const labelsGroup = new THREE.Group();
    labelsGroup.name = "labels";
    group.add(labelsGroup);

    atomInstanceMaps = buildAtoms(group, props);
    if (shouldRenderBonds(props.state.representation)) {
      buildBonds(bondGroup, props.scene, visualBonds, props.state);
    }
    if (props.state.polyhedraVisible) {
      buildPolyhedra(polyhedraGroup, props.scene, visualBonds, props.state);
    }
    if (props.state.unitCellVisible) buildCell(cellGroup, props);
    buildSelection(group, props);
    buildMeasurements(group, props);
    buildLabels(labelsGroup, props);
    buildArrows(group, props);
    resize();

    const representationChanged = props.state.representation !== previousRepresentation;
    previousRepresentation = props.state.representation;
    const presetChanged = props.state.presetView !== previousPresetView;
    previousPresetView = props.state.presetView;

    if (props.scene.cell) {
      const [va, vb, vc] = props.scene.cell.latticeVectors;
      triadA.setDirection(new THREE.Vector3(...va).normalize());
      triadB.setDirection(new THREE.Vector3(...vb).normalize());
      triadC.setDirection(new THREE.Vector3(...vc).normalize());
      tipA.position.copy(new THREE.Vector3(...va).normalize().multiplyScalar(1.2));
      tipB.position.copy(new THREE.Vector3(...vb).normalize().multiplyScalar(1.2));
      tipC.position.copy(new THREE.Vector3(...vc).normalize().multiplyScalar(1.2));
    } else {
      triadA.setDirection(new THREE.Vector3(1, 0, 0));
      triadB.setDirection(new THREE.Vector3(0, 1, 0));
      triadC.setDirection(new THREE.Vector3(0, 0, 1));
      tipA.position.set(1.2, 0, 0);
      tipB.position.set(0, 1.2, 0);
      tipC.position.set(0, 0, 1.2);
    }

    if (!initialized) {
      let restored = false;
      try {
        const saved = JSON.parse(localStorage.getItem(props.cameraStorageKey ?? "") ?? "null");
        if (
          saved &&
          [saved.position, saved.target].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) &&
          Number.isFinite(saved.orthoSpan) &&
          saved.orthoSpan > 0 &&
          Number.isFinite(saved.zoom) &&
          saved.zoom > 0
        ) {
          currentCamera.position.fromArray(saved.position);
          controls.target.fromArray(saved.target);
          if (currentCamera.position.distanceTo(controls.target) > 0.01) {
            orthoSpan = saved.orthoSpan;
            currentCamera.zoom = saved.zoom;
            controls.update();
            restored = true;
          }
        }
      } catch {
        /* Invalid display preferences are ignored. */
      }
      if (!restored) fitCamera();
    } else if (props.fitToken !== latestFitToken) {
      hasUserInteracted = false;
      fitCamera();
    } else if (presetChanged) {
      hasUserInteracted = false;
      if (props.state.presetView) {
        applyViewPreset(props.state.presetView, initialized);
      } else {
        fitCamera();
      }
    } else if (representationChanged && !hasUserInteracted) {
      fitCamera();
    }
    latestFitToken = props.fitToken;
    initialized = true;

    host.dataset.authoritativeBonds = String(props.scene.bonds.length);
    host.dataset.visualBonds = String(visualBonds.length);
    host.dataset.atomCount = String(props.scene.atoms.length);
    resize();
    render();
  }

  function resize(): void {
    if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    renderer.setSize(width, height, false);
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();
    const span = orthoSpan;
    orthographicCamera.left = -span * (width / height);
    orthographicCamera.right = span * (width / height);
    orthographicCamera.top = span;
    orthographicCamera.bottom = -span;
    orthographicCamera.updateProjectionMatrix();
    render();
  }

  function render(): void {
    if (disposed) return;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => {
      if (disposed) return;
      renderer.render(scene, currentCamera);
      const currentProps = getProps();
      if (currentProps.scene.kind === "PERIODIC" || currentProps.state.unitCellVisible) {
        const triadPixelSize = 72;
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.setScissorTest(true);
        renderer.setScissor(12, 12, triadPixelSize, triadPixelSize);
        renderer.setViewport(12, 12, triadPixelSize, triadPixelSize);
        triadGroup.quaternion.copy(currentCamera.quaternion).invert();
        renderer.render(triadScene, triadCamera);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, host.clientWidth, host.clientHeight);
        renderer.autoClear = true;
      }
      const saved = {
        position: currentCamera.position.toArray(),
        target: controls.target.toArray(),
        orthoSpan,
        zoom: currentCamera.zoom,
      };
      host.dataset.camera = JSON.stringify(saved);
      if (initialized && getProps().cameraStorageKey) {
        try {
          localStorage.setItem(getProps().cameraStorageKey!, JSON.stringify(saved));
        } catch {
          /* Storage is optional */
        }
      }
    });
  }

  interface SnapshotExportOptions {
    cropToContent?: boolean;
    showLegend?: boolean;
    showTriad?: boolean;
    showCellLabels?: boolean;
    showPolyhedra?: boolean;
    showCellOutline?: boolean;
    bondColorMode?: "split" | "uniform";
    addCreditLine?: boolean;
  }

  function exportSnapshot(
    scale: 1 | 2 | 4,
    bg: "white" | "transparent",
    filename?: string,
    options?: SnapshotExportOptions,
  ): void {
    if (disposed) return;
    const currentProps = getProps();
    const width = host.clientWidth || 800;
    const height = host.clientHeight || 600;
    const { width: targetWidth, height: targetHeight } = calculateSnapshotDimensions(width, height, scale);

    const prevClearColor = new THREE.Color();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(prevClearColor);
    const prevBg = scene.background;

    renderer.setPixelRatio(1);
    renderer.setSize(targetWidth, targetHeight, false);

    if (bg === "transparent") {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
    } else {
      scene.background = new THREE.Color("#ffffff");
      renderer.setClearColor(0xffffff, 1);
    }

    const aspect = targetWidth / targetHeight;
    if (currentCamera instanceof THREE.PerspectiveCamera) {
      currentCamera.aspect = aspect;
      currentCamera.updateProjectionMatrix();
    } else if (currentCamera instanceof THREE.OrthographicCamera) {
      const span = orthoSpan;
      currentCamera.left = -span * aspect;
      currentCamera.right = span * aspect;
      currentCamera.top = span;
      currentCamera.bottom = -span;
      currentCamera.updateProjectionMatrix();
    }

    const bondGroup = group.getObjectByName("bonds") as THREE.Group | undefined;
    const polyhedraGroup = group.getObjectByName("polyhedra") as THREE.Group | undefined;
    const cellGroup = group.getObjectByName("cell") as THREE.Group | undefined;
    const labelsGroup = group.getObjectByName("labels") as THREE.Group | undefined;

    const prevPolyVisible = polyhedraGroup ? polyhedraGroup.visible : true;
    const prevCellVisible = cellGroup ? cellGroup.visible : true;
    const prevLabelsVisible = labelsGroup ? labelsGroup.visible : true;

    if (options?.showPolyhedra === false && polyhedraGroup) polyhedraGroup.visible = false;
    if (options?.showCellOutline === false && cellGroup) cellGroup.visible = false;
    if (options?.showCellLabels === false && labelsGroup) labelsGroup.visible = false;

    let restoredBonds = false;
    if (options?.bondColorMode === "uniform" && bondGroup) {
      disposeGroup(bondGroup);
      bondGroup.clear();
      buildBonds(bondGroup, currentProps.scene, currentProps.visualBonds ?? [], currentProps.state, "#9ca3af");
      restoredBonds = true;
    }

    renderer.render(scene, currentCamera);

    const showTriad =
      options?.showTriad !== false &&
      (currentProps.scene.kind === "PERIODIC" || currentProps.state.unitCellVisible);
    if (showTriad) {
      const triadPixelSize = Math.round(72 * (targetWidth / width));
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.setScissorTest(true);
      renderer.setScissor(
        Math.round(12 * (targetWidth / width)),
        Math.round(12 * (targetHeight / height)),
        triadPixelSize,
        triadPixelSize,
      );
      renderer.setViewport(
        Math.round(12 * (targetWidth / width)),
        Math.round(12 * (targetHeight / height)),
        triadPixelSize,
        triadPixelSize,
      );
      triadGroup.quaternion.copy(currentCamera.quaternion).invert();
      renderer.render(triadScene, triadCamera);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, targetWidth, targetHeight);
      renderer.autoClear = true;
    }

    if (polyhedraGroup) polyhedraGroup.visible = prevPolyVisible;
    if (cellGroup) cellGroup.visible = prevCellVisible;
    if (labelsGroup) labelsGroup.visible = prevLabelsVisible;
    if (restoredBonds && bondGroup) {
      disposeGroup(bondGroup);
      bondGroup.clear();
      buildBonds(bondGroup, currentProps.scene, currentProps.visualBonds ?? [], currentProps.state);
    }

    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = targetWidth;
    compositeCanvas.height = targetHeight;
    const ctx = compositeCanvas.getContext("2d");
    if (ctx) {
      if (bg === "white") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetWidth, targetHeight);
      }
      ctx.drawImage(renderer.domElement, 0, 0, targetWidth, targetHeight);

      const showLegend =
        options?.showLegend !== false &&
        (currentProps.state.legendVisible ?? (currentProps.scene.kind === "PERIODIC"));
      if (showLegend) {
        const set = new Set<string>();
        for (const a of currentProps.scene.atoms) set.add(a.element);
        const elements = Array.from(set);
        if (elements.length > 0) {
          const s = Math.max(1, targetHeight / height);
          const boxPadding = Math.round(10 * s);
          const itemHeight = Math.round(22 * s);
          const circleRadius = Math.round(6 * s);
          const fontSize = Math.max(12, Math.round(13 * s));
          ctx.font = `600 ${fontSize}px sans-serif`;

          let maxTextW = 0;
          for (const el of elements) {
            const txt = `${elementName(el)} (${el})`;
            const m = ctx.measureText(txt).width;
            if (m > maxTextW) maxTextW = m;
          }
          const boxW = Math.round(maxTextW + circleRadius * 2 + 24 * s + boxPadding * 2);
          const boxH = Math.round(elements.length * itemHeight + boxPadding * 2);
          const boxX = targetWidth - boxW - Math.round(16 * s);
          const boxY = Math.round(16 * s);

          ctx.fillStyle = bg === "white" ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.92)";
          ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
          ctx.lineWidth = Math.max(1, Math.round(1.5 * s));
          ctx.beginPath();
          const r = Math.round(6 * s);
          if (typeof ctx.roundRect === "function") {
            ctx.roundRect(boxX, boxY, boxW, boxH, r);
          } else {
            ctx.rect(boxX, boxY, boxW, boxH);
          }
          ctx.fill();
          ctx.stroke();

          elements.forEach((el, idx) => {
            const itemY = boxY + boxPadding + idx * itemHeight + itemHeight / 2;
            const circleX = boxX + boxPadding + circleRadius;
            ctx.beginPath();
            ctx.arc(circleX, itemY, circleRadius, 0, Math.PI * 2);
            ctx.fillStyle = atomColor(el, currentProps.state);
            ctx.fill();
            ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
            ctx.lineWidth = Math.max(1, Math.round(1 * s));
            ctx.stroke();

            ctx.fillStyle = "#111827";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(`${elementName(el)} (${el})`, circleX + circleRadius + Math.round(8 * s), itemY);
          });
        }
      }
    }

    let finalCanvas: HTMLCanvasElement = compositeCanvas;
    if (options?.cropToContent && ctx) {
      const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const bounds = computeContentBounds(imgData.data, targetWidth, targetHeight, bg);
      if (bounds) {
        const margin = Math.round(24 * (targetHeight / height));
        const cropX = Math.max(0, bounds.minX - margin);
        const cropY = Math.max(0, bounds.minY - margin);
        const cropW = Math.min(targetWidth - cropX, bounds.maxX - bounds.minX + 1 + margin * 2);
        const cropH = Math.min(targetHeight - cropY, bounds.maxY - bounds.minY + 1 + margin * 2);
        if (cropW > 0 && cropH > 0) {
          const croppedCanvas = document.createElement("canvas");
          croppedCanvas.width = cropW;
          croppedCanvas.height = cropH;
          const cropCtx = croppedCanvas.getContext("2d");
          if (cropCtx) {
            if (bg === "white") {
              cropCtx.fillStyle = "#ffffff";
              cropCtx.fillRect(0, 0, cropW, cropH);
            }
            cropCtx.drawImage(compositeCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            finalCanvas = croppedCanvas;
          }
        }
      }
    }

    if (options?.addCreditLine) {
      const finalCtx = finalCanvas.getContext("2d");
      if (finalCtx) {
        drawCreditLine(finalCtx, finalCanvas.width, finalCanvas.height, bg === "white" ? "white" : "transparent");
      }
    }

    const rawDataUrl = finalCanvas.toDataURL("image/png");
    const dataUrl = insertPng300DpiToDataUrl(rawDataUrl);

    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    scene.background = prevBg;
    resize();

    const a = document.createElement("a");
    a.href = dataUrl;
    const name =
      filename ||
      ((currentProps.scene as { name?: string }).name || currentProps.scene.id || "structure")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_");
    a.download = `chemdft-${name}-${scale}x.png`;
    a.click();
  }

  function handleSnapshotEvent(event: Event): void {
    const detail = (event as CustomEvent).detail;
    if (detail) {
      exportSnapshot(detail.scale ?? 1, detail.background ?? "white", detail.filename, {
        cropToContent: detail.cropToContent,
        showLegend: detail.showLegend,
        showTriad: detail.showTriad,
        showCellLabels: detail.showCellLabels,
        showPolyhedra: detail.showPolyhedra,
        showCellOutline: detail.showCellOutline,
        bondColorMode: detail.bondColorMode,
        addCreditLine: detail.addCreditLine,
      });
    }
  }
  window.addEventListener("chemdft:export-3d-snapshot", handleSnapshotEvent);

  function fitCamera(): void {
    if (host.clientWidth === 0 || host.clientHeight === 0) return;
    const currentProps = getProps();
    const atoms = sceneDisplayAtoms(currentProps.scene, currentProps.state);
    const cellPoints: Vec3[] = [];
    if (currentProps.state.unitCellVisible) {
      for (const [start, end] of cellLineSegments(currentProps.scene, currentProps.state.supercell)) {
        cellPoints.push(start, end);
      }
    }
    const bounds = computeSceneAndCellVisualBounds(atoms, cellPoints, currentProps.state.representation);
    const aspect = host.clientWidth / host.clientHeight;
    const { distance, orthoSpan: newOrthoSpan } = calculateCanonicalCameraDistance(
      bounds.radius,
      aspect,
      35,
      1.22,
    );
    const sphereCenter = new THREE.Vector3(...bounds.center);
    let direction: THREE.Vector3;
    let cameraUp = new THREE.Vector3(0, 0, 1);
    if (currentProps.state.presetView) {
      const p = presetCameraDirection(currentProps.state.presetView, currentProps.scene.cell);
      direction = new THREE.Vector3(...p.direction);
      cameraUp = new THREE.Vector3(...p.up);
    } else if (initialized) {
      direction = currentCamera.position.clone().sub(controls.target);
      cameraUp.copy(currentCamera.up);
    } else {
      direction = new THREE.Vector3(1.1, 1.6, 1.75);
      cameraUp.set(0, 0, 1);
    }
    if (direction.lengthSq() < 1e-8) direction.set(1.1, 1.6, 1.75);

    controls.target.copy(sphereCenter);
    currentCamera.up.copy(cameraUp);
    currentCamera.position.copy(sphereCenter.clone().add(direction.normalize().multiplyScalar(distance)));
    orthoSpan = newOrthoSpan;
    currentCamera.zoom = 1;
    currentCamera.near = Math.max(0.001, bounds.radius / 1000);
    currentCamera.far = Math.max(1000, distance + bounds.radius * 100);
    currentCamera.lookAt(sphereCenter);
    currentCamera.updateMatrixWorld();
    currentCamera.updateProjectionMatrix();

    // Collect all bounding points (atom sphere extents + unit cell vertices)
    const samplePoints: THREE.Vector3[] = [];
    for (const atom of atoms) {
      const r = atomRadius(atom.element, currentProps.state.representation);
      const [x, y, z] = atom.position;
      samplePoints.push(
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(x + r, y, z),
        new THREE.Vector3(x - r, y, z),
        new THREE.Vector3(x, y + r, z),
        new THREE.Vector3(x, y - r, z),
        new THREE.Vector3(x, y, z + r),
        new THREE.Vector3(x, y, z - r),
      );
    }
    for (const [x, y, z] of cellPoints) {
      samplePoints.push(new THREE.Vector3(x, y, z));
    }

    function getProjectedNdcBounds() {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const tmp = new THREE.Vector3();
      for (const pt of samplePoints) {
        tmp.copy(pt).project(currentCamera);
        if (tmp.x < minX) minX = tmp.x;
        if (tmp.x > maxX) maxX = tmp.x;
        if (tmp.y < minY) minY = tmp.y;
        if (tmp.y > maxY) maxY = tmp.y;
      }
      return {
        minX,
        maxX,
        minY,
        maxY,
        midX: (minX + maxX) * 0.5,
        midY: (minY + maxY) * 0.5,
      };
    }

    let pBounds = getProjectedNdcBounds();
    // Refine camera and target so the projected bounding box is centered within 0.5% of NDC (0, 0)
    for (let iter = 0; iter < 3; iter++) {
      if (Math.abs(pBounds.midX) < 0.005 && Math.abs(pBounds.midY) < 0.005) break;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(currentCamera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(currentCamera.quaternion);
      let shiftX = 0;
      let shiftY = 0;
      if (currentCamera instanceof THREE.PerspectiveCamera) {
        const tanV = Math.tan(THREE.MathUtils.degToRad(35 * 0.5));
        shiftX = pBounds.midX * (distance * tanV * aspect);
        shiftY = pBounds.midY * (distance * tanV);
      } else {
        shiftX = pBounds.midX * (orthoSpan * aspect);
        shiftY = pBounds.midY * orthoSpan;
      }
      controls.target.add(right.clone().multiplyScalar(shiftX)).add(up.clone().multiplyScalar(shiftY));
      currentCamera.position.add(right.clone().multiplyScalar(shiftX)).add(up.clone().multiplyScalar(shiftY));
      currentCamera.lookAt(controls.target);
      currentCamera.updateMatrixWorld();
      currentCamera.updateProjectionMatrix();
      pBounds = getProjectedNdcBounds();
    }
    controls.update();

    host.dataset.projectedBounds = JSON.stringify({
      minX: Number(pBounds.minX.toFixed(4)),
      maxX: Number(pBounds.maxX.toFixed(4)),
      minY: Number(pBounds.minY.toFixed(4)),
      maxY: Number(pBounds.maxY.toFixed(4)),
      midX: Number(pBounds.midX.toFixed(4)),
      midY: Number(pBounds.midY.toFixed(4)),
      allInside: pBounds.minX >= -1 && pBounds.maxX <= 1 && pBounds.minY >= -1 && pBounds.maxY <= 1,
    });
    host.dataset.fitCount = String(Number(host.dataset.fitCount ?? 0) + 1);
  }

  function selectFromClick(event: MouseEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, currentCamera);
    const intersections = raycaster.intersectObjects(Array.from(atomInstanceMaps.keys()));
    const hit = intersections[0];
    if (!hit || hit.instanceId == null) return;
    const map = atomInstanceMaps.get(hit.object as THREE.InstancedMesh);
    const atomIndex = map?.[hit.instanceId];
    if (atomIndex != null) getProps().onSelectAtom(atomIndex);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("chemdft:export-3d-snapshot", handleSnapshotEvent);
    cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    controls.dispose();
    disposeGroup(group);
    // Release the GPU context now; dispose() alone leaves it alive until GC, and browsers cap
    // live contexts (~16), so repeated viewer mounts otherwise end in "Too many active WebGL contexts".
    renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  return {
    renderScene,
    applyPreset: applyViewPreset,
    toggleProjection,
    fitCamera,
    dispose,
  };
}

/**
 * Shared molecule builder for atoms, used both in StructureViewport and OrbitalIsosurfaceViewport.
 */
export function buildAtoms(
  group: THREE.Group,
  props: { scene: RenderableSceneData; state: VisualizationState },
): Map<THREE.InstancedMesh, readonly number[]> {
  const atoms = sceneDisplayAtoms(props.scene, props.state);
  const scale = props.state.atomScale ?? 1;

  // Group by element and role (coordination image vs regular)
  type AtomGroup = { element: string; isCoordination: boolean; list: DisplayAtom[] };
  const groups = new Map<string, AtomGroup>();
  for (const atom of atoms) {
    const isCoord = Boolean(atom.isCoordinationImage || (atom as unknown as { role?: string }).role === "coordination-image");
    const key = `${atom.element}:${isCoord ? "coord" : "normal"}`;
    let g = groups.get(key);
    if (!g) {
      g = { element: atom.element, isCoordination: isCoord, list: [] };
      groups.set(key, g);
    }
    g.list.push(atom);
  }

  const maps = new Map<THREE.InstancedMesh, readonly number[]>();
  for (const { element, isCoordination, list: elementAtoms } of groups.values()) {
    const baseRadius = atomRadius(element, props.state.representation, scale);
    const radius = isCoordination ? baseRadius * 0.72 : baseRadius;
    const geometry = new THREE.SphereGeometry(radius, 36, 24);
    const material = new THREE.MeshStandardMaterial({
      color: atomColor(element, props.state),
      roughness: isCoordination ? 0.5 : 0.38,
      metalness: 0.04,
      transparent: isCoordination || elementAtoms.some((atom) => atom.occupancy != null && atom.occupancy < 1),
      opacity: isCoordination ? 0.65 : 1,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, elementAtoms.length);
    const matrix = new THREE.Matrix4();
    for (const [instance, atom] of elementAtoms.entries()) {
      matrix.makeTranslation(atom.position[0], atom.position[1], atom.position[2]);
      mesh.setMatrixAt(instance, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    maps.set(mesh, elementAtoms.map((atom) => atom.sourceAtomIndex));
  }
  return maps;
}

/**
 * Shared two-color bond builder, used in StructureViewport and OrbitalIsosurfaceViewport.
 */
export function buildBonds(
  group: THREE.Group,
  scene: RenderableSceneData,
  visualBonds: readonly VisualBond[],
  state: VisualizationState,
  uniformBondColor?: string | undefined,
): void {
  if (scene.kind === "PERIODIC" && scene.cell) {
    const crystal = displayAtomsAndBondsForCrystal(scene, visualBonds, state.cellContents ?? "coordination");
    const crystalAtoms = crystal.atoms;
    const radius = bondRadius(state.representation);
    const nx = Math.max(1, state.supercell?.nx || 1);
    const ny = Math.max(1, state.supercell?.ny || 1);
    const nz = Math.max(1, state.supercell?.nz || 1);
    const [va, vb, vc] = scene.cell.latticeVectors;

    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let iz = 0; iz < nz; iz++) {
          const ox = ix * va[0] + iy * vb[0] + iz * vc[0];
          const oy = ix * va[1] + iy * vb[1] + iz * vc[1];
          const oz = ix * va[2] + iy * vb[2] + iz * vc[2];

          for (const bond of crystal.bonds) {
            const first = crystalAtoms[bond.displayIndexA];
            const second = crystalAtoms[bond.displayIndexB];
            if (!first || !second) continue;
            if (!state.hydrogensVisible && (first.element === "H" || second.element === "H")) continue;

            const colorA = uniformBondColor ?? atomColor(first.element, state);
            const colorB = uniformBondColor ?? atomColor(second.element, state);
            const start: Vec3 = [first.position[0] + ox, first.position[1] + oy, first.position[2] + oz];
            const end: Vec3 = [second.position[0] + ox, second.position[1] + oy, second.position[2] + oz];

            if (bond.isDashed) {
              addDashedCylinderSegments(group, start, end, colorA, colorB, radius);
            } else {
              const segments = calculateTwoColorBondSegments(start, end, colorA, colorB, radius);
              for (const seg of segments) {
                group.add(cylinderBetween(seg.start, seg.end, seg.radius, new THREE.Color(seg.color).getHex()));
              }
            }
          }
        }
      }
    }
    return;
  }

  const atoms = sceneDisplayAtoms(scene, state, visualBonds);
  const allBonds = [
    ...scene.bonds,
    ...visualBonds.map((b) => ({ ...b, order: 1, id: "visual", source: "derived" as const })),
  ];
  const radius = bondRadius(state.representation);

  for (const bond of allBonds) {
    const first = atoms.find((atom) => atom.sourceAtomIndex === bond.atomIndexA);
    const second = atoms.find((atom) => atom.sourceAtomIndex === bond.atomIndexB);
    if (!first || !second) continue;

    const colorA = uniformBondColor ?? atomColor(first.element, state);
    const colorB = uniformBondColor ?? atomColor(second.element, state);

    for (const offset of bondOffsets(first.position, second.position, bond)) {
      const start = add(first.position, offset);
      const end = add(second.position, offset);
      const segments = calculateTwoColorBondSegments(start, end, colorA, colorB, radius);
      for (const seg of segments) {
        group.add(cylinderBetween(seg.start, seg.end, seg.radius, new THREE.Color(seg.color).getHex()));
      }
    }
  }
}

function addDashedCylinderSegments(
  group: THREE.Group,
  start: Vec3,
  end: Vec3,
  colorA: string,
  colorB: string,
  radius: number,
): void {
  const from = toVector3(start);
  const to = toVector3(end);
  const dir = to.clone().sub(from);
  const totalLength = dir.length();
  if (totalLength < 1e-4) return;
  const unit = dir.clone().normalize();

  // Period ~ 0.3 Å
  const numDashes = Math.max(3, Math.round(totalLength / 0.3));
  const dashLength = totalLength / (numDashes * 2 - 1);

  for (let i = 0; i < numDashes; i++) {
    const dStart = i * 2 * dashLength;
    const dEnd = dStart + dashLength;
    const midFrac = (dStart + dEnd) * 0.5 / totalLength;
    const color = midFrac < 0.5 ? new THREE.Color(colorA).getHex() : new THREE.Color(colorB).getHex();
    const segStart: Vec3 = [
      from.x + unit.x * dStart,
      from.y + unit.y * dStart,
      from.z + unit.z * dStart,
    ];
    const segEnd: Vec3 = [
      from.x + unit.x * dEnd,
      from.y + unit.y * dEnd,
      from.z + unit.z * dEnd,
    ];
    group.add(cylinderBetween(segStart, segEnd, radius * 0.85, color));
  }
}

function buildPolyhedra(
  group: THREE.Group,
  scene: RenderableSceneData,
  visualBonds: readonly VisualBond[],
  state: VisualizationState,
): void {
  if (scene.kind !== "PERIODIC" || !scene.cell) return;
  const crystal = displayAtomsAndBondsForCrystal(scene, visualBonds, state.cellContents ?? "coordination");
  if (crystal.polyhedra.length === 0) return;

  const positions: number[] = [];
  const edgePositions: number[] = [];
  const edgeKeys = new Set<string>();

  const nx = Math.max(1, state.supercell?.nx || 1);
  const ny = Math.max(1, state.supercell?.ny || 1);
  const nz = Math.max(1, state.supercell?.nz || 1);
  const [va, vb, vc] = scene.cell.latticeVectors;

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        const ox = ix * va[0] + iy * vb[0] + iz * vc[0];
        const oy = ix * va[1] + iy * vb[1] + iz * vc[1];
        const oz = ix * va[2] + iy * vb[2] + iz * vc[2];

        for (const poly of crystal.polyhedra) {
          for (const face of poly.faces) {
            const v0 = poly.vertices[face[0]];
            const v1 = poly.vertices[face[1]];
            const v2 = poly.vertices[face[2]];
            if (v0 && v1 && v2) {
              positions.push(
                v0[0] + ox, v0[1] + oy, v0[2] + oz,
                v1[0] + ox, v1[1] + oy, v1[2] + oz,
                v2[0] + ox, v2[1] + oy, v2[2] + oz,
              );
            }
          }
          for (const [i, j] of poly.edges) {
            const a = poly.vertices[i];
            const b = poly.vertices[j];
            if (a && b) {
              const pA = [a[0] + ox, a[1] + oy, a[2] + oz];
              const pB = [b[0] + ox, b[1] + oy, b[2] + oz];
              const key = [pA, pB].map((p) => p.map((v) => Math.round(v * 1000)).join(",")).sort().join("|");
              if (!edgeKeys.has(key)) {
                edgeKeys.add(key);
                edgePositions.push(...pA, ...pB);
              }
            }
          }
        }
      }
    }
  }

  if (positions.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    const tint = new THREE.Color(atomColor(crystal.polyhedra[0]?.centerElement ?? "Cr", state));
    const mat = new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
  }

  if (edgePositions.length > 0) {
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x4a5568,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(lineGeom, lineMat);
    group.add(lines);
  }
}

/**
 * Full molecule builder for external viewports (like OrbitalIsosurfaceViewport).
 */
export function buildMoleculeInGroup(
  group: THREE.Group,
  scene: RenderableSceneData,
  visualBonds: readonly VisualBond[],
  state: VisualizationState,
): { atomInstanceMaps: Map<THREE.InstancedMesh, readonly number[]> } {
  const maps = buildAtoms(group, { scene, state });
  if (shouldRenderBonds(state.representation)) {
    buildBonds(group, scene, visualBonds, state);
  }
  return { atomInstanceMaps: maps };
}

function buildCell(group: THREE.Group, props: Props): void {
  for (const [start, end] of cellLineSegments(props.scene, props.state.supercell)) {
    const geometry = new THREE.BufferGeometry().setFromPoints([toVector3(start), toVector3(end)]);
    group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x315e8a })));
  }

  if (props.scene.cell) {
    const [va, vb, vc] = props.scene.cell.latticeVectors;
    const labelA = createAxisLabelSprite("a", "#d9534f", 0.6);
    labelA.position.set(va[0], va[1], va[2]);
    const labelB = createAxisLabelSprite("b", "#5cb85c", 0.6);
    labelB.position.set(vb[0], vb[1], vb[2]);
    const labelC = createAxisLabelSprite("c", "#0275d8", 0.6);
    labelC.position.set(vc[0], vc[1], vc[2]);
    group.add(labelA, labelB, labelC);
  }
}

function buildSelection(group: THREE.Group, props: Props): void {
  const atoms = sceneDisplayAtoms(props.scene, props.state);
  const selected =
    props.selectedAtomIndex == null ? null : atoms.find((atom) => atom.sourceAtomIndex === props.selectedAtomIndex);
  if (!selected) return;

  const radius = atomRadius(selected.element, props.state.representation);
  const center = toVector3(selected.position);

  // Restrained, crisp selection ring around atom equator
  const torusGeom = new THREE.TorusGeometry(radius + 0.04, 0.012, 16, 48);
  const torusMat = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    emissive: 0x3b82f6,
    emissiveIntensity: 0.8,
    roughness: 0.3,
  });
  const torus = new THREE.Mesh(torusGeom, torusMat);
  torus.position.copy(center);
  torus.lookAt(center.clone().add(new THREE.Vector3(0.5, 0.7, 1)));
  group.add(torus);
}

function buildMeasurements(group: THREE.Group, props: Props): void {
  const display = sceneDisplayAtoms(props.scene, props.state);
  const atoms = props.measurementAtomIndices
    .map((index) => display.find((atom) => atom.sourceAtomIndex === index))
    .filter((atom): atom is DisplayAtom => Boolean(atom));

  if (atoms.length === 0) return;

  // Thin, restrained ring around each measured atom
  for (const atom of atoms) {
    const radius = atomRadius(atom.element, props.state.representation);
    const center = toVector3(atom.position);

    const ringGeom = new THREE.TorusGeometry(radius + 0.035, 0.010, 16, 48);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.copy(center);
    ring.lookAt(center.clone().add(new THREE.Vector3(0.5, 0.7, 1)));
    group.add(ring);
  }

  // DISTANCE MODE: 2 atoms selected
  if (atoms.length === 2) {
    const atomA = atoms[0]!;
    const atomB = atoms[1]!;
    const pA = toVector3(atomA.position);
    const pB = toVector3(atomB.position);
    const dist = pA.distanceTo(pB);

    // Segment between atom centers
    group.add(cylinderBetween(atomA.position, atomB.position, 0.02, 0x0284c7));

    // Midpoint badge showing distance in Å
    const mid = pA.clone().add(pB).multiplyScalar(0.5);
    const badgeText = `${dist.toFixed(3)} Å`;
    const sprite = createMeasurementSprite(badgeText);
    sprite.position.copy(mid.add(new THREE.Vector3(0, 0.15, 0)));
    group.add(sprite);
  }

  // ANGLE MODE: 3 atoms selected
  if (atoms.length === 3) {
    const atomA = atoms[0]!;
    const atomB = atoms[1]!; // vertex
    const atomC = atoms[2]!;
    const pA = toVector3(atomA.position);
    const pB = toVector3(atomB.position);
    const pC = toVector3(atomC.position);

    // Segments A-B and B-C
    group.add(cylinderBetween(atomA.position, atomB.position, 0.02, 0x0284c7));
    group.add(cylinderBetween(atomB.position, atomC.position, 0.02, 0x0284c7));

    // Calculate angle at vertex B
    const vA = pA.clone().sub(pB).normalize();
    const vC = pC.clone().sub(pB).normalize();
    const dot = THREE.MathUtils.clamp(vA.dot(vC), -1, 1);
    const angleRad = Math.acos(dot);
    const angleDeg = (angleRad * 180) / Math.PI;

    // Normal to plane A-B-C
    const normal = new THREE.Vector3().crossVectors(vA, vC).normalize();
    if (normal.lengthSq() > 1e-6) {
      const arcRadius = Math.min(0.48, pA.distanceTo(pB) * 0.42, pC.distanceTo(pB) * 0.42);
      const arcPoints: THREE.Vector3[] = [];
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const pt = vA.clone().applyAxisAngle(normal, angleRad * frac).multiplyScalar(arcRadius).add(pB);
        arcPoints.push(pt);
      }
      const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
      const arcMat = new THREE.LineBasicMaterial({ color: 0x0284c7, linewidth: 2 });
      group.add(new THREE.Line(arcGeom, arcMat));

      // Badge at arc midpoint
      const midAnglePt = vA.clone().applyAxisAngle(normal, angleRad * 0.5).multiplyScalar(arcRadius + 0.14).add(pB);
      const sprite = createMeasurementSprite(`${angleDeg.toFixed(1)}°`);
      sprite.position.copy(midAnglePt);
      group.add(sprite);
    }
  }
}

function createMeasurementSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.strokeStyle = "rgba(56, 189, 248, 0.8)";
    ctx.lineWidth = 3;
    const r = 16;
    const x = 12;
    const y = 8;
    const w = 232;
    const h = 48;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(text, 128, 32);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.48, 0.12, 1);
  return sprite;
}

function installLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene, persCam: THREE.Camera, orthoCam: THREE.Camera): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Ambient & hemisphere light to ensure rotating 360 degrees never leaves a face black
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.8));

  // Key light (headlight) attached to camera: invariant under rotation
  const pKey = new THREE.DirectionalLight(0xffffff, 1.8);
  pKey.position.set(1.5, 2.0, 4.0);
  persCam.add(pKey);

  const pFill = new THREE.DirectionalLight(0xddeeff, 0.6);
  pFill.position.set(-2.0, -1.0, 3.0);
  persCam.add(pFill);

  const oKey = new THREE.DirectionalLight(0xffffff, 1.8);
  oKey.position.set(1.5, 2.0, 4.0);
  orthoCam.add(oKey);

  const oFill = new THREE.DirectionalLight(0xddeeff, 0.6);
  oFill.position.set(-2.0, -1.0, 3.0);
  orthoCam.add(oFill);

  scene.add(persCam);
  scene.add(orthoCam);
}

function cylinderBetween(start: Vec3, end: Vec3, radius: number, color: number): THREE.Mesh {
  const from = toVector3(start);
  const to = toVector3(end);
  const direction = to.clone().sub(from);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 16);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.02 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(from.clone().add(to).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function bondOffsets(from: Vec3, to: Vec3, bond: ScientificSceneBond): Vec3[] {
  const order = bond.order ?? 1;
  if (order <= 1) return [[0, 0, 0]];
  const offset = stableBondOffset(from, to, 0.11);
  if (order === 2) return [offset, [-offset[0], -offset[1], -offset[2]]];
  return [[0, 0, 0], offset, [-offset[0], -offset[1], -offset[2]]];
}

function toVector3(value: Vec3): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function studioBackground(background: string): THREE.Color | null {
  if (background === "transparent") return null;
  if (background === "dark-neutral") return new THREE.Color("#111820");
  if (background === "white") return new THREE.Color("#ffffff");
  return new THREE.Color("#f4f7f8");
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.Sprite) {
      object.material.map?.dispose();
      object.material.dispose();
    }
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.InstancedMesh) {
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }
  });
}

function buildLabels(group: THREE.Group, props: Props): void {
  if (props.state.labels === "none") return;
  const labelScale = props.state.labelScale ?? 1;
  const atomScale = props.state.atomScale ?? 1;
  for (const atom of sceneDisplayAtoms(props.scene, props.state)) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.font = "bold 76px sans-serif";
    context.textAlign = "center";
    // Light halo behind dark text keeps labels readable over atoms and bonds (F-015).
    context.lineJoin = "round";
    context.lineWidth = 14;
    context.strokeStyle = "rgba(255,255,255,0.92)";
    context.fillStyle = "#101820";
    const labelText =
      props.state.labels === "element"
        ? atom.element
        : String(atom.sourceAtomIndex + 1);
    context.strokeText(labelText, 128, 92);
    context.fillText(labelText, 128, 92);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.position.set(
      atom.position[0],
      atom.position[1] + atomRadius(atom.element, props.state.representation, atomScale) + 0.22 * labelScale,
      atom.position[2],
    );
    sprite.scale.set(0.95 * labelScale, 0.475 * labelScale, 1);
    group.add(sprite);
  }
}

function buildArrows(group: THREE.Group, props: Props): void {
  for (const arrow of props.arrows ?? []) {
    const vector = new THREE.Vector3(...arrow.vector);
    const length = vector.length();
    if (!Number.isFinite(length) || length < 0.02) continue;
    group.add(new THREE.ArrowHelper(
      vector.clone().normalize(), new THREE.Vector3(...arrow.origin), length, 0xc86a2b,
      Math.min(0.25, length * 0.4), Math.min(0.12, length * 0.2),
    ));
  }
}

export function createAxisLabelSprite(text: string, color: string, scale = 0.5): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = "bold 80px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineJoin = "round";
    ctx.strokeText(text, 64, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale, scale, 1);
  return sprite;
}
