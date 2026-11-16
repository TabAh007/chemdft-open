import type { NavigatorAction, NavigatorState, NavigatorTarget } from "@chemdft/schemas";
import { validSelection, type WorkspaceSelection } from "./workspace-selection";

/** Only adapters to existing workspace controls. No calculation submission or scientific rules. */
export const NAVIGATOR_LAUNCHES = ["draw", "structure_import", "inspect", "edit", "cell", "supercell", "energy", "optimization", "orbitals", "ir", "raman", "uvvis", "spectrum_import", "experimental", "compare", "spectra", "mo", "density", "esp", "thermochemistry", "document_import", "calculation_import", "provenance", "jobs"] as const satisfies readonly NavigatorTarget["launch"][];

export function navigatorSelection(projectId: string, target: NavigatorTarget): WorkspaceSelection | null {
  if (!target.selection_kind || !target.selection_id) return null;
  const selection = { projectId, kind: target.selection_kind, id: target.selection_id, ...(target.source_id ? { sourceId: target.source_id } : {}) };
  return validSelection(selection, projectId) ? selection : null;
}

export function navigatorHref(locale: string, projectId: string, action: NavigatorAction, goal?: NavigatorState["goal"], structureVersionId?: string | null): string | null {
  const target = action.target;
  if (!target || action.reasons?.length || !NAVIGATOR_LAUNCHES.includes(target.launch)) return null;
  const route = target.route === "jobs" ? "jobs" : "workspace";
  const params = new URLSearchParams();
  params.set("navigator_action", action.action_id);
  if (goal) params.set("navigator_goal", goal);
  if (structureVersionId) params.set("navigator_version", structureVersionId);
  const selection = navigatorSelection(projectId, target);
  if (target.selection_kind && !selection) return null;
  if (selection) {
    params.set("selection", `${selection.kind}:${selection.id}`);
    if ("sourceId" in selection) params.set("source", selection.sourceId);
    if (selection.kind === "structureVersion") params.set("navigator_version", selection.id);
  }
  if (target.launch === "spectrum_import") params.set("import", "spectrum");
  if (target.launch === "calculation_import") params.set("import", "calculation");
  return `/${encodeURIComponent(locale)}/projects/${encodeURIComponent(projectId)}/${route}?${params}`;
}

export function navigatorCalculationTask(actionId: string | null): "ENERGY" | "GEOMETRY_OPTIMIZATION" | "ORBITAL" | undefined {
  if (actionId === "calculation.single_point") return "ENERGY";
  if (actionId === "calculation.optimize") return "GEOMETRY_OPTIMIZATION";
  if (actionId === "calculation.orbitals") return "ORBITAL";
  return undefined;
}
