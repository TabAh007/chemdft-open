import type { CandidateRepresentationDetail, CandidateRepresentationView } from "@chemdft/schemas";
import type { CandidateRecognitionProposalView } from "./phase7-api";

type RepresentationRow = Pick<
  CandidateRepresentationView,
  "id" | "representation_type" | "representation_origin" | "revision"
>;

/**
 * The newest diagram-recognition output of a candidate: its SMILES proposal and the 2D MOL block
 * stored right behind it (revision + 1). Repeated recognition appends revisions, so "first match"
 * would show a superseded proposal.
 */
export function latestRecognitionRepresentations<T extends RepresentationRow>(
  representations: readonly T[],
): { smiles: T | null; mol: T | null } {
  const recognized = representations.filter((item) => item.representation_origin === "IMAGE_RECONSTRUCTION");
  const smiles = recognized
    .filter((item) => item.representation_type === "SMILES")
    .reduce<T | null>((best, item) => (best === null || item.revision > best.revision ? item : best), null);
  if (!smiles) return { smiles: null, mol: null };
  const mol = recognized.find((item) => item.representation_type === "MOL_BLOCK" && item.revision === smiles.revision + 1);
  return { smiles, mol: mol ?? null };
}

/** The stored proposal exactly as the server persisted it; nothing is defaulted or re-derived. */
export function recognitionProposalFromDetail(
  detail: Pick<CandidateRepresentationDetail, "recognition_proposal">,
): CandidateRecognitionProposalView | null {
  const proposal = detail.recognition_proposal;
  if (!proposal || typeof proposal.status !== "string" || typeof proposal.recognition_engine !== "string") return null;
  return proposal as unknown as CandidateRecognitionProposalView;
}
