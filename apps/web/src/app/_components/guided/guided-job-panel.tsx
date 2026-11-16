"use client";

import { useState } from "react";
import type { CalculationDetail } from "@chemdft/schemas";
import type { GuidedJobView } from "@/lib/guided-job-status";
import type { JobConnection } from "@/lib/use-guided-job";
import { timestampDisplay } from "@/lib/timestamps";
import styles from "./guided-workspace.module.css";

function when(iso: string | null | undefined): string {
  const display = timestampDisplay(iso);
  return display ? `${display.local} (${display.zone})` : "—";
}

/**
 * The single presentation of a submitted job in Guided mode. It reads only the persisted calculation and
 * compute-job records, names both states, says when the records were last confirmed, and shows no progress,
 * queue position or ETA because the API reports none.
 */
export function GuidedJobPanel({ view, detail, connection, error, lastFetchedAt, onCancel, cancelError, onRetry }: {
  view: GuidedJobView;
  detail: CalculationDetail;
  connection: JobConnection;
  error: string | null;
  lastFetchedAt: number | null;
  onCancel: () => Promise<void>;
  cancelError: string | null;
  onRetry: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const spec = detail.specification;
  const submitted = "method" in spec ? spec : null;

  return (
    <div className={styles.inspectorBody} data-testid="guided-job-panel" data-job-key={view.key}>
      <div className={styles.job}>
        <div className={styles.jobTitle}>
          <h3>Job status</h3>
          <span className={styles.tag} data-intent={view.intent === "none" ? undefined : view.intent} data-testid="guided-job-state">{view.label}</span>
        </div>
        <p data-testid="guided-job-meaning">{view.meaning}</p>

        {view.discrepancy ? <div className={styles.notice} data-intent="warning" data-testid="guided-job-discrepancy"><strong>Records disagree</strong><span>{view.discrepancy}</span></div> : null}
        {view.failure && (view.key === "failed" || view.key === "lost") ? <div className={styles.notice} data-intent="danger" role="alert" data-testid="guided-job-failure"><strong>What was recorded</strong><span>{view.failure}</span></div> : null}
        {connection === "stale" ? (
          <div className={styles.notice} data-intent="warning" role="status" data-testid="guided-job-stale">
            <strong>Showing the last confirmed record</strong>
            <span>{error ?? "The job record could not be refreshed."} {lastFetchedAt ? `Last confirmed ${new Date(lastFetchedAt).toLocaleTimeString()}.` : ""} Retrying automatically.</span>
            <button type="button" className={styles.secondary} onClick={onRetry}>Retry now</button>
          </div>
        ) : null}

        <dl className={styles.facts} data-testid="guided-job-facts">
          <dt>Calculation record</dt><dd>{view.calculationState}</dd>
          <dt>Compute job</dt><dd>{view.jobState ?? "No job record yet"}{view.executionState ? ` · execution ${view.executionState}` : ""}</dd>
          <dt>Job ID</dt><dd className={styles.mono}>{view.jobId ?? "—"}</dd>
          <dt>Calculation ID</dt><dd className={styles.mono}>{view.calculationId}</dd>
          <dt>Last recorded update</dt><dd>{when(view.lastRecordedUpdate?.iso)}</dd>
          {view.waitingSince ? <><dt>Waiting for a worker since</dt><dd>{when(detail.compute_job?.created_at)}</dd></> : null}
          {view.runtimeSeconds !== null ? <><dt>{view.terminal ? "Runtime" : "Running for"}</dt><dd>{view.runtimeText}</dd></> : null}
          {view.workerStatus ? <><dt>Worker</dt><dd>{view.workerStatus}</dd></> : null}
          {submitted ? (
            <>
              <dt>Submitted</dt>
              <dd>{submitted.method.display_name}{submitted.basis ? ` / ${submitted.basis.display_name}` : ""} · {submitted.engine_preference.engine} · charge {submitted.charge}, multiplicity {submitted.multiplicity}</dd>
            </>
          ) : null}
          <dt>Input hash</dt><dd className={styles.mono}>{detail.calculation_input_hash.slice(0, 16)}…</dd>
        </dl>

        {view.active ? (
          <p className={styles.caption}>
            ChemDFT receives no progress percentage, queue position or time estimate for this job; only the recorded states above are shown.
          </p>
        ) : null}

        {view.cancel.offered ? (
          asking ? (
            <div className={styles.notice} data-intent="warning" data-testid="guided-job-cancel-confirm">
              <strong>Cancel this job?</strong>
              <span>The compute job is asked to stop. Your draft settings are not affected, and no result will be substituted.</span>
              <span className={styles.confirmRow}>
                <button type="button" className={`${styles.secondary} ${styles.danger}`} disabled={busy} data-testid="guided-job-cancel-yes"
                  onClick={() => { setBusy(true); void onCancel().finally(() => { setBusy(false); setAsking(false); }); }}>Yes, cancel job</button>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => setAsking(false)}>Keep it</button>
              </span>
            </div>
          ) : (
            <p><button type="button" className={`${styles.secondary} ${styles.danger}`} onClick={() => setAsking(true)} data-testid="guided-cancel-job" title={view.cancel.reason}>Cancel job</button></p>
          )
        ) : !view.terminal ? <p className={styles.caption} data-testid="guided-job-cancel-note">{view.cancel.reason}</p> : null}
        {cancelError ? <div className={styles.notice} data-intent="danger" role="alert"><strong>Cancellation failed</strong><span>{cancelError}</span></div> : null}
      </div>
    </div>
  );
}
