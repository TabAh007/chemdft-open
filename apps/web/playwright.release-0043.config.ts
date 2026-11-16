import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["release-0043-qe-periodic.spec.ts"],
  outputDir: resolve("../../output/release-0.0.43/playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  webServer: {
    command: "NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx next dev --webpack --port 3243",
    url: "http://127.0.0.1:3243/en",
    reuseExistingServer: true,
    timeout: 180_000,
  },
  use: {
    baseURL: process.env.R43_BASE ?? "http://127.0.0.1:3243",
    ...devices["Desktop Chrome"],
    channel: "chrome",
    trace: "off",
  },
});
