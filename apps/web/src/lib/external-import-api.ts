import type {
  ExternalImportDetail,
  ExternalImportListOutput,
  ExternalImportView,
  ImportedResultView,
} from "@chemdft/schemas";

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

type ApiErrorPayload = { detail?: string | { message?: string; code?: string } };

/** Upload one plain-text Gaussian/ORCA output. The server returns a hash-bound PREVIEW only. */
export async function uploadExternalImport(params: {
  projectId: string;
  file: File;
}): Promise<ExternalImportView> {
  const form = new FormData();
  form.set("upload", params.file);
  form.set("idempotency_key", `web-external-import-${crypto.randomUUID()}`);
  const response = await fetch(apiUrl(`/v1/projects/${params.projectId}/external-imports`), {
    method: "POST",
    body: form,
  });
  return readJson<ExternalImportView>(response);
}

export async function listExternalImports(projectId: string): Promise<ExternalImportListOutput> {
  const response = await fetch(apiUrl(`/v1/projects/${projectId}/external-imports`), { cache: "no-store" });
  // An API build without external-import support has nothing to list; every other failure still surfaces.
  if (response.status === 404 && (await response.clone().json().catch(() => ({})) as ApiErrorPayload).detail === "Not Found") {
    return { imports: [] };
  }
  return readJson<ExternalImportListOutput>(response);
}

export async function getExternalImport(params: {
  projectId: string;
  importId: string;
}): Promise<ExternalImportDetail> {
  return apiJson<ExternalImportDetail>(
    `/v1/projects/${params.projectId}/external-imports/${params.importId}`,
  );
}

/** Confirm the exact preview the user saw: the server rejects a stale hash or a changed source. */
export async function confirmExternalImport(params: {
  projectId: string;
  importId: string;
  previewSha256: string;
}): Promise<ExternalImportDetail> {
  const response = await fetch(
    apiUrl(`/v1/projects/${params.projectId}/external-imports/${params.importId}/confirm`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preview_sha256: params.previewSha256,
        idempotency_key: `web-external-import-confirm-${crypto.randomUUID()}`,
      }),
    },
  );
  return readJson<ExternalImportDetail>(response);
}

export async function getImportedResult(params: {
  projectId: string;
  resultId: string;
}): Promise<ImportedResultView> {
  return apiJson<ImportedResultView>(
    `/v1/projects/${params.projectId}/imported-results/${params.resultId}`,
  );
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
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    payload = {};
  }
  const detail = payload.detail;
  const message = typeof detail === "string" ? detail : detail?.message;
  return new Error(message ?? `ChemDFT API request failed with ${response.status}`);
}

function apiUrl(path: string): string {
  return `${API_ROOT}${path}`;
}
