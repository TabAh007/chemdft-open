"use client";

import { useEffect, useRef, useState } from "react";

import type { Vec3 } from "@chemdft/scientific-scene";

import {
  atomColor,
  atomRadius,
  bondRadius,
  cellLineSegments,
  sceneDisplayAtoms,
  shouldRenderBonds,
  stableBondOffset,
  type RendererProps,
} from "@/lib/visualization/renderer-utils";

type ThreeDMolModule = {
  createViewer: (element: HTMLElement, options: Record<string, unknown>) => ThreeDMolViewer;
};

type ThreeDMolViewer = {
  addSphere: (spec: Record<string, unknown>) => unknown;
  addCylinder: (spec: Record<string, unknown>) => unknown;
  addLine: (spec: Record<string, unknown>) => unknown;
  addLabel: (text: string, spec: Record<string, unknown>) => unknown;
  clear: () => void;
  removeAllShapes?: () => void;
  removeAllLabels?: () => void;
  render: () => void;
  zoomTo: () => void;
  setBackgroundColor?: (color: string, alpha?: number) => void;
  setProjection?: (projection: "orthographic" | "perspective") => void;
  getView?: () => unknown[];
  setView?: (view: unknown[]) => unknown;
};

export default function ThreeDMolViewport(props: RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ThreeDMolViewer | null>(null);
  const framedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function mountViewer() {
      if (!containerRef.current) return;
      try {
        if (!hasWebGl()) {
          setError("WEBGL_UNAVAILABLE: Browser WebGL is unavailable. Tables remain available below.");
          return;
        }
        const threeDmol = await import("3dmol") as unknown as ThreeDMolModule;
        if (cancelled || !containerRef.current) return;
        viewerRef.current = threeDmol.createViewer(containerRef.current, { backgroundColor: backgroundColor(props.state.background) });
        let restoredCamera = false;
        if (props.cameraStorageKey) {
          try {
            const stored = localStorage.getItem(props.cameraStorageKey);
            const view: unknown = stored ? JSON.parse(stored) : null;
            if (Array.isArray(view) && viewerRef.current.setView) {
              viewerRef.current.setView(view);
              restoredCamera = true;
            }
          } catch { /* Ignore an invalid saved display preference. */ }
        }
        renderScene(viewerRef.current, props, !restoredCamera);
        framedRef.current = true;
      } catch {
        setError("RENDERER_INITIALIZATION_FAILED: 3Dmol.js Scientific Mode could not initialize.");
      }
    }
    void mountViewer();
    return () => {
      cancelled = true;
      if (props.cameraStorageKey && viewerRef.current?.getView) {
        try { localStorage.setItem(props.cameraStorageKey, JSON.stringify(viewerRef.current.getView())); } catch { /* Storage is optional. */ }
      }
      viewerRef.current?.clear();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewerRef.current) {
      renderScene(viewerRef.current, props, !framedRef.current);
      framedRef.current = true;
    }
  }, [props]);

  if (error) return <div className="viewport-fallback">{error}</div>;
  return <div ref={containerRef} className="scientific-canvas" role="img" aria-label="3Dmol.js scientific structure viewport" />;
}

function renderScene(viewer: ThreeDMolViewer, props: RendererProps, frame: boolean): void {
  viewer.clear();
  viewer.setBackgroundColor?.(backgroundColor(props.state.background), props.state.background === "transparent" ? 0 : 1);
  viewer.setProjection?.(props.state.camera.projection);
  const atoms = sceneDisplayAtoms(props.scene, props.state);
  for (const atom of atoms) {
    viewer.addSphere({
      center: vector(atom.position),
      radius: atomRadius(atom.element, props.state.representation),
      color: atomColor(atom.element, props.state),
      clickable: true,
      callback: () => props.onSelectAtom(atom.sourceAtomIndex),
      opacity: atom.occupancy == null ? 1 : Math.max(0.25, atom.occupancy),
    });
    if (props.state.labels !== "none" && atoms.length <= 250) {
      viewer.addLabel(props.state.labels === "index" ? String(atom.sourceAtomIndex) : atom.element, {
        position: vector(atom.position),
        fontSize: 11,
        fontColor: "#17212B",
        backgroundOpacity: 0,
        inFront: true,
      });
    }
  }
  if (shouldRenderBonds(props.state.representation)) {
    for (const bond of props.scene.bonds) {
      const first = atoms.find((atom) => atom.sourceAtomIndex === bond.atomIndexA);
      const second = atoms.find((atom) => atom.sourceAtomIndex === bond.atomIndexB);
      if (!first || !second) continue;
      const offsets = bondOffsets(first.position, second.position, bond.order ?? 1);
      for (const offset of offsets) {
        viewer.addCylinder({
          start: vector(add(first.position, offset)),
          end: vector(add(second.position, offset)),
          radius: bondRadius(props.state.representation),
          color: "#6b737c",
          fromCap: true,
          toCap: true,
        });
      }
    }
  }
  if (props.state.unitCellVisible) {
    for (const [start, end] of cellLineSegments(props.scene, props.state.supercell)) {
      viewer.addLine({ start: vector(start), end: vector(end), color: "#315E8A", linewidth: 1 });
    }
  }
  for (const index of props.measurementAtomIndices) {
    const atom = atoms.find((candidate) => candidate.sourceAtomIndex === index);
    if (atom) viewer.addSphere({ center: vector(atom.position), radius: atomRadius(atom.element, props.state.representation) + 0.09, color: "#0B6FCB", opacity: 0.35 });
  }
  const selected = props.selectedAtomIndex == null ? null : atoms.find((atom) => atom.sourceAtomIndex === props.selectedAtomIndex);
  if (selected) viewer.addSphere({ center: vector(selected.position), radius: atomRadius(selected.element, props.state.representation) + 0.16, color: "#0B6FCB", opacity: 0.28 });
  if (frame) {
    viewer.zoomTo();
  }
  viewer.render();
}

function vector(position: Vec3): { x: number; y: number; z: number } {
  return { x: position[0], y: position[1], z: position[2] };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function bondOffsets(from: Vec3, to: Vec3, order: number): Vec3[] {
  if (order <= 1) return [[0, 0, 0]];
  const offset = stableBondOffset(from, to, 0.08);
  if (order === 2) return [offset, [-offset[0], -offset[1], -offset[2]]];
  return [[0, 0, 0], offset, [-offset[0], -offset[1], -offset[2]]];
}

function backgroundColor(background: string): string {
  if (background === "dark-neutral") return "#111820";
  if (background === "white" || background === "transparent") return "#ffffff";
  return "#eef3f6";
}

function hasWebGl(): boolean {
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}
