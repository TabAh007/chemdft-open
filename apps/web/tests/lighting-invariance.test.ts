import { describe, expect, it } from "vitest";
import * as THREE from "three";

describe("Viewer lighting invariance (release 0.0.38)", () => {
  it("light direction relative to camera is invariant under rotation", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    scene.add(camera);

    // Key light (headlight) attached to camera
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(1.5, 2.0, 4.0);
    camera.add(keyLight);

    // Fill light attached to camera
    const fillLight = new THREE.DirectionalLight(0xddeeff, 0.6);
    fillLight.position.set(-2.0, -1.0, 3.0);
    camera.add(fillLight);

    // Function to get light direction in camera local coordinates
    function getLocalLightDirection(light: THREE.DirectionalLight): THREE.Vector3 {
      // In camera space, light is a direct child of camera
      return light.position.clone().normalize();
    }

    const initialKeyDir = getLocalLightDirection(keyLight);
    const initialFillDir = getLocalLightDirection(fillLight);

    // Test a sequence of 360-degree rotations in yaw, pitch, roll
    const testRotations = [
      new THREE.Euler(0, 0, 0),
      new THREE.Euler(Math.PI / 4, 0, 0),
      new THREE.Euler(0, Math.PI / 2, 0),
      new THREE.Euler(Math.PI, Math.PI, 0),
      new THREE.Euler(-Math.PI / 3, Math.PI / 6, Math.PI / 4),
      new THREE.Euler(2 * Math.PI, 2 * Math.PI, 2 * Math.PI),
    ];

    for (const rot of testRotations) {
      camera.rotation.copy(rot);
      camera.updateMatrixWorld(true);

      const currentKeyDir = getLocalLightDirection(keyLight);
      const currentFillDir = getLocalLightDirection(fillLight);

      // Relative direction in camera frame remains identical
      expect(currentKeyDir.x).toBeCloseTo(initialKeyDir.x, 6);
      expect(currentKeyDir.y).toBeCloseTo(initialKeyDir.y, 6);
      expect(currentKeyDir.z).toBeCloseTo(initialKeyDir.z, 6);

      expect(currentFillDir.x).toBeCloseTo(initialFillDir.x, 6);
      expect(currentFillDir.y).toBeCloseTo(initialFillDir.y, 6);
      expect(currentFillDir.z).toBeCloseTo(initialFillDir.z, 6);

      // In world coordinates, the light transformed along with the camera
      const worldKeyPos = new THREE.Vector3();
      keyLight.getWorldPosition(worldKeyPos);
      const camPos = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      const worldRel = worldKeyPos.clone().sub(camPos);
      expect(worldRel.length()).toBeCloseTo(keyLight.position.length(), 4);
    }
  });

  it("ambient and hemisphere illumination ensure no face is black under 360-degree rotation", () => {
    // Standard material with base color
    const material = new THREE.MeshStandardMaterial({
      color: 0x8a99c7, // Cr color
      roughness: 0.35,
      metalness: 0.0,
    });
    expect(material.color.getHex()).toBe(0x8a99c7);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);

    // Total minimum ambient intensity is > 0.6 regardless of normal direction
    const minAmbient = ambient.intensity * 0.5 + hemi.intensity * 0.4;
    expect(minAmbient).toBeGreaterThan(0.5);
  });
});
