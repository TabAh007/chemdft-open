"use client";

import { useState } from "react";
import type { CalculationDetail, CalculationResult, StructureVersionDetail } from "@chemdft/schemas";
import { approvalCoordinate } from "@/lib/approval-geometry";
import { saveBlob } from "@/lib/download";
import { coordinateUnitText, verifiedInputCoordinates } from "@/lib/result-inspector-model";
import { describeScientificState } from "@/lib/scientific-state";
import { downloadCalculationArtifact } from "@/lib/structure-workspace-api";
import { useNativeEvidence } from "@/lib/use-native-evidence";
import { ProvenanceInspector } from "../provenance-inspector";
import { NativeLogViewer } from "./native-log-viewer";
import { ScientificTimestamp } from "../scientific-timestamp";
import { CopyValue } from "./results-parts";
import styles from "./results-ui.module.css";

const number = (value: number | null | undefined, unit = "") => typeof value === "number" && Number.isFinite(value) ? `${value}${unit ? ` ${unit}` : ""}` : "Unavailable";

/** Identifiers, hashes, producer and attestation. Long IDs are copyable, not spread across the page. */
export function ProvenanceSection({ projectId, detail, result }: { projectId: string; detail: CalculationDetail; result: CalculationResult }) {
  const [full, setFull] = useState(false);
  const state = describeScientificState(result);
  return (
    <>
      <dl className={styles.kv} data-testid="provenance-facts">
        <dt>Result ID</dt><dd><CopyValue value={result.id} label="result ID" /></dd>
        <dt>Calculation ID</dt><dd><CopyValue value={detail.calculation.id} label="calculation ID" /></dd>
        <dt>Provenance record</dt><dd><CopyValue value={result.provenance_record_id} label="provenance record ID" /></dd>
        <dt>Producer</dt><dd>{result.trusted_producer_id} <span className={styles.muted}>({result.trusted_producer_type})</span></dd>
        <dt>Producer attestation</dt><dd><CopyValue value={result.producer_attestation_id} label="producer attestation ID" /></dd>
        <dt>Input SHA-256</dt><dd><CopyValue value={detail.calculation_input_hash} label="input SHA-256" /></dd>
        <dt>Scientific standing</dt><dd>{state.headline}</dd>
        <dt>Recorded validation / verification</dt><dd>{result.validation_state} / {result.verification_state}</dd>
        <dt>Calculation created</dt><dd><ScientificTimestamp value={detail.calculation.created_at} /></dd>
        <dt>Execution completed</dt><dd><ScientificTimestamp value={detail.compute_execution?.finished_at} /></dd>
        <dt>Result published</dt><dd><ScientificTimestamp value={result.created_at} /></dd>
      </dl>
      <div>
        <button type="button" className={styles.secondaryAction} aria-expanded={full} onClick={() => setFull((v) => !v)} data-testid="provenance-toggle">
          {full ? "Hide recorded operations and lineage" : "Show recorded operations and source lineage"}
        </button>
      </div>
      {full ? <ProvenanceInspector projectId={projectId} resultId={result.id} hideArtifacts /> : null}
    </>
  );
}

/**
 * Display-only quantities parsed deterministically from the native log bound to this exact result. They never add
 * fields to the authoritative result; a missing or mismatched log is shown as unavailable, never guessed.
 */
export function EvidenceSection({ projectId, detail }: { projectId: string; detail: CalculationDetail }) {
  const evidence = useNativeEvidence(projectId, detail, true);
  const [notice, setNotice] = useState<string | null>(null);
  if (evidence.status === "loading") return <p role="status">Reading native evidence…</p>;
  if (evidence.status === "none") return <p className={styles.muted} data-testid="evidence-none">No native log applies to this result (the producing engine publishes none, or none is bound to it). The stored result and its provenance are unchanged.</p>;
  if (evidence.status === "unverified") return <div className={styles.notice} data-intent="warning" role="alert" data-testid="evidence-unverified"><strong>Native evidence unverified</strong><span>{evidence.message}</span></div>;
  const native = evidence.evidence;
  const threshold = native?.convergenceThreshold;
  const rows: Array<[string, string]> = [
    ["SCF energy convergence threshold", threshold !== null && threshold !== undefined && threshold > 0 ? number(threshold, "Eh") : "Unavailable"],
    ["Nuclear repulsion energy", number(native?.nuclearRepulsion, "Eh")],
    ["Electron count", number(native?.electrons)],
    ["Basis-function count (contracted)", number(native?.basisFunctions)],
    ["HOMO energy (native log)", number(native?.homo, "Eh")],
    ["LUMO energy (native log)", number(native?.lumo, "Eh")],
  ];
  async function download() {
    try {
      const file = await downloadCalculationArtifact({ projectId, calculationId: detail.calculation.id, artifactId: evidence.status === "ready" ? evidence.log.artifact_id : "" });
      saveBlob(file.blob, file.filename);
      setNotice("Original native log downloaded.");
    } catch { setNotice("The original log could not be downloaded. Check project access and retry."); }
  }
  return (
    <>
      <div className={styles.notice} data-intent="info" data-testid="evidence-classification">
        <strong>Evidence-derived, display only</strong>
        <span>These values are parsed deterministically from the bound native log; they are not fields of the authoritative result. Frontier orbital energies here are log values, not an orbital calculation.</span>
      </div>
      <dl className={styles.kv} data-testid="native-quantities">{rows.map(([name, value]) => <div key={name} style={{ display: "contents" }}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      {native === null ? <p className={styles.caption} role="note">The log could not be bound to a single converged SCF for this result, so no extra quantities are shown.</p> : null}
      <NativeLogViewer log={evidence.log} onDownload={() => void download()} downloadNotice={notice} />
    </>
  );
}

/** The exact hash-verified input coordinates, only when the version/project metadata is mutually consistent. */
export function CoordinatesSection({ detail, input, inputError }: { detail: CalculationDetail; input: StructureVersionDetail | null; inputError: string | null }) {
  const coordinates = verifiedInputCoordinates(detail, input);
  if (!coordinates || !input) {
    return <div className={styles.notice} data-intent="warning" role="note" data-testid="coordinates-unavailable"><strong>Input coordinates unavailable</strong><span>{inputError ?? "The exact hash-bound input could not be verified, so nothing is drawn or listed."}</span></div>;
  }
  const units = coordinateUnitText(coordinates);
  return (
    <>
      <p className={styles.caption}>Structure version <CopyValue value={input.version.id} label="structure version ID" /> · Units: {units} · {coordinates.coordinate_system}. Verified against the input SHA-256 recorded with this calculation.</p>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label={`Input atomic coordinates (${units})`} data-testid="coordinates-table">
        <table>
          <thead><tr><th scope="col">Atom</th><th scope="col">Element</th><th scope="col">X</th><th scope="col">Y</th><th scope="col">Z</th></tr></thead>
          <tbody>{coordinates.atoms.map((atom) => <tr key={atom.index}><th scope="row">{atom.index + 1}</th><td>{atom.element}</td><td>{approvalCoordinate(atom.x)}</td><td>{approvalCoordinate(atom.y)}</td><td>{approvalCoordinate(atom.z)}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

/** Stored artifacts with their SHA-256. Downloads are authorized by the server; the artifacts themselves are never altered. */
export function ArtifactsSection({ projectId, detail, result }: { projectId: string; detail: CalculationDetail; result: CalculationResult }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const refs = [...result.raw_artifacts, ...(detail.attempt?.raw_artifacts ?? []).filter((ref) => !result.raw_artifacts.some((other) => other.artifact_id === ref.artifact_id))];
  async function download(artifactId: string) {
    setBusy(artifactId); setNotice(null);
    try {
      const file = await downloadCalculationArtifact({ projectId, calculationId: detail.calculation.id, artifactId });
      saveBlob(file.blob, file.filename);
      setNotice({ tone: "ok", text: `Saved ${file.filename}.` });
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof Error ? cause.message : "The artifact could not be downloaded." });
    } finally { setBusy(null); }
  }
  if (refs.length === 0) return <p className={styles.muted} data-testid="artifacts-none">No stored artifacts are attached to this result.</p>;
  return (
    <>
      <div className={styles.scroll} role="region" tabIndex={0} aria-label="Stored artifacts and their SHA-256 hashes">
        <table data-testid="artifacts-table">
          <thead><tr><th scope="col">Artifact</th><th scope="col">Role</th><th scope="col">SHA-256</th><th scope="col"><span className={styles.visuallyHidden}>Download</span></th></tr></thead>
          <tbody>
            {refs.map((ref) => (
              <tr key={ref.artifact_id} data-artifact-id={ref.artifact_id}>
                <td><CopyValue value={ref.artifact_id} label="artifact ID" short /></td>
                <td style={{ fontFamily: "var(--cdf-font-ui)" }}>{ref.sha256 === detail.calculation_input_hash ? "Immutable calculation input" : result.raw_artifacts.some((r) => r.artifact_id === ref.artifact_id) ? "Raw evidence" : "Attempt artifact"}</td>
                <td><CopyValue value={ref.sha256} label="artifact SHA-256" short /></td>
                <td><button type="button" className={styles.secondaryAction} disabled={busy !== null} onClick={() => void download(ref.artifact_id)} data-testid="artifact-download">{busy === ref.artifact_id ? "Preparing…" : "Download"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.caption}>The original artifacts may include source code, local paths and machine identifiers. Download requires authorized project access.</p>
      <p role="status" aria-live="polite" className={notice?.tone === "error" ? undefined : styles.caption} data-testid="artifact-status">{notice?.text ?? ""}</p>
    </>
  );
}

export function ExportSection({ projectId, calculationId }: { projectId?: string; calculationId?: string }) {
  void projectId;
  void calculationId;
  return (
    <div data-testid="export-panel" style={{ padding: "8px 0" }}>
      <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--cdf-ink-muted, #5c7080)", lineHeight: 1.5 }}>
        Export files, scientific reports, and reproducibility archives for this calculation are in the <strong>Export ▾</strong> menu of the action row at the top of this result (next to Share…, Cite and Ask AI about this result).
      </p>
    </div>
  );
}
