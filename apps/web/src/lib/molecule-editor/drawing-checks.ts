/**
 * Read-outs computed by Ketcher's own Indigo from the DRAWING (schematic 2D): formula, heavy-atom count,
 * valence and stereo flags. None of this is an engine result, a 3D property or evidence of a calculation.
 */
export type GrossFormula = {
  /** Hill formula of the whole drawing (all fragments added up). */
  formula: string;
  /** Heavy atoms of the whole drawing. */
  heavyAtoms: number;
  counts: Readonly<Record<string, number>>;
  /** One entry per distinct molecule, "6 × H2O"; empty when the drawing is a single molecule. */
  molecules: { formula: string; count: number }[];
};

const HILL_LAST = (a: string, b: string) => a.localeCompare(b);

/** Hill order: C, then H, then the rest alphabetically; without carbon everything is alphabetical. */
export function hillFormula(counts: Readonly<Record<string, number>>): string {
  const symbols = Object.keys(counts).filter((symbol) => (counts[symbol] ?? 0) > 0);
  const ordered = symbols.includes("C")
    ? ["C", ...(symbols.includes("H") ? ["H"] : []), ...symbols.filter((symbol) => symbol !== "C" && symbol !== "H").sort(HILL_LAST)]
    : [...symbols].sort(HILL_LAST);
  return ordered.map((symbol) => `${symbol}${counts[symbol] === 1 ? "" : counts[symbol]}`).join("");
}

function parseOneFormula(gross: string): Record<string, number> | null {
  const counts: Record<string, number> = {};
  for (const token of gross.trim().split(/\s+/)) {
    const match = /^([A-Z][a-z]?)(\d*)([+-]\d*)?$/.exec(token);
    if (!match) return null;
    const symbol = match[1] as string;
    counts[symbol] = (counts[symbol] ?? 0) + (match[2] ? Number(match[2]) : 1);
  }
  return counts;
}

/**
 * Parse Indigo's gross formula (Hill order, space separated, e.g. "C2 H6 O"). Indigo reports a drawing with several
 * fragments as one formula per fragment separated by ";" ("H2 O; H2 O"): those are added up into one combined formula
 * and counted per distinct molecule. Null when empty or malformed.
 */
export function parseGrossFormula(gross: string | number | boolean | undefined): GrossFormula | null {
  if (typeof gross !== "string" || !gross.trim()) return null;
  const parts = gross.split(";").map((part) => part.trim()).filter(Boolean);
  const counts: Record<string, number> = {};
  const perMolecule = new Map<string, number>();
  for (const part of parts) {
    const one = parseOneFormula(part);
    if (!one) return null;
    for (const [symbol, count] of Object.entries(one)) counts[symbol] = (counts[symbol] ?? 0) + count;
    const label = part.split(/\s+/).join("");
    perMolecule.set(label, (perMolecule.get(label) ?? 0) + 1);
  }
  if (Object.keys(counts).length === 0) return null;
  const heavyAtoms = Object.entries(counts).reduce((total, [symbol, count]) => (symbol === "H" || symbol === "D" || symbol === "T" ? total : total + count), 0);
  const molecules = parts.length > 1 ? [...perMolecule].map(([formula, count]) => ({ formula, count })) : [];
  return { formula: parts.length > 1 ? hillFormula(counts) : parts[0]!.split(/\s+/).join(""), heavyAtoms, counts, molecules };
}

/** "6 × H2O" or "2 × CH4O + 1 × H2O". */
export function describeMolecules(molecules: readonly { formula: string; count: number }[]): string {
  return molecules.map((entry) => `${entry.count} × ${entry.formula}`).join(" + ");
}

/** Split “C2H6O” into display runs so digits can be subscripted. */
export function formulaRuns(formula: string): { text: string; sub: boolean }[] {
  return (formula.match(/\d+|[^\d]+/g) ?? []).map((text) => ({ text, sub: /^\d/.test(text) }));
}

export type CheckSummary = {
  valence: { ok: boolean; text: string };
  stereo: { none: boolean; text: string };
  other: { id: string; text: string }[];
};

/** Indigo's check result: an object of `{ checkType: message }`; absent or empty means no finding. */
export function summarizeCheck(result: Readonly<Record<string, string>> | null | undefined): CheckSummary | null {
  if (!result) return null;
  const message = (key: string) => (typeof result[key] === "string" && result[key]!.trim() ? result[key]!.trim() : null);
  const valence = message("valence");
  const stereoFindings = ["stereo", "chiral", "chiral_flag"].map((key) => message(key)).filter((text): text is string => text !== null);
  const known = new Set(["valence", "stereo", "chiral", "chiral_flag"]);
  const other = Object.entries(result)
    .filter(([key, text]) => !known.has(key) && typeof text === "string" && text.trim())
    .map(([id, text]) => ({ id, text: text.trim() }));
  return {
    valence: valence ? { ok: false, text: valence } : { ok: true, text: "No issues found" },
    stereo: stereoFindings.length ? { none: false, text: stereoFindings.join(" · ") } : { none: true, text: "None defined" },
    other,
  };
}

export type SelectedAtomInfo = { element: string; charge: number; valence: number | null };

/** Facts about one selected atom, exactly as Ketcher's structure model holds them. */
export function describeSelectedAtom(atom: { label?: unknown; charge?: unknown; valence?: unknown } | null | undefined): SelectedAtomInfo | null {
  if (!atom || typeof atom.label !== "string" || !atom.label) return null;
  const charge = typeof atom.charge === "number" && Number.isFinite(atom.charge) ? atom.charge : 0;
  const valence = typeof atom.valence === "number" && Number.isFinite(atom.valence) && atom.valence > 0 ? atom.valence : null;
  return { element: atom.label, charge, valence };
}

export function formatCharge(charge: number): string {
  if (charge === 0) return "0 (neutral)";
  return `${charge > 0 ? "+" : "−"}${Math.abs(charge)}`;
}
