"use client";

import { AppIcon } from "@chemdft/ui";

import { askAiAboutResult, type ResultAiTarget } from "@/lib/result-ai-context";
import { CiteCalculation } from "../cite-calculation";
import { ExportMenu } from "../export/export-menu";
import styles from "./result-action-row.module.css";

/**
 * Release 0.0.25: ONE action row for every Results view (Guided and Advanced): Export ▾ (with Share…), Cite, and
 * "Ask AI about this result", always in this order and with these labels. It reuses the existing ExportMenu and
 * CiteCalculation (same permissions, same output); nothing is forked or re-implemented here.
 */
export function ResultActionRow({ projectId, calculationId, resultId, structureLabel, label, exportTestId = "result-action-export" }: ResultAiTarget & { structureLabel?: string | undefined; exportTestId?: string | undefined }) {
  return (
    <div className={styles.row} role="group" aria-label="Result actions" data-testid="result-action-row">
      <ExportMenu
        context="result"
        projectId={projectId}
        calculationId={calculationId}
        resultId={resultId}
        structureLabel={structureLabel}
        buttonTestId={exportTestId}
        shareTestId="result-action-share"
      />
      <CiteCalculation projectId={projectId} calculationId={calculationId} inline />
      <button type="button" className="bp6-button" data-testid="result-ask-ai" onClick={() => askAiAboutResult({ projectId, calculationId, resultId, label })}>
        <AppIcon icon="chat" />
        <span>Ask AI about this result</span>
      </button>
    </div>
  );
}
