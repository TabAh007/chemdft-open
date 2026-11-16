import { describe, expect, it } from "vitest";
import type { DrawResponse, DrawStepView } from "@chemdft/schemas";
import { applicableSteps, buildDrawPayload, extendTrail, newTrail, padMolfile, undoAll, undoLastStep } from "@/lib/molecule-editor/ai-draw";

const step = (index: number, ok = true): DrawStepView => ({ index, op: { op: "clean_up" }, ok, molfile: ok ? `mol${index}` : null, error: ok ? null : "bad", description: "x" }) as DrawStepView;
const response = (status: DrawResponse["status"], steps: DrawStepView[]): DrawResponse => ({ status, reply: "r", steps, label: "AI-drafted · schematic" }) as DrawResponse;

describe("DRAW client helpers", () => {
  it("builds a bounded payload: trimmed text, last six turns, empty drawing as null", () => {
    const history = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(900) }) as const);
    const payload = buildDrawPayload("  draw ethanol  ", "  ", null, history);
    expect(payload.content).toBe("draw ethanol");
    expect(payload.molfile).toBeNull();
    expect(payload.history).toHaveLength(6);
    expect(payload.history?.every((turn) => turn.content.length <= 600)).toBe(true);
    expect(buildDrawPayload("x".repeat(2000), "M", "P", []).content).toHaveLength(1000);
  });

  it("applies only validated steps, in order, up to the first failure", () => {
    expect(applicableSteps(response("OK", [step(0), step(1)])).map((s) => s.index)).toEqual([0, 1]);
    expect(applicableSteps(response("PARTIAL", [step(0), step(1, false), step(2)])).map((s) => s.index)).toEqual([0]);
    for (const status of ["REJECTED", "CLARIFY", "REFUSED", "NO_CHANGE", "ERROR"] as const) expect(applicableSteps(response(status, [step(0)]))).toEqual([]);
  });

  it("keeps an undo trail independent of Ketcher: last step, all, and branching after an undo", () => {
    let trail = extendTrail(newTrail("base"), [step(0), step(1), step(2)]);
    expect(trail).toEqual({ molfiles: ["base", "mol0", "mol1", "mol2"], pos: 3 });
    const one = undoLastStep(trail)!;
    expect(one.molfile).toBe("mol1");
    trail = extendTrail(one.trail, [step(5)]);
    expect(trail.molfiles).toEqual(["base", "mol0", "mol1", "mol5"]);
    expect(undoAll(trail)).toMatchObject({ molfile: "base", trail: { pos: 0 } });
    expect(undoLastStep(newTrail("base"))).toBeNull();
  });

  it("re-pads molfile title lines that a transport trimmed", () => {
    const body = "  3  2  0  0  0  0  0  0  0  0999 V2000\nM  END\n";
    expect(padMolfile(`RDKit 2D\n\n${body}`).split("\n")[3]).toContain("V2000");
    const good = `\n  rd\n\n${body}`;
    expect(padMolfile(good)).toBe(good);
    expect(padMolfile("garbage")).toBe("garbage");
  });
});
