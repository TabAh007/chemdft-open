"use client";

import { AppIcon } from "@chemdft/ui";
import type { StageId, StageStep } from "@/lib/guided-stages";
import type { GuidedJobView } from "@/lib/guided-job-status";
import styles from "./guided-workspace.module.css";

/** Structure → Configure → Review & Submit, plus a compact job chip when a submitted job exists. */
export function GuidedStageBar({ steps, onStage, job, onOpenJob }: {
  steps: StageStep[];
  onStage: (stage: StageId) => void;
  job: GuidedJobView | null;
  onOpenJob: () => void;
}) {
  return (
    <>
      <nav aria-label="Calculation stages" data-testid="guided-stages">
        <ol className={styles.stages}>
          {steps.map((step) => (
            <li key={step.id} data-stage={step.id}>
              <button
                type="button" className={styles.stage} data-state={step.state} data-testid={`guided-stage-${step.id}`}
                aria-current={step.state === "current" ? "step" : undefined} disabled={step.state === "blocked"}
                title={step.note ?? step.label} onClick={() => onStage(step.id)}
              >
                <span className={styles.marker} aria-hidden="true">{step.state === "done" ? <AppIcon icon="tick" /> : step.number}</span>
                {step.label}
                <span className={styles.visuallyHidden}>{step.state === "done" ? " (complete)" : step.state === "current" ? " (current stage)" : step.state === "blocked" ? ` (blocked: ${step.note ?? ""})` : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {job ? (
        <button type="button" className={styles.jobChip} onClick={onOpenJob} data-testid="guided-job-chip" title="Open the submitted job's status">
          <span className={styles.dot} data-intent={job.intent} aria-hidden="true" />
          Job · {job.label}
        </button>
      ) : null}
    </>
  );
}
