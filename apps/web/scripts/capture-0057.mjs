import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT_DIR = resolve(ROOT, "../../output/release-0057");
mkdirSync(OUT_DIR, { recursive: true });

const globalsCss = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf8");
const shellCss = readFileSync(resolve(ROOT, "src/app/shell.css"), "utf8");
const aiCss = readFileSync(resolve(ROOT, "src/app/ai-scientist.css"), "utf8");

async function run() {
  const browser = await chromium.launch({ headless: true });

  // 1. AI Panel Declutter at 1440x900 and 390px
  console.log("=== 1. AI Panel Declutter Measurements ===");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const aiPanelHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    ${globalsCss}
    ${shellCss}
    ${aiCss}
    body { margin: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; height: 100vh; }
    .workspace-mock { display: flex; width: 100%; height: 100%; }
    .workspace-main { flex: 1; background: #eaedf1; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <div class="workspace-mock">
    <div class="workspace-main">3D Structure Viewport Mock</div>
    <aside class="ai-scientist-panel is-docked" data-testid="ai-scientist-panel" style="width: 440px; height: 100%; display: flex; flex-direction: column;">
      <header class="ai-scientist-topbar" style="padding: 8px 12px; border-bottom: 1px solid var(--cdf-line, #d0d7de); display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
        <div style="display: flex; gap: 6px; align-items: center;">
          <strong>Nemotron 3.5</strong>
          <span style="color: #64748b;">·</span>
          <span style="color: #475569;">Benzene DFT study</span>
        </div>
        <button type="button" class="bp6-button bp6-minimal bp6-small" style="font-size: 11px;">Details</button>
      </header>

      <div class="ai-chat-container" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
        <div class="ai-conversation-scroll" data-testid="ai-conversation-scroll" style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px;">
          <!-- Turn 1 -->
          <article class="ai-message-bubble user" data-testid="ai-message-bubble">
            <header class="ai-message-header-compact">
              <span class="ai-message-sender-compact" title="Today at 06:32:10 UTC">You · 06:32</span>
            </header>
            <div class="ai-message-body" style="font-size: 13px; line-height: 1.45; color: #1e293b;">
              What is the calculated single-point energy and HOMO-LUMO gap for benzene using B3LYP/def2-SVP?
            </div>
          </article>

          <article class="ai-message-bubble assistant is-chat-mode" data-testid="ai-message-bubble">
            <header class="ai-message-header-compact">
              <span class="ai-message-sender-compact" title="Today at 06:32:14 UTC">AI Scientist · 06:32</span>
              <span class="ai-reply-chip" role="note" title="AI reply · not project evidence">AI reply · not project evidence</span>
            </header>
            <div class="ai-message-body" style="font-size: 13px; line-height: 1.45; color: #1e293b;">
              Based on the validated PySCF calculation (job #4b92e8), the total ground-state electronic energy is -232.2491845 Hartree with a HOMO-LUMO fundamental gap of 6.82 eV. The convergence was achieved in 12 SCF cycles.
            </div>
          </article>

          <!-- Turn 2 -->
          <article class="ai-message-bubble user" data-testid="ai-message-bubble">
            <header class="ai-message-header-compact">
              <span class="ai-message-sender-compact" title="Today at 06:33:02 UTC">You · 06:33</span>
            </header>
            <div class="ai-message-body" style="font-size: 13px; line-height: 1.45; color: #1e293b;">
              Can we run vibrational frequency analysis to confirm there are no imaginary modes?
            </div>
          </article>

          <article class="ai-message-bubble assistant is-chat-mode" data-testid="ai-message-bubble">
            <header class="ai-message-header-compact">
              <span class="ai-message-sender-compact" title="Today at 06:33:05 UTC">AI Scientist · 06:33</span>
              <span class="ai-reply-chip" role="note" title="AI reply · not project evidence">AI reply · not project evidence</span>
            </header>
            <div class="ai-message-body" style="font-size: 13px; line-height: 1.45; color: #1e293b;">
              Yes, a harmonic frequency calculation with PySCF will evaluate the Hessian matrix and verify all 30 normal vibrational modes are real.
              <br><br>
              <em>Nothing was submitted. To prepare a calculation for your approval, use 'Plan a calculation' in the AI box.</em>
            </div>
          </article>
        </div>

        <!-- Composer -->
        <div class="ai-composer-wrapper" style="border-top: 1px solid var(--cdf-line, #d0d7de); padding: 8px 12px; background: #fff;">
          <div class="ai-composer-mode-scope ai-composer-compact-disclaimer" style="margin-bottom: 6px; font-size: 11px; color: #64748b; display: flex; align-items: center; justify-content: space-between;">
            <span>AI replies are not evidence. Plans need your approval.</span>
            <span class="ai-composer-info-trigger" tabindex="0" title="About AI Scientist replies and plans" style="cursor: pointer;">ℹ️</span>
          </div>

          <div class="ai-composer-box" style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; background: #fff;">
            <textarea class="ai-prompt-input ai-composer-textarea" rows="2" placeholder="Ask a question, or describe what you want to do… (Enter to send)" style="width: 100%; border: none; outline: none; font-size: 13px; resize: none;"></textarea>
            <div class="ai-composer-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <div class="ai-composer-toolbar-left" style="display: flex; gap: 6px; align-items: center;">
                <div class="ai-mode-toggle-group" role="group" aria-label="Request mode" style="display: inline-flex; border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden;">
                  <button type="button" class="ai-mode-toggle-btn active" style="padding: 2px 8px; font-size: 11px; border: none; background: #2563eb; color: #fff; cursor: pointer;">Chat</button>
                  <button type="button" class="ai-mode-toggle-btn" style="padding: 2px 8px; font-size: 11px; border: none; background: #f8fafc; color: #475569; cursor: pointer;">Plan</button>
                </div>
                <button type="button" class="ai-composer-options-btn" style="border: 1px solid #cbd5e1; border-radius: 4px; background: #f8fafc; padding: 2px 6px; font-size: 11px; cursor: pointer;">Options ▾</button>
              </div>
              <div class="ai-composer-toolbar-right">
                <button type="button" class="bp6-button bp6-intent-primary bp6-small" style="background: #2563eb; color: #fff; border: none; border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer;">Send</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  </div>
</body>
</html>
  `;

  await page.setContent(aiPanelHtml);
  await page.waitForTimeout(500);

  // Measure 1440x900
  const panelMeasurements = await page.evaluate(() => {
    const panel = document.querySelector(".ai-scientist-panel");
    const scrollContainer = document.querySelector(".ai-conversation-scroll");
    const bubbles = Array.from(document.querySelectorAll(".ai-message-bubble"));
    const messageBodies = Array.from(document.querySelectorAll(".ai-message-body"));

    const panelHeight = panel.clientHeight;
    const scrollHeight = scrollContainer.scrollHeight;
    const scrollClientHeight = scrollContainer.clientHeight;
    const doesScroll = scrollHeight > scrollClientHeight + 2;

    const totalMessageHeight = messageBodies.reduce((acc, el) => acc + el.getBoundingClientRect().height, 0);
    const totalBubbleHeight = bubbles.reduce((acc, el) => acc + el.getBoundingClientRect().height, 0);

    const messageToPanelRatio = totalMessageHeight / panelHeight;
    const bubblesToPanelRatio = totalBubbleHeight / panelHeight;

    return {
      panelHeight,
      scrollClientHeight,
      scrollHeight,
      doesScroll,
      turnsCount: 2,
      totalMessageHeight,
      totalBubbleHeight,
      messageRatioPercent: (messageToPanelRatio * 100).toFixed(1),
      bubbleRatioPercent: (bubblesToPanelRatio * 100).toFixed(1),
    };
  });

  console.log("Measurements at 1440x900:", panelMeasurements);
  await page.screenshot({ path: resolve(OUT_DIR, "ai-panel-declutter-1440x900.png") });

  // Wide variant (1920x1080)
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT_DIR, "ai-panel-wide-1920x1080.png") });

  // Mobile / narrow (390x844)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT_DIR, "ai-panel-declutter-390px.png") });

  // 2. Snapshot Dialog with Credit Line & Caption
  console.log("=== 2. Snapshot Dialog with Credit Line & Caption ===");
  const dialogHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    ${globalsCss}
    body { margin: 0; background: rgba(15, 23, 42, 0.4); display: flex; align-items: center; justify-content: center; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .dialog-card { background: #fff; border-radius: 8px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); width: 460px; overflow: hidden; }
  </style>
</head>
<body>
  <div class="dialog-card">
    <div style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
      <h3 style="margin: 0; font-size: 15px; font-weight: 600;">Export image (PNG / SVG)</h3>
      <span style="font-size: 18px; color: #94a3b8; cursor: pointer;">×</span>
    </div>
    <div style="padding: 20px;">
      <!-- Canvas preview with credit line -->
      <div style="width: 100%; height: 200px; background: #0f172a; border-radius: 6px; position: relative; display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <span style="color: #cbd5e1; font-size: 13px;">[ 3D Benzene Molecule Preview ]</span>
        <div style="position: absolute; bottom: 8px; right: 10px; font-size: 10px; color: rgba(255, 255, 255, 0.7); background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 3px;">
          Rendered with ChemDFT
        </div>
      </div>

      <!-- Credit line checkbox -->
      <label style="display: flex; gap: 8px; align-items: center; font-size: 13px; color: #1e293b; margin-bottom: 14px; cursor: pointer;">
        <input type="checkbox" checked style="accent-color: #2563eb;" />
        <span>Add a small 'Rendered with ChemDFT' line</span>
      </label>

      <!-- Copy figure caption section -->
      <div style="border-top: 1px solid #e2e8f0; padding-top: 14px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 12px; font-weight: 600; color: #475569;">Figure caption for publication</span>
          <button type="button" style="border: 1px solid #cbd5e1; background: #f8fafc; padding: 2px 8px; font-size: 11px; border-radius: 4px; cursor: pointer; color: #2563eb; font-weight: 500;">
            Copy figure caption
          </button>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; font-size: 11px; line-height: 1.4; color: #334155;">
          Structure rendered with ChemDFT 0.0.57 (DOI 10.5281/zenodo.18872223). Coordinates: benzene.xyz. Calculated with PySCF 2.14.0, b3lyp/def2-svp.
        </div>
      </div>
    </div>
    <div style="padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 8px;">
      <button type="button" style="border: 1px solid #cbd5e1; background: #fff; padding: 5px 12px; border-radius: 4px; font-size: 12px; cursor: pointer;">Cancel</button>
      <button type="button" style="border: none; background: #2563eb; color: #fff; padding: 5px 14px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer;">Export PNG</button>
    </div>
  </div>
</body>
</html>
  `;
  await page.setViewportSize({ width: 800, height: 600 });
  await page.setContent(dialogHtml);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT_DIR, "snapshot-dialog-credit-line-caption.png") });

  // 3. Cite Nudge
  console.log("=== 3. Cite Nudge Inline Hint ===");
  const citeNudgeHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    ${globalsCss}
    body { margin: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; }
    .job-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; width: 500px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  </style>
</head>
<body>
  <div class="job-card">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <strong>Calculation #4b92e8 — Succeeded</strong>
      <span style="font-size: 11px; background: #ecfdf5; color: #047857; padding: 2px 6px; border-radius: 3px; font-weight: 600;">VALIDATED</span>
    </div>

    <!-- Inline dismissible Cite Nudge -->
    <div class="cite-nudge" style="display: flex; align-items: center; justify-content: space-between; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; color: #0369a1;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 14px;">📄</span>
        <span>Using this in a paper? <strong>Copy the citation</strong></span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button type="button" style="background: #0284c7; color: #fff; border: none; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 500; cursor: pointer;">
          Cite calculation
        </button>
        <span style="cursor: pointer; color: #0284c7; font-size: 16px; line-height: 1;">×</span>
      </div>
    </div>

    <div style="font-size: 12px; color: #64748b; line-height: 1.5;">
      Ground-state energy: -232.2491845 Hartree<br>
      Engine: PySCF 2.14.0 (B3LYP/def2-SVP)
    </div>
  </div>
</body>
</html>
  `;
  await page.setContent(citeNudgeHtml);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT_DIR, "cite-nudge.png") });

  // 4. Pulse Light States
  console.log("=== 4. Pulse Light States ===");
  const pulseHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    ${globalsCss}
    body { margin: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; }
    .pulse-grid { display: flex; flex-direction: column; gap: 16px; width: 620px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .pulse-row { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; }
    .pulse-row:last-child { border-bottom: none; padding-bottom: 0; }
    .row-label { font-size: 12px; font-weight: 600; color: #64748b; width: 140px; }
  </style>
</head>
<body>
  <div class="pulse-grid">
    <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">
      Real Signal Pulse Light Indicators (Never colour alone, never decorative)
    </div>

    <!-- Starting (Amber slow pulse) -->
    <div class="pulse-row" id="row-starting">
      <div class="row-label">Starting (AWS / Leased)</div>
      <div class="cdf-pulse-light-container" role="status" aria-live="polite">
        <span class="cdf-pulse-light-dot is-pulsing" data-color="amber"></span>
        <span class="cdf-pulse-light-word">Starting</span>
        <span class="cdf-pulse-light-detail">Starting the compute machine — usually about 2.5 min</span>
      </div>
    </div>

    <!-- Running + Fresh (Green pulse) -->
    <div class="pulse-row" id="row-running">
      <div class="row-label">Running (Fresh)</div>
      <div class="cdf-pulse-light-container" role="status" aria-live="polite">
        <span class="cdf-pulse-light-dot is-pulsing" data-color="green"></span>
        <span class="cdf-pulse-light-word">Running</span>
        <span class="cdf-pulse-light-detail">Running — worker checked in 4 s ago</span>
      </div>
    </div>

    <!-- Stale / Stuck (Grey, no pulse + Cancel) -->
    <div class="pulse-row" id="row-stale">
      <div class="row-label">Stale / Overdue (No signal)</div>
      <div class="cdf-pulse-light-container" role="status" aria-live="polite">
        <span class="cdf-pulse-light-dot" data-color="grey"></span>
        <span class="cdf-pulse-light-word">Stale</span>
        <span class="cdf-pulse-light-detail">No signal for 90 s — this may be stuck</span>
        <button type="button" class="cdf-pulse-light-cancel-btn" style="border: 1px solid #cbd5e1; background: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; color: #c23030; font-weight: 500;">
          Cancel
        </button>
      </div>
    </div>

    <!-- Queued -->
    <div class="pulse-row">
      <div class="row-label">Queued</div>
      <div class="cdf-pulse-light-container" role="status" aria-live="polite">
        <span class="cdf-pulse-light-dot" data-color="amber"></span>
        <span class="cdf-pulse-light-word">Queued</span>
        <span class="cdf-pulse-light-detail">Queued in compute queue · elapsed 15 s</span>
      </div>
    </div>

    <!-- Succeeded -->
    <div class="pulse-row">
      <div class="row-label">Succeeded</div>
      <div class="cdf-pulse-light-container" role="status" aria-live="polite">
        <span class="cdf-pulse-light-dot" data-color="green"></span>
        <span class="cdf-pulse-light-word">Succeeded</span>
        <span class="cdf-pulse-light-detail">Calculation completed successfully.</span>
      </div>
    </div>

    <!-- Failed -->
    <div class="pulse-row">
      <div class="row-label">Failed</div>
      <div class="cdf-pulse-light-container" role="status" aria-live="polite">
        <span class="cdf-pulse-light-dot" data-color="red"></span>
        <span class="cdf-pulse-light-word">Failed</span>
        <span class="cdf-pulse-light-detail">Calculation failed.</span>
      </div>
    </div>
  </div>
</body>
</html>
  `;
  await page.setContent(pulseHtml);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT_DIR, "pulse-light-all-states.png") });

  // Individual captures
  const startingEl = page.locator("#row-starting");
  await startingEl.screenshot({ path: resolve(OUT_DIR, "pulse-light-amber-starting.png") });

  const runningEl = page.locator("#row-running");
  await runningEl.screenshot({ path: resolve(OUT_DIR, "pulse-light-green-running.png") });

  const staleEl = page.locator("#row-stale");
  await staleEl.screenshot({ path: resolve(OUT_DIR, "pulse-light-grey-stale-cancel.png") });

  await browser.close();
  console.log("All Playwright captures generated successfully in output/release-0057/!");
}

run().catch((err) => {
  console.error("Error running captures:", err);
  process.exit(1);
});
