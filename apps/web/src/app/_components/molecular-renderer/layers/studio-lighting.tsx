"use client";

import { Environment, Lightformer } from "@react-three/drei";

import type { RenderPreset } from "../presets";

/**
 * Authored studio lighting. The direct lights are parented to the camera (see CameraRig) so every view keeps the
 * same key/fill/rim relationship; the image-based environment is procedural (a few soft panels rendered once into
 * an environment map), so it needs no network and no HDR file. Specular response stays soft: no point lights, no
 * coloured lights, no glow.
 */
export function CameraLights({ preset }: { preset: RenderPreset }) {
  const { key, fill, rim, ambient } = preset.lights;
  return (
    <>
      <ambientLight intensity={ambient} />
      <directionalLight position={[...key.position]} intensity={key.intensity} color="#fffdf8" />
      <directionalLight position={[...fill.position]} intensity={fill.intensity} color="#f3f7ff" />
      {rim.intensity > 0 ? <directionalLight position={[...rim.position]} intensity={rim.intensity} color="#eaf1fb" /> : null}
    </>
  );
}

/** Soft rectangular panels: a broad key above-left, a dimmer fill opposite, and a thin strip behind for edge separation. */
export function StudioEnvironment({ preset }: { preset: RenderPreset }) {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={preset.lights.environment}>
      <color attach="background" args={["#d7dde4"]} />
      <Lightformer form="rect" intensity={2.4} position={[-6, 7, 6]} scale={[11, 7, 1]} target={[0, 0, 0]} color="#ffffff" />
      <Lightformer form="rect" intensity={0.8} position={[8, 2, 4]} scale={[6, 8, 1]} target={[0, 0, 0]} color="#eef3fa" />
      <Lightformer form="rect" intensity={0.9} position={[0, 5, -9]} scale={[14, 2.2, 1]} target={[0, 0, 0]} color="#ffffff" />
      <Lightformer form="rect" intensity={0.25} position={[0, -7, 3]} scale={[14, 5, 1]} target={[0, 0, 0]} color="#dfe6ee" />
    </Environment>
  );
}
