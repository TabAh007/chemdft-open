import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * RW-2 read-only verification against a DISPOSABLE COPY of the accepted native-engine evidence
 * (python3 tools/rw2_evidence_stack.py). It refuses to run against the interactive stack.
 */
const web = process.env.RW2_EVIDENCE_WEB_PORT;
const api = process.env.RW2_EVIDENCE_API_PORT;
if (!web || !api) throw new Error("RW2_EVIDENCE_PORTS_REQUIRED: start tools/rw2_evidence_stack.py and pass RW2_EVIDENCE_WEB_PORT/RW2_EVIDENCE_API_PORT");
if (["3148", "3000"].includes(web) || ["8148", "8000"].includes(api)) throw new Error("TEST_PORT_PROTECTED: refusing the interactive stack");

export default defineConfig({
  testDir: "./tests",
  testMatch: process.env.RW2_EVIDENCE_SPEC ?? "e2e/rw2-evidence-viewers.spec.ts",
  outputDir: resolve("/tmp/chemdft-rw2-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${web}`, ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
