import Link from "next/link";
import { type SeoPageData, HOSTED_LIMITS_SUMMARY } from "../../../content/seo-pages";
import { getSeoPageJsonLd } from "../../../lib/seo";
import { RUN, fixed } from "../home/run-record";
import { VALIDATION_RUN } from "../../../content/site-pages";
import styles from "./seo-page.module.css";

export function SeoPageView({
  locale,
  data,
}: {
  locale: string;
  data: SeoPageData;
}) {
  const jsonLd = getSeoPageJsonLd({
    pageTitle: data.title,
    path: `/${locale}/${data.slug}`,
    faqs: data.faqs,
  });

  return (
    <article className={styles.container}>
      {/* Server-rendered structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href={`/${locale}`}>Home</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/${locale}/learn`}>Learn</Link>
        <span aria-hidden="true">/</span>
        <span className={styles.breadcrumbCurrent}>{data.h1}</span>
      </nav>

      <header className={styles.hero}>
        <p className={styles.kicker}>{data.kicker}</p>
        <h1 className={styles.title}>{data.h1}</h1>
        <p className={styles.lead}>{data.lead}</p>
        <div className={styles.actions}>
          <Link href={`/${locale}/login`} className={styles.primaryBtn}>
            Try it free
          </Link>
          <Link href={`/${locale}/examples`} className={styles.secondaryBtn}>
            See a worked example
          </Link>
        </div>
        <p className={styles.actionNote}>
          Sign in with Google. No credit card required. Free for researchers during the beta.
        </p>
      </header>

      {/* Prominent Limits Card */}
      <section className={styles.limitsCard} aria-labelledby="limits-heading">
        <h2 id="limits-heading">{data.limitsHeading}</h2>
        <div className={styles.limitsGrid}>
          <div className={styles.limitPill}>
            <span className={styles.limitPillLabel}>PySCF Opt & Orbitals</span>
            <span className={styles.limitPillValue}>≤ {HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms</span>
          </div>
          <div className={styles.limitPill}>
            <span className={styles.limitPillLabel}>PySCF Freq & TDDFT</span>
            <span className={styles.limitPillValue}>≤ {HOSTED_LIMITS_SUMMARY.pyscfFrequencies} atoms</span>
          </div>
          <div className={styles.limitPill}>
            <span className={styles.limitPillLabel}>xTB (GFN2) Energy & Opt</span>
            <span className={styles.limitPillValue}>≤ {HOSTED_LIMITS_SUMMARY.xtb} atoms</span>
          </div>
          <div className={styles.limitPill}>
            <span className={styles.limitPillLabel}>CREST Conformer Search</span>
            <span className={styles.limitPillValue}>≤ {HOSTED_LIMITS_SUMMARY.crest} atoms</span>
          </div>
          <div className={styles.limitPill}>
            <span className={styles.limitPillLabel}>Quantum ESPRESSO (QE)</span>
            <span className={styles.limitPillValue}>≤ {HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms</span>
          </div>
          <div className={styles.limitPill}>
            <span className={styles.limitPillLabel}>Periodic PySCF</span>
            <span className={styles.limitPillValue}>≤ {HOSTED_LIMITS_SUMMARY.periodicPyscf} atoms</span>
          </div>
        </div>
        {data.limitsParagraphs.map((p, idx) => (
          <p key={idx}>{p}</p>
        ))}
      </section>

      {/* Main Content Sections */}
      {data.sections.map((section, sIdx) => (
        <section key={sIdx} className={styles.section}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((p, pIdx) => (
            <p key={pIdx}>{p}</p>
          ))}

          {/* Special Custom Tables for targeted pages */}
          {data.slug === "gaussian-alternative" && sIdx === 1 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="ChemDFT vs Gaussian comparison">
                <thead>
                  <tr>
                    <th scope="col">Capability / Dimension</th>
                    <th scope="col">ChemDFT (Hosted Beta)</th>
                    <th scope="col">Gaussian (Commercial)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Access & Licensing</strong></td>
                    <td>Free during beta; browser-based; no software installation.</td>
                    <td>Commercial proprietary license; local or cluster installation required.</td>
                  </tr>
                  <tr>
                    <td><strong>System Size Limits</strong></td>
                    <td>Small molecules and crystals: PySCF ≤12 atoms, xTB ≤50 atoms, QE ≤20 atoms.</td>
                    <td>Up to 250,000 atoms documented program limit (gaussian.com Model Chemistries).</td>
                  </tr>
                  <tr>
                    <td><strong>Electronic Methods</strong></td>
                    <td>PySCF HF, B3LYP, PBE (gas phase); GFN2-xTB; Quantum ESPRESSO 7.6.</td>
                    <td>Extensive: HF, DFT, MP2–MP5, Coupled Cluster (CCSD(T)), CASSCF, ONIOM.</td>
                  </tr>
                  <tr>
                    <td><strong>File Compatibility</strong></td>
                    <td>Cannot run Gaussian input files; imports Gaussian 09/16 & ORCA output (via cclib).</td>
                    <td>Native Gaussian input (.gjf, .com) and checkpoint (.chk) execution.</td>
                  </tr>
                  <tr>
                    <td><strong>Post-HF Methods</strong></td>
                    <td>Coupled cluster and MP2 are not hosted on ChemDFT.</td>
                    <td>Full suite of high-accuracy composite methods (G1–G4, CBS-QB3, W1).</td>
                  </tr>
                  <tr>
                    <td><strong>AI Assistance & Integrity</strong></td>
                    <td>AI Scientist plans and explains; Result Firewall verifies engine numbers.</td>
                    <td>Manual scripting or GUI tools (GaussView); no built-in AI Scientist.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          {data.slug === "homo-lumo-calculator" && sIdx === 2 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="Real water calculation stored orbital eigenvalues">
                <thead>
                  <tr>
                    <th scope="col">Quantity</th>
                    <th scope="col">Calculated Value (Hartree)</th>
                    <th scope="col">Calculated Value (eV)</th>
                    <th scope="col">Provenance / Details</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Total Ground-State Energy</strong></td>
                    <td>{fixed(RUN.result.total_energy_hartree, 6)} Ha</td>
                    <td>—</td>
                    <td>PySCF 2.14.0, RHF/STO-3G, 7 SCF iterations</td>
                  </tr>
                  <tr>
                    <td><strong>HOMO (Orbital #{RUN.result.homo.index})</strong></td>
                    <td>{fixed(RUN.result.homo.energy_hartree, 6)} Ha</td>
                    <td>{fixed(RUN.result.homo.energy_ev, 3)} eV</td>
                    <td>Occupied alpha orbital (5 alpha electrons)</td>
                  </tr>
                  <tr>
                    <td><strong>LUMO (Orbital #{RUN.result.lumo.index})</strong></td>
                    <td>{fixed(RUN.result.lumo.energy_hartree, 6)} Ha</td>
                    <td>{fixed(RUN.result.lumo.energy_ev, 3)} eV</td>
                    <td>Lowest unoccupied alpha orbital</td>
                  </tr>
                  <tr>
                    <td><strong>Frontier Energy Gap (ΔE)</strong></td>
                    <td>{fixed(RUN.result.gap_hartree, 6)} Ha</td>
                    <td>{fixed(RUN.result.gap_ev, 3)} eV</td>
                    <td>Orbital-energy difference (not optical excitation)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          {data.slug === "quantum-espresso-online" && sIdx === 2 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="Alpha-Cr2O3 Quantum ESPRESSO benchmark agreement">
                <thead>
                  <tr>
                    <th scope="col">Benchmark Quantity</th>
                    <th scope="col">Through ChemDFT Platform</th>
                    <th scope="col">Direct Container pw.x Run</th>
                  </tr>
                </thead>
                <tbody>
                  {VALIDATION_RUN.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      <td><strong>{row[0]}</strong></td>
                      <td>{row[1]}</td>
                      <td>{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ))}

      {/* Honest Research Aid Disclaimer Callout */}
      <aside className={styles.firewallNotice} aria-label="Scientific integrity statement">
        <h3>Research Aid Notice & Scientific Result Firewall</h3>
        <p>
          Calculations performed on ChemDFT are intended as an exploratory research aid and must be independently verified prior to publication.
          ChemDFT enforces the Scientific Result Firewall: artificial intelligence models assist in workflow planning and scientific explanation, but they never author, alter, or interpolate numerical calculation results. All values come directly from genuine open-source engines.
        </p>
      </aside>

      {/* Frequently Asked Questions */}
      <section className={styles.faqSection} aria-labelledby="faq-heading">
        <h2 id="faq-heading">Frequently Asked Questions</h2>
        <div className={styles.faqList}>
          {data.faqs.map((faq, fIdx) => (
            <div key={fIdx} className={styles.faqItem}>
              <h3 className={styles.faqQuestion}>{faq.question}</h3>
              <p className={styles.faqAnswer}>{faq.answer}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Core Policy and Documentation Links */}
      <nav className={styles.siteNavLinks} aria-label="Policy and verification documentation">
        <h3>Scientific Standards & Governance</h3>
        <div className={styles.linkGroup}>
          <Link href={`/${locale}/validation`}>Platform Validation</Link>
          <Link href={`/${locale}/examples`}>Worked Examples</Link>
          <Link href={`/${locale}/principles`}>Scientific Principles</Link>
          <Link href={`/${locale}/learn/cite`}>How to Cite</Link>
          <Link href={`/${locale}/license`}>Open-Core License</Link>
          <Link href={`/${locale}/cost-and-support`}>Cost & Support</Link>
        </div>
      </nav>

      {/* Related Calculation Guides */}
      {data.relatedPages.length > 0 ? (
        <nav className={styles.relatedGuides} aria-label="Related calculation guides">
          <h3>Related Calculation Guides</h3>
          <div className={styles.guideCards}>
            {data.relatedPages.map((related, rIdx) => (
              <Link key={rIdx} href={related.href} className={styles.guideCard}>
                <span className={styles.guideCardTitle}>{related.title}</span>
                <span className={styles.guideCardReason}>{related.reason}</span>
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </article>
  );
}
