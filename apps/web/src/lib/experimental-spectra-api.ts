import type {
  CalculatedSourceListOutput,
  SpectrumArraysView,
  SpectrumAssociationInput,
  SpectrumAssociationView,
  SpectrumChoices,
  SpectrumComparisonInput,
  SpectrumComparisonListOutput,
  SpectrumComparisonView,
  SpectrumDatasetListOutput,
  SpectrumDatasetView,
  SpectrumPeakParameters,
  SpectrumTechnique,
  SpectrumTransformInput,
  SpectrumUploadView,
} from "@chemdft/schemas";

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";
const base = (projectId: string) => `/v1/projects/${projectId}/experimental/spectra`;

type ApiErrorPayload = { detail?: string | { message?: string; code?: string } | Array<{ msg?: string }> };

/** Upload one plain-text spectrum. The server returns a hash-bound PREVIEW only: no experiment, dataset or spectrum is created. */
export async function uploadSpectrum(params: { projectId: string; file: File; technique: SpectrumTechnique }): Promise<SpectrumUploadView> {
  const form = new FormData();
  form.set("upload", params.file);
  form.set("technique", params.technique);
  form.set("idempotency_key", `web-spectrum-upload-${crypto.randomUUID()}`);
  return readJson(await fetch(apiUrl(`${base(params.projectId)}/uploads`), { method: "POST", body: form }));
}

/** Re-run the deterministic parser on the stored bytes with the user's unit / column choices; returns a new preview. */
export async function resolveSpectrum(params: { projectId: string; uploadId: string; choices: SpectrumChoices }): Promise<SpectrumUploadView> {
  return postJson(`${base(params.projectId)}/uploads/${params.uploadId}/resolve`, { choices: params.choices });
}

/** Confirm the exact preview the user saw; the server rejects a stale hash, a changed source or an unconfirmed unit. */
export async function confirmSpectrum(params: {
  projectId: string;
  uploadId: string;
  previewSha256: string;
  association?: SpectrumAssociationInput;
}): Promise<SpectrumDatasetView> {
  return postJson(`${base(params.projectId)}/uploads/${params.uploadId}/confirm`, {
    preview_sha256: params.previewSha256,
    idempotency_key: `web-spectrum-confirm-${crypto.randomUUID()}`,
    ...(params.association ? { association: params.association } : {}),
  });
}

export async function listSpectrumDatasets(projectId: string): Promise<SpectrumDatasetListOutput> {
  const response = await fetch(apiUrl(`${base(projectId)}/datasets`), { cache: "no-store" });
  // An API build without experimental-spectra support has nothing to list; every other failure still surfaces.
  if (response.status === 404 && (await response.clone().json().catch(() => ({})) as ApiErrorPayload).detail === "Not Found") {
    return { datasets: [] };
  }
  return readJson(response);
}

export async function getSpectrumDataset(params: { projectId: string; datasetId: string }): Promise<SpectrumDatasetView> {
  return getJson(`${base(params.projectId)}/datasets/${params.datasetId}`);
}

export async function getSpectrumArrays(params: { projectId: string; datasetId: string; maxPoints?: number }): Promise<SpectrumArraysView> {
  const query = params.maxPoints ? `?max_points=${params.maxPoints}` : "";
  return getJson(`${base(params.projectId)}/datasets/${params.datasetId}/arrays${query}`);
}

/** User-triggered transform: always a NEW derived dataset; the parent is never changed. */
export async function createSpectrumTransform(params: { projectId: string; datasetId: string; input: Omit<SpectrumTransformInput, "idempotency_key"> }): Promise<SpectrumDatasetView> {
  return postJson(`${base(params.projectId)}/datasets/${params.datasetId}/transforms`, { ...params.input, idempotency_key: `web-spectrum-transform-${crypto.randomUUID()}` });
}

export async function createSpectrumPeaks(params: { projectId: string; datasetId: string; parameters: SpectrumPeakParameters }): Promise<SpectrumDatasetView> {
  return postJson(`${base(params.projectId)}/datasets/${params.datasetId}/peaks`, { parameters: params.parameters, idempotency_key: `web-spectrum-peaks-${crypto.randomUUID()}` });
}

export async function setSpectrumAssociation(params: { projectId: string; datasetId: string; association: SpectrumAssociationInput }): Promise<SpectrumAssociationView> {
  const response = await fetch(apiUrl(`${base(params.projectId)}/datasets/${params.datasetId}/association`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params.association),
  });
  return readJson(response);
}

export async function listComparisonSources(params: { projectId: string; technique: SpectrumTechnique }): Promise<CalculatedSourceListOutput> {
  return getJson(`${base(params.projectId)}/comparison-sources?technique=${params.technique}`);
}

export async function createSpectrumComparison(params: { projectId: string; input: Omit<SpectrumComparisonInput, "idempotency_key"> }): Promise<SpectrumComparisonView> {
  return postJson(`${base(params.projectId)}/comparisons`, { ...params.input, idempotency_key: `web-spectrum-compare-${crypto.randomUUID()}` });
}

export async function listSpectrumComparisons(params: { projectId: string; experimentalDatasetId?: string }): Promise<SpectrumComparisonListOutput> {
  const query = params.experimentalDatasetId ? `?experimental_dataset_id=${params.experimentalDatasetId}` : "";
  return getJson(`${base(params.projectId)}/comparisons${query}`);
}

async function getJson<T>(path: string): Promise<T> {
  return readJson<T>(await fetch(apiUrl(path), { cache: "no-store" }));
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
  const message = typeof detail === "string"
    ? detail
    : Array.isArray(detail)
      ? detail.map((item) => item.msg).filter(Boolean).join("; ")
      : detail?.message;
  return new Error(message || `ChemDFT API request failed with ${response.status}`);
}

function apiUrl(path: string): string {
  return `${API_ROOT}${path}`;
}
