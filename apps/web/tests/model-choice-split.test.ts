import { describe, expect, it } from "vitest";
import { splitModelChoices, type ModelChoice } from "../src/lib/ai-model-choices";

const choice = (model: string, selectable: boolean, reason: string | null = null): ModelChoice => ({
  key: `p::${model}`, provider: "p", model, label: model, selectable, reason, capability: null, localTestOnly: false,
});

describe("splitModelChoices", () => {
  const all = [choice("a", true), choice("b", false, "Not configured"), choice("c", true), choice("d", false, "Development use only")];
  it("puts selectable models first and the rest apart, keeping each reason", () => {
    const { available, unavailable } = splitModelChoices(all);
    expect(available.map((c) => c.model)).toEqual(["a", "c"]);
    expect(unavailable.map((c) => [c.model, c.reason])).toEqual([["b", "Not configured"], ["d", "Development use only"]]);
    expect(unavailable.every((c) => !c.selectable)).toBe(true);
  });
  it("keeps the current selection in the first group even when it cannot be chosen", () => {
    const { available, unavailable } = splitModelChoices(all, "p::b");
    expect(available.map((c) => c.model)).toEqual(["a", "b", "c"]);
    expect(unavailable.map((c) => c.model)).toEqual(["d"]);
  });
  it("loses and invents nothing", () => {
    const { available, unavailable } = splitModelChoices(all);
    expect(available.length + unavailable.length).toBe(all.length);
  });
});
