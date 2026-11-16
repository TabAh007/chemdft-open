"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import type { AISettingsView, AIPreferencesInput } from "@chemdft/schemas";
import { ActionButton, AppIcon, StatusTag } from "@chemdft/ui";
import { getAiSettings, saveAiSettings } from "@/lib/ai-scientist-api";
import { hasHiddenLocalTest, modelChoices, savedPreferenceUnavailable } from "@/lib/ai-model-choices";
import { useLocalDevelopment } from "../../../../_components/local-development-context";
import { AiErrorDetails } from "./ai-scientist-error-details";
import { plainAiError } from "@/lib/ai-plain-errors";
import { aiErrorLabel, aiModeLabel, modelDisplayName, modelStatusLabel, providerLabel } from "@/lib/scientific-labels";

interface AIScientistSettingsTabProps {
  /** Called after the server accepted a new preference, so Chat can re-read its model context. */
  onModelSaved?: (selection: { provider: string; model: string }) => void;
}

export { modelChoices, type ModelChoice } from "@/lib/ai-model-choices";

export function AIScientistSettingsTab({ onModelSaved }: AIScientistSettingsTabProps) {
  const locale = useLocale();
  const [settingsView, setSettingsView] = useState<AISettingsView | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "warning" | "error"; text: string; detail?: string | undefined } | null>(null);

  useEffect(() => {
    let alive = true;
    getAiSettings()
      .then((data) => {
        if (!alive) return;
        setSettingsView(data);
        setSelectedKey(`${data.preferences.provider}::${data.preferences.model}`);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const raw = err instanceof Error ? err.message : "Failed to load server AI settings.";
        const plain = plainAiError(raw);
        setStatusMessage({
          type: "error",
          text: plain.text || "Failed to load server AI settings.",
          detail: plain.detail ?? (raw !== plain.text ? raw : undefined),
        });
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const allowLocalTest = useLocalDevelopment();
  const choices = useMemo(() => modelChoices(settingsView, { allowLocalTest }), [settingsView, allowLocalTest]);
  const savedUnavailable = savedPreferenceUnavailable(settingsView, choices);
  const testProvidersHidden = hasHiddenLocalTest(settingsView, { allowLocalTest });
  const selected = choices.find((choice) => choice.key === selectedKey) ?? null;
  const savedKey = settingsView ? `${settingsView.preferences.provider}::${settingsView.preferences.model}` : "";
  const unchanged = selectedKey === savedKey;

  const handleSaveModel = async () => {
    if (!selected?.selectable || !settingsView) return;
    setSaving(true);
    setStatusMessage(null);
    try {
      const updated = await saveAiSettings({
        mode: settingsView.preferences.mode,
        provider: selected.provider as AIPreferencesInput["provider"],
        model: selected.model,
      });
      setSettingsView(updated);
      setSelectedKey(`${updated.preferences.provider}::${updated.preferences.model}`);
      const name = selected.capability ? modelDisplayName(selected.capability.display_name, selected.capability.provider) : selected.model;
      setStatusMessage(updated.availability.available
        ? { type: "success", text: `Saved. New AI requests use ${name} (${providerLabel(updated.preferences.provider)}).` }
        : { type: "warning", text: `Saved, but AI is unavailable for this preference: ${aiErrorLabel(updated.availability.error_code)}. No fallback model is used.`, detail: updated.availability.error_code ?? "AI_UNAVAILABLE" });
      onModelSaved?.({ provider: updated.preferences.provider, model: updated.preferences.model });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "The server rejected the preference.";
      const plain = plainAiError(raw);
      setStatusMessage({
        type: "error",
        text: `Not saved: ${plain.text}`,
        detail: plain.detail ?? (raw !== plain.text ? raw : undefined),
      });
    } finally {
      setSaving(false);
    }
  };

  const availability = settingsView?.availability;
  const capability = selected?.capability ?? null;

  return (
    <div className="ai-settings-view-container" data-testid="ai-settings-view">
      <div className="ai-settings-intro-header">
        <h3 className="ai-settings-heading">Model and safeguards</h3>
        <p className="ai-settings-subtitle">
          Your model preference is stored on the server for your account. Execution safeguards below are fixed by ChemDFT.
        </p>
      </div>

      {statusMessage ? (
        <div className={`ai-settings-notice is-${statusMessage.type}`} role={statusMessage.type === "error" ? "alert" : "status"}
          data-testid="ai-settings-notice">
          {statusMessage.text}
          <AiErrorDetails detail={statusMessage.detail} />
        </div>
      ) : null}

      <section className="ai-settings-section" aria-labelledby="ai-settings-model-heading">
        <div className="ai-settings-section-header">
          <AppIcon icon="cog" />
          <h4 id="ai-settings-model-heading" className="ai-settings-section-title">Model &amp; Provider</h4>
        </div>
        <div className="ai-settings-section-body">
          {availability && savedUnavailable ? (
            <p className="ai-setting-help" data-testid="ai-settings-current">
              Your saved model is not available in this environment. Choose a model below.
            </p>
          ) : availability ? (
            <p className="ai-setting-help" data-testid="ai-settings-current">
              Current: <strong>{availability.model}</strong> ({providerLabel(availability.provider)}, {aiModeLabel(availability.mode)}) ·{" "}
              {availability.available ? "available" : `unavailable — ${aiErrorLabel(availability.error_code)}`}
            </p>
          ) : null}
          <div className="ai-setting-field">
            <label htmlFor="ai-model-select" className="ai-setting-label">Model for new AI requests</label>
            <p className="ai-setting-help">
              Only models that are available on this server can be chosen.
            </p>
            {loading ? (
              <p className="ai-setting-help" role="status">Loading model registry…</p>
            ) : (
              <div className="ai-settings-model-stack">
                <select id="ai-model-select" className="ai-settings-select" value={selectedKey}
                  disabled={saving || choices.length === 0} onChange={(event) => { setSelectedKey(event.target.value); setStatusMessage(null); }}
                  data-testid="ai-model-select">
                  {selected === null && selectedKey ? <option value={selectedKey} disabled>Saved model is not available here — choose another</option> : null}
                  {choices.map((choice) => (
                    <option key={choice.key} value={choice.key} disabled={!choice.selectable}>
                      {choice.label}{choice.selectable ? "" : " · not selectable"}
                    </option>
                  ))}
                </select>

                {capability ? (
                  <div className="ai-model-meta-card" data-testid="ai-model-meta">
                    <div className="ai-model-meta-title">
                      <strong>{modelDisplayName(capability.display_name, capability.provider)}</strong>
                      <StatusTag intent={capability.eligibility === "DEVELOPMENT" ? "warning" : selected?.selectable ? "success" : "none"}>
                        {capability.eligibility === "DEVELOPMENT" ? "Development use only" : modelStatusLabel(capability.status)}
                      </StatusTag>
                    </div>
                    <dl className="ai-model-meta-list">
                      <div><dt>Provider</dt><dd>{providerLabel(capability.provider)}</dd></div>
                      <div><dt>Endpoint availability</dt><dd>{modelStatusLabel(capability.endpoint_availability)}</dd></div>
                      <div><dt>Published context</dt><dd>{capability.published_context}</dd></div>
                      <div><dt>Verification scope</dt><dd>{capability.verification_scope}</dd></div>
                      <div><dt>Reviewed</dt><dd>{capability.reviewed_on}</dd></div>
                    </dl>
                    {capability.eligibility === "DEVELOPMENT" && capability.development_evidence?.length ? (
                      <ul className="ai-model-limitations" aria-label="Development evidence" data-testid="ai-model-development-evidence">
                        {capability.development_evidence.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    ) : null}
                    {capability.limitations?.length ? (
                      <ul className="ai-model-limitations" aria-label="Limitations">
                        {capability.limitations.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ) : selected?.localTestOnly ? (
                  <p className="ai-setting-help">Offline local test fixture: deterministic test responses, no external model calls.</p>
                ) : selected?.reason ? (
                  <p className="ai-setting-help">{selected.reason}</p>
                ) : null}

                {testProvidersHidden ? <p className="ai-setting-help" data-testid="ai-test-providers-hidden">Test providers are only available in local development.</p> : null}

                <div>
                  <ActionButton intent="primary" text={saving ? "Saving…" : "Save model preference"}
                    disabled={saving || !selected?.selectable || unchanged} onClick={handleSaveModel}
                    data-testid="ai-settings-save" />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <p className="ai-settings-account-link">
        Provider API keys and account-level AI options: <Link href={`/${locale}/settings/ai`}>Account AI settings</Link>
      </p>

      <section className="ai-settings-section" aria-labelledby="ai-settings-policy-heading">
        <div className="ai-settings-section-header">
          <AppIcon icon="shield" />
          <h4 id="ai-settings-policy-heading" className="ai-settings-section-title">Execution safeguards (fixed)</h4>
        </div>
        <ul className="ai-settings-policy-list">
          <li><strong>No provider fallback.</strong> If the selected provider or model is unavailable, the request stops and reports the error.</li>
          <li><strong>Consistent settings by default.</strong> Planning requests are sent with temperature 0, which reduces sampling variation without making outputs identical. A model marked development use only is sent its documented sampling settings instead; every proposal records the settings it used.</li>
          <li><strong>Your request is kept as written.</strong> A proposal that differs from a method, basis set, engine, calculation type, charge or multiplicity your message names is refused, not shown for approval.</li>
          <li><strong>Human approval.</strong> A calculation runs only after you approve its exact bound parameters. The AI never produces scientific results.</li>
          <li><strong>No automatic resubmission</strong> of failed scientific calculations. Model calls per run are bounded by server limits and your run limits.</li>
        </ul>
      </section>
    </div>
  );
}
