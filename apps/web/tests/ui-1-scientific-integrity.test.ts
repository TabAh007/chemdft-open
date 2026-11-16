// @vitest-environment jsdom
/**
 * UI-1 scientific-integrity regression tests. Category: STATIC/COMPONENT tests in jsdom with
 * mocked network functions; the Result Firewall helpers, geometry binding, planning-profile
 * selection and status derivation under test are the real production code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cloneElement, createElement, Fragment, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  AICitation, AIApprovalView, AIMessageView, AIRunView, AISettingsView, CalculationDetail,
  EngineCapabilityView, ProductContext, StructureVersionDetail,
} from "@chemdft/schemas";

const api = vi.hoisted(() => ({
  getCalculation: vi.fn(), cancelCalculation: vi.fn(), listStructures: vi.fn(), listStructureVersions: vi.fn(),
  listCalculationCapabilities: vi.fn(), getAiSettings: vi.fn(), saveAiSettings: vi.fn(), postAiMessage: vi.fn(),
  getProductContext: vi.fn(), createAiConversation: vi.fn(), listAiConversations: vi.fn(),
  getAiModelPerformance: vi.fn(), getAiConversation: vi.fn(), getAiRun: vi.fn(), decideAiApproval: vi.fn(),
  workspace: { catalog: [] as unknown[], openSelection: vi.fn(), unsavedWork: false } as Record<string, unknown> | null,
  capabilities: { capabilities: [] as EngineCapabilityView[], loading: false, error: null as string | null },
}));

vi.mock("@/lib/structure-workspace-api", () => ({
  getCalculation: api.getCalculation, cancelCalculation: api.cancelCalculation,
  listStructures: api.listStructures, listStructureVersions: api.listStructureVersions,
  listCalculationCapabilities: api.listCalculationCapabilities,
}));
vi.mock("@/lib/use-calculation-capabilities", () => ({
  useCalculationCapabilities: () => ({ ...api.capabilities, refresh: vi.fn() }),
}));
vi.mock("@/lib/ai-scientist-api", () => ({
  getAiSettings: api.getAiSettings, saveAiSettings: api.saveAiSettings, postAiMessage: api.postAiMessage,
  getAiModelPerformance: api.getAiModelPerformance,
  getProductContext: api.getProductContext, getProductContextOrFallback: api.getProductContext, createAiConversation: api.createAiConversation,
  listAiConversations: api.listAiConversations, getAiConversation: api.getAiConversation, getAiRun: api.getAiRun,
  getAiRunEvents: vi.fn().mockResolvedValue({ events: [] }), cancelAiRun: vi.fn(), pauseAiRun: vi.fn(),
  resumeAiRun: vi.fn(), decideAiApproval: api.decideAiApproval,
}));
vi.mock("@/lib/investigations-api", () => ({
  listInvestigations: vi.fn().mockResolvedValue({ investigations: [] }), createInvestigation: vi.fn(),
  decideInvestigationApproval: vi.fn(), startInvestigation: vi.fn(),
}));
vi.mock("@/app/_components/workspace-state-provider", () => ({ useOptionalWorkspaceState: () => api.workspace }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
vi.mock("@chemdft/ui", () => ({
  AppIcon: () => null,
  // A controlled popover: the trigger toggles it and the content renders only while it is open.
  AppPopover: ({ children, content, isOpen, onInteraction }: { children: ReactElement; content: ReactNode; isOpen?: boolean; onInteraction?: (next: boolean) => void }) =>
    createElement(Fragment, null, cloneElement(children, { onClick: () => onInteraction?.(!isOpen) } as never), isOpen ? content : null),
  PopupKind: { DIALOG: "dialog" },
  StatusTag: ({ children }: { children: ReactNode }) => createElement("span", { "data-role": "status-tag" }, children),
  ActionButton: ({ text, disabled, onClick, type, title, "data-testid": testId, "aria-describedby": describedBy }: {
    text: string; title?: string; disabled?: boolean; onClick?: () => void; type?: "submit" | "button"; "data-testid"?: string; "aria-describedby"?: string;
  }) => createElement("button", { disabled, onClick, title, type: type ?? "button", "data-testid": testId, "aria-describedby": describedBy }, text),
}));
vi.mock("../src/app/[locale]/projects/[projectId]/workspace/visualization/energy-precision-plate", () => ({ EnergyPrecisionPlate: () => null }));

import { buildRunTimeline, calculationNeedsPolling } from "../src/lib/ai-run-timeline";
import { buildEvidenceRecords, passageState } from "../src/lib/ai-evidence-records";
import { scientificWorkflowPhase } from "../src/lib/ai-scientist-workflow";
import { basisLabel, expiryCountdown, humanizeDetail, methodLabel, modelDisplayName, multiplicityLabel, taskLabel } from "../src/lib/scientific-labels";
import { ApprovalCard, AIScientistPanel } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-panel";
import { AIScientistRunsTab, RUN_POLL_INTERVAL_MS } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-runs-tab";
import { AIScientistToolsTab, resolveToolStatus } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-tools-tab";
import { AIScientistEvidenceTab } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-evidence-tab";
import { resolveAiContext } from "../src/lib/ai-context";
import { plainAiError } from "../src/lib/ai-plain-errors";
import { CHAT_REPLY_NOTE } from "../src/lib/ai-chat-reply";
import { AIScientistStatusBar } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-status-bar";
import { AIScientistSettingsTab, modelChoices } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-settings-tab";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "99999999-9999-4999-8999-999999999999";
const structureId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
  return container;
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
const byTestId = (id: string) => container!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const buttonByText = (text: string) => [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  api.workspace = { catalog: [], openSelection: vi.fn(), unsavedWork: false };
  api.capabilities = { capabilities: [], loading: false, error: null };
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null; container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------- fixtures
function aiRun(overrides: Partial<AIRunView>): AIRunView {
  return { id: "44444444-4444-4444-8444-444444444444", project_id: projectId, conversation_id: "conv-1", status: "PLANNING",
    current_step: 1, max_steps: 10, created_at: "2026-10-16T12:00:00Z", updated_at: "2026-10-16T12:00:00Z", ...overrides } as AIRunView;
}

/** A record that satisfies every Result Firewall check unless an override breaks one. */
function calculation(id: string, overrides: { state?: string; jobState?: string; result?: unknown; created?: string; project?: string; diagnostic?: string } = {}): CalculationDetail {
  const project = overrides.project ?? projectId;
  const result = overrides.result === undefined ? energyResult(id, project) : overrides.result;
  return {
    calculation: { id, project_id: project, input_id: `input-${id}`, state: overrides.state ?? "SUCCEEDED",
      created_at: overrides.created ?? "2026-10-16T10:00:00Z", updated_at: overrides.created ?? "2026-10-16T10:05:00Z", created_by: "user-1" },
    calculation_input_hash: "hash",
    specification: { task_type: "ENERGY", method: { identifier: "HF" }, basis: { identifier: "STO-3G" }, engine_preference: { engine: "pyscf" }, charge: 0, multiplicity: 1 },
    compute_job: { state: overrides.jobState ?? (overrides.state && overrides.state !== "SUCCEEDED" ? overrides.state : "SUCCEEDED") },
    attempt: overrides.diagnostic ? { diagnostic: overrides.diagnostic, attempt_number: 1, calculation_id: id } : null,
    result,
  } as unknown as CalculationDetail;
}
function energyResult(id: string, project = projectId, authoritative = true) {
  return {
    id: `result-${id}`, project_id: project, calculation_id: id, calculation_input_id: `input-${id}`,
    source_class: "CALCULATED", result_type: "chemdft.energy", producer_software: { name: "pyscf", version: "2.14.0" },
    effective_state: { authority: authoritative ? "AUTHORITATIVE" : "CANDIDATE", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
      source_lineage_validity: "ACTIVE", eligible_for_derivation: true, stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED" },
    payload: { payload_schema: "chemdft.energy", total_energy: { value: -1.1167593073964255, unit: { code: "Eh", dimension: "ENERGY" } }, converged: true, method: "hf", basis: "sto-3g" },
  };
}

const proposalArguments = {
  structure_version: { entity_type: "structure.version", entity_id: versionId, project_id: projectId },
  specification: { charge: 0, multiplicity: 1, task_type: "ENERGY", engine_preference: { engine: "pyscf" }, method: { identifier: "hf" }, basis: { identifier: "sto-3g" } },
};
function approval(overrides: Partial<AIApprovalView> = {}): AIApprovalView {
  return { id: "appr-1", run_id: "run-1", project_id: projectId, tool_name: "calculation.submit", tool_version: "1.0.0",
    action_fingerprint: "fingerprint-abc", scientific_summary: "PySCF HF/STO-3G energy for the selected version", reason: "Requested by researcher",
    status: "PENDING", expires_at: "2099-01-01T00:00:00Z", created_at: "2026-10-16T12:00:00Z", estimated_compute: null,
    normalized_arguments: proposalArguments, ...overrides } as AIApprovalView;
}
function savedVersion(id = versionId, project = projectId): StructureVersionDetail {
  return {
    structure: { id: structureId, project_id: project, name: "H2" },
    version: { id, project_id: project, structure_id: structureId, overall_charge: 0, multiplicity: 1, provenance: { coordinate_origin: "IMPORTED" },
      coordinates: { structure_version_id: id, unit: "angstrom", source: { project_id: project, entity_type: "structure.version", entity_id: id },
        atoms: [{ index: 0, element: "H", atomic_number: 1, x: 0, y: 0, z: -0.37 }, { index: 1, element: "H", atomic_number: 1, x: 0, y: 0, z: 0.37 }] } },
  } as unknown as StructureVersionDetail;
}
function message(id: string, citations: AICitation[] = [], evidence: unknown[] = []): AIMessageView {
  return { id, conversation_id: "conv-1", role: "assistant", content: "answer", created_at: "2026-10-16T12:00:00Z", citations, evidence } as unknown as AIMessageView;
}

// ---------------------------------------------------------------- Runs: data model
describe("Runs timeline (P0-1, P0-2, section 5)", () => {
  it("keeps AI planning distinct from calculations and never invents progress, methods or engines", () => {
    const [item] = buildRunTimeline({ projectId, catalogCalculations: [], calculationDetails: {}, aiRuns: [aiRun({ status: "PLANNING" })] });
    expect(item).toMatchObject({ kind: "AI_RUN", phase: "AI_PLANNING", engine: null, method: null, energyText: null, calculationId: null });
    expect(JSON.stringify(item)).not.toMatch(/SCF|45|%|current session/i);
  });

  it("maps every AI and job state to a distinct phase", () => {
    // A rejected proposal is reported as rejected (persisted APPROVAL_REQUEST step), never as a completed calculation.
    const rejected = aiRun({ status: "SUCCEEDED", steps: [{ id: "a", step_number: 2, step_type: "APPROVAL_REQUEST", status: "REJECTED", tool_name: "calculation.submit", created_at: "2026-10-16T11:00:00Z" }] as NonNullable<AIRunView["steps"]> });
    expect(buildRunTimeline({ projectId, catalogCalculations: [], calculationDetails: {}, aiRuns: [rejected] })[0]?.resultSummary).toBe("Proposal rejected by you — nothing was submitted");
    expect(scientificWorkflowPhase(rejected)).toBe("Proposal rejected · nothing submitted");
    expect(scientificWorkflowPhase(aiRun({ status: "SUCCEEDED" }))).toBe("Completed");
    const phases = (status: string) => buildRunTimeline({ projectId, catalogCalculations: [], calculationDetails: {}, aiRuns: [aiRun({ status: status as AIRunView["status"] })] })[0]?.phase;
    expect(phases("WAITING_FOR_APPROVAL")).toBe("AWAITING_APPROVAL");
    expect(phases("PAUSED")).toBe("PAUSED");
    expect(phases("SUCCEEDED")).toBe("PLANNING_COMPLETE");
    expect(phases("CANCELED")).toBe("CANCELED");
    const calc = (state: string) => buildRunTimeline({ projectId, catalogCalculations: [{ id: "c" }], calculationDetails: { c: calculation("c", { state, result: null }) }, aiRuns: [] })[0]?.phase;
    expect(calc("QUEUED")).toBe("QUEUED");
    expect(calc("RUNNING")).toBe("RUNNING");
    expect(calc("FAILED")).toBe("FAILED");
    expect(calc("CANCELED")).toBe("CANCELED");
    expect(calc("DRAFT")).toBe("DRAFT");
  });

  it("shows an energy only for a record that passes the Result Firewall, at full stored precision", () => {
    const [item] = buildRunTimeline({ projectId, catalogCalculations: [{ id: "c1" }], calculationDetails: { c1: calculation("c1") }, aiRuns: [] });
    expect(item).toMatchObject({ phase: "VALIDATED_RESULT", energyText: "-1.1167593073964255 Eh", engine: "PySCF 2.14.0", method: "Hartree–Fock (HF) / STO-3G" });
  });

  it("Result Firewall rejection: a non-authoritative result is completed but shows no energy", () => {
    const rejected = calculation("c2", { result: energyResult("c2", projectId, false) });
    const [item] = buildRunTimeline({ projectId, catalogCalculations: [{ id: "c2" }], calculationDetails: { c2: rejected }, aiRuns: [] });
    expect(item?.phase).toBe("COMPLETED");
    expect(item?.energyText).toBeNull();
    expect(item?.resultSummary).toMatch(/not currently authoritative/);
  });

  it("missing calculation provenance: a succeeded record without a persisted result is not presented as a result", () => {
    const [item] = buildRunTimeline({ projectId, catalogCalculations: [{ id: "c3" }], calculationDetails: { c3: calculation("c3", { result: null }) }, aiRuns: [] });
    expect(item).toMatchObject({ phase: "COMPLETED", energyText: null, resultSummary: "No persisted result record" });
  });

  it("does not call a validated non-energy result invalid", () => {
    const geometry = { ...energyResult("c4"), result_type: "chemdft.geometry-optimization", payload: { payload_schema: "chemdft.geometry-optimization" } };
    const [item] = buildRunTimeline({ projectId, catalogCalculations: [{ id: "c4" }], calculationDetails: { c4: calculation("c4", { result: geometry }) }, aiRuns: [] });
    expect(item?.phase).toBe("VALIDATED_RESULT");
    expect(item?.energyText).toBeNull();
    expect(item?.resultSummary).toMatch(/Validated chemdft.geometry-optimization result — no total energy/);
  });

  it("orders by persisted creation time, de-duplicates the calculation and keeps the planning run", () => {
    const run = aiRun({ id: "run-linked", status: "WAITING_FOR_CALCULATION", waiting_calculation_id: "c-new", created_at: "2026-10-16T11:00:00Z" });
    const items = buildRunTimeline({
      projectId,
      catalogCalculations: [{ id: "c-old" }, { id: "c-new" }, { id: "c-unread" }],
      calculationDetails: { "c-old": calculation("c-old", { created: "2026-10-15T09:00:00Z" }), "c-new": calculation("c-new", { state: "RUNNING", created: "2026-10-16T11:01:00Z", result: null }) },
      aiRuns: [run],
    });
    expect(items.map((item) => item.key)).toEqual(["calculation:c-new", "ai-run:run-linked", "calculation:c-old", "calculation:c-unread"]);
    expect(items.filter((item) => item.calculationId === "c-new")).toHaveLength(1);
    expect(items[1]).toMatchObject({ linkedCalculationId: "c-new", calculationId: null });
    expect(items[3]?.phase).toBe("LOADING");
  });

  it("excludes calculations and runs that belong to another project", () => {
    const items = buildRunTimeline({ projectId, catalogCalculations: [{ id: "foreign" }],
      calculationDetails: { foreign: calculation("foreign", { project: otherProjectId }) }, aiRuns: [aiRun({ project_id: otherProjectId })] });
    expect(items).toEqual([]);
  });

  it("reports the recorded failure diagnostic and never guesses a convergence failure", () => {
    const [withReason] = buildRunTimeline({ projectId, catalogCalculations: [{ id: "f" }], calculationDetails: { f: calculation("f", { state: "FAILED", result: null, diagnostic: "Engine exited 137" }) }, aiRuns: [] });
    const [noReason] = buildRunTimeline({ projectId, catalogCalculations: [{ id: "g" }], calculationDetails: { g: calculation("g", { state: "FAILED", result: null }) }, aiRuns: [] });
    expect(withReason?.errorMessage).toBe("Engine exited 137");
    expect(noReason?.errorMessage).toBeNull();
  });

  it("polls only records whose state can still change", () => {
    expect(calculationNeedsPolling(undefined)).toBe(true);
    expect(calculationNeedsPolling(calculation("a", { state: "RUNNING", result: null }))).toBe(true);
    expect(calculationNeedsPolling(calculation("b"))).toBe(false);
    expect(calculationNeedsPolling(calculation("c", { state: "FAILED", result: null }))).toBe(false);
  });
});

// ---------------------------------------------------------------- Runs: component behaviour
describe("Runs tab interactions", () => {
  it("reads terminal calculations once and re-reads active ones until they finish", async () => {
    vi.useFakeTimers();
    api.workspace = { catalog: [
      { label: "Done", selection: { kind: "calculation", id: "done", projectId } },
      { label: "Active", selection: { kind: "calculation", id: "active", projectId } },
    ], openSelection: vi.fn() };
    let activeReads = 0;
    api.getCalculation.mockImplementation(async ({ calculationId }: { calculationId: string }) => {
      if (calculationId === "done") return calculation("done");
      activeReads += 1;
      return activeReads < 3 ? calculation("active", { state: "RUNNING", result: null }) : calculation("active");
    });
    await render(createElement(AIScientistRunsTab, { projectId }));
    await flush();
    for (let tick = 0; tick < 4; tick += 1) { await act(async () => { await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS); }); }
    const reads = (id: string) => api.getCalculation.mock.calls.filter(([args]) => args.calculationId === id).length;
    expect(reads("done")).toBe(1);
    expect(reads("active")).toBe(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS * 3); });
    expect(reads("active")).toBe(3);
  });

  it("gives AI-only runs a real action and opens the clicked calculation, not the current selection", async () => {
    const openChat = vi.fn();
    const viewResults = vi.fn();
    api.workspace = { catalog: [{ label: "H2 energy", selection: { kind: "calculation", id: "calc-9", projectId } }], openSelection: vi.fn() };
    api.getCalculation.mockResolvedValue(calculation("calc-9"));
    await render(createElement(AIScientistRunsTab, { projectId, activeRun: aiRun({ status: "SUCCEEDED" }), onOpenChat: openChat, onViewResults: viewResults }));
    await flush();
    const aiCard = byTestId(`ai-run-item-${aiRun({}).id}`)!;
    expect(aiCard.textContent).toContain("Planning complete — no calculation submitted");
    expect([...aiCard.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Open in Chat"]);
    await act(async () => { buttonByText("Open in Chat")!.click(); });
    expect(openChat).toHaveBeenCalledOnce();
    await act(async () => { buttonByText("View results")!.click(); });
    expect(api.workspace.openSelection).toHaveBeenCalledWith({ kind: "calculation", projectId, id: "calc-9" }, "H2 energy");
    expect(viewResults).toHaveBeenCalledWith("calc-9");
    expect(container!.textContent).toContain("Total energy -1.1167593073964255 Eh");
  });
});

// ---------------------------------------------------------------- Approval card
describe("Approval card safety boundaries (P0-3, P0-4)", () => {
  async function renderCard(value: AIApprovalView, versions: StructureVersionDetail[] = [savedVersion()]) {
    api.listStructures.mockResolvedValue([{ id: structureId }]);
    api.listStructureVersions.mockResolvedValue(versions);
    api.listCalculationCapabilities.mockResolvedValue([]);
    const onApprove = vi.fn();
    await render(createElement(ApprovalCard, { approval: value, submitting: false, onApprove, onReject: vi.fn() }));
    await flush(); await flush();
    return { onApprove, approve: byTestId("ai-approve-button") as HTMLButtonElement };
  }

  it("puts the decision context under the title: request, recorded compute preference, estimate and expiry", async () => {
    api.listStructures.mockResolvedValue([{ id: structureId }]);
    api.listStructureVersions.mockResolvedValue([savedVersion()]);
    api.listCalculationCapabilities.mockResolvedValue([]);
    await render(createElement(ApprovalCard, { approval: approval({ normalized_arguments: { ...proposalArguments, provider_preference: "AUTO" } }),
      submitting: false, onApprove: vi.fn(), onReject: vi.fn(), request: "Calculate the HF/STO-3G energy for H2." }));
    await flush(); await flush();
    const context = byTestId("ai-approval-context")!.textContent!;
    expect(context).toContain("Your requestCalculate the HF/STO-3G energy for H2.");
    expect(context).toContain("Automatic — chosen by the server at submission");
    expect(context).toContain("Unavailable — none recorded");
    expect(byTestId("ai-approval-countdown")!.closest(".ai-approval-screen-header")).not.toBeNull();
    expect(byTestId("ai-proposal-decision-summary")!.textContent).toContain("· compute: automatic");
  });

  it("enables approval only after the exact bound geometry resolves, and shows only bound arguments", async () => {
    const { onApprove, approve } = await renderCard(approval());
    expect(approve.disabled).toBe(false);
    expect(byTestId("ai-proposal-argument-check")!.textContent).toContain("Exact saved geometry resolved");
    expect(byTestId("ai-proposal-decision-summary")!.textContent).toBe("Approving submits: PySCF · Hartree–Fock (HF) / STO-3G · Single-point energy · charge 0 · multiplicity 1 (singlet) · H2");
    expect(byTestId("ai-approve-blocked-reason")).toBeNull();
    expect(container!.textContent).not.toMatch(/Low \(CPU\)|Input validation: Passed|h2-reference/);
    await act(async () => { approve.click(); });
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("mismatched geometry context: a version from another project or id blocks approval", async () => {
    const { approve } = await renderCard(approval(), [savedVersion("44444444-0000-4000-8000-000000000000")]);
    expect(approve.disabled).toBe(true);
    expect(byTestId("ai-proposal-argument-check")!.textContent).toContain("approval blocked");
    expect(byTestId("ai-approve-blocked-reason")!.textContent).toContain("until the exact saved geometry is resolved");
    const foreign = await (async () => { await act(async () => { root!.unmount(); }); container!.remove(); return renderCard(approval(), [savedVersion(versionId, otherProjectId)]); })();
    expect(foreign.approve.disabled).toBe(true);
  });

  it("malformed proposal: a non-object specification cannot be approved", async () => {
    const { approve } = await renderCard(approval({ normalized_arguments: { ...proposalArguments, specification: "HF/STO-3G" } }));
    expect(approve.disabled).toBe(true);
    expect(container!.textContent).toContain("Missing required proposal information");
  });

  it("missing or mistyped scientific parameters block approval and are never back-filled", async () => {
    const spec = { ...proposalArguments.specification } as Record<string, unknown>;
    delete spec.method;
    spec.charge = "0";
    const { approve } = await renderCard(approval({ normalized_arguments: { ...proposalArguments, specification: spec } }));
    expect(approve.disabled).toBe(true);
    expect(container!.textContent).not.toContain("Hartree-Fock");
    expect(container!.querySelectorAll(".ai-proposal-missing").length).toBeGreaterThanOrEqual(2);
  });

  it("a missing method blocks approval even when the bound geometry resolves", async () => {
    const spec = { ...proposalArguments.specification } as Record<string, unknown>;
    delete spec.method;
    const { approve } = await renderCard(approval({ normalized_arguments: { ...proposalArguments, specification: spec } }));
    expect(byTestId("ai-proposal-argument-check")!.textContent).toContain("Incomplete or malformed");
    expect(container!.querySelector('[data-testid="ai-approval-geometry"]')).not.toBeNull();
    expect(approve.disabled).toBe(true);
  });

  it("expired or already-decided approvals cannot be approved", async () => {
    const expired = await renderCard(approval({ expires_at: "2020-01-01T00:00:00Z" }));
    expect(expired.approve.disabled).toBe(true);
    expect(byTestId("ai-approve-blocked-reason")!.textContent).toContain("expired");
    await act(async () => { root!.unmount(); }); container!.remove();
    const decided = await renderCard(approval({ status: "REJECTED" as AIApprovalView["status"] }));
    expect(decided.approve.disabled).toBe(true);
  });

  it("does not invent a tool version or compute estimate", async () => {
    await renderCard(approval({ estimated_compute: null }));
    expect(container!.textContent).toContain("Estimate unavailable");
    expect(container!.textContent).toContain("calculation.submit 1.0.0");
  });
});

// ---------------------------------------------------------------- Evidence
describe("Evidence and provenance (P0-5, section 9)", () => {
  it("maps every recorded verification state and only says Verified for VERIFIED", () => {
    expect(passageState({ verification_state: "VERIFIED" })).toBe("Verified");
    expect(passageState({ verification_state: "UNVERIFIED" })).toBe("Not independently verified");
    expect(passageState({ verification_state: null })).toBe("Not independently verified");
    expect(passageState({ verification_state: "RETRACTED" })).toBe("Retracted");
    expect(passageState({ verification_state: "DISPUTED" })).toBe("Disputed");
    expect(passageState({ verification_state: "SUPERSEDED" })).toBe("Superseded");
    expect(passageState({ verification_state: "VERIFIED", available: false })).toBe("Source unavailable");
  });

  it("keeps identical citation ids from different answers as distinct sources", () => {
    const e1 = (entity: string): AICitation => ({ citation_id: "E1", citation_type: "DOCUMENT", entity_id: entity, label: `Doc ${entity}`, reference_text: "p" } as AICitation);
    const records = buildEvidenceRecords([message("m1", [e1("doc-a")]), message("m2", [e1("doc-b")])]);
    expect(records.map((record) => record.citation?.entity_id)).toEqual(["doc-a", "doc-b"]);
  });

  it("labels candidates as unreviewed and never promotes project records to Verified", () => {
    const records = buildEvidenceRecords(
      [message("m1", [{ citation_id: "P1", citation_type: "STRUCTURE", entity_id: "cand-1", label: "Candidate", reference_text: "r", source_record_type: "structureCandidate" } as AICitation])],
      [{ label: "Draft", selection: { kind: "structureCandidate", id: "cand-2", projectId } as never }, { label: "Calc", selection: { kind: "calculation", id: "c", projectId } as never }],
    );
    expect(records.map((record) => record.state)).toEqual(["Candidate · unreviewed", "Candidate · unreviewed", "Not assessed"]);
    expect(records.some((record) => record.state === "Verified")).toBe(false);
  });

  it("opens a cited source through the original citation record", async () => {
    const citation = { citation_id: "E3", citation_type: "DOCUMENT", entity_id: "doc-7", label: "Methods paper", reference_text: "x", page_number: 4, source_anchor_id: "a-1" } as AICitation;
    const onOpenCitation = vi.fn();
    await render(createElement(AIScientistEvidenceTab, { projectId, conversationMessages: [message("m1", [citation], [{ citation_id: "E3", verification_state: "RETRACTED", source_title: "Methods paper", passage: "text", page_number: 4, source_type: "PDF", knowledge_chunk_id: "k", knowledge_item_id: "i" }])], onOpenCitation }));
    expect(byTestId("ai-evidence-state")!.textContent).toBe("Retracted");
    await act(async () => { (container!.querySelector('[aria-label="Open source: Methods paper"]') as HTMLButtonElement).click(); });
    expect(onOpenCitation).toHaveBeenCalledWith(citation);
  });
});

// ---------------------------------------------------------------- Tools
describe("Tool availability (section 8)", () => {
  const pyscf: EngineCapabilityView = { engine: "pyscf", availability: "AVAILABLE", version: "2.14.0", supported_tasks: ["ENERGY"], supported_methods: ["hf", "b3lyp"], supported_basis_sets: ["sto-3g", "def2-svp"] } as EngineCapabilityView;
  const submit = [{ tool_id: "calculation.submit" }] as never;

  it("derives status from deployment capabilities and project tool policy", () => {
    const tool = { id: "pyscf", binding: { kind: "engine", engine: "pyscf", draftable: true }, availabilityNote: "" } as never;
    const base = { capabilitiesLoading: false, capabilitiesError: null, aiAvailable: true };
    expect(resolveToolStatus(tool, { ...base, capabilities: [pyscf], allowedTools: submit })).toMatchObject({ label: "Engine available", canDraft: true });
    expect(resolveToolStatus(tool, { ...base, capabilities: [pyscf], allowedTools: [] })).toMatchObject({ label: "Engine available", canDraft: false });
    expect(resolveToolStatus(tool, { ...base, capabilities: [{ ...pyscf, availability: "UNAVAILABLE", diagnostic: "worker offline" }], allowedTools: submit })).toMatchObject({ label: "Unavailable", canDraft: false, detail: "worker offline" });
    expect(resolveToolStatus(tool, { ...base, capabilities: [], allowedTools: submit })).toMatchObject({ label: "Not on this deployment", canDraft: false });
    expect(resolveToolStatus(tool, { ...base, capabilities: [pyscf], allowedTools: submit, aiAvailable: false }).canDraft).toBe(false);
  });

  it("unavailable tool invocation: roadmap and unavailable engines expose no draft action", async () => {
    api.capabilities = { capabilities: [{ ...pyscf, availability: "UNAVAILABLE" }], loading: false, error: null };
    const onDraft = vi.fn();
    await render(createElement(AIScientistToolsTab, { projectId, allowedTools: submit, aiAvailable: true, onSelectToolForChat: onDraft }));
    expect(container!.querySelector('[data-testid^="ai-tool-draft-"]')).toBeNull();
    expect(byTestId("ai-tool-card-orca")!.dataset.status).toBe("roadmap");
    expect(container!.textContent).not.toMatch(/Add tool|CCSD|MP2|6-31G\*/);
  });

  it("lists reported methods, filters by them, drafts only through the action, and closes details with Escape", async () => {
    api.capabilities = { capabilities: [pyscf], loading: false, error: null };
    const onDraft = vi.fn();
    await render(createElement(AIScientistToolsTab, { projectId, allowedTools: submit, aiAvailable: true, onSelectToolForChat: onDraft }));
    expect(byTestId("ai-tool-card-pyscf")!.textContent).toContain("B3LYP");
    const search = byTestId("ai-tools-search-input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "def2-svp");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container!.querySelectorAll('[data-testid^="ai-tool-card-"]')).toHaveLength(1);
    await act(async () => { byTestId("ai-tool-draft-pyscf")!.click(); });
    expect(onDraft).toHaveBeenCalledWith("PySCF", expect.stringContaining("single-point energy"));
    await act(async () => { (container!.querySelector(".ai-tool-open-detail") as HTMLButtonElement).click(); });
    expect(byTestId("ai-tool-detail")!.textContent).toContain("Basis sets: STO-3G, def2-SVP");
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(byTestId("ai-tool-detail")).toBeNull();
  });
});

// ---------------------------------------------------------------- Settings
function settingsView(model = "nvidia/nemotron-3.5-lightning-30b-a3b", available = true): AISettingsView {
  const capability = (id: string, selectable: boolean, status: string) => ({
    provider: "nvidia", model_identifier: id, display_name: id.split("/")[1], status, endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    endpoint_availability: "AVAILABLE", documented_capabilities: [], published_context: "1M (published)", configuration_requirements: ["x"],
    configured: selectable, selectable, tool_compatibility_verified: selectable, verification_scope: selectable ? "historical tool selection only" : "No live ChemDFT verification",
    limitations: ["Trial terms apply."], source_urls: ["https://example.invalid"], reviewed_on: "2026-10-16",
  });
  return {
    preferences: { mode: "MANAGED", provider: "nvidia", model },
    availability: { mode: "MANAGED", provider: "nvidia", model, available, error_code: available ? null : "MANAGED_PROVIDER_UNAVAILABLE", managed_enabled: true, byok_enabled: false, secret_storage_available: true, local_test_only: false, allowance_status: "NOT_APPLICABLE" },
    providers: [{ provider: "nvidia", models: ["nvidia/nemotron-3.5-lightning-30b-a3b", "nvidia/model-b"] }],
    credentials: [],
    model_capabilities: [
      capability("nvidia/nemotron-3.5-lightning-30b-a3b", true, "LIVE-VERIFIED"),
      capability("nvidia/model-b", true, "LIVE-VERIFIED"),
      capability("nvidia/nemotron-3-super-120b-a12b", false, "DOCUMENTED"),
    ],
  } as unknown as AISettingsView;
}

describe("Model settings and routing (section 6)", () => {
  it("offers only server-offered, registry-selectable provider/model pairs", () => {
    const choices = modelChoices(settingsView());
    expect(choices.filter((choice) => choice.selectable).map((choice) => choice.model)).toEqual(["nvidia/nemotron-3.5-lightning-30b-a3b", "nvidia/model-b"]);
    const unoffered = modelChoices({ ...settingsView(), providers: [{ provider: "nvidia", models: ["nvidia/nemotron-3.5-lightning-30b-a3b"] }] } as AISettingsView);
    expect(unoffered.find((choice) => choice.model === "nvidia/model-b")?.selectable).toBe(false);
  });

  it("saves the exact provider/model pair to the server, reports success only from the response, and never uses localStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    api.getAiSettings.mockResolvedValue(settingsView());
    api.saveAiSettings.mockResolvedValue(settingsView("nvidia/model-b"));
    const onModelSaved = vi.fn();
    await render(createElement(AIScientistSettingsTab, { onModelSaved }));
    await flush();
    const select = byTestId("ai-model-select") as HTMLSelectElement;
    expect([...select.options].find((option) => option.value.endsWith("super-120b-a12b"))?.disabled).toBe(true);
    expect((byTestId("ai-settings-save") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { select.value = "nvidia::nvidia/model-b"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { byTestId("ai-settings-save")!.click(); });
    await flush();
    expect(api.saveAiSettings).toHaveBeenCalledWith({ mode: "MANAGED", provider: "nvidia", model: "nvidia/model-b" });
    expect(onModelSaved).toHaveBeenCalledWith({ provider: "nvidia", model: "nvidia/model-b" });
    expect(byTestId("ai-settings-notice")!.textContent).toMatch(/^Saved\. New AI requests use model-b/);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("does not claim success when the server rejects the preference or leaves AI unavailable", async () => {
    api.getAiSettings.mockResolvedValue(settingsView());
    api.saveAiSettings.mockRejectedValueOnce(new Error("MODEL_UNAVAILABLE"));
    const onModelSaved = vi.fn();
    await render(createElement(AIScientistSettingsTab, { onModelSaved }));
    await flush();
    const select = byTestId("ai-model-select") as HTMLSelectElement;
    await act(async () => { select.value = "nvidia::nvidia/model-b"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { byTestId("ai-settings-save")!.click(); });
    await flush();
    expect(byTestId("ai-settings-notice")!.textContent).toContain("Not saved: The selected model is not available on this server.");
    expect(byTestId("ai-settings-notice")!.textContent).toContain("MODEL_UNAVAILABLE");
    expect(onModelSaved).not.toHaveBeenCalled();
    api.saveAiSettings.mockResolvedValueOnce(settingsView("nvidia/model-b", false));
    await act(async () => { byTestId("ai-settings-save")!.click(); });
    await flush();
    expect(byTestId("ai-settings-notice")!.textContent).toMatch(/Saved, but AI is unavailable.*No fallback model is used/);
  });
});

// ---------------------------------------------------------------- Panel: planning profile + model refresh
describe("Composer planning profile, approval screen and model display (sections 6, 7; 1A/2A)", () => {
  function productContext(hints: Record<string, unknown>, model = "nvidia/nemotron-3.5-lightning-30b-a3b", canWrite = true): ProductContext {
    return { ai: { mode: "MANAGED", provider: "nvidia", model, available: true, error_code: null, managed_enabled: true, byok_enabled: false, secret_storage_available: true, local_test_only: false, allowance_status: "NOT_APPLICABLE" },
      allowed_tools: [], can_write: canWrite, generated_at: "2026-10-16T12:00:00Z", human_id: "u", navigator: { blocked: [], goal: "", have: [], next: [], notices: [] },
      organization_id: "o", project_id: projectId, project_kind: "STANDARD", project_name: "H2", published_example: false, resources: [], role: "OWNER", sealed: false,
      selection: hints } as unknown as ProductContext;
  }
  async function renderPanel(selection: Record<string, unknown> | null, options: { canWrite?: boolean; conversation?: unknown; run?: AIRunView } = {}) {
    api.listAiConversations.mockResolvedValue({ conversations: options.conversation ? [{ id: "conv-1" }] : [] });
    if (options.conversation) api.getAiConversation.mockResolvedValue(options.conversation);
    if (options.run) api.getAiRun.mockResolvedValue(options.run);
    api.getAiSettings.mockResolvedValue(settingsView());
    api.getProductContext.mockImplementation(async (_project: string, hints: Record<string, unknown>) => productContext(hints, undefined, options.canWrite ?? true));
    api.createAiConversation.mockResolvedValue({ conversation: { id: "conv-new" }, messages: [] });
    api.postAiMessage.mockResolvedValue({ conversation: { id: "conv-new" }, messages: [], latest_run: null });
    await render(createElement(AIScientistPanel, { projectId, currentSelection: selection as never, currentViewLabel: "H2 → Structure" }));
    await flush(); await flush();
  }
  async function typeAndSend(text: string) {
    const input = byTestId("ai-prompt-input") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { byTestId("ai-ask-button")!.click(); });
    await flush();
  }
  const structureSelection = { kind: "structureVersion", id: versionId, sourceId: structureId, projectId };

  async function typeOnly(text: string) {
    const input = byTestId("ai-prompt-input") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("is one box: no tab switch, one text box, primary Ask and secondary calculation action", async () => {
    await renderPanel(structureSelection);
    expect(container!.querySelectorAll('[role="radio"][data-mode]')).toHaveLength(0);
    expect(container!.querySelectorAll('[data-testid="ai-ask-button"]')).toHaveLength(1);
    expect(byTestId("ai-prepare-calculation-button")).not.toBeNull();
    expect(byTestId("ai-composer-options")).not.toBeNull();
    expect(byTestId("ai-composer-mode-scope")).not.toBeNull();
  });

  it("shows the Prepare calculation button only for non-periodic structures with a version, and sending via Ask stays a normal Chat", async () => {
    await renderPanel(structureSelection);
    expect(byTestId("ai-prepare-calculation-button")).not.toBeNull();
    await typeAndSend("optimize the geometry and calculate the energy");
    expect(api.postAiMessage).toHaveBeenLastCalledWith(projectId, "conv-new", expect.objectContaining({ planning_profile: "GENERAL", mode: "CHAT" }));
  });

  it("clicking Prepare calculation triggers planning proposal for the molecular structure", async () => {
    await renderPanel(structureSelection);
    await typeOnly("calculate the energy of this molecule");
    await act(async () => { byTestId("ai-prepare-calculation-button")!.click(); });
    await flush();
    expect(api.postAiMessage).toHaveBeenLastCalledWith(projectId, "conv-new", expect.objectContaining({ planning_profile: "PYSCF_ENERGY_PROPOSAL", mode: "STANDARD", selected_structure_version_id: versionId }));
  });

  it("Ask sends CHAT requests; Prepare calculation sends the scoped PySCF profile with a saved version selected", async () => {
    await renderPanel(structureSelection);
    await typeAndSend("What is this structure?");
    expect(api.postAiMessage).toHaveBeenLastCalledWith(projectId, "conv-new", expect.objectContaining({ planning_profile: "GENERAL", mode: "CHAT" }));
    await typeOnly("Plan an energy calculation");
    await act(async () => { byTestId("ai-prepare-calculation-button")!.click(); });
    await flush();
    expect(api.postAiMessage).toHaveBeenLastCalledWith(projectId, "conv-new", expect.objectContaining({ planning_profile: "PYSCF_ENERGY_PROPOSAL", mode: "STANDARD", selected_structure_version_id: versionId }));
  });

  it("a disabled Prepare calculation button always shows its reason (title and visible hint)", async () => {
    await renderPanel(structureSelection);
    const button = byTestId("ai-prepare-calculation-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/Type a request/);
    expect(byTestId("ai-composer-disabled-hint")?.textContent).toMatch(/Type a request/);
    await typeOnly("calculate the energy of this molecule");
    expect((byTestId("ai-prepare-calculation-button") as HTMLButtonElement).disabled).toBe(false);
    expect(byTestId("ai-composer-disabled-hint")).toBeNull();
  });

  it("without a saved version, Prepare calculation is not available and Ask explains or responds", async () => {
    await renderPanel(null);
    expect(byTestId("ai-prepare-calculation-button")).toBeNull();
    expect(byTestId("ai-ask-button")).not.toBeNull();
  });

  it("offers the project's saved versions in options if prerequisite needed", async () => {
    const openSelection = vi.fn();
    api.workspace = { catalog: [
      { label: "H2 · V1", section: "structures", selection: structureSelection },
      { label: "Benzene draft", section: "candidates", selection: { kind: "structureCandidate", id: "cand-1", projectId } },
      { label: "Other project", section: "structures", selection: { ...structureSelection, id: "foreign", projectId: "elsewhere" } },
    ], openSelection, unsavedWork: false };
    await renderPanel(null);
    expect(byTestId("ai-prepare-calculation-button")).toBeNull();
  });

  it("names the version the server resolved when nothing is selected, instead of the view label", async () => {
    api.listAiConversations.mockResolvedValue({ conversations: [] });
    api.getAiSettings.mockResolvedValue(settingsView());
    api.getProductContext.mockImplementation(async (_project: string, hints: Record<string, unknown>) => {
      const context = productContext(hints);
      return { ...context, selection: { ...context.selection, selected_structure_version_id: versionId, selected_structure_id: structureId },
        resources: [{ entity_type: "structure.version", entity_id: versionId, label: "H2 reference V1", source_class: "USER_SUPPLIED", verification_state: "NOT_REVIEWED" }] } as unknown as ProductContext;
    });
    await render(createElement(AIScientistPanel, { projectId, currentSelection: null, currentViewLabel: "H2 → Overview" }));
    await flush(); await flush();
    expect(byTestId("ai-prepare-calculation-button")).not.toBeNull();
  });

  it("with a version, Plan stays scoped unless the researcher explicitly chooses the general planner in More options", async () => {
    await renderPanel(structureSelection);
    expect(byTestId("ai-composer-options-body")!.hidden).toBe(true);
    expect(byTestId("ai-composer-options-changed")).toBeNull();
    await act(async () => { byTestId("ai-composer-options")!.click(); });
    expect(byTestId("ai-composer-options-body")!.hidden).toBe(false);
    expect((byTestId("ai-plan-general") as HTMLInputElement).checked).toBe(false);
    await act(async () => { (byTestId("ai-plan-general") as HTMLInputElement).click(); });
    expect(byTestId("ai-composer-options-changed")).not.toBeNull();
    await typeOnly("Extract the figures from the imported paper");
    await act(async () => { byTestId("ai-prepare-calculation-button")!.click(); });
    await flush();
    expect(api.postAiMessage).toHaveBeenLastCalledWith(projectId, "conv-new", expect.objectContaining({ planning_profile: "GENERAL", mode: "STANDARD", selected_structure_version_id: versionId }));
  });

  it("an unreviewed draft selection does not offer Prepare calculation button", async () => {
    await renderPanel({ kind: "structureCandidate", id: "cand-1", projectId });
    expect(byTestId("ai-prepare-calculation-button")).toBeNull();
  });

  it("general planner option in More options allows general planning", async () => {
    await renderPanel(structureSelection);
    await act(async () => { byTestId("ai-composer-options")!.click(); });
    await act(async () => { (byTestId("ai-plan-general") as HTMLInputElement).click(); });
    await typeOnly("Create benzene and plan an energy calculation");
    await act(async () => { byTestId("ai-prepare-calculation-button")!.click(); });
    await flush();
    expect(api.postAiMessage).toHaveBeenLastCalledWith(projectId, "conv-new", expect.objectContaining({ planning_profile: "GENERAL", mode: "STANDARD" }));
  });

  it("blocks Plan calculation in a read-only project while Ask still works", async () => {
    await renderPanel(structureSelection, { canWrite: false });
    expect(byTestId("ai-prepare-calculation-button")).toBeNull();
    const input = byTestId("ai-prompt-input") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "What is this structure?");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((byTestId("ai-ask-button") as HTMLButtonElement).disabled).toBe(false);
    expect(byTestId("ai-read-only-state")).not.toBeNull();
  });

  it("opens the dedicated approval screen for a pending approval, can defer it, and reopens from the banner", async () => {
    const pending = approval({ project_id: projectId });
    const run = aiRun({ id: "run-1", status: "WAITING_FOR_APPROVAL", pending_approval: pending } as Partial<AIRunView>);
    api.listStructures.mockResolvedValue([{ id: structureId }]);
    api.listStructureVersions.mockResolvedValue([savedVersion()]);
    api.listCalculationCapabilities.mockResolvedValue([]);
    await renderPanel(structureSelection, { conversation: { conversation: { id: "conv-1" }, messages: [], latest_run: run }, run });
    await flush();
    const screen = byTestId("ai-approval-card")!;
    expect(screen.classList.contains("is-screen")).toBe(true);
    expect(byTestId("ai-input-dock")).toBeNull();
    expect(byTestId("ai-chat-approval-badge")!.textContent).toContain("Approval waiting");
    expect(screen.querySelector(".ai-approval-screen-footer [data-testid='ai-approve-button']")).not.toBeNull();
    await act(async () => { byTestId("ai-approval-back")!.click(); });
    expect(byTestId("ai-approval-card")).toBeNull();
    expect(byTestId("ai-approval-pending-banner")).not.toBeNull();
    await act(async () => { buttonByText("Review proposal")!.click(); });
    expect(byTestId("ai-approval-card")).not.toBeNull();
  });

  it("passes an optional reject reason to the backend decision", async () => {
    const pending = approval({ project_id: projectId });
    const run = aiRun({ id: "run-1", status: "WAITING_FOR_APPROVAL", pending_approval: pending } as Partial<AIRunView>);
    api.listStructures.mockResolvedValue([{ id: structureId }]);
    api.listStructureVersions.mockResolvedValue([savedVersion()]);
    api.listCalculationCapabilities.mockResolvedValue([]);
    api.decideAiApproval.mockResolvedValue({ ...run, status: "CANCELED", pending_approval: null });
    await renderPanel(structureSelection, { conversation: { conversation: { id: "conv-1" }, messages: [], latest_run: run }, run });
    await flush();
    const note = byTestId("ai-reject-note") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "Use def2-SVP instead");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { byTestId("ai-reject-button")!.click(); });
    await flush();
    expect(api.decideAiApproval).toHaveBeenCalledWith(projectId, pending.id, { decision: "REJECT", decision_notes: "Use def2-SVP instead" });
  });

  it("shows the registry model in one status bar and re-reads model context after a settings save", async () => {
    await renderPanel(structureSelection);
    expect(byTestId("ai-model-name")!.textContent).toBe("nemotron-3.5-lightning-30b-a3b");
    expect(byTestId("ai-model-capability")).toBeNull();
    await act(async () => { byTestId("ai-status-details-toggle")!.click(); });
    expect(byTestId("ai-model-capability")!.textContent).toContain("1M (published)");
    expect(container!.querySelectorAll(".ai-authority-note, .ai-model-provider-header-row")).toHaveLength(0);
    const contextReads = api.getProductContext.mock.calls.length;
    api.getProductContext.mockImplementation(async (_project: string, hints: Record<string, unknown>) => productContext(hints, "nvidia/model-b"));
    api.saveAiSettings.mockResolvedValue(settingsView("nvidia/model-b"));
    await act(async () => { byTestId("ai-nav-more")!.click(); });
    await act(async () => { byTestId("ai-menu-settings")!.click(); });
    await flush();
    const select = byTestId("ai-model-select") as HTMLSelectElement;
    await act(async () => { select.value = "nvidia::nvidia/model-b"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { byTestId("ai-settings-save")!.click(); });
    await flush(); await flush();
    expect(api.getProductContext.mock.calls.length).toBeGreaterThan(contextReads);
    await act(async () => { byTestId("ai-nav-chat")!.click(); });
    await flush();
    expect(byTestId("ai-model-name")!.textContent).toBe("model-b");
  });
});

describe("Researcher-facing labels (3B)", () => {
  it("shows an error code as a plain sentence and keeps the original text for a Details disclosure", () => {
    expect(plainAiError("PROVIDER_TIMEOUT: The provider did not answer.")).toEqual({ text: "The AI provider did not answer in time. The provider did not answer.", detail: "PROVIDER_TIMEOUT: The provider did not answer." });
    expect(plainAiError("ALLOWANCE_EXCEEDED")).toEqual({ text: "The AI allowance for this period is used up.", detail: "ALLOWANCE_EXCEEDED" });
    expect(plainAiError("Not saved: the server rejected the preference.")).toEqual({ text: "Not saved: the server rejected the preference.", detail: null });
    expect(plainAiError("")).toEqual({ text: "", detail: null });
  });

  it("the status bar says AI is unavailable in words and keeps the code under Details", async () => {
    const unavailable = { ai: { mode: "MANAGED", provider: "nvidia", model: "m", available: false, error_code: "AI_UNAVAILABLE", local_test_only: false }, can_write: false } as unknown as ProductContext;
    await render(createElement(AIScientistStatusBar, {
      productContext: unavailable, capability: null, contextError: "CONTEXT_FAILED: boom", viewLabel: "H2 → Structure", candidateContext: false, showFollowAi: true,
      followAiMode: true, onFollowAiModeChange: vi.fn(), projectId, onConfigure: vi.fn(), settingsView: null, activeRunModel: null, runInFlight: false,
      approvalPending: false, onModelSaved: vi.fn(),
    }));
    const outside = (el: HTMLElement) => { const copy = el.cloneNode(true) as HTMLElement; copy.querySelectorAll('[data-testid="ai-error-details"]').forEach((node) => node.remove()); return copy.textContent ?? ""; };
    const visible = outside(byTestId("ai-model-provider-card")!);
    expect(visible).toContain("AI is unavailable. Structures, Navigator, calculations, examples and Learn remain usable.");
    expect(visible).toContain("Read-only project: you can ask questions, but planning a calculation needs edit access.");
    expect(visible).toContain("Couldn't load this page's context. Questions about a specific result are turned off.");
    expect(visible).not.toMatch(/AI_UNAVAILABLE|CONTEXT_FAILED|boom/);
    const details = [...container!.querySelectorAll('[data-testid="ai-error-details"] code')].map((node) => node.textContent);
    expect(details).toEqual(["AI_UNAVAILABLE", "CONTEXT_FAILED: boom"]);
  });

  it("the approval record keeps the exact proposal visible and the fingerprint, tool and status code under Details", async () => {
    api.listStructures.mockResolvedValue([{ id: structureId }]);
    api.listStructureVersions.mockResolvedValue([savedVersion()]);
    api.listCalculationCapabilities.mockResolvedValue([]);
    await render(createElement(ApprovalCard, { approval: approval(), submitting: false, onApprove: vi.fn(), onReject: vi.fn() }));
    await flush(); await flush();
    const technical = byTestId("ai-approval-technical")!;
    expect(technical.querySelector("summary")!.textContent).toBe("Details");
    expect(technical.textContent).toContain("fingerprint-abc");
    expect(technical.textContent).toContain("calculation.submit");
    expect(technical.textContent).toContain("PENDING");
    const card = byTestId("ai-approval-card")!;
    const copy = card.cloneNode(true) as HTMLElement; copy.querySelector('[data-testid="ai-approval-technical"]')!.remove();
    expect(copy.textContent).not.toContain("fingerprint-abc");
    expect(copy.textContent).toContain("The values above are exactly what will run");
    expect(copy.textContent).toContain("Nothing runs until you approve; results appear only after ChemDFT checks them.");
    expect(byTestId("ai-proposal-decision-summary")!.textContent).toContain("Approving submits:");
    expect(byTestId("ai-approve-button")).not.toBeNull();
  });

  it("replaces stored codes with readable terms without changing identifiers", () => {
    expect(humanizeDetail("Authority: USER_SUPPLIED · Verification: NOT REVIEWED")).toBe("Authority: supplied by researcher · Verification: not reviewed");
    expect(humanizeDetail("structure.imported · SUCCEEDED")).toBe("Structure imported · succeeded");
    expect(humanizeDetail("Engine: AVAILABLE")).toBe("Engine: available");
    // The provider is shown beside the model name, so a "(Provider)" suffix is not repeated.
    expect(modelDisplayName("Kimi K2 Instruct (NVIDIA)", "nvidia")).toBe("Kimi K2 Instruct");
    expect(modelDisplayName("DeepSeek V4.1 Flash (candidate)", "nvidia")).toBe("DeepSeek V4.1 Flash (candidate)");
    expect(modelDisplayName("Nemotron 3.5 Lightning 30B A3B", "nvidia")).toBe("Nemotron 3.5 Lightning 30B A3B");
    expect(methodLabel("hf")).toBe("Hartree–Fock (HF)");
    expect(basisLabel("def2-svp")).toBe("def2-SVP");
    expect(taskLabel("ENERGY")).toBe("Single-point energy");
    expect(multiplicityLabel(3)).toBe("3 (triplet)");
    expect(methodLabel("unknown-method")).toBe("unknown-method");
  });

  it("counts down to expiry and never shows negative time", () => {
    const now = Date.parse("2026-10-17T10:00:00Z");
    expect(expiryCountdown(now + 125_000, now)).toEqual({ expired: false, label: "2 min 05 s left", urgent: true });
    expect(expiryCountdown(now + 2 * 3600_000, now).urgent).toBe(false);
    expect(expiryCountdown(now - 1000, now)).toEqual({ expired: true, label: "Expired", urgent: true });
  });

  it("shows researcher terms in evidence records and the runs coverage limit", async () => {
    const [record] = buildEvidenceRecords([], [{ label: "H2 V1", detail: "Authority: USER_SUPPLIED · Verification: NOT REVIEWED", selection: { kind: "structureVersion", id: "v", projectId } as never }]);
    expect(record?.locator).toBe("Authority: supplied by researcher · Verification: not reviewed");
    await render(createElement(AIScientistRunsTab, { projectId, conversationRunCount: 3 }));
    expect(byTestId("ai-runs-coverage")!.textContent).toMatch(/3 AI runs from the current conversation.*earlier conversations are not listed/);
  });
});

// ---------------------------------------------------------------- Panel: one conversation per AI context
describe("AI context per page: the panel keeps one thread per context", () => {
  const ctx = (page: Parameters<typeof resolveAiContext>[2]) => resolveAiContext(projectId, "H2", page);
  const jobs = ctx({ page: "job", label: "Compute Jobs · job aaaa", jobId: "job-a" });
  const jobsB = ctx({ page: "job", label: "Compute Jobs · job bbbb", jobId: "job-b" });
  const compare = ctx({ page: "compare", label: "Calculation comparison", resultIds: ["r1", "r2"], letters: ["A", "B"], referenceLabel: "Energy", readOnly: true });
  const overview = ctx({ page: "project", section: "overview", label: "Overview" });
  const message = (id: string, role: "user" | "assistant", content: string) => ({ id, conversation_id: "conv-new", role, content, created_at: "2026-10-26T10:00:00Z" });

  function productContext(hints: Record<string, unknown>): ProductContext {
    return { ai: { mode: "MANAGED", provider: "nvidia", model: "nvidia/model-a", available: true, error_code: null, managed_enabled: true, byok_enabled: false, secret_storage_available: true, local_test_only: false, allowance_status: "AVAILABLE" },
      allowed_tools: [], can_write: true, generated_at: "2026-10-26T10:00:00Z", human_id: "u", navigator: { blocked: [], goal: "", have: [], next: [], notices: [] },
      organization_id: "o", project_id: projectId, project_kind: "STANDARD", project_name: "H2", published_example: false, resources: [], role: "OWNER", sealed: false,
      selection: hints } as unknown as ProductContext;
  }
  const panel = (aiContext: ReturnType<typeof ctx>) => createElement(AIScientistPanel, { projectId, aiContext });
  async function show(aiContext: ReturnType<typeof ctx>) { await act(async () => { root!.render(panel(aiContext)); }); await flush(); await flush(); }
  async function setup(first: ReturnType<typeof ctx>) {
    api.listAiConversations.mockResolvedValue({ conversations: [] });
    api.getAiSettings.mockResolvedValue(settingsView());
    api.getProductContext.mockImplementation(async (_project: string, hints: Record<string, unknown>) => productContext(hints));
    api.createAiConversation.mockResolvedValue({ conversation: { id: "conv-new" }, messages: [] });
    await render(panel(first));
    await flush(); await flush();
  }
  async function type(text: string) {
    const input = byTestId("ai-prompt-input") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const send = async () => { await act(async () => { byTestId("ai-ask-button")!.click(); }); await flush(); await flush(); };
  const bubble = (text: string) => [...container!.querySelectorAll(".ai-message-bubble")].find((el) => el.textContent?.includes(text));
  const inHistory = (text: string) => Boolean(bubble(text)?.closest('[data-testid="ai-history"]'));

  it("an answer stays with the context it was given for: collapsed history elsewhere, back in the thread when you return", async () => {
    await setup(jobs);
    api.postAiMessage.mockResolvedValue({ conversation: { id: "conv-new" }, latest_run: null, messages: [message("m1", "user", "Why did it stop?"), message("m2", "assistant", "ANSWER-FOR-JOB-A")] });
    await type("Why did it stop?"); await send();
    expect(bubble("ANSWER-FOR-JOB-A")).toBeTruthy();
    expect(inHistory("ANSWER-FOR-JOB-A")).toBe(false);
    expect(api.postAiMessage.mock.calls[0]![2]).toMatchObject({ current_view: jobs.viewLabel });

    for (const other of [jobsB, compare, overview]) {
      await show(other);
      expect(byTestId("ai-scientist-panel")!.getAttribute("data-context-key")).toBe(other.key);
      expect(inHistory("ANSWER-FOR-JOB-A"), `collapsed under ${other.key}`).toBe(true);
      expect(byTestId("ai-empty-state")).toBeTruthy();
    }
    await show(jobs);
    expect(bubble("ANSWER-FOR-JOB-A")).toBeTruthy();
    expect(inHistory("ANSWER-FOR-JOB-A")).toBe(false);
    expect(byTestId("ai-empty-state")).toBeNull();
  });

  it("labels a CHAT reply as an AI reply, not project evidence, and leaves evidence answers alone", async () => {
    await setup(jobs);
    const chat = { ...message("m2", "assistant", "CHAT-ANSWER"), evidence_status: null, evidence_note: CHAT_REPLY_NOTE };
    const cited = { ...message("m4", "assistant", "CITED-ANSWER"), evidence_status: "SUPPORTED", evidence_note: null };
    api.postAiMessage.mockResolvedValue({ conversation: { id: "conv-new" }, latest_run: null, messages: [message("m1", "user", "how many molecules"), chat, message("m3", "user", "what is the HOMO"), cited] });
    await type("how many molecules"); await send();
    const labelled = (text: string) => bubble(text)?.querySelector('[data-testid="ai-chat-reply-label"]');
    expect(labelled("CHAT-ANSWER")?.textContent).toContain("not project evidence");
    expect(labelled("CITED-ANSWER")).toBeNull();
    expect(bubble("CITED-ANSWER")?.textContent).toContain("SUPPORTED");
  });

  it("a run loaded from the server (no recorded context) never puts its answer into a context's own thread", async () => {
    const run = aiRun({ id: "run-9", status: "SUCCEEDED" } as Partial<AIRunView>);
    const saved = { conversation: { id: "conv-1" }, latest_run: run, messages: [message("m1", "user", "Old question"), { ...message("m2", "assistant", "SAVED-ANSWER-ELSEWHERE"), run_id: "run-9" }] };
    api.listAiConversations.mockResolvedValue({ conversations: [{ id: "conv-1" }] });
    api.getAiConversation.mockResolvedValue(saved);
    api.getAiRun.mockResolvedValue(run);
    api.getAiSettings.mockResolvedValue(settingsView());
    api.getProductContext.mockImplementation(async (_project: string, hints: Record<string, unknown>) => productContext(hints));
    await render(panel(compare));
    await flush(); await flush();
    expect(bubble("SAVED-ANSWER-ELSEWHERE")).toBeTruthy();
    expect(inHistory("SAVED-ANSWER-ELSEWHERE")).toBe(true);
    expect(byTestId("ai-empty-state")).toBeTruthy();
  });

  it("shows what the context is, and badges a named context as not grounded; the project context has no badge", async () => {
    await setup(compare);
    expect(byTestId("ai-scientist-panel")!.getAttribute("data-context-page")).toBe("compare");
    expect(byTestId("ai-context-readonly")!.textContent).toBe("Read-only");
    expect(byTestId("ai-context-grounding")!.textContent).toBe("Named, not grounded");
    expect(byTestId("ai-empty-state")!.textContent).toContain("Ask about this comparison");
    await show(overview);
    expect(byTestId("ai-context-grounding")).toBeNull();
    expect(byTestId("ai-context-readonly")).toBeNull();
    expect(api.getProductContext.mock.calls.at(-1)![1]).toEqual({ current_view: "H2 → Overview" });
  });

  it("offers Follow AI / Stay here only in the Workspace, where it can act, and says why elsewhere (under Details)", async () => {
    const workspace = ctx({ page: "workspace", label: "H2 → Structure", selection: null });
    const openDetails = async () => {
      const toggle = byTestId("ai-status-details-toggle")!;
      if (toggle.getAttribute("aria-expanded") !== "true") await act(async () => { toggle.click(); });
    };
    await setup(jobs);
    await openDetails();
    expect(byTestId("ai-view-mode-toggle")).toBeNull();
    expect(byTestId("ai-follow-unavailable")!.textContent).toContain("Follow AI works in the Workspace only");
    await show(compare);
    await openDetails();
    expect(byTestId("ai-view-mode-toggle")).toBeNull();
    expect(byTestId("ai-follow-unavailable")).not.toBeNull();
    await show(overview);
    await openDetails();
    expect(byTestId("ai-view-mode-toggle")).toBeNull();
    await show(workspace);
    await openDetails();
    expect(byTestId("ai-view-mode-toggle")).not.toBeNull();
    expect(byTestId("ai-follow-unavailable")).toBeNull();
    expect(byTestId("ai-view-mode-toggle")!.getAttribute("aria-labelledby")).toBe("ai-follow-label");
  });

  it("keeps the unsent draft with its own context", async () => {
    await setup(jobs);
    await type("draft for job a");
    await show(compare);
    expect((byTestId("ai-prompt-input") as HTMLTextAreaElement).value).toBe("");
    await type("draft for the comparison");
    await show(jobs);
    expect((byTestId("ai-prompt-input") as HTMLTextAreaElement).value).toBe("draft for job a");
    await show(compare);
    expect((byTestId("ai-prompt-input") as HTMLTextAreaElement).value).toBe("draft for the comparison");
  });

  it("a run still working when the page changes says whose answer it is, and the pending question is not shown elsewhere", async () => {
    await setup(jobs);
    const run = aiRun({ id: "run-2", status: "EXECUTING" } as Partial<AIRunView>);
    api.getAiRun.mockResolvedValue(run);
    api.postAiMessage.mockResolvedValue({ conversation: { id: "conv-new" }, latest_run: run, messages: [message("m1", "user", "Slow question")] });
    await type("Slow question"); await send();
    expect(byTestId("ai-context-switch-notice")).toBeNull();
    await show(compare);
    expect(byTestId("ai-context-switch-notice")!.textContent).toContain(`“${jobs.label}”`);
    expect(byTestId("ai-context-switch-notice")!.textContent).toContain("will appear under that context");
    await show(jobs);
    expect(byTestId("ai-context-switch-notice")).toBeNull();
  });

  it("a pending approval survives a page change: the full proposal, its origin, and no automatic decision", async () => {
    await setup(jobs);
    const pending = approval({ project_id: projectId });
    const run = aiRun({ id: "run-1", status: "WAITING_FOR_APPROVAL", pending_approval: pending } as Partial<AIRunView>);
    api.listStructures.mockResolvedValue([{ id: structureId }]);
    api.listStructureVersions.mockResolvedValue([savedVersion()]);
    api.listCalculationCapabilities.mockResolvedValue([]);
    api.getAiRun.mockResolvedValue(run);
    api.postAiMessage.mockResolvedValue({ conversation: { id: "conv-new" }, latest_run: run, messages: [message("m1", "user", "Plan it")] });
    await type("Plan it"); await send();
    expect(byTestId("ai-approval-card")).toBeTruthy();
    expect(byTestId("ai-approval-proposed-under"), "no origin note while the context is unchanged").toBeNull();

    await show(compare);
    expect(byTestId("ai-approval-card"), "the proposal is still on screen").toBeTruthy();
    expect(byTestId("ai-approval-proposed-under")!.textContent).toBe(`Proposed under: ${jobs.label}`);
    expect(byTestId("ai-approval-card")!.textContent).toContain("PySCF HF/STO-3G energy for the selected version");
    expect((byTestId("ai-approve-button") as HTMLButtonElement).disabled).toBe(false);
    expect(api.decideAiApproval).not.toHaveBeenCalled();

    await show(jobs);
    expect(byTestId("ai-approval-proposed-under")).toBeNull();
    expect(api.decideAiApproval).not.toHaveBeenCalled();
  });
});
