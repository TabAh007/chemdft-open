"use client";

/* eslint-disable react-hooks/refs -- three.js scene-graph objects, uniforms and shared view refs are updated imperatively from the R3F frame loop and effects, outside React state (same convention as the previous homepage canvas) */

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, Matrix4, Object3D, type InstancedMesh } from "three";

import type { DerivedGeometry } from "../derive";
import { elementDisplay } from "../elements";
import type { RenderPreset } from "../presets";
import type { RepresentationStyle } from "../radii";
import { presentedColor } from "../tone";
import type { AtomSelection } from "../types";
import { damp, SETTLE } from "./damp";

/**
 * All atoms of the derived geometry as ONE instanced sphere mesh (one draw call). Per-element radius and per-atom
 * presence are *presentation* values: they chase their targets so representation switches and supercell changes
 * can animate, while every atom's position stays exactly where the structure puts it.
 */
export function AtomLayer({
  geometry,
  style,
  preset,
  segments,
  visible,
  entrance,
  immediate = false,
  onPick,
}: {
  geometry: DerivedGeometry;
  style: RepresentationStyle;
  preset: RenderPreset;
  segments: number;
  /** Presentation-only visibility: false scales every atom out (used while one structure is replaced by another). */
  visible: boolean;
  /** Whether the very first appearance animates (atoms grow in) instead of appearing at once. */
  entrance: boolean;
  immediate?: boolean;
  onPick?: (selection: AtomSelection) => void;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const atoms = geometry.atoms;
  const radius = useRef<Record<string, number>>({});
  const presence = useRef<Float32Array>(new Float32Array(0));
  const settled = useRef(false);
  const mounted = useRef(false);
  const scratch = useMemo(() => new Object3D(), []);
  const matrix = useMemo(() => new Matrix4(), []);

  const targets = useMemo(() => atoms.map((atom) => (!visible || (atom.role === "polyhedron-image" && !style.showPolyhedra) ? 0 : 1)), [atoms, style.showPolyhedra, visible]);
  const previous = useRef<{ atoms: DerivedGeometry["atoms"]; presence: Float32Array } | null>(null);

  const write = () => {
    const node = mesh.current;
    if (!node) return;
    atoms.forEach((atom, i) => {
      const scale = (radius.current[atom.element] ?? 0) * (presence.current[i] ?? 0);
      scratch.position.set(atom.position[0], atom.position[1], atom.position[2]);
      scratch.scale.setScalar(scale < 1e-4 ? 0 : scale);
      scratch.updateMatrix();
      node.setMatrixAt(i, scratch.matrix);
    });
    node.instanceMatrix.needsUpdate = true;
    node.boundingSphere = null;
    // Hidden polyhedron ligands are the trailing instances; do not send them to the GPU while they are not shown.
    let active = atoms.length;
    while (active > 0 && (radius.current[atoms[active - 1]!.element] ?? 0) * (presence.current[active - 1] ?? 0) < 1e-4) active--;
    node.count = active;
  };

  // Geometry change (new structure or supercell). Atoms that were already drawn at exactly the same place and element keep
  // their presence, so a supercell change adds or removes whole cells and never moves an atom; new atoms grow in. The very
  // first mount appears at once unless an entrance is requested.
  useLayoutEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (first) presence.current = entrance ? new Float32Array(atoms.length) : Float32Array.from(targets);
    else {
      const carried = new Map<string, number>();
      const before = previous.current;
      before?.atoms.forEach((atom, i) => carried.set(`${atom.element}:${atom.position.map((v) => Math.round(v * 1000)).join(",")}`, before.presence[i] ?? 0));
      presence.current = Float32Array.from(atoms, (atom) => carried.get(`${atom.element}:${atom.position.map((v) => Math.round(v * 1000)).join(",")}`) ?? 0);
    }
    previous.current = { atoms, presence: presence.current };
    for (const [element, r] of Object.entries(style.atomRadius)) if (first || radius.current[element] === undefined) radius.current[element] = r;
    settled.current = false;
    const node = mesh.current;
    if (node) {
      const color = new Color();
      atoms.forEach((atom, i) => {
        node.setColorAt(i, color.copy(presentedColor(elementDisplay(atom.element).color, preset)));
      });
      if (node.instanceColor) node.instanceColor.needsUpdate = true;
    }
    write();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `write` closes over refs only
  }, [atoms]);

  useLayoutEffect(() => {
    const node = mesh.current;
    if (node?.instanceColor) {
      atoms.forEach((atom, i) => node.setColorAt(i, presentedColor(elementDisplay(atom.element).color, preset)));
      node.instanceColor.needsUpdate = true;
    }
    invalidate();
  }, [atoms, preset, invalidate]);

  useLayoutEffect(() => {
    settled.current = false;
    invalidate();
    if (immediate) {
      radius.current = { ...style.atomRadius };
      presence.current = Float32Array.from(targets);
      write();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- write uses this effect's style/targets and stable instance refs.
  }, [style, targets, immediate, invalidate]);

  useFrame((_, delta) => {
    if (settled.current) return;
    let moving = false;
    for (const [element, target] of Object.entries(style.atomRadius)) {
      const current = radius.current[element] ?? target;
      const next = damp(current, target, 9, delta);
      if (Math.abs(next - target) > SETTLE * Math.max(0.3, target)) moving = true;
      radius.current[element] = Math.abs(next - target) > SETTLE * Math.max(0.3, target) ? next : target;
    }
    const p = presence.current;
    for (let i = 0; i < p.length; i++) {
      const target = targets[i] ?? 0;
      const next = damp(p[i]!, target, 8, delta);
      if (Math.abs(next - target) > 2e-3) moving = true;
      p[i] = Math.abs(next - target) > 2e-3 ? next : target;
    }
    write();
    if (moving) invalidate();
    else settled.current = true;
  });

  const pick = onPick
    ? (event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        const atom = atoms[event.instanceId ?? -1];
        if (atom && (presence.current[atom.index] ?? 0) > 0.5) onPick({ index: atom.index, element: atom.element, position: atom.position });
      }
    : undefined;

  void matrix;
  return (
    <instancedMesh key={atoms.length} ref={mesh} userData={{ chemdftLayer: "atoms" }} args={[undefined, undefined, atoms.length]} {...(pick ? { onClick: pick } : {})} frustumCulled={false}>
      <sphereGeometry args={[1, segments, Math.max(10, Math.round(segments * 0.66))]} />
      <meshStandardMaterial roughness={preset.material.roughness} metalness={preset.material.metalness} envMapIntensity={preset.material.envMapIntensity} />
    </instancedMesh>
  );
}
