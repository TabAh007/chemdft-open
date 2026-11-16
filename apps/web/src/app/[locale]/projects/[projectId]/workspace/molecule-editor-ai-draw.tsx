"use client";

import { useEffect, useRef, useState } from "react";

import { AppIcon } from "@chemdft/ui";

import { drawText, DRAFT_LABEL } from "@/lib/molecule-editor/ai-draw";
import type { ChatEntry, UseAiDraw } from "./use-ai-draw";
import styles from "./molecule-editor.module.css";

function StepList({ entry, ai }: { entry: Extract<ChatEntry, { kind: "assistant" }>; ai: UseAiDraw }) {
  const { response } = entry;
  const steps = response.steps ?? [];
  if (steps.length === 0) return null;
  return (
    <ol className={styles.drawSteps} aria-label="Steps" data-testid="ai-draw-steps">
      {steps.map((step, index) => {
        const applied = step.ok && index < entry.shown && ai.appliedKeys.has(`${entry.id}:${index}`);
        const pending = step.ok && index >= entry.shown;
        const undone = step.ok && !applied && !pending;
        return (
          <li key={step.index} className={step.ok ? undefined : styles.drawStepFailed} data-testid="ai-draw-step" data-state={!step.ok ? "failed" : applied ? "applied" : undone ? "undone" : "pending"}>
            <span className={styles.drawStepMark} aria-hidden="true">
              {!step.ok ? <AppIcon icon="cross" /> : applied ? <AppIcon icon="tick" /> : undone ? <AppIcon icon="undo" /> : <AppIcon icon="dot" />}
            </span>
            <span>
              <span className={styles.srOnly}>{!step.ok ? "Failed: " : applied ? "Applied: " : undone ? "Undone: " : "Waiting: "}</span>
              {step.description}
              {step.ok && step.formula ? <span className={styles.drawStepFormula}> · {step.formula}</span> : null}
              {!step.ok && !(response.reply ?? "").includes(step.error ?? "\u0000") ? <span className={styles.drawStepError}> {step.error}{step.suggestion ? ` ${step.suggestion}` : ""}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function AssistantBubble({ entry, ai, latest }: { entry: Extract<ChatEntry, { kind: "assistant" }>; ai: UseAiDraw; latest: boolean }) {
  const { response } = entry;
  const proposals = response.proposals ?? [];
  const tone = response.status === "OK" ? "ok" : response.status === "CLARIFY" ? "info" : "warn";
  return (
    <div className={styles.drawBubble} data-testid="ai-draw-message-assistant" data-status={response.status} data-tone={tone}>
      <div className={styles.drawBubbleHead}>
        <span className={styles.draftChip} data-testid="ai-draw-label">{DRAFT_LABEL}</span>
        <span className={styles.drawStatus}>{response.status === "OK" ? "Done" : response.status === "PARTIAL" ? "Stopped early" : response.status === "NEEDS_ATTENTION" ? "Needs attention" : response.status === "CLARIFY" ? "Question" : response.status === "REFUSED" ? "Not a drawing request" : response.status === "NO_CHANGE" ? "Nothing to draw" : "Not applied"}</span>
      </div>
      <p className={styles.drawReply}>{response.reply}</p>
      <StepList entry={entry} ai={ai} />
      {proposals.map((proposal) => (
        <p key={proposal.label + proposal.smiles} className={styles.drawProposal} role="note" data-testid="ai-draw-proposal"><AppIcon icon="info-sign" /><span>{proposal.note}</span></p>
      ))}
      {(response.info ?? []).map((line) => (
        <p key={line} className={styles.drawNote} role="note" data-testid="ai-draw-info"><AppIcon icon="info-sign" /><span>{line}</span></p>
      ))}
      {(response.warnings ?? []).filter((w) => !proposals.some((p) => p.note === w)).map((warning) => (
        <p key={warning} className={styles.drawWarning} role="note"><AppIcon icon="info-sign" /><span>{warning}</span></p>
      ))}
      {response.clarify ? (
        <div className={styles.drawClarify} role="group" aria-label={response.clarify.question}>
          <div className={styles.drawClarifyQuestion}>{response.clarify.question}</div>
          <div className={styles.drawOptions}>
            {response.clarify.options.map((option) => (
              <button key={option.label} type="button" className={styles.chip} disabled={!latest || ai.busy !== "idle"} onClick={() => void ai.send(option.message)} data-testid="ai-draw-clarify-option">
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {response.model ? (
        <div className={styles.drawUsage} data-testid="ai-draw-usage" title="Model and tokens used by this reply">
          {response.model} · {response.input_tokens ?? 0} in · {response.output_tokens ?? 0} out{response.repaired ? " · 1 repair retry" : ""}
        </div>
      ) : null}
    </div>
  );
}

export function AiDrawPanel({ ai, ready }: { ai: UseAiDraw; ready: boolean }) {
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const unavailable = ai.availability === "unavailable";
  const disabled = !ready || ai.busy !== "idle" || unavailable;

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [ai.entries, ai.busy]);

  function submit() {
    const value = text.trim();
    if (!value || disabled) return;
    setText("");
    void ai.send(value);
  }

  const latestAssistant = [...ai.entries].reverse().find((entry) => entry.kind === "assistant")?.id;
  return (
    <div className={styles.drawPanel} data-testid="editor-ai-chat">
      {unavailable ? (
        <p className={styles.drawUnavailable} role="status" data-testid="ai-draw-unavailable">
          <AppIcon icon="warning-sign" /> {drawText.unavailable}
        </p>
      ) : null}
      <div className={styles.drawLog} ref={logRef} role="log" aria-live="polite" aria-relevant="additions text" aria-label="Drawing assistant conversation" tabIndex={0} data-testid="ai-draw-log">
        {ai.entries.length === 0 ? (
          <div className={styles.drawEmpty}>
            <strong>{drawText.title}</strong>
            <p>{drawText.intro}</p>
            <div className={styles.drawOptions} role="group" aria-label="Examples">
              {drawText.examples.map((example) => (
                <button key={example} type="button" className={styles.chip} disabled={disabled} onClick={() => void ai.send(example)} data-testid="ai-draw-example">{example}</button>
              ))}
            </div>
          </div>
        ) : null}
        {ai.entries.map((entry) => {
          if (entry.kind === "user") return <div key={entry.id} className={styles.drawUser} data-testid="ai-draw-message-user">{entry.text}</div>;
          if (entry.kind === "pending") return <div key={entry.id} className={styles.drawPending} role="status" data-testid="ai-draw-working"><AppIcon icon="refresh" /> {drawText.working}</div>;
          if (entry.kind === "notice") return <p key={entry.id} className={entry.tone === "error" ? styles.drawError : styles.drawNote} role={entry.tone === "error" ? "alert" : "status"} data-testid="ai-draw-notice">{entry.text}</p>;
          return <AssistantBubble key={entry.id} entry={entry} ai={ai} latest={entry.id === latestAssistant} />;
        })}
      </div>
      <form className={styles.drawComposer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label className={styles.srOnly} htmlFor="ai-draw-input">{drawText.inputLabel}</label>
        <textarea
          id="ai-draw-input"
          className={styles.drawInput}
          rows={2}
          maxLength={1000}
          value={text}
          placeholder={drawText.placeholder}
          disabled={!ready || unavailable}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}
          data-testid="ai-draw-input"
        />
        <button type="submit" className={styles.drawSend} disabled={disabled || !text.trim()} data-testid="ai-draw-send">
          {ai.busy === "working" ? drawText.working : ai.busy === "applying" ? drawText.applying : drawText.send}
        </button>
      </form>
      <p className={styles.drawFootnote}>{drawText.schematic} {drawText.languageNote}</p>
    </div>
  );
}

export function AiDraftBanner({ ai }: { ai: UseAiDraw }) {
  const idle = ai.busy === "idle";
  const partialView = ai.view?.scope === "main" && !ai.view.allFitReadably;
  const fitButton = (
    <button type="button" className={styles.draftButton} disabled={!idle} onClick={() => void ai.fit(partialView ? "all" : "auto")} data-testid={ai.draft ? "ai-draft-fit" : "editor-fit"} title={partialView ? drawText.fitAllTitle : drawText.fitTitle}>
      {partialView ? drawText.fitAll : drawText.fit}
    </button>
  );
  if (!ai.draft) {
    return (
      <div className={styles.fitOnly} role="group" aria-label="View" data-testid="editor-fit-group">
        {fitButton}
      </div>
    );
  }
  return (
    <div className={styles.draftBanner} role="group" aria-label={DRAFT_LABEL} data-testid="ai-draft-banner">
      <span className={styles.draftChip}>{DRAFT_LABEL}</span>
      <button type="button" className={styles.draftButton} disabled={!idle} onClick={ai.keep} data-testid="ai-draft-keep">{drawText.keep}</button>
      <button type="button" className={styles.draftButton} disabled={!idle || ai.draft.trail.pos <= 0} onClick={() => void ai.undoLast()} data-testid="ai-draft-undo-last">{drawText.undoLast}</button>
      <button type="button" className={styles.draftButton} disabled={!idle} onClick={() => void ai.undoEverything()} data-testid="ai-draft-undo-all">{drawText.undoAll}</button>
      {fitButton}
      {partialView ? <span className={styles.draftEdited} role="status" data-testid="ai-draft-partial-view">{drawText.partialView}</span> : null}
      {ai.draft.edited ? <span className={styles.draftEdited} title={drawText.edited} data-testid="ai-draft-edited">edited since</span> : null}
    </div>
  );
}
