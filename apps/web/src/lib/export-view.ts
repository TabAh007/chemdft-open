import type { CalculationExportCatalog } from "@chemdft/schemas";

type FormatOption = CalculationExportCatalog["formats"][number];

/** Researcher-facing wording for the export menu. Availability and reasons come from the API. */

export const FORMAT_HELP: Record<string, string> = {
  "result-json": "Values with units, method and engine, structure identity, scientific state and provenance lineage.",
  "trajectory-xyz": "Every stored optimization frame in order (Å, energies in Eh in each comment line).",
  "spectrum-csv": "Stored stick data only — no broadening and no peak picking.",
  report: "Methods, standing, results with units, charts of stored data and provenance, evaluated now. Not a substitute for the evidence archive.",
  "reproducibility-bundle": "Allowlisted specification, structure, engine identity, environment and result, with checksums. Raw engine outputs, logs, original uploads and free text are withheld. The label says whether it is a provenance archive or a reproducibility package; exact reproduction is never claimed.",
  cube: "A stored density, potential or orbital grid in Gaussian CUBE form (lengths in bohr).",
};

export type ExportGroupKey = "raw" | "report" | "archive";

/** RW-3.2: exports are presented by kind of deliverable, in this order. */
export const EXPORT_GROUPS: readonly { key: ExportGroupKey; title: string; description: string }[] = [
  { key: "raw", title: "Raw scientific data", description: "Stored values in standard formats, for other software." },
  { key: "report", title: "Human-readable report", description: "Methods, results with units, standing and provenance, for people." },
  { key: "archive", title: "Evidence archive", description: "Allowlisted, checksummed evidence. Its class is decided by the same check that builds the download." },
];

const GROUP_OF: Record<string, ExportGroupKey> = {
  "result-json": "raw", "trajectory-xyz": "raw", "spectrum-csv": "raw", cube: "raw",
  report: "report",
  "reproducibility-bundle": "archive",
};

/** Researcher-facing name of an archive classification; unknown keys are shown as given, never upgraded. */
export function archiveClassLabel(key: string): { text: string; reproducible: boolean } {
  if (key === "REPRODUCIBILITY_PACKAGE") return { text: "Reproducibility package", reproducible: true };
  if (key === "PROVENANCE_ARCHIVE") return { text: "Provenance archive", reproducible: false };
  return { text: key.toLowerCase().replaceAll("_", " "), reproducible: false };
}

export function exportMenuModel(catalog: CalculationExportCatalog): {
  entries: { option: FormatOption; help: string }[];
  groups: { key: ExportGroupKey; title: string; description: string; entries: { option: FormatOption; help: string }[] }[];
  anyAvailable: boolean;
  historicalNotice: string | null;
} {
  const entries = catalog.formats.map((option) => ({ option, help: FORMAT_HELP[option.format] ?? option.label }));
  const groups = EXPORT_GROUPS.map((group) => ({
    ...group,
    entries: entries.filter((entry) => (GROUP_OF[entry.option.format] ?? "raw") === group.key),
  })).filter((group) => group.entries.length > 0);
  return {
    entries,
    groups,
    anyAvailable: entries.some((entry) => entry.option.available),
    historicalNotice:
      catalog.evidence_use === "HISTORICAL_ONLY"
        ? "This result is historical evidence. Exports are labelled historical and must not be cited as current."
        : catalog.evidence_use === "UNKNOWN"
          ? "Current scientific standing could not be established; exports make no current-authority claim."
          : null,
  };
}
