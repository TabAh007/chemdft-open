import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "release-0034-workspace-matrix.spec.ts",
  outputDir: resolve("../../output/release-0.0.34/playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  webServer: {
    command: "npx next dev --webpack --port 3210",
    url: "http://127.0.0.1:3210/en",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.R34_BASE ?? "http://127.0.0.1:3210",
    ...devices["Desktop Chrome"],
    channel: "chrome",
    trace: "off",
  },
});
