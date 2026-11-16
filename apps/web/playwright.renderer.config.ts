throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";

// Web-only stack for the molecular renderer review page (development-only route). No API, no database.
const webPort = Number(process.env.CHEMDFT_E2E_RENDERER_PORT ?? 3103);

export default defineConfig({
  testDir: "./tests/e2e-renderer",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    command: `CHEMDFT_WEB_DIST_DIR=.next-renderer-e2e pnpm dev --hostname 127.0.0.1 --port ${webPort}`,
    url: `http://127.0.0.1:${webPort}/renderer-review`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
