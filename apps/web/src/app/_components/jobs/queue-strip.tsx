"use client";

import type { QueueStatus } from "@chemdft/schemas";

import { formatAge, formatShortTime, formatUtcSeconds } from "@/lib/job-view";
import styles from "./jobs.module.css";

/** Persisted queue counts and worker heartbeats for the project. The API never observes a worker process directly. */
export function QueueStrip({ queue, onSelectJob }: { queue: QueueStatus; onSelectJob: (jobId: string) => void }) {
  const active = queue.active ?? [];
  return (
    <section className={styles.queue} aria-label="Queue and worker status" data-testid="queue-status">
      <dl className={styles.queueCounts}>
        <div><dt>Queued</dt><dd data-testid="queue-queued">{queue.counts.queued}</dd></div>
        <div><dt>Starting</dt><dd>{queue.counts.leased}</dd></div>
        <div><dt>Running</dt><dd data-testid="queue-running">{queue.counts.running}</dd></div>
        <div><dt>Cancelling</dt><dd>{queue.counts.cancel_requested}</dd></div>
        <div><dt>Succeeded</dt><dd>{queue.counts.succeeded}</dd></div>
        <div><dt>Failed</dt><dd>{queue.counts.failed}</dd></div>
        <div><dt>Canceled</dt><dd>{queue.counts.canceled}</dd></div>
      </dl>
      <details className={styles.queueActive}>
        <summary>Persisted queue records · no percent-complete is shown{active.length > 0 ? ` · ${active.length} active execution${active.length === 1 ? "" : "s"}` : ""}</summary>
        <p className={styles.queueNote}>
          {queue.oldest_queued_at ? <>Oldest queued job submitted {formatShortTime(queue.oldest_queued_at)} ({formatUtcSeconds(queue.oldest_queued_at)}). </> : null}
          {queue.notice} No percent-complete is shown: native engines do not report a trustworthy one.
        </p>
        {active.length > 0 ? (
          <ul data-testid="queue-active">
            {active.map((entry) => (
              <li key={entry.job_id}>
                <button type="button" className={styles.link} onClick={() => onSelectJob(entry.job_id)}>job {entry.job_id.slice(0, 8)}</button>
                {" · "}{entry.job_state.toLowerCase().replaceAll("_", " ")} · worker {entry.worker_id ?? entry.lease_owner ?? "unknown"} ·{" "}
                {entry.heartbeat_status === "FRESH" ? `heartbeat ${formatAge(entry.heartbeat_age_seconds)}` : entry.heartbeat_status === "STALE" ? <strong>heartbeat overdue ({formatAge(entry.heartbeat_age_seconds)})</strong> : "no heartbeat recorded yet"}
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </section>
  );
}
