throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["pf8c-context-correction.spec.ts", "pf8b13-result-association.spec.ts", "pf8b2-native-optimization.spec.ts"],
  fullyParallel: false, workers: 1, timeout: 300_000, expect: { timeout: 20_000 },
  outputDir: "../../.chemdft/pf8c-gate-c1/playwright-results",
  reporter: [["list"], ["json", { outputFile: "../../.chemdft/pf8c-gate-c1/playwright-report.json" }]],
  use: { baseURL: "http://127.0.0.1:3119", trace: "retain-on-failure", actionTimeout: 20_000 },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1100 } } }],
});
