import type { AIApprovalView, CoordinateSet, StructureVersionDetail } from "@chemdft/schemas";

export const approvalGeometryKey = (approval: AIApprovalView) =>
  JSON.stringify([approval.id, approval.project_id, approval.action_fingerprint, approval.normalized_arguments]);

/** Only the immutable server version named by this approval may supply geometry. */
export function approvalGeometry(approval: AIApprovalView, detail: StructureVersionDetail): CoordinateSet {
  const args = approval.normalized_arguments ?? {};
  const target = args.structure_version as Record<string, unknown> | undefined;
  const spec = args.specification as Record<string, unknown> | undefined;
  const version = detail.version;
  const coordinates = version.coordinates;
  if (!approval.project_id || !target || target.project_id !== approval.project_id ||
      target.entity_type !== "structure.version" || target.entity_id !== version.id ||
      version.project_id !== approval.project_id || detail.structure.project_id !== approval.project_id ||
      version.structure_id !== detail.structure.id || !coordinates ||
      coordinates.structure_version_id !== version.id || coordinates.source.project_id !== approval.project_id) {
    throw new Error("The structure or coordinate version does not match this approval. Reload the approval.");
  }
  if ("entity_type" in coordinates.source && coordinates.source.entity_type === "structure.version" &&
      coordinates.source.entity_id !== version.id) {
    throw new Error("The coordinate source does not match the approved structure version.");
  }
  if (!spec || !Number.isInteger(spec.charge) || !Number.isInteger(spec.multiplicity) ||
      Number(spec.multiplicity) < 1 ||
      (version.overall_charge !== null && version.overall_charge !== spec.charge) ||
      (version.multiplicity !== null && version.multiplicity !== spec.multiplicity)) {
    throw new Error("The electronic state does not match this approval. Request a new proposal.");
  }
  if (!coordinates.atoms.length || !["angstrom", "bohr", "fractional"].includes(coordinates.unit) ||
      coordinates.atoms.some((atom, index) => atom.index !== index ||
        !atom.element || !Number.isInteger(atom.atomic_number) || atom.atomic_number < 1 ||
        ![atom.x, atom.y, atom.z].every(Number.isFinite))) {
    throw new Error("The approved geometry is incomplete or invalid. Approval is unavailable.");
  }
  return coordinates;
}

/** Keep every stored digit; add readable decimals only to exact integer coordinates. */
export const approvalCoordinate = (value: number) =>
  Object.is(value, -0) ? "-0.00" : Number.isInteger(value) && Math.abs(value) < 1e21 ? `${value}.00` : String(value);
