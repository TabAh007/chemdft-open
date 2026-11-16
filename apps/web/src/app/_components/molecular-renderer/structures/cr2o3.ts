import reference from "../../home/reference/cr2o3-reference.json";
import type { ScientificStructure, Vec3 } from "../types";
import { periodicStructure } from "./build";

/**
 * α-Cr₂O₃ (eskolaite), COD 9014036 — the same validated reference the homepage already cites. The lattice and the
 * 30 symmetry-expanded fractional sites are read unchanged from `home/reference/cr2o3-reference.json`, which
 * `tools/homepage_reference_structure.py` generated from the CIF through ChemDFT's pymatgen path and which the
 * unit tests re-derive independently from the CIF's symmetry operators. Nothing here is a calculation.
 */
const SITES = (reference.sites as unknown as { element: string; fractional: Vec3 }[]).map((site) => ({ element: site.element, fractional: site.fractional }));

/** Cr–O distances in this structure are 1.96 and 2.01 Å; the next shell is beyond 2.6 Å. */
export const CR2O3_BOND_CUTOFF = 2.3;

export const CR2O3_STRUCTURE: ScientificStructure = periodicStructure({
  id: "cod-9014036-cr2o3",
  title: "Reference α-Cr₂O₃ (eskolaite) crystal structure",
  formula: "Cr₂O₃",
  parameters: {
    a: reference.lattice.a,
    b: reference.lattice.b,
    c: reference.lattice.c,
    alpha: reference.lattice.alpha,
    beta: reference.lattice.beta,
    gamma: reference.lattice.gamma,
  },
  sites: SITES,
  displayBondRule: { pairs: [{ a: "Cr", b: "O", maxDistance: CR2O3_BOND_CUTOFF }], label: `Cr–O ≤ ${CR2O3_BOND_CUTOFF.toFixed(1)} Å (display bonds, inferred)` },
  coordinationRules: [{ center: "Cr", ligand: "O", maxDistance: CR2O3_BOND_CUTOFF, expectedCount: 6, label: "CrO₆: the six O within 2.3 Å of each Cr" }],
  oxidationStates: { Cr: 3, O: -2 },
  provenance: {
    kind: "reference-structure",
    label: "Reference structure for illustration",
    source: {
      name: "Crystallography Open Database",
      id: "COD 9014036",
      url: "https://www.crystallography.net/cod/9014036.html",
      citation: "H. Sawada, Mater. Res. Bull. 29, 239–245 (1994), doi:10.1016/0025-5408(94)90019-1",
      licence: "COD data are dedicated to the public domain (CC0); the original authors are acknowledged as the CIF requests.",
    },
    note: "Independently sourced reference structure. It is not the refined structure of any ChemDFT sample or of any specific study.",
  },
});
