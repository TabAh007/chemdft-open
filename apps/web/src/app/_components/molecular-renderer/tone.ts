import { Color } from "three";

import type { RenderPreset } from "./presets";

const hsl = { h: 0, s: 0, l: 0 };

/** Hue-preserving tone for a preset. Element identity is carried by hue, which this never changes. */
export function presentedColor(hex: string, preset: RenderPreset): Color {
  const color = new Color(hex);
  color.getHSL(hsl);
  const { saturationScale, saturationLift, lightnessScale } = preset.tone;
  // lift only chromatic colours: near-white (H) and greys keep their neutrality
  const s = hsl.s < 0.08 ? hsl.s : Math.min(1, hsl.s * saturationScale + saturationLift * (1 - hsl.s * 0.5));
  return color.setHSL(hsl.h, s, Math.min(1, hsl.l * lightnessScale));
}

export const mixColors = (a: Color, b: Color, t: number): Color => a.clone().lerp(b, t);
