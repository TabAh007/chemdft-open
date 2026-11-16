"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, Matrix4, Quaternion, Vector3, type InstancedMesh } from "three";

import type { DerivedGeometry } from "../derive";
import { elementDisplay } from "../elements";
import type { RenderPreset } from "../presets";
import type { RepresentationStyle } from "../radii";
import { mixColors, presentedColor } from "../tone";
import { damp, SETTLE } from "./damp";

const UP = new Vector3(0, 1, 0);

/**
 * Display bonds as cylinders running centre-to-centre, split at the midpoint so each half carries its own atom's
 * colour (or one neutral colour). The ends sit inside the atom spheres, so intersections are clean and no gap can
 * open. Only bonds the structure's rule (or canonical connectivity) supplies are drawn.
 */
export function BondLayer({
  geometry,
  style,
  preset,
  segments,
  visible,
  entrance,
  immediate = false,
}: {
  geometry: DerivedGeometry;
  style: RepresentationStyle;
  preset: RenderPreset;
  segments: number;
  visible: boolean;
  entrance: boolean;
  immediate?: boolean;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const bonds = geometry.bonds;
  const radius = useRef(style.bondRadius);
  const presence = useRef<Float32Array>(new Float32Array(0));
  const settled = useRef(false);
  const mounted = useRef(false);

  const targets = useMemo(() => bonds.map((bond) => (!visible || !style.showBonds || (bond.polyhedraOnly && !style.showPolyhedra) ? 0 : 1)), [bonds, style.showBonds, style.showPolyhedra, visible]);
  const previous = useRef<{ keys: string[]; presence: Float32Array } | null>(null);
  const bondKey = (bond: DerivedGeometry["bonds"][number]) => [bond.a, bond.b].map((i) => geometry.atoms[i]!.position.map((v) => Math.round(v * 1000)).join(",")).sort().join("|");

  const write = () => {
    const node = mesh.current;
    if (!node) return;
    const matrix = new Matrix4();
    const a = new Vector3();
    const b = new Vector3();
    const mid = new Vector3();
    const direction = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    bonds.forEach((bond, i) => {
      const pa = geometry.atoms[bond.a]!.position;
      const pb = geometry.atoms[bond.b]!.position;
      a.set(pa[0], pa[1], pa[2]);
      b.set(pb[0], pb[1], pb[2]);
      mid.copy(a).add(b).multiplyScalar(0.5);
      const r = radius.current * (presence.current[i] ?? 0);
      const live = r > 1e-4;
      for (const half of [0, 1]) {
        const from = half === 0 ? a : b;
        direction.copy(mid).sub(from);
        const length = direction.length();
        quaternion.setFromUnitVectors(UP, direction.normalize());
        matrix.compose(mid.clone().add(from).multiplyScalar(0.5), quaternion, live ? scale.set(r, length, r) : scale.set(0, 0, 0));
        node.setMatrixAt(i * 2 + half, matrix);
      }
    });
    node.instanceMatrix.needsUpdate = true;
    node.boundingSphere = null;
  };

  useLayoutEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    const keys = bonds.map(bondKey);
    if (first) presence.current = entrance ? new Float32Array(bonds.length) : Float32Array.from(targets);
    else {
      // bonds already drawn between the same two positions keep their presence; only new bonds grow in
      const carried = new Map<string, number>();
      previous.current?.keys.forEach((key, i) => carried.set(key, previous.current!.presence[i] ?? 0));
      presence.current = Float32Array.from(keys, (key) => carried.get(key) ?? 0);
    }
    previous.current = { keys, presence: presence.current };
    if (first) radius.current = style.bondRadius;
    settled.current = false;
    const node = mesh.current;
    if (node) {
      const neutral = new Color(preset.bonds.neutral);
      bonds.forEach((bond, i) => {
        for (const half of [0, 1]) {
          const atom = geometry.atoms[half === 0 ? bond.a : bond.b]!;
          const base = presentedColor(elementDisplay(atom.element).color, preset);
          node.setColorAt(i * 2 + half, preset.bonds.splitColour ? mixColors(base, neutral, preset.bonds.neutralMix) : neutral);
        }
      });
      if (node.instanceColor) node.instanceColor.needsUpdate = true;
    }
    write();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `write` closes over refs only
  }, [bonds, preset]);

  useLayoutEffect(() => {
    settled.current = false;
    invalidate();
    if (immediate) {
      radius.current = style.bondRadius;
      presence.current = Float32Array.from(targets);
      write();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- write uses this effect's style/targets and stable instance refs.
  }, [style, targets, immediate, invalidate]);

  useFrame((_, delta) => {
    if (settled.current) return;
    let moving = false;
    const target = style.bondRadius;
    const next = damp(radius.current, target, 9, delta);
    if (Math.abs(next - target) > SETTLE * 0.2) moving = true;
    radius.current = Math.abs(next - target) > SETTLE * 0.2 ? next : target;
    const p = presence.current;
    for (let i = 0; i < p.length; i++) {
      const t = targets[i] ?? 0;
      const n = damp(p[i]!, t, 8, delta);
      if (Math.abs(n - t) > 2e-3) moving = true;
      p[i] = Math.abs(n - t) > 2e-3 ? n : t;
    }
    write();
    if (moving) invalidate();
    else settled.current = true;
  });

  if (bonds.length === 0) return null;
  return (
    <instancedMesh key={bonds.length} ref={mesh} args={[undefined, undefined, bonds.length * 2]} frustumCulled={false}>
      <cylinderGeometry args={[1, 1, 1, segments, 1, true]} />
      <meshStandardMaterial roughness={Math.min(0.9, preset.material.roughness + 0.1)} metalness={0} envMapIntensity={preset.material.envMapIntensity * 0.8} />
    </instancedMesh>
  );
}
