import { elementVisual, ELEMENT_VISUALS } from "@chemdft/scientific-scene";

/**
 * Element colours and radii. The central ChemDFT table (`@chemdft/scientific-scene`) is the first source;
 * the supplement below covers only elements that table does not yet have and that the renderer must draw.
 *
 * Cr: colour is the conventional Jmol/CPK value; covalent radius 1.39 Å is Cordero et al., Dalton Trans. 2008,
 * 2832 (Cr, low- and high-spin alike). No van der Waals radius is listed for Cr in the sources ChemDFT uses, so
 * none is invented: a van der Waals sphere model is simply unavailable for structures containing Cr.
 */
export type ElementDisplay = {
  readonly color: string;
  readonly colorblindColor: string;
  readonly covalentRadius: number;
  readonly vanDerWaalsRadius?: number;
  readonly source: "central-table" | "renderer-supplement";
};

const SUPPLEMENT: Readonly<Record<string, ElementDisplay>> = {
  Cr: { color: "#8a99c7", colorblindColor: "#56b4e9", covalentRadius: 1.39, source: "renderer-supplement" },
};

export function elementDisplay(element: string): ElementDisplay {
  const supplement = SUPPLEMENT[element];
  if (supplement) return supplement;
  const known = ELEMENT_VISUALS[element];
  const visual = elementVisual(element);
  return {
    color: visual.conventionalColor,
    colorblindColor: visual.colorblindColor,
    covalentRadius: visual.covalentRadius,
    ...(known ? { vanDerWaalsRadius: known.vanDerWaalsRadius } : {}),
    source: "central-table",
  };
}

export const hasElementData = (element: string): boolean => element in SUPPLEMENT || element in ELEMENT_VISUALS;
