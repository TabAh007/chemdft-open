"use client";

import { useEffect, useState } from "react";

import { getResultProvenance, resultLineageExportUrl } from "@/lib/structure-workspace-api";
import { summarizeProvenance, type ProvenanceSummary } from "@/lib/provenance-view";
import styles from "./scientific-state.module.css";
import { ScientificTimestamp } from "./scientific-timestamp";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; summary: ProvenanceSummary };

export function ProvenanceProducerFacts({ producer }: { producer: ProvenanceSummary["producer"] }) {
  return <dl className={styles.kv}>
    {producer.map(row => <div key={row.label} style={{ display: "contents" }}><dt>{row.label}</dt><dd>
      {row.label === "Result created" ? <ScientificTimestamp value={row.value} /> : row.value}
    </dd></div>)}
  </dl>;
}

/** Loads the read-only lineage export for one result. Nothing is inferred beyond the document. */
export function ProvenanceInspector({ projectId, resultId, hideArtifacts = false }: { projectId: string; resultId: string; /** The Results inspector lists artifacts and hashes in its own Artifacts section. */ hideArtifacts?: boolean }) {
  // The parent mounts this with key={resultId}, so a new result always starts from "loading".
  const [load, setLoad] = useState<Load>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    getResultProvenance(projectId, resultId)
      .then((document) => {
        if (!alive) return;
        const summary = summarizeProvenance(document);
        setLoad(summary ? { status: "ready", summary } : { status: "error", message: "The lineage export has an unrecognised format; nothing is shown." });
      })
      .catch((cause: unknown) => {
        if (alive) setLoad({ status: "error", message: cause instanceof Error ? cause.message : "Provenance could not be loaded." });
      });
    return () => { alive = false; };
  }, [projectId, resultId]);

  if (load.status === "loading") return <div className={styles.inspector} role="status">Loading provenance…</div>;
  if (load.status === "error") return <div className={styles.inspector} role="alert" data-testid="provenance-error">{load.message}</div>;
  const { summary } = load;
  return (
    <div className={styles.inspector} data-testid="provenance-inspector">
      <h4>Producer and environment</h4>
      <ProvenanceProducerFacts producer={summary.producer} />

      <h4>Recorded operations ({summary.steps.length})</h4>
      {summary.steps.length === 0 ? <p className={styles.muted}>No provenance records were returned.</p> : (
        <div className={styles.tableScroll} role="region" tabIndex={0} aria-label="Recorded provenance operations"><table className={styles.table}>
          <thead><tr><th scope="col">Operation</th><th scope="col">Producer</th><th scope="col">Recorded</th><th scope="col">Record</th></tr></thead>
          <tbody>
            {summary.steps.map((step) => (
              <tr key={step.id}>
                <td>{step.operation}{step.version ? ` ${step.version}` : ""}{step.approximate ? <span className={styles.warn}> · approximate</span> : null}</td>
                <td>{step.producer || "—"}</td>
                <td className={styles.mono}><ScientificTimestamp value={step.createdAt} /></td>
                <td className={styles.mono}>{step.id}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {hideArtifacts ? null : <>
      <h4>Raw evidence artifacts ({summary.artifacts.length})</h4>
      {summary.artifacts.length === 0 ? <p className={styles.muted}>No raw artifacts are attached to this result.</p> : (
        <div className={styles.tableScroll} role="region" tabIndex={0} aria-label="Raw evidence artifact hashes"><table className={styles.table}>
          <thead><tr><th scope="col">Artifact</th><th scope="col">SHA-256</th></tr></thead>
          <tbody>
            {summary.artifacts.map((artifact) => (
              <tr key={artifact.artifactId}><td className={styles.mono}>{artifact.artifactId}</td><td className={styles.mono}>{artifact.sha256}</td></tr>
            ))}
          </tbody>
        </table></div>
      )}

      </>}

      <h4>Source lineage ({summary.lineage.length} result{summary.lineage.length === 1 ? "" : "s"})</h4>
      <div className={styles.tableScroll} role="region" tabIndex={0} aria-label="Scientific source lineage"><table className={styles.table}>
        <thead><tr><th scope="col">Result</th><th scope="col">Type</th><th scope="col">Stored authority</th><th scope="col">Current lineage</th></tr></thead>
        <tbody>
          {summary.lineage.map((row) => (
            <tr key={row.resultId}>
              <td className={styles.mono}>{row.resultId}</td><td>{row.resultType}</td><td>{row.authority}</td><td>{row.lineageValidity ?? "unknown"}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {summary.truncated ? <p className={styles.warn} role="note">This export was truncated by the server; the lineage shown is incomplete.</p> : null}
      <p>
        <a href={resultLineageExportUrl(projectId, resultId)} download data-testid="lineage-export-link">Download full lineage export (JSON, {summary.schema})</a>
      </p>
    </div>
  );
}
