import type { CalculationDetail, CalculationSubmitInput, ConformerEnsembleResult, ConformerSearchOptions, EngineCapabilityView, StructureVersionDetail } from "@chemdft/schemas";
import type { RenderableSceneData } from "@chemdft/scientific-scene";

export const CREST_VERSION = "3.0.2+pf8c-ewinfix-a1";
export const CONFORMER_SETTINGS = {
  workflow: "imtd-gc", optimization_level: "vtight", energy_window_kcal_mol: 6,
  rmsd_threshold_angstrom: 0.125, energy_threshold_kcal_mol: 0.05,
  rotational_constant_threshold: 0.01, threads: 2, timeout_seconds: 1800,
} as const satisfies ConformerSearchOptions;

export function conformerUnavailableReason(structure: StructureVersionDetail, capability?: EngineCapabilityView): string | null {
  if (!capability || capability.availability !== "AVAILABLE") return capability?.diagnostic || "The native CREST capability is unavailable on this host.";
  if (capability.engine !== "crest" || capability.version !== CREST_VERSION ||
    !capability.supported_tasks.includes("CONFORMER_SEARCH") || !capability.supported_methods.includes("gfn2")) {
    return "This host does not advertise the validated patched CREST GFN2 conformer workflow.";
  }
  if (structure.structure.kind !== "MOLECULE" || structure.version.periodic_cell) return "Conformer search requires a nonperiodic molecule.";
  if (structure.version.overall_charge !== 0 || structure.version.multiplicity !== 1) return "The validated workflow supports neutral singlet molecules only (charge 0, multiplicity 1).";
  const atoms = structure.version.coordinates?.atoms;
  if (!atoms?.length || atoms.length > 50) return "The validated workflow requires 1–50 atoms with saved coordinates.";
  if (atoms.some((atom, i) => atom.index !== i || ({ H: 1, C: 6, O: 8 } as Record<string, number>)[atom.element] !== atom.atomic_number)) return "The validated workflow supports ordered H/C/O atom identities only.";
  return null;
}

export function buildConformerSubmission(projectId: string, structureVersionId: string, idempotencyKey: string): CalculationSubmitInput {
  return {
    structure_version: { project_id: projectId, entity_type: "structure.version", entity_id: structureVersionId },
    specification: {
      task_type: "CONFORMER_SEARCH", method: { identifier: "gfn2", display_name: "GFN2 · embedded tblite", registry: "chemdft.method" },
      basis: null, charge: 0, multiplicity: 1,
      engine_preference: { engine: "crest", allowed_version: CREST_VERSION }, conformer_search: { ...CONFORMER_SETTINGS },
    },
    provider_preference: "AUTO", idempotency_key: idempotencyKey,
  };
}

/** Presentation guard in addition to server validation. Never use an active structure as a member. */
export function associatedConformerEnsemble(detail: CalculationDetail, projectId: string, calculationId: string, resultId: string): ConformerEnsembleResult {
  const { calculation, result, compute_execution: execution, attempt } = detail;
  if (calculation.project_id !== projectId || calculation.id !== calculationId || calculation.state !== "SUCCEEDED" ||
    detail.specification.task_type !== "CONFORMER_SEARCH" || !result || result.id !== resultId || result.project_id !== projectId ||
    result.calculation_id !== calculationId || result.calculation_input_id !== calculation.input_id ||
    result.validation_state !== "VALIDATED" || result.trusted_producer_id !== "local.crest.worker" ||
    result.result_type !== "chemdft.conformer-ensemble" || result.payload.payload_schema !== "chemdft.conformer-ensemble") {
    throw new Error("The selected calculation and validated CREST ensemble do not match.");
  }
  const payload = result.payload as ConformerEnsembleResult;
  const m = payload.manifest;
  if (m.project_id !== projectId || m.calculation_id !== calculationId || m.calculation_input_id !== calculation.input_id ||
    m.calculation_input_sha256 !== detail.calculation_input_hash || m.execution_id !== execution?.id || execution.project_id !== projectId ||
    execution.calculation_id !== calculationId || m.attempt_number !== attempt?.attempt_number || attempt.calculation_id !== calculationId ||
    attempt.project_id !== projectId || m.search_completed !== true || m.engine_version !== CREST_VERSION ||
    payload.manifest_artifact.project_id !== projectId || !m.members.length || m.members.length > 1000 ||
    new Set(m.members.map((member) => member.conformer.id)).size !== m.members.length ||
    m.native_artifacts.some((entry) => entry.artifact.project_id !== projectId) || payload.artifacts.some((artifact) => artifact.project_id !== projectId)) {
    throw new Error("The ensemble identity or completed native evidence is inconsistent with this execution.");
  }
  for (const [index, member] of m.members.entries()) {
    const c = member.conformer;
    if (c.project_id !== projectId || c.structure_version_id !== m.input_structure_version_id ||
      c.coordinates.structure_version_id !== m.input_structure_version_id || c.rank !== member.application_rank ||
      member.application_rank !== index + 1 || member.native_rank !== index + 1 ||
      member.minimum_status !== "UNVERIFIED" || member.geometry_convergence !== "NATIVE_GRADIENT_CONVERGED" ||
      member.native_electronic_energy.unit.code !== "Eh" || !Number.isFinite(member.native_electronic_energy.value) ||
      c.relative_energy?.unit.code !== "kcal/mol" || !Number.isFinite(c.relative_energy.value) ||
      c.coordinates.unit !== "angstrom" || c.coordinates.coordinate_system !== "CARTESIAN" || !c.coordinates.atoms.length ||
      c.coordinates.atoms.some((atom) => ![atom.x, atom.y, atom.z].every(Number.isFinite))) {
      throw new Error("A retained member has inconsistent identity, ranking, units, geometry, or minimum status.");
    }
  }
  return payload;
}

export function ensembleSelectionKey(projectId: string, calculationId: string, resultId: string, payload: ConformerEnsembleResult): string {
  return `chemdft:conformer-member:${projectId}:${calculationId}:${resultId}:${payload.manifest.execution_id}:${payload.manifest_artifact.sha256}`;
}

export function selectedEnsembleMember(payload: ConformerEnsembleResult, memberId: string | null) {
  return payload.manifest.members.find((member) => member.conformer.id === memberId) ?? payload.manifest.members[0];
}

export function sceneForConformerMember(payload: ConformerEnsembleResult, memberId: string): RenderableSceneData {
  const member = payload.manifest.members.find((item) => item.conformer.id === memberId);
  if (!member) throw new Error("The selected member does not belong to this ensemble.");
  return {
    id: `${payload.manifest.execution_id}:${member.conformer.id}:${member.native_record_sha256}`, kind: "MOLECULE",
    atoms: member.conformer.coordinates.atoms.map((atom) => ({
      id: `${member.conformer.id}:atom:${atom.index}`, index: atom.index, element: atom.element, atomicNumber: atom.atomic_number,
      position: [atom.x, atom.y, atom.z], sourcePosition: [atom.x, atom.y, atom.z], sourceCoordinateSystem: "CARTESIAN",
    })),
    bonds: [],
  };
}

export function conformerRunState(detail: CalculationDetail) {
  const state = detail.calculation.state;
  const failure = `${detail.attempt?.failure_code ?? ""} ${detail.compute_execution?.failure_code ?? ""} ${detail.attempt?.diagnostic ?? ""} ${detail.compute_execution?.diagnostic ?? ""}`;
  if (state === "CANCELED") return "Canceled";
  if (/TIMEOUT|TIMED_OUT|time.?out/i.test(failure)) return "Timed out";
  if (state === "FAILED") return /incomplete|missing.*evidence/i.test(failure) ? "Incomplete native evidence" : "Failed";
  if (state === "SUCCEEDED") return detail.result?.validation_state === "VALIDATED" && detail.result.result_type === "chemdft.conformer-ensemble" ? "Completed" : "Incomplete native evidence";
  return ["RUNNING", "VALIDATING"].includes(state) ? "Running" : "Queued";
}


/* ---- Release 0.0.25 follow-up: presentation helpers (no scientific value is changed) ---- */

export type ArtifactGroupId = "results" | "logs" | "internal";
export const ARTIFACT_GROUP_LABEL: Record<ArtifactGroupId, string> = { results: "Result files", logs: "Logs", internal: "Internal / temporary files" };

/** Result files (the ensemble and its geometries), logs, and everything else (restart/temporary files). Order is kept inside a group. */
export function artifactGroup(name: string): ArtifactGroupId {
  if (/^(ensemble-manifest\.json|crest_(best|conformers|rotamers)\.xyz)$/i.test(name)) return "results";
  if (/(\.log|stdout|stderr)$/i.test(name) || /^(crestopt|ensemble_energies)/i.test(name)) return "logs";
  return "internal";
}

export function groupArtifacts<T extends { name: string }>(items: readonly T[]): Array<{ id: ArtifactGroupId; label: string; items: T[] }> {
  return (["results", "logs", "internal"] as const)
    .map((id) => ({ id, label: ARTIFACT_GROUP_LABEL[id], items: items.filter((item) => artifactGroup(item.name) === id) }))
    .filter((group) => group.items.length > 0);
}

/** Plain label for the native convergence enum; the raw value is shown under Technical details. */
export function convergenceLabel(value: string): string {
  return value === "NATIVE_GRADIENT_CONVERGED" ? "Gradient converged (reported by CREST)" : value.toLowerCase().replaceAll("_", " ");
}

/** A human label for a member: "Member 1 of 2 (lowest energy)"; the short id is shown separately, never the full UUID. */
export function memberLabel(rank: number, total: number): string {
  return `Member ${rank} of ${total}${rank === 1 ? " (lowest energy)" : ""}`;
}
export const shortId = (id: string): string => id.slice(0, 8);
