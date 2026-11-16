import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * 0.0.22 logo/favicon captures against the PRESENTATION-FIXTURE mock APIs (jobs 8391, comparison 8294, proxy 8300). No AI provider, engine or database.
 *   PORT=8391 node tests/fixtures/jobs-mock-api.mjs ; PORT=8294 node tests/fixtures/comparison-mock-api.mjs ; PORT=8300 node tests/fixtures/release-0022-proxy.mjs
 *   CHEMDFT_API_BASE_URL=http://127.0.0.1:8300 pnpm exec next build && ... next start -p 3322   (before: same on origin/main, port 3323)
 *   R22_PHASE=before R22_BASE=http://127.0.0.1:3323 pnpm exec playwright test -c playwright.release-0022.config.ts   (after: default port 3322)
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e/release-0022-captures.capture.ts",
  outputDir: resolve("/tmp/chemdft-release-0022-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: process.env.R22_BASE ?? "http://127.0.0.1:3322", ...devices["Desktop Chrome"], channel: "chrome", trace: "retain-on-failure" },
});
