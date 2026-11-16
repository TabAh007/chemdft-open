"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ScientificSceneBond, Vec3 } from "@chemdft/scientific-scene";

import {
  atomColor,
  atomRadius,
  bondRadius,
  cellLineSegments,
  sceneDisplayAtoms,
  shouldRenderBonds,
  stableBondOffset,
  type DisplayAtom,
  type RendererProps,
} from "@/lib/visualization/renderer-utils";

export default function StudioViewport(props: RendererProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<StudioRuntime | null>(null);
  const latestPropsRef = useRef(props);
  const [error, setError] = useState<string | null>(() => (
    typeof document !== "undefined" && !hasWebGl()
      ? "WEBGL_UNAVAILABLE: Browser WebGL is unavailable. Tables remain available below."
      : null
  ));

  useEffect(() => {
    latestPropsRef.current = props;
  }, [props]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || error) return;
    if (!hasWebGl()) {
      return;
    }
    try {
      const runtime = createRuntime(host, () => latestPropsRef.current);
      runtimeRef.current = runtime;
      runtime.renderScene(props);
      return () => {
        runtime.dispose();
        runtimeRef.current = null;
      };
    } catch {
      queueMicrotask(() => setError("RENDERER_INITIALIZATION_FAILED: Three.js Studio Mode could not initialize."));
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    runtimeRef.current?.renderScene(props);
  }, [props]);

  if (error) return <div className="viewport-fallback">{error}</div>;
  return <div ref={hostRef} className="scientific-canvas studio-canvas" aria-label="Three.js Studio structure viewport" />;
}

type StudioRuntime = {
  renderScene: (props: RendererProps) => void;
  dispose: () => void;
};

function createRuntime(host: HTMLDivElement, getProps: () => RendererProps): StudioRuntime {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.append(renderer.domElement);
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    host.dataset.rendererError = "WEBGL_CONTEXT_LOST";
  });

  const scene = new THREE.Scene();
  const perspectiveCamera = new THREE.PerspectiveCamera(38, 1, 0.01, 5000);
  const orthographicCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 5000);
  perspectiveCamera.position.set(0, 0, 14);
  orthographicCamera.position.set(0, 0, 14);
  const controls = new OrbitControls(perspectiveCamera, renderer.domElement);
  controls.enableDamping = true;
  controls.addEventListener("change", () => render());
  const group = new THREE.Group();
  scene.add(group);
  installLighting(scene);

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(host);
  renderer.domElement.addEventListener("click", (event) => selectFromClick(event));

  let currentCamera: THREE.Camera = perspectiveCamera;
  let animationFrame = 0;
  let atomInstanceMaps = new Map<THREE.InstancedMesh, readonly number[]>();

  function renderScene(props: RendererProps): void {
    disposeGroup(group);
    group.clear();
    scene.background = studioBackground(props.state.background);
    currentCamera = props.state.camera.projection === "orthographic" ? orthographicCamera : perspectiveCamera;
    controls.object = perspectiveCamera;
    atomInstanceMaps = buildAtoms(group, props);
    if (shouldRenderBonds(props.state.representation)) buildBonds(group, props);
    if (props.state.unitCellVisible) buildCell(group, props);
    buildSelection(group, props);
    buildMeasurements(group, props);
    fitCamera(props);
    resize();
    render();
  }

  function resize(): void {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();
    const span = 8 / getProps().state.camera.zoom;
    orthographicCamera.left = -span * (width / height);
    orthographicCamera.right = span * (width / height);
    orthographicCamera.top = span;
    orthographicCamera.bottom = -span;
    orthographicCamera.updateProjectionMatrix();
    render();
  }

  function render(): void {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => {
      controls.update();
      renderer.render(scene, currentCamera);
    });
  }

  function fitCamera(props: RendererProps): void {
    const atoms = sceneDisplayAtoms(props.scene, props.state);
    if (atoms.length === 0) return;
    const center = new THREE.Vector3();
    for (const atom of atoms) center.add(toVector3(atom.position));
    center.multiplyScalar(1 / atoms.length);
    controls.target.copy(center);
    const radius = Math.max(4, ...atoms.map((atom) => toVector3(atom.position).distanceTo(center))) * 2.2;
    perspectiveCamera.position.copy(center.clone().add(new THREE.Vector3(0, 0, radius)));
    orthographicCamera.position.copy(perspectiveCamera.position);
    perspectiveCamera.lookAt(center);
    orthographicCamera.lookAt(center);
  }

  function selectFromClick(event: MouseEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, currentCamera);
    const intersections = raycaster.intersectObjects(Array.from(atomInstanceMaps.keys()));
    const hit = intersections[0];
    if (!hit || hit.instanceId == null) return;
    const map = atomInstanceMaps.get(hit.object as THREE.InstancedMesh);
    const atomIndex = map?.[hit.instanceId];
    if (atomIndex != null) getProps().onSelectAtom(atomIndex);
  }

  function dispose(): void {
    resizeObserver.disconnect();
    controls.dispose();
    disposeGroup(group);
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { renderScene, dispose };
}

function buildAtoms(group: THREE.Group, props: RendererProps): Map<THREE.InstancedMesh, readonly number[]> {
  const atoms = sceneDisplayAtoms(props.scene, props.state);
  const byElement = new Map<string, DisplayAtom[]>();
  for (const atom of atoms) byElement.set(atom.element, [...(byElement.get(atom.element) ?? []), atom]);
  const maps = new Map<THREE.InstancedMesh, readonly number[]>();
  for (const [element, elementAtoms] of byElement) {
    const radius = atomRadius(element, props.state.representation);
    const geometry = new THREE.SphereGeometry(radius, props.state.representation === "space-fill" ? 32 : 20, props.state.representation === "space-fill" ? 16 : 12);
    const material = new THREE.MeshStandardMaterial({
      color: atomColor(element, props.state),
      roughness: 0.48,
      metalness: 0.02,
      transparent: elementAtoms.some((atom) => atom.occupancy != null && atom.occupancy < 1),
      opacity: 1,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, elementAtoms.length);
    const matrix = new THREE.Matrix4();
    for (const [instance, atom] of elementAtoms.entries()) {
      matrix.makeTranslation(atom.position[0], atom.position[1], atom.position[2]);
      mesh.setMatrixAt(instance, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    maps.set(mesh, elementAtoms.map((atom) => atom.sourceAtomIndex));
  }
  return maps;
}

function buildBonds(group: THREE.Group, props: RendererProps): void {
  const atoms = sceneDisplayAtoms(props.scene, props.state);
  for (const bond of props.scene.bonds) {
    const first = atoms.find((atom) => atom.sourceAtomIndex === bond.atomIndexA);
    const second = atoms.find((atom) => atom.sourceAtomIndex === bond.atomIndexB);
    if (!first || !second) continue;
    for (const offset of bondOffsets(first.position, second.position, bond)) {
      group.add(cylinderBetween(add(first.position, offset), add(second.position, offset), bondRadius(props.state.representation), 0x67717b));
    }
  }
}

function buildCell(group: THREE.Group, props: RendererProps): void {
  for (const [start, end] of cellLineSegments(props.scene, props.state.supercell)) {
    const geometry = new THREE.BufferGeometry().setFromPoints([toVector3(start), toVector3(end)]);
    group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x315e8a })));
  }
}

function buildSelection(group: THREE.Group, props: RendererProps): void {
  const atoms = sceneDisplayAtoms(props.scene, props.state);
  const selected = props.selectedAtomIndex == null ? null : atoms.find((atom) => atom.sourceAtomIndex === props.selectedAtomIndex);
  if (!selected) return;
  const geometry = new THREE.SphereGeometry(atomRadius(selected.element, props.state.representation) + 0.16, 24, 12);
  const material = new THREE.MeshBasicMaterial({ color: 0x0b6fcb, transparent: true, opacity: 0.24 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(toVector3(selected.position));
  group.add(mesh);
}

function buildMeasurements(group: THREE.Group, props: RendererProps): void {
  const atoms = sceneDisplayAtoms(props.scene, props.state).filter((atom) => props.measurementAtomIndices.includes(atom.sourceAtomIndex));
  for (let index = 1; index < atoms.length; index += 1) {
    const previous = atoms[index - 1];
    const current = atoms[index];
    if (!previous || !current) continue;
    group.add(cylinderBetween(previous.position, current.position, 0.025, 0x0b6fcb));
  }
}

function installLighting(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xf8fbff, 0xc7d0d8, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(8, 8, 12);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd7e7ff, 0.8);
  fill.position.set(-8, 4, 6);
  scene.add(fill);
}

function cylinderBetween(start: Vec3, end: Vec3, radius: number, color: number): THREE.Mesh {
  const from = toVector3(start);
  const to = toVector3(end);
  const direction = to.clone().sub(from);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 12);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.02 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(from.clone().add(to).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function bondOffsets(from: Vec3, to: Vec3, bond: ScientificSceneBond): Vec3[] {
  const order = bond.order ?? 1;
  if (order <= 1) return [[0, 0, 0]];
  const offset = stableBondOffset(from, to, 0.11);
  if (order === 2) return [offset, [-offset[0], -offset[1], -offset[2]]];
  return [[0, 0, 0], offset, [-offset[0], -offset[1], -offset[2]]];
}

function toVector3(value: Vec3): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function studioBackground(background: string): THREE.Color | null {
  if (background === "transparent") return null;
  if (background === "dark-neutral") return new THREE.Color("#111820");
  if (background === "white") return new THREE.Color("#ffffff");
  return new THREE.Color("#eef3f6");
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.InstancedMesh) {
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }
  });
}

function hasWebGl(): boolean {
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}
