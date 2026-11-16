throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.CHEMDFT_E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.CHEMDFT_E2E_API_PORT ?? 8123);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `if [ -f /tmp/chemdft-e2e-localhost.db ]; then mv /tmp/chemdft-e2e-localhost.db /tmp/chemdft-e2e-localhost.db.bak-phase10-$$; fi; if [ -d /tmp/chemdft-e2e-objects ]; then mv /tmp/chemdft-e2e-objects /tmp/chemdft-e2e-objects.bak-phase10-$$; fi; export CHEMDFT_DATABASE_URL=sqlite:////tmp/chemdft-e2e-localhost.db CHEMDFT_OBJECT_ROOT=/tmp/chemdft-e2e-objects CHEMDFT_AUTO_CREATE_SCHEMA=true CHEMDFT_DEV_IDENTITY_ENABLED=true CHEMDFT_COMPUTE_WORKER_POLL_SECONDS=0.5 CHEMDFT_INVESTIGATION_WORKER_POLL_SECONDS=0.5 CHEMDFT_KNOWLEDGE_WORKER_POLL_SECONDS=0.5; uv run --project ../../services/api python -m chemdft_api.compute_worker & uv run --project ../../services/api python -m chemdft_api.investigation_worker & uv run --project ../../services/api python -m chemdft_api.knowledge_worker & uv run --project ../../services/api uvicorn chemdft_api.main:app --host 127.0.0.1 --port ${apiPort}`,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: true,
    },
    {
      command: `CHEMDFT_WEB_DIST_DIR=.next-e2e CHEMDFT_API_BASE_URL=http://127.0.0.1:${apiPort} CHEMDFT_DEV_IDENTITY_ENABLED=true pnpm dev --hostname 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}/en`,
      reuseExistingServer: true,
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
