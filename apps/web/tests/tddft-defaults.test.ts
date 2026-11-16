import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// 10 states did not converge for water at def2-SVP on the hosted worker; 5 did. The def2-SVPD default of the
// legacy panel made the wrong basis easy to submit. Both forms must start from the verified case.
describe("TDDFT defaults", () => {
  it("the Guided form starts at 5 states and falls back to 5", () => {
    expect(read("src/lib/use-guided-config.ts")).toMatch(/nstates: 5,/);
    expect(read("src/app/_components/guided/guided-configure-stage.tsx")).toContain("Number.parseInt(e.target.value, 10) || 5");
  });
  it("the Guided form starts TDDFT at def2-SVP, not def2-SVPD", () => {
    expect(read("src/lib/use-guided-config.ts")).toContain('basis: task === "tddft" || task === "ir" || task === "raman" ? "def2-svp" : "sto-3g"');
  });
  it("the legacy panel defaults to 5 editable states and def2-SVP", () => {
    const panel = read("src/app/[locale]/projects/[projectId]/workspace/calculation-panel.tsx");
    expect(panel).toMatch(/useState\(5\)/);
    expect(panel).toMatch(/Excited states<input type="number"/);
    expect(panel).not.toMatch(/nstates: 10/);
    expect(panel).not.toContain('setBasis("def2-svpd")');
    expect(panel).toMatch(/if \(nextTask === "TDDFT"\) \{\s*setMethod\("b3lyp"\);\s*setBasis\("def2-svp"\);/);
  });
});
