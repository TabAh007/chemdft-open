import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * 0.0.17 UI verification captures (run in 0.0.18) against the PRESENTATION-FIXTURE mock APIs. No engine, database, AI provider or
 * real project is involved. Uses the installed Google Chrome (no Playwright browser download). Three mock APIs and three web servers:
 *
 *   PORT=8292 node tests/fixtures/settings-mock-api.mjs      CHEMDFT_API_BASE_URL=http://127.0.0.1:8292 pnpm exec next dev -p 3292
 *   PORT=8293 node tests/fixtures/claims-mock-api.mjs        CHEMDFT_API_BASE_URL=http://127.0.0.1:8293 pnpm exec next dev -p 3293
 *   PORT=8294 node tests/fixtures/comparison-mock-api.mjs    CHEMDFT_API_BASE_URL=http://127.0.0.1:8294 pnpm exec next dev -p 3294
 *   pnpm exec playwright test -c playwright.release-0018.config.ts
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e/release-0018-captures.spec.ts",
  outputDir: resolve("/tmp/chemdft-release-0018-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { ...devices["Desktop Chrome"], channel: "chrome", trace: "retain-on-failure" },
});
