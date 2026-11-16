import type { NavigatorAction } from "@chemdft/schemas";
import { blockedKinds, reasonKind, type ReasonKind } from "./overview-model";

/**
 * Release 0.0.24: why each workflow is "not available yet", in plain words. Presentation only: the server
 * catalogue, the reason codes and the availability are unchanged, and every fact the server states stays
 * reachable under "Technical details". An unknown code is never mapped to a guess.
 */
export type Fixer = "you" | "chemdft" | "access" | "none";

export const FIXER_LABEL: Record<Fixer, string> = {
  you: "You can fix this",
  chemdft: "Waiting on ChemDFT",
  access: "Needs access",
  none: "Prerequisite",
};

/** One plain line per known reason code. */
export const PLAIN_REASON: Record<string, string> = {
  structure_missing: "Needs a saved structure — this project has none yet.",
  coordinates_3d_required: "Needs 3D coordinates for the saved structure.",
  charge_required: "The structure's charge has not been recorded yet.",
  multiplicity_required: "The structure's spin multiplicity has not been recorded yet.",
  molecule_required: "This works on a single molecule, and this structure is not one.",
  lattice_required: "Needs a periodic structure with a lattice.",
  crystal_required: "Needs a crystal structure with a unit cell.",
  periodic_compute_unsupported: "ChemDFT can't run periodic calculations yet.",
  optimization_required: "Needs a finished geometry optimization of this structure first.",
  worker_unavailable: "This can't be proposed automatically here yet (on the hosted path, automatic proposals cover energy calculations only).",
  optimizer_unavailable: "Geometry optimization can't be proposed automatically here yet. You can still set it up in Calculation setup, which shows which engines are available.",
  job_in_progress: "A calculation of this kind is already queued or running — see Jobs.",
  editor_required: "You need edit access to this project to do this.",
  frequency_required: "Needs a validated frequency calculation first.",
  imaginary_frequencies: "The frequency result has imaginary or invalid modes; a valid minimum is needed.",
  stationarity_unproven: "The optimization has to end with a small enough final gradient first.",
  frequency_geometry_mismatch: "The frequency result does not match this structure version.",
  closed_shell_required: "Only closed-shell singlet molecules are supported for this.",
  matching_level_required: "The optimization and the frequency result must use the same engine, method and basis.",
  orbitals_required: "Needs a validated molecular-orbital result first.",
  computed_spectrum_required: "Needs a calculated spectrum for this structure first.",
  experimental_spectrum_required: "Needs an imported and confirmed experimental spectrum first.",
  experimental_peaks_required: "Detect the peaks of the experimental spectrum first.",
  spectrum_association_required: "Link the experimental spectrum to this structure first.",
  matching_spectrum_type_required: "The experimental and calculated spectra must be the same type (IR, Raman or UV/Vis).",
  thermochemistry_required: "Needs a validated thermochemistry result first.",
  provenance_required: "Needs a recorded source for this structure.",
  job_required: "No calculation has been run in this project yet.",
  history_limit_reached: "This project has more history than the Navigator can read; review it in the workspace.",
  template_sealed: "This example is sealed — copy it to your projects first.",
};

const UNKNOWN_PLAIN = "Has another prerequisite. The exact wording is under Technical details.";

export function plainReason(code: string): string {
  return PLAIN_REASON[code] ?? UNKNOWN_PLAIN;
}

export function isKnownReason(code: string): boolean {
  return code in PLAIN_REASON;
}

export function fixerOfKind(kind: ReasonKind): Fixer {
  switch (kind) {
    case "project":
    case "scientific": return "you";
    case "capability":
    case "method": return "chemdft";
    case "access": return "access";
    default: return "none";
  }
}

/** The who-can-fix tags of one action: the party of every reason it has, in a stable order. */
export function fixersOf(action: Pick<NavigatorAction, "reasons">): Fixer[] {
  const found = new Set<Fixer>((action.reasons ?? []).map((reason) => fixerOfKind(reasonKind(reason.code))));
  return (["you", "chemdft", "access", "none"] as const).filter((fixer) => found.has(fixer));
}

/** Codes that mean "no usable structure (yet)": the prerequisite almost every workflow shares. */
export const STRUCTURE_CODES: readonly string[] = [
  "structure_missing", "coordinates_3d_required", "charge_required", "multiplicity_required", "provenance_required",
  "molecule_required", "lattice_required", "crystal_required",
];

/** Codes resolved by a result that does not exist yet. */
const EARLIER_RESULT_CODES: readonly string[] = [
  "optimization_required", "frequency_required", "imaginary_frequencies", "stationarity_unproven", "frequency_geometry_mismatch",
  "matching_level_required", "orbitals_required", "computed_spectrum_required", "experimental_spectrum_required",
  "experimental_peaks_required", "spectrum_association_required", "matching_spectrum_type_required", "thermochemistry_required",
  "job_required", "closed_shell_required",
];

export type UnavailableSummary = { total: number; needStructure: number; needEarlierResult: number; platformLimits: number; needAccess: number; other: number };

const hasAny = (action: Pick<NavigatorAction, "reasons">, codes: readonly string[]) => (action.reasons ?? []).some((reason) => codes.includes(reason.code));

/** Real counts; an action with several reasons counts once in each category (the total counts it once). */
export function summarizeUnavailable(blocked: readonly Pick<NavigatorAction, "reasons">[]): UnavailableSummary {
  const summary: UnavailableSummary = { total: blocked.length, needStructure: 0, needEarlierResult: 0, platformLimits: 0, needAccess: 0, other: 0 };
  for (const action of blocked) {
    const kinds = blockedKinds(action);
    if (hasAny(action, STRUCTURE_CODES)) summary.needStructure += 1;
    if (hasAny(action, EARLIER_RESULT_CODES) || (action.reasons ?? []).some((r) => ["experimental_spectrum_required", "job_required"].includes(r.code))) summary.needEarlierResult += 1;
    if (kinds.includes("capability") || kinds.includes("method")) summary.platformLimits += 1;
    if (kinds.includes("access")) summary.needAccess += 1;
    if ((action.reasons ?? []).some((reason) => !isKnownReason(reason.code))) summary.other += 1;
  }
  return summary;
}

export function summaryLine(summary: UnavailableSummary): string {
  if (summary.total === 0) return "Nothing is blocked for the listed workflows.";
  const parts = [
    summary.needStructure ? `${summary.needStructure} need a structure` : null,
    summary.needEarlierResult ? `${summary.needEarlierResult} need an earlier result` : null,
    summary.platformLimits ? `${summary.platformLimits} ${summary.platformLimits === 1 ? "is a platform limit" : "are platform limits"}` : null,
    summary.needAccess ? `${summary.needAccess} need different access` : null,
    summary.other ? `${summary.other} have another prerequisite` : null,
  ].filter((part): part is string => part !== null);
  return `${summary.total} not available: ${parts.join(", ")}`;
}

export const SUMMARY_TOOLTIP = "A workflow with several reasons is counted once in each category, so the parts can add up to more than the total.";

/** The shared prerequisite to show once as a banner: "no structure", when most blocked workflows need it. */
export function sharedPrerequisite(blocked: readonly Pick<NavigatorAction, "reasons">[]): "structure_missing" | null {
  if (blocked.length < 3) return null;
  const sharing = blocked.filter((action) => (action.reasons ?? []).some((reason) => reason.code === "structure_missing")).length;
  return sharing / blocked.length >= 0.6 ? "structure_missing" : null;
}

/** Real existing actions that resolve a reason; a button is offered only if that action is available right now. */
const RESOLVING_ACTION: Record<string, readonly string[]> = {
  structure_missing: ["structure.import", "structure.draw"],
  coordinates_3d_required: ["structure.import", "structure.draw"],
  charge_required: ["structure.edit"],
  multiplicity_required: ["structure.edit"],
  experimental_spectrum_required: ["spectra.upload_experimental"],
  optimization_required: ["calculation.optimize"],
  orbitals_required: ["calculation.orbitals"],
  thermochemistry_required: ["thermochemistry.calculate"],
  provenance_required: ["evidence.import_document"],
  job_in_progress: ["jobs.review"],
};

/** The id of an available action that resolves this blocked action's first resolvable reason; never for platform limits. */
export function resolvingActionId(action: Pick<NavigatorAction, "reasons">, availableIds: ReadonlySet<string>): string | null {
  for (const reason of action.reasons ?? []) {
    if (fixerOfKind(reasonKind(reason.code)) === "chemdft") continue;
    for (const candidate of RESOLVING_ACTION[reason.code] ?? []) if (availableIds.has(candidate)) return candidate;
  }
  return null;
}
