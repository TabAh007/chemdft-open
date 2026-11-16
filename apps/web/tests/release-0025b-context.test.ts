import { describe, expect, it } from "vitest";
import { mergeWorkspaceScope, type ScopeShape } from "../src/lib/workspace-scope";

describe("workspace scope follows the current page (stale-context bug class)", () => {
  it("IR result -> Calculation setup -> Thermochemistry: nothing of the IR page survives", () => {
    let scope: ScopeShape = { projectName: "Paper test" };
    scope = mergeWorkspaceScope(scope, { structureName: "hno3", structureVersionRevision: 3, currentView: "hno3 V3 → IR → Mode 8 · 1839.1 cm⁻¹", calculationId: "c1", resultId: "r1", selectedModeIndex: 7, selectedModeFrequency: 1839.1, selectedModeIntensity: 363.12 });
    expect(scope.selectedModeFrequency).toBe(1839.1);
    scope = mergeWorkspaceScope(scope, { structureName: "hno3", structureVersionRevision: 3, currentView: "hno3 V3 → Calculation setup" });
    expect(scope).toEqual({ projectName: "Paper test", structureName: "hno3", structureVersionRevision: 3, currentView: "hno3 V3 → Calculation setup" });
    expect(scope.resultId).toBeUndefined();
    expect(scope.selectedModeFrequency).toBeUndefined();
    scope = mergeWorkspaceScope(scope, { structureName: "hno3", currentView: "hno3 V3 → Thermochemistry", calculationId: "c2", resultId: "r2" });
    expect(scope).toMatchObject({ resultId: "r2", currentView: "hno3 V3 → Thermochemistry" });
    expect(scope.selectedModeIndex).toBeUndefined();
  });

  it("a different project name is only kept from the announcement that sets it", () => {
    const scope = mergeWorkspaceScope({ projectName: "A", selectionName: "old" } as ScopeShape, { currentView: "x" });
    expect(scope.projectName).toBe("A");
    expect(scope.selectionName).toBeUndefined();
  });
});

import { resultHeaderBelongsToView } from "../src/lib/result-view-match";
describe("result status header only for the page's own record", () => {
  const records = { thermoResultIds: [], spectraResultIds: ["ir1", undefined, undefined], loadedResultId: "opt1" };
  it("hides the IR result header on an empty Thermochemistry page and keeps it on Spectra", () => {
    expect(resultHeaderBelongsToView("thermochemistry", "ir1", records)).toBe(false);
    expect(resultHeaderBelongsToView("thermochemistry", "t1", { ...records, thermoResultIds: ["t1"] })).toBe(true);
    expect(resultHeaderBelongsToView("spectra", "ir1", records)).toBe(true);
    expect(resultHeaderBelongsToView("spectra", "opt1", records)).toBe(false);
    expect(resultHeaderBelongsToView("result", "ir1", records)).toBe(false);
  });
});
