throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";

// Run against a separately launched frontend/API/worker with disposable database and object storage.
export default defineConfig({
  testDir: "./tests", timeout: 120_000, expect: { timeout: 15_000 },
  fullyParallel: false, retries: 0, workers: 1,
  outputDir: process.env.CHEMDFT_CORRECTIONS_OUTPUT ?? "/tmp/chemdft-pf8b13-corrections/e2e",
  reporter: [["list"], ["json", { outputFile: process.env.CHEMDFT_CORRECTIONS_REPORT ?? "/tmp/chemdft-pf8b13-corrections/e2e.json" }]],
  use: { baseURL: process.env.CHEMDFT_CORRECTIONS_URL ?? "http://127.0.0.1:3194", ...devices["Desktop Chrome"], actionTimeout: 15_000, trace: "retain-on-failure" },
  projects: [{ name: "desktop" }],
});
