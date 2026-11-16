import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve("../../output/release-0.0.35");
mkdirSync(OUTPUT_DIR, { recursive: true });

async function setupContactMock(page: Page, options: { unavailable?: boolean; rateLimited?: boolean } = {}) {
  // Inject mock Turnstile script & window.turnstile
  await page.addInitScript(() => {
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (container: HTMLElement, opts: { callback?: (token: string) => void }) => {
        container.innerHTML = `<div data-testid="cf-turnstile-mock" style="padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; color: #475569; background: #f8fafc;">Cloudflare Turnstile Verified</div>`;
        setTimeout(() => {
          opts.callback?.("dummy-mock-turnstile-token-passed");
        }, 50);
        return "mock-turnstile-widget-id";
      },
      reset: () => {},
      remove: () => {},
    };
  });

  // Intercept Cloudflare challenge script requests
  await page.route("**/challenges.cloudflare.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "// mock turnstile script",
    });
  });

  // Intercept contact API submission
  await page.route("**/api/contact", async (route) => {
    if (options.unavailable) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "service_unavailable",
          code: "CONTACT_UNAVAILABLE",
          message: "Contact form is temporarily unavailable. Please email tab@chemdft.com.",
        }),
      });
    }

    if (options.rateLimited) {
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "rate_limited",
          message: "You have sent several messages recently. Please wait a few minutes before trying again.",
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

test.describe("Public Contact Form (0.0.35)", () => {
  const viewports = [
    { width: 1024, height: 560, name: "1024x560" },
    { width: 860, height: 560, name: "860x560" },
    { width: 834, height: 1112, name: "834x1112" },
    { width: 1440, height: 900, name: "1440x900" },
  ];

  for (const vp of viewports) {
    test(`renders cleanly without horizontal scroll at ${vp.name}`, async ({ page }) => {
      await setupContactMock(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/en/contact");
      await expect(page.locator("h1")).toContainText("Contact ChemDFT");
      await expect(page.locator("#contact-name")).toBeVisible();
      await expect(page.locator("#contact-email")).toBeVisible();
      await expect(page.locator("#contact-topic")).toBeVisible();
      await expect(page.locator("#contact-message")).toBeVisible();
      await expect(page.locator("#contact-consent")).toBeVisible();
      await expect(page.locator('[data-testid="contact-submit-btn"]')).toBeVisible();

      // Verify no horizontal scroll
      const noHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth;
      });
      expect(noHorizontalScroll).toBe(true);

      // Screenshot
      await page.screenshot({
        path: resolve(OUTPUT_DIR, `contact-${vp.name}.png`),
        fullPage: true,
      });
    });
  }

  test("handles client-side validation and error summary focus", async ({ page }) => {
    await setupContactMock(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/en/contact");

    // Submit without filling required fields
    await page.locator('[data-testid="contact-submit-btn"]').click();

    // Verify error summary appears with aria-live
    const errorSummary = page.locator('[data-testid="contact-error-summary"]');
    await expect(errorSummary).toBeVisible();
    await expect(errorSummary).toHaveAttribute("aria-live", "polite");

    // First error is name, focus should be on name input
    await expect(page.locator("#contact-name")).toBeFocused();

    // Verify error messages
    await expect(page.locator('[data-testid="contact-error-name"]')).toContainText("Please provide your name");
    await expect(page.locator('[data-testid="contact-error-email"]')).toContainText("Please provide your email");
    await expect(page.locator('[data-testid="contact-error-message"]')).toContainText("Please write a message");
    await expect(page.locator('[data-testid="contact-error-consent"]')).toContainText("Consent to receive a reply is required");

    await page.screenshot({
      path: resolve(OUTPUT_DIR, "contact-error-summary.png"),
    });
  });

  test("completes keyboard navigation flow and submits form", async ({ page }) => {
    await setupContactMock(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/en/contact");

    // Focus name and fill via keyboard
    await page.locator("#contact-name").focus();
    await page.keyboard.type("Dr. Alice Quantum");

    // Tab to email
    await page.keyboard.press("Tab");
    await expect(page.locator("#contact-email")).toBeFocused();
    await page.keyboard.type("alice@quantum-research.org");

    // Tab to organisation
    await page.keyboard.press("Tab");
    await expect(page.locator("#contact-org")).toBeFocused();
    await page.keyboard.type("Institute of Nanotechnology");

    // Tab to topic
    await page.keyboard.press("Tab");
    await expect(page.locator("#contact-topic")).toBeFocused();
    await page.locator("#contact-topic").selectOption("Work with us");

    // Tab to message
    await page.keyboard.press("Tab");
    await expect(page.locator("#contact-message")).toBeFocused();
    await page.keyboard.type("We are interested in evaluating ChemDFT for periodic solid-state DFT simulations.");

    // Tab to consent checkbox
    await page.keyboard.press("Tab");
    await expect(page.locator("#contact-consent")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator("#contact-consent")).toBeChecked();

    // Ensure Turnstile mock widget is verified
    await expect(page.locator('[data-testid="cf-turnstile-mock"]')).toBeVisible();

    // Tab to Privacy Policy link
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeFocused();

    // Tab to submit button and press Enter
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-testid="contact-submit-btn"]')).toBeFocused();
    await page.keyboard.press("Enter");

    // Verify success state
    const successCard = page.locator('[data-testid="contact-success-state"]');
    await expect(successCard).toBeVisible();
    await expect(successCard).toContainText("Thank you. Your message has been sent.");
    await expect(successCard).toContainText("If you asked for a reply, we usually answer within a few working days.");

    await page.screenshot({
      path: resolve(OUTPUT_DIR, "contact-success-state.png"),
    });
  });

  test("displays clear fallback message when service is unavailable (503)", async ({ page }) => {
    await setupContactMock(page, { unavailable: true });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/en/contact");

    // Fill valid data
    await page.locator("#contact-name").fill("Dr. Bob Scientist");
    await page.locator("#contact-email").fill("bob@lab.org");
    await page.locator("#contact-message").fill("Inquiring about API rate limits and cluster deployment options.");
    await page.locator("#contact-consent").check();

    // Submit
    await page.locator('[data-testid="contact-submit-btn"]').click();

    // Verify fallback alert is shown
    const fallbackBanner = page.locator('[data-testid="contact-unavailable-fallback"]');
    await expect(fallbackBanner).toBeVisible();
    await expect(fallbackBanner).toContainText("The form is temporarily unavailable. Please email tab@chemdft.com.");

    await page.screenshot({
      path: resolve(OUTPUT_DIR, "contact-unavailable-fallback.png"),
    });
  });

  test("displays English fallback notice on localized contact pages", async ({ page }) => {
    await setupContactMock(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/tr/contact");

    // Verify notice role
    const notice = page.locator('[role="note"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("This page is provided in English");

    // Verify form is present
    await expect(page.locator("#contact-name")).toBeVisible();
  });
});
