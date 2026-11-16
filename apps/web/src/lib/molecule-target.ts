/**
 * Save-target semantics of the molecule editor (RW-3.2).
 *
 * NEW MOLECULE creates a separate structure identity with its own version history.
 * NEW VERSION appends one revision to an explicitly chosen, existing structure lineage. The lineage
 * keeps its name: the server ignores the name of a candidate that has a parent version.
 *
 * The target is frozen when the editor opens, so a later change of the selected structure can never
 * redirect a save into another lineage. Nothing here decides chemistry; it only describes the save.
 */

export type Composition = Readonly<Record<string, number>>;

export type LineageParent = {
  structureId: string;
  versionId: string;
  revision: number;
  /** The revision the server will assign (latest revision of the lineage + 1) when the editor opened. */
  nextRevision: number;
  name: string;
  composition: Composition;
};

export type EditorTarget =
  | { kind: "new-molecule"; key: string; initialMolfile: string | null }
  | { kind: "new-version"; key: string; parent: LineageParent; initialMolfile: string | null };

export const DEFAULT_NEW_MOLECULE_NAME = "Drawn molecule";

let sequence = 0;

export function newMoleculeTarget(initialMolfile: string | null = null): EditorTarget {
  sequence += 1;
  return { kind: "new-molecule", key: `new-molecule:${sequence}`, initialMolfile };
}

export function newVersionTarget(parent: LineageParent, initialMolfile: string | null = null): EditorTarget {
  sequence += 1;
  return { kind: "new-version", key: `new-version:${parent.versionId}:${sequence}`, parent, initialMolfile };
}

export function composition(elements: Iterable<string>): Composition {
  const counts: Record<string, number> = {};
  for (const element of elements) counts[element] = (counts[element] ?? 0) + 1;
  return counts;
}

/** Hill order, identical to the server's `calculation_summary.hill_formula`. */
export function hillFormula(counts: Composition): string {
  const elements = Object.keys(counts).filter((element) => (counts[element] ?? 0) > 0);
  if (elements.length === 0) return "";
  const order = "C" in counts && (counts.C ?? 0) > 0
    ? ["C", "H", ...elements.filter((e) => e !== "C" && e !== "H").sort()]
    : [...elements].sort();
  return order
    .filter((element) => (counts[element] ?? 0) > 0)
    .map((element) => `${element}${counts[element] === 1 ? "" : counts[element]}`)
    .join("");
}

export function sameComposition(a: Composition, b: Composition): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
}

/** The name a new molecule is committed under: what the researcher typed, never a previous structure's name. */
export function effectiveMoleculeName(input: string): string {
  return input.trim() || DEFAULT_NEW_MOLECULE_NAME;
}

export type TargetSummary = {
  action: "New molecule" | "New version";
  commitAs: string;
  detail: string;
};

export function describeTarget(target: EditorTarget, typedName = ""): TargetSummary {
  if (target.kind === "new-molecule") {
    return {
      action: "New molecule",
      commitAs: `${effectiveMoleculeName(typedName)} · V1`,
      detail: "Creates a separate structure with its own version history. Existing structures, versions and results are not changed.",
    };
  }
  const { parent } = target;
  return {
    action: "New version",
    commitAs: `${parent.name} · V${parent.nextRevision}`,
    detail: `Adds V${parent.nextRevision} to the existing “${parent.name}” lineage (parent V${parent.revision}). The lineage keeps its name; earlier versions and their results are not changed.`,
  };
}

/**
 * A new version whose atoms differ in composition from its parent is almost always a different
 * molecule. Returns both formulas when that is the case so the editor can require an explicit decision.
 */
export function lineageCompositionChange(target: EditorTarget, candidateElements: readonly string[]): { parent: string; candidate: string } | null {
  if (target.kind !== "new-version" || candidateElements.length === 0) return null;
  const candidate = composition(candidateElements);
  if (sameComposition(candidate, target.parent.composition)) return null;
  return { parent: hillFormula(target.parent.composition) || "no atoms", candidate: hillFormula(candidate) };
}

/** The next revision the server assigns: one above the highest revision known for the lineage. */
export function nextRevision(knownRevisions: Iterable<number | null | undefined>): number {
  let highest = 0;
  for (const value of knownRevisions) if (typeof value === "number" && Number.isFinite(value) && value > highest) highest = value;
  return highest + 1;
}
