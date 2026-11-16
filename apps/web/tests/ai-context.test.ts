// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AiContextProvider, resolveAiContext, useAiPageContext, usePublishedAiContext, type AiPageContext } from "../src/lib/ai-context";
import { aiWorkspaceSelection } from "../src/lib/ai-workspace-context";
import { selectionKey } from "../src/lib/workspace-selection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const P = "00000000-0000-4000-8000-000000000001";
const R1 = "00000000-0000-4000-8000-0000000000a1";
const R2 = "00000000-0000-4000-8000-0000000000a2";
const DOC = "00000000-0000-4000-8000-0000000000d1";
const result = { kind: "calculationResult" as const, id: R1, projectId: P, sourceId: "00000000-0000-4000-8000-0000000000c1" };
const CLAIM = "00000000-0000-4000-8000-0000000000e1";
const JOB = "00000000-0000-4000-8000-0000000000f1";
const ACCEPTED = ["selected_structure_id", "selected_structure_version_id", "selected_result_id", "selected_document_id", "selected_spectrum_id", "compared_result_ids", "selected_claim_id", "selected_job_id", "goal", "current_view"];

describe("resolveAiContext", () => {
  it("bridges the Workspace exactly as before: same thread key, same hints", () => {
    const resolved = resolveAiContext(P, "Water", { page: "workspace", label: "Water V1", selection: result });
    expect(resolved.key).toBe(selectionKey(result));
    expect(resolved.hints).toEqual(aiWorkspaceSelection(P, result, "Water V1"));
    expect(resolved.selection).toEqual(result);
    expect(resolved.grounding).toBe("grounded");
  });
  it("a Workspace with nothing selected, or a selection from another project, is the project thread", () => {
    expect(resolveAiContext(P, "Water", { page: "workspace", label: "Water → Overview", selection: null }).key).toBe("project");
    const other = resolveAiContext(P, "Water", { page: "workspace", label: "x", selection: { ...result, projectId: "other" } });
    expect(other.key).toBe("project");
    expect(other.selection).toBeNull();
    expect(other.hints).toEqual({ current_view: "x" });
  });
  it("pages with no selection share the project thread and send only the view", () => {
    for (const section of ["overview", "settings", "results", "jobs", "claims", "paper-vs-chemdft"] as const) {
      const resolved = resolveAiContext(P, "Water", { page: "project", section, label: "Settings" });
      expect(resolved).toMatchObject({ key: "project", grounding: "project", readOnly: false });
      expect(resolved.hints).toEqual({ current_view: "Water → Settings" });
    }
  });
  it("Jobs sends the job id when it is a UUID, else only names the job", () => {
    const resolved = resolveAiContext(P, "Water", { page: "job", label: "Compute Jobs · job abc", jobId: JOB });
    expect(resolved).toMatchObject({ key: `job:${JOB}`, grounding: "grounded" });
    expect(resolved.hints).toEqual({ current_view: "Water → Compute Jobs · job abc", selected_job_id: JOB });
    const named = resolveAiContext(P, "Water", { page: "job", label: "Compute Jobs · job abc", jobId: "job-1" });
    expect(named).toMatchObject({ key: "job:job-1", grounding: "named" });
    expect(named.hints).toEqual({ current_view: "Water → Compute Jobs · job abc" });
  });
  it("Claims sends the claim id and never the source document id", () => {
    const withDoc = resolveAiContext(P, "Water", { page: "claim", label: "Claim", claimId: CLAIM, sourceDocumentId: DOC });
    expect(withDoc).toMatchObject({ key: `claim:${CLAIM}`, grounding: "grounded" });
    expect(withDoc.hints).toEqual({ current_view: "Water → Claim", selected_claim_id: CLAIM });
    const bad = resolveAiContext(P, "Water", { page: "claim", label: "Claim", claimId: "c1" });
    expect(bad.grounding).toBe("named");
    expect(bad.hints).toEqual({ current_view: "Water → Claim" });
  });
  it("Compare is read-only, keyed by the SET of results, and sends the compared ids (max 8, UUIDs only)", () => {
    const a = resolveAiContext(P, "Water", { page: "compare", label: "Calculation comparison", resultIds: [R1, R2], letters: ["A", "B"], referenceLabel: "Energy", readOnly: true });
    const b = resolveAiContext(P, "Water", { page: "compare", label: "Calculation comparison", resultIds: [R2, R1], letters: ["A", "B"], referenceLabel: "Energy", readOnly: true });
    const c = resolveAiContext(P, "Water", { page: "compare", label: "Calculation comparison", resultIds: [R1], letters: ["A"], referenceLabel: "Energy", readOnly: true });
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
    expect(a).toMatchObject({ grounding: "grounded", readOnly: true });
    expect(a.hints.compared_result_ids).toEqual([R1, R2]);
    expect(a.hints.current_view).toBe("Water → Calculation comparison (A, B; reference Energy)");
    const many = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const capped = resolveAiContext(P, "Water", { page: "compare", label: "x", resultIds: [...many, "not-a-uuid"], letters: [], referenceLabel: null, readOnly: true });
    expect(capped.hints.compared_result_ids).toHaveLength(8);
    const none = resolveAiContext(P, "Water", { page: "compare", label: "x", resultIds: ["nope"], letters: [], referenceLabel: null, readOnly: true });
    expect(none.grounding).toBe("named");
    expect(Object.keys(none.hints)).toEqual(["current_view"]);
  });
  it("Paper vs ChemDFT sends the row's paper claim and calculated results when it has them", () => {
    const plain = resolveAiContext(P, "Water", { page: "paper-vs-chemdft", label: "Paper vs ChemDFT comparison", rowId: "row-1", readOnly: true });
    expect(plain).toMatchObject({ key: "paper:row-1", grounding: "named", readOnly: true });
    const full = resolveAiContext(P, "Water", { page: "paper-vs-chemdft", label: "Paper", rowId: "row-1", readOnly: true, claimId: CLAIM, resultIds: [R1] });
    expect(full.grounding).toBe("grounded");
    expect(full.hints).toMatchObject({ selected_claim_id: CLAIM, compared_result_ids: [R1] });
  });
  it("different subjects never share a thread", () => {
    const keys = [
      resolveAiContext(P, "W", { page: "workspace", label: "x", selection: result }).key,
      resolveAiContext(P, "W", { page: "job", label: "x", jobId: "1" }).key,
      resolveAiContext(P, "W", { page: "job", label: "x", jobId: "2" }).key,
      resolveAiContext(P, "W", { page: "claim", label: "x", claimId: "1" }).key,
      resolveAiContext(P, "W", { page: "compare", label: "x", resultIds: [R1, R2], letters: [], referenceLabel: null, readOnly: true }).key,
      resolveAiContext(P, "W", { page: "paper-vs-chemdft", label: "x", rowId: "1", readOnly: true }).key,
      "project",
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("only ProductSelection fields the server accepts are ever produced, and the view is capped at 500 characters", () => {
    const contexts: AiPageContext[] = [
      { page: "job", label: "j".repeat(900), jobId: JOB },
      { page: "claim", label: "c", claimId: CLAIM },
      { page: "compare", label: "c", resultIds: [R1, R2], letters: ["A", "B"], referenceLabel: "r".repeat(900), readOnly: true },
      { page: "project", section: "settings", label: "s" },
    ];
    for (const context of contexts) {
      const { hints } = resolveAiContext(P, "Water", context);
      for (const field of Object.keys(hints)) expect(ACCEPTED).toContain(field);
      expect((hints.current_view ?? "").length).toBeLessThanOrEqual(500);
    }
  });
});

describe("AiContextProvider", () => {
  let host: HTMLDivElement;
  let root: Root;
  let seen: Array<AiPageContext | null>;
  const Probe = ({ projectId = "p" }: { projectId?: string }) => { seen.push(usePublishedAiContext(projectId)); return null; };
  const Page = ({ context, projectId = "p" }: { context: AiPageContext | null; projectId?: string }) => { useAiPageContext(projectId, context); return null; };
  const render = async (...children: ReturnType<typeof createElement>[]) => { await act(async () => { root.render(createElement(AiContextProvider, null, ...children)); }); };
  const job: AiPageContext = { page: "job", label: "Job", jobId: "1" };
  const claim: AiPageContext = { page: "claim", label: "Claim", claimId: "2" };

  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); seen = []; });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("has no context until a page publishes one, and clears it when the page unmounts", async () => {
    await render(createElement(Probe));
    expect(seen.at(-1)).toBeNull();
    await render(createElement(Probe), createElement(Page, { context: job }));
    expect(seen.at(-1)).toEqual(job);
    await render(createElement(Probe));
    expect(seen.at(-1)).toBeNull();
  });
  it("replaces the entry when the page's context changes", async () => {
    await render(createElement(Probe), createElement(Page, { context: job }));
    await render(createElement(Probe), createElement(Page, { context: claim }));
    expect(seen.at(-1)).toEqual(claim);
  });
  it("a page replaced by another in the same render leaves the successor's context, never the default", async () => {
    await render(createElement(Probe), createElement(Page, { key: "old", context: job }));
    seen.length = 0;
    await render(createElement(Probe), createElement(Page, { key: "new", context: claim }));
    expect(seen.at(-1)).toEqual(claim);
    expect(seen.some((value) => value === null)).toBe(false);
  });
  it("publishing null publishes nothing, and another project's entry is not visible", async () => {
    await render(createElement(Probe), createElement(Page, { context: null }));
    expect(seen.at(-1)).toBeNull();
    await render(createElement(Probe, { projectId: "other" }), createElement(Page, { context: job }));
    expect(seen.at(-1)).toBeNull();
  });
  it("is a no-op without a provider", () => {
    expect(() => act(() => root.render(createElement(Page, { context: job })))).not.toThrow();
  });
});
