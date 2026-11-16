import type { Vec3, ViewPreset } from "./types";

export const BOHR_TO_ANGSTROM = 0.529177210903;

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function magnitude(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function normalize(a: Vec3): Vec3 {
  const length = magnitude(a);
  if (length === 0) return [0, 0, 0];
  return scale(a, 1 / length);
}

export function distance(a: Vec3, b: Vec3): number {
  return magnitude(subtract(a, b));
}

export function angleDegrees(a: Vec3, b: Vec3, c: Vec3): number {
  const ba = normalize(subtract(a, b));
  const bc = normalize(subtract(c, b));
  const cosTheta = clamp(dot(ba, bc), -1, 1);
  return radiansToDegrees(Math.acos(cosTheta));
}

export function dihedralDegrees(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b0 = subtract(b, a);
  const b1 = subtract(c, b);
  const b2 = subtract(d, c);
  const b1n = normalize(b1);
  const v = subtract(b0, scale(b1n, dot(b0, b1n)));
  const w = subtract(b2, scale(b1n, dot(b2, b1n)));
  const x = dot(v, w);
  const y = dot(cross(b1n, v), w);
  return radiansToDegrees(Math.atan2(y, x));
}

export function fractionalToCartesian(
  fractional: Vec3,
  latticeVectors: readonly [Vec3, Vec3, Vec3],
): Vec3 {
  return add(
    add(scale(latticeVectors[0], fractional[0]), scale(latticeVectors[1], fractional[1])),
    scale(latticeVectors[2], fractional[2]),
  );
}

export function cartesianToFractional(
  cart: Vec3,
  latticeVectors: readonly [Vec3, Vec3, Vec3],
): Vec3 {
  const det = dot(latticeVectors[0], cross(latticeVectors[1], latticeVectors[2]));
  if (Math.abs(det) < 1e-12) return [0, 0, 0];
  const b1 = scale(cross(latticeVectors[1], latticeVectors[2]), 1 / det);
  const b2 = scale(cross(latticeVectors[2], latticeVectors[0]), 1 / det);
  const b3 = scale(cross(latticeVectors[0], latticeVectors[1]), 1 / det);
  return [dot(cart, b1), dot(cart, b2), dot(cart, b3)];
}

export function presetCameraDirection(
  preset: ViewPreset,
  cell?: { readonly latticeVectors: readonly [Vec3, Vec3, Vec3] } | undefined,
): { direction: Vec3; up: Vec3 } {
  switch (preset) {
    case "front": {
      return { direction: [0, -1, 0], up: [0, 0, 1] };
    }
    case "back": {
      return { direction: [0, 1, 0], up: [0, 0, 1] };
    }
    case "left": {
      return { direction: [-1, 0, 0], up: [0, 0, 1] };
    }
    case "right": {
      return { direction: [1, 0, 0], up: [0, 0, 1] };
    }
    case "top": {
      return { direction: [0, 0, 1], up: [0, 1, 0] };
    }
    case "bottom": {
      return { direction: [0, 0, -1], up: [0, -1, 0] };
    }
    case "isometric": {
      return { direction: normalize([1, 1, 1]), up: [0, 0, 1] };
    }
    case "along-a": {
      if (!cell) return { direction: [1, 0, 0], up: [0, 0, 1] };
      return { direction: normalize(cell.latticeVectors[0]), up: normalize(cell.latticeVectors[2]) };
    }
    case "along-b": {
      if (!cell) return { direction: [0, 1, 0], up: [0, 0, 1] };
      return { direction: normalize(cell.latticeVectors[1]), up: normalize(cell.latticeVectors[2]) };
    }
    case "along-c": {
      if (!cell) return { direction: [0, 0, 1], up: [0, 1, 0] };
      return { direction: normalize(cell.latticeVectors[2]), up: normalize(cell.latticeVectors[1]) };
    }
    case "along-a-star": {
      if (!cell) return { direction: [1, 0, 0], up: [0, 0, 1] };
      const [, vb, vc] = cell.latticeVectors;
      return { direction: normalize(cross(vb, vc)), up: normalize(vc) };
    }
    case "oblique":
    default:
      return {
        direction: normalize([1.1, 1.6, 1.75]),
        up: [0, 0, 1],
      };
  }
}

export function cellVolume(cell: {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
  latticeVectors?: readonly [Vec3, Vec3, Vec3] | undefined;
}): number {
  if (cell.latticeVectors && cell.latticeVectors.length === 3) {
    const det = dot(cell.latticeVectors[0], cross(cell.latticeVectors[1], cell.latticeVectors[2]));
    return Math.abs(det);
  }
  const rad = Math.PI / 180;
  const ca = Math.cos(cell.alpha * rad);
  const cb = Math.cos(cell.beta * rad);
  const cg = Math.cos(cell.gamma * rad);
  const term = 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg;
  return cell.a * cell.b * cell.c * Math.sqrt(Math.max(0, term));
}

/**
 * Faces of the convex hull of a small point set (coordination polyhedra have 3–12 vertices).
 * Triangles index into `points` and are wound counter-clockwise seen from outside.
 */
export function convexHullFaces(points: readonly Vec3[], tolerance = 1e-3): [number, number, number][] {
  const n = points.length;
  if (n < 4) return [];
  const c = centroid(points);
  const planes = new Map<string, { normal: Vec3; offset: number; members: Set<number> }>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const normalRaw = cross(subtract(points[j]!, points[i]!), subtract(points[k]!, points[i]!));
        const length = magnitude(normalRaw);
        if (length < 1e-9) continue;
        let normal = scale(normalRaw, 1 / length);
        let offset = dot(normal, points[i]!);
        let positive = 0;
        let negative = 0;
        for (let m = 0; m < n; m++) {
          const side = dot(normal, points[m]!) - offset;
          if (side > tolerance) positive++;
          else if (side < -tolerance) negative++;
        }
        if (positive > 0 && negative > 0) continue;
        if (dot(normal, c) - offset > 0) {
          normal = scale(normal, -1);
          offset = -offset;
        }
        const key = [...normal, offset].map((v) => Math.round(v / tolerance)).join(",");
        const plane = planes.get(key) ?? { normal, offset, members: new Set<number>() };
        for (let m = 0; m < n; m++) {
          if (Math.abs(dot(plane.normal, points[m]!) - plane.offset) <= tolerance) {
            plane.members.add(m);
          }
        }
        planes.set(key, plane);
      }
    }
  }
  const faces: [number, number, number][] = [];
  for (const { normal, members } of planes.values()) {
    const ids = [...members];
    if (ids.length < 3) continue;
    const center = scale(ids.reduce<Vec3>((acc, id) => add(acc, points[id]!), [0, 0, 0]), 1 / ids.length);
    const u = subtract(points[ids[0]!]!, center);
    const v = cross(normal, u);
    ids.sort((p, q) =>
      Math.atan2(dot(subtract(points[p]!, center), v), dot(subtract(points[p]!, center), u)) -
      Math.atan2(dot(subtract(points[q]!, center), v), dot(subtract(points[q]!, center), u)),
    );
    for (let t = 1; t < ids.length - 1; t++) faces.push([ids[0]!, ids[t]!, ids[t + 1]!]);
  }
  return faces;
}

/**
 * True edges of a hull: edges between two coplanar triangles are triangulation diagonals and are dropped.
 */
export function hullEdges(
  points: readonly Vec3[],
  faces: readonly (readonly [number, number, number])[],
): [number, number][] {
  const normalOf = (face: readonly [number, number, number]): Vec3 => {
    const n = cross(subtract(points[face[1]]!, points[face[0]]!), subtract(points[face[2]]!, points[face[0]]!));
    const len = magnitude(n) || 1;
    return scale(n, 1 / len);
  };
  const edges = new Map<string, { edge: [number, number]; normals: Vec3[] }>();
  for (const face of faces) {
    const normal = normalOf(face);
    for (const [p, q] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] as const) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const entry = edges.get(key) ?? { edge: (p < q ? [p, q] : [q, p]) as [number, number], normals: [] };
      entry.normals.push(normal);
      edges.set(key, entry);
    }
  }
  return [...edges.values()]
    .filter(({ normals: adjacent }) => adjacent.length < 2 || dot(adjacent[0]!, adjacent[1]!) < 1 - 1e-6)
    .map(({ edge }) => edge);
}

export function convertCoordinateToAngstrom(value: Vec3, unit: "angstrom" | "bohr"): Vec3 {
  return unit === "bohr" ? scale(value, BOHR_TO_ANGSTROM) : value;
}

export function centroid(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) return [0, 0, 0];
  const sum = points.reduce<Vec3>((total, point) => add(total, point), [0, 0, 0]);
  return scale(sum, 1 / points.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function radiansToDegrees(value: number): number {
  return value * (180 / Math.PI);
}
