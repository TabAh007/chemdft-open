import { describe, expect, it } from "vitest";

import { availableRepresentations, resolveRepresentation, unavailableReason } from "../src/app/_components/molecular-renderer/capabilities";
import { deriveGeometry } from "../src/app/_components/molecular-renderer/derive";
import { hillFormula } from "../src/app/_components/molecular-renderer/structures/build";
import { representationStyle } from "../src/app/_components/molecular-renderer/radii";
import benzeneSource from "../src/app/_components/home/reference/molecules.json";
import { DEFAULT_STRUCTURE_ID, HOME_STRUCTURES, formulaParts, homeStructure } from "../src/app/_components/home/structures";

describe("the four homepage structures", () => {
  it("are water, benzene, caffeine and chromium(III) oxide, in that order, with the right formulas", () => {
    expect(HOME_STRUCTURES.map((s) => [s.name, s.formula])).toEqual([
      ["Water", "H2O"],
      ["Benzene", "C6H6"],
      ["Caffeine", "C8H10N4O2"],
      ["Chromium(III) oxide", "Cr2O3"],
    ]);
    expect(HOME_STRUCTURES.map((s) => s.id)).toEqual(["h2o", "c6h6", "c8h10n4o2", "cr2o3"]);
    expect(DEFAULT_STRUCTURE_ID).toBe("cr2o3");
  });

  it("each formula is the composition of its authoritative structure (no formula/structure mix-up)", () => {
    for (const entry of HOME_STRUCTURES) {
      const elements = entry.structure.sites.map((site) => site.element);
      const composition = hillFormula(elements);
      if (entry.kind === "molecule") expect(composition, entry.name).toBe(entry.formula);
      else {
        // the conventional cell holds Z = 6 formula units: 12 Cr and 18 O
        expect(elements.filter((e) => e === "Cr")).toHaveLength(12);
        expect(elements.filter((e) => e === "O")).toHaveLength(18);
        expect(entry.formula).toBe("Cr2O3");
      }
    }
  });

  it("uses the validated molecule data exactly: coordinates and bond tables are the bundled, validated records", () => {
    for (const [id, key] of [["h2o", "water"], ["c6h6", "benzene"], ["c8h10n4o2", "caffeine"]] as const) {
      const entry = homeStructure(id);
      const source = benzeneSource[key];
      expect(entry.structure.sites).toHaveLength(source.atoms.length);
      source.atoms.forEach((atom, i) => {
        expect(entry.structure.sites[i]!.element).toBe(atom.element);
        expect(entry.structure.sites[i]!.position).toEqual([atom.x, atom.y, atom.z]);
      });
      expect(entry.structure.canonicalBonds?.length ?? 0).toBe(source.bonds.length);
    }
    expect(homeStructure("c6h6").structure.canonicalBonds).toHaveLength(12);
    expect(homeStructure("c8h10n4o2").structure.canonicalBonds).toHaveLength(25);
    expect(deriveGeometry(homeStructure("h2o").structure).bonds.every((b) => b.source === "inferred")).toBe(true); // water's XYZ carries no connectivity
    expect(deriveGeometry(homeStructure("c6h6").structure).bonds.every((b) => b.source === "canonical")).toBe(true);
  });

  it("keeps every structure frozen and unchanged by derivation, representation changes and supercell display", () => {
    for (const entry of HOME_STRUCTURES) {
      const before = JSON.stringify(entry.structure);
      expect(Object.isFrozen(entry.structure)).toBe(true);
      deriveGeometry(entry.structure, entry.supercell);
      for (const representation of availableRepresentations(entry.structure)) representationStyle(entry.structure, representation, deriveGeometry(entry.structure).coordination);
      expect(JSON.stringify(entry.structure)).toBe(before);
    }
  });

  it("states provenance: reference sources, never a ChemDFT calculation", () => {
    for (const entry of HOME_STRUCTURES) {
      expect(entry.structure.provenance.kind).toBe("reference-structure");
      expect(entry.note).toMatch(/not (a|the refined structure)/i);
      expect(entry.kindLabel).toMatch(/^Reference (crystal structure|molecular conformer|molecular geometry)$/);
    }
    expect(homeStructure("c6h6").sourceLine).toContain("PubChem CID 241");
    expect(homeStructure("c8h10n4o2").sourceLine).toContain("PubChem CID 2519");
    expect(homeStructure("cr2o3").sourceLine).toContain("COD 9014036");
    expect(homeStructure("h2o").sourceLine).toMatch(/ChemDFT test geometry/);
  });

  it("shows the crystal as a 2×2×1 display supercell (exact cells, never stretched) and says so", () => {
    const crystal = homeStructure("cr2o3");
    expect(crystal.supercell).toEqual([2, 2, 1]);
    expect(crystal.facts).toContain("2×2×1 display supercell");
    const cells = deriveGeometry(crystal.structure, crystal.supercell).atoms.filter((a) => a.role === "cell");
    expect(cells).toHaveLength(30 * 4);
  });

  it("splits formulas into text and subscripts for display", () => {
    expect(formulaParts("Cr2O3")).toEqual([{ text: "Cr", sub: false }, { text: "2", sub: true }, { text: "O", sub: false }, { text: "3", sub: true }]);
    expect(formulaParts("C8H10N4O2").map((p) => p.text).join("")).toBe("C8H10N4O2");
  });
});

describe("representation modes depend on the structure type", () => {
  it("offers all five for the crystal and only ball & stick, wireframe and space filling for isolated molecules", () => {
    expect(availableRepresentations(homeStructure("cr2o3").structure)).toEqual(["ball-stick", "unit-cell", "polyhedra", "wireframe", "space-fill"]);
    for (const id of ["h2o", "c6h6", "c8h10n4o2"] as const) {
      expect(availableRepresentations(homeStructure(id).structure), id).toEqual(["ball-stick", "wireframe", "space-fill"]);
      expect(unavailableReason(homeStructure(id).structure, "unit-cell")).toMatch(/no unit cell/);
      expect(unavailableReason(homeStructure(id).structure, "polyhedra")).toMatch(/no coordination polyhedra/);
    }
    expect(unavailableReason(homeStructure("cr2o3").structure, "polyhedra")).toBeNull();
  });

  it("never renders a crystallographic mode for a molecule: an unsupported request falls back to ball & stick", () => {
    expect(resolveRepresentation(homeStructure("h2o").structure, "unit-cell")).toBe("ball-stick");
    expect(resolveRepresentation(homeStructure("c6h6").structure, "polyhedra")).toBe("ball-stick");
    expect(resolveRepresentation(homeStructure("cr2o3").structure, "polyhedra")).toBe("polyhedra");
  });

  it("molecules have no cell and no polyhedra to draw", () => {
    for (const id of ["h2o", "c6h6", "c8h10n4o2"] as const) {
      const geometry = deriveGeometry(homeStructure(id).structure);
      expect(geometry.cell).toBeNull();
      expect(geometry.polyhedra).toHaveLength(0);
    }
  });

  it("uses a documented space-filling radius model for every structure, with Cr–O touching in the crystal", () => {
    for (const entry of HOME_STRUCTURES) {
      const geometry = deriveGeometry(entry.structure);
      const style = representationStyle(entry.structure, "space-fill", geometry.coordination);
      expect(style.model.physical).toBe(true);
      expect(style.model.citation.length).toBeGreaterThan(20);
    }
    expect(representationStyle(homeStructure("cr2o3").structure, "space-fill", deriveGeometry(homeStructure("cr2o3").structure).coordination).model.id).toBe("ionic-shannon");
    expect(representationStyle(homeStructure("c6h6").structure, "space-fill", deriveGeometry(homeStructure("c6h6").structure).coordination).model.id).toBe("vdw-bondi");
  });
});

describe("switching structure is presentation only", () => {
  it("never mixes two structures' coordinates: each derived geometry is a pure function of its own structure", () => {
    const a = deriveGeometry(homeStructure("h2o").structure);
    const b = deriveGeometry(homeStructure("c6h6").structure);
    deriveGeometry(homeStructure("h2o").structure);
    expect(deriveGeometry(homeStructure("h2o").structure)).toBe(a);
    expect(a.atoms.map((x) => x.position)).toEqual(homeStructure("h2o").structure.sites.map((s) => s.position));
    expect(b.atoms.map((x) => x.position)).toEqual(homeStructure("c6h6").structure.sites.map((s) => s.position));
  });
});
