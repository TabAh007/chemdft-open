"use client";

import { useState, type ReactNode } from "react";
import { AppIcon } from "@chemdft/ui";
import type { ScientificStateView, StateIntent } from "@/lib/scientific-state";
import styles from "./results-ui.module.css";

export function Tag({ intent, children, ...rest }: { intent?: StateIntent | undefined; children: ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={styles.tag} data-intent={intent && intent !== "none" ? intent : undefined} {...rest}>{children}</span>;
}

/** A technical identifier: monospace, truncated in the layout, copyable, never taking over the UI. */
export function CopyValue({ value, label, short = false }: { value: string; label: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  const shown = short && value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  return (
    <span className={styles.idRow}>
      <span className={styles.mono} title={value}>{shown}</span>
      <button
        type="button" className={styles.copy} aria-label={`Copy ${label}`}
        onClick={() => {
          if (typeof navigator === "undefined" || !navigator.clipboard) return;
          void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => {});
        }}
      >{copied ? "Copied" : "Copy"}</button>
    </span>
  );
}

/**
 * The primary stored scientific value, shown prominently once. The unit is the stored one; unit conversions are
 * identified as derived representations and only appear for hartree values (deterministic constants).
 */
export function PrimaryReadout({ label, valueText, unit, note, derived, convergence, exact }: {
  label: string;
  valueText: string;
  unit: string;
  note: string | null;
  derived: { eV: string; kcalPerMol: string } | null;
  convergence?: { known: boolean; converged: boolean; iterations: number | null } | undefined;
  exact?: string | undefined;
}) {
  return (
    <div className={styles.readout} data-testid="primary-readout">
      <span className={styles.kicker}>Primary stored result</span>
      <span className={styles.readoutLabel}>{label}</span>
      <div className={styles.readoutValue}>
        <strong data-testid="primary-value" title={exact ? `Stored value: ${exact}` : undefined}>{valueText}</strong>
        {unit ? <span data-testid="primary-unit">{unit}</span> : null}
      </div>
      <div className={styles.readoutMeta}>
        {convergence ? (
          convergence.known
            ? <Tag intent={convergence.converged ? "success" : "danger"} data-testid="primary-convergence">
                {convergence.converged ? "SCF converged" : "SCF not converged"}{convergence.iterations !== null ? ` · ${convergence.iterations} iteration${convergence.iterations === 1 ? "" : "s"}` : ""}
              </Tag>
            : <Tag data-testid="primary-convergence">Convergence not reported</Tag>
        ) : null}
        {derived ? <span className={styles.derived} data-testid="primary-derived"><i>Derived</i>{derived.eV} eV · {derived.kcalPerMol} kcal/mol</span> : null}
      </div>
      {note ? <p className={styles.caption} data-testid="primary-note">{note}</p> : null}
    </div>
  );
}

/**
 * Authority, platform validation, independent verification and standing/lineage as four separate scientific facts.
 * An authoritative, validated result may still be not independently verified; nothing here merges them.
 */
export function AuthorityPanel({ view }: { view: ScientificStateView }) {
  return (
    <section className={`${styles.panel} ${styles.panelPad} ${styles.authority}`} aria-label="Scientific authority" data-testid="authority-panel" data-currently-authoritative={view.currentlyAuthoritative ? "true" : "false"}>
      <span className={styles.kicker}>Scientific authority</span>
      <div className={styles.authorityGrid}>
        <div className={styles.axis} data-axis="authority">
          <h3>Result authority</h3>
          <Tag intent={view.authority.intent}>{view.authority.label}</Tag>
          <p>The role this stored result may play.</p>
        </div>
        <div className={styles.axis} data-axis="validation">
          <h3>Platform validation</h3>
          <Tag intent={view.validation.intent}>{view.validation.label}</Tag>
          <p>The platform&apos;s own validators accepted the output.</p>
        </div>
        <div className={styles.axis} data-axis="verification">
          <h3>Independent verification</h3>
          <Tag intent={view.verification.intent}>{view.verification.label}</Tag>
          <p>Reproduction by an independent method.</p>
        </div>
        <div className={styles.axis} data-axis="standing">
          <h3>Standing &amp; lineage</h3>
          <Tag intent={view.currentlyAuthoritative ? "success" : view.effectiveKnown ? "warning" : "none"} data-testid="standing-tag">
            {view.currentlyAuthoritative ? "Current" : view.effectiveKnown ? "Historical" : "Not asserted"}
          </Tag>
          <p>{view.lineage.label}.</p>
        </div>
      </div>
      {view.notes.length > 0 ? <ul className={styles.notes} data-testid="authority-notes">{view.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      {view.stored ? <p className={styles.caption} data-testid="stored-state">Recorded at publication: {view.stored.authority} / {view.stored.validation} / {view.stored.verification}</p> : null}
    </section>
  );
}

/** One collapsible evidence section. Its body mounts only when opened, so nothing is fetched until it is wanted. */
export function Section({ id, title, summary, open, onToggle, children }: {
  id: string; title: string; summary: ReactNode; open: boolean; onToggle: (open: boolean) => void; children: ReactNode;
}) {
  return (
    <div className={styles.section} id={`section-${id}`} data-testid={`section-${id}`}>
      <h3 style={{ margin: 0 }}>
        <button type="button" className={styles.sectionHead} aria-expanded={open} aria-controls={`section-body-${id}`} onClick={() => onToggle(!open)} data-testid={`section-toggle-${id}`}>
          <strong>{title}</strong>
          <span>{summary}</span>
          <span className={styles.chev} aria-hidden="true"><AppIcon icon="chevron-right" /></span>
        </button>
      </h3>
      {open ? <div className={styles.sectionBody} id={`section-body-${id}`} role="region" aria-label={title}>{children}</div> : null}
    </div>
  );
}
