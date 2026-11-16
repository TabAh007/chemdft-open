"use client";

/* eslint-disable react-hooks/immutability -- three.js scene-graph objects, uniforms and shared view refs are updated imperatively from the R3F frame loop and effects, outside React state (same convention as the previous homepage canvas) */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, type RefObject } from "react";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

/**
 * Constant-screen-width line segments (WebGL's native 1px lines are neither adjustable nor antialiased).
 * `positions` is a flat x,y,z,x,y,z… array of segment endpoints.
 */
export function ThickSegments({
  positions,
  color,
  width,
  opacity = 1,
  dashed = false,
  dashSize = 0.2,
  gapSize = 0.14,
  renderOrder = 0,
  fade,
}: {
  positions: readonly number[];
  color: string;
  width: number;
  opacity?: number;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
  renderOrder?: number;
  /** Optional 0–1 multiplier (a presentation value owned by the caller); the line is hidden at 0. */
  fade?: RefObject<number>;
}) {
  const size = useThree((state) => state.size);
  const object = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions as number[]);
    const material = new LineMaterial({ color, linewidth: width, transparent: true, opacity, dashed, dashSize, gapSize, worldUnits: false });
    material.resolution.set(1, 1);
    const line = new LineSegments2(geometry, material);
    if (dashed) line.computeLineDistances();
    return line;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- appearance props are applied by the effect below without rebuilding geometry
  }, [positions, dashed]);

  useLayoutEffect(() => {
    object.material.color.set(color);
    object.material.linewidth = width;
    object.material.opacity = opacity;
    object.material.dashSize = dashSize;
    object.material.gapSize = gapSize;
    object.material.resolution.set(size.width, size.height);
  }, [object, color, width, opacity, dashSize, gapSize, size.width, size.height]);

  useFrame(() => {
    if (!fade) return;
    const f = fade.current;
    object.visible = f > 0.004;
    object.material.opacity = opacity * f;
  });

  useEffect(
    () => () => {
      object.geometry.dispose();
      object.material.dispose();
    },
    [object],
  );
  return <primitive object={object} renderOrder={renderOrder} />;
}
