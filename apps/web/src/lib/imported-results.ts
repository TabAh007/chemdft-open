import type {
  ExternalImportDetail,
  ExternalImportSummaryView,
  ImportItem,
  ImportedEnergyPayload,
  ImportedExcitationsPayload,
  ImportedOptimizationPayload,
  ImportedOrbitalTablePayload,
  ImportedResultView,
  ImportedStructurePayload,
  ImportedThermochemistryPayload,
  ImportedVibrationsPayload,
  StructureVersionDetail,
} from "@chemdft/schemas";

/**
 * Presentation helpers for IMPORTED results. Nothing here computes science: every value shown is the
 * validated payload value, and display-only conversions are labelled where they are applied.
 */

export type ImportedResultType = ImportedResultView["result_type"];
export type ImportItemState = ImportItem["state"];

export const IMPORT_STATE_ORDER: readonly ImportItemState[] = ["DETECTED", "WARNING", "UNAVAILABLE", "REJECTED"];

export const IMPORT_STATE_TITLE: Record<ImportItemState, string> = {
  DETECTED: "Detected",
  WARNING: "Warnings",
  UNAVAILABLE: "Unavailable",
  REJECTED: "Rejected",
};

export const IMPORTED_RESULT_TITLE: Record<ImportedResultType, string> = {
  "chemdft.imported.structure": "Imported structure",
  "chemdft.imported.energy": "Imported SCF energy",
  "chemdft.imported.optimization": "Imported geometry optimization",
  "chemdft.imported.orbital-table": "Imported orbital energies",
  "chemdft.imported.vibrations": "Imported vibrational analysis",
  "chemdft.imported.excitations": "Imported electronic excitations",
  "chemdft.imported.thermochemistry": "Imported thermochemistry",
};

export function groupImportItems(items: readonly ImportItem[] | undefined): Record<ImportItemState, ImportItem[]> {
  const groups: Record<ImportItemState, ImportItem[]> = { DETECTED: [], WARNING: [], UNAVAILABLE: [], REJECTED: [] };
  for (const item of items ?? []) groups[item.state].push(item);
  return groups;
}

export function importStateLabel(state: ExternalImportSummaryView["state"]): string {
  if (state === "IMPORTED") return "Imported";
  if (state === "REJECTED") return "Rejected";
  return "Preview · not imported";
}

/** "Gaussian 16", "ORCA 6.1" — as reported by the output itself; never inferred from the file name. */
export function programDisplay(program: { label: string | null; engine: string | null; version: string | null }): string {
  if (program.label) return program.label;
  if (program.engine) return `${program.engine}${program.version ? ` ${program.version}` : ""}`;
  return "Unidentified program";
}

/** The status vocabulary the preview must show for method and basis ("UNKNOWN" is never softened). */
export function methodBasisDisplay(value: { value: string; status: "ESTABLISHED" | "REPORTED" | "UNKNOWN" }): string {
  return value.status === "UNKNOWN" ? "UNKNOWN" : value.value;
}

export function findResult<T extends ImportedResultView["payload"]>(
  results: readonly ImportedResultView[] | undefined,
  resultType: ImportedResultType,
): { view: ImportedResultView; payload: T } | null {
  const view = results?.find((item) => item.result_type === resultType);
  return view ? { view, payload: view.payload as T } : null;
}

export const asStructure = (results: readonly ImportedResultView[] | undefined) =>
  findResult<ImportedStructurePayload>(results, "chemdft.imported.structure");
export const asEnergy = (results: readonly ImportedResultView[] | undefined) =>
  findResult<ImportedEnergyPayload>(results, "chemdft.imported.energy");
export const asOptimization = (results: readonly ImportedResultView[] | undefined) =>
  findResult<ImportedOptimizationPayload>(results, "chemdft.imported.optimization");
export const asOrbitals = (results: readonly ImportedResultView[] | undefined) =>
  findResult<ImportedOrbitalTablePayload>(results, "chemdft.imported.orbital-table");
export const asVibrations = (results: readonly ImportedResultView[] | undefined) =>
  findResult<ImportedVibrationsPayload>(results, "chemdft.imported.vibrations");
export const asExcitations = (results: readonly ImportedResultView[] | undefined) =>
  findResult<ImportedExcitationsPayload>(results, "chemdft.imported.excitations");
export const asThermochemistry = (results: readonly ImportedResultView[] | undefined) =>
  findResult<ImportedThermochemistryPayload>(results, "chemdft.imported.thermochemistry");

export type ImportedTab =
  | "overview"
  | "structure"
  | "ir"
  | "raman"
  | "excitations"
  | "orbitals"
  | "thermochemistry"
  | "provenance";

export interface ImportedTabSpec {
  id: ImportedTab;
  label: string;
  /** Present only when the imported file carries the data; absent tabs are listed as unavailable on Overview. */
  available: boolean;
}

export function importedTabs(results: readonly ImportedResultView[] | undefined): ImportedTabSpec[] {
  const vibrations = asVibrations(results)?.payload;
  return [
    { id: "overview", label: "Overview", available: true },
    { id: "structure", label: "Structure", available: Boolean(asStructure(results)) },
    { id: "ir", label: "IR", available: Boolean(vibrations?.has_ir_intensities) },
    { id: "raman", label: "Raman", available: Boolean(vibrations?.has_raman_activities) },
    { id: "excitations", label: "Excitations", available: Boolean(asExcitations(results)) },
    { id: "orbitals", label: "Orbital energies", available: Boolean(asOrbitals(results)) },
    { id: "thermochemistry", label: "Thermochemistry", available: Boolean(asThermochemistry(results)) },
    { id: "provenance", label: "Provenance", available: true },
  ];
}

/** True when an imported result carries spectral data: IR/Raman intensities, or excited-state energies. */
export function isImportedSpectrum(resultType: ImportedResultType, vibrations?: ImportedVibrationsPayload): boolean {
  if (resultType === "chemdft.imported.excitations") return true;
  return resultType === "chemdft.imported.vibrations" && Boolean(vibrations?.has_ir_intensities || vibrations?.has_raman_activities);
}

export type SpectraKind = "uvvis" | "ir" | "raman";
const SPECTRA_KIND_LABEL: Record<SpectraKind, string> = { ir: "IR", raman: "Raman", uvvis: "UV/Vis" };

/**
 * Guided "Spectra" badge. It names the spectrum types that really exist (IR, Raman, UV/Vis from a TDDFT result),
 * never a method that did not produce a result; imported spectra are labelled as imported, never as calculated.
 */
export function spectraNavBadge(status: { hasSpectra: boolean; hasImportedSpectra: boolean; kinds?: readonly SpectraKind[] | undefined }): string {
  if (status.hasSpectra) {
    const labels = (["ir", "raman", "uvvis"] as const).filter((kind) => status.kinds?.includes(kind)).map((kind) => SPECTRA_KIND_LABEL[kind]);
    return labels.length ? labels.join(" · ") : "Calculated";
  }
  return status.hasImportedSpectra ? "Imported" : "Not calculated";
}

/** Default landing tab for a selected imported result. */
export function tabForResultType(resultType: ImportedResultType, vibrations?: ImportedVibrationsPayload): ImportedTab {
  switch (resultType) {
    case "chemdft.imported.structure":
    case "chemdft.imported.optimization":
      return "structure";
    case "chemdft.imported.vibrations":
      return vibrations?.has_ir_intensities ? "ir" : vibrations?.has_raman_activities ? "raman" : "overview";
    case "chemdft.imported.excitations":
      return "excitations";
    case "chemdft.imported.orbital-table":
      return "orbitals";
    case "chemdft.imported.thermochemistry":
      return "thermochemistry";
    default:
      return "overview";
  }
}

/**
 * Display-only animation frame of an imported normal mode. The source displacement vectors are used as
 * direction only (like the ChemDFT-computed frames): the largest per-atom excursion is scaled to
 * `amplitudeAngstrom`, and the stored vectors are never modified.
 */
export function importedVibrationFrame(
  source: StructureVersionDetail,
  payload: ImportedVibrationsPayload,
  modeIndex: number,
  phase: number,
  amplitudeAngstrom: number,
): StructureVersionDetail | null {
  const coordinates = source.version.coordinates;
  const mode = payload.modes[modeIndex];
  const base = payload.equilibrium_geometry.atoms;
  if (!coordinates || !mode || !Number.isFinite(phase) || !Number.isFinite(amplitudeAngstrom)) return null;
  if (coordinates.atoms.length !== base.length || displacementVectors(mode).length !== base.length) return null;
  if (coordinates.atoms.some((atom, index) => atom.element !== base[index]?.element)) return null;
  const vectors = displacementVectors(mode);
  const largest = Math.max(...vectors.map((vector) => Math.hypot(...vector)));
  if (!Number.isFinite(largest) || largest <= 0) return null;
  const scale = (amplitudeAngstrom * Math.sin(phase)) / largest;
  const atoms = coordinates.atoms.map((atom, index) => {
    const point = base[index];
    const vector = vectors[index];
    if (!point || !vector) return null;
    return {
      ...atom,
      x: point.x + scale * vector[0],
      y: point.y + scale * vector[1],
      z: point.z + scale * vector[2],
    };
  });
  if (atoms.some((atom) => atom === null)) return null;
  return {
    ...source,
    version: {
      ...source.version,
      coordinates: { ...coordinates, unit: "angstrom", atoms: atoms as typeof coordinates.atoms },
    },
  };
}

type Vector3 = [number, number, number];

/** The generated schema types the per-atom displacement triples as `unknown`; the contract guarantees finite numbers. */
export function displacementVectors(mode: ImportedVibrationsPayload["modes"][number]): Vector3[] {
  return mode.displacement as unknown as Vector3[];
}

export interface ImportedStick {
  modeIndex: number;
  frequencyCm1: number;
  value: number;
  imaginary: boolean;
}

/** Sticks for one normal-mode spectroscopy; modes with no reported value are omitted, never zero-filled. */
export function importedSticks(payload: ImportedVibrationsPayload, kind: "ir" | "raman"): ImportedStick[] {
  const sticks: ImportedStick[] = [];
  for (const mode of payload.modes) {
    const value = kind === "ir" ? mode.ir_intensity_km_mol : mode.raman_activity_a4_amu;
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    sticks.push({ modeIndex: mode.index, frequencyCm1: mode.frequency_cm1, value, imaginary: mode.imaginary });
  }
  return sticks;
}

export function formatFrequency(frequencyCm1: number, imaginary: boolean): string {
  return imaginary ? `−${Math.abs(frequencyCm1).toFixed(1)}i` : frequencyCm1.toFixed(1);
}

export function formatHartree(value: number, digits = 8): string {
  return value.toFixed(digits);
}

export function formatSource(detail: ExternalImportDetail): string {
  return programDisplay(detail.import_record.preview.program);
}

/** Preview items that the UI states as facts about what is NOT imported (for the Overview "Not available" list). */
export function unavailableItems(items: readonly ImportItem[] | undefined): ImportItem[] {
  return (items ?? []).filter((item) => item.state === "UNAVAILABLE");
}

export function shortHash(value: string, head = 12): string {
  return value.length > head * 2 + 1 ? `${value.slice(0, head)}…${value.slice(-head)}` : value;
}

/** Payload semantic notes are stored as lower-case clauses; show them as sentences. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const capitalised = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}
