"use client";

import type { GuidedJobView } from "@/lib/guided-job-status";
import styles from "./guided-workspace.module.css";

/**
 * Shown on Guided home when the project has a submitted job for the selected structure, so a reloaded page
 * (which always starts on Guided home) still shows the recorded state and leads straight to its status.
 */
export function GuidedJobBanner({ view, onOpen, onDismiss }: { view: GuidedJobView; onOpen: () => void; onDismiss: () => void }) {
  return (
    <div className={styles.banner} role="status" data-testid="guided-job-banner" data-job-key={view.key}>
      <span className={styles.dot} data-intent={view.intent} aria-hidden="true" />
      <span>
        <strong>Calculation {view.terminal ? view.label.toLowerCase() : `in progress · ${view.label}`}</strong>
        <span className={styles.caption}> Calculation record {view.calculationState}{view.jobState ? ` · compute job ${view.jobState}` : ""}</span>
      </span>
      <button type="button" className={styles.secondary} onClick={onOpen} data-testid="guided-job-banner-open">View status</button>
      {view.terminal ? <button type="button" className={styles.secondary} onClick={onDismiss}>Dismiss</button> : null}
    </div>
  );
}
