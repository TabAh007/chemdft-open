throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /(ir-spectroscopy-flow|tddft-flow)\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  projects: [{ name: "ir-spectroscopy", use: { ...devices["Desktop Chrome"] } }],
});
