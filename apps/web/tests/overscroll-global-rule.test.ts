import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Release 0.0.56: a horizontal overscroll lock on html/body kills the macOS two-finger history swipe on every page. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
  });
}

describe("global overscroll-behavior", () => {
  it("never locks the horizontal axis on html or body", () => {
    const bad: string[] = [];
    for (const f of cssFiles(resolve(__dirname, "../src"))) {
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = (m[1] ?? "").trim();
        const decl = m[2] ?? "";
        const touchesRoot = sel.split(",").some((s) => /^(html|body|:root)\b/.test(s.trim()));
        if (!touchesRoot) continue;
        if (/overscroll-behavior(-x)?\s*:\s*(none|contain)/.test(decl)) bad.push(`${f}: ${sel}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("keeps the vertical lock scoped to the workspace shell", () => {
    const css = readFileSync(resolve(__dirname, "../src/app/shell.css"), "utf8");
    expect(css).toMatch(/html:has\(\.project-shell\)[^{]*\{\s*overscroll-behavior-y:\s*none/);
  });
});
