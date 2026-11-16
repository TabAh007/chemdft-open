"use client";

/* eslint-disable react-hooks/immutability -- the shadow pass renders the three.js scene into its own targets from the R3F frame loop, outside React state (same convention as the other renderer layers) */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, Color, Mesh, MeshDepthMaterial, PlaneGeometry, ShaderMaterial, UniformsUtils, WebGLRenderTarget, type Group, type OrthographicCamera } from "three";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";

type ContactShadowProps = {
  position: readonly [number, number, number];
  /** Edge length of the square shadow area, in scene units. Changing it rebuilds (and disposes) the render targets. */
  scale: number;
  far: number;
  blur: number;
  opacity: number;
  resolution: number;
  color: string;
};

/**
 * A radial fade (opaque at the centre, exactly transparent from 0.5 of the plane's half-width outward) multiplied into
 * the shadow's alpha. The blurred shadow has a faint tail over the whole plane; without this, half-float
 * post-processing keeps it and it shows as a hard polygon edge where the plane ends on a smooth page gradient.
 * One small shared texture, created on first use; it holds no per-structure state.
 */
let fadeTexture: CanvasTexture | null = null;
function radialFade(): CanvasTexture {
  if (fadeTexture) return fadeTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "#fff");
  gradient.addColorStop(0.55, "#fff");
  gradient.addColorStop(1, "#000");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  fadeTexture = new CanvasTexture(canvas);
  return fadeTexture;
}

const blurMaterial = (shader: typeof HorizontalBlurShader | typeof VerticalBlurShader) =>
  new ShaderMaterial({ uniforms: UniformsUtils.clone(shader.uniforms), vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader, depthTest: false });

/**
 * A baked, blurred soft shadow under the structure. The same technique as drei's `ContactShadows`, kept here because
 * drei's version never disposes its two render targets or its plane when it is rebuilt or unmounted, which leaked GPU
 * memory every time the homepage switched structure. This one releases everything it allocates.
 */
export function ContactShadow({ position, scale, far, blur, opacity, resolution, color }: ContactShadowProps) {
  const group = useRef<Group>(null);
  const shadowCamera = useRef<OrthographicCamera>(null);
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);

  const fade = useMemo(() => radialFade(), []);

  const parts = useMemo(() => {
    const target = new WebGLRenderTarget(resolution, resolution);
    const blurTarget = new WebGLRenderTarget(resolution, resolution);
    target.texture.generateMipmaps = blurTarget.texture.generateMipmaps = false;
    const plane = new PlaneGeometry(scale, scale).rotateX(Math.PI / 2);
    const blurPlane = new Mesh(plane);
    const depth = new MeshDepthMaterial();
    depth.depthTest = depth.depthWrite = false;
    const shadowColor = new Color(color);
    depth.onBeforeCompile = (shader) => {
      shader.uniforms = { ...shader.uniforms, ucolor: { value: shadowColor } };
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform vec3 ucolor;\nvoid main() {")
        // a coloured shadow whose centre stays darker
        .replace("vec4( vec3( 1.0 - fragCoordZ ), opacity );", "vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );");
    };
    return { target, blurTarget, plane, blurPlane, depth, horizontal: blurMaterial(HorizontalBlurShader), vertical: blurMaterial(VerticalBlurShader) };
  }, [resolution, scale, color]);

  useEffect(
    () => () => {
      parts.target.dispose();
      parts.blurTarget.dispose();
      parts.plane.dispose();
      parts.depth.dispose();
      parts.horizontal.dispose();
      parts.vertical.dispose();
    },
    [parts],
  );

  const blurPass = (amount: number) => {
    const { blurPlane, horizontal, vertical, target, blurTarget } = parts;
    blurPlane.visible = true;
    blurPlane.material = horizontal;
    horizontal.uniforms.tDiffuse!.value = target.texture;
    horizontal.uniforms.h!.value = amount / 256;
    gl.setRenderTarget(blurTarget);
    gl.render(blurPlane, shadowCamera.current!);
    blurPlane.material = vertical;
    vertical.uniforms.tDiffuse!.value = blurTarget.texture;
    vertical.uniforms.v!.value = amount / 256;
    gl.setRenderTarget(target);
    gl.render(blurPlane, shadowCamera.current!);
    blurPlane.visible = false;
  };

  useFrame(() => {
    const camera = shadowCamera.current;
    const node = group.current;
    if (!camera || !node) return;
    const background = scene.background;
    const override = scene.overrideMaterial;
    node.visible = false;
    scene.background = null;
    scene.overrideMaterial = parts.depth;
    gl.setRenderTarget(parts.target);
    gl.render(scene, camera);
    blurPass(blur);
    blurPass(blur * 0.4);
    gl.setRenderTarget(null);
    node.visible = true;
    scene.overrideMaterial = override;
    scene.background = background;
  });

  return (
    <group ref={group} position={[...position]} rotation-x={Math.PI / 2}>
      <mesh geometry={parts.plane} scale={[1, -1, 1]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial transparent map={parts.target.texture} opacity={opacity} depthWrite={false} alphaMap={fade} />
      </mesh>
      <orthographicCamera ref={shadowCamera} args={[-scale / 2, scale / 2, scale / 2, -scale / 2, 0, far]} />
    </group>
  );
}
