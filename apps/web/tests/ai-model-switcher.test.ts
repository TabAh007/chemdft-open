// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AIModelCapability, AISettingsView, ModelPerformanceRow } from "@chemdft/schemas";
import { modelChoices } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-settings-tab";
import { evidenceLines, ObservedRunsSummary, requestTypesLabel } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-model-switcher";

const capability = (over: Partial<AIModelCapability>): AIModelCapability => ({
  provider: "nvidia", model_identifier: "nvidia/example", display_name: "Example (NVIDIA)", status: "DOCUMENTED",
  endpoint: "https://example.invalid/v1/chat/completions", endpoint_availability: "AVAILABLE", documented_capabilities: ["Text"],
  published_context: "1M (published)", configuration_requirements: [], configured: false, selectable: false,
  tool_compatibility_verified: false, proposal_workflow_verified: false, verification_scope: "No live ChemDFT verification",
  limitations: [], source_urls: [], reviewed_on: "2026-10-16", planning_profiles: [], unselectable_reason: null, ...over,
} as AIModelCapability);

const view = (rows: AIModelCapability[], offered: Array<[string, string[], boolean?]>): AISettingsView => ({
  preferences: { mode: "MANAGED", provider: "fake", model: "fake-standard" },
  availability: { mode: "MANAGED", provider: "fake", model: "fake-standard", available: true },
  providers: offered.map(([provider, models, local]) => ({ provider, models, local_test_only: Boolean(local) })),
  credentials: [], model_capabilities: rows,
} as unknown as AISettingsView);

it("offers only what the server offers and carries the server's reason for the rest", () => {
  const listed = capability({ model_identifier: "nvidia/listed", selectable: true, planning_profiles: ["GENERAL"] });
  const refused = capability({ model_identifier: "nvidia/refused", unselectable_reason: "Tool calling is not verified against ChemDFT's adapter." });
  const notOffered = capability({ model_identifier: "nvidia/not-offered", selectable: true });
  const choices = modelChoices(view([listed, refused, notOffered], [["nvidia", ["nvidia/listed"]], ["fake", ["fake-standard", "fake-alternate"], true]]), { allowLocalTest: true });
  const byModel = Object.fromEntries(choices.map((choice) => [choice.model, choice]));
  expect(byModel["nvidia/listed"]!.selectable).toBe(true);
  expect(byModel["nvidia/refused"]!.selectable).toBe(false);
  expect(byModel["nvidia/refused"]!.reason).toBe("Tool calling is not verified against ChemDFT's adapter.");
  // Registry says selectable, but the server did not offer this pair: never selectable in the UI.
  expect(byModel["nvidia/not-offered"]!.selectable).toBe(false);
  expect(byModel["fake-alternate"]).toMatchObject({ selectable: true, localTestOnly: true });
});

it("never offers a local test provider outside local development", () => {
  const listed = capability({ model_identifier: "nvidia/listed", selectable: true });
  const hosted = view([listed], [["nvidia", ["nvidia/listed"]], ["fake", ["fake-standard", "fake-alternate"], true]]);
  const models = modelChoices(hosted).map((choice) => choice.model);
  expect(models).toEqual(["nvidia/listed"]);
  expect(modelChoices(hosted, { allowLocalTest: false }).some((choice) => choice.localTestOnly)).toBe(false);
});

it("keeps registry, configuration, eligibility and hosted verification as separate facts", () => {
  const verified = capability({ configured: true, selectable: true, tool_compatibility_verified: true, verification_scope: "historical read", planning_profiles: ["EVIDENCE", "GENERAL"] });
  const [choice] = modelChoices(view([verified], [["nvidia", ["nvidia/example"]]]));
  const lines = Object.fromEntries(evidenceLines(choice!));
  expect(lines["This server"]).toBe("Configured");
  expect(lines["Selection"]).toBe("Eligible");
  expect(lines["Hosted verification"]).toContain("historical read");
  expect(lines["Proposal workflow"]).toBe("Not verified at a hosted endpoint");
  expect(requestTypesLabel(choice!)).toBe("Ask, Plan (general)");
  const [unverified] = modelChoices(view([capability({})], []));
  expect(Object.fromEntries(evidenceLines(unverified!))["Hosted verification"]).toBe("Not verified");
  expect(requestTypesLabel(unverified!)).toBe("None");
});

const row = (over: Partial<ModelPerformanceRow>): ModelPerformanceRow => ({
  model_provider: "nvidia", model_name: "nvidia/example", synthetic: false,
  requests: { dispatched: 2, succeeded: 0, timeout: 1, provider_error: 1, unclassified_failure: 0, not_dispatched: 0, in_flight: 0 },
  request_latency: { observations: 0, median_ms: null, p95_ms: null, max_ms: null },
  tokens: { requests_reported: 0, requests_unknown: 2, input_tokens: null, output_tokens: null },
  tool_calls: { emitted: 0, rejected_by_validation: 0, outside_run_scope: 0, conformance_rate: null },
  proposals: { validated_for_approval: 0, rejected_by_validation: 0, validity_rate: null },
  run_outcomes: { runs: 2, succeeded: 0, failed: 2, canceled: 0, other: 0 }, ...over,
} as ModelPerformanceRow);

it("shows unknown usage and latency as UNKNOWN, never as zero, and labels fixture data", () => {
  const html = renderToStaticMarkup(createElement(ObservedRunsSummary, { row: row({}), synthetic: false }));
  expect(html).toContain("UNKNOWN (no successful timed request)");
  expect(html).toContain("UNKNOWN");
  expect(html).toContain("1 timed out");
  expect(html).not.toContain("0 in /");
  expect(html).not.toContain("synthetic");
  expect(renderToStaticMarkup(createElement(ObservedRunsSummary, { row: row({ synthetic: true }), synthetic: true }))).toContain("synthetic");
  expect(renderToStaticMarkup(createElement(ObservedRunsSummary, { row: null, synthetic: false }))).toContain("No runs recorded");
});
