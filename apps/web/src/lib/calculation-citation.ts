import type { CalculationDetail } from "@chemdft/schemas";

import { LATEST_RELEASE } from "../content/releases";
import { ENGINE_REFERENCES, RDKIT_CITATION, type EngineReference } from "../content/engine-citations";
import { taskLabel } from "./overview-view";
import { CITATION_METADATA } from "./citation";
import type { OrcidStatus } from "./orcid";
import { KS_GAP_NOTE, LOCAL_SPIN_LABEL, LOCAL_SPIN_TOOLTIP, QE_GAP_NOTE, QE_LOCAL_SPIN_LABEL, QE_LOCAL_SPIN_NOTE, QE_PLANE_WAVE_FOOTNOTE, U_DEFAULTS_NOTE } from "./periodic-wording";

/**
 * "Cite this calculation" (BibTeX, RIS, APA, plain text), the Methods paragraph, engine attribution and the reproducibility record.
 *
 * Everything is a pure, deterministic function of the stored calculation record (`CalculationDetail`). A fact the record does not carry is
 * printed as "not recorded", never guessed. Nothing here is written by a model, and no DOI, version or identifier is invented: engine
 * references come from `content/engine-citations.ts` (each project's own citation page), and the calculation has no DOI (see "Not included").
 */

const NOT_RECORDED = "not recorded";
import { SITE_URL } from "./site";

export type CitationFacts = {
  calculationId: string;
  jobId: string | null;
  year: number | null;
  createdAt: string | null;
  task: string;
  method: string;
  basis: string | null;
  charge: number;
  multiplicity: number;
  structure: { versionId: string | null; revision: number | null; inputSha256: string };
  engine: { name: string; version: string; adapterVersion: string; backend: string; hardware: string | null; environmentDigest: string | null; libraries: [string, string][] } | null;
  platform: string | null;
  firewall: { authority: string; validation: string; verification: string; source: string } | null;
  appVersion: string;
  /** The ChemDFT software DOI, only when the owner has set one (never invented). Null prints nothing. */
  softwareDoi: string | null;
  periodic?: {
    kMesh?: string;
    uEffectiveEv?: Record<string, number> | null;
    magneticOrder?: string;
    hasPlusU?: boolean;
    usedDefaultU?: boolean;
    /** Quantum ESPRESSO plane-wave runs only: the pseudopotential libraries actually used and whether local moments were reported. */
    qe?: { libraries: string[]; hasLocalMoments: boolean } | null;
  } | null;
};

/** Recorded library versions as [name, value]: the namespace, and each recorded key/value of it. Shape is read defensively. */
function libraryEntries(extensions: unknown): [string, string][] {
  if (!Array.isArray(extensions)) return [];
  const entries: [string, string][] = [];
  for (const extension of extensions as { namespace?: unknown; values?: unknown }[]) {
    const namespace = typeof extension?.namespace === "string" ? extension.namespace : null;
    if (!namespace) continue;
    const values = Array.isArray(extension.values) ? (extension.values as { key?: unknown; value?: unknown }[]) : [];
    if (values.length === 0) entries.push([namespace, "recorded"]);
    for (const item of values) if (typeof item?.key === "string") entries.push([`${namespace}.${item.key}`, String(item.value)]);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

export function citationFacts(detail: CalculationDetail): CitationFacts {
  const spec = detail.specification as { method: { display_name?: string; identifier: string }; basis?: { display_name?: string; identifier: string } | null; charge: number; multiplicity: number; task_type: string };
  const result = detail.result ?? null;
  const producer = result?.producer_software ?? null;
  const created = result?.created_at ?? detail.calculation.created_at ?? null;
  const year = created ? new Date(created).getUTCFullYear() : null;
  const summary = detail.compute_job?.structure_summary ?? null;
  const libraries = libraryEntries(producer?.library_versions);
  const job = detail.compute_job ?? null;
  const rawSpec = detail.specification as unknown as Record<string, unknown>;
  const periodicSpec = rawSpec.periodic as { k_mesh?: [number, number, number] | string; u_effective_ev?: Record<string, number>; magnetic_order?: string } | undefined;
  const isPeriodic = rawSpec.task_type === "PERIODIC_ENERGY" || Boolean(periodicSpec);
  let periodicInfo: CitationFacts["periodic"] = null;
  if (isPeriodic) {
    const uMap = periodicSpec?.u_effective_ev ?? null;
    const hasPlusU = (spec.method.identifier ?? "").toLowerCase().includes("+u") || (uMap !== null && Object.keys(uMap).length > 0);
    const defaultUMap: Record<string, number> = { V: 3.25, Cr: 3.7, Mn: 3.9, Fe: 5.3, Co: 3.32, Ni: 6.2 };
    const usedDefaultU = hasPlusU && uMap !== null && Object.entries(uMap).some(([elem, val]) => defaultUMap[elem] !== undefined && Math.abs(val - defaultUMap[elem]) < 1e-4);
    const kMeshStr = Array.isArray(periodicSpec?.k_mesh) ? periodicSpec.k_mesh.join("x") : (periodicSpec?.k_mesh ?? "1x1x1");
    const payload = (result?.payload ?? null) as Record<string, unknown> | null;
    const isQe = (detail.specification as { engine_preference?: { engine?: string } }).engine_preference?.engine === "qe" || payload?.engine === "qe";
    const libs = payload && typeof payload.pseudopotential_libraries === "object" && payload.pseudopotential_libraries !== null
      ? [...new Set(Object.values(payload.pseudopotential_libraries as Record<string, string>))].sort()
      : [];
    const localMoments = payload && typeof payload.local_magnetic_moments === "object" && payload.local_magnetic_moments !== null ? Object.keys(payload.local_magnetic_moments as object).length > 0 : false;
    periodicInfo = {
      kMesh: kMeshStr,
      uEffectiveEv: uMap,
      magneticOrder: periodicSpec?.magnetic_order ?? "none",
      hasPlusU,
      usedDefaultU,
      qe: isQe ? { libraries: libs, hasLocalMoments: localMoments } : null,
    };
  }
  return {
    calculationId: detail.calculation.id,
    jobId: job?.id ?? null,
    year: year !== null && Number.isFinite(year) ? year : null,
    createdAt: created,
    task: taskLabel(spec.task_type as never),
    method: spec.method.display_name ?? spec.method.identifier,
    basis: spec.basis ? (spec.basis.display_name ?? spec.basis.identifier) : null,
    charge: spec.charge,
    multiplicity: spec.multiplicity,
    structure: { versionId: summary?.structure_version_id ?? null, revision: summary?.structure_revision ?? null, inputSha256: detail.calculation_input_hash },
    engine: producer
      ? {
          name: producer.name,
          version: producer.version,
          adapterVersion: producer.adapter_version,
          backend: producer.execution_backend,
          hardware: producer.hardware_class ?? null,
          environmentDigest: producer.environment_digest ?? null,
          libraries,
        }
      : null,
    platform: job ? `${job.provider}${producer?.hardware_class ? `, ${producer.hardware_class}` : ""}` : null,
    firewall: result
      ? {
          authority: result.effective_state?.authority ?? result.authority ?? NOT_RECORDED,
          validation: result.effective_state?.validation_state ?? result.validation_state,
          verification: result.effective_state?.verification_state ?? result.verification_state,
          source: result.source_class ?? NOT_RECORDED,
        }
      : null,
    appVersion: LATEST_RELEASE.version,
    softwareDoi: CITATION_METADATA.doi,
    periodic: periodicInfo,
  };
}

/** The researcher as an author. Only a production-authenticated iD ever appears; a sandbox (test) iD is never put in a citation. */
export type CitationAuthor = { name: string | null; orcidUrl: string | null };

export function citationAuthor(status: OrcidStatus | null, includeOrcid: boolean): CitationAuthor | null {
  if (!includeOrcid || !status?.linked || !status.orcid_id || status.environment !== "production") return null;
  return { name: status.display_name, orcidUrl: `https://orcid.org/${status.orcid_id}` };
}

/**
 * One short line shown NEXT TO a citation, never inside it (the citation text stays a clean reference). No stable public link to a
 * calculation exists in the app today (records are private project pages), so the record is identified by its calculation ID.
 */
export const NO_DOI_NOTE = "No DOI yet and no public link: this is a private record in ChemDFT, identified by the calculation ID in the citation.";

const platformText = (facts: CitationFacts) => facts.platform ?? NOT_RECORDED;

export function citationTitle(facts: CitationFacts): string {
  const level = facts.basis ? `${facts.method}/${facts.basis}` : facts.method;
  return `ChemDFT calculation ${facts.calculationId}: ${facts.task.toLowerCase()} at ${level}`;
}

/** The Methods paragraph. Fixed template, stored provenance only. */
export function methodsParagraph(facts: CitationFacts): string {
  const level = facts.basis ? `the ${facts.method} method with the ${facts.basis} basis set` : `the ${facts.method} method`;
  const structure = [
    facts.structure.versionId ? `structure version ${facts.structure.versionId}${facts.structure.revision !== null ? ` (revision ${facts.structure.revision})` : ""}` : "an immutable structure input",
    `with input SHA-256 ${facts.structure.inputSha256}`,
  ].join(" ");
  const engine = facts.engine
    ? `${facts.engine.name} ${facts.engine.version} (ChemDFT adapter ${facts.engine.adapterVersion}; ${facts.engine.backend} backend${facts.engine.hardware ? `, ${facts.engine.hardware}` : ""})`
    : NOT_RECORDED;
  const digest = facts.engine?.environmentDigest ? ` The engine environment digest is ${facts.engine.environmentDigest}.` : "";
  const evidence = facts.firewall
    ? ` Evidence status: ${facts.firewall.source} (${facts.firewall.verification === "UNVERIFIED" ? "not independently verified" : `independent verification ${facts.firewall.verification.toLowerCase()}`}).`
    : "";
  const firewall = facts.firewall
    ? `Result Firewall status: authority ${facts.firewall.authority}, validation ${facts.firewall.validation}, independent verification ${facts.firewall.verification} (source class ${facts.firewall.source}).`
    : "No published result is recorded for this calculation, so there is no Result Firewall status.";
  const periodicText = facts.periodic
    ? [
        `Periodic DFT used the k-point mesh ${facts.periodic.kMesh ?? "1x1x1"}${facts.periodic.hasPlusU ? " with a Dudarev Hubbard +U correction" : ""}.`,
        ...(facts.periodic.hasPlusU && facts.periodic.usedDefaultU ? [U_DEFAULTS_NOTE] : []),
        ...(facts.periodic.qe
          ? [QE_PLANE_WAVE_FOOTNOTE, `${QE_GAP_NOTE} ${QE_LOCAL_SPIN_LABEL}: ${QE_LOCAL_SPIN_NOTE}`]
          : [`${KS_GAP_NOTE} ${LOCAL_SPIN_LABEL}: ${LOCAL_SPIN_TOOLTIP}`]),
      ].join(" ")
    : "";
  return [
    `The ${facts.task.toLowerCase()} calculation used ${level}, charge ${facts.charge} and spin multiplicity ${facts.multiplicity}, on ${structure}.`,
    `It was run with ${engine} on ${platformText(facts)} as ChemDFT ${facts.appVersion} calculation ${facts.calculationId}${facts.jobId ? ` (job ${facts.jobId})` : ""}.${digest}`,
    ...(periodicText ? [periodicText] : []),
    `${firewall}${evidence}`.trim(),
    "All values are the ones ChemDFT stored from the engine; none were edited. The ChemDFT citation and the engine references below should be cited with this calculation.",
  ].join(" ");
}

// ---------- the calculation's own citation ---------------------------------------------------------------------------------------------

const bibEscape = (value: string) => value.replace(/([&%$#_{}])/g, "\\$1");

function noteLines(facts: CitationFacts, author: CitationAuthor | null): string[] {
  const lines = [
    `Calculation ${facts.calculationId}`,
    ...(facts.jobId ? [`job ${facts.jobId}`] : []),
    `input SHA-256 ${facts.structure.inputSha256}`,
    ...(facts.engine ? [`${facts.engine.name} ${facts.engine.version}`] : []),
    `ChemDFT ${facts.appVersion}`,
    ...(facts.softwareDoi ? [`software DOI https://doi.org/${facts.softwareDoi}`] : []),
  ];
  if (author?.orcidUrl && !author.name) lines.push(`Author ORCID iD ${author.orcidUrl}`);
  return lines;
}

export function calculationBibTeX(facts: CitationFacts, author: CitationAuthor | null): string {
  const lines = [`@misc{chemdft_calculation_${facts.calculationId.replaceAll("-", "").slice(0, 12)},`];
  if (author?.name) lines.push(`  author = {{${bibEscape(author.name)}}},`);
  else lines.push("  organization = {ChemDFT},");
  lines.push(`  title = {${bibEscape(citationTitle(facts))}},`);
  if (facts.year !== null) lines.push(`  year = {${facts.year}},`);
  lines.push(`  howpublished = {ChemDFT ${facts.appVersion}, ${SITE_URL}},`);
  if (author?.orcidUrl && author.name) lines.push(`  orcid = {${author.orcidUrl}},`);
  lines.push(`  note = {${bibEscape(noteLines(facts, author).join("; "))}}`, "}");
  return lines.join("\n");
}

export function calculationRis(facts: CitationFacts, author: CitationAuthor | null): string {
  return [
    "TY  - DATA",
    ...(author?.name ? [`AU  - ${author.name}`] : []),
    `TI  - ${citationTitle(facts)}`,
    ...(facts.year !== null ? [`PY  - ${facts.year}`] : []),
    `PB  - ChemDFT ${facts.appVersion}`,
    `UR  - ${SITE_URL}`,
    `N1  - ${noteLines(facts, author).join("; ")}`,
    ...(author?.orcidUrl && author.name ? [`N1  - Author ORCID iD ${author.orcidUrl}`] : []),
    "ER  - ",
  ].join("\n");
}

export function calculationApa(facts: CitationFacts, author: CitationAuthor | null): string {
  const who = author?.name ?? "ChemDFT";
  const orcid = author?.orcidUrl ? ` (${author.orcidUrl})` : "";
  return `${who}${orcid}. (${facts.year ?? "n.d."}). ${citationTitle(facts)} [Computational chemistry calculation record]. ChemDFT (Version ${facts.appVersion}). ${SITE_URL} (${noteLines(facts, null).slice(0, 3).join("; ")})`;
}

export function calculationPlain(facts: CitationFacts, author: CitationAuthor | null): string {
  const who = author?.name ?? "ChemDFT";
  const orcid = author?.orcidUrl ? ` ORCID iD ${author.orcidUrl}.` : "";
  return `${who}.${orcid} ${citationTitle(facts)}. ChemDFT ${facts.appVersion}, ${facts.year ?? "n.d."}. ${noteLines(facts, null).join("; ")}.`;
}

export interface FigureCaptionOptions {
  coordinatesOrigin?: string | null;
}

/**
 * Pure deterministic figure caption for exported 3D images and figures.
 * Built only from the stored record. A fact the record does not carry is printed
 * as "not recorded" or omitted; never guessed, never strengthening claims.
 */
export function figureCaption(facts: CitationFacts, options?: FigureCaptionOptions): string {
  const doiNote = facts.softwareDoi ? ` (DOI https://doi.org/${facts.softwareDoi})` : "";
  const rendered = `Structure rendered with ChemDFT ${facts.appVersion}${doiNote}.`;

  let coords = `Coordinates: ${NOT_RECORDED}.`;
  if (options?.coordinatesOrigin) {
    coords = `Coordinates: ${options.coordinatesOrigin}.`;
  } else if (facts.structure.versionId) {
    coords = `Coordinates: structure version ${facts.structure.versionId}${facts.structure.revision !== null ? ` (revision ${facts.structure.revision})` : ""}, input SHA-256 ${facts.structure.inputSha256}.`;
  } else if (facts.structure.inputSha256) {
    coords = `Coordinates: input SHA-256 ${facts.structure.inputSha256}.`;
  }

  const engine = facts.engine ? `${facts.engine.name} ${facts.engine.version}` : NOT_RECORDED;
  const level = facts.method ? (facts.basis ? `${facts.method}/${facts.basis}` : facts.method) : NOT_RECORDED;
  const calc = `Calculated with ${engine}, ${level}.`;

  const firewall = facts.firewall
    ? facts.firewall.verification === "UNVERIFIED"
      ? " Evidence not independently verified."
      : ` Independent verification: ${facts.firewall.verification.toLowerCase()}.`
    : "";

  return `${rendered} ${coords} ${calc}${firewall}`.trim();
}

// ---------- engine attribution --------------------------------------------------------------------------------------------------------

export type EngineAttribution = {
  /** Verified references to cite. */
  references: EngineReference[];
  /** Text-only citation (RDKit has no publication). */
  textCitations: string[];
  /** Engines used by this record whose citation text has not been verified; the export says so instead of guessing. */
  unverified: string[];
};

/** Original pseudopotential library (derived from the SSSP file names) -> reference key in content/engine-citations.ts. */
export const QE_LIBRARY_REFERENCE: Record<string, string> = {
  gbrv: "garrity2014gbrv",
  "pslibrary-0": "kucukbenli2014pslibrary",
  "pslibrary-1": "dalcorso2014pslibrary",
  jth: "jollet2014jth",
  spms: "shojaei2023spms",
  sg15: "schlipf2015sg15",
  pseudodojo: "vansetten2018pseudodojo",
  tw14: "topsakal2014tw14",
};

const has = (facts: CitationFacts, name: string) => facts.engine?.libraries.some(([key]) => key.toLowerCase().split(".")[0] === name) ?? false;

export function engineAttribution(facts: CitationFacts): EngineAttribution {
  const engine = (facts.engine?.name ?? "").toLowerCase();
  const refs: string[] = [];
  const text: string[] = [];
  const unverified: string[] = [];
  const isPeriodic = facts.task.toLowerCase().includes("periodic") || Boolean(facts.periodic);
  if (isPeriodic) {
    const qe = engine === "qe" || engine === "quantum espresso" || Boolean(facts.periodic?.qe);
    if (qe) {
      refs.push("giannozzi2017qe", "giannozzi2009qe", "giannozzi2020qe", "perdew1996pbe", "prandini2018sssp", "prandini2023sssplibrary");
    } else {
      if (engine === "pyscf" || !engine) {
        refs.push("sun2020pyscf", "sun2018pyscf");
      }
      refs.push("perdew1996pbe", "goedecker1996gth", "hartwigsen1998gth", "krack2005gth", "vandevondele2007molopt");
    }
    const hasPlusU = facts.periodic?.hasPlusU ?? facts.method.toLowerCase().includes("+u");
    if (hasPlusU) {
      refs.push("dudarev1998plusu");
      if (qe) refs.push("timrov2020orthoatomic");
    }
    if (qe) {
      for (const library of facts.periodic?.qe?.libraries ?? []) {
        const key = QE_LIBRARY_REFERENCE[library];
        if (key) refs.push(key);
      }
      if (facts.periodic?.qe?.hasLocalMoments) refs.push("lowdin1950orthogonalization");
    }
    const defaultUMap: Record<string, number> = { V: 3.25, Cr: 3.7, Mn: 3.9, Fe: 5.3, Co: 3.32, Ni: 6.2 };
    const usedDefault = facts.periodic?.usedDefaultU ?? (hasPlusU && facts.periodic?.uEffectiveEv && Object.entries(facts.periodic.uEffectiveEv).some(([el, val]) => defaultUMap[el] !== undefined && Math.abs(val - defaultUMap[el]) < 1e-4));
    if (usedDefault) {
      refs.push("jain2011materials");
    }
  } else {
    if (engine === "pyscf") refs.push("sun2026pyscf", "sun2020pyscf", "sun2018pyscf", "sun2015libcint");
    else if (engine === "xtb") refs.push("bannwarth2020xtb", "bannwarth2019gfn2");
    else if (engine === "crest") refs.push("pracht2020crest", "pracht2024crest", "bannwarth2020xtb", "bannwarth2019gfn2");
    else if (engine === "psi4") refs.push("smith2020psi4");
    else if (engine === "dftd4" || engine === "d4") refs.push("caldeweyher2017d4", "caldeweyher2019d4", "caldeweyher2020d4");
    else if (engine) unverified.push(`${facts.engine?.name}: citation text not verified in ChemDFT yet; cite it from the project's own page.`);
    if (/gfn1/i.test(facts.method) && !refs.includes("grimme2017gfn1")) refs.push("grimme2017gfn1");
    if (has(facts, "geometric") || (engine === "pyscf" && /optimi[sz]ation/i.test(facts.task))) refs.push("wang2016geometric");
    if (has(facts, "rdkit")) text.push(RDKIT_CITATION.text + ` Include the DOI of the RDKit version used (${RDKIT_CITATION.versionDoisUrl}).`);
  }
  return { references: refs.map((key) => ENGINE_REFERENCES[key]).filter((ref): ref is EngineReference => Boolean(ref)), textCitations: text, unverified };
}

const authorsBib = (ref: EngineReference) => ref.authors.map(([family, given]) => `${family}, ${given}`).join(" and ") + (ref.moreAuthors ? " and others" : "");
const authorsPlain = (ref: EngineReference) => ref.authors.map(([family, given]) => `${family}, ${given.split(/\s+/).map((part) => `${part[0]}.`).join(" ")}`).join("; ") + (ref.moreAuthors ? "; et al." : "");

export function referencesBibTeX(attribution: EngineAttribution): string {
  return attribution.references
    .map((ref) =>
      ref.kind
        ? [`@misc{${ref.key},`, `  author = {${authorsBib(ref)}},`, `  title = {${ref.title}},`, `  year = {${ref.year}},`, ...(ref.kind === "preprint" ? [`  eprint = {${ref.volume}},`, "  archivePrefix = {arXiv},"] : [`  publisher = {${ref.journal}},`]), `  doi = {${ref.doi}}`, "}"].join("\n")
        : [`@article{${ref.key},`, `  author = {${authorsBib(ref)}},`, `  title = {${ref.title}},`, `  journal = {${ref.journal}},`, `  year = {${ref.year}},`, `  volume = {${ref.volume}},`, `  pages = {${ref.pages}},`, `  doi = {${ref.doi}}`, "}"].join("\n"),
    )
    .join("\n\n");
}

export function referencesRis(attribution: EngineAttribution): string {
  return attribution.references
    .map((ref) => [ref.kind === "dataset" ? "TY  - DATA" : ref.kind === "preprint" ? "TY  - UNPB" : "TY  - JOUR", ...ref.authors.map(([family, given]) => `AU  - ${family}, ${given}`), `TI  - ${ref.title}`, `JO  - ${ref.journal}`, `PY  - ${ref.year}`, ...(ref.volume ? [`VL  - ${ref.volume}`] : []), ...(ref.pages ? [`SP  - ${ref.pages}`] : []), `DO  - ${ref.doi}`, "ER  - "].join("\n"))
    .join("\n");
}

export function referencesPlain(attribution: EngineAttribution): string {
  const lines = attribution.references.map((ref) => {
    const where = ref.kind === "dataset" ? `${ref.journal} (data set) ${ref.year}` : ref.kind === "preprint" ? `arXiv:${ref.volume} ${ref.year}` : `${ref.journal} ${ref.year}, ${ref.volume}, ${ref.pages}`;
    return `${authorsPlain(ref)} ${ref.title}. ${where}. https://doi.org/${ref.doi}`;
  });
  return [...lines, ...attribution.textCitations, ...attribution.unverified].join("\n");
}

// ---------- reproducibility record ----------------------------------------------------------------------------------------------------

/**
 * Inputs, versions, hashes and provenance as JSON. Privacy follows the portable-export policy: no project, structure or user name, no
 * coordinates, no log or artifact bytes. The full hash-verified package is the existing "Export & reports" archive.
 */
export function reproducibilityRecord(detail: CalculationDetail, facts: CitationFacts): Record<string, unknown> {
  return {
    schema: "chemdft.calculation-citation.v1",
    chemdft_version: facts.appVersion,
    calculation_id: facts.calculationId,
    job_id: facts.jobId,
    published_at: facts.createdAt,
    specification: detail.specification,
    structure: { structure_version_id: facts.structure.versionId, revision: facts.structure.revision, calculation_input_sha256: facts.structure.inputSha256 },
    engine: facts.engine && {
      name: facts.engine.name,
      version: facts.engine.version,
      adapter_version: facts.engine.adapterVersion,
      execution_backend: facts.engine.backend,
      hardware_class: facts.engine.hardware,
      environment_digest: facts.engine.environmentDigest,
      library_versions: Object.fromEntries(facts.engine.libraries),
    },
    platform: facts.platform,
    result_firewall: facts.firewall,
    result: detail.result && { id: detail.result.id, result_type: detail.result.result_type, provenance_record_id: detail.result.provenance_record_id, raw_artifact_sha256: detail.result.raw_artifacts.map((artifact) => (artifact as { sha256?: string }).sha256 ?? null) },
    not_included: ["structure and project names", "atomic coordinates (use the evidence archive)", "logs and native artifacts", "a DOI (none exists; Zenodo/DOI registration is not part of this release)"],
  };
}
