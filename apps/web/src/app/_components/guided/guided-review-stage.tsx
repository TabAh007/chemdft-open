"use client";

import { plainSubmitError } from "@/lib/plain-submit-errors";
import { expectedHostedDuration } from "@/lib/aws-limits";
import type { StructureVersionDetail } from "@chemdft/schemas";
import { ENGINE_INFO, TASK_LABEL, methodDescription, methodLabel } from "@/lib/guided-engine-info";
import type { GuidedConfig } from "@/lib/use-guided-config";
import styles from "./guided-workspace.module.css";

export function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function calculationTitle(config: GuidedConfig): string {
  const { task, isXtb, isPsi4, draft } = config;
  if (task === "energy") return isXtb ? "GFN2-xTB single-point energy" : `${isPsi4 ? "Psi4" : "PySCF"} ${methodLabel(draft.method)} single-point energy`;
  if (task === "optimization") return `${isXtb ? "xTB" : "PySCF"} geometry optimization`;
  return TASK_LABEL[task];
}

function expectedOutputs(config: GuidedConfig): string[] {
  const { task, isPsi4, draft, psi4Capability } = config;
  if (task === "raman") return ["Harmonic vibrational frequencies and normal modes", "Placzek Raman activities and depolarization ratios", "Lorentzian-broadened Raman spectrum", "Synchronized 3D normal-mode animation"];
  if (task === "ir") return ["Harmonic vibrational frequencies and normal modes", "Integrated IR intensities from finite-difference dipole derivatives", "Lorentzian-broadened IR spectrum", "Synchronized 3D normal-mode animation"];
  if (task === "tddft") return [`${draft.nstates} lowest singlet excitation energies and wavelengths`, "Length-gauge oscillator strengths", "Calculated stick spectrum and broadened UV/Vis curve", "Dominant orbital contributions"];
  if (task === "optimization") return ["Optimized 3D Cartesian coordinates", "Recorded engine evaluations with gradient norms", "Final total energy and geometry convergence evidence"];
  if (isPsi4) return [
    draft.method === "mp2" ? "Conventional MP2 total energy (Eh)" : "Total electronic energy (Eh)",
    "Published SCF convergence status and iterations",
    `Pinned Psi4 ${psi4Capability?.version ?? ""} engine identity, immutable input hash and validated result provenance`.replace("  ", " "),
  ];
  return ["Total computed energy in the engine's native unit", "Published convergence status", "Engine identity, immutable input hash and validated result provenance"];
}

/**
 * Stage 3 (before submission): the exact configuration that will be sent, the checks it has to pass, every
 * scientific restriction that applies, and the explicit confirmation. Nothing here starts a calculation.
 */
export function GuidedReviewStage({ detail, config, canExecute, submitError, checkedAt, rechecking, onRecheck, onEditInputs }: {
  detail: StructureVersionDetail;
  config: GuidedConfig;
  canExecute: boolean;
  submitError: string | null;
  checkedAt: number | null;
  rechecking: boolean;
  onRecheck: () => void;
  onEditInputs: () => void;
}) {
  const { draft, inputs, activeEngine, isXtb, isPsi4, isOpt, isTddft, capability, choices, geometry } = config;
  const engineChoice = choices[activeEngine];
  const info = ENGINE_INFO[activeEngine];
  const checks: Array<{ ok: boolean | "pending"; text: string }> = [
    { ok: geometry.loading ? "pending" : geometry.eligible, text: geometry.loading ? "Geometry eligibility is being checked" : geometry.eligible ? "Structure has calculation-ready 3D geometry (server verdict)" : (geometry.eligibility?.detail ?? geometry.error ?? "Structure is not calculation-ready") },
    { ok: inputs.confirmed, text: config.electronicState.status === "invalid" ? `Electronic state is impossible. ${config.electronicState.message}` : inputs.confirmed ? `Charge ${inputs.charge}, multiplicity ${inputs.multiplicity} confirmed` : "Charge and multiplicity are not confirmed" },
    { ok: engineChoice ? (engineChoice.selectable ? true : engineChoice.kind === "unknown" || engineChoice.kind === "expired" ? "pending" : false) : false, text: engineChoice?.selectable ? `${info?.name} ${capability?.version ?? ""} is available for this task`.replace("  ", " ") : `${info?.name ?? activeEngine}: ${engineChoice?.label.toLowerCase() ?? "unknown"}${engineChoice?.reason ? ` — ${engineChoice.reason}` : ""}` },
    { ok: config.settingsIssues.length === 0, text: config.settingsIssues.length === 0 ? "Method, basis and parameters are within the reported capabilities" : config.settingsIssues[0] ?? "" },
    { ok: canExecute, text: canExecute ? "Your role can submit calculations" : "Your project role cannot submit calculations" },
  ];

  return (
    <div className={styles.inspectorBody} data-testid="guided-review-stage">
      <div className={styles.section}>
        <h3>Exact configuration</h3>
        <dl className={styles.facts} data-testid="review-configuration">
          <dt>Calculation</dt><dd>{calculationTitle(config)}</dd>
          <dt>Structure</dt><dd>{detail.structure.name} · V{detail.version.revision} <span className={`${styles.mono} ${styles.muted}`} title={detail.version.id}>{shortId(detail.version.id)}</span></dd>
          <dt>Engine</dt><dd>{info?.name ?? activeEngine}{capability?.version ? ` ${capability.version}` : ""}</dd>
          <dt>Method</dt><dd>{isXtb ? "GFN2-xTB" : methodLabel(draft.method)}</dd>
          <dt>Basis set</dt><dd>{isXtb ? "Built-in parameters" : draft.basis.toUpperCase()}</dd>
          <dt>Charge</dt><dd>{inputs.charge ?? "Not entered"}</dd>
          <dt>Multiplicity</dt><dd>{inputs.multiplicity}</dd>
          {!isXtb && !isPsi4 ? <><dt>SCF convergence</dt><dd>{draft.convergence} Eh</dd></> : null}
          {isOpt ? <><dt>Optimizer</dt><dd>{config.optimizer ?? "—"}{isXtb && config.level ? ` (${config.level})` : ""}, ≤ {draft.maxSteps} cycles</dd></> : null}
          {isTddft ? <><dt>Excited states</dt><dd>{draft.nstates} singlets, length gauge</dd></> : null}
          {expectedHostedDuration(config.task, isXtb) ? <><dt>Expected time on the hosted beta</dt><dd data-testid="review-expected-duration">{expectedHostedDuration(config.task, isXtb)}</dd></> : null}
        </dl>
        <p className={styles.caption}>{methodDescription(isXtb ? "gfn2" : draft.method)} The exact structure version above is sent unchanged; its coordinates are immutable.</p>
      </div>

      <div className={styles.section}>
        <h3>Checks</h3>
        <ul className={styles.checks} data-testid="review-checks">
          {checks.map((check) => (
            <li key={check.text} data-ok={String(check.ok)}>
              <span aria-hidden="true">{check.ok === true ? "✓" : check.ok === "pending" ? "…" : "✕"}</span>
              <span><span className={styles.visuallyHidden}>{check.ok === true ? "Passed: " : check.ok === "pending" ? "Pending: " : "Failed: "}</span>{check.text}</span>
            </li>
          ))}
        </ul>
        <p className={styles.caption}>
          Engine availability {checkedAt ? `last read ${new Date(checkedAt).toLocaleTimeString()}` : "has not been read yet"}; it is read again when you submit.{" "}
          <button type="button" className={styles.linkButton} onClick={onRecheck} disabled={rechecking}>{rechecking ? "Checking…" : "Check now"}</button>
        </p>
        {geometry.error ? <p><button type="button" className={styles.secondary} onClick={geometry.retry}>Retry eligibility check</button></p> : null}
        {!inputs.confirmed ? <p><button type="button" className={styles.secondary} onClick={onEditInputs}>Confirm charge &amp; multiplicity</button></p> : null}
      </div>

      <div className={styles.section}>
        <h3>Scientific scope</h3>
        {info?.caveat ? <div className={styles.notice} data-intent="info"><span>{info.caveat}</span></div> : null}
        {isOpt ? <div className={styles.notice} data-intent="info"><span>Geometry convergence does not establish a local minimum; that needs separate vibrational evidence.</span></div> : null}
        {isTddft ? <div className={styles.notice} data-intent="info"><span>Predicted excitation energies depend on the functional and basis set chosen above.</span></div> : null}
        <details className={styles.disclosure}>
          <summary>What you will get</summary>
          <div className={styles.disclosureBody}><ul>{expectedOutputs(config).map((item) => <li key={item} className={styles.caption}>• {item}</li>)}</ul></div>
        </details>
      </div>

      {submitError ? <div className={styles.notice} data-intent="danger" role="alert" data-testid="submit-error"><strong>Not submitted</strong><span>{plainSubmitError(submitError).text}</span>{plainSubmitError(submitError).detail ? <details className={styles.disclosure} data-testid="submit-error-details"><summary>Details</summary><code>{plainSubmitError(submitError).detail}</code></details> : null}</div> : null}

    </div>
  );
}
