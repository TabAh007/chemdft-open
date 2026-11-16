import type { StructureSummary, StructureVersionDetail } from "@chemdft/schemas";
import { buildScientificScene, elementVisual, inferVisualBonds, type Vec3 } from "@chemdft/scientific-scene";
import { getStructureVersion, listStructures } from "./structure-workspace-api";

/**
 * Project thumbnails: a static, view-only drawing of the project's latest committed StructureVersion.
 *
 * Source of truth is the persisted structure record read through the authenticated API (the same endpoints the workspace
 * uses). Nothing here is generated, cached on disk, or served from a public location; there is no WebGL context and no
 * calculation. Geometry comes from `buildScientificScene` (the workspace's own coordinate pipeline); bonds are the stored
 * connectivity plus ChemDFT's display-only visual-bond inference for molecules, exactly as in the workspace viewer.
 * Periodic structures show the real lattice vectors as the unit-cell outline and carry no inferred bonds.
 */

export const MAX_PREVIEW_ATOMS = 500;
/** Bound the fan-out for a project with very many structures; candidates are ordered by structure recency first. */
const MAX_CANDIDATE_STRUCTURES = 6;
const MAX_CONCURRENT_REQUESTS = 4;

export type PreviewAtom = { x: number; y: number; r: number; element: string; color: string };
export type PreviewSegment = { x1: number; y1: number; x2: number; y2: number };

export type PreviewModel = {
  versionId: string;
  structureId: string;
  structureName: string;
  revision: number;
  kind: "molecule" | "periodic";
  formula: string;
  atomCount: number;
  /** Painted far to near. Coordinates are in a −50…50 viewBox. */
  atoms: PreviewAtom[];
  bonds: PreviewSegment[];
  cell: PreviewSegment[];
  /** True when at least one drawn bond was inferred for display rather than stored. */
  inferredBonds: boolean;
  /** Structures in the project (the card shows the latest one only). */
  structureCount?: number;
};

export type PreviewResult =
  | { status: "ready"; model: PreviewModel }
  | { status: "none" }
  | { status: "large"; structureName: string; formula: string; atomCount: number; structureCount?: number }
  | { status: "unavailable" };

/* ------------------------------------------------------------------ selection */

function stamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The project's latest committed structure version, deterministically.
 * Only versions that provably belong to the project (and to the structure they claim) and that carry coordinates qualify.
 * Order: newest `created_at`, then highest revision, then smallest version id (a stable tie-break).
 */
export function selectLatestCommitted(projectId: string, details: readonly StructureVersionDetail[]): StructureVersionDetail | null {
  const eligible = details.filter(
    (detail) =>
      detail.structure.project_id === projectId &&
      detail.version.project_id === projectId &&
      detail.version.structure_id === detail.structure.id &&
      (detail.version.coordinates?.atoms.length ?? 0) > 0,
  );
  eligible.sort(
    (a, b) =>
      stamp(b.version.created_at) - stamp(a.version.created_at) ||
      b.version.revision - a.version.revision ||
      a.version.id.localeCompare(b.version.id),
  );
  return eligible[0] ?? null;
}

/** Structures whose latest version is worth fetching, most recently touched first (stable). */
export function candidateStructures(projectId: string, summaries: readonly StructureSummary[]): StructureSummary[] {
  return summaries
    .filter((summary) => summary.project_id === projectId)
    .sort((a, b) => stamp(b.updated_at) - stamp(a.updated_at) || a.id.localeCompare(b.id))
    .slice(0, MAX_CANDIDATE_STRUCTURES);
}

/* ------------------------------------------------------------------ formula */

export function hillFormula(elements: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);
  const order = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const hasCarbon = counts.has("C");
  const ranked = hasCarbon ? ["C", ...(counts.has("H") ? ["H"] : []), ...order.filter((e) => e !== "C" && e !== "H")] : order;
  return ranked.map((element) => `${element}${counts.get(element)! > 1 ? counts.get(element) : ""}`).join("");
}

/* ------------------------------------------------------------------ projection */

export type Mat3 = readonly [readonly number[], readonly number[], readonly number[]];

function eigenSymmetric(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const a = matrix.map((row) => [...row]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) off += a[p]![q]! ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j]![j]! - a[i]![i]! || i - j);
  return {
    values: order.map((i) => a[i]![i]!),
    vectors: order.map((i) => [v[0]![i]!, v[1]![i]!, v[2]![i]!]),
  };
}

const dot = (u: readonly number[], w: readonly number[]) => u[0]! * w[0]! + u[1]! * w[1]! + u[2]! * w[2]!;
const cross = (u: readonly number[], w: readonly number[]): number[] => [
  u[1]! * w[2]! - u[2]! * w[1]!,
  u[2]! * w[0]! - u[0]! * w[2]!,
  u[0]! * w[1]! - u[1]! * w[0]!,
];

/** Sign convention makes the principal axes reproducible for identical coordinates. */
function signed(axis: number[]): number[] {
  let pivot = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(axis[i]!) > Math.abs(axis[pivot]!) + 1e-12) pivot = i;
  return axis[pivot]! < 0 ? axis.map((c) => -c) : axis;
}

/** A proper rotation (never a reflection, so chirality is preserved) whose first two axes follow the molecule's extent. */
export function principalFrame(points: readonly Vec3[]): Mat3 {
  const n = points.length;
  const centroid = [0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k]!, 0) / n);
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p[0]! - centroid[0]!, p[1]! - centroid[1]!, p[2]! - centroid[2]!];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i]![j]! += d[i]! * d[j]!;
  }
  const { vectors } = eigenSymmetric(cov);
  const e1 = signed(vectors[0]!);
  let e2 = vectors[1]!.map((c, k) => c - dot(vectors[1]!, e1) * e1[k]!);
  const norm = Math.hypot(...e2);
  e2 = norm > 1e-9 ? signed(e2.map((c) => c / norm)) : cross(e1, Math.abs(e1[0]!) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  const length = Math.hypot(...e2);
  e2 = e2.map((c) => c / length);
  return [e1, e2, cross(e1, e2)];
}

type Placed = { x: number; y: number; depth: number };

/** yaw about the vertical axis, then tilt about the horizontal axis; camera on +z looking down −z. */
function view(local: readonly [number, number, number], yaw: number, tilt: number): Placed {
  const [x, y, z] = local;
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const y2 = y * Math.cos(tilt) - z1 * Math.sin(tilt);
  const z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt);
  return { x: x1, y: -y2, depth: z2 };
}

const round = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ model */

export function buildPreviewModel(detail: StructureVersionDetail): PreviewResult {
  let scene;
  try {
    scene = buildScientificScene(detail);
  } catch {
    return { status: "unavailable" };
  }
  const structureName = detail.structure.name;
  const elements = scene.atoms.map((atom) => atom.element);
  if (elements.length === 0) return { status: "none" };
  const formula = hillFormula(elements);
  if (elements.length > MAX_PREVIEW_ATOMS) return { status: "large", structureName, formula, atomCount: elements.length };

  const periodic = scene.kind === "PERIODIC" && Boolean(scene.cell);
  const cellVectors = scene.cell?.latticeVectors;
  let frame: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let origin: number[];
  let yaw = 0.45;
  let tilt = 0.5;
  if (periodic && cellVectors) {
    // Crystal frame: c vertical, as in the homepage reference view. The centre is the real cell centre.
    frame = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
    origin = [0, 1, 2].map((k) => (cellVectors[0][k]! + cellVectors[1][k]! + cellVectors[2][k]!) / 2);
    yaw = 0.6;
    tilt = 0.4;
  } else {
    const points = scene.atoms.map((atom) => atom.position);
    frame = principalFrame(points);
    origin = [0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k]!, 0) / points.length);
  }
  const place = (p: readonly number[]): Placed => {
    const d = [p[0]! - origin[0]!, p[1]! - origin[1]!, p[2]! - origin[2]!];
    return view([dot(frame[0]!, d), dot(frame[1]!, d), dot(frame[2]!, d)], yaw, tilt);
  };

  const placed = scene.atoms.map((atom) => place(atom.position));
  const corners: Placed[] = [];
  if (periodic && cellVectors) {
    for (let i = 0; i < 8; i++) {
      const p = [0, 1, 2].map((k) => (i & 1 ? cellVectors[0][k]! : 0) + (i & 2 ? cellVectors[1][k]! : 0) + (i & 4 ? cellVectors[2][k]! : 0));
      corners.push(place(p));
    }
  }
  const covalent = scene.atoms.map((atom) => elementVisual(atom.element).covalentRadius);
  const factor = periodic ? 0.27 : 0.36;
  // Fit atoms (including their radii) and the cell outline into the viewBox.
  const extent = (scale: number) =>
    Math.max(
      0.5,
      ...placed.flatMap((p, i) => [Math.abs(p.x) + covalent[i]! * factor * scale, Math.abs(p.y) + covalent[i]! * factor * scale]),
      ...corners.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]),
    );
  const scale = 44 / extent(1);
  const radius = (i: number) => Math.max(1.5, covalent[i]! * factor * scale);

  const atoms = placed
    .map((p, i) => ({ depth: p.depth, atom: { x: round(p.x * scale), y: round(p.y * scale), r: round(radius(i)), element: elements[i]!, color: elementVisual(elements[i]!).conventionalColor } }))
    .sort((a, b) => a.depth - b.depth)
    .map((entry) => entry.atom);

  const position = new Map(scene.atoms.map((atom, i) => [atom.index, i]));
  const bondPairs: Array<readonly [number, number]> = [];
  for (const bond of scene.bonds) bondPairs.push([bond.atomIndexA, bond.atomIndexB]);
  const inferred = inferVisualBonds(scene);
  for (const bond of inferred) bondPairs.push([bond.atomIndexA, bond.atomIndexB]);
  const bonds: PreviewSegment[] = [];
  for (const [a, b] of bondPairs) {
    const ia = position.get(a);
    const ib = position.get(b);
    if (ia === undefined || ib === undefined) continue;
    bonds.push({ x1: round(placed[ia]!.x * scale), y1: round(placed[ia]!.y * scale), x2: round(placed[ib]!.x * scale), y2: round(placed[ib]!.y * scale) });
  }
  const cell: PreviewSegment[] = [];
  if (corners.length === 8) {
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        if (i & bit) continue;
        const a = corners[i]!;
        const b = corners[i | bit]!;
        cell.push({ x1: round(a.x * scale), y1: round(a.y * scale), x2: round(b.x * scale), y2: round(b.y * scale) });
      }
    }
  }
  return {
    status: "ready",
    model: {
      versionId: detail.version.id,
      structureId: detail.structure.id,
      structureName,
      revision: detail.version.revision,
      kind: periodic ? "periodic" : "molecule",
      formula,
      atomCount: elements.length,
      atoms,
      bonds,
      cell,
      inferredBonds: inferred.length > 0,
    },
  };
}

/* ------------------------------------------------------------------ loading */

let active = 0;
const waiting: Array<() => void> = [];
function limited<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active += 1;
      task().then(resolve, reject).finally(() => {
        active -= 1;
        waiting.shift()?.();
      });
    };
    if (active < MAX_CONCURRENT_REQUESTS) run();
    else waiting.push(run);
  });
}

/** Immutable by version id, so a cached version never needs to be fetched or re-derived again (keyed with the project too, so a cache hit can never cross projects). */
const versionCache = new Map<string, PreviewResult>();
const detailCache = new Map<string, StructureVersionDetail>();
/** One result per project for this visit to the page; cleared on mount so a new visit re-checks which version is latest. */
const visitResults = new Map<string, PreviewResult>();
const inflight = new Map<string, Promise<PreviewResult>>();
const subscribers = new Map<string, Set<() => void>>();

export function resetProjectPreviews(): void {
  visitResults.clear();
  inflight.clear();
}

/**
 * Drops every cached structure and drawing. Called when the dashboard unmounts, so no project geometry outlives the page
 * that was authorised to show it (sign-out, account switch, revoked access). The caches are memory-only and per project.
 */
export function clearProjectPreviewCaches(): void {
  resetProjectPreviews();
  versionCache.clear();
  detailCache.clear();
}

const PREVIEW_TIMEOUT_MS = 20_000;
function withTimeout(task: Promise<PreviewResult>): Promise<PreviewResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: "unavailable" }), PREVIEW_TIMEOUT_MS);
    task.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      () => {
        clearTimeout(timer);
        resolve({ status: "unavailable" });
      },
    );
  });
}

export function peekProjectPreview(projectId: string): PreviewResult | undefined {
  return visitResults.get(projectId);
}

export function subscribeProjectPreview(projectId: string, listener: () => void): () => void {
  const set = subscribers.get(projectId) ?? new Set<() => void>();
  set.add(listener);
  subscribers.set(projectId, set);
  return () => {
    set.delete(listener);
  };
}

async function versionDetail(summary: StructureSummary): Promise<StructureVersionDetail | null> {
  const key = `${summary.project_id}:${summary.latest_version_id}`;
  const cached = detailCache.get(key);
  if (cached) return cached;
  try {
    const detail = await limited(() =>
      getStructureVersion({ projectId: summary.project_id, structureId: summary.id, versionId: summary.latest_version_id }),
    );
    detailCache.set(key, detail);
    return detail;
  } catch {
    return null;
  }
}

export function loadProjectPreview(projectId: string): Promise<PreviewResult> {
  const known = visitResults.get(projectId);
  if (known) return Promise.resolve(known);
  const pending = inflight.get(projectId);
  if (pending) return pending;
  const task = withTimeout((async (): Promise<PreviewResult> => {
    let summaries: StructureSummary[];
    try {
      summaries = await limited(() => listStructures(projectId));
    } catch {
      return { status: "unavailable" };
    }
    const candidates = candidateStructures(projectId, summaries);
    if (candidates.length === 0) return { status: "none" };
    const details = (await Promise.all(candidates.map(versionDetail))).filter((d): d is StructureVersionDetail => d !== null);
    if (details.length === 0) return { status: "unavailable" };
    const chosen = selectLatestCommitted(projectId, details);
    if (!chosen) return { status: "none" };
    const cacheKey = `${projectId}:${chosen.version.id}`;
    const cached = versionCache.get(cacheKey);
    if (cached) return cached;
    const built = buildPreviewModel(chosen);
    const result: PreviewResult =
      built.status === "ready" ? { status: "ready", model: { ...built.model, structureCount: summaries.length } }
      : built.status === "large" ? { ...built, structureCount: summaries.length } : built;
    versionCache.set(cacheKey, result);
    return result;
  })()).then((result) => {
    visitResults.set(projectId, result);
    inflight.delete(projectId);
    subscribers.get(projectId)?.forEach((listener) => listener());
    return result;
  });
  inflight.set(projectId, task);
  return task;
}
