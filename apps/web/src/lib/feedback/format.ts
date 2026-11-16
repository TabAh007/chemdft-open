/**
 * Shared formatting utilities for feedback attachments and sizes.
 * Safe for use in both client components and server code.
 */

/**
 * Formats byte counts according to ChemDFT UI/email standards:
 * - Under 1024 bytes: "N B"
 * - Under 10 KB (10 * 1024 = 10,240 bytes): "N.N KB" (one decimal)
 * - Under 1 MB (1024 * 1024 = 1,048,576 bytes): "N KB" (rounded integer)
 * - 1 MB and above: "N.N MB" (one decimal)
 */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    if (kb < 10) {
      return `${kb.toFixed(1)} KB`;
    }
    return `${Math.round(kb)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
