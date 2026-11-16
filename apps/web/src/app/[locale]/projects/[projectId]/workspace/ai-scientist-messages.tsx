"use client";
import type { ReactNode } from "react";
import { formatShortTime, timestampDisplay } from "@/lib/timestamps";
import { SCIENTIFIC_EVENT_LABELS } from "@/lib/ai-scientist-workflow";
import { useLocale } from "next-intl";
import type { AICitation, AIMessageView, AIRunStepView, AIRunEventView } from "@chemdft/schemas";
import { ActionButton, AppIcon, StatusTag } from "@chemdft/ui";
import { CHAT_GROUNDED_NOTE, CHAT_REPLY_NOTE } from "@/lib/ai-chat-reply";
import { navigatorMessage } from "@/lib/navigator-messages";
import { answerSections } from "@/lib/workstation-ux";
import { runStatusLabel } from "@/lib/scientific-labels";

type TypedAiAction = {
  id: string;
  label: string;
  actionType: "OPEN_STRUCTURE" | "OPEN_ELECTRONIC_STRUCTURE" | "OPEN_ELECTRON_DENSITY" | "OPEN_ESP" | "PREPARE_GEOMETRY_OPTIMIZATION";
  intent?: "primary" | "none";
  requiresConfirmation?: boolean;
};

function detectTypedActions(content: string, isCrystalOrPeriodic: boolean = false): TypedAiAction[] {
  const actions: TypedAiAction[] = [];
  const lower = content.toLowerCase();
  // A failure explanation never offers result viewers: nothing was computed to view.
  if (/\b(?:failed|failure|errored|error code|did not (?:finish|complete))\b/.test(lower)) return actions;

  if (lower.includes("density") || lower.includes("ρ =") || lower.includes("view electron density")) {
    actions.push({
      id: "action-density",
      label: "View Electron Density",
      actionType: "OPEN_ELECTRON_DENSITY",
      intent: "primary",
    });
  }

  if (lower.includes("electrostatic potential") || /\besp\b/.test(lower)) {
    actions.push({
      id: "action-esp",
      label: "View ESP",
      actionType: "OPEN_ESP",
    });
  }

  if (!isCrystalOrPeriodic && (lower.includes("electronic structure") || lower.includes("molecular orbital") || lower.includes("hf / sto-3g"))) {
    actions.push({
      id: "action-electronic",
      label: "Open Electronic Structure",
      actionType: "OPEN_ELECTRONIC_STRUCTURE",
      intent: actions.length === 0 ? "primary" : "none",
    });
  }

  if (!isCrystalOrPeriodic && (lower.includes("geometry optimization") || lower.includes("optimize geometry"))) {
    actions.push({
      id: "action-opt",
      label: "Prepare Geometry Optimization",
      actionType: "PREPARE_GEOMETRY_OPTIMIZATION",
      requiresConfirmation: true,
    });
  }

  if (lower.includes("water v1") || lower.includes("structureversion") || lower.includes("open structure")) {
    actions.push({
      id: "action-struct",
      label: "Open Structure",
      actionType: "OPEN_STRUCTURE",
    });
  }

  return actions;
}

export function MessageBubble({
  message,
  onCitationClick,
  supersededUnavailable = false,
  sourcesInitiallyOpen = false,
  isCrystalOrPeriodic = false,
}: {
  message: AIMessageView;
  onCitationClick?: ((citation: AICitation) => void) | undefined;
  supersededUnavailable?: boolean;
  sourcesInitiallyOpen?: boolean;
  isCrystalOrPeriodic?: boolean;
}) {
  const locale = useLocale();
  const isUser = message.role === "user";
  const navigatorAnswer = message.citations?.some(citation => citation.source_record_type === "navigator");
  const displayContent = navigatorAnswer ? message.content.replace(/(?<=: |, )\b[a-z]+(?:_[a-z]+)+\b/g, key => navigatorMessage(locale as "en", `reason.${key}`)).replace(/\b(?:[a-z][a-z_]*\.)+[a-z][a-z_]*\b/g, key => navigatorMessage(locale as "en", key.startsWith("notice.") ? key : `action.${key}.title`)) : message.content;
  const citations = message.citations ?? [];
  const hasCitations = citations.length > 0;

  return (
    <div
      className={`ai-message-bubble ${isUser ? "user" : "assistant"}${supersededUnavailable ? " ai-message-superseded" : ""}`}
      data-testid={`ai-message-${message.role.toLowerCase()}`}
    >
      {supersededUnavailable ? <details className="ai-superseded-details"><summary>Previous answer unavailable</summary><div className="ai-superseded-content">{message.content}</div>{hasCitations ? <div className="ai-citations-list"><span className="citations-label">Sources:</span>{citations.map((cite, idx) => <button key={`${cite.entity_id}-${idx}`} type="button" className="citation-chip" onClick={() => onCitationClick?.(cite)} title={`${cite.citation_type}: ${cite.label}`}>[{cite.citation_id}] {cite.label}</button>)}</div> : null}</details> : <>
      <div className="message-header ai-message-header-compact">
        <span className="message-author">
          {isUser ? "You" : "AI Scientist"}
        </span>
        <span className="message-header-dot">·</span>
        <span
          className="message-time message-time-compact"
          tabIndex={0}
          role="note"
          aria-label={`Sent at ${timestampDisplay(message.created_at)?.local ?? ""} (${timestampDisplay(message.created_at)?.zone ?? ""}) · UTC: ${timestampDisplay(message.created_at)?.utc ?? ""}`}
          title={`${timestampDisplay(message.created_at)?.local ?? ""} (${timestampDisplay(message.created_at)?.zone ?? ""}) · UTC: ${timestampDisplay(message.created_at)?.utc ?? ""}`}
        >
          {formatShortTime(message.created_at)}
        </span>
      </div>

      <div className="message-content">
        {answerSections(displayContent).map((section, index) => {
          const citationMap = new Map((message.citations ?? []).filter((item) => item.citation_id).map((item) => [item.citation_id!, item]));
          const technical = !isUser && /\b[a-f0-9]{64}\b|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i.test(section.content);
          return (
            <section key={index} className="ai-answer-section">
              {section.heading ? <h3>{renderInlineMarkdown(section.heading, citationMap, message.evidence, onCitationClick)}</h3> : null}
              {section.content ? (
                technical ? (
                  <details className="ai-answer-provenance">
                    <summary>Calculation provenance</summary>
                    <p>{renderInlineMarkdown(section.content, citationMap, message.evidence, onCitationClick)}</p>
                  </details>
                ) : (
                  renderSafeMarkdownBlocks(section.content, citationMap, message.evidence, onCitationClick)
                )
              ) : null}
            </section>
          );
        })}
      </div>

      {!isUser && detectTypedActions(message.content, isCrystalOrPeriodic).length > 0 ? (
        <div className="ai-typed-actions-bar" data-testid="ai-typed-actions-bar">
          <span className="actions-bar-label">Suggested actions:</span>
          <div className="actions-bar-buttons">
            {detectTypedActions(message.content, isCrystalOrPeriodic).map((action) => (
              <button
                key={action.id}
                type="button"
                className={`ai-typed-action-btn ${action.intent === "primary" ? "primary" : ""}`}
                data-testid={`ai-action-${action.actionType.toLowerCase()}`}
                onClick={() => {
                  if (action.actionType === "OPEN_STRUCTURE") {
                    window.dispatchEvent(new CustomEvent("chemdft:guided-navigate", { detail: { view: "structure" } }));
                  } else if (action.actionType === "OPEN_ELECTRONIC_STRUCTURE") {
                    window.dispatchEvent(new CustomEvent("chemdft:guided-navigate", { detail: { view: "result", tab: "MO" } }));
                  } else if (action.actionType === "OPEN_ELECTRON_DENSITY") {
                    window.dispatchEvent(new CustomEvent("chemdft:guided-navigate", { detail: { view: "result", tab: "Density" } }));
                  } else if (action.actionType === "OPEN_ESP") {
                    window.dispatchEvent(new CustomEvent("chemdft:guided-navigate", { detail: { view: "result", tab: "ESP" } }));
                  } else if (action.actionType === "PREPARE_GEOMETRY_OPTIMIZATION") {
                    window.dispatchEvent(new CustomEvent("chemdft:guided-navigate", { detail: { view: "setup", calculationType: "optimization" } }));
                  }
                }}
              >
                <AppIcon icon={action.actionType === "PREPARE_GEOMETRY_OPTIMIZATION" ? "refresh" : action.actionType === "OPEN_ELECTRON_DENSITY" ? "cube" : action.actionType === "OPEN_ESP" ? "heatmap" : "arrow-right"} />
                <span>{action.label}</span>
                {action.requiresConfirmation ? <span className="confirmation-badge" title="Requires explicit parameter review">review</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="message-meta-footer">
        {hasCitations ? (
          <details className="ai-sources-disclosure" open={sourcesInitiallyOpen} data-testid="ai-sources">
            <summary>Sources · {citations.length}</summary>
            <div className="ai-citations-list" data-testid="ai-citations-list">
              {citations.map((cite, idx) => (
                <button
                  key={`${cite.entity_id}-${idx}`}
                  type="button"
                  className="citation-chip"
                  data-testid="citation-chip"
                  onClick={() => onCitationClick?.(cite)}
                  title={`${cite.citation_type}: ${cite.label}`}
                >
                  <AppIcon
                    icon={
                      cite.citation_type === "DOCUMENT"
                        ? "document"
                        : cite.citation_type === "CALCULATION"
                        ? "application"
                        : "cube"
                    }
                  />
                  <span className="citation-chip-label"><b>{cite.citation_id ? `[${cite.citation_id}] ` : ""}</b>{cite.label}</span>
                </button>
              ))}
            </div>
          </details>
        ) : null}

        {!message.evidence_status && message.evidence_note === CHAT_REPLY_NOTE ? (
          <span className="ai-message-evidence-status ai-message-chat-reply" title={CHAT_REPLY_NOTE} data-testid="ai-chat-reply-label">
            AI reply · not project evidence
          </span>
        ) : null}
        {!message.evidence_status && message.evidence_note === CHAT_GROUNDED_NOTE ? (
          <span className="ai-message-evidence-status ai-message-chat-reply" title={CHAT_GROUNDED_NOTE} data-testid="ai-chat-grounded-label">
            AI reply · quotes stored project records
          </span>
        ) : null}
        {message.evidence_status ? (
          <span className={`ai-message-evidence-status evidence-status-${message.evidence_status.toLowerCase().replaceAll("_", "-")}`} title={`Evidence status: ${message.evidence_status}`}>
            {message.evidence_status.replaceAll("_", " ")}
          </span>
        ) : null}
      </div>
      </>}
    </div>
  );
}

function renderInlineMarkdown(
  text: string,
  citations?: Map<string, AICitation>,
  evidence?: AIMessageView["evidence"],
  onCitationClick?: (citation: AICitation) => void,
): ReactNode {
  const tokenRegex = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*\s][^*]*?\*|\[\[(?:E|P)\d+\]\]|\[(?:E|P)\d+\])/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, index) => {
    if (!part) return null;

    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("***") && part.endsWith("***") && part.length >= 6) {
      return (
        <strong key={index}>
          <em>{part.slice(3, -3)}</em>
        </strong>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }

    const citeMatch = /^\[{1,2}((?:E|P)\d+)\]{1,2}$/.exec(part);
    if (citeMatch) {
      const id = citeMatch[1]!;
      const citation = citations?.get(id);
      if (citation && (id.startsWith("P") || evidence?.some((item) => item.citation_id === id))) {
        return (
          <button
            key={index}
            type="button"
            className="inline-evidence-citation"
            onClick={() => onCitationClick?.(citation)}
            data-testid="inline-evidence-citation"
            aria-label={`Open ${id.startsWith("P") ? "project record" : "evidence"} ${id}`}
          >
            [{id}]
          </button>
        );
      }
    }

    return part;
  });
}

function renderSafeMarkdownBlocks(
  content: string,
  citations?: Map<string, AICitation>,
  evidence?: AIMessageView["evidence"],
  onCitationClick?: (citation: AICitation) => void,
): ReactNode {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let currentList: string[] = [];

  const flushList = () => {
    if (currentList.length > 0) {
      const items = [...currentList];
      currentList = [];
      blocks.push(
        <ul key={`ul-${blocks.length}`} style={{ margin: "4px 0", paddingLeft: "1.25rem" }}>
          {items.map((item, i) => (
            <li key={i}>{renderInlineMarkdown(item, citations, evidence, onCitationClick)}</li>
          ))}
        </ul>,
      );
    }
  };

  for (const line of lines) {
    const bulletMatch = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bulletMatch) {
      currentList.push(bulletMatch[1]!);
    } else if (line.trim()) {
      flushList();
      blocks.push(
        <p key={`p-${blocks.length}`} style={{ margin: "4px 0" }}>
          {renderInlineMarkdown(line, citations, evidence, onCitationClick)}
        </p>,
      );
    }
  }
  flushList();

  return blocks.length > 0 ? blocks : null;
}

export function RunTimeline({
  events,
  steps,
  status,
}: {
  events?: AIRunEventView[];
  steps: AIRunStepView[];
  status: string;
}) {
  const hasEvents = (events?.length ?? 0) > 0;
  return (
    <div className="ai-run-timeline" data-testid="ai-run-timeline">
      <div className="timeline-header">
        <span className="timeline-title">Activity Timeline</span>
        <StatusTag
          intent={
            status === "SUCCEEDED"
              ? "success"
              : status === "FAILED"
              ? "danger"
              : status === "PAUSED"
              ? "warning"
              : "none"
          }
        >
          {runStatusLabel(status)}
        </StatusTag>
      </div>
      {hasEvents ? (
        <ol className="timeline-step-list">
          {events!.map((event) => (
            <li key={`${event.sequence}-${event.event_type}`} className="timeline-step">
              <span className="step-icon">
                <AppIcon
                  icon={
                    event.event_type === "object.created" ||
                    event.event_type === "identity.resolved" ||
                    event.event_type === "run.completed"
                      ? "tick"
                      : event.event_type === "clarification.requested"
                      ? "help"
                      : "timeline-events"
                  }
                />
              </span>
              <div className="step-body">
                <span className="step-summary">
                  {event.event_type === "identity.resolved" || event.event_type === "object.created" ? "✓ " : ""}
                  {SCIENTIFIC_EVENT_LABELS[event.event_type] ? <strong>{SCIENTIFIC_EVENT_LABELS[event.event_type]}: </strong> : null}{event.summary}
                </span>
                {event.payload?.name ? (
                  <code className="step-tool-name">{String(event.payload.name)}</code>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="timeline-step-list">
          {steps.map((step) => (
            <li key={step.id} className="timeline-step">
              <span className="step-icon">
                <AppIcon
                  icon={
                    step.step_type === "TOOL_CALL"
                      ? "wrench"
                      : step.step_type === "APPROVAL_REQUESTED"
                      ? "shield"
                      : step.step_type === "FINAL_SYNTHESIS"
                      ? "tick"
                      : "small-tick"
                  }
                />
              </span>
              <div className="step-body">
                <span className="step-summary">{step.summary ?? step.step_type}</span>
                {step.tool_name ? (
                  <code className="step-tool-name">{step.tool_name}</code>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ClarificationCard({
  event,
  submitting,
  input,
  setInput,
  onSubmit,
}: {
  event: AIRunEventView;
  submitting: boolean;
  input: string;
  setInput: (v: string) => void;
  onSubmit: (text: string) => void;
}) {
  const alternatives = (event.payload?.alternatives as Array<{ name?: string; description?: string }>) || [];
  return (
    <div className="ai-clarification-card" data-testid="ai-clarification-card">
      <h4>
        <AppIcon icon="help" />
        <span>Clarification Required</span>
      </h4>
      <p>{SCIENTIFIC_EVENT_LABELS[event.event_type] ? <strong>{SCIENTIFIC_EVENT_LABELS[event.event_type]}: </strong> : null}{event.summary}</p>
      {alternatives.length > 0 ? (
        <div className="ai-clarification-options">
          {alternatives.map((alt) => (
            <button
              key={alt.name}
              type="button"
              className="ai-clarification-option-btn"
              onClick={() => onSubmit(`Create ${alt.name || ""}.`)}
              disabled={submitting}
            >
              {alt.name}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
        <input
          type="text"
          value={input}
          placeholder="Provide clarification or specify compound…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(input);
            }
          }}
          disabled={submitting}
          style={{ flex: 1, padding: "4px 8px", fontSize: "12px", border: "1px solid var(--cdf-line)", borderRadius: "var(--cdf-radius-sm, 4px)" }}
        />
        <ActionButton
          small
          intent="primary"
          text="Submit"
          onClick={() => onSubmit(input)}
          disabled={submitting || !input.trim()}
        />
      </div>
    </div>
  );
}
