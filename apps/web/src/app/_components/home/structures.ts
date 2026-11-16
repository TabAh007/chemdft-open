import { availableRepresentations } from "../molecular-renderer/capabilities";
import { BENZENE_STRUCTURE, CAFFEINE_STRUCTURE, WATER_STRUCTURE } from "../molecular-renderer/structures/molecules";
import { CR2O3_STRUCTURE } from "../molecular-renderer/structures/cr2o3";
import type { Representation, ScientificStructure, Supercell } from "../molecular-renderer/types";

/**
 * The four reference structures the homepage can show. Each wraps an authoritative `ScientificStructure`; the page
 * only chooses which one to display and how (presentation), it never edits a coordinate. None of them is a ChemDFT
 * calculation result.
 */
export type HomeStructureId = "h2o" | "c6h6" | "c8h10n4o2" | "cr2o3";

export type HomeStructure = {
  readonly id: HomeStructureId;
  readonly name: string;
  readonly secondary?: string;
  /** Plain-text formula, e.g. "Cr2O3" (rendered with subscripts; screen readers read the plain text). */
  readonly formula: string;
  readonly kind: "crystal" | "molecule";
  readonly kindLabel: string;
  readonly structure: ScientificStructure;
  readonly supercell: Supercell;
  readonly representations: readonly Representation[];
  readonly defaultRepresentation: Representation;
  /** Authored starting camera (presentation only). `minRadius` keeps a small molecule from being blown up to fill the stage, Å. */
  readonly view: { readonly azimuth: number; readonly polar: number; readonly minRadius?: number };
  readonly sourceLine: string;
  readonly sourceHref?: string;
  readonly facts: string;
  readonly note: string;
  /** Long description for assistive technology and the no-WebGL fallback. */
  readonly description: string;
};

const crystalSource = CR2O3_STRUCTURE.provenance.source!;
const lattice = CR2O3_STRUCTURE.lattice!.parameters;

export const HOME_STRUCTURES: readonly HomeStructure[] = [
  {
    id: "h2o",
    name: "Water",
    formula: "H2O",
    kind: "molecule",
    kindLabel: "Reference molecular geometry",
    structure: WATER_STRUCTURE,
    supercell: [1, 1, 1],
    representations: availableRepresentations(WATER_STRUCTURE),
    defaultRepresentation: "ball-stick",
    view: { azimuth: 0.25, polar: 0.85, minRadius: 1.4 },
    sourceLine: "ChemDFT test geometry (the geometry of its stored water calculation)",
    facts: "O–H 0.9572 Å · H–O–H 104.52° · 3 atoms",
    note: "Reference geometry for illustration. Not a calculation result.",
    description: "Water, H2O: one oxygen and two hydrogen atoms in ChemDFT's stored test geometry, with an O–H distance of 0.9572 ångström and an H–O–H angle of 104.52 degrees. Display bonds are inferred from distances.",
  },
  {
    id: "c6h6",
    name: "Benzene",
    formula: "C6H6",
    kind: "molecule",
    kindLabel: "Reference molecular conformer",
    structure: BENZENE_STRUCTURE,
    supercell: [1, 1, 1],
    representations: availableRepresentations(BENZENE_STRUCTURE),
    defaultRepresentation: "ball-stick",
    view: { azimuth: 0.4, polar: 0.5 },
    sourceLine: "PubChem CID 241 · 3D conformer computed by PubChem",
    sourceHref: "https://pubchem.ncbi.nlm.nih.gov/compound/241",
    facts: "Planar six-carbon ring · 12 atoms · SDF bond table",
    note: "Reference structure for illustration. Not a ChemDFT calculation.",
    description: "Benzene, C6H6: a planar ring of six carbon atoms, each bonded to one hydrogen, from PubChem's computed 3D conformer for compound 241.",
  },
  {
    id: "c8h10n4o2",
    name: "Caffeine",
    formula: "C8H10N4O2",
    kind: "molecule",
    kindLabel: "Reference molecular conformer",
    structure: CAFFEINE_STRUCTURE,
    supercell: [1, 1, 1],
    representations: availableRepresentations(CAFFEINE_STRUCTURE),
    defaultRepresentation: "ball-stick",
    view: { azimuth: 0.5, polar: 0.55 },
    sourceLine: "PubChem CID 2519 · 3D conformer computed by PubChem",
    sourceHref: "https://pubchem.ncbi.nlm.nih.gov/compound/2519",
    facts: "24 atoms · heavy atoms coplanar · SDF bond table",
    note: "Reference structure for illustration. Not a ChemDFT calculation.",
    description: "Caffeine, C8H10N4O2: a fused two-ring purine system carrying three methyl groups and two carbonyl oxygens, from PubChem's computed 3D conformer for compound 2519.",
  },
  {
    id: "cr2o3",
    name: "Chromium(III) oxide",
    secondary: "eskolaite",
    formula: "Cr2O3",
    kind: "crystal",
    kindLabel: "Reference crystal structure",
    structure: CR2O3_STRUCTURE,
    supercell: [2, 2, 1],
    representations: availableRepresentations(CR2O3_STRUCTURE),
    defaultRepresentation: "ball-stick",
    view: { azimuth: 0.7, polar: 1.05 },
    sourceLine: `${crystalSource.id} · ${crystalSource.citation?.split(", doi")[0] ?? ""}`,
    sourceHref: crystalSource.url ?? "",
    facts: `α-Cr₂O₃ (corundum type) · R-3c (No. 167) · a = b = ${lattice.a.toFixed(4)} Å, c = ${lattice.c.toFixed(4)} Å, γ = 120° · shown as a 2×2×1 display supercell`,
    note: CR2O3_STRUCTURE.provenance.note ?? "",
    description: `Chromium(III) oxide, Cr2O3, the mineral eskolaite: the hexagonal unit cell of space group R-3c with ${lattice.a.toFixed(4)} by ${lattice.c.toFixed(4)} ångström edges and 30 atoms, from Crystallography Open Database entry 9014036. Each chromium sits in an octahedron of six oxygen atoms.`,
  },
];

export const DEFAULT_STRUCTURE_ID: HomeStructureId = "cr2o3";
export const WATER_ID: HomeStructureId = "h2o";

export const homeStructure = (id: HomeStructureId): HomeStructure => HOME_STRUCTURES.find((entry) => entry.id === id)!;

/** Splits "C8H10N4O2" into text and subscript runs for display. */
export function formulaParts(formula: string): { text: string; sub: boolean }[] {
  const parts: { text: string; sub: boolean }[] = [];
  for (const match of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    parts.push({ text: match[1]!, sub: false });
    if (match[2]) parts.push({ text: match[2], sub: true });
  }
  return parts;
}
