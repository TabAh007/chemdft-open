import { describe, expect, it } from "vitest";
import { applicableSteps } from "@/lib/molecule-editor/ai-draw";
import { boundingBox, fitZoom, mainFragment, MAX_FIT_ZOOM, MIN_READABLE_ZOOM, parseMolfileGeometry } from "@/lib/molecule-editor/fit-view";
import type { DrawResponse } from "@chemdft/schemas";

const block = (atoms: [number, number][], bonds: [number, number][]) =>
  ["", "  RDKit          2D", "", `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
    ...atoms.map(([x, y]) => `${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0`),
    ...bonds.map(([a, b]) => `${String(a).padStart(3)}${String(b).padStart(3)}  1  0`), "M  END", ""].join("\n");

describe("fit-view", () => {
  it("reads atoms and bonds from a V2000 block and finds the main fragment", () => {
    const geometry = parseMolfileGeometry(block([[0, 0], [1.5, 0], [3, 0], [40, 30]], [[1, 2], [2, 3]]));
    expect(geometry.atoms).toHaveLength(4);
    expect(geometry.bonds).toEqual([[0, 1], [1, 2]]);
    expect(mainFragment(geometry).sort()).toEqual([0, 1, 2]);
    expect(boundingBox(geometry.atoms)).toEqual({ minX: 0, maxX: 40, minY: 0, maxY: 30 });
  });

  it("returns an empty geometry for anything that is not a V2000 molfile", () => {
    expect(parseMolfileGeometry("").atoms).toEqual([]);
    expect(parseMolfileGeometry("not a molfile").atoms).toEqual([]);
  });

  it("clamps the zoom to the readable range and says when the box does not fit", () => {
    expect(fitZoom(100, 100, 600, 500)).toEqual({ zoom: MAX_FIT_ZOOM, fits: true });
    const mid = fitZoom(600, 300, 500, 500);
    expect(mid.zoom).toBeGreaterThanOrEqual(MIN_READABLE_ZOOM);
    expect(mid.zoom).toBeLessThan(MAX_FIT_ZOOM);
    expect(mid.fits).toBe(true);
    expect(fitZoom(8000, 40, 500, 500)).toEqual({ zoom: MIN_READABLE_ZOOM, fits: false });
    expect(fitZoom(0, 0, 500, 500).zoom).toBe(MAX_FIT_ZOOM);
  });

  it("applies the steps of a NEEDS_ATTENTION response so they can be inspected and undone", () => {
    const step = { index: 0, op: { op: "clear_all" }, ok: true, molfile: "\n  x\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n", description: "Clear the drawing" };
    const response = { status: "NEEDS_ATTENTION", reply: "Needs attention", steps: [step] } as unknown as DrawResponse;
    expect(applicableSteps(response)).toHaveLength(1);
    expect(applicableSteps({ ...response, status: "REJECTED" } as DrawResponse)).toEqual([]);
  });
});
