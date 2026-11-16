throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.CHEMDFT_E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.CHEMDFT_E2E_API_PORT ?? 8123);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "final-visualization-polish.spec.ts",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `CHEMDFT_DATABASE_URL=sqlite:///<local-path>/Desktop/chemdft/.chemdft/chemdft.db CHEMDFT_OBJECT_ROOT=<local-path>/Desktop/chemdft/.chemdft/objects CHEMDFT_DEV_IDENTITY_ENABLED=true uv run --project ../../services/api uvicorn chemdft_api.main:app --host 127.0.0.1 --port ${apiPort}`,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `CHEMDFT_API_BASE_URL=http://127.0.0.1:${apiPort} CHEMDFT_DEV_IDENTITY_ENABLED=true pnpm dev --hostname 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}/en/projects`,
      reuseExistingServer: true,
      timeout: 45_000,
    },
  ],
  projects: [{ name: "final-polish", use: { ...devices["Desktop Chrome"] } }],
});
