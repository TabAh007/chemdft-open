import { describe, expect, it } from "vitest";
import {
  IDENTITY_QUATERNION,
  quaternionRollAngle,
  quaternionRotateVector,
  trackballRotate,
  turntableRotate,
  type Quaternion4,
  type Vec3,
} from "@chemdft/scientific-scene";

describe("Viewer trackball rotation mapping (release 0.0.38)", () => {
  const frontPoint: Vec3 = [0, 0, 1];

  it("left-drag moves a front-facing point to -x", () => {
    // Assert left drag (dx < 0) turns the front of the model to the left (-x)
    const newQ = trackballRotate(-25, 0, IDENTITY_QUATERNION, { sensitivity: 0.008 });
    const pRot = quaternionRotateVector(newQ, frontPoint);

    // Front-facing point moved to -x
    expect(pRot[0]).toBeLessThan(0);
    expect(pRot[0]).toBeCloseTo(-0.19867, 3);
    expect(pRot[1]).toBeCloseTo(0, 5);
    expect(pRot[2]).toBeGreaterThan(0);
  });

  it("up-drag moves a front-facing point to +y", () => {
    // Assert up drag (dy > 0) turns the front of the model upward (+y)
    const newQ = trackballRotate(0, 25, IDENTITY_QUATERNION, { sensitivity: 0.008 });
    const pRot = quaternionRotateVector(newQ, frontPoint);

    // Front-facing point moved to +y
    expect(pRot[1]).toBeGreaterThan(0);
    expect(pRot[1]).toBeCloseTo(0.19867, 3);
    expect(pRot[0]).toBeCloseTo(0, 5);
    expect(pRot[2]).toBeGreaterThan(0);
  });

  it("a closed loop of drags leaves no roll about the view axis", () => {
    const startQ = IDENTITY_QUATERNION;
    // Four-step drag forming a closed rectangle in cursor space
    let q: Quaternion4 = startQ;
    q = trackballRotate(15, 0, q, { sensitivity: 0.005 });
    q = trackballRotate(0, 15, q, { sensitivity: 0.005 });
    q = trackballRotate(-15, 0, q, { sensitivity: 0.005 });
    q = trackballRotate(0, -15, q, { sensitivity: 0.005 });

    const roll = quaternionRollAngle(q);
    expect(Math.abs(roll)).toBeLessThan(0.015);
  });

  it("the corner triad rotates in the same sense as the model", () => {
    const dx = -20;
    const dy = 10;
    const q = trackballRotate(dx, dy, IDENTITY_QUATERNION, { sensitivity: 0.005 });

    const modelFront = quaternionRotateVector(q, frontPoint);
    const triadFront = quaternionRotateVector(q, [0, 0, 1]);

    expect(triadFront[0]).toBeCloseTo(modelFront[0], 5);
    expect(triadFront[1]).toBeCloseTo(modelFront[1], 5);
    expect(triadFront[2]).toBeCloseTo(modelFront[2], 5);
    expect(triadFront[0]).toBeLessThan(0); // moved left
    expect(triadFront[1]).toBeGreaterThan(0); // moved up
  });

  it("turntable mode keeps c axis vertical", () => {
    const q = turntableRotate(-30, 0, IDENTITY_QUATERNION, 0.008);
    const upVector = quaternionRotateVector(q, [0, 1, 0]);
    expect(upVector[0]).toBeCloseTo(0, 5);
    expect(upVector[1]).toBeCloseTo(1, 5);
    expect(upVector[2]).toBeCloseTo(0, 5);
  });
});

