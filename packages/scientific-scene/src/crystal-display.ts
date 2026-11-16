import { isMetal } from "./element-data";
import { cartesianToFractional, convexHullFaces, distance, fractionalToCartesian, hullEdges } from "./geometry";
import type { CellBoundaryMode, RenderableSceneData, ScientificSceneAtom, Vec3 } from "./types";
import type { VisualBond } from "./visual-bonds";

export type CrystalDisplayAtom = ScientificSceneAtom & {
  readonly displayIndex: number;
  readonly sourceAtomIndex: number;
  readonly cellOffset: Vec3;
  readonly role: "cell" | "boundary-image" | "coordination-image";
  readonly isCoordinationImage?: boolean;
};

export type CrystalDisplayBond = {
  readonly atomIndexA: number;
  readonly atomIndexB: number;
  readonly displayIndexA: number;
  readonly displayIndexB: number;
  readonly isDashed: boolean;
  readonly length: number;
};

export type CrystalPolyhedron = {
  readonly centerAtomIndex: number;
  readonly centerDisplayIndex: number;
  readonly centerElement: string;
  readonly vertices: readonly Vec3[];
  readonly faces: readonly (readonly [number, number, number])[];
  readonly edges: readonly (readonly [number, number])[];
};

export type CrystalDisplayResult = {
  readonly atoms: readonly CrystalDisplayAtom[];
  readonly bonds: readonly CrystalDisplayBond[];
  readonly polyhedra: readonly CrystalPolyhedron[];
};

const keyOf = (p: Vec3): string =>
  `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;

export function displayAtomsAndBondsForCrystal(
  scene: RenderableSceneData,
  visualBonds: readonly VisualBond[],
  mode: CellBoundaryMode = "coordination",
): CrystalDisplayResult {
  if (scene.kind !== "PERIODIC" || !scene.cell) {
    const atoms: CrystalDisplayAtom[] = scene.atoms.map((atom, index) => ({
      ...atom,
      displayIndex: index,
      sourceAtomIndex: atom.index,
      cellOffset: [0, 0, 0],
      role: "cell",
    }));
    const bonds: CrystalDisplayBond[] = visualBonds.map((b) => {
      const a = atoms.find((at) => at.sourceAtomIndex === b.atomIndexA);
      const bAtom = atoms.find((at) => at.sourceAtomIndex === b.atomIndexB);
      const len = a && bAtom ? distance(a.position, bAtom.position) : 1;
      return {
        atomIndexA: b.atomIndexA,
        atomIndexB: b.atomIndexB,
        displayIndexA: a?.displayIndex ?? b.atomIndexA,
        displayIndexB: bAtom?.displayIndex ?? b.atomIndexB,
        isDashed: Boolean(b.isDashed),
        length: len,
      };
    });
    return { atoms, bonds, polyhedra: [] };
  }

  const vectors = scene.cell.latticeVectors;
  const atoms: CrystalDisplayAtom[] = [];
  const keys = new Map<string, number>();

  function registerAtom(
    atom: ScientificSceneAtom,
    cartPos: Vec3,
    cellOffset: Vec3,
    role: "cell" | "boundary-image" | "coordination-image",
  ): number {
    const key = keyOf(cartPos);
    const existing = keys.get(key);
    if (existing !== undefined) return existing;
    const index = atoms.length;
    atoms.push({
      ...atom,
      id: `${atom.id}:${cellOffset.join(":")}`,
      position: cartPos,
      displayIndex: index,
      sourceAtomIndex: atom.index,
      cellOffset,
      role,
      ...(role === "coordination-image" ? { isCoordinationImage: true } : {}),
    });
    keys.set(key, index);
    return index;
  }

  // 1. In-cell atoms
  const inCellAtoms: { atom: ScientificSceneAtom; frac: Vec3 }[] = [];
  for (const atom of scene.atoms) {
    const frac =
      atom.sourceCoordinateSystem === "FRACTIONAL"
        ? atom.sourcePosition
        : cartesianToFractional(atom.position, vectors);
    registerAtom(atom, atom.position, [0, 0, 0], "cell");
    inCellAtoms.push({ atom, frac });
  }

  // 2. Boundary repetitions on opposite face/edge/corners (tolerance 1e-3 fractional)
  const EPS = 1e-3;
  for (const { atom, frac } of inCellAtoms) {
    const axes: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      if (frac[axis]! < EPS) axes.push(axis);
    }
    for (let mask = 1; mask < 1 << axes.length; mask++) {
      const shiftedFrac: [number, number, number] = [frac[0], frac[1], frac[2]];
      const offset: [number, number, number] = [0, 0, 0];
      axes.forEach((axis, bit) => {
        if (mask & (1 << bit)) {
          const idx = axis as 0 | 1 | 2;
          shiftedFrac[idx] += 1;
          offset[idx] += 1;
        }
      });
      const cart = fractionalToCartesian(shiftedFrac, vectors);
      registerAtom(atom, cart, offset, "boundary-image");
    }
  }

  const bonds: CrystalDisplayBond[] = [];
  const seenBond = new Set<string>();

  function addBond(dispA: number, dispB: number, isDashed: boolean, len: number) {
    const [minIdx, maxIdx] = dispA < dispB ? [dispA, dispB] : [dispB, dispA];
    const key = `${minIdx}:${maxIdx}`;
    if (seenBond.has(key)) return;
    seenBond.add(key);
    bonds.push({
      atomIndexA: atoms[minIdx]!.sourceAtomIndex,
      atomIndexB: atoms[maxIdx]!.sourceAtomIndex,
      displayIndexA: minIdx,
      displayIndexB: maxIdx,
      isDashed,
      length: len,
    });
  }

  // 3. Connect bonds & coordination images
  if (mode === "coordination") {
    // For each in-cell atom, connect all incident visual bonds
    for (let i = 0; i < scene.atoms.length; i++) {
      const atomA = scene.atoms[i]!;
      const dispA = i; // in-cell atom displayIndex is its scene atom index

      for (const vb of visualBonds) {
        let otherIndex = -1;
        let shift: Vec3 = [0, 0, 0];

        if (vb.atomIndexA === atomA.index) {
          otherIndex = vb.atomIndexB;
          shift = vb.cellOffset ?? [0, 0, 0];
        } else if (vb.atomIndexB === atomA.index) {
          otherIndex = vb.atomIndexA;
          const off = vb.cellOffset ?? [0, 0, 0];
          shift = [-off[0], -off[1], -off[2]];
        }
        if (otherIndex === -1) continue;

        const targetAtom = scene.atoms.find((a) => a.index === otherIndex);
        if (!targetAtom) continue;

        const shiftCart: Vec3 = [
          shift[0] * vectors[0][0] + shift[1] * vectors[1][0] + shift[2] * vectors[2][0],
          shift[0] * vectors[0][1] + shift[1] * vectors[1][1] + shift[2] * vectors[2][1],
          shift[0] * vectors[0][2] + shift[1] * vectors[1][2] + shift[2] * vectors[2][2],
        ];
        const targetPos: Vec3 = [
          targetAtom.position[0] + shiftCart[0],
          targetAtom.position[1] + shiftCart[1],
          targetAtom.position[2] + shiftCart[2],
        ];

        const existingIdx = keys.get(keyOf(targetPos));
        let dispB: number;
        let isDashed = false;

        if (existingIdx !== undefined) {
          dispB = existingIdx;
          // If the existing atom is inside the cell / boundary, bond is solid
          isDashed = atoms[dispB]!.role === "coordination-image";
        } else {
          // New coordination image outside the cell
          dispB = registerAtom(targetAtom, targetPos, shift, "coordination-image");
          isDashed = true;
        }

        const len = distance(atoms[dispA]!.position, atoms[dispB]!.position);
        addBond(dispA, dispB, isDashed, len);
      }
    }
  } else {
    // Mode "cell": only bonds between displayed atoms
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const atA = atoms[i]!;
        const atB = atoms[j]!;
        if (isMetal(atA.element) && isMetal(atB.element)) continue;
        const d = distance(atA.position, atB.position);
        // Check if there is an inferred bond between their source atoms
        const matches = visualBonds.some((vb) => {
          if (
            (vb.atomIndexA === atA.sourceAtomIndex && vb.atomIndexB === atB.sourceAtomIndex) ||
            (vb.atomIndexB === atA.sourceAtomIndex && vb.atomIndexA === atB.sourceAtomIndex)
          ) {
            // Check distance
            return Math.abs(d - (vb.cellOffset ? d : d)) < 0.05;
          }
          return false;
        });
        if (matches) {
          addBond(i, j, false, d);
        }
      }
    }
  }

  // 4. Coordination polyhedra around metal centers in the cell
  const polyhedra: CrystalPolyhedron[] = [];
  for (let i = 0; i < scene.atoms.length; i++) {
    const center = atoms[i]!;
    if (center.role !== "cell" || !isMetal(center.element)) continue;

    // Find all bonded ligands connected to this center
    const ligandPositions: Vec3[] = [];
    for (const b of bonds) {
      if (b.displayIndexA === i) ligandPositions.push(atoms[b.displayIndexB]!.position);
      else if (b.displayIndexB === i) ligandPositions.push(atoms[b.displayIndexA]!.position);
    }

    if (ligandPositions.length >= 4) {
      const faces = convexHullFaces(ligandPositions);
      if (faces.length > 0) {
        const edges = hullEdges(ligandPositions, faces);
        polyhedra.push({
          centerAtomIndex: center.sourceAtomIndex,
          centerDisplayIndex: i,
          centerElement: center.element,
          vertices: ligandPositions,
          faces,
          edges,
        });
      }
    }
  }

  return { atoms, bonds, polyhedra };
}
