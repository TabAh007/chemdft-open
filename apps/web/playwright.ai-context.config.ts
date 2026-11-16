import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * AI context contract: the dock follows the page. Run against a PRESENTATION-FIXTURE mock API (jobs, claims, comparison or
 * settings fixture) or the RW2 evidence stack; the AI endpoints are mocked in the browser (tests/e2e/ai-context-mock.ts).
 * No AI provider, engine, database or real project is involved.
 *
 *   AI_CONTEXT_WEB_PORT=3291 pnpm exec playwright test -c playwright.ai-context.config.ts --grep @jobs
 */
const web = process.env.AI_CONTEXT_WEB_PORT;
if (!web) throw new Error("AI_CONTEXT_PORTS_REQUIRED: start a mock API and a web server, then pass AI_CONTEXT_WEB_PORT");
if (["3148", "3000"].includes(web)) throw new Error("TEST_PORT_PROTECTED: refusing the interactive stack");

export default defineConfig({
  testDir: "./tests",
  testMatch: process.env.AI_CONTEXT_SPEC ?? "e2e/ai-context-follows-page.spec.ts",
  outputDir: resolve("/tmp/chemdft-ai-context-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${web}`, ...devices["Desktop Chrome"], viewport: { width: 1366, height: 800 }, trace: "retain-on-failure" },
});
