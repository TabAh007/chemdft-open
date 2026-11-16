import type { PresetId, ProjectionMode } from "./types";

/**
 * Scientific / Editorial / Publication differ only in how the same geometry is lit, framed and finished.
 * Nothing here can move an atom, bend a lattice or add a bond.
 */
export type RenderPreset = {
  readonly id: PresetId;
  readonly label: string;
  /** CSS background of the stage. The WebGL canvas itself is transparent unless post-processing needs an opaque clear. */
  readonly background: string;
  /** Solid colour used as the WebGL clear when post-processing is on (it must match `background` visually). */
  readonly clearColor: string | null;
  readonly projection: ProjectionMode;
  readonly fov: number;
  /** Fraction of extra space around the bounding sphere when fitting. */
  readonly framingMargin: number;
  readonly material: { readonly roughness: number; readonly metalness: number; readonly envMapIntensity: number };
  /** Hue-preserving tone: saturation = s·scale + lift; lightness = l·scale. */
  readonly tone: { readonly saturationScale: number; readonly saturationLift: number; readonly lightnessScale: number };
  readonly lights: {
    readonly key: { readonly intensity: number; readonly position: readonly [number, number, number] };
    readonly fill: { readonly intensity: number; readonly position: readonly [number, number, number] };
    readonly rim: { readonly intensity: number; readonly position: readonly [number, number, number] };
    readonly ambient: number;
    readonly environment: number;
  };
  readonly ao: { readonly enabled: boolean; readonly aoRadius: number; readonly distanceFalloff: number; readonly intensity: number; readonly quality: "performance" | "low" | "medium" | "high" };
  readonly contactShadow: boolean;
  readonly edges: { readonly color: string; readonly width: number; readonly opacity: number; readonly dashedRear: boolean };
  readonly bonds: { readonly splitColour: boolean; readonly neutral: string; readonly neutralMix: number };
  /**
   * Scale of the *display-scale* atom spheres and bond cylinders (ball & stick, unit cell, polyhedra, wireframe). It is
   * a finish, like lighting: it never applies to space filling, whose radii are physical, and never moves a centre.
   */
  readonly display: { readonly atomScale: number; readonly bondScale: number };
  readonly polyhedra: { readonly opacity: number; readonly edgeOpacity: number };
  readonly showAxes: boolean;
  readonly reproducible: boolean;
};

const KEY = [-5, 7.5, 8] as const;
const FILL = [7, 1.5, 5] as const;
const RIM = [1.5, 4, -9] as const;

export const PRESETS: Readonly<Record<PresetId, RenderPreset>> = {
  scientific: {
    id: "scientific",
    label: "Scientific",
    background: "#f4f7f8",
    clearColor: null,
    projection: "perspective",
    fov: 30,
    framingMargin: 1.05,
    material: { roughness: 0.5, metalness: 0, envMapIntensity: 0.55 },
    tone: { saturationScale: 1, saturationLift: 0, lightnessScale: 1 },
    lights: { key: { intensity: 1.5, position: KEY }, fill: { intensity: 0.7, position: FILL }, rim: { intensity: 0.15, position: RIM }, ambient: 0.35, environment: 0.7 },
    ao: { enabled: false, aoRadius: 1, distanceFalloff: 1, intensity: 1, quality: "medium" },
    contactShadow: false,
    edges: { color: "#18212b", width: 1.2, opacity: 0.8, dashedRear: false },
    bonds: { splitColour: false, neutral: "#8a98a5", neutralMix: 1 },
    display: { atomScale: 1, bondScale: 1 },
    polyhedra: { opacity: 0.2, edgeOpacity: 0.6 },
    showAxes: true,
    reproducible: false,
  },
  editorial: {
    id: "editorial",
    label: "Editorial",
    background: "#f7f9fb",
    clearColor: null,
    projection: "perspective",
    fov: 26,
    framingMargin: 1.10,
    material: { roughness: 0.52, metalness: 0, envMapIntensity: 0.65 },
    tone: { saturationScale: 0.9, saturationLift: 0.08, lightnessScale: 0.86 },
    lights: { key: { intensity: 2.5, position: KEY }, fill: { intensity: 0.55, position: FILL }, rim: { intensity: 0.45, position: RIM }, ambient: 0.06, environment: 0.55 },
    ao: { enabled: true, aoRadius: 0.9, distanceFalloff: 1.0, intensity: 1.5, quality: "medium" },
    contactShadow: true,
    edges: { color: "#2b3a49", width: 1.1, opacity: 0.62, dashedRear: false },
    bonds: { splitColour: true, neutral: "#8a98a5", neutralMix: 0.28 },
    display: { atomScale: 0.84, bondScale: 0.78 },
    polyhedra: { opacity: 0.14, edgeOpacity: 0.4 },
    showAxes: false,
    reproducible: false,
  },
  publication: {
    id: "publication",
    label: "Publication",
    background: "#ffffff",
    clearColor: null,
    projection: "orthographic",
    fov: 30,
    framingMargin: 1.05,
    material: { roughness: 0.55, metalness: 0, envMapIntensity: 0.4 },
    tone: { saturationScale: 1, saturationLift: 0, lightnessScale: 1 },
    lights: { key: { intensity: 1.35, position: KEY }, fill: { intensity: 0.95, position: FILL }, rim: { intensity: 0, position: RIM }, ambient: 0.5, environment: 0.5 },
    ao: { enabled: false, aoRadius: 1, distanceFalloff: 1, intensity: 1, quality: "medium" },
    contactShadow: false,
    edges: { color: "#111827", width: 1.6, opacity: 1, dashedRear: true },
    bonds: { splitColour: true, neutral: "#6b7785", neutralMix: 0.2 },
    display: { atomScale: 1, bondScale: 1 },
    polyhedra: { opacity: 0.2, edgeOpacity: 0.8 },
    showAxes: true,
    reproducible: true,
  },
};
