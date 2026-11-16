import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AIApprovalView, AIRunEventView, AIRunView, CalculationDetail, ResearcherGateView } from "@chemdft/schemas";
import { aiTimestamp, coordinateOriginLabel, contiguousEventSequence, mergeRunEvents, researcherGateSelection, scientificWorkflowPhase, scientificResultProvenance, scientificCalculationEnergy, SCIENTIFIC_EVENT_LABELS } from "../src/lib/ai-scientist-workflow";
import { AiApiError, decideAiApproval, getAiRun, getAiRunEvents, resumeAiRun } from "../src/lib/ai-scientist-api";
import { workspaceSelectionUrl, parseWorkspaceSelection } from "../src/lib/workspace-selection";
import { CalculationProposal, ScientificWorkflow } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientific-workflow";
import { ApprovalCard } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-panel";

vi.mock("@/app/_components/workspace-state-provider", () => ({ useOptionalWorkspaceState: () => null }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
const projectId = "11111111-1111-4111-8111-111111111111";
const candidateId = "22222222-2222-4222-8222-222222222222";
const representationId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const gate: ResearcherGateView = { step_id: "step", status: "WAITING", candidate_id: candidateId, expected_representation_id: representationId, source_document_id: "document", review_reason: "Inspect stereochemical markings and charge", requested_at: "2026-10-13T00:00:00Z" };
const run = (override: Partial<AIRunView> = {}): AIRunView => ({ id: runId, project_id: projectId, conversation_id: "conversation", status: "EXECUTING", current_step: 1, max_steps: 20, created_at: "2026-10-13T00:00:00Z", updated_at: "2026-10-13T00:00:00Z", ...override });
const event = (sequence: number, override: Partial<AIRunEventView> = {}): AIRunEventView => ({ sequence, run_id: runId, project_id: projectId, event_type: "candidate.diagram_recognized", summary: "Saved", occurred_at: "2026-10-13T00:00:00Z", ...override });
const approval: AIApprovalView = { id: "approval", run_id: runId, project_id: projectId, tool_name: "calculation.submit", tool_version: "1.0.0", action_fingerprint: "exact-fingerprint", scientific_summary: "Test scientific rationale", reason: "Researcher requested calculation", status: "PENDING", expires_at: "2099-01-01T00:00:00Z", created_at: "2026-10-13T00:00:00Z", normalized_arguments: { structure_version: { entity_id: representationId, project_id: projectId }, specification: { charge: -1, multiplicity: 2, task_type: "ENERGY", engine_preference: { engine: "pyscf" }, method: { identifier: "HF" }, basis: { identifier: "STO-3G" } } } };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("B4 persisted scientific workflow phases", () => {
  it.each([
    ["knowledge.search", "Evidence retrieval"], ["document.figures.extract", "PDF figure extraction"],
    ["structure_candidate.recognize", "Molecular recognition"], ["structure_candidate.validate_graph", "Molecular validation"],
    ["navigator.get", "Calculation planning"],
  ])("renders actual running tool %s", (tool, phase) => {
    expect(scientificWorkflowPhase(run({ steps: [{ id: "s", step_number: 1, step_type: "TOOL_CALL", status: "RUNNING", tool_name: tool, created_at: "now" }] }))).toBe(phase);
  });
  it.each([["SUCCEEDED", "Completed"], ["FAILED", "Failed"], ["CANCELED", "Canceled"], ["PAUSED", "Run paused"]] as const)("distinguishes %s", (status, text) => expect(scientificWorkflowPhase(run({ status }))).toBe(text));
  it("requires both PAUSED and an actual gate", () => {
    expect(scientificWorkflowPhase(run({ status: "PAUSED", pending_researcher_gate: gate }))).toContain("Researcher verification required");
    expect(scientificWorkflowPhase(run({ status: "CANCELED", pending_researcher_gate: gate }))).toBe("Canceled");
    expect(scientificWorkflowPhase(run({ pending_researcher_gate: gate }))).not.toContain("verification required");
  });
  it("renders approval only from the actual approval tool", () => {
    expect(scientificWorkflowPhase(run({ status: "WAITING_FOR_APPROVAL", pending_approval: approval }))).toBe("Calculation approval required");
    expect(scientificWorkflowPhase(run({ status: "WAITING_FOR_APPROVAL" }))).toBe("Action approval required");
  });
  it.each([["QUEUED", "Calculation queued"], ["RUNNING", "Calculation running"], ["SUCCEEDED", "Calculation completed"], ["FAILED", "Calculation failed"]])("uses persisted calculation state %s", (state, phase) => {
    expect(scientificWorkflowPhase(run({ status: "WAITING_FOR_CALCULATION" }), { calculation: { state } } as CalculationDetail)).toBe(phase);
  });
  it("does not call submitted calculations running without records", () => expect(scientificWorkflowPhase(run({ status: "WAITING_FOR_CALCULATION" }))).toContain("retrieving execution status"));
  it("labels generated conformers from recorded provenance only", () => {
    expect(coordinateOriginLabel("GENERATED_CONFORMER")).toBe("GENERATED CONFORMER — NOT QM OPTIMIZED");
    expect(coordinateOriginLabel("USER_IMPORTED_FILE")).toContain("not verified by ChemDFT");
    expect(coordinateOriginLabel("USER_IMPORTED_FILE")).not.toContain("NOT QM OPTIMIZED");
    expect(coordinateOriginLabel(undefined)).toBe("Coordinate origin unavailable");
  });
  it("labels persisted result provenance without numeric claims", () => {
    expect(scientificResultProvenance({ result: null } as CalculationDetail)).toBe("No persisted engine result available");
    expect(scientificResultProvenance({ result: { id: "engine-record" } } as unknown as CalculationDetail)).toContain("persisted engine record engine-record");
  });
});

describe("B4 scientific replay", () => {
  it("orders and suppresses duplicate sequence identities", () => {
    const result = mergeRunEvents([event(3), event(1)], [event(2), event(1)], projectId, runId);
    expect(result.map(row => row.sequence)).toEqual([1, 2, 3]);
    expect(contiguousEventSequence(result)).toBe(3);
  });
  it("recovers gaps without advancing past missing events", () => {
    const missing = mergeRunEvents([], [event(1), event(3)], projectId, runId);
    expect(contiguousEventSequence(missing)).toBe(1);
    expect(contiguousEventSequence(mergeRunEvents(missing, [event(2)], projectId, runId))).toBe(3);
  });
  it("rejects context from other projects and runs", () => expect(mergeRunEvents([], [event(1, { run_id: "other" }), event(2, { project_id: "other" }), event(-1)], projectId, runId)).toEqual([]));
  it("names all five B4 events without promoting recognition to verification", () => {
    expect(Object.keys(SCIENTIFIC_EVENT_LABELS)).toHaveLength(10);
    expect(SCIENTIFIC_EVENT_LABELS["candidate.diagram_recognized"]).toContain("unverified");
  });
  it("requests the backend's replay cursor", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"events":[]}'));
    vi.stubGlobal("fetch", fetcher);
    await getAiRunEvents(projectId, runId, 1000);
    expect(fetcher.mock.calls[0]![0]).toContain("after_sequence=1000");
  });
});

// Explicitly synthetic contracts: these tests prove rendering guards, never engine execution.
function syntheticEnergy(): CalculationDetail {
  return {
    calculation: { id: "calc", project_id: projectId, input_id: "input", state: "SUCCEEDED" },
    compute_job: { state: "SUCCEEDED" },
    specification: { task_type: "ENERGY", engine_preference: { engine: "pyscf" }, method: { identifier: "hf" }, basis: { identifier: "sto-3g" } },
    result: { id: "result", project_id: projectId, calculation_id: "calc", calculation_input_id: "input", authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED", source_class: "CALCULATED", result_type: "chemdft.energy",
      effective_state: { authority: "AUTHORITATIVE", validation_state: "VALIDATED", source_lineage_validity: "ACTIVE", eligible_for_derivation: true },
      producer_software: { name: "pyscf", version: "test-fixture" },
      payload: { payload_schema: "chemdft.energy", converged: true, method: "hf", basis: "sto-3g", total_energy: { value: -1.1, unit: { code: "Eh", dimension: "ENERGY" } } } },
  } as unknown as CalculationDetail;
}
describe("B4.2 numerical presentation guards (synthetic contracts)", () => {
  it("reads the persisted quantity with current authority, independently unverified", () => {
    expect(scientificCalculationEnergy(syntheticEnergy(), projectId, "calc")?.total_energy.value).toBe(-1.1);
  });
  it.each(["missing", "foreign-project", "foreign-calculation", "foreign-input", "failed", "inactive", "missing-effective-state", "engine", "unit", "method", "nonconverged", "nonfinite"])("hides values when %s", corruption => {
    const detail = syntheticEnergy();
    const value = detail as unknown as { calculation: { state: string }; result: { project_id: string; calculation_id: string; calculation_input_id: string; effective_state: object | null; producer_software: { name: string }; payload: { converged: boolean; method: string; total_energy: { value: number; unit: { code: string } } } } | null };
    if (corruption === "missing") value.result = null;
    else if (value.result) {
      if (corruption === "foreign-project") value.result.project_id = "foreign";
      if (corruption === "foreign-calculation") value.result.calculation_id = "foreign";
      if (corruption === "foreign-input") value.result.calculation_input_id = "foreign";
      if (corruption === "failed") value.calculation.state = "FAILED";
      if (corruption === "inactive") value.result.effective_state = { authority: "CANDIDATE", source_lineage_validity: "RETRACTED" };
      if (corruption === "missing-effective-state") value.result.effective_state = null;
      if (corruption === "engine") value.result.producer_software.name = "unapproved";
      if (corruption === "unit") value.result.payload.total_energy.unit.code = "eV";
      if (corruption === "method") value.result.payload.method = "unapproved";
      if (corruption === "nonconverged") value.result.payload.converged = false;
      if (corruption === "nonfinite") value.result.payload.total_energy.value = NaN;
    }
    expect(scientificCalculationEnergy(detail, projectId, "calc")).toBeNull();
  });
});

describe("B4 human review and calculation UI", () => {
  it("hands off exact candidate, representation and project through a refreshable URL", () => {
    const selection = researcherGateSelection(projectId, gate);
    expect(selection).toEqual({ kind: "candidateRepresentation", id: representationId, sourceId: candidateId, projectId });
    const url = workspaceSelectionUrl("http://localhost/en/workspace", selection);
    expect(parseWorkspaceSelection(new URL(url, "http://localhost").search, projectId)).toEqual(selection);
  });
  it("renders unverified proposal and explicit human gate even without chat history", () => {
    const html = renderToStaticMarkup(createElement(ScientificWorkflow, { run: run({ status: "PAUSED", pending_researcher_gate: gate }), submitting: false, onResume: () => {}, onRefresh: () => {} }));
    for (const text of ["UNVERIFIED MOLECULAR PROPOSAL", "Researcher verification required", candidateId, representationId, gate.review_reason, "Inspect &amp; Correct in Ketcher", "never resumes automatically", 'aria-live="polite"']) expect(html).toContain(text);
  });
  it("renders actual calculation parameters and missing estimates", () => {
    const html = renderToStaticMarkup(createElement(CalculationProposal, { approval }));
    for (const text of [representationId, "HF", "STO-3G", "pyscf", "ENERGY", "-1", "Estimate unavailable", "Checking engine availability…", "does not establish the physical spin state", "not an optimized or experimental geometry"]) expect(html).toContain(text);
    expect(html).not.toContain("Predicted energy");
  });
  it.each(["REJECTED", "EXPIRED", "APPROVED"] as const)("disables decisions for %s approval", status => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { approval: { ...approval, status }, submitting: false, onApprove: () => {}, onReject: () => {} }));
    expect(html.match(/disabled=""/g)?.length).toBe(2);
    expect(html).toContain(status);
  });
  it("disables both buttons during submission", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { approval, submitting: true, onApprove: () => {}, onReject: () => {} }));
    expect(html.match(/disabled=""/g)?.length).toBe(2);
    expect(html).toContain("exact-fingerprint");
  });
});

describe("B4 API conflicts, authorization and exact decisions", () => {
  it.each(["APPROVE", "REJECT"] as const)("sends exact %s enum without changing fingerprint-bound arguments", async decision => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetcher);
    await decideAiApproval(projectId, approval.id, { decision });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toContain(`/ai/approvals/${approval.id}/decision`);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ decision });
  });
  it.each(["RESEARCHER_GATE_PENDING", "RESEARCHER_GATE_REPRESENTATION_MISMATCH", "RESEARCHER_GATE_PROMOTION_MISMATCH", "RESEARCHER_GATE_CANDIDATE_REJECTED", "AUTHORITATIVE_STRUCTURE_VERSION_MISSING", "INVALID_RUN_STATE"])("retains HTTP 409 and %s without retry", async code => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code, message: "Review refused" } }), { status: 409 })); vi.stubGlobal("fetch", fetcher);
    await expect(resumeAiRun(projectId, runId)).rejects.toMatchObject({ status: 409, code, message: expect.stringContaining("Context retained") });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])("explains authorization denial %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"Permission denied"}', { status })));
    await expect(getAiRun(projectId, runId)).rejects.toThrow("Authorization denied");
  });
  it("preserves mixed backend detail strings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"Approval expired"}', { status: 409 })));
    await expect(decideAiApproval(projectId, approval.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(AiApiError);
  });
  it("describes timeout uncertainty and does not retry", async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException("Timeout", "TimeoutError")); vi.stubGlobal("fetch", fetcher);
    await expect(resumeAiRun(projectId, runId)).rejects.toThrow("may still be executing");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

 it("interprets naive backend approval expiry as UTC, preserving explicit offsets", () => {
   expect(aiTimestamp("2026-10-13T11:49:11.561454")).toBe(Date.parse("2026-10-13T11:49:11.561Z"));
   expect(aiTimestamp("2026-10-13T15:49:11+04:00")).toBe(Date.parse("2026-10-13T11:49:11Z"));
 });
