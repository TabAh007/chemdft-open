import type { AISettingsView } from "@chemdft/schemas";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { hasHiddenLocalTest, modelChoices, savedPreferenceUnavailable } from "../src/lib/ai-model-choices";
import { isLocalDevelopment } from "../src/lib/local-development";
import { formatMinorUnits } from "../src/lib/money";
import { initialsOf, railSections, roleLabel } from "../src/lib/settings-model";
import { BillingUnavailable } from "../src/app/_components/settings/billing-unavailable";
import { SettingsShell, UnavailableSection } from "../src/app/_components/settings/settings-shell";

describe("formatMinorUnits (integer arithmetic only)", () => {
  it.each([
    [1250, "USD", "$12.50"], [0, "USD", "$0.00"], [5, "USD", "$0.05"], [99, "USD", "$0.99"], [100, "USD", "$1.00"],
    [-1250, "USD", "-$12.50"], [-5, "USD", "-$0.05"], [123456789, "USD", "$1,234,567.89"],
    [100000, "JPY", "¥100,000"], [0, "JPY", "¥0"], [1234, "KWD", "KWD 1.234"], [7, "KWD", "KWD 0.007"],
    [Number.MAX_SAFE_INTEGER, "USD", "$90,071,992,547,409.91"],
  ])("%i %s -> %s", (minor, currency, expected) => {
    expect(formatMinorUnits({ currency, minor_units: minor })).toBe(expected);
  });
  it("does not format a fractional or unsafe amount", () => {
    expect(formatMinorUnits({ currency: "USD", minor_units: 12.5 })).toBe("Unavailable");
    expect(formatMinorUnits({ currency: "USD", minor_units: Number.MAX_SAFE_INTEGER + 2 })).toBe("Unavailable");
    expect(formatMinorUnits({ currency: "USD", minor_units: Number.NaN })).toBe("Unavailable");
  });
  it("labels an unknown currency instead of guessing", () => {
    expect(formatMinorUnits({ currency: "not-a-code", minor_units: 1250 })).toBe("1250 minor units (not-a-code)");
  });
});

const view = (providers: AISettingsView["providers"], preferences = { mode: "MANAGED", provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b" }) => ({
  availability: { allowance_status: "AVAILABLE", available: true, byok_enabled: true, managed_enabled: true, mode: preferences.mode, model: preferences.model, provider: preferences.provider, secret_storage_available: true },
  credentials: [], model_capabilities: [], preferences, providers,
}) as unknown as AISettingsView;

describe("local test providers", () => {
  const withFake = view([
    { provider: "fake", models: ["fake-standard", "fake-alternate"], local_test_only: true },
    { provider: "nvidia", models: ["nvidia/nemotron-3.5-lightning-30b-a3b"] },
  ] as AISettingsView["providers"]);
  it("are not offered unless the app runs in local development", () => {
    const hosted = modelChoices(withFake);
    expect(hosted.map((choice) => choice.provider)).toEqual(["nvidia"]);
    expect(hosted.some((choice) => choice.model.startsWith("fake"))).toBe(false);
    expect(hasHiddenLocalTest(withFake)).toBe(true);
  });
  it("are offered, labelled as test fixtures, in local development", () => {
    const local = modelChoices(withFake, { allowLocalTest: true });
    expect(local.filter((choice) => choice.localTestOnly).map((choice) => choice.label)).toEqual(["fake-standard (local test fixture)", "fake-alternate (local test fixture)"]);
    expect(hasHiddenLocalTest(withFake, { allowLocalTest: true })).toBe(false);
  });
  it("flag a saved fake preference as unavailable on a hosted build", () => {
    const stale = view(withFake.providers, { mode: "MANAGED", provider: "fake", model: "fake-standard" });
    expect(savedPreferenceUnavailable(stale, modelChoices(stale))).toBe(true);
    expect(savedPreferenceUnavailable(stale, modelChoices(stale, { allowLocalTest: true }))).toBe(false);
  });
});

describe("local development detection", () => {
  it("needs dev auth, the explicit flag and a non-production build", () => {
    expect(isLocalDevelopment({ CHEMDFT_DEV_IDENTITY_ENABLED: "true" })).toBe(true);
    expect(isLocalDevelopment({ CHEMDFT_DEV_IDENTITY_ENABLED: "true", NODE_ENV: "production" })).toBe(false);
    expect(isLocalDevelopment({ CHEMDFT_DEV_IDENTITY_ENABLED: "true", CHEMDFT_AUTH_MODE: "jwt" })).toBe(false);
    expect(isLocalDevelopment({ CHEMDFT_AUTH_MODE: "dev" })).toBe(false);
    expect(isLocalDevelopment({})).toBe(false);
  });
});

describe("settings model", () => {
  it("lists General and AI everywhere and Billing (greyed) only globally; the other sections are hidden", () => {
    expect(railSections("global").map((entry) => [entry.section, entry.unavailable])).toEqual([["general", false], ["ai", false], ["billing", true]]);
    expect(railSections("project").map((entry) => entry.section)).toEqual(["general", "ai"]);
  });
  it("derives initials only from letters and never invents a name", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("  tab  ")).toBe("T");
    expect(initialsOf("")).toBeNull();
    expect(initialsOf("123")).toBeNull();
    expect(initialsOf(undefined)).toBeNull();
  });
  it("labels roles and keeps unknown input readable", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("org_admin")).toBe("Org admin");
    expect(roleLabel(null)).toBe("—");
  });
});

describe("rendered settings pages", () => {
  it("Billing is a static greyed state with the one message and no controls", () => {
    const html = renderToStaticMarkup(createElement(BillingUnavailable));
    expect(html).toContain("Billing is not available during the beta. No charges are made.");
    expect(html).not.toMatch(/<button|<input|<select|<form|checkout/i);
  });
  it("hidden sections still resolve and say Not available yet", () => {
    const html = renderToStaticMarkup(createElement(UnavailableSection, { section: "compute", scope: "global" }));
    expect(html).toContain("Not available yet");
    expect(html).not.toMatch(/<input|<select|disabled/);
  });
  it("the rail shows Billing greyed globally and nothing for the unavailable sections", () => {
    const html = renderToStaticMarkup(createElement(SettingsShell, { scope: "global", locale: "en", section: "ai" }, null));
    expect(html).toContain('data-section="billing" data-unavailable="true"');
    expect(html).toContain('aria-current="page"');
    for (const hidden of ["compute", "scientific", "privacy", "advanced"]) expect(html).not.toContain(`/settings/${hidden}`);
    expect(html).not.toContain(">Ai<");
  });
});
