import { afterEach, describe, expect, it, vi } from "vitest";
import { getVolumetricFieldGrid } from "../src/lib/structure-workspace-api";

afterEach(() => vi.unstubAllGlobals());
describe("electronic field UI requests", () => {
  it("requests derived saved-SCF fields with no visualization or client field values", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({manifest:{grid_sha256:"immutable"},field_values:[1]}),{status:200}));
    vi.stubGlobal("fetch",fetch);
    await getVolumetricFieldGrid({projectId:"water",calculationId:"scf",request:{field_kind:"ELECTRON_DENSITY"}});
    expect(fetch.mock.calls[0]?.[0]).toContain("/calculations/scf/fields/grid");
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({field_kind:"ELECTRON_DENSITY"});
  });
  it("propagates typed generation failures while preserving the saved calculation", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:"ESP worker failed; saved SCF remains available"}),{status:503})));
    await expect(getVolumetricFieldGrid({projectId:"water",calculationId:"scf",request:{field_kind:"ELECTROSTATIC_POTENTIAL"}})).rejects.toThrow("saved SCF remains available");
  });
});
