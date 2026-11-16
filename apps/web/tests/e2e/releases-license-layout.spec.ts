import { expect, test, type Page } from "@playwright/test";

/**
 * Footer, Releases menu item, Releases and License pages on the public pages at 1093x520, 1280x600, 1366x768 and 1920x1080,
 * normal, with post-Chrome-109 CSS removed, and with +40% longer labels. These pages have no AI Scientist drawer, so
 * "with and without the AI drawer" does not apply to them (the signed-in header is checked on /en/projects, which the drawer
 * layouts in other-pages-layout.spec.ts already cover). Start the app first:  pnpm exec next dev -p 3210
 *   pnpm exec playwright test -c playwright.editor.config.ts releases-license-layout
 */
const VIEWPORTS = [
  { width: 1093, height: 520 },
  { width: 1280, height: 600 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];
const VARIANTS = ["normal", "chrome109", "labels+40%"] as const;
const PAGES = ["/en", "/en/releases", "/en/license", "/en/learn/cite", "/en/projects"];

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

test.describe.configure({ mode: "parallel" });

// `next dev` compiles a route on its first request; warming every page once keeps the first parallel cases from racing the compiler.
test.beforeAll(async ({ request }) => {
  for (const path of [...PAGES, "/en/releases/feed.xml"]) await request.get(path, { timeout: 90_000 }).catch(() => undefined);
});
test.setTimeout(120_000);

for (const path of PAGES) {
  for (const vp of VIEWPORTS) {
    for (const variant of VARIANTS) {
      test(`${path} ${vp.width}x${vp.height} ${variant}`, async ({ page }) => {
        await page.setViewportSize(vp);
        if (path === "/en/projects") {
          await page.route("**/api/chemdft/**", (route) => route.fulfill({ json: [{ id: "00000000-0000-4000-8000-000000000001", name: "Water benchmarks", slug: "p-0", organization_id: "00000000-0000-4000-8000-000000000001", role: "OWNER", created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-02T10:00:00Z" }] }));
        }
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await page.locator("main").first().waitFor({ timeout: 45_000 });
        // Mutating text nodes before React has hydrated them forces a client re-render and loses the change: wait for a fiber on <main>.
        await page.waitForFunction(() => { const main = document.querySelector("main"); return !!main && Object.keys(main).some((key) => key.startsWith("__reactFiber$")); }, undefined, { timeout: 30_000 });
        await page.waitForTimeout(400);
        if (variant === "chrome109") await strip(page);
        if (variant === "labels+40%") await growLabels(page);

        // Releases menu item: present, visible and inside the viewport. Under 1000 px the landing nav is behind "Menu".
        if (path === "/en" && vp.width < 1000) await page.getByRole("button", { name: /Menu|Mennnn/ }).click();
        const releasesLink = page.locator("header a[href='/en/releases']").first();
        if (path !== "/en/releases" || variant !== "labels+40%") {
          await expect(releasesLink, "Releases menu item").toBeAttached();
          // Icon-only (visually hidden label) below 1280 px in the product header, so check the box, not the text.
          const box = await releasesLink.boundingBox();
          expect(box, "Releases link has a box").not.toBeNull();
          expect(box!.x + box!.width, "Releases link inside the viewport").toBeLessThanOrEqual(vp.width + 1);
        }

        // Footer: reachable, visible, unclipped (public pages only; the project list has none).
        if (path !== "/en/projects") {
          const footer = page.getByTestId("site-footer");
          await footer.scrollIntoViewIfNeeded();
          await expect(footer).toBeVisible();
          const fb = (await footer.boundingBox())!;
          expect(fb.x, "footer left edge").toBeGreaterThanOrEqual(-1);
          expect(fb.x + fb.width, "footer right edge").toBeLessThanOrEqual(vp.width + 1);
          if (variant !== "labels+40%") {
            await expect(page.getByTestId("footer-version")).toHaveText(/^v\d+\.\d+\.\d+$/);
            for (const name of ["Release notes", "How to cite", "License"]) {
              await expect(footer.getByRole("link", { name })).toBeVisible();
            }
            await expect(footer.getByRole("link", { name: "GitHub" })).toHaveCount(0);
          }
          for (const link of await footer.getByRole("link").all()) {
            const b = (await link.boundingBox())!;
            expect(b.x + b.width, "footer link inside the viewport").toBeLessThanOrEqual(vp.width + 1);
          }
        }

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "page-level horizontal scroll").toBeLessThanOrEqual(1);
      });
    }
  }
}

test("releases page: anchor opens the release, keyboard operates the entry and the menu", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/en/releases#0.0.1", { waitUntil: "load" });
  await page.waitForLoadState("load");
  await page.waitForTimeout(800); // hydration: `networkidle` never settles under next dev HMR
  const entry = page.locator("details#\\30 \\.0\\.1, details[id='0.0.1']");
  await expect(entry).toHaveAttribute("open", "");
  await expect(entry.getByRole("heading", { name: "What is verified" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Atom feed" })).toHaveAttribute("href", "/en/releases/feed.xml");
  // Keyboard: focus the summary, Enter collapses, Enter expands.
  await entry.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(entry).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(entry).toHaveAttribute("open", "");
  // Keyboard path through the header: Tab reaches Releases before Settings.
  await page.goto("/en/releases", { waitUntil: "load" });
  await page.waitForLoadState("load");
  await page.waitForTimeout(800); // hydration: `networkidle` never settles under next dev HMR
  const order = await page.evaluate(() => Array.from(document.querySelectorAll("header nav a")).map((a) => a.getAttribute("href")));
  expect(order.indexOf("/en/learn")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("/en/releases")).toBe(order.indexOf("/en/learn") + 1);
  await expect(async () => {
    await page.locator("header nav a[href='/en/releases']").focus();
    await expect(page.locator("header nav a[href='/en/releases']")).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.press("Tab");
  await expect(page.locator("header nav a[href='/en/settings/general']")).toBeFocused();
});

test("the feed is served as Atom", async ({ request }) => {
  const response = await request.get("/en/releases/feed.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/atom+xml");
  expect(await response.text()).toContain("<feed xmlns=\"http://www.w3.org/2005/Atom\">");
});
