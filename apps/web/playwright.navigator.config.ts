throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.CHEMDFT_E2E_NAV_WEB_PORT ?? 3140);
const apiPort = Number(process.env.CHEMDFT_E2E_NAV_API_PORT ?? 8140);
const database = process.env.CHEMDFT_E2E_NAV_DATABASE ?? "/tmp/chemdft-pf4-navigator.db";

export default defineConfig({
  expect: { timeout: 20000 },
  testDir: "./tests/e2e-navigator", fullyParallel: false, timeout: 60000,
  use: { baseURL: `http://127.0.0.1:${webPort}`, ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: [
    { command: `CHEMDFT_DATABASE_URL=sqlite:///${database} CHEMDFT_OBJECT_ROOT=/tmp/chemdft-pf4-navigator-objects CHEMDFT_AUTO_CREATE_SCHEMA=true CHEMDFT_AUTH_MODE=dev CHEMDFT_DEV_IDENTITY_ENABLED=true CHEMDFT_AI_PROVIDER=fake CHEMDFT_AI_API_KEY='' CHEMDFT_RUN_AI_INTEGRATION=false uv run --project ../../services/api python ../../services/api/tests/pf7_independence_server.py --port ${apiPort}`, url: `http://127.0.0.1:${apiPort}/health`, reuseExistingServer: false, timeout: 90000 },
    { command: `CHEMDFT_WEB_DIST_DIR=.next-navigator-e2e CHEMDFT_AUTH_MODE=dev CHEMDFT_DEV_IDENTITY_ENABLED=true CHEMDFT_API_BASE_URL=http://127.0.0.1:${apiPort} pnpm dev --hostname 127.0.0.1 --port ${webPort}`, url: `http://127.0.0.1:${webPort}/en/projects`, reuseExistingServer: false, timeout: 180000 },
  ],
  projects: [{ name: "navigator-desktop" }],
});
