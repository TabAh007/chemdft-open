"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CalculationDetail, CalculationSubmitInput, StructureVersionDetail } from "@chemdft/schemas";
import { buildGuidedSubmission } from "@/lib/guided-calculation";
import { classifyEngineChoice } from "@/lib/guided-capability-state";
import { clearPending, loadPending, savePending } from "@/lib/guided-draft";
import { guidedStages, type StageId } from "@/lib/guided-stages";
import { projectPath } from "@/lib/routes";
import { submitCalculation } from "@/lib/structure-workspace-api";
import { useGuidedConfig, type GuidedTask } from "@/lib/use-guided-config";
import type { useGuidedJob } from "@/lib/use-guided-job";
import { useLocale } from "next-intl";
import { defaultLocale, isLocale } from "@chemdft/i18n";
import { GuidedConfigureStage } from "./guided-configure-stage";
import { GuidedJobPanel } from "./guided-job-panel";
import { GuidedReviewStage } from "./guided-review-stage";
import { GuidedStageBar } from "./guided-stage-bar";
import { GuidedStructureStage } from "./guided-structure-stage";
import { GuidedViewer } from "./guided-viewer";
import styles from "./guided-workspace.module.css";

const AVAILABILITY_REFRESH_MS = 45_000;

const STAGE_COPY: Record<StageId, { title: string; lead: string }> = {
  structure: { title: "Structure", lead: "Inspect the committed structure and confirm the inputs the calculation needs." },
  configure: { title: "Configure", lead: "Choose the calculation, engine and method." },
  review: { title: "Review & Submit", lead: "Check the exact configuration, then submit it." },
};

export interface GuidedWorkspaceProps {
  projectId: string;
  detail: StructureVersionDetail;
  task: GuidedTask;
  onTask: (task: GuidedTask | "conformer") => void;
  stage: StageId;
  onStage: (stage: StageId) => void;
  existingResult?: { available: boolean; onView: () => void } | undefined;
  onHome: () => void;
  onOpenEditor: () => void;
  onOpenResult: (detail: CalculationDetail) => void;
  /** The submitted job for this structure version (owned by the workspace so Guided home can show it too). */
  job: ReturnType<typeof useGuidedJob>;
  canExecute: boolean;
}

/**
 * Guided calculation workspace: one persistent molecular view and a contextual inspector that moves through
 * Structure → Configure → Review & Submit. It owns the draft (so stages never lose it) and the submitted job
 * (so a reload restores the recorded state), and shows exactly one primary action for the current state.
 */
export function GuidedWorkspace(props: GuidedWorkspaceProps) {
  const { projectId, detail, task, stage, onStage } = props;
  const candidate = useLocale();
  const locale = isLocale(candidate) ? candidate : defaultLocale;
  const router = useRouter();
  const { job, canExecute } = props;
  const config = useGuidedConfig({ projectId, structure: detail, task, canExecute });

  // The acknowledgement belongs to the exact configuration that was reviewed: any change to the structure version,
  // the electronic-state inputs, the engine, the method, the basis or a setting withdraws it.
  const signature = JSON.stringify([projectId, detail.version.id, config.config]);
  const [acknowledgedFor, setAcknowledgedFor] = useState<string | null>(null);
  const acknowledged = acknowledgedFor === signature;
  const setAcknowledged = (value: boolean) => setAcknowledgedFor(value ? signature : null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const lock = useRef(false);

  // Engine availability is read again on its own: when it expires, and periodically while a decision is pending.
  const capabilities = config.capabilities;
  useEffect(() => { if (capabilities.length > 0) queueMicrotask(() => setCheckedAt(Date.now())); }, [capabilities]);
  const refreshRef = useRef(config.refresh);
  useEffect(() => { refreshRef.current = config.refresh; });
  const expired = Boolean(config.capabilityError?.startsWith("Engine capabilities expired"));
  useEffect(() => {
    if (stage === "structure") return;
    if (expired) void refreshRef.current().catch(() => {});
    const id = window.setInterval(() => { void refreshRef.current().catch(() => {}); }, AVAILABILITY_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [stage, expired]);

  const geometryKnown = !config.geometry.loading && !config.geometry.error;
  const { steps, primary } = guidedStages({
    current: stage,
    hasStructure: true,
    geometryEligible: geometryKnown ? config.geometry.eligible : null,
    geometryReason: config.geometry.error ?? config.geometry.eligibility?.detail ?? null,
    inputsConfirmed: config.inputs.confirmed,
    chargeEntered: config.inputs.charge !== null,
    electronicIssue: config.electronicState.status === "invalid" ? config.electronicState.message : null,
    configIssues: config.issues,
    canExecute,
    acknowledged,
    job: job.view ? { key: job.view.key, terminal: job.view.terminal, resultId: job.view.resultId } : null,
  });

  async function recheck() {
    setRechecking(true);
    try { await config.refresh(); } catch { /* the notice shows the error */ } finally { setRechecking(false); }
  }

  async function submit() {
    if (lock.current || job.view) return;
    lock.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let fresh;
      try { fresh = await config.refresh(); }
      catch (cause) { throw new Error(`Engine availability could not be read, so nothing was submitted. ${cause instanceof Error ? cause.message : ""}`.trim()); }
      const choice = classifyEngineChoice({
        engine: config.activeEngine, task: config.taskType, capabilities: fresh, capabilityError: null, loading: false, canExecute,
        restriction: config.isPsi4 && !config.psi4Structure.valid ? `Psi4 molecular restriction: ${config.psi4Structure.reason}` : null,
      });
      if (!choice.selectable) throw new Error(`${choice.label}${choice.reason ? ` — ${choice.reason}` : ""}. Nothing was submitted.`);

      // The same configuration re-sent after a failure or a reload reuses its idempotency key, so the server de-duplicates it.
      if (!config.config) throw new Error("A valid total charge is required to build a calculation submission.");
      const stored = loadPending(projectId, detail.version.id);
      const payload = (stored?.signature === signature ? stored.payload : null) as CalculationSubmitInput | null
        ?? buildGuidedSubmission(projectId, detail.version.id, config.config);
      if (stored?.signature !== signature) savePending(projectId, detail.version.id, { signature, payload });
      const accepted = await submitCalculation(projectId, payload);
      clearPending(projectId, detail.version.id);
      job.track(accepted);
      setAcknowledged(false);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Calculation submission failed.");
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  function runPrimary() {
    switch (primary.kind) {
      case "fix-geometry": props.onOpenEditor(); break;
      case "confirm-inputs": config.confirmInputs(); break;
      case "to-configure": onStage("configure"); break;
      case "to-review": onStage("review"); break;
      case "submit": void submit(); break;
      case "view-jobs": router.push(projectPath(locale, projectId, "jobs")); break;
      case "open-result": if (job.detail) props.onOpenResult(job.detail); break;
      case "edit-configuration": job.dismiss(); setAcknowledged(false); onStage("configure"); break;
      default: break;
    }
  }

  const copy = STAGE_COPY[stage];
  const atomCount = detail.version.coordinates?.atoms.length ?? 0;
  const primaryBusy = submitting && primary.kind === "submit";

  const headRef = useRef<HTMLElement>(null);
  const [headerOffset, setHeaderOffset] = useState<number>(140);

  useEffect(() => {
    const updateOffset = () => {
      if (!headRef.current) return;
      const rect = headRef.current.getBoundingClientRect();
      const offset = Math.round(rect.bottom);
      if (offset > 0 && Math.abs(offset - headerOffset) >= 2) {
        setHeaderOffset(offset);
      }
    };
    updateOffset();
    window.addEventListener("resize", updateOffset);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && headRef.current) {
      observer = new ResizeObserver(updateOffset);
      observer.observe(headRef.current);
    }
    return () => {
      window.removeEventListener("resize", updateOffset);
      observer?.disconnect();
    };
  }, [headerOffset]);

  const structureTitle = `${detail.structure.name} V${detail.version.revision}`;

  return (
    <div
      className={styles.workspace}
      style={{ "--guided-header-offset": `${headerOffset}px` } as React.CSSProperties}
      data-guided-workspace
      data-testid="guided-workspace"
      data-stage={stage}
    >
      <header ref={headRef} className={styles.head}>
        <div className={styles.crumb}>
          <button type="button" onClick={props.onHome}>Project home</button>
          <span aria-hidden="true">/</span>
          <strong title={structureTitle}>{structureTitle}</strong>
          <span>{atomCount} atoms</span>
        </div>
        <GuidedStageBar steps={steps} onStage={onStage} job={job.view} onOpenJob={() => onStage("review")} />
      </header>

      <div className={styles.body}>
        <GuidedViewer detail={detail} />
        <aside className={styles.inspector} aria-label="Calculation inspector" data-testid="guided-inspector">
          <div className={styles.inspectorHead}>
            <h2>{copy.title}</h2>
            <p className={styles.caption}>{copy.lead}</p>
          </div>

          {stage === "structure" ? (
            <GuidedStructureStage detail={detail} config={config} canEdit={canExecute} onGenerate3d={props.onOpenEditor} />
          ) : stage === "configure" ? (
            <GuidedConfigureStage task={task} onTask={props.onTask} config={config} existingResult={props.existingResult}
              onEditInputs={() => onStage("structure")} jobActive={Boolean(job.view && !job.view.terminal)} />
          ) : job.view && job.detail ? (
            <GuidedJobPanel view={job.view} detail={job.detail} connection={job.connection} error={job.error} lastFetchedAt={job.lastFetchedAt}
              onCancel={job.cancel} cancelError={job.cancelError} onRetry={job.refetch} />
          ) : job.restoring ? (
            <div className={styles.inspectorBody} role="status">Reading recorded job state…</div>
          ) : (
            <GuidedReviewStage detail={detail} config={config} canExecute={canExecute}
              submitError={submitError} checkedAt={checkedAt} rechecking={rechecking} onRecheck={() => { void recheck(); }} onEditInputs={() => onStage("structure")} />
          )}

          <div className={styles.inspectorFoot}>
            {stage === "review" && !job.view && !job.restoring ? (
              <label className={styles.confirm}>
                <input type="checkbox" checked={acknowledged} disabled={submitting} onChange={(e) => setAcknowledged(e.target.checked)} data-testid="setup-confirm-checkbox" />
                <span>I have reviewed this exact configuration and understand that submitting it starts a scientific calculation.</span>
              </label>
            ) : null}
            <button
              type="button" className={styles.primary} onClick={runPrimary} data-testid={primary.kind === "submit" ? "run-calculation-btn" : `guided-primary-${primary.kind}`}
              disabled={primary.disabledReason !== null || primaryBusy} aria-describedby={primary.disabledReason ? "gw-primary-reason" : undefined}
            >
              {primaryBusy ? "Submitting…" : primary.label}
            </button>
            {primary.disabledReason ? <p className={styles.reason} id="gw-primary-reason">{primary.disabledReason}</p> : null}
            {stage === "review" && job.view?.terminal && primary.kind === "open-result" ? (
              <button
                type="button" className={styles.secondary} data-testid="guided-new-calculation"
                onClick={() => { job.dismiss(); setAcknowledged(false); onStage("configure"); }}
              >
                New calculation on this structure
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
