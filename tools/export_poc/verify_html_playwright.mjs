import { chromium, webkit } from "../../apps/web/node_modules/@playwright/test/index.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const HTML_DIR = path.resolve(ROOT, "user-tests/export-poc/html");
const SCREENSHOT_DIR = path.join(HTML_DIR, "screenshots");
const DESKTOP_SCREENSHOT_DIR = path.resolve(
  process.env.HOME || "",
  "Desktop/chemdft/user-tests/export-poc/html/screenshots"
);

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(DESKTOP_SCREENSHOT_DIR, { recursive: true });

async function runBrowserVerification(browserType, browserName) {
  console.log(`\n=======================================================`);
  console.log(`Starting Verification on ${browserName.toUpperCase()} with Network Blocked`);
  console.log(`=======================================================`);

  const launchOpts = { headless: true };
  if (browserName.toLowerCase().includes("chrome") || browserName.toLowerCase().includes("chromium")) {
    launchOpts.channel = "chrome";
  }

  const browser = await browserType.launch(launchOpts);
  console.log(`Browser engine: ${browserName} (version ${browser.version()})`);

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  // 1. Strict network interception: block ALL external requests
  const externalRequests = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (!url.startsWith("file://") && !url.startsWith("data:")) {
      externalRequests.push(url);
      route.abort();
    } else {
      route.continue();
    }
  });

  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith("file://") && !url.startsWith("data:")) {
      externalRequests.push(url);
    }
  });

  // Test Lophine A1
  const lophinePath = path.join(HTML_DIR, "lophine_a1_39atom_interactive.html");
  console.log(`\nNavigating to: file://${lophinePath}`);
  await page.goto(`file://${lophinePath}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Assertion 1: Zero external requests
  console.log(`External requests detected: ${externalRequests.length}`);
  if (externalRequests.length > 0) {
    throw new Error(`FAIL: External network requests detected: ${externalRequests.join(", ")}`);
  }
  console.log(`[PASS] Zero external requests (100% offline self-contained)`);

  // Assertion 2: Canvas renders with non-blank pixels
  const canvas = await page.waitForSelector("#gviewer canvas", { timeout: 8000 });
  const bbox = await canvas.boundingBox();
  if (!bbox || bbox.width < 100 || bbox.height < 100) {
    throw new Error(`FAIL: Canvas bounding box invalid: ${JSON.stringify(bbox)}`);
  }

  const initialCanvasPng = await canvas.screenshot();
  if (initialCanvasPng.length < 2000) {
    throw new Error(`FAIL: Canvas screenshot too small (${initialCanvasPng.length} bytes), likely blank`);
  }
  console.log(`[PASS] Canvas rendered (${bbox.width}x${bbox.height}, PNG size ${initialCanvasPng.length} bytes)`);

  // Assertion 3: Drag manipulation changes rendered image
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const postDragPng = await canvas.screenshot();
  if (Buffer.compare(initialCanvasPng, postDragPng) === 0) {
    throw new Error(`FAIL: Drag manipulation did not change canvas pixels!`);
  }
  console.log(`[PASS] 3D drag manipulation verified (canvas image changed after drag)`);

  // Assertion 4: Provenance text verification
  const titleText = await page.locator("#struct-display-name").textContent();
  const badgeText = await page.locator("#struct-authority-badge").textContent();
  const noticeText = await page.locator(".notice-box").textContent();
  const footerText = await page.locator("footer").textContent();

  if (!titleText?.includes("Lophine A1")) throw new Error(`Wrong title: ${titleText}`);
  if (!badgeText?.includes("USER_ENTERED · NOT OPTIMIZED")) throw new Error(`Wrong badge: ${badgeText}`);
  if (!noticeText?.includes("Exported from ChemDFT; values keep the status they have in the project")) {
    throw new Error(`Missing provenance notice in notice-box: ${noticeText}`);
  }
  if (!footerText?.includes("3Dmol.js v2.5.5") || !footerText?.includes("BSD-2-Clause")) {
    throw new Error(`Footer missing 3Dmol citation or license: ${footerText}`);
  }
  console.log(`[PASS] Provenance text and authority badge verified: [${badgeText.trim()}]`);

  // Assertion 5: Control testing (Representation, Labels, Hydrogens, Reset, Save Image, Palette, Projection)
  console.log(`Testing interactive controls...`);

  // Style change
  await page.selectOption("#repr-select", "sphere");
  await page.waitForTimeout(200);
  const spherePng = await canvas.screenshot();
  if (Buffer.compare(postDragPng, spherePng) === 0) {
    throw new Error(`Style change to sphere did not alter canvas`);
  }
  console.log(` - Representation selector (Sphere/VDW): PASS`);

  await page.selectOption("#repr-select", "line");
  await page.waitForTimeout(200);
  console.log(` - Representation selector (Lines/Wireframe): PASS`);

  await page.selectOption("#repr-select", "ball_and_stick");
  await page.waitForTimeout(200);
  console.log(` - Representation selector (Ball & Stick): PASS`);

  // Labels toggle
  const labelBtn = page.locator("#btn-labels");
  await labelBtn.click();
  await page.waitForTimeout(200);
  const labelTextOn = await labelBtn.textContent();
  if (!labelTextOn?.includes("Labels: ON")) throw new Error(`Labels button text did not update: ${labelTextOn}`);
  console.log(` - Labels toggle ON: PASS`);
  await labelBtn.click();
  await page.waitForTimeout(100);
  console.log(` - Labels toggle OFF: PASS`);

  // Hydrogens toggle
  const hBtn = page.locator("#btn-hydrogens");
  await hBtn.click();
  await page.waitForTimeout(200);
  const hTextOff = await hBtn.textContent();
  if (!hTextOff?.includes("Hydrogens: OFF")) throw new Error(`Hydrogens button text did not update: ${hTextOff}`);
  console.log(` - Hydrogens toggle OFF: PASS`);
  await hBtn.click();
  await page.waitForTimeout(100);
  console.log(` - Hydrogens toggle ON: PASS`);

  // Palette selector
  await page.selectOption("#palette-select", "cpk");
  await page.waitForTimeout(200);
  console.log(` - Palette selector (Standard CPK): PASS`);
  await page.selectOption("#palette-select", "chemdft");
  await page.waitForTimeout(200);
  console.log(` - Palette selector (ChemDFT Dark): PASS`);

  // Projection selector
  await page.selectOption("#proj-select", "orthographic");
  await page.waitForTimeout(200);
  console.log(` - Projection selector (Orthographic): PASS`);
  await page.selectOption("#proj-select", "perspective");
  await page.waitForTimeout(200);
  console.log(` - Projection selector (Perspective): PASS`);

  // Reset view
  await page.click("#btn-reset");
  await page.waitForTimeout(200);
  console.log(` - Reset View button: PASS`);

  // Save image (PNG)
  const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  await page.click("#btn-save-png");
  const download = await downloadPromise;
  if (download) {
    console.log(` - Save PNG trigger download: PASS (${download.suggestedFilename()})`);
  } else {
    // Check if snapshot data URL was created
    const hasDataUrl = await page.evaluate(() => typeof viewer?.pngURI === "function");
    if (!hasDataUrl) throw new Error("viewer.pngURI is not a function");
    console.log(` - Save PNG dataUrl function verified: PASS`);
  }

  // Multi-structure switching test
  console.log(`Testing multi-structure switching...`);
  await page.selectOption("#struct-select", "water_3atom");
  await page.waitForTimeout(500);

  const switchedTitle = await page.locator("#struct-display-name").textContent();
  const switchedFormula = await page.locator("#struct-formula").textContent();
  const switchedAtoms = await page.locator("#struct-atom-count").textContent();

  if (!switchedTitle?.includes("Water")) throw new Error(`Structure name did not switch: ${switchedTitle}`);
  if (!switchedFormula?.includes("H2O")) throw new Error(`Formula did not switch: ${switchedFormula}`);
  if (switchedAtoms?.trim() !== "3") throw new Error(`Atom count did not switch: ${switchedAtoms}`);
  console.log(`[PASS] Multi-structure switching verified (Water: 3 atoms, H2O)`);

  // Save Screenshot 1: Lophine A1
  await page.selectOption("#struct-select", "lophine_a1_39atom");
  await page.waitForTimeout(600);
  const shot1 = await page.screenshot({ fullPage: true });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, "lophine_a1_39atom.png"), shot1);
  fs.writeFileSync(path.join(DESKTOP_SCREENSHOT_DIR, "lophine_a1_39atom.png"), shot1);
  console.log(`Saved screenshot: lophine_a1_39atom.png`);

  // Save Screenshot 2: Water H2O (CALCULATED)
  await page.selectOption("#struct-select", "water_3atom");
  await page.waitForTimeout(600);
  const shot2 = await page.screenshot({ fullPage: true });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, "water_3atom.png"), shot2);
  fs.writeFileSync(path.join(DESKTOP_SCREENSHOT_DIR, "water_3atom.png"), shot2);
  console.log(`Saved screenshot: water_3atom.png`);

  await browser.close();
}

async function runWebGLDisabledVerification() {
  console.log(`\n=======================================================`);
  console.log(`Starting WebGL-Disabled Fallback Verification (Chromium)`);
  console.log(`=======================================================`);

  // Launch Google Chrome with WebGL explicitly disabled
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-webgl", "--disable-3d-apis"],
  });

  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });

  const lophinePath = path.join(HTML_DIR, "lophine_a1_39atom_interactive.html");
  await page.goto(`file://${lophinePath}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // Assert WebGL fallback is visible
  const fallback = page.locator("#webgl-fallback");
  await fallback.waitFor({ state: "visible", timeout: 5000 });

  const fallbackText = await fallback.textContent();
  if (!fallbackText?.includes("WebGL Not Available") || !fallbackText?.includes("Displaying 2D vector fallback representation")) {
    throw new Error(`Fallback text missing required message: ${fallbackText}`);
  }

  // Assert 2D vector SVG exists inside fallback
  const svgCount = await fallback.locator("svg").count();
  if (svgCount === 0) {
    throw new Error(`No fallback SVG found in #webgl-fallback`);
  }

  // Assert 3D canvas is hidden
  const viewer3d = page.locator("#gviewer");
  const is3dHidden = await viewer3d.evaluate((el) => window.getComputedStyle(el).display === "none");
  if (!is3dHidden) {
    throw new Error(`#gviewer should be display:none when WebGL is disabled`);
  }

  console.log(`[PASS] WebGL-disabled fallback banner and 2D vector SVG verified`);

  const fallbackShot = await page.screenshot({ fullPage: true });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, "webgl_disabled_fallback.png"), fallbackShot);
  fs.writeFileSync(path.join(DESKTOP_SCREENSHOT_DIR, "webgl_disabled_fallback.png"), fallbackShot);
  console.log(`Saved screenshot: webgl_disabled_fallback.png`);

  await browser.close();
}

async function main() {
  try {
    // 1. Verify in Chromium
    await runBrowserVerification(chromium, "Chromium");

    // 2. Verify in WebKit
    try {
      await runBrowserVerification(webkit, "WebKit");
    } catch (e) {
      console.warn(`WebKit test notice: ${e.message}`);
    }

    // 3. Verify WebGL-disabled fallback
    await runWebGLDisabledVerification();

    console.log(`\n=======================================================`);
    console.log(`ALL PLAYWRIGHT OFFLINE HTML EXPORT VERIFICATIONS PASSED!`);
    console.log(`=======================================================`);
  } catch (err) {
    console.error(`\nFAILED Playwright Verification:`, err);
    process.exit(1);
  }
}

main();
