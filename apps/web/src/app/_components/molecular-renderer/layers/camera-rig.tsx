"use client";

/* eslint-disable react-hooks/immutability, react-hooks/refs -- three.js scene-graph objects, uniforms and shared view refs are updated imperatively from the R3F frame loop and effects, outside React state (same convention as the previous homepage canvas) */

import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type ComponentRef, type ReactNode, type Ref } from "react";
import { MathUtils, TOUCH, type OrthographicCamera as OrthoCam } from "three";

import { FULL_COMPOSITION, type CameraView, type Composition, type ProjectionMode } from "../types";
import { angleDelta, damp } from "./damp";
import { computeFit } from "./framing";

export type CameraRigHandle = {
  reset(animate?: boolean): void;
  zoomBy(factor: number): void;
  rotateBy(deltaAzimuth: number, deltaPolar: number): void;
  setView(view: Partial<CameraView>, animate?: boolean): void;
  getView(): CameraView;
  setComposition(composition: Partial<Composition>, animate?: boolean): void;
};

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.4;
const POLAR_MIN = 0.1;
const POLAR_MAX = Math.PI - 0.1;

/**
 * Camera, framing and orbit controls. The structure never moves: the camera orbits it (so lights attached to the
 * camera keep every view evenly lit). The framing distance is the bounding sphere's fit for the stage's aspect
 * ratio, so no rotation can clip the structure; distance changes (supercell, representation) are damped.
 * Wheel zoom is off on purpose — it would hijack page scrolling — and touch uses `touch-action: pan-y`, so a
 * vertical swipe still scrolls the page while a horizontal drag rotates.
 */
export function CameraRig({
  projection,
  fitKey,
  snapKey,
  fov,
  margin,
  extent,
  initial,
  autoRotate,
  composition = FULL_COMPOSITION,
  handleRef,
  children,
  onUserChange,
}: {
  projection: ProjectionMode;
  fitKey?: string | undefined;
  snapKey?: string | undefined;
  fov: number;
  /** What must stay in frame (Å, atom radii included): a cylinder about the vertical axis, which rotation preserves. */
  extent: { horizontalRadius: number; halfHeight: number };
  margin: number;
  initial: CameraView;
  autoRotate: boolean;
  /** Where the structure sits on the canvas (see `Composition`). */
  composition?: Composition;
  handleRef: Ref<CameraRigHandle>;
  children?: ReactNode;
  onUserChange?: () => void;
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const gl = useThree((state) => state.gl);
  const userZoom = useRef(initial.zoom);
  const current = useRef<{ distance: number; zoom: number } | null>(null);
  const goal = useRef<{ azimuth?: number; polar?: number } | null>(null);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  // Composition: the structure is fitted to a sub-region of the canvas and shifted by a damped view offset.
  const compGoal = useRef<Composition>(composition);
  const compCurrent = useRef<Composition>(composition);
  const compApplied = useRef<string>("");
  const framing = () =>
    computeFit({ extent, margin, projection, fov, width: size.width * compCurrent.current.regionWidth, height: size.height * compCurrent.current.regionHeight, polar: controls.current?.getPolarAngle() ?? initialRef.current.polar, zoom: userZoom.current });
  const fit = framing;

  const startPosition = useMemo(() => {
    const d = fit().distance || 10;
    return [d * Math.sin(initial.polar) * Math.sin(initial.azimuth), d * Math.cos(initial.polar), d * Math.sin(initial.polar) * Math.cos(initial.azimuth)] as [number, number, number];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the first placement; afterwards the controls own the angles
  }, [projection]);

  /** Place the camera at exact angles. OrbitControls applies angle changes through its damping, so damping is suspended for programmatic placement. */
  const placeAngles = (azimuth: number | undefined, polar: number | undefined) => {
    const c = controls.current;
    if (!c) return;
    const damping = c.enableDamping;
    c.enableDamping = false;
    if (azimuth !== undefined) c.setAzimuthalAngle(azimuth);
    if (polar !== undefined) c.setPolarAngle(MathUtils.clamp(polar, POLAR_MIN, POLAR_MAX));
    c.update();
    c.enableDamping = damping;
  };

  const apply = (delta: number) => {
    const c = controls.current;
    if (!c) return false;
    let moving = false;
    const next = fit();
    const state = (current.current ??= { distance: next.distance, zoom: next.zoom });
    const d = damp(state.distance, next.distance, 6, delta);
    const z = damp(state.zoom, next.zoom, 6, delta);
    if (Math.abs(d - next.distance) > 1e-3 * next.distance || Math.abs(z - next.zoom) > 1e-3 * next.zoom) moving = true;
    state.distance = next.distance > state.distance ? next.distance : moving ? d : next.distance;
    state.zoom = moving ? z : next.zoom;
    c.minDistance = c.maxDistance = state.distance;
    if (projection === "orthographic") {
      const ortho = camera as OrthoCam;
      ortho.zoom = state.zoom;
      ortho.updateProjectionMatrix();
    }
    // composition (region and offset) chases its goal; the view offset is only re-applied when it changes
    const cg = compGoal.current;
    const cc = compCurrent.current;
    const nextComp: Composition = {
      offsetX: damp(cc.offsetX, cg.offsetX, 5, delta),
      offsetY: damp(cc.offsetY, cg.offsetY, 5, delta),
      regionWidth: damp(cc.regionWidth, cg.regionWidth, 5, delta),
      regionHeight: damp(cc.regionHeight, cg.regionHeight, 5, delta),
    };
    const compMoving = (Object.keys(cg) as (keyof Composition)[]).some((key) => Math.abs(nextComp[key] - cg[key]) > 1e-3);
    compCurrent.current = compMoving ? nextComp : cg;
    if (compMoving) moving = true;
    const stamp = `${compCurrent.current.offsetX.toFixed(4)},${compCurrent.current.offsetY.toFixed(4)},${size.width},${size.height}`;
    if (stamp !== compApplied.current) {
      compApplied.current = stamp;
      if (Math.abs(compCurrent.current.offsetX) < 1e-4 && Math.abs(compCurrent.current.offsetY) < 1e-4) camera.clearViewOffset();
      else camera.setViewOffset(size.width, size.height, -compCurrent.current.offsetX * size.width, -compCurrent.current.offsetY * size.height, size.width, size.height);
    }
    const target = goal.current;
    if (target) {
      let done = true;
      if (target.azimuth !== undefined) {
        const delta1 = angleDelta(c.getAzimuthalAngle(), target.azimuth);
        const step = damp(0, delta1, 7, delta);
        if (Math.abs(delta1) > 2e-3) {
          placeAngles(c.getAzimuthalAngle() + step, undefined);
          done = false;
        } else placeAngles(target.azimuth, undefined);
      }
      if (target.polar !== undefined) {
        const delta2 = target.polar - c.getPolarAngle();
        const step = damp(0, delta2, 7, delta);
        if (Math.abs(delta2) > 2e-3) {
          placeAngles(undefined, c.getPolarAngle() + step);
          done = false;
        } else placeAngles(undefined, target.polar);
      }
      if (done) goal.current = null;
      else moving = true;
    }
    c.update();
    return moving;
  };

  useFrame((_, delta) => {
    if (apply(delta)) invalidate();
  });

  const fittedStructure = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    current.current = null;
    if (snapKey) userZoom.current = initialRef.current.zoom;
    compGoal.current = compCurrent.current = composition;
    if (fitKey !== fittedStructure.current) {
      userZoom.current = initialRef.current.zoom;
      goal.current = null;
      fittedStructure.current = fitKey;
      placeAngles(initialRef.current.azimuth, initialRef.current.polar);
    }
    compApplied.current = ""; // a new default camera (projection change, drei makeDefault) must receive the view offset again
    if (!fitKey) placeAngles(initialRef.current.azimuth, initialRef.current.polar);
    apply(0);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run per projection/camera swap
  }, [projection, camera, fitKey, snapKey]);

  // OrbitControls claims `touch-action: none` when it connects; a passive effect in this parent runs after the
  // child controls' effect, so the page can still scroll vertically over the canvas while horizontal drags rotate.
  useEffect(() => {
    const element = gl.domElement;
    element.style.touchAction = "pan-y";
    return () => {
      element.style.touchAction = "";
    };
  }, [gl, projection, camera]);

  useEffect(() => {
    compGoal.current = composition;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on the values, not the object identity
  }, [composition.offsetX, composition.offsetY, composition.regionWidth, composition.regionHeight, invalidate]);

  useEffect(() => {
    invalidate();
  }, [extent.horizontalRadius, extent.halfHeight, size.width, size.height, margin, invalidate]);

  const view = (): CameraView => ({
    projection,
    azimuth: controls.current?.getAzimuthalAngle() ?? initial.azimuth,
    polar: controls.current?.getPolarAngle() ?? initial.polar,
    zoom: userZoom.current,
  });

  useImperativeHandle(
    handleRef,
    () => {
      const setView: CameraRigHandle["setView"] = (next, animate = false) => {
        const c = controls.current;
        if (!c) return;
        if (next.zoom !== undefined) userZoom.current = MathUtils.clamp(next.zoom, ZOOM_MIN, ZOOM_MAX);
        if (animate) goal.current = { ...(next.azimuth !== undefined ? { azimuth: next.azimuth } : {}), ...(next.polar !== undefined ? { polar: next.polar } : {}) };
        else {
          goal.current = null;
          placeAngles(next.azimuth, next.polar);
        }
        invalidate();
      };
      return {
        reset(animate = true) {
          userZoom.current = initialRef.current.zoom;
          setView({ azimuth: initialRef.current.azimuth, polar: initialRef.current.polar }, animate);
        },
        zoomBy(factor) {
          userZoom.current = MathUtils.clamp(userZoom.current * factor, ZOOM_MIN, ZOOM_MAX);
          invalidate();
        },
        rotateBy(deltaAzimuth, deltaPolar) {
          const c = controls.current;
          if (!c) return;
          goal.current = null;
          c.setAzimuthalAngle(c.getAzimuthalAngle() + deltaAzimuth);
          c.setPolarAngle(MathUtils.clamp(c.getPolarAngle() + deltaPolar, POLAR_MIN, POLAR_MAX));
          c.update();
          invalidate();
        },
        setView,
        getView: view,
        setComposition(next, animate = true) {
          compGoal.current = { ...compGoal.current, ...next };
          if (!animate) compCurrent.current = compGoal.current;
          invalidate();
        },
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handle only reads refs
    [projection],
  );

  return (
    <>
      {projection === "orthographic" ? (
        <OrthographicCamera key="ortho" makeDefault near={0.1} far={framing().bound * 14} position={startPosition}>
          {children}
        </OrthographicCamera>
      ) : (
        <PerspectiveCamera key="persp" makeDefault fov={fov} near={0.1} far={framing().bound * 14 + 60} position={startPosition}>
          {children}
        </PerspectiveCamera>
      )}
      <OrbitControls
        key={projection}
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.09}
        enablePan={false}
        enableZoom={false}
        rotateSpeed={0.65}
        minPolarAngle={POLAR_MIN}
        maxPolarAngle={POLAR_MAX}
        autoRotate={autoRotate}
        autoRotateSpeed={0.7}
        touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.ROTATE }}
        onStart={() => {
          goal.current = null;
          onUserChange?.();
        }}
      />
    </>
  );
}

