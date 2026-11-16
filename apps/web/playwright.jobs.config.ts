import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Jobs workstation verification against the PRESENTATION-FIXTURE mock API (tests/fixtures/jobs-mock-api.mjs).
 * No engine, database, AI provider or real project is involved; it refuses the interactive stack's ports.
 *
 *   PORT=8291 node tests/fixtures/jobs-mock-api.mjs
 *   CHEMDFT_API_BASE_URL=http://127.0.0.1:8291 pnpm exec next dev -p 3291
 *   JOBS_WEB_PORT=3291 pnpm exec playwright test -c playwright.jobs.config.ts
 */
const web = process.env.JOBS_WEB_PORT;
if (!web) throw new Error("JOBS_PORTS_REQUIRED: start the mock API and a web server, then pass JOBS_WEB_PORT");
if (["3148", "3000"].includes(web)) throw new Error("TEST_PORT_PROTECTED: refusing the interactive stack");

export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e/jobs-workstation.spec.ts",
  outputDir: resolve("/tmp/chemdft-jobs-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${web}`, ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
