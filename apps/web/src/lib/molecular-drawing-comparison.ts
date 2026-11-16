/** Ketcher refreshes its MOL writer timestamp even when the drawing is unchanged. */
export function normalizeDrawingMol(mol: string): string {
  return mol.replace(/\r/g, "").split("\n").map((line, index) => {
    const stableLine = index === 1
      ? line.replace(/(-INDIGO-)\d{10}(?=[23]D\b)/, "$1")
      : line;
    return stableLine.trimEnd();
  }).join("\n").trim();
}
