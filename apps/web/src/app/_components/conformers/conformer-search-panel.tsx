"use client";

import { saveBlob } from "@/lib/download";
import { useEffect, useRef, useState } from "react";
import type { CalculationDetail, EngineCapabilityView, StructureVersionDetail } from "@chemdft/schemas";
import { ActionButton } from "@chemdft/ui";
import { useGeometryEligibility } from "@/lib/use-geometry-eligibility";
import { buildConformerSubmission, conformerRunState, conformerUnavailableReason, CREST_VERSION } from "@/lib/conformer-ensemble";
import { cancelCalculation, downloadCalculationArtifact, getCalculation, listCalculationCapabilities, listStructures, listStructureVersions, submitCalculation } from "@/lib/structure-workspace-api";

export function ConformerRunStatus({ projectId, detail, onOpenResult, onRetry }: {
  projectId: string; detail: CalculationDetail; onOpenResult: (detail: CalculationDetail) => void; onRetry?: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [cancellationRequested, setCancellationRequested] = useState(false);
  const state = conformerRunState(detail);
  const pending = state === "Queued" || state === "Running";
  const diagnostic = detail.attempt?.diagnostic || detail.compute_execution?.diagnostic;
  return <section className="conformer-run-status" aria-label="Conformer search status" data-calculation-id={detail.calculation.id}>
    <div role="status"><strong>Search: {state}</strong>{pending ? <progress aria-label="Conformer search in progress" /> : null}</div>
    <p className="conformer-identity">Calculation {detail.calculation.id}</p>
    {pending ? <><p>{state === "Queued" ? "Waiting for native worker execution. CREST sampling has not started." : "Native CREST sampling is in progress. A defensible percentage or total step count is unavailable."}</p>
      <button type="button" onClick={async () => {
        try { await cancelCalculation({ projectId, calculationId: detail.calculation.id }); setCancellationRequested(true); setNotice(null); }
        catch (cause) { setNotice(cause instanceof Error ? cause.message : "Cancellation could not be requested."); }
      }}>Cancel conformer search</button></> : state === "Completed" ? <button type="button" onClick={() => onOpenResult(detail)}>Open completed ensemble</button> : <>
      <p>{state === "Canceled" ? "Search canceled before an authoritative ensemble was published." : "This search could not be accepted under the validated scientific workflow. No authoritative ensemble is available."}</p>
      {state === "Failed" && /#494|outer.?restart|lower.conformer restart/i.test(diagnostic ?? "") ? <p>Outer lower-conformer restarts (CREST upstream #494) fail closed.</p> : null}
      <p>Incomplete or rejected native files are diagnostics, not authoritative conformers.</p>
      {diagnostic ? <p className="conformer-diagnostic">{diagnostic}</p> : null}
      {detail.attempt?.failure_code ? <p>Failure code: {detail.attempt.failure_code}</p> : null}
      <details><summary>Retained diagnostic artifacts</summary><p>These files do not establish an accepted ensemble.</p>
        {(detail.attempt?.raw_artifacts ?? []).map((artifact) => <button key={artifact.artifact_id} type="button" onClick={async () => {
          try { const { blob, filename } = await downloadCalculationArtifact({ projectId, calculationId: detail.calculation.id, artifactId: artifact.artifact_id }); saveArtifact(blob, filename); }
          catch (cause) { setNotice(cause instanceof Error ? cause.message : "Diagnostic download failed."); }
        }}>Download diagnostic {artifact.artifact_id.slice(0, 8)}</button>)}
      </details>
      {onRetry ? <button type="button" onClick={onRetry}>Review settings for another search</button> : null}
      <p>Another stochastic search may also be rejected; retry does not guarantee acceptance.</p>
    </>}
    {pending && cancellationRequested ? <p role="status">Cancellation requested; waiting for worker reconciliation.</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}

const saveArtifact = saveBlob;
export { saveArtifact };

/** Shared Guided/Advanced controls submit exclusively through the existing Compute Gateway. */
export function ConformerSearchPanel({ projectId, structure, onOpenResult, onOpenCalculation, onBack }: {
  projectId: string; structure: StructureVersionDetail;
  onOpenResult: (detail: CalculationDetail) => void;
  onOpenCalculation: (detail: CalculationDetail) => void;
  onBack?: () => void;
}) {
  const [capabilities, setCapabilities] = useState<EngineCapabilityView[] | null>(null);
  const [input, setInput] = useState(structure);
  const geometry = useGeometryEligibility(projectId, input.structure.id, input.version.id);
  const [inputs, setInputs] = useState<StructureVersionDetail[]>([structure]);
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CalculationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void listCalculationCapabilities(projectId).then((items) => { if (alive.current) setCapabilities(items); })
      .catch((cause: unknown) => { if (alive.current) setError(cause instanceof Error ? cause.message : "Native capability registry unavailable."); });
    void listStructures(projectId).then(async (structures) => {
      const versions = (await Promise.all(structures.filter((item) => item.kind === "MOLECULE").map((item) => listStructureVersions(projectId, item.id)))).flat();
      if (alive.current) setInputs(versions);
    }).catch(() => { if (alive.current) setInputNotice("Other saved input versions could not be loaded. The current immutable input remains available."); });
    return () => { alive.current = false; };
  }, [projectId]);
  const terminal = detail ? ["SUCCEEDED", "FAILED", "CANCELED"].includes(detail.calculation.state) : true;
  const calculationId = detail?.calculation.id;
  useEffect(() => {
    if (!calculationId || terminal) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await getCalculation({ projectId, calculationId: calculationId! });
        if (!active) return;
        if (next.calculation.id !== calculationId || next.calculation.project_id !== projectId) throw new Error("Calculation status identity mismatch.");
        setDetail(next); setError(null);
        if (["SUCCEEDED", "FAILED", "CANCELED"].includes(next.calculation.state)) {
          window.dispatchEvent(new Event("chemdft:workspace-items-changed")); return;
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Search status refresh failed."); }
      if (active) timer = setTimeout(() => void poll(), 1500);
    }
    timer = setTimeout(() => void poll(), 500);
    return () => { active = false; clearTimeout(timer); };
  }, [projectId, calculationId, terminal]);
  const capability = capabilities?.find((item) => item.engine === "crest");
  const reason = capabilities === null ? "Checking the native CREST capability…" : conformerUnavailableReason(input, capability);
  const startBlocker = reason || (!geometry.eligible ? "the calculation eligibility check has not passed yet." : !confirmed ? "tick the review box above first." : !terminal ? "a previous search is still running." : null);
  async function submit() {
    if (lock.current || reason || !geometry.eligible || !confirmed || !terminal) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const next = await submitCalculation(projectId, buildConformerSubmission(projectId, input.version.id, `web-crest-${crypto.randomUUID()}`));
      if (!alive.current) return;
      if (next.calculation.project_id !== projectId) throw new Error("Calculation project identity mismatch.");
      setDetail(next); window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Conformer search submission failed."); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="conformer-search-panel" aria-label="Conformer search setup" data-testid="conformer-search-setup" data-structure-version-id={input.version.id}>
    <header className="conformer-header"><div><h2>Conformer search</h2><p>Explore retained molecular geometries with native CREST sampling.</p></div>{onBack ? <button type="button" onClick={onBack}>Back to structure</button> : null}</header>
    <label className="conformer-input-choice">Input StructureVersion<select value={input.version.id} disabled={busy || !terminal} onChange={(event) => {
      const next = inputs.find((item) => item.version.id === event.target.value);
      if (next) { setInput(next); setDetail(null); setConfirmed(false); setError(null); }
    }}>{inputs.map((item) => <option key={item.version.id} value={item.version.id}>{item.structure.name} V{item.version.revision} · {item.version.id.slice(0, 8)}</option>)}</select></label>
    {inputNotice ? <p role="status">{inputNotice}</p> : null}
    <dl className="conformer-facts">
      <div><dt>Immutable input</dt><dd>{input.structure.name} V{input.version.revision}<small>{input.version.id}</small></dd></div>
      <div><dt>Charge / multiplicity</dt><dd>{input.version.overall_charge} / {input.version.multiplicity}</dd></div>
      <div><dt>Native engine</dt><dd>CREST {CREST_VERSION}</dd></div>
      <div><dt>Calculator / method</dt><dd>Embedded tblite 0.3.0-fork / GFN2</dd></div>
    </dl>
    <details open><summary>Validated search settings</summary><dl className="conformer-facts">
      <div><dt>Workflow / gradient threshold</dt><dd>iMTD-GC / VTIGHT</dd></div>
      <div><dt>Requested energy window</dt><dd>6 kcal/mol</dd></div>
      <div><dt>RMSD threshold</dt><dd>0.125 Å</dd></div>
      <div><dt>Energy / rotational threshold</dt><dd>0.05 kcal/mol / 0.01</dd></div>
      <div><dt>Resources / time limit</dt><dd>2 CPU threads / 1800 s</dd></div>
      <div><dt>Supported molecules</dt><dd>Neutral singlet H/C/O only, up to 12 atoms on the hosted worker, nonperiodic</dd></div>
    </dl></details>
    <p className="conformer-disclosure">Retained geometries have minimum status UNVERIFIED. Gradient convergence does not prove a local minimum; vibrational/Hessian validation would be required. Sampling is stochastic and bounded.</p>
    <p>Embedded tblite calculations run inside CREST. External xTB 6.7.1 is a separate engine.</p>
    {reason ? <p role="status" className="conformer-unavailable" data-testid="conformer-unavailable">{reason}</p> : null}
    {geometry.loading ? <p role="status">Checking calculation eligibility…</p> : null}
    {geometry.error ? <div role="alert">
      <p>Calculation eligibility could not be verified. {geometry.error}</p>
      <ActionButton text="Retry eligibility check" onClick={geometry.retry} />
    </div> : null}
    {geometry.eligibility && !geometry.eligible ? <p role="alert">{geometry.eligibility.detail}</p> : null}
    <label className="conformer-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy || !terminal} />I have reviewed the immutable input and fixed CREST settings.</label>
    <div className="conformer-actions"><ActionButton intent="primary" text={busy ? "Submitting search…" : "Start conformer search"} disabled={Boolean(reason) || !geometry.eligible || !confirmed || busy || !terminal} onClick={() => void submit()} />
      {detail ? <button type="button" onClick={() => onOpenCalculation(detail)}>Open calculation record</button> : null}</div>
    {startBlocker ? <p role="status" className="conformer-unavailable" data-testid="conformer-start-blocker">Start is disabled: {startBlocker}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {detail ? <ConformerRunStatus key={detail.calculation.id} projectId={projectId} detail={detail} onOpenResult={onOpenResult} onRetry={() => { setDetail(null); setConfirmed(false); }} /> : null}
  </section>;
}
