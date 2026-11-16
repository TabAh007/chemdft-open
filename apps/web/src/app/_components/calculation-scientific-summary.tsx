"use client";

import { useEffect, useState } from "react";
import type { CalculationDetail, JobLogOutput, StructureVersionDetail } from "@chemdft/schemas";
import { getJobDiagnostics, getJobLog } from "@/lib/analysis-api";
import { scientificCalculationEnergy } from "@/lib/ai-scientist-workflow";
import { calculationInputStructure } from "@/lib/calculation-result-association";
import { boundScfEvidence, resultLogArtifact } from "@/lib/scientific-result-presentation";
import { describeScientificState } from "@/lib/scientific-state";
import { getCalculation, downloadCalculationArtifact } from "@/lib/structure-workspace-api";
import { saveBlob } from "@/lib/download";
import { ScientificLogView } from "./scientific-log-view";
import { ScientificTimestamp } from "./scientific-timestamp";
import { approvalCoordinate } from "@/lib/approval-geometry";
import styles from "./calculation-scientific-summary.module.css";

const number = (value: number | null | undefined, unit = "") => typeof value === "number" && Number.isFinite(value) ? `${value}${unit ? ` ${unit}` : ""}` : "Unavailable";

export function ScientificSummaryContent({ detail, input, log }: {
  detail: CalculationDetail; input?: StructureVersionDetail | null | undefined; log: JobLogOutput | null;
}) {
  const spec = detail.specification;
  const result = detail.result;
  const energy = scientificCalculationEnergy(detail, detail.calculation.project_id, detail.calculation.id);
  const native = boundScfEvidence(detail, log);
  // `input` is supplied by the hash-verifying immutable-input resolver. Refuse
  // inconsistent version/project/coordinate metadata rather than render it.
  const candidate = input?.version.coordinates;
  const coordinates = input && input.structure.project_id === detail.calculation.project_id &&
    input.version.project_id === detail.calculation.project_id && input.structure.id === input.version.structure_id &&
    candidate?.structure_version_id === input.version.id && candidate.source.project_id === detail.calculation.project_id &&
    (!("entity_type" in candidate.source) || candidate.source.entity_type !== "structure.version" || candidate.source.entity_id === input.version.id) &&
    candidate.atoms.every(atom => [atom.x, atom.y, atom.z].every(Number.isFinite)) ? candidate : null;
  const units = coordinates?.coordinate_system === "FRACTIONAL" ? "Fractional (dimensionless)" : coordinates?.unit === "bohr" ? "Bohr" : coordinates?.unit === "angstrom" ? "Angstrom" : "Unavailable";
  const threshold = native?.convergenceThreshold;
  const rows = [
    ["Calculation type", spec.task_type], ["Method", spec.method.display_name ?? spec.method.identifier],
    ["Basis set", spec.basis?.display_name ?? spec.basis?.identifier ?? "Unavailable"],
    ["Engine / version", result ? `${result.producer_software.name} ${result.producer_software.version}` : "Unavailable"],
    ["Charge", "charge" in spec ? number(spec.charge) : "Unavailable"],
    ["Multiplicity", "multiplicity" in spec ? number(spec.multiplicity) : "Unavailable"],
    ["Total energy", energy ? number(energy.total_energy.value, energy.total_energy.unit.code) : "Unavailable"],
    ["SCF convergence", energy ? energy.converged ? "Converged" : "Not converged" : "Unavailable"],
    ["SCF iterations", number(energy?.scf_iterations)],
  ];
  return <section className={styles.summary} aria-label="Scientific calculation summary" data-testid="scientific-calculation-summary">
    <h3>Scientific calculation summary</h3>
    <p>Parameters and result values below come from the stored calculation and its validated result.</p>
    <dl className={styles.facts}>{rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    {result?.producer_software.name === "pyscf" && spec.task_type === "ENERGY" ? <p>PySCF SCF total energy includes nuclear repulsion; it is not the electronic-only component.</p> : null}
    <h4>Native evidence details</h4>
    <p>Display-only quantities parsed deterministically from the bound native log; they do not add fields to the authoritative result. Missing or mismatched evidence is shown as unavailable.</p>
    <dl className={styles.facts}>{[
      ["SCF energy convergence threshold", threshold !== null && threshold !== undefined && threshold > 0 ? number(threshold, "Eh") : "Unavailable"],
      ["Nuclear repulsion energy", number(native?.nuclearRepulsion, "Eh")],
      ["Electron count", number(native?.electrons)], ["Basis-function count (contracted)", number(native?.basisFunctions)],
      ["HOMO energy (native log)", number(native?.homo, "Eh")], ["LUMO energy (native log)", number(native?.lumo, "Eh")],
    ].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    <h4>Immutable input coordinates</h4>
    {coordinates ? <>
      <p>Structure version <code>{input!.version.id}</code> · Units: {units} · {coordinates.coordinate_system}</p>
      <p className="coordinate-scroll-hint">Scroll horizontally to see all coordinates. Focus the table and use the arrow keys, or swipe.</p>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label={`Input atomic coordinates (${units})`}><table>
        <thead><tr><th scope="col">Atom</th><th scope="col">Element</th><th scope="col">X</th><th scope="col">Y</th><th scope="col">Z</th></tr></thead>
        <tbody>{coordinates.atoms.map(atom => <tr key={atom.index}><th scope="row">{atom.index + 1}</th><td>{atom.element}</td><td>{approvalCoordinate(atom.x)}</td><td>{approvalCoordinate(atom.y)}</td><td>{approvalCoordinate(atom.z)}</td></tr>)}</tbody>
      </table></div>
    </> : <p>Unavailable. The exact hash-bound input could not be loaded.</p>}
    <h4>Provenance and verification</h4>
    <dl className={styles.facts}>
      <div><dt>Scientific standing</dt><dd>{result ? describeScientificState(result).headline : "Unavailable"}</dd></div>
      <div><dt>Recorded validation / verification</dt><dd>{result ? `${result.validation_state} / ${result.verification_state}` : "Unavailable"}</dd></div>
      <div><dt>Provenance record</dt><dd>{result?.provenance_record_id ?? "Unavailable"}</dd></div>
      <div><dt>Producer</dt><dd>{result?.trusted_producer_id ?? "Unavailable"}</dd></div>
      <div><dt>Producer attestation</dt><dd>{result?.producer_attestation_id ?? "Unavailable"}</dd></div>
      <div><dt>Input SHA-256</dt><dd>{detail.calculation_input_hash}</dd></div>
      <div><dt>Created</dt><dd><ScientificTimestamp value={detail.calculation.created_at} /></dd></div>
      <div><dt>Completed</dt><dd><ScientificTimestamp value={detail.compute_execution?.finished_at} /></dd></div>
    </dl>
  </section>;
}

export function CalculationScientificSummary({ projectId, detail, input }: {
  projectId: string; detail: CalculationDetail; input?: StructureVersionDetail | null | undefined;
}) {
  const key = `${projectId}:${detail.calculation.id}:${detail.result?.id}:${detail.attempt?.id}:${detail.calculation_input_hash}`;
  const [load, setLoad] = useState<{ key: string; log: JobLogOutput | null; error: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const jobId = detail.compute_job?.id;
  useEffect(() => {
    let alive = true;
    async function read() {
      if (!jobId || detail.calculation.project_id !== projectId || detail.result?.producer_software.name !== "pyscf") return null;
      const diagnostics = await getJobDiagnostics(projectId, jobId);
      const artifact = resultLogArtifact(detail, diagnostics);
      if (!artifact) return null;
      const log = await getJobLog(projectId, jobId, artifact.artifact_id);
      if (log.sha256 !== artifact.sha256 || log.artifact_id !== artifact.artifact_id || log.attempt_id !== detail.attempt?.id) throw new Error("Native log binding mismatch");
      return log;
    }
    void read().then(log => { if (alive) setLoad({ key, log, error: null }); }).catch(() => {
      if (alive) setLoad({ key, log: null, error: "Native evidence could not be verified. Reload the result to retry; stored artifacts remain available through authorized downloads." });
    });
    return () => { alive = false; };
    // Immutable result/attempt key controls this read; status polls need no new artifact request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, jobId]);
  const current = load?.key === key ? load : null;
  async function download() {
    if (!current?.log) return;
    try {
      const file = await downloadCalculationArtifact({ projectId, calculationId: detail.calculation.id, artifactId: current.log.artifact_id });
      saveBlob(file.blob, file.filename);
      setNotice("Original native log downloaded.");
    } catch { setNotice("The original log could not be downloaded. Check project access and retry."); }
  }
  return <div>
    <ScientificSummaryContent detail={detail} input={input} log={current?.log ?? null} />
    {!current ? <p role="status">Reading native evidence…</p> : current.error ? <p role="alert">{current.error}</p> : current.log ? <ScientificLogView log={current.log} onDownload={() => void download()} /> : <p>Native log unavailable for this result.</p>}
    <p role="status">{notice}</p>
  </div>;
}

/** Results-list detail uses the same exact-input resolver as the scientific workspace. */
export function ResultPageScientificSummary({ projectId, calculationId, resultId }: { projectId: string; calculationId: string; resultId: string }) {
  const key = `${projectId}:${calculationId}:${resultId}`;
  const [load, setLoad] = useState<{ key: string; detail: CalculationDetail; input: StructureVersionDetail | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    async function read() {
      const detail = await getCalculation({ projectId, calculationId });
      if (detail.result?.id !== resultId || detail.calculation.project_id !== projectId) throw new Error("Selected result mismatch");
      const input = await calculationInputStructure(projectId, detail).catch(() => null);
      return { key, detail, input };
    }
    void read().then(value => { if (alive) { setLoad(value); setError(null); } }).catch(() => { if (alive) setError("Scientific summary unavailable. Reload the selected result to retry."); });
    return () => { alive = false; };
  }, [key, projectId, calculationId, resultId]);
  if (error) return <p role="alert">{error}</p>;
  if (load?.key !== key) return <p role="status">Loading scientific summary…</p>;
  return <CalculationScientificSummary projectId={projectId} detail={load.detail} input={load.input} />;
}
