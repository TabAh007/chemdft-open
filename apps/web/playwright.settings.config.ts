import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Settings verification against the PRESENTATION-FIXTURE mock API (tests/fixtures/settings-mock-api.mjs). No engine, database, AI
 * provider or real credential is involved; it refuses the interactive stack's ports.
 *
 *   PORT=8292 MOCK_INCLUDE_FAKE=1 node tests/fixtures/settings-mock-api.mjs                  # offers a local test provider
 *   CHEMDFT_API_BASE_URL=http://127.0.0.1:8292 pnpm exec next dev -p 3292                     # hosted-like: not local development
 *   CHEMDFT_API_BASE_URL=http://127.0.0.1:8292 CHEMDFT_DEV_IDENTITY_ENABLED=true pnpm exec next dev -p 3293   # local development
 *   SETTINGS_WEB_PORT=3292 SETTINGS_LOCAL_WEB_PORT=3293 SETTINGS_API_PORT=8292 pnpm exec playwright test -c playwright.settings.config.ts
 */
const web = process.env.SETTINGS_WEB_PORT;
if (!web) throw new Error("SETTINGS_PORTS_REQUIRED: start the mock API and the web servers, then pass SETTINGS_WEB_PORT");
for (const port of [web, process.env.SETTINGS_LOCAL_WEB_PORT ?? ""]) if (["3148", "3000"].includes(port)) throw new Error("TEST_PORT_PROTECTED: refusing the interactive stack");

export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e/settings-redesign.spec.ts",
  outputDir: resolve("/tmp/chemdft-settings-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${web}`, ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
