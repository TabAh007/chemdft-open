import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(import.meta.dirname, "../../../output/release-0.0.32");
mkdirSync(outDir, { recursive: true });

const BASE = "http://127.0.0.1:3200";

async function main() {
  console.log(`Starting UI capture against ${BASE}...`);
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });

  try {
    // 1. /en/terms at 1366x768
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/terms`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1");
      const title = await page.locator("h1").innerText();
      console.log(`/en/terms loaded: "${title}"`);

      const hasHorizScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      if (hasHorizScroll) {
        throw new Error("Horizontal overflow detected on /en/terms 1366px!");
      }
      console.log(`PASS: /en/terms 1366x768 has no horizontal scroll.`);

      await page.screenshot({ path: `${outDir}/01-terms-1366x768.png`, fullPage: false });
      await page.screenshot({ path: `${outDir}/01-terms-1366-full.png`, fullPage: true });
      console.log(`Captured 01-terms-1366x768.png`);
      await context.close();
    }

    // 2. /en/terms at 768 width (narrow viewport)
    {
      const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/terms`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1");

      const hasHorizScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      console.log(`/en/terms 768 narrow has horizontal scroll: ${hasHorizScroll}`);
      if (hasHorizScroll) {
        throw new Error("Horizontal overflow detected on /en/terms 768px narrow viewport!");
      }
      console.log(`PASS: /en/terms 768 narrow has no horizontal scroll.`);

      await page.screenshot({ path: `${outDir}/02-terms-768-narrow.png`, fullPage: false });
      console.log(`Captured 02-terms-768-narrow.png`);
      await context.close();
    }

    // 3. /en/privacy at 1366x768
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/privacy`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1");
      const title = await page.locator("h1").innerText();
      console.log(`/en/privacy loaded: "${title}"`);

      const hasHorizScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      if (hasHorizScroll) {
        throw new Error("Horizontal overflow detected on /en/privacy 1366px!");
      }
      console.log(`PASS: /en/privacy 1366x768 has no horizontal scroll.`);

      await page.screenshot({ path: `${outDir}/03-privacy-1366x768.png`, fullPage: false });
      await page.screenshot({ path: `${outDir}/03-privacy-1366-full.png`, fullPage: true });
      console.log(`Captured 03-privacy-1366x768.png`);
      await context.close();
    }

    // 4. /en/privacy at 768 width (narrow viewport)
    {
      const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/privacy`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1");

      const hasHorizScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      console.log(`/en/privacy 768 narrow has horizontal scroll: ${hasHorizScroll}`);
      if (hasHorizScroll) {
        throw new Error("Horizontal overflow detected on /en/privacy 768px narrow viewport!");
      }
      console.log(`PASS: /en/privacy 768 narrow has no horizontal scroll.`);

      await page.screenshot({ path: `${outDir}/04-privacy-768-narrow.png`, fullPage: false });
      console.log(`Captured 04-privacy-768-narrow.png`);
      await context.close();
    }

    // 5. Feedback form with tiny file chip (45 B .xyz)
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/en/feedback`, { waitUntil: "domcontentloaded" });
      await page.locator("form").waitFor({ state: "visible" });

      // Create an exact 45 B .xyz file
      const buffer = Buffer.alloc(45, "a");
      await page.locator('input[type="file"]').setInputFiles({
        name: "water.xyz",
        mimeType: "chemical/x-xyz",
        buffer,
      });

      // Wait for chip to appear with formatted size
      const chip = page.locator('[data-testid="feedback-file-chip"]');
      await chip.waitFor({ state: "visible", timeout: 5000 });
      const chipText = await chip.innerText();
      console.log(`File chip text: "${chipText}"`);

      if (!chipText.includes("(45 B)")) {
        throw new Error(`Expected chip to show "(45 B)", got: "${chipText}"`);
      }
      console.log(`PASS: Feedback form chip displays formatted "(45 B)".`);

      await page.screenshot({ path: `${outDir}/05-feedback-form-tiny-chip.png` });
      console.log(`Captured 05-feedback-form-tiny-chip.png`);
      await context.close();
    }

    // 6. Owner feedback table showing attachment counts and formatted bytes
    {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();

      // Mock the /api/owner/feedback route with mock data
      await page.route("**/api/owner/feedback", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            reports: [
              {
                id: "rep-001",
                userId: "user-1",
                accountEmail: "researcher@oxford.ac.uk",
                type: "not_working",
                title: "Convergence failure on water cluster",
                details: "SCF did not reach convergence with def2-TZVP",
                status: "sent",
                replyConsent: true,
                pagePath: "/en/workspace",
                locale: "en",
                appVersion: "0.0.32",
                attachmentCount: 1,
                attachmentBytes: 45,
                providerMessageId: "msg-001",
                errorCode: null,
                createdAt: "2026-11-10T04:30:00.000Z",
                sentAt: "2026-11-10T04:30:02.000Z",
              },
              {
                id: "rep-002",
                userId: "user-2",
                accountEmail: "chemist@mit.edu",
                type: "feature_idea",
                title: "Add PBE0-D4 dispersion correction",
                details: "Need D4 dispersion for non-covalent complexes",
                status: "sent",
                replyConsent: true,
                pagePath: "/en/projects",
                locale: "en",
                appVersion: "0.0.32",
                attachmentCount: 1,
                attachmentBytes: 87 * 1024,
                providerMessageId: "msg-002",
                errorCode: null,
                createdAt: "2026-11-10T04:15:00.000Z",
                sentAt: "2026-11-10T04:15:01.000Z",
              },
              {
                id: "rep-003",
                userId: "user-3",
                accountEmail: "postdoc@stanford.edu",
                type: "method_or_engine",
                title: "Question about xTB GFN2 parameters",
                details: "Is GFN2-xTB using the default Hubbard parameters?",
                status: "sent",
                replyConsent: false,
                pagePath: "/en/roadmap",
                locale: "en",
                appVersion: "0.0.32",
                attachmentCount: 0,
                attachmentBytes: 0,
                providerMessageId: "msg-003",
                errorCode: null,
                createdAt: "2026-11-10T03:50:00.000Z",
                sentAt: "2026-11-10T03:50:01.000Z",
              },
            ],
            failedLast7Days: 0,
          }),
        });
      });

      await page.goto(`${BASE}/en/owner/feedback`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Feedback Reports" }).waitFor({ state: "visible" });

      // Verify rows
      const table = page.locator("table");
      await table.waitFor({ state: "visible" });
      const tableText = await table.innerText();
      console.log(`Owner feedback table rendered.`);

      if (!tableText.includes("1 (45 B)")) {
        throw new Error(`Expected owner table to show "1 (45 B)", got: "${tableText}"`);
      }
      if (!tableText.includes("1 (87 KB)")) {
        throw new Error(`Expected owner table to show "1 (87 KB)", got: "${tableText}"`);
      }
      console.log(`PASS: Owner feedback table displays formatted "1 (45 B)" and "1 (87 KB)".`);

      await page.screenshot({ path: `${outDir}/06-owner-feedback-table.png` });
      console.log(`Captured 06-owner-feedback-table.png`);
      await context.close();
    }

    console.log("All Release 0.0.32 screenshots captured and verified successfully!");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
