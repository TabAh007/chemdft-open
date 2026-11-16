// The one definition of the software metadata, shared with the Python exporters (chemdft_api/citation_block.py).
import SOFTWARE from "../../../../services/api/src/chemdft_api/data/software_citation.json";

/**
 * Software citation metadata and deterministic formatting.
 *
 * Grounded in repository-level CITATION.cff without invented DOIs, versions, or unverified affiliations.
 * In accordance with docs/02_SCIENTIFIC_INTEGRITY.md and docs/TECHNOLOGY_REGISTRY.md.
 */

export interface AuthorMetadata {
  givenNames: string;
  familyNames: string;
  affiliation?: string;
  orcid?: string;
}

export interface CitationMetadata {
  title: string;
  type: string;
  /** Derived from the latest release (content/releases.ts). */
  version: string;
  dateReleased: string;
  authors: AuthorMetadata[];
  /** The code repository is private, so no citation format prints it; every format prints `url` (the public website). */
  repositoryCode: string;
  url: string;
  abstract: string;
  keywords: string[];
  /** The software DOI. `null` until the owner sets it in software_citation.json; while null no citation prints a DOI. */
  doi: string | null;
  license: string;
}

export const CITATION_METADATA: CitationMetadata = {
  title: SOFTWARE.title,
  type: SOFTWARE.type,
  version: SOFTWARE.version,
  dateReleased: SOFTWARE.date_released,
  authors: SOFTWARE.authors.map((a) => ({ givenNames: a.given_names, familyNames: a.family_names, affiliation: a.affiliation, orcid: a.orcid })),
  repositoryCode: SOFTWARE.repository_code,
  url: SOFTWARE.url,
  abstract: SOFTWARE.abstract,
  keywords: SOFTWARE.keywords,
  doi: SOFTWARE.doi,
  license: SOFTWARE.license,
};

function findNewestArchivedVersion(meta: typeof SOFTWARE): string | null {
  const versions: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    const match = key.match(/^snapshot_(\d+)_(\d+)_(\d+)_version_doi$/);
    if (match && typeof value === "string" && value.length > 0) {
      versions.push(`${match[1]}.${match[2]}.${match[3]}`);
    }
  }
  versions.sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    }
    return 0;
  });
  return versions.length > 0 ? versions[versions.length - 1] ?? null : null;
}

/**
 * Returns a statement clarifying version precision when an app version has no archived Zenodo version DOI.
 * Reads software_citation.json; never invents a DOI.
 */
export function versionPrecisionNote(version: string = CITATION_METADATA.version): string | null {
  const vKey = `snapshot_${version.replace(/\./g, "_")}_version_doi` as keyof typeof SOFTWARE;
  const versionDoi = vKey in SOFTWARE ? (SOFTWARE[vKey] as string | null) : null;
  if (versionDoi) return null;
  if (CITATION_METADATA.doi) {
    const newest = findNewestArchivedVersion(SOFTWARE);
    const newestSuffix = newest ? ` (newest archived version: ${newest})` : "";
    return `Version ${version} has no archived Zenodo version DOI yet; citing the all-versions concept DOI ${CITATION_METADATA.doi}${newestSuffix}`;
  }
  return null;
}

const doiUrl = (doi: string) => `https://doi.org/${doi}`;

/**
 * Format software citation in standard BibTeX (@software).
 * Contains author, title, ORCID, and website URL a DOI only when software_citation.json carries one (never invented).
 */
export function formatBibTeX(meta: CitationMetadata = CITATION_METADATA): string {
  const author = meta.authors
    .map((a) => `${a.familyNames}, ${a.givenNames}`)
    .join(" and ");
  const orcid = meta.authors.find((a) => a.orcid)?.orcid;

  const lines = [
    `@software{chemdft,`,
    `  author = {${author}},`,
    `  title = {${meta.title}},`,
    `  version = {${meta.version}},`,
    `  year = {${meta.dateReleased.slice(0, 4)}},`,
    ...(meta.doi ? [`  doi = {${meta.doi}},`] : []),
    `  url = {${meta.url}},`,
  ];
  if (orcid) {
    lines.push(`  note = {ORCID: ${orcid}}`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

/**
 * Format software citation in APA 7th edition style.
 * Contains author (Ahmadli, Tabriz), title (ChemDFT), ORCID, and website URL a DOI only when software_citation.json carries one (never invented).
 */
export function formatApa(meta: CitationMetadata = CITATION_METADATA): string {
  const primaryAuthor = meta.authors[0];
  const authorStr = primaryAuthor
    ? `${primaryAuthor.familyNames}, ${primaryAuthor.givenNames}`
    : meta.title;
  const orcid = primaryAuthor?.orcid;
  const orcidSuffix = orcid ? ` (ORCID: ${orcid})` : "";
  return `${authorStr}. (${meta.dateReleased.slice(0, 4)}). ${meta.title} (Version ${meta.version}) [Computer software]. ${meta.url}${meta.doi ? ` ${doiUrl(meta.doi)}` : ""}${orcidSuffix}`;
}

/** RIS for the software (same metadata as BibTeX/APA, website URL; no e-mail). */
export function formatRis(meta: CitationMetadata = CITATION_METADATA): string {
  const lines = [
    "TY  - COMP",
    ...meta.authors.map((a) => `AU  - ${a.familyNames}, ${a.givenNames}`),
    `TI  - ${meta.title}`,
    `PY  - ${meta.dateReleased.slice(0, 4)}`,
    `ET  - ${meta.version}`,
    `UR  - ${meta.url}`,
    ...(meta.doi ? [`DO  - ${meta.doi}`] : []),
    "ER  - ",
  ];
  return lines.join("\n");
}

/** Plain text for the software: author, year, title, version, website URL. */
export function formatPlainText(meta: CitationMetadata = CITATION_METADATA): string {
  const authors = meta.authors.map((a) => `${a.familyNames}, ${a.givenNames}`).join("; ");
  return `${authors}. ${meta.title}, version ${meta.version}, ${meta.dateReleased.slice(0, 4)}. ${meta.url}${meta.doi ? ` ${doiUrl(meta.doi)}` : ""}`;
}

export const SOFTWARE_CITATION_FORMATS = [
  { key: "apa", label: "APA" },
  { key: "bibtex", label: "BibTeX" },
  { key: "ris", label: "RIS" },
  { key: "plain", label: "Plain text" },
] as const;
export type SoftwareCitationFormat = (typeof SOFTWARE_CITATION_FORMATS)[number]["key"];

/** The software citation in one format. A format that does not exist for software (Methods, engine references, JSON) falls back to APA. */
export function softwareCitation(format: string, meta: CitationMetadata = CITATION_METADATA): { format: SoftwareCitationFormat; text: string } {
  switch (format) {
    case "bibtex": return { format: "bibtex", text: formatBibTeX(meta) };
    case "ris": return { format: "ris", text: formatRis(meta) };
    case "plain": return { format: "plain", text: formatPlainText(meta) };
    default: return { format: "apa", text: formatApa(meta) };
  }
}

/** The last-used citation format is remembered per browser (never needed for correctness). */
export const CITE_FORMAT_STORAGE_KEY = "chemdft:cite-format";
export const DEFAULT_CITE_FORMAT = "apa";
