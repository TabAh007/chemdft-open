import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LATEST_RELEASE, LATEST_VERSION, RELEASES } from "../src/content/releases";
import { SiteFooter } from "../src/app/_components/site-footer";
import { CITATION_METADATA } from "../src/lib/citation";
import { buildAtomFeed } from "../src/lib/releases-feed";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf-8");
const SEMVER = /^0\.\d+\.\d+$/;
const compare = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i += 1) if (x![i]! !== y![i]!) return x![i]! - y![i]!;
  return 0;
};

describe("release data", () => {
  it("is newest first with unique 0.x SemVer versions and ISO dates", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    for (const release of RELEASES) {
      expect(release.version).toMatch(SEMVER);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(release.date))).toBe(false);
    }
    expect(new Set(RELEASES.map((r) => r.version)).size).toBe(RELEASES.length);
    for (let i = 1; i < RELEASES.length; i += 1) {
      expect(compare(RELEASES[i - 1]!.version, RELEASES[i]!.version)).toBeGreaterThan(0);
      expect(RELEASES[i - 1]!.date >= RELEASES[i]!.date).toBe(true);
    }
  });

  it("has no empty claims and honest scientific status for every release", () => {
    for (const { title, summary, scientificStatus: s } of RELEASES) {
      expect(title.trim()).not.toBe("");
      expect(summary.trim()).not.toBe("");
      // A release may list no verified claim only when it says, in its known limits, that it ran no new scientific calculation.
      if (s.verified.length === 0) expect(s.knownLimits.some((limit) => limit.startsWith("No new scientific calculation"))).toBe(true);
      for (const claim of s.verified) {
        expect(claim.statement.trim().length).toBeGreaterThan(10);
        expect(claim.platform.trim()).not.toBe("");
        expect(claim.engine.trim()).not.toBe("");
      }
      expect(s.notYetVerified.length).toBeGreaterThan(0);
      expect(s.knownLimits.length).toBeGreaterThan(0);
    }
  });

  it("the 0.0.18 notes are in plain words and list what was actually verified", () => {
    const entry = RELEASES.find((r) => r.version === "0.0.18")!;
    expect(entry.title).toBe("Faster Jobs list and better AI answers about your selection");
    expect(entry.scientificStatus.verified.length).toBe(2);
    expect(entry.scientificStatus.notYetVerified.length).toBe(3);
    expect(JSON.stringify(entry)).not.toMatch(/minor units|grounding|server-side|\bids?\b/i);
  });

  it("contains no internal strings (deployment ids, hashes, PR numbers, instance ids, hosts, paths, test names)", () => {
    const text = JSON.stringify(RELEASES);
    const forbidden: [string, RegExp][] = [
      ["deployment id", /dpl_/i],
      ["commit hash", /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/],
      ["AWS instance id", /\bi-[0-9a-f]{8,}\b/],
      ["localhost", /localhost|127\.0\.0\.1/i],
      ["server address", /sslip\.io|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
      ["PR number", /\bPR\s*#?\d+|#\d{2,}/i],
      ["internal path", /\b[\w-]+\/[\w-]+\.(py|tsx?|mjs|json|md)\b|\/Users\//],
      ["test name", /\btest_\w+|\.spec\b|\.test\b/],
    ];
    for (const [name, pattern] of forbidden) expect(text, name).not.toMatch(pattern);
  });
});

describe("version consistency with the latest release", () => {
  it("matches package.json", () => {
    expect(JSON.parse(read("apps/web/package.json")).version).toBe(LATEST_VERSION);
  });

  it("matches the backend export release version (services/api release_info.py)", () => {
    const match = read("services/api/src/chemdft_api/release_info.py").match(/RELEASE_VERSION = "([^"]+)"/);
    expect(match?.[1]).toBe(LATEST_VERSION);
  });

  it("matches CITATION.cff version and date-released", () => {
    const cff = read("CITATION.cff");
    expect(cff.match(/^version: "?([^"\n]+)"?$/m)?.[1]).toBe(LATEST_RELEASE.version);
    expect(cff.match(/^date-released: "?([^"\n]+)"?$/m)?.[1]).toBe(LATEST_RELEASE.date);
  });

  it("matches the cite page metadata", () => {
    expect(CITATION_METADATA.version).toBe(LATEST_VERSION);
    expect(CITATION_METADATA.dateReleased).toBe(LATEST_RELEASE.date);
  });

  it("is shown in the footer with the three links and no GitHub link while the repository is private", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter, { locale: "en" }));
    expect(html).toContain(`v${LATEST_VERSION}`);
    for (const href of ["/en/releases", "/en/learn/cite", "/en/license"]) expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain("github.com");
  });
});

describe("Atom feed", () => {
  const xml = buildAtomFeed(RELEASES, { siteUrl: CITATION_METADATA.url, locale: "en" });

  it("is well formed Atom with the latest entry first", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml.trimEnd().endsWith("</feed>")).toBe(true);
    const stack: string[] = [];
    for (const m of xml.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g)) {
      const [, closing, name, , selfClosing] = m;
      if (selfClosing) continue;
      if (closing) expect(stack.pop()).toBe(name);
      else stack.push(name!);
    }
    expect(stack).toEqual([]);
    // No raw ampersand or angle bracket outside markup: every "&" starts a valid entity.
    expect(xml).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
    const ids = [...xml.matchAll(/<entry>\s*<id>([^<]+)<\/id>/g)].map((m) => m[1]);
    expect(ids).toHaveLength(RELEASES.length);
    expect(ids[0]).toContain(`release-${LATEST_VERSION}`);
    expect(new Set(ids).size).toBe(ids.length);
    const updated = [...xml.matchAll(/<entry>[\s\S]*?<updated>([^<]+)<\/updated>/g)].map((m) => m[1]!);
    expect([...updated].sort().reverse()).toEqual(updated);
    expect(xml).toContain(`/en/releases#${LATEST_VERSION}`);
  });

  it("contains no internal strings either", () => {
    expect(xml).not.toMatch(/dpl_|localhost|sslip\.io/i);
  });
});
