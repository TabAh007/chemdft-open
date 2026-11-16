import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

if (process.env.CHEMDFT_TEST_MODE !== "1" || process.env.CHEMDFT_ENVIRONMENT !== "test" ||
    !process.env.CHEMDFT_TEST_WORKSPACE || !process.env.CHEMDFT_DATABASE_URL ||
    !process.env.CHEMDFT_OBJECT_ROOT || !process.env.CHEMDFT_E2E_WEB_PORT ||
    !process.env.CHEMDFT_E2E_API_PORT) {
  throw new Error("TEST_ENVIRONMENT_REQUIRED: run browser tests with python3 tools/run_isolated_e2e.py");
}
if (["3148", "3000"].includes(process.env.CHEMDFT_E2E_WEB_PORT) ||
    ["8148", "8000"].includes(process.env.CHEMDFT_E2E_API_PORT)) {
  throw new Error("TEST_PORT_PROTECTED: isolated tests cannot target interactive ports");
}
const repositoryRoot = process.env.CHEMDFT_E2E_REPOSITORY_ROOT ?? resolve("../..");
execFileSync(resolve(repositoryRoot, ".venv/bin/python"), ["-B", resolve(repositoryRoot, "tools/run_isolated_e2e.py"), "--check-only",
  "--api-port", process.env.CHEMDFT_E2E_API_PORT,
  "--web-port", process.env.CHEMDFT_E2E_WEB_PORT], { stdio: "pipe" });

const suites: Record<string, string> = {
  geometry: "e2e/ketcher-2d-3d-acceptance.spec.ts",
  "scientific-safety": "e2e/isolated-scientific-safety.spec.ts",
  "psi4-ui": "e2e/pf8d-psi4-acceptance.spec.ts",
  "rw1-journey": "e2e/rw1-researcher-journey.spec.ts",
  "rw2-analysis": "e2e/rw2-analysis-journey.spec.ts",
  "ai-molecule-creator": "e2e/ai-molecule-creator.spec.ts",
  "ai-scientist": "e2e/ai-scientist.spec.ts",
  "ai-model-switching": "e2e/ai-model-switcher.spec.ts",
  "molecular-recognition": "e2e/batch-b2-recognition-flow.spec.ts",
  "ai-scientific-workflow": "e2e/batch-b4-scientist-flow.spec.ts",
  "ai-calculation-execution": "e2e/batch-b42-calculation-execution.spec.ts",
  "molecular-correction": "e2e/batch-b3-correction-flow.spec.ts",
  "as-c1-nvidia": "e2e/as-c1-nvidia-acceptance.spec.ts",
  "approval-geometry-offline": "e2e/approval-geometry-offline.spec.ts",
  "ui-1-ai-scientist": "e2e/ui-1-ai-scientist.spec.ts",
  "ai-nvidia-planning": "e2e/ai-nvidia-planning.spec.ts",
  "ai-scientific-execution": "e2e/ai-scientific-execution.spec.ts",
  "ai-live-browser": "e2e/ai-live-browser.spec.ts",
  "ai-live-execution": "e2e/ai-live-execution.spec.ts",
  "ai-kimi-integration": "e2e/ai-kimi-integration.spec.ts",
  "scientific-claims": "e2e/scientific-claims.spec.ts",
};
const suite = process.env.CHEMDFT_E2E_SUITE ?? "";
if (!suites[suite]) throw new Error("TEST_SUITE_REQUIRED: select a supported isolated suite");
if ((process.env.CHEMDFT_E2E_OFFLINE === "1" || ["scientific-safety", "approval-geometry-offline", "as-c1-nvidia", "ui-1-ai-scientist"].includes(suite)) && process.env.CHEMDFT_E2E_WORKER_MODE !== "disabled") {
  throw new Error("TEST_WORKER_MUST_BE_DISABLED: queue safety tests must not execute calculations");
}

const defaultGrep = process.env.CHEMDFT_E2E_GREP ? new RegExp(process.env.CHEMDFT_E2E_GREP) :
  suite === "geometry" ? /Scenario F|Scenario G/ :
  suite === "psi4-ui" ? /Synthetic unavailable capability/ : undefined;

export default defineConfig({
  testDir: "./tests",
  testMatch: suites[suite],
  // Keep the default gate small; other scenarios require an explicit --grep.
  ...(defaultGrep ? { grep: defaultGrep } : {}),
  grepInvert: /LIVE NATIVE|LIVE IDENTITY/,
  globalSetup: "./tests/e2e/isolated-global-setup.ts",
  outputDir: resolve(process.env.CHEMDFT_TEST_WORKSPACE, "playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${process.env.CHEMDFT_E2E_WEB_PORT}`,
    ...devices["Desktop Chrome"],
    // Optional: use an installed browser (for example "chrome") when the bundled Chromium is not downloaded.
    ...(process.env.CHEMDFT_E2E_CHANNEL ? { channel: process.env.CHEMDFT_E2E_CHANNEL } : {}),
    trace: "retain-on-failure",
  },
});
