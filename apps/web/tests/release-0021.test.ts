import { describe, expect, it } from "vitest";
import { RELEASES } from "../src/content/releases";

describe("0.0.21 release notes", () => {
  it("lists what was run, what was not, and says no calculation was performed", () => {
    const entry = RELEASES.find((r) => r.version === "0.0.21")!;
    expect(entry.version).toBe("0.0.21");
    expect(entry.scientificStatus.verified.length).toBeGreaterThan(0);
    const notYet = entry.scientificStatus.notYetVerified.join(" ");
    expect(notYet).toContain("two real accounts");
    expect(notYet).toContain("selected job");
    expect(notYet).toContain("not in the stored record");
    expect(notYet).toContain("not yet running on the live site");
    expect(entry.scientificStatus.knownLimits.join(" ")).toContain("No scientific calculation was performed");
  });
});
