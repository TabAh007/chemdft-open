import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Release 0.0.55: the public header. Regression guard for the Contact/Account overlap: at every width the header items must not
 * overlap one another, the header must not overflow, and the page must not scroll sideways. Captures go to output/release-0055/.
 */
const OUT = resolve(import.meta.dirname, "../../../../output/release-0055");
const WIDTHS = [360, 390, 768, 1024, 1099, 1100, 1180, 1280, 1440, 1920];

async function openHome(page: Page, locale: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/${locale}`);
  await expect(page.locator("header.home-header")).toBeVisible();
  // The dev stack has no session, so the signed-in "Account" link is inserted exactly where HeaderActions renders it: the widest case.
  await page.evaluate(() => {
    const end = document.querySelector(".home-header-end")!;
    if (end.querySelector(".home-signin")) return;
    const account = document.createElement("a");
    account.className = "home-signin";
    account.href = "/en/account";
    account.textContent = "Account";
    end.prepend(account);
  });
}

/** Every visible leaf item in the header bar (links, buttons, the language codes), as rectangles. */
async function itemRects(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header.home-header")!;
    const rects: { name: string; l: number; r: number; t: number; b: number }[] = [];
    header.querySelectorAll("a, button, .locale-soon").forEach((el) => {
      if (el.closest(".home-mobile-menu, .home-more-list")) return;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      rects.push({ name: (el.textContent ?? "").trim() || el.getAttribute("aria-label") || el.tagName, l: box.left, r: box.right, t: box.top, b: box.bottom });
    });
    return { rects, headerRight: header.getBoundingClientRect().right, headerWidth: header.getBoundingClientRect().width, docWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
  });
}

async function expectNoOverlap(page: Page, label: string) {
  const { rects, headerRight, docWidth, innerWidth } = await itemRects(page);
  expect(docWidth, `${label}: horizontal page scroll`).toBeLessThanOrEqual(innerWidth);
  for (const item of rects) expect(item.r, `${label}: ${item.name} leaves the header`).toBeLessThanOrEqual(headerRight + 0.5);
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]!;
      const b = rects[j]!;
      const overlapX = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const overlapY = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      expect(overlapX > 0.5 && overlapY > 0.5, `${label}: "${a.name}" overlaps "${b.name}"`).toBe(false);
    }
  }
}

test.describe("public header", () => {
  for (const locale of ["en", "de"]) {
    for (const width of WIDTHS) {
      test(`no overlapping items, no sideways scroll: ${locale} ${width}px`, async ({ page }) => {
        await openHome(page, locale, width);
        await expectNoOverlap(page, `${locale} ${width}px`);
      });
    }
  }

  test("the wide bar shows the primary links, a More menu and the language switcher; the narrow bar shows Menu and the language switcher", async ({ page }) => {
    await openHome(page, "en", 1280);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.locator(":scope > a")).toHaveText(["How it works", "Engines", "Workstation", "Result checks", "Learn", "Releases"]);
    await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Language" })).toBeVisible();
    await expect(page.getByTestId("locale-soon-note")).not.toBeInViewport();
    await openHome(page, "en", 390);
    await expect(nav).toBeHidden();
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Language" })).toBeVisible();
  });

  test("More menu: opens, links resolve, Escape returns focus, outside click closes", async ({ page }) => {
    await openHome(page, "en", 1280);
    const more = page.getByRole("button", { name: "More" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const list = page.getByRole("list", { name: "More pages" });
    await expect(list.getByRole("link")).toHaveText(["Reproducibility", "Contact"]);
    await page.screenshot({ path: resolve(OUT, "more-menu-open-en-1280.png"), clip: { x: 0, y: 0, width: 1280, height: 220 } });
    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toBeFocused();
    await more.click();
    await page.mouse.click(640, 600);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(list).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(list.getByRole("link").first()).toBeFocused();
  });

  test("collapsed menu: full-width panel with every link, closes on Escape and after a choice", async ({ page }) => {
    await openHome(page, "en", 390);
    const button = page.getByRole("button", { name: "Menu" });
    await button.click();
    const panel = page.getByRole("navigation", { name: "Primary (mobile)" });
    await expect(panel.getByRole("link")).toHaveText(["How it works", "Engines", "Workstation", "Result checks", "Learn", "Releases", "Reproducibility", "Contact"]);
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(388);
    await page.screenshot({ path: resolve(OUT, "menu-open-en-390.png") });
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
    await page.getByRole("button", { name: "Menu" }).click();
    await panel.getByRole("link", { name: "Engines" }).click();
    await expect(panel).toBeHidden();
  });

  test("Coming soon is a tooltip on the disabled languages", async ({ page }) => {
    await openHome(page, "en", 1280);
    await expect(page.getByTestId("locale-de")).toHaveAttribute("title", "Coming soon");
    await page.getByTestId("locale-de").hover();
    await page.screenshot({ path: resolve(OUT, "coming-soon-tooltip-en-1280.png"), clip: { x: 640, y: 0, width: 640, height: 120 } });
  });

  test("captures", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    for (const [locale, width] of [["en", 390], ["en", 1024], ["en", 1280], ["en", 1440], ["en", 1920], ["de", 1280]] as const) {
      await openHome(page, locale, width);
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(OUT, `header-${locale}-${width}.png`), clip: { x: 0, y: 0, width, height: 760 } });
    }
  });
});
