import type { KnowledgeIndexStatus, KnowledgeSearchInput, KnowledgeSearchOutput, ProjectMemoryListOutput } from "@chemdft/schemas";

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

export async function searchKnowledge(
  projectId: string,
  payload: KnowledgeSearchInput,
): Promise<KnowledgeSearchOutput> {
  const response = await fetch(`${API_ROOT}/v1/projects/${projectId}/knowledge/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson(response);
}

export async function getKnowledgeStatus(projectId: string): Promise<KnowledgeIndexStatus> {
  const response = await fetch(`${API_ROOT}/v1/projects/${projectId}/knowledge/status`, {
    cache: "no-store",
  });
  return readJson(response);
}

export async function listProjectMemory(projectId: string): Promise<ProjectMemoryListOutput> {
  const response = await fetch(`${API_ROOT}/v1/projects/${projectId}/memory`, { cache: "no-store" });
  return readJson(response);
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `ChemDFT API request failed with ${response.status}`;
    try {
      detail = ((await response.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // The response may not be JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}
