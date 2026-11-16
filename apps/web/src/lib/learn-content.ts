// Learn information architecture, guides and the local search index. Server- and client-safe: no component imports.
// The article texts themselves stay in help-messages.ts / help-articles.ts (unchanged); this file only organises them.
import { HELP_ARTICLES } from "./help-articles";
import { HELP_MESSAGES, HELP_UI } from "./help-messages";
import { HELP_TOPICS, type HelpTopicId } from "./help-topics";
import { KS_GAP_NOTE, LOCAL_SPIN_LABEL, LOCAL_SPIN_TOOLTIP, QE_AFM_LOCAL_MINIMUM_NOTE, QE_LOCAL_SPIN_LABEL, QE_LOCAL_SPIN_TOOLTIP, U_DEFAULTS_NOTE } from "./periodic-wording";

export type LearnCategoryId = "structure" | "calculation" | "spectra" | "integrity";
export type LearnAccent = "teal" | "blue" | "orange" | "indigo";

export type LearnCategory = {
  id: LearnCategoryId;
  title: string;
  description: string;
  icon: "cube" | "cog" | "pulse" | "book";
  accent: LearnAccent;
  /** Display order requested for the library; every id exists in HELP_TOPICS. */
  topics: readonly HelpTopicId[];
};

export const LEARN_CATEGORIES: readonly LearnCategory[] = [
  {
    id: "structure",
    title: HELP_UI.structure,
    description: "Understand molecular and crystal structures, electronic states, and coordinate systems.",
    icon: "cube",
    accent: "teal",
    topics: ["structure.charge", "structure.multiplicity", "crystal.unit_cell", "crystal.supercell"],
  },
  {
    id: "calculation",
    title: HELP_UI.calculation,
    description: "Understand quantum chemistry methods, calculation settings, and interpretation.",
    icon: "cog",
    accent: "blue",
    topics: [
      "calculation.method",
      "calculation.basis",
      "calculation.optimization",
      "calculation.frequency",
      "thermochemistry.frequency_requirement",
      "electronic.homo_lumo",
    ],
  },
  {
    id: "spectra",
    title: HELP_UI.spectra,
    description: "Learn how measured and calculated spectroscopic information is interpreted and compared.",
    icon: "pulse",
    accent: "orange",
    topics: ["spectra.ir", "spectra.raman", "spectra.uv_vis", "spectra.experimental"],
  },
  {
    id: "integrity",
    title: HELP_UI.integrity,
    description: "Understand scientific evidence, reproducibility, data origins, and the limits of AI explanations.",
    icon: "book",
    accent: "indigo",
    topics: ["provenance.authority", "firewall.ai_vs_calculation"],
  },
];

export function categoryOf(topic: HelpTopicId): LearnCategory {
  const group = HELP_TOPICS.find((item) => item.id === topic)!.group;
  return LEARN_CATEGORIES.find((category) => category.id === group)!;
}

/* ------------------------------------------------------------------ per-topic metadata */

export type CapabilityNote = { tone: "limit" | "info"; title: string; text: string };

import { AWS_FREQUENCY_MAX_ATOMS, AWS_OPTIMIZATION_MAX_ATOMS, verifiedEnergyPairsText, verifiedFrequencyPairsText, verifiedOptimizationPairsText, verifiedTddftPairsText, verifiedThermochemistryPairsText, verifiedXtbEnergyPairsText, verifiedXtbOptimizationPairsText } from "./aws-verified";

/*
 * Capability copy is limited to what the repository can prove, and each note names its evidence:
 *  - Engines: docs/implementation/ENGINE_CAPABILITY_MATRIX.md (audited): the local PySCF worker accepts ENERGY,
 *    GEOMETRY_OPTIMIZATION, FREQUENCY, ORBITAL, TDDFT and THERMOCHEMISTRY. Periodic systems are not supported.
 *  - Hosted beta: services/api/src/chemdft_api/aws_compute.py::aws_supports_specification accepts PySCF ENERGY and
 *    GEOMETRY_OPTIMIZATION only; anything else is rejected on the hosted compute route. Only the pairs in
 *    lib/aws-verified.ts (energy, and optimization for B3LYP/def2-SVP water) have been executed there.
 *    tests/learn-redesign.test.ts fails if that function stops saying so, so this copy cannot silently go stale.
 */
const PERIODIC_NOTE: CapabilityNote = {
  tone: "info",
  title: "Periodic DFT (PySCF periodic and Quantum ESPRESSO)",
  text: "ChemDFT supports periodic DFT of crystals with two engines. PySCF periodic (localized Gaussian basis): single-point energy, PBE and PBE+U (Dudarev) on transition metals, collinear AFM/FM magnetism, Gamma-only on the hosted beta (a measured 10-atom Gamma job takes about 17 minutes; larger meshes would exceed the one-hour limit). Quantum ESPRESSO (plane waves, fixed SSSP PBE Efficiency v2.0 pseudopotentials and cutoffs): single-point energy, atom relaxation with the cell fixed, density of states and projected DOS, band structure along a high-symmetry path, and Lowdin local spin moments, with Gamma, 2x2x2, 3x3x3 or 4x4x4 meshes and at most 20 atoms. Not offered: cell relaxation, stress or pressure, phonons, hybrid functionals, noncollinear or spin-orbit calculations, molecular dynamics. " + QE_AFM_LOCAL_MINIMUM_NOTE + " " + U_DEFAULTS_NOTE + " " + KS_GAP_NOTE + " PySCF: " + LOCAL_SPIN_LABEL + ": " + LOCAL_SPIN_TOOLTIP + " Quantum ESPRESSO: " + QE_LOCAL_SPIN_LABEL + ": " + QE_LOCAL_SPIN_TOOLTIP,
};
const ENERGY_NOTE: CapabilityNote = {
  tone: "info",
  title: "Verified on AWS: single-point energy",
  text: `Verified on AWS: ${verifiedEnergyPairsText()} single-point energy. Other method and basis combinations are validated by ChemDFT and accepted by the hosted route, but have not been verified there. An xTB (semi-empirical GFN2) energy has also been run there, for ${verifiedXtbEnergyPairsText()}; its totals are on a different scale and must not be compared with the ab initio energies. A calculation runs only after you submit or approve it; Learn never starts one.`,
};
const OPTIMIZATION_NOTE: CapabilityNote = {
  tone: "limit",
  title: "Hosted geometry optimization: verified for one case",
  text: `The hosted beta's compute route accepts PySCF geometry optimization for closed-shell molecules of up to ${AWS_OPTIMIZATION_MAX_ATOMS} atoms, and it has been executed there only for ${verifiedOptimizationPairsText()}, so treat other molecules and methods as unverified. An xTB (semi-empirical GFN2) optimization has also been run there once, for ${verifiedXtbOptimizationPairsText()}; its energies are on a different scale from PySCF and must not be compared with them. Learn never starts a calculation.`,
};
const FREQUENCY_NOTE: CapabilityNote = {
  tone: "limit",
  title: "Hosted frequency analysis: verified for one case",
  text: `The hosted beta's compute route accepts PySCF frequency analysis (analytic Hessian) for closed-shell molecules of up to ${AWS_FREQUENCY_MAX_ATOMS} atoms, without Raman, and it has been executed there only for ${verifiedFrequencyPairsText()}, so treat other molecules and methods as unverified. Learn never starts a calculation.`,
};
const THERMOCHEMISTRY_NOTE: CapabilityNote = {
  tone: "limit",
  title: "Hosted thermochemistry: verified for one case",
  text: `The hosted beta's compute route accepts thermochemistry derived from a stored optimization and frequency result (closed-shell, up to ${AWS_FREQUENCY_MAX_ATOMS} atoms; no new electronic-structure calculation), and it has been executed there only for ${verifiedThermochemistryPairsText()}, so treat other molecules and methods as unverified. Learn never starts a calculation.`,
};
const ORBITAL_NOTE: CapabilityNote = {
  tone: "limit",
  title: "Hosted molecular orbitals: run on AWS for one case",
  text: "The hosted beta's compute route accepts a PySCF molecular-orbital calculation (orbital energies, HOMO and LUMO) for closed-shell molecules of up to 12 atoms. One has been run there, water at B3LYP/def2-SVP, and its orbital energies matched a Linux reference; other molecules and methods have not been checked, so treat them as unverified. Orbital surface images (cubes) are not available on the hosted beta: the grid is computed by a separate step inside the API, outside the compute queue, so it cannot reach the hosted worker. Use the local engines for orbital surfaces. Learn never starts a calculation.",
};
const TDDFT_NOTE: CapabilityNote = {
  tone: "limit",
  title: "Hosted TDDFT: verified for one case",
  text: `The hosted beta's compute route accepts PySCF TDDFT (closed-shell singlet excited states, up to 6 atoms and 10 states), and it has been executed there only for ${verifiedTddftPairsText()} with 5 states, where the excitation energies matched a Mac reference to within 1e-6 Eh. Other molecules, methods and state counts are unverified; 10 states did not converge for water at def2-SVP, so keep the state count small. Learn never starts a calculation.`,
};
const NOT_HOSTED_SPECTRUM_NOTE: CapabilityNote = {
  tone: "limit",
  title: "Calculated spectra are not available on the hosted beta yet",
  text: "A calculated infrared or Raman spectrum needs a frequency calculation. ChemDFT's local engines accept those workflows, but the hosted beta's compute route currently runs PySCF single-point energy, geometry optimization, frequency analysis, thermochemistry, molecular orbitals and TDDFT, and xTB single-point energy only (orbitals and TDDFT ran for water only). Importing and processing a measured spectrum does not need a calculation.",
};

type TopicMeta = {
  keywords: readonly string[];
  related: readonly HelpTopicId[];
  capability?: CapabilityNote;
};

export const TOPIC_META: Readonly<Record<HelpTopicId, TopicMeta>> = {
  "structure.charge": { keywords: ["net charge", "electron count", "ion", "anion", "cation"], related: ["structure.multiplicity", "calculation.method"] },
  "structure.multiplicity": { keywords: ["spin", "singlet", "doublet", "triplet", "open shell", "closed shell", "2S+1"], related: ["structure.charge", "electronic.homo_lumo"] },
  "calculation.method": { keywords: ["dft", "hartree-fock", "hf", "scf", "functional", "b3lyp", "pbe", "level of theory"], related: ["calculation.basis", "calculation.optimization", "structure.charge"], capability: ENERGY_NOTE },
  "calculation.basis": { keywords: ["basis functions", "sto-3g", "6-31g", "def2-svp", "orbitals"], related: ["calculation.method", "calculation.optimization"], capability: ENERGY_NOTE },
  "calculation.optimization": { keywords: ["geometry", "relaxation", "minimum", "converged", "optimizer", "geometric"], related: ["calculation.frequency", "calculation.method", "thermochemistry.frequency_requirement"], capability: OPTIMIZATION_NOTE },
  "calculation.frequency": { keywords: ["vibrations", "hessian", "harmonic", "normal modes", "imaginary frequency"], related: ["calculation.optimization", "spectra.ir", "spectra.raman", "thermochemistry.frequency_requirement"], capability: FREQUENCY_NOTE },
  "thermochemistry.frequency_requirement": { keywords: ["gibbs", "enthalpy", "entropy", "zero-point", "rrho", "temperature", "pressure"], related: ["calculation.frequency", "calculation.optimization"], capability: THERMOCHEMISTRY_NOTE },
  "electronic.homo_lumo": { keywords: ["frontier orbitals", "orbital gap", "orbital energy", "homo", "lumo"], related: ["spectra.uv_vis", "structure.multiplicity"], capability: ORBITAL_NOTE },
  "spectra.ir": { keywords: ["infrared", "ftir", "wavenumber", "absorption", "intensity"], related: ["calculation.frequency", "spectra.experimental", "spectra.raman"], capability: NOT_HOSTED_SPECTRUM_NOTE },
  "spectra.raman": { keywords: ["raman activity", "polarizability", "scattering"], related: ["calculation.frequency", "spectra.experimental", "spectra.ir"], capability: NOT_HOSTED_SPECTRUM_NOTE },
  "spectra.uv_vis": { keywords: ["tddft", "excitation", "oscillator strength", "electronic spectrum", "absorption"], related: ["electronic.homo_lumo", "spectra.experimental"], capability: TDDFT_NOTE },
  "spectra.experimental": { keywords: ["measurement", "peaks", "units", "association", "comparison", "import", "measured"], related: ["spectra.ir", "spectra.raman", "spectra.uv_vis", "provenance.authority"] },
  "crystal.unit_cell": { keywords: ["lattice", "cif", "crystal", "periodic", "fractional coordinates", "cell vectors"], related: ["crystal.supercell", "provenance.authority"], capability: PERIODIC_NOTE },
  "crystal.supercell": { keywords: ["replication", "repeat", "crystal view", "periodic"], related: ["crystal.unit_cell"], capability: PERIODIC_NOTE },
  "provenance.authority": { keywords: ["source", "lineage", "hash", "artifact", "reproducibility", "evidence"], related: ["firewall.ai_vs_calculation", "spectra.experimental"] },
  "firewall.ai_vs_calculation": { keywords: ["ai", "llm", "authority", "result firewall", "validation", "hypothesis", "calculated"], related: ["provenance.authority"] },
};

/* ------------------------------------------------------------------ guides */

export type GuideId = "prepare-structure" | "run-calculation" | "understand-results" | "scientific-authority";
export type GuideLink = { label: string; to: "welcome-molecule" | "examples" | "projects" | "welcome" };
export type GuideStep = {
  title: string;
  body: string;
  topics?: readonly HelpTopicId[];
  where?: GuideLink;
};
export type Guide = {
  id: GuideId;
  /** Present for the three Getting Started tutorials. */
  number?: "01" | "02" | "03";
  accent: LearnAccent;
  title: string;
  summary: string;
  intro: string;
  steps: readonly GuideStep[];
  /** Where the guide describes workflows the hosted beta cannot run yet, say so (see CapabilityNote evidence above). */
  notice?: CapabilityNote;
  /** A plain statement of what this guide (and Learn) will not do. */
  boundaries: readonly string[];
  next: GuideId | null;
};

export const GUIDES: readonly Guide[] = [
  {
    id: "prepare-structure",
    number: "01",
    accent: "teal",
    title: "Prepare a structure",
    summary: "Learn how to import or draw a molecule, understand atomic coordinates, and specify charge and spin multiplicity.",
    intro: "A calculation starts from a committed structure: three-dimensional coordinates stored as a versioned record inside a project. This guide follows that path and explains what you are asked to record.",
    steps: [
      {
        title: "Choose or create a project",
        body: "Structures live inside a project. Choosing a path on the starting screen creates nothing; you confirm a project before an editor or an import opens.",
        where: { label: "Choose a starting path", to: "welcome-molecule" },
      },
      {
        title: "Draw or import a structure",
        body: "Draw a molecule in the editor, or import coordinates from an SDF, MOL, XYZ or CIF file. Crystal structures support periodic DFT with PySCF (single point) or Quantum ESPRESSO (single point, atom relaxation with a fixed cell, DOS, bands), PBE or PBE+U.",
        topics: ["crystal.unit_cell"],
      },
      {
        title: "Inspect the committed coordinates",
        body: "An accepted structure becomes a version with its atomic coordinates and origin. The original file is preserved, and an edit creates a new version instead of overwriting the old one.",
      },
      {
        title: "Record the charge",
        body: "Charge sets the number of electrons. ChemDFT stores it with the structure version and does not infer it, so review it for the actual chemical species.",
        topics: ["structure.charge"],
      },
      {
        title: "Record the spin multiplicity",
        body: "Multiplicity is 2S + 1 and is stored separately from charge. An integer alone does not establish the correct electronic state, so review it for your species. Supported frequency, TDDFT and thermochemistry paths require closed-shell singlets.",
        topics: ["structure.multiplicity"],
      },
      {
        title: "Check what is eligible",
        body: "The project Navigator lists the supported next steps for your structure and, for anything unavailable, the actual blockers.",
      },
    ],
    boundaries: [
      "Learn and the starting screen create no project and run no calculation.",
      "ChemDFT does not guess charge or multiplicity for you.",
    ],
    next: "run-calculation",
  },
  {
    id: "run-calculation",
    number: "02",
    accent: "blue",
    title: "Run a calculation",
    summary: "Understand calculation methods, basis sets, human approval, and execution workflows.",
    intro: "A calculation is an explicit, reviewable request. This guide describes the path from a committed structure to a recorded job. It explains the steps; it does not start anything.",
    steps: [
      {
        title: "Pick a supported calculation",
        body: "Choose the task, method and basis yourself. ChemDFT validates the choice against the task and the configured worker, and it does not rank methods for your system.",
        topics: ["calculation.method", "calculation.basis"],
      },
      {
        title: "Build on the right geometry",
        body: "Frequency, orbital and thermochemistry workflows need a converged optimized geometry. A drawn or imported reference alone is not enough.",
        topics: ["calculation.optimization", "calculation.frequency"],
      },
      {
        title: "Review the exact request",
        body: "Before anything is submitted, check the structure version, charge, multiplicity, engine, method and basis that the request names.",
      },
      {
        title: "Approve or submit",
        body: "A calculation starts only after you submit it, or approve an AI Scientist proposal. The decision is yours: models, help pages and Learn cannot approve on your behalf.",
        topics: ["firewall.ai_vs_calculation"],
      },
      {
        title: "Follow the status",
        body: "A job moves through queued, running and finished states. In the hosted beta a calculation can wait for the on-demand worker to start, and per-user limits apply. Success is not guaranteed for every structure, method or basis.",
      },
    ],
    notice: {
      tone: "info",
      title: "What the hosted beta runs today",
      text: `Verified on AWS: ${verifiedEnergyPairsText()} single-point energy. Geometry optimization is accepted for small closed-shell molecules and verified there for ${verifiedOptimizationPairsText()}. Frequency analysis is accepted for small closed-shell molecules and verified there for ${verifiedFrequencyPairsText()}. PySCF TDDFT is verified there for ${verifiedTddftPairsText()} (5 states), and an xTB (semi-empirical) GFN2 energy for ${verifiedXtbEnergyPairsText()}. Other workflows, such as CREST and Psi4, are not available on the hosted route, so some steps above describe workflows you cannot run there.`,
    },
    boundaries: [
      "Learn starts no calculation and calls no AI model.",
      "Nothing in this guide implies that a calculation will succeed for your structure, method or basis.",
    ],
    next: "understand-results",
  },
  {
    id: "understand-results",
    number: "03",
    accent: "indigo",
    title: "Understand results",
    summary: "Learn how to inspect calculated energies, convergence, provenance, and scientific evidence.",
    intro: "A number is only meaningful with its context. This guide shows where ChemDFT keeps that context and what its labels do and do not mean.",
    steps: [
      {
        title: "Read the context before the number",
        body: "Every result names its structure version, engine, method, basis and units. Read these first, then the value.",
        topics: ["provenance.authority"],
      },
      {
        title: "Check convergence and status",
        body: "Look at whether the calculation converged and what status the stored result carries. A result is published only for a job that succeeded and whose artifacts pass the Scientific Result Firewall's validation.",
      },
      {
        title: "Inspect provenance and evidence",
        body: "The provenance view shows the producer and environment, each recorded operation, and the SHA-256 hash of every raw evidence artifact, so the record can be re-checked.",
      },
      {
        title: "Know what the label means",
        body: "A result accepted by the Scientific Result Firewall is a validated engine result. That is not the same as independent verification against a reference or a second method, and an AI explanation is never a result.",
        topics: ["firewall.ai_vs_calculation"],
      },
      {
        title: "Compare with measurements carefully",
        body: "Calculated and measured data keep separate sources. A comparison needs a matching technique, an explicit structure association and processed peaks; close peaks are candidates, not assignments.",
        topics: ["spectra.experimental"],
      },
    ],
    boundaries: [
      "Learn shows no calculated values. Any number you see in ChemDFT comes from a stored result with its provenance.",
      "Illustrations on these pages are diagrams, never measurements or calculation output.",
    ],
    next: null,
  },
  {
    id: "scientific-authority",
    accent: "indigo",
    title: "How ChemDFT labels scientific information",
    summary: "Five kinds of information ChemDFT keeps apart: user-supplied, source-referenced, calculated, AI explanation and validated.",
    intro: "ChemDFT never lets one kind of information pass for another. These are the five classes you will see and what each one does and does not establish.",
    steps: [
      {
        title: "User-supplied data",
        body: "Files and values that you import or enter. Raw uploads are kept unchanged, and processing creates new derived versions instead of editing the original.",
      },
      {
        title: "Source-referenced data",
        body: "Information tied to an identifiable source, such as a reference structure from a public database. It keeps its attribution, and a reference structure is not a measurement of your own sample.",
        topics: ["crystal.unit_cell"],
      },
      {
        title: "Calculated results",
        body: "Values produced by a scientific engine running on a recorded input, with the log and artifacts retained. A calculated value is a model result, not a measurement.",
        topics: ["provenance.authority"],
      },
      {
        title: "AI explanations",
        body: "Text from an AI provider that plans, explains or proposes. It is labelled and kept separate: AI cannot write calculated values, and an explanation is not a calculation.",
        topics: ["firewall.ai_vs_calculation"],
      },
      {
        title: "Validated results",
        body: "Results the Scientific Result Firewall accepted after checking provenance, units, artifact hashes and producer identity. Validated is a record-keeping state: it does not mean independently verified against experiment or a second method.",
        topics: ["firewall.ai_vs_calculation"],
      },
    ],
    boundaries: ["This page defines labels. It contains no scientific data."],
    next: null,
  },
];

export const GETTING_STARTED: readonly Guide[] = GUIDES.filter((guide) => guide.number);

/** The guide that best prepares a reader for a topic (used for the "Learn the workflow" link on articles). */
export function guideForTopic(topic: HelpTopicId): GuideId {
  if (topic.startsWith("structure.") || topic.startsWith("crystal.")) return "prepare-structure";
  if (topic === "calculation.method" || topic === "calculation.basis" || topic === "calculation.optimization") return "run-calculation";
  if (topic.startsWith("provenance.") || topic.startsWith("firewall.")) return "scientific-authority";
  return "understand-results";
}

export function isGuideId(value: string): value is GuideId {
  return GUIDES.some((guide) => guide.id === value);
}
export function guideById(id: GuideId): Guide {
  return GUIDES.find((guide) => guide.id === id)!;
}
export function guideHref(locale: string, id: GuideId): string {
  return `/${locale}/learn/guides/${id}`;
}
export function guideLinkHref(locale: string, to: GuideLink["to"]): string {
  switch (to) {
    case "welcome-molecule":
      return `/${locale}/welcome?path=molecule`;
    case "welcome":
      return `/${locale}/welcome`;
    case "examples":
      return `/${locale}/examples`;
    case "projects":
      return `/${locale}/projects`;
  }
}

/* ------------------------------------------------------------------ search */

export type SearchEntry = {
  id: string;
  kind: "topic" | "guide";
  /** Path below /{locale}/learn, without a query string. */
  path: string;
  title: string;
  categoryId: LearnCategoryId | "getting-started";
  categoryLabel: string;
  accent: LearnAccent;
  summary: string;
  /** Searchable text that is not shown in full (article body, step titles). */
  text: string;
  keywords: readonly string[];
};

export function buildSearchIndex(): SearchEntry[] {
  const topics = HELP_TOPICS.map((topic): SearchEntry => {
    const category = categoryOf(topic.id);
    const message = HELP_MESSAGES[topic.id];
    const article = HELP_ARTICLES[topic.id];
    return {
      id: topic.id,
      kind: "topic",
      path: topic.id,
      title: message.title,
      categoryId: category.id,
      categoryLabel: category.title,
      accent: category.accent,
      summary: message.summary,
      text: `${article.product} ${article.prerequisite}`,
      keywords: TOPIC_META[topic.id].keywords,
    };
  });
  const guides = GUIDES.map((guide): SearchEntry => ({
    id: guide.id,
    kind: "guide",
    path: `guides/${guide.id}`,
    title: guide.title,
    categoryId: "getting-started",
    categoryLabel: guide.number ? "Getting started" : "Sources and authority",
    accent: guide.accent,
    summary: guide.summary,
    text: `${guide.intro} ${guide.steps.map((step) => `${step.title}. ${step.body}`).join(" ")}`,
    keywords: guide.number ? ["tutorial", "guide", "getting started", "how to"] : ["labels", "authority", "classes", "provenance"],
  }));
  return [...guides, ...topics];
}

/** Lower-case, accent-free, punctuation-free: "UV/Vis" → "uv vis", "2S + 1" → "2s 1". */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type Segment = { text: string; match: boolean };
export type SearchHit = {
  entry: SearchEntry;
  score: number;
  matchedIn: "title" | "keyword" | "summary" | "text";
  /** One whole, relevant sentence from the article or guide text; only when the match lives in the body text. */
  excerpt: string | null;
  /** The keyword that matched when neither the title nor the summary shows it, e.g. "hessian". */
  via: string | null;
};

function words(value: string): string[] {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}
function hasPrefix(source: readonly string[], token: string): boolean {
  return source.some((word) => word.startsWith(token));
}
export function queryTokens(query: string): string[] {
  return words(query);
}

/** Splits text into the pieces that start with a query word and the rest, for <mark> highlighting. */
export function highlightSegments(text: string, tokens: readonly string[]): Segment[] {
  if (tokens.length === 0) return [{ text, match: false }];
  const parts: Segment[] = [];
  let last = 0;
  for (const found of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = normalizeSearchText(found[0]);
    if (!word || !tokens.some((token) => word.startsWith(token))) continue;
    const start = found.index!;
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    // Highlight just the typed prefix of the word.
    const typed = tokens.filter((token) => word.startsWith(token)).sort((x, y) => y.length - x.length)[0]!;
    const end = Math.min(start + typed.length, start + found[0].length);
    parts.push({ text: text.slice(start, end), match: true });
    last = end;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

const EXCERPT_SOFT_LIMIT = 300;
const EXCERPT_HARD_LIMIT = 420;

/**
 * The single best sentence for the query: most query words, earliest wins. It always begins at the start of a sentence,
 * and when a long sentence has to be shortened it is cut only at the end and never before the first matching word.
 */
export function bestExcerpt(text: string, tokens: readonly string[]): string | null {
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  let best: string | null = null;
  let bestScore = 0;
  for (const sentence of sentences) {
    const sentenceWords = words(sentence);
    const score = tokens.filter((token) => hasPrefix(sentenceWords, token)).length;
    if (score > bestScore) [best, bestScore] = [sentence, score];
  }
  if (!best) return null;
  let firstMatchEnd = 0;
  for (const found of best.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = normalizeSearchText(found[0]);
    if (tokens.some((token) => word.startsWith(token))) {
      firstMatchEnd = found.index! + found[0].length;
      break;
    }
  }
  const limit = Math.min(EXCERPT_HARD_LIMIT, Math.max(EXCERPT_SOFT_LIMIT, firstMatchEnd + 40));
  if (best.length <= limit) return best;
  const cut = best.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:\s]+$/, "")}…`;
}

/** Every query word must match the start of a word in the entry (search-as-you-type); results are ranked by where they match. */
export function searchLearn(index: readonly SearchEntry[], query: string): SearchHit[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const entry of index) {
    const title = words(entry.title);
    const category = words(entry.categoryLabel);
    const keywordList = entry.keywords.map((keyword) => ({ keyword, words: words(keyword) }));
    const summary = words(entry.summary);
    const text = words(entry.text);
    let score = 0;
    let best: SearchHit["matchedIn"] = "text";
    let ok = true;
    for (const token of tokens) {
      let tokenScore = 0;
      let where: SearchHit["matchedIn"] = "text";
      if (hasPrefix(title, token)) [tokenScore, where] = [10, "title"];
      else if (keywordList.some((item) => hasPrefix(item.words, token))) [tokenScore, where] = [6, "keyword"];
      else if (hasPrefix(category, token)) [tokenScore, where] = [4, "keyword"];
      else if (hasPrefix(summary, token)) [tokenScore, where] = [3, "summary"];
      else if (hasPrefix(text, token)) [tokenScore, where] = [1, "text"];
      if (tokenScore === 0) {
        ok = false;
        break;
      }
      score += tokenScore;
      const rank = { title: 3, keyword: 2, summary: 1, text: 0 };
      if (rank[where] > rank[best]) best = where;
    }
    if (!ok) continue;
    const via = best === "keyword"
      ? (keywordList.find((item) => tokens.some((token) => hasPrefix(item.words, token)))?.keyword ?? null)
      : null;
    const summaryShowsMatch = tokens.some((token) => hasPrefix(summary, token));
    hits.push({
      entry,
      score,
      matchedIn: best,
      excerpt: best === "text" ? bestExcerpt(entry.text, tokens) : null,
      via: via && !summaryShowsMatch && !tokens.every((token) => hasPrefix(title, token)) ? via : null,
    });
  }
  const order = new Map(index.map((entry, position) => [entry.id, position]));
  return hits.sort((a, b) => b.score - a.score || order.get(a.entry.id)! - order.get(b.entry.id)!);
}
