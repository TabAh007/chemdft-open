import { add, cross, dot, sub } from "./lattice";
import type { Vec3 } from "./types";

/**
 * Faces of the convex hull of a small point set (coordination polyhedra have 3–12 vertices). Brute force over
 * triples is exact and plenty fast here; coplanar faces (a cube's squares) are merged and fan-triangulated.
 * Returned triangles index into `points` and are wound counter-clockwise seen from outside.
 */
export function convexHullFaces(points: readonly Vec3[], tolerance = 1e-3): [number, number, number][] {
  const n = points.length;
  if (n < 4) return [];
  const centroid = points.reduce<Vec3>((acc, p) => add(acc, p), [0, 0, 0]).map((v) => v / n) as unknown as Vec3;
  const planes = new Map<string, { normal: Vec3; offset: number; members: Set<number> }>();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const normalRaw = cross(sub(points[j]!, points[i]!), sub(points[k]!, points[i]!));
        const length = Math.hypot(...normalRaw);
        if (length < 1e-9) continue;
        let normal = normalRaw.map((v) => v / length) as unknown as Vec3;
        let offset = dot(normal, points[i]!);
        let positive = 0;
        let negative = 0;
        for (let m = 0; m < n; m++) {
          const side = dot(normal, points[m]!) - offset;
          if (side > tolerance) positive++;
          else if (side < -tolerance) negative++;
        }
        if (positive > 0 && negative > 0) continue; // not a supporting plane
        if (dot(normal, centroid) - offset > 0) {
          normal = normal.map((v) => -v) as unknown as Vec3;
          offset = -offset;
        }
        const key = [...normal, offset].map((v) => Math.round(v / tolerance)).join(",");
        const plane = planes.get(key) ?? { normal, offset, members: new Set<number>() };
        for (let m = 0; m < n; m++) if (Math.abs(dot(plane.normal, points[m]!) - plane.offset) <= tolerance) plane.members.add(m);
        planes.set(key, plane);
      }
  const faces: [number, number, number][] = [];
  for (const { normal, members } of planes.values()) {
    const ids = [...members];
    if (ids.length < 3) continue;
    const c = ids.reduce<Vec3>((acc, id) => add(acc, points[id]!), [0, 0, 0]).map((v) => v / ids.length) as unknown as Vec3;
    const u = sub(points[ids[0]!]!, c);
    const v = cross(normal, u);
    ids.sort((p, q) => Math.atan2(dot(sub(points[p]!, c), v), dot(sub(points[p]!, c), u)) - Math.atan2(dot(sub(points[q]!, c), v), dot(sub(points[q]!, c), u)));
    for (let t = 1; t < ids.length - 1; t++) faces.push([ids[0]!, ids[t]!, ids[t + 1]!]);
  }
  return faces;
}

/**
 * The true edges of a hull given its triangulated faces: an edge between two coplanar triangles is a triangulation
 * diagonal, not a polyhedron edge, and is dropped.
 */
export function hullEdges(points: readonly Vec3[], faces: readonly (readonly [number, number, number])[]): [number, number][] {
  const normals = (face: readonly [number, number, number]): Vec3 => {
    const n = cross(sub(points[face[1]]!, points[face[0]]!), sub(points[face[2]]!, points[face[0]]!));
    const length = Math.hypot(...n) || 1;
    return [n[0] / length, n[1] / length, n[2] / length];
  };
  const edges = new Map<string, { edge: [number, number]; normals: Vec3[] }>();
  for (const face of faces) {
    const normal = normals(face);
    for (const [p, q] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] as const) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const entry = edges.get(key) ?? { edge: (p < q ? [p, q] : [q, p]) as [number, number], normals: [] };
      entry.normals.push(normal);
      edges.set(key, entry);
    }
  }
  return [...edges.values()].filter(({ normals: adjacent }) => adjacent.length < 2 || dot(adjacent[0]!, adjacent[1]!) < 1 - 1e-6).map(({ edge }) => edge);
}
