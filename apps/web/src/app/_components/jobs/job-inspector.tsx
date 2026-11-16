"use client";

import Link from "next/link";
import type { Locale } from "@chemdft/i18n";
import type { ComputeJobView } from "@chemdft/schemas";
import { StatusTag } from "@chemdft/ui";

import {
  calculationWorkspacePath, describeEstimate, describeReservation, describeSpecification, describeWorkload, formatRuntime, formatShortTime,
  formatTimestamp, formatUtcSeconds, jobFailure, jobPhase, jobRuntimeSeconds, providerCostText, providerLabel, structureWorkspacePath,
} from "@/lib/job-view";
import { CiteCalculation } from "../cite-calculation";
import { JobDiagnostics } from "./job-diagnostics";
import styles from "./jobs.module.css";

function execution_finished(job: ComputeJobView): string {
  return job.latest_execution?.finished_at ?? job.updated_at;
}

/** Local time first, the stored UTC instant underneath; the full text stays in the tooltip. */
function Moment({ value, note }: { value: string | null | undefined; note?: string | null }) {
  if (!value) return <>—</>;
  return (
    <time dateTime={value} title={formatTimestamp(value)}>
      {formatShortTime(value)}
      <span className={styles.utc}>{formatUtcSeconds(value)}{note ? ` · ${note}` : ""}</span>
    </time>
  );
}

function Fact({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return <div className={styles.fact}><dt>{label}</dt><dd data-testid={testId}>{children}</dd></div>;
}

/**
 * The persistent right pane: everything the server reports about one job. Estimates and reservations are labelled as
 * such in the visible text; nothing here is derived, summed or extrapolated, and there is no progress figure.
 */
export function JobInspector({ projectId, locale, job, now, canWrite, cancelling, onCancel, onReuse }: {
  projectId: string; locale: Locale; job: ComputeJobView; now: number; canWrite: boolean | null; cancelling: boolean;
  onCancel: () => void; onReuse: () => void;
}) {
  const workload = describeWorkload(job.workload.workload_type);
  const phase = jobPhase(job);
  const failure = jobFailure(job);
  const terminal = !phase.active;
  const completedAt = terminal ? execution_finished(job) : null;
  const structure = job.structure_summary;
  const estimate = describeEstimate(job.estimate);
  const reservation = describeReservation(job.reservation);
  const execution = job.latest_execution;
  return (
    <div className={styles.inspector} data-testid="job-inspector" data-job-id={job.id}>
      <header className={styles.inspectorHead}>
        <div className={styles.titleRow}>
          <h2>{workload.task}{workload.task.includes(workload.engine) ? null : <span className={styles.muted}> · {workload.engine}</span>}</h2>
          <span className={styles.state}>
            {phase.key === "running" || phase.key === "leased" ? <i className={styles.pulse} aria-hidden="true" /> : null}
            <StatusTag intent={phase.intent}>{phase.label}</StatusTag>
          </span>
        </div>
        <p className={styles.muted}>
          {structure?.structure_name ? <strong className={styles.ink}>{structure.structure_name}</strong> : "Structure not recorded"}
          {structure?.formula_hill ? <> · <span className={styles.formula}>{structure.formula_hill}</span></> : null}
          {structure?.structure_revision !== null && structure?.structure_revision !== undefined ? <> · version {structure.structure_revision}</> : null}
        </p>
        <p className={styles.muted}>{describeSpecification(job.specification_summary)}</p>
        {failure ? <p className={styles.failure} role="note" data-testid="job-failure">{failure}</p> : null}
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href={calculationWorkspacePath(locale, projectId, job.calculation_id)} data-testid="job-open">
            {phase.key === "succeeded" ? "Open result" : "Open calculation"}
          </Link>
          {structure?.structure_id && structure.structure_version_id ? (
            <Link className={styles.secondaryAction} href={structureWorkspacePath(locale, projectId, structure.structure_id, structure.structure_version_id)} data-testid="job-open-structure">Open structure</Link>
          ) : null}
          {canWrite === true ? <button type="button" className={styles.secondaryAction} onClick={onReuse} data-testid="job-reuse">Reuse settings</button> : null}
          {canWrite === true && phase.active && phase.key !== "cancelling" ? (
            <button type="button" className={styles.dangerAction} disabled={cancelling} onClick={onCancel} data-testid="job-cancel">{cancelling ? "Cancelling…" : "Cancel job"}</button>
          ) : null}
        </div>
      </header>

      <div className={styles.inspectorBody}>
        <section className={styles.block} aria-labelledby="job-where">
          <h3 id="job-where">Where it runs</h3>
          <dl className={styles.facts}>
            <Fact label="Provider" testId="job-provider">{providerLabel(job.provider)}</Fact>
            <Fact label="Hardware">{execution?.hardware_class ?? "not reported"}</Fact>
            <Fact label="Worker">{execution?.worker_id ? <span className={styles.mono}>{execution.worker_id}</span> : <span className={styles.muted}>no worker has taken this job yet</span>}</Fact>
          </dl>
          {job.worker_status ? <p className={styles.notice} data-intent="warning" role="note" data-testid="job-worker-status">{job.worker_status}</p> : null}
        </section>

        <section className={styles.block} aria-labelledby="job-cost">
          <h3 id="job-cost">Estimate and reservation</h3>
          {estimate ? (
            <dl className={styles.facts} data-testid="job-estimate">
              <Fact label="Estimated runtime">{estimate.runtime}</Fact>
              <Fact label="Estimated cost">{estimate.cost}</Fact>
              <Fact label="Estimate confidence">{estimate.confidence}</Fact>
              <Fact label="Estimate basis">{estimate.providerSummary}</Fact>
              <Fact label="Estimate valid until"><Moment value={estimate.validUntil} /></Fact>
            </dl>
          ) : <p className={styles.muted} data-testid="job-estimate-none">No estimate recorded for this job.</p>}
          {estimate && estimate.assumptions.length > 0 ? (
            <details className={styles.assumptions}><summary>Estimate assumptions ({estimate.assumptions.length})</summary><ul>{estimate.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></details>
          ) : null}
          {reservation ? (
            <dl className={styles.facts} data-testid="job-reservation">
              <Fact label="Reservation">{reservation.state}</Fact>
              <Fact label="Authorized maximum">{reservation.authorizedMax}</Fact>
              <Fact label="Actual cost">{reservation.actualCost}</Fact>
              <Fact label="Cost reported by provider">{providerCostText(job)}</Fact>
            </dl>
          ) : <p className={styles.muted}>No reservation recorded for this job.</p>}
          <p className={styles.caption}>Figures labelled “estimate” are forecasts from the compute gateway, not charges. Payments are not enabled.</p>
        </section>

        <section className={styles.block} aria-labelledby="job-time">
          <h3 id="job-time">Timeline</h3>
          <dl className={styles.facts}>
            <Fact label="Submitted"><Moment value={job.created_at} /></Fact>
            <Fact label="Started"><Moment value={execution?.started_at} /></Fact>
            <Fact label="Completed"><Moment value={completedAt} note={execution?.finished_at ? null : "last update; no finish was recorded"} /></Fact>
            <Fact label="Runtime">{formatRuntime(jobRuntimeSeconds(job, now))}</Fact>
            <Fact label="Attempts">{job.attempt_count}</Fact>
          </dl>
        </section>

        <section className={styles.block} aria-labelledby="job-diag">
          <h3 id="job-diag">Execution record</h3>
          <JobDiagnostics projectId={projectId} job={job} />
        </section>
        {job.state === "SUCCEEDED" ? (
          <section className={styles.block} aria-label="Cite this job">
            <CiteCalculation projectId={projectId} calculationId={job.calculation_id} />
          </section>
        ) : null}
        <p className={styles.caption}><span className={styles.mono}>{job.workload.workload_type}</span> · job <span className={styles.mono}>{job.id}</span></p>
      </div>
    </div>
  );
}
