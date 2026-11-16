"use client";

import { EffectComposer, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

import type { RenderPreset } from "../presets";

/**
 * The only post-processing ChemDFT uses: subtle ambient occlusion (N8AO), neutral tone mapping and SMAA. There is
 * deliberately no bloom, chromatic aberration, grain, depth of field or lens distortion, and the scene reads
 * correctly without any of it (presets with `ao.enabled === false` never mount this).
 */
export function Effects({ preset, compact }: { preset: RenderPreset; compact: boolean }) {
  const { aoRadius, distanceFalloff, intensity, quality } = preset.ao;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO aoRadius={aoRadius} distanceFalloff={distanceFalloff} intensity={intensity} quality={compact ? "performance" : quality} halfRes={compact} color="#55657a" />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <SMAA />
    </EffectComposer>
  );
}
