/**
 * Static starter structures. SMILES are written by hand from the standard identities of the molecules;
 * Ketcher/Indigo lays them out. `formula` is the Hill formula that Indigo's gross-formula calculation must
 * return for the loaded drawing (checked in the browser by tests/e2e/molecule-editor-flow.spec.ts), so a
 * wrong entry fails a test rather than reaching a researcher.
 */
export type StructureTemplate = { id: string; label: string; smiles: string; formula: string; featured: boolean };

export const STRUCTURE_TEMPLATES: readonly StructureTemplate[] = [
  { id: "water", label: "Water", smiles: "O", formula: "H2 O", featured: true },
  { id: "ethanol", label: "Ethanol", smiles: "CCO", formula: "C2 H6 O", featured: true },
  { id: "benzene", label: "Benzene", smiles: "c1ccccc1", formula: "C6 H6", featured: true },
  { id: "methane", label: "Methane", smiles: "C", formula: "C H4", featured: false },
  { id: "ammonia", label: "Ammonia", smiles: "N", formula: "H3 N", featured: false },
  { id: "acetic-acid", label: "Acetic acid", smiles: "CC(=O)O", formula: "C2 H4 O2", featured: false },
  { id: "acetone", label: "Acetone", smiles: "CC(=O)C", formula: "C3 H6 O", featured: false },
  { id: "toluene", label: "Toluene", smiles: "Cc1ccccc1", formula: "C7 H8", featured: false },
  { id: "caffeine", label: "Caffeine", smiles: "Cn1cnc2c1c(=O)n(C)c(=O)n2C", formula: "C8 H10 N4 O2", featured: false },
] as const;
