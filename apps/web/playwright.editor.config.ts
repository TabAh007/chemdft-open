import { defineConfig } from "@playwright/test";

// Mock-transport specs for the molecule editor (no backend, no persistent data); same shape as playwright.layout.config.ts.
// Start the web app first: `pnpm exec next dev -p 3210`.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["molecule-editor-*.spec.ts", "other-pages-layout.spec.ts", "releases-license-layout.spec.ts", "home-nav-layout.spec.ts", "overscroll-swipe-back.spec.ts", "paper-fixes-*.spec.ts", "export-share.spec.ts", "ui-audit.spec.ts", "_scratch-*.spec.ts"],
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "off",
    // Installed Google Chrome: the bundled Playwright browser is not downloaded on this machine.
    channel: process.env.CHEMDFT_E2E_CHANNEL ?? "chrome",
  },
  webServer: {
    command: "pnpm exec next dev -p 3210",
    url: "http://127.0.0.1:3210/en",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
