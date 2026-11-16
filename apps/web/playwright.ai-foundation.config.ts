throw new Error("TEST_CONFIG_ISOLATION_REQUIRED: run selected specs with python3 tools/run_isolated_e2e.py -- <spec path>; legacy Playwright configs are disabled to protect persistent data.");
import { defineConfig, devices } from "@playwright/test";
const baseURL = "http://127.0.0.1:3177";
export default defineConfig({
  testDir: "./tests/e2e-ai-foundation", workers: 1, fullyParallel: false,
  timeout: 120000, expect: { timeout: 30000 },
  use: { baseURL, ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  outputDir: "../../output/pf7-review/playwright-results",
  webServer: [
    { command: "rm -f /private/tmp/chemdft-pf7-browser.db /private/tmp/chemdft-pf7-browser.db-wal /private/tmp/chemdft-pf7-browser.db-shm; CHEMDFT_PF7_BROWSER_FIXTURE=fake-credentials-only CHEMDFT_ENVIRONMENT=test CHEMDFT_DATABASE_URL=sqlite:////private/tmp/chemdft-pf7-browser.db CHEMDFT_OBJECT_ROOT=/private/tmp/chemdft-pf7-browser-objects CHEMDFT_AUTO_CREATE_SCHEMA=true CHEMDFT_AUTH_MODE=dev CHEMDFT_DEV_IDENTITY_ENABLED=true CHEMDFT_AI_PROVIDER=fake CHEMDFT_AI_API_KEY='' CHEMDFT_RUN_AI_INTEGRATION=false CHEMDFT_BILLING_BYOK_ENABLED=true CHEMDFT_BILLING_BYOK_SECRET_PROVIDER=local-encrypted CHEMDFT_BYOK_LOCAL_ROOT=/private/tmp/chemdft-pf7-browser-secrets uv run --project ../../services/api python ../../services/api/tests/pf7_browser_server.py", url: "http://127.0.0.1:8177/health", reuseExistingServer: false, timeout: 120000 },
    { command: "CHEMDFT_WEB_DIST_DIR=.next-ai-e2e CHEMDFT_AUTH_MODE=dev CHEMDFT_DEV_IDENTITY_ENABLED=true CHEMDFT_API_BASE_URL=http://127.0.0.1:8177 pnpm dev --hostname 127.0.0.1 --port 3177", url: `${baseURL}/en/projects`, reuseExistingServer: false, timeout: 180000 },
  ],
});
