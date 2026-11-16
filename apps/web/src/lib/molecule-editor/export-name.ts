export const DEFAULT_EXPORT_STEM = "drawn-molecule";

/** `<name>.<ext>` for an export: unsafe filename characters become “-”, Unicode letters are kept. */
export function exportFilename(
  name: string,
  extension: "svg" | "png" | "pdf" | "mol" | "sdf" | "smi" | "xyz",
): string {
  const cleaned = Array.from(name.normalize("NFC"))
    .map((char) => (/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/\s*-+\s*/g, "-")
    .trim()
    .replace(/^[.\- ]+|[.\- ]+$/g, "");
  const stem = Array.from(cleaned).slice(0, 80).join("").trim() || DEFAULT_EXPORT_STEM;
  return `${stem.replace(/ /g, "-")}.${extension}`;
}
