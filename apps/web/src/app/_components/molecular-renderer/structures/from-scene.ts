import { inferVisualBonds, type RenderableSceneData } from "@chemdft/scientific-scene";

import { dot, cross } from "../lattice";
import type { ScientificStructure, StructureProvenance, Vec3 } from "../types";
import { deepFreeze, hillFormula } from "./build";

/**
 * Adapts a ChemDFT `ScientificScene`/`RenderableSceneData` (what the workspace derives from a StructureVersion) to
 * the renderer's structure. Coordinates are copied, not re-derived; canonical bonds stay canonical; for molecules
 * the central visual-bond inference supplies display-only bonds, exactly as the workspace viewer does.
 */
export function structureFromScene(
  scene: RenderableSceneData,
  options: { readonly title: string; readonly provenance: StructureProvenance; readonly oxidationStates?: Readonly<Record<string, number>> },
): ScientificStructure {
  const atoms = [...scene.atoms].sort((a, b) => a.index - b.index);
  const indexOf = new Map(atoms.map((atom, i) => [atom.index, i]));
  const canonicalBonds = scene.bonds
    .map((bond) => [indexOf.get(bond.atomIndexA), indexOf.get(bond.atomIndexB)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined);
  const base = {
    id: scene.id,
    title: options.title,
    formula: hillFormula(atoms.map((atom) => atom.element)),
    provenance: options.provenance,
    ...(options.oxidationStates ? { oxidationStates: options.oxidationStates } : {}),
  };
  if (scene.kind === "PERIODIC" && scene.cell) {
    const [va, vb, vc] = scene.cell.latticeVectors;
    const volume = dot(va, cross(vb, vc));
    const reciprocal = [cross(vb, vc), cross(vc, va), cross(va, vb)].map((v) => v.map((x) => x / volume) as unknown as Vec3);
    return deepFreeze({
      ...base,
      kind: "periodic" as const,
      lattice: { parameters: { a: scene.cell.a, b: scene.cell.b, c: scene.cell.c, alpha: scene.cell.alpha, beta: scene.cell.beta, gamma: scene.cell.gamma }, vectors: scene.cell.latticeVectors },
      sites: atoms.map((atom) => ({
        element: atom.element,
        position: atom.position,
        fractional: reciprocal.map((r) => dot(r, atom.position)) as unknown as Vec3,
      })),
      canonicalBonds,
    });
  }
  // The source's own bond table, when it has one, is the connectivity; distance inference is only a fallback for sources without it.
  const inferred = (scene.bonds.length > 0 ? [] : inferVisualBonds(scene)).map((bond) => [indexOf.get(bond.atomIndexA)!, indexOf.get(bond.atomIndexB)!] as const);
  return deepFreeze({
    ...base,
    kind: "molecule" as const,
    sites: atoms.map((atom) => ({ element: atom.element, position: atom.position })),
    canonicalBonds,
    ...(inferred.length ? { inferredBonds: { pairs: inferred, label: "Display bonds inferred from interatomic distances; not authoritative connectivity." } } : {}),
  });
}
