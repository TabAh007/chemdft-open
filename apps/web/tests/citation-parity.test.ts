import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LATEST_RELEASE } from "../src/content/releases";
import { calculationApa, calculationBibTeX, type CitationFacts } from "../src/lib/calculation-citation";
import { CITATION_METADATA, formatApa, formatBibTeX, formatPlainText, formatRis, type CitationMetadata } from "../src/lib/citation";
import SOFTWARE from "../../../services/api/src/chemdft_api/data/software_citation.json";

/**
 * Parity with the Python exporters (services/api/src/chemdft_api/citation_block.py). Both sides build every case of the shared golden
 * file from the same facts; the expected text is what the web Cite panel shows. Regenerate only on purpose:
 *   CITATION_PARITY_WRITE=1 pnpm exec vitest run tests/citation-parity.test.ts
 */
const FIXTURE = resolve(__dirname, "../../../services/api/tests/fixtures/contracts/citation_parity.json");

const facts = (over: Partial<CitationFacts>): CitationFacts => ({
  calculationId: "11111111-2222-4333-8444-555555555555", jobId: "job-1", year: 2026, createdAt: null, task: "Single-point energy", method: "HF", basis: "STO-3G", charge: 0, multiplicity: 1,
  structure: { versionId: null, revision: null, inputSha256: "a".repeat(64) },
  engine: { name: "pyscf", version: "2.14.0", adapterVersion: "1.0.0", backend: "LOCAL_PROCESS", hardware: null, environmentDigest: null, libraries: [] },
  platform: null, firewall: null, appVersion: "0.0.28", softwareDoi: null, ...over,
});

const meta = (over: Partial<CitationMetadata>): CitationMetadata => ({ ...CITATION_METADATA, version: "0.0.28", dateReleased: "2026-11-09", doi: null, ...over });

const CASES = {
  calculations: [
    { name: "full record, no software DOI", facts: facts({}) },
    { name: "minimal record: no job, no engine, no basis, no year", facts: facts({ jobId: null, year: null, basis: null, engine: null }) },
    { name: "characters BibTeX must escape", facts: facts({ method: "wB97X_D", basis: "def2-SVP&aug%", task: "Geometry optimization" }) },
    { name: "software DOI set", facts: facts({ softwareDoi: "10.5281/zenodo.0000000" }) },
  ],
  software: [
    { name: "no DOI", meta: meta({}) },
    { name: "DOI set", meta: meta({ doi: "10.5281/zenodo.0000000" }) },
  ],
};

// The Python side takes flat facts.
const flat = (f: CitationFacts) => ({ calculationId: f.calculationId, jobId: f.jobId, year: f.year, task: f.task, method: f.method, basis: f.basis, inputSha256: f.structure.inputSha256, engineName: f.engine?.name ?? null, engineVersion: f.engine?.version ?? null, appVersion: f.appVersion, softwareDoi: f.softwareDoi });
const software = (m: CitationMetadata) => ({ title: m.title, version: m.version, date_released: m.dateReleased, doi: m.doi, repository_code: m.repositoryCode, url: m.url, authors: m.authors.map((a) => ({ given_names: a.givenNames, family_names: a.familyNames, orcid: a.orcid })) });

function build() {
  return {
    _comment: "Golden record shared by apps/web/tests/citation-parity.test.ts and services/api/tests/test_citation_block.py. The expected text is what the web Cite panel builds. DOI values here are FAKE test strings, never a real DOI.",
    calculations: CASES.calculations.map((c) => ({ name: c.name, facts: flat(c.facts), apa: calculationApa(c.facts, null), bibtex: calculationBibTeX(c.facts, null) })),
    software: CASES.software.map((c) => ({ name: c.name, meta: software(c.meta), apa: formatApa(c.meta), bibtex: formatBibTeX(c.meta) })),
  };
}

describe("citation parity with the Python exporters", () => {
  it("matches the shared golden file", () => {
    const built = build();
    if (process.env.CITATION_PARITY_WRITE === "1") writeFileSync(FIXTURE, JSON.stringify(built, null, 2) + "\n");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(built);
  });

  it("software metadata file equals the newest release and carries the real DOI", () => {
    expect(SOFTWARE.version).toBe(LATEST_RELEASE.version);
    expect(SOFTWARE.date_released).toBe(LATEST_RELEASE.date);
    expect(CITATION_METADATA.doi).toBe("10.5281/zenodo.24082321");
    expect(formatApa()).toContain("https://doi.org/10.5281/zenodo.24082321");
    expect(formatBibTeX()).toContain("doi = {10.5281/zenodo.24082321}");
  });

  it("every software citation format prints the website URL and never github.com (the repository is private)", () => {
    for (const text of [formatApa(), formatBibTeX(), formatRis(), formatPlainText()]) {
      expect(text).toContain("https://chemdft.com");
      expect(text).not.toContain("github.com");
    }
  });

  it("prints the DOI in the software citation when one is set, and references it from the calculation citation", () => {
    const m = meta({ doi: "10.5281/zenodo.24082321" });
    expect(formatApa(m)).toContain("https://doi.org/10.5281/zenodo.24082321");
    expect(formatBibTeX(m)).toContain("doi = {10.5281/zenodo.24082321}");
    expect(calculationBibTeX(facts({ softwareDoi: m.doi }), null)).toContain("software DOI https://doi.org/10.5281/zenodo.24082321");
  });
});
