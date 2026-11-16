throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.CHEMDFT_E2E_WEB_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "ai-scientist-acceptance.spec.ts",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium-acceptance", use: { ...devices["Desktop Chrome"] } }],
});
