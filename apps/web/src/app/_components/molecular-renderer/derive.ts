import { convexHullFaces, hullEdges } from "./hull";
import { distance, fractionalToCartesian } from "./lattice";
import type { CoordinationRule, ScientificStructure, Supercell, Vec3 } from "./types";

/** Maximum atoms a derived display may contain (matches the central scientific-scene display limit). */
export const MAX_DISPLAY_ATOMS = 5000;
const EPS = 1e-4;

export type AtomRole =
  /** A site of the n×n×n block. */
  | "cell"
  /** A periodic image on the upper cell face/edge/corner of a site that sits on the lower one (as crystal viewers draw). */
  | "boundary-image"
  /** A ligand outside the block that completes a coordination polyhedron of a site inside it. */
  | "polyhedron-image";

export type DisplayAtom = {
  readonly index: number;
  /** Index into `structure.sites`. */
  readonly siteIndex: number;
  readonly element: string;
  /** Cartesian Å. Always `fractionalToCartesian(fractional)` for crystals; never adjusted for composition. */
  readonly position: Vec3;
  readonly fractional?: Vec3;
  readonly role: AtomRole;
};

export type DisplayBond = {
  readonly a: number;
  readonly b: number;
  readonly source: "canonical" | "inferred";
  readonly length: number;
  /** True when an endpoint is a polyhedron-completing ligand, so the bond is only drawn with polyhedra. */
  readonly polyhedraOnly: boolean;
};

export type DisplayPolyhedron = {
  readonly center: number;
  readonly vertices: readonly number[];
  /** Triangles indexing `vertices` (positions in this array), wound outward. */
  readonly faces: readonly (readonly [number, number, number])[];
  /** The polyhedron's real edges (pairs of positions in `vertices`). */
  readonly edges: readonly (readonly [number, number])[];
  readonly rule: string;
};

export type CellGeometry = {
  readonly corners: readonly Vec3[];
  /** Pairs of indices into `corners`: the 12 edges of the n-block parallelepiped. */
  readonly edges: readonly (readonly [number, number])[];
};

export type DerivedGeometry = {
  readonly supercell: Supercell;
  readonly atoms: readonly DisplayAtom[];
  readonly bonds: readonly DisplayBond[];
  readonly polyhedra: readonly DisplayPolyhedron[];
  readonly cell: CellGeometry | null;
  /** Rotation pivot and bounding radius of everything drawn, Å (atom radii are added by the renderer). */
  readonly bounds: {
    readonly center: Vec3;
    /** Bounding-sphere radius about `center`. */
    readonly radius: number;
    /** Largest distance of any drawn point from the vertical (lattice c / Cartesian z) axis through `center`. */
    readonly horizontalRadius: number;
    /** Largest vertical (z) distance of any drawn point from `center`. */
    readonly halfHeight: number;
  };
  /** Neighbour counts per structure site, by element, from the structure's coordination/bond rules (1×1×1). */
  readonly coordination: Readonly<Record<string, readonly number[]>>;
};

const keyOf = (p: Vec3) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;

function cellGeometry(structure: ScientificStructure, n: Supercell): CellGeometry | null {
  if (!structure.lattice) return null;
  const corners: Vec3[] = [];
  for (let mask = 0; mask < 8; mask++) corners.push(fractionalToCartesian([(mask & 1) * n[0], ((mask >> 1) & 1) * n[1], ((mask >> 2) & 1) * n[2]], structure.lattice.vectors));
  const edges: [number, number][] = [];
  for (let mask = 0; mask < 8; mask++) for (let bit = 0; bit < 3; bit++) if (!(mask & (1 << bit))) edges.push([mask, mask | (1 << bit)]);
  return { corners, edges };
}

/** Neighbour counts for every site of the structure's own 1×1×1 cell (periodic) or molecule. */
function coordinationNumbers(structure: ScientificStructure): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  const rules: { a: string; b: string; max: number }[] = [
    ...(structure.coordinationRules ?? []).map((r) => ({ a: r.center, b: r.ligand, max: r.maxDistance })),
    ...(structure.displayBondRule?.pairs ?? []).map((p) => ({ a: p.a, b: p.b, max: p.maxDistance })),
  ];
  if (!structure.lattice || rules.length === 0) return result;
  const vectors = structure.lattice.vectors;
  const translations: Vec3[] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) translations.push(fractionalToCartesian([i, j, k], vectors));
  structure.sites.forEach((site) => {
    if (result[site.element]) return;
    result[site.element] = [];
  });
  structure.sites.forEach((site) => {
    const rule = rules.find((r) => r.a === site.element || r.b === site.element);
    if (!rule) return;
    const partner = rule.a === site.element ? rule.b : rule.a;
    let count = 0;
    for (const other of structure.sites) {
      if (other.element !== partner) continue;
      for (const t of translations) {
        const p: Vec3 = [other.position[0] + t[0], other.position[1] + t[1], other.position[2] + t[2]];
        if (distance(p, site.position) <= rule.max) count++;
      }
    }
    result[site.element]!.push(count);
  });
  return result;
}

type Registry = { atoms: DisplayAtom[]; keys: Map<string, number> };

function register(reg: Registry, siteIndex: number, element: string, position: Vec3, fractional: Vec3 | undefined, role: AtomRole): number {
  const key = keyOf(position);
  const existing = reg.keys.get(key);
  if (existing !== undefined) return existing;
  const index = reg.atoms.length;
  reg.atoms.push({ index, siteIndex, element, position, ...(fractional ? { fractional } : {}), role });
  reg.keys.set(key, index);
  return index;
}

function inferBonds(structure: ScientificStructure, atoms: readonly DisplayAtom[]): DisplayBond[] {
  const bonds: DisplayBond[] = [];
  const polyOnly = (a: DisplayAtom, b: DisplayAtom) => a.role === "polyhedron-image" || b.role === "polyhedron-image";
  if (structure.kind === "molecule") {
    const seen = new Set<string>();
    const add = (i: number, j: number, source: DisplayBond["source"]) => {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key) || i === j) return;
      seen.add(key);
      bonds.push({ a: i, b: j, source, length: distance(atoms[i]!.position, atoms[j]!.position), polyhedraOnly: false });
    };
    for (const [i, j] of structure.canonicalBonds ?? []) add(i, j, "canonical");
    for (const [i, j] of structure.inferredBonds?.pairs ?? []) add(i, j, "inferred");
    return bonds;
  }
  const pairs = structure.displayBondRule?.pairs ?? [];
  if (pairs.length === 0) return bonds;
  const cutoff = Math.max(...pairs.map((p) => p.maxDistance));
  const grid = new Map<string, number[]>();
  const cellOf = (p: Vec3) => [Math.floor(p[0] / cutoff), Math.floor(p[1] / cutoff), Math.floor(p[2] / cutoff)] as const;
  atoms.forEach((atom, index) => {
    const c = cellOf(atom.position).join(",");
    const bucket = grid.get(c);
    if (bucket) bucket.push(index);
    else grid.set(c, [index]);
  });
  for (const atom of atoms) {
    const [cx, cy, cz] = cellOf(atom.position);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (j <= atom.index) continue;
            const other = atoms[j]!;
            const rule = pairs.find((p) => (p.a === atom.element && p.b === other.element) || (p.b === atom.element && p.a === other.element));
            if (!rule) continue;
            const length = distance(atom.position, other.position);
            if (length <= rule.maxDistance) bonds.push({ a: atom.index, b: j, source: "inferred", length, polyhedraOnly: polyOnly(atom, other) });
          }
  }
  return bonds;
}

function addPolyhedra(structure: ScientificStructure, n: Supercell, reg: Registry, rule: CoordinationRule): DisplayPolyhedron[] {
  const vectors = structure.lattice!.vectors;
  const parameters = structure.lattice!.parameters;
  const range = Math.max(1, Math.ceil(rule.maxDistance / Math.min(parameters.a, parameters.b, parameters.c)));
  const centers = reg.atoms.filter((atom) => atom.role === "cell" && atom.element === rule.center);
  const polyhedra: DisplayPolyhedron[] = [];
  for (const center of centers) {
    const found: { siteIndex: number; position: Vec3; fractional: Vec3 }[] = [];
    structure.sites.forEach((site, siteIndex) => {
      if (site.element !== rule.ligand) return;
      for (let i = -range; i < n[0] + range; i++)
        for (let j = -range; j < n[1] + range; j++)
          for (let k = -range; k < n[2] + range; k++) {
            const fractional: Vec3 = [site.fractional![0] + i, site.fractional![1] + j, site.fractional![2] + k];
            const position = fractionalToCartesian(fractional, vectors);
            if (distance(position, center.position) <= rule.maxDistance) found.push({ siteIndex, position, fractional });
          }
    });
    if (found.length !== rule.expectedCount) continue; // never draw a polyhedron that is not the stated coordination
    const vertices = found.map((f) => register(reg, f.siteIndex, rule.ligand, f.position, f.fractional, "polyhedron-image"));
    const points = vertices.map((v) => reg.atoms[v]!.position);
    const faces = convexHullFaces(points);
    if (faces.length > 0) polyhedra.push({ center: center.index, vertices, faces, edges: hullEdges(points, faces), rule: rule.label });
  }
  return polyhedra;
}

const cache = new WeakMap<ScientificStructure, Map<string, DerivedGeometry>>();

/** Derives everything the renderer draws from the structure. Pure: the structure is never modified. */
export function deriveGeometry(structure: ScientificStructure, supercell: Supercell = [1, 1, 1]): DerivedGeometry {
  const n: Supercell = structure.kind === "periodic" ? [Math.max(1, Math.min(4, Math.floor(supercell[0]))), Math.max(1, Math.min(4, Math.floor(supercell[1]))), Math.max(1, Math.min(4, Math.floor(supercell[2])))] : [1, 1, 1];
  const cacheKey = n.join("x");
  const perStructure = cache.get(structure) ?? new Map<string, DerivedGeometry>();
  cache.set(structure, perStructure);
  const hit = perStructure.get(cacheKey);
  if (hit) return hit;

  const total = structure.sites.length * n[0] * n[1] * n[2];
  if (total > MAX_DISPLAY_ATOMS) throw new Error(`Display supercell would draw ${total} atoms, above the ${MAX_DISPLAY_ATOMS} atom limit.`);

  const reg: Registry = { atoms: [], keys: new Map() };
  let polyhedra: DisplayPolyhedron[] = [];
  const cell = cellGeometry(structure, n);

  if (structure.kind === "periodic" && structure.lattice) {
    const vectors = structure.lattice.vectors;
    for (let i = 0; i < n[0]; i++)
      for (let j = 0; j < n[1]; j++)
        for (let k = 0; k < n[2]; k++)
          structure.sites.forEach((site, siteIndex) => {
            const fractional: Vec3 = [site.fractional![0] + i, site.fractional![1] + j, site.fractional![2] + k];
            register(reg, siteIndex, site.element, fractionalToCartesian(fractional, vectors), fractional, "cell");
          });
    for (const atom of [...reg.atoms]) {
      const axes = [0, 1, 2].filter((axis) => atom.fractional![axis]! < EPS);
      for (let mask = 1; mask < 1 << axes.length; mask++) {
        const fractional = [...atom.fractional!] as [number, number, number];
        axes.forEach((axis, bit) => {
          if (mask & (1 << bit)) fractional[axis] = fractional[axis]! + n[axis]!;
        });
        register(reg, atom.siteIndex, atom.element, fractionalToCartesian(fractional, vectors), fractional, "boundary-image");
      }
    }
    for (const rule of structure.coordinationRules ?? []) polyhedra = polyhedra.concat(addPolyhedra(structure, n, reg, rule));
  } else {
    structure.sites.forEach((site, siteIndex) => register(reg, siteIndex, site.element, site.position, undefined, "cell"));
  }

  const atoms = reg.atoms;
  const bonds = inferBonds(structure, atoms);

  let center: Vec3;
  const points: Vec3[] = atoms.map((a) => a.position);
  if (cell) {
    center = fractionalToCartesian([n[0] / 2, n[1] / 2, n[2] / 2], structure.lattice!.vectors);
    points.push(...cell.corners);
  } else {
    const lo = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis]!)));
    const hi = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis]!)));
    center = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
  }
  const radius = Math.max(0.5, ...points.map((p) => distance(p, center)));
  const horizontalRadius = Math.max(0.5, ...points.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1])));
  const halfHeight = Math.max(0.5, ...points.map((p) => Math.abs(p[2] - center[2])));

  const derived: DerivedGeometry = { supercell: n, atoms, bonds, polyhedra, cell, bounds: { center, radius, horizontalRadius, halfHeight }, coordination: coordinationNumbers(structure) };
  perStructure.set(cacheKey, derived);
  return derived;
}
