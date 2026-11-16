import { describe, expect, it } from "vitest";
import { normalizeDrawingMol } from "../src/lib/molecular-drawing-comparison";

const mol = `
  -INDIGO-10112612072D

  2  1  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.5000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
M  END
`;

describe("Ketcher drawing comparison", () => {
  it("ignores only the volatile writer timestamp across a minute rollover", () => {
    expect(normalizeDrawingMol(mol.replace("1011261207", "1011261208"))).toBe(normalizeDrawingMol(mol));
    expect(normalizeDrawingMol(mol.replaceAll("\n", "\r\n"))).toBe(normalizeDrawingMol(mol));
  });

  it.each([
    mol.replace("1.5000", "1.6000"),
    mol.replace(" O ", " N "),
    mol.replace("  1  2  1 ", "  1  2  2 "),
    mol.replace("12072D", "12073D"),
  ])("retains coordinate, element, bond and dimensionality changes", (changed) => {
    expect(normalizeDrawingMol(changed)).not.toBe(normalizeDrawingMol(mol));
  });
});
