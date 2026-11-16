"use client";
import type { ReactNode, RefObject } from "react";
import type {
  AICitation, AIModelCapability, AIRunEventView, AIRunView, AIApprovalView, AIMessageView, AISettingsView, InvestigationView, ProductContext, ComputeJobView,
} from "@chemdft/schemas";
import { ActionButton, AppIcon, StatusTag } from "@chemdft/ui";
import type { WorkspaceSelection } from "@/lib/workspace-selection";
import { supersededAnswer } from "@/lib/workstation-ux";
import { runStatusLabel } from "@/lib/scientific-labels";
import { latestEvidenceSelection } from "@/lib/ai-evidence-selection";
import type { ResolvedAiContext } from "@/lib/ai-context";
import { AiContextSwitchNotice, AiContextTags } from "./ai-context-chip";
import { ScientificWorkflow } from "./ai-scientific-workflow";
import { ApprovalCard } from "./ai-scientist-approval-screen";
import { ProposalBlockerNotice } from "./ai-scientist-blocker";
import { AIScientistStatusBar } from "./ai-scientist-status-bar";
import type { AiContextOrigin } from "./ai-conversation-state";
import type { PlanningProfile } from "./ai-scientist-composer";
import { ClarificationCard, MessageBubble, RunTimeline } from "./ai-scientist-messages";
import { AiErrorDetails } from "./ai-scientist-error-details";
import { plainAiError } from "@/lib/ai-plain-errors";
import { PulseLightIndicator } from "@/app/_components/pulse-light-indicator";

export type StarterPrompt = { label: string; prompt: string; mode: "EVIDENCE" | "STANDARD" | "CHAT"; profile?: PlanningProfile };

export interface AIScientistChatTabProps {
  projectId: string;
  /** The page context and what the status bar shows about it. */
  context: {
    ctx: ResolvedAiContext;
    contextKey: string;
    effectiveView: string;
    currentSelection: WorkspaceSelection | null | undefined;
    productContext: ProductContext | null;
    contextError: string | null | undefined;
    aiAvailable: boolean;
    aiSettings: AISettingsView | null;
    activeModelCapability: AIModelCapability | null;
    conformerContext: boolean;
    candidateSelection: boolean;
    showFollowAi: boolean;
    followAiMode: boolean;
    onFollowAiModeChange: (follow: boolean) => void;
    onConfigure: () => void;
    onModelSaved: () => void;
    switchedOrigin: AiContextOrigin | null;
    onCitationClick: ((citation: AICitation) => void) | undefined;
    onRetry?: () => void;
  };
  /** The active run, its timeline and the actions on it. */
  run: {
    activeRun: AIRunView | null;
    activeRunId: string | undefined;
    events: AIRunEventView[];
    eventLoading: boolean;
    eventError: string | null;
    runReadError: string | null;
    isRunActive: boolean;
    isRunPaused: boolean;
    isRunWaitingCalculation: boolean;
    waitingComputeJob?: ComputeJobView | null;
    submitting: boolean;
    progress: string | null;
    elapsed: number;
    onResume: () => Promise<void>;
    onCancel: () => Promise<void>;
    onRefreshRun: () => Promise<void>;
    onFetchEvents: (runId: string) => Promise<void>;
  };
  approval: {
    approvalWaiting: boolean;
    pendingApproval: AIApprovalView | null | undefined;
    showApprovalScreen: boolean;
    approvalRequest: string | null;
    onDecide: (approvalId: string, decision: "APPROVE" | "REJECT", note?: string) => Promise<void>;
    onDefer: (approvalId: string | null) => void;
    reviewButtonRef: RefObject<HTMLButtonElement | null>;
  };
  conversation: {
    loading: boolean;
    scrollRef: RefObject<HTMLDivElement | null>;
    allMessages: AIMessageView[];
    messages: AIMessageView[];
    history: AIMessageView[];
    turnStart: number | undefined;
    runOrigins: Record<string, AiContextOrigin>;
    submitOrigin: AiContextOrigin | null;
    pendingQuestion: string | null;
    starterPrompts: StarterPrompt[];
    onStarter: (starter: StarterPrompt) => void;
    latestClarification: AIRunEventView | null;
    clarificationInput: string;
    onClarificationInputChange: (value: string) => void;
    onClarificationSubmit: (text: string) => Promise<void>;
    planAwaitingChoice: boolean;
    composerRequestMode: "STANDARD" | "EVIDENCE" | "CHAT";
    composerProfile: PlanningProfile;
    onSend: (messageText?: string, mode?: "STANDARD" | "EVIDENCE" | "CHAT", profile?: PlanningProfile) => Promise<void>;
  };
  investigation: {
    investigation: InvestigationView | null;
    objective: string;
    onObjectiveChange: (value: string) => void;
    creating: boolean;
    onCreate: () => Promise<void>;
    onStart: () => Promise<void>;
    onDecide: (decision: "APPROVE" | "REJECT") => Promise<void>;
  };
  /** The composer, rendered by the panel (it owns the request). */
  composer: ReactNode;
  isCrystalOrPeriodic?: boolean;
}


/** The Chat tab: status row, run notices, conversation (starters first, investigation tools below), then the composer. */
export function AIScientistChatTab({ projectId, context, run, approval, conversation, investigation: investigationProps, composer, isCrystalOrPeriodic = false }: AIScientistChatTabProps) {
  const {
    ctx, contextKey, effectiveView, currentSelection, productContext, contextError, aiAvailable, aiSettings, activeModelCapability, conformerContext,
    candidateSelection, showFollowAi, followAiMode, onFollowAiModeChange: setFollowAiMode, onConfigure, onModelSaved, switchedOrigin, onCitationClick, onRetry,
  } = context;
  const {
    activeRun, activeRunId, events, eventLoading, eventError, runReadError, isRunActive, isRunPaused, isRunWaitingCalculation, waitingComputeJob, submitting, progress, elapsed,
    onResume: handleResumeRun, onCancel: handleCancelRun, onRefreshRun: refreshRun, onFetchEvents: fetchEvents,
  } = run;
  const { approvalWaiting, pendingApproval, showApprovalScreen, approvalRequest, onDecide: handleApproval, onDefer: setDeferredApprovalId, reviewButtonRef } = approval;
  const {
    loading, scrollRef, allMessages, messages, history, turnStart, runOrigins, submitOrigin, pendingQuestion, starterPrompts, onStarter, latestClarification,
    clarificationInput, onClarificationInputChange: setClarificationInput, onClarificationSubmit: handleClarificationSubmit, planAwaitingChoice,
    composerRequestMode, composerProfile, onSend: handleSendMessage,
  } = conversation;
  const {
    investigation, objective: investigationObjective, onObjectiveChange: setInvestigationObjective, creating: creatingInvestigation,
    onCreate: handleCreateInvestigation, onStart: handleStartInvestigation, onDecide: handleInvestigationApproval,
  } = investigationProps;
  const investigationTools = investigation ? (
      <details className="ai-investigation-disclosure" open={Boolean(investigation?.pending_approval) || undefined}><summary>Investigation tools{investigation?.pending_approval ? " · approval pending" : ""}</summary>
      <div className="ai-investigation-strip" data-testid="ai-investigation-strip">
        <div className="ai-investigation-heading">
          <strong>Investigation</strong>
          <span className="ai-investigation-summary">
            {investigation
              ? <>{investigation.status} · {(investigation.hypotheses ?? []).length} hypotheses · Steps {Number(investigation.budget?.steps_used ?? 0)}/{investigation.policy.max_steps}</>
              : "No investigation started"}
          </span>
        </div>
        <div className="ai-investigation-create">
          {!investigation ? <input
            aria-label="Investigation objective"
            placeholder="Objective"
            value={investigationObjective}
            onChange={(event) => setInvestigationObjective(event.target.value)}
            disabled={creatingInvestigation || !productContext?.can_write || !aiAvailable}
          /> : null}
          {!investigation ? <ActionButton small intent="primary" text={creatingInvestigation ? "Starting…" : "Start"} onClick={() => void handleCreateInvestigation()} disabled={!investigationObjective.trim() || creatingInvestigation || !productContext?.can_write || !aiAvailable} /> : null}
          {investigation?.pending_approval ? <ApprovalCard variant="inline" approval={investigation.pending_approval} submitting={submitting || !productContext?.can_write} onApprove={() => void handleInvestigationApproval("APPROVE")} onReject={() => void handleInvestigationApproval("REJECT")} /> : null}
          {investigation && ["DRAFT", "PLANNED", "PAUSED"].includes(investigation.status) ? (
            <ActionButton small intent="primary" text="Run" onClick={() => void handleStartInvestigation()} />
          ) : null}
        </div>
      </div>

      {investigation ? (
        <div className="ai-investigation-detail" data-testid="ai-investigation-detail">
          <div className="ai-investigation-objective">
            <span>Objective</span><strong>{investigation.objective}</strong>
          </div>
          {(investigation.hypotheses ?? []).map((hypothesis) => (
            <div className="ai-investigation-detail-row" key={hypothesis.id}>
              <span>Hypothesis</span><strong>{hypothesis.status}: {hypothesis.statement}</strong>
            </div>
          ))}
          {(investigation.plans ?? []).flatMap((plan) => plan.steps ?? []).map((step) => (
            <div className="ai-investigation-detail-row" key={step.id}>
              <span>Step {step.step_number}</span><strong>{step.status} · {step.intent}</strong>
            </div>
          ))}
          {(investigation.observations ?? []).map((observation) => (
            <div className="ai-investigation-detail-row" key={observation.id}>
              <span>Observation</span><strong>{observation.source_class} · {observation.summary}</strong>
            </div>
          ))}
          {(investigation.assessments ?? []).map((assessment) => (
            <div className="ai-investigation-detail-row" key={assessment.id}>
              <span>Assessment</span><strong>{assessment.outcome} · {assessment.rationale}</strong>
            </div>
          ))}
          {investigation.user_input ? (
            <div className="ai-waiting-card" data-testid="ai-investigation-user-input">
              <strong>Investigation needs user input</strong>
              <p>{String(investigation.user_input.question ?? "Provide clarification to continue.")}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      </details>
  ) : null;
  return (
    <div className="ai-chat-container">
      {showApprovalScreen ? null : <AIScientistStatusBar
        productContext={productContext}
        capability={activeModelCapability}
        contextError={contextError ?? null}
        contextTags={<AiContextTags context={ctx} />}
        viewLabel={`${effectiveView}${currentSelection?.locator?.page ? ` · page ${currentSelection.locator.page}` : ""}`}
        candidateContext={candidateSelection} showFollowAi={showFollowAi}
        followAiMode={followAiMode}
        onFollowAiModeChange={setFollowAiMode}
        projectId={projectId}
        onConfigure={onConfigure}
        settingsView={aiSettings}
        activeRunModel={activeRun?.ai_model ?? null}
        runInFlight={isRunActive}
        approvalPending={approvalWaiting}
        onModelSaved={onModelSaved}
        onRetry={onRetry}
        requestKey={contextKey}
      />}

      {!showApprovalScreen && switchedOrigin ? <AiContextSwitchNotice origin={switchedOrigin} current={ctx.label} /> : null}

      {activeRun?.status === "PAUSED" && !activeRun.pending_researcher_gate ? (
        <div className="ai-paused-banner" data-testid="ai-paused-banner">
          <span>Run paused · No further tools dispatched.</span>
          <div style={{ display: "flex", gap: "6px" }}>
            <ActionButton small intent="primary" icon="play" text="Resume" onClick={() => void handleResumeRun()} disabled={submitting} />
            <ActionButton small minimal icon="cross" text="Stop" onClick={() => void handleCancelRun()} />
          </div>
        </div>
      ) : null}

      {conformerContext ? <div role="note" className="ai-limit-notice" data-testid="ai-conformer-context-limit">AI explanations are not available for CREST ensembles or their members yet. The IDs in the context line are navigation hints, not AI-validated evidence. Use the ensemble view and its provenance above.
        <details className="ai-error-details"><summary>Details</summary>The selected CREST result and source input identify this context. Ensemble/member scientific explanations are unavailable in the current AI context model. Member and ensemble IDs in the view label are navigation hints, not AI-validated scientific evidence. Inspect the native ensemble and provenance above.</details></div> : null}

      {/* The approval screen replaces the conversation; an investigation approval still needs to show there. */}
      {showApprovalScreen && investigation?.pending_approval ? investigationTools : null}

      {showApprovalScreen && pendingApproval ? (
        <ApprovalCard key={pendingApproval.id} approval={pendingApproval} submitting={submitting || !productContext?.can_write} request={approvalRequest} proposedUnder={switchedOrigin?.label ?? null}
          onApprove={() => void handleApproval(pendingApproval.id, "APPROVE")}
          onReject={(note) => void handleApproval(pendingApproval.id, "REJECT", note)}
          onBack={() => setDeferredApprovalId(pendingApproval.id)} />
      ) : <>
      {/* Messages & Timeline Area */}
      <div className="ai-conversation-scroll" ref={scrollRef}>
        {/* While a proposal waits, the banner is the one status indicator (no repeated summaries). */}
        {approvalWaiting && !showApprovalScreen ? (
          <div className="ai-approval-pending-banner" data-testid="ai-approval-pending-banner">
            <span><AppIcon icon="hand" /> A proposed calculation is waiting for your decision.</span>
            <button type="button" ref={reviewButtonRef} onClick={() => setDeferredApprovalId(null)}>Review proposal</button>
          </div>
        ) : null}
        {activeRun && !approvalWaiting && (isRunActive || isRunPaused || activeRun.status === "FAILED") ? <ScientificWorkflow run={activeRun} submitting={submitting} onResume={() => void handleResumeRun()} onRefresh={() => { void refreshRun(); void fetchEvents(activeRun.id); }} /> : null}
        {runReadError ? <div role="alert">{plainAiError(runReadError).text}<button type="button" onClick={() => void refreshRun()}>Refresh status</button><AiErrorDetails detail={plainAiError(runReadError).detail} /></div> : null}
        {eventLoading ? <p role="status">Loading activity…</p> : null}
        {eventError ? <div role="alert">{plainAiError(eventError).text}<button type="button" onClick={() => { if (activeRunId) void fetchEvents(activeRunId); }}>Reconnect timeline</button><AiErrorDetails detail={plainAiError(eventError).detail} /></div> : null}
        {activeRun && ((activeRun.steps?.length ?? 0) > 0 || events.length > 0) ? (
          <details className="ai-activity-disclosure" open={!approvalWaiting || undefined}>
            <summary>Activity timeline · {events.length > 0 ? events.length : activeRun.steps?.length ?? 0} {(events.length > 0 ? events.length : activeRun.steps?.length ?? 0) === 1 ? "step" : "steps"}{approvalWaiting ? "" : ` · ${runStatusLabel(activeRun.status)}`}</summary>
            <RunTimeline events={events} steps={activeRun.steps ?? []} status={activeRun.status} />
          </details>
        ) : null}
        {/* A run loaded from the server has no recorded context, so its messages stay in the collapsed history; they are shown here only for a run asked under this context. */}
        {turnStart === undefined && activeRun && runOrigins[activeRun.id]?.key === contextKey && allMessages.some(message => message.run_id === activeRun.id) ? <details open className="ai-conversation-history"><summary>Saved workflow messages</summary>{allMessages.filter(message => message.run_id === activeRun.id).map(message => <MessageBubble key={message.id} message={message} onCitationClick={onCitationClick} isCrystalOrPeriodic={isCrystalOrPeriodic} />)}</details> : null}
        {history.length > 0 ? <details key={contextKey} className="ai-conversation-history" data-testid="ai-history" onToggle={event => {
          const selected = event.currentTarget.open ? latestEvidenceSelection(history) : latestEvidenceSelection(messages);
          window.dispatchEvent(new CustomEvent("chemdft:evidence-message", {detail:selected}));
        }}><summary>Previous conversation · {history.length} {history.length === 1 ? "message" : "messages"}</summary><div className="ai-message-list">{history.map((msg,index) => <MessageBubble key={msg.id} message={msg} onCitationClick={onCitationClick} supersededUnavailable={supersededAnswer(msg,index,history)} isCrystalOrPeriodic={isCrystalOrPeriodic} />)}</div></details> : null}
        {loading ? (
          <div className="ai-empty-state">
            <AppIcon icon="timeline-events" />
            <p>Initializing project-scoped AI Scientist…</p>
          </div>
        ) : messages.length === 0 && !(approvalWaiting || isRunActive || isRunPaused || submitting || pendingQuestion) ? (
          <div className="ai-empty-state ai-empty-state-compact" data-testid="ai-empty-state">
            <span className="ai-visually-hidden">{ctx.emptyTitle}</span>
            <div className="ai-starter-prompts">
              {(conformerContext ? [] : starterPrompts).slice(0, 3).map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  className="starter-prompt-button"
                  data-testid="ai-starter-prompt"
                  onClick={() => onStarter(starter)}
                  disabled={submitting || !aiAvailable}
                >
                  <AppIcon icon="chevron-right" />
                  <span>{starter.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ai-message-list">
            {messages.map((msg, index) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onCitationClick={onCitationClick}
                sourcesInitiallyOpen={index === messages.length - 1}
                supersededUnavailable={supersededAnswer(msg, index, messages)}
                isCrystalOrPeriodic={isCrystalOrPeriodic}
              />
            ))}

            {/* Clarification Card */}
            {latestClarification ? (
              <ClarificationCard
                event={latestClarification}
                submitting={submitting}
                input={clarificationInput}
                setInput={setClarificationInput}
                onSubmit={(text) => void handleClarificationSubmit(text)}
              />
            ) : null}

            {/* Waiting for calculation alert */}
            {isRunWaitingCalculation ? (
              <div className="ai-waiting-card" data-testid="ai-waiting-card">
                <div className="waiting-header" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  {waitingComputeJob ? (
                    <PulseLightIndicator
                      jobState={waitingComputeJob.state}
                      provider={waitingComputeJob.provider}
                      workerStatus={waitingComputeJob.worker_status}
                      createdAt={waitingComputeJob.created_at}
                      startedAt={waitingComputeJob.latest_execution?.started_at}
                      heartbeatAt={waitingComputeJob.latest_execution?.heartbeat_at}
                      heartbeatStatus={(waitingComputeJob as { heartbeat_status?: "FRESH" | "STALE" | "NOT_REPORTED" | "NOT_APPLICABLE" | null })?.heartbeat_status}
                      heartbeatAgeSeconds={(waitingComputeJob as { heartbeat_age_seconds?: number | null })?.heartbeat_age_seconds}
                      heartbeatStaleAfterSeconds={(waitingComputeJob as { heartbeat_stale_after_seconds?: number | null })?.heartbeat_stale_after_seconds}
                      onCancel={handleCancelRun}
                    />
                  ) : null}
                  <StatusTag intent="warning">Execution status above</StatusTag>
                </div>
                <p>
                  The calculation was sent to run. Its status above says whether it is queued, running, done or failed.
                </p>
                <div className="waiting-actions">
                  <ActionButton
                    small
                    icon="refresh"
                    text="Check result & resume"
                    onClick={() => void handleResumeRun()}
                    disabled={submitting || !aiAvailable}
                  />
                  <ActionButton
                    small
                    minimal
                    icon="cross"
                    text="Cancel run"
                    onClick={() => void handleCancelRun()}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
        {/* Starter prompts come first; the investigation tools sit below them. */}
        {investigationTools}
        {/* A run that ended without a valid proposal explains why, in the conversation where the answer would be. */}
        {turnStart !== undefined && activeRun?.status === "FAILED" && activeRun.blocker
          ? <ProposalBlockerNotice blocker={activeRun.blocker} retryDisabled={planAwaitingChoice} onRetry={() => { const question = [...messages].reverse().find(item => item.role === "user")?.content; if (question && !planAwaitingChoice) void handleSendMessage(question, composerRequestMode, composerProfile); }} /> : null}
        {pendingQuestion && (!submitOrigin || submitOrigin.key === contextKey) ? <div className="ai-message-bubble user ai-pending-user-message" data-testid="ai-pending-message">
          <div className="message-header ai-message-header-compact"><span className="message-author">You</span><span className="message-header-dot">·</span><span className="message-time message-time-compact">Sending…</span></div>
          <div className="message-content"><p>{pendingQuestion}</p></div>
        </div> : null}
      </div>

      {progress ? <div className="ai-live-progress" role="status" aria-live="polite" data-testid="ai-working-state"><span className="ai-submit-indicator" aria-hidden="true" /><strong>{progress}</strong><span>{elapsed}s</span></div> : null}
      {turnStart !== undefined && activeRun?.status === "FAILED" && !activeRun.blocker
        ? <div className="ai-error-banner" role="alert">The AI couldn&apos;t answer. {plainAiError(activeRun.error_detail ?? activeRun.error_code ?? "No answer was produced.").text}<AiErrorDetails detail={activeRun.error_code ? `${activeRun.error_code}${activeRun.error_detail ? `: ${activeRun.error_detail}` : ""}` : null} /><button type="button" onClick={() => { const question = [...messages].reverse().find(item => item.role === "user")?.content; if (question && !planAwaitingChoice) void handleSendMessage(question, composerRequestMode, composerProfile); }} disabled={planAwaitingChoice}>Retry question</button></div> : null}

      {composer}
      </>}
    </div>
  );
}
