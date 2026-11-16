import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LicenseView } from "../src/app/_components/public-doc/license-view";
import { GITHUB_URL, LICENSE_ROWS, OPEN_REPOSITORY_URL, REGISTRY_NAMED_FOR_LICENSE_PAGE, THIRD_PARTY } from "../src/content/license";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf-8");

/** Paths of every Apache-2.0 annotation in REUSE.toml (the file keeps one `path = [...]` array per annotation). */
function openPathsFromReuse(): string[] {
  const toml = read("REUSE.toml");
  const out: string[] = [];
  for (const block of toml.split("[[annotations]]").slice(1)) {
    if (!/SPDX-License-Identifier = "Apache-2\.0"/.test(block)) continue;
    const array = block.match(/path = \[([\s\S]*?)\]/)?.[1] ?? "";
    out.push(...[...array.matchAll(/"([^"]+)"/g)].map((m) => m[1]!));
  }
  return out;
}

describe("License page data", () => {
  it("covers every directory REUSE.toml marks Apache-2.0, and labels the other groups", () => {
    const apache = openPathsFromReuse();
    const rows = LICENSE_ROWS.filter((row) => row.group === "open").flatMap((row) => row.paths);
    // Every open row must be a real Apache-2.0 path in REUSE.toml.
    for (const path of rows) expect(apache, path).toContain(path);
    // Every Apache directory glob must be shown to a reader somewhere.
    for (const path of apache.filter((p) => p.endsWith("/**"))) expect(rows, path).toContain(path);
    expect(LICENSE_ROWS.filter((row) => row.group === "third-party")).toHaveLength(1);
    expect(LICENSE_ROWS.filter((row) => row.group === "excluded")).toHaveLength(1);
    expect(LICENSE_ROWS.filter((row) => row.group === "artwork")).toHaveLength(1);
    for (const row of LICENSE_ROWS) {
      expect(row.spdx).toBe(row.group === "open" ? "Apache-2.0" : row.group === "artwork" ? "LicenseRef-ChemDFT-Proprietary" : row.spdx);
    }
  });

  it("covers every dependency the registry names for this page, each with a license and an evidence note", () => {
    const names = THIRD_PARTY.map((row) => row.name.toLowerCase());
    for (const required of REGISTRY_NAMED_FOR_LICENSE_PAGE) expect(names.some((n) => n.includes(required.toLowerCase())), required).toBe(true);
    if (existsSync(resolve(root, "docs/TECHNOLOGY_REGISTRY.md"))) {
      const registry = read("docs/TECHNOLOGY_REGISTRY.md");
      for (const required of REGISTRY_NAMED_FOR_LICENSE_PAGE) expect(registry.toLowerCase(), required).toContain(required.toLowerCase());
    }
    for (const row of THIRD_PARTY) {
      expect(row.license.trim(), row.name).not.toBe("");
      expect(row.evidence.trim(), row.name).not.toBe("");
      expect(["verified", "upstream", "not verified"]).toContain(row.status);
    }
  });

  it("does not claim public availability or link a repository that does not exist", () => {
    expect(GITHUB_URL).toBeNull();
    expect(OPEN_REPOSITORY_URL).toBeNull();
    const html = renderToStaticMarkup(createElement(LicenseView));
    expect(html).toContain("Source licence: Apache-2.0 for all ChemDFT first-party code. Public source repository: not published yet");
    expect(html).not.toMatch(/publicly available|TabAh007/i);
    expect(html).toContain("Apache-2.0");
    expect(html).toContain("Third-party software");
    expect(html).toMatch(/no warranty/i);
  });
});
