import type { CalculationDetail, StructureVersionDetail } from "@chemdft/schemas";
import { describeScientificState, type ScientificStateView } from "./scientific-state";
import { derivedEnergyUnits, energyQuantityLabel, formatStoredValue, unitLabel } from "./results-model";
import { taskLabel } from "./overview-view";

/**
 * What the Scientific Result Inspector shows, derived only from the stored calculation, its published result and the
 * hash-verified immutable input. Nothing is generated: a missing value is "unavailable", never a default.
 */

export type ViewerKind = "energy" | "orbitals" | "optimization" | "conformers" | "dispersion" | "unsupported";

/** Result types that have a deterministic viewer reachable from Results. Everything else is honestly "unsupported here". */
export function viewerKind(resultType: string | null | undefined): ViewerKind {
  switch (resultType) {
    case "chemdft.energy": return "energy";
    case "chemdft.molecular-orbitals": return "orbitals";
    case "chemdft.optimization": return "optimization";
    case "chemdft.conformer-ensemble": return "conformers";
    case "chemdft.dispersion-corrected-energy": return "dispersion";
    default: return "unsupported";
  }
}

export type PrimaryOutput = {
  label: string;
  note: string | null;
  /** The stored value rendered at readable precision, and the exact stored number. */
  valueText: string;
  exact: string;
  unit: string;
  derived: { eV: string; kcalPerMol: string } | null;
  convergence: { known: boolean; converged: boolean; iterations: number | null };
};

export type InspectorModel = {
  title: string;
  task: string;
  resultType: string;
  viewer: ViewerKind;
  primary: PrimaryOutput | null;
  method: string;
  basis: string;
  engine: string;
  electronic: { charge: string; multiplicity: string };
  structure: { name: string; revision: number | null; versionId: string | null; label: string } | null;
  authority: ScientificStateView | null;
  /** Plain statement for result types with no scalar quantity or no Results viewer. */
  note: string | null;
};

const num = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? String(value) : "Unavailable");

/**
 * The AI dock's name for the inspected result, built from recorded fields only: the energy view names method and structure; every
 * other case uses the page's own title (the task, and the structure when its input resolved). Never an id.
 */
export function resultAiLabel(model: Pick<InspectorModel, "viewer" | "structure" | "title">, methodIdentifier: string): string {
  return model.viewer === "energy" && model.structure ? `Total Energy · ${methodIdentifier.toUpperCase()} · ${model.structure.label}` : model.title;
}

export function inspectorModel(detail: CalculationDetail, input: StructureVersionDetail | null): InspectorModel {
  const spec = detail.specification;
  const result = detail.result ?? null;
  const resultType = result?.result_type ?? "";
  const viewer = viewerKind(resultType);
  const engine = result ? `${result.producer_software.name} ${result.producer_software.version}`.trim() : "Unavailable";
  const methodName = spec.method.display_name ?? spec.method.identifier;
  const basisName = spec.basis?.display_name ?? spec.basis?.identifier ?? null;
  const task = taskLabel(spec.task_type);

  let primary: PrimaryOutput | null = null;
  const payload = result?.payload as unknown as Record<string, unknown> | undefined;
  const energy = payload && typeof payload === "object" && "total_energy" in payload ? (payload.total_energy as { value?: unknown; unit?: { code?: unknown } } | null) : null;
  if (result && viewer !== "unsupported" && resultType === "chemdft.energy" && energy && typeof energy.value === "number" && Number.isFinite(energy.value) && typeof energy.unit?.code === "string") {
    const wording = energyQuantityLabel({ engine: result.producer_software.name, method: spec.method.identifier });
    const converged = typeof payload?.converged === "boolean" ? payload.converged : null;
    const iterations = typeof payload?.scf_iterations === "number" && Number.isFinite(payload.scf_iterations) ? payload.scf_iterations : null;
    primary = {
      label: wording.label, note: wording.note,
      valueText: formatStoredValue(energy.value, energy.unit.code), exact: String(energy.value), unit: unitLabel(energy.unit.code),
      derived: derivedEnergyUnits(energy.value, energy.unit.code),
      convergence: { known: converged !== null, converged: converged === true, iterations },
    };
  }

  const structure = input
    ? { name: input.structure.name, revision: input.version.revision, versionId: input.version.id, label: `${input.structure.name} · V${input.version.revision}` }
    : null;
  const authority = result ? describeScientificState(result) : null;
  const note = !result ? "No published result is attached to this calculation."
    : viewer === "unsupported" ? `This result type (${resultType.replace("chemdft.", "")}) has no viewer in Results yet. Its stored data is unchanged; open it in the scientific workbench to see its dedicated viewer.`
    : primary === null && viewer === "energy" ? "The stored result has no valid total energy; nothing is shown in its place." : null;

  return {
    title: primary ? `${task} · ${structure?.label ?? "structure unavailable"}` : `${task}${structure ? ` · ${structure.label}` : ""}`,
    task, resultType, viewer, primary,
    method: methodName, basis: basisName ?? "Not applicable", engine,
    electronic: { charge: "charge" in spec ? num(spec.charge) : "Unavailable", multiplicity: "multiplicity" in spec ? num(spec.multiplicity) : "Unavailable" },
    structure, authority, note,
  };
}

/**
 * The input coordinates, only when the version/project/coordinate metadata is mutually consistent (same checks as the
 * workspace summary). An inconsistent input is refused rather than shown.
 */
export function verifiedInputCoordinates(detail: CalculationDetail, input: StructureVersionDetail | null | undefined) {
  const candidate = input?.version.coordinates;
  if (!input || !candidate) return null;
  const project = detail.calculation.project_id;
  const consistent = input.structure.project_id === project && input.version.project_id === project && input.structure.id === input.version.structure_id &&
    candidate.structure_version_id === input.version.id && candidate.source.project_id === project &&
    (!("entity_type" in candidate.source) || candidate.source.entity_type !== "structure.version" || candidate.source.entity_id === input.version.id) &&
    candidate.atoms.every((atom) => [atom.x, atom.y, atom.z].every(Number.isFinite));
  return consistent ? candidate : null;
}

export function coordinateUnitText(coordinates: { coordinate_system: string; unit?: string | null | undefined }): string {
  return coordinates.coordinate_system === "FRACTIONAL" ? "Fractional (dimensionless)" : coordinates.unit === "bohr" ? "Bohr" : coordinates.unit === "angstrom" ? "Angstrom" : "Unavailable";
}
