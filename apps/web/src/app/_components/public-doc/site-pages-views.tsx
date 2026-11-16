import Link from "next/link";

import { AI_DISCLOSURE, COST_SUPPORT, PRINCIPLES, VALIDATION_RUN } from "../../../content/site-pages";
import styles from "./public-doc.module.css";

export function PrinciplesView({ locale }: { locale: string }) {
  return (
    <>
      <header className={styles.head}>
        <h1>Principles</h1>
        <p className={styles.lead}>The rules ChemDFT is built under, and what it does not claim.</p>
      </header>
      {PRINCIPLES.map((item) => (
        <section key={item.id} className={styles.section} aria-labelledby={item.id}>
          <h2 id={item.id}>{item.title}</h2>
          {item.body.map((text) => <p key={text}>{text}</p>)}
        </section>
      ))}
      <section className={styles.section} aria-labelledby="ai-disclosure" data-testid="ai-disclosure">
        <h2 id="ai-disclosure">How AI was used to build ChemDFT</h2>
        <p>{AI_DISCLOSURE.intro}</p>
        <ul>{AI_DISCLOSURE.facts.map((t) => <li key={t}>{t}</li>)}</ul>
        <h3>What this does not show</h3>
        <ul>{AI_DISCLOSURE.limits.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <p className={styles.notice}>
        See also <Link href={`/${locale}/validation`}>Validation</Link>, <Link href={`/${locale}/cost-and-support`}>Cost and support</Link> and{" "}
        <Link href={`/${locale}/license`}>License</Link>.
      </p>
    </>
  );
}

export function CostSupportView({ locale }: { locale: string }) {
  return (
    <>
      <header className={styles.head}>
        <h1>Cost and support</h1>
        <p className={styles.lead}>What using ChemDFT costs today, and what support to expect.</p>
      </header>
      <section className={styles.section} aria-labelledby="cost">
        <h2 id="cost">Cost</h2>
        <ul>{COST_SUPPORT.cost.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <section className={styles.section} aria-labelledby="support">
        <h2 id="support">Support</h2>
        <ul>{COST_SUPPORT.support.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <p className={styles.notice}>
        <Link href={`/${locale}/contact`}>Contact</Link> · <Link href={`/${locale}/principles`}>Principles</Link>
      </p>
    </>
  );
}

export function ValidationView({ locale }: { locale: string }) {
  const run = VALIDATION_RUN;
  return (
    <>
      <header className={styles.head}>
        <h1>Validation</h1>
        <p className={styles.lead}>
          One measured check: a stored ChemDFT job compared with the same Quantum ESPRESSO input run directly. It is the only result the site
          compares with an independent run, and only within the limits below. Live platform checks of the hosted service are listed after the limits.
        </p>
      </header>
      <section className={styles.section} aria-labelledby="setup">
        <h2 id="setup">What was run</h2>
        <p>{run.system}, {run.engine}, pseudopotentials {run.library}.</p>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Run settings">
          <table className={styles.table}>
            <tbody>{run.settings.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td><code>{v}</code></td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="comparison">
        <h2 id="comparison">What was compared</h2>
        <p>{run.liveRef}</p>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Comparison">
          <table className={`${styles.table} ${styles.stack}`}>
            <thead><tr>{run.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
            <tbody>{run.rows.map(([a, b, c]) => <tr key={a}><th scope="row">{a}</th><td data-label="Live site">{b}</td><td data-label="Direct run">{c}</td></tr>)}</tbody>
          </table>
        </div>
        <p style={{ marginTop: 12 }}>{run.earlier}</p>
      </section>
      <section className={styles.section} aria-labelledby="limits" data-testid="validation-limits">
        <h2 id="limits">Limits</h2>
        <ul>{run.limits.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <section className={styles.section} aria-labelledby="live-checks" data-testid="validation-live-checks">
        <h2 id="live-checks">{run.liveChecksTitle}</h2>
        <p>{run.liveChecksIntro}</p>
        <ul>{run.liveChecks.map((t) => <li key={t}>{t}</li>)}</ul>
        <h3>Not done or open</h3>
        <ul>{run.liveChecksNotDone.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <p className={styles.notice}>
        See <Link href={`/${locale}/principles`}>Principles</Link> and the engine status in the <Link href={`/${locale}#engines`}>Engines</Link> section.
      </p>
    </>
  );
}
