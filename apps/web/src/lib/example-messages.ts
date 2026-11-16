import type { Locale } from "@chemdft/i18n";

const messages: Record<string, string> = {
  staticRadius: "Static drawing uses display sizes, not physical atomic radii.",
  legend: "Elements shown",
  title: "Scientific examples",
  intro:
    "Inspect a sourced reference structure. Keep its provenance when you make it your own project.",
  catalogue: "Examples",
  home: "ChemDFT home",
  open: "Open example",
  sealed: "Sealed reference · read-only",
  copy: "Copy to my projects",
  copying: "Copying structure…",
  signIn: "Sign in to copy",
  copyNote:
    "Creates a normal project with this reference structure and its source provenance. No calculation runs on copy.",
  reference: "Reference structure",
  noResults: "No calculated results",
  source: "Structure source",
  citation: "Publication / citation",
  licence: "Reuse basis",
  sourceHash: "Original source SHA-256",
  sourceFile: "Download original structure",
  review: "Source verification date",
  atoms: "Atoms in the source cell / molecule",
  formula: "Formula",
  group: "Space group",
  origin: "Data class",
  imported: "IMPORTED · validated source structure",
  provenance: "Source and provenance",
  context: "Related research context",
  coordinateNote:
    "These coordinates come from the named reference source. Visualization does not produce a quantum result.",
  view: "Structure inspection",
  representation: "Representation",
  extent: "Display supercell",
  preset: "Presentation",
  labels: "Atom labels",
  reset: "Reset view",
  cell: "Unit-cell edges",
  fallback:
    "Static view of the same reference geometry. Interactive 3D is unavailable; coordinates and source metadata remain readable below.",
  help: "Drag to rotate; scroll to zoom. With the 3D view focused, use arrow keys to rotate, +/− to zoom, and 0 to reset.",
  polyhedra:
    "Coordination geometry: CrO₆, six O within 2.3 Å of each Cr. Display only; no periodic DFT or quantum calculation. The authenticated workspace currently provides structure, unit-cell and supercell inspection.",
  coordinates: "Source coordinates",
  coordinatesNote:
    "Fractional coordinates use the original non-orthogonal crystallographic cell. Molecular coordinates are Cartesian Å.",
  author: "Original scientific importer",
  parser: "Parser / adapter",
  version: "Template version",
  navigation: "Example navigation",
  unavailable:
    "Examples are temporarily unavailable. Retry this page when the API is available.",
  empty: "No published examples are currently available.",
};
export function exampleMessage(_locale: Locale, key: string): string {
  return messages[key] ?? key;
}
