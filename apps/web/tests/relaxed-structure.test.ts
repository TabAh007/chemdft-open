import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { QePeriodicResults } from "../src/app/[locale]/projects/[projectId]/workspace/visualization/qe-periodic-results";
import { canSaveRelaxedStructure, RELAXED_VERSION_NOTE, savedVersionSummary } from "../src/lib/relaxed-structure";
import { createRelaxedStructureVersion } from "../src/lib/structure-workspace-api";

const relaxation = {
  converged: true, ionic_steps: 4, scf_cycles: 9, initial_energy_hartree: -1, final_energy_hartree: -1.1, max_force_ry_per_bohr: 1e-4,
  force_threshold_ry_per_bohr: 1e-3, final_positions: [{ index: 0, element: "Na", species: "Na", fractional: [0.01, 0, 0] }],
};
const relaxed = { engine: "qe", relaxation };

afterEach(() => vi.unstubAllGlobals());

describe("Save relaxed structure as a new version (0.0.45)", () => {
  it("is offered only for a converged Quantum ESPRESSO relaxation with stored positions", () => {
    expect(canSaveRelaxedStructure(relaxed)).toBe(true);
    expect(canSaveRelaxedStructure({ engine: "qe" })).toBe(false); // plain SCF
    expect(canSaveRelaxedStructure({ engine: "qe", relaxation: { ...relaxation, converged: false } })).toBe(false);
    expect(canSaveRelaxedStructure({ engine: "qe", relaxation: { ...relaxation, final_positions: [] } })).toBe(false);
    expect(canSaveRelaxedStructure({ engine: "pyscf", relaxation })).toBe(false);
    expect(canSaveRelaxedStructure(null)).toBe(false);
  });

  it("renders the button for a relaxed QE result only", () => {
    const html = (payload: Record<string, unknown>) => renderToStaticMarkup(createElement(QePeriodicResults, { payload, projectId: "p1", calculationId: "c1" }));
    expect(html(relaxed)).toContain("Save relaxed structure as a new version");
    expect(html(relaxed)).toContain(RELAXED_VERSION_NOTE);
    expect(html({ engine: "qe" })).not.toContain("Save relaxed structure as a new version");
  });

  it("posts to the server and describes the new version without touching the old one", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: { id: "v2", structure_id: "s1", revision: 2, origin: "DERIVED" } }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { version } = await createRelaxedStructureVersion({ projectId: "p1", calculationId: "c1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/projects\/p1\/calculations\/c1\/relaxed-structure-version$/);
    expect(init.method).toBe("POST");
    expect(savedVersionSummary(version)).toBe("Saved as version V2 (derived from this calculation, authority CALCULATED). Version V1 is unchanged.");
  });
});
