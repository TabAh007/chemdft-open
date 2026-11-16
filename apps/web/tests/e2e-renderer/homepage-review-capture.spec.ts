import { mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Review-only: writes the PF-3E/F review screenshots and the interaction clip into the untracked review output.
 * Run with CHEMDFT_HOMEPAGE_CAPTURE=1 (it uses the machine's real GPU through ANGLE/Metal).
 */
test.skip(!process.env.CHEMDFT_HOMEPAGE_CAPTURE, "review capture is opt-in");

const OUT = resolve(import.meta.dirname, "../../../../output/homepage-review");
test.use({ launchOptions: { args: ["--use-angle=metal", "--ignore-gpu-blocklist"] } });

const settle = (page: Page, ms = 1700) => page.waitForTimeout(ms);
async function open(page: Page) {
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Computational chemistry, without the old workflow.");
  await expect(page.locator("#structure-stage")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await settle(page, 2200);
}
const pause = async (page: Page) => {
  const button = page.getByRole("button", { name: "Pause rotation" });
  if (await button.count()) await button.click();
  await settle(page, 1500);
};
const structure = (page: Page, id: string) => page.getByTestId(`structure-${id}`).click().then(() => settle(page, 2200));
const mode = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click().then(() => settle(page, 1800));
const scrollToSection = async (page: Page, selector: string, offset: number) => {
  await page.evaluate(([sel, off]) => window.scrollTo(0, document.querySelector(sel as string)!.getBoundingClientRect().top + window.scrollY - (off as number)), [selector, offset] as const);
  await settle(page, 2200);
};

test("desktop review screenshots (1440 × 900)", async ({ browser }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3103", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await open(page);
  await pause(page);
  await page.screenshot({ path: `${OUT}/01-hero-desktop-1440.png` });
  await structure(page, "h2o");
  await page.screenshot({ path: `${OUT}/02-water-h2o.png` });
  await structure(page, "c6h6");
  await page.screenshot({ path: `${OUT}/03-benzene-c6h6.png` });
  await structure(page, "c8h10n4o2");
  await page.screenshot({ path: `${OUT}/04-caffeine-c8h10n4o2.png` });
  await structure(page, "cr2o3");
  await page.screenshot({ path: `${OUT}/05-chromium-iii-oxide-ball-and-stick.png` });
  await mode(page, "Polyhedra");
  await page.screenshot({ path: `${OUT}/06-cr2o3-polyhedra.png` });
  await mode(page, "Unit cell");
  await page.screenshot({ path: `${OUT}/07-cr2o3-unit-cell.png` });
  await mode(page, "Space filling");
  await page.screenshot({ path: `${OUT}/08-cr2o3-space-filling.png` });
  await mode(page, "Ball & stick");

  // Act II mid-story (the "Calculate" step), Act III, Act IV
  await scrollToSection(page, "#how-it-works", 54 - 120 - 2 * 81);
  await page.screenshot({ path: `${OUT}/09-act-ii-scroll-state-calculate.png` });
  await page.evaluate(() => {
    const chain = document.querySelector("#result-firewall .chain")!;
    window.scrollTo(0, chain.getBoundingClientRect().top + window.scrollY - 340);
  });
  await settle(page, 2200);
  await page.screenshot({ path: `${OUT}/10-act-iii-firewall-dark.png` });
  await scrollToSection(page, "#workstation", 54 - 150);
  await page.screenshot({ path: `${OUT}/11-act-iv-workstation.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 1500);
  // as it stands at scroll position 0: scroll-driven reveals are in their unrevealed state, which is what this shot shows
  await page.screenshot({ path: `${OUT}/12b-full-page-desktop-scroll-initial-state.png`, fullPage: true });
  await context.close();

  // the settled page: reduced motion shows every section fully, unpinned, in reading order
  const settled = await browser.newContext({ baseURL: "http://127.0.0.1:3103", viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const still = await settled.newPage();
  await open(still);
  // lazy images load as they near the viewport: read through the page once, then return to the top
  const height = await still.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 600) {
    await still.evaluate((top) => window.scrollTo(0, top), y);
    await still.waitForTimeout(120);
  }
  await still.evaluate(() => window.scrollTo(0, 0));
  await settle(still, 1500);
  await still.screenshot({ path: `${OUT}/12-full-page-desktop.png`, fullPage: true });
  await settled.close();
});

test("mobile review screenshots (390 × 844)", async ({ browser }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3103", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await open(page);
  await pause(page).catch(() => undefined);
  await page.screenshot({ path: `${OUT}/13-mobile-hero-390.png` });
  await page.getByTestId("structure-c6h6").scrollIntoViewIfNeeded();
  await page.getByTestId("structure-c6h6").tap();
  await settle(page, 2200);
  await page.evaluate(() => {
    const strip = document.querySelector(".sample-strip")!;
    window.scrollTo(0, strip.getBoundingClientRect().top + window.scrollY - 560);
  });
  await settle(page, 1000);
  await page.screenshot({ path: `${OUT}/14-mobile-structure-selector.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 1200);
  await page.screenshot({ path: `${OUT}/15-mobile-full-page.png`, fullPage: true });
  await context.close();
});

async function record(browser: Browser) {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3103", viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${OUT}/video-tmp`, size: { width: 1280, height: 800 } } });
  const page = await context.newPage();
  await open(page);
  // structure selector
  for (const id of ["h2o", "c6h6", "c8h10n4o2", "cr2o3"]) {
    await page.getByTestId(`structure-${id}`).click();
    await page.waitForTimeout(2000);
  }
  // representations on the crystal
  for (const name of ["Polyhedra", "Unit cell", "Space filling", "Wireframe", "Ball & stick"]) {
    await page.getByRole("radio", { name, exact: true }).click();
    await page.waitForTimeout(1500);
  }
  // drag to rotate
  const box = (await page.locator("#structure-stage canvas").boundingBox())!;
  const cx = box.x + box.width * 0.72;
  const cy = box.y + box.height * 0.5;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy + 40, { steps: 45 });
  await page.mouse.move(cx - 100, cy - 30, { steps: 45 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  // part of the GSAP scroll story: native wheel scrolling through Act II and into the dark act
  await page.mouse.move(640, 500);
  for (let i = 0; i < 26; i += 1) {
    await page.mouse.wheel(0, 70);
    await page.waitForTimeout(110);
  }
  await page.waitForTimeout(1200);
  for (let i = 0; i < 24; i += 1) {
    await page.mouse.wheel(0, 90);
    await page.waitForTimeout(110);
  }
  await page.waitForTimeout(1500);
  const video = page.video()!;
  await context.close();
  return video.path();
}

test("records the interaction clip", async ({ browser }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const recorded = await record(browser);
  renameSync(recorded, `${OUT}/homepage-interaction.webm`);
});
