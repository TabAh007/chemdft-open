import type { RenderableSceneData, ScientificSceneAtom, SupercellState, Vec3 } from "./types";
import { add, scale } from "./geometry";

export const MAX_SUPERCELL_ATOMS = 5000;

export type DisplayAtom = ScientificSceneAtom & {
  readonly displayIndex: number;
  readonly sourceAtomIndex: number;
  readonly cellOffset: Vec3;
  readonly role?: "cell" | "boundary-image" | "coordination-image" | string | undefined;
  readonly isCoordinationImage?: boolean | undefined;
};

export function displayAtomsForSupercell(
  scene: RenderableSceneData,
  supercell: SupercellState,
  maxAtoms = MAX_SUPERCELL_ATOMS,
): readonly DisplayAtom[] {
  const nx = boundedRepeat(supercell.nx);
  const ny = boundedRepeat(supercell.ny);
  const nz = boundedRepeat(supercell.nz);
  const total = scene.atoms.length * nx * ny * nz;
  if (total > maxAtoms) {
    throw new Error(`Display supercell would render ${total} atoms, above the ${maxAtoms} atom Phase 4 limit.`);
  }
  if (scene.kind !== "PERIODIC" || !scene.cell) {
    return scene.atoms.map((atom, displayIndex) => ({
      ...atom,
      displayIndex,
      sourceAtomIndex: atom.index,
      cellOffset: [0, 0, 0],
    }));
  }
  const atoms: DisplayAtom[] = [];
  for (let ix = 0; ix < nx; ix += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      for (let iz = 0; iz < nz; iz += 1) {
        const offset = add(
          add(scale(scene.cell.latticeVectors[0], ix), scale(scene.cell.latticeVectors[1], iy)),
          scale(scene.cell.latticeVectors[2], iz),
        );
        for (const atom of scene.atoms) {
          atoms.push({
            ...atom,
            id: `${atom.id}:${ix}:${iy}:${iz}`,
            position: add(atom.position, offset),
            displayIndex: atoms.length,
            sourceAtomIndex: atom.index,
            cellOffset: [ix, iy, iz],
          });
        }
      }
    }
  }
  return atoms;
}

function boundedRepeat(value: number): number {
  return Math.max(1, Math.min(4, Math.floor(value)));
}
