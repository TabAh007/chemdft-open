import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { expect, test, type Page } from "@playwright/test";

// PF-3E/F: the public homepage against the jwt-mode stack. It proves the page needs no session, that the primary
// action follows the session, that signup stays closed and that protected routes stay protected. The 3D behaviour
// (structures, representations, no coordinate interpolation, scroll choreography) is covered web-only in
// tests/e2e-renderer/homepage.spec.ts; this file keeps the parts that need real authentication.
const WEB = `http://127.0.0.1:${Number(process.env.CHEMDFT_E2E_AUTH_WEB_PORT ?? 3102)}`;
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const HEADLINE = "Computational chemistry, without the old workflow.";

async function open(page: Page) {
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
}

test("the homepage renders publicly with proper landmarks, no registration and no price", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  await open(page);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "See how it works" }).first()).toBeVisible();
  await expect(page.getByTestId("header-signin")).toHaveText("Sign in");
  await expect(page.getByTestId("hero-primary")).toHaveText("Sign in");
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\$\s?\d/);
  expect(text).not.toMatch(/Launch ChemDFT|From molecule to insight|AI-powered/i);
  expect(text).toMatch(/pricing are not available yet/);
  expect(text).toMatch(/public sign-up and pricing are not available yet/);
  expect(text).toMatch(/new accounts with Google while beta places last/);
  expect(text).not.toMatch(/accounts by invitation/);
  await expect(page.getByRole("link", { name: /sign up|create account|register|get started/i })).toHaveCount(0);
  await expect(page.locator("h1")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("the hero is the interactive structure stage: four reference structures, the crystal first, honestly labelled", async ({ page }) => {
  await open(page);
  const stage = page.locator("#structure-stage");
  await expect(stage).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect(stage.locator("canvas")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Reference structure" }).getByRole("radio")).toHaveCount(4);
  const caption = page.getByTestId("figure-caption");
  await expect(caption).toContainText("Reference crystal structure");
  await expect(caption).toContainText("R-3c (No. 167)");
  await expect(caption).toContainText("a = b = 4.9570 Å, c = 13.5923 Å, γ = 120°");
  await expect(caption.getByRole("link", { name: /COD 9014036/ })).toHaveAttribute("href", "https://www.crystallography.net/cod/9014036.html");
  await expect(caption).toContainText("not the refined structure of any ChemDFT sample");
  await page.getByTestId("structure-c6h6").click();
  await expect(stage).toHaveAttribute("data-structure", "c6h6");
  await expect(caption).toContainText("PubChem CID 241");
  await expect(page.getByRole("radiogroup", { name: "Representation" }).getByRole("radio")).toHaveText(["Ball & stick", "Wireframe", "Space filling"]);
});

test("without WebGL the server-rendered static structure stays, with a text description and the source metadata", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (/webgl/.test(kind)) return null;
      return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest) as never;
    } as typeof original;
  });
  await open(page);
  await page.waitForTimeout(1500);
  await expect(page.locator("#structure-stage canvas")).toHaveCount(0);
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-ready", "false");
  await expect(page.getByRole("img", { name: /Chromium\(III\) oxide/ }).first()).toBeVisible();
  await expect(page.getByTestId("figure-caption")).toContainText("COD 9014036");
  await expect(page.getByRole("button", { name: /Pause rotation|Reset view/ })).toHaveCount(0);
});

test("save-data visitors keep the static structure and never download the 3D scene", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true } }));
  const scripts: string[] = [];
  page.on("request", (request) => /molecular-renderer|three|postprocessing/i.test(request.url()) && scripts.push(request.url()));
  await open(page);
  await page.waitForTimeout(2000);
  await expect(page.locator("#structure-stage canvas")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /Chromium\(III\) oxide/ }).first()).toBeVisible();
  expect(scripts).toEqual([]);
});

test("reduced motion: no auto-rotation control, the scene stays, the whole story is readable unpinned", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: WEB, reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await open(page);
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /pause rotation|resume rotation/i })).toHaveCount(0);
  await expect(page.locator(".journey")).not.toHaveAttribute("data-mode", "pinned");
  await page.getByTestId("structure-h2o").click();
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-structure", "h2o");
  await expect(page.locator("#how-it-works")).toContainText("Results are checked before they are trusted");
  await context.close();
});

test("the primary action follows the session without a registration path", async ({ page }) => {
  const mock = (status: number, body: unknown) => page.route("**/api/auth/get-session", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
  await mock(200, null); // signed out
  await open(page);
  await expect(page.getByTestId("header-signin")).toHaveText("Sign in");
  await expect(page.getByTestId("hero-primary")).toHaveText("Sign in");
  await expect(page.getByTestId("hero-primary")).toHaveAttribute("href", "/en/login");
  await page.unroute("**/api/auth/get-session");
  await mock(200, { user: { id: "u1", name: "Alice" }, session: { id: "s1" } }); // signed in
  await page.reload();
  await expect(page.getByTestId("header-launch")).toHaveText("Open ChemDFT");
  await expect(page.getByTestId("hero-primary")).toHaveText("Open ChemDFT");
  await expect(page.getByTestId("hero-primary")).toHaveAttribute("href", "/en/projects");
  await expect(page.getByTestId("header-account")).toHaveText("Account");
  await expect(page.getByTestId("header-signin")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /sign up|create account|register/i })).toHaveCount(0);
  await page.unroute("**/api/auth/get-session");
  await mock(404, { message: "Not Found" }); // no auth server answers: the local development identity
  await page.reload();
  await expect(page.getByTestId("hero-primary")).toHaveText("Open ChemDFT");
  await expect(page.getByTestId("header-signin")).toHaveCount(0);
});

test("the calculation story walks Structure → Prepare → Calculate → Verify → Explore with only supported capabilities", async ({ page }) => {
  await open(page);
  const story = page.locator("#how-it-works");
  for (const label of ["Structure", "Prepare", "Calculate", "Verify", "Explore"]) await expect(story).toContainText(label);
  await expect(story).toContainText("Hartree-Fock");
  await expect(story).toContainText("Stored calculation example · Water · HF / STO-3G");
  await expect(page.locator("#engines")).toContainText("B3LYP");
  await expect(page.locator("#engines")).toContainText("PBE");
  await expect(story).not.toContainText(/molecular dynamics|\bxtb\b/i);
});

test("the mobile menu opens, navigates, and closes with Escape returning focus", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: WEB, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await open(page);
  await expect(page.getByRole("navigation", { name: "Primary", exact: true })).toBeHidden();
  const menu = page.getByRole("button", { name: "Menu" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(page.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
  const mobileNav = page.getByRole("navigation", { name: "Primary (mobile)" });
  await expect(mobileNav.getByRole("link", { name: "Engines" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mobileNav).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
  await page.getByRole("button", { name: "Menu" }).click();
  await mobileNav.getByRole("link", { name: "Engines" }).click();
  await expect(mobileNav).toHaveCount(0);
  await expect(page).toHaveURL(/#engines$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await context.close();
});

test("on a phone the headline and the primary action are in the first screen, and the page does not scroll sideways", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: WEB, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await open(page);
  const h1 = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
  const primary = (await page.getByTestId("hero-primary").boundingBox())!;
  expect(h1.y + h1.height).toBeLessThan(844);
  expect(primary.y + primary.height).toBeLessThan(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await context.close();
});

test("protected product routes stay protected and the homepage links only to the public catalogue and exposes no private project or restricted asset", async ({ page }) => {
  test.setTimeout(120_000); // the dev server compiles each protected route on first visit
  for (const path of ["/en/projects", "/en/jobs", "/en/settings", "/en/account"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/en\/login\?next=/);
  }
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await open(page);
  await page.locator("img").evaluateAll((images) => images.forEach((image) => ((image as HTMLImageElement).loading = "eager")));
  await page.waitForLoadState("networkidle");
  const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  // internal navigation and the cited sources
  for (const href of hrefs) expect(href).toMatch(/^(#[a-z-]+|\/(en|tr|ru|de)(\/projects|\/login|\/account|\/examples)?|https:\/\/(www\.crystallography\.net\/cod\/9014036\.html|pubchem\.ncbi\.nlm\.nih\.gov\/compound\/(241|2519)))$/);
  const text = (await page.locator("body").innerText()).toLowerCase();
  await expect(page.getByRole("link", { name: "Explore examples", exact: true })).toHaveAttribute("href", "/en/examples");
  for (const forbidden of [/acceptance/, /\bnist\b/, /phase 7/, /example project/, /acetone/]) expect(text).not.toMatch(forbidden);
  for (const url of requested) expect(url).not.toMatch(/nist|acetone|acceptance/i);
});

test("the homepage has no serious or critical automated accessibility violations (every section shown, as with reduced motion)", async ({ browser }) => {
  // scrub reveals start sections at partial opacity by design; reduced motion shows the settled state of every section
  const context = await browser.newContext({ baseURL: WEB, reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await open(page);
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] });
    return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 4) }));
  });
  expect(violations).toEqual([]);
  await context.close();
});
