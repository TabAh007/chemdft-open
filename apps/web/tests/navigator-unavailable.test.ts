import { describe, expect, it } from "vitest";
import type { NavigatorAction } from "@chemdft/schemas";
import {
  FIXER_LABEL, PLAIN_REASON, fixersOf, plainReason, resolvingActionId, sharedPrerequisite, summarizeUnavailable, summaryLine,
} from "../src/lib/navigator-unavailable";
import { reasonKind } from "../src/lib/overview-model";
import { looksLikePlanningRequest } from "../src/lib/ai-plan-intent";

const action = (id: string, codes: string[]): NavigatorAction => ({
  action_id: id, title_key: `action.${id}.title`, description_key: `action.${id}.description`,
  reasons: codes.map((code) => ({ code, message_key: `reason.${code}` })),
} as unknown as NavigatorAction);

describe("plain-language not-available reasons (release 0.0.24)", () => {
  it("has a plain sentence for every known reason code, none containing developer wording", () => {
    for (const [code, text] of Object.entries(PLAIN_REASON)) {
      expect(text.length, code).toBeGreaterThan(10);
      expect(text, code).not.toMatch(/geomeTRIC|pinned|adapter|worker-capability/i);
    }
    expect(plainReason("structure_missing")).toBe("Needs a saved structure — this project has none yet.");
    expect(plainReason("frequency_required")).toBe("Needs a validated frequency calculation first.");
    expect(plainReason("worker_unavailable")).toBe("This can't be proposed automatically here yet (on the hosted path, automatic proposals cover energy calculations only).");
    expect(plainReason("optimizer_unavailable")).toContain("Calculation setup");
  });

  it("never maps an unknown code to a guess", () => {
    expect(plainReason("brand_new_code")).toContain("Technical details");
    expect(reasonKind("brand_new_code")).toBe("other");
    expect(fixersOf(action("x", ["brand_new_code"]))).toEqual(["none"]);
    expect(FIXER_LABEL.none).toBe("Prerequisite");
  });

  it("classifies who can fix each kind of reason", () => {
    expect(fixersOf(action("a", ["structure_missing"]))).toEqual(["you"]);
    expect(fixersOf(action("a", ["frequency_required"]))).toEqual(["you"]);
    expect(fixersOf(action("a", ["worker_unavailable"]))).toEqual(["chemdft"]);
    expect(fixersOf(action("a", ["periodic_compute_unsupported"]))).toEqual(["chemdft"]);
    expect(fixersOf(action("a", ["editor_required"]))).toEqual(["access"]);
    expect(fixersOf(action("a", ["structure_missing", "worker_unavailable"]))).toEqual(["you", "chemdft"]);
  });

  it("summarises real counts, counting an action once per category", () => {
    const blocked = [
      action("a", ["structure_missing"]),
      action("b", ["structure_missing", "optimization_required"]),
      action("c", ["frequency_required"]),
      action("d", ["worker_unavailable"]),
      action("e", ["editor_required"]),
    ];
    const summary = summarizeUnavailable(blocked);
    expect(summary).toMatchObject({ total: 5, needStructure: 2, needEarlierResult: 2, platformLimits: 1, needAccess: 1 });
    expect(summaryLine(summary)).toBe("5 not available: 2 need a structure, 2 need an earlier result, 1 is a platform limit, 1 need different access");
    expect(summaryLine(summarizeUnavailable([]))).toContain("Nothing is blocked");
  });

  it("shows the shared structure prerequisite once, only when most workflows share it", () => {
    const many = [action("a", ["structure_missing"]), action("b", ["structure_missing"]), action("c", ["structure_missing", "x"]), action("d", ["frequency_required"])];
    expect(sharedPrerequisite(many)).toBe("structure_missing");
    expect(sharedPrerequisite([action("a", ["frequency_required"]), action("b", ["frequency_required"]), action("c", ["structure_missing"])])).toBeNull();
    expect(sharedPrerequisite([action("a", ["structure_missing"])])).toBeNull();
  });

  it("offers a next-step button only where a real available action resolves it, never for platform limits", () => {
    const available = new Set(["structure.import", "calculation.optimize"]);
    expect(resolvingActionId(action("a", ["structure_missing"]), available)).toBe("structure.import");
    expect(resolvingActionId(action("a", ["optimization_required"]), available)).toBe("calculation.optimize");
    expect(resolvingActionId(action("a", ["frequency_required"]), available)).toBeNull();
    expect(resolvingActionId(action("a", ["worker_unavailable"]), available)).toBeNull();
    expect(resolvingActionId(action("a", ["periodic_compute_unsupported", "structure_missing"]), new Set())).toBeNull();
    expect(resolvingActionId(action("a", ["structure_missing", "worker_unavailable"]), available)).toBe("structure.import");
  });
});

describe("planning intent for the one AI box", () => {
  it("detects calculation requests and ignores questions and small talk", () => {
    for (const yes of ["optimize the geometry", "calculate the energy of this molecule", "run a calculation", "predict the IR spectrum of benzene calculation", "single point energy", "compute the HOMO LUMO gap"]) {
      expect(looksLikePlanningRequest(yes), yes).toBe(true);
    }
    for (const no of ["hi", "what is this structure?", "how do I start a calculation", "where do I import a molecule", "i want to import molecule", "thanks"]) {
      expect(looksLikePlanningRequest(no), no).toBe(false);
    }
  });
});
