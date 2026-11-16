"use client";

import { useEffect, useState } from "react";
import type { CalculationDetail, CalculationResult, Dftd4Capability, DispersionCorrectedEnergyResult, NativeDispersionCorrectedEnergyResult } from "@chemdft/schemas";
import { describeScientificState, axesSummary } from "@/lib/scientific-state";
import { cancelCalculation, getCalculation, getDftd4Capability, retryDftd4Correction, submitDftd4Correction } from "@/lib/structure-workspace-api";

function useLiveCorrection(projectId: string, initial: CalculationDetail | null) {
  const [detail, setDetail] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const calculationId = detail?.calculation.id;
  useEffect(() => {
    if (!calculationId) return;
    let active = true;
    const timer = window.setInterval(() => {
      void getCalculation({ projectId, calculationId }).then((value) => {
        if (active) { setDetail(value); setError(null); }
      }).catch(() => { if (active) setError("The correction's current scientific status could not be verified. Refresh before using this result."); });
    }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, calculationId]);
  return { detail, setDetail, error };
}

function CorrectionEvidence({ projectId, detail }: { projectId: string; detail: CalculationDetail }) {
  const result = detail.result;
  if (!result || result.payload.payload_schema !== "chemdft.dispersion-corrected-energy") return null;
  const payload = result.payload as DispersionCorrectedEnergyResult | NativeDispersionCorrectedEnergyResult;
  // Current standing requires an explicit read-time effective state; its absence fails closed.
  const state = describeScientificState(result);
  const active = state.currentlyAuthoritative;
  return <section aria-label="DFT-D4 scientific result" data-testid="dftd4-result" data-currently-authoritative={active ? "true" : "false"}>
    <h3>{payload.functional.toUpperCase()} + D4 · BJ / EEQ / ATM</h3>
    <p role="status">{active
      ? "Native correction · inputs and evidence validated"
      : state.effectiveKnown ? "Inactive correction — required source is no longer valid" : "Inactive correction — current scientific state not established"} · {axesSummary(state)}</p>
    {active ? null : <p role="note" data-testid="dftd4-inactive-reason">
      {state.notes[0]} The corrected total is not shown as current evidence.
      {state.stored ? ` Recorded at publication: ${state.stored.authority} / ${state.stored.validation} / ${state.stored.verification}.` : ""}
    </p>}
    {active ? <dl>
      <div><dt>Original uncorrected DFT energy</dt><dd>{payload.uncorrected_dft_energy.value.toPrecision(17)} Eh</dd></div>
      <div><dt>D4 dispersion correction</dt><dd>{payload.d4_correction_energy.value.toPrecision(17)} Eh</dd></div>
      <div><dt>DFT + D4 total energy</dt><dd>{payload.corrected_total_energy.value.toPrecision(17)} Eh</dd></div>
    </dl> : null}
    <p>{result.producer_software.name} {result.producer_software.version} · fixed source geometry · charge 0 · singlet</p>
    <p>Independent verification of this combined energy: not established.</p>
    <details><summary>Scientific lineage, parameters and native evidence</summary>
      <dl>
        <div><dt>Source result</dt><dd>{payload.source.result_id}</dd></div>
        <div><dt>Source calculation</dt><dd>{payload.source.calculation_id}</dd></div>
        <div><dt>StructureVersion</dt><dd>{payload.source.structure_version_id}</dd></div>
        <div><dt>Provenance</dt><dd>{result.provenance_record_id}</dd></div>
        <div><dt>Canonical geometry SHA-256</dt><dd>{payload.source.canonical_sha256}</dd></div>
        <div><dt>Parameter table SHA-256</dt><dd>{payload.parameter_table_sha256}</dd></div>
      </dl>
      <p>Exact coefficients (a2 in bohr; other coefficients dimensionless):</p>
      <pre>{JSON.stringify(payload.parameters, null, 2)}</pre>
      <ul>{result.raw_artifacts.map((artifact, i) => <li key={artifact.artifact_id}>
        <a href={`/api/chemdft/v1/projects/${projectId}/calculations/${detail.calculation.id}/artifacts/${artifact.artifact_id}`}>
          Evidence {i + 1} · SHA-256 {artifact.sha256}
        </a>
      </li>)}</ul>
    </details>
  </section>;
}

export function Dftd4RetryControl({ projectId, detail, onRetried }: {
  projectId: string; detail: CalculationDetail; onRetried: (value: CalculationDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = detail.attempt;
  const eligible = detail.calculation.state === "FAILED" && attempt?.state === "FAILED" &&
    ["ENGINE_CRASHED", "EXECUTION_TIMEOUT", "ENGINE_UNAVAILABLE", "OUTPUT_MISSING"].includes(attempt.failure_code ?? "");
  if (!eligible || !attempt) return null;
  async function retry() {
    setBusy(true); setError(null);
    try {
      onRetried(await retryDftd4Correction(projectId, detail.calculation.id, { failed_attempt_id: attempt!.id }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "D4 recovery failed."); }
    finally { setBusy(false); }
  }
  return <div>
    <p>The failed attempt and its diagnostics will be preserved. Retry runs a new attempt of this correction.</p>
    <button type="button" disabled={busy} onClick={() => void retry()}>{busy ? "Requesting retry…" : "Retry failed D4 execution"}</button>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

export function Dftd4ResultView({ projectId, initial }: { projectId: string; initial: CalculationDetail }) {
  const live = useLiveCorrection(projectId, initial);
  if (live.error) return <p role="alert">{live.error}</p>;
  return live.detail ? <>
    <CorrectionEvidence projectId={projectId} detail={live.detail} />
    <Dftd4RetryControl projectId={projectId} detail={live.detail} onRetried={live.setDetail} />
  </> : null;
}

export function Dftd4CorrectionControl({ projectId, source }: { projectId: string; source: CalculationResult }) {
  const [capability, setCapability] = useState<Dftd4Capability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useLiveCorrection(projectId, null);
  // D4 is defined only for a trusted Psi4 source; probing any other engine's result can only be rejected (422).
  const eligibleEngine = source.producer_software?.name === "psi4";
  useEffect(() => {
    if (!eligibleEngine) return;
    let active = true;
    void getDftd4Capability(projectId, source.id).then((value) => { if (active) setCapability(value); })
      .catch(() => { if (active) setCapability(null); });
    return () => { active = false; };
  }, [projectId, source.id, eligibleEngine]);
  const sourceState = describeScientificState(source);
  if (!sourceState.currentlyAuthoritative) {
    // Fail closed: a source without an established current state is never offered for derivation.
    return <section aria-label="DFT-D4 correction" data-testid="dftd4-control-unavailable">
      <h3>DFT-D4 dispersion correction</h3>
      <p role="note">Unavailable: the source result is not currently established as authoritative. {sourceState.notes[0]}</p>
    </section>;
  }
  if (!eligibleEngine || !capability) return null;
  const pending = live.detail && !["SUCCEEDED", "FAILED", "CANCELED"].includes(live.detail.calculation.state);
  async function submit() {
    setBusy(true); setError(null);
    try { live.setDetail(await submitDftd4Correction(projectId, source.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "D4 correction failed."); }
    finally { setBusy(false); }
  }
  return <section aria-label="DFT-D4 correction" data-testid="dftd4-control">
    <h3>DFT-D4 dispersion correction</h3>
    <p>Apply the fixed D4 BJ/EEQ/ATM correction to this uncorrected Psi4 result and its exact geometry.</p>
    <button type="button" disabled={!capability.available || busy || Boolean(pending)} onClick={() => void submit()}>
      {busy ? "Submitting D4 correction…" : "Calculate D4 correction"}
    </button>
    {capability.diagnostic ? <p role="status">{capability.diagnostic}</p> : null}
    {pending && live.detail ? <button type="button" onClick={() => {
      void cancelCalculation({ projectId, calculationId: live.detail!.calculation.id }).then(live.setDetail)
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Cancellation failed."));
    }}>Cancel D4 correction</button> : null}
    {error || live.error ? <p role="alert">{error ?? live.error}</p> : live.detail ? <>
      {!live.detail.result ? <p role="status">{live.detail.calculation.state} · {live.detail.attempt?.diagnostic ?? "Awaiting native result"}</p> : null}
      <CorrectionEvidence projectId={projectId} detail={live.detail} />
      <Dftd4RetryControl projectId={projectId} detail={live.detail} onRetried={live.setDetail} />
    </> : null}
  </section>;
}
