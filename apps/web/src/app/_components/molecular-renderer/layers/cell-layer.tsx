"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Vector3, type Group } from "three";

import type { DerivedGeometry } from "../derive";
import type { RenderPreset } from "../presets";
import { cross, dot, sub } from "../lattice";
import type { ProjectionMode, Vec3 } from "../types";
import { useDampedRef } from "./use-damped";
import { ThickSegments } from "./thick-segments";

/** For each of the 12 cell edges, the two faces (axis·2 + side) that meet there. */
function edgeFaces(corners: number[][]): [number, number][] {
  return corners.map(([from, to]) => {
    const axis = [0, 1, 2].find((a) => ((from! >> a) & 1) !== ((to! >> a) & 1))!;
    const [p, q] = [0, 1, 2].filter((a) => a !== axis);
    return [p! * 2 + ((from! >> p!) & 1), q! * 2 + ((from! >> q!) & 1)] as [number, number];
  });
}

/**
 * The authoritative unit-cell (or supercell block) outline: the true parallelepiped of the lattice, drawn as thin
 * constant-width edges. In reproducible presets the edges hidden behind the cell are dashed: an edge is hidden
 * exactly when both faces that meet at it face away from the camera.
 */
export function CellLayer({
  geometry,
  preset,
  emphasis,
  projection,
  visible,
  shown,
  immediate = false,
}: {
  geometry: DerivedGeometry;
  preset: RenderPreset;
  emphasis: number;
  projection: ProjectionMode;
  visible: boolean;
  /** Presentation-only: false fades the outline out (while a structure is being replaced). */
  shown: boolean;
  immediate?: boolean;
}) {
  const cell = geometry.cell;
  // The outline fades in again whenever the block changes (new structure or supercell): cells are added or removed, never stretched.
  const fade = useDampedRef(shown && visible ? 1 : 0, { lambda: 9, resetKey: geometry.cell, immediate });
  const group = useRef<Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const [hiddenMask, setHiddenMask] = useState(0);
  const adjacency = useMemo(() => (cell ? edgeFaces(cell.edges.map((e) => [...e])) : []), [cell]);

  const faces = useMemo(() => {
    if (!cell) return [];
    const c = cell.corners;
    const center = c.reduce<Vec3>((acc, p) => [acc[0] + p[0] / 8, acc[1] + p[1] / 8, acc[2] + p[2] / 8], [0, 0, 0]);
    const axes = [sub(c[1]!, c[0]!), sub(c[2]!, c[0]!), sub(c[4]!, c[0]!)]; // lattice edge vectors of the block
    const result: { center: Vec3; normal: Vec3 }[] = [];
    for (let axis = 0; axis < 3; axis++)
      for (let side = 0; side < 2; side++) {
        const ids = [...Array(8).keys()].filter((m) => ((m >> axis) & 1) === side);
        const fc = ids.reduce<Vec3>((acc, m) => [acc[0] + c[m]![0] / 4, acc[1] + c[m]![1] / 4, acc[2] + c[m]![2] / 4], [0, 0, 0]);
        const [p, q] = [0, 1, 2].filter((a) => a !== axis);
        let normal = cross(axes[p!]!, axes[q!]!);
        if (dot(normal, sub(fc, center)) < 0) normal = [-normal[0], -normal[1], -normal[2]];
        result[axis * 2 + side] = { center: fc, normal };
      }
    return result;
  }, [cell]);

  useFrame(({ camera }) => {
    const node = group.current;
    if (!node || (preset.id !== "editorial" && !preset.edges.dashedRear) || !cell) return;
    const cameraLocal = node.worldToLocal(camera.position.clone());
    const target = node.worldToLocal(new Vector3(0, 0, 0));
    const view = cameraLocal.clone().sub(target);
    let mask = 0;
    adjacency.forEach(([f1, f2], i) => {
      const facing = (face: number) => {
        const { center, normal } = faces[face]!;
        const toCamera = projection === "orthographic" ? ([view.x, view.y, view.z] as const) : ([cameraLocal.x - center[0], cameraLocal.y - center[1], cameraLocal.z - center[2]] as const);
        return dot(normal, toCamera) > 0;
      };
      if (!facing(f1) && !facing(f2)) mask |= 1 << i;
    });
    if (mask !== hiddenMask) {
      setHiddenMask(mask);
      invalidate();
    }
  });

  const { all, front, rear } = useMemo(() => {
    const all: number[] = [];
    const front: number[] = [];
    const rear: number[] = [];
    cell?.edges.forEach(([i, j], e) => {
      const a = cell.corners[i]!;
      const b = cell.corners[j]!;
      all.push(...a, ...b);
      (hiddenMask & (1 << e) ? rear : front).push(...a, ...b);
    });
    return { all, front, rear };
  }, [cell, hiddenMask]);

  if (!cell || !visible) return null;
  const width = preset.edges.width * (0.75 + 0.5 * emphasis);
  const opacity = preset.edges.opacity * (0.55 + 0.45 * emphasis);
  return (
    <group ref={group}>
      {preset.edges.dashedRear || preset.id === "editorial" ? (
        <>
          <ThickSegments positions={front} color={preset.edges.color} width={width} opacity={opacity} renderOrder={4} fade={fade} />
          {rear.length ? <ThickSegments positions={rear} color={preset.edges.color} width={width * 0.8} opacity={opacity * 0.55} dashed={preset.edges.dashedRear} dashSize={0.22} gapSize={0.16} renderOrder={4} fade={fade} /> : null}
        </>
      ) : (
        <ThickSegments positions={all} color={preset.edges.color} width={width} opacity={opacity} renderOrder={4} fade={fade} />
      )}
    </group>
  );
}
