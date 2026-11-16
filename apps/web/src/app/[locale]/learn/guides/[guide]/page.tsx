import Link from "next/link";
import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { AppIcon } from "@chemdft/ui";
import { createPublicMetadata } from "@/lib/seo";
import { helpHref, helpTopic, type HelpTopicId } from "@/lib/help-topics";
import {
  GUIDES,
  guideById,
  guideHref,
  guideLinkHref,
  isGuideId,
} from "@/lib/learn-content";
import styles from "../../../../_components/learn/learn-page.module.css";

const GUIDE_META: Record<string, { title: string; description: string }> = {
  "prepare-structure": {
    title: "Prepare a molecular structure | ChemDFT",
    description:
      "Learn how to import or draw a molecule, understand atomic coordinates, and specify charge and spin multiplicity in ChemDFT.",
  },
  "run-calculation": {
    title: "Run a quantum chemistry calculation | ChemDFT",
    description:
      "Understand quantum chemistry methods, basis sets, human job approval, and computational execution workflows in ChemDFT.",
  },
  "understand-results": {
    title: "Understand calculation results | ChemDFT",
    description:
      "Learn how to inspect calculated energies, convergence, provenance, and scientific evidence in ChemDFT calculation results.",
  },
  "scientific-authority": {
    title: "How ChemDFT labels scientific data | ChemDFT",
    description:
      "Five kinds of information ChemDFT keeps apart: user-supplied, source-referenced, calculated, AI explanation, and validated.",
  },
};

export const dynamicParams = false;
export function generateStaticParams() {
  return GUIDES.map((guide) => ({ guide: guide.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ guide: string }> }): Promise<Metadata> {
  const { guide } = await params;
  const meta = GUIDE_META[guide];
  if (!meta) return {};
  return createPublicMetadata({
    title: meta.title,
    description: meta.description,
    path: `/en/learn/guides/${guide}`,
  });
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ locale: string; guide: string }>;
}) {
  const { locale, guide: id } = await params;
  if (!isLocale(locale) || !isGuideId(id)) notFound();
  const guide = guideById(id);
  const next = guide.next ? guideById(guide.next) : null;
  const related = [...new Set(guide.steps.flatMap((step) => step.topics ?? []))] as HelpTopicId[];
  return (
    <main id="main-content" className={styles.article} data-guide={guide.id} data-accent={guide.accent}>
      <header className={styles.articleHead}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link href={`/${locale}/learn`}>
            <AppIcon icon="arrow-left" />
            Learn
          </Link>
          <span aria-hidden="true">/</span>
          <span>{guide.number ? "Getting started" : "Sources and authority"}</span>
        </nav>
        <p className={styles.kicker}>{guide.number ? `Tutorial ${guide.number}` : "Reference"}</p>
        <h1>{guide.title}</h1>
        <p className={styles.articleLead}>{guide.intro}</p>
      </header>
      <div className={styles.articleBody}>
        <ol className={styles.steps}>
          {guide.steps.map((step, index) => (
            <li key={step.title} className={styles.step} id={`step-${index + 1}`}>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                {(step.topics?.length || step.where) && (
                  <div className={styles.stepLinks}>
                    {step.where && (
                      <Link href={guideLinkHref(locale, step.where.to)}>
                        {step.where.label}
                        <AppIcon icon="arrow-right" />
                      </Link>
                    )}
                    {step.topics?.map((topic) => (
                      <Link key={topic} href={helpHref(locale, topic)}>
                        {helpTopic(locale, topic).title}
                        <AppIcon icon="arrow-right" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        {guide.notice && (
          <aside className={styles.notice} data-tone={guide.notice.tone} aria-label="Availability in ChemDFT">
            <AppIcon icon={guide.notice.tone === "limit" ? "warning-sign" : "info-sign"} />
            <div>
              <strong>{guide.notice.title}</strong>
              <p>{guide.notice.text}</p>
            </div>
          </aside>
        )}
        <section className={styles.boundaries} aria-labelledby="boundaries">
          <h2 id="boundaries">What this page will not do</h2>
          <ul>
            {guide.boundaries.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>
      <aside className={styles.aside} aria-label="Guide navigation">
        <nav className={styles.panel} aria-labelledby="in-guide">
          <h2 id="in-guide">In this guide</h2>
          <ul>
            {guide.steps.map((step, index) => (
              <li key={step.title}>
                <a href={`#step-${index + 1}`}>
                  <span>
                    {index + 1}. {step.title}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {next && (
          <nav className={styles.panel} aria-labelledby="next-guide">
            <h2 id="next-guide">Next tutorial</h2>
            <ul>
              <li>
                <Link href={guideHref(locale, next.id)}>
                  <span>
                    {next.number}. {next.title}
                  </span>
                  <AppIcon icon="arrow-right" />
                </Link>
              </li>
            </ul>
          </nav>
        )}
        {related.length > 0 && (
          <nav className={styles.panel} aria-labelledby="guide-topics">
            <h2 id="guide-topics">Related topics</h2>
            <ul>
              {related.map((topic) => (
                <li key={topic}>
                  <Link href={helpHref(locale, topic)}>
                    <span>{helpTopic(locale, topic).title}</span>
                    <AppIcon icon="arrow-right" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
    </main>
  );
}
