import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalculationDetail, ProductContext } from "@chemdft/schemas";
import { aiWorkspaceSelection, associatedAiContext, selectedConformerContext } from "../src/lib/ai-workspace-context";
import { ConformerRunStatus } from "../src/app/_components/conformers/conformer-search-panel";

vi.mock("@chemdft/ui", () => ({ ActionButton: () => null }));
vi.mock("@/lib/conformer-ensemble", () => import("../src/lib/conformer-ensemble"));
vi.mock("@/lib/structure-workspace-api", () => ({}));
const selected = { kind: "calculationResult" as const, projectId: "project", id: "ethanol-result", sourceId: "ethanol-calculation" };
const view = "CREST ensemble · Ethanol V1 → Member 2 · member-id · ensemble execution-id · minimum unverified";
function context() {
  return { project_id: "project", selection: { selected_result_id: selected.id, selected_structure_id: "ethanol", selected_structure_version_id: "ethanol-input", current_view: view },
    resources: [{ entity_type: "calculation.result", entity_id: selected.id, calculation_id: selected.sourceId, structure_version_id: "ethanol-input", label: "chemdft.conformer-ensemble" }] } as ProductContext;
}
describe("AI scientific context uses canonical result navigation", () => {
  it("selects the ethanol result without leaking an active water input; server resolves ethanol input", () => {
    const hints = aiWorkspaceSelection("project", selected, view);
    expect(hints).toEqual({ selected_result_id: selected.id, current_view: view });
    const resolved = associatedAiContext(context(), "project", selected, hints);
    expect(resolved.selection.selected_structure_version_id).toBe("ethanol-input");
    expect(selectedConformerContext(resolved)).toBe(true);
  });
  it.each(["project", "result", "calculation", "version", "view"])("rejects stale or mismatched %s association", (field) => {
    const value = context();
    if (field === "project") value.project_id = "other";
    if (field === "result") value.selection.selected_result_id = "water-result";
    if (field === "calculation") value.resources[0]!.calculation_id = "water-calculation";
    if (field === "version") value.resources[0]!.structure_version_id = "water-input";
    if (field === "view") value.selection.current_view = "Water V1";
    expect(() => associatedAiContext(value, "project", selected, aiWorkspaceSelection("project", selected, view))).toThrow();
  });
  it("clears result hints on close, ignores foreign selections and preserves structure/document hints", () => {
    expect(aiWorkspaceSelection("project", null, "Overview")).toEqual({ current_view: "Overview" });
    expect(aiWorkspaceSelection("other", selected, "Overview")).toEqual({ current_view: "Overview" });
    expect(aiWorkspaceSelection("project", { kind: "structureVersion", projectId: "project", id: "water-version", sourceId: "water" }, "Water V1"))
      .toEqual({ current_view: "Water V1", selected_structure_id: "water", selected_structure_version_id: "water-version" });
    expect(() => associatedAiContext(context(), "project", null, { current_view: view })).toThrow(/previous result/);
  });
  it("preserves xTB result identity and does not apply the conformer explanation restriction", () => {
    const value = context(); value.resources[0]!.label = "chemdft.optimization";
    expect(associatedAiContext(value, "project", selected, aiWorkspaceSelection("project", selected, view))).toBe(value);
    expect(selectedConformerContext(value)).toBe(false);
  });
});

function status(state: string, diagnostic?: string) {
  const detail = { calculation: { id: "calculation", state }, attempt: { diagnostic, raw_artifacts: [] }, result: null } as unknown as CalculationDetail;
  return renderToStaticMarkup(createElement(ConformerRunStatus, { projectId: "project", detail, onOpenResult: () => {} }));
}
describe("actual conformer status wording", () => {
  it("distinguishes queued from running native sampling", () => {
    expect(status("QUEUED")).toContain("CREST sampling has not started");
    expect(status("QUEUED")).not.toContain("sampling is in progress");
    expect(status("RUNNING")).toContain("sampling is in progress");
  });
  it("only explains #494 when the failed diagnostic identifies a restart", () => {
    expect(status("FAILED", "Outer lower-conformer restart rejected (upstream #494)")).toContain("fail closed");
    for (const html of [status("CANCELED"), status("FAILED", "Native wall timeout"), status("FAILED", "Incomplete native evidence")]) {
      expect(html).not.toContain("#494"); expect(html).not.toContain("Cancellation requested");
      expect(html).not.toContain("Open completed ensemble");
    }
  });
});

describe("AI run request (0.0.20)", () => {
  it("carries the ids a page published, not only the view text", async () => {
    const { aiRunPayload } = await import("../src/lib/ai-workspace-context");
    const body = aiRunPayload("q", "CHAT", "GENERAL", { current_view: "Claims", selected_claim_id: "c1", selected_job_id: "j1", compared_result_ids: ["r1", "r2"] } as never);
    expect(body).toMatchObject({ content: "q", mode: "CHAT", planning_profile: "GENERAL", selected_claim_id: "c1", selected_job_id: "j1", compared_result_ids: ["r1", "r2"] });
    expect("run_limits" in body).toBe(false);
    expect(aiRunPayload("q", "CHAT", "GENERAL", { current_view: "x" }, { max_steps: 1 })).toHaveProperty("run_limits");
  });
});
