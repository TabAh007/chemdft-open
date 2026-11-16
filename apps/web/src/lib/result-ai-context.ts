/**
 * Release 0.0.25: "Ask AI about this result". Selects the result as the AI Scientist's context (the same
 * `chemdft:workspace-selection` event the result views already publish, so the 0.0.20 selected-record grounding
 * applies) and opens the AI panel. It sends nothing to a model: the researcher still types the question.
 */
export interface ResultAiTarget {
  projectId: string;
  calculationId: string;
  resultId: string;
  /** What the researcher is looking at, for example "IR spectrum" or "Total energy". */
  label?: string | undefined;
}

export function resultSelectionDetail(target: ResultAiTarget): Record<string, unknown> {
  return {
    projectId: target.projectId,
    calculationId: target.calculationId,
    resultId: target.resultId,
    currentView: target.label ? `${target.label} (selected result)` : "Selected scientific result",
  };
}

export function askAiAboutResult(target: ResultAiTarget): void {
  window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", { detail: resultSelectionDetail(target) }));
  window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"));
}
