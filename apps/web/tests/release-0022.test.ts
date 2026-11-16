import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_FILES, BrandMark } from "../src/app/_components/brand-mark";
import { RELEASES } from "../src/content/releases";

const WEB = resolve(__dirname, "..");
const pub = (p: string) => resolve(WEB, "public", p.replace(/^\//, ""));
const app = (p: string) => resolve(WEB, "src/app", p);

// The logo and icons are the owner's artwork and are not part of the public export; these checks run only where they exist.
const HAS_ARTWORK = existsSync(pub("brand")) && existsSync(app("favicon.ico"));

describe.skipIf(!HAS_ARTWORK)("0.0.22 brand files", () => {
  const brand = [
    ...["logo-horizontal", "logo-stacked", "mark", "mark-small"].flatMap((n) => [`${n}-light.svg`, `${n}-dark.svg`]).map((f) => `brand/svg/${f}`),
    "brand/svg/favicon.svg", "brand/svg/app-icon.svg", "brand/BRAND_README.txt",
    ...["favicon-16", "favicon-32", "favicon-48", "favicon-192", "apple-touch-icon-180", "app-icon-512"].map((f) => `brand/png/${f}.png`),
  ];
  it.each(brand)("%s exists and is not empty", (f) => {
    expect(existsSync(pub(f))).toBe(true);
    expect(statSync(pub(f)).size).toBeGreaterThan(100);
  });
  it("every path BrandMark can reference resolves to a file", () => {
    for (const p of Object.values(BRAND_FILES)) expect(existsSync(pub(p))).toBe(true);
  });
  it("the light logo keeps the documented wordmark colour and has no dark variant in use", () => {
    expect(readFileSync(pub("brand/svg/logo-horizontal-light.svg"), "utf8")).toContain("#12263A");
    expect(Object.values(BRAND_FILES).join(" ")).not.toContain("dark");
  });
});

describe("0.0.22 BrandMark accessibility", () => {
  for (const compact of [false, true]) {
    it(`${compact ? "compact" : "full"} variant has exactly one accessible name "ChemDFT" and explicit size`, () => {
      const html = renderToStaticMarkup(createElement(BrandMark, { compact }));
      expect(html.match(/alt="ChemDFT"/g)).toHaveLength(1);
      expect(html).not.toContain("aria-label");
      expect(html).not.toMatch(/>ChemDFT</);
      expect(html).toMatch(/width="\d+"/);
      expect(html).toMatch(/height="\d+"/);
      expect(html).toContain(compact ? BRAND_FILES.markSmall : BRAND_FILES.horizontal);
    });
  }
});

describe.skipIf(!HAS_ARTWORK)("0.0.22 icons (Next.js app-router file convention, relative links, metadataBase untouched)", () => {
  const files: Array<[string, string]> = [
    ["icon.svg", "brand/svg/favicon.svg"], ["icon1.png", "brand/png/favicon-32.png"], ["icon2.png", "brand/png/favicon-48.png"],
    ["icon3.png", "brand/png/favicon-192.png"], ["icon4.png", "brand/png/app-icon-512.png"], ["apple-icon.png", "brand/png/apple-touch-icon-180.png"],
  ];
  it.each(files)("src/app/%s is the supplied %s byte for byte", (a, b) => {
    expect(readFileSync(app(a)).equals(readFileSync(pub(b)))).toBe(true);
  });
  it("favicon.ico holds the supplied 16, 32 and 48 px PNGs", () => {
    const ico = readFileSync(app("favicon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1);
    const n = ico.readUInt16LE(4);
    expect(n).toBe(3);
    const sizes = Array.from({ length: n }, (_, i) => ico[6 + i * 16]);
    expect(sizes).toEqual([16, 32, 48]);
  });
  it("the root layout uses the production SITE_URL as metadataBase and declares no absolute icon URLs", () => {
    const layout = readFileSync(app("layout.tsx"), "utf8");
    expect(layout).toContain("new URL(SITE_URL)");
    expect(layout).not.toContain("chemdft.invalid");
    expect(layout).not.toMatch(/icons\s*:/);
  });
});

describe("0.0.22 release notes", () => {
  it("is the newest entry with a non-empty Verified list and the honest limits", () => {
    const e = RELEASES.find((r) => r.version === "0.0.22")!;
    expect(e.version).toBe("0.0.22");
    expect(e.scientificStatus.verified.length).toBeGreaterThan(0);
    expect(e.scientificStatus.notYetVerified.join(" ")).toContain("live site");
    expect(e.scientificStatus.knownLimits.join(" ")).toContain("No scientific calculation was performed");
  });
});
