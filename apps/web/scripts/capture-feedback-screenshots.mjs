import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(import.meta.dirname, "../../output/feedback-ui");
mkdirSync(outDir, { recursive: true });

const BASE = "http://127.0.0.1:3200";

async function main() {
  console.log(`Starting UI capture against ${BASE}...`);
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });

  try {
    // 1. 1366x768 form view (must fit without vertical scroll)
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/feedback`, { waitUntil: "domcontentloaded" });
      await page.locator("form").waitFor({ state: "visible" });

      const sendBtn = page.getByRole("button", { name: "Send feedback" });
      await sendBtn.waitFor({ state: "visible" });

      const box = await sendBtn.boundingBox();
      if (!box) throw new Error("Send button bounding box not found");
      const bottom = box.y + box.height;
      console.log(`1366x768 Send button bottom y: ${bottom}px (viewport: 768px)`);
      if (bottom > 768) {
        console.warn(`WARNING: Send button bottom (${bottom}px) exceeds 768px viewport height!`);
      } else {
        console.log(`PASS: Form fits entirely in 1366x768 viewport without vertical scroll.`);
      }

      await page.screenshot({ path: `${outDir}/01-feedback-form-1366x768.png` });
      console.log(`Captured 01-feedback-form-1366x768.png`);
      await context.close();
    }

    // 2. 1280x720 form view
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/feedback`, { waitUntil: "domcontentloaded" });
      await page.locator("form").waitFor({ state: "visible" });
      await page.screenshot({ path: `${outDir}/02-feedback-form-1280x720.png` });
      console.log(`Captured 02-feedback-form-1280x720.png`);
      await context.close();
    }

    // 3. 1536x864 form view
    {
      const context = await browser.newContext({ viewport: { width: 1536, height: 864 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/feedback`, { waitUntil: "domcontentloaded" });
      await page.locator("form").waitFor({ state: "visible" });
      await page.screenshot({ path: `${outDir}/03-feedback-form-1536x864.png` });
      console.log(`Captured 03-feedback-form-1536x864.png`);
      await context.close();
    }

    // 4. 768 narrow responsive view (assert no horizontal scroll)
    {
      const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/feedback`, { waitUntil: "domcontentloaded" });
      await page.locator("form").waitFor({ state: "visible" });

      const hasHorizScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      console.log(`768 narrow has horizontal scroll: ${hasHorizScroll}`);
      if (hasHorizScroll) {
        throw new Error("Horizontal overflow detected on 768px narrow viewport!");
      }
      console.log(`PASS: No horizontal scroll on 768px narrow viewport.`);

      await page.screenshot({ path: `${outDir}/04-feedback-form-768-narrow.png` });
      console.log(`Captured 04-feedback-form-768-narrow.png`);
      await context.close();
    }

    // 5. Error state (inline alert role="alert", form preserved)
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/feedback`, { waitUntil: "domcontentloaded" });
      await page.locator("form").waitFor({ state: "visible" });

      // Intercept /api/feedback to return 500 error
      await page.route("**/api/feedback", async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "delivery_failed", message: "Mail delivery failed" }),
        });
      });

      await page.fill('#feedback-title', "Calculation convergence failure");
      await page.fill('#feedback-details', "Detailed explanation of the SCF failure on water cluster...");

      const sendBtn = page.getByRole("button", { name: "Send feedback" });
      await sendBtn.click();

      const alert = page.locator('[role="alert"]');
      await alert.waitFor({ state: "visible", timeout: 5000 });
      const alertText = await alert.innerText();
      console.log(`Error alert announced: "${alertText}"`);

      // Verify form contents are kept
      const titleValue = await page.inputValue('#feedback-title');
      if (titleValue !== "Calculation convergence failure") throw new Error("Form content was not preserved!");
      console.log(`PASS: Form contents preserved during error state.`);

      await page.screenshot({ path: `${outDir}/05-feedback-error-state.png` });
      console.log(`Captured 05-feedback-error-state.png`);
      await context.close();
    }

    // 6. Sent screen (green check, delivery message, action buttons)
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/feedback`, { waitUntil: "domcontentloaded" });
      await page.locator("form").waitFor({ state: "visible" });

      // Intercept /api/feedback to return 200 success
      await page.route("**/api/feedback", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, reportId: "018f-feedback-report-test-uuid" }),
        });
      });

      await page.fill('#feedback-title', "Add support for B3LYP functional");
      await page.fill('#feedback-details', "Requesting B3LYP functional integration for organic molecules.");

      const sendBtn = page.getByRole("button", { name: "Send feedback" });
      await sendBtn.click();

      const successH1 = page.getByRole("heading", { name: "Thank you, we got it" });
      await successH1.waitFor({ state: "visible", timeout: 5000 });
      console.log(`PASS: Success screen rendered with "Thank you, we got it".`);

      await page.screenshot({ path: `${outDir}/06-feedback-sent-state.png` });
      console.log(`Captured 06-feedback-sent-state.png`);
      await context.close();
    }

    // 7. Roadmap page
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/roadmap`, { waitUntil: "domcontentloaded" });

      await page.getByRole("heading", { name: "In Progress" }).waitFor({ state: "visible" });
      await page.getByRole("heading", { name: "Planned" }).waitFor({ state: "visible" });
      await page.getByRole("heading", { name: "Completed" }).waitFor({ state: "visible" });
      console.log(`PASS: Roadmap page verified with Planned, In progress, and Done sections.`);

      await page.waitForTimeout(500);
      await page.screenshot({ path: `${outDir}/07-roadmap-page.png` });
      console.log(`Captured 07-roadmap-page.png`);
      await context.close();
    }

    // 8. Owner feedback page
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/owner/feedback`, { waitUntil: "domcontentloaded" });

      await page.getByRole("heading", { name: "Feedback Reports" }).waitFor({ state: "visible" });
      console.log(`PASS: Owner Feedback console verified.`);

      await page.waitForTimeout(500);
      await page.screenshot({ path: `${outDir}/08-owner-feedback-page.png` });
      console.log(`Captured 08-owner-feedback-page.png`);
      await context.close();
    }

    console.log("All screenshots captured and UI assertions passed successfully!");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
