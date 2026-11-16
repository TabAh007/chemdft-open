import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "release-0033-workspace-matrix.spec.ts",
  outputDir: resolve("../../output/release-0.0.33/playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.R33_BASE ?? "http://127.0.0.1:3210",
    ...devices["Desktop Chrome"],
    channel: "chrome",
    trace: "off",
  },
});

