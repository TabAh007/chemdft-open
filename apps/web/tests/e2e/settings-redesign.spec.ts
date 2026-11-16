import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Global and project Settings against the presentation-fixture mock API (see playwright.settings.config.ts). All values come from
 * tests/fixtures/settings-mock-api.mjs; no provider is called and no real credential is used (the "key" typed below is a made-up string).
 */
const SHOTS = process.env.SETTINGS_SHOTS ?? "/tmp/chemdft-settings-screens";
mkdirSync(SHOTS, { recursive: true });
const API = `http://127.0.0.1:${process.env.SETTINGS_API_PORT ?? "8292"}`;
const LOCAL = `http://127.0.0.1:${process.env.SETTINGS_LOCAL_WEB_PORT ?? "3293"}`;
const PROJECT = "00000000-0000-4000-8000-0000000000e1";
const TEST_KEY = "test-key-NOT-A-REAL-KEY-0123456789";

test.beforeEach(async ({ request }) => { await request.post(`${API}/__reset`); });

async function axeViolations(page: Page) {
  await page.evaluate(axe.source);
  const result = await page.evaluate(() => (window as unknown as { axe: typeof axe }).axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const requests = async (request: import("@playwright/test").APIRequestContext) => (await (await request.get(`${API}/__requests`)).json()) as { method: string; path: string }[];

test.describe("global Settings", () => {
  test("General shows the real account, never a placeholder identity", async ({ page }) => {
    await page.goto("/en/settings/general");
    await expect(page.getByRole("heading", { name: "Settings", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByTestId("settings-account-name")).toHaveText("Priya Raman");
    await expect(page.getByTestId("settings-account-email")).toHaveText("priya.raman@example.org");
    await expect(page.getByTestId("settings-account-organization")).toHaveText("Raman Lab");
    await expect(page.getByTestId("account-facts")).toContainText("Owner");
    await expect(page.getByTestId("header-identity")).toHaveText("PR");
    await expect(page.getByTestId("header-identity")).not.toHaveText("DV");
    const body = (await page.locator("body").innerText());
    expect(body).not.toMatch(/will live here|Persisted project name|Server configured|Development identity/);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("the rail lists General, AI and a greyed Billing; unavailable sections are hidden but their URLs resolve", async ({ page }) => {
    await page.goto("/en/settings/general");
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    await expect(rail.getByRole("link")).toHaveText([/General/, /^AI$/, /Billing\s*Not in beta/]);
    await expect(rail.locator('[data-section="billing"]')).toHaveAttribute("data-unavailable", "true");
    for (const hidden of ["compute", "scientific", "privacy", "advanced"]) {
      await expect(rail.locator(`[data-section="${hidden}"]`)).toHaveCount(0);
      await page.goto(`/en/settings/${hidden}`);
      await expect(page.getByTestId("settings-unavailable")).toContainText("Not available yet");
      await expect(page.locator("main input, main select, main textarea")).toHaveCount(0);
    }
  });

  test("Billing is greyed with one message and makes no billing request of any kind", async ({ page, request }) => {
    await page.goto("/en/settings/billing");
    await expect(page.getByTestId("billing-unavailable-message")).toHaveText("Billing is not available during the beta. No charges are made.");
    await expect(page.getByTestId("billing-panel").getByRole("button")).toHaveCount(0);
    await expect(page.getByText(/checkout/i)).toHaveCount(0);
    await page.waitForTimeout(800);
    const seen = await requests(request);
    expect(seen.filter((entry) => entry.path.startsWith("/v1/billing"))).toEqual([]);
    expect(seen.filter((entry) => entry.method !== "GET")).toEqual([]);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("AI settings on a hosted-like build never offer the local test provider", async ({ page }) => {
    await page.goto("/en/settings/ai");
    await expect(page.getByTestId("ai-settings-panel")).toBeVisible();
    const model = page.getByTestId("ai-settings-model");
    const options = await model.locator("option").allTextContents();
    expect(options.join("|")).not.toMatch(/fake|local test/i);
    expect(options.join("|")).toContain("Nemotron 3.5 Lightning");
    expect(options.join("|")).toContain("Kimi K2.6");
    await expect(page.getByTestId("ai-test-providers-hidden")).toHaveText("Test providers are only available in local development.");
    const status = page.getByTestId("ai-provider-status");
    await expect(status).toContainText("Managed by ChemDFT");
    await expect(status).toContainText("NVIDIA");
    await expect(status).toHaveAttribute("data-provider", "nvidia");
    expect(await page.locator("body").innerText()).not.toMatch(/SecretProvider|MANAGED ·|fake-standard/);
    await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "AI", exact: true })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("unavailable models sit behind a toggle, keep their reason and are never selectable", async ({ page }) => {
    await page.goto("/en/settings/ai");
    await expect(page.getByTestId("ai-settings-panel")).toBeVisible();
    const options = (await page.getByTestId("ai-settings-model").locator("option").allTextContents()).join("|");
    expect(options).not.toContain("Unconfigured Fixture Model");
    const toggle = page.getByTestId("ai-unavailable-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("ai-unavailable-model")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const row = page.getByTestId("ai-unavailable-model");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Unconfigured Fixture Model");
    await expect(row).toContainText("Not configured on this server.");
    await expect(row).not.toContainText("Verified");
    expect((await page.getByTestId("ai-settings-model").locator("option").allTextContents()).join("|")).not.toContain("Unconfigured Fixture Model");
    await page.screenshot({ path: `${SHOTS}/ai-unavailable-open.png` });
    expect(await axeViolations(page)).toEqual([]);
  });

  test("local development offers the test provider, labelled as a fixture, and says it is a development identity", async ({ browser }) => {
    const page = await (await browser.newContext({ baseURL: LOCAL })).newPage();
    await page.goto("/en/settings/ai");
    await expect(page.getByTestId("ai-settings-panel")).toBeVisible();
    const options = await page.getByTestId("ai-settings-model").locator("option").allTextContents();
    expect(options.some((text) => text.includes("fake-standard (local test fixture)"))).toBe(true);
    await expect(page.getByTestId("ai-test-providers-hidden")).toHaveCount(0);
    await expect(page.getByText("Development identity")).toBeVisible();
    await page.context().close();
  });

  test("saving a model sends one PUT of an offered pair and states that no fallback exists", async ({ page, request }) => {
    await page.goto("/en/settings/ai");
    await expect(page.getByTestId("ai-settings-panel")).toBeVisible();
    const model = page.getByTestId("ai-settings-model");
    await model.selectOption({ label: (await model.locator("option").allTextContents()).find((t) => t.includes("Kimi K2.6"))! });
    const saving = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/ai/settings"));
    await page.getByRole("button", { name: "Save AI preferences" }).click();
    expect((await saving).status()).toBe(200);
    await expect(page.getByRole("status")).toContainText("No fallback is enabled");
    expect((await (await request.get(`${API}/v1/ai/settings`)).json()).preferences).toMatchObject({ provider: "moonshot", model: "kimi-k2.6" });
  });

  test("credential safety: password field, cleared after submit, never stored or echoed, masked fingerprint only", async ({ page, request }) => {
    const logged: string[] = [];
    page.on("console", (message) => logged.push(message.text()));
    await page.goto("/en/settings/ai");
    const input = page.getByLabel("Provider API key");
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveAttribute("autocomplete", "off");
    await input.fill(TEST_KEY);
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.getByTestId("ai-key-status")).toContainText("Saved");
    await expect(page.getByTestId("ai-key-status")).toContainText("sha256:4f2a…9c1d");
    await expect(input).toHaveValue("");
    expect(await page.content()).not.toContain(TEST_KEY);
    const storage = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    expect(storage).not.toContain(TEST_KEY);
    expect(logged.join("\n")).not.toContain(TEST_KEY);
    expect((await (await request.get(`${API}/v1/ai/settings`)).text())).not.toContain(TEST_KEY);
    await page.getByRole("button", { name: "Revoke key" }).click();
    await expect(page.getByTestId("ai-key-status")).toContainText("Revoked");
    expect(await page.content()).not.toContain(TEST_KEY);
  });
});

test.describe("project Settings", () => {
  const url = (section: string) => `/en/projects/${PROJECT}/settings/${section}`;
  test("General shows the real project name with the rename note (owners can rename; checked in release-0018-captures)", async ({ page }) => {
    await page.goto(url("general"));
    await expect(page.getByTestId("project-name")).toHaveText("Water B3LYP benchmark");
    await expect(page.getByTestId("project-rename-note")).toHaveText("Renaming changes the name only. The address stays the same.");
    await expect(page.getByTestId("project-general-settings")).toContainText("Owner");
    await expect(page.getByTestId("project-general-settings").locator("input, select, textarea")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/Persisted project name|will live here|Server configured/);
    const rail = page.getByRole("navigation", { name: "Project settings" });
    await expect(rail.getByRole("link")).toHaveText(["General", "AI"]);
    expect(await axeViolations(page)).toEqual([]);
  });
  test("AI is a read-only view that links to the account setting", async ({ page }) => {
    await page.goto(url("ai"));
    await expect(page.getByTestId("project-ai-current")).toContainText("Managed by ChemDFT");
    await expect(page.getByTestId("project-ai-current")).toContainText("Nemotron 3.5 Lightning");
    await expect(page.getByRole("link", { name: "account AI settings" })).toHaveAttribute("href", "/en/settings/ai");
    await expect(page.getByTestId("project-ai-settings").locator("input, select, button")).toHaveCount(0);
  });
  test("Billing, Compute and the rest say Not available yet", async ({ page }) => {
    for (const section of ["billing", "compute", "scientific", "privacy", "advanced"]) {
      await page.goto(url(section));
      await expect(page.getByTestId("settings-unavailable")).toContainText(/Not available/);
    }
  });
});

test.describe("desktop layout", () => {
  for (const width of [1280, 1440, 1920]) {
    test(`global pages at ${width}px: rail and pane side by side, no overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const section of ["general", "ai", "billing"]) {
        await page.goto(`/en/settings/${section}`);
        await expect(page.getByTestId("settings-shell")).toBeVisible();
        await page.waitForTimeout(500);
        expect(await noHorizontalOverflow(page)).toBe(true);
        const rail = await page.getByRole("navigation", { name: "Settings sections" }).boundingBox();
        const pane = await page.locator('[data-testid="settings-shell"] > div').boundingBox();
        expect(pane!.x).toBeGreaterThanOrEqual(rail!.x + rail!.width - 1);
        await page.screenshot({ path: `${SHOTS}/global-${section}-${width}.png` });
      }
    });
    for (const dock of ["closed", "open"] as const) {
      test(`project pages at ${width}px with the AI dock ${dock}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        for (const section of ["general", "ai"]) {
          await page.goto(`/en/projects/${PROJECT}/settings/${section}`);
          const toggle = page.getByTestId("ai-dock-toggle");
          await expect(toggle).toBeVisible();
          const pressed = (await toggle.getAttribute("aria-pressed")) === "true";
          if ((dock === "open") !== pressed) await toggle.click();
          await expect(toggle).toHaveAttribute("aria-pressed", dock === "open" ? "true" : "false");
          await expect(page.getByTestId("settings-shell")).toBeVisible();
          await page.waitForTimeout(500);
          expect(await noHorizontalOverflow(page)).toBe(true);
          const shell = await page.getByTestId("settings-shell").boundingBox();
          const size = page.viewportSize()!;
          expect(shell!.x + shell!.width).toBeLessThanOrEqual(size.width + 1);
          await page.screenshot({ path: `${SHOTS}/project-${section}-${width}-dock-${dock}.png` });
        }
      });
    }
  }
});

test.describe("Account", () => {
  for (const width of [1280, 1440, 1920]) {
    test(`the card uses the header's content column at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/en/account");
      const card = page.getByTestId("account");
      await expect(card).toBeVisible();
      const [c, brand, avatar] = await Promise.all([card.boundingBox(), page.locator(".header-brand").boundingBox(), page.getByTestId("header-identity").boundingBox()]);
      expect(Math.abs(c!.x - brand!.x)).toBeLessThanOrEqual(2);
      expect(Math.abs((c!.x + c!.width) - (avatar!.x + avatar!.width))).toBeLessThanOrEqual(2);
      expect(await noHorizontalOverflow(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/account-${width}.png` });
    });
  }
});
