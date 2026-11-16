import type { Vec3 } from "../molecular-renderer/types";

/** Orthographic view used by the static (no-JavaScript, no-WebGL) illustration: lattice/Cartesian z is drawn vertically. */
export function staticProjection(point: Vec3, centre: Vec3, yaw: number, pitch: number): { x: number; y: number; depth: number } {
  const x0 = point[0] - centre[0];
  const y0 = point[2] - centre[2];
  const z0 = -(point[1] - centre[1]);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = x0 * cy + z0 * sy;
  const z1 = -x0 * sy + z0 * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y0 * cp - z1 * sp;
  const z2 = y0 * sp + z1 * cp;
  return { x: Math.round(x1 * 1000) / 1000, y: Math.round(-y2 * 1000) / 1000, depth: Math.round(z2 * 1000) / 1000 };
}
