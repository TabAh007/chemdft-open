/** One source-bound navigation identity shared by the tree, canvas, tabs and URL. */
export type WorkspaceSelection =
  | { kind: "file" | "document" | "structureCandidate" | "geometryCandidate" | "experimentalDataset" | "experimentalSpectrum" | "calculation" | "externalImport" | "note" | "historyEvent"; id: string; projectId: string; locator?: WorkspaceLocator }
  | { kind: "documentEvidence" | "candidateRepresentation" | "structureVersion" | "optimizedStructureVersion" | "scientificScene" | "calculationResult" | "optimizationTrajectory" | "importedResult"; id: string; projectId: string; sourceId: string; locator?: WorkspaceLocator };

export type WorkspaceLocator = { page?: number; anchorId?: string; section?: string };
export type WorkspaceTab = { selection: WorkspaceSelection; label: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = new Set<WorkspaceSelection["kind"]>([
  "file", "document", "documentEvidence", "structureCandidate", "geometryCandidate", "candidateRepresentation",
  "structureVersion", "optimizedStructureVersion", "scientificScene", "experimentalDataset", "experimentalSpectrum", "calculation", "calculationResult", "optimizationTrajectory", "externalImport", "importedResult", "note", "historyEvent",
]);
const sourceKinds = new Set<WorkspaceSelection["kind"]>([
  "documentEvidence", "candidateRepresentation", "structureVersion", "optimizedStructureVersion", "scientificScene", "calculationResult", "optimizationTrajectory", "importedResult",
]);

export function selectionKey(selection: WorkspaceSelection): string {
  return `${selection.kind}:${selection.id}`;
}

export function validSelection(value: unknown, projectId: string): value is WorkspaceSelection {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.projectId !== projectId || typeof item.kind !== "string" || !kinds.has(item.kind as WorkspaceSelection["kind"])) return false;
  if (typeof item.id !== "string" || !uuid.test(item.id)) return false;
  if (sourceKinds.has(item.kind as WorkspaceSelection["kind"]) && (typeof item.sourceId !== "string" || !uuid.test(item.sourceId))) return false;
  if (item.locator !== undefined) {
    if (!item.locator || typeof item.locator !== "object") return false;
    const locator = item.locator as Record<string, unknown>;
    if (locator.page !== undefined && (!Number.isInteger(locator.page) || Number(locator.page) < 1 || Number(locator.page) > 100000)) return false;
    if (locator.anchorId !== undefined && (typeof locator.anchorId !== "string" || !uuid.test(locator.anchorId))) return false;
    if (locator.section !== undefined && (typeof locator.section !== "string" || locator.section.length > 200)) return false;
  }
  return true;
}

export function parseWorkspaceSelection(search: string, projectId: string): WorkspaceSelection | null {
  const params = new URLSearchParams(search);
  const token = params.get("selection");
  if (!token) return null;
  const split = token.indexOf(":");
  if (split < 1) return null;
  const kind = token.slice(0, split);
  const id = token.slice(split + 1);
  const sourceId = params.get("source") ?? undefined;
  const pageText = params.get("page");
  const page = pageText === null ? undefined : Number(pageText);
  const anchorId = params.get("anchor") ?? undefined;
  const section = params.get("section") ?? undefined;
  const locator = page !== undefined || anchorId || section ? { page, anchorId, section } : undefined;
  const candidate = { kind, id, projectId, ...(sourceId ? { sourceId } : {}), ...(locator ? { locator } : {}) };
  return validSelection(candidate, projectId) ? candidate : null;
}

export function workspaceSelectionUrl(currentUrl: string, selection: WorkspaceSelection | null): string {
  const url = new URL(currentUrl);
  for (const key of ["selection", "source", "page", "anchor", "section"]) url.searchParams.delete(key);
  if (selection) {
    url.searchParams.set("selection", selectionKey(selection));
    if ("sourceId" in selection) url.searchParams.set("source", selection.sourceId);
    if (selection.locator?.page) url.searchParams.set("page", String(selection.locator.page));
    if (selection.locator?.anchorId) url.searchParams.set("anchor", selection.locator.anchorId);
    if (selection.locator?.section) url.searchParams.set("section", selection.locator.section);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
