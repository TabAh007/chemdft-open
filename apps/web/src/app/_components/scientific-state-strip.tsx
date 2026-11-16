"use client";

import { useState } from "react";
import { StatusTag } from "@chemdft/ui";

import { describeScientificState, type ScientificStateInput } from "@/lib/scientific-state";
import { ProvenanceInspector } from "./provenance-inspector";
import { ResultActionRow } from "./results/result-action-row";
import styles from "./scientific-state.module.css";

/**
 * Separate AUTHORITY / VALIDATION / INDEPENDENT VERIFICATION display for one published result,
 * driven by the server's read-time effective state. An inactive lineage is shown as historical.
 */
export function ScientificStateStrip({
  projectId,
  resultId,
  result,
  withProvenance = true,
  calculationId,
  actionRow = true,
  actionLabel,
}: {
  projectId: string;
  resultId: string;
  result: ScientificStateInput;
  withProvenance?: boolean;
  /** Retained for contract compatibility. */
  calculationId?: string | null;
  /** Release 0.0.25: the Export / Share / Cite / Ask AI row under the status block. Off only where the host page has its own copy. */
  actionRow?: boolean;
  /** What the result is, for the AI context label (for example "IR spectrum"). */
  actionLabel?: string;
}) {
  const view = describeScientificState(result);
  const [open, setOpen] = useState(false);
  const tone = view.currentlyAuthoritative ? styles.current : view.effectiveKnown ? styles.historical : styles.uncertain;
  return (
    <section
      className={`${styles.strip} ${tone}`}
      aria-label="Scientific state"
      data-testid="scientific-state"
      data-currently-authoritative={view.currentlyAuthoritative ? "true" : "false"}
      data-lineage={view.lineage.value}
    >
      <div className={styles.head}>
        <span className={styles.headline} role={view.currentlyAuthoritative ? undefined : "status"}>{view.headline}</span>
        {withProvenance ? (
          <span className={styles.actions}>
            <button
              type="button"
              className={styles.linkButton}
              aria-expanded={open}
              data-testid="provenance-toggle"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "Hide provenance & lineage" : "Provenance & lineage"}
            </button>
          </span>
        ) : null}
      </div>
      <ul className={styles.axes} aria-label="Scientific state axes">
        <li className={styles.axis} data-axis="authority"><span className={styles.axisName}>Authority</span><StatusTag intent={view.authority.intent}>{view.authority.label}</StatusTag></li>
        <li className={styles.axis} data-axis="validation"><span className={styles.axisName}>Validation</span><StatusTag intent={view.validation.intent}>{view.validation.label}</StatusTag></li>
        <li className={styles.axis} data-axis="verification"><span className={styles.axisName}>Independent verification</span><StatusTag intent={view.verification.intent}>{view.verification.label}</StatusTag></li>
        <li className={styles.axis} data-axis="lineage"><span className={styles.axisName}>Lineage</span><StatusTag intent={view.lineage.intent}>{view.lineage.label}</StatusTag></li>
      </ul>
      {view.notes.length > 0 ? <ul className={styles.notes}>{view.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      {view.stored ? (
        <p className={styles.stored} data-testid="stored-state">
          Recorded at publication: {view.stored.authority} / {view.stored.validation} / {view.stored.verification}
        </p>
      ) : null}
      {actionRow && (calculationId ?? (result as { calculation_id?: string }).calculation_id) ? (
        <ResultActionRow projectId={projectId} resultId={resultId} calculationId={(calculationId ?? (result as { calculation_id?: string }).calculation_id)!} label={actionLabel} />
      ) : null}
      {open ? <ProvenanceInspector key={resultId} projectId={projectId} resultId={resultId} /> : null}
    </section>
  );
}
