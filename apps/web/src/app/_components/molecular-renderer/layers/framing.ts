import type { ProjectionMode } from "../types";

export type FramingExtent = { readonly horizontalRadius: number; readonly halfHeight: number };

/**
 * Fit the camera to a structure. The structure is a cylinder about the vertical axis (radius ρ, half-height h):
 * rotating about that axis never widens it, and at polar angle θ its projected half-height is at most
 * h·sinθ + ρ·cosθ (never more than √(h²+ρ²)). Fitting for the starting polar angle therefore keeps every rotation
 * inside the frame, up to the margin, without wasting a narrow (phone) stage the way a bounding sphere does.
 * Perspective: the structure's near side is up to ρ closer to the camera than its centre, which is accounted for.
 */
export function computeFit(options: {
  extent: FramingExtent;
  margin: number;
  projection: ProjectionMode;
  /** Vertical field of view in degrees (perspective). */
  fov: number;
  width: number;
  height: number;
  /** The polar angle the view starts at, radians. */
  polar: number;
  /** User zoom multiplier (1 = fitted). */
  zoom: number;
}): { distance: number; zoom: number; bound: number } {
  const { extent, margin, projection, fov, width, height, polar, zoom } = options;
  const rho = extent.horizontalRadius * margin;
  const h = extent.halfHeight;
  const vertical = (h * Math.abs(Math.sin(polar)) + extent.horizontalRadius * Math.abs(Math.cos(polar))) * margin;
  const depth = (h * Math.abs(Math.cos(polar)) + extent.horizontalRadius * Math.abs(Math.sin(polar))) * margin;
  const bound = Math.hypot(extent.horizontalRadius, h) * margin;
  if (projection === "orthographic") return { distance: bound * 6, zoom: Math.min(width / (2 * rho), height / (2 * vertical)) * zoom, bound };
  const vHalf = (fov * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * (width / Math.max(1, height)));
  const distance = Math.max(depth + rho / Math.tan(hHalf), depth + vertical / Math.tan(vHalf));
  return { distance: distance / zoom, zoom: 1, bound };
}
