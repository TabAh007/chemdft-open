"use client";

/* eslint-disable react-hooks/immutability -- three.js scene-graph objects, uniforms and shared view refs are updated imperatively from the R3F frame loop and effects, outside React state (same convention as the previous homepage canvas) */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { Matrix4, Vector3, NeutralToneMapping, type Group, type InstancedMesh } from "three";

import { deriveGeometry } from "./derive";
import { Effects } from "./layers/effects";
import { AtomLayer } from "./layers/atom-layer";
import { AtomLabels, CellAxes, SelectionHalo } from "./layers/annotation-layers";
import { BondLayer } from "./layers/bond-layer";
import { CameraRig, type CameraRigHandle } from "./layers/camera-rig";
import { CellLayer } from "./layers/cell-layer";
import { PolyhedraLayer } from "./layers/polyhedra-layer";
import { ContactShadow } from "./layers/contact-shadow";
import { CameraLights, StudioEnvironment } from "./layers/studio-lighting";
import { resolveRepresentation } from "./capabilities";
import { PRESETS, type RenderPreset } from "./presets";
import { presetStyle, representationStyle } from "./radii";
import { DEFAULT_PRESENTATION, FULL_COMPOSITION, type AtomSelection, type CameraView, type Composition, type PresentationState, type RendererHandle, type ScientificStructure } from "./types";

export type MolecularRendererProps = {
  /** Authoritative geometry. Never modified; swapping it re-derives everything without rebuilding the renderer. */
  structure: ScientificStructure;
  /** How it is shown. Changing any of it only changes presentation. */
  presentation?: Partial<PresentationState>;
  /** Starting camera; defaults to an authored three-quarter view. */
  initialView?: Partial<CameraView>;
  /** Override the preset's ambient occlusion (for example off on low-power devices or data-saver). The scene reads correctly without it. */
  ambientOcclusion?: boolean;
  /** Small screens: fewer polygons, lower pixel ratio, half-resolution ambient occlusion. */
  compact?: boolean;
  /** Stop rendering entirely while the stage is off screen (the scene is kept and resumes instantly). Default true. */
  active?: boolean;
  /** Upper bound on the device pixel ratio (a full-viewport stage does not need 2×). */
  maxDpr?: number;
  /** Where the structure sits on the canvas; change it later with `handle.setComposition`. */
  composition?: Composition;
  /** Smallest framing radius in Å: tiny molecules are not blown up to fill the stage (a page choosing its own visual scale). */
  minFramingRadius?: number;
  /** Animate the first appearance (atoms grow in) instead of appearing at once. */
  entrance?: boolean;
  /** Fade one structure out and the next in when `structure` changes. False swaps at once (reduced motion). Default true. */
  transition?: boolean;
  /** Arrow keys rotate, + / − zoom, 0 resets (the stage is focusable). */
  keyboard?: boolean;
  /** Hosts may commit a hidden, pre-fitted presentation instead of the renderer's legacy exit animation. */
  presentationKey?: string | undefined;
  immediatePresentation?: boolean;
  onPresented?: ((key: string) => void) | undefined;
  onSelect?: (selection: AtomSelection) => void;
  onReady?: (handle: RendererHandle) => void;
  /** Keep the projected-bounds measurement (`handle.framing()`) running in production builds, for hosts that fit the camera to the drawn atoms. */
  measureFrame?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
};

/** How long the outgoing structure takes to scale out before the incoming one is shown, ms. */
const EXIT_MS = 260;

const DEFAULT_VIEWS = {
  periodic: { azimuth: 0.62, polar: 1.2, zoom: 1 },
  molecule: { azimuth: 0.5, polar: 1.3, zoom: 1 },
} as const;

type SceneProps = {
  preset: RenderPreset;
  structure: ScientificStructure;
  presentation: PresentationState;
  initial: CameraView;
  compact: boolean;
  active: boolean;
  /** True while the previous structure is fading out, before the new one is shown. */
  leaving: boolean;
  entrance: boolean;
  composition: Composition;
  minFramingRadius: number;
  measureFrame: boolean;
  onSelect?: ((selection: AtomSelection) => void) | undefined;
  onReady?: ((handle: RendererHandle) => void) | undefined;
  rigRef: { current: CameraRigHandle | null };
  frames: { current: number };
  overlay: RefObject<HTMLDivElement | null>;
  presentationKey?: string | undefined;
  immediatePresentation: boolean;
  onPresented?: ((key: string) => void) | undefined;
};

function Scene({ preset, structure, presentation, initial, compact, active, leaving, entrance, composition, minFramingRadius, measureFrame, onSelect, onReady, rigRef, frames, overlay, presentationKey, immediatePresentation, onPresented }: SceneProps) {
  const anchor = useRef<Group>(null);
  const projection = presentation.projection ?? preset.projection;
  const geometry = useMemo(() => deriveGeometry(structure, presentation.supercell), [structure, presentation.supercell]);
  const representation = resolveRepresentation(structure, presentation.representation);
  const style = useMemo(() => presetStyle(representationStyle(structure, representation, geometry.coordination), preset), [structure, representation, geometry.coordination, preset]);
  // The shadow plane is just large enough for the structure's shadow and its blur; a change of supercell rebuilds it
  // (and disposes the old render targets), and it fades to zero well inside its own edge.
  const shadowScale = 2.6 * geometry.bounds.radius;
  const frameBounds = useRef({ bounds: [0, 0, 0, 0], region: [0, 0, 1, 1], structure: structure.id });
  const lastPresented = useRef<string | undefined>(undefined);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const scene = useThree((state) => state.scene);
  const getState = useThree((state) => state.get);

  // Frame accounting for review/diagnostics: count rendered frames and accumulate draw calls across every pass of a frame.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame(() => {
    gl.info.reset();
    frames.current += 1;
  }, -1000);

  useEffect(() => {
    onReady?.({
      resetView: (animate?: boolean) => rigRef.current?.reset(animate),
      zoomBy: (factor: number) => rigRef.current?.zoomBy(factor),
      rotateBy: (a: number, p: number) => rigRef.current?.rotateBy(a, p),
      setView: (view: Partial<CameraView>, animate?: boolean) => rigRef.current?.setView(view, animate),
      getView: () => rigRef.current?.getView() ?? initial,
      setComposition: (next: Partial<Composition>, animate?: boolean) => rigRef.current?.setComposition(next, animate),
      inspectAtoms: () => {
        let mesh: InstancedMesh | null = null;
        scene.traverse((object) => {
          if (object.userData?.chemdftLayer === "atoms") mesh = object as InstancedMesh;
        });
        const found = mesh as InstancedMesh | null;
        if (!found) return [];
        const matrix = new Matrix4();
        return Array.from({ length: found.count }, (_, i) => {
          found.getMatrixAt(i, matrix);
          const te = matrix.elements; // read columns directly: Matrix4.decompose reports scale 1 for a singular (zero-scale, hidden) instance
          return { position: [te[12]!, te[13]!, te[14]!] as const, radius: Math.hypot(te[0]!, te[1]!, te[2]!) };
        });
      },
      framing: () => frameBounds.current,
      stats: () => ({ projectionShiftX: getState().camera.projectionMatrix.elements[8], viewOffset: getState().camera.view?.enabled ? [getState().camera.view!.offsetX, getState().camera.view!.offsetY] : null, calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, frame: frames.current }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- publish the handle once
  }, []);

  useEffect(() => { if (active) invalidate(); }, [active, invalidate]);

  useFrame(({ camera, size }) => {
    if (process.env.NODE_ENV === "production") {
      if (presentationKey && lastPresented.current !== presentationKey) {
        lastPresented.current = presentationKey;
        onPresented?.(presentationKey);
      }
      if (!measureFrame) return;
    }
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const point = new Vector3();
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const project = (p: Vector3) => {
      point.copy(p).project(camera);
      box[0] = Math.min(box[0]!, (point.x + 1) / 2);
      box[1] = Math.min(box[1]!, (1 - point.y) / 2);
      box[2] = Math.max(box[2]!, (point.x + 1) / 2);
      box[3] = Math.max(box[3]!, (1 - point.y) / 2);
    };
    scene.updateMatrixWorld();
    scene.traverse((object) => {
      if (!object.userData.chemdftLayer || object.userData.chemdftLayer !== "atoms") return;
      const mesh = object as InstancedMesh;
      const matrix = new Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        const radius = Math.hypot(matrix.elements[0]!, matrix.elements[1]!, matrix.elements[2]!);
        if (radius < 1e-4) continue;
        const center = new Vector3().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);
        project(center.clone().addScaledVector(right, radius));
        project(center.clone().addScaledVector(right, -radius));
        project(center.clone().addScaledVector(up, radius));
        project(center.clone().addScaledVector(up, -radius));
      }
    });
    if (geometry.cell && anchor.current && presentation.showCell) {
      geometry.cell.corners.forEach((p) => project(new Vector3(...p).applyMatrix4(anchor.current!.matrixWorld)));
    }
    void size;
    frameBounds.current = {
      bounds: box,
      region: [0.5 + composition.offsetX - composition.regionWidth / 2, 0.5 + composition.offsetY - composition.regionHeight / 2, 0.5 + composition.offsetX + composition.regionWidth / 2, 0.5 + composition.offsetY + composition.regionHeight / 2],
      structure: structure.id,
    };
    if (presentationKey && lastPresented.current !== presentationKey) {
      lastPresented.current = presentationKey;
      onPresented?.(presentationKey);
    }
  }, 0);

  // Sphere detail follows the atom count: smooth at hero sizes, lighter for big supercells and phones.
  const segments = compact ? 24 : geometry.atoms.length > 250 ? 32 : 44;
  const bondSegments = compact ? 12 : 20;
  const showCell = presentation.showCell || style.forceCell;
  const showAxes = presentation.showAxes || preset.showAxes;

  return (
    <>
      {preset.clearColor && preset.ao.enabled ? <color attach="background" args={[preset.clearColor]} /> : null}
      <CameraRig
        projection={projection}
        fitKey={immediatePresentation ? structure.id : undefined}
        snapKey={immediatePresentation ? presentationKey : undefined}
        fov={preset.fov}
        margin={preset.framingMargin}
        extent={{ horizontalRadius: Math.max(minFramingRadius, geometry.bounds.horizontalRadius + style.framingPadding), halfHeight: Math.max(minFramingRadius, geometry.bounds.halfHeight + style.framingPadding) }}
        initial={initial}
        autoRotate={presentation.autoRotate}
        composition={composition}
        handleRef={rigRef as never}
      >
        <CameraLights preset={preset} />
      </CameraRig>
      <StudioEnvironment preset={preset} />
      {preset.contactShadow ? (
        <ContactShadow position={[0, -(geometry.bounds.halfHeight + style.framingPadding + 0.15), 0]} scale={shadowScale} blur={2.2} far={shadowScale / 2} opacity={0.08} resolution={512} color="#2b3a49" />
      ) : null}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <group ref={anchor} position={[-geometry.bounds.center[0], -geometry.bounds.center[1], -geometry.bounds.center[2]]}>
          <AtomLayer key={`atoms:${structure.id}`} immediate={immediatePresentation} geometry={geometry} style={style} preset={preset} segments={segments} visible={!leaving} entrance={entrance} {...(onSelect ? { onPick: onSelect } : {})} />
          <BondLayer key={`bonds:${structure.id}`} immediate={immediatePresentation} geometry={geometry} style={style} preset={preset} segments={bondSegments} visible={!leaving} entrance={entrance} />
          <PolyhedraLayer immediate={immediatePresentation} geometry={geometry} style={style} preset={preset} visible={!leaving} />
          <CellLayer immediate={immediatePresentation} geometry={geometry} preset={preset} emphasis={style.cellEmphasis} projection={projection} visible={showCell} shown={!leaving} />
          {showAxes && geometry.cell ? <CellAxes geometry={geometry} color={preset.edges.color} container={overlay} anchor={anchor} /> : null}
          <SelectionHalo selection={presentation.selection} style={style} />
          <AtomLabels geometry={geometry} style={style} mode={presentation.labels} selection={presentation.selection} container={overlay} anchor={anchor} />
        </group>
      </group>
      {preset.ao.enabled ? <Effects preset={preset} compact={compact} /> : null}
    </>
  );
}

/**
 * The reusable ChemDFT molecular/crystal renderer (React Three Fiber). Load it lazily; it owns the WebGL canvas,
 * camera, lighting and layers, and takes the structure and the presentation separately.
 */
export default function MolecularRenderer({
  structure,
  presentation: partial,
  initialView,
  ambientOcclusion,
  compact = false,
  active = true,
  maxDpr,
  composition = FULL_COMPOSITION,
  entrance = false,
  minFramingRadius = 0,
  measureFrame = false,
  transition = true,
  presentationKey,
  immediatePresentation = false,
  onPresented,
  keyboard = true,
  onSelect,
  onReady,
  ariaLabel,
  className,
  style,
}: MolecularRendererProps) {
  const presentation: PresentationState = { ...DEFAULT_PRESENTATION, ...partial };
  const base0 = PRESETS[presentation.preset];
  const preset: RenderPreset = ambientOcclusion === undefined ? base0 : { ...base0, ao: { ...base0.ao, enabled: ambientOcclusion } };
  // Replacing one structure with another is a presentation transition: the old one scales out, the new authoritative
  // structure is then shown and grows in. Coordinates of neither are ever interpolated.
  const [retained, setShown] = useState(structure);
  const shown = transition ? retained : structure;
  const leaving = transition && structure !== shown;
  useEffect(() => {
    if (!transition || structure === retained) return;
    const timer = window.setTimeout(() => setShown(structure), transition ? EXIT_MS : 0);
    return () => window.clearTimeout(timer);
  }, [structure, retained, transition]);
  const rigRef = useRef<CameraRigHandle | null>(null);
  const frames = useRef(0);
  const overlay = useRef<HTMLDivElement>(null);
  const base = DEFAULT_VIEWS[shown.kind];
  const initial = useMemo<CameraView>(
    () => ({ projection: presentation.projection ?? preset.projection, azimuth: initialView?.azimuth ?? base.azimuth, polar: initialView?.polar ?? base.polar, zoom: initialView?.zoom ?? base.zoom }),
    // the initial view is read once per projection/structure kind; later changes go through the handle
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown.id, shown.kind, initialView?.azimuth, initialView?.polar, initialView?.zoom, presentation.projection, preset.projection],
  );

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!keyboard) return;
    const step = 0.14;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => rigRef.current?.rotateBy(-step, 0),
      ArrowRight: () => rigRef.current?.rotateBy(step, 0),
      ArrowUp: () => rigRef.current?.rotateBy(0, -step),
      ArrowDown: () => rigRef.current?.rotateBy(0, step),
      "+": () => rigRef.current?.zoomBy(1.15),
      "=": () => rigRef.current?.zoomBy(1.15),
      "-": () => rigRef.current?.zoomBy(1 / 1.15),
      "0": () => rigRef.current?.reset(!immediatePresentation),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  }, [keyboard, immediatePresentation]);

  const opaque = preset.ao.enabled && preset.clearColor !== null;
  return (
    <div
      className={className}
      data-molecular-renderer=""
      data-preset={preset.id}
      data-representation={resolveRepresentation(shown, presentation.representation)}
      data-structure={shown.id}
      role="group"
      aria-label={ariaLabel ?? `Interactive 3D view of ${shown.title}. Drag to rotate; arrow keys rotate, plus and minus zoom, 0 resets.`}
      tabIndex={keyboard ? 0 : undefined}
      onKeyDown={onKeyDown}
      style={{ position: "relative", width: "100%", height: "100%", background: preset.background, ...style }}
    >
      <Canvas
        frameloop={!active ? "never" : presentation.autoRotate ? "always" : "demand"}
        dpr={[1, Math.min(maxDpr ?? 2, compact ? 1.5 : 2)]}
        camera={{ fov: preset.fov, near: 0.1, far: 400, position: [0, 0, 20] }}
        gl={{ antialias: !opaque, alpha: !opaque, powerPreference: "default", toneMapping: NeutralToneMapping }}
        onPointerMissed={() => onSelect?.(null)}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0 }}
      >
        <Scene preset={preset} structure={shown} presentation={presentation} initial={initial} compact={compact} active={active} leaving={leaving} entrance={entrance} composition={composition} minFramingRadius={minFramingRadius} measureFrame={measureFrame} onSelect={onSelect} onReady={onReady} rigRef={rigRef} frames={frames} overlay={overlay} presentationKey={presentationKey} immediatePresentation={immediatePresentation} onPresented={onPresented} />
      </Canvas>
      <div ref={overlay} aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }} />
    </div>
  );
}
