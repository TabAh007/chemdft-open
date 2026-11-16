import type { ProductContext, ProductSelection } from "@chemdft/schemas";
import type { WorkspaceSelection } from "./workspace-selection";

/** Navigation IDs are hints only; the server resolves source input and authority. */
export function aiWorkspaceSelection(projectId: string, selection: WorkspaceSelection | null | undefined, currentView: string): ProductSelection {
  const hints: ProductSelection = { current_view: currentView.slice(0, 500) };
  if (selection?.projectId !== projectId) return hints;
  switch (selection.kind) {
    case "calculationResult": case "importedResult":
      return { ...hints, selected_result_id: selection.id };
    case "structureVersion": case "optimizedStructureVersion": case "scientificScene":
      return { ...hints, selected_structure_id: selection.sourceId, selected_structure_version_id: selection.id };
    case "document": return { ...hints, selected_document_id: selection.id };
    case "documentEvidence": return { ...hints, selected_document_id: selection.sourceId };
    case "experimentalDataset": case "experimentalSpectrum": return { ...hints, selected_spectrum_id: selection.id };
    default: return hints;
  }
}

export function associatedAiContext(context: ProductContext, projectId: string, selection: WorkspaceSelection | null | undefined, hints: ProductSelection): ProductContext {
  if (context.project_id !== projectId || context.selection.current_view !== hints.current_view) throw new Error("AI context does not match the current view.");
  for (const field of ["selected_result_id", "selected_structure_id", "selected_structure_version_id", "selected_document_id", "selected_spectrum_id"] as const) {
    if (hints[field] && context.selection[field] !== hints[field]) throw new Error("AI context does not match the selected resource.");
  }
  if (!hints.selected_result_id && context.selection.selected_result_id) throw new Error("AI context retained a previous result.");
  if (selection?.projectId === projectId && selection.kind === "calculationResult") {
    const result = context.resources.find((r) => r.entity_type === "calculation.result" && r.entity_id === selection.id);
    if (!result || result.calculation_id !== selection.sourceId || !result.structure_version_id || result.structure_version_id !== context.selection.selected_structure_version_id) {
      throw new Error("AI result context has an inconsistent calculation or source version.");
    }
  }
  return context;
}

export function selectedConformerContext(context: ProductContext | null): boolean {
  return Boolean(context?.selection.selected_result_id && context.resources.some((r) => r.entity_id === context.selection.selected_result_id && r.label === "chemdft.conformer-ensemble"));
}

/** The body of one AI run request. The ids a page published travel with it (0.0.20), not only with /ai/context. */
export function aiRunPayload(
  content: string,
  mode: "STANDARD" | "EVIDENCE" | "CHAT",
  planningProfile: string,
  hints: ProductSelection,
  runLimits?: unknown,
): Record<string, unknown> {
  return { content, mode, planning_profile: planningProfile, ...hints, ...(runLimits ? { run_limits: runLimits } : {}) };
}
