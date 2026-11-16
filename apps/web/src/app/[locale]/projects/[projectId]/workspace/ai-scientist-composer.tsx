"use client";
import { useState, type RefObject } from "react";
import { ActionButton, AppIcon } from "@chemdft/ui";
import { selectionKey, type WorkspaceSelection } from "@/lib/workspace-selection";
import { plainAiError } from "@/lib/ai-plain-errors";
import { AiErrorDetails } from "./ai-scientist-error-details";

export type PlanningProfile = "GENERAL" | "PYSCF_ENERGY_PROPOSAL" | "STRUCTURE_EDIT_PROPOSAL" | "PERIODIC_ENERGY_PROPOSAL";
export type ComposerMode = "ask" | "plan";

export type SavedVersionChoice = { selection: WorkspaceSelection; label: string };

export interface AIScientistComposerProps {
  mode?: ComposerMode;
  onModeChange?: (mode: ComposerMode) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Sends the request unless the plan still awaits a structure choice or the project cannot plan. */
  onSubmit: () => void;
  onPrepareCalculation?: () => void;
  onPreparePeriodicCalculation?: () => void;
  onProposeStructureEdit?: () => void;
  onOpenCalculationPanel?: () => void;
  canPrepareCalculation?: boolean;
  canPreparePeriodicCalculation?: boolean;
  canProposeStructureEdit?: boolean;
  isCrystalOrPeriodic?: boolean;
  /** Server-authored reasons a proposal action is unavailable for the selected model/selection. */
  proposalReasons?: { model: string | null; selection: string | null };
  aiAvailable: boolean;
  submitting: boolean;
  /** The run the composer sits under: what blocks sending, and the controls that act on it. */
  run: {
    approvalWaiting: boolean;
    composerPaused: boolean;
    isRunActive: boolean;
    isRunPaused: boolean;
    waitingForCalculation: boolean;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
  };
  /** Plan calculation: what the proposal is built from, and what is missing. */
  planning: {
    planNeedsVersion: boolean;
    planAwaitingChoice: boolean;
    energyPlanningReady: boolean;
    candidateSelection: boolean;
    savedVersions: SavedVersionChoice[];
    planningVersionLabel: string | null;
    planningVersionChosenByServer: boolean;
    effectiveView: string;
    blockedReason: string | null;
    generalPlan: boolean;
    onGeneralPlanChange: (value: boolean) => void;
    onUseVersion: (item: SavedVersionChoice) => void;
  };
  limits: {
    limitRun: boolean;
    onLimitRunChange: (value: boolean) => void;
    values: { calls: string; input: string; output: string };
    onValuesChange: (update: (old: { calls: string; input: string; output: string }) => { calls: string; input: string; output: string }) => void;
    valid: boolean;
  };
  error: string | null;
  onRefreshStatus: () => void;
}

/** Composer: one box, two explicit actions (Ask / Prepare calculation); planning always needs approval. */
export function AIScientistComposer({
  prompt, onPromptChange: setPrompt, inputRef: promptInputRef, onSubmit: submitComposer,
  onPrepareCalculation, onPreparePeriodicCalculation, onProposeStructureEdit, onOpenCalculationPanel,
  canPrepareCalculation, canPreparePeriodicCalculation, canProposeStructureEdit, isCrystalOrPeriodic, proposalReasons,
  aiAvailable, submitting, run, planning, limits, error, onRefreshStatus,
}: AIScientistComposerProps) {
  const { approvalWaiting, composerPaused, isRunActive, isRunPaused, waitingForCalculation, onPause: handlePauseRun, onResume: handleResumeRun, onStop: handleCancelRun } = run;
  const {
    planNeedsVersion, planAwaitingChoice, savedVersions,
    blockedReason: composerBlockedReason, generalPlan, onGeneralPlanChange: setGeneralPlan, onUseVersion,
  } = planning;
  const { limitRun, onLimitRunChange: setLimitRun, values: runLimitValues, onValuesChange: setRunLimitValues, valid: validRunLimits } = limits;
  // One reason per disabled state; the first that applies is shown as a title and a visible hint.
  const proposalDisabledReason: string | null =
    proposalReasons?.model
    ?? proposalReasons?.selection
    ?? composerBlockedReason
    ?? (!aiAvailable ? "AI is not available on this server." : null)
    ?? (isRunActive || isRunPaused ? "A run is in progress. Pause or stop it first." : null)
    ?? (!validRunLimits ? "The run limits are not valid." : null)
    ?? (!prompt.trim() ? "Type a request to enable this action." : null);
  const proposalButtonShown = Boolean(canPreparePeriodicCalculation || canPrepareCalculation);
  // Run limits and the general-planner opt-in live behind one More button; a dot says when either differs from the default.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsChanged = limitRun || generalPlan;
  return (
    <form
      className="ai-input-dock ai-composer-wrapper"
      data-testid="ai-input-dock"
      onSubmit={(e) => {
        e.preventDefault();
        submitComposer();
      }}
    >
      {approvalWaiting ? (
        // One row while a proposal waits: why Ask and Plan are unavailable, and the only other way out.
        <div className="ai-composer-paused-row">
          <p className="ai-composer-paused" data-testid="ai-composer-paused">Ask and Plan are paused: this run waits for your decision on its proposal. Approve or reject it, or stop the run, before sending another request.</p>
          <ActionButton small minimal icon="cross" text="Stop run" onClick={() => void handleCancelRun()} />
        </div>
      ) : <>
      {planNeedsVersion && !composerPaused ? (
        <div className="ai-plan-prerequisite" role="group" aria-labelledby="ai-plan-prerequisite-title" data-testid="ai-plan-prerequisite">
          <p className="ai-plan-prerequisite-title" id="ai-plan-prerequisite-title">
            <AppIcon icon="cube" /> Choose the structure to plan this calculation for
          </p>
          <p className="ai-plan-prerequisite-text">
            {savedVersions.length > 0
              ? "A calculation is planned for one saved structure. Pick the one to use:"
              : "This project has no saved structure yet. Import or draw one and save it, or ask the AI Scientist to find or draft one for you."}
          </p>
          {savedVersions.length > 0 ? (
            <div className="ai-plan-version-picks">
              {savedVersions.slice(0, 3).map((item) => (
                <button key={selectionKey(item.selection)} type="button" className="ai-plan-version-pick" data-testid="ai-plan-use-version"
                  onClick={() => onUseVersion(item)}>
                  <AppIcon icon="cube" /><span>{item.label}</span>
                </button>
              ))}
              {savedVersions.length > 3 ? <span className="ai-plan-version-more">or choose another in the Navigator</span> : null}
            </div>
          ) : null}
          <label className="ai-plan-structure-first">
            <input type="checkbox" checked={generalPlan} onChange={(event) => setGeneralPlan(event.target.checked)}
              data-testid="ai-plan-structure-first" />
            <span>Let the AI Scientist find or draft the structure first (you review it before it is saved)</span>
          </label>
        </div>
      ) : null}

      {/* Options: the general-planner opt-in and the per-run limits. Kept in the DOM while closed so nothing is lost. */}
      <div className="ai-composer-options-body" id="ai-composer-options-body" data-testid="ai-composer-options-body" hidden={!optionsOpen}>
        {(canProposeStructureEdit || canPreparePeriodicCalculation) ? (
          <div className="ai-composer-options-actions" style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
            {canProposeStructureEdit ? (
              <ActionButton
                small
                icon="edit"
                text="Propose structure edit"
                type="button"
                onClick={() => onProposeStructureEdit?.()}
                title={proposalReasons?.model ?? "Propose a structure edit for approval"}
                disabled={submitting || isRunActive || isRunPaused || !aiAvailable || !validRunLimits || Boolean(composerBlockedReason) || Boolean(proposalReasons?.model)}
                data-testid="ai-propose-structure-edit-button"
              />
            ) : null}
            {canPreparePeriodicCalculation ? (
              <ActionButton
                small
                icon="calculator"
                text="Set up in Calculation panel"
                type="button"
                onClick={() => onOpenCalculationPanel?.()}
                data-testid="ai-open-calculation-panel-button"
              />
            ) : null}
          </div>
        ) : null}
        <label className="ai-plan-structure-first">
          <input type="checkbox" checked={generalPlan} onChange={(event) => setGeneralPlan(event.target.checked)} data-testid="ai-plan-general" />
          <span>Use the general planner (find or draft structures, extract document figures)</span>
        </label>
        <div className="ai-run-limits">
          <p className="ai-run-limits-title">Run limits</p>
          <fieldset disabled={submitting || isRunActive || isRunPaused}>
            <label>
              <input type="checkbox" checked={limitRun} onChange={(event) => setLimitRun(event.target.checked)} />
              Set lower limits for this run
            </label>
            {limitRun ? <>
              <p>Limits are checked by the server before model calls. They do not increase your quota or approve calculations.</p>
              <label>Maximum model calls
                <input className="bp6-input" type="number" min={1} max={15} step={1} value={runLimitValues.calls}
                  onChange={(event) => setRunLimitValues((old) => ({ ...old, calls: event.target.value }))} />
              </label>
              <label>Maximum input reservations
                <input className="bp6-input" type="number" min={1} max={60000} step={1} value={runLimitValues.input}
                  onChange={(event) => setRunLimitValues((old) => ({ ...old, input: event.target.value }))} />
              </label>
              <label>Maximum output tokens
                <input className="bp6-input" type="number" min={1} max={12000} step={1} value={runLimitValues.output}
                  onChange={(event) => setRunLimitValues((old) => ({ ...old, output: event.target.value }))} />
              </label>
              {!validRunLimits ? <p role="alert">Enter positive whole numbers within the displayed limits.</p> : null}
            </> : null}
          </fieldset>
        </div>
      </div>

      <div className="ai-composer-box">
        <textarea
          className="ai-prompt-input ai-composer-textarea"
          data-testid="ai-prompt-input"
          aria-label="Message for AI Scientist"
          aria-describedby="ai-composer-hint"
          placeholder="Ask, or describe what to do… (Enter sends)"
          title="Enter to send · Shift+Enter for a new line"
          rows={1}
          ref={promptInputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submitComposer();
            }
          }}
          disabled={submitting || isRunActive || isRunPaused || !aiAvailable}
        />
        <div className="ai-composer-toolbar">
          <div className="ai-composer-toolbar-left">
            <button
              type="button"
              className="ai-composer-options-btn"
              aria-expanded={optionsOpen}
              aria-controls="ai-composer-options-body"
              data-testid="ai-composer-options"
              title="More: find or draft a structure, extract figures, run limits"
              onClick={() => setOptionsOpen((val) => !val)}
            >
              More
              {optionsChanged ? <span className="ai-options-dot" role="img" aria-label="changed from the defaults" data-testid="ai-composer-options-changed" /> : null}
              <AppIcon icon={optionsOpen ? "chevron-up" : "chevron-down"} />
            </button>
            <span className="ai-composer-mode-scope ai-composer-compact-disclaimer" data-testid="ai-composer-mode-scope">
              <span className="ai-visually-hidden">Ask anything about this project. Calculations need your approval. AI replies are not evidence.</span>
              <span
                className="ai-composer-info-trigger"
                tabIndex={0}
                role="note"
                aria-label="About AI Scientist replies and plans"
                title="Ask anything about this project. Calculations need your approval. AI replies are not evidence. Results and documents are answered with citations; other replies are labelled as AI replies. Ask never proposes or changes anything. Calculations require your explicit review and approval."
              >
                <AppIcon icon="info-sign" />
              </span>
            </span>
            <span className="ai-composer-hint" id="ai-composer-hint" style={{ fontSize: "11px", color: "var(--cdf-ink-faint, #64748b)" }}>
              {planAwaitingChoice ? "Choose a structure version to plan" : ""}
            </span>
          </div>
          <div className="ai-composer-toolbar-right">
            {isRunActive && !submitting ? (
              <div className="ai-composer-run-controls">
                <ActionButton small icon="pause" text="Pause" onClick={() => void handlePauseRun()} />
                <ActionButton small icon="cross" text="Stop" onClick={() => void handleCancelRun()} />
              </div>
            ) : isRunPaused ? (
              <div className="ai-composer-run-controls">
                <ActionButton small intent="primary" icon="play" text="Resume" onClick={() => void handleResumeRun()} disabled={submitting} />
                <ActionButton small icon="cross" text="Stop" onClick={() => void handleCancelRun()} />
              </div>
            ) : (
              <div className="ai-composer-actions-group" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {canPreparePeriodicCalculation ? (
                  <ActionButton
                    small
                    icon="cube"
                    text="Prepare periodic run"
                    aria-label="Prepare periodic calculation for approval"
                    title={proposalDisabledReason ?? "Prepare periodic calculation for approval"}
                    type="button"
                    onClick={() => onPreparePeriodicCalculation?.()}
                    disabled={submitting || Boolean(proposalDisabledReason)}
                    data-testid="ai-prepare-periodic-calculation-button"
                  />
                ) : canPrepareCalculation ? (
                  <ActionButton
                    small
                    icon="cube"
                    text="Prepare calculation"
                    aria-label="Prepare calculation for approval"
                    title={proposalDisabledReason ?? "Prepare calculation for approval"}
                    type="button"
                    onClick={() => onPrepareCalculation?.()}
                    disabled={submitting || Boolean(proposalDisabledReason)}
                    data-testid="ai-prepare-calculation-button"
                  />
                ) : isCrystalOrPeriodic ? (
                  <ActionButton
                    small
                    icon="calculator"
                    text="Set up in Calculation panel"
                    type="button"
                    onClick={() => onOpenCalculationPanel?.()}
                    data-testid="ai-open-calculation-panel-button"
                  />
                ) : null}
                <ActionButton
                  small
                  intent="primary"
                  icon="arrow-right"
                  text={submitting ? "Working…" : "Ask"}
                  type="submit"
                  disabled={submitting || isRunActive || isRunPaused || !prompt.trim() || !aiAvailable || !validRunLimits}
                  aria-describedby="ai-composer-hint"
                  aria-busy={submitting}
                  data-testid="ai-ask-button"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {proposalButtonShown && proposalDisabledReason ? <p className={proposalDisabledReason === "Type a request to enable this action." ? "ai-composer-disabled-hint ai-visually-hidden" : "ai-composer-disabled-hint"} role="note" data-testid="ai-composer-disabled-hint">{proposalDisabledReason}</p> : null}
      {composerBlockedReason ? <p className="ai-composer-blocked" role="note" data-testid="ai-composer-blocked">{composerBlockedReason}</p> : null}
      {isRunPaused ? <p className="ai-composer-paused" data-testid="ai-composer-paused">Run paused. Resume or stop it before sending another request.</p>
        : waitingForCalculation ? <p className="ai-composer-paused" data-testid="ai-composer-paused">Waiting for the approved calculation to finish. Ask and Plan resume when it completes; its status is shown in Runs and Jobs.</p>
        : isRunActive && !submitting ? <p className="ai-composer-paused" data-testid="ai-composer-paused">The AI Scientist is working on your last request. Pause or stop it to change course.</p> : null}
      </>}
      {error ? <div className="ai-error-banner" role="alert" data-testid="ai-submit-error">
        <AppIcon icon="error" /><span>{plainAiError(error).text}<AiErrorDetails detail={plainAiError(error).detail} /></span><button type="button" onClick={() => onRefreshStatus()}>Refresh status</button>
      </div> : null}
    </form>
  );
}
