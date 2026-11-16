"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  buildScientificScene,
  DEFAULT_VISUALIZATION_STATE,
  inferVisualBonds,
  potentialColor,
  type VolumetricField,
  type FieldSurface,
} from "@chemdft/scientific-scene";
import { buildVtkFieldSurface, type IndexedFieldSurface } from "@/lib/visualization/field-surface-vtk";
import type { StructureVersionDetail } from "@chemdft/schemas";
import { calculateCanonicalCameraDistance } from "@/lib/visualization/renderer-utils";
import { insertPngMetadataToDataUrl } from "@/lib/visualization/snapshot-processor";
import { buildMoleculeInGroup } from "./structure-viewport";

type Props = {
  structure: StructureVersionDetail;
  grid: VolumetricField;
  potential?: VolumetricField | undefined;
  onSurface?: (surface: FieldSurface) => void;
  isovalue: number;
  opacity: number;
  showMolecule: boolean;
  showPositive: boolean;
  showNegative: boolean;
  fitToken: number;
  fitTarget: "molecule" | "surface";
  active: boolean;
  cameraKey: string;
};

export default function OrbitalIsosurfaceViewport(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let created: Runtime | null = null;
    try {
      const runtime = createRuntime(host);
      created = runtime;
      runtimeRef.current = runtime;
      runtime.update(props);
      const exportImage = () => runtime.exportImage();
      window.addEventListener("chemdft:export-field-image", exportImage);
      return () => {
        window.removeEventListener("chemdft:export-field-image", exportImage);
        runtime.dispose();
        runtimeRef.current = null;
      };
    } catch (failure) {
      created?.dispose();
      runtimeRef.current = null;
      queueMicrotask(() => setError(`Renderer unavailable: ${failure instanceof Error ? failure.message : "WebGL could not start"}. Saved scientific records remain available.`));
    }
    return undefined;
    // Renderer is created once; live state arrives through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);

  useEffect(() => {
    try { runtimeRef.current?.update(props); }
    catch (failure) {
      runtimeRef.current?.dispose(); runtimeRef.current = null;
      queueMicrotask(() => setError(`Surface unavailable: ${failure instanceof Error ? failure.message : "Rendering failed"}. Saved scientific records remain available.`));
    }
  }, [props]);

  return error
    ? <div className="mo-viewport-fallback" role="alert">{error}<button type="button" onClick={() => { setError(null); setRetry(value => value + 1); }}>Retry renderer</button></div>
    : <div ref={hostRef} className="mo-viewport" aria-label={props.potential ? "ESP mapped electron-density surface" : props.grid.manifest.field_quantity === "ELECTRON_DENSITY" ? "Electron-density isosurface" : "Molecular orbital positive and negative phase isosurfaces"} />;
}

type Runtime = { update: (props: Props) => void; dispose: () => void; exportImage: () => void };

function createRuntime(host: HTMLDivElement): Runtime {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf4f7f8, 1);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f7f8);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  // Event-driven rendering: direct orbit updates avoid an unfinished damping step.
  controls.enableDamping = false;
  controls.addEventListener("change", render);
  scene.add(new THREE.HemisphereLight(0xf8fbff, 0x64748b, 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(8, 12, 10);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd7e7ff, 0.8);
  fill.position.set(-8, 4, 6);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.4);
  rim.position.set(0, -8, -10);
  scene.add(rim);
  const orbitals = new THREE.Group();
  const molecule = new THREE.Group();
  scene.add(orbitals, molecule);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  let needsFit = true;
  let latestFitToken = -1;
  let meshKey = "";
  let sourceStructure: StructureVersionDetail | null = null;
  let latest: Props | null = null;
  let phaseSurfaces: IndexedFieldSurface[] = [];
  let initialized = false;
  let surfaceBuilds = 0;
  let disposed = false;

  function render() {
    if (disposed) return;
    renderer.render(scene, camera);
    host.dataset.camera = JSON.stringify({ position: camera.position.toArray(), target: controls.target.toArray() });
    if (initialized && latest) {
      try {
        localStorage.setItem(latest.cameraKey, host.dataset.camera);
        const structureFallbackKey = `chemdft:structure-view:${latest.structure.version.id}:camera`;
        localStorage.setItem(structureFallbackKey, host.dataset.camera);
      } catch {
        /* Storage is optional */
      }
    }
  }
  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  }
  function clear(group: THREE.Group) {
    for (const child of [...group.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material?.dispose());
    }
    group.clear();
  }
  function fit(props: Props) {
    const bounds = new THREE.Box3();
    if (props.fitTarget === "surface") {
      for (const mesh of orbitals.children) if (mesh.visible) bounds.union(new THREE.Box3().setFromObject(mesh));
    } else bounds.setFromObject(molecule);
    if (bounds.isEmpty()) for (const atom of buildScientificScene(props.structure).atoms) bounds.expandByPoint(new THREE.Vector3(...atom.position));
    const sphere = new THREE.Sphere();
    if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(3, 3, 3));
    bounds.getBoundingSphere(sphere);
    const radius = Math.max(0.5, sphere.radius);
    const { distance } = calculateCanonicalCameraDistance(radius, camera.aspect, camera.fov, 1.15);
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-8) direction.set(1.1, 0.9, 1.75);
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center.clone().add(direction.normalize().multiplyScalar(distance)));
    camera.near = Math.max(0.001, radius / 1000);
    camera.far = Math.max(1000, distance + radius * 100);
    camera.updateProjectionMatrix();
    controls.update();
    needsFit = false;
  }
  function update(props: Props) {
    if (disposed) return;
    latest = props;
    const density = props.grid.manifest.field_quantity === "ELECTRON_DENSITY";
    const nextKey = JSON.stringify([props.grid.manifest.grid_sha256, props.isovalue, props.potential?.manifest.grid_sha256]);
    if (nextKey !== meshKey) {
      const start = performance.now();
      clear(orbitals);
      phaseSurfaces = [buildVtkFieldSurface(props.grid, props.isovalue, false, props.potential)];
      if (!density) phaseSurfaces.push(buildVtkFieldSurface(props.grid, props.isovalue, true));
      phaseSurfaces.forEach((surface, index) => {
        const mesh = makeSurface(surface, props.opacity, density ? 0x438e89 : index ? 0xe18b3a : 0x326fd1);
        if (mesh) { mesh.userData.phase = index; orbitals.add(mesh); }
      });
      surfaceBuilds += 1;
      host.dataset.extractionMs = String(performance.now() - start);
      host.dataset.surfaceBuilds = String(surfaceBuilds);
      meshKey = nextKey;
    }
    let triangles = 0;
    // Empty means the threshold intersects no field; hiding phase colors is separate.
    phaseSurfaces.forEach(surface => { triangles += surface.triangleCount; });
    const primary = phaseSurfaces[0]!;
    host.dataset.surfaceTriangles = String(triangles);
    host.dataset.gridHash = props.grid.manifest.grid_sha256;
    props.onSurface?.({ ...primary, triangleCount: triangles });
    for (const child of orbitals.children) {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      mesh.visible = density || (mesh.userData.phase ? props.showNegative : props.showPositive);
      const transparent = props.opacity < 1;
      if (mesh.material.transparent !== transparent) mesh.material.needsUpdate = true;
      mesh.material.opacity = props.opacity;
      mesh.material.transparent = transparent;
      mesh.material.depthWrite = !transparent;
    }
    if (sourceStructure !== props.structure) {
      clear(molecule);
      buildMolecule(molecule, props.structure, true);
      sourceStructure = props.structure;
    }
    molecule.visible = props.showMolecule;
    if (needsFit) {
      let restored = false;
      try {
        const structureFallbackKey = `chemdft:structure-view:${props.structure.version.id}:camera`;
        const raw = localStorage.getItem(props.cameraKey) ?? localStorage.getItem(structureFallbackKey);
        const saved = JSON.parse(raw ?? "null");
        if (saved && [saved.position, saved.target].every(value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite))) {
          camera.position.fromArray(saved.position);
          controls.target.fromArray(saved.target);
          if (camera.position.distanceTo(controls.target) > 0.01) {
            controls.update();
            restored = true;
            needsFit = false;
          }
        }
      } catch { /* Invalid camera preferences are discarded. */ }
      if (!restored) fit(props);
    } else if (props.fitToken !== latestFitToken) fit(props);
    latestFitToken = props.fitToken;
    initialized = true;
    render();
  }
  function exportImage() {
    if (disposed || !latest?.active) return;
    render();
    const link = document.createElement("a");
    link.href = insertPngMetadataToDataUrl(renderer.domElement.toDataURL("image/png"));
    link.download = `electronic-structure-${latest.grid.manifest.field_quantity.toLowerCase()}.png`;
    link.click();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    resizeObserver.disconnect();
    controls.dispose();
    clear(orbitals);
    clear(molecule);
    renderer.dispose();
    renderer.domElement.remove();
  }
  resize();
  return { update, dispose, exportImage };
}

function buildMolecule(group: THREE.Group, detail: StructureVersionDetail, visible: boolean) {
  if (!visible) return;
  const canonicalScene = buildScientificScene(detail);
  const visualBonds = inferVisualBonds(canonicalScene);
  buildMoleculeInGroup(group, canonicalScene, visualBonds, DEFAULT_VISUALIZATION_STATE);
}

function makeSurface(surface: IndexedFieldSurface, opacity: number, color: number): THREE.Mesh | null {
  if (!surface.positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
  geometry.setAttribute("position", new THREE.BufferAttribute(surface.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(surface.normals, 3));
  if (surface.potentials && surface.minimum != null && surface.maximum != null) {
    const range = Math.max(Math.abs(surface.minimum), Math.abs(surface.maximum));
    const colors = new Float32Array(surface.potentials.length * 3);
    surface.potentials.forEach((value, index) => {
      const rgb = potentialColor(value, range);
      const linear = new THREE.Color(...rgb).convertSRGBToLinear();
      colors.set([linear.r, linear.g, linear.b], index * 3);
    });
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  const material = new THREE.MeshStandardMaterial({ color: surface.potentials ? 0xffffff : color,
    vertexColors: Boolean(surface.potentials), roughness: surface.potentials ? 0.7 : 0.42, metalness: 0,
    transparent: opacity < 1, opacity, side: THREE.FrontSide, depthWrite: opacity >= 1 });
  return new THREE.Mesh(geometry, material);
}
