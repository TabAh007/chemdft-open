import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AIApprovalView, AIModelCapability, AIRunView, AISettingsView, ModelPerformanceRow, ProposalBlocker } from "@chemdft/schemas";
import { ApprovalCard } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-panel";
import { ProposalBlockerNotice } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-blocker";
import { modelChoices } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-settings-tab";
import { evidenceLines, proposalsText, requestTypesLabel } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-model-switcher";
import { eligibilityLabel, fieldLabel, matchValueLabel, parameterLabel, requestCheckSummary, samplingLabel } from "../src/lib/scientific-labels";
import { ScientificWorkflow } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientific-workflow";

vi.mock("@/app/_components/workspace-state-provider", () => ({ useOptionalWorkspaceState: () => null }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));

const SUPER = "nvidia/nemotron-3-super-120b-a12b";
const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "44444444-4444-4444-8444-444444444444";
const versionId = "33333333-3333-4333-8333-333333333333";

const capability = (over: Partial<AIModelCapability> = {}): AIModelCapability => ({
  provider: "nvidia", model_identifier: SUPER, display_name: "Nemotron 3 Super 120B A12B", status: "CONFIGURED",
  endpoint: "https://example.invalid/v1/chat/completions", endpoint_availability: "AVAILABLE", documented_capabilities: ["Text", "Tool calling"],
  published_context: "1M (published)", configuration_requirements: [], configured: true, selectable: true,
  tool_compatibility_verified: false, proposal_workflow_verified: false, eligibility: "DEVELOPMENT",
  development_evidence: ["AI-5 run 5: one request accepted on the first attempt.", "One sample: repeatability is not established."],
  planning_profiles: ["PYSCF_ENERGY_PROPOSAL"], unselectable_reason: null, verification_scope: "Development eligibility only",
  limitations: [], source_urls: [], reviewed_on: "2026-10-16", ...over,
} as AIModelCapability);

const view = (rows: AIModelCapability[]): AISettingsView => ({
  preferences: { mode: "MANAGED", provider: "nvidia", model: SUPER },
  availability: { mode: "MANAGED", provider: "nvidia", model: SUPER, available: true },
  providers: [{ provider: "nvidia", models: rows.map((row) => row.model_identifier), local_test_only: false }],
  credentials: [], model_capabilities: rows,
} as unknown as AISettingsView);

describe("development eligibility is shown as what it is", () => {
  it("is selectable but labelled development-only, with its dated evidence and the one profile it covers", () => {
    const [choice] = modelChoices(view([capability()]));
    expect(choice!.selectable).toBe(true);
    expect(choice!.label).toContain("Development use only");
    expect(choice!.label).not.toContain("Verified");
    const lines = evidenceLines(choice!);
    const byLabel = Object.fromEntries(lines);
    expect(byLabel["Selection"]).toBe("Eligible for development use only");
    expect(byLabel["Hosted verification"]).toBe("Not verified");
    expect(lines.filter(([label]) => label === "Development evidence").map(([, value]) => value)).toEqual(capability().development_evidence);
    expect(requestTypesLabel(choice!)).toBe("Plan (PySCF energy)");
  });
  it("shows no development evidence for a standard model", () => {
    const [choice] = modelChoices(view([capability({ eligibility: "STANDARD", development_evidence: [], tool_compatibility_verified: true, status: "LIVE-VERIFIED" })]));
    expect(evidenceLines(choice!).some(([label]) => label === "Development evidence")).toBe(false);
    expect(Object.fromEntries(evidenceLines(choice!))["Selection"]).toBe("Eligible");
  });
  it("labels eligibility and recorded sampling in the researcher's words", () => {
    expect(eligibilityLabel("DEVELOPMENT")).toBe("Development use only");
    expect(eligibilityLabel(null)).toBeNull();
    expect(samplingLabel({ source: "MODEL_CARD_PROFILE", temperature: 1, top_p: 0.95, chat_template_kwargs: { enable_thinking: true, low_effort: true } }))
      .toBe("Model-card profile: temperature 1 · top-p 0.95 · reasoning enable thinking on, low effort on");
    expect(samplingLabel({ source: "SERVER_DEFAULT", temperature: 0, top_p: null, chat_template_kwargs: null })).toBe("Server default: temperature 0");
    expect(samplingLabel(null)).toBe("Not recorded");
  });
});

const row = (over: Record<string, unknown>): ModelPerformanceRow => ({
  model_provider: "nvidia", model_name: SUPER, synthetic: false,
  proposals: { validated_for_approval: 0, rejected_by_validation: 0, validity_rate: null, accepted_first_attempt: 0, repairs_before_approval: 0, unrepaired_runs: 0, rejections_by_reason: {}, ...over },
} as unknown as ModelPerformanceRow);

describe("repair statistics are validation outcomes, never correctness", () => {
  it("says none when there were no proposals", () => {
    expect(proposalsText(row({}))).toBe("none");
  });
  it("counts first attempts, repairs, reasons and unrepaired runs", () => {
    const text = proposalsText(row({ validated_for_approval: 2, rejected_by_validation: 3, accepted_first_attempt: 1, repairs_before_approval: 2, unrepaired_runs: 1, rejections_by_reason: { REQUEST_MISMATCH: 2, ARGUMENT_SCHEMA: 1 } }));
    expect(text).toContain("2 reached approval (1 on the first attempt)");
    expect(text).toContain("3 refused by validation (2 request mismatch, 1 argument schema)");
    expect(text).toContain("2 corrected after a refusal");
    expect(text).toContain("1 run ended without a valid proposal");
    expect(text).toContain("validation, not scientific correctness");
  });
});

const approval = (over: Partial<AIApprovalView> = {}): AIApprovalView => ({
  id: "approval", run_id: runId, project_id: projectId, tool_name: "calculation.submit", tool_version: "1.0.0",
  action_fingerprint: "exact-fingerprint", scientific_summary: "Run ENERGY on StructureVersion", reason: "Researcher requested calculation",
  status: "PENDING", expires_at: "2099-01-01T00:00:00Z", created_at: "2026-10-18T00:00:00Z",
  normalized_arguments: { structure_version: { entity_id: versionId, project_id: projectId }, specification: { charge: 0, multiplicity: 1, task_type: "ENERGY", engine_preference: { engine: "pyscf" }, method: { identifier: "hf" }, basis: { identifier: "sto-3g" } } },
  proposal_provenance: { provider: "nvidia", model: SUPER, eligibility: "DEVELOPMENT", repair_attempts: 1, sampling: { source: "MODEL_CARD_PROFILE", temperature: 1, top_p: 0.95, chat_template_kwargs: { enable_thinking: true } } },
  request_match: [
    { parameter: "task", outcome: "MATCH", requested: "ENERGY", proposed: "ENERGY", requested_available: true },
    { parameter: "engine", outcome: "NOT_SPECIFIED", proposed: "pyscf" },
    { parameter: "method", outcome: "MATCH", requested: "hf", proposed: "hf", requested_available: true },
    { parameter: "basis", outcome: "MATCH", requested: "sto-3g", proposed: "sto-3g", requested_available: true },
    { parameter: "charge", outcome: "AMBIGUOUS", proposed: 0 },
    { parameter: "multiplicity", outcome: "NOT_SPECIFIED", proposed: 1 },
  ],
  ...over,
} as AIApprovalView);

const render = (value: AIApprovalView) => renderToStaticMarkup(createElement(ApprovalCard, { approval: value, submitting: false, onApprove: () => {}, onReject: () => {} }));

describe("the approval screen names the model and checks the request", () => {
  it("shows who proposed, how it was sampled, how often it was corrected, and each parameter's outcome", () => {
    const html = render(approval());
    for (const text of [
      'data-testid="ai-approval-model"', SUPER, "NVIDIA", "Development use only",
      "Model-card profile: temperature 1", "Corrected 1 time after the server refused earlier proposals",
      "Request check", 'data-testid="ai-request-check"',
    ]) expect(html).toContain(text);
    const outcomes = [...html.matchAll(/data-outcome="([A-Z_]+)" data-parameter="([a-z]+)"/g)].map((m) => `${m[2]}:${m[1]}`);
    expect(outcomes).toEqual(["task:MATCH", "engine:NOT_SPECIFIED", "method:MATCH", "basis:MATCH", "charge:AMBIGUOUS", "multiplicity:NOT_SPECIFIED"]);
    expect(html).toContain("Not in your request · model chose");
    expect(html).toContain("Several named, not checked");
    expect(html).toContain("You asked <strong>Hartree–Fock (HF)</strong> · proposed <strong>Hartree–Fock (HF)</strong>");
    expect(html).toContain("Matches");
  });
  it("adds no approval block of its own when everything matches", () => {
    const html = render(approval());
    // A static render has not resolved the saved geometry yet, which is the existing, separate gate.
    expect(html).not.toContain("differs from what your message asked for");
    expect(html).toContain("Approve is unavailable until the exact saved geometry is resolved.");
    expect(html).toContain('data-testid="ai-approve-button"');
  });
  it("blocks approval and says why if a proposal ever differs from the request", () => {
    const html = render(approval({ request_match: [{ parameter: "basis", outcome: "MISMATCH", requested: "sto-3g", proposed: "6-31g", requested_available: true }] }));
    expect(html).toContain("this proposal differs from what your message asked for");
    expect(html).toContain("Differs");
    expect(html).toMatch(/data-testid="ai-approve-button"[^>]*disabled=""|disabled=""[^>]*data-testid="ai-approve-button"/);
  });
  it("is honest when no check was recorded and when the model is unknown", () => {
    const html = render(approval({ request_match: [], proposal_provenance: null }));
    expect(html).toContain("No request check was recorded for this proposal");
    expect(html).toContain("Not recorded for this proposal");
    expect(html).not.toContain("ai-approval-eligibility");
  });
  it("summarises the request check in the header and keeps the sampling in the approval record", () => {
    const html = render(approval());
    expect(html).toMatch(/data-testid="ai-request-check-summary"[^>]*>3 named parameters match your request · 2 chosen by the model · 1 not checked \(several named\)</);
    expect(html).not.toContain("<dt>Sampling</dt>");
    expect(html.indexOf("<dt>Model settings</dt>")).toBeGreaterThan(html.indexOf("Approval record"));
    expect(html.indexOf('data-testid="ai-request-check-summary"')).toBeLessThan(html.indexOf("Scientific parameters"));
    const differing = render(approval({ request_match: [{ parameter: "basis", outcome: "MISMATCH", requested: "sto-3g", proposed: "6-31g", requested_available: true }] }));
    expect(differing).toMatch(/class="ai-request-check-summary is-danger"[^>]*>1 named parameter differs from your request\. Approval is blocked</);
    expect(render(approval({ request_match: [] }))).toContain("Not recorded; compare the proposal with your request yourself");
  });
  it("does not label a standard model as development", () => {
    const html = render(approval({ proposal_provenance: { provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b", eligibility: "STANDARD", repair_attempts: 0, sampling: { source: "SERVER_DEFAULT", temperature: 0, top_p: null, chat_template_kwargs: null } } }));
    expect(html).not.toContain("Development use only");
    expect(html).toContain("Server default: temperature 0");
    expect(html).not.toContain("ai-approval-repairs");
  });
});

const blocker: ProposalBlocker = {
  code: "REQUEST_MISMATCH", summary: "The proposal does not match what the researcher asked for.", attempts: 3,
  next_step: "Correct only the listed fields.",
  issues: [
    { code: "REQUEST_MISMATCH", field: "specification.basis.identifier", message: "The researcher asked for sto-3g (basis); the proposal uses 6-31g. Use the requested value.", requested: "sto-3g", proposed: "6-31g", allowed: [] },
    { code: "REQUEST_MISMATCH", field: "specification.method.identifier", message: "The researcher asked for pbe0, which this server cannot run here. Do not substitute another method.", requested: "pbe0", allowed: ["b3lyp", "hf", "pbe"] },
  ],
};

describe("the researcher sees the actual blocker", () => {
  it("names the attempts, each field, what was asked and proposed, and what is available", () => {
    const html = renderToStaticMarkup(createElement(ProposalBlockerNotice, { blocker, onRetry: () => {}, retryDisabled: false }));
    for (const text of [
      'data-testid="ai-proposal-blocker"', 'role="alert"', "No valid proposal after 3 attempts",
      "The proposals did not match what you asked for.",
      "Basis set", "Method", "You asked <b>STO-3G</b> · proposed <b>6-31G</b>", "You asked <b>pbe0</b>",
      "Not available here.", "Available here: B3LYP, Hartree–Fock (HF), PBE", "Nothing was submitted or computed, and your request was not changed",
    ]) expect(html).toContain(text);
    expect(html.match(/Not available here\./g)).toHaveLength(1); // only the method the server cannot run
  });
  it("speaks to the researcher: the sentences written for the model are not shown for a comparison", () => {
    const html = renderToStaticMarkup(createElement(ProposalBlockerNotice, { blocker, onRetry: () => {}, retryDisabled: false }));
    for (const text of ["Do not substitute", "Use the requested value", "The researcher asked for"]) expect(html).not.toContain(text);
  });
  it("keeps the server's own sentence for an issue that has no request to compare", () => {
    const other: ProposalBlocker = { ...blocker, code: "ARGUMENT_SCHEMA", summary: "The proposal's arguments were refused.", issues: [{ code: "ARGUMENT_SCHEMA", field: "specification.charge", message: "Charge must be a whole number." }] };
    const html = renderToStaticMarkup(createElement(ProposalBlockerNotice, { blocker: other, onRetry: () => {}, retryDisabled: false }));
    expect(html).toContain("The proposal&#x27;s arguments were refused.");
    expect(html).toContain("Charge must be a whole number.");
    expect(html).not.toContain("The proposals did not match what you asked for.");
  });
  it("uses the singular and disables retry when a plan choice is pending", () => {
    const html = renderToStaticMarkup(createElement(ProposalBlockerNotice, { blocker: { ...blocker, attempts: 1, issues: [] }, onRetry: () => {}, retryDisabled: true }));
    expect(html).toContain("No valid proposal after 1 attempt<");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("ai-blocker-issues");
  });
});

describe("the one-line request check", () => {
  const items = (...outcomes: string[]) => outcomes.map((outcome) => ({ outcome }));
  it("counts what matches, what the model chose and what could not be checked", () => {
    expect(requestCheckSummary(items("MATCH", "MATCH", "MATCH", "MATCH", "MATCH", "MATCH"))).toEqual({ text: "6 named parameters match your request", tone: "ok" });
    expect(requestCheckSummary(items("MATCH", "NOT_SPECIFIED", "AMBIGUOUS")).text).toBe("1 named parameter matches your request · 1 chosen by the model · 1 not checked (several named)");
    expect(requestCheckSummary(items("NOT_SPECIFIED", "NOT_SPECIFIED")).text).toBe("Your message named no parameter to check · 2 chosen by the model");
  });
  it("puts a difference first, in danger tone, whatever else matched", () => {
    expect(requestCheckSummary(items("MATCH", "MISMATCH", "MISMATCH"))).toEqual({ text: "2 named parameters differ from your request. Approval is blocked", tone: "danger" });
    expect(requestCheckSummary(items("MISMATCH")).text).toBe("1 named parameter differs from your request. Approval is blocked");
  });
  it("says so when nothing was recorded", () => {
    expect(requestCheckSummary([])).toEqual({ text: "Not recorded; compare the proposal with your request yourself", tone: "muted" });
  });
});

describe("a refused proposal is not repeated as a failure of the run", () => {
  const step = (id: string, over: Record<string, unknown>) => ({ id, step_number: 1, step_type: "TOOL_CALL", status: "FAILED", tool_name: "calculation.submit", created_at: "now", ...over });
  const refused = (id: string) => step(id, { error_code: "TOOL_REJECTED", error_detail: "The proposal does not match what the researcher asked for." });
  const runWith = (over: Record<string, unknown>): AIRunView => ({ id: runId, project_id: projectId, conversation_id: "conversation", status: "SUCCEEDED", current_step: 1, max_steps: 20, created_at: "now", updated_at: "now", ...over } as unknown as AIRunView);
  const card = (value: AIRunView) => renderToStaticMarkup(createElement(ScientificWorkflow, { run: value, submitting: false, onResume: () => {}, onRefresh: () => {} }));
  it("shows one quiet note for refusals the run recovered from or explained", () => {
    const html = card(runWith({ steps: [refused("a"), refused("b")] }));
    expect(html).toContain('data-testid="ai-refused-proposals"');
    expect(html).toContain("ChemDFT refused 2 proposals before approval; the activity timeline lists each reason.");
    expect(html).not.toContain("TOOL_REJECTED");
    expect(html).not.toContain('role="alert"');
    expect(card(runWith({ steps: [refused("a")] }))).toContain("ChemDFT refused 1 proposal before approval");
  });
  it("leaves a run that ended without a valid proposal to its blocker notice", () => {
    const html = card(runWith({ status: "FAILED", error_code: "PROPOSAL_NOT_REPAIRED", error_detail: "No valid proposal after 3 attempts.", steps: [refused("a"), refused("b"), refused("c")], blocker }));
    expect(html).not.toContain("ai-refused-proposals");
    expect(html).not.toContain("PROPOSAL_NOT_REPAIRED");
    expect(html).not.toContain('role="alert"');
  });
  it("still reports every other failure as before", () => {
    const html = card(runWith({ status: "FAILED", error_code: "PROVIDER_TIMEOUT", error_detail: "The provider did not answer.", steps: [step("x", { error_code: "PROVIDER_TIMEOUT", error_detail: "No reply in 60 s." })] }));
    expect(html).toContain("calculation.submit: The AI provider did not answer in time. No reply in 60 s.");
    expect(html).toContain("calculation.submit: PROVIDER_TIMEOUT: No reply in 60 s.");
    expect(html).toContain("The AI provider did not answer in time. The provider did not answer.");
    expect(html).toContain("PROVIDER_TIMEOUT: The provider did not answer.");
  });
});

describe("field and value labels", () => {
  it("map server paths and parameters to the researcher's vocabulary", () => {
    expect(fieldLabel("specification.task_type")).toBe("Calculation type");
    expect(fieldLabel("structure_version.entity_id")).toBe("Structure version");
    expect(fieldLabel("specification.unknown_field")).toBe("Unknown field");
    expect(fieldLabel(null)).toBe("Proposal");
    expect(parameterLabel("multiplicity")).toBe("Spin multiplicity");
    expect(matchValueLabel("basis", "def2-svp")).toBe("def2-SVP");
    expect(matchValueLabel("multiplicity", 3)).toBe("3 (triplet)");
    expect(matchValueLabel("charge", -1)).toBe("-1");
    expect(matchValueLabel("dispersion", true)).toBe("present");
    expect(matchValueLabel("basis", null)).toBe("not set");
  });
});
