import type { MeasurementKind, MeasurementResult, ScientificScene, VisualBond, VisualizationState } from "@chemdft/scientific-scene";
import type { StructureVersionDetail } from "@chemdft/schemas";
import type { WorkspaceTab } from "./workspace-selection";

export type StructureInspectorContext = {
  projectId?: string;
  detail: StructureVersionDetail;
  scene: ScientificScene | null;
  visualBonds: readonly VisualBond[];
  visualBondsEnabled: boolean;
  selectedAtomIndex: number | null;
  measurementKind: MeasurementKind | "none";
  measurementAtomIndices: readonly number[];
  measurement: MeasurementResult | null;
  sourceName?: string;
};

export function structureReview(detail: StructureVersionDetail): string {
  const review = detail.provenance?.verification_state;
  return review === "UNVERIFIED" || !review ? "NOT REVIEWED" : detail.version.origin === "RECONSTRUCTED" && review === "VERIFIED" ? "USER REVIEWED" : review;
}

/** The importer names structures "<file stem> · imported from <program label>"; the label comes from the output itself. */
const IMPORTED_STRUCTURE_NAME = /^(.+?) · imported from (.+)$/;
const IMPORTED_STEM_LIMIT = 28;

/** Short display label derived from the saved name; exact source name stays in title/Inspector. */
export function compactStructureTitle(name: string, revision: number): string {
  const imported = IMPORTED_STRUCTURE_NAME.exec(name.trim());
  if (imported) {
    const [, stem = "", source = ""] = imported;
    // Only the file stem is clipped: the detected engine/version is never cut.
    const shortStem = stem.length > IMPORTED_STEM_LIMIT ? `${stem.slice(0, IMPORTED_STEM_LIMIT - 1)}…` : stem;
    return `${shortStem} V${revision} · imported from ${source}`;
  }
  const words = name.trim().split(/\s+/).filter(word => !/^(test|user[-_]supplied|geometry|structure)$/i.test(word));
  const concise = (words.join(" ") || name || "Structure").slice(0, 38);
  return `${concise === concise.toUpperCase() ? concise.charAt(0)+concise.slice(1).toLowerCase() : concise} V${revision}`;
}

export function compactTabTitle(tab: WorkspaceTab): string {
  const revision = /\bV(\d+)/.exec(tab.label)?.[1];
  return ["structureVersion", "optimizedStructureVersion", "scientificScene"].includes(tab.selection.kind) && revision
    ? compactStructureTitle(tab.label.split(" · ")[0]!, Number(revision))
    : tab.label.replace("Restricted Hartree-Fock", "RHF");
}

export function restoredStructureDisplay(raw: string | null, fallback: VisualizationState): { state: VisualizationState; visualBondsEnabled: boolean } {
  try {
    const saved = JSON.parse(raw ?? "null");
    if (!saved || typeof saved !== "object") return {state:fallback, visualBondsEnabled:true};
    const state = {...fallback};
    if (["ball-stick","sticks","wireframe","space-fill"].includes(saved.representation)) state.representation=saved.representation;
    if (["none","element","index"].includes(saved.labels)) state.labels=saved.labels;
    if (["conventional","colorblind","monochrome"].includes(saved.colorScheme)) state.colorScheme=saved.colorScheme;
    if (["perspective","orthographic"].includes(saved.projection)) state.camera={...fallback.camera,projection:saved.projection};
    if (["coordination", "cell"].includes(saved.cellContents)) state.cellContents = saved.cellContents;
    if (typeof saved.polyhedraVisible === "boolean") state.polyhedraVisible = saved.polyhedraVisible;
    if (typeof saved.atomScale === "number" && saved.atomScale >= 0.5 && saved.atomScale <= 2.5) state.atomScale = saved.atomScale;
    if (typeof saved.labelScale === "number" && saved.labelScale >= 0.5 && saved.labelScale <= 2.5) state.labelScale = saved.labelScale;
    if (typeof saved.legendVisible === "boolean") state.legendVisible = saved.legendVisible;
    if (["along-a", "along-b", "along-c", "along-a-star", "oblique"].includes(saved.presetView)) state.presetView = saved.presetView;
    return {state,visualBondsEnabled:saved.visualBondsEnabled !== false};
  } catch { return {state:fallback,visualBondsEnabled:true}; }
}
