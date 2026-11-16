"use client";

import type { AIPreferencesInput, AISettingsView } from "@chemdft/schemas";
import { ActionButton, AppIcon, StatusTag } from "@chemdft/ui";
import { useEffect, useMemo, useState } from "react";

import { getAiSettings, revokeAiCredential, saveAiCredential, saveAiSettings } from "@/lib/ai-scientist-api";
import { hasHiddenLocalTest, modelChoices, savedPreferenceUnavailable, splitModelChoices } from "@/lib/ai-model-choices";
import { aiErrorLabel, aiModeLabel, modelDisplayName, providerLabel } from "@/lib/scientific-labels";
import { useLocalDevelopment } from "../local-development-context";
import { SectionHead } from "./settings-shell";
import styles from "./settings.module.css";

const ALLOWANCE: Record<string, string> = { AVAILABLE: "Available", UNAVAILABLE: "Unavailable", NOT_CONFIGURED: "Not configured" };
const allowanceLabel = (code: string) => ALLOWANCE[code] ?? code.toLowerCase().replaceAll("_", " ");

const UNAVAILABLE_KEY = "chemdft.ai.showUnavailableModels";

export function AISettingsPanel() {
  const allowLocalTest = useLocalDevelopment();
  const [settings, setSettings] = useState<AISettingsView | null>(null);
  const [draft, setDraft] = useState<AIPreferencesInput | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(() => {
    try { return window.sessionStorage.getItem(UNAVAILABLE_KEY) === "1"; } catch { return false; }
  });
  function toggleUnavailable() {
    const next = !showUnavailable;
    setShowUnavailable(next);
    try { window.sessionStorage.setItem(UNAVAILABLE_KEY, next ? "1" : "0"); } catch { /* remembering is optional */ }
  }
  async function refresh() {
    const view = await getAiSettings();
    setSettings(view);
  }
  useEffect(() => {
    let current = true;
    void getAiSettings().then(view => { if (current) { setSettings(view); setDraft(view.preferences); } }).catch(() => {
      if (current) setError("AI settings could not be loaded. Reload the page to try again.");
    });
    return () => { current = false; };
  }, []);
  const choices = useMemo(() => modelChoices(settings, { allowLocalTest }), [settings, allowLocalTest]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "AI settings could not be saved."); }
    finally { setSecret(""); setBusy(false); }
  }
  if (!settings || !draft) return <div aria-live="polite" data-testid="ai-settings-loading">{error ? <p role="alert" className={styles.error}>{error}</p> : <p className={styles.muted}>Loading AI settings…</p>}</div>;

  const selectedKey = `${draft.provider}::${draft.model}`;
  const { available, unavailable } = splitModelChoices(choices, selectedKey);
  const selected = choices.find(choice => choice.key === selectedKey) ?? null;
  const savedUnavailable = savedPreferenceUnavailable(settings, choices);
  const testHidden = hasHiddenLocalTest(settings, { allowLocalTest });
  const availability = settings.availability;
  const current = choices.find(choice => choice.provider === availability.provider && choice.model === availability.model) ?? null;
  const currentName = current?.capability ? modelDisplayName(current.capability.display_name, current.capability.provider) : availability.model;
  const credential = settings.credentials.find(item => item.provider === draft.provider);
  const credentialAvailable = !savedUnavailable && !selected?.localTestOnly && settings.availability.secret_storage_available;
  const byokAllowed = !selected?.localTestOnly;

  return <div data-testid="ai-settings-panel">
    <SectionHead title="AI Scientist" tag={<StatusTag intent={availability.available ? "success" : "none"}>{availability.available ? "Available" : "Unavailable"}</StatusTag>}
      lead="Optional explanations and approved actions. Scientific engines remain the authority for every result." />
    <div style={{ display: "grid", gap: 18, marginTop: 22 }}>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {notice ? <p role="status" className={styles.notice}><AppIcon icon="tick-circle" /> {notice}</p> : null}

      <section className={styles.card} aria-labelledby="ai-current-heading">
        <div className={styles.cardHead}><h3 id="ai-current-heading">Current setting</h3></div>
        <div className={styles.cardBody}>
          {savedUnavailable ? <p className={`${styles.notice} ${styles.noticeWarn}`} data-testid="ai-saved-unavailable">Your saved model is not available in this environment. Choose a model below.</p> : null}
          <dl className={styles.facts} data-testid="ai-provider-status" data-mode={availability.mode} data-provider={availability.provider} data-model={availability.model} data-error-code={availability.error_code ?? ""}>
            <div><dt>AI source</dt><dd title={availability.mode}>{aiModeLabel(availability.mode)}</dd></div>
            <div><dt>Model</dt><dd title={availability.model}>{savedUnavailable ? "—" : currentName}</dd></div>
            <div><dt>Provider</dt><dd title={availability.provider}>{savedUnavailable ? "—" : providerLabel(availability.provider)}</dd></div>
            <div><dt>Status</dt><dd title={availability.error_code ?? undefined}>{availability.error_code ? aiErrorLabel(availability.error_code) : availability.available ? "Ready to use" : "Unavailable"}</dd></div>
            <div><dt>Managed AI</dt><dd>{availability.managed_enabled ? "Enabled" : "Unavailable"}</dd></div>
            <div><dt>Your own key</dt><dd>{availability.byok_enabled ? "Enabled" : "Unavailable"}</dd></div>
            <div><dt>Allowance</dt><dd title={availability.allowance_status}>{allowanceLabel(availability.allowance_status)}</dd></div>
          </dl>
        </div>
      </section>

      <form className={styles.card} aria-labelledby="ai-prefs-heading" onSubmit={event => { event.preventDefault(); void perform(async () => { const view = await saveAiSettings(draft); setSettings(view); setDraft(view.preferences); setNotice("AI preferences saved. No fallback is enabled."); }); }}>
        <div className={styles.cardHead}><h3 id="ai-prefs-heading">Choose how AI runs</h3></div>
        <div className={styles.cardBody}>
          <label className={styles.field}>AI source
            <select value={draft.mode} disabled={busy} onChange={event => setDraft({ ...draft, mode: event.target.value as AIPreferencesInput["mode"] })}>
              <option value="NONE">AI disabled</option><option value="MANAGED">Managed AI</option><option value="BYOK" disabled={!byokAllowed}>Bring your own key</option>
            </select>
          </label>
          <label className={styles.field}>Model
            <select value={savedUnavailable ? "" : selectedKey} disabled={busy || choices.length === 0} data-testid="ai-settings-model"
              onChange={event => { const next = choices.find(choice => choice.key === event.target.value); if (next?.selectable) setDraft({ ...draft, provider: next.provider as AIPreferencesInput["provider"], model: next.model, mode: next.localTestOnly && draft.mode === "BYOK" ? "NONE" : draft.mode }); }}>
              {savedUnavailable ? <option value="" disabled>Choose a model</option> : null}
              {available.map(choice => <option key={choice.key} value={choice.key} disabled={!choice.selectable}>{choice.label}{choice.selectable ? "" : " · not selectable"}</option>)}
            </select>
            {selected && !selected.selectable && selected.reason ? <span className={styles.hint}>{selected.reason}</span> : null}
            {testHidden ? <span className={styles.hint} data-testid="ai-test-providers-hidden">Test providers are only available in local development.</span> : null}
          </label>
          {unavailable.length ? (
            <div>
              <button type="button" className={styles.disclosureToggle} aria-expanded={showUnavailable} aria-controls="ai-unavailable-models" data-testid="ai-unavailable-toggle" onClick={toggleUnavailable}>
                <AppIcon icon={showUnavailable ? "chevron-up" : "chevron-down"} />
                {showUnavailable ? "Hide" : "Show"} unavailable models ({unavailable.length})
              </button>
              <ul id="ai-unavailable-models" className={styles.unavailableList} hidden={!showUnavailable} data-testid="ai-unavailable-list">
                {showUnavailable ? unavailable.map(choice => (
                  <li key={choice.key} data-testid="ai-unavailable-model"><span>{choice.capability ? `${modelDisplayName(choice.capability.display_name, choice.capability.provider)} (${providerLabel(choice.capability.provider)})` : choice.label}</span><span className={styles.hint}>{choice.reason ?? "Not available"}</span></li>
                )) : null}
              </ul>
            </div>
          ) : null}
          <p className={styles.caption}>Changes take effect only after saving. Requests use one selected source and model; if it is unavailable, the request stops and never switches to managed credits or another key.</p>
          <div className={styles.actions}><ActionButton type="submit" text={busy ? "Saving…" : "Save AI preferences"} intent="primary" disabled={busy || savedUnavailable && !selected} /></div>
        </div>
      </form>

      <section className={styles.card} aria-labelledby="ai-key-heading">
        <div className={styles.cardHead}><h3 id="ai-key-heading">Your provider key</h3><p>Used only when the AI source is “Bring your own key”. Saving a key makes no request to the provider; a successful AI request marks it validated.</p></div>
        <div className={styles.cardBody}>
          {credential ? <dl className={styles.facts} data-testid="ai-key-status" data-status={credential.status}>
            <div><dt>Provider</dt><dd>{providerLabel(credential.provider)}</dd></div>
            <div><dt>Status</dt><dd title={credential.status}>{credential.status === "CONFIGURED" ? "Saved" : credential.status === "REVOKED" ? "Revoked" : "Not saved"} · {credential.validated ? "validated by a successful request" : "not yet validated"}</dd></div>
            <div><dt>Fingerprint</dt><dd><code className={styles.mono}>{credential.fingerprint}</code> <span className={styles.caption}>(masked identifier)</span></dd></div>
            <div><dt>Updated</dt><dd>{credential.updated_at ? new Date(credential.updated_at).toLocaleString() : "Not available"}</dd></div>
          </dl> : <p className={styles.muted} data-testid="ai-key-none">No private key saved for this provider.</p>}
          {!credentialAvailable ? <p className={styles.notice} data-testid="ai-key-storage-unavailable">Secure key storage is not available for this provider in this environment, so a key cannot be saved here. Core workflows are unaffected.</p> : <form onSubmit={event => { event.preventDefault(); const submitted = secret; setSecret(""); void perform(async () => { await saveAiCredential(draft.provider, submitted); await refresh(); setNotice("Key saved. Only a masked identifier is shown."); }); }} style={{ display: "grid", gap: 12 }}>
            <label className={styles.field}>Provider API key
              <input name="provider-api-key" type="password" autoComplete="off" spellCheck={false} minLength={8} maxLength={4096} value={secret} onChange={event => setSecret(event.target.value)} disabled={busy} aria-describedby="ai-key-privacy" />
            </label>
            <p id="ai-key-privacy" className={styles.caption}>Sent once to the server’s secret store. The original key cannot be viewed again.</p>
            <div className={styles.actions}>
              <ActionButton type="submit" intent="primary" text={credential?.status === "CONFIGURED" ? "Replace key" : "Save key"} disabled={busy || secret.length < 8} />
              {credential?.status === "CONFIGURED" ? <ActionButton type="button" text="Revoke key" disabled={busy} onClick={() => void perform(async () => { await revokeAiCredential(draft.provider); await refresh(); setNotice("Key revoked."); })} /> : null}
            </div>
          </form>}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="ai-safeguards-heading">
        <div className={styles.cardHead}><h3 id="ai-safeguards-heading">Fixed safeguards</h3></div>
        <div className={styles.cardBody}>
          <ul className={styles.safeguards}>
            <li><strong>No provider fallback.</strong> If the selected provider or model is unavailable, the request stops and reports the error.</li>
            <li><strong>Human approval.</strong> A calculation runs only after you approve its exact parameters. The AI never produces scientific results.</li>
          </ul>
        </div>
      </section>
    </div>
  </div>;
}
