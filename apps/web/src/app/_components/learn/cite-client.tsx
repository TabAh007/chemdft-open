"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionButton, AppIcon } from "@chemdft/ui";
import { CITATION_METADATA, SOFTWARE_CITATION_FORMATS, softwareCitation } from "@/lib/citation";
import { ENGINE_REFERENCES, RDKIT_CITATION } from "@/content/engine-citations";
import { THIRD_PARTY_CITATIONS } from "@/content/third-party-citations";
import styles from "./cite.module.css";

interface CopyBlockProps {
  id: string;
  label: string;
  formatTag: string;
  value: string;
}

function CopyBlock({ id, label, formatTag, value }: CopyBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div className={styles.citationCard} id={id}>
      <div className={styles.citationCardHeader}>
        <div className={styles.formatLabel}>
          <span className={styles.formatTag}>{formatTag}</span>
          <span>{label}</span>
        </div>
        <ActionButton
          type="button"
          icon={copied ? "tick" : "clipboard"}
          intent={copied ? "success" : "none"}
          minimal
          onClick={handleCopy}
          aria-label={`Copy ${label} citation to clipboard`}
          aria-live="polite"
        >
          {copied ? "Copied" : "Copy citation"}
        </ActionButton>
      </div>
      <pre className={styles.codeBlock} tabIndex={0} aria-label={`${label} citation text`}>
        <code>{value}</code>
      </pre>
    </div>
  );
}

export function HowToCiteContent({ locale }: { locale: string }) {
  const author = CITATION_METADATA.authors[0];
  if (!author) return null;

  return (
    <main id="main-content" className={`${styles.citePage} ${styles.article}`}>
      <header className={styles.articleHead}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link href={`/${locale}/learn`}>
            <AppIcon icon="arrow-left" />
            Learn
          </Link>
          <span aria-hidden="true">/</span>
          <span>Citation</span>
        </nav>
        <h1>How to cite ChemDFT</h1>
        <p className={styles.articleLead}>
          ChemDFT is research software for reproducible computational chemistry. If you use
          ChemDFT in academic work, theses, or publications, please cite the software and the
          verified computational engines that produced your results.
        </p>
      </header>

      <div className={styles.articleBody}>
        {/* Cite ChemDFT: first thing on the page, one copy button per format */}
        <section className={styles.section} aria-labelledby="software-citation-title">
          <h2 id="software-citation-title">Cite ChemDFT</h2>
          <p>
            Standard software citation metadata is published in the repository root{" "}
            <code>CITATION.cff</code> (Citation File Format 1.2.0). Copy the citation in the format you need:
          </p>
          {SOFTWARE_CITATION_FORMATS.map((entry) => (
            <CopyBlock key={entry.key} id={`citation-${entry.key}`} label={entry.label} formatTag={entry.label} value={softwareCitation(entry.key).text} />
          ))}
          <p>
            Citing a result? Open it and choose <strong>Cite</strong>: it copies the citation for that calculation and the one for ChemDFT.
          </p>
        </section>

        {/* Scientific Calculations & Provenance Section */}
        <section className={styles.section} aria-labelledby="calculation-provenance-title">
          <h2 id="calculation-provenance-title">Citing scientific calculations & provenance</h2>
          <p>
            ChemDFT is built on a strict Result Firewall: while the AI Scientist plans, explains,
            and inspects computational workflows, numerical scientific values originate solely from
            deterministic, validated scientific engines.
          </p>

          <div className={styles.notice} data-tone="integrity">
            <span className={styles.noticeIcon} aria-hidden="true">
              <AppIcon icon="shield" />
            </span>
            <div className={styles.noticeText}>
              <strong>Calculations carry their own calculation IDs and verification state</strong>
              <p>
                Every calculation executed or imported in ChemDFT receives a permanent,
                project-scoped calculation ID, cryptographic artifact hashes, and an explicit
                Result Firewall verification state (such as <code>VALIDATED</code> or{" "}
                <code>CALCULATED</code>).
              </p>
              <p>
                Private calculation IDs and workspace URLs identify internal records within your
                project; they are not public scholarly DOIs. ChemDFT does not fabricate DOIs,
                software versions, or external publication references.
              </p>
            </div>
          </div>

          <p>
            When describing computational methodology in research publications, researchers should:
          </p>
          <ul style={{ margin: "0 0 8px", paddingLeft: "24px", lineHeight: 1.6 }}>
            <li>
              <strong>Cite the specific engine:</strong> Attribute the exact quantum chemical
              engine that executed the job (such as PySCF or xTB), citing the engine&apos;s primary
              literature.
            </li>
            <li>
              <strong>Record the calculation parameters:</strong> Report the method/functional,
              basis set, charge, multiplicity, and geometry coordinates exactly as recorded in the
              provenance ledger.
            </li>
            <li>
              <strong>Cite ChemDFT:</strong> Cite ChemDFT for workbench orchestration, electronic
              state verification, and workflow management using the software citation above.
            </li>
          </ul>
        </section>

        {/* Citing a calculation, engines, ORCID */}
        <section className={styles.section} aria-labelledby="cite-calculation-title">
          <h2 id="cite-calculation-title">Cite a calculation</h2>
          <p>
            On a result or a finished job, <strong>Cite this calculation</strong> gives BibTeX, RIS, APA and plain text, a
            <strong> Methods paragraph</strong> and a <strong>reproducibility JSON</strong>. All of them are built only from the
            stored record: engine and version, method, basis set, charge, multiplicity, structure version and input hash, job ID, platform,
            environment digest and Result Firewall status. A fact that was not recorded is printed as &ldquo;not recorded&rdquo;.
            The JSON leaves out structure and project names, coordinates, logs and artifact bytes; the hash-verified evidence archive under
            Export &amp; reports carries the rest.
          </p>
          <p>
            Your ORCID iD is added as an author identifier only if you linked it in Settings and tick the box on that citation; an iD
            from the ORCID sandbox (a test record) is never added. Calculations have internal calculation IDs rather than public DOIs.
            The ChemDFT software citation carries the official Zenodo Concept DOI (10.5281/zenodo.24082321) which always resolves to the latest version; the Zenodo record is an archival snapshot of the open-core parts only.
          </p>
          <p data-testid="cite-licence-line">
            Licence: ChemDFT&rsquo;s own code is licensed under Apache-2.0, and every engine it calls keeps its own
            licence. <Link href={`/${locale}/license`}>See the licences</Link>.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="cite-engines-title">
          <h2 id="cite-engines-title">Cite the engines</h2>
          <p>
            References below are the ones each project asks for on its own page (checked 2026-11-03; every DOI resolves). Psi4 and DFT-D4 follow their own pages (Psi4 lists its 1.4 paper for the package). QCEngine is
            not listed: citation text not verified here; cite it from its own project.
          </p>
          <ul style={{ margin: "0 0 8px", paddingLeft: "24px", lineHeight: 1.6 }}>
            {Object.values(ENGINE_REFERENCES).map((ref) => (
              <li key={ref.key}>
                {ref.authors.slice(0, 3).map(([family, given]) => `${family}, ${given}`).join("; ")}
                {ref.authors.length > 3 || ref.moreAuthors ? "; et al." : ""} {ref.title}. <em>{ref.journal}</em> {ref.year}, {ref.volume}, {ref.pages}.{" "}
                <a href={`https://doi.org/${ref.doi}`} target="_blank" rel="noopener noreferrer">doi:{ref.doi}</a>{" "}
                (<a href={ref.listedBy} target="_blank" rel="noopener noreferrer">listed by the project</a>)
              </li>
            ))}
            <li>
              RDKit has no official publication; the project asks for &ldquo;{RDKIT_CITATION.text}&rdquo; and the DOI of the version used (
              <a href={RDKIT_CITATION.versionDoisUrl} target="_blank" rel="noopener noreferrer">version DOIs</a>).
            </li>
          </ul>
        </section>

        {/* Cite your data sources too */}
        <section className={styles.section} aria-labelledby="cite-data-sources-title" data-testid="cite-data-sources-section">
          <h2 id="cite-data-sources-title">Cite your data sources too</h2>
          <p>
            If you imported a structure from a paper, a CIF, COD, Materials Project, PubChem or any database,
            cite the original source; ChemDFT is only the tool.
          </p>
          <div className={styles.workedExampleCard}>
            <h3 style={{ margin: "0 0 6px", fontSize: "1rem", fontWeight: 600 }}>Worked example: Cr₂O₃ from COD 9014036</h3>
            <p style={{ margin: "0 0 6px" }}>
              Sawada, H., Materials Research Bulletin 29 (1994) 239-245.
            </p>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--cdf-ink-muted)" }}>
              Full publication: Sawada, H. (1994). An electron density residual study of alpha-Fe2O3 and alpha-Cr2O3. <em>Materials Research Bulletin</em>, 29(3), 239–245. Crystallography Open Database ID: 9014036.
            </p>
          </div>
          <p>
            ChemDFT prints the source it finds in the CIF under &ldquo;Structure Source Reference&rdquo; in exports,
            and says &ldquo;No source reference found in file — add one&rdquo; when there is none.
          </p>
        </section>

        {/* Also cite: Third-party scientific tools */}
        <section className={styles.section} aria-labelledby="also-cite-title" data-testid="also-cite-section">
          <h2 id="also-cite-title">Also cite</h2>
          <p>
            When you run calculations, geometry optimizations, or visualize crystal structures in ChemDFT,
            several verified third-party scientific tools and libraries may contribute to your results:
            pymatgen, RDKit, PySCF, xTB, CREST, geomeTRIC, DFT-D4, and Three.js (viewer).
          </p>
          <p>
            The list is generated automatically in report exports under the &ldquo;Also cite&rdquo; section, based on the
            tools actually invoked for your project. The full registry:
          </p>
          <ul style={{ margin: "0 0 8px", paddingLeft: "24px", lineHeight: 1.6 }}>
            {Object.values(THIRD_PARTY_CITATIONS).map((tool) => (
              <li key={tool.name}>
                <strong>{tool.name}</strong> (v{tool.version}): {tool.apa}{" "}
                {tool.doi ? (
                  <a href={`https://doi.org/${tool.doi}`} target="_blank" rel="noopener noreferrer">
                    doi:{tool.doi}
                  </a>
                ) : (
                  <span>(no DOI registered)</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Ownership and Attribution Section */}
        <section className={styles.section} aria-labelledby="scientific-ownership-title">
          <h2 id="scientific-ownership-title">Scientific ownership & attribution</h2>
          <p>
            Researchers retain full ownership of their scientific discoveries and calculations.
            ChemDFT receives software attribution, never automatic co-authorship.
          </p>
        </section>
      </div>

      {/* Sidebar Aside */}
      <aside className={styles.aside} aria-label="Citation details and resources">
        <div className={styles.panel}>
          <h2>Citation metadata</h2>
          <dl className={styles.metaList}>
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Software</dt>
              <dd className={styles.metaValue}>{CITATION_METADATA.title}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Author</dt>
              <dd className={styles.metaValue}>
                {author.givenNames} {author.familyNames}
                {author.affiliation ? ` (${author.affiliation})` : ""}
              </dd>
            </div>
            {author.orcid && (
              <div className={styles.metaItem}>
                <dt className={styles.metaLabel}>ORCID</dt>
                <dd className={styles.metaValue}>
                  <a
                    href={author.orcid}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    0009-0006-0198-5253
                  </a>
                </dd>
              </div>
            )}
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Website</dt>
              <dd className={styles.metaValue}>
                <a
                  href={CITATION_METADATA.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  chemdft.com
                </a>
              </dd>
            </div>
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Metadata format</dt>
              <dd className={styles.metaValue}>CFF 1.2.0 (CITATION.cff)</dd>
            </div>
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Software DOI</dt>
              <dd className={styles.metaValue}>
                <a
                  href={`https://doi.org/${CITATION_METADATA.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {CITATION_METADATA.doi}
                </a>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--cdf-ink-muted)", marginTop: "3px" }}>
                  Concept DOI {CITATION_METADATA.doi} always resolves to the latest version
                </span>
              </dd>
            </div>
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Archival scope</dt>
              <dd className={styles.metaValue}>Open-core parts only (Apache-2.0)</dd>
            </div>
          </dl>
        </div>

        <div className={styles.panel}>
          <h2>Related resources</h2>
          <ul className={styles.panelLinks}>
            <li>
              <Link href={`/${locale}/learn`}>
                <span>Learn ChemDFT</span>
                <AppIcon icon="arrow-right" />
              </Link>
            </li>
            <li>
              <Link href={`/${locale}/learn/guides/scientific-authority`}>
                <span>Scientific authority guide</span>
                <AppIcon icon="arrow-right" />
              </Link>
            </li>
            <li>
              <Link href={`/${locale}/examples`}>
                <span>Reference examples</span>
                <AppIcon icon="arrow-right" />
              </Link>
            </li>
            <li>
              <Link href={`/${locale}/projects`}>
                <span>Scientific Projects</span>
                <AppIcon icon="arrow-right" />
              </Link>
            </li>
          </ul>
        </div>
      </aside>
    </main>
  );
}
