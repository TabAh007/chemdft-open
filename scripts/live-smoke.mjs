#!/usr/bin/env node
// ChemDFT live smoke test (release 0.0.54). Nightly-style check of the hosted site.
//
//   node scripts/live-smoke.mjs          free and read-only: sign in, load the projects page and one project workspace,
//                                        check health and capability flags. Starts no compute.
//   node scripts/live-smoke.mjs --job    ALSO submits one H2 HF/STO-3G job (starts the pilot, small cost) and compares the energy.
//
// Credentials: CHEMDFT_SMOKE_EMAIL and CHEMDFT_SMOKE_PASSWORD, from the environment only. They are never printed, logged or stored.
// Optional: CHEMDFT_SMOKE_BASE_URL (default https://chemdft.com), CHEMDFT_SMOKE_EXPECT_PYSCF / CHEMDFT_SMOKE_EXPECT_GEOMETRIC (1|0, default 1),
//           CHEMDFT_SMOKE_STRUCTURE_VERSION_ID (required with --job: an H2 structure version in the smoke project),
//           CHEMDFT_SMOKE_TIMEOUT_MINUTES (default 20), CHEMDFT_SMOKE_HEADED=1.
// Prints PASS/FAIL per check, a final PASS or FAIL line, and exits 0 only if every check passed. See docs/implementation/LIVE_SMOKE.md.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildH2Submission, checkCapabilities, checkHealth, compareEnergy, firstProjectId, formatCheck, isTerminalState,
  parseArgs, readBaseUrl, readCredentials, readExpectations,
} from "./live-smoke-lib.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log("Usage: node scripts/live-smoke.mjs [--job]\nSee docs/implementation/LIVE_SMOKE.md.");
  process.exit(0);
}
if (options.unknown.length) {
  console.log(`Unknown option(s): ${options.unknown.join(" ")}. Usage: node scripts/live-smoke.mjs [--job]`);
  process.exit(2);
}
const credentials = readCredentials(process.env);
if (!credentials.ok) {
  console.log(credentials.message);
  console.log("FAIL");
  process.exit(1);
}

const base = readBaseUrl(process.env);
const expectations = readExpectations(process.env);
const timeoutMs = Number(process.env.CHEMDFT_SMOKE_TIMEOUT_MINUTES ?? "20") * 60_000;
const CRASH = /workspace could not load/i;
const results = [];
function record(name, ok, detail) {
  const result = { name, ok, detail };
  results.push(result);
  console.log(formatCheck(result));
  return ok;
}
function finish() {
  const ok = results.length > 0 && results.every((r) => r.ok);
  console.log(ok ? "PASS" : "FAIL");
  process.exit(ok ? 0 : 1);
}

if (options.job) {
  console.log("WARNING: --job submits a real H2 HF/STO-3G calculation. It STARTS THE PILOT INSTANCE (small AWS cost) and uses one compute job of the smoke account's daily limit.");
  if (!process.env.CHEMDFT_SMOKE_STRUCTURE_VERSION_ID) {
    record("--job configuration", false, "CHEMDFT_SMOKE_STRUCTURE_VERSION_ID is not set (an H2 structure version in the smoke project)");
    finish();
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "apps", "web", "package.json"));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch({ headless: process.env.CHEMDFT_SMOKE_HEADED !== "1" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const boundaryLogs = [];
page.on("console", (message) => { if (message.text().includes("[chemdft-boundary]")) boundaryLogs.push(message.text().slice(0, 300)); });
const crashed = async () => CRASH.test(await page.locator("body").innerText().catch(() => ""));
const getJson = async (path) => {
  const response = await context.request.get(`${base}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok()) throw new Error(`GET ${path} answered HTTP ${response.status()}`);
  return response.json();
};

try {
  // 1. Health (public) and sign-in.
  try { const health = checkHealth(await getJson("/api/chemdft/health")); record("API health", health.ok, health.detail); }
  catch (error) { record("API health", false, error instanceof Error ? error.message : "request failed"); }

  await page.goto(`${base}/en/login`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-email").fill(credentials.email);
  await page.getByTestId("login-password").fill(credentials.password);
  const terms = page.getByTestId("login-terms-label").locator("input");
  if (await terms.count()) await terms.first().check().catch(() => undefined);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 60_000 }).then(
    () => record("Sign in", true, ""),
    () => record("Sign in", false, "still on the login page after 60 s"),
  );
  if (!results.every((r) => r.name !== "Sign in" || r.ok)) finish();

  // 2. Projects page and one workspace, without the error screen.
  await page.goto(`${base}/en/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  record("Projects page loads without the error screen", !(await crashed()), "");
  const hrefs = await page.locator("a[href*='/projects/']").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  const projectId = firstProjectId(hrefs);
  if (!projectId) {
    record("Project workspace", false, "no project link found on the projects page (the smoke account needs one project)");
  } else {
    await page.goto(`${base}/en/projects/${projectId}/workspace`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(4_000);
    record("Project workspace loads without the error screen", !(await crashed()), "");
    record("No [chemdft-boundary] console log", boundaryLogs.length === 0, boundaryLogs[0] ?? "");

    // 3. Capability flags for this project.
    try {
      const capabilities = await getJson(`/api/chemdft/v1/projects/${projectId}/calculations/capabilities`);
      for (const check of checkCapabilities(capabilities, expectations)) record(check.name, check.ok, check.detail);
    } catch (error) { record("Capability endpoint", false, error instanceof Error ? error.message : "request failed"); }

    // 4. Optional single job (explicit --job only).
    if (options.job) {
      const key = `live-smoke-${Date.now()}`;
      const post = await context.request.post(`${base}/api/chemdft/v1/projects/${projectId}/calculations`, {
        data: buildH2Submission(projectId, process.env.CHEMDFT_SMOKE_STRUCTURE_VERSION_ID, key),
        headers: { "content-type": "application/json" },
      });
      if (!post.ok()) {
        record("H2 HF/STO-3G submission", false, `HTTP ${post.status()}`);
      } else {
        let detail = await post.json();
        const calculationId = detail?.calculation?.id;
        record("H2 HF/STO-3G submission", Boolean(calculationId), calculationId ? "submitted" : "no calculation id returned");
        const deadline = Date.now() + timeoutMs;
        while (calculationId && !isTerminalState(detail?.calculation?.state) && Date.now() < deadline) {
          await page.waitForTimeout(10_000);
          detail = await getJson(`/api/chemdft/v1/projects/${projectId}/calculations/${calculationId}`);
        }
        const energy = compareEnergy(detail);
        record("H2 HF/STO-3G energy", energy.ok, energy.detail);
      }
    }
  }
} catch (error) {
  record("Unexpected error", false, error instanceof Error ? error.message.split("\n")[0] : "unknown");
} finally {
  await browser.close();
}
finish();
