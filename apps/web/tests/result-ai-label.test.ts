import { describe, expect, it } from "vitest";

import { resultAiLabel } from "../src/lib/result-inspector-model";

/** F15: the dock's name for an inspected result is built from recorded fields, never from an id prefix. */
const structure = { name: "Water", revision: 1, versionId: "v", label: "Water · V1" };

describe("resultAiLabel", () => {
  it.each([
    { name: "energy with a resolved input names method and structure", viewer: "energy" as const, structure, title: "Single-point energy · Water · V1", expected: "Total Energy · HF · Water · V1" },
    { name: "energy whose input could not be resolved says so, with no id", viewer: "energy" as const, structure: null, title: "Single-point energy · structure unavailable", expected: "Single-point energy · structure unavailable" },
    { name: "another result type uses the page title with the structure", viewer: "unsupported" as const, structure, title: "Vibrational frequencies · Water · V1", expected: "Vibrational frequencies · Water · V1" },
    { name: "another result type without an input uses the task only", viewer: "unsupported" as const, structure: null, title: "Vibrational frequencies", expected: "Vibrational frequencies" },
  ])("$name", ({ viewer, structure: input, title, expected }) => {
    const label = resultAiLabel({ viewer, structure: input, title }, "hf");
    expect(label).toBe(expected);
    expect(label).not.toMatch(/^Result [0-9a-f]{8}/);
  });
});
