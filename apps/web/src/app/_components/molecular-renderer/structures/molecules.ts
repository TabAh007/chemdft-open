import type { RenderableSceneData, ScientificSceneAtom, ScientificSceneBond } from "@chemdft/scientific-scene";

import reference from "../../home/reference/molecules.json";
import type { ScientificStructure, StructureProvenance } from "../types";
import { structureFromScene } from "./from-scene";

/**
 * The homepage reference molecules, adapted to the renderer's structure. The coordinates and bond tables are exactly
 * what `tools/homepage_reference_molecules.py` validated through ChemDFT's RDKit structure adapter; nothing here is
 * computed or adjusted. See `home/reference/README.md` for sources and reuse basis.
 */
type Entry = (typeof reference)[keyof typeof reference];

function toScene(entry: Entry): RenderableSceneData {
  const atoms: ScientificSceneAtom[] = entry.atoms.map((atom, index) => ({
    id: `${entry.id}:atom:${index}`,
    index,
    element: atom.element,
    atomicNumber: 0,
    position: [atom.x, atom.y, atom.z] as const,
    sourcePosition: [atom.x, atom.y, atom.z] as const,
    sourceCoordinateSystem: "CARTESIAN" as const,
  }));
  const bonds: ScientificSceneBond[] = (entry.bonds as { atom_index_a: number; atom_index_b: number; order: number }[]).map((bond, i) => ({
    id: `${entry.id}:bond:${i}`,
    atomIndexA: bond.atom_index_a,
    atomIndexB: bond.atom_index_b,
    order: bond.order,
    source: "canonical" as const,
  }));
  return { id: entry.id, kind: "MOLECULE", atoms, bonds };
}

function provenance(entry: Entry): StructureProvenance {
  const source = entry.source as { name: string; id?: string; url?: string; kind: string; licence?: string };
  return {
    kind: "reference-structure",
    label: entry.title === "Water" ? "Reference geometry" : "Reference molecular conformer",
    source: { name: source.name, ...(source.id ? { id: source.id } : {}), ...(source.url ? { url: source.url } : {}), ...(source.licence ? { licence: source.licence } : {}) },
    note: `${source.kind}. Not a ChemDFT calculation result.`,
  };
}

const build = (entry: Entry): ScientificStructure => structureFromScene(toScene(entry), { title: entry.title, provenance: provenance(entry) });

export const WATER_STRUCTURE = build(reference.water);
export const BENZENE_STRUCTURE = build(reference.benzene);
export const CAFFEINE_STRUCTURE = build(reference.caffeine);
