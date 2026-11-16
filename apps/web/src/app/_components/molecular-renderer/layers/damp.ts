import { MathUtils } from "three";

/** Presentation damping: values chase their targets exponentially. Coordinates are never passed through this. */
export const damp = MathUtils.damp;
export const SETTLE = 1e-3;

/** Shortest signed angular difference, radians. */
export function angleDelta(from: number, to: number): number {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}
