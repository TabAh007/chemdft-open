"use client";

/* eslint-disable react-hooks/immutability -- three.js scene-graph objects, uniforms and shared view refs are updated imperatively from the R3F frame loop and effects, outside React state (same convention as the previous homepage canvas) */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { BackSide, BufferGeometry, Float32BufferAttribute, FrontSide, MeshBasicMaterial, type Mesh } from "three";

import type { DerivedGeometry } from "../derive";
import { elementDisplay } from "../elements";
import type { RenderPreset } from "../presets";
import type { RepresentationStyle } from "../radii";
import { presentedColor } from "../tone";
import { damp } from "./damp";
import { ThickSegments } from "./thick-segments";

/**
 * Coordination polyhedra as thin translucent shells: one merged mesh drawn twice (back faces, then front faces) plus
 * one hairline edge object, so any number of polyhedra costs three draw calls. Depth ordering is exact, not
 * approximate: every shell is the same flat (unlit) tint, and alpha blending of identical colours is order
 * independent (result = tint·(1−Π(1−α)) + background·Π(1−α)), while the shells never write depth, so opaque atoms in
 * front still occlude them and atoms behind remain visible through them. Opacity is a presentation value that fades
 * in and out when the representation changes.
 */
export function PolyhedraLayer({ geometry, style, preset, visible, immediate = false }: { geometry: DerivedGeometry; style: RepresentationStyle; preset: RenderPreset; visible: boolean; immediate?: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  const opacity = useRef(0);
  const meshes = useRef<Mesh[]>([]);
  const settled = useRef(false);
  const target = style.showPolyhedra && visible ? 1 : 0;

  const { shell, edgePositions } = useMemo(() => {
    const edgeKeys = new Set<string>();
    const edgePositions: number[] = [];
    const positions: number[] = [];
    for (const polyhedron of geometry.polyhedra) {
      for (const face of polyhedron.faces) for (const v of face) positions.push(...geometry.atoms[polyhedron.vertices[v]!]!.position);
      for (const [i, j] of polyhedron.edges) {
        const a = geometry.atoms[polyhedron.vertices[i]!]!.position;
        const b = geometry.atoms[polyhedron.vertices[j]!]!.position;
        const key = [a, b].map((p) => p.map((v) => Math.round(v * 1000)).join(",")).sort().join("|");
        if (edgeKeys.has(key)) continue; // faces shared by neighbouring polyhedra share edges
        edgeKeys.add(key);
        edgePositions.push(...a, ...b);
      }
    }
    const shell = new BufferGeometry();
    shell.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return { shell, edgePositions };
  }, [geometry]);

  const materials = useMemo(() => {
    // A flat (unlit) translucent tint derived from the central cation's colour, a little deeper so it reads as a thin
    // coloured film rather than a white haze; lit materials would wash out under the key light.
    const tint = presentedColor(elementDisplay(geometry.atoms[geometry.polyhedra[0]?.center ?? 0]?.element ?? "Cr").color, preset);
    const hsl = { h: 0, s: 0, l: 0 };
    tint.getHSL(hsl);
    tint.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), hsl.l * 0.78);
    const make = (side: typeof FrontSide | typeof BackSide) => new MeshBasicMaterial({ color: tint, transparent: true, opacity: 0, side, depthWrite: false });
    return { front: make(FrontSide), back: make(BackSide) };
  }, [geometry, preset]);

  useEffect(() => () => shell.dispose(), [shell]);
  useEffect(
    () => () => {
      materials.front.dispose();
      materials.back.dispose();
    },
    [materials],
  );

  const apply = () => {
    materials.front.opacity = opacity.current * preset.polyhedra.opacity;
    materials.back.opacity = opacity.current * preset.polyhedra.opacity * 0.65;
    const visible = opacity.current > 0.004;
    meshes.current.forEach((mesh) => {
      if (mesh) mesh.visible = visible;
    });
  };

  useLayoutEffect(() => {
    settled.current = immediate;
    if (immediate) opacity.current = target;
    apply();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `apply` closes over refs only
  }, [target, materials, immediate]);

  useFrame((_, delta) => {
    if (settled.current) return;
    const next = damp(opacity.current, target, 7, delta);
    const moving = Math.abs(next - target) > 2e-3;
    opacity.current = moving ? next : target;
    apply();
    if (moving) invalidate();
    else settled.current = true;
  });

  if (geometry.polyhedra.length === 0) return null;
  return (
    <group>
      <mesh ref={(node) => void (node && (meshes.current[0] = node))} geometry={shell} material={materials.back} renderOrder={1} frustumCulled={false} />
      <mesh ref={(node) => void (node && (meshes.current[1] = node))} geometry={shell} material={materials.front} renderOrder={2} frustumCulled={false} />
      <ThickSegments positions={edgePositions} color={preset.edges.color} width={0.9} opacity={preset.polyhedra.edgeOpacity * 0.8} renderOrder={3} fade={opacity} />
    </group>
  );
}
