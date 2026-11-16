const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

export type ProjectRead = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  role: string;
  created_at: string;
  updated_at: string;
};

export class ProjectApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ProjectApiError";
  }
}

type ApiErrorPayload = {
  detail?: string | { msg?: string }[];
};

export async function listProjects(): Promise<ProjectRead[]> {
  return apiJson<ProjectRead[]>("/v1/projects");
}

export async function getProject(projectId: string): Promise<ProjectRead> {
  return apiJson<ProjectRead>(`/v1/projects/${projectId}`);
}

export async function createProject(payload: { name: string; slug: string }): Promise<ProjectRead> {
  const response = await fetch(apiUrl("/v1/projects"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<ProjectRead>(response);
}

/** Name only; the address (slug) never changes. Writers and owners only. */
export async function renameProject(projectId: string, name: string): Promise<ProjectRead> {
  const response = await fetch(apiUrl(`/v1/projects/${projectId}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return readJson<ProjectRead>(response);
}

async function apiJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { cache: "no-store" });
  return readJson<T>(response);
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<T>;
}

async function apiError(response: Response): Promise<Error> {
  let payload: ApiErrorPayload = {};
  try {
    payload = await response.json() as ApiErrorPayload;
  } catch {
    payload = {};
  }
  if (Array.isArray(payload.detail)) {
    const message = payload.detail.map((item) => item.msg).filter(Boolean).join("; ");
    if (message) return new ProjectApiError(response.status, message);
  }
  if (typeof payload.detail === "string") return new ProjectApiError(response.status, payload.detail);
  if (response.status === 401) return new ProjectApiError(response.status, "Development identity is not enabled for this web session.");
  if (response.status === 403) return new ProjectApiError(response.status, "Authorization failed for the current development identity.");
  if (response.status === 409) return new ProjectApiError(response.status, "Project slug already exists in this organization.");
  return new ProjectApiError(response.status, `ChemDFT API request failed with ${response.status}`);
}

function apiUrl(path: string): string {
  return `${API_ROOT}${path}`;
}
