import type { Representation, ScientificStructure } from "./types";

export const REPRESENTATION_LABELS: Readonly<Record<Representation, string>> = {
  "ball-stick": "Ball & stick",
  wireframe: "Wireframe",
  "space-fill": "Space filling",
  "unit-cell": "Unit cell",
  polyhedra: "Polyhedra",
};

/** Order the representations are offered in. */
const ORDER: readonly Representation[] = ["ball-stick", "unit-cell", "polyhedra", "wireframe", "space-fill"];

/**
 * Which representations are scientifically meaningful for a structure. A unit cell needs a lattice and coordination
 * polyhedra need a coordination rule, so an isolated molecule offers neither: modes are never faked to fill a row.
 */
export function availableRepresentations(structure: ScientificStructure): readonly Representation[] {
  return ORDER.filter((representation) => unavailableReason(structure, representation) === null);
}

/** Why a representation cannot be shown for this structure, or `null` when it can. */
export function unavailableReason(structure: ScientificStructure, representation: Representation): string | null {
  if (representation === "unit-cell" && !structure.lattice) return "An isolated molecule has no unit cell.";
  if (representation === "polyhedra" && !(structure.lattice && structure.coordinationRules?.length)) return "An isolated molecule has no coordination polyhedra.";
  return null;
}

/** The requested representation if the structure supports it, otherwise ball-and-stick. */
export function resolveRepresentation(structure: ScientificStructure, requested: Representation): Representation {
  return unavailableReason(structure, requested) === null ? requested : "ball-stick";
}
