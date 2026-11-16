import type { CalculationDetail, JobDiagnostics, JobLogOutput } from "@chemdft/schemas";
import { scientificCalculationEnergy } from "./ai-scientist-workflow";
import { scientificLog } from "./scientific-log";

/** Read only the log attached to the exact published result and its attempt. */
export function resultLogArtifact(detail: CalculationDetail, diagnostics: JobDiagnostics) {
  if (diagnostics.project_id !== detail.calculation.project_id || diagnostics.calculation_id !== detail.calculation.id ||
      diagnostics.job_id !== detail.compute_job?.id || detail.result?.producer_software.name !== "pyscf") return null;
  const attempt = diagnostics.attempts.find(item => item.attempt_id === detail.attempt?.id);
  return attempt?.artifacts?.find(artifact => artifact.kind === "ENGINE_LOG" && artifact.format_identifier === "pyscf.log" &&
    artifact.log_readable && detail.result?.raw_artifacts.some(ref => ref.artifact_id === artifact.artifact_id && ref.sha256 === artifact.sha256) &&
    detail.attempt?.raw_artifacts?.some(ref => ref.artifact_id === artifact.artifact_id && ref.sha256 === artifact.sha256)) ?? null;
}

export function boundScfEvidence(detail: CalculationDetail, log: JobLogOutput | null) {
  const energy = scientificCalculationEnergy(detail, detail.calculation.project_id, detail.calculation.id);
  if (!energy || !log || detail.result?.producer_software.name !== "pyscf" || log.kind !== "ENGINE_LOG" ||
      log.attempt_id !== detail.attempt?.id || !detail.result.raw_artifacts.some(ref => ref.artifact_id === log.artifact_id && ref.sha256 === log.sha256) ||
      !detail.attempt?.raw_artifacts?.some(ref => ref.artifact_id === log.artifact_id && ref.sha256 === log.sha256)) return null;
  const evidence = scientificLog(log.text);
  // A multi-SCF trajectory or mismatched/unconverged output cannot supply
  // extra quantities for a single-point result. Never guess missing output.
  if (evidence.convergenceRecords !== 1 || evidence.convergedEnergy === null ||
      Math.abs(evidence.convergedEnergy - energy.total_energy.value) > 1e-10 * Math.max(1, Math.abs(energy.total_energy.value))) return null;
  return evidence;
}
