import { describe, expect, it } from "vitest";
import { expectedHostedDuration } from "../src/lib/aws-limits";

describe("expected hosted duration", () => {
  it("states the measured time and the limit for tasks that ran on the hosted worker", () => {
    expect(expectedHostedDuration("tddft", false)).toBe("About 28 s for a water-sized molecule once the worker is running (the worker takes 2-3 minutes to start); stopped after 10 min.");
    expect(expectedHostedDuration("energy", true)).toContain("stopped after 30 min");
  });
  it("never invents a time for xTB optimization, which has not run on the hosted worker", () => {
    expect(expectedHostedDuration("optimization", true)).toBe("Not yet timed on the hosted worker; it is stopped after 15 min.");
  });
  it("returns nothing for tasks the hosted route does not run", () => {
    expect(expectedHostedDuration("conformer", false)).toBeNull();
    expect(expectedHostedDuration("raman", false)).toBeNull();
  });
});
