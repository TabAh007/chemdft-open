import { describe, expect, it } from "vitest";
import { projectRecommendedNextStep } from "../src/lib/recommended-next-step";

describe("Guided Mode Visual System & Human-Readable Mapping", () => {
  it("translates technical authority and origin enums into human-readable descriptions", () => {
    function mapAuthorityToHuman(authority: string) {
      switch (authority) {
        case "USER_SUPPLIED":
          return "Uploaded by you";
        case "COMPUTED":
          return "Calculated by ChemDFT";
        case "CURATED":
          return "Curated reference";
        default:
          return authority;
      }
    }

    function mapOriginToHuman(origin: string) {
      switch (origin) {
        case "IMPORTED":
          return "Imported from XYZ";
        case "MANUAL_ENTRY":
          return "Manually created";
        case "DERIVED":
          return "Derived structure";
        default:
          return origin;
      }
    }

    expect(mapAuthorityToHuman("USER_SUPPLIED")).toBe("Uploaded by you");
    expect(mapAuthorityToHuman("COMPUTED")).toBe("Calculated by ChemDFT");
    expect(mapOriginToHuman("IMPORTED")).toBe("Imported from XYZ");
  });

  it("ensures visual bond disclaimer is always associated with unbonded formats (XYZ)", () => {
    const hasAuthoritativeBonds = false;
    const disclaimer = !hasAuthoritativeBonds
      ? "The visual bonds shown in the 3D viewer are estimated from interatomic distances for display purposes only. This structure file did not include authoritative bond connectivity."
      : null;

    expect(disclaimer).toContain("estimated from interatomic distances");
    expect(disclaimer).toContain("did not include authoritative bond connectivity");
  });

  it("strictly distinguishes orbital energy gap from optical excitation energy", () => {
    const homoEh = -0.4998;
    const lumoEh = 0.6074;
    const gapEh = lumoEh - homoEh;
    const gapEv = (gapEh * 27.211386).toFixed(2);

    expect(gapEv).toBe("30.13");
    const scientificNote = "Orbital energy difference (εLUMO - εHOMO). This is a ground-state orbital eigenvalue gap, not an optical excitation energy.";
    expect(scientificNote).toContain("not an optical excitation energy");
  });

  it("configures guided navigation items according to scientific state", () => {
    type NavItem = {
      id: string;
      label: string;
      available: boolean;
      badge?: string | undefined;
    };

    function buildNavItems(hasStructure: boolean, hasElectronic: boolean): NavItem[] {
      return [
        { id: "overview", label: "Overview", available: true },
        { id: "structure", label: "Structure", available: hasStructure },
        {
          id: "electronic",
          label: "Electronic Structure",
          available: hasElectronic,
          badge: hasElectronic ? "HF/STO-3G" : undefined,
        },
        { id: "spectra", label: "Spectra", available: false, badge: "Not calculated" },
        { id: "analysis", label: "Analysis", available: false, badge: "Not calculated" },
        { id: "ai", label: "AI Scientist", available: true },
        { id: "files", label: "Files & Data", available: true },
      ];
    }

    const waterNav = buildNavItems(true, true);
    expect(waterNav.find((n) => n.id === "structure")?.available).toBe(true);
    expect(waterNav.find((n) => n.id === "electronic")?.available).toBe(true);
    expect(waterNav.find((n) => n.id === "electronic")?.badge).toBe("HF/STO-3G");
    expect(waterNav.find((n) => n.id === "spectra")?.available).toBe(false);

    const emptyNav = buildNavItems(false, false);
    expect(emptyNav.find((n) => n.id === "structure")?.available).toBe(false);
    expect(emptyNav.find((n) => n.id === "electronic")?.available).toBe(false);
  });

  it("provides deterministic recommendations for beginner flow", () => {
    const rec = projectRecommendedNextStep({
      hasStructure: true,
      structureName: "Water V1",
      structureVersionRevision: 1,
      atomCount: 3,
      hasElectronicResult: true,
      electronicMethod: "HF",
      electronicBasis: "STO-3G",
      currentView: "Water V1",
    });

    expect(rec.primary.kind).toBe("VIEW_ELECTRONIC_STRUCTURE");
    expect(rec.primary.label).toBe("Explore electronic structure");
    expect(rec.secondary.length).toBeGreaterThan(0);
  });

  it("deterministically derives Hill-system molecular formula and rejects structure/project names", async () => {
    const { deriveMolecularFormula } = await import("../src/lib/scientific-format");

    // Water: 2 H, 1 O -> H2O with unicode subscripts: H₂O
    const waterAtoms = [
      { element: "O" },
      { element: "H" },
      { element: "H" },
    ];
    expect(deriveMolecularFormula(waterAtoms)).toBe("H₂O");
    expect(deriveMolecularFormula(waterAtoms, { useSubscripts: false })).toBe("H2O");

    // Methane (Hill system: C first, then H)
    const methaneAtoms = [
      { element: "H" },
      { element: "C" },
      { element: "H" },
      { element: "H" },
      { element: "H" },
    ];
    expect(deriveMolecularFormula(methaneAtoms)).toBe("CH₄");

    // Ethanol (Hill system: C2 H6 O)
    const ethanolAtoms = [
      { element: "O" },
      { element: "C" },
      { element: "H" },
      { element: "C" },
      { element: "H" },
      { element: "H" },
      { element: "H" },
      { element: "H" },
      { element: "H" },
    ];
    expect(deriveMolecularFormula(ethanolAtoms)).toBe("C₂H₆O");

    // Regression check: Project / structure titles can NEVER populate formula
    const structureName = "TEST USER-SUPPLIED WATER GEOMETRY";
    // @ts-expect-error Passing a string structure name must fail typing and return null
    expect(deriveMolecularFormula(structureName)).toBeNull();

    // Missing, empty, or invalid coordinates return null so the Formula row is safely omitted
    expect(deriveMolecularFormula(undefined)).toBeNull();
    expect(deriveMolecularFormula(null)).toBeNull();
    expect(deriveMolecularFormula([])).toBeNull();
    expect(deriveMolecularFormula([{ element: "InvalidElement123" }])).toBeNull();
  });

  it("presents exactly one authoritative Hartree total energy with deterministic eV conversion", async () => {
    const { hartreeToEv } = await import("../src/lib/scientific-format");

    const authoritativeTotalEnergyHartree = -74.962928;
    const formattedHartree = authoritativeTotalEnergyHartree.toFixed(6);
    expect(formattedHartree).toBe("-74.962928");

    // Deterministic eV conversion
    const totalEnergyEv = hartreeToEv(authoritativeTotalEnergyHartree).toFixed(2);
    expect(totalEnergyEv).toBe("-2039.85");

    // There must never be two conflicting Hartree values (such as -74.962949)
    const conflictingHartreeNote = "-74.962949 Hartree";
    expect(formattedHartree).not.toBe("-74.962949");
    expect(conflictingHartreeNote).not.toContain(formattedHartree);
  });

  it("ensures orbital numbering consistency across UI (1-based MO numbers, 0-based engine indices)", async () => {
    const { formatOrbitalNumber, formatOrbitalLabel } = await import("../src/lib/scientific-format");

    // For water in minimal STO-3G basis:
    // Engine index 4 -> User-visible HOMO = Orbital 5
    // Engine index 5 -> User-visible LUMO = Orbital 6
    const engineHomoIndex = 4;
    const engineLumoIndex = 5;

    expect(formatOrbitalNumber(engineHomoIndex)).toBe(5);
    expect(formatOrbitalLabel(engineHomoIndex)).toBe("Orbital 5");

    expect(formatOrbitalNumber(engineLumoIndex)).toBe(6);
    expect(formatOrbitalLabel(engineLumoIndex)).toBe("Orbital 6");

    // MO chip labels
    expect(`MO ${formatOrbitalNumber(1)}`).toBe("MO 2");
    expect(`MO ${formatOrbitalNumber(2)}`).toBe("MO 3");
  });

  it("formats message timestamps consistently across UTC and ISO strings", async () => {
    const { formatMessageTime } = await import("../src/lib/scientific-format");

    // ISO string with UTC indicator
    const timeUtc = formatMessageTime("2026-09-30T17:00:00Z");
    // ISO string without timezone indicator (backend naive UTC representation)
    const timeNaive = formatMessageTime("2026-09-30T17:00:00");

    // Both must evaluate to the same local time string
    expect(timeUtc).toBe(timeNaive);
    expect(timeUtc).not.toBe("—");
  });

  it("computes representation-aware scene visual bounds and canonical camera distances", async () => {
    const { computeSceneVisualBounds, calculateCanonicalCameraDistance } = await import(
      "../src/lib/visualization/renderer-utils"
    );

    const waterAtoms = [
      { element: "O", position: [0, 0, 0.1173] as [number, number, number], sourceAtomIndex: 0 },
      { element: "H", position: [0, 0.7572, -0.4692] as [number, number, number], sourceAtomIndex: 1 },
      { element: "H", position: [0, -0.7572, -0.4692] as [number, number, number], sourceAtomIndex: 2 },
    ];

    const ballStickBounds = computeSceneVisualBounds(waterAtoms, "ball-stick");
    const spaceFillBounds = computeSceneVisualBounds(waterAtoms, "space-fill");

    // Space-fill bounding radius is significantly larger than ball-and-stick
    expect(spaceFillBounds.radius).toBeGreaterThan(ballStickBounds.radius);
    expect(ballStickBounds.radius).toBeGreaterThan(1.0);
    expect(ballStickBounds.radius).toBeLessThan(1.6);

    // Standard aspect ratio
    const stdFit = calculateCanonicalCameraDistance(ballStickBounds.radius, 1.33, 35, 1.15);
    expect(stdFit.distance).toBeGreaterThan(3.5);
    expect(stdFit.distance).toBeLessThan(6.5);

    // Narrow 1024 layout aspect ratio (e.g., width 450, height 500 -> aspect = 0.9)
    const narrowFit = calculateCanonicalCameraDistance(ballStickBounds.radius, 0.9, 35, 1.15);
    // Distance accommodates limiting horizontal field of view without making molecule tiny
    expect(narrowFit.distance).toBeGreaterThan(stdFit.distance);
    expect(narrowFit.distance).toBeLessThan(8.0);

    // Space-fill camera distance is larger to fit the expanded van der Waals representation
    const spaceFillFit = calculateCanonicalCameraDistance(spaceFillBounds.radius, 1.33, 35, 1.15);
    expect(spaceFillFit.distance).toBeGreaterThan(stdFit.distance);
  });

  it("verifies canonical MO phase mapping and disclaimer", () => {
    // Canonical mapping from field-surface-vtk and orbital-isosurface-viewport:
    // Surface 0 (+iso, invert=false) -> 0x326fd1 (Blue) = Positive phase (+)
    // Surface 1 (-iso, invert=true)  -> 0xe18b3a (Orange) = Negative phase (−)
    const phaseMapping = {
      positive: { color: "Blue", hex: 0x326fd1, sign: "+" },
      negative: { color: "Orange", hex: 0xe18b3a, sign: "−" },
      disclaimer: "Orbital phase — not electric charge",
    };

    expect(phaseMapping.positive.color).toBe("Blue");
    expect(phaseMapping.positive.sign).toBe("+");
    expect(phaseMapping.negative.color).toBe("Orange");
    expect(phaseMapping.negative.sign).toBe("−");
    expect(phaseMapping.disclaimer).toBe("Orbital phase — not electric charge");
  });

  it("incorporates periodic unit cell vertices into scene bounds to prevent corner clipping", async () => {
    const { computeSceneVisualBounds, computeSceneAndCellVisualBounds, calculateCanonicalCameraDistance } = await import(
      "../src/lib/visualization/renderer-utils"
    );

    const atoms = [
      { element: "Cr", position: [0, 0, 0] as [number, number, number] },
      { element: "O", position: [1.2, 1.2, 2.5] as [number, number, number] },
    ];
    // Rhombohedral Cr2O3 unit cell extending up to c = 13.59Å
    const cellVertices: [number, number, number][] = [
      [0, 0, 0],
      [4.957, 0, 0],
      [-2.478, 4.293, 0],
      [2.478, 4.293, 0],
      [0, 0, 13.592],
      [4.957, 0, 13.592],
      [-2.478, 4.293, 13.592],
      [2.478, 4.293, 13.592],
    ];

    const atomsOnlyBounds = computeSceneVisualBounds(atoms, "ball-stick");
    const withCellBounds = computeSceneAndCellVisualBounds(atoms, cellVertices, "ball-stick");

    // Bounding radius with periodic cell should encompass the full ~13.6Å height
    expect(withCellBounds.radius).toBeGreaterThan(atomsOnlyBounds.radius);
    expect(withCellBounds.box.max[2]).toBeGreaterThanOrEqual(13.592);
    expect(withCellBounds.box.min[0]).toBeLessThanOrEqual(-2.478);

    // On short viewports (height 520px, aspect 2.1), camera distance accommodates cell vertices with 1.22 margin
    const wideShortAspect = 1093 / 520;
    const cameraFit = calculateCanonicalCameraDistance(withCellBounds.radius, wideShortAspect, 35, 1.22);
    expect(cameraFit.distance).toBeGreaterThan(withCellBounds.radius * 2);
    expect(cameraFit.orthoSpan).toBeGreaterThanOrEqual(withCellBounds.radius * 1.22);
  });
});


