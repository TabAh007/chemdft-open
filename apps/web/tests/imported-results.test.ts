import { describe, expect, it } from "vitest";
import type { ImportedResultView, ImportedVibrationsPayload, StructureVersionDetail } from "@chemdft/schemas";

import {
  asVibrations,
  formatFrequency,
  groupImportItems,
  importStateLabel,
  importedSticks,
  importedTabs,
  importedVibrationFrame,
  isImportedSpectrum,
  methodBasisDisplay,
  programDisplay,
  sentence,
  shortHash,
  spectraNavBadge,
  tabForResultType,
} from "../src/lib/imported-results";
import { parseWorkspaceSelection, validSelection, workspaceSelectionUrl } from "../src/lib/workspace-selection";

// Synthetic, ChemDFT-authored payload (not third-party program output).
const atoms = [
  { index: 0, element: "O", atomic_number: 8, x: 0, y: 0, z: 0.1 },
  { index: 1, element: "H", atomic_number: 1, x: 0, y: 0.75, z: -0.4 },
  { index: 2, element: "H", atomic_number: 1, x: 0, y: -0.75, z: -0.4 },
];

function vibrations(overrides: Partial<ImportedVibrationsPayload> = {}): ImportedVibrationsPayload {
  const modes = [
    { index: 0, frequency_cm1: 1600, imaginary: false, ir_intensity_km_mol: 70, raman_activity_a4_amu: 4, reduced_mass_amu: 1.08, displacement: [[0, 0, 0.1], [0, 0.5, -0.4], [0, -0.5, -0.4]], displacement_euclidean_norm: 1 },
    { index: 1, frequency_cm1: 3700, imaginary: false, ir_intensity_km_mol: 8, raman_activity_a4_amu: 90, reduced_mass_amu: 1.05, displacement: [[0, 0, 0.0], [0, 0.6, 0.4], [0, -0.6, 0.4]], displacement_euclidean_norm: 1 },
    { index: 2, frequency_cm1: -42.5, imaginary: true, ir_intensity_km_mol: 0, raman_activity_a4_amu: 0, reduced_mass_amu: 1.0, displacement: [[0, 0, 0.2], [0, 0.1, 0], [0, -0.1, 0]], displacement_euclidean_norm: 1 },
  ];
  return {
    mode_count: 3,
    linear: false,
    imaginary_mode_count: 1,
    modes,
    has_ir_intensities: true,
    has_raman_activities: true,
    depolarization_ratios: "not reported by the source parser; never synthesized",
    frequency_unit: "cm^-1",
    ir_intensity_unit: "km/mol",
    raman_activity_unit: "angstrom^4/amu",
    frequency_sign: "negative = imaginary",
    equilibrium_geometry: { coordinate_unit: "angstrom", atoms },
    zero_modes: "translation/rotation modes are not part of the imported modes",
    ordering: "as reported",
    ...overrides,
  } as unknown as ImportedVibrationsPayload;
}

function resultView(resultType: ImportedResultView["result_type"], payload: unknown): ImportedResultView {
  return { id: "r-" + resultType, result_type: resultType, payload } as unknown as ImportedResultView;
}

const structureVersion = {
  structure: { id: "s", project_id: "p", name: "synthetic" },
  version: {
    id: "v",
    revision: 1,
    coordinates: { unit: "angstrom", coordinate_system: "CARTESIAN", atoms: atoms.map((a) => ({ ...a })), bonds: [] },
  },
} as unknown as StructureVersionDetail;

describe("imported preview presentation", () => {
  it("groups preview items by state in the order the UI renders them", () => {
    const groups = groupImportItems([
      { id: "a", state: "DETECTED", title: "A", detail: "", result_type: null },
      { id: "b", state: "UNAVAILABLE", title: "B", detail: "", result_type: null },
      { id: "c", state: "WARNING", title: "C", detail: "", result_type: null },
      { id: "d", state: "DETECTED", title: "D", detail: "", result_type: null },
    ]);
    expect(groups.DETECTED.map((i) => i.id)).toEqual(["a", "d"]);
    expect(groups.WARNING.map((i) => i.id)).toEqual(["c"]);
    expect(groups.UNAVAILABLE.map((i) => i.id)).toEqual(["b"]);
    expect(groups.REJECTED).toEqual([]);
    expect(groupImportItems(undefined).DETECTED).toEqual([]);
  });

  it("never softens an UNKNOWN method or basis", () => {
    expect(methodBasisDisplay({ value: "whatever", status: "UNKNOWN" })).toBe("UNKNOWN");
    expect(methodBasisDisplay({ value: "B3LYP", status: "ESTABLISHED" })).toBe("B3LYP");
    expect(methodBasisDisplay({ value: "6-31G(d)", status: "REPORTED" })).toBe("6-31G(d)");
  });

  it("labels the program from the output, never from a filename", () => {
    expect(programDisplay({ label: "Gaussian 16", engine: "gaussian", version: "16" })).toBe("Gaussian 16");
    expect(programDisplay({ label: null, engine: "orca", version: "6.1" })).toBe("orca 6.1");
    expect(programDisplay({ label: null, engine: null, version: null })).toBe("Unidentified program");
  });

  it("states import state in plain words and shortens hashes without losing the ends", () => {
    expect(importStateLabel("PREVIEW_READY")).toContain("not imported");
    expect(importStateLabel("IMPORTED")).toBe("Imported");
    expect(importStateLabel("REJECTED")).toBe("Rejected");
    const hash = "a".repeat(32) + "b".repeat(32);
    expect(shortHash(hash, 8)).toBe("aaaaaaaa…bbbbbbbb");
    expect(shortHash("abc", 8)).toBe("abc");
  });

  it("turns stored lower-case clauses into sentences", () => {
    expect(sentence("not imported (no path)")).toBe("Not imported (no path).");
    expect(sentence("Already a sentence.")).toBe("Already a sentence.");
  });
});

describe("imported result tabs", () => {
  it("only offers views the file actually carries", () => {
    const withBoth = [resultView("chemdft.imported.structure", {}), resultView("chemdft.imported.vibrations", vibrations())];
    const available = importedTabs(withBoth).filter((t) => t.available).map((t) => t.id);
    expect(available).toEqual(["overview", "structure", "ir", "raman", "provenance"]);

    const irOnly = [resultView("chemdft.imported.vibrations", vibrations({ has_raman_activities: false }))];
    const irTabs = importedTabs(irOnly).filter((t) => t.available).map((t) => t.id);
    expect(irTabs).toContain("ir");
    expect(irTabs).not.toContain("raman");
    expect(irTabs).not.toContain("excitations");
    expect(irTabs).not.toContain("thermochemistry");
  });

  it("lands on the tab of the opened result", () => {
    expect(tabForResultType("chemdft.imported.excitations")).toBe("excitations");
    expect(tabForResultType("chemdft.imported.orbital-table")).toBe("orbitals");
    expect(tabForResultType("chemdft.imported.thermochemistry")).toBe("thermochemistry");
    expect(tabForResultType("chemdft.imported.structure")).toBe("structure");
    expect(tabForResultType("chemdft.imported.energy")).toBe("overview");
    expect(tabForResultType("chemdft.imported.vibrations", vibrations())).toBe("ir");
    expect(tabForResultType("chemdft.imported.vibrations", vibrations({ has_ir_intensities: false }))).toBe("raman");
  });

  it("finds a payload by result type", () => {
    const payload = vibrations();
    const found = asVibrations([resultView("chemdft.imported.vibrations", payload)]);
    expect(found?.payload).toBe(payload);
    expect(asVibrations(undefined)).toBeNull();
  });
});

describe("Guided Spectra status for imported data", () => {
  it("treats IR/Raman intensities and excitations as imported spectra, nothing else", () => {
    expect(isImportedSpectrum("chemdft.imported.vibrations", vibrations())).toBe(true);
    expect(isImportedSpectrum("chemdft.imported.vibrations", vibrations({ has_ir_intensities: false }))).toBe(true);
    expect(isImportedSpectrum("chemdft.imported.vibrations", vibrations({ has_ir_intensities: false, has_raman_activities: false }))).toBe(false);
    expect(isImportedSpectrum("chemdft.imported.vibrations")).toBe(false);
    expect(isImportedSpectrum("chemdft.imported.excitations")).toBe(true);
    for (const type of ["chemdft.imported.structure", "chemdft.imported.energy", "chemdft.imported.orbital-table", "chemdft.imported.thermochemistry"] as const) {
      expect(isImportedSpectrum(type)).toBe(false);
    }
  });

  it("never reports imported spectra as calculated, and never hides a ChemDFT result", () => {
    expect(spectraNavBadge({ hasSpectra: false, hasImportedSpectra: false })).toBe("Not calculated");
    expect(spectraNavBadge({ hasSpectra: false, hasImportedSpectra: true })).toBe("Imported");
    // 0.0.25: the badge names the spectrum types that really exist; an IR result is never badged "TDDFT".
    expect(spectraNavBadge({ hasSpectra: true, hasImportedSpectra: false, kinds: ["ir"] })).toBe("IR");
    expect(spectraNavBadge({ hasSpectra: true, hasImportedSpectra: false, kinds: ["raman"] })).toBe("Raman");
    expect(spectraNavBadge({ hasSpectra: true, hasImportedSpectra: false, kinds: ["uvvis"] })).toBe("UV/Vis");
    expect(spectraNavBadge({ hasSpectra: true, hasImportedSpectra: true, kinds: ["uvvis", "ir"] })).toBe("IR · UV/Vis");
    expect(spectraNavBadge({ hasSpectra: true, hasImportedSpectra: false })).toBe("Calculated");
    expect(spectraNavBadge({ hasSpectra: true, hasImportedSpectra: false, kinds: ["ir"] })).not.toContain("TDDFT");
  });
});

describe("imported vibrational data", () => {
  it("builds sticks from reported values only and keeps the imaginary flag", () => {
    const ir = importedSticks(vibrations(), "ir");
    expect(ir.map((s) => s.value)).toEqual([70, 8, 0]);
    expect(ir[2]?.imaginary).toBe(true);
    const noRamanModes = vibrations().modes.map((m) => ({ ...m, raman_activity_a4_amu: null })) as unknown as ImportedVibrationsPayload["modes"];
    const noRaman = importedSticks(vibrations({ modes: noRamanModes }), "raman");
    expect(noRaman).toEqual([]);
  });

  it("formats imaginary frequencies with an i, as reported", () => {
    expect(formatFrequency(-42.5, true)).toBe("−42.5i");
    expect(formatFrequency(1600.04, false)).toBe("1600.0");
  });

  it("builds a display-only frame whose largest excursion equals the requested amplitude", () => {
    const payload = vibrations();
    const frame = importedVibrationFrame(structureVersion, payload, 0, Math.PI / 2, 0.2);
    expect(frame).not.toBeNull();
    const moved = frame!.version.coordinates!.atoms;
    const excursions = moved.map((a, i) => Math.hypot(a.x - atoms[i]!.x, a.y - atoms[i]!.y, a.z - atoms[i]!.z));
    expect(Math.max(...excursions)).toBeCloseTo(0.2, 9);
    // The stored vectors and the immutable structure are untouched.
    expect(structureVersion.version.coordinates!.atoms[1]!.y).toBe(0.75);
    expect(payload.modes[0]!.displacement[1]).toEqual([0, 0.5, -0.4]);
  });

  it("returns the equilibrium geometry at zero phase and rejects a mismatched structure", () => {
    const zero = importedVibrationFrame(structureVersion, vibrations(), 1, 0, 0.2)!;
    expect(zero.version.coordinates!.atoms.map((a) => [a.x, a.y, a.z])).toEqual(atoms.map((a) => [a.x, a.y, a.z]));
    const wrong = { ...structureVersion, version: { ...structureVersion.version, coordinates: { ...structureVersion.version.coordinates!, atoms: structureVersion.version.coordinates!.atoms.slice(0, 2) } } } as StructureVersionDetail;
    expect(importedVibrationFrame(wrong, vibrations(), 0, 1, 0.2)).toBeNull();
    expect(importedVibrationFrame(structureVersion, vibrations(), 9, 1, 0.2)).toBeNull();
  });
});

describe("workspace selections for imported items", () => {
  const projectId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0ef";
  const importId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0f5";
  const resultId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0f6";

  it("round-trips an import and an imported result through the URL", () => {
    const imp = { kind: "externalImport" as const, id: importId, projectId };
    const res = { kind: "importedResult" as const, id: resultId, projectId, sourceId: importId };
    expect(parseWorkspaceSelection(new URL(workspaceSelectionUrl("https://x.test/en/p/workspace", imp), "https://x.test").search, projectId)).toEqual(imp);
    expect(parseWorkspaceSelection(new URL(workspaceSelectionUrl("https://x.test/en/p/workspace", res), "https://x.test").search, projectId)).toEqual(res);
  });

  it("requires the owning import for an imported result", () => {
    expect(validSelection({ kind: "importedResult", id: resultId, projectId }, projectId)).toBe(false);
    expect(validSelection({ kind: "externalImport", id: importId, projectId: "other" }, projectId)).toBe(false);
  });
});
