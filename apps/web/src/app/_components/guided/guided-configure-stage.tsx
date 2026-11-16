"use client";

import { HelpTip } from "@/app/_components/help/help-tip";
import { ENGINE_INFO, TASK_LABEL, methodDescription, methodLabel } from "@/lib/guided-engine-info";
import { CAPABILITIES_EXPIRED_PREFIX } from "@/lib/guided-capability-state";
import { plainEngineReason } from "@/lib/engine-reason-text";
import type { GuidedConfig, GuidedEngine, GuidedTask } from "@/lib/use-guided-config";
import styles from "./guided-workspace.module.css";

const FAMILIES: Array<GuidedTask | "conformer"> = ["energy", "optimization", "tddft", "ir", "raman", "conformer"];
const ENGINES: GuidedEngine[] = ["xtb", "pyscf", "psi4"];
const KIND_INTENT = { selectable: "success", "missing-inputs": "warning", "worker-unavailable": "danger", "unsupported-method": "warning", unknown: "none", expired: "warning", "no-permission": "warning" } as const;

/**
 * Stage 2: the calculation itself. Engine availability comes from the capability contract and is shown with the
 * exact reason when an engine cannot be chosen; required inputs are never hidden, and numerical controls sit
 * under Advanced settings.
 */
export function GuidedConfigureStage({ task, onTask, config, existingResult, onEditInputs, jobActive }: {
  task: GuidedTask;
  onTask: (task: GuidedTask | "conformer") => void;
  config: GuidedConfig;
  existingResult?: { available: boolean; onView: () => void } | undefined;
  onEditInputs: () => void;
  jobActive: boolean;
}) {
  const { draft, inputs, patch, isXtb, isPsi4, isOpt, isTddft, isEnergy, choices, capability, activeEngine } = config;
  const energyLike = isEnergy || isOpt;
  const info = ENGINE_INFO[activeEngine];
  const methods = isPsi4 ? config.psi4Methods : config.methods;
  const bases = isPsi4 ? config.psi4Bases : config.bases;
  const refreshing = Boolean(config.capabilityError?.startsWith(CAPABILITIES_EXPIRED_PREFIX)) || config.capabilitiesLoading;

  return (
    <div className={styles.inspectorBody} data-testid="guided-calculation-setup">
      {jobActive ? (
        <div className={styles.notice} data-intent="info">
          <strong>A job for this structure is in flight.</strong>
          <span>Changes here edit a new draft; they do not alter the submitted job. Its status is under Review &amp; Submit.</span>
        </div>
      ) : null}

      <div className={styles.field}>
        <label htmlFor="gw-family">Calculation</label>
        <select id="gw-family" value={task} onChange={(e) => onTask(e.target.value as GuidedTask | "conformer")} data-testid="guided-family">
          {FAMILIES.map((family) => <option key={family} value={family}>{TASK_LABEL[family]}</option>)}
        </select>
      </div>

      {existingResult?.available && !isOpt && !isTddft ? (
        <div className={styles.notice} data-intent="success" data-testid="existing-result-notice">
          <strong>A published result already exists</strong>
          <button type="button" className={styles.linkButton} onClick={existingResult.onView} data-testid="view-saved-result-btn">View saved result</button>
          <span className={styles.caption}>Inspect its method and input before deciding to rerun.</span>
        </div>
      ) : null}

      <div className={styles.section}>
        <h3>Engine</h3>
        {energyLike ? (
          <div className={styles.engines} role="radiogroup" aria-label="Calculation engine">
            {ENGINES.filter((engine) => engine !== "psi4" || isEnergy).map((engine) => {
              const choice = choices[engine];
              const cap = config.capabilities.find((item) => item.engine === engine);
              const usable = Boolean(choice?.selectable);
              return (
                <div key={engine} className={styles.engineWrap}>
                <button
                  type="button" role="radio" aria-checked={activeEngine === engine} disabled={!usable}
                  className={styles.engine} data-testid={`guided-engine-${engine}-btn`} aria-describedby={`gw-engine-${engine}-note`} title={ENGINE_INFO[engine]?.summary}
                  onClick={() => config.changeEngine(engine)}
                >
                  <span className={styles.radio} aria-hidden="true" />
                  <span className={styles.engineName}>{ENGINE_INFO[engine]?.name}{cap?.version ? ` ${cap.version}` : ""}</span>
                  <span className={styles.tag} data-intent={choice ? KIND_INTENT[choice.kind] : "none"}>{choice?.label ?? "—"}</span>
                  {activeEngine === engine || !usable
                    ? <span className={styles.engineMeta} id={`gw-engine-${engine}-note`}>{plainEngineReason(choice?.reason).plain || ENGINE_INFO[engine]?.summary}</span>
                    : <span className={styles.visuallyHidden} id={`gw-engine-${engine}-note`}>{ENGINE_INFO[engine]?.summary}</span>}
                </button>
                {plainEngineReason(choice?.reason).technical && (activeEngine === engine || !usable) ? (
                  <details className={styles.technical}><summary>Technical details</summary><code>{plainEngineReason(choice?.reason).technical}</code></details>
                ) : null}
                {/* Each caution sits under ITS OWN engine row and shows only while that engine is the selected one. */}
                {activeEngine === engine && ENGINE_INFO[engine]?.caveat
                  ? <p className={styles.caption} data-testid={`engine-caveat-${engine}`}>{ENGINE_INFO[engine]!.caveat}</p> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.engines}>
            <div className={styles.engine} aria-checked="true" role="radio" tabIndex={0}>
              <span className={styles.radio} aria-hidden="true" />
              <span className={styles.engineName}>PySCF{capability?.version ? ` ${capability.version}` : ""}</span>
              <span className={styles.tag} data-intent={choices.pyscf ? KIND_INTENT[choices.pyscf.kind] : "none"}>{choices.pyscf?.label ?? "—"}</span>
              <span className={styles.engineMeta}>{choices.pyscf?.reason ?? "This calculation runs on PySCF."}</span>
            </div>
          </div>
        )}
        {!energyLike && info?.caveat ? <p className={styles.caption} data-testid="engine-caveat">{info.caveat}</p> : null}
        {config.capabilityError ? (
          <div className={styles.notice} data-intent="warning" role="status" data-testid="capability-notice">
            <strong>{config.capabilityError.startsWith(CAPABILITIES_EXPIRED_PREFIX) ? "Engine availability needs a refresh" : "Engine availability unknown"}</strong>
            <span>{config.capabilityError.startsWith(CAPABILITIES_EXPIRED_PREFIX) ? "It is re-read automatically and again just before you submit." : config.capabilityError}</span>
            <button type="button" className={styles.secondary} disabled={refreshing} onClick={() => { void config.refresh().catch(() => {}); }}>Refresh availability</button>
          </div>
        ) : null}
      </div>

      <div className={styles.section}>
        <h3>Method</h3>
        <div className={styles.row2}>
          <div className={styles.field}>
            <span className={styles.label}><label htmlFor="calc-method">{isTddft ? "Ground-state functional" : "Method"}</label> <HelpTip topic="calculation.method" /></span>
            {isXtb ? (
              <div className={styles.fixedByEngine} data-testid="calc-method-fixed">
                <output id="calc-method">GFN2-xTB</output>
                <span>Set by the xTB engine: it only runs GFN2-xTB.</span>
              </div>
            ) : (
              <select id="calc-method" value={draft.method} onChange={(e) => config.changeMethod(e.target.value)}>
                {methods.length === 0 ? <option value={draft.method}>{methodLabel(draft.method)}</option> : null}
                {methods.map((id) => <option key={id} value={id}>{methodLabel(id)}</option>)}
              </select>
            )}
          </div>
          <div className={styles.field}>
            <span className={styles.label}><label htmlFor="calc-basis">Basis set</label> <HelpTip topic="calculation.basis" /></span>
            {isXtb ? (
              <div className={styles.fixedByEngine} data-testid="calc-basis-fixed">
                <output id="calc-basis">None (built-in parameters)</output>
                <span>Set by the xTB engine: GFN2-xTB uses built-in parameters, so there is no basis set.</span>
              </div>
            ) : (
              <select id="calc-basis" value={draft.basis} onChange={(e) => patch({ basis: e.target.value }, true)}>
                {bases.length === 0 ? <option value={draft.basis}>{draft.basis.toUpperCase()}</option> : null}
                {bases.map((id) => {
                  const coverage = config.basisCovers(id);
                  const usable = isPsi4 || coverage.usable;
                  return <option key={id} value={id} disabled={!usable}>{usable ? id.toUpperCase() : `${id.toUpperCase()} — unavailable (Z ≤ ${coverage.limit} only)`}</option>;
                })}
              </select>
            )}
          </div>
        </div>
        <p className={styles.caption}>{methodDescription(isXtb ? "gfn2" : draft.method)}{isTddft ? " TDDFT adds a linear-response excited-state calculation on top of this reference." : ""}</p>
        <p className={styles.caption}>
          Electronic state: charge <strong>{inputs.charge === null ? "not entered" : inputs.charge > 0 ? `+${inputs.charge}` : inputs.charge}</strong>, multiplicity <strong>{inputs.multiplicity}</strong>
          {inputs.confirmed ? " (confirmed)" : " (not yet confirmed)"}. <button type="button" className={styles.linkButton} onClick={onEditInputs}>Change on the Structure stage</button>
        </p>
      </div>

      <details className={styles.disclosure}>
        <summary>Advanced settings</summary>
        <div className={styles.disclosureBody} data-testid="advanced-settings-form">
          <div className={styles.field}>
            <label htmlFor="calc-conv">SCF convergence threshold (Eh)</label>
            <input id="calc-conv" type="text" value={isXtb ? "Engine default" : isPsi4 ? "Pinned engine preset" : draft.convergence} disabled={isXtb || isPsi4}
              onChange={(e) => patch({ convergence: e.target.value }, true)} />
          </div>
          {isTddft ? (
            <div className={styles.field}>
              <label htmlFor="calc-nstates">Number of singlet excited states</label>
              <input id="calc-nstates" type="number" min={1} max={20} value={draft.nstates} onChange={(e) => patch({ nstates: Math.min(20, Math.max(1, Number.parseInt(e.target.value, 10) || 5)) }, true)} />
            </div>
          ) : null}
          {isOpt ? (
            <>
              <div className={styles.row2}>
                <div className={styles.field}><label htmlFor="calc-optimizer">Optimizer</label><input id="calc-optimizer" type="text" value={config.optimizer ?? "Unavailable"} disabled /></div>
                {isXtb ? <div className={styles.field}><label htmlFor="calc-opt-level">Level</label><input id="calc-opt-level" type="text" value={config.level ?? "Unavailable"} disabled /></div> : null}
              </div>
              <div className={styles.field}>
                <label htmlFor="calc-max-steps">Maximum optimization cycles</label>
                <input id="calc-max-steps" type="number" min={1} max={500} value={draft.maxSteps} onChange={(e) => patch({ maxSteps: Number(e.target.value) }, true)} />
              </div>
            </>
          ) : null}
        </div>
      </details>

      {!inputs.confirmed ? (
        <div className={styles.notice} data-intent="warning" role="group" aria-label="To continue" data-testid="configure-confirm-checklist">
          <strong>To continue: confirm charge and multiplicity</strong>
          <span>
            {inputs.charge === null
              ? "The total charge has not been entered. Enter it on the Structure stage."
              : config.electronicState.status === "invalid"
                ? config.electronicState.message
                : `Charge ${inputs.charge > 0 ? `+${inputs.charge}` : inputs.charge}, multiplicity ${inputs.multiplicity} will be used for this calculation. Confirm them, or change them on the Structure stage.`}
          </span>
          <span className={styles.checklistActions}>
            {inputs.charge !== null && config.electronicState.status !== "invalid" ? (
              <button type="button" className={styles.secondary} onClick={config.confirmInputs} data-testid="configure-confirm-inputs-btn">Confirm charge &amp; multiplicity</button>
            ) : null}
            <button type="button" className={styles.linkButton} onClick={onEditInputs}>Change on the Structure stage</button>
          </span>
        </div>
      ) : null}

      {config.issues.length > 0 ? (
        <div className={styles.notice} data-intent="warning" data-testid="configure-issues">
          <strong>Before you can review</strong>
          <ul>{config.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}
