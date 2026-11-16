import type {
  CandidateCoordinatePasteInput,
  CandidateRepresentationCreateInput,
  CandidateRepresentationCreateOutput,
  CandidateRepresentationDetail,
  CandidateRepresentationListOutput,
  CandidateRepresentationReviewOutput,
  CandidateRepresentationReviewChecklist,
  CandidateRepresentationReviewInput,
  MolecularGraphValidateInput,
  MolecularGraphValidateOutput,
  ConformerGenerationInput,
  DigitizedDatasetInput,
  EvidenceReviewInput,
  EvidenceReviewOutput,
  ExperimentalDatasetListOutput,
  ExperimentalDatasetView,
  ScientificDocumentImportOutput,
  ScientificDocumentListOutput,
  StructureCandidate,
  StructureCandidateListOutput,
  StructureCandidateReviewOutput,
  StructureCandidatePromotionOutput,
  XrdDigitizedDatasetInput,
  GraphDigitizedDatasetInput,
  ProjectScientificClaimsOutput,
  ProjectScientificComparisonOutput,
} from "@chemdft/schemas";

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

export async function listDocuments(projectId: string): Promise<ScientificDocumentListOutput> {
  return apiJson(`/v1/projects/${projectId}/documents`);
}

// The website host rejects request bodies above 4.5 MB, so larger PDFs go straight to the API with a
// short-lived upload ticket (see services/api direct_upload.py). Small files keep the normal path.
export const DIRECT_UPLOAD_THRESHOLD_BYTES = 4_000_000;

type UploadTicket = { ticket: string; upload_url: string; expires_at: number; max_bytes: number };

export async function importDocument(projectId: string, file: File): Promise<ScientificDocumentImportOutput> {
  const form = new FormData();
  form.set("upload", file);
  if (file.size <= DIRECT_UPLOAD_THRESHOLD_BYTES) {
    return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/documents/imports`, { method: "POST", body: form }));
  }
  let ticket: UploadTicket;
  try {
    ticket = await readJson<UploadTicket>(await fetch(`${API_ROOT}/v1/projects/${projectId}/documents/upload-tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, size_bytes: file.size }),
    }));
  } catch (error) {
    if (error instanceof CandidateApiError && error.status === 503) {
      throw new Error("Large PDF upload is not enabled on this server yet. Use a PDF under 4 MB or ask the administrator to enable direct upload.");
    }
    if (error instanceof CandidateApiError && error.status === 413) {
      throw new Error(`This PDF is larger than the server limit of ${Math.round(file.size / 1_000_000)} MB allows. Try a smaller file.`);
    }
    throw error;
  }
  let response: Response;
  try {
    response = await fetch(ticket.upload_url, { method: "POST", headers: { "X-ChemDFT-Upload-Ticket": ticket.ticket }, body: form });
  } catch {
    throw new Error("The large PDF could not be sent to the server. Check your connection and try again.");
  }
  return readJson(response);
}

export async function getDocument(projectId: string, documentId: string): Promise<ScientificDocumentImportOutput> {
  return apiJson(`/v1/projects/${projectId}/documents/${documentId}`);
}

export function documentSourceUrl(projectId: string, documentId: string): string {
  return `${API_ROOT}/v1/projects/${projectId}/documents/${documentId}/source`;
}

export async function reviewEvidence(projectId: string, candidateId: string, payload: EvidenceReviewInput): Promise<EvidenceReviewOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/evidence/${candidateId}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
}

export async function createDigitizedDataset(projectId: string, candidateId: string, payload: DigitizedDatasetInput): Promise<ExperimentalDatasetView> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/evidence/${candidateId}/digitized-datasets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
}

export async function createXrdDigitizedDataset(
  projectId: string,
  evidenceId: string,
  payload: XrdDigitizedDatasetInput,
): Promise<ExperimentalDatasetView> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/evidence/${evidenceId}/xrd-digitizations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function createGraphDigitizedDataset(
  projectId: string,
  evidenceId: string,
  payload: GraphDigitizedDatasetInput,
): Promise<ExperimentalDatasetView> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/evidence/${evidenceId}/graph-digitizations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function listExperimentalDatasets(projectId: string): Promise<ExperimentalDatasetListOutput> {
  return apiJson(`/v1/projects/${projectId}/experimental/datasets`);
}

export async function listScientificClaims(
  projectId: string,
  locale: string,
): Promise<ProjectScientificClaimsOutput> {
  return apiJson(`/v1/projects/${projectId}/scientific-claims?locale=${encodeURIComponent(locale)}`);
}

export async function addManualScientificClaim(
  projectId: string,
  input: {
    document_id: string;
    system: string;
    quantity: string;
    value: number;
    unit: string;
    page: number;
    quote: string;
    quantity_key?: string | null;
  },
): Promise<{ evidence_id: string }> {
  return apiJson(`/v1/projects/${projectId}/scientific-claims/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getScientificComparison(
  projectId: string,
  locale: string,
): Promise<ProjectScientificComparisonOutput> {
  return apiJson(`/v1/projects/${projectId}/scientific-comparison?locale=${encodeURIComponent(locale)}`);
}

export async function listStructureCandidates(projectId: string): Promise<StructureCandidateListOutput> {
  return apiJson(`/v1/projects/${projectId}/structure-candidates`);
}

export interface CandidateRecognitionProposalView {
  source_document_id: string | null;
  source_document_sha256: string | null;
  source_page_number: number | null;
  source_figure_number: string | null;
  source_figure_anchor_id: string | null;
  figure_sha256: string;
  figure_region: [number, number, number, number];
  recognition_engine: string;
  engine_version: string;
  raw_model_output: string | null;
  proposed_smiles: string | null;
  canonical_isomeric_smiles: string | null;
  formula: string | null;
  formal_charge: number | null;
  heavy_atom_count: number | null;
  elements: string[];
  has_stereochemistry: boolean;
  confidence: number | null;
  status: string;
  is_scientifically_verified: boolean;
  validation_warnings: string[];
  diagnostics: string[];
  unresolved_ambiguities: string[];
  runtime_ms: number;
}

export interface CandidateRecognitionOutput {
  candidate: StructureCandidate;
  proposal: CandidateRecognitionProposalView;
}

export async function extractDocumentFigures(
  projectId: string,
  documentId: string,
): Promise<StructureCandidateListOutput> {
  return readJson(
    await fetch(`${API_ROOT}/v1/projects/${projectId}/documents/${documentId}/figures/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
  );
}

export async function recognizeCandidateFigure(
  projectId: string,
  candidateId: string,
  payload?: { engine?: string; category_hint?: string },
): Promise<CandidateRecognitionOutput> {
  return readJson(
    await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/recognize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    })
  );
}

export function getCandidateFigureUrl(projectId: string, candidateId: string): string {
  return `${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/figure`;
}

export async function reviewStructureCandidate(projectId: string, candidateId: string): Promise<StructureCandidateReviewOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }));
}

export async function rejectStructureCandidate(projectId: string, candidateId: string): Promise<StructureCandidateReviewOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }));
}

export async function listCandidateRepresentations(projectId: string, candidateId: string): Promise<CandidateRepresentationListOutput> {
  return apiJson(`/v1/projects/${projectId}/structure-candidates/${candidateId}/representations`);
}

export async function getCandidateRepresentation(projectId: string, candidateId: string, representationId: string): Promise<CandidateRepresentationDetail> {
  return apiJson(`/v1/projects/${projectId}/structure-candidates/${candidateId}/representations/${representationId}`);
}

export async function createCandidateRepresentation(projectId: string, candidateId: string, payload: CandidateRepresentationCreateInput): Promise<CandidateRepresentationCreateOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/representations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function validateCandidateGraph(projectId: string, candidateId: string, payload: MolecularGraphValidateInput): Promise<MolecularGraphValidateOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/validate-graph`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }));
}

export async function generateCandidateConformer(projectId: string, candidateId: string, representationId: string, payload: ConformerGenerationInput): Promise<CandidateRepresentationCreateOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/representations/${representationId}/generate-conformer`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }));
}

export async function pasteCandidateCoordinates(projectId: string, candidateId: string, payload: CandidateCoordinatePasteInput): Promise<CandidateRepresentationCreateOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/representations/paste`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function importCandidateCoordinates(params: {
  projectId: string;
  candidateId: string;
  file: File;
  fileFormat: "XYZ" | "MOL" | "SDF" | "CIF";
  coordinateUnit: "angstrom" | "bohr";
  coordinateOrigin: "USER_IMPORTED_FILE" | "USER_CREATED" | "USER_EDITED";
  name?: string;
  parentRepresentationId?: string;
}): Promise<CandidateRepresentationCreateOutput> {
  const form = new FormData();
  form.set("upload", params.file);
  form.set("file_format", params.fileFormat);
  form.set("coordinate_unit", params.coordinateUnit);
  form.set("coordinate_origin", params.coordinateOrigin);
  if (params.name) form.set("name", params.name);
  if (params.parentRepresentationId) form.set("parent_representation_id", params.parentRepresentationId);
  return readJson(await fetch(`${API_ROOT}/v1/projects/${params.projectId}/structure-candidates/${params.candidateId}/representations/imports`, {
    method: "POST",
    body: form,
  }));
}

export async function reviewCandidateRepresentation(
  projectId: string,
  candidateId: string,
  representationId: string,
  checklist?: CandidateRepresentationReviewChecklist,
): Promise<CandidateRepresentationReviewOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/representations/${representationId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(checklist ? { checklist } : {}) } satisfies CandidateRepresentationReviewInput),
  }));
}

export async function rejectCandidateRepresentation(projectId: string, candidateId: string, representationId: string): Promise<CandidateRepresentationReviewOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/representations/${representationId}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }));
}

export async function promoteStructureCandidate(projectId: string, candidateId: string, representationId: string): Promise<StructureCandidatePromotionOutput> {
  return readJson(await fetch(`${API_ROOT}/v1/projects/${projectId}/structure-candidates/${candidateId}/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ representation_id: representationId }),
  }));
}

export async function importExperimentalDataset(params: {
  projectId: string;
  file: File;
  modality: string;
  xColumn: string;
  yColumns: string[];
  xLabel: string;
  xUnit: string;
  yLabel: string;
  yUnit: string;
  experimentName: string;
  delimiter?: string;
}): Promise<ExperimentalDatasetView> {
  const form = new FormData();
  form.set("upload", params.file);
  form.set("modality", params.modality);
  form.set("x_column", params.xColumn);
  form.set("y_columns", params.yColumns.join(","));
  form.set("x_label", params.xLabel);
  form.set("x_unit", params.xUnit);
  form.set("y_label", params.yLabel);
  form.set("y_unit", params.yUnit);
  form.set("experiment_name", params.experimentName);
  form.set("delimiter", params.delimiter ?? ",");
  return readJson(await fetch(`${API_ROOT}/v1/projects/${params.projectId}/experimental/imports`, { method: "POST", body: form }));
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return readJson(await fetch(`${API_ROOT}${path}`, { cache: "no-store", ...init }));
}

export class CandidateApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function errorDetail(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(errorDetail).filter(Boolean).join("; ");
  if (value && typeof value === "object") {
    const detail = value as { message?: unknown; msg?: unknown; code?: unknown };
    return errorDetail(detail.message ?? detail.msg ?? detail.code);
  }
  return null;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `ChemDFT API request failed with ${response.status}`;
    try { detail = errorDetail(((await response.json()) as { detail?: unknown }).detail) || detail; } catch { /* response may not be JSON */ }
    if (response.status === 404 && /project not found/i.test(detail)) detail = "This project is no longer available.";
    throw new CandidateApiError(response.status, `HTTP ${response.status}: ${detail}${response.status === 409 ? " Reload revision history and inspect the current revision before trying again. Your drawing has been kept." : ""}`);
  }
  return response.json() as Promise<T>;
}
