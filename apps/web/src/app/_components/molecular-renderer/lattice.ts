import type { LatticeParameters, Vec3 } from "./types";

const DEG = Math.PI / 180;

/** Row vectors of the lattice in the standard crystallographic setting (a along x, b in the xy plane). */
export function latticeVectors(l: LatticeParameters): readonly [Vec3, Vec3, Vec3] {
  const ca = Math.cos(l.alpha * DEG);
  const cb = Math.cos(l.beta * DEG);
  const cg = Math.cos(l.gamma * DEG);
  const sg = Math.sin(l.gamma * DEG);
  const cy = (ca - cb * cg) / sg;
  return [
    [l.a, 0, 0],
    [l.b * cg, l.b * sg, 0],
    [l.c * cb, l.c * cy, l.c * Math.sqrt(Math.max(0, 1 - cb * cb - cy * cy))],
  ];
}

export function fractionalToCartesian(frac: Vec3, vectors: readonly [Vec3, Vec3, Vec3]): Vec3 {
  return [0, 1, 2].map((axis) => frac[0] * vectors[0][axis]! + frac[1] * vectors[1][axis]! + frac[2] * vectors[2][axis]!) as unknown as Vec3;
}

export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
