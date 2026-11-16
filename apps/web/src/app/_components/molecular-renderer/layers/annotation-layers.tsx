"use client";

/* eslint-disable react-hooks/immutability -- three.js scene-graph objects, uniforms and shared view refs are updated imperatively from the R3F frame loop and effects, outside React state (same convention as the previous homepage canvas) */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, type RefObject } from "react";
import { BackSide, Vector3, type Object3D } from "three";

import type { DerivedGeometry } from "../derive";
import type { RepresentationStyle } from "../radii";
import type { AtomSelection, LabelMode, Vec3 } from "../types";
import { ThickSegments } from "./thick-segments";

/** Minimal selection halo: an inverted-hull outline, no glow. The inspector row carries the same information. */
export function SelectionHalo({ selection, style }: { selection: AtomSelection; style: RepresentationStyle }) {
  if (!selection) return null;
  const radius = (style.atomRadius[selection.element] ?? 0.3) * 1.2 + 0.02;
  return (
    <mesh position={[selection.position[0], selection.position[1], selection.position[2]]} renderOrder={5}>
      <sphereGeometry args={[radius, 36, 24]} />
      <meshBasicMaterial color="#1565a7" side={BackSide} transparent opacity={0.95} />
    </mesh>
  );
}

export type OverlayLabel = { readonly key: string; readonly text: string; readonly position: Vec3; readonly italic?: boolean };

const LABEL_CSS =
  "position:absolute;left:0;top:0;pointer-events:none;user-select:none;white-space:nowrap;font:600 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:#18212b;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 2px #fff;will-change:transform";

/**
 * Text labels as plain DOM spans positioned from the camera projection each rendered frame. (drei's `Html` would
 * create a React root per label; a handful of absolutely positioned spans needs none.)
 */
function OverlayLabels({ labels, container, anchor }: { labels: readonly OverlayLabel[]; container: RefObject<HTMLElement | null>; anchor: RefObject<Object3D | null> }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const spans = useMemo(() => new Map<string, HTMLSpanElement>(), []);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    for (const label of labels) {
      const span = document.createElement("span");
      span.setAttribute("aria-hidden", "true");
      span.style.cssText = LABEL_CSS + (label.italic ? ";font-style:italic" : "");
      span.textContent = label.text;
      host.appendChild(span);
      spans.set(label.key, span);
    }
    return () => {
      spans.forEach((span) => span.remove());
      spans.clear();
    };
  }, [labels, container, spans]);

  const world = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const node = anchor.current;
    if (!node) return;
    for (const label of labels) {
      const span = spans.get(label.key);
      if (!span) continue;
      world.set(label.position[0], label.position[1], label.position[2]);
      node.localToWorld(world);
      world.project(camera);
      const visible = world.z < 1 && world.z > -1;
      span.style.display = visible ? "" : "none";
      span.style.transform = `translate(${((world.x + 1) / 2) * size.width}px, ${((1 - world.y) / 2) * size.height}px) translate(-50%, -50%)`;
    }
  });
  return null;
}

/** Element labels (capped, so a large supercell never becomes a wall of text) plus the selected atom's label. */
export function AtomLabels({
  geometry,
  style,
  mode,
  selection,
  container,
  anchor,
}: {
  geometry: DerivedGeometry;
  style: RepresentationStyle;
  mode: LabelMode;
  selection: AtomSelection;
  container: RefObject<HTMLElement | null>;
  anchor: RefObject<Object3D | null>;
}) {
  const labels = useMemo<OverlayLabel[]>(() => {
    const items: OverlayLabel[] = [];
    if (mode === "element") for (const atom of geometry.atoms.filter((a) => a.role !== "polyhedron-image").slice(0, 60)) items.push({ key: `atom-${atom.index}`, text: atom.element, position: atom.position });
    else if (selection) items.push({ key: "selected", text: selection.element, position: [selection.position[0], selection.position[1], selection.position[2] + (style.atomRadius[selection.element] ?? 0.3) + 0.3] });
    return items;
  }, [geometry, style, mode, selection]);
  return <OverlayLabels labels={labels} container={container} anchor={anchor} />;
}

/** Lattice axes a, b, c drawn from the cell origin along the true (non-orthogonal) lattice directions. */
export function CellAxes({ geometry, color, container, anchor }: { geometry: DerivedGeometry; color: string; container: RefObject<HTMLElement | null>; anchor: RefObject<Object3D | null> }) {
  const cell = geometry.cell;
  const { positions, labels } = useMemo(() => {
    const positions: number[] = [];
    const labels: OverlayLabel[] = [];
    if (!cell) return { positions, labels };
    const origin = cell.corners[0]!;
    const axes: [string, Vec3][] = [
      ["a", cell.corners[1]!],
      ["b", cell.corners[2]!],
      ["c", cell.corners[4]!],
    ];
    for (const [name, end] of axes) {
      const vector = [end[0] - origin[0], end[1] - origin[1], end[2] - origin[2]] as const;
      const length = Math.hypot(...vector);
      const scale = Math.min(3, length * 0.5) / length;
      const tip: Vec3 = [origin[0] + vector[0] * scale, origin[1] + vector[1] * scale, origin[2] + vector[2] * scale];
      positions.push(...origin, ...tip);
      labels.push({ key: `axis-${name}`, text: name, italic: true, position: [origin[0] + vector[0] * scale * 1.12, origin[1] + vector[1] * scale * 1.12, origin[2] + vector[2] * scale * 1.12] });
    }
    return { positions, labels };
  }, [cell]);
  if (!cell) return null;
  return (
    <>
      <ThickSegments positions={positions} color={color} width={1.4} opacity={0.9} renderOrder={5} />
      <OverlayLabels labels={labels} container={container} anchor={anchor} />
    </>
  );
}
