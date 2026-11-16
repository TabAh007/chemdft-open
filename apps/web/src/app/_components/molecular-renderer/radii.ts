import { elementDisplay } from "./elements";
import type { Representation, ScientificStructure } from "./types";

/**
 * Atom radii per representation. Radii that a representation *claims* to be physical come from a named,
 * sourced model; ball-and-stick sizes are display scales and are labelled as such.
 */
export type RadiusModelId = "ionic-shannon" | "vdw-bondi" | "covalent-cordero" | "display-scale";

export type RadiusModel = {
  readonly id: RadiusModelId;
  readonly label: string;
  readonly citation: string;
  readonly physical: boolean;
  readonly radii: Readonly<Record<string, number>>;
};

/**
 * Shannon effective ionic radii, Å (R. D. Shannon, Acta Cryst. A32, 751–767, 1976), by coordination number.
 * Only the ions the renderer needs; extend with sourced values, never by eye.
 */
const SHANNON: Readonly<Record<string, { charge: number; byCoordination: Readonly<Record<number, number>> }>> = {
  Cr: { charge: 3, byCoordination: { 6: 0.615 } },
  O: { charge: -2, byCoordination: { 2: 1.35, 3: 1.36, 4: 1.38, 6: 1.4, 8: 1.42 } },
};

export type CoordinationByElement = Readonly<Record<string, readonly number[]>>;

function modal(values: readonly number[] | undefined): number | undefined {
  if (!values?.length) return undefined;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

function elementsOf(structure: ScientificStructure): string[] {
  return [...new Set(structure.sites.map((site) => site.element))];
}

export function ionicModel(structure: ScientificStructure, coordination: CoordinationByElement): RadiusModel | null {
  const states = structure.oxidationStates;
  if (!states) return null;
  const radii: Record<string, number> = {};
  for (const element of elementsOf(structure)) {
    const entry = SHANNON[element];
    const cn = modal(coordination[element]);
    if (!entry || entry.charge !== states[element] || cn === undefined) return null;
    const radius = entry.byCoordination[cn];
    if (radius === undefined) return null;
    radii[element] = radius;
  }
  return {
    id: "ionic-shannon",
    label: "Shannon effective ionic radii",
    citation: "R. D. Shannon, Acta Cryst. A32, 751 (1976); each ion at its coordination number in this structure.",
    physical: true,
    radii,
  };
}

export function vdwModel(structure: ScientificStructure): RadiusModel | null {
  const radii: Record<string, number> = {};
  for (const element of elementsOf(structure)) {
    const radius = elementDisplay(element).vanDerWaalsRadius;
    if (radius === undefined) return null;
    radii[element] = radius;
  }
  return {
    id: "vdw-bondi",
    label: "van der Waals radii",
    citation: "ChemDFT central element table (Bondi, J. Phys. Chem. 68, 441, 1964, and commonly used values).",
    physical: true,
    radii,
  };
}

export function covalentModel(structure: ScientificStructure): RadiusModel {
  const radii: Record<string, number> = {};
  for (const element of elementsOf(structure)) radii[element] = elementDisplay(element).covalentRadius;
  return {
    id: "covalent-cordero",
    label: "Covalent radii",
    citation: "B. Cordero et al., Dalton Trans. 2832 (2008), via the ChemDFT central element table.",
    physical: true,
    radii,
  };
}

/** Compressed display scale for ball-and-stick: 0.46·r_cov^0.6 Å. Not a physical radius. */
export function displayScaleModel(structure: ScientificStructure): RadiusModel {
  const radii: Record<string, number> = {};
  for (const element of elementsOf(structure)) radii[element] = 0.46 * Math.pow(elementDisplay(element).covalentRadius, 0.6);
  return {
    id: "display-scale",
    label: "Display size (not a physical radius)",
    citation: "0.46 × covalent radius^0.6 (Å), chosen only so atoms and bonds read clearly.",
    physical: false,
    radii,
  };
}

/** The scientific model used by space-filling: ionic when oxidation states are stated, else van der Waals, else covalent. */
export function spaceFillModel(structure: ScientificStructure, coordination: CoordinationByElement): RadiusModel {
  return ionicModel(structure, coordination) ?? (structure.kind === "molecule" ? vdwModel(structure) : null) ?? covalentModel(structure);
}

export type RepresentationStyle = {
  readonly model: RadiusModel;
  /** Atom radius per element, Å. */
  readonly atomRadius: Readonly<Record<string, number>>;
  /** Bond cylinder radius, Å; 0 hides bonds. */
  readonly bondRadius: number;
  readonly showBonds: boolean;
  readonly showPolyhedra: boolean;
  /** 0–1 emphasis of cell edges. */
  readonly cellEmphasis: number;
  readonly forceCell: boolean;
  /** Extra framing margin so the largest drawn atom is not clipped, Å. */
  readonly framingPadding: number;
};

const scaled = (radii: Readonly<Record<string, number>>, factor: number) => Object.fromEntries(Object.entries(radii).map(([e, r]) => [e, r * factor]));

export function representationStyle(structure: ScientificStructure, representation: Representation, coordination: CoordinationByElement): RepresentationStyle {
  const display = displayScaleModel(structure);
  const maxOf = (radii: Readonly<Record<string, number>>) => Math.max(...Object.values(radii));
  switch (representation) {
    case "space-fill": {
      const model = spaceFillModel(structure, coordination);
      return { model, atomRadius: model.radii, bondRadius: 0, showBonds: false, showPolyhedra: false, cellEmphasis: 0.35, forceCell: false, framingPadding: maxOf(model.radii) };
    }
    case "wireframe":
      return { model: display, atomRadius: scaled(display.radii, 0.3), bondRadius: 0.04, showBonds: true, showPolyhedra: false, cellEmphasis: 0.85, forceCell: false, framingPadding: 0.2 };
    case "polyhedra":
      return { model: display, atomRadius: scaled(display.radii, 0.78), bondRadius: 0.04, showBonds: false, showPolyhedra: true, cellEmphasis: 0.55, forceCell: false, framingPadding: 0.45 };
    case "unit-cell":
      return { model: display, atomRadius: scaled(display.radii, 0.9), bondRadius: 0.08, showBonds: true, showPolyhedra: false, cellEmphasis: 1, forceCell: true, framingPadding: 0.5 };
    case "ball-stick":
    default:
      return { model: display, atomRadius: display.radii, bondRadius: 0.09, showBonds: true, showPolyhedra: false, cellEmphasis: 0.6, forceCell: false, framingPadding: 0.5 };
  }
}

/** The preset's finish on a style: display-scale spheres and bonds are scaled, physical radii never are. */
export function presetStyle(style: RepresentationStyle, preset: { readonly display: { readonly atomScale: number; readonly bondScale: number } }): RepresentationStyle {
  const { atomScale, bondScale } = preset.display;
  if (style.model.physical || (atomScale === 1 && bondScale === 1)) return style;
  return { ...style, atomRadius: scaled(style.atomRadius, atomScale), bondRadius: style.bondRadius * bondScale };
}
