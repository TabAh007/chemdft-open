import type { AIModelCapability, AISettingsView } from "@chemdft/schemas";
import { modelDisplayName, modelStatusLabel, providerLabel } from "./scientific-labels";

export interface ModelChoice {
  key: string;
  provider: string;
  model: string;
  label: string;
  /** Saveable only when the server lists the provider/model pair as an option. */
  selectable: boolean;
  reason: string | null;
  capability: AIModelCapability | null;
  localTestOnly: boolean;
}

export interface ModelChoiceOptions {
  /** Offer server options marked `local_test_only`. Only the local development stack passes true. */
  allowLocalTest?: boolean;
}

/** True when the server offered a local-test provider that `allowLocalTest: false` removes. */
export function hasHiddenLocalTest(view: AISettingsView | null, { allowLocalTest = false }: ModelChoiceOptions = {}): boolean {
  return !allowLocalTest && Boolean(view?.providers?.some((option) => option.local_test_only));
}

/**
 * The server accepts a preference only for a provider/model pair in `providers`. Registry rows add evidence; a row outside the
 * options is shown but never offered as selectable. Local test providers (stand-ins that make no real model call) are never
 * offered to a user unless the app runs in local development.
 */
export function modelChoices(view: AISettingsView | null, { allowLocalTest = false }: ModelChoiceOptions = {}): ModelChoice[] {
  if (!view) return [];
  const offered = new Map<string, { localTestOnly: boolean }>();
  for (const option of view.providers ?? []) {
    if (option.local_test_only && !allowLocalTest) continue;
    for (const model of option.models ?? []) offered.set(`${option.provider}::${model}`, { localTestOnly: Boolean(option.local_test_only) });
  }
  const choices: ModelChoice[] = (view.model_capabilities ?? []).map((capability) => {
    const key = `${capability.provider}::${capability.model_identifier}`;
    const option = offered.get(key);
    const selectable = Boolean(option && capability.selectable);
    return {
      key, provider: capability.provider, model: capability.model_identifier,
      label: `${modelDisplayName(capability.display_name, capability.provider)} (${providerLabel(capability.provider)}) — ${capability.eligibility === "DEVELOPMENT" ? "Development use only" : modelStatusLabel(capability.status)}`,
      selectable,
      reason: selectable ? null : capability.unselectable_reason ?? (!capability.selectable ? "Not selectable in the model registry" : "Not offered by this server's configuration"),
      capability, localTestOnly: false,
    };
  });
  for (const [key, option] of offered) {
    if (choices.some((choice) => choice.key === key)) continue;
    const [provider = "", model = ""] = key.split("::");
    choices.push({
      key, provider, model,
      label: option.localTestOnly ? `${model} (local test fixture)` : `${model} (${providerLabel(provider)}) — not in the model registry`,
      selectable: option.localTestOnly,
      reason: option.localTestOnly ? null : "No registry evidence for this model",
      capability: null, localTestOnly: option.localTestOnly,
    });
  }
  return choices;
}

/** The saved preference names a pair the user cannot be offered here (for example a local test provider on a hosted build). */
export function savedPreferenceUnavailable(view: AISettingsView | null, choices: ModelChoice[]): boolean {
  if (!view) return false;
  const key = `${view.preferences.provider}::${view.preferences.model}`;
  return !choices.some((choice) => choice.key === key);
}

/**
 * Models that can be chosen first; the rest are listed behind a disclosure and never become options. The model named by
 * `keepKey` (the current selection) stays in the first group so the control never shows a value it does not list.
 */
export function splitModelChoices(choices: ModelChoice[], keepKey: string | null = null): { available: ModelChoice[]; unavailable: ModelChoice[] } {
  const available = choices.filter((choice) => choice.selectable || choice.key === keepKey);
  return { available, unavailable: choices.filter((choice) => !available.includes(choice)) };
}
