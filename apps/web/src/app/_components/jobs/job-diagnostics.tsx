"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComputeJobView, JobDiagnostics as JobDiagnosticsOutput, JobLogOutput } from "@chemdft/schemas";
import { StatusTag } from "@chemdft/ui";

import { getJobDiagnostics, getJobLog } from "@/lib/analysis-api";
import { saveBlob } from "@/lib/download";
import { artifactAvailability, diagnosticsPollInterval, ENGINE_LABEL, formatBytes, formatTimestamp, heartbeatBadge, plainFailure } from "@/lib/job-view";
import { downloadCalculationArtifact } from "@/lib/structure-workspace-api";
import { ScientificLogView } from "../scientific-log-view";
import { PulseLightIndicator } from "@/app/_components/pulse-light-indicator";
import styles from "./jobs.module.css";

const failureText = (code: string | null | undefined, diagnostic: string | null | undefined) =>
  plainFailure(code, diagnostic) ?? (code ? `${code.toLowerCase().replaceAll("_", " ")}${diagnostic ? ` — ${diagnostic}` : ""}` : diagnostic ?? "—");

/**
 * Persisted execution state for one job: heartbeat freshness, every execution and attempt, native artifacts and (on
 * request) the tail of an engine log. No percent-complete is ever shown — native engines do not report a trustworthy
 * one — and elapsed time is not presented as convergence.
 */
export function JobDiagnostics({ projectId, job }: { projectId: string; job: ComputeJobView }) {
  const [diagnostics, setDiagnostics] = useState<JobDiagnosticsOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ artifactId: string; output: JobLogOutput | null; error: string | null } | null>(null);
  const logRequest = useRef(0);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    getJobDiagnostics(projectId, job.id)
      .then((value) => { if (alive) { setDiagnostics(value); setError(null); } })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : "Diagnostics could not be loaded."); });
    return () => { alive = false; };
  }, [projectId, job.id, job.state, job.updated_at, tick]);

  const interval = diagnostics ? diagnosticsPollInterval(diagnostics.job_state, true) : null;
  useEffect(() => {
    if (interval === null) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") setTick((value) => value + 1); }, interval);
    return () => window.clearInterval(timer);
  }, [interval]);

  const openLog = useCallback(async (artifactId: string) => {
    const request = ++logRequest.current;
    setLog({ artifactId, output: null, error: null });
    try {
      const output = await getJobLog(projectId, job.id, artifactId);
      if (request === logRequest.current) setLog({ artifactId, output, error: null });
    } catch (cause) {
      if (request === logRequest.current) setLog({ artifactId, output: null, error: cause instanceof Error ? cause.message : "The log could not be read." });
    }
  }, [projectId, job.id]);

  async function download(artifactId: string) {
    setMessage(null);
    try {
      const file = await downloadCalculationArtifact({ projectId, calculationId: job.calculation_id, artifactId });
      saveBlob(file.blob, file.filename);
      setMessage(`Saved ${file.filename}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Download failed.");
    }
  }

  if (error && !diagnostics) return <div className={styles.notice} data-intent="danger" role="alert" data-testid="job-diagnostics-error">{error}</div>;
  if (!diagnostics) return <p className={styles.muted} role="status">Loading job diagnostics…</p>;
  const heartbeat = heartbeatBadge(diagnostics);
  const artifacts = artifactAvailability(diagnostics);
  return (
    <div className={styles.diagnostics} data-testid="job-diagnostics" data-heartbeat={diagnostics.heartbeat_status}>
      <div className={styles.diagRow}>
        <PulseLightIndicator
          jobState={diagnostics.job_state}
          provider={job.provider}
          workerStatus={job.worker_status}
          createdAt={job.created_at}
          startedAt={job.latest_execution?.started_at}
          heartbeatAt={job.latest_execution?.heartbeat_at}
          heartbeatStatus={diagnostics.heartbeat_status}
          heartbeatAgeSeconds={diagnostics.heartbeat_age_seconds}
          heartbeatStaleAfterSeconds={diagnostics.heartbeat_stale_after_seconds}
        />
        {heartbeat ? <StatusTag intent={heartbeat.intent}>{heartbeat.label}</StatusTag> : null}
        <span className={styles.muted} data-testid="job-progress-note">{diagnostics.progress_note}</span>
      </div>

      <details className={styles.section} open>
        <summary>Executions ({diagnostics.executions.length})</summary>
        {diagnostics.executions.length === 0 ? <p className={styles.muted}>No execution has started for this job.</p> : (
          <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Executions">
            <table className={styles.subtable} data-testid="job-executions">
              <thead><tr><th scope="col">State</th><th scope="col">Worker</th><th scope="col">Started</th><th scope="col">Last heartbeat</th><th scope="col">Finished</th><th scope="col">Failure</th></tr></thead>
              <tbody>
                {diagnostics.executions.map((execution) => (
                  <tr key={execution.execution_id}>
                    <td>{execution.state}</td>
                    <td className={styles.mono}>{execution.worker_id ?? "—"}</td>
                    <td>{formatTimestamp(execution.started_at)}</td>
                    <td>{formatTimestamp(execution.heartbeat_at)}</td>
                    <td>{formatTimestamp(execution.finished_at)}</td>
                    <td>{failureText(execution.failure_code, execution.diagnostic)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <details className={styles.section} open>
        <summary>Attempts ({diagnostics.attempts.length})</summary>
        {diagnostics.attempts.length === 0 ? <p className={styles.muted}>No calculation attempt has been recorded yet.</p> : (
          <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Attempts">
            <table className={styles.subtable} data-testid="job-attempts">
              <thead><tr><th scope="col">#</th><th scope="col">State</th><th scope="col">Engine</th><th scope="col">Worker</th><th scope="col">Finished</th><th scope="col">Failure</th><th scope="col">Native artifacts</th></tr></thead>
              <tbody>
                {diagnostics.attempts.map((attempt) => (
                  <tr key={attempt.attempt_id} data-testid="job-attempt">
                    <td>{attempt.attempt_number}</td>
                    <td>{attempt.state}</td>
                    <td>{[attempt.engine_name ? (ENGINE_LABEL[attempt.engine_name.toLowerCase()] ?? attempt.engine_name) : null, attempt.engine_version].filter(Boolean).join(" ") || "—"}</td>
                    <td className={styles.mono}>{attempt.worker_id}</td>
                    <td>{formatTimestamp(attempt.finished_at)}</td>
                    <td>{failureText(attempt.failure_code, attempt.diagnostic)}</td>
                    <td>
                      {(attempt.artifacts ?? []).length === 0 ? "—" : (attempt.artifacts ?? []).map((artifact) => (
                        <div key={artifact.artifact_id} className={styles.artifactLine}>
                          <span className={styles.mono}>{artifact.format_identifier}</span> <span className={styles.muted}>{formatBytes(artifact.size_bytes)}</span>{" "}
                          {artifact.log_readable ? <button type="button" className={styles.link} onClick={() => void openLog(artifact.artifact_id)} data-testid="job-log-open">View log</button> : null}{" "}
                          <button type="button" className={styles.link} onClick={() => void download(artifact.artifact_id)} data-testid="job-artifact-download">Download</button>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <p className={styles.muted} data-testid="job-artifact-availability">{artifacts.text}{diagnostics.logs_available ? "" : " Engine logs appear after an attempt finishes; live log streaming is not available."}</p>
      <div role="status" aria-live="polite" className={styles.muted}>{message ?? ""}</div>

      {log ? (
        <div data-testid="job-log">
          <h4>Engine log {log.output ? `(${log.output.truncated ? `last ${formatBytes(log.output.returned_bytes)} of ${formatBytes(log.output.size_bytes)}` : formatBytes(log.output.size_bytes)})` : ""}</h4>
          {log.error ? <p role="alert">The native log could not be read. Check project access and retry.</p> : log.output ? <ScientificLogView log={log.output} onDownload={() => void download(log.artifactId)} /> : <p role="status">Reading log…</p>}
        </div>
      ) : null}
    </div>
  );
}
