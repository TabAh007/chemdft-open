import { describe, it } from "vitest";
import type { AIMessageView, AIRunView } from "@chemdft/schemas";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { AIScientistHeader } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-header";
import { AIScientistToolsTab } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-tools-tab";
import { AIScientistEvidenceTab } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-evidence-tab";
import { AIScientistRunsTab } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-runs-tab";
import { AIScientistSettingsTab } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-settings-tab";

/**
 * STATIC COMPONENT PREVIEW generator — NOT a test and NOT localhost integration evidence.
 * Renders components with renderToStaticMarkup() and page.setContent(); no routing, auth, API,
 * effects or interaction. Every fixture below is SYNTHETIC: no value is a calculated or verified
 * scientific result and no citation refers to a real document.
 */
const artifactDir = process.env.CHEMDFT_UI1_CAPTURE_DIR ?? resolve(__dirname, "../../../.chemdft/audits/ui-1-static-previews");
mkdirSync(artifactDir, { recursive: true });

function cleanCss(css: string): string {
  return css.replace(/@import\s+[^;]+;/g, "");
}

function getStyles(): string {
  const root = resolve(__dirname, "../../..");
  const blueprintCss = readFileSync(resolve(root, "apps/web/node_modules/@blueprintjs/core/lib/css/blueprint.css"), "utf8");
  const tokensCss = readFileSync(resolve(root, "packages/ui/src/tokens.css"), "utf8");
  const globalsCss = readFileSync(resolve(root, "apps/web/src/app/globals.css"), "utf8");
  const shellCss = readFileSync(resolve(root, "apps/web/src/app/shell.css"), "utf8");
  const aiScientistCss = readFileSync(resolve(root, "apps/web/src/app/ai-scientist.css"), "utf8");

  const font16Base64 = readFileSync(resolve(root, "apps/web/node_modules/@blueprintjs/icons/lib/css/blueprint-icons-16.woff2")).toString("base64");
  const font20Base64 = readFileSync(resolve(root, "apps/web/node_modules/@blueprintjs/icons/lib/css/blueprint-icons-20.woff2")).toString("base64");

  const fontFaceCss = `
@font-face {
  font-family: "blueprint-icons-16";
  src: url("data:font/woff2;base64,${font16Base64}") format("woff2");
}
@font-face {
  font-family: "blueprint-icons-20";
  src: url("data:font/woff2;base64,${font20Base64}") format("woff2");
}
`;

  return [cleanCss(tokensCss), cleanCss(blueprintCss), fontFaceCss, cleanCss(globalsCss), cleanCss(shellCss), cleanCss(aiScientistCss)].join("\n");
}

function wrapHtml(content: string, options: { isExpanded?: boolean; title?: string } = {}): string {
  const styles = getStyles();
  const expandedClass = options.isExpanded ? "is-expanded" : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${options.title ?? "ChemDFT AI Scientist"}</title>
  <style>
    ${styles}
    body {
      margin: 0;
      padding: 0;
      background: #f7f9fb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      overflow: hidden;
    }
    .capture-container {
      width: 100%;
      height: 100vh;
      display: flex;
      justify-content: flex-end;
      background: #eef2f6;
    }
    .capture-container.full-workspace {
      display: grid;
      grid-template-columns: 1fr 680px;
      height: 100vh;
    }
  </style>
</head>
<body>
  <div role="note" style="position:fixed;z-index:9999;left:0;right:0;top:0;padding:4px 10px;background:#7c2d12;color:#fff;font:600 11px/1.4 system-ui,sans-serif;text-align:center">
    STATIC COMPONENT PREVIEW · SYNTHETIC FIXTURE DATA · not scientific results · not a localhost integration test
  </div>
  <div class="capture-container ${options.isExpanded ? "expanded-view" : "docked-view"}">
    <aside class="ai-scientist-redesign-panel ${expandedClass}" data-testid="ai-scientist-panel" style="height: 100vh; border-left: 1px solid var(--cdf-line, #d6dde4);">
      ${content}
    </aside>
  </div>
</body>
</html>`;
}

function renderChatContent(): string {
  const headerHtml = renderToStaticMarkup(
    createElement(AIScientistHeader, {
      activeTab: "chat",
      onSelectTab: () => {},
      isExpanded: true,
      onToggleExpanded: () => {},
    })
  );

  // HAND-BUILT MOCKUP: this Chat view is static HTML copied from the approved reference, not
  // rendered from AIScientistPanel. Real Chat behaviour is covered by the localhost browser suite.
  const modelCardHtml = `
    <div role="note" style="margin:28px 14px 0;padding:6px 8px;border:1px dashed #b45309;color:#7c2d12;font:600 11px/1.4 system-ui,sans-serif">
      HAND-BUILT MOCKUP of the approved Chat reference — not rendered from the production component; values are illustrative.
    </div>
    <div class="ai-model-provider-card" style="margin: 12px 14px 8px 14px;">
      <div class="ai-model-header-row">
        <span class="ai-model-provider-label">Model &amp; Provider</span>
        <a href="#learn-more" class="ai-model-learn-more">Learn more</a>
      </div>
      <div class="ai-model-selector-row">
        <div class="ai-model-selector-left">
          <span class="ai-model-provider-badge">
            <svg class="ai-nvidia-logo" viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M4 6.5C4 6.5 7.5 4 11.5 4C17.5 4 21 8.5 21 12C21 16 16.5 20 11.5 20C7.5 20 4 17.5 4 17.5" stroke="#76b900" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M7 9C7 9 9.5 7.5 11.5 7.5C15 7.5 17.5 10 17.5 12C17.5 14 14.5 16.5 11.5 16.5C9.5 16.5 7 15 7 15" stroke="#76b900" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <div class="ai-model-name-group">
            <span class="ai-model-provider-org">NVIDIA</span>
            <span class="ai-model-name-title">Nemotron 3.5 Lightning 30B (A3B)</span>
          </div>
        </div>
        <div class="ai-model-selector-right">
          <span class="ai-model-free-badge">Free</span>
          <svg class="ai-dropdown-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>
      <div class="ai-model-capability-pills">
        <span class="ai-model-cap-pill"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Fast</span>
        <span class="ai-model-cap-pill"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></svg> 128K context</span>
        <span class="ai-model-cap-pill"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Tool calling</span>
        <span class="ai-model-cap-pill"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Good for agentic tasks</span>
      </div>
    </div>
  `;

  const messagesHtml = `
    <div class="ai-chat-conversation" style="padding: 12px 14px; flex: 1; overflow-y: auto;">
      <div class="ai-message-row user" style="margin-bottom: 16px;">
        <div class="ai-message-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: #0284c7; color: white; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600;">T</div>
            <strong style="font-size: 13px; color: #1e293b;">You</strong>
          </div>
          <span style="font-size: 11px; color: #94a3b8;">Oct 16, 2026, 13:51</span>
        </div>
        <div class="ai-user-bubble" style="background: #f1f5f9; border-radius: 8px; padding: 10px 14px; font-size: 13.5px; line-height: 1.5; color: #0f172a;">
          Plan a single-point energy calculation for H<sub>2</sub> using PySCF. Use HF with STO-3G. Charge 0, multiplicity 1.
        </div>
      </div>

      <div class="ai-message-row assistant" style="margin-bottom: 16px;">
        <div class="ai-message-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 24px; height: 24px; border-radius: 6px; background: #2563eb; color: white; display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/></svg>
            </div>
            <strong style="font-size: 13px; color: #1e293b;">AI Scientist</strong>
          </div>
          <span style="font-size: 11px; color: #94a3b8;">Oct 16, 2026, 13:51</span>
        </div>
        <div class="ai-assistant-body" style="font-size: 13.5px; line-height: 1.5; color: #1e293b;">
          <div class="ai-plan-prepared-heading" style="display: flex; align-items: center; gap: 6px; font-weight: 600; color: #166534; margin-bottom: 6px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#16a34a" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
            Scientific plan prepared
          </div>
          <p style="margin: 0 0 10px 0; color: #334155;">
            I will prepare a PySCF single-point energy calculation for the H<sub>2</sub> structure in this project using HF/STO-3G, charge 0, multiplicity 1. Here is the proposed setup:
          </p>

          <div class="ai-proposal-card" style="border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff; padding: 14px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <div class="ai-proposal-card-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">
              <div style="font-weight: 600; font-size: 13px; color: #0f172a;">Proposed calculation</div>
              <span class="ai-waiting-approval-pill" style="background: #fef3c7; color: #b45309; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 9999px;">Waiting for approval</span>
            </div>
            <table class="ai-proposal-spec-table" style="width: 100%; font-size: 12.5px; border-collapse: collapse;">
              <tbody>
                <tr style="border-bottom: 1px solid #f8fafc;"><td style="padding: 5px 0; color: #64748b; width: 140px;">⚙️ Method</td><td style="padding: 5px 0; font-weight: 500; color: #0f172a;">Hartree-Fock (HF)</td></tr>
                <tr style="border-bottom: 1px solid #f8fafc;"><td style="padding: 5px 0; color: #64748b;">📚 Basis set</td><td style="padding: 5px 0; font-weight: 500; color: #0f172a;">STO-3G</td></tr>
                <tr style="border-bottom: 1px solid #f8fafc;"><td style="padding: 5px 0; color: #64748b;">🎯 Engine</td><td style="padding: 5px 0; font-weight: 500; color: #0f172a;">PySCF 2.14.0</td></tr>
                <tr style="border-bottom: 1px solid #f8fafc;"><td style="padding: 5px 0; color: #64748b;">🧊 Molecule</td><td style="padding: 5px 0; font-weight: 500; color: #0f172a;">h2-reference V1 (2 atoms)</td></tr>
                <tr style="border-bottom: 1px solid #f8fafc;"><td style="padding: 5px 0; color: #64748b;">⚡ Charge</td><td style="padding: 5px 0; font-weight: 500; color: #0f172a;">0</td></tr>
                <tr style="border-bottom: 1px solid #f8fafc;"><td style="padding: 5px 0; color: #64748b;">🔢 Multiplicity</td><td style="padding: 5px 0; font-weight: 500; color: #0f172a;">1 (singlet)</td></tr>
                <tr style="border-bottom: 1px solid #f8fafc;"><td style="padding: 5px 0; color: #64748b;">⏱️ Estimated runtime</td><td style="padding: 5px 0; font-weight: 500; color: #0f172a;">Local worker · ~2–5s</td></tr>
                <tr><td style="padding: 5px 0; color: #64748b;">🔒 Result Firewall</td><td style="padding: 5px 0; font-weight: 600; color: #2563eb;">Pending human approval</td></tr>
              </tbody>
            </table>
            <div style="margin-top: 10px; font-size: 12px; color: #475569; display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              Show input preview
            </div>
            <div class="ai-proposal-firewall-notice" style="margin-top: 10px; padding: 8px 10px; background: #f8fafc; border-radius: 6px; font-size: 11.5px; color: #64748b; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#64748b" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              This is a proposed calculation. No calculation will be executed until you approve it.
            </div>
          </div>

          <div class="ai-message-actions-row" style="display: flex; align-items: center; justify-content: space-between; margin-top: 6px;">
            <div style="display: flex; gap: 8px; color: #94a3b8;">
              <button class="ai-icon-action-btn" style="border: none; background: none; color: #64748b; cursor: pointer; padding: 4px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></button>
              <button class="ai-icon-action-btn" style="border: none; background: none; color: #64748b; cursor: pointer; padding: 4px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg></button>
              <button class="ai-icon-action-btn" style="border: none; background: none; color: #64748b; cursor: pointer; padding: 4px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="ai-refine-plan-btn" style="border: 1px solid #cbd5e1; background: #ffffff; border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 500; color: #334155; display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Refine plan
              </button>
              <button class="ai-more-btn" style="border: 1px solid #cbd5e1; background: #ffffff; border-radius: 6px; padding: 4px 8px; font-size: 12px; color: #334155; cursor: pointer;">···</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const composerHtml = `
    <div class="ai-composer-dock" style="border-top: 1px solid var(--cdf-line, #d6dde4); background: #ffffff; padding: 10px 14px;">
      <div class="ai-action-mode-selector" style="display: flex; gap: 4px; margin-bottom: 8px;">
        <button class="ai-mode-pill" style="border: none; background: transparent; padding: 4px 10px; font-size: 12px; font-weight: 500; color: #64748b; cursor: pointer;">Ask</button>
        <button class="ai-mode-pill active" style="border: none; background: transparent; padding: 4px 10px; font-size: 12px; font-weight: 600; color: #2563eb; border-bottom: 2px solid #2563eb; cursor: pointer;">Plan calculation</button>
        <button class="ai-mode-pill" style="border: none; background: transparent; padding: 4px 10px; font-size: 12px; font-weight: 500; color: #64748b; cursor: pointer;">Analyze results</button>
        <button class="ai-mode-pill" style="border: none; background: transparent; padding: 4px 10px; font-size: 12px; font-weight: 500; color: #64748b; cursor: pointer;">General</button>
      </div>
      <div class="ai-composer-input-box" style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; background: #ffffff;">
        <textarea placeholder="Ask the AI Scientist...&#10;(e.g. plan a calculation, compare methods, analyze results)" style="width: 100%; border: none; resize: none; outline: none; font-family: inherit; font-size: 13px; color: #1e293b; height: 48px; line-height: 1.4;"></textarea>
        <div class="ai-composer-toolbar" style="display: flex; align-items: center; justify-content: space-between; margin-top: 6px;">
          <div style="display: flex; gap: 6px;">
            <button class="ai-tool-attach-btn" style="border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 6px; padding: 4px 8px; font-size: 11.5px; color: #475569; display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> Attach
            </button>
            <button class="ai-tool-attach-btn" style="border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 6px; padding: 4px 8px; font-size: 11.5px; color: #475569; display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg> Project
            </button>
            <button class="ai-tool-attach-btn" style="border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 6px; padding: 4px 8px; font-size: 11.5px; color: #475569; display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Tools
            </button>
          </div>
          <button class="ai-send-btn" style="width: 28px; height: 28px; border-radius: 50%; background: #2563eb; border: none; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
      <div class="ai-composer-footer-links" style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 11.5px; color: #64748b;">
        <span style="display: flex; align-items: center; gap: 4px;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
          Context: h2-reference V1
        </span>
        <span style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
          Evidence: 1 source <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </span>
      </div>
    </div>
  `;

  return `${headerHtml}${modelCardHtml}${messagesHtml}${composerHtml}`;
}

describe("UI-1 Visual Capture", () => {
  it("renders and captures all 5 approved views in docked and expanded configurations", async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // 1. Screenshot 1: Chat Tab - Expanded (680px)
    const chatHtmlExpanded = wrapHtml(renderChatContent(), { isExpanded: true, title: "ChemDFT - AI Scientist Chat" });
    await page.setViewportSize({ width: 720, height: 980 });
    await page.setContent(chatHtmlExpanded);
    await page.screenshot({ path: `${artifactDir}/actual_01_chat_expanded.png`, fullPage: true });

    // 2. Screenshot 1: Chat Tab - Docked (360px)
    const chatHtmlDocked = wrapHtml(renderChatContent(), { isExpanded: false, title: "ChemDFT - AI Scientist Chat Docked" });
    await page.setViewportSize({ width: 380, height: 980 });
    await page.setContent(chatHtmlDocked);
    await page.screenshot({ path: `${artifactDir}/actual_01_chat_docked.png`, fullPage: true });

    // 3. Screenshot 2: Tools Tab - Expanded (680px)
    const toolsHeaderHtml = renderToStaticMarkup(
      createElement(AIScientistHeader, {
        activeTab: "tools",
        onSelectTab: () => {},
        isExpanded: true,
        onToggleExpanded: () => {},
      })
    );
    const toolsBodyHtml = renderToStaticMarkup(createElement(AIScientistToolsTab, {}));
    const toolsHtmlExpanded = wrapHtml(`${toolsHeaderHtml}${toolsBodyHtml}`, { isExpanded: true, title: "ChemDFT - Available Tools" });
    await page.setViewportSize({ width: 720, height: 1280 });
    await page.setContent(toolsHtmlExpanded);
    await page.screenshot({ path: `${artifactDir}/actual_02_tools_expanded.png`, fullPage: true });

    // 4. Screenshot 2: Tools Tab - Docked (360px)
    const toolsHtmlDocked = wrapHtml(`${toolsHeaderHtml}${toolsBodyHtml}`, { isExpanded: false, title: "ChemDFT - Available Tools Docked" });
    await page.setViewportSize({ width: 380, height: 1280 });
    await page.setContent(toolsHtmlDocked);
    await page.screenshot({ path: `${artifactDir}/actual_02_tools_docked.png`, fullPage: true });

    // 5. Screenshot 3: Evidence Tab - Expanded (680px)
    const mockEvidenceMessages = [
      {
        id: "m1",
        conversation_id: "conv-1",
        role: "ASSISTANT",
        created_at: "2026-10-16T13:51:00Z",
        citations: [
          {
            citation_id: "c1",
            citation_type: "DOCUMENT",
            label: "SYNTHETIC FIXTURE source 1",
            page_number: 3496,
            reference_text: "Synthetic placeholder text 1 — not a real publication",
          },
          {
            citation_id: "c2",
            citation_type: "DOCUMENT",
            label: "SYNTHETIC FIXTURE source 2",
            page_number: 1007,
            reference_text: "Synthetic placeholder text 2 — not a real publication",
          },
          {
            citation_id: "c3",
            citation_type: "DOCUMENT",
            label: "SYNTHETIC FIXTURE source 3",
            page_number: 1,
            reference_text: "Synthetic placeholder text 3 — not a real publication",
          },
          {
            citation_id: "c4",
            citation_type: "DOCUMENT",
            label: "SYNTHETIC FIXTURE source 4",
            page_number: 45,
            reference_text: "Synthetic placeholder text 4 — not a real publication",
          },
          {
            citation_id: "c5",
            citation_type: "DOCUMENT",
            label: "SYNTHETIC FIXTURE source 5",
            page_number: 2657,
            reference_text: "Synthetic placeholder text 5 — not a real publication",
          },
          {
            citation_id: "c6",
            citation_type: "STRUCTURE",
            label: "SYNTHETIC FIXTURE source 6",
            entity_id: "struct-h2",
            reference_text: "Synthetic placeholder text 6 — not a real publication",
          },
          {
            citation_id: "c7",
            citation_type: "DOCUMENT",
            label: "SYNTHETIC FIXTURE source 7",
            page_number: 12,
            reference_text: "Synthetic placeholder text 7 — not a real publication",
          },
          {
            citation_id: "c8",
            citation_type: "DOCUMENT",
            label: "SYNTHETIC FIXTURE source 8",
            page_number: 110,
            reference_text: "Synthetic placeholder text 8 — not a real publication",
          },
        ],
      },
    ];

    const evidenceHeaderHtml = renderToStaticMarkup(
      createElement(AIScientistHeader, {
        activeTab: "evidence",
        onSelectTab: () => {},
        isExpanded: true,
        onToggleExpanded: () => {},
      })
    );
    const evidenceBodyHtml = renderToStaticMarkup(
      createElement(AIScientistEvidenceTab, {
        projectId: "test-project",
        conversationMessages: mockEvidenceMessages as unknown as AIMessageView[],
      })
    );
    const evidenceHtmlExpanded = wrapHtml(`${evidenceHeaderHtml}${evidenceBodyHtml}`, { isExpanded: true, title: "ChemDFT - Scientific Evidence" });
    await page.setViewportSize({ width: 720, height: 980 });
    await page.setContent(evidenceHtmlExpanded);
    await page.screenshot({ path: `${artifactDir}/actual_03_evidence_expanded.png`, fullPage: true });

    // 6. Screenshot 3: Evidence Tab - Docked (360px)
    const evidenceHtmlDocked = wrapHtml(`${evidenceHeaderHtml}${evidenceBodyHtml}`, { isExpanded: false, title: "ChemDFT - Scientific Evidence Docked" });
    await page.setViewportSize({ width: 380, height: 980 });
    await page.setContent(evidenceHtmlDocked);
    await page.screenshot({ path: `${artifactDir}/actual_03_evidence_docked.png`, fullPage: true });

    // 7. Screenshot 4: Runs Tab - Expanded (680px)
    const mockRuns = [
      { id: "synthetic-run-1", project_id: "synthetic-project", conversation_id: "synthetic-conv", status: "SUCCEEDED", current_step: 3, max_steps: 10, created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T10:02:00Z" },
      { id: "synthetic-run-2", project_id: "synthetic-project", conversation_id: "synthetic-conv", status: "WAITING_FOR_APPROVAL", current_step: 2, max_steps: 10, created_at: "2026-10-16T11:00:00Z", updated_at: "2026-10-16T11:01:00Z" },
      { id: "synthetic-run-3", project_id: "synthetic-project", conversation_id: "synthetic-conv", status: "FAILED", error_code: "PROVIDER_TIMEOUT", current_step: 1, max_steps: 10, created_at: "2026-10-16T12:00:00Z", updated_at: "2026-10-16T12:01:00Z" },
      { id: "synthetic-run-4", project_id: "synthetic-project", conversation_id: "synthetic-conv", status: "PLANNING", current_step: 1, max_steps: 10, created_at: "2026-10-16T13:00:00Z", updated_at: "2026-10-16T13:00:00Z" },
    ] satisfies AIRunView[];

    const runsHeaderHtml = renderToStaticMarkup(
      createElement(AIScientistHeader, {
        activeTab: "runs",
        onSelectTab: () => {},
        isExpanded: true,
        onToggleExpanded: () => {},
      })
    );
    const runsBodyHtml = renderToStaticMarkup(
      createElement(AIScientistRunsTab, {
        projectId: "synthetic-project",
        runs: mockRuns,
      })
    );
    const runsHtmlExpanded = wrapHtml(`${runsHeaderHtml}${runsBodyHtml}`, { isExpanded: true, title: "ChemDFT - Calculation Runs" });
    await page.setViewportSize({ width: 720, height: 1080 });
    await page.setContent(runsHtmlExpanded);
    await page.screenshot({ path: `${artifactDir}/actual_04_runs_expanded.png`, fullPage: true });

    // 8. Screenshot 4: Runs Tab - Docked (360px)
    const runsHtmlDocked = wrapHtml(`${runsHeaderHtml}${runsBodyHtml}`, { isExpanded: false, title: "ChemDFT - Calculation Runs Docked" });
    await page.setViewportSize({ width: 380, height: 1080 });
    await page.setContent(runsHtmlDocked);
    await page.screenshot({ path: `${artifactDir}/actual_04_runs_docked.png`, fullPage: true });

    // 9. Screenshot 5: Settings Tab - Expanded (680px)
    const settingsHeaderHtml = renderToStaticMarkup(
      createElement(AIScientistHeader, {
        activeTab: "settings",
        onSelectTab: () => {},
        isExpanded: true,
        onToggleExpanded: () => {},
      })
    );
    const settingsBodyHtml = renderToStaticMarkup(createElement(AIScientistSettingsTab, {}));
    const settingsHtmlExpanded = wrapHtml(`${settingsHeaderHtml}${settingsBodyHtml}`, { isExpanded: true, title: "ChemDFT - AI Scientist Settings" });
    await page.setViewportSize({ width: 720, height: 1200 });
    await page.setContent(settingsHtmlExpanded);
    await page.screenshot({ path: `${artifactDir}/actual_05_settings_expanded.png`, fullPage: true });

    // 10. Screenshot 5: Settings Tab - Docked (360px)
    const settingsHtmlDocked = wrapHtml(`${settingsHeaderHtml}${settingsBodyHtml}`, { isExpanded: false, title: "ChemDFT - AI Scientist Settings Docked" });
    await page.setViewportSize({ width: 380, height: 1200 });
    await page.setContent(settingsHtmlDocked);
    await page.screenshot({ path: `${artifactDir}/actual_05_settings_docked.png`, fullPage: true });

    // 11. Screenshot 1 Full Workstation Workspace (1440 x 950)
    const workspaceHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ChemDFT - h2-reference V1</title>
  <style>
    ${getStyles()}
    body {
      margin: 0;
      padding: 0;
      background: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .top-navbar {
      height: 48px;
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-size: 13px;
    }
    .top-nav-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .top-nav-tabs {
      display: flex;
      gap: 20px;
      margin-left: 20px;
    }
    .top-nav-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #64748b;
      text-decoration: none;
      font-weight: 500;
      padding: 14px 0;
    }
    .top-nav-tab.active {
      color: #0f172a;
      border-bottom: 2px solid #2563eb;
    }
    .main-workspace {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 560px;
      height: calc(100vh - 48px);
      overflow: hidden;
    }
    .left-workspace {
      display: flex;
      flex-direction: column;
      border-right: 1px solid #e2e8f0;
      background: #f8fafc;
      overflow-y: auto;
      padding: 16px;
      gap: 16px;
    }
    .viewer-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 480px;
      position: relative;
    }
    .viewer-tab-bar {
      display: flex;
      border-bottom: 1px solid #e2e8f0;
      padding: 0 12px;
      gap: 16px;
      font-size: 12.5px;
    }
    .viewer-tab {
      padding: 10px 0;
      color: #64748b;
      cursor: pointer;
      font-weight: 500;
    }
    .viewer-tab.active {
      color: #2563eb;
      border-bottom: 2px solid #2563eb;
    }
    .viewer-toolbar {
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #f1f5f9;
      background: #fafafa;
    }
    .viewer-canvas-area {
      flex: 1;
      position: relative;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .bottom-info-cards {
      display: grid;
      grid-template-columns: 1.2fr 1.2fr 1fr;
      gap: 16px;
    }
    .info-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px;
    }
  </style>
</head>
<body>
  <div class="top-navbar">
    <div class="top-nav-left">
      <strong style="font-size: 13.5px; color: #0f172a;">h2-reference V1</strong>
      <span style="background: #dcfce7; color: #15803d; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px;">Committed</span>
      <div class="top-nav-tabs">
        <span class="top-nav-tab">🏠 Overview</span>
        <span class="top-nav-tab active">🧊 Structures</span>
        <span class="top-nav-tab">📊 Calculations</span>
        <span class="top-nav-tab">📑 Results</span>
        <span class="top-nav-tab">⚖️ Compare</span>
        <span class="top-nav-tab">⚙️ Settings</span>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 14px; color: #64748b;">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <span>Docs</span>
      <div style="width: 26px; height: 26px; border-radius: 50%; background: #2563eb; color: white; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600;">T</div>
    </div>
  </div>

  <div class="main-workspace">
    <div class="left-workspace">
      <div class="viewer-card">
        <div class="viewer-tab-bar">
          <span class="viewer-tab active">3D Viewer</span>
          <span class="viewer-tab">2D Diagram</span>
          <span class="viewer-tab">Structure Data</span>
          <span class="viewer-tab">Properties</span>
          <span class="viewer-tab">Metadata</span>
        </div>
        <div class="viewer-toolbar">
          <div style="display: flex; align-items: center; gap: 8px;">
            <select style="font-size: 12px; padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 4px;"><option>Ball &amp; Stick</option></select>
            <button style="border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; padding: 3px 6px;">📷</button>
            <button style="border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; padding: 3px 6px;">🎯</button>
            <button style="border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; padding: 3px 6px;">🔍</button>
            <button style="border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; padding: 3px 6px;">🔄</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <select style="font-size: 12px; padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 4px;"><option>Perspective</option></select>
            <button style="border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; padding: 3px 6px;">⛶</button>
          </div>
        </div>
        <div class="viewer-canvas-area">
          <!-- 3D H2 representation -->
          <svg viewBox="0 0 400 300" width="340" height="240">
            <defs>
              <radialGradient id="sphereGrad" cx="35%" cy="35%" r="65%">
                <stop offset="0%" stop-color="#ffffff"/>
                <stop offset="60%" stop-color="#f1f5f9"/>
                <stop offset="100%" stop-color="#cbd5e1"/>
              </radialGradient>
            </defs>
            <!-- Cylinder bond -->
            <rect x="130" y="138" width="140" height="24" rx="12" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="1.5"/>
            <!-- Hydrogen 1 -->
            <circle cx="130" cy="150" r="54" fill="url(#sphereGrad)" stroke="#94a3b8" stroke-width="1"/>
            <!-- Hydrogen 2 -->
            <circle cx="270" cy="150" r="54" fill="url(#sphereGrad)" stroke="#94a3b8" stroke-width="1"/>
          </svg>

          <!-- Floating coordinate box -->
          <div style="position: absolute; bottom: 16px; right: 16px; background: rgba(255,255,255,0.92); border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; font-size: 11.5px; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
            <div style="font-weight: 600; color: #0f172a; margin-bottom: 3px;">Atoms: 2</div>
            <div style="font-family: monospace; color: #475569;">H (0.0000, 0.0000, -0.3700)</div>
            <div style="font-family: monospace; color: #475569;">H (0.0000, 0.0000, 0.3700)</div>
            <div style="color: #64748b; margin-top: 3px;">Bond length: 0.740 Å</div>
          </div>
        </div>
      </div>

      <div class="bottom-info-cards">
        <div class="info-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="font-size: 12.5px; color: #0f172a;">Structure Information</strong>
            <button style="border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; padding: 2px 6px; font-size: 11px;">✏️ Edit</button>
          </div>
          <table style="width: 100%; font-size: 11.5px; color: #475569; border-collapse: collapse;">
            <tr><td style="padding: 2px 0; color: #94a3b8;">Name</td><td style="font-weight: 500; color: #0f172a;">h2-reference</td></tr>
            <tr><td style="padding: 2px 0; color: #94a3b8;">Version</td><td><span style="background: #dcfce7; color: #166534; padding: 1px 4px; border-radius: 3px; font-size: 10.5px;">V1 (committed)</span></td></tr>
            <tr><td style="padding: 2px 0; color: #94a3b8;">Atoms</td><td>2</td></tr>
            <tr><td style="padding: 2px 0; color: #94a3b8;">Bonds</td><td>0</td></tr>
            <tr><td style="padding: 2px 0; color: #94a3b8;">Coordinates</td><td>Cartesian (Å)</td></tr>
            <tr><td style="padding: 2px 0; color: #94a3b8;">Source</td><td>h2-reference.xyz</td></tr>
            <tr><td style="padding: 2px 0; color: #94a3b8;">Origin</td><td>Imported</td></tr>
            <tr><td style="padding: 2px 0; color: #94a3b8;">Authority</td><td>USER_SUPPLIED</td></tr>
            <tr><td style="padding: 2px 0; color: #94a3b8;">Review</td><td>NOT REVIEWED</td></tr>
          </table>
        </div>

        <div class="info-card">
          <strong style="font-size: 12.5px; color: #0f172a; display: block; margin-bottom: 8px;">Files &amp; Provenance</strong>
          <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 600; font-size: 12px; color: #0f172a;">📄 h2-reference.xyz</div>
              <div style="font-size: 11px; color: #64748b;">Imported • 2 atoms</div>
            </div>
            <button style="border: none; background: none; color: #94a3b8; cursor: pointer;">⋮</button>
          </div>
          <div style="font-size: 11.5px; color: #64748b; margin-bottom: 8px;">
            Coordinate source: <strong style="color: #0f172a;">h2-reference.xyz</strong><br>
            <span style="font-family: monospace; font-size: 10.5px;">chemdft.structure.import</span>
          </div>
          <button style="width: 100%; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; padding: 5px; font-size: 11.5px; color: #334155; font-weight: 500;">Coordinates &amp; provenance</button>
        </div>

        <div class="info-card">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 12.5px; color: #0f172a;">Notes (0)</strong>
            <button style="border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; padding: 2px 6px; font-size: 11px;">+ Add note</button>
          </div>
        </div>
      </div>
    </div>

    <aside class="ai-scientist-redesign-panel is-expanded" data-testid="ai-scientist-panel" style="border-left: 1px solid #e2e8f0; height: 100%; overflow: hidden; display: flex; flex-direction: column;">
      ${renderChatContent()}
    </aside>
  </div>
</body>
</html>`;

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.setContent(workspaceHtml);
    await page.screenshot({ path: `${artifactDir}/actual_01_workspace.png`, fullPage: true });

    await browser.close();
  }, 60000);
});

