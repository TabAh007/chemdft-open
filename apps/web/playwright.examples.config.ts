throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const webPort = 3105,
  apiPort = 8125;
const origin = `http://127.0.0.1:${webPort}`;
process.env.CHEMDFT_E2E_EXAMPLE_AUTH_SECRET ??= randomBytes(32).toString("hex");
const apiDb = "/tmp/chemdft-e2e-examples-api.db";
const authDb = "/tmp/chemdft-e2e-examples-users.db";
export default defineConfig({
  testDir: "./tests/e2e-examples",
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 30000 },
  use: { baseURL: origin, trace: "retain-on-failure" },
  outputDir: "../../output/pf5-review/playwright-results",
  webServer: [
    {
      command: `rm -f ${apiDb} ${authDb} ${authDb}-wal ${authDb}-shm; rm -rf /tmp/chemdft-e2e-examples-objects; export CHEMDFT_DATABASE_URL=sqlite:///${apiDb} CHEMDFT_OBJECT_ROOT=/tmp/chemdft-e2e-examples-objects CHEMDFT_AUTO_CREATE_SCHEMA=true CHEMDFT_AUTH_MODE=jwt CHEMDFT_DEV_IDENTITY_ENABLED=false CHEMDFT_AUTH_ISSUER=${origin} CHEMDFT_AUTH_AUDIENCE=chemdft-api CHEMDFT_AUTH_JWKS_URL=${origin}/api/auth/jwks CHEMDFT_AI_API_KEY='' CHEMDFT_RUN_AI_INTEGRATION=false; cd ../../services/api && uv run alembic upgrade head && uv run python -m chemdft_api.examples.seed --publish && uv run python tests/pf7_independence_server.py --port ${apiPort}`,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: `CHEMDFT_WEB_DIST_DIR=.next-examples-e2e CHEMDFT_AUTH_MODE=jwt CHEMDFT_DEV_IDENTITY_ENABLED=false BETTER_AUTH_SECRET=${process.env.CHEMDFT_E2E_EXAMPLE_AUTH_SECRET} BETTER_AUTH_URL=${origin} CHEMDFT_AUTH_DATABASE_URL=file:${authDb} CHEMDFT_API_BASE_URL=http://127.0.0.1:${apiPort} pnpm dev --hostname 127.0.0.1 --port ${webPort}`,
      url: `${origin}/en/examples`,
      reuseExistingServer: false,
      timeout: 180000,
    },
  ],
  projects: [
    { name: "examples-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
