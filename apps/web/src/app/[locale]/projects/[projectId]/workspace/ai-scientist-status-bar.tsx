"use client";

import { compactContextLabel } from "@/lib/context-label";
import { useEffect, useState, type ReactNode } from "react";
import type { AIModelCapability, AISettingsView, ProductContext } from "@chemdft/schemas";
import { AppIcon } from "@chemdft/ui";
import { AIScientistModelSwitcher } from "./ai-scientist-model-switcher";
import { AiErrorDetails } from "./ai-scientist-error-details";
import { aiErrorLabel, aiModeLabel, modelDisplayName, modelStatusLabel, providerLabel } from "@/lib/scientific-labels";

/**
 * One status indicator for the Chat tab: model availability, the AI context, follow mode and,
 * on demand, the model's registry evidence. Replaces the former model card, context header,
 * provider line and authority note (which repeated the same facts).
 */
export function AIScientistStatusBar({
  productContext, capability, contextError, viewLabel, contextTags, candidateContext, showFollowAi, followAiMode, onFollowAiModeChange, projectId, onConfigure,
  settingsView, activeRunModel, runInFlight, approvalPending, onModelSaved, onRetry, requestKey,
}: {
  productContext: ProductContext | null;
  capability: AIModelCapability | null;
  contextError: string | null;
  viewLabel: string;
  /** Read-only / "named, not grounded" line for the current page context; renders nothing when the context is grounded. */
  contextTags?: ReactNode;
  candidateContext: boolean;
  /** Follow AI opens what the AI Scientist creates in the Workspace, so it is offered only there (elsewhere Details explains why). */
  showFollowAi: boolean;
  followAiMode: boolean;
  onFollowAiModeChange: (follow: boolean) => void;
  projectId: string;
  onConfigure: () => void;
  /** The same server settings view the Settings tab edits; the quick switcher saves through it. */
  settingsView: AISettingsView | null;
  activeRunModel: string | null;
  runInFlight: boolean;
  approvalPending: boolean;
  onModelSaved: (selection: { provider: string; model: string }) => void;
  onRetry?: (() => void) | undefined;
  requestKey?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slowChecking, setSlowChecking] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const currentKey = requestKey ?? viewLabel;
  const [prevKey, setPrevKey] = useState(currentKey);
  const [prevHasAi, setPrevHasAi] = useState(Boolean(productContext?.ai));

  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setSlowChecking(false);
    setTimedOut(false);
  }
  if (Boolean(productContext?.ai) !== prevHasAi) {
    setPrevHasAi(Boolean(productContext?.ai));
    if (productContext?.ai) {
      setSlowChecking(false);
      setTimedOut(false);
    }
  }

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (productContext?.ai || contextError) return;
    const slowTimer = window.setTimeout(() => setSlowChecking(true), 4000);
    const timeoutTimer = window.setTimeout(() => setTimedOut(true), 15000);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
    };
  }, [productContext?.ai, contextError, currentKey]);

  const ai = productContext?.ai ?? null;
  const available = Boolean(ai?.available);
  const modelUnavailable = !ai && (Boolean(contextError) || timedOut);
  const tone = modelUnavailable ? "unavailable" : !ai ? "checking" : available ? "available" : "unavailable";
  const modelName = modelUnavailable
    ? "Model unavailable"
    : capability
      ? modelDisplayName(capability.display_name, capability.provider)
      : ai?.model ?? "Resolving model…";
  const status = modelUnavailable
    ? "Unavailable"
    : !ai
      ? (slowChecking ? "Still checking…" : "Checking availability…")
      : !available
        ? "Unavailable"
        : ai.local_test_only
          ? "Offline, no external model calls"
          : capability?.eligibility === "DEVELOPMENT"
            ? "Development use only"
            : capability
              ? modelStatusLabel(capability.status)
              : "Available";

  const showStatusInRow = tone !== "available";
  return (
    <section className="ai-status-bar" data-testid="ai-model-provider-card" aria-label="AI Scientist status">
      {/* One calm row: model, the page the AI is looking at, and a Details disclosure. */}
      <div className="ai-status-row" data-testid="ai-provider-state">
        <span className="ai-status-model">
          <AIScientistModelSwitcher settingsView={settingsView} currentLabel={modelName} tone={tone}
            activeRunModel={activeRunModel} runInFlight={runInFlight} approvalPending={approvalPending}
            onModelSaved={onModelSaved} />
        </span>
        {showStatusInRow ? <span className="ai-status-meta ai-status-meta-row" data-testid="ai-status-meta">{status}</span> : null}
        <span className="ai-status-context" data-testid="ai-current-context-header">
          <span className="ai-visually-hidden">Context: </span>
          <span className="ai-status-context-path" data-testid="ai-current-view" title={viewLabel}>{compactContextLabel(viewLabel)}</span>
        </span>
        {modelUnavailable && onRetry ? (
          <button type="button" className="ai-status-retry-button" onClick={() => { setSlowChecking(false); setTimedOut(false); onRetry(); }} data-testid="ai-status-retry">
            Retry
          </button>
        ) : null}
        <button type="button" className="ai-status-details-toggle" aria-expanded={open} aria-controls="ai-status-details"
          onClick={() => setOpen((value) => !value)} data-testid="ai-status-details-toggle">
          Details <AppIcon icon={open ? "chevron-up" : "chevron-down"} />
        </button>
      </div>
      {ai && !available ? (
        <div className="ai-status-alert" role="alert">
          {aiErrorLabel(ai.error_code)}. Structures, Navigator, calculations, examples and Learn remain usable.
          <AiErrorDetails detail={ai.error_code ?? "AI_UNAVAILABLE"} />
        </div>
      ) : null}
      {productContext && !productContext.can_write ? (
        <p className="ai-status-note" data-testid="ai-read-only-state">Read-only project: you can ask questions, but planning a calculation needs edit access.</p>
      ) : null}
      {contextTags}
      {candidateContext ? <p className="ai-status-note">Unreviewed draft structure: it is not a saved, authoritative structure.</p> : null}
      {contextError ? <div className="ai-status-alert" role="alert">Couldn&apos;t load this page&apos;s context. Questions about a specific result are turned off.<AiErrorDetails detail={contextError} /></div> : null}
      {!productContext && !contextError ? <p className="ai-status-note" role="status">Loading context…</p> : null}

      {open ? (
        <div id="ai-status-details" className="ai-status-details" data-testid="ai-model-capability">
          <dl className="ai-status-dl">
            <div><dt>Provider</dt><dd>{ai ? providerLabel(ai.provider) : "—"} · {status}</dd></div>
            <div><dt>Mode</dt><dd>{ai ? aiModeLabel(ai.mode) : "—"}</dd></div>
            <div><dt>Model identifier</dt><dd><code>{ai?.model ?? "—"}</code></dd></div>
            {capability ? <>
              <div><dt>Context</dt><dd>{capability.published_context}</dd></div>
              <div><dt>Tool calling</dt><dd>{capability.tool_compatibility_verified ? "Verified (limited scope)" : capability.eligibility === "DEVELOPMENT" ? "Not verified; development evidence only" : "Not verified"}</dd></div>
              <div><dt>Verification scope</dt><dd>{capability.verification_scope}</dd></div>
              {capability.limitations?.[0] ? <div><dt>Limitation</dt><dd>{capability.limitations[0]}</dd></div> : null}
            </> : ai?.local_test_only ? <div><dt>Note</dt><dd>Offline fixture · no external model calls</dd></div> : null}
          </dl>
          {showFollowAi ? <div className="ai-follow-row" data-testid="ai-follow-row">
            <span id="ai-follow-label">When the AI creates a structure</span>
            <div className="ai-view-mode-toggle" role="group" aria-labelledby="ai-follow-label" data-testid="ai-view-mode-toggle">
              <button type="button" className={`ai-toggle-btn ${followAiMode ? "active" : ""}`} aria-pressed={followAiMode}
                onClick={() => onFollowAiModeChange(true)} title="Follow AI: open structures the AI Scientist creates">Follow AI</button>
              <button type="button" className={`ai-toggle-btn ${!followAiMode ? "active" : ""}`} aria-pressed={!followAiMode}
                onClick={() => onFollowAiModeChange(false)} title="Stay here: keep the current view while the AI Scientist works">Stay here</button>
            </div>
          </div> : <p className="ai-status-note ai-follow-why" data-testid="ai-follow-unavailable">
            Follow AI works in the Workspace only. On this page the panel never moves you away from what you are reading.
          </p>}
          <div className="ai-status-actions">
            <button type="button" className="ai-status-link" onClick={onConfigure}>Change model in Settings</button>
            <button type="button" className="ai-status-link" onClick={() => { void navigator.clipboard?.writeText(projectId).then(() => setCopied(true)).catch(() => {}); }}>
              <AppIcon icon="duplicate" /> Copy project ID
            </button>
            <span role="status" className="ai-status-copied">{copied ? "Project ID copied" : ""}</span>
          </div>
          <p className="ai-status-firewall"><AppIcon icon="shield" /> AI explanations are separate from scientific results; every number comes from a persisted engine record.</p>
        </div>
      ) : null}
    </section>
  );
}
