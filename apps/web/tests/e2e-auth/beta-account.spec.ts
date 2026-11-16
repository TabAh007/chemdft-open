import { execFileSync } from "node:child_process";

import { expect, request as playwrightRequest, test, type Browser } from "@playwright/test";

// Release 0.0.10 owner/CI spec (ADR-045): Settings limits, data export, isolation between two ordinary accounts, deletion.
// NOT RUN in the agent session. Run with the isolated jwt stack:
//   python3 tools/run_isolated_e2e.py -- apps/web/tests/e2e-auth/beta-account.spec.ts
// Accounts are controlled local fixtures (public signup stays closed); never point this at the live site.
const WEB = `http://127.0.0.1:${Number(process.env.CHEMDFT_E2E_AUTH_WEB_PORT ?? 3102)}`;
const PASSWORD = "e2e-correct-horse-battery";

function createControlledUser(email: string, name: string) {
  execFileSync("pnpm", ["exec", "tsx", "scripts/create-controlled-user.ts", "--email", email, "--name", name], {
    cwd: process.cwd(),
    env: { ...process.env, CHEMDFT_AUTH_MODE: "jwt", BETTER_AUTH_SECRET: process.env.CHEMDFT_E2E_AUTH_SECRET, BETTER_AUTH_URL: WEB, CHEMDFT_AUTH_DATABASE_URL: "file:/tmp/chemdft-e2e-auth-users.db", CHEMDFT_NEW_USER_PASSWORD: PASSWORD },
    stdio: "pipe",
  });
}

async function signIn(browser: Browser, email: string) {
  const context = await browser.newContext({ baseURL: WEB });
  const page = await context.newPage();
  await page.goto("/en/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/en\/(projects|welcome)/);
  return { context, page };
}

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.beforeAll(async () => {
  const probe = await playwrightRequest.newContext({ baseURL: WEB });
  await probe.get("/api/auth/ok", { timeout: 120_000 });
  await probe.dispose();
  createControlledUser("ada@example.test", "Ada Example");
  createControlledUser("grace@example.test", "Grace Example");
});

test("public pages and the closed signup route", async ({ page, request }) => {
  for (const path of ["terms", "privacy", "beta"]) {
    await page.goto(`/en/${path}`);
    await expect(page.getByTestId("legal-draft-notice")).toContainText("BETA");
  }
  await page.goto("/en/signup");
  await expect(page.getByTestId("signup-closed")).toBeVisible();
  const refused = await request.post("/api/auth/sign-up/email", { headers: { origin: WEB }, data: { email: "m@example.test", password: PASSWORD, name: "M" } });
  expect((await refused.json()).code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
});

test("Settings shows limits and export, and two accounts stay isolated through export and deletion", async ({ browser }) => {
  const ada = await signIn(browser, "ada@example.test");
  const grace = await signIn(browser, "grace@example.test");
  const adaProject = await (await ada.context.request.post("/api/chemdft/v1/projects", { data: { name: "Ada private", slug: "ada-private" } })).json();
  await grace.context.request.post("/api/chemdft/v1/projects", { data: { name: "Grace private", slug: "grace-private" } });

  await ada.page.goto("/en/settings/general");
  await expect(ada.page.getByTestId("account-limits")).toContainText("no self-service beta limits"); // controlled accounts have no profile
  await expect(ada.page.getByTestId("export-download")).toBeVisible();

  const exported = await ada.context.request.get("/api/chemdft/v1/me/export");
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("application/zip");
  expect((await exported.body()).toString("latin1")).not.toContain("grace@example.test");

  expect((await grace.context.request.get(`/api/chemdft/v1/projects/${adaProject.id}`)).status()).toBe(404);

  await ada.page.getByTestId("delete-start").click();
  await ada.page.getByTestId("delete-email").fill("wrong@example.test");
  await ada.page.getByTestId("delete-confirm-button").click();
  await expect(ada.page.getByRole("alert")).toContainText("does not match");
  await ada.page.getByTestId("delete-email").fill("ada@example.test");
  await ada.page.getByTestId("delete-confirm-button").click();
  await ada.page.waitForURL(/\/en\/login/);

  // The deleted person cannot sign back in; Grace is untouched.
  const again = await browser.newContext({ baseURL: WEB });
  const attempt = await again.request.post("/api/auth/sign-in/email", { headers: { origin: WEB }, data: { email: "ada@example.test", password: PASSWORD } });
  expect(attempt.status()).toBe(401);
  expect((await grace.context.request.get("/api/chemdft/v1/projects")).status()).toBe(200);
});
