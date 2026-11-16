import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Claims workstation verification against the PRESENTATION-FIXTURE mock API (tests/fixtures/claims-mock-api.mjs).
 * No engine, database, AI provider or real project is involved; it refuses the interactive stack's ports.
 *
 *   PORT=8292 node tests/fixtures/claims-mock-api.mjs
 *   CHEMDFT_API_BASE_URL=http://127.0.0.1:8292 pnpm exec next dev -p 3292
 *   CLAIMS_WEB_PORT=3292 CHEMDFT_E2E_API_PORT=8292 pnpm exec playwright test -c playwright.claims.config.ts
 */
const web = process.env.CLAIMS_WEB_PORT;
if (!web) throw new Error("CLAIMS_PORTS_REQUIRED: start the mock API and a web server, then pass CLAIMS_WEB_PORT");
if (["3148", "3000", "3100"].includes(web)) throw new Error("TEST_PORT_PROTECTED: refusing the interactive stack");

export default defineConfig({
  testDir: "./tests",
  testMatch: ["e2e/claims-workstation.spec.ts", "e2e/scientific-claims.spec.ts"],
  outputDir: resolve("/tmp/chemdft-claims-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${web}`, ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
