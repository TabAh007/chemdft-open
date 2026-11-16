import { execFileSync } from "node:child_process";

import { expect, request as playwrightRequest, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// PF-1 end-to-end gate: Better Auth session cookie -> trusted Next layer -> short-lived JWT -> FastAPI (JWKS)
// -> ChemDFT identity -> project authorization. Public signup stays closed; accounts are controlled fixtures.
const WEB_PORT = Number(process.env.CHEMDFT_E2E_AUTH_WEB_PORT ?? 3102);
const API_PORT = Number(process.env.CHEMDFT_E2E_AUTH_API_PORT ?? 8124);
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = "e2e-correct-horse-battery";

function createControlledUser(email: string, name: string) {
  execFileSync("pnpm", ["exec", "tsx", "scripts/create-controlled-user.ts", "--email", email, "--name", name], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CHEMDFT_AUTH_MODE: "jwt",
      BETTER_AUTH_SECRET: process.env.CHEMDFT_E2E_AUTH_SECRET,
      BETTER_AUTH_URL: WEB,
      CHEMDFT_AUTH_DATABASE_URL: "file:/tmp/chemdft-e2e-auth-users.db",
      CHEMDFT_NEW_USER_PASSWORD: PASSWORD,
    },
    stdio: "pipe",
  });
}

async function signIn(browser: Browser, email: string, next?: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: WEB });
  const page = await context.newPage();
  await page.goto(`/en/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  return { context, page };
}

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.beforeAll(async () => {
  // Make the web server initialise Better Auth (and its schema) before the fixture script opens the same file.
  const probe = await playwrightRequest.newContext({ baseURL: WEB });
  await probe.get("/api/auth/ok", { timeout: 120_000 });
  await probe.dispose();
  createControlledUser("alice@example.test", "Alice Example");
  createControlledUser("bob@example.test", "Bob Example");
});

test("anonymous visitors cannot sign up, reach projects, or inherit any identity", async ({ page, request }) => {
  await page.goto("/en/login");
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.getByTestId("signup-closed")).toContainText("invitation only");
  await expect(page.getByTestId("login-google")).toHaveCount(0); // Google is hidden until credentials exist
  await expect(page.getByRole("link", { name: /sign up|create account|register/i })).toHaveCount(0);

  const signup = await request.post("/api/auth/sign-up/email", { headers: { origin: WEB }, data: { email: "mallory@example.test", password: PASSWORD, name: "Mallory" } });
  expect(signup.status()).toBe(400);
  expect((await signup.json()).code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");

  // the optimistic gate redirects navigation; the API refuses every credential-less call
  await page.goto("/en/projects");
  await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fprojects/);
  for (const path of ["/api/chemdft/v1/projects", "/api/chemdft/v1/me"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    expect(await response.json()).toEqual({ detail: "authentication_required" });
  }
  const spoof = { "X-ChemDFT-User-ID": "00000000-0000-4000-8000-000000000001", "X-ChemDFT-Organization-ID": "00000000-0000-4000-8000-000000000010", Authorization: "Bearer forged" };
  expect((await request.get("/api/chemdft/v1/projects", { headers: spoof })).status()).toBe(401);
  const direct = await playwrightRequest.newContext();
  expect((await direct.get(`${API}/v1/projects`)).status()).toBe(401);
  expect((await direct.get(`${API}/v1/projects`, { headers: spoof })).status()).toBe(401);
  await direct.dispose();

  const jwks = await (await request.get("/api/auth/jwks")).json();
  expect(jwks.keys.length).toBeGreaterThan(0);
  expect(JSON.stringify(jwks)).not.toMatch(/"d"\s*:/);
});

test("two signed-in users are isolated end to end, and the browser never holds an API token", async ({ browser }) => {
  const alice = await signIn(browser, "alice@example.test");
  await expect(alice.page).toHaveURL(/\/en\/welcome$/, { timeout: 30_000 });
  const bob = await signIn(browser, "bob@example.test");
  await expect(bob.page).toHaveURL(/\/en\/welcome$/, { timeout: 30_000 });

  const aliceMe = await (await alice.context.request.get("/api/chemdft/v1/me")).json();
  const bobMe = await (await bob.context.request.get("/api/chemdft/v1/me")).json();
  expect(aliceMe).toMatchObject({ email: "alice@example.test", kind: "HUMAN", auth_mode: "jwt", organization: { kind: "PERSONAL", role: "owner" } });
  expect(bobMe.organization.id).not.toBe(aliceMe.organization.id);

  const created = await alice.context.request.post("/api/chemdft/v1/projects", { data: { name: "Alice project", slug: "alice-project" } });
  expect(created.status()).toBe(201);
  const projectA = await created.json();
  const bobProject = await (await bob.context.request.post("/api/chemdft/v1/projects", { data: { name: "Bob project", slug: "bob-project" } })).json();

  // Bob cannot read, mutate or discover Alice's project (by id, by list, with spoofed identity headers)
  for (const [method, path] of [["get", `/api/chemdft/v1/projects/${projectA.id}`], ["get", `/api/chemdft/v1/projects/${projectA.id}/structures`], ["get", `/api/chemdft/v1/projects/${projectA.id}/files`]] as const) {
    const response = await bob.context.request[method](path, { headers: { "X-ChemDFT-User-ID": aliceMe.id, "X-ChemDFT-Organization-ID": aliceMe.organization.id } });
    expect([403, 404], path).toContain(response.status());
  }
  const bobList = await (await bob.context.request.get("/api/chemdft/v1/projects")).json();
  expect(bobList.map((p: { id: string }) => p.id)).toEqual([bobProject.id]);
  const aliceList = await (await alice.context.request.get("/api/chemdft/v1/projects")).json();
  expect(aliceList.map((p: { id: string }) => p.id)).toEqual([projectA.id]);

  // PUT travels through the Next forwarding layer to FastAPI in jwt mode: a FastAPI answer, never Next's 405
  const put = await alice.context.request.put(`/api/chemdft/v1/projects/${projectA.id}/experimental/spectra/datasets/00000000-0000-4000-8000-0000000000aa/association`, { data: { state: "UNASSIGNED" } });
  expect(put.status()).not.toBe(405);
  expect(await put.json()).toHaveProperty("detail");

  // credentials stay server-side: HttpOnly SameSite cookie, nothing readable by page scripts, nothing stored
  const cookie = (await alice.context.cookies()).find((c) => c.name.endsWith("session_token"))!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  expect(await alice.page.evaluate(() => document.cookie)).not.toContain("session_token");
  const storage = await alice.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toMatch(/eyJ|token|bearer/i);
  const html = await alice.page.content();
  expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // no JWT embedded in the rendered page

  await alice.context.close();
  await bob.context.close();
});

test("the account page, sign-out and post-login redirect safety work", async ({ browser }) => {
  const evil = await signIn(browser, "alice@example.test", "https://evil.test/steal");
  await expect(evil.page).toHaveURL(`${WEB}/en/projects`); // an off-site `next` falls back to the project list
  await evil.context.close();
  const protocolRelative = await signIn(browser, "alice@example.test", "//evil.test/en/projects");
  await expect(protocolRelative.page).toHaveURL(`${WEB}/en/projects`);
  await protocolRelative.context.close();

  const kept = await signIn(browser, "alice@example.test", "/en/account");
  await expect(kept.page).toHaveURL(`${WEB}/en/account`);
  await expect(kept.page.getByTestId("account-email")).toHaveText("alice@example.test");
  await expect(kept.page.getByTestId("account-organization")).toContainText("owner");
  await kept.page.getByTestId("sign-out").click();
  await expect(kept.page).toHaveURL(/\/en\/login/);
  expect((await kept.context.request.get("/api/chemdft/v1/me")).status()).toBe(401);
  await kept.page.goto("/en/projects");
  await expect(kept.page).toHaveURL(/\/en\/login/);
  await kept.context.close();

  const wrong = await browser.newContext({ baseURL: WEB });
  const page = await wrong.newPage();
  await page.goto("/en/login");
  await page.getByTestId("login-email").fill("alice@example.test");
  await page.getByTestId("login-password").fill("not-the-password-123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toHaveText("The email or password is incorrect.");
  await page.getByTestId("login-email").fill("nobody@example.test");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toHaveText("The email or password is incorrect."); // no account enumeration
  await wrong.close();
});

test("a real user never sees broken legacy example buttons or the frozen acceptance projects", async ({ browser }) => {
  createControlledUser("carol@example.test", "Carol Example");
  const { context, page } = await signIn(browser, "carol@example.test");
  await expect(page).toHaveURL(/\/en\/welcome$/, { timeout: 30_000 });
  await expect(page.locator("[data-welcome-path]")).toHaveCount(6);
  await page.locator('[data-welcome-path="examples"]').click();
  await expect(page).toHaveURL(/\/en\/examples$/);
  await expect(page.getByRole("heading", { name: "Scientific examples", exact: true })).toBeVisible();
  await expect(page.getByTestId("choose-water-example")).toHaveCount(0);
  await expect(page.getByTestId("choose-chromium-example")).toHaveCount(0);
  expect((await context.request.get("/api/chemdft/v1/examples/water-hf-sto3g")).status()).toBe(404);
  expect(await (await context.request.get("/api/chemdft/v1/projects")).json()).toEqual([]);
  // and the legacy projects are simply not found for her, whatever id is guessed
  for (const id of ["f39aefcf-a1cd-4606-8f03-f9b18eadb96d", "7ae7e41b-2483-42c3-823e-42dd1b9fa72f"]) {
    expect((await context.request.get(`/api/chemdft/v1/projects/${id}`)).status()).toBe(404);
  }
  await context.close();
});


test("the homepage primary action sends signed-out visitors to sign-in and signed-in users into the product", async ({ browser }) => {
  const anonymous = await browser.newContext({ baseURL: WEB });
  const visitor = await anonymous.newPage();
  await visitor.goto("/en");
  await expect(visitor.getByRole("link", { name: "Open ChemDFT" })).toHaveCount(0); // signed out: nothing to open yet
  await visitor.getByTestId("hero-primary").click();
  await expect(visitor).toHaveURL(/\/en\/login$/);
  await expect(visitor.getByRole("link", { name: /sign up|create account|register/i })).toHaveCount(0);
  await anonymous.close();

  const { context, page } = await signIn(browser, "alice@example.test");
  await page.waitForURL(/\/en\/projects/);
  await page.goto("/en");
  await expect(page.getByTestId("header-launch")).toHaveText("Open ChemDFT"); // signed in: no "Sign in"
  await expect(page.getByTestId("header-account")).toBeVisible();
  await expect(page.getByTestId("header-signin")).toHaveCount(0);
  await page.getByTestId("hero-primary").click();
  await expect(page).toHaveURL(/\/en\/projects$/);
  await expect(page.getByRole("heading", { name: "Scientific Projects", exact: true })).toBeVisible();
  await context.close();
});
