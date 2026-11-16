import { describe, expect, it } from "vitest";
import fixture from "./fixtures/as-c1-h2-scientific-log.json";
import { scientificLog } from "../src/lib/scientific-log";
import { findMatches, highlightRuns, lineSection, logSections } from "../src/lib/native-log-view";

const lines = scientificLog(fixture.text).excerpt.split("\n");

describe("native log display helpers (excerpt only)", () => {
  it("offers exactly the sections the excerpt contains, in order", () => {
    const sections = logSections(lines);
    expect(sections.map((s) => s.id)).toEqual(["initialization", "iterations", "convergence", "input"]);
    for (const section of sections) expect(lines[section.line]).toBeDefined();
    expect(lines[sections.find((s) => s.id === "convergence")!.line]).toMatch(/^converged SCF energy = /);
  });
  it("offers nothing for text that has no supported lines", () => {
    expect(logSections([])).toEqual([]);
    expect(logSections(["some unrelated text"])).toEqual([]);
    expect(logSections(["cycle= 1 E= -1 delta_E= 0 |g|= 0 |ddm|= 0"]).map((s) => s.id)).toEqual(["iterations"]);
  });
  it("assigns a line to a section from its own text only", () => {
    expect(lineSection("SCF conv_tol = 1e-09")).toBe("initialization");
    expect(lineSection("[INPUT] num. atoms = 2")).toBe("input");
    expect(lineSection("nuclear repulsion = 0.715")).toBe("input");
    expect(lineSection("SCF not converged. E = -1.0")).toBe("convergence");
    expect(lineSection("HOMO = -0.5  LUMO = 0.6")).toBeNull();
  });
  it("finds literal, case-insensitive matches within the displayed lines", () => {
    const matches = findMatches(lines, "converged");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    for (const m of matches) expect(lines[m.line]!.slice(m.start, m.end).toLowerCase()).toBe("converged");
    expect(findMatches(lines, "CONVERGED SCF")).toHaveLength(1);
    expect(findMatches(lines, "")).toEqual([]);
    expect(findMatches(lines, "   ")).toEqual([]);
    expect(findMatches(lines, "no such text")).toEqual([]);
  });
  it("treats the query literally, never as a regular expression", () => {
    expect(findMatches(["a.b", "axb"], "a.b")).toEqual([{ line: 0, start: 0, end: 3 }]);
    expect(findMatches(["|g|= 2"], "|g|")).toHaveLength(1);
    expect(() => findMatches(lines, "(")).not.toThrow();
  });
  it("finds several matches on one line and never searches text that is not displayed", () => {
    expect(findMatches(["ab ab ab"], "ab")).toHaveLength(3);
    expect(findMatches(lines, "python")).toEqual([]);
    expect(findMatches(lines, "checkpoint")).toEqual([]);
  });
  it("splits a line into runs that reassemble to the original text", () => {
    const line = "converged SCF energy = -1.11675930739643";
    const matches = findMatches([line], "scf");
    const runs = highlightRuns(line, matches, 0, matches[0]!.start);
    expect(runs.map((r) => r.text).join("")).toBe(line);
    expect(runs.filter((r) => r.match)).toHaveLength(1);
    expect(runs.find((r) => r.match)!.active).toBe(true);
    expect(highlightRuns("plain", [], 0, null)).toEqual([{ text: "plain", match: false, active: false }]);
  });
  it("does not change the original log text", () => {
    const original = fixture.text;
    scientificLog(original); findMatches(lines, "scf"); logSections(lines);
    expect(original).toBe(fixture.text);
  });
});
