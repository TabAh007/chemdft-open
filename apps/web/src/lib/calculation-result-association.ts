import type { CalculationDetail, StructureVersionDetail } from "@chemdft/schemas";
import { downloadCalculationArtifact, listStructures, listStructureVersions } from "./structure-workspace-api";

/** Resolve the immutable input from the published, hash-bound input artifact, never the active molecule. */
export async function calculationInputStructure(projectId: string, detail: CalculationDetail): Promise<StructureVersionDetail> {
  const reference = detail.attempt?.raw_artifacts?.find((artifact) => artifact.sha256 === detail.calculation_input_hash);
  if (!reference) throw new Error("The immutable calculation input is unavailable.");
  const { blob } = await downloadCalculationArtifact({ projectId, calculationId: detail.calculation.id, artifactId: reference.artifact_id });
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== detail.calculation_input_hash) throw new Error("The calculation input hash does not match its artifact.");
  const input: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!input || typeof input !== "object" || !("structure_version_id" in input) || typeof input.structure_version_id !== "string") {
    throw new Error("The calculation input has no valid structure version reference.");
  }
  const structures = await listStructures(projectId);
  const versions = (await Promise.all(structures.map((structure) => listStructureVersions(projectId, structure.id)))).flat();
  const version = versions.find((item) => item.version.id === input.structure_version_id);
  if (!version) throw new Error("The immutable input structure version is unavailable.");
  return version;
}

export function selectedPublishedResult(detail: CalculationDetail, calculationId: string, resultId: string): boolean {
  return detail.calculation.id === calculationId && detail.result?.id === resultId &&
    detail.result.calculation_id === calculationId && detail.result.calculation_input_id === detail.calculation.input_id;
}
