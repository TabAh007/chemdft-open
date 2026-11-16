import { validateSmilesSyntax } from "./smiles-syntax";

export type StructureInput =
  | { kind: "empty" }
  | { kind: "smiles"; text: string; atoms: number }
  | { kind: "mol"; text: string; atoms: number }
  | { kind: "invalid"; reason: string };

const V2000_COUNTS = /^\s*(\d{1,3})\s*(\d{1,3})/;

/** Classify pasted text as a MOL/SDF block or a SMILES string and reject anything malformed. */
export function classifyStructureInput(raw: string): StructureInput {
  const text = raw.replace(/\r\n?/g, "\n");
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };

  const looksLikeMol = /(^|\n)M {2}END\b/.test(text) || /M {2}V30 END CTAB/.test(text);
  const multiline = trimmed.includes("\n");
  if (!looksLikeMol && !multiline) {
    const syntax = validateSmilesSyntax(trimmed);
    return syntax.ok ? { kind: "smiles", text: trimmed, atoms: syntax.atoms } : { kind: "invalid", reason: syntax.reason };
  }
  if (!looksLikeMol) {
    return { kind: "invalid", reason: "This is neither a single-line SMILES nor a complete MOL block (a MOL block ends with “M  END”)." };
  }

  const records = text.split(/^\$\$\$\$\s*$/m).filter((part) => part.trim().length > 0);
  if (records.length > 1) return { kind: "invalid", reason: `The SDF contains ${records.length} structures. Paste one structure at a time.` };
  let block = (records[0] ?? "").replace(/\s+$/, "");
  // The counts line is line 4. A paste that lost its blank title lines is re-padded so Ketcher reads it correctly.
  const rawLines = block.split("\n");
  const countsIndex = rawLines.slice(0, 8).findIndex((line) => /V[23]000\s*$/.test(line));
  if (countsIndex < 0) return { kind: "invalid", reason: "The MOL block has no counts line (line 4 must end with V2000 or V3000)." };
  if (countsIndex < 3) block = `${"\n".repeat(3 - countsIndex)}${block}`;
  const lines = block.split("\n");
  if (/V3000/.test(lines[3] ?? "")) {
    const counts = /M {2}V30 COUNTS (\d+)/.exec(block);
    const atoms = counts ? Number(counts[1]) : 0;
    return atoms > 0 ? { kind: "mol", text: block, atoms } : { kind: "invalid", reason: "The MOL block contains no atoms." };
  }
  const counts = V2000_COUNTS.exec(lines[3] ?? "");
  if (!counts) return { kind: "invalid", reason: "The MOL block has no valid counts line (line 4 must give the atom and bond counts)." };
  const atoms = Number(counts[1]);
  const bonds = Number(counts[2]);
  if (atoms === 0) return { kind: "invalid", reason: "The MOL block contains no atoms." };
  if (lines.length < 4 + atoms + bonds) return { kind: "invalid", reason: `The MOL block announces ${atoms} atoms and ${bonds} bonds but is shorter than that.` };
  return { kind: "mol", text: block, atoms };
}

export type LoadableKetcher = {
  setMolecule: (structure: string) => Promise<void | undefined>;
  indigo?: {
    convert: (structure: string, options?: { outputFormat?: string; inputFormat?: string }) => Promise<{ struct: string }>;
  };
};

export type LoadResult = { ok: true; kind: "smiles" | "mol"; atoms: number } | { ok: false; error: string };

const MOLFILE_MIME = "chemical/x-mdl-molfile";

export function countMolfileAtoms(molfile: string): number {
  const counts = V2000_COUNTS.exec(molfile.replace(/\r\n?/g, "\n").split("\n")[3] ?? "");
  return counts ? Number(counts[1]) : 0;
}

function shorten(message: string): string {
  const first = message.split(/\.\s|:\s'/)[0] ?? message;
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

/**
 * Validate, interpret with Ketcher's own Indigo, then load. The canvas is touched only after the text has
 * parsed to at least one atom, so a failed load never erases the current drawing.
 */
export async function loadStructureIntoEditor(ketcher: LoadableKetcher, raw: string): Promise<LoadResult> {
  const input = classifyStructureInput(raw);
  if (input.kind === "empty") return { ok: false, error: "Paste a SMILES string or a MOL block first." };
  if (input.kind === "invalid") return { ok: false, error: input.reason };
  try {
    if (ketcher.indigo) {
      const converted = await ketcher.indigo.convert(input.text, { outputFormat: MOLFILE_MIME });
      if (countMolfileAtoms(converted.struct) === 0) {
        return { ok: false, error: "Ketcher could not read this text as a structure." };
      }
    }
    await ketcher.setMolecule(input.text);
  } catch (error: unknown) {
    return { ok: false, error: `Ketcher could not read this structure: ${shorten(error instanceof Error ? error.message : String(error))}` };
  }
  return { ok: true, kind: input.kind, atoms: input.atoms };
}
