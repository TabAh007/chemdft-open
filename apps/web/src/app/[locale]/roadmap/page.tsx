import { isLocale } from "@chemdft/i18n";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";

import { ROADMAP_SECTIONS } from "../../../content/roadmap";
import { ProductHeader } from "../../_components/product-header";
import styles from "./roadmap.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Public development roadmap | ChemDFT",
    description:
      "Explore planned, in-progress, and completed capabilities for ChemDFT, including quantum chemistry engines, periodic DFT, and analysis tools.",
    path: "/en/roadmap",
  });
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: "In Progress",
  planned: "Planned",
  done: "Completed",
};

export default async function RoadmapPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <div className="projects-index">
      <ProductHeader locale={locale} active="none" />
      <main id="main-content" className="projects-main">
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>ChemDFT Roadmap</h1>
            <p className={styles.subtitle}>
              Publicly planned, active, and completed technical developments for the ChemDFT computational chemistry platform.
            </p>
            <div className={styles.notice}>
              Owner-curated roadmap reflecting architectural phases and verified capabilities. Becoming an open Gaussian replacement is a long-term goal, not a present fact; today ChemDFT runs small systems within transparent hosted limits. No speculative completion dates are listed.
            </div>
          </header>

          {ROADMAP_SECTIONS.map((section) => (
            <section key={section.status} className={styles.section} aria-labelledby={`roadmap-section-${section.status}`}>
              <div className={styles.sectionHeader}>
                <h2 id={`roadmap-section-${section.status}`} className={styles.sectionTitle}>
                  {section.title}
                </h2>
                <p className={styles.sectionDesc}>{section.description}</p>
              </div>

              <div className={styles.grid}>
                {section.items.map((item) => {
                  let statusClass = styles.statusPlanned;
                  if (item.status === "in_progress") statusClass = styles.statusInProgress;
                  if (item.status === "done") statusClass = styles.statusDone;

                  return (
                    <article key={item.id} className={styles.card} data-testid={`roadmap-item-${item.id}`}>
                      <div className={styles.cardHeader}>
                        <h3 className={styles.itemTitle}>{item.title}</h3>
                        {item.category ? <span className={styles.categoryTag}>{item.category}</span> : null}
                      </div>
                      <p className={styles.itemDesc}>{item.shortDescription}</p>
                      <div className={`${styles.statusBar} ${statusClass}`}>
                        <span>&bull;</span>
                        <span>{STATUS_LABELS[item.status] || item.status}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
