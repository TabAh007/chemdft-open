"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AIModelCapability, AIModelPerformanceView, AISettingsView, ModelPerformanceRow } from "@chemdft/schemas";
import { AppIcon, AppPopover, PopupKind } from "@chemdft/ui";
import { getAiModelPerformance, saveAiSettings } from "@/lib/ai-scientist-api";
import { aiErrorLabel, modelDisplayName, providerLabel } from "@/lib/scientific-labels";
import { AiErrorDetails } from "./ai-scientist-error-details";
import { modelChoices, type ModelChoice } from "@/lib/ai-model-choices";
import { useLocalDevelopment } from "../../../../_components/local-development-context";

const PROFILE_LABEL: Record<string, string> = {
  EVIDENCE: "Ask",
  GENERAL: "Plan (general)",
  PYSCF_ENERGY_PROPOSAL: "Plan (PySCF energy)",
  STRUCTURE_EDIT_PROPOSAL: "Structure edit proposal",
  PERIODIC_ENERGY_PROPOSAL: "Plan (periodic energy)",
};

/** Request types the server's registry evidence allows this row to serve. */
export function requestTypesLabel(choice: ModelChoice): string {
  if (choice.localTestOnly) return "All request types (offline fixture)";
  const profiles = choice.capability?.planning_profiles ?? [];
  return profiles.length ? profiles.map((profile) => PROFILE_LABEL[profile] ?? profile).join(", ") : "None";
}

/** Registry, configuration, eligibility and hosted verification are different facts. */
export function evidenceLines(choice: ModelChoice): Array<[string, string]> {
  const capability: AIModelCapability | null = choice.capability;
  if (!capability) {
    return choice.localTestOnly
      ? [["Registry", "Offline fixture; deterministic test responses"], ["Hosted verification", "Not applicable: no hosted endpoint"]]
      : [["Registry", "No registry evidence for this model"]];
  }
  const development = capability.eligibility === "DEVELOPMENT";
  return [
    ["Registry", `Listed, reviewed ${capability.reviewed_on}`],
    ["This server", capability.configured ? "Configured" : "Not configured"],
    ["Selection", choice.selectable ? (development ? "Eligible for development use only" : "Eligible") : "Not eligible"],
    ["Hosted verification", capability.tool_compatibility_verified ? `Tool calling verified: ${capability.verification_scope}` : "Not verified"],
    ["Proposal workflow", capability.proposal_workflow_verified ? "Verified" : "Not verified at a hosted endpoint"],
    ...(development ? (capability.development_evidence ?? []).map((line): [string, string] => ["Development evidence", line]) : []),
  ];
}

function milliseconds(value: number | null | undefined) {
  return value == null ? "—" : `${value.toLocaleString("en-US")} ms`;
}

/** Validation outcomes only (never scientific correctness): approvals, first attempts, repairs, refusal classes. */
export function proposalsText(row: ModelPerformanceRow): string {
  const { proposals } = row;
  if (proposals.validated_for_approval + proposals.rejected_by_validation === 0) return "none";
  const reasons = Object.entries(proposals.rejections_by_reason ?? {})
    .map(([code, count]) => `${count} ${code.toLowerCase().replaceAll("_", " ")}`).join(", ");
  const parts = [
    `${proposals.validated_for_approval} reached approval${proposals.validated_for_approval ? ` (${proposals.accepted_first_attempt ?? 0} on the first attempt)` : ""}`,
    `${proposals.rejected_by_validation} refused by validation${reasons ? ` (${reasons})` : ""}`,
  ];
  if (proposals.repairs_before_approval) parts.push(`${proposals.repairs_before_approval} corrected after a refusal`);
  if (proposals.unrepaired_runs) parts.push(`${proposals.unrepaired_runs} run${proposals.unrepaired_runs === 1 ? "" : "s"} ended without a valid proposal`);
  return `${parts.join(" · ")} — validation, not scientific correctness`;
}

/** Observed operational counts only; every unknown stays unknown, nothing is ranked. */
export function ObservedRunsSummary({ row, synthetic }: { row: ModelPerformanceRow | null; synthetic: boolean }) {
  if (!row) return <p className="ai-model-observed-empty">No runs recorded for this model yet.</p>;
  const { requests, request_latency: latency, tokens } = row;
  return (
    <dl className="ai-status-dl" data-testid="ai-model-observed">
      <div><dt>Requests</dt><dd>{requests.dispatched} sent · {requests.succeeded} succeeded · {requests.timeout} timed out · {requests.provider_error} provider errors{requests.unclassified_failure ? ` · ${requests.unclassified_failure} unclassified` : ""}</dd></div>
      <div><dt>Latency</dt><dd>{latency.observations ? `median ${milliseconds(latency.median_ms)} over ${latency.observations} successful` : "UNKNOWN (no successful timed request)"}{latency.p95_ms != null ? ` · p95 ${milliseconds(latency.p95_ms)}` : ""}</dd></div>
      <div><dt>Tokens</dt><dd>{tokens.requests_reported ? `${tokens.input_tokens?.toLocaleString("en-US")} in / ${tokens.output_tokens?.toLocaleString("en-US")} out, provider-reported` : "UNKNOWN"}{tokens.requests_unknown ? ` · ${tokens.requests_unknown} request(s) reported none` : ""}</dd></div>
      <div><dt>Tool calls</dt><dd>{row.tool_calls.emitted ? `${row.tool_calls.emitted - row.tool_calls.rejected_by_validation} of ${row.tool_calls.emitted} passed validation` : "none emitted"}</dd></div>
      <div><dt>Proposals</dt><dd>{proposalsText(row)}</dd></div>
      {synthetic ? <div><dt>Note</dt><dd>Offline fixture timings are synthetic and say nothing about any real model.</dd></div> : null}
    </dl>
  );
}

export function AIScientistModelSwitcher({
  settingsView, currentLabel, tone, activeRunModel, runInFlight, approvalPending, onModelSaved,
}: {
  settingsView: AISettingsView | null;
  currentLabel: string;
  tone: "checking" | "available" | "unavailable";
  /** Model the current/last run is bound to (from its receipts); never the selection. */
  activeRunModel: string | null;
  runInFlight: boolean;
  approvalPending: boolean;
  onModelSaved: (selection: { provider: string; model: string }) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; detail?: string } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [performance, setPerformance] = useState<AIModelPerformanceView | "error" | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const allowLocalTest = useLocalDevelopment();
  const choices = useMemo(() => modelChoices(settingsView, { allowLocalTest }), [settingsView, allowLocalTest]);
  const currentKey = settingsView ? `${settingsView.preferences.provider}::${settingsView.preferences.model}` : "";
  // Eligible models first; models the server will refuse sit behind an explicit disclosure.
  const offered = choices.filter((choice) => choice.selectable || choice.key === currentKey);
  const refused = choices.filter((choice) => !offered.includes(choice));
  const shown = choices.find((choice) => choice.key === (focusKey ?? currentKey)) ?? choices.find((choice) => choice.key === currentKey) ?? null;

  useEffect(() => {
    if (!message || message.kind === "error") return;
    const timer = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getAiModelPerformance().then((view) => { if (alive) setPerformance(view); }).catch(() => { if (alive) setPerformance("error"); });
    return () => { alive = false; };
  }, [open]);

  const select = async (choice: ModelChoice) => {
    if (!settingsView || saving) return;
    if (choice.key === currentKey) { setOpen(false); return; }
    if (!choice.selectable) { setFocusKey(choice.key); return; }
    setSaving(true);
    setMessage(null);
    try {
      const updated = await saveAiSettings({ mode: settingsView.preferences.mode, provider: choice.provider as AISettingsView["preferences"]["provider"], model: choice.model });
      const name = choice.capability ? modelDisplayName(choice.capability.display_name, choice.capability.provider) : choice.model;
      setMessage(updated.availability.available
        ? { kind: "ok", text: `New requests use ${name}.` }
        : { kind: "error", text: `Saved ${name}, but AI is unavailable: ${aiErrorLabel(updated.availability.error_code)}. No fallback model is used.`, detail: updated.availability.error_code ?? "AI_UNAVAILABLE" });
      onModelSaved({ provider: updated.preferences.provider, model: updated.preferences.model });
      setOpen(false);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? `Not changed: ${error.message}` : "Not changed: the server rejected the selection." });
    } finally {
      setSaving(false);
    }
  };

  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, (index: number, count: number) => number> = {
      ArrowDown: (i, n) => (i + 1) % n, ArrowRight: (i, n) => (i + 1) % n,
      ArrowUp: (i, n) => (i - 1 + n) % n, ArrowLeft: (i, n) => (i - 1 + n) % n,
      Home: () => 0, End: (_, n) => n - 1,
    };
    const step = keys[event.key];
    if (!step) return;
    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const index = radios.findIndex((radio) => radio === document.activeElement);
    if (!radios.length) return;
    event.preventDefault();
    radios[step(Math.max(index, 0), radios.length)]?.focus();
  };

  const renderOption = (choice: ModelChoice) => {
    const current = choice.key === currentKey;
    const name = choice.capability ? modelDisplayName(choice.capability.display_name, choice.capability.provider) : choice.model;
    const firstReason = choice.reason?.split(/(?<=\.)\s/)[0] ?? null;
    const development = choice.capability?.eligibility === "DEVELOPMENT";
    return (
      <button key={choice.key} type="button" role="radio" aria-checked={current}
        aria-disabled={!choice.selectable && !current} aria-describedby={`${id}-${choice.key}-note`}
        tabIndex={current || (!currentKey && choice === choices[0]) || (!offered.includes(choice) && choice === refused[0]) ? 0 : -1}
        className={`ai-model-option${current ? " is-current" : ""}${!choice.selectable && !current ? " is-unavailable" : ""}`}
        data-testid={`ai-model-option-${choice.model}`}
        onFocus={() => setFocusKey(choice.key)} onMouseEnter={() => setFocusKey(choice.key)}
        onClick={() => void select(choice)} disabled={saving}>
        <span className="ai-model-option-name">{name}</span>
        <span className={`ai-model-option-state${development ? " is-development" : ""}`}>
          {current ? (development ? "Current · development" : "Current") : choice.selectable ? (development ? "Development" : "Selectable") : "Not selectable"}
        </span>
        <span id={`${id}-${choice.key}-note`} className="ai-model-option-note">
          {choice.localTestOnly ? "Offline fixture" : providerLabel(choice.provider)}
          {development ? ` · development use only: ${requestTypesLabel(choice)}` : ""}
          {!choice.selectable && !current && firstReason ? ` · ${firstReason}` : ""}
        </span>
      </button>
    );
  };

  const observed = !shown || performance === null || performance === "error" ? null
    : performance.rows.find((row) => row.model_provider === shown.provider && row.model_name === shown.model) ?? null;
  const bound = runInFlight || approvalPending;

  return (
    <>
      <AppPopover
        interactionKind="click"
        popupKind={PopupKind.DIALOG}
        placement="bottom-start"
        isOpen={open}
        onInteraction={(next) => { if (!saving) { setOpen(next); if (next) { setFocusKey(null); setShowUnavailable(false); setPerformance(null); } } }}
        autoFocus
        enforceFocus={false}
        canEscapeKeyClose
        shouldReturnFocusOnClose
        arrow={false}
        transitionDuration={0}
        popoverClassName="ai-model-switcher-popover"
        portalClassName="ai-model-switcher-portal"
        onOpened={(node) => node.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true })}
        content={
          <section className="ai-model-switcher" role="dialog" aria-labelledby={`${id}-title`} data-testid="ai-model-switcher">
            <h4 id={`${id}-title`} className="ai-model-switcher-title">AI model</h4>
            <p className="ai-model-switcher-lede">Applies to your next request. No fallback model is ever used.</p>
            {choices.length === 0 ? <p className="ai-model-observed-empty" role="status">Couldn&apos;t load the model list.</p> : (
              <>
                <div role="radiogroup" aria-labelledby={`${id}-title`} className="ai-model-list" onKeyDown={move}>
                  {offered.map((choice) => renderOption(choice))}
                </div>
                {refused.length ? (
                  <>
                    <button type="button" className="ai-model-unavailable-toggle" aria-expanded={showUnavailable}
                      aria-controls={`${id}-unavailable`} data-testid="ai-model-unavailable-toggle"
                      onClick={() => setShowUnavailable((value) => !value)}>
                      <AppIcon icon={showUnavailable ? "chevron-up" : "chevron-down"} />
                      {showUnavailable ? "Hide" : "Show"} {refused.length} model{refused.length === 1 ? "" : "s"} that cannot be selected
                    </button>
                    <div id={`${id}-unavailable`} role="radiogroup" aria-label="Models that cannot be selected" className="ai-model-list is-refused" onKeyDown={move} hidden={!showUnavailable}>
                      {showUnavailable ? refused.map((choice) => renderOption(choice)) : null}
                    </div>
                  </>
                ) : null}
              </>
            )}
            {shown ? (
              <div className="ai-model-detail" data-testid="ai-model-detail" aria-live="polite">
                <h5 className="ai-model-detail-title">{shown.capability ? modelDisplayName(shown.capability.display_name, shown.capability.provider) : shown.model}</h5>
                <dl className="ai-status-dl">
                  {evidenceLines(shown).map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}
                  {shown.capability ? <div><dt>Context</dt><dd>{shown.capability.published_context}</dd></div> : null}
                  <div><dt>Request types</dt><dd>{requestTypesLabel(shown)}</dd></div>
                </dl>
                {!shown.selectable && shown.key !== currentKey && shown.reason ? <p className="ai-model-detail-reason">{shown.reason}</p> : null}
                <h6 className="ai-model-detail-sub">Observed in your own runs (not a benchmark)</h6>
                {performance === null ? <p className="ai-model-observed-empty" role="status">Loading…</p>
                  : performance === "error" ? <p className="ai-model-observed-empty">Run telemetry is unavailable.</p>
                  : <ObservedRunsSummary row={observed} synthetic={shown.localTestOnly || shown.provider === "fake"} />}
              </div>
            ) : null}
            {bound ? (
              <p className="ai-model-bound-note" data-testid="ai-model-bound-note">
                {approvalPending ? "A proposal is awaiting your decision; changing the model does not alter it or its provenance. " : "A request is running and keeps "}
                {approvalPending ? null : <strong>{activeRunModel ?? "its bound model"}</strong>}
                {approvalPending ? null : ". It is not restarted. "}
                The new selection applies to your next request.
              </p>
            ) : null}
            {message?.kind === "error" ? <><p className="ai-model-switch-error" role="alert">{message.text}</p><AiErrorDetails detail={message.detail} /></> : null}
          </section>
        }
      >
        <button ref={trigger} type="button" className="ai-model-switch-trigger" data-testid="ai-model-switch-trigger"
          aria-haspopup="dialog" aria-expanded={open} aria-label={`AI model: ${currentLabel}. Change model`}
          disabled={!settingsView}>
          <span className={`ai-status-dot tone-${tone}`} aria-hidden="true" />
          <strong data-testid="ai-model-name" title={settingsView?.preferences.model}>{currentLabel}</strong>
          <AppIcon icon={open ? "chevron-up" : "chevron-down"} />
        </button>
      </AppPopover>
      <span role="status" className={`ai-model-switch-status${message?.kind === "error" ? " is-error" : ""}`} data-testid="ai-model-switch-status">
        {message?.kind === "ok" ? message.text : ""}
      </span>
    </>
  );
}
