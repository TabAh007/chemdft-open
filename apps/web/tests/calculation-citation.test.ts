// @vitest-environment jsdom
import type { CalculationDetail } from "@chemdft/schemas";
import { describe, expect, it, vi } from "vitest";

import { ENGINE_REFERENCES } from "../src/content/engine-citations";
import {
  NO_DOI_NOTE, calculationApa, calculationBibTeX, calculationPlain, calculationRis, citationAuthor, citationFacts, engineAttribution, figureCaption, methodsParagraph,
  referencesBibTeX, reproducibilityRecord,
} from "../src/lib/calculation-citation";
import type { OrcidStatus } from "../src/lib/orcid";

const ID = "11111111-2222-4333-8444-555555555555";
const HASH = "a".repeat(64);

function detail(engine = "pyscf", over: Record<string, unknown> = {}): CalculationDetail {
  return {
    calculation: { id: ID, created_at: "2026-11-02T10:00:00Z" },
    calculation_input_hash: HASH,
    specification: { task_type: "SINGLE_POINT_ENERGY", method: { identifier: "hf", display_name: "HF" }, basis: { identifier: "sto-3g", display_name: "STO-3G" }, charge: 0, multiplicity: 1 },
    compute_job: { id: "job-1", provider: "aws", structure_summary: { structure_version_id: "ver-1", structure_revision: 2, structure_name: "Private water name" } },
    result: {
      id: "res-1", result_type: "chemdft.energy", created_at: "2026-11-02T10:05:00Z", authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED", source_class: "CALCULATED",
      provenance_record_id: "prov-1", raw_artifacts: [{ sha256: "b".repeat(64) }],
      producer_software: { name: engine, version: "2.14.0", adapter_version: "1.0.0", execution_backend: "LOCAL_PROCESS", hardware_class: "CPU", environment_digest: "sha256:" + "c".repeat(64), library_versions: [] },
    },
    ...over,
  } as unknown as CalculationDetail;
}

const linked = (environment: string): OrcidStatus => ({ enabled: true, environment, linked: true, orcid_id: "0000-0002-1825-0097", record_url: null, verified_at: null, display_name: "Josiah Carberry" });

describe("Cite this calculation", () => {
  it("builds every format from the stored record only, deterministically, with the verified engine references", () => {
    const facts = citationFacts(detail());
    expect(citationFacts(detail())).toEqual(facts);
    const methods = methodsParagraph(facts);
    for (const fact of [ID, "job-1", HASH, "pyscf 2.14.0", "HF", "STO-3G", "ver-1", "VALIDATED", "AUTHORITATIVE", "aws"]) expect(methods.toLowerCase()).toContain(fact.toLowerCase());
    const bib = calculationBibTeX(facts, null);
    expect(bib).toContain("organization = {ChemDFT}");
    expect(bib).toContain(ID);
    expect(bib).not.toMatch(/doi\s*=/i);
    expect(calculationRis(facts, null)).toMatch(/^TY {2}- DATA/);
    expect(calculationApa(facts, null)).toContain("(2026)");
    expect(calculationPlain(facts, null)).not.toContain("Private project record");
    expect(NO_DOI_NOTE).toContain("No DOI yet");
    const attribution = engineAttribution(facts);
    expect(attribution.references.map((ref) => ref.doi)).toEqual(["10.1063/5.0337441", "10.1063/5.0006074", "10.1002/wcms.1340", "10.1002/jcc.23981"]);
    expect(referencesBibTeX(attribution)).toContain("doi = {10.1063/5.0006074}");
    // privacy: the structure name never appears in any output
    const everything = JSON.stringify([bib, methods, reproducibilityRecord(detail(), facts)]);
    expect(everything).not.toContain("Private water name");
    expect(reproducibilityRecord(detail(), facts)).toMatchObject({ schema: "chemdft.calculation-citation.v1", structure: { calculation_input_sha256: HASH } });
  });

  it("every engine reference has a DOI of the registry form and a project page it was taken from", () => {
    for (const ref of Object.values(ENGINE_REFERENCES)) {
      expect(ref.doi).toMatch(/^10\.\d{4,9}\/\S+$/);
      expect(ref.listedBy).toMatch(/^https:\/\//);
      expect(ref.title.length).toBeGreaterThan(10);
    }
  });

  it("adds the researcher's ORCID iD only when linked in production and chosen; a sandbox iD never appears", () => {
    const facts = citationFacts(detail());
    const author = citationAuthor(linked("production"), true);
    expect(author).toEqual({ name: "Josiah Carberry", orcidUrl: "https://orcid.org/0000-0002-1825-0097" });
    expect(calculationBibTeX(facts, author)).toContain("orcid = {https://orcid.org/0000-0002-1825-0097}");
    expect(citationAuthor(linked("production"), false)).toBeNull();
    expect(citationAuthor(linked("sandbox"), true)).toBeNull();
    expect(citationAuthor({ ...linked("production"), linked: false, orcid_id: null }, true)).toBeNull();
    expect(calculationBibTeX(facts, citationAuthor(linked("sandbox"), true))).not.toContain("0000-0002");
  });

  it("does not invent: an engine without a verified citation is flagged, and a missing result is 'no status'", () => {
    const qce = engineAttribution(citationFacts(detail("qcengine")));
    expect(qce.references).toEqual([]);
    expect(qce.unverified[0]).toMatch(/citation text not verified/);
    const psi4 = engineAttribution(citationFacts(detail("psi4")));
    expect(psi4.references.map((r) => r.doi)).toEqual(["10.1063/5.0006002"]);
    expect(psi4.unverified).toEqual([]);
    const d4 = engineAttribution(citationFacts(detail("dftd4")));
    expect(d4.references.map((r) => r.doi)).toEqual(["10.1063/1.4993215", "10.1063/1.5090222", "10.1039/D0CP00502A"]);
    const none = citationFacts(detail("pyscf", { result: null, compute_job: null }));
    expect(none.engine).toBeNull();
    expect(none.firewall).toBeNull();
    const methods = methodsParagraph(none);
    expect(methods).toContain("No published result is recorded");
    expect(methods).toContain("not recorded");
    expect(engineAttribution(none).references).toEqual([]);
  });

  it("cites PySCF, PBE, GTH and MOLOPT for periodic calculations, and adds Dudarev and Jain when +U and default U are used", () => {
    const periodicDetail = (hasPlusU: boolean, uMap?: Record<string, number>) =>
      detail("pyscf", {
        specification: {
          task_type: "PERIODIC_ENERGY",
          method: { identifier: hasPlusU ? "pbe+u" : "pbe", display_name: hasPlusU ? "PBE+U" : "PBE" },
          basis: { identifier: "gth-dzvp-molopt-sr", display_name: "GTH-DZVP-MOLOPT-SR" },
          charge: 0,
          multiplicity: 1,
          periodic: {
            k_mesh: "1x1x1",
            u_effective_ev: uMap ?? (hasPlusU ? { Cr: 3.7 } : {}),
            magnetic_order: "antiferromagnetic",
          },
        },
      });

    // 1. PBE without +U
    const factsNoU = citationFacts(periodicDetail(false));
    const attrNoU = engineAttribution(factsNoU);
    const doisNoU = attrNoU.references.map((r) => r.doi);
    expect(doisNoU).toContain("10.1063/5.0006074"); // Sun 2020
    expect(doisNoU).toContain("10.1002/wcms.1340"); // Sun 2018
    expect(doisNoU).toContain("10.1103/PhysRevLett.77.3865"); // PBE
    expect(doisNoU).toContain("10.1103/PhysRevB.54.1703"); // GTH 1996
    expect(doisNoU).toContain("10.1103/PhysRevB.58.3641"); // GTH 1998
    expect(doisNoU).toContain("10.1007/s00214-005-0655-y"); // Krack 2005
    expect(doisNoU).toContain("10.1063/1.2770708"); // MOLOPT 2007
    expect(doisNoU).not.toContain("10.1103/PhysRevB.57.1505"); // Dudarev
    expect(doisNoU).not.toContain("10.1103/PhysRevB.84.045115"); // Jain

    // 2. PBE+U with custom U (e.g. Cr=4.5, not default 3.7)
    const factsCustomU = citationFacts(periodicDetail(true, { Cr: 4.5 }));
    const attrCustomU = engineAttribution(factsCustomU);
    const doisCustomU = attrCustomU.references.map((r) => r.doi);
    expect(doisCustomU).toContain("10.1103/PhysRevB.57.1505"); // Dudarev
    expect(doisCustomU).not.toContain("10.1103/PhysRevB.84.045115"); // Jain not cited for non-default U

    // 3. PBE+U with default U (Cr=3.7 from Jain 2011)
    const factsDefaultU = citationFacts(periodicDetail(true, { Cr: 3.7 }));
    const attrDefaultU = engineAttribution(factsDefaultU);
    const doisDefaultU = attrDefaultU.references.map((r) => r.doi);
    expect(doisDefaultU).toContain("10.1103/PhysRevB.57.1505"); // Dudarev
    expect(doisDefaultU).toContain("10.1103/PhysRevB.84.045115"); // Jain 2011
  });

  it("builds a figure caption with DOI and details from the stored record (Part 3.3)", () => {
    const facts = citationFacts(detail("pyscf"));
    const caption = figureCaption(facts, { coordinatesOrigin: "Optimized coordinates from DFT trajectory" });
    expect(caption).toContain(`Structure rendered with ChemDFT ${facts.appVersion}`);
    if (facts.softwareDoi) {
      expect(caption).toContain(`(DOI https://doi.org/${facts.softwareDoi})`);
    }
    expect(caption).toContain("Coordinates: Optimized coordinates from DFT trajectory.");
    expect(caption).toContain("Calculated with pyscf 2.14.0, HF/STO-3G.");
    expect(caption).toContain("Evidence not independently verified.");
  });

  it("prints 'not recorded' in figure caption when facts are missing and omits DOI when null", () => {
    const raw = detail("pyscf", { result: null, compute_job: null });
    const facts = citationFacts(raw);
    facts.softwareDoi = null;
    facts.structure.versionId = null;
    facts.structure.inputSha256 = "";
    facts.method = "";
    facts.basis = null;
    const caption = figureCaption(facts);
    expect(caption).toContain(`Structure rendered with ChemDFT ${facts.appVersion}.`);
    expect(caption).not.toContain("DOI");
    expect(caption).toContain("Coordinates: not recorded.");
    expect(caption).toContain("Calculated with not recorded, not recorded.");
  });
});

import { SOFTWARE_CITATION_FORMATS, CITATION_METADATA, softwareCitation, CITE_FORMAT_STORAGE_KEY } from "../src/lib/citation";
import { CiteCalculation } from "../src/app/_components/cite-calculation";

describe("easy citation (0.0.25 third PR)", () => {
  it("the calculation citation stays a clean reference; the no-DOI note is separate and invents nothing", () => {
    const facts = citationFacts(detail());
    for (const text of [calculationApa(facts, null), calculationBibTeX(facts, null), calculationRis(facts, null), calculationPlain(facts, null)]) {
      expect(text).not.toMatch(/^\s*doi\s*=/im);
      expect(text).not.toContain("Private project record");
      expect(text).toContain(ID);
    }
    expect(NO_DOI_NOTE).toBe("No DOI yet and no public link: this is a private record in ChemDFT, identified by the calculation ID in the citation.");
    expect(methodsParagraph(facts)).toMatch(/Evidence status: .*\(not independently verified\)/);
    expect(methodsParagraph(facts)).toContain(`ChemDFT ${facts.appVersion}`);
  });

  it("the software citation exists in every software format from the citation metadata only", () => {
    expect(SOFTWARE_CITATION_FORMATS.map((f) => f.key)).toEqual(["apa", "bibtex", "ris", "plain"]);
    for (const { key } of SOFTWARE_CITATION_FORMATS) {
      const { text, format } = softwareCitation(key);
      expect(format).toBe(key);
      for (const part of [CITATION_METADATA.authors[0]!.familyNames, CITATION_METADATA.version, CITATION_METADATA.url, "ChemDFT"]) expect(text).toContain(part);
      expect(text).not.toContain("github.com");
      if (CITATION_METADATA.doi) {
        expect(text).toContain(CITATION_METADATA.doi);
      }
      expect(text).not.toMatch(/@chemdft\.com/i);
    }
    expect(softwareCitation("methods").format).toBe("apa");
    expect(softwareCitation("json").format).toBe("apa");
  });

  it("opens on the last-used format (APA by default) and remembers a change; works without storage", async () => {
    const { createElement, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.removeItem(CITE_FORMAT_STORAGE_KEY);
    const mount = async () => {
      const container = document.createElement("div"); document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => { root.render(createElement(CiteCalculation, { projectId: "p", calculationId: ID, detail: detail(), inline: true })); });
      await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="cite-toggle"]')!.click(); });
      return { container, root };
    };
    const first = await mount();
    expect(first.container.querySelector('[data-testid="cite-format-apa"]')!.getAttribute("aria-selected")).toBe("true");
    expect(first.container.querySelector('[data-testid="cite-output"]')!.textContent).toContain("Computational chemistry calculation record");
    expect(first.container.querySelector('[data-testid="cite-section-software"]')).not.toBeNull();
    expect(first.container.querySelector('[data-testid="cite-no-doi-note"]')!.textContent).toBe(NO_DOI_NOTE);
    await act(async () => { first.container.querySelector<HTMLButtonElement>('[data-testid="cite-format-bibtex"]')!.click(); });
    expect(window.localStorage.getItem(CITE_FORMAT_STORAGE_KEY)).toBe("bibtex");
    expect(first.container.querySelector('[data-testid="cite-software-output"]')!.textContent).toContain("@software{chemdft");
    await act(async () => { first.root.unmount(); });
    const second = await mount();
    expect(second.container.querySelector('[data-testid="cite-format-bibtex"]')!.getAttribute("aria-selected")).toBe("true");
    await act(async () => { second.root.unmount(); });
    // storage blocked: still renders, default APA
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const third = await mount();
    expect(third.container.querySelector('[data-testid="cite-format-apa"]')!.getAttribute("aria-selected")).toBe("true");
    spy.mockRestore();
    await act(async () => { third.root.unmount(); });
  });
});
