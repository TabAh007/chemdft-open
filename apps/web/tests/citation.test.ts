import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUPPORT_EMAIL } from "../src/content/legal";
import {
  CITATION_METADATA,
  formatApa,
  formatBibTeX,
  SOFTWARE_CITATION_FORMATS,
  softwareCitation,
  versionPrecisionNote,
} from "../src/lib/citation";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

describe("Citation metadata and string formatting", () => {
  it("formats BibTeX with author, title, ORCID, website URL, real DOI, and no email", () => {
    const bibtex = formatBibTeX();
    const primaryAuthor = CITATION_METADATA.authors[0]!;

    // Contains author, title, ORCID, and the public website URL (never the private repository)
    expect(bibtex).toContain(primaryAuthor.givenNames);
    expect(bibtex).toContain(primaryAuthor.familyNames);
    expect(bibtex).toContain(CITATION_METADATA.title);
    expect(bibtex).toContain(primaryAuthor.orcid!);
    expect(bibtex).toContain(CITATION_METADATA.url);
    expect(bibtex).not.toContain(CITATION_METADATA.repositoryCode);

    // Contains the real software DOI
    expect(bibtex).toContain(`doi = {${CITATION_METADATA.doi}}`);

    // Contains no email address
    expect(bibtex).not.toMatch(EMAIL_REGEX);
  });

  it("formats APA with author, title, ORCID, website URL, real DOI, and no email", () => {
    const apa = formatApa();
    const primaryAuthor = CITATION_METADATA.authors[0]!;

    // Contains author, title, ORCID, and the public website URL (never the private repository)
    expect(apa).toContain(primaryAuthor.givenNames);
    expect(apa).toContain(primaryAuthor.familyNames);
    expect(apa).toContain(CITATION_METADATA.title);
    expect(apa).toContain(primaryAuthor.orcid!);
    expect(apa).toContain(CITATION_METADATA.url);
    expect(apa).not.toContain(CITATION_METADATA.repositoryCode);

    // Contains the real software DOI URL
    expect(apa).toContain(`https://doi.org/${CITATION_METADATA.doi}`);

    // Contains no email address
    expect(apa).not.toMatch(EMAIL_REGEX);
  });

  it("verifies the CITATION.cff root file: required fields, version and date from the latest release, open-group licence, author email is the public contact address", () => {
    const cffPath = resolve(__dirname, "../../../CITATION.cff");
    const cffContent = readFileSync(cffPath, "utf-8");

    expect(cffContent).toContain("cff-version: 1.2.0");
    expect(cffContent).toContain("title: ChemDFT");
    expect(cffContent).toContain("Tabriz");
    expect(cffContent).toContain("Ahmadli");
    expect(cffContent).toContain("https://orcid.org/0009-0006-0198-5253");
    expect(cffContent).toContain("https://github.com/TabAh007/chemdft-open");

    // The licence covers the open group only (LICENSE.md); version and date are checked against content/releases.ts in releases.test.ts.
    expect(cffContent).toMatch(/^license: Apache-2\.0$/m);
    expect(cffContent).toMatch(/^version: /m);
    expect(cffContent).toMatch(/^date-released: /m);
    // The author email is the public contact address; it is the only email in the file.
    expect(cffContent.match(new RegExp(EMAIL_REGEX.source, "g"))).toEqual([SUPPORT_EMAIL]);
    expect(cffContent).toMatch(new RegExp(`^    email: ${SUPPORT_EMAIL.replace(/\./g, "\\.")}$`, "m"));
  });

  it("prints the website URL and never github.com in any citation format (the repository is private)", () => {
    expect(CITATION_METADATA.url).toBe("https://chemdft.com");
    for (const { key } of SOFTWARE_CITATION_FORMATS) {
      const { text } = softwareCitation(key);
      expect(text).toContain("https://chemdft.com");
      expect(text).not.toContain("github.com");
    }
  });

  it("puts the release version in both citation formats", () => {
    expect(formatBibTeX()).toContain(`version = {${CITATION_METADATA.version}}`);
    expect(formatApa()).toContain(`Version ${CITATION_METADATA.version}`);
  });

  it("clarifies version precision with newest archived version for unarchived 0.0.58 and 0.0.59", () => {
    expect(versionPrecisionNote("0.0.57")).toBeNull();
    expect(versionPrecisionNote("0.0.53")).toBeNull();
    const note58 = versionPrecisionNote("0.0.58");
    expect(note58).toContain("Version 0.0.58 has no archived Zenodo version DOI yet");
    expect(note58).toContain("10.5281/zenodo.24082321");
    expect(note58).toContain("newest archived version: 0.0.57");
    const note59 = versionPrecisionNote("0.0.59");
    expect(note59).toContain("Version 0.0.59 has no archived Zenodo version DOI yet");
    expect(note59).toContain("10.5281/zenodo.24082321");
    expect(note59).toContain("newest archived version: 0.0.57");
  });
});
