import { describe, expect, it } from "vitest";
import { molfileFormalCharge, plainGeometryError } from "../src/lib/molecule-editor/geometry-errors";

describe("geometry errors", () => {
  it("sums M  CHG entries", () => {
    expect(molfileFormalCharge("x\nM  CHG  2   3   1   5  -1\nM  END")).toBe(0);
    expect(molfileFormalCharge("M  CHG  1   3   1\nM  END")).toBe(1);
    expect(molfileFormalCharge("M  END")).toBe(0);
  });
  it("explains charge mismatch and multi-fragment input", () => {
    expect(plainGeometryError("GEOMETRY_CHARGE_MISMATCH: Requested charge disagrees with the drawing.").text).toContain("Total charge");
    const unsupported = plainGeometryError("GEOMETRY_UNSUPPORTED: Requires one closed-shell organic graph");
    expect(unsupported.text).toContain("XYZ");
    expect(unsupported.detail).toContain("GEOMETRY_UNSUPPORTED");
  });
});
