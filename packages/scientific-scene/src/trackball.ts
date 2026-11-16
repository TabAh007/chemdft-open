/**
 * Pure quaternion trackball (arcball) rotation math for molecular and crystal viewers.
 *
 * Requirements:
 * - Object follows cursor: left-drag moves front-facing point to -x, up-drag moves it to +y.
 * - No gimbal flip and no accumulated roll about the view axis.
 * - Turntable mode ("Keep c vertical"): rotates azimuthally around c/vertical axis, tilts elevation.
 * - Corner triad rotates in the exact same sense as the model.
 * - Pure and unit-testable without WebGL or DOM dependencies.
 */

import type { Vec3 } from "./types";

export type Quaternion4 = readonly [number, number, number, number]; // [x, y, z, w]

export interface TrackballOptions {
  /** Angular sensitivity in radians per pixel or normalized unit. Default: 0.005 */
  readonly sensitivity?: number;
  /** Keep c / vertical axis vertical (turntable mode). Default: false */
  readonly keepCVertical?: boolean;
  /** Optional vertical axis in world coordinates (defaults to [0, 0, 1]) */
  readonly verticalAxis?: Vec3;
}

export const IDENTITY_QUATERNION: Quaternion4 = [0, 0, 0, 1];

/**
 * Multiply two quaternions q1 * q2 (Hamilton product).
 * Hamilton product with vector-first quaternion [x, y, z, w].
 */
export function quaternionMultiply(a: Quaternion4, b: Quaternion4): Quaternion4 {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * Normalize quaternion to unit length.
 */
export function quaternionNormalize(q: Quaternion4): Quaternion4 {
  const [x, y, z, w] = q;
  const len = Math.hypot(x, y, z, w);
  if (len < 1e-12) return IDENTITY_QUATERNION;
  return [x / len, y / len, z / len, w / len];
}

/**
 * Rotate a 3D vector v by quaternion q: q * v * q^-1.
 */
export function quaternionRotateVector(q: Quaternion4, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;

  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (ay(y, vz) - az(z, vy));
  const ty = 2 * (az(z, vx) - ax(x, vz));
  const tz = 2 * (ax(x, vy) - ay(y, vx));

  // v' = v + w * t + cross(q.xyz, t)
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

function ax(a: number, b: number): number { return a * b; }
function ay(a: number, b: number): number { return a * b; }
function az(a: number, b: number): number { return a * b; }

/**
 * Invert quaternion.
 */
export function quaternionInvert(q: Quaternion4): Quaternion4 {
  const [x, y, z, w] = q;
  const lenSq = x * x + y * y + z * z + w * w;
  if (lenSq < 1e-12) return IDENTITY_QUATERNION;
  return [-x / lenSq, -y / lenSq, -z / lenSq, w / lenSq];
}

/**
 * Pure trackball rotation function:
 * Given cursor delta (dx, dy) and startOrientation, returns the new orientation quaternion.
 *
 * Mapping:
 * - Left-drag (dx < 0): front-facing surface point (0, 0, 1) moves to -x.
 * - Up-drag (dy > 0): front-facing surface point (0, 0, 1) moves to +y.
 * - Right-drag (dx > 0): front-facing point moves to +x.
 * - Down-drag (dy < 0): front-facing point moves to -y.
 *
 * The rotation axis lies strictly in the view plane (z=0 in view coordinates),
 * so dragging introduces zero instantaneous roll about the view axis.
 */
export function trackballRotate(
  dx: number,
  dy: number,
  startOrientation: Quaternion4 = IDENTITY_QUATERNION,
  options: TrackballOptions = {},
): Quaternion4 {
  const sensitivity = options.sensitivity ?? 0.005;

  if (options.keepCVertical) {
    return turntableRotate(dx, dy, startOrientation, sensitivity);
  }

  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) return startOrientation;

  const angle = dist * sensitivity;
  // Rotation axis in camera view coordinates:
  // To move front point (0, 0, 1) by (dx, dy):
  // ux = -dy / dist, uy = dx / dist, uz = 0.
  const ux = -dy / dist;
  const uy = dx / dist;

  const halfAngle = angle * 0.5;
  const sinH = Math.sin(halfAngle);
  const cosH = Math.cos(halfAngle);

  // Delta rotation in view space
  const deltaQ: Quaternion4 = [ux * sinH, uy * sinH, 0, cosH];

  // Apply in view space (multiply on left: deltaQ * startOrientation)
  return quaternionNormalize(quaternionMultiply(deltaQ, startOrientation));
}

/**
 * Turntable mode ("Keep c vertical"):
 * - Horizontal drag (dx) rotates azimuthally around the vertical axis.
 * - Vertical drag (dy) pitches elevation up/down, clamped to prevent upside-down flip.
 */
export function turntableRotate(
  dx: number,
  dy: number,
  startOrientation: Quaternion4,
  sensitivity = 0.005,
): Quaternion4 {
  // 1. Azimuthal rotation around the vertical axis (0, 1, 0 in view space or start frame)
  // Left drag (dx < 0) turns model left (yaw around +Y in view space)
  const yawAngle = dx * sensitivity;
  const halfYaw = yawAngle * 0.5;
  const yawQ: Quaternion4 = [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)];

  // 2. Pitch rotation around horizontal axis (-1, 0, 0 in view space)
  // Up drag (dy > 0) tilts model up
  const pitchAngle = dy * sensitivity;
  const halfPitch = pitchAngle * 0.5;
  const pitchQ: Quaternion4 = [-Math.sin(halfPitch), 0, 0, Math.cos(halfPitch)];

  const deltaQ = quaternionMultiply(pitchQ, yawQ);
  return quaternionNormalize(quaternionMultiply(deltaQ, startOrientation));
}

/**
 * Measure the roll angle (in radians) about the z view axis of a quaternion.
 */
export function quaternionRollAngle(q: Quaternion4): number {
  const [x, y, z, w] = q;
  // Roll angle around Z axis
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}
