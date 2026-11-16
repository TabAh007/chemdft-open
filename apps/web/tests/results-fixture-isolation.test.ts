import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Test fixtures hold accepted historical records and synthetic scientific values for tests only. This guards the boundary:
 * production source must never import them, embed their values or ids, or manufacture scientific results by itself.
 */
const SRC = join(__dirname, "..", "src");
const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx|css|json)$/.test(name)) files.push(path);
  }
})(SRC);
const source = files.map((file) => ({ file: relative(SRC, file), text: readFileSync(file, "utf8") }));

describe("test fixtures stay out of production source", () => {
  it("scans the whole source tree", () => expect(files.length).toBeGreaterThan(200));
  it("never imports from the tests directory or a fixtures file", () => {
    const offenders = source.filter(({ text }) => /from\s+["'][^"']*(?:\/tests\/|\.\.\/tests|fixtures\/)/.test(text) || /require\(["'][^"']*fixtures/.test(text));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
  it("embeds none of the accepted H2 fixture's scientific values, hashes or markers", () => {
    const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "as-c1-h2-scientific-log.json"), "utf8")) as { energy: number; source_native_log_sha256: string; nuclear_repulsion: number };
    const needles = [String(fixture.energy), fixture.source_native_log_sha256, String(fixture.nuclear_repulsion), "mock fixture", "MOCK FIXTURE"];
    const offenders = source.flatMap(({ file, text }) => needles.filter((needle) => text.includes(needle)).map((needle) => `${file}: ${needle}`));
    expect(offenders).toEqual([]);
  });
  it("contains no zero-filled scientific identifiers (only the documented dev identity constants)", () => {
    const allowed = new Set(["lib/api-proxy.ts"]);
    const offenders = source.filter(({ file, text }) => !allowed.has(file) && /00000000-0000-4000-8000-0000000/.test(text));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
  it("the Results code only reads: it never POSTs, PUTs or DELETEs a result, and generates no energies", () => {
    const results = source.filter(({ file }) => /results\/|results-model|result-inspector-model|use-result-record|use-native-evidence|use-project-role|native-log-view/.test(file));
    expect(results.length).toBeGreaterThan(8);
    for (const { file, text } of results) {
      expect(text, file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
      expect(text, file).not.toMatch(/Math\.random|faker|crypto\.randomUUID/);
    }
  });
  it("test fixtures carry an explicit isolation note", () => {
    expect(readFileSync(join(__dirname, "fixtures", "README.md"), "utf8")).toMatch(/never imported by production code/i);
  });
});
