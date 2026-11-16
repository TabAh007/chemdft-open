import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Laptop layout of the Projects, Learn, Jobs, Compare, Results, Claims, Settings and Paper-vs-ChemDFT pages at 1093x520,
 * 1280x600, 1366x768 and 1920x1080, with and without post-Chrome-109 CSS, with +40% longer labels and (where the page has
 * one) the AI dock open. Pages that need data are served by the presentation-fixture mock APIs (tests/fixtures/*-mock-api.mjs,
 * not scientific results) through page.route, so one dev server serves every page:
 *   PORT=8291 node tests/fixtures/jobs-mock-api.mjs   (8292 claims, 8293 comparison, 8294 settings)
 *   pnpm exec next dev -p 3210
 *   pnpm exec playwright test -c playwright.editor.config.ts other-pages-layout
 * Every case records its measurements to output/layout-other-pages/<LAYOUT_TAG>.json (LAYOUT_TAG=before|after).
 */
const TAG = process.env.LAYOUT_TAG ?? "after";
const OUT = resolve("../../output/layout-other-pages");
mkdirSync(OUT, { recursive: true });
const MOCK = { jobs: 8291, claims: 8292, comparison: 8293, settings: 8294 } as const;
type Kind = keyof typeof MOCK | "none";

const SMALL = "00000000-0000-4000-8000-0000000000a1";
const CLAIMS = "00000000-0000-4000-8000-0000000000a1";
const COMPARISON = "00000000-0000-4000-8000-0000000000d1";
const SETTINGS_PROJECT = "00000000-0000-4000-8000-0000000000e1";

const PAGES: { id: string; path: string; kind: Kind; ready: string; dock?: boolean }[] = [
  { id: "projects", path: "/en/projects", kind: "none", ready: "main" },
  { id: "learn", path: "/en/learn", kind: "none", ready: "main" },
  { id: "releases", path: "/en/releases", kind: "none", ready: "main" },
  { id: "license", path: "/en/license", kind: "none", ready: "main" },
  { id: "cite", path: "/en/learn/cite", kind: "none", ready: "main" },
  { id: "jobs", path: `/en/projects/${SMALL}/jobs`, kind: "jobs", ready: "main", dock: true },
  { id: "compare", path: `/en/projects/${SMALL}/compare`, kind: "jobs", ready: "main", dock: true },
  { id: "results", path: `/en/projects/${SMALL}/results`, kind: "jobs", ready: "main", dock: true },
  { id: "claims", path: `/en/projects/${CLAIMS}/claims`, kind: "claims", ready: ".claim-row", dock: true },
  { id: "paper-vs-chemdft", path: `/en/projects/${COMPARISON}/comparison`, kind: "comparison", ready: "tr.comparison-row", dock: true },
  { id: "settings", path: "/en/settings/general", kind: "settings", ready: "main" },
  { id: "project-settings", path: `/en/projects/${SETTINGS_PROJECT}/settings`, kind: "settings", ready: "main" },
];
const VIEWPORTS = [
  { name: "1093x520", width: 1093, height: 520 },
  { name: "1280x600", width: 1280, height: 600 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
];
const VARIANTS = ["normal", "chrome109", "labels+40%"] as const;

const projectList = ["Cr2O3 doping study with a deliberately long project name to test truncation", "Water benchmarks", "Caffeine", "Benzene", "Ethanol conformers", "Spectra import", "Untitled"].map((name, i) => ({
  id: `00000000-0000-4000-8000-00000000${String(i + 1).padStart(4, "0")}`, name, slug: `p-${i}`, organization_id: "00000000-0000-4000-8000-000000000001",
  role: "OWNER", created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-2" + (i % 9) + "T10:00:00Z",
}));

async function wire(page: Page, kind: Kind) {
  await page.route("**/api/chemdft/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/chemdft/, "") + url.search;
    if (kind === "none" || (kind !== "settings" && path.split("?")[0] === "/v1/projects")) {
      if (path.split("?")[0] === "/v1/projects") return route.fulfill({ json: projectList });
      return route.fulfill({ status: 404, json: { detail: "layout fixture: no data" } });
    }
    try {
      const response = await route.fetch({ url: `http://127.0.0.1:${MOCK[kind]}${path}` });
      return route.fulfill({ response });
    } catch {
      return route.fulfill({ status: 502, json: { detail: "layout fixture: mock API not running" } });
    }
  });
}

async function strip(page: Page) {
  await page.evaluate(() => {
    const bad = /color-mix\(|text-wrap|subgrid|@starting-style|@scope|anchor-name|field-sizing/;
    const walk = (rules: CSSRuleList) => {
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        const rule = rules[i] as CSSRule & { cssRules?: CSSRuleList; parentRule?: CSSRule | null; parentStyleSheet?: CSSStyleSheet | null };
        if (rule.cssRules?.length) walk(rule.cssRules);
        if (bad.test(rule.cssText) && !rule.cssRules?.length) {
          const owner = (rule.parentRule as (CSSRule & { deleteRule?: (index: number) => void }) | null) ?? rule.parentStyleSheet;
          try { owner?.deleteRule?.(i); } catch { /* cross-origin */ }
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) { try { walk(sheet.cssRules); } catch { /* cross-origin */ } }
  });
}

async function growLabels(page: Page) {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as Text;
      const parent = text.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT)$/.test(parent.tagName)) continue;
      if (text.data.trim().length >= 4 && text.data.trim().length <= 40) nodes.push(text);
    }
    for (const node of nodes) node.data = node.data.replace(/(\S+)\s*$/, (m) => m + "n".repeat(Math.ceil(node.data.trim().length * 0.4)));
  });
}

type Measure = { mainWidth: number; docOverflowPx: number; clipped: string[]; hiddenOverflow: string[]; tableOutside: string[]; headerRows: number; headerBottom: number; underDock: string[]; primaryOutside: string[] };

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const scrollAncestor = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) return p;
      }
      return null;
    };
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? "." + (el as HTMLElement).className.split(/\s+/)[0] : ""}:${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 28)}`;
    const interactive = Array.from(document.querySelectorAll("button, a[href], input, select, textarea, [role=tab], [role=button]")).filter(visible);
    const clipped = interactive.filter((el) => { const r = el.getBoundingClientRect(); return (r.right > vw + 1 || r.left < -1) && !scrollAncestor(el); }).map(label).slice(0, 12);
    const hiddenOverflow = Array.from(document.querySelectorAll("body *")).filter((el) => {
      if (!visible(el)) return false;
      const s = getComputedStyle(el);
      return /(hidden|clip)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 2 && el.querySelector("button, a[href], input, select");
    }).map(label).slice(0, 8);
    const tableOutside = Array.from(document.querySelectorAll("table")).filter(visible).filter((t) => { const r = t.getBoundingClientRect(); return r.right > vw + 1 && !scrollAncestor(t); }).map(label);
    const header = document.querySelector("header") ?? document.querySelector("[role=banner]");
    const tops = header ? Array.from(header.querySelectorAll("a, button")).filter(visible).map((e) => Math.round((e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2) / 28)) : [];
    const headerRows = new Set(tops).size;
    const headerBottom = header ? Math.round(header.getBoundingClientRect().bottom) : 0;
    const dock = document.querySelector("[data-testid=ai-dock], .ai-dock, aside[aria-label*='AI']");
    // A dock that is a fixed overlay drawer opened on request is meant to cover the page; only an in-flow dock must not hide controls.
    const dr = dock && visible(dock) && getComputedStyle(dock).position !== "fixed" ? dock.getBoundingClientRect() : null;
    const underDock = dr ? Array.from(document.querySelectorAll("main button, main a[href], main input")).filter(visible).filter((el) => { const r = el.getBoundingClientRect(); return !dock!.contains(el) && r.right > dr.left + 2 && r.left < dr.right - 2 && r.bottom > dr.top && r.top < dr.bottom; }).map(label).slice(0, 8) : [];
    const primary = Array.from(document.querySelectorAll("main h1, main [data-primary], main button[class*=primary], main .bp5-intent-primary")).filter(visible);
    const primaryOutside = primary.filter((el) => { const r = el.getBoundingClientRect(); return (r.right > vw + 1 || r.left < -1 || r.top > vh) && !scrollAncestor(el); }).map(label).slice(0, 6);
    return { mainWidth: Math.round(document.querySelector("main")?.getBoundingClientRect().width ?? 0), docOverflowPx: document.documentElement.scrollWidth - vw, clipped, hiddenOverflow, tableOutside, headerRows, headerBottom, underDock, primaryOutside };
  });
}

const results: Record<string, unknown> = {};
test.afterAll(() => { if (Object.keys(results).length) writeFileSync(join(OUT, `${TAG}-${process.pid}.json`), JSON.stringify(results, null, 1)); });
test.describe.configure({ mode: "parallel" });
test.setTimeout(120_000);

for (const pg of PAGES) {
  for (const vp of VIEWPORTS) {
    for (const variant of VARIANTS) {
      for (const dockOpen of pg.dock ? [false, true] : [false]) {
        const name = `${pg.id} ${vp.name} ${variant}${dockOpen ? " +dock" : ""}`;
        test(name, async ({ page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await wire(page, pg.kind);
          await page.goto(pg.path, { waitUntil: "domcontentloaded" });
          await page.locator(pg.ready).first().waitFor({ timeout: 45_000 }).catch(() => undefined);
          await page.waitForTimeout(700);
          if (dockOpen) {
            const toggle = page.getByRole("button", { name: /AI Scientist|Open AI|AI assistant/i }).first();
            if (await toggle.isVisible().catch(() => false)) { await toggle.click().catch(() => undefined); await page.waitForTimeout(400); }
          }
          if (variant === "chrome109") await strip(page);
          if (variant === "labels+40%") await growLabels(page);
          await page.waitForTimeout(250);
          const m = await measure(page);
          results[name] = m;
          if (variant === "normal" && !dockOpen) await page.screenshot({ path: join(OUT, `${TAG}-${pg.id}-${vp.name}.png`) });
          expect.soft(m.mainWidth, "document column wide enough to use").toBeGreaterThanOrEqual(Math.min(vp.width, 640) - 1);
          expect.soft(m.docOverflowPx, "page-level horizontal scroll").toBeLessThanOrEqual(1);
          expect.soft(m.clipped, "interactive elements outside the viewport").toEqual([]);
          expect.soft(m.tableOutside, "tables wider than the viewport outside a scroll container").toEqual([]);
          expect.soft(m.hiddenOverflow, "containers hiding overflowing controls").toEqual([]);
          expect.soft(m.underDock, "main controls hidden under the AI dock").toEqual([]);
          expect.soft(m.primaryOutside, "primary heading/action unreachable").toEqual([]);
          if (vp.width >= 1280) expect.soft(m.headerRows, "header on one row").toBeLessThanOrEqual(1);
        });
      }
    }
  }
}
