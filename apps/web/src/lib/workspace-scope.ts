/**
 * Release 0.0.25 follow-up: the AI Scientist's workspace scope must always describe the CURRENT page.
 * Root cause of the stale-context bug (an IR mode still shown on Calculation setup): the dock merged every
 * announcement into the previous scope, and only `resultId` / `calculationId` were dropped when absent, so the
 * IR mode fields (`selectedMode*`) and the `selectionName` of the previous page survived a navigation.
 */
export interface ScopeShape {
  projectName?: string | undefined;
  structureName?: string | undefined;
  structureVersionRevision?: number | undefined;
  documentName?: string | undefined;
  datasetName?: string | undefined;
  selectionName?: string | undefined;
  currentView?: string | undefined;
  calculationId?: string | undefined;
  resultId?: string | undefined;
  selectedModeIndex?: number | undefined;
  selectedModeFrequency?: number | undefined;
  selectedModeIntensity?: number | undefined;
}

/** Fields that belong to the page's selection (result, mode, record); they never carry over to another announcement. */
const PAGE_BOUND: readonly (keyof ScopeShape)[] = [
  "calculationId", "resultId", "selectedModeIndex", "selectedModeFrequency", "selectedModeIntensity", "selectionName",
];

/** Merge one announcement into the scope: the project, structure and document names persist; the result, mode and selection fields are replaced. */
export function mergeWorkspaceScope<T extends ScopeShape>(previous: T, announcement: Partial<T> & Record<string, unknown>): T {
  const next: Record<string, unknown> = { ...previous, ...announcement };
  for (const key of PAGE_BOUND) if (!(key in announcement) || announcement[key] === undefined) delete next[key];
  return next as T;
}
