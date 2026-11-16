import {
  displayAtomsAndBondsForCrystal,
  displayAtomsForSupercell,
  elementColor,
  elementVisual,
  inferVisualBonds,
  type RepresentationMode,
  type RenderableSceneData,
  type SupercellState,
  type Vec3,
  type VisualBond,
  type VisualizationState,
} from "@chemdft/scientific-scene";
import { insertPngMetadataToDataUrl } from "./snapshot-processor";

export type DisplayAtom = ReturnType<typeof displayAtomsForSupercell>[number];

export type RendererProps = {
  scene: RenderableSceneData;
  state: VisualizationState;
  selectedAtomIndex: number | null;
  measurementAtomIndices: readonly number[];
  onSelectAtom: (atomIndex: number) => void;
  cameraStorageKey?: string | undefined;
};

export const ELEMENT_NAMES: Readonly<Record<string, string>> = {
  H: "Hydrogen",
  He: "Helium",
  Li: "Lithium",
  Be: "Beryllium",
  B: "Boron",
  C: "Carbon",
  N: "Nitrogen",
  O: "Oxygen",
  F: "Fluorine",
  Ne: "Neon",
  Na: "Sodium",
  Mg: "Magnesium",
  Al: "Aluminum",
  Si: "Silicon",
  P: "Phosphorus",
  S: "Sulfur",
  Cl: "Chlorine",
  Ar: "Argon",
  K: "Potassium",
  Ca: "Calcium",
  Sc: "Scandium",
  Ti: "Titanium",
  V: "Vanadium",
  Cr: "Chromium",
  Mn: "Manganese",
  Fe: "Iron",
  Co: "Cobalt",
  Ni: "Nickel",
  Cu: "Copper",
  Zn: "Zinc",
  Br: "Bromine",
  I: "Iodine",
};

export function elementName(element: string): string {
  return ELEMENT_NAMES[element] ?? element;
}

export function sceneDisplayAtoms(
  scene: RenderableSceneData,
  state: VisualizationState,
  visualBonds?: readonly VisualBond[],
): readonly DisplayAtom[] {
  if (
    scene.kind === "PERIODIC" &&
    scene.cell &&
    state.supercell.nx === 1 &&
    state.supercell.ny === 1 &&
    state.supercell.nz === 1
  ) {
    const bonds = visualBonds ?? inferVisualBonds(scene);
    const crystal = displayAtomsAndBondsForCrystal(scene, bonds, state.cellContents ?? "coordination");
    return crystal.atoms.filter(
      (atom) => state.hydrogensVisible || atom.element !== "H",
    ) as unknown as readonly DisplayAtom[];
  }
  return displayAtomsForSupercell(scene, state.supercell).filter(
    (atom) => state.hydrogensVisible || atom.element !== "H",
  );
}

export function atomColor(element: string, state: VisualizationState): string {
  return elementColor(element, state.colorScheme);
}

export function atomRadius(
  element: string,
  representation: RepresentationMode,
  scale = 1,
): number {
  const visual = elementVisual(element);
  let base: number;
  if (representation === "space-fill") base = visual.vanDerWaalsRadius * 0.44;
  else if (representation === "wireframe") base = 0.05;
  else if (representation === "sticks") base = 0.085;
  else base = element === "H" ? 0.25 : Math.max(0.32, Math.min(0.46, visual.covalentRadius * 0.48));
  return base * scale;
}

export function calculateSnapshotDimensions(
  viewportWidth: number,
  viewportHeight: number,
  scale: 1 | 2 | 4,
): { width: number; height: number; multiplier: number } {
  const w = Math.max(100, viewportWidth);
  const h = Math.max(100, viewportHeight);
  const longSide = Math.max(w, h);
  let multiplier: number;
  if (scale === 4) {
    multiplier = Math.max(4, Math.ceil(3000 / longSide));
  } else if (scale === 2) {
    multiplier = 2;
  } else {
    multiplier = 1;
  }
  return {
    width: Math.round(w * multiplier),
    height: Math.round(h * multiplier),
    multiplier,
  };
}

export function bondRadius(representation: RepresentationMode): number {
  if (representation === "wireframe") return 0.02;
  if (representation === "sticks") return 0.085;
  return 0.07;
}

export function shouldRenderBonds(representation: RepresentationMode): boolean {
  return representation !== "space-fill";
}

export type BondSegment = {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly color: string;
  readonly radius: number;
};

export function calculateTwoColorBondSegments(
  from: Vec3,
  to: Vec3,
  colorA: string,
  colorB: string,
  radius: number,
): readonly BondSegment[] {
  if (colorA === colorB) {
    return [{ start: from, end: to, color: colorA, radius }];
  }
  const mid: Vec3 = [
    (from[0] + to[0]) * 0.5,
    (from[1] + to[1]) * 0.5,
    (from[2] + to[2]) * 0.5,
  ];
  return [
    { start: from, end: mid, color: colorA, radius },
    { start: mid, end: to, color: colorB, radius },
  ];
}

export function cellLineSegments(scene: RenderableSceneData, supercell: SupercellState): readonly [Vec3, Vec3][] {
  if (!scene.cell) return [];
  const [a, b, c] = scene.cell.latticeVectors;
  const nx = Math.max(1, Math.floor(supercell.nx));
  const ny = Math.max(1, Math.floor(supercell.ny));
  const nz = Math.max(1, Math.floor(supercell.nz));
  const ax: Vec3 = [a[0] * nx, a[1] * nx, a[2] * nx];
  const by: Vec3 = [b[0] * ny, b[1] * ny, b[2] * ny];
  const cz: Vec3 = [c[0] * nz, c[1] * nz, c[2] * nz];
  const o: Vec3 = [0, 0, 0];
  const ab = add(ax, by);
  const ac = add(ax, cz);
  const bc = add(by, cz);
  const abc = add(ab, cz);
  return [
    [o, ax], [o, by], [o, cz],
    [ax, ab], [ax, ac],
    [by, ab], [by, bc],
    [cz, ac], [cz, bc],
    [ab, abc], [ac, abc], [bc, abc],
  ];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function magnitude(a: Vec3): number {
  return Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
}

export function normalize(a: Vec3): Vec3 {
  const length = magnitude(a);
  return length === 0 ? [0, 0, 0] : scale(a, 1 / length);
}

export function stableBondOffset(from: Vec3, to: Vec3, distance: number): Vec3 {
  const axis = normalize(subtract(to, from));
  const reference: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  return scale(normalize(cross(axis, reference)), distance);
}

export function exportViewportPng(container: HTMLElement, filename: string): boolean {
  const canvas = container.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return false;
  const href = insertPngMetadataToDataUrl(canvas.toDataURL("image/png"));
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  return true;
}

export type SceneVisualBounds = {
  readonly center: Vec3;
  readonly radius: number;
  readonly box: { min: Vec3; max: Vec3 };
};

export function computeSceneVisualBounds(
  atoms: readonly { readonly element: string; readonly position: Vec3 }[],
  representation: RepresentationMode,
): SceneVisualBounds {
  if (atoms.length === 0) {
    return {
      center: [0, 0, 0],
      radius: 1.5,
      box: { min: [-1, -1, -1], max: [1, 1, 1] },
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const atom of atoms) {
    const r = atomRadius(atom.element, representation);
    const [x, y, z] = atom.position;
    if (x - r < minX) minX = x - r;
    if (x + r > maxX) maxX = x + r;
    if (y - r < minY) minY = y - r;
    if (y + r > maxY) maxY = y + r;
    if (z - r < minZ) minZ = z - r;
    if (z + r > maxZ) maxZ = z + r;
  }

  const center: Vec3 = [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];

  let maxDist = 0.4;
  for (const atom of atoms) {
    const r = atomRadius(atom.element, representation);
    const [x, y, z] = atom.position;
    const dist = Math.hypot(x - center[0], y - center[1], z - center[2]) + r;
    if (dist > maxDist) maxDist = dist;
  }

  return {
    center,
    radius: maxDist,
    box: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}

export function calculateCanonicalCameraDistance(
  boundingRadius: number,
  aspectRatio: number,
  fovDegrees: number = 35,
  marginFactor: number = 1.15,
): { distance: number; orthoSpan: number } {
  const radius = Math.max(0.4, boundingRadius);
  const verticalHalfFov = (fovDegrees * 0.5 * Math.PI) / 180;
  const aspect = Math.max(0.1, aspectRatio);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  const limitingFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const distance = (radius / Math.sin(limitingFov)) * marginFactor;
  const orthoSpan = (radius * marginFactor) / Math.min(1, aspect);
  return { distance, orthoSpan };
}

export function computeSceneAndCellVisualBounds(
  atoms: readonly { readonly element: string; readonly position: Vec3 }[],
  cellPoints: readonly Vec3[],
  representation: RepresentationMode,
): SceneVisualBounds {
  const base = computeSceneVisualBounds(atoms, representation);
  if (cellPoints.length === 0) return base;

  let minX = base.box.min[0];
  let minY = base.box.min[1];
  let minZ = base.box.min[2];
  let maxX = base.box.max[0];
  let maxY = base.box.max[1];
  let maxZ = base.box.max[2];

  for (const [x, y, z] of cellPoints) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const center: Vec3 = [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];

  let maxDist = 0.4;
  for (const atom of atoms) {
    const r = atomRadius(atom.element, representation);
    const [x, y, z] = atom.position;
    const dist = Math.hypot(x - center[0], y - center[1], z - center[2]) + r;
    if (dist > maxDist) maxDist = dist;
  }

  for (const [x, y, z] of cellPoints) {
    const dist = Math.hypot(x - center[0], y - center[1], z - center[2]);
    if (dist > maxDist) maxDist = dist;
  }

  return {
    center,
    radius: maxDist,
    box: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}


