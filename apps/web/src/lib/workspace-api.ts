export type WorkspaceFile = {
  id: string;
  project_id: string;
  original_name: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  provenance_class: string;
  created_at: string;
};

export type WorkspaceHistoryEvent = {
  id: string;
  project_id: string;
  event_name: string;
  label: string;
  occurred_at: string;
  outcome: string;
  target_kind: string | null;
  target_id: string | null;
  source_id: string | null;
};

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(`${API_ROOT}${url}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Project inventory request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export function listWorkspaceFiles(projectId: string): Promise<WorkspaceFile[]> {
  return getJson(`/v1/projects/${projectId}/files`);
}

export function listWorkspaceHistory(projectId: string): Promise<WorkspaceHistoryEvent[]> {
  return getJson(`/v1/projects/${projectId}/workspace/history`);
}
