import { describe, expect, it } from "vitest";
import type { CalculationExportCatalog, OverviewRow } from "@chemdft/schemas";

import { archiveClassLabel, exportMenuModel } from "../src/lib/export-view";
import { calculationWorkspacePath, resultWorkspacePath } from "../src/lib/job-view";
import {
  composition, describeTarget, effectiveMoleculeName, hillFormula, lineageCompositionChange, newMoleculeTarget,
  newVersionTarget, nextRevision, sameComposition, type LineageParent,
} from "../src/lib/molecule-target";
import { EMPTY_FILTERS, filterRows, resultContextModel, rowWorkspaceHref } from "../src/lib/overview-view";
import { activeProjectSection, PROJECT_SECTIONS, researchFocusFromSelection } from "../src/lib/project-sections";
import { parseWorkspaceSelection } from "../src/lib/workspace-selection";

const P = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const C = "fd2addfb-f10d-4c79-9fdb-ae0a4a1f706e";
const R = "0746b1d9-eadb-4028-95dc-8bf8c87a5990";

const water: LineageParent = {
  structureId: "s-water", versionId: "v-water-1", revision: 1, nextRevision: 2, name: "Water", composition: composition(["O", "H", "H"]),
};

describe("molecule save target (New molecule vs New version)", () => {
  it("never carries a previous structure's name into a new molecule", () => {
    const target = newMoleculeTarget();
    expect(target.kind).toBe("new-molecule");
    expect(describeTarget(target).commitAs).toBe("Drawn molecule · V1");
    expect(describeTarget(target, "  Ethanol ").commitAs).toBe("Ethanol · V1");
    expect(describeTarget(target).detail).toMatch(/separate structure/);
    expect(effectiveMoleculeName("")).toBe("Drawn molecule");
  });

  it("names the lineage and the revision a new version will receive", () => {
    const target = newVersionTarget(water);
    const summary = describeTarget(target, "Ethanol"); // a typed name cannot rename the lineage
    expect(summary.action).toBe("New version");
    expect(summary.commitAs).toBe("Water · V2");
    expect(summary.detail).toContain("parent V1");
  });

  it("gives every opened editor a distinct identity so state never carries over", () => {
    expect(newMoleculeTarget().key).not.toBe(newMoleculeTarget().key);
    expect(newVersionTarget(water).key).not.toBe(newVersionTarget(water).key);
    expect(newMoleculeTarget("MOL").initialMolfile).toBe("MOL");
  });

  it("flags a new version whose composition differs from its lineage (water → ethanol)", () => {
    const target = newVersionTarget(water);
    expect(lineageCompositionChange(target, ["C", "C", "O", "H", "H", "H", "H", "H", "H"])).toEqual({ parent: "H2O", candidate: "C2H6O" });
    expect(lineageCompositionChange(target, ["H", "O", "H"])).toBeNull();
    expect(lineageCompositionChange(newMoleculeTarget(), ["C", "O"])).toBeNull();
    expect(lineageCompositionChange(target, [])).toBeNull();
  });

  it("writes Hill formulas exactly like the server", () => {
    expect(hillFormula(composition(["O", "H", "H"]))).toBe("H2O");
    expect(hillFormula(composition(["O", "C", "H", "C", "H", "H", "H", "H", "H"]))).toBe("C2H6O");
    expect(hillFormula(composition(["Cl", "Na"]))).toBe("ClNa");
    expect(hillFormula({})).toBe("");
    expect(sameComposition({ H: 2, O: 1 }, { O: 1, H: 2 })).toBe(true);
    expect(sameComposition({ H: 2, O: 1 }, { H: 2, O: 1, C: 0 })).toBe(true);
  });

  it("predicts the next revision from every revision known for the lineage", () => {
    expect(nextRevision([1])).toBe(2);
    expect(nextRevision([1, 3, null, undefined, 2])).toBe(4);
    expect(nextRevision([])).toBe(1);
  });
});

describe("project sections", () => {
  it("are ordered by the research flow", () => {
    expect(PROJECT_SECTIONS.map((s) => s.label)).toEqual(["Overview", "Workspace", "Results", "Compare", "Jobs", "Claims", "Paper vs ChemDFT", "Settings"]);
  });

  it("match exactly, so Compare is never active on Paper vs ChemDFT", () => {
    expect(activeProjectSection(`/en/projects/${P}/compare`, P)).toBe("compare");
    expect(activeProjectSection(`/en/projects/${P}/comparison`, P)).toBe("comparison");
    expect(activeProjectSection(`/de/projects/${P}/settings/ai`, P)).toBe("settings/general");
    expect(activeProjectSection(`/en/projects/${P}/workspace`, "other")).toBeNull();
    expect(activeProjectSection(`/en/projects/${P}`, P)).toBeNull();
  });

  it("take the research focus only from this project's workspace selection", () => {
    expect(researchFocusFromSelection({ projectId: P, currentView: "Water V1 → IR → Mode 2 · 3791.4 cm⁻¹" }, P)).toBe("Water V1 → IR → Mode 2 · 3791.4 cm⁻¹");
    expect(researchFocusFromSelection({ projectId: P, currentView: "Project → Overview" }, P)).toBeNull();
    expect(researchFocusFromSelection({ projectId: "other", currentView: "Water V1" }, P)).toBeNull();
    expect(researchFocusFromSelection({ projectId: P }, P)).toBeNull();
  });
});

describe("result navigation", () => {
  it("opens the published result itself, round-tripping through the workspace URL parser", () => {
    const href = resultWorkspacePath("en", P, C, R);
    const selection = parseWorkspaceSelection(new URL(href, "http://x").search, P);
    expect(selection).toEqual({ kind: "calculationResult", id: R, projectId: P, sourceId: C });
  });

  it("links Results rows with a result to the result, and other rows to the calculation record", () => {
    expect(rowWorkspaceHref("en", P, { calculation_id: C, result_id: R })).toBe(resultWorkspacePath("en", P, C, R));
    expect(rowWorkspaceHref("en", P, { calculation_id: C, result_id: null })).toBe(calculationWorkspacePath("en", P, C));
  });

  it("summarizes a row with stored values, units and the server's standing only", () => {
    const row = {
      calculation_id: C, result_id: R, task: "ORBITAL", calculation_state: "SUCCEEDED", engine: "pyscf", engine_version: "2.14.0",
      method: "hf", basis: "sto-3g", charge: 0, multiplicity: 1, structure_name: "Water", structure_revision: 1, formula_hill: "H2O",
      quantities: [{ key: "total_electronic_energy", label: "Total electronic energy", value: -74.96411623109547, unit: "Eh" }],
      evidence_use: "CURRENT", effective_state: { verification_state: "UNVERIFIED" }, visualizations: ["molecular-orbitals", "electron-density"],
      created_at: "2026-10-06T00:00:00", updated_at: "2026-10-06T00:00:00",
    } as unknown as OverviewRow;
    const model = resultContextModel(row);
    expect(model.task).toBe("Molecular orbitals");
    expect(model.quantity).toEqual({ text: "-74.964116 Eh", label: "Total electronic energy", full: "-74.96411623109547 Eh" });
    expect(model.level).toBe("hf / sto-3g");
    expect(model.engine).toBe("pyscf 2.14.0");
    expect(model.structure).toBe("Water · V1 · H2O");
    expect(model.standing).toBe("current");
    expect(model.verification).toBe("Not independently verified");
    expect(model.analyses).toEqual(["Molecular orbitals", "Electron density"]);
    const historical = resultContextModel({ ...row, evidence_use: "HISTORICAL_ONLY" } as OverviewRow);
    expect(historical.standing).toBe("historical"); // historical evidence never reads as current
    expect(resultContextModel({ ...row, evidence_use: "UNKNOWN" } as OverviewRow).standing).toBe("historical");
    const none = resultContextModel({ ...row, result_id: null, quantities: [], evidence_use: "NO_RESULT", calculation_state: "FAILED", failure: "SCF did not converge" } as unknown as OverviewRow);
    expect(none.quantity).toBeNull();
    expect(none.failure).toBe("SCF did not converge");
  });
});

describe("results search", () => {
  it("finds a level of theory written the way it is displayed", () => {
    const row = { calculation_id: C, task: "ENERGY", calculation_state: "SUCCEEDED", method: "hf", basis: "sto-3g", engine: "psi4" } as unknown as OverviewRow;
    for (const text of ["hf / sto-3g", "sto-3g", "HF/STO", "psi4"]) expect(filterRows([row], { ...EMPTY_FILTERS, text })).toHaveLength(text === "HF/STO" ? 0 : 1);
    expect(filterRows([row], { ...EMPTY_FILTERS, text: "b3lyp" })).toHaveLength(0);
  });
});

describe("export presentation", () => {
  const catalog = {
    project_id: P, calculation_id: C, result_id: R, evidence_use: "CURRENT",
    formats: [
      { format: "result-json", label: "Result (JSON)", available: true, media_type: "application/json", file_extension: "json" },
      { format: "report", label: "Report", available: true, media_type: "text/html", file_extension: "html" },
      { format: "reproducibility-bundle", label: "Evidence archive (ZIP)", available: true, media_type: "application/zip", file_extension: "zip",
        variants: [{ key: "PROVENANCE_ARCHIVE", label: "Provenance archive", detail: "Not sufficient to re-run — ENGINE_INPUT: NOT_REVIEWED_FOR_EXPORT." }] },
      { format: "cube", label: "CUBE", available: false, media_type: "chemical/x-cube", file_extension: "cube", unsupported_reason: "No grid." },
    ],
  } as unknown as CalculationExportCatalog;

  it("groups raw data, human-readable reports and evidence archives", () => {
    const model = exportMenuModel(catalog);
    expect(model.groups.map((g) => [g.key, g.entries.map((e) => e.option.format)])).toEqual([
      ["raw", ["result-json", "cube"]], ["report", ["report"]], ["archive", ["reproducibility-bundle"]],
    ]);
  });

  it("names archive classes without ever upgrading an unknown one", () => {
    expect(archiveClassLabel("REPRODUCIBILITY_PACKAGE")).toEqual({ text: "Reproducibility package", reproducible: true });
    expect(archiveClassLabel("PROVENANCE_ARCHIVE")).toEqual({ text: "Provenance archive", reproducible: false });
    expect(archiveClassLabel("SOMETHING_ELSE").reproducible).toBe(false);
  });
});
