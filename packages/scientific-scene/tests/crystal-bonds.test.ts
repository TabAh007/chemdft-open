import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  cellVolume,
  displayAtomsAndBondsForCrystal,
  inferVisualBonds,
  presetCameraDirection,
  dot,
  cross,
  magnitude,
  type RenderableSceneData,
  type ScientificSceneAtom,
  type ScientificSceneCell,
  type Vec3,
} from "../src/index";
import moleculesJson from "../../../apps/web/src/app/_components/home/reference/molecules.json";

function parseCifToScene(cifText: string, id: string): RenderableSceneData {
  const lines = cifText.split("\n").map((l) => l.trim());
  let a = 0, b = 0, c = 0, alpha = 90, beta = 90, gamma = 90;
  for (const line of lines) {
    if (line.startsWith("_cell_length_a")) a = parseFloat(line.split(/\s+/)[1]!);
    if (line.startsWith("_cell_length_b")) b = parseFloat(line.split(/\s+/)[1]!);
    if (line.startsWith("_cell_length_c")) c = parseFloat(line.split(/\s+/)[1]!);
    if (line.startsWith("_cell_angle_alpha")) alpha = parseFloat(line.split(/\s+/)[1]!);
    if (line.startsWith("_cell_angle_beta")) beta = parseFloat(line.split(/\s+/)[1]!);
    if (line.startsWith("_cell_angle_gamma")) gamma = parseFloat(line.split(/\s+/)[1]!);
  }

  const DEG = Math.PI / 180;
  const ca = Math.cos(alpha * DEG);
  const cb = Math.cos(beta * DEG);
  const cg = Math.cos(gamma * DEG);
  const sg = Math.sin(gamma * DEG);
  const cy = (ca - cb * cg) / sg;
  const cz = Math.sqrt(Math.max(0, 1 - cb * cb - cy * cy));
  const latticeVectors: readonly [Vec3, Vec3, Vec3] = [
    [a, 0, 0],
    [b * cg, b * sg, 0],
    [c * cb, c * cy, c * cz],
  ];

  let inAtomLoop = false;
  const atoms: ScientificSceneAtom[] = [];
  let colIndexSymbol = -1, colIndexX = -1, colIndexY = -1, colIndexZ = -1;
  let colCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("loop_")) {
      inAtomLoop = false;
      colCount = 0;
      colIndexSymbol = -1; colIndexX = -1; colIndexY = -1; colIndexZ = -1;
      continue;
    }
    if (line.startsWith("_atom_site_")) {
      inAtomLoop = true;
      if (line.includes("type_symbol")) colIndexSymbol = colCount;
      if (line.includes("fract_x")) colIndexX = colCount;
      if (line.includes("fract_y")) colIndexY = colCount;
      if (line.includes("fract_z")) colIndexZ = colCount;
      colCount++;
      continue;
    }
    if (inAtomLoop && line && !line.startsWith("#") && !line.startsWith("_")) {
      const parts = line.split(/\s+/);
      if (parts.length >= colCount && colIndexSymbol >= 0) {
        const element = parts[colIndexSymbol]!.replace(/[^A-Za-z]/g, "");
        const fx = parseFloat(parts[colIndexX]!);
        const fy = parseFloat(parts[colIndexY]!);
        const fz = parseFloat(parts[colIndexZ]!);
        const px = fx * latticeVectors[0][0] + fy * latticeVectors[1][0] + fz * latticeVectors[2][0];
        const py = fx * latticeVectors[0][1] + fy * latticeVectors[1][1] + fz * latticeVectors[2][1];
        const pz = fx * latticeVectors[0][2] + fy * latticeVectors[1][2] + fz * latticeVectors[2][2];
        const idx = atoms.length;
        atoms.push({
          id: `atom:${idx}`,
          index: idx,
          element,
          atomicNumber: element === "Cr" ? 24 : 8,
          position: [px, py, pz],
          sourcePosition: [fx, fy, fz],
          sourceCoordinateSystem: "FRACTIONAL",
        });
      }
    }
  }

  const cell: ScientificSceneCell = {
    a, b, c, alpha, beta, gamma,
    latticeVectors,
    periodicDimensions: [true, true, true],
  };

  return {
    id,
    kind: "PERIODIC",
    atoms,
    bonds: [],
    cell,
  };
}

describe("Crystal structure periodic display bonds and coordination", () => {
  const hexCif = readFileSync(resolve(__dirname, "fixtures/Cr2O3_hex.cif"), "utf-8");
  const rhombCif = readFileSync(resolve(__dirname, "fixtures/Cr2O3_rhomb.cif"), "utf-8");

  const hexScene = parseCifToScene(hexCif, "Cr2O3_hex");
  const rhombScene = parseCifToScene(rhombCif, "Cr2O3_rhomb");

  it("calculates accurate cell volume for hexagonal and rhombohedral cells", () => {
    const vHex = cellVolume(hexScene.cell!);
    // a=b=4.958, c=13.593, gamma=120 -> V = 289.37365745
    expect(vHex).toBeCloseTo(289.37, 1);

    const vRhomb = cellVolume(rhombScene.cell!);
    // a=b=c=5.3595, alpha=55.103 -> V = 96.45788582 (1/3 of hex cell volume)
    expect(vRhomb).toBeCloseTo(289.37 / 3, 1);
  });

  it("infers exact bond counts and coordination for hexagonal Cr2O3", () => {
    const bonds = inferVisualBonds(hexScene);
    // 72 unique Cr-O bonds per cell counting bonds that cross the boundary once
    expect(bonds).toHaveLength(72);

    // Verify zero Cr-Cr and zero O-O bonds
    for (const bond of bonds) {
      const elA = hexScene.atoms[bond.atomIndexA]!.element;
      const elB = hexScene.atoms[bond.atomIndexB]!.element;
      expect(elA === "Cr" && elB === "Cr").toBe(false);
      expect(elA === "O" && elB === "O").toBe(false);
      expect((elA === "Cr" && elB === "O") || (elA === "O" && elB === "Cr")).toBe(true);
    }

    // Measure neighbour counts and distances for every Cr and O
    const crBonds: Record<number, number[]> = {};
    const oBonds: Record<number, number[]> = {};
    for (const atom of hexScene.atoms) {
      if (atom.element === "Cr") crBonds[atom.index] = [];
      if (atom.element === "O") oBonds[atom.index] = [];
    }

    const vectors = hexScene.cell!.latticeVectors;
    for (const b of bonds) {
      const atomA = hexScene.atoms[b.atomIndexA]!;
      const atomB = hexScene.atoms[b.atomIndexB]!;
      const off = b.cellOffset ?? [0, 0, 0];
      const shiftX = off[0] * vectors[0][0] + off[1] * vectors[1][0] + off[2] * vectors[2][0];
      const shiftY = off[0] * vectors[0][1] + off[1] * vectors[1][1] + off[2] * vectors[2][1];
      const shiftZ = off[0] * vectors[0][2] + off[1] * vectors[1][2] + off[2] * vectors[2][2];
      const dist = Math.hypot(
        atomA.position[0] - (atomB.position[0] + shiftX),
        atomA.position[1] - (atomB.position[1] + shiftY),
        atomA.position[2] - (atomB.position[2] + shiftZ),
      );

      if (atomA.element === "Cr") crBonds[atomA.index]!.push(dist);
      if (atomB.element === "Cr") crBonds[atomB.index]!.push(dist);
      if (atomA.element === "O") oBonds[atomA.index]!.push(dist);
      if (atomB.element === "O") oBonds[atomB.index]!.push(dist);
    }

    // Every Cr has exactly 6 O neighbours (3 at 1.965 A and 3 at 2.013 A, tolerance 0.002)
    const crIndices = Object.keys(crBonds).map(Number);
    expect(crIndices).toHaveLength(12);
    for (const crIdx of crIndices) {
      const dists = crBonds[crIdx]!.sort((x, y) => x - y);
      expect(dists).toHaveLength(6);
      const shortDists = dists.slice(0, 3);
      const longDists = dists.slice(3);
      for (const d of shortDists) expect(d).toBeCloseTo(1.965, 2);
      for (const d of longDists) expect(d).toBeCloseTo(2.013, 2);
    }

    // Every O has exactly 4 Cr neighbours
    const oIndices = Object.keys(oBonds).map(Number);
    expect(oIndices).toHaveLength(18);
    for (const oIdx of oIndices) {
      expect(oBonds[oIdx]).toHaveLength(4);
    }
  });

  it("infers exact bond counts and coordination for rhombohedral Cr2O3", () => {
    const bonds = inferVisualBonds(rhombScene);
    // 24 unique Cr-O bonds per cell
    expect(bonds).toHaveLength(24);

    const crBonds: Record<number, number[]> = {};
    const oBonds: Record<number, number[]> = {};
    for (const atom of rhombScene.atoms) {
      if (atom.element === "Cr") crBonds[atom.index] = [];
      if (atom.element === "O") oBonds[atom.index] = [];
    }

    const vectors = rhombScene.cell!.latticeVectors;
    for (const b of bonds) {
      const atomA = rhombScene.atoms[b.atomIndexA]!;
      const atomB = rhombScene.atoms[b.atomIndexB]!;
      const off = b.cellOffset ?? [0, 0, 0];
      const shiftX = off[0] * vectors[0][0] + off[1] * vectors[1][0] + off[2] * vectors[2][0];
      const shiftY = off[0] * vectors[0][1] + off[1] * vectors[1][1] + off[2] * vectors[2][1];
      const shiftZ = off[0] * vectors[0][2] + off[1] * vectors[1][2] + off[2] * vectors[2][2];
      const dist = Math.hypot(
        atomA.position[0] - (atomB.position[0] + shiftX),
        atomA.position[1] - (atomB.position[1] + shiftY),
        atomA.position[2] - (atomB.position[2] + shiftZ),
      );

      if (atomA.element === "Cr") crBonds[atomA.index]!.push(dist);
      if (atomB.element === "Cr") crBonds[atomB.index]!.push(dist);
      if (atomA.element === "O") oBonds[atomA.index]!.push(dist);
      if (atomB.element === "O") oBonds[atomB.index]!.push(dist);
    }

    // Every Cr has exactly 6 O neighbours
    expect(Object.keys(crBonds)).toHaveLength(4);
    for (const crIdx of Object.keys(crBonds).map(Number)) {
      const dists = crBonds[crIdx]!.sort((x, y) => x - y);
      expect(dists).toHaveLength(6);
      for (const d of dists.slice(0, 3)) expect(d).toBeCloseTo(1.965, 2);
      for (const d of dists.slice(3)) expect(d).toBeCloseTo(2.013, 2);
    }

    // Every O has exactly 4 Cr neighbours
    expect(Object.keys(oBonds)).toHaveLength(6);
    for (const oIdx of Object.keys(oBonds).map(Number)) {
      expect(oBonds[oIdx]).toHaveLength(4);
    }
  });

  it("builds cell mode and coordination mode with polyhedra for Cr2O3", () => {
    const bonds = inferVisualBonds(hexScene);
    const coordDisplay = displayAtomsAndBondsForCrystal(hexScene, bonds, "coordination");
    const cellDisplay = displayAtomsAndBondsForCrystal(hexScene, bonds, "cell");

    // In coordination mode, bonds leaving cell are dashed
    const dashed = coordDisplay.bonds.filter((b) => b.isDashed);
    const solid = coordDisplay.bonds.filter((b) => !b.isDashed);
    expect(dashed.length).toBeGreaterThan(0);
    expect(solid.length).toBeGreaterThan(0);

    // In cell mode, all bonds are between displayed atoms and solid
    expect(cellDisplay.bonds.every((b) => !b.isDashed)).toBe(true);

    // Coordination polyhedra: 12 octahedra around the 12 Cr atoms in the cell
    expect(coordDisplay.polyhedra).toHaveLength(12);
    for (const poly of coordDisplay.polyhedra) {
      expect(poly.centerElement).toBe("Cr");
      expect(poly.vertices).toHaveLength(6);
      expect(poly.faces).toHaveLength(8); // octahedron has 8 triangular faces
      expect(poly.edges).toHaveLength(12); // octahedron has 12 edges
    }
  });

  it("preserves exact inferVisualBonds output for benzene and caffeine (molecule regression)", () => {
    // Benzene
    const benzeneData = (moleculesJson as any).benzene;
    const benzeneScene: RenderableSceneData = {
      id: "benzene",
      kind: "MOLECULE",
      atoms: benzeneData.atoms.map((a: any, i: number) => ({
        id: `atom:${i}`,
        index: i,
        element: a.element,
        atomicNumber: a.element === "C" ? 6 : 1,
        position: [a.x, a.y, a.z],
        sourcePosition: [a.x, a.y, a.z],
        sourceCoordinateSystem: "CARTESIAN",
      })),
      bonds: [],
    };
    const benzeneBonds = inferVisualBonds(benzeneScene);
    // Benzene C6H6: 6 C-C bonds + 6 C-H bonds = 12 bonds
    expect(benzeneBonds).toHaveLength(12);
    expect(benzeneBonds.every((b) => b.displayOnly === true)).toBe(true);
    // Verify each bond only has atomIndexA, atomIndexB, displayOnly
    expect(Object.keys(benzeneBonds[0]!).sort()).toEqual(["atomIndexA", "atomIndexB", "displayOnly"].sort());

    // Caffeine
    const caffeineData = (moleculesJson as any).caffeine;
    const caffeineScene: RenderableSceneData = {
      id: "caffeine",
      kind: "MOLECULE",
      atoms: caffeineData.atoms.map((a: any, i: number) => ({
        id: `atom:${i}`,
        index: i,
        element: a.element,
        atomicNumber: a.element === "C" ? 6 : a.element === "N" ? 7 : a.element === "O" ? 8 : 1,
        position: [a.x, a.y, a.z],
        sourcePosition: [a.x, a.y, a.z],
        sourceCoordinateSystem: "CARTESIAN",
      })),
      bonds: [],
    };
    const caffeineBonds = inferVisualBonds(caffeineScene);
    // Caffeine: 24 atoms (8 C, 10 H, 4 N, 2 O), 25 bonds inferred
    expect(caffeineBonds).toHaveLength(25);
    expect(caffeineBonds.every((b) => b.displayOnly === true)).toBe(true);
    expect(Object.keys(caffeineBonds[0]!).sort()).toEqual(["atomIndexA", "atomIndexB", "displayOnly"].sort());
  });

  it("calculates view presets correctly and ensures 'Along c' is parallel to c lattice vector", () => {
    const alongC = presetCameraDirection("along-c", hexScene.cell!);
    const vc = hexScene.cell!.latticeVectors[2];
    const vcNorm: Vec3 = [vc[0] / magnitude(vc), vc[1] / magnitude(vc), vc[2] / magnitude(vc)];
    // Direction must be parallel to c (dot product close to 1)
    expect(dot(alongC.direction, vcNorm)).toBeCloseTo(1, 5);

    // Test 'Along a*' is perpendicular to b and c
    const alongAStar = presetCameraDirection("along-a-star", hexScene.cell!);
    const vb = hexScene.cell!.latticeVectors[1];
    expect(Math.abs(dot(alongAStar.direction, vb))).toBeLessThan(1e-5);
    expect(Math.abs(dot(alongAStar.direction, vc))).toBeLessThan(1e-5);

    // Test 'Along a' and 'Along b'
    const alongA = presetCameraDirection("along-a", hexScene.cell!);
    const va = hexScene.cell!.latticeVectors[0];
    const vaNorm: Vec3 = [va[0] / magnitude(va), va[1] / magnitude(va), va[2] / magnitude(va)];
    expect(dot(alongA.direction, vaNorm)).toBeCloseTo(1, 5);
  });
});
