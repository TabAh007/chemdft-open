/**
 * The one browser download primitive. Every file ChemDFT hands the researcher (exports, native
 * artifacts, structure files) goes through `readAttachment` + `saveBlob`, so filename parsing,
 * object-URL lifetime and error handling cannot drift between views.
 */

/** Filename from a Content-Disposition header, honouring the RFC 5987 `filename*` form; never a path. */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  const value = header ?? "";
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value)?.[1];
  let name: string | undefined;
  if (extended) {
    try { name = decodeURIComponent(extended.trim()); } catch { name = undefined; }
  }
  name ??= /filename\s*=\s*"([^"]+)"/i.exec(value)?.[1] ?? /filename\s*=\s*([^;\s]+)/i.exec(value)?.[1];
  const safe = (name ?? "").split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

export type Attachment = { blob: Blob; filename: string; mediaType: string };

/** Reads a successful attachment response; the caller supplies how a failed response becomes an Error. */
export async function readAttachment(
  response: Response,
  fallbackName: string,
  toError: (response: Response) => Promise<Error>,
): Promise<Attachment> {
  if (!response.ok) throw await toError(response);
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("content-disposition"), fallbackName),
    mediaType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Starts a browser download of an in-memory blob. The object URL is released after the click is handled. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
