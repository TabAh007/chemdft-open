"use client";

import { AppIcon } from "@chemdft/ui";
import type { IconName } from "@chemdft/ui";
import type { ReadinessRow, ReadinessTone, Restriction } from "@/lib/overview-model";
import { EXPAND_REASONS_EVENT } from "./overview-navigator";
import styles from "./overview.module.css";

const ICON: Record<ReadinessTone, IconName> = { ok: "tick", missing: "circle", info: "info-sign", attention: "warning-sign", failed: "error" };
const TONE_TEXT: Record<ReadinessTone, string> = { ok: "Recorded", missing: "Missing", info: "Note", attention: "Needs attention", failed: "Failed" };

/**
 * What is scientifically recorded and ready, and what restricts further work. Counts, structure facts and calculation
 * records are not repeated here. Restrictions are kept apart (worker, method, scientific prerequisite, project record,
 * access) and summarised in one line each; the full reasons live once, in the workflow groups.
 */
export function OverviewStatus({ rows, restrictions, ready }: {
  rows: readonly ReadinessRow[];
  restrictions: readonly Restriction[];
  ready: boolean;
}) {
  return (
    <section className={styles.panel} aria-labelledby="overview-status-title" aria-busy={!ready} data-testid="overview-readiness">
      <h2 id="overview-status-title">Scientific status</h2>
      {rows.length === 0 && restrictions.length === 0 ? <p className={styles.muted} role="status">Reading project records…</p> : null}
      {rows.length ? (
        <ul className={styles.readiness}>
          {rows.map((row) => (
            <li key={row.id} data-tone={row.tone} data-row={row.id}>
              <AppIcon icon={ICON[row.tone]} />
              <span className={styles.visuallyHidden}>{TONE_TEXT[row.tone]}: </span>
              <span className={styles.rowLabel}>{row.label}</span>
              <span className={styles.rowValue}>{row.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {restrictions.length ? (
        <p className={styles.restrictionLine} data-testid="restrictions">
          <span>Unavailable workflows are optional detail: </span>
          {restrictions.map((entry, index) => (
            <span key={entry.kind} data-kind={entry.kind}>{index ? " · " : ""}{entry.label} {entry.count}</span>
          ))}
          <button type="button" className={styles.linkButton} onClick={() => { window.dispatchEvent(new CustomEvent(EXPAND_REASONS_EVENT)); window.setTimeout(() => document.getElementById("overview-workflows")?.scrollIntoView({ block: "start" }), 50); }}>Show reasons</button>
        </p>
      ) : null}
    </section>
  );
}
