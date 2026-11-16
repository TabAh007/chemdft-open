// One-off asset capture: the real ChemDFT workspace showing the stored water HF/STO-3G HOMO, at 2x.
// Run against a COPY of a development database in which the water project holds a real PySCF run:
//   CHEMDFT_CAPTURE_URL=http://127.0.0.1:3131 CHEMDFT_CAPTURE_PROJECT=<project id> CHEMDFT_CAPTURE_OUT=<dir> node scripts/capture-workstation.mjs
import { chromium } from "@playwright/test";

const base = process.env.CHEMDFT_CAPTURE_URL ?? "http://127.0.0.1:3131";
const project = process.env.CHEMDFT_CAPTURE_PROJECT;
const out = process.env.CHEMDFT_CAPTURE_OUT ?? ".";
if (!project) throw new Error("CHEMDFT_CAPTURE_PROJECT is required");

const browser = await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, baseURL: base });
await context.addInitScript(() => localStorage.setItem("chemdft:workspace-mode", "guided"));
const page = await context.newPage();
await page.goto(`/en/projects/${project}/workspace`, { waitUntil: "domcontentloaded" });
await page.getByTestId("what-chemdft-found").waitFor({ timeout: 90_000 });
await page.getByTestId("guided-view-electronic-btn").first().click({ timeout: 30_000 }).catch(async () => {
  await page.getByTestId("goal-review-structure").click();
  await page.getByTestId("guided-view-electronic-btn").click();
});
await page.getByTestId("guided-result-view").waitFor({ timeout: 60_000 });
await page.locator(".guided-3d-canvas-wrap canvas").waitFor({ timeout: 60_000 });
// the AI dock opens by default in a development database with a long history; close it for a clean workspace
await page.getByRole("button", { name: /close/i }).filter({ has: page.locator("svg") }).first().click({ timeout: 5000 }).catch(async () => page.mouse.click(1577, 68));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/workstation-homo.png` });
await browser.close();
console.log("captured");
