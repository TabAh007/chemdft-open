import { describe, expect, it } from "vitest";
import { presetCameraDirection, type ScientificSceneCell, type Vec3 } from "@chemdft/scientific-scene";

describe("View presets camera directions (release 0.0.38)", () => {
  // Hexagonal Cr2O3 cell lattice vectors: a = 4.958, c = 13.593, gamma = 120 deg
  const hexCell: ScientificSceneCell = {
    a: 4.958,
    b: 4.958,
    c: 13.593,
    alpha: 90,
    beta: 90,
    gamma: 120,
    periodicDimensions: [true, true, true],
    latticeVectors: [
      [4.958, 0, 0],
      [-2.479, 4.29375, 0],
      [0, 0, 13.593],
    ],
  };

  // Rhombohedral Cr2O3 cell lattice vectors: a = 5.3595, alpha = 55.103 deg
  const rhombCell: ScientificSceneCell = {
    a: 5.3595,
    b: 5.3595,
    c: 5.3595,
    alpha: 55.103,
    beta: 55.103,
    gamma: 55.103,
    periodicDimensions: [true, true, true],
    latticeVectors: [
      [4.545, 0, 2.842],
      [-2.2725, 3.936, 2.842],
      [-2.2725, -3.936, 2.842],
    ],
  };

  function dot(u: Vec3, v: Vec3): number {
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  }
  function norm(v: Vec3): Vec3 {
    const m = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / m, v[1] / m, v[2] / m];
  }

  describe("Cartesian standard view presets (z up)", () => {
    it("Front looks from -y with +z up", () => {
      const p = presetCameraDirection("front");
      expect(p.direction).toEqual([0, -1, 0]);
      expect(p.up).toEqual([0, 0, 1]);
    });

    it("Back looks from +y with +z up", () => {
      const p = presetCameraDirection("back");
      expect(p.direction).toEqual([0, 1, 0]);
      expect(p.up).toEqual([0, 0, 1]);
    });

    it("Left looks from -x with +z up", () => {
      const p = presetCameraDirection("left");
      expect(p.direction).toEqual([-1, 0, 0]);
      expect(p.up).toEqual([0, 0, 1]);
    });

    it("Right looks from +x with +z up", () => {
      const p = presetCameraDirection("right");
      expect(p.direction).toEqual([1, 0, 0]);
      expect(p.up).toEqual([0, 0, 1]);
    });

    it("Top looks from +z with +y up", () => {
      const p = presetCameraDirection("top");
      expect(p.direction).toEqual([0, 0, 1]);
      expect(p.up).toEqual([0, 1, 0]);
    });

    it("Bottom looks from -z with -y up", () => {
      const p = presetCameraDirection("bottom");
      expect(p.direction).toEqual([0, 0, -1]);
      expect(p.up).toEqual([0, -1, 0]);
    });

    it("Isometric view looks from [1, 1, 1] normalized with +z up", () => {
      const p = presetCameraDirection("isometric");
      const expected = norm([1, 1, 1]);
      expect(p.direction[0]).toBeCloseTo(expected[0], 5);
      expect(p.direction[1]).toBeCloseTo(expected[1], 5);
      expect(p.direction[2]).toBeCloseTo(expected[2], 5);
      expect(p.up).toEqual([0, 0, 1]);
    });
  });

  describe("Crystallographic view presets for hexagonal Cr2O3", () => {
    it("Along a aligns with hexagonal a vector", () => {
      const p = presetCameraDirection("along-a", hexCell);
      const expected = norm(hexCell.latticeVectors[0]);
      expect(dot(p.direction, expected)).toBeCloseTo(1, 5);
      expect(p.up).toEqual([0, 0, 1]);
    });

    it("Along b aligns with hexagonal b vector", () => {
      const p = presetCameraDirection("along-b", hexCell);
      const expected = norm(hexCell.latticeVectors[1]);
      expect(dot(p.direction, expected)).toBeCloseTo(1, 5);
      expect(p.up).toEqual([0, 0, 1]);
    });

    it("Along c aligns with hexagonal c vector", () => {
      const p = presetCameraDirection("along-c", hexCell);
      const expected = norm(hexCell.latticeVectors[2]);
      expect(dot(p.direction, expected)).toBeCloseTo(1, 5);
      // Up aligns with b
      expect(dot(p.up, norm(hexCell.latticeVectors[1]))).toBeCloseTo(1, 5);
    });

    it("Along a* is perpendicular to b and c in hexagonal cell", () => {
      const p = presetCameraDirection("along-a-star", hexCell);
      expect(Math.abs(dot(p.direction, hexCell.latticeVectors[1]))).toBeLessThan(1e-5);
      expect(Math.abs(dot(p.direction, hexCell.latticeVectors[2]))).toBeLessThan(1e-5);
      expect(p.up).toEqual([0, 0, 1]);
    });
  });

  describe("Crystallographic view presets for rhombohedral Cr2O3", () => {
    it("Along a aligns with rhombohedral a vector", () => {
      const p = presetCameraDirection("along-a", rhombCell);
      const expected = norm(rhombCell.latticeVectors[0]);
      expect(dot(p.direction, expected)).toBeCloseTo(1, 5);
    });

    it("Along b aligns with rhombohedral b vector", () => {
      const p = presetCameraDirection("along-b", rhombCell);
      const expected = norm(rhombCell.latticeVectors[1]);
      expect(dot(p.direction, expected)).toBeCloseTo(1, 5);
    });

    it("Along c aligns with rhombohedral c vector", () => {
      const p = presetCameraDirection("along-c", rhombCell);
      const expected = norm(rhombCell.latticeVectors[2]);
      expect(dot(p.direction, expected)).toBeCloseTo(1, 5);
    });

    it("Along a* is perpendicular to b and c in rhombohedral cell", () => {
      const p = presetCameraDirection("along-a-star", rhombCell);
      expect(Math.abs(dot(p.direction, rhombCell.latticeVectors[1]))).toBeLessThan(1e-5);
      expect(Math.abs(dot(p.direction, rhombCell.latticeVectors[2]))).toBeLessThan(1e-5);
    });
  });
});

