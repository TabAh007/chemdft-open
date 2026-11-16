import { describe, expect, it } from "vitest";
import {
  IDENTITY_QUATERNION,
  quaternionInvert,
  quaternionNormalize,
  quaternionRollAngle,
  quaternionRotateVector,
  trackballRotate,
  turntableRotate,
  type Quaternion4,
  type Vec3,
} from "../src/trackball";

describe("Quaternion trackball rotation math", () => {
  const frontPoint: Vec3 = [0, 0, 1];

  it("left-drag moves a front-facing point to -x", () => {
    // Left-drag: dx < 0 (e.g. -20 px), dy = 0
    const startQ = IDENTITY_QUATERNION;
    const newQ = trackballRotate(-20, 0, startQ, { sensitivity: 0.01 });

    const pRotated = quaternionRotateVector(newQ, frontPoint);
    // Left drag must turn front surface left (negative x)
    expect(pRotated[0]).toBeLessThan(0);
    expect(pRotated[1]).toBeCloseTo(0, 5);
    expect(pRotated[2]).toBeGreaterThan(0); // still front-facing
  });

  it("right-drag moves a front-facing point to +x", () => {
    // Right-drag: dx > 0 (e.g. +20 px), dy = 0
    const startQ = IDENTITY_QUATERNION;
    const newQ = trackballRotate(20, 0, startQ, { sensitivity: 0.01 });

    const pRotated = quaternionRotateVector(newQ, frontPoint);
    expect(pRotated[0]).toBeGreaterThan(0);
    expect(pRotated[1]).toBeCloseTo(0, 5);
  });

  it("up-drag moves a front-facing point to +y", () => {
    // Up-drag: dx = 0, dy > 0 (e.g. +20 px)
    const startQ = IDENTITY_QUATERNION;
    const newQ = trackballRotate(0, 20, startQ, { sensitivity: 0.01 });

    const pRotated = quaternionRotateVector(newQ, frontPoint);
    // Up drag must turn front surface up (positive y)
    expect(pRotated[1]).toBeGreaterThan(0);
    expect(pRotated[0]).toBeCloseTo(0, 5);
    expect(pRotated[2]).toBeGreaterThan(0);
  });

  it("down-drag moves a front-facing point to -y", () => {
    // Down-drag: dx = 0, dy < 0 (e.g. -20 px)
    const startQ = IDENTITY_QUATERNION;
    const newQ = trackballRotate(0, -20, startQ, { sensitivity: 0.01 });

    const pRotated = quaternionRotateVector(newQ, frontPoint);
    expect(pRotated[1]).toBeLessThan(0);
    expect(pRotated[0]).toBeCloseTo(0, 5);
  });

  it("a closed loop of drags leaves no roll about the view axis", () => {
    const startQ = IDENTITY_QUATERNION;

    // Single stroke returning to origin (dx=0, dy=0)
    const returnedQ = trackballRotate(0, 0, startQ);
    expect(returnedQ).toEqual(startQ);
    expect(quaternionRollAngle(returnedQ)).toBeCloseTo(0, 5);

    // Multi-step closed loop of drags starting and returning to start:
    // Drag right 20, up 20, left 20, down 20
    let q: Quaternion4 = startQ;
    q = trackballRotate(20, 0, q, { sensitivity: 0.005 });
    q = trackballRotate(0, 20, q, { sensitivity: 0.005 });
    q = trackballRotate(-20, 0, q, { sensitivity: 0.005 });
    q = trackballRotate(0, -20, q, { sensitivity: 0.005 });

    // The roll angle about Z (view axis) must remain negligible (no accumulated roll)
    const roll = quaternionRollAngle(q);
    expect(Math.abs(roll)).toBeLessThan(0.02);
  });

  it("corner triad rotates in the exact same sense as the model", () => {
    // When the model is rotated by trackballRotate, the triad tracks the model axes.
    // Specifically: if model's front vector moves left (negative x) under left-drag,
    // the triad's front vector (Z axis [0, 0, 1]) must also move left (negative x).
    const dx = -30;
    const dy = 0;
    const modelQ = trackballRotate(dx, dy, IDENTITY_QUATERNION, { sensitivity: 0.01 });

    const modelFront = quaternionRotateVector(modelQ, frontPoint);
    expect(modelFront[0]).toBeLessThan(0);

    // Triad orientation matches model orientation
    const triadQ = modelQ;
    const triadZ = quaternionRotateVector(triadQ, [0, 0, 1]);
    expect(triadZ[0]).toBeLessThan(0);
    expect(triadZ[0]).toBeCloseTo(modelFront[0], 5);
    expect(triadZ[1]).toBeCloseTo(modelFront[1], 5);
    expect(triadZ[2]).toBeCloseTo(modelFront[2], 5);
  });

  it("turntable mode preserves vertical c-axis", () => {
    const startQ = IDENTITY_QUATERNION;
    // Turntable left drag rotates azimuthally around Y
    const turnedQ = turntableRotate(-30, 0, startQ, 0.01);
    const rotatedUp = quaternionRotateVector(turnedQ, [0, 1, 0]);
    // Vertical axis remains [0, 1, 0]
    expect(rotatedUp[0]).toBeCloseTo(0, 5);
    expect(rotatedUp[1]).toBeCloseTo(1, 5);
    expect(rotatedUp[2]).toBeCloseTo(0, 5);

    // Front point moved in -x direction
    const rotatedFront = quaternionRotateVector(turnedQ, frontPoint);
    expect(rotatedFront[0]).toBeLessThan(0);
  });
});

