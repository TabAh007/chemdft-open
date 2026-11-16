import { readAttachment, type Attachment } from "./download";
import { ProjectApiError } from "./project-api";

const API_ROOT = process.env.NEXT_PUBLIC_CHEMDFT_API_ROOT ?? "/api/chemdft";

function apiUrl(path: string): string {
  return `${API_ROOT}${path}`;
}

async function toError(response: Response): Promise<Error> {
  let message = `Export failed with status ${response.status}`;
  try {
    const payload = (await response.json()) as { detail?: string | { message?: string; reason?: string } };
    if (typeof payload.detail === "string") {
      message = payload.detail;
    } else if (payload.detail && typeof payload.detail === "object") {
      message = payload.detail.message || payload.detail.reason || message;
    }
  } catch {
    // Keep fallback message
  }
  return new ProjectApiError(response.status, message);
}

export interface ExportCapabilities {
  export_3d_pdf_available: boolean;
  export_3d_pdf_reason?: string | null | undefined;
  export_report_pdf_available: boolean;
  export_html_available: boolean;
  export_archive_available: boolean;
}

export async function fetchExportCapabilities(): Promise<ExportCapabilities> {
  try {
    const res = await fetch(apiUrl("/v1/export/capabilities"), { cache: "no-store" });
    if (res.ok) {
      return (await res.json()) as ExportCapabilities;
    }
  } catch {
    // fallback default
  }
  return {
    export_3d_pdf_available: false,
    export_3d_pdf_reason: "Requires Asymptote server toolchain and Adobe Acrobat on client (IN TESTING).",
    export_report_pdf_available: true,
    export_html_available: true,
    export_archive_available: true,
  };
}

export async function downloadProject3dPdf(
  projectId: string,
  structureVersionId?: string,
): Promise<Attachment> {
  const query = structureVersionId ? `?structure_version_id=${encodeURIComponent(structureVersionId)}` : "";
  const res = await fetch(apiUrl(`/v1/projects/${projectId}/export/3d-pdf${query}`), {
    cache: "no-store",
  });
  return readAttachment(res, "chemdft-3d-model.pdf", toError);
}

export async function downloadProjectReportPdf(
  projectId: string,
  structureVersionId?: string,
): Promise<Attachment> {
  const query = structureVersionId ? `?structure_version_id=${encodeURIComponent(structureVersionId)}` : "";
  const res = await fetch(apiUrl(`/v1/projects/${projectId}/export/report-pdf${query}`), {
    cache: "no-store",
  });
  return readAttachment(res, "chemdft-report.pdf", toError);
}

export async function downloadProjectHtml(
  projectId: string,
  structureVersionId?: string,
): Promise<Attachment> {
  const query = structureVersionId ? `?structure_version_id=${encodeURIComponent(structureVersionId)}` : "";
  const res = await fetch(apiUrl(`/v1/projects/${projectId}/export/html${query}`), {
    cache: "no-store",
  });
  return readAttachment(res, "chemdft-interactive.html", toError);
}

export async function downloadProjectArchive(projectId: string): Promise<Attachment> {
  const res = await fetch(apiUrl(`/v1/projects/${projectId}/export/archive`), {
    cache: "no-store",
  });
  return readAttachment(res, "chemdft-archive.zip", toError);
}

export async function downloadStructureFile(
  projectId: string,
  structureId: string,
  versionId: string,
  format: "XYZ" | "SDF" | "MOL" | "SMILES",
): Promise<Attachment> {
  const res = await fetch(
    apiUrl(
      `/v1/projects/${projectId}/structures/${structureId}/versions/${versionId}/export?file_format=${format}`,
    ),
    { cache: "no-store" },
  );
  const ext = format === "SMILES" ? "smi" : format.toLowerCase();
  return readAttachment(res, `structure.${ext}`, toError);
}

