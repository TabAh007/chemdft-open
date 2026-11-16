import { describe, expect, it } from "vitest";

import { calibratedPoint, formatDigitizedDlsPoint, normalizedAnchorToCssRect } from "../src/lib/digitizer";

describe("digitizer calibration", () => {
  it("formats DLS point indices separately from full precision values", () => {
    expect(formatDigitizedDlsPoint(5, 1524.4, 23.62)).toBe("6 · 1524.4 nm · q 23.62%");
  });

  it("converts synthetic graph pixels to linear scientific coordinates", () => {
    const point = calibratedPoint(
      { x: 150, y: 125 },
      {
        xAxis: {
          pixelA: { x: 50, y: 200 },
          pixelB: { x: 250, y: 200 },
          valueA: 0,
          valueB: 100,
          scale: "linear",
        },
        yAxis: {
          pixelA: { x: 50, y: 200 },
          pixelB: { x: 50, y: 50 },
          valueA: 0,
          valueB: 300,
          scale: "linear",
        },
      },
    );

    expect(point.x).toBeCloseTo(50);
    expect(point.y).toBeCloseTo(150);
  });

  it("supports log axis calibration without duplicating math in React", () => {
    const point = calibratedPoint(
      { x: 150, y: 125 },
      {
        xAxis: {
          pixelA: { x: 50, y: 200 },
          pixelB: { x: 250, y: 200 },
          valueA: 1,
          valueB: 100,
          scale: "log",
        },
        yAxis: {
          pixelA: { x: 50, y: 200 },
          pixelB: { x: 50, y: 50 },
          valueA: 10,
          valueB: 1_000,
          scale: "log",
        },
      },
    );

    expect(point.x).toBeCloseTo(10);
    expect(point.y).toBeCloseTo(100);
  });

  it("converts normalized source anchors into rendered highlight rectangles", () => {
    expect(normalizedAnchorToCssRect({ x: 0.25, y: 0.1, width: 0.5, height: 0.2 }, 800, 1000)).toEqual({
      left: 200,
      top: 100,
      width: 400,
      height: 200,
    });
  });
});
