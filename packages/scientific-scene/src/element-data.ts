import type { AtomColorScheme } from "./types";

type ElementVisual = {
  readonly atomicNumber: number;
  readonly covalentRadius: number;
  readonly vanDerWaalsRadius: number;
  readonly conventionalColor: string;
  readonly colorblindColor: string;
};

export const DEFAULT_ELEMENT_VISUAL: ElementVisual = {
  atomicNumber: 0,
  covalentRadius: 0.77,
  vanDerWaalsRadius: 1.7,
  conventionalColor: "#9aa4ad",
  colorblindColor: "#737373",
};

/**
 * Deterministic visualization data for common elements.
 *
 * Color source: conventional CPK/Jmol-style chemistry palette.
 * Radius source: Cordero et al. covalent radii and Bondi/commonly used
 * van der Waals radii, reduced here to the elements ChemDFT Phase 4 fixtures
 * and common organic/periodic structures exercise.
 */
export const ELEMENT_VISUALS: Readonly<Record<string, ElementVisual>> = {
  H: { atomicNumber: 1, covalentRadius: 0.31, vanDerWaalsRadius: 1.2, conventionalColor: "#ffffff", colorblindColor: "#f7f7f7" },
  B: { atomicNumber: 5, covalentRadius: 0.84, vanDerWaalsRadius: 1.92, conventionalColor: "#ffb5b5", colorblindColor: "#e6ab02" },
  C: { atomicNumber: 6, covalentRadius: 0.76, vanDerWaalsRadius: 1.7, conventionalColor: "#909090", colorblindColor: "#666666" },
  N: { atomicNumber: 7, covalentRadius: 0.71, vanDerWaalsRadius: 1.55, conventionalColor: "#3050f8", colorblindColor: "#0072b2" },
  O: { atomicNumber: 8, covalentRadius: 0.66, vanDerWaalsRadius: 1.52, conventionalColor: "#ff0d0d", colorblindColor: "#d55e00" },
  F: { atomicNumber: 9, covalentRadius: 0.57, vanDerWaalsRadius: 1.47, conventionalColor: "#90e050", colorblindColor: "#009e73" },
  P: { atomicNumber: 15, covalentRadius: 1.07, vanDerWaalsRadius: 1.8, conventionalColor: "#ff8000", colorblindColor: "#cc79a7" },
  S: { atomicNumber: 16, covalentRadius: 1.05, vanDerWaalsRadius: 1.8, conventionalColor: "#ffff30", colorblindColor: "#f0e442" },
  Cl: { atomicNumber: 17, covalentRadius: 1.02, vanDerWaalsRadius: 1.75, conventionalColor: "#1ff01f", colorblindColor: "#009e73" },
  Na: { atomicNumber: 11, covalentRadius: 1.66, vanDerWaalsRadius: 2.27, conventionalColor: "#ab5cf2", colorblindColor: "#cc79a7" },
  Mg: { atomicNumber: 12, covalentRadius: 1.41, vanDerWaalsRadius: 1.73, conventionalColor: "#8aff00", colorblindColor: "#009e73" },
  Al: { atomicNumber: 13, covalentRadius: 1.21, vanDerWaalsRadius: 1.84, conventionalColor: "#bfa6a6", colorblindColor: "#999999" },
  Si: { atomicNumber: 14, covalentRadius: 1.11, vanDerWaalsRadius: 2.1, conventionalColor: "#f0c8a0", colorblindColor: "#e69f00" },
  K: { atomicNumber: 19, covalentRadius: 2.03, vanDerWaalsRadius: 2.75, conventionalColor: "#8f40d4", colorblindColor: "#cc79a7" },
  Ca: { atomicNumber: 20, covalentRadius: 1.76, vanDerWaalsRadius: 2.31, conventionalColor: "#3dff00", colorblindColor: "#009e73" },
  Cr: { atomicNumber: 24, covalentRadius: 1.39, vanDerWaalsRadius: 2.0, conventionalColor: "#8a99c7", colorblindColor: "#56b4e9" },
  Fe: { atomicNumber: 26, covalentRadius: 1.24, vanDerWaalsRadius: 2.04, conventionalColor: "#e06633", colorblindColor: "#d55e00" },
  Cu: { atomicNumber: 29, covalentRadius: 1.32, vanDerWaalsRadius: 1.4, conventionalColor: "#c88033", colorblindColor: "#e69f00" },
  Zn: { atomicNumber: 30, covalentRadius: 1.22, vanDerWaalsRadius: 1.39, conventionalColor: "#7d80b0", colorblindColor: "#56b4e9" },
  Br: { atomicNumber: 35, covalentRadius: 1.2, vanDerWaalsRadius: 1.85, conventionalColor: "#a62929", colorblindColor: "#d55e00" },
  I: { atomicNumber: 53, covalentRadius: 1.39, vanDerWaalsRadius: 1.98, conventionalColor: "#940094", colorblindColor: "#cc79a7" },
};

export function elementVisual(element: string): ElementVisual {
  return ELEMENT_VISUALS[element] ?? DEFAULT_ELEMENT_VISUAL;
}

export function elementColor(element: string, scheme: AtomColorScheme): string {
  if (scheme === "monochrome") return "#6f7780";
  const visual = elementVisual(element);
  return scheme === "colorblind" ? visual.colorblindColor : visual.conventionalColor;
}

const METALS = new Set([
  "Li", "Be", "Na", "Mg", "Al", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
  "Ga", "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Cs", "Ba",
  "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta",
  "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "Fr", "Ra", "Ac", "Th", "Pa", "U",
]);

export function isMetal(element: string): boolean {
  return METALS.has(element);
}
