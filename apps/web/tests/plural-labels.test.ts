import { describe, expect, it } from "vitest";
import { plural } from "@/lib/overview-model";

describe("count labels", () => {
  it("never says '1 structures' or '1 jobs'", () => {
    expect(plural(1, "job")).toBe("1 job");
    expect(plural(0, "job")).toBe("0 jobs");
    expect(plural(2, "structure")).toBe("2 structures");
    expect(plural(1, "atom")).toBe("1 atom");
  });
});
