import { describe, expect, it } from "vitest";
import { formatScientificNumber } from "../src/lib/scientific-format";

describe("scientific display formatting", () => {
  it("normalizes negative zero only in the displayed value", () => {
    expect(formatScientificNumber(-0)).toBe("0");
    expect(formatScientificNumber(-0.0000001)).toBe("0");
    expect(formatScientificNumber(-1.23456789)).toBe("-1.234568");
  });
});
