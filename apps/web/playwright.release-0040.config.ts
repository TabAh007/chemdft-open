import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["release-0040-wrapping-controls.spec.ts"],
  outputDir: resolve("../../output/release-0.0.40/playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  webServer: {
    command: "NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx next dev --webpack --port 3240",
    url: "http://127.0.0.1:3240/en",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.R40_BASE ?? "http://127.0.0.1:3240",
    ...devices["Desktop Chrome"],
    channel: "chrome",
    trace: "off",
  },
});
