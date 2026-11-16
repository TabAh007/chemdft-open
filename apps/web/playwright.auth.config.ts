throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

// Isolated jwt-mode stack: real Better Auth in Next, real FastAPI verifying its JWKS. Nothing here touches
// the persistent dev database, the dev API (:8000) or the acceptance stack. The secret is random per run.
const webPort = Number(process.env.CHEMDFT_E2E_AUTH_WEB_PORT ?? 3102);
const apiPort = Number(process.env.CHEMDFT_E2E_AUTH_API_PORT ?? 8124);
process.env.CHEMDFT_E2E_AUTH_SECRET ??= randomBytes(32).toString("hex");

const webOrigin = `http://127.0.0.1:${webPort}`;
const apiDb = "/tmp/chemdft-e2e-auth-api.db";
const authDb = "/tmp/chemdft-e2e-auth-users.db";

export default defineConfig({
  testDir: "./tests/e2e-auth",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: webOrigin, trace: "retain-on-failure" },
  webServer: [
    {
      command: `rm -f ${apiDb} ${authDb} ${authDb}-wal ${authDb}-shm; rm -rf /tmp/chemdft-e2e-auth-objects; export CHEMDFT_DATABASE_URL=sqlite:///${apiDb} CHEMDFT_OBJECT_ROOT=/tmp/chemdft-e2e-auth-objects CHEMDFT_AUTO_CREATE_SCHEMA=true CHEMDFT_AUTH_MODE=jwt CHEMDFT_AUTH_ISSUER=${webOrigin} CHEMDFT_AUTH_AUDIENCE=chemdft-api CHEMDFT_AUTH_JWKS_URL=${webOrigin}/api/auth/jwks; uv run --project ../../services/api uvicorn chemdft_api.main:app --host 127.0.0.1 --port ${apiPort}`,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
    },
    {
      command: `CHEMDFT_WEB_DIST_DIR=.next-auth-e2e CHEMDFT_AUTH_MODE=jwt BETTER_AUTH_SECRET=${process.env.CHEMDFT_E2E_AUTH_SECRET} BETTER_AUTH_URL=${webOrigin} CHEMDFT_AUTH_DATABASE_URL=file:${authDb} CHEMDFT_API_BASE_URL=http://127.0.0.1:${apiPort} pnpm dev --hostname 127.0.0.1 --port ${webPort}`,
      url: `${webOrigin}/en/login`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
