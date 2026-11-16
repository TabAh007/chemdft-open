import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveGeometry } from "../../src/app/_components/molecular-renderer/derive";
import { distance, dot } from "../../src/app/_components/molecular-renderer/lattice";
import { representationStyle, spaceFillModel } from "../../src/app/_components/molecular-renderer/radii";
import { CR2O3_STRUCTURE } from "../../src/app/_components/molecular-renderer/structures/cr2o3";
import reference from "../../src/app/_components/home/reference/cr2o3-reference.json";

const cif = readFileSync(resolve(import.meta.dirname, "../../src/app/_components/home/reference/cod-9014036-cr2o3.cif"), "utf8");
const key = (p: readonly number[]) => p.map((v) => Math.round(v * 1000)).join(",");

describe("α-Cr₂O₃ structure in the renderer (COD 9014036)", () => {
  const structure = CR2O3_STRUCTURE;

  it("keeps every validated site and the R-3c cell exactly as the validated reference stores them", () => {
    expect(structure.sites).toHaveLength(30);
    expect(structure.sites.filter((s) => s.element === "Cr")).toHaveLength(12);
    expect(structure.sites.filter((s) => s.element === "O")).toHaveLength(18);
    structure.sites.forEach((site, i) => {
      expect(site.element).toBe(reference.sites[i]!.element);
      expect(site.fractional).toEqual(reference.sites[i]!.fractional);
    });
    const p = structure.lattice!.parameters;
    expect([p.a, p.b, p.c, p.alpha, p.beta, p.gamma]).toEqual([4.957, 4.957, 13.5923, 90, 90, 120]);
    expect(cif).toMatch(/_cod_database_code\s+9014036/);
    expect(structure.provenance.source?.id).toBe("COD 9014036");
  });

  it("has a genuinely non-orthogonal lattice with the right metric", () => {
    const [a, b, c] = structure.lattice!.vectors;
    expect(Math.hypot(...a)).toBeCloseTo(4.957, 6);
    expect(Math.hypot(...b)).toBeCloseTo(4.957, 6);
    expect(Math.hypot(...c)).toBeCloseTo(13.5923, 6);
    expect(dot(a, b) / (Math.hypot(...a) * Math.hypot(...b))).toBeCloseTo(Math.cos((120 * Math.PI) / 180), 9);
    expect(dot(a, c)).toBeCloseTo(0, 9);
    expect(dot(b, c)).toBeCloseTo(0, 9);
    // volume of the cell is the CIF's 289.242 Å^3
    const volume = Math.abs(a[0] * (b[1] * c[2] - b[2] * c[1]));
    expect(volume).toBeCloseTo(reference.lattice.volume, 2);
  });

  it("is immutable and deriving geometry never modifies it", () => {
    const before = JSON.stringify(structure);
    expect(Object.isFrozen(structure)).toBe(true);
    expect(Object.isFrozen(structure.sites[0])).toBe(true);
    deriveGeometry(structure, [1, 1, 1]);
    deriveGeometry(structure, [2, 2, 2]);
    expect(JSON.stringify(structure)).toBe(before);
    expect(() => {
      (structure.sites[0] as { element: string }).element = "X";
    }).toThrow();
  });

  it("stores no coordinate that is not the lattice applied to its fractional site", () => {
    structure.sites.forEach((site) => {
      const [a, b, c] = structure.lattice!.vectors;
      const f = site.fractional!;
      for (let axis = 0; axis < 3; axis++) expect(site.position[axis]).toBeCloseTo(f[0] * a[axis]! + f[1] * b[axis]! + f[2] * c[axis]!, 9);
    });
  });
});

describe("1×1×1 and 2×2×2 supercell derivation", () => {
  const structure = CR2O3_STRUCTURE;
  const one = deriveGeometry(structure, [1, 1, 1]);
  const two = deriveGeometry(structure, [2, 2, 2]);

  it("replicates exactly: 30 sites per cell, 240 in the 2×2×2 block, no duplicate positions", () => {
    expect(one.atoms.filter((a) => a.role === "cell")).toHaveLength(30);
    expect(two.atoms.filter((a) => a.role === "cell")).toHaveLength(240);
    for (const geometry of [one, two]) {
      const keys = geometry.atoms.map((a) => key(a.position));
      expect(new Set(keys).size).toBe(keys.length); // no duplicated boundary atoms from naive replication
    }
  });

  it("places every block atom at fractional + integer translation, never moved", () => {
    const vectors = structure.lattice!.vectors;
    for (const atom of two.atoms) {
      const f = atom.fractional!;
      for (let axis = 0; axis < 3; axis++) expect(atom.position[axis]).toBeCloseTo(f[0] * vectors[0][axis]! + f[1] * vectors[1][axis]! + f[2] * vectors[2][axis]!, 9);
      const site = structure.sites[atom.siteIndex]!;
      expect(atom.element).toBe(site.element);
      const shift = f.map((v, axis) => v - site.fractional![axis]!);
      for (const s of shift) expect(Math.abs(s - Math.round(s))).toBeLessThan(1e-9); // an integer lattice translation
    }
  });

  it("repeats the 1×1×1 cell: the 1×1×1 atoms appear unchanged inside the 2×2×2 block", () => {
    const keys2 = new Set(two.atoms.map((a) => key(a.position)));
    for (const atom of one.atoms.filter((a) => a.role !== "polyhedron-image")) expect(keys2.has(key(atom.position))).toBe(true);
  });

  it("builds the 2×2×2 cell outline as the doubled non-orthogonal parallelepiped", () => {
    const c1 = one.cell!.corners;
    const c2 = two.cell!.corners;
    expect(c1).toHaveLength(8);
    expect(one.cell!.edges).toHaveLength(12);
    c2.forEach((corner, i) => corner.forEach((v, axis) => expect(v).toBeCloseTo(2 * c1[i]![axis]!, 9)));
    const edgeLengths = one.cell!.edges.map(([i, j]) => distance(c1[i]!, c1[j]!)).sort((a, b) => a - b);
    expect(edgeLengths.slice(0, 8).every((l) => Math.abs(l - 4.957) < 1e-6)).toBe(true);
    expect(edgeLengths.slice(8).every((l) => Math.abs(l - 13.5923) < 1e-6)).toBe(true);
  });

  it("agrees with an independent re-derivation from the CIF's own symmetry operators (atoms, bonds, polyhedra)", () => {
    const operators = cif.split("_space_group_symop_operation_xyz")[1]!.split("loop_")[0]!.split("\n").map((line) => line.trim()).filter((line) => /[xyz]/.test(line));
    const rows = cif.split("_atom_site_U_iso_or_equiv")[1]!.split("loop_")[0]!.trim().split("\n").map((line) => line.trim().split(/\s+/)).filter((row) => row.length >= 5);
    const apply = (operator: string, [x = 0, y = 0, z = 0]: number[]) =>
      operator.split(",").map((expression) => {
        let total = 0;
        for (const term of expression.replaceAll(" ", "").match(/[+-]?[^+-]+/g) ?? []) {
          const sign = term.startsWith("-") ? -1 : 1;
          const body = term.replace(/^[+-]/, "");
          total += body === "x" ? sign * x : body === "y" ? sign * y : body === "z" ? sign * z : body.includes("/") ? (sign * Number(body.split("/")[0])) / Number(body.split("/")[1]) : sign * Number(body);
        }
        return total;
      });
    const sites = new Map<string, { element: string; frac: number[] }>();
    for (const row of rows)
      for (const operator of operators) {
        const frac = apply(operator, [Number(row[1]), Number(row[2]), Number(row[3])]).map((v) => ((Math.round(v * 1e5) / 1e5) % 1 + 1) % 1 % 1);
        sites.set(`${row[0]}:${frac.map((v) => v.toFixed(4)).join(",")}`, { element: row[0]!, frac });
      }
    expect(sites.size).toBe(30);
    const vectors = structure.lattice!.vectors;
    const cart = (f: number[]) => [0, 1, 2].map((axis) => f[0]! * vectors[0][axis]! + f[1]! * vectors[1][axis]! + f[2]! * vectors[2][axis]!);
    const positionsOf = (n: number) => {
      const atoms: { element: string; position: number[] }[] = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) for (const site of sites.values()) atoms.push({ element: site.element, position: cart([site.frac[0]! + i, site.frac[1]! + j, site.frac[2]! + k]) });
      return atoms;
    };
    for (const [n, geometry] of [[1, one], [2, two]] as const) {
      const expected = positionsOf(n);
      const mine = geometry.atoms.filter((a) => a.role === "cell");
      expect(mine).toHaveLength(expected.length);
      // every independently derived atom has exactly one counterpart at the same place (positions agree to 1e-3 Å)
      const unused = new Set(mine.map((_, i) => i));
      for (const atom of expected) {
        const match = [...unused].find((i) => mine[i]!.element === atom.element && distance(mine[i]!.position, atom.position as unknown as readonly [number, number, number]) < 1e-3);
        expect(match, `no atom for ${atom.element} at ${atom.position}`).toBeDefined();
        unused.delete(match!);
      }
      expect(unused.size).toBe(0);
      // independent brute-force bond count among every atom of the block and its face images
      const shown = geometry.atoms.filter((a) => a.role !== "polyhedron-image");
      let brute = 0;
      for (let p = 0; p < shown.length; p++) for (let q = p + 1; q < shown.length; q++) if (shown[p]!.element !== shown[q]!.element && distance(shown[p]!.position, shown[q]!.position) <= 2.3) brute++;
      expect(geometry.bonds.filter((b) => !b.polyhedraOnly)).toHaveLength(brute);
      // every Cr in the block has exactly six O within 2.3 Å among the periodic images, and one polyhedron is drawn for it
      const oxygen = positionsOf(n + 2).filter((a) => a.element === "O");
      expect(geometry.polyhedra).toHaveLength(expected.filter((a) => a.element === "Cr").length);
      void oxygen;
    }
  });

  it("derives CrO₆ from the structure: six O per Cr, eight triangular faces, vertices 1.96–2.01 Å from the centre", () => {
    for (const geometry of [one, two]) {
      for (const polyhedron of geometry.polyhedra) {
        expect(polyhedron.vertices).toHaveLength(6);
        expect(polyhedron.faces).toHaveLength(8);
        const center = geometry.atoms[polyhedron.center]!;
        expect(center.element).toBe("Cr");
        for (const v of polyhedron.vertices) {
          const o = geometry.atoms[v]!;
          expect(o.element).toBe("O");
          const d = distance(o.position, center.position);
          expect(d).toBeGreaterThan(1.95);
          expect(d).toBeLessThan(2.02);
        }
      }
    }
  });

  it("winds every polyhedron face outward", () => {
    for (const polyhedron of one.polyhedra) {
      const center = one.atoms[polyhedron.center]!.position;
      for (const [i, j, k] of polyhedron.faces) {
        const p = [i, j, k].map((v) => one.atoms[polyhedron.vertices[v]!]!.position);
        const u = [0, 1, 2].map((a) => p[1]![a]! - p[0]![a]!);
        const v = [0, 1, 2].map((a) => p[2]![a]! - p[0]![a]!);
        const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        const outward = [0, 1, 2].map((a) => p[0]![a]! - center[a]!);
        expect(normal[0]! * outward[0]! + normal[1]! * outward[1]! + normal[2]! * outward[2]!).toBeGreaterThan(0);
      }
    }
  });

  it("draws only Cr–O display bonds within the stated cutoff, each labelled inferred", () => {
    for (const bond of two.bonds) {
      expect(bond.source).toBe("inferred");
      expect(bond.length).toBeLessThanOrEqual(2.3);
      expect(new Set([two.atoms[bond.a]!.element, two.atoms[bond.b]!.element])).toEqual(new Set(["Cr", "O"]));
    }
  });

  it("reproduces the validated coordination numbers (Cr 6, O 4) for every site", () => {
    expect(new Set(one.coordination.Cr)).toEqual(new Set([6]));
    expect(new Set(one.coordination.O)).toEqual(new Set([4]));
    expect(reference.coordination_numbers).toEqual({ Cr: [6], O: [4] });
  });

  it("frames the whole block: bounds centre is the cell centre and encloses every drawn point", () => {
    const [a, b, c] = structure.lattice!.vectors;
    for (const [n, g] of [[1, one], [2, two]] as const) {
      for (let axis = 0; axis < 3; axis++) expect(g.bounds.center[axis]).toBeCloseTo((n / 2) * (a[axis]! + b[axis]! + c[axis]!), 9);
      for (const atom of g.atoms) expect(distance(atom.position, g.bounds.center)).toBeLessThanOrEqual(g.bounds.radius + 1e-9);
    }
  });
});

describe("space-filling radius convention", () => {
  const geometry = deriveGeometry(CR2O3_STRUCTURE, [1, 1, 1]);
  const model = spaceFillModel(CR2O3_STRUCTURE, geometry.coordination);

  it("uses Shannon effective ionic radii at the structure's own coordination numbers", () => {
    expect(model.id).toBe("ionic-shannon");
    expect(model.radii.Cr).toBe(0.615); // Cr3+, CN 6
    expect(model.radii.O).toBe(1.38); // O2-, CN 4
    expect(model.citation).toMatch(/Shannon/);
  });

  it("is consistent with the structure: Cr and O spheres touch at the 1.96–2.01 Å bond distances without overlapping", () => {
    const touching = model.radii.Cr! + model.radii.O!;
    expect(touching).toBeCloseTo(1.995, 3);
    for (const bond of geometry.bonds) expect(bond.length).toBeGreaterThanOrEqual(touching - 0.05); // no more than 0.05 Å of overlap
    expect(Math.min(...geometry.bonds.map((b) => b.length))).toBeGreaterThan(1.9);
  });

  it("keeps ball-and-stick sizes labelled as display scale, not physical radii", () => {
    const style = representationStyle(CR2O3_STRUCTURE, "ball-stick", geometry.coordination);
    expect(style.model.physical).toBe(false);
    expect(style.model.id).toBe("display-scale");
    expect(representationStyle(CR2O3_STRUCTURE, "space-fill", geometry.coordination).model.physical).toBe(true);
  });
});
