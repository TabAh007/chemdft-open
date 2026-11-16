import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Focused captures of the 0.0.17 UI changes at 1280 px, AI dock open and closed, light and dark colour scheme.
 * Presentation-fixture mock APIs only (see playwright.release-0018.config.ts); fixture claims are not scientific results.
 * ChemDFT has no dark theme: the dark runs prove the page stays readable and does not overflow under prefers-color-scheme: dark.
 */
const SHOTS = process.env.RELEASE_0018_SHOTS ?? "/tmp/chemdft-release-0018-screens";
mkdirSync(SHOTS, { recursive: true });
const SETTINGS_WEB = "http://127.0.0.1:3292";
const CLAIMS_WEB = "http://127.0.0.1:3292";
const COMPARISON_WEB = "http://127.0.0.1:3292";
const SETTINGS_PROJECT = "00000000-0000-4000-8000-0000000000e1";
const CLAIMS_PROJECT = "00000000-0000-4000-8000-0000000000a1";
const COMPARISON_PROJECT = "00000000-0000-4000-8000-0000000000d1";
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function setDock(page: Page, dock: "open" | "closed") {
  const hide = page.getByRole("button", { name: "Hide AI Scientist panel" });
  if (dock === "closed") {
    await hide.click();
    await expect(page.locator(".project-shell")).toHaveClass(/dock-collapsed/);
  } else {
    await expect(hide).toBeVisible();
  }
}

for (const scheme of ["light", "dark"] as const) {
  for (const dock of ["open", "closed"] as const) {
    test.describe(`1280 px, dock ${dock}, ${scheme}`, () => {
      test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
      const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}-${scheme}-dock-${dock}.png` });

      test("Settings: project rename", async ({ page }) => {
        await page.goto(`${SETTINGS_WEB}/en/projects/${SETTINGS_PROJECT}/settings/general`);
        await expect(page.getByTestId("project-name")).toBeVisible({ timeout: 60_000 });
        await setDock(page, dock);
        await expect(page.getByTestId("project-rename-note")).toHaveText("Renaming changes the name only. The address stays the same.");
        await page.getByTestId("project-rename-start").click();
        await page.getByRole("textbox").first().fill("  Water   renamed  ");
        await shot(page, "settings-rename-editing");
        await page.getByTestId("project-rename-save").click();
        await expect(page.getByTestId("project-name")).toHaveText("Water renamed");
        expect(await noOverflow(page)).toBe(true);
        await shot(page, "settings-rename-saved");
        await page.reload();
        await expect(page.getByTestId("project-name")).toHaveText("Water renamed"); // the mock keeps it, as the server does
      });

      test("Claims: the number as written", async ({ page }) => {
        await page.goto(`${CLAIMS_WEB}/en/projects/${CLAIMS_PROJECT}/claims`);
        await expect(page.locator(".claim-row").first()).toBeVisible({ timeout: 60_000 });
        await setDock(page, dock);
        const first = page.locator('.claim-row[data-claim-id="10000000-0000-4000-8000-000000000001"]');
        await first.click();
        await expect(page.getByRole("complementary", { name: "Selected claim inspector" })).toContainText("24.45650");
        expect(await noOverflow(page)).toBe(true);
        await shot(page, "claims-original-token");
      });

      test("Paper vs ChemDFT: the number as written", async ({ page }) => {
        await page.goto(`${COMPARISON_WEB}/en/projects/${COMPARISON_PROJECT}/comparison`);
        await expect(page.locator("tr.comparison-row").first()).toBeVisible({ timeout: 60_000 });
        await setDock(page, dock);
        await expect(page.locator("tr.comparison-row").filter({ hasText: "24.4820" }).first()).toBeVisible();
        await page.locator("tr.comparison-row").filter({ hasText: "24.4820" }).first().click();
        await expect(page.getByLabel("Comparison row inspector")).toContainText("24.4820");
        expect(await noOverflow(page)).toBe(true);
        await shot(page, "paper-vs-chemdft-original-token");
      });
    });
  }
}
