import { ELEMENT_VISUALS, isMetal } from "./element-data";
import type { RenderableSceneData } from "./types";

/** Display state only. Deliberately not a canonical ScientificSceneBond or edit contract. */
export type VisualBond = {
  readonly atomIndexA: number;
  readonly atomIndexB: number;
  readonly displayOnly: true;
  readonly cellOffset?: readonly [number, number, number];
  readonly isDashed?: boolean;
};

/** Cartesian Å; conservative supported radii. Molecule + periodic minimum-image inference. */
export function inferVisualBonds(scene: RenderableSceneData): readonly VisualBond[] {
  if (scene.kind === "PERIODIC") {
    if (!scene.cell) return [];
    const vectors = scene.cell.latticeVectors;
    const atoms = [...scene.atoms].sort((a, b) => a.index - b.index);
    const canonical = new Set(
      scene.bonds.map((b) => [b.atomIndexA, b.atomIndexB].sort((a, b) => a - b).join(":")),
    );
    const bonds: VisualBond[] = [];
    const n = atoms.length;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (i > j) continue;
              if (i === j) {
                if (dx < 0 || (dx === 0 && dy < 0) || (dx === 0 && dy === 0 && dz <= 0)) continue;
              }
              const a = atoms[i]!;
              const b = atoms[j]!;
              const ra = ELEMENT_VISUALS[a.element];
              const rb = ELEMENT_VISUALS[b.element];
              if (!ra || !rb) continue;
              // Never bond two metal atoms in a periodic scene (e.g. Cr-Cr oxide exclusion)
              if (isMetal(a.element) && isMetal(b.element)) continue;
              if (dx === 0 && dy === 0 && dz === 0 && canonical.has(`${a.index}:${b.index}`)) continue;

              const shiftX = dx * vectors[0][0] + dy * vectors[1][0] + dz * vectors[2][0];
              const shiftY = dx * vectors[0][1] + dy * vectors[1][1] + dz * vectors[2][1];
              const shiftZ = dx * vectors[0][2] + dy * vectors[1][2] + dz * vectors[2][2];
              const bX = b.position[0] + shiftX;
              const bY = b.position[1] + shiftY;
              const bZ = b.position[2] + shiftZ;

              const distance = Math.hypot(a.position[0] - bX, a.position[1] - bY, a.position[2] - bZ);
              const radii = ra.covalentRadius + rb.covalentRadius;
              if (
                Number.isFinite(distance) &&
                distance >= Math.max(0.4, 0.5 * radii) &&
                distance <= Math.min(3.2, 1.2 * radii)
              ) {
                bonds.push({
                  atomIndexA: a.index,
                  atomIndexB: b.index,
                  displayOnly: true,
                  cellOffset: [dx, dy, dz],
                });
              }
            }
          }
        }
      }
    }
    return bonds;
  }

  if (scene.kind !== "MOLECULE") return [];
  const bonds: VisualBond[] = [];
  const canonical = new Set(scene.bonds.map(b => [b.atomIndexA, b.atomIndexB].sort((a,b) => a-b).join(":")));
  const atoms = [...scene.atoms].sort((a,b) => a.index-b.index);
  for (let i=0; i<atoms.length; i++) for (let j=i+1; j<atoms.length; j++) {
    const a=atoms[i]!, b=atoms[j]!;
    const ra=ELEMENT_VISUALS[a.element], rb=ELEMENT_VISUALS[b.element];
    if (!ra || !rb || canonical.has(`${a.index}:${b.index}`) || a.index === b.index) continue;
    const distance = Math.hypot(...a.position.map((v,k) => v-b.position[k]!));
    const radii = ra.covalentRadius+rb.covalentRadius;
    if (Number.isFinite(distance) && distance >= Math.max(.4, .5*radii) && distance <= Math.min(3.2, 1.2*radii)) {
      bonds.push({atomIndexA:a.index, atomIndexB:b.index, displayOnly:true});
    }
  }
  return bonds;
}
