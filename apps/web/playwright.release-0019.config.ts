import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * 0.0.19 UI cleanup captures + axe scans against the PRESENTATION-FIXTURE mock APIs (jobs 8391, comparison 8294) behind one proxy.
 * The AI endpoints are mocked in the browser (tests/e2e/ai-context-mock.ts). No AI provider, engine, database or real project.
 *
 *   PORT=8391 node tests/fixtures/jobs-mock-api.mjs ; PORT=8294 node tests/fixtures/comparison-mock-api.mjs
 *   PORT=8300 node tests/fixtures/release-0019-proxy.mjs
 *   CHEMDFT_API_BASE_URL=http://127.0.0.1:8300 pnpm exec next dev -p 3294
 *   R19_PHASE=before|after pnpm exec playwright test -c playwright.release-0019.config.ts
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e/release-0019-captures.capture.ts",
  outputDir: resolve("/tmp/chemdft-release-0019-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: process.env.R19_BASE ?? "http://127.0.0.1:3294", ...devices["Desktop Chrome"], channel: "chrome", trace: "retain-on-failure" },
});
