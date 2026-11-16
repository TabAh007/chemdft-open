import type { Metadata } from "next";
import Link from "next/link";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { AppIcon } from "@chemdft/ui";
import { createPublicMetadata } from "@/lib/seo";
import {
  HELP_TOPICS,
  helpHref,
  helpTopic,
  isHelpTopic,
  workspaceReturn,
} from "@/lib/help-topics";
import { HELP_ARTICLES } from "@/lib/help-articles";
import { helpUi } from "@/lib/help-messages";
import { TOPIC_META, categoryOf, guideById, guideForTopic, guideHref } from "@/lib/learn-content";
import styles from "../../../_components/learn/learn-page.module.css";

const TOPIC_SEO_META: Record<string, { title: string; description: string }> = {
  "structure.charge": {
    title: "Molecular charge in DFT calculations | ChemDFT",
    description:
      "Net electric charge sets the electron count for a molecular calculation. Learn how charge is defined and validated in ChemDFT.",
  },
  "structure.multiplicity": {
    title: "Spin multiplicity in quantum chemistry | ChemDFT",
    description:
      "Multiplicity is 2S + 1, where S is total spin quantum number. Learn how spin multiplicity is configured for calculations in ChemDFT.",
  },
  "calculation.method": {
    title: "Electronic structure methods and models | ChemDFT",
    description:
      "The method specifies the electronic-structure approximation. Learn about DFT and semi-empirical methods available in ChemDFT.",
  },
  "calculation.basis": {
    title: "Basis sets in molecular DFT | ChemDFT",
    description:
      "A basis represents the functions used to describe molecular orbitals. Learn how basis sets define the calculation model in ChemDFT.",
  },
  "calculation.optimization": {
    title: "Molecular geometry optimization | ChemDFT",
    description:
      "Optimization relaxes atomic positions under a selected method and basis. Understand geometry relaxation workflows in ChemDFT.",
  },
  "calculation.frequency": {
    title: "Vibrational frequency calculations | ChemDFT",
    description:
      "A harmonic frequency calculation describes local vibrational modes from the molecular Hessian. Understand frequency analysis in ChemDFT.",
  },
  "spectra.ir": {
    title: "Infrared spectra: calculated vs measured | ChemDFT",
    description:
      "ChemDFT separates a calculated harmonic IR spectrum from an imported experimental measurement. Understand IR workflows in ChemDFT.",
  },
  "spectra.raman": {
    title: "Raman spectra and calculated activities | ChemDFT",
    description:
      "Raman activities belong to the supported calculated Raman result. Learn how calculated Raman activities are handled in ChemDFT.",
  },
  "spectra.uv_vis": {
    title: "UV/Vis spectra and electronic transitions | ChemDFT",
    description:
      "Electronic excitation energies and oscillator strengths are distinct from a HOMO–LUMO orbital gap. Understand UV/Vis spectra in ChemDFT.",
  },
  "spectra.experimental": {
    title: "Experimental spectra association | ChemDFT",
    description:
      "Confirm technique and units before importing a measurement. Learn how experimental spectra are associated with structures in ChemDFT.",
  },
  "thermochemistry.frequency_requirement": {
    title: "Thermochemistry calculation prerequisites | ChemDFT",
    description:
      "ChemDFT thermochemistry reuses eligible recorded frequency and electronic-energy data with explicit temperature and pressure parameters.",
  },
  "electronic.homo_lumo": {
    title: "HOMO-LUMO frontier molecular orbitals | ChemDFT",
    description:
      "HOMO and LUMO are frontier molecular orbitals identified from calculation energies and occupations. Understand orbital gaps in ChemDFT.",
  },
  "crystal.unit_cell": {
    title: "Crystal unit cells and periodic reference | ChemDFT",
    description:
      "Cell vectors and atoms expressed in that cell define the periodic structural reference. Learn how unit cells are defined in ChemDFT.",
  },
  "crystal.supercell": {
    title: "Supercell viewing for crystal structures | ChemDFT",
    description:
      "A supercell view repeats the reference cell along selected lattice directions. Learn how crystal supercells are visualized in ChemDFT.",
  },
  "provenance.authority": {
    title: "Scientific provenance and data origins | ChemDFT",
    description:
      "Every scientific record has a source and validation context. Learn how ChemDFT tracks provenance, references, and engine results.",
  },
  "firewall.ai_vs_calculation": {
    title: "AI explanations and the Result Firewall | ChemDFT",
    description:
      "AI explanation is not an authoritative scientific calculation. Learn how ChemDFT enforces the Scientific Result Firewall.",
  },
};

export const dynamicParams = false;
export function generateStaticParams() {
  return HELP_TOPICS.map((item) => ({ topic: item.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const { topic } = await params;
  const meta = TOPIC_SEO_META[topic];
  if (!meta) return {};
  return createPublicMetadata({
    title: meta.title,
    description: meta.description,
    path: `/en/learn/${topic}`,
  });
}

export default async function LearnTopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; topic: string }>;
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { locale, topic } = await params;
  if (!isLocale(locale) || !isHelpTopic(topic)) notFound();
  const copy = helpTopic(locale, topic);
  const article = HELP_ARTICLES[topic];
  const entry = HELP_TOPICS.find((item) => item.id === topic)!;
  const category = categoryOf(topic);
  const meta = TOPIC_META[topic];
  const guide = guideById(guideForTopic(topic));
  const returnTo = workspaceReturn(locale, (await searchParams).return_to);
  const start = new URLSearchParams({ path: entry.path });
  if (entry.goal) start.set("goal", entry.goal);
  return (
    <main
      id="main-content"
      className={styles.article}
      data-help-article={topic}
      data-accent={category.accent}
    >
      <header className={styles.articleHead}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link href={`/${locale}/learn`}>
            <AppIcon icon="arrow-left" />
            {helpUi(locale, "title")}
          </Link>
          <span aria-hidden="true">/</span>
          <span>{category.title}</span>
        </nav>
        <p className={styles.kicker}>{category.title}</p>
        <h1>{copy.title}</h1>
        <p className={styles.articleLead}>{copy.summary}</p>
      </header>
      <div className={styles.articleBody}>
        <section>
          <h2>{helpUi(locale, "product")}</h2>
          <p>{article.product}</p>
        </section>
        <section>
          <h2>{helpUi(locale, "prerequisite")}</h2>
          <p>{article.prerequisite}</p>
        </section>
        {meta.capability && (
          <aside className={styles.notice} data-tone={meta.capability.tone} aria-label="Availability in ChemDFT">
            <AppIcon icon={meta.capability.tone === "limit" ? "warning-sign" : "info-sign"} />
            <div>
              <strong>{meta.capability.title}</strong>
              <p>{meta.capability.text}</p>
            </div>
          </aside>
        )}
        <div className={styles.actions}>
          <Link className="bp6-button bp6-intent-primary" href={`/${locale}/welcome?${start}`}>
            {helpUi(locale, "use")}
          </Link>
          {returnTo && <Link href={returnTo}>{helpUi(locale, "return")}</Link>}
        </div>
        {article.source && (
          <p className={styles.source}>
            {helpUi(locale, "sources")}:{" "}
            <a href={article.source.url}>{article.source.label}</a>
          </p>
        )}
      </div>
      <aside className={styles.aside} aria-label="Related learning">
        {meta.related.length > 0 && (
          <nav className={styles.panel} aria-labelledby="related-topics">
            <h2 id="related-topics">Related topics</h2>
            <ul>
              {meta.related.map((id) => (
                <li key={id}>
                  <Link href={helpHref(locale, id, returnTo ?? undefined)} data-related-topic={id}>
                    <span>{helpTopic(locale, id).title}</span>
                    <AppIcon icon="arrow-right" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <nav className={styles.panel} aria-labelledby="learn-workflow">
          <h2 id="learn-workflow">Learn the workflow</h2>
          <ul>
            <li>
              <Link href={guideHref(locale, guide.id)}>
                <span>{guide.title}</span>
                <AppIcon icon="arrow-right" />
              </Link>
            </li>
          </ul>
        </nav>
      </aside>
    </main>
  );
}
