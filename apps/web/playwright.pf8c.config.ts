throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";

// Deliberately uses separately supervised localhost services, never the shared E2E database.
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "pf8c-conformer-workstation.spec.ts", fullyParallel: false, workers: 1,
  timeout: 300_000, expect: { timeout: 20_000 },
  outputDir: "../../.chemdft/pf8c-gate-c/playwright-results",
  reporter: [["list"], ["json", { outputFile: "../../.chemdft/pf8c-gate-c/playwright-report.json" }]],
  use: { baseURL: "http://127.0.0.1:3118", trace: "retain-on-failure", actionTimeout: 20_000 },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1100 } } }],
});
