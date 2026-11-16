import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AIApprovalView, StructureVersionDetail } from "@chemdft/schemas";
import { describe, expect, it } from "vitest";
import { approvalCoordinate, approvalGeometry, approvalGeometryKey } from "../src/lib/approval-geometry";
import { ApprovalGeometryTable } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientific-workflow";

const project = "11111111-1111-4111-8111-111111111111";
const structure = "22222222-2222-4222-8222-222222222222";
const version = "33333333-3333-4333-8333-333333333333";
const actor = "44444444-4444-4444-8444-444444444444";
const time = "2026-10-14T00:00:00Z";
const approval: AIApprovalView = {
  id: version, run_id: structure, project_id: project, tool_name: "calculation.submit", tool_version: "1.0.0",
  action_fingerprint: "server-issued-fingerprint", scientific_summary: "H2 reference input", reason: "Researcher requested",
  status: "PENDING", expires_at: "2099-01-01T00:00:00Z", created_at: time,
  normalized_arguments: { structure_version: { entity_id: version, entity_type: "structure.version", project_id: project },
    specification: { task_type: "ENERGY", charge: 0, multiplicity: 1, method: { identifier: "hf" }, basis: { identifier: "sto-3g" }, engine_preference: { engine: "pyscf" } } },
};
function authoritativeInput(): StructureVersionDetail {
  return {
    structure: { id: structure, project_id: project, kind: "MOLECULE", name: "H2 supplied geometry", created_at: time, created_by: actor },
    version: { id: version, project_id: project, structure_id: structure, revision: 1, origin: "IMPORTED", overall_charge: 0,
      multiplicity: 1, created_at: time, created_by: actor, representation_artifacts: [{ project_id: project, artifact_id: structure, sha256: "0".repeat(64) }],
      coordinates: { structure_version_id: version, coordinate_system: "CARTESIAN", unit: "angstrom",
        source: { project_id: project, entity_type: "structure.version", entity_id: version }, atoms: [
          { index: 0, element: "H", atomic_number: 1, x: 0, y: 0, z: -0.37 },
          { index: 1, element: "H", atomic_number: 1, x: 0, y: 0, z: 0.37 },
        ] },
    },
  };
}

describe("approval-bound scientific geometry", () => {
  it("renders supplied H2 coordinates, atom identities, units and exact version without changing them", () => {
    const data = authoritativeInput();
    const before = JSON.stringify(data);
    const html = renderToStaticMarkup(createElement(ApprovalGeometryTable, { coordinates: approvalGeometry(approval, data) }));
    for (const text of ["Units: Angstrom", version, "Atomic number", "<td>H</td>", "<td>0.00</td>", "<td>-0.37</td>", "<td>0.37</td>"]) expect(html).toContain(text);
    expect(JSON.stringify(data)).toBe(before);
  });
  it.each(["version", "project", "structure", "coordinate-version", "coordinate-project", "coordinate-source", "charge", "multiplicity", "nonfinite"])("rejects mismatched %s", field => {
    const data = authoritativeInput();
    if (field === "version") data.version.id = structure;
    if (field === "project") data.version.project_id = actor;
    if (field === "structure") data.structure.id = actor;
    if (field === "coordinate-version") data.version.coordinates!.structure_version_id = actor;
    if (field === "coordinate-project") data.version.coordinates!.source.project_id = actor;
    if (field === "coordinate-source") data.version.coordinates!.source = { project_id: project, entity_type: "structure.version", entity_id: actor };
    if (field === "charge") data.version.overall_charge = 1;
    if (field === "multiplicity") data.version.multiplicity = 3;
    if (field === "nonfinite") data.version.coordinates!.atoms[0]!.x = Infinity;
    expect(() => approvalGeometry(approval, data)).toThrow();
  });
  it("invalidates cached readiness when bound method, basis or fingerprint changes", () => {
    const original = approvalGeometryKey(approval);
    for (const field of ["method", "basis"] as const) {
      const changed = structuredClone(approval);
      (changed.normalized_arguments!.specification as Record<string, unknown>)[field] = { identifier: "changed" };
      expect(approvalGeometryKey(changed)).not.toBe(original);
    }
    expect(approvalGeometryKey({ ...approval, action_fingerprint: "new-fingerprint" })).not.toBe(original);
  });
  it("preserves digits rather than rounding geometry to two decimal places", () => {
    expect(approvalCoordinate(0.123456789)).toBe("0.123456789");
    expect(approvalCoordinate(-0)).toBe("-0.00");
    expect(approvalCoordinate(1e21)).toBe("1e+21");
  });
});
