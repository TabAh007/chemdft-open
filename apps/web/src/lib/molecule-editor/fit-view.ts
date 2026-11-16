/**
 * Fit the Ketcher viewport to a drawing with a sane zoom range. Ketcher's own fit goes down to zoom 0.1, which makes a
 * drawing with far-apart fragments a few readable-less specks; here a minimum keeps atoms legible, and a drawing that
 * is too large to fit readably is fitted on its main fragment instead (the "Fit all" button then shows everything).
 */
import type { EditorKetcher } from "./ketcher-types";

/** Ketcher zoom 1 draws a bond ~40 px long; 0.5 (~20 px) is the smallest size at which atom labels stay readable. */
export const MIN_READABLE_ZOOM = 0.5;
export const MAX_FIT_ZOOM = 1;
export const FIT_MARGIN_PX = 28;

export type Point = { x: number; y: number };
export type Geometry = { atoms: Point[]; bonds: [number, number][] };

/** Coordinates and bonds of a V2000 molfile; anything unparseable gives an empty geometry. */
export function parseMolfileGeometry(molfile: string): Geometry {
  const lines = molfile.replace(/\r\n?/g, "\n").split("\n");
  const countsAt = lines.slice(0, 8).findIndex((line) => /V2000\s*$/.test(line));
  if (countsAt < 0) return { atoms: [], bonds: [] };
  const counts = lines[countsAt] ?? "";
  const atomCount = Number.parseInt(counts.slice(0, 3), 10);
  const bondCount = Number.parseInt(counts.slice(3, 6), 10);
  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount)) return { atoms: [], bonds: [] };
  const atoms: Point[] = [];
  for (let i = 0; i < atomCount; i += 1) {
    const line = lines[countsAt + 1 + i] ?? "";
    const x = Number.parseFloat(line.slice(0, 10));
    const y = Number.parseFloat(line.slice(10, 20));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { atoms: [], bonds: [] };
    atoms.push({ x, y });
  }
  const bonds: [number, number][] = [];
  for (let i = 0; i < bondCount; i += 1) {
    const line = lines[countsAt + 1 + atomCount + i] ?? "";
    const a = Number.parseInt(line.slice(0, 3), 10) - 1;
    const b = Number.parseInt(line.slice(3, 6), 10) - 1;
    if (a >= 0 && b >= 0 && a < atomCount && b < atomCount) bonds.push([a, b]);
  }
  return { atoms, bonds };
}

/** Atom indices of the connected fragment with the most atoms (the first one on a tie). */
export function mainFragment(geometry: Geometry): number[] {
  const parent = geometry.atoms.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    parent[i] = root;
    return root;
  };
  for (const [a, b] of geometry.bonds) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  geometry.atoms.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  let best: number[] = [];
  for (const members of groups.values()) if (members.length > best.length) best = members;
  return best;
}

export function boundingBox(points: Point[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)),
  };
}

/** The zoom at which a box of `widthPx` x `heightPx` (measured at zoom 1) fits the area with a margin, clamped. */
export function fitZoom(widthPx: number, heightPx: number, areaW: number, areaH: number, margin = FIT_MARGIN_PX): { zoom: number; fits: boolean } {
  const availW = Math.max(areaW - 2 * margin, 40);
  const availH = Math.max(areaH - 2 * margin, 40);
  const wanted = Math.min(widthPx > 0 ? availW / widthPx : Infinity, heightPx > 0 ? availH / heightPx : Infinity);
  const raw = Number.isFinite(wanted) ? wanted : MAX_FIT_ZOOM;
  const zoom = Math.min(Math.max(raw, MIN_READABLE_ZOOM), MAX_FIT_ZOOM);
  return { zoom: Number(zoom.toFixed(3)), fits: raw >= MIN_READABLE_ZOOM };
}

export type FitResult = { zoom: number; scope: "all" | "main"; allFitReadably: boolean };

type RenderLike = {
  options: { zoom: number; microModeScale: number };
  clientArea: HTMLElement;
  viewBox: { minX: number; minY: number; width: number; height: number };
  setViewBox: (fn: (viewBox: { minX: number; minY: number; width: number; height: number }) => unknown) => void;
};
type EditorLike = { zoom: (value?: number) => number; struct: () => { getCoordBoundingBox: () => { min: { x: number; y: number }; max: { x: number; y: number } } }; render: RenderLike };

/**
 * Zoom and centre the viewport on the drawing (`scope: "all"`) or, when the whole drawing cannot be shown at a readable
 * size, on its largest fragment. Never throws: a failing Ketcher internal leaves the view as it was.
 */
export function fitDrawing(k: EditorKetcher, molfile: string, scope: "auto" | "all" = "auto"): FitResult | null {
  try {
    const editor = k.editor as unknown as EditorLike;
    const render = editor.render;
    const struct = editor.struct().getCoordBoundingBox();
    const geometry = parseMolfileGeometry(molfile);
    const mol = boundingBox(geometry.atoms);
    if (!mol) return null;
    // Ketcher rescales a loaded structure; relate its model units to the molfile's by comparing the two boxes.
    const molW = mol.maxX - mol.minX;
    const molH = mol.maxY - mol.minY;
    const unitsPerMol = molW >= molH && molW > 0 ? (struct.max.x - struct.min.x) / molW : molH > 0 ? (struct.max.y - struct.min.y) / molH : 1;
    const pxPerModel = render.options.microModeScale; // pixels per model unit at zoom 1
    const area = render.clientArea.getBoundingClientRect();
    const measure = (box: { minX: number; maxX: number; minY: number; maxY: number }) => ({
      w: (box.maxX - box.minX) * unitsPerMol * pxPerModel,
      h: (box.maxY - box.minY) * unitsPerMol * pxPerModel,
    });
    const all = measure(mol);
    const fitAll = fitZoom(all.w, all.h, area.width, area.height);
    let chosen = fitAll.zoom;
    let used: "all" | "main" = "all";
    let centre = { x: (mol.minX + mol.maxX) / 2, y: (mol.minY + mol.maxY) / 2 };
    if (!fitAll.fits && scope === "auto") {
      const members = mainFragment(geometry);
      const main = members.length < geometry.atoms.length ? boundingBox(members.map((i) => geometry.atoms[i] as Point)) : null;
      if (main) {
        const size = measure(main);
        chosen = fitZoom(size.w, size.h, area.width, area.height).zoom;
        centre = { x: (main.minX + main.maxX) / 2, y: (main.minY + main.maxY) / 2 };
        used = "main";
      }
    }
    editor.zoom(chosen);
    // Model position of the centre: Ketcher's model y axis points down and is offset by the structure's own box.
    const modelX = struct.min.x + (centre.x - mol.minX) * unitsPerMol;
    const modelY = struct.max.y - (centre.y - mol.minY) * unitsPerMol;
    // The view box is in zoom-1 pixels (its width is the canvas width divided by the zoom).
    const width = area.width / chosen;
    const height = area.height / chosen;
    const scale = render.options.microModeScale;
    render.setViewBox((viewBox) => ({ ...viewBox, width, height, minX: modelX * scale - width / 2, minY: modelY * scale - height / 2 }));
    return { zoom: chosen, scope: used, allFitReadably: fitAll.fits };
  } catch {
    return null;
  }
}
