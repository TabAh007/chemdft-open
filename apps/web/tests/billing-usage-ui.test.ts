import type { AIUsageSummary } from "@chemdft/schemas";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AIUsageReadout } from "../src/app/_components/settings/ai-usage-readout";

const reported: AIUsageSummary = {
  input_tokens: 0, output_tokens: 0, cached_tokens: 0, usage_complete: true,
  reported_input_tokens: 0, reported_output_tokens: 0, reported_cached_tokens: 0,
  reported_entries: 1, unknown_entries: 0, legacy_entries: 0, pending_entries: 0,
  billable: { currency: "USD", minor_units: 7 },
  known_provider_cost: { currency: "USD", minor_units: 0 },
  provider_cost: null, provider_cost_complete: false,
  managed_entries: 0, byok_entries: 1,
};

describe("AI usage observations and charges", () => {
  it("shows confirmed zero tokens separately from unknown provider cost", () => {
    const html = renderToStaticMarkup(createElement(AIUsageReadout, { usage: reported }));
    expect(html).toContain("0 reported tokens");
    expect(html).toContain("Platform charges: USD 7 minor units");
    expect(html).toContain("Provider cost unavailable");
    expect(html).not.toContain("Usage is incomplete");
  });

  it.each(["unknown", "legacy", "pending"])("never displays %s tokens as zero", (kind) => {
    const usage = {
      ...reported, input_tokens: null, output_tokens: null, cached_tokens: null,
      usage_complete: false, reported_input_tokens: 12,
      unknown_entries: kind === "unknown" ? 1 : 0,
      legacy_entries: kind === "legacy" ? 1 : 0,
      pending_entries: kind === "pending" ? 1 : 0,
    };
    const html = renderToStaticMarkup(createElement(AIUsageReadout, { usage }));
    expect(html).toContain("Token total unavailable");
    expect(html).toContain("Reported subtotal: 12 tokens");
    expect(html).not.toContain("0 reported tokens");
    expect(html).toContain("Platform charges: USD 7 minor units");
  });
});
