import type {
  CalculationDetail,
  CalculationResult,
  Dftd4Capability,
  Dftd4RetryInput,
  CalculationSubmitInput,
  ComputeJobListOutput,
  EngineCapabilityView,
  GeometryCandidateAcceptInput,
  GeometryCandidateAcceptOutput,
  GeometryCandidateListOutput,
  GeometryCandidateView,
  GeometryEligibility,
  MolecularDrawingGenerateInput,
  MolecularOrbitalGridOutput,
  MolecularOrbitalGridRequest,
  VolumetricFieldOutput,
  VolumetricFieldRequest,
  StructureImportOutput,
  StructureSummary,
  StructureVersionCreateOutput,
  StructureVersionDetail,
} from "@chemdft/schemas";
import { readAttachment } from "./download";

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

type ApiErrorPayload = {
  detail?: string | Array<{ msg?: string; [key: string]: unknown }> | Record<string, unknown>;
};

export async function listStructures(projectId: string): Promise<StructureSummary[]> {
  return apiJson<StructureSummary[]>(`/v1/projects/${projectId}/structures`);
}

export async function listStructureVersions(
  projectId: string,
  structureId: string,
): Promise<StructureVersionDetail[]> {
  return apiJson<StructureVersionDetail[]>(
    `/v1/projects/${projectId}/structures/${structureId}/versions`,
  );
}

export async function getStructureVersion(params: {
  projectId: string;
  structureId: string;
  versionId: string;
}): Promise<StructureVersionDetail> {
  return apiJson<StructureVersionDetail>(
    `/v1/projects/${params.projectId}/structures/${params.structureId}/versions/${params.versionId}`,
  );
}

export async function getMolecularOrbitalGrid(params: {
  projectId: string;
  calculationId: string;
  request: MolecularOrbitalGridRequest;
}): Promise<MolecularOrbitalGridOutput> {
  const response = await fetch(apiUrl(
    `/v1/projects/${params.projectId}/calculations/${params.calculationId}/orbitals/grid`,
  ), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params.request),
  });
  return readJson<MolecularOrbitalGridOutput>(response);
}

export async function getVolumetricFieldGrid(params: {
  projectId: string; calculationId: string; request: VolumetricFieldRequest;
}): Promise<VolumetricFieldOutput> {
  const response = await fetch(apiUrl(
    `/v1/projects/${params.projectId}/calculations/${params.calculationId}/fields/grid`,
  ), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params.request) });
  return readJson<VolumetricFieldOutput>(response);
}

export async function importStructure(params: {
  projectId: string;
  file: File;
  fileFormat: string;
  structureName?: string;
}): Promise<StructureImportOutput> {
  const form = new FormData();
  form.set("upload", params.file);
  form.set("file_format", params.fileFormat);
  form.set("idempotency_key", `web-import-${crypto.randomUUID()}`);
  if (params.structureName) form.set("structure_name", params.structureName);
  const response = await fetch(apiUrl(`/v1/projects/${params.projectId}/structures/imports`), {
    method: "POST",
    body: form,
  });
  return readJson<StructureImportOutput>(response);
}

export async function createStructureVersionFromMol(params: {
  projectId: string;
  structureId: string;
  parentVersionId: string;
  molfile: string;
}): Promise<StructureVersionCreateOutput> {
  const form = new FormData();
  form.set("upload", new File([params.molfile], "ketcher-edit.mol", { type: "chemical/x-mdl-molfile" }));
  form.set("file_format", "MOL");
  form.set("parent_version_id", params.parentVersionId);
  form.set("idempotency_key", `web-ketcher-${crypto.randomUUID()}`);
  const response = await fetch(
    apiUrl(`/v1/projects/${params.projectId}/structures/${params.structureId}/versions/imports`),
    {
      method: "POST",
      body: form,
    },
  );
  return readJson<StructureVersionCreateOutput>(response);
}

/** Release 0.0.45: save the relaxed positions of a Quantum ESPRESSO result as a new structure version (idempotent on the server). */
export async function createRelaxedStructureVersion(params: {
  projectId: string;
  calculationId: string;
}): Promise<StructureVersionCreateOutput> {
  const response = await fetch(
    apiUrl(`/v1/projects/${params.projectId}/calculations/${params.calculationId}/relaxed-structure-version`),
    { method: "POST" },
  );
  return readJson<StructureVersionCreateOutput>(response);
}

export async function exportStructureVersion(params: {
  projectId: string;
  structureId: string;
  versionId: string;
  fileFormat: string;
}): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(
    apiUrl(
      `/v1/projects/${params.projectId}/structures/${params.structureId}/versions/${params.versionId}/export?file_format=${encodeURIComponent(params.fileFormat)}`,
    ),
  );
  return readAttachment(response, `structure.${params.fileFormat.toLowerCase()}`, apiError);
}

export async function listCalculationCapabilities(
  projectId: string,
): Promise<EngineCapabilityView[]> {
  const capabilities: unknown = await apiJson<unknown>(`/v1/projects/${projectId}/calculations/capabilities`);
  // A reply that is not a list (an older server, a proxy error page) must not reach code that calls `.find` on it.
  if (!Array.isArray(capabilities)) throw new Error("Engine capabilities unavailable: the server sent an unexpected reply.");
  return capabilities as EngineCapabilityView[];
}

export async function submitCalculation(
  projectId: string,
  payload: CalculationSubmitInput,
): Promise<CalculationDetail> {
  const response = await fetch(apiUrl(`/v1/projects/${projectId}/calculations`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<CalculationDetail>(response);
}

export async function getCalculation(params: {
  projectId: string;
  calculationId: string;
}): Promise<CalculationDetail> {
  return apiJson<CalculationDetail>(
    `/v1/projects/${params.projectId}/calculations/${params.calculationId}`,
  );
}

export async function cancelCalculation(params: {
  projectId: string;
  calculationId: string;
}): Promise<CalculationDetail> {
  const response = await fetch(
    apiUrl(`/v1/projects/${params.projectId}/calculations/${params.calculationId}/cancel`),
    { method: "POST" },
  );
  return readJson<CalculationDetail>(response);
}

export async function listComputeJobs(projectId: string): Promise<ComputeJobListOutput> {
  return apiJson<ComputeJobListOutput>(`/v1/projects/${projectId}/compute/jobs`);
}

/** Optional paging and filters (0.0.18); an older server ignores `search` and answers with every job and no `total`. */
export async function listComputeJobsPage(projectId: string, search: string): Promise<ComputeJobListOutput> {
  return apiJson<ComputeJobListOutput>(`/v1/projects/${projectId}/compute/jobs${search}`);
}

/** One published result with its read-time `effective_state` (never cached by the API). */
export async function getResult(projectId: string, resultId: string): Promise<CalculationResult> {
  return apiJson<CalculationResult>(`/v1/projects/${projectId}/results/${resultId}`);
}

/** Historical lineage export for one result (`chemdft.result-lineage-export.v1`); read-only and project-scoped. */
export async function getResultProvenance(projectId: string, resultId: string): Promise<unknown> {
  return apiJson<unknown>(`/v1/projects/${projectId}/results/${resultId}/provenance`);
}

export function resultLineageExportUrl(projectId: string, resultId: string): string {
  return apiUrl(`/v1/projects/${projectId}/results/${resultId}/export`);
}

export async function downloadCalculationArtifact(params: {
  projectId: string;
  calculationId: string;
  artifactId: string;
}): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(apiUrl(
    `/v1/projects/${params.projectId}/calculations/${params.calculationId}/artifacts/${params.artifactId}`,
  ));
  return readAttachment(response, "calculation-artifact.log", apiError);
}

export async function generateGeometryCandidate(params: {
  projectId: string;
  payload: MolecularDrawingGenerateInput;
}): Promise<GeometryCandidateView> {
  const response = await fetch(apiUrl(`/v1/projects/${params.projectId}/geometry-candidates`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params.payload),
  });
  return readJson<GeometryCandidateView>(response);
}

export async function listGeometryCandidates(
  projectId: string,
): Promise<GeometryCandidateListOutput> {
  return apiJson<GeometryCandidateListOutput>(`/v1/projects/${projectId}/geometry-candidates`);
}

export async function getGeometryCandidate(params: {
  projectId: string;
  candidateId: string;
}): Promise<GeometryCandidateView> {
  return apiJson<GeometryCandidateView>(
    `/v1/projects/${params.projectId}/geometry-candidates/${params.candidateId}`,
  );
}

export async function getGeometryCandidateDrawing(params: {
  projectId: string;
  candidateId: string;
}): Promise<string> {
  const response = await fetch(
    apiUrl(`/v1/projects/${params.projectId}/geometry-candidates/${params.candidateId}/drawing`),
  );
  if (!response.ok) throw await apiError(response);
  return response.text();
}

export async function acceptGeometryCandidate(params: {
  projectId: string;
  candidateId: string;
  payload: GeometryCandidateAcceptInput;
}): Promise<GeometryCandidateAcceptOutput> {
  const response = await fetch(
    apiUrl(`/v1/projects/${params.projectId}/geometry-candidates/${params.candidateId}/accept`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params.payload),
    },
  );
  return readJson<GeometryCandidateAcceptOutput>(response);
}

export async function getCalculationEligibility(params: {
  projectId: string;
  structureId: string;
  versionId: string;
}): Promise<GeometryEligibility> {
  return apiJson<GeometryEligibility>(
    `/v1/projects/${params.projectId}/structures/${params.structureId}/versions/${params.versionId}/calculation-eligibility`,
  );
}

export async function apiJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { cache: "no-store" });
  return readJson<T>(response);
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<T>;
}

export async function apiError(response: Response): Promise<Error> {
  let payload: ApiErrorPayload = {};
  try {
    payload = await response.json() as ApiErrorPayload;
  } catch {
    payload = {};
  }
  let message = "";
  if (typeof payload.detail === "string") {
    message = payload.detail;
  } else if (Array.isArray(payload.detail)) {
    message = payload.detail
      .map((item) => (typeof item === "object" && item && "msg" in item ? String(item.msg) : JSON.stringify(item)))
      .join("; ");
  } else if (payload.detail && typeof payload.detail === "object") {
    message = "message" in payload.detail && typeof payload.detail.message === "string"
      ? `${"code" in payload.detail ? `${String(payload.detail.code)}: ` : ""}${payload.detail.message}`
      : JSON.stringify(payload.detail);
  } else {
    message = `ChemDFT API request failed with ${response.status}`;
  }
  if (response.status === 404 && /project not found/i.test(message)) {
    return new Error("This project is no longer available.");
  }
  return new Error(message);
}

export function apiUrl(path: string): string {
  return `${API_ROOT}${path}`;
}
export async function getDftd4Capability(projectId: string, sourceResultId: string): Promise<Dftd4Capability> {
  return apiJson<Dftd4Capability>(`/v1/projects/${projectId}/dispersion-corrections/capability?source_result_id=${encodeURIComponent(sourceResultId)}`);
}

export async function submitDftd4Correction(projectId: string, sourceResultId: string): Promise<CalculationDetail> {
  const response = await fetch(apiUrl(`/v1/projects/${projectId}/dispersion-corrections`), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ source_result_id: sourceResultId, variant: "d4.bj-eeq-atm", idempotency_key: crypto.randomUUID() }),
  });
  return readJson<CalculationDetail>(response);
}

export async function retryDftd4Correction(projectId: string, calculationId: string, command: Dftd4RetryInput): Promise<CalculationDetail> {
  const response = await fetch(apiUrl(`/v1/projects/${projectId}/dispersion-corrections/${calculationId}/retry`), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  return readJson<CalculationDetail>(response);
}
