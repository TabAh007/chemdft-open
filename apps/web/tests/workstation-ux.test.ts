import { describe, expect, it } from "vitest";
import { aiProgress, answerSections, formatThreshold, parsePositiveThreshold, runBusy, sliderThreshold, supersededAnswer, workbenchKind } from "../src/lib/workstation-ux";
import { emptyWorkspaceState, openWorkspaceTab, focusWorkspaceTab, closeWorkspaceTab } from "../src/lib/workspace-tabs";
import type { AIMessageView, AIRunView } from "@chemdft/schemas";
const run = (status: AIRunView["status"], steps: AIRunView["steps"] = []): AIRunView => ({ status, steps } as AIRunView);
const message = (role: AIMessageView["role"], evidence_status: AIMessageView["evidence_status"], content="Saved answer"): AIMessageView => ({ role, evidence_status, content } as AIMessageView);
describe("scientific workstation controls", () => {
  it("classifies toolbar by current workbench instead of unrelated structure selection", () => {
    expect(workbenchKind(null)).toBe("project");
    expect(workbenchKind({kind:"calculationResult"} as never)).toBe("result");
    expect(workbenchKind({kind:"structureVersion"} as never)).toBe("structure");
    expect(workbenchKind({kind:"experimentalDataset"} as never)).toBe("dataset");
    expect(workbenchKind({kind:"document"} as never)).toBe("source");
  });
  it("accepts exact decimal/comma/exponent thresholds without silent clamping", () => {
    expect(parsePositiveThreshold("0,001")).toBe(.001);
    expect(parsePositiveThreshold(".035123456789")).toBe(.035123456789);
    expect(parsePositiveThreshold("1e-4")).toBe(.0001);
    expect(parsePositiveThreshold("999")).toBe(999); // a meaningful empty surface, not an error
    for (const bad of ["", "0", "-1", "NaN", "Infinity", "1e999", "1,2,3"]) expect(parsePositiveThreshold(bad)).toBeNull();
    for (const value of [.0001,.001,.01,.1,.035]) expect(parsePositiveThreshold(formatThreshold(value))).toBe(value);
    expect(formatThreshold(.001)).toBe("0.001");
  });
  it("maps density slider naturally across decades", () => {
    expect([-4,-3,-2,-1].map(sliderThreshold)).toEqual([.0001,.001,.01,.1]);
  });
  it("brings existing and newly opened records to front; closing a background tab keeps focus", () => {
    const selection = { kind:"note", id:"a", projectId:"p" } as const;
    const other = {...selection,id:"b"};
    const state=openWorkspaceTab(openWorkspaceTab(emptyWorkspaceState(),{selection,label:"A"}),{selection:other,label:"B"});
    expect(focusWorkspaceTab(state,"note:a").activeKey).toBe("note:a");
    expect(focusWorkspaceTab(focusWorkspaceTab(state,"note:a"),"note:a").activeKey).toBe("note:a");
    expect(openWorkspaceTab(state,{selection,label:"A"}).tabs).toHaveLength(2);
    expect(closeWorkspaceTab(state,"note:a").activeKey).toBe("note:b");
  });
});
describe("explicit AI execution state", () => {
  it("shows immediate pending feedback but no fabricated retrieval", () => {
    expect(aiProgress(null,true)).toContain("Question submitted");
    expect(aiProgress(null,true)).not.toContain("Retrieving");
    expect(aiProgress(null,false)).toBeNull();
  });
  it("disables duplicate questions for every nonterminal server state", () => {
    for (const state of ["CREATED","PLANNING","EXECUTING","WAITING_FOR_APPROVAL","WAITING_FOR_CALCULATION"] as const) expect(runBusy(run(state))).toBe(true);
    for (const state of ["SUCCEEDED","FAILED","CANCELED"] as const) expect(runBusy(run(state))).toBe(false);
  });
  it("reports only actual backend context/tool/calculation states", () => {
    expect(aiProgress(run("PLANNING"),false)).toBe("Gathering project context…");
    expect(aiProgress(run("EXECUTING",[{status:"RUNNING",tool_name:"knowledge.search"}] as never),false)).toBe("Retrieving supporting evidence…");
    expect(aiProgress(run("WAITING_FOR_CALCULATION"),false)).toBe("Calculation running…");
    expect(aiProgress(run("SUCCEEDED"),false)).toBeNull();
  });
  it("collapses superseded failures while keeping newest failures inspectable", () => {
    const failed=message("assistant","INSUFFICIENT_EVIDENCE","Previous answer unavailable");
    expect(supersededAnswer(failed,0,[failed,message("assistant","SUPPORTED")])).toBe(true);
    expect(supersededAnswer(failed,0,[failed])).toBe(false);
    expect(supersededAnswer(message("assistant","SUPPORTED"),0,[message("assistant","SUPPORTED")])).toBe(false);
  });
  it("formats paragraphs/headings without rewriting citations or scientific text", () => {
    const input="## Density\n9.6195 e [[P7]]\n\nESP: −0.0709 a.u. [[P8]]";
    const sections=answerSections(input);
    expect(sections).toEqual([{heading:"Density",content:"9.6195 e [[P7]]"},{heading:"ESP:",content:"−0.0709 a.u. [[P8]]"}]);
  });
  it("honors existing single-newline summary boundaries and keeps supported limitations visible", () => {
    expect(answerSections("Result [P1]\nStructures:\n- Water [P2]\nELECTRON_DENSITY: 9.619521 e [P3]")).toEqual([
      {heading:null,content:"Result [P1]"},{heading:"Structures:",content:""},
      {heading:null,content:"- Water [P2]"},{heading:"ELECTRON_DENSITY:",content:"9.619521 e [P3]"},
    ]);
    const supported=message("assistant","SUPPORTED","We could not infer atomic charges from these fields.");
    expect(supersededAnswer(supported,0,[supported,message("assistant","SUPPORTED")])).toBe(false);
  });
});
