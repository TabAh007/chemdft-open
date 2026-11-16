import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Paper vs ChemDFT verification against the PRESENTATION-FIXTURE mock API (tests/fixtures/comparison-mock-api.mjs).
 * No engine, database, AI provider or real project is involved; it refuses the interactive stack's ports.
 *
 *   PORT=8293 node tests/fixtures/comparison-mock-api.mjs
 *   CHEMDFT_API_BASE_URL=http://127.0.0.1:8293 ./node_modules/.bin/next dev -p 3293
 *   COMPARISON_WEB_PORT=3293 CHEMDFT_E2E_API_PORT=8293 ./node_modules/.bin/playwright test -c playwright.comparison.config.ts
 */
const web = process.env.COMPARISON_WEB_PORT;
if (!web) throw new Error("COMPARISON_PORTS_REQUIRED: start the mock API and a web server, then pass COMPARISON_WEB_PORT");
if (["3148", "3000", "3100"].includes(web)) throw new Error("TEST_PORT_PROTECTED: refusing the interactive stack");

export default defineConfig({
  testDir: "./tests",
  testMatch: ["e2e/comparison-workstation.spec.ts", "e2e/scientific-comparison.spec.ts"],
  outputDir: resolve("/tmp/chemdft-comparison-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${web}`, ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
