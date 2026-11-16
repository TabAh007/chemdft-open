import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import reference from "../src/app/_components/home/reference/cr2o3-reference.json";
import { deriveGeometry } from "../src/app/_components/molecular-renderer/derive";
import { latticeVectors as latticeVectorsOf } from "../src/app/_components/molecular-renderer/lattice";
import { CR2O3_BOND_CUTOFF as BOND_CUTOFF, CR2O3_STRUCTURE } from "../src/app/_components/molecular-renderer/structures/cr2o3";
import type { Vec3 } from "../src/app/_components/molecular-renderer/types";

// These tests used to import the homepage's own crystal code. The homepage now draws through the shared molecular
// renderer, so the same independent checks (against the CIF's own symmetry operators) run on the renderer's derivation.
const CRYSTAL = {
  source: { doi: "10.1016/0025-5408(94)90019-1" },
  lattice: reference.lattice,
  spaceGroup: reference.space_group_symbol,
  spaceGroupNumber: reference.space_group_number,
  formulaUnitsZ: 6,
};
const cell = (n: number) => deriveGeometry(CR2O3_STRUCTURE, [n, n, n]);
const latticeVectors = () => latticeVectorsOf(CR2O3_STRUCTURE.lattice!.parameters);
const blockAtoms = (n: number) => cell(n).atoms.filter((atom) => atom.role === "cell");
const displayedAtoms = (n: number) => cell(n).atoms.filter((atom) => atom.role !== "polyhedron-image");
const bondsAmong = (atoms: { index: number }[]) => cell(1).bonds.filter((bond) => !bond.polyhedraOnly && atoms.length > 0);
const cellOutline = (n: number) => ({ corners: cell(n).cell!.corners.map((c) => [...c] as unknown as Vec3), edges: cell(n).cell!.edges });
const coordinationNumbers = () => cell(1).coordination as { Cr: readonly number[]; O: readonly number[] };
const octahedra = (n: number) =>
  cell(n).polyhedra.map((p) => ({ center: cell(n).atoms[p.center]!.position as Vec3, vertices: p.vertices.map((v) => cell(n).atoms[v]!.position as Vec3), faces: p.faces }));

const ROOT = resolve(import.meta.dirname, "../src/app/_components/home/reference");
const cif = readFileSync(resolve(ROOT, "cod-9014036-cr2o3.cif"), "utf8");

function cifValue(tag: string): string {
  const match = new RegExp(`^${tag}\\s+(.+)$`, "m").exec(cif);
  if (!match) throw new Error(`CIF has no ${tag}`);
  return match[1]!.trim().replace(/^'|'$/g, "");
}

/** Evaluate a CIF symmetry operator such as "2/3+x,1/3+x-y,5/6+z" for fractional (x, y, z). */
function applyOperator(operator: string, [x, y, z]: Vec3): Vec3 {
  const [fx, fy, fz] = operator.split(",").map((expression) => {
    const terms = expression.replaceAll(" ", "").match(/[+-]?[^+-]+/g) ?? [];
    let total = 0;
    for (const term of terms) {
      const sign = term.startsWith("-") ? -1 : 1;
      const body = term.replace(/^[+-]/, "");
      if (body === "x") total += sign * x;
      else if (body === "y") total += sign * y;
      else if (body === "z") total += sign * z;
      else if (body.includes("/")) total += (sign * Number(body.split("/")[0])) / Number(body.split("/")[1]);
      else total += sign * Number(body);
    }
    return total;
  });
  return [fx!, fy!, fz!];
}

const wrap = (value: number) => ((Math.round(value * 1e5) / 1e5) % 1 + 1) % 1 % 1;
const key = (element: string, frac: Vec3) => `${element}:${frac.map((v) => wrap(v).toFixed(4)).join(",")}`;

describe("reference α-Cr₂O₃ structure (COD 9014036)", () => {
  const operators = [...cif.split("_space_group_symop_operation_xyz")[1]!.split("loop_")[0]!.split("\n").map((line) => line.trim()).filter((line) => /[xyz]/.test(line))];
  const atomLoop = cif.split("_atom_site_U_iso_or_equiv")[1]!.split("loop_")[0]!;
  const asymmetric = atomLoop.trim().split("\n").map((line) => line.trim().split(/\s+/)).filter((row) => row.length >= 5);

  it("is the CIF's own data: it contains atomic coordinates and the expected phase", () => {
    expect(asymmetric).toHaveLength(2); // Cr and O in the asymmetric unit: the coordinates are in the file
    expect(cifValue("_chemical_formula_sum")).toBe("Cr2 O3");
    expect(cifValue("_chemical_name_mineral")).toBe("Eskolaite");
    expect(cifValue("_cod_database_code")).toBe("9014036");
    expect(cifValue("_database_code_amcsd")).toBe("0017803");
    expect(cifValue("_journal_paper_doi")).toBe(CRYSTAL.source.doi);
    expect(CR2O3_STRUCTURE.provenance.source?.citation).toContain(CRYSTAL.source.doi);
    expect(cifValue("_space_group_IT_number")).toBe("167");
    expect(cifValue("_symmetry_space_group_name_H-M")).toBe("R -3 c :H");
    expect(cif).toMatch(/proper attribution is given to the journal article/);
  });

  it("matches the lattice and symmetry the page displays", () => {
    const { lattice } = CRYSTAL;
    expect(lattice.a).toBeCloseTo(Number(cifValue("_cell_length_a")), 3);
    expect(lattice.b).toBeCloseTo(Number(cifValue("_cell_length_b")), 3);
    expect(lattice.c).toBeCloseTo(Number(cifValue("_cell_length_c")), 3);
    expect([lattice.alpha, lattice.beta, lattice.gamma]).toEqual([90, 90, 120]);
    expect(lattice.volume).toBeCloseTo(Number(cifValue("_cell_volume")), 2);
    expect(CRYSTAL.spaceGroup).toBe("R-3c");
    expect(CRYSTAL.spaceGroupNumber).toBe(167);
    expect(CRYSTAL.formulaUnitsZ).toBe(Number(cifValue("_cell_formula_units_Z")));
    // the bundled data is not the paper-adjacent cell: it is exactly this CIF's cell
    expect(lattice.a).not.toBeCloseTo(4.958, 3);
  });

  it("re-derives all 30 bundled sites from the CIF's symmetry operators", () => {
    const expected = new Set<string>();
    for (const row of asymmetric) {
      const element = row[0]!;
      const frac: Vec3 = [Number(row[1]), Number(row[2]), Number(row[3])];
      for (const operator of operators) expected.add(key(element, applyOperator(operator, frac)));
    }
    const bundled = new Set(reference.sites.map((site) => key(site.element, site.fractional as unknown as Vec3)));
    expect(expected.size).toBe(30);
    expect(bundled).toEqual(expected);
    expect(reference.composition).toEqual({ Cr: 12, O: 18 }); // Cr2O3 × Z = 6
  });

  it("has the corundum coordination: Cr is six-coordinate, O four-coordinate, Cr–O ≈ 1.96 and 2.01 Å", () => {
    const counts = coordinationNumbers();
    expect(new Set(counts.Cr)).toEqual(new Set([6]));
    expect(new Set(counts.O)).toEqual(new Set([4]));
    expect(reference.coordination_numbers).toEqual({ Cr: [6], O: [4] }); // pymatgen CrystalNN, recorded by the generator
    expect(reference.cr_o_distances_angstrom.every((d) => d > 1.9 && d < 2.05)).toBe(true);
    expect(BOND_CUTOFF).toBeGreaterThan(Math.max(...reference.cr_o_distances_angstrom));
  });

  it("builds a true hexagonal parallelepiped, not a rectangular box", () => {
    const [a1, a2, a3] = latticeVectors();
    const length = (v: Vec3) => Math.hypot(...v);
    const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    expect(length(a1)).toBeCloseTo(4.957, 3);
    expect(length(a2)).toBeCloseTo(4.957, 3);
    expect(length(a3)).toBeCloseTo(13.5923, 3);
    expect(Math.acos(dot(a1, a2) / (length(a1) * length(a2))) * (180 / Math.PI)).toBeCloseTo(120, 6);
    expect(dot(a1, a3)).toBeCloseTo(0, 8);
    expect(dot(a2, a3)).toBeCloseTo(0, 8);
    const outline = cellOutline(1);
    expect(outline.corners).toHaveLength(8);
    expect(outline.edges).toHaveLength(12);
    const cellVolume = Math.abs(a1[0] * (a2[1] * a3[2] - a2[2] * a3[1]) - a1[1] * (a2[0] * a3[2] - a2[2] * a3[0]) + a1[2] * (a2[0] * a3[1] - a2[1] * a3[0]));
    expect(cellVolume).toBeCloseTo(CRYSTAL.lattice.volume, 1);
  });

  it("generates the 1×1×1 cell and the 2×2×2 supercell", () => {
    expect(blockAtoms(1)).toHaveLength(30);
    expect(blockAtoms(2)).toHaveLength(240);
    expect(blockAtoms(2).filter((atom) => atom.element === "Cr")).toHaveLength(96);
    expect(displayedAtoms(1).length).toBeGreaterThan(30); // face images are drawn on the cell boundary
    expect(displayedAtoms(2).length).toBeGreaterThan(240);
    expect(cellOutline(2).corners.some((corner) => corner[2] > 2 * 13.5)).toBe(true);
    expect(bondsAmong(displayedAtoms(1)).length).toBeGreaterThan(0);
  });

  it("builds only true six-coordinate octahedra from the structure", () => {
    const cell = octahedra(1);
    expect(cell).toHaveLength(12); // one per Cr in the cell
    expect(octahedra(2)).toHaveLength(96);
    for (const polyhedron of cell) {
      expect(polyhedron.vertices).toHaveLength(6);
      expect(polyhedron.faces).toHaveLength(8);
      for (const vertex of polyhedron.vertices) {
        const d = Math.hypot(vertex[0] - polyhedron.center[0], vertex[1] - polyhedron.center[1], vertex[2] - polyhedron.center[2]);
        expect(d).toBeGreaterThan(1.9);
        expect(d).toBeLessThan(2.05);
      }
    }
  });
});
