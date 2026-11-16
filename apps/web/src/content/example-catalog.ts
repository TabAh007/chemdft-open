/**
 * Static metadata catalog for public reference examples.
 * Sourced directly from examples/catalog.json in the repository.
 */
export interface PublicExampleMeta {
  slug: string;
  title: string;
  pageTitle: string;
  description: string;
  sourceIdentifier: string;
  reviewDate: string;
}

export const PUBLIC_EXAMPLES: readonly PublicExampleMeta[] = [
  {
    slug: "cr2o3-eskolaite",
    title: "α-Cr₂O₃ / Eskolaite",
    pageTitle: "α-Cr₂O₃ Eskolaite crystal reference | ChemDFT",
    description:
      "Inspect the reference crystal structure for α-Cr₂O₃ (eskolaite, COD 9014036) with authoritative coordinates and unit cell parameters in ChemDFT.",
    sourceIdentifier: "COD 9014036",
    reviewDate: "2026-10-07",
  },
  {
    slug: "benzene",
    title: "Benzene",
    pageTitle: "Benzene reference structure (C6H6) | ChemDFT",
    description:
      "Inspect the reference molecular structure for benzene (C6H6, PubChem CID 241) with vetted 3D coordinates and source provenance in ChemDFT.",
    sourceIdentifier: "PubChem CID 241",
    reviewDate: "2026-10-07",
  },
  {
    slug: "caffeine",
    title: "Caffeine",
    pageTitle: "Caffeine reference structure (C8H10N4O2) | ChemDFT",
    description:
      "Inspect the reference molecular structure for caffeine (C8H10N4O2, PubChem CID 2519) with vetted 3D coordinates and bond tables in ChemDFT.",
    sourceIdentifier: "PubChem CID 2519",
    reviewDate: "2026-10-07",
  },
] as const;

export function getPublicExample(slug: string): PublicExampleMeta | undefined {
  return PUBLIC_EXAMPLES.find((item) => item.slug === slug);
}
