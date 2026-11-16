/** Net formal charge written in a V2000 molfile ("M  CHG" lines, plus the legacy charge field in the atom block is not used by Ketcher). */
export function molfileFormalCharge(molfile: string): number {
  let total = 0;
  for (const line of molfile.split(/\r?\n/)) {
    if (!line.startsWith("M  CHG")) continue;
    const parts = line.slice(6).trim().split(/\s+/).map(Number);
    const count = parts[0] ?? 0;
    for (let i = 0; i < count; i++) total += parts[2 + 2 * i] ?? 0;
  }
  return total;
}

const MESSAGES: Record<string, string> = {
  GEOMETRY_CHARGE_MISMATCH: "The total charge you set does not match the charges in the drawing. Set \"Total charge\" to the sum of the drawn charges (the drawing's own value is suggested), or change the charges in the drawing.",
  GEOMETRY_UNSUPPORTED: "The 3D builder handles one molecule or one ion at a time, with no open-shell or unusual atoms. For an ion pair, a complex or several molecules, build the coordinates elsewhere and import them as XYZ (Import structure). ChemDFT does not invent a geometry for several fragments.",
  GEOMETRY_DEGENERATE: "Two atoms ended up almost on top of each other, so this 3D structure was refused. Adjust the drawing and generate again.",
  GEOMETRY_ATOM_IDENTITY: "The generated atoms did not match the drawing, so the structure was refused. Redraw it and generate again.",
  GEOMETRY_INVALID_COORDINATES: "The 3D builder produced invalid coordinates, so the structure was refused.",
  GEOMETRY_INVALID_UNITS: "The generated coordinates were not in angstrom, so the structure was refused.",
};

/** The researcher's sentence for a geometry error; the raw text is kept for a Details line. */
export function plainGeometryError(raw: string): { text: string; detail: string | null } {
  const match = /^(GEOMETRY_[A-Z_]+)\b/.exec(raw.trim());
  const text = match ? MESSAGES[match[1]!] : undefined;
  return text ? { text, detail: raw } : { text: raw, detail: null };
}

export const MULTI_FRAGMENT_MESSAGE = MESSAGES.GEOMETRY_UNSUPPORTED!;
