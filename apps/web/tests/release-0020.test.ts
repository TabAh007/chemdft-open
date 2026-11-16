import { describe, expect, it } from "vitest";
import { RELEASES } from "../src/content/releases";

describe("0.0.20 release notes", () => {
  it("lists what was run and says no calculation was performed", () => {
    const entry = RELEASES.find((r) => r.version === "0.0.20")!;
    expect(entry.scientificStatus.verified.length).toBeGreaterThan(0);
    expect(entry.scientificStatus.notYetVerified.join(" ")).toContain("selected job");
    expect(entry.scientificStatus.notYetVerified.join(" ")).not.toContain("live check with a real AI model on the Claims page is not done");
    expect(entry.scientificStatus.verified.map((v) => v.platform).join(" ")).toContain("Live site");
    expect(entry.scientificStatus.knownLimits.join(" ")).toContain("No scientific calculation was performed");
  });
  it("the 0.0.18 entry says plainly that the live check found the chat did not read the selection", () => {
    const old = RELEASES.find((r) => r.version === "0.0.18")!;
    expect(old.scientificStatus.notYetVerified.join(" ")).toContain("fixed in 0.0.20");
  });
});
