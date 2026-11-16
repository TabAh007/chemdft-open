import type { StructureVersionDetail } from "@chemdft/schemas";
import { buildScientificScene } from "@chemdft/scientific-scene";
import { structureFromScene } from "@/app/_components/molecular-renderer/structures/from-scene";
import type { ScientificStructure } from "@/app/_components/molecular-renderer/types";
import { buildPreviewModel, type PreviewResult } from "./project-structure-preview";
import { getStructureVersion } from "./structure-workspace-api";

/**
 * The Overview's active-structure summary. The structure is the exact committed version the server Navigator reports
 * (`facts_summary.structure_id` / `structure_version_id`), read through the same authenticated endpoint the workspace
 * uses. The drawing is the project dashboard's static, view-only projection of its persisted coordinates: nothing is
 * generated, no calculation runs, and anything that cannot be resolved safely becomes a neutral placeholder.
 */

export type ActiveStructure = {
  detail: StructureVersionDetail;
  preview: PreviewResult;
};

export async function loadActiveStructure(params: {
  projectId: string;
  structureId: string;
  versionId: string;
  signal?: AbortSignal;
}): Promise<ActiveStructure> {
  const detail = await getStructureVersion({ projectId: params.projectId, structureId: params.structureId, versionId: params.versionId });
  // A response that does not provably belong to this project and version is never drawn.
  if (detail.version.project_id !== params.projectId || detail.version.id !== params.versionId || detail.structure.project_id !== params.projectId) {
    throw new Error("Structure version does not belong to this project.");
  }
  if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const preview = (detail.version.coordinates?.atoms.length ?? 0) > 0 ? buildPreviewModel(detail) : ({ status: "none" } as const);
  return { detail, preview };
}

/** Provenance wording shared with the workspace tree: "Authority: … · Verification: …". */
export function structureAuthority(detail: Pick<StructureVersionDetail, "provenance" | "version">): { source: string; verification: string } {
  const source = detail.provenance?.source_class ?? detail.version.origin;
  const verification = detail.provenance?.verification_state;
  return { source, verification: !verification || verification === "UNVERIFIED" ? "NOT REVIEWED" : verification };
}

/**
 * The interactive viewer's structure: persisted coordinates copied as stored, through the same scene adapter the
 * workspace and sealed examples use. Stored bonds stay canonical; display-only bonds are inferred only when the
 * version stores none, and the structure says so.
 */
export function viewerStructure(detail: StructureVersionDetail): ScientificStructure | null {
  try {
    const scene = buildScientificScene(detail);
    if (scene.atoms.length === 0) return null;
    return structureFromScene(scene, {
      title: detail.structure.name,
      provenance: { kind: "stored-structure-version", label: `${detail.structure.name} · V${detail.version.revision}` },
    });
  } catch {
    return null;
  }
}

/** How the drawn bonds relate to the record: stored connectivity, display-only inference, or none. */
export function bondBasis(structure: Pick<ScientificStructure, "canonicalBonds" | "inferredBonds" | "kind"> | null): { kind: "stored" | "inferred" | "none"; text: string } {
  if (!structure) return { kind: "none", text: "No coordinates to draw." };
  const stored = structure.canonicalBonds?.length ?? 0;
  if (stored > 0) return { kind: "stored", text: `Bonds: ${stored} stored in the structure record.` };
  if (structure.inferredBonds?.pairs.length) return { kind: "inferred", text: "Bonds are display-only, inferred from interatomic distances; they are not authoritative connectivity." };
  return { kind: "none", text: structure.kind === "periodic" ? "No bonds are stored; the unit cell is drawn from the recorded lattice." : "No bonds are stored for this structure." };
}
