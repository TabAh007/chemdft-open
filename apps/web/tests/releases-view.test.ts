import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Verified } from "../src/app/_components/public-doc/releases-view";
import { RELEASES, type ReleaseEntry } from "../src/content/releases";

const render = (release: ReleaseEntry) => renderToStaticMarkup(createElement(Verified, { release }));

describe("releases page: the Verified heading is never empty", () => {
  it("says so in a plain line when nothing was verified", () => {
    const empty = RELEASES.find((r) => r.scientificStatus.verified.length === 0)!;
    const html = render(empty);
    expect(html).toContain("Nothing in this release was verified yet.");
    expect(html).not.toMatch(/<ul class="[^"]*claim[^"]*"><\/ul>/);
  });
  it("lists the claims when there are some", () => {
    const html = render(RELEASES.find((r) => r.version === "0.0.18")!);
    expect(html).not.toContain("Nothing in this release was verified yet.");
    expect(html).toContain("Hosted beta, chemdft.com");
  });
  it("no release renders an empty Verified section", () => {
    for (const release of RELEASES) {
      const html = render(release);
      const hasList = /<li>/.test(html.split("Not yet verified")[0]!);
      expect(hasList || html.includes("Nothing in this release was verified yet.")).toBe(true);
    }
  });
});
