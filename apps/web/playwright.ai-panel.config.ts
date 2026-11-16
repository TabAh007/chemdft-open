import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * AI Scientist panel layout (desktop >= 1280 px). Runs against the PRESENTATION-FIXTURE mock API (jobs fixture) with the AI
 * endpoints mocked in the browser (tests/e2e/ai-context-mock.ts). No AI provider, engine, database or real project is involved.
 *
 *   PORT=8391 node tests/fixtures/jobs-mock-api.mjs
 *   CHEMDFT_API_BASE_URL=http://127.0.0.1:8391 pnpm exec next dev -p 3391
 *   AI_PANEL_WEB_PORT=3391 pnpm exec playwright test -c playwright.ai-panel.config.ts
 */
const web = process.env.AI_PANEL_WEB_PORT ?? "3391";
if (["3148", "3000"].includes(web)) throw new Error("TEST_PORT_PROTECTED: refusing the interactive stack");

export default defineConfig({
  testDir: "./tests",
  testMatch: process.env.AI_PANEL_SPEC ?? "e2e/ai-panel-layout.spec.ts",
  outputDir: resolve("/tmp/chemdft-ai-panel-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${web}`, ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: [
    {
      command: "PORT=8391 node tests/fixtures/jobs-mock-api.mjs",
      port: 8391,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `CHEMDFT_API_BASE_URL=http://127.0.0.1:8391 pnpm exec next dev -p ${web}`,
      url: `http://127.0.0.1:${web}/en`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
