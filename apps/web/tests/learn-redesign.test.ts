import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELP_ARTICLES } from "../src/lib/help-articles";
import { HELP_MESSAGES } from "../src/lib/help-messages";
import { HELP_TOPICS, helpHref } from "../src/lib/help-topics";
import {
  GETTING_STARTED,
  GUIDES,
  LEARN_CATEGORIES,
  TOPIC_META,
  buildSearchIndex,
  categoryOf,
  guideById,
  guideForTopic,
  highlightSegments,
  isGuideId,
  normalizeSearchText,
  queryTokens,
  searchLearn,
} from "../src/lib/learn-content";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = buildSearchIndex();
const top = (query: string) => searchLearn(index, query).map((hit) => hit.entry.id);

describe("Learn information architecture", () => {
  it("keeps every existing topic exactly once, in the requested four categories and order", () => {
    const listed = LEARN_CATEGORIES.flatMap((category) => category.topics);
    expect([...listed].sort()).toEqual(HELP_TOPICS.map((topic) => topic.id).sort());
    expect(new Set(listed).size).toBe(16);
    expect(LEARN_CATEGORIES.map((category) => category.id)).toEqual(["structure", "calculation", "spectra", "integrity"]);
    expect(LEARN_CATEGORIES.map((category) => category.accent)).toEqual(["teal", "blue", "orange", "indigo"]);
    expect(LEARN_CATEGORIES[0]!.topics.map((id) => HELP_MESSAGES[id].title)).toEqual(["Charge", "Spin multiplicity", "Unit cells", "Supercell viewing"]);
    expect(LEARN_CATEGORIES[1]!.topics.map((id) => HELP_MESSAGES[id].title)).toEqual([
      "Electronic-structure method",
      "Basis sets",
      "Geometry optimization",
      "Frequency calculations",
      "Thermochemistry prerequisites",
      "HOMO / LUMO",
    ]);
    expect(LEARN_CATEGORIES[2]!.topics.map((id) => HELP_MESSAGES[id].title)).toEqual(["Infrared spectra", "Raman spectra", "UV/Vis spectra", "Experimental spectra and association"]);
    expect(LEARN_CATEGORIES[3]!.topics.map((id) => HELP_MESSAGES[id].title)).toEqual(["Scientific provenance", "AI and scientific authority"]);
  });
  it("places every topic in the category that matches its stored group, and preserves the article routes", () => {
    for (const topic of HELP_TOPICS) {
      expect(categoryOf(topic.id).id).toBe(topic.group);
      expect(helpHref("en", topic.id)).toBe(`/en/learn/${topic.id}`);
    }
  });
  it("relates topics only to real topics and never to themselves", () => {
    for (const topic of HELP_TOPICS) {
      const { related } = TOPIC_META[topic.id];
      expect(related.length).toBeGreaterThan(0);
      for (const id of related) {
        expect(id).not.toBe(topic.id);
        expect(Object.hasOwn(HELP_MESSAGES, id)).toBe(true);
      }
    }
  });
  it("labels capability limits only where the article itself states them", () => {
    expect(TOPIC_META["crystal.unit_cell"].capability?.text).toMatch(/periodic DFT of crystals with two engines/);
    expect(HELP_ARTICLES["crystal.unit_cell"].prerequisite).toMatch(/Cell relaxation, stress or pressure, phonons, hybrid functionals/);
    expect(TOPIC_META["structure.charge"].capability).toBeUndefined();
    expect(TOPIC_META["provenance.authority"].capability).toBeUndefined();
    expect(TOPIC_META["calculation.frequency"].capability?.title).toMatch(/Hosted frequency analysis: verified for one case/);
    expect(TOPIC_META["electronic.homo_lumo"].capability?.title).toMatch(/Hosted molecular orbitals: run on AWS for one case/);
    expect(TOPIC_META["thermochemistry.frequency_requirement"].capability?.title).toMatch(/Hosted thermochemistry: verified for one case/);
    expect(TOPIC_META["calculation.method"].capability?.title).toMatch(/Verified on AWS/);
  });
});

describe("capability copy stays true to the code and the audited records", () => {
  const aws = read("../../../services/api/src/chemdft_api/aws_compute.py");
  const matrix = read("../../../docs/implementation/ENGINE_CAPABILITY_MATRIX.md");
  it("the hosted compute route accepts PySCF energy, optimization, frequency, thermochemistry and orbitals only, and Learn claims only the verified pairs", () => {
    // Allow-list: the six PySCF tasks (TDDFT is implemented but claimed as executed only once a job verified it) and xTB energy and optimization (the optimization is implemented, claimed as executed only once a job verified it).
    expect(aws).toMatch(/AWS_PYSCF_TASKS = frozenset\(\{\s*AWS_ENERGY_TASK, AWS_OPTIMIZATION_TASK, AWS_FREQUENCY_TASK, AWS_THERMOCHEMISTRY_TASK,\s*AWS_ORBITAL_TASK, AWS_TDDFT_TASK,\s*\}\)/);
    expect(aws).toContain("AWS_XTB_TASKS = frozenset({AWS_ENERGY_TASK, AWS_OPTIMIZATION_TASK})");
    expect(aws).toContain("AWS_VERIFIED_ENERGY_PAIRS");
    expect(TOPIC_META["calculation.optimization"].capability?.text).toMatch(/executed there only for B3LYP\/def2-SVP \(water\)/);
    expect(TOPIC_META["calculation.method"].capability?.text).toMatch(/Verified on AWS: HF\/STO-3G \(H2\), B3LYP\/def2-SVP \(water\), HF\/STO-3G \(water\) and PBE\/6-31G \(water\)/);
    expect(guideById("run-calculation").notice?.text).toMatch(/Verified on AWS: HF\/STO-3G/);
  });
  it("the workflows described as locally accepted are listed for the local PySCF worker, and periodic systems support PySCF and Quantum ESPRESSO periodic DFT", () => {
    for (const task of ["ENERGY", "PERIODIC_ENERGY", "GEOMETRY_OPTIMIZATION", "FREQUENCY", "ORBITAL", "TDDFT", "THERMOCHEMISTRY"]) expect(matrix).toContain(task);
    expect(TOPIC_META["crystal.unit_cell"].capability?.text).toMatch(/periodic DFT of crystals with two engines/);
  });
  it("no concept-only topic carries a capability banner", () => {
    for (const id of ["structure.charge", "structure.multiplicity", "spectra.experimental", "provenance.authority", "firewall.ai_vs_calculation"] as const)
      expect(TOPIC_META[id].capability).toBeUndefined();
  });
});

describe("Getting started guides", () => {
  it("offers three numbered tutorials that chain and resolve to real topics", () => {
    expect(GETTING_STARTED.map((guide) => [guide.number, guide.id])).toEqual([
      ["01", "prepare-structure"],
      ["02", "run-calculation"],
      ["03", "understand-results"],
    ]);
    expect(guideById("prepare-structure").next).toBe("run-calculation");
    expect(guideById("run-calculation").next).toBe("understand-results");
    expect(guideById("understand-results").next).toBeNull();
    for (const guide of GUIDES) {
      expect(isGuideId(guide.id)).toBe(true);
      expect(guide.steps.length).toBeGreaterThanOrEqual(5);
      for (const step of guide.steps) for (const topic of step.topics ?? []) expect(Object.hasOwn(HELP_MESSAGES, topic)).toBe(true);
    }
    expect(isGuideId("nope")).toBe(false);
  });
  it("sends every topic to a guide that exists", () => {
    for (const topic of HELP_TOPICS) expect(isGuideId(guideForTopic(topic.id))).toBe(true);
    expect(guideForTopic("structure.charge")).toBe("prepare-structure");
    expect(guideForTopic("calculation.basis")).toBe("run-calculation");
    expect(guideForTopic("spectra.ir")).toBe("understand-results");
    expect(guideForTopic("firewall.ai_vs_calculation")).toBe("scientific-authority");
  });
  it("contains no numeric scientific values, units or invented results", () => {
    const text = GUIDES.map((guide) => [guide.intro, ...guide.steps.map((step) => `${step.title} ${step.body}`), ...guide.boundaries].join(" ")).join(" ");
    expect(text).not.toMatch(/\d+\.\d+/);
    expect(text).not.toMatch(/\b(?:eV|kcal|kJ|Hartree|cm-1|cm⁻¹|Å|nm|THz)\b/);
    expect(text).not.toMatch(/doi\.org|10\.\d{4,}\//i);
  });
  it("states the authority classes without claiming independent verification", () => {
    const authority = guideById("scientific-authority");
    expect(authority.steps.map((step) => step.title)).toEqual(["User-supplied data", "Source-referenced data", "Calculated results", "AI explanations", "Validated results"]);
    expect(authority.steps.at(-1)!.body).toMatch(/does not mean independently verified/);
    expect(authority.steps.find((step) => step.title === "AI explanations")!.body).toMatch(/AI cannot write calculated values/);
  });
});

describe("Learn search", () => {
  it("indexes all topics and guides locally", () => {
    expect(index.filter((entry) => entry.kind === "topic").length).toBe(16);
    expect(index.filter((entry) => entry.kind === "guide").length).toBe(4);
  });
  it("normalises punctuation, case and accents", () => {
    expect(normalizeSearchText("UV/Vis")).toBe("uv vis");
    expect(normalizeSearchText("2S + 1")).toBe("2s 1");
    expect(normalizeSearchText("HOMO / LUMO")).toBe("homo lumo");
    expect(normalizeSearchText("Électronique")).toBe("electronique");
  });
  it("finds topics by title, keyword, category and article text, case-insensitively", () => {
    expect(top("basis")[0]).toBe("calculation.basis");
    expect(top("BASIS SETS")[0]).toBe("calculation.basis");
    expect(top("homo")[0]).toBe("electronic.homo_lumo");
    expect(top("uv/vis")[0]).toBe("spectra.uv_vis");
    expect(top("infrared")).toContain("spectra.ir");
    expect(top("2S+1")).toContain("structure.multiplicity");
    expect(top("hessian")).toContain("calculation.frequency");
    expect(top("stationarity")).toContain("thermochemistry.frequency_requirement");
    expect(top("spectra").filter((id) => id.startsWith("spectra."))).toHaveLength(4);
  });
  it("matches as you type (word prefixes) and requires every word", () => {
    expect(top("basi")).toContain("calculation.basis");
    expect(top("frequency optimization")).toContain("calculation.optimization");
    expect(top("charge zzzxq")).toEqual([]);
  });
  it("returns nothing for empty or unmatched queries and ranks title matches above article text", () => {
    expect(top("")).toEqual([]);
    expect(top("   ")).toEqual([]);
    expect(top("zzzxq")).toEqual([]);
    const hits = searchLearn(index, "multiplicity");
    expect(hits[0]!.entry.id).toBe("structure.multiplicity");
    expect(hits[0]!.matchedIn).toBe("title");
  });
  it("shows one whole, relevant sentence only when the match lives in the article text", () => {
    const hit = searchLearn(index, "stationarity").find((candidate) => candidate.entry.id === "thermochemistry.frequency_requirement")!;
    expect(hit.matchedIn).toBe("text");
    expect(hit.excerpt).toMatch(/stationarity/i);
    expect(hit.excerpt).toMatch(/^[A-Z0-9(]/);
    expect(hit.excerpt).toMatch(/[.!?…]$/);
    expect(hit.excerpt!.length).toBeLessThanOrEqual(421);
    expect(searchLearn(index, "charge").find((candidate) => candidate.entry.id === "structure.charge")!.excerpt).toBeNull();
  });
  it("never starts an excerpt mid-sentence, and every excerpt contains a query word", () => {
    for (const query of ["optimized", "converged", "provenance", "hash", "stationarity", "tolerance", "closed-shell", "association"]) {
      for (const hit of searchLearn(index, query)) {
        if (!hit.excerpt) continue;
        expect(hit.excerpt).not.toMatch(/^…|^\.\.\./);
        expect(hit.excerpt).toMatch(/^[A-Z0-9(]/);
        expect(normalizeSearchText(hit.excerpt)).toContain(normalizeSearchText(query).split(" ")[0]!.slice(0, 4));
      }
    }
  });
  it("explains a keyword-only match instead of showing an unrelated sentence", () => {
    const hit = searchLearn(index, "wavenumber").find((candidate) => candidate.entry.id === "spectra.ir")!;
    expect(hit.matchedIn).not.toBe("text");
    expect(hit.excerpt).toBeNull();
    expect(hit.via).toBe("wavenumber");
    // A keyword that the summary already shows needs no extra hint.
    expect(searchLearn(index, "hessian").find((candidate) => candidate.entry.id === "calculation.frequency")!.via).toBeNull();
  });
  it("highlights only the typed word prefixes", () => {
    const parts = highlightSegments("Basis sets and basic ideas", queryTokens("basi"));
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["Basi", "basi"]);
    expect(parts.map((part) => part.text).join("")).toBe("Basis sets and basic ideas");
    expect(highlightSegments("UV/Vis", queryTokens("uv")).filter((part) => part.match).map((part) => part.text)).toEqual(["UV"]);
  });
  it("finds the guides", () => {
    expect(top("tutorial")).toEqual(expect.arrayContaining(["prepare-structure", "run-calculation", "understand-results"]));
    expect(top("labels")).toContain("scientific-authority");
  });
});

describe("Learn page contracts", () => {
  const landing = read("../src/app/_components/learn/learn-landing.tsx");
  const illustrations = read("../src/app/_components/learn/learn-illustrations.tsx");
  const page = read("../src/app/[locale]/learn/page.tsx");
  const layout = read("../src/app/[locale]/learn/layout.tsx");
  const header = read("../src/app/_components/product-header.tsx");
  it("is a static knowledge base: no requests, no scientific or AI endpoints, no 3D engine", () => {
    for (const source of [landing, illustrations, page, read("../src/lib/learn-content.ts")]) {
      expect(source).not.toMatch(/fetch\(|XMLHttpRequest|\/api\/chemdft|useEffect\(/);
      expect(source).not.toMatch(/from "three|from "3dmol|from "echarts|WebGLRenderer|<canvas/);
      expect(source).not.toMatch(/calculation\.submit|ai-scientist|moonshot|nvidia/i);
    }
  });
  it("captions every non-molecular thumbnail as a schematic", () => {
    expect(landing).toContain("data-schematic");
    expect(page).toContain("schematic: true");
    expect(illustrations).toContain("Schematic");
  });
  it("uses the approved header with Learn marked as the current page", () => {
    expect(layout).toContain('<ProductHeader locale={locale} active="learn" layout="content" />');
    expect(header).toContain('aria-current={active === item.key ? "page" : undefined}');
    expect(header).toContain('isLocalDevelopment() ?');
  });
  it("keeps the topic data hooks the end-to-end suite relies on", () => {
    expect(landing).toContain("data-learn-topic");
    expect(landing).toContain("data-learn-guide");
    expect(read("../src/app/[locale]/learn/[topic]/page.tsx")).toContain("data-help-article");
  });
});
